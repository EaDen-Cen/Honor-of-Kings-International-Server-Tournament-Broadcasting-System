import OBSWebSocket, { EventSubscription, type OBSRequestTypes, type OBSResponseTypes } from 'obs-websocket-js/json';
import { OBS_AUDIO_ROLES, OBS_PRESET_IDS, type ObsAudioRole, type ObsCommand, type ObsCommandResult, type ObsOutputState, type ObsPublicConfig, type ObsSnapshot, type ObsStatus } from '../../src/shared/obsProtocol.js';
import { ObsConfigStore, parseObsConfigUpdate, publicObsConfig } from './ObsConfig.js';
import { probeDiskFree, recordHealth, type ObsDiskProbe } from './ObsRecordHealth.js';

export interface ObsServiceOptions {
  onChange?: (snapshot: ObsSnapshot) => void;
  requestTimeoutMs?: number;
  commandTimeoutMs?: number;
  pollMs?: number;
  reconnectMs?: number;
  diskProbe?: ObsDiskProbe;
  canEnterGame?: () => { ready: boolean; issues: Array<{ code: string; message: string }> };
}
class CommandInterrupted extends Error {
  constructor(message: string, readonly uncertain = false) { super(message); }
}
interface Operation { command: ObsCommand; generation: number; cancelled: string | null; uncertain: boolean; deadline: number }
const emptyOutput = (): ObsOutputState => ({ active: null, paused: null, reconnecting: null, durationMs: null, bytes: null });
const validNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const wait = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });
function parseCommand(input: unknown): ObsCommand {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid OBS command');
  const command = input as Record<string, unknown>;
  if (typeof command.id !== 'string' || !/^[\w.-]{1,128}$/.test(command.id)) throw new Error('OBS command requires a unique ID');
  const fields: Record<string, string[]> = { preset: ['id', 'type', 'preset'], scene: ['id', 'type', 'sceneName'], bgm: ['id', 'type', 'volume', 'muted', 'fadeMs'], cancel: ['id', 'type'], refresh: ['id', 'type'] };
  if (typeof command.type !== 'string' || !Object.hasOwn(fields, command.type) || Object.keys(command).some(k => !fields[command.type as string].includes(k))) throw new Error('Unsupported OBS command');
  if (command.type === 'preset' && !(OBS_PRESET_IDS as readonly unknown[]).includes(command.preset)) throw new Error('Unknown OBS preset');
  if (command.type === 'scene' && (typeof command.sceneName !== 'string' || !command.sceneName || command.sceneName.length > 256)) throw new Error('Invalid OBS scene');
  if (command.type === 'bgm' && ((command.volume === undefined && command.muted === undefined)
    || (command.volume !== undefined && (!validNumber(command.volume) || command.volume > 1))
    || (command.muted !== undefined && typeof command.muted !== 'boolean')
    || (command.fadeMs !== undefined && (!validNumber(command.fadeMs) || command.fadeMs > 3000)))) throw new Error('Invalid BGM control');
  return structuredClone(command) as unknown as ObsCommand;
}

