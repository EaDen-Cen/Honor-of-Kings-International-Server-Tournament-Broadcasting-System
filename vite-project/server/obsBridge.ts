import { createHash, randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';

/** Minimal OBS WebSocket v5 bridge. No OBS credentials leave this process. */
export interface ObsSnapshot {
  configured: boolean;
  connected: boolean;
  scenes: string[];
  programScene: string | null;
  recording: boolean | null;
  error?: string;
}
type Pending = {
  resolve: (data: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
const sha256 = (value: string) => createHash('sha256').update(value).digest('base64');
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function validateLocalObsUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== 'ws:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('OBS WebSocket URL must be ws://127.0.0.1:<port> with no credentials or path');
  return url.toString();
}

export class ObsBridge {
  private readonly address: string | undefined;
  private readonly configurationError: string | undefined;
  private readonly password: string;
  private socket?: WebSocket;
  private connection?: Promise<void>;
  private ready = false;
  private pending = new Map<string, Pending>();
  private lastScene: string | null = null;
  private lastScenes: string[] = [];
  private lastRecording: boolean | null = null;
  private lastError = '';
  private readonly fadingInputs = new Map<string, symbol>();
  constructor(address = process.env.OBS_WS_URL, password = process.env.OBS_WS_PASSWORD || '') {
    // OBS is optional. Bad OBS configuration must never prevent the BP server
    // from starting or interrupt an already running game.
    if (address) {
      try {
        this.address = validateLocalObsUrl(address);
      } catch {
        this.configurationError = 'OBS_WS_URL must target a loopback WebSocket';
      }
    }
    this.password = password;
  }
  get configured() {
    return !!this.address || !!this.configurationError;
  }
  private reset(error: Error) {
    this.ready = false;
    this.lastError = error.message;
    this.lastRecording = null;
    for (const [id, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
      this.pending.delete(id);
    }
  }
  async connect(): Promise<void> {
    if (!this.address) throw new Error('OBS WebSocket is not configured');
    if (this.ready && this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connection) return this.connection;
    this.connection = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.address!, { handshakeTimeout: 5000 });
      this.socket = ws;
      let settled = false;
      const timer = setTimeout(() => {
        ws.terminate();
        fail(new Error('OBS connection timed out'));
      }, 6000);
      const success = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.ready = true;
        this.lastError = '';
        resolve();
      };
      const fail = (error: Error) => {
        // Ignore duplicate close/error notifications after an initial handshake failure.
        // Otherwise a useful authentication/refused error gets overwritten by 'disconnected'.
        if (settled && !this.ready) return;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
        if (this.socket === ws) this.reset(error);
      };
      ws.on('message', (raw) => {
        let packet: Record<string, unknown>;
        try {
          packet = record(JSON.parse(raw.toString()));
        } catch {
          fail(new Error('Invalid OBS WebSocket packet'));
          ws.close();
          return;
        }
        const op = packet.op,
          d = record(packet.d);
        if (op === 0) {
          const auth = record(d.authentication);
          if (auth.challenge && auth.salt) {
            if (!this.password) {
              fail(new Error('OBS requires a local WebSocket password'));
              ws.close();
              return;
            }
            const secret = sha256(this.password + String(auth.salt));
            ws.send(
              JSON.stringify({
                op: 1,
                d: {
                  rpcVersion: 1,
                  eventSubscriptions: 65,
                  authentication: sha256(secret + String(auth.challenge)),
                },
              }),
            );
          } else ws.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, eventSubscriptions: 65 } }));
        } else if (op === 2) success();
        else if (op === 5) {
          const eventType = d.eventType,
            event = record(d.eventData);
          if (eventType === 'CurrentProgramSceneChanged' && typeof event.sceneName === 'string')
            this.lastScene = event.sceneName;
          if (eventType === 'RecordStateChanged' && typeof event.outputActive === 'boolean')
            this.lastRecording = event.outputActive;
        } else if (op === 7) {
          const id = d.requestId,
            waiter = typeof id === 'string' ? this.pending.get(id) : undefined;
          if (!waiter) return;
          this.pending.delete(id as string);
          clearTimeout(waiter.timer);
          const status = record(d.requestStatus);
          if (status.result === true) waiter.resolve(record(d.responseData));
          else
            waiter.reject(
              new Error(
                typeof status.comment === 'string' ? status.comment : 'OBS request was rejected',
              ),
            );
        }
      });
      ws.on('error', (error: Error) => {
        const code = (error as NodeJS.ErrnoException).code;
        fail(
          new Error(
            code === 'ECONNREFUSED'
              ? 'OBS refused connection: enable WebSocket Server in Tools → WebSocket Server Settings and check its port.'
              : code === 'EADDRNOTAVAIL'
                ? 'Local OBS address is unavailable'
                : 'Cannot connect to local OBS WebSocket',
          ),
        );
      });
      ws.on('close', (code: number) => {
        fail(
          new Error(
            code === 4008
              ? 'OBS WebSocket authentication failed: check OBS_WS_PASSWORD.'
              : code === 4009
                ? 'OBS WebSocket RPC version is unsupported.'
                : 'OBS disconnected',
          ),
        );
      });
    }).finally(() => {
      this.connection = undefined;
    });
    return this.connection;
  }
  private async request(
    type: string,
    data?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    await this.connect();
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN)
      throw new Error('OBS disconnected');
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('OBS request timed out'));
      }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket!.send(
          JSON.stringify({
            op: 6,
            d: { requestType: type, requestId: id, requestData: data || {} },
          }),
        );
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('OBS request could not be sent'));
      }
    });
  }
  async status(): Promise<ObsSnapshot> {
    if (this.configurationError)
      return {
        configured: true,
        connected: false,
        scenes: [],
        programScene: null,
        recording: null,
        error: this.configurationError,
      };
    if (!this.configured)
      return {
        configured: false,
        connected: false,
        scenes: [],
        programScene: null,
        recording: null,
      };
    try {
      const [scenes, recording] = await Promise.allSettled([
        this.request('GetSceneList'),
        this.request('GetRecordStatus'),
      ]);
      if (scenes.status === 'fulfilled') {
        const data = scenes.value;
        this.lastScenes = Array.isArray(data.scenes)
          ? data.scenes
              .map((item) => record(item).sceneName)
              .filter((x): x is string => typeof x === 'string')
          : [];
        if (typeof data.currentProgramSceneName === 'string')
          this.lastScene = data.currentProgramSceneName;
      } else throw scenes.reason;
      if (recording.status === 'fulfilled')
        this.lastRecording =
          typeof recording.value.outputActive === 'boolean' ? recording.value.outputActive : null;
      return {
        configured: true,
        connected: this.ready,
        scenes: this.lastScenes,
        programScene: this.lastScene,
        recording: this.lastRecording,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OBS unavailable';
      this.lastError = message;
      return {
        configured: true,
        connected: false,
        scenes: this.lastScenes,
        programScene: this.lastScene,
        recording: null,
        error: message,
      };
    }
  }
  async switchScene(name: string, isCurrent = () => true): Promise<ObsSnapshot> {
    if (typeof name !== 'string' || !name.trim() || name.length > 128)
      throw new Error('Invalid OBS scene name');
    const status = await this.status();
    if (!status.connected) throw new Error(status.error || 'OBS is disconnected');
    if (!status.scenes.includes(name)) throw new Error('Scene is not present in OBS');
    if (!isCurrent()) throw new Error('OBS scene cue cancelled');
    await this.request('SetCurrentProgramScene', { sceneName: name });
    // Read back real OBS status; request success alone is not enough.
    const next = await this.status();
    if (next.programScene !== name) throw new Error('OBS did not confirm scene change');
    return next;
  }
  /** Read-only Browser Source geometry audit. Never return source URLs or OBS credentials. */
  async browserSourceLayout(sceneName: string): Promise<
    Array<{
      name: string;
      enabled: boolean;
      index: number;
      width: number | null;
      height: number | null;
    }>
  > {
    if (typeof sceneName !== 'string' || !sceneName.trim() || sceneName.length > 128)
      throw new Error('Invalid OBS scene');
    const status = await this.status();
    if (!status.connected) throw new Error(status.error || 'OBS disconnected');
    if (!status.scenes.includes(sceneName)) throw new Error('Scene is not present in OBS');
    const result = await this.request('GetSceneItemList', { sceneName });
    const items = Array.isArray(result.sceneItems) ? result.sceneItems.slice(0, 64) : [];
    const sources = await Promise.all(
      items.map(async (item) => {
        const source = record(item),
          name = source.sourceName;
        if (typeof name !== 'string' || !name) return null;
        try {
          const input = await this.request('GetInputSettings', { inputName: name });
          if (input.inputKind !== 'browser_source') return null;
          const settings = record(input.inputSettings);
          const width = settings.width,
            height = settings.height;
          return {
            name,
            enabled: source.sceneItemEnabled === true,
            index: typeof source.sceneItemIndex === 'number' ? source.sceneItemIndex : -1,
            width: typeof width === 'number' && Number.isFinite(width) ? width : null,
            height: typeof height === 'number' && Number.isFinite(height) ? height : null,
          };
        } catch {
          return null;
        }
      }),
    );
    return sources.filter(
      (
        source,
      ): source is {
        name: string;
        enabled: boolean;
        index: number;
        width: number | null;
        height: number | null;
      } => source !== null,
    );
  }
  /** Only audio-capable OBS inputs respond to GetInputVolume. Never expose credentials. */
  async audioInputs(): Promise<Array<{ name: string; volume: number }>> {
    const data = await this.request('GetInputList');
    const names = Array.isArray(data.inputs)
      ? data.inputs
          .map((item) => record(item).inputName)
          .filter((name): name is string => typeof name === 'string' && name.length > 0)
          .slice(0, 64)
      : [];
    const results = await Promise.all(
      names.map(async (name) => {
        try {
          const volume = await this.request('GetInputVolume', { inputName: name });
          const value = volume.inputVolumeMul;
          return typeof value === 'number' && Number.isFinite(value) && value >= 0
            ? { name, volume: value }
            : null;
        } catch {
          return null;
        } // Non-audio OBS sources reject GetInputVolume.
      }),
    );
    return results.filter((item): item is { name: string; volume: number } => item !== null);
  }
  /** Local-only, explicit fade request. Each OBS step is acknowledged before the next. */
  async fadeInput(name: string, targetVolume: number, durationMs: number): Promise<number> {
    if (typeof name !== 'string' || !name.trim() || name.length > 128)
      throw new Error('Invalid OBS audio input');
    if (
      typeof targetVolume !== 'number' ||
      !Number.isFinite(targetVolume) ||
      targetVolume < 0 ||
      targetVolume > 2
    )
      throw new Error('OBS volume must be between 0 and 200%');
    if (!Number.isInteger(durationMs) || durationMs < 0 || durationMs > 5000)
      throw new Error('OBS fade duration must be 0–5000ms');
    const generation = Symbol(name);
    this.fadingInputs.set(name, generation);
    const currentGeneration = () => {
      if (this.fadingInputs.get(name) !== generation)
        throw new Error('OBS fade replaced by a newer command');
    };
    try {
      const current = await this.request('GetInputVolume', { inputName: name });
      currentGeneration();
      const start = current.inputVolumeMul;
      if (typeof start !== 'number' || !Number.isFinite(start) || start < 0)
        throw new Error('OBS did not return a valid audio level');
      const started = Date.now();
      for (;;) {
        if (durationMs > 0) {
          await new Promise<void>((resolve) =>
            setTimeout(resolve, Math.min(100, Math.max(0, durationMs - (Date.now() - started)))),
          );
          if (!this.ready || this.socket?.readyState !== WebSocket.OPEN)
            throw new Error('OBS disconnected during audio fade');
        }
        currentGeneration();
        const fraction = durationMs === 0 ? 1 : Math.min(1, (Date.now() - started) / durationMs);
        const volume = start + (targetVolume - start) * fraction;
        await this.request('SetInputVolume', { inputName: name, inputVolumeMul: volume });
        if (fraction >= 1) break;
      }
      currentGeneration();
      const final = await this.request('GetInputVolume', { inputName: name });
      if (typeof final.inputVolumeMul !== 'number')
        throw new Error('OBS did not confirm audio volume');
      return final.inputVolumeMul;
    } finally {
      if (this.fadingInputs.get(name) === generation) this.fadingInputs.delete(name);
    }
  }
  async crossfade(from: string, to: string, targetVolume: number, durationMs: number) {
    if (from === to) throw Error('Crossfade requires two different persistent audio inputs');
    const inputs = await this.audioInputs();
    if (!inputs.some((i) => i.name === from) || !inputs.some((i) => i.name === to))
      throw Error('Crossfade inputs must both exist in OBS');
    const [outgoing, incoming] = await Promise.all([
      this.fadeInput(from, 0, durationMs),
      this.fadeInput(to, targetVolume, durationMs),
    ]);
    return { outgoing, incoming };
  }
  close() {
    this.socket?.close();
    this.reset(new Error('OBS bridge closed'));
  }
}