/** Local OBS control. No recording/stream start/stop request is exposed here. */
export class ObsService {
  private config: ObsConfigStore;
  private obs: OBSWebSocket | null = null;
  private generation = 0;
  private active: Operation | null = null;
  private commands = new Map<string, { signature: string; promise: Promise<ObsCommandResult> }>();
  private desired = false;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private connecting: Promise<ObsStatus> | null = null;
  private refreshing: { generation: number; promise: Promise<void> } | null = null;
  private retryCount = 0;
  private expectedScene: { name: string; until: number } | null = null;
  private expectedAudio = new Map<string, Array<{ value: number | boolean; until: number }>>();
  private recordingSample: { bytes: number; at: number } | null = null;
  private observedRate: number | null = null;
  private sceneEventVersion = 0;
  private audioEventVersions = new Map<string, number>();
  private recordEventVersion = 0;
  private streamEventVersion = 0;
  private status: ObsStatus = { connection: 'disconnected', lastError: null, connectedAt: null, obsVersion: null,
    sceneName: null, scenes: [], inputs: [], recording: emptyOutput(), streaming: emptyOutput(),
    recordHealth: { directory: null, directorySource: null, freeBytes: null, estimatedMinutes: null, rateBytesPerSecond: null, level: 'unknown', warnings: [] },
    warnings: [], lastCommand: null, observedAt: null };
  constructor(file: string, private options: ObsServiceOptions = {}) {
    this.config = new ObsConfigStore(file);
    if (this.config.loadError) { this.status.connection = 'error'; this.status.lastError = this.config.loadError; }
  }
  getConfig(): ObsPublicConfig { return publicObsConfig(this.config.data); }
  getStatus(): ObsStatus { return structuredClone(this.status); }
  getSnapshot(): ObsSnapshot { return { config: this.getConfig(), status: this.getStatus() }; }
  private publish() { this.options.onChange?.(this.getSnapshot()); }
  private interrupt(message: string, uncertain = false) {
    if (this.active) { this.active.cancelled = message; this.active.uncertain ||= uncertain; }
  }
  async updateConfig(input: unknown): Promise<ObsPublicConfig> {
    if (this.closed) throw new Error('OBS service is closed');
    const next = parseObsConfigUpdate(this.config.data, input);
    // While connected reject bindings invented outside the authoritative OBS lists.
    if (this.status.connection === 'connected') {
      if (Object.values(next.inputs).some(name => name && !this.status.inputs.some(i => i.inputName === name))) throw new Error('Select an existing OBS audio input');
      if (Object.values(next.presets).some(preset => preset.sceneName && !this.status.scenes.includes(preset.sceneName))) throw new Error('Select an existing OBS scene');
    }
    const previous = this.config.data;
    this.config.save(next);
    this.interrupt('OBS configuration changed; previous action cancelled');
    if (previous.url !== next.url || previous.password !== next.password || !next.enabled) await this.disconnect();
    else if (this.status.connection === 'connected') void this.refresh().catch(() => {});
    if (!this.config.loadError && this.status.connection === 'error') this.status.lastError = null;
    this.publish();
    return this.getConfig();
  }
  async connect(): Promise<ObsStatus> {
    if (this.closed) throw new Error('OBS service is closed');
    if (!this.config.data.enabled || !this.config.data.password) throw new Error('Enable OBS and configure its authentication password first');
    this.desired = true;
    clearTimeout(this.reconnectTimer);
    if (this.status.connection === 'connected') return this.getStatus();
    if (this.connecting) return this.connecting;
    const pending = this.open();
    this.connecting = pending;
    try { return await pending; } finally { if (this.connecting === pending) this.connecting = null; }
  }
  private async open(): Promise<ObsStatus> {
    const generation = ++this.generation;
    const obs = new OBSWebSocket();
    this.obs = obs;
    let authenticatedServer = false;
    let compatibleServer = false;
    const current = () => this.obs === obs && this.generation === generation;
    this.status.connection = this.retryCount ? 'reconnecting' : 'connecting';
    this.status.lastError = null;
    this.publish();
    obs.on('Hello', hello => {
      authenticatedServer = !!hello.authentication;
      compatibleServer = hello.rpcVersion >= 1 && /^5\./.test(hello.obsWebSocketVersion);
      if (!authenticatedServer || !compatibleServer) void obs.disconnect().catch(() => {});
    });
    obs.on('ConnectionClosed', () => { if (current()) this.connectionLost('OBS connection closed'); });
    obs.on('ConnectionError', () => { /* ConnectionClosed/connect rejection owns state; never log raw transport details. */ });
    obs.on('CurrentProgramSceneChanged', event => {
      if (!current()) return;
      ++this.sceneEventVersion;
      const own = this.expectedScene?.name === event.sceneName && this.expectedScene.until >= Date.now();
      if (own) this.expectedScene = null;
      else this.interrupt('OBS scene was changed manually; previous action cancelled');
      this.status.sceneName = event.sceneName;
      this.status.observedAt = Date.now();
      this.publish();
    });
    obs.on('InputVolumeChanged', event => {
      if (!current()) return;
      this.audioEvent(event.inputName, 'volume', event.inputVolumeMul);
    });
    obs.on('InputMuteStateChanged', event => {
      if (!current()) return;
      this.audioEvent(event.inputName, 'muted', event.inputMuted);
    });
    obs.on('RecordStateChanged', event => {
      if (!current()) return;
      ++this.recordEventVersion;
      this.recordActive(event.outputActive);
      this.status.recording.paused = event.outputState === 'OBS_WEBSOCKET_OUTPUT_PAUSED';
      this.publish();
      void this.refresh().catch(() => {});
    });
    obs.on('StreamStateChanged', event => {
      if (!current()) return;
      ++this.streamEventVersion;
      this.status.streaming.active = event.outputActive;
      this.status.streaming.reconnecting = event.outputState === 'OBS_WEBSOCKET_OUTPUT_RECONNECTING';
      this.publish();
      void this.refresh().catch(() => {});
    });
    for (const name of ['SceneListChanged', 'InputCreated', 'InputRemoved', 'InputNameChanged', 'CurrentSceneCollectionChanged'] as const) {
      obs.on(name, () => { if (current()) { this.interrupt('OBS resources changed; inspect bindings before retrying'); void this.refresh().catch(() => {}); } });
    }
    try {
      const hello = await this.deadline(obs.connect(this.config.data.url, this.config.data.password, {
        rpcVersion: 1, eventSubscriptions: EventSubscription.General | EventSubscription.Scenes | EventSubscription.Inputs | EventSubscription.Outputs | EventSubscription.Config,
      }), this.options.requestTimeoutMs ?? 4000);
      if (!current() || !this.desired) throw new CommandInterrupted('OBS connection cancelled');
      if (!authenticatedServer) throw new Error('OBS must require password authentication');
      if (!compatibleServer) throw new Error('OBS WebSocket 5 with RPC version 1 is required');
      void hello;
      this.status.connection = 'connected';
      this.status.connectedAt = Date.now();
      this.retryCount = 0;
      await this.refresh();
      if (!current() || this.status.connection !== 'connected') throw new Error('OBS initial state could not be read');
      this.pollTimer = setInterval(() => { void this.refresh().catch(() => {}); }, this.options.pollMs ?? 5000);
      this.pollTimer.unref();
      this.publish();
      return this.getStatus();
    } catch (error) {
      if (current()) {
        const code = error && typeof error === 'object' && 'code' in error ? Number(error.code) : 0;
        const message = !authenticatedServer ? 'OBS requires password authentication or could not be reached'
          : code === 4009 ? 'OBS authentication failed; check the local password' : 'Cannot connect to OBS or read its state';
        this.connectionLost(message);
      }
      throw new Error(this.status.lastError ?? 'OBS connection cancelled');
    }
  }
  private connectionLost(message: string) {
    const previous = this.obs;
    this.obs = null;
    ++this.generation;
    clearInterval(this.pollTimer);
    this.interrupt('OBS disconnected; command was not replayed', true);
    this.expectedAudio.clear(); this.expectedScene = null;
    if (this.status.recording.active) this.addWarning('OBS disconnected while recording; recording continuity is unknown');
    this.status.connection = this.desired && this.config.data.reconnect ? 'reconnecting' : 'error';
    this.status.lastError = message;
    this.status.connectedAt = null;
    this.status.recording = emptyOutput(); this.status.streaming = emptyOutput();
    this.status.sceneName = null;
    this.status.recordHealth.level = 'unknown';
    this.status.recordHealth.warnings = ['OBS disconnected; recording status and disk readings may be stale'];
    this.recordingSample = null; this.observedRate = null;
    if (previous) void previous.disconnect().catch(() => {});
    if (this.desired && !this.closed && this.config.data.reconnect) {
      clearTimeout(this.reconnectTimer);
      const delay = Math.min((this.options.reconnectMs ?? 1000) * 2 ** Math.min(this.retryCount++, 5), 30000);
      this.reconnectTimer = setTimeout(() => { void this.connect().catch(() => {}); }, delay);
      this.reconnectTimer.unref();
    }
    this.publish();
  }
  async disconnect(): Promise<ObsStatus> {
    this.desired = false;
    clearTimeout(this.reconnectTimer); clearInterval(this.pollTimer);
    this.interrupt('OBS action cancelled by disconnect', true);
    const previous = this.obs;
    this.obs = null; ++this.generation;
    this.expectedAudio.clear(); this.expectedScene = null;
    this.recordingSample = null; this.observedRate = null;
    this.status.connection = 'disconnected'; this.status.connectedAt = null;
    this.status.sceneName = null; this.status.recording = emptyOutput(); this.status.streaming = emptyOutput();
    this.status.recordHealth.level = 'unknown';
    this.status.recordHealth.warnings = ['OBS disconnected; recording status and disk readings may be stale'];
    if (previous) await previous.disconnect().catch(() => {});
    this.publish();
    return this.getStatus();
  }
  async close(): Promise<void> { this.closed = true; await this.disconnect(); }
  private addWarning(message: string) { if (!this.status.warnings.includes(message)) this.status.warnings = [...this.status.warnings.slice(-9), message]; }
  private recordActive(active: boolean) {
    if (this.status.recording.active === true && !active) this.addWarning('Recording stopped in OBS; verify the recording file and disk space');
    if (active && this.status.recording.active !== true) {
      this.status.warnings = this.status.warnings.filter(w => !w.startsWith('Recording stopped') && !w.startsWith('OBS disconnected while'));
      this.recordingSample = null; this.observedRate = null;
    }
    this.status.recording.active = active;
  }
  private audioEvent(name: string, property: 'volume' | 'muted', value: number | boolean) {
    this.audioEventVersions.set(name, (this.audioEventVersions.get(name) ?? 0) + 1);
    const key = name + ':' + property;
    const expected = (this.expectedAudio.get(key) ?? []).filter(e => e.until >= Date.now());
    const match = expected.findIndex(e => typeof value === 'number' && typeof e.value === 'number' ? Math.abs(e.value - value) < 0.001 : e.value === value);
    if (match >= 0) expected.splice(match, 1);
    else if (Object.values(this.config.data.inputs).includes(name)) this.interrupt('OBS audio was changed manually; previous action cancelled');
    this.expectedAudio.set(key, expected);
    const input = this.status.inputs.find(i => i.inputName === name);
    if (input) {
      if (property === 'volume' && validNumber(value)) input.volume = value;
      if (property === 'muted' && typeof value === 'boolean') input.muted = value;
    }
    this.status.observedAt = Date.now(); this.publish();
  }
  private async deadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new CommandInterrupted('OBS response timed out; result is unconfirmed', true)), milliseconds); })]); }
    finally { clearTimeout(timer); }
  }
  private async request<K extends keyof OBSRequestTypes>(type: K, data?: OBSRequestTypes[K]): Promise<OBSResponseTypes[K]> {
    const obs = this.obs, generation = this.generation;
    if (!obs || this.status.connection !== 'connected') throw new CommandInterrupted('OBS is disconnected', true);
    try {
      const response = await this.deadline(obs.call(type, data), this.options.requestTimeoutMs ?? 2500);
      if (this.obs !== obs || this.generation !== generation) throw new CommandInterrupted('OBS connection changed; result is unconfirmed', true);
      return response;
    } catch (error) {
      if (error instanceof CommandInterrupted) {
        if (this.obs === obs) this.connectionLost(error.message);
        throw error;
      }
      // OBS errors may echo request data. Return only the request name and numeric code.
      const code = error && typeof error === 'object' && 'code' in error ? Number(error.code) : 0;
      throw new Error(`OBS ${type} failed${Number.isFinite(code) && code ? ` (${code})` : ''}`);
    }
  }
  private refresh(): Promise<void> {
    if (this.status.connection !== 'connected') return Promise.resolve();
    if (this.refreshing?.generation === this.generation) return this.refreshing.promise;
    const generation = this.generation;
    const promise = this.readState();
    const refresh = { generation, promise };
    this.refreshing = refresh;
    void promise.finally(() => { if (this.refreshing === refresh) this.refreshing = null; }).catch(() => {});
    return promise;
  }
  private async readState(): Promise<void> {
    const generation = this.generation;
    const sceneEventVersion = this.sceneEventVersion, recordEventVersion = this.recordEventVersion, streamEventVersion = this.streamEventVersion;
    const audioEventVersions = new Map(this.audioEventVersions);
    try {
      const [version, scenes, inputs, recording, streaming] = await Promise.all([
        this.request('GetVersion'), this.request('GetSceneList'), this.request('GetInputList'), this.request('GetRecordStatus'), this.request('GetStreamStatus'),
      ]);
      if (generation !== this.generation) return;
      this.status.obsVersion = version.obsVersion;
      this.status.scenes = scenes.scenes.map(s => s.sceneName).filter((s): s is string => typeof s === 'string');
      if (this.sceneEventVersion === sceneEventVersion) this.status.sceneName = scenes.currentProgramSceneName;
      const audio = await Promise.all(inputs.inputs.map(async input => {
        const name = String(input.inputName ?? '');
        try {
          const [volume, mute] = await Promise.all([this.request('GetInputVolume', { inputName: name }), this.request('GetInputMute', { inputName: name })]);
          return { inputName: name, inputKind: String(input.inputKind ?? ''), volume: volume.inputVolumeMul, muted: mute.inputMuted };
        } catch { return null; } // Video-only inputs are not audio bindings.
      }));
      if (generation !== this.generation) return;
      this.status.inputs = audio.filter((i): i is NonNullable<typeof i> => i !== null).map(input => {
        if ((this.audioEventVersions.get(input.inputName) ?? 0) === (audioEventVersions.get(input.inputName) ?? 0)) return input;
        return this.status.inputs.find(i => i.inputName === input.inputName) ?? input;
      });
      if (this.recordEventVersion === recordEventVersion) {
        this.recordActive(recording.outputActive);
        this.status.recording = { active: recording.outputActive, paused: recording.outputPaused, reconnecting: null, durationMs: recording.outputDuration, bytes: recording.outputBytes };
      }
      if (this.streamEventVersion === streamEventVersion) this.status.streaming = { active: streaming.outputActive, paused: null, reconnecting: streaming.outputReconnecting, durationMs: streaming.outputDuration, bytes: streaming.outputBytes };
      const now = Date.now();
      if (recording.outputActive && !recording.outputPaused && validNumber(recording.outputBytes)) {
        if (this.recordingSample && recording.outputBytes >= this.recordingSample.bytes && now - this.recordingSample.at >= 1000) this.observedRate = (recording.outputBytes - this.recordingSample.bytes) / ((now - this.recordingSample.at) / 1000);
        this.recordingSample = { bytes: recording.outputBytes, at: now };
      } else this.recordingSample = null;
      let directory: string | null = null;
      let source: 'obs' | 'manual' | null = null;
      try { const result = await this.request('GetRecordDirectory'); directory = result.recordDirectory || null; source = directory ? 'obs' : null; } catch { /* Old OBS versions require an explicit local fallback. */ }
      if (!directory && this.config.data.recordDirectory) { directory = this.config.data.recordDirectory; source = 'manual'; }
      const probe = this.options.diskProbe ?? probeDiskFree;
      const health = await recordHealth({ directory, source, lowDiskGb: this.config.data.lowDiskGb,
        remainingMinutesWarning: this.config.data.remainingMinutesWarning, rate: this.observedRate,
        probe: path => this.deadline(probe(path), this.options.requestTimeoutMs ?? 2500) });
      if (generation !== this.generation) return;
      this.status.recordHealth = health;
      this.status.observedAt = now;
      this.status.lastError = null;
      this.publish();
    } catch (error) {
      if (generation === this.generation) { this.status.lastError = error instanceof CommandInterrupted ? error.message : 'Cannot refresh OBS status'; this.publish(); }
      throw error;
    }
  }
  command(input: unknown): Promise<ObsCommandResult> {
    const command = parseCommand(input);
    const signature = JSON.stringify(command);
    const existing = this.commands.get(command.id);
    if (existing) {
      if (existing.signature !== signature) throw new Error('OBS command ID was already used for another action');
      return existing.promise;
    }
    if (this.closed) throw new Error('OBS service is closed');
    if (command.type !== 'refresh') this.interrupt('Superseded by a newer director action');
    const promise = this.execute(command);
    this.commands.set(command.id, { signature, promise });
    // Bound memory, preserving recent IDs through reconnects. No command is replayed.
    if (this.commands.size > 1024) this.commands.delete(this.commands.keys().next().value!);
    return promise;
  }
  private check(operation: Operation) {
    if (operation.cancelled) throw new CommandInterrupted(operation.cancelled, operation.uncertain);
    if (operation.generation !== this.generation || this.status.connection !== 'connected') throw new CommandInterrupted('OBS connection changed; command not replayed', true);
    if (Date.now() >= operation.deadline) throw new CommandInterrupted('OBS command timed out; verify actual state', true);
  }
  private gameGuard(sceneName: string, preset?: string) {
    if (preset !== 'game' && (!this.config.data.presets.game.sceneName || sceneName !== this.config.data.presets.game.sceneName)) return;
    const readiness = this.options.canEnterGame?.();
    if (!readiness?.ready) throw new Error('Game scene blocked: ' + (readiness?.issues.map(i => i.message).join('; ') || 'verify player IDs and final lineup first'));
  }
  private audioInput(role: ObsAudioRole): string {
    const name = this.config.data.inputs[role];
    if (!name || !this.status.inputs.some(i => i.inputName === name)) throw new Error(`Bind an available OBS ${role} audio input first`);
    return name;
  }
  private expectAudio(name: string, property: string, value: number | boolean) {
    const key = name + ':' + property;
    this.expectedAudio.set(key, [...(this.expectedAudio.get(key) ?? []).filter(e => e.until >= Date.now()), { value, until: Date.now() + 3000 }]);
  }
  private async audio(operation: Operation, role: ObsAudioRole, volume: number | undefined, muted: boolean | undefined, fadeMs: number) {
    this.check(operation);
    const name = this.audioInput(role);
    const current = await this.request('GetInputVolume', { inputName: name });
    this.check(operation);
    if (muted === false) { this.expectAudio(name, 'muted', false); await this.request('SetInputMute', { inputName: name, inputMuted: false }); this.check(operation); }
    if (volume !== undefined) {
      const steps = Math.max(1, Math.ceil(fadeMs / 100));
      for (let step = 1; step <= steps; step++) {
        if (fadeMs) await wait(fadeMs / steps);
        this.check(operation);
        const value = step === steps ? volume : current.inputVolumeMul + (volume - current.inputVolumeMul) * step / steps;
        this.expectAudio(name, 'volume', value);
        await this.request('SetInputVolume', { inputName: name, inputVolumeMul: value });
        this.check(operation);
      }
    }
    if (muted === true) { this.expectAudio(name, 'muted', true); await this.request('SetInputMute', { inputName: name, inputMuted: true }); this.check(operation); }
    const [actualVolume, actualMute] = await Promise.all([this.request('GetInputVolume', { inputName: name }), this.request('GetInputMute', { inputName: name })]);
    this.check(operation);
    const input = this.status.inputs.find(i => i.inputName === name);
    if (input) { input.volume = actualVolume.inputVolumeMul; input.muted = actualMute.inputMuted; }
    if ((volume !== undefined && Math.abs(actualVolume.inputVolumeMul - volume) > 0.005) || (muted !== undefined && actualMute.inputMuted !== muted)) throw new CommandInterrupted('OBS audio does not match the requested state; inspect manual controls');
  }
  private async execute(command: ObsCommand): Promise<ObsCommandResult> {
    const result: ObsCommandResult = { id: command.id, type: command.type, status: 'running', message: 'Waiting for OBS confirmation', startedAt: Date.now() };
    const operation: Operation = { command, generation: this.generation, cancelled: null, uncertain: false, deadline: Date.now() + (this.options.commandTimeoutMs ?? 8000) };
    if (command.type !== 'refresh') this.active = operation;
    this.status.lastCommand = result; this.publish();
    try {
      if (command.type === 'cancel') result.message = 'Previous director action cancelled; OBS outputs continue';
      else {
        this.check(operation);
        if (command.type === 'refresh') await this.refresh();
        if (command.type === 'bgm') await this.audio(operation, 'bgm', command.volume, command.muted, command.fadeMs ?? 0);
        if (command.type === 'preset' || command.type === 'scene') {
          const preset = command.type === 'preset' ? this.config.data.presets[command.preset] : null;
          const sceneName = command.type === 'scene' ? command.sceneName : preset!.sceneName;
          if (!sceneName || !this.status.scenes.includes(sceneName)) throw new Error('Bind an available OBS scene first');
          this.gameGuard(sceneName, command.type === 'preset' ? command.preset : undefined);
          if (preset) {
            // Validate every audio binding before the first side effect.
            for (const role of OBS_AUDIO_ROLES) if (preset.audio[role]) this.audioInput(role);
            const fades = await Promise.allSettled(OBS_AUDIO_ROLES.filter(role => preset.audio[role]).map(async role => {
              const target = preset.audio[role]!;
              try { await this.audio(operation, role, target.volume, target.muted, preset.fadeMs); }
              catch (error) { operation.cancelled ||= 'Preset audio step failed; remaining steps cancelled'; throw error; }
            }));
            const failed = fades.find((fade): fade is PromiseRejectedResult => fade.status === 'rejected');
            if (failed) throw failed.reason;
          }
          this.check(operation);
          this.gameGuard(sceneName, command.type === 'preset' ? command.preset : undefined);
          this.expectedScene = { name: sceneName, until: Date.now() + 3000 };
          await this.request('SetCurrentProgramScene', { sceneName });
          this.check(operation);
          const actual = await this.request('GetCurrentProgramScene');
          this.check(operation);
          this.status.sceneName = actual.sceneName;
          if (actual.sceneName !== sceneName) throw new CommandInterrupted('OBS scene differs from the requested scene; inspect manual controls');
        }
        result.message = 'OBS confirmed the requested state';
      }
      result.status = 'succeeded';
    } catch (error) {
      result.status = error instanceof CommandInterrupted ? error.uncertain ? 'unconfirmed' : 'cancelled' : 'failed';
      result.message = error instanceof Error ? error.message : 'OBS action failed';
    } finally {
      result.finishedAt = Date.now();
      if (this.active === operation) this.active = null;
      if (this.status.lastCommand?.id === command.id) this.status.lastCommand = result;
      this.publish();
    }
    return structuredClone(result);
  }
}
