import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { OBS_AUDIO_ROLES, OBS_PRESET_IDS, defaultObsConfig, type ObsPublicConfig } from '../../src/shared/obsProtocol.js';

export interface ObsPrivateConfig extends Omit<ObsPublicConfig, 'passwordConfigured'> { password: string }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 256): v is string => typeof v === 'string' && v.length <= max && !Array.from(v).some(character => character.charCodeAt(0) < 32);
const number = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
export function localObsUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('OBS address must be a local WebSocket URL');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('OBS address must be a local WebSocket URL'); }
  if (!['ws:', 'wss:'].includes(url.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('Only local OBS WebSocket addresses are allowed');
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url.href.replace(/\/$/, '');
}
export function localRecordDirectory(value: unknown): value is string {
  return text(value, 2048) && (value === '' || (isAbsolute(value) && !/^[/\\]{2}/.test(value)));
}
export function publicObsConfig(config: ObsPrivateConfig): ObsPublicConfig {
  const { password, ...rest } = config;
  return structuredClone({ ...rest, passwordConfigured: !!password });
}
export function parseObsConfigUpdate(current: ObsPrivateConfig, input: unknown): ObsPrivateConfig {
  if (!record(input)) throw new Error('Invalid OBS configuration');
  const allowed = new Set(['enabled', 'url', 'reconnect', 'inputs', 'presets', 'recordDirectory', 'lowDiskGb', 'remainingMinutesWarning', 'password', 'clearPassword']);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new Error('Unknown OBS configuration field');
  const next = structuredClone(current);
  for (const key of ['enabled', 'reconnect'] as const) if (input[key] !== undefined) {
    if (typeof input[key] !== 'boolean') throw new Error(`Invalid OBS ${key}`);
    next[key] = input[key];
  }
  if (input.url !== undefined) next.url = localObsUrl(input.url);
  if (input.password !== undefined) {
    if (!text(input.password, 256) || input.password.length < 1) throw new Error('OBS password must contain 1–256 characters');
    next.password = input.password;
  }
  if (input.clearPassword !== undefined && typeof input.clearPassword !== 'boolean') throw new Error('Invalid clearPassword');
  if (input.clearPassword === true) {
    if (input.password !== undefined) throw new Error('Cannot set and clear OBS password together');
    next.password = '';
  }
  if (input.inputs !== undefined) {
    if (!record(input.inputs) || Object.keys(input.inputs).some(k => !(OBS_AUDIO_ROLES as readonly string[]).includes(k))
      || OBS_AUDIO_ROLES.some(role => !text((input.inputs as Record<string, unknown>)[role]))) throw new Error('Invalid OBS audio bindings');
    next.inputs = input.inputs as ObsPrivateConfig['inputs'];
    const bound = Object.values(next.inputs).filter(Boolean);
    if (new Set(bound).size !== bound.length) throw new Error('Each OBS audio role must use a different input');
  }
  if (input.presets !== undefined) {
    if (!record(input.presets) || Object.keys(input.presets).length !== OBS_PRESET_IDS.length) throw new Error('Invalid OBS presets');
    for (const id of OBS_PRESET_IDS) {
      const preset = input.presets[id];
      if (!record(preset) || Object.keys(preset).some(k => !['sceneName', 'fadeMs', 'audio'].includes(k))
        || !text(preset.sceneName) || !number(preset.fadeMs, 0, 3000) || !record(preset.audio)
        || Object.keys(preset.audio).some(k => !(OBS_AUDIO_ROLES as readonly string[]).includes(k))) throw new Error('Invalid OBS preset');
      for (const target of Object.values(preset.audio)) if (!record(target) || Object.keys(target).some(k => !['volume', 'muted'].includes(k))
        || !number(target.volume, 0, 1) || typeof target.muted !== 'boolean') throw new Error('Invalid OBS preset audio');
    }
    next.presets = input.presets as ObsPrivateConfig['presets'];
  }
  if (input.recordDirectory !== undefined) {
    if (!localRecordDirectory(input.recordDirectory)) throw new Error('Recording directory must be an absolute local path');
    next.recordDirectory = input.recordDirectory;
  }
  for (const key of ['lowDiskGb', 'remainingMinutesWarning'] as const) if (input[key] !== undefined) {
    if (!number(input[key], 1, key === 'lowDiskGb' ? 10000 : 1440)) throw new Error(`Invalid ${key}`);
    next[key] = input[key];
  }
  if (next.enabled && !next.password) throw new Error('OBS authentication password is required');
  return structuredClone(next);
}
export class ObsConfigStore {
  data: ObsPrivateConfig;
  loadError: string | null = null;
  constructor(private file: string) {
    const { passwordConfigured: _, ...defaults } = defaultObsConfig();
    void _;
    const base = { ...defaults, password: '' };
    // A malformed private file fails closed without exposing its contents in an error.
    try { this.data = existsSync(file) ? parseObsConfigUpdate(base, JSON.parse(readFileSync(file, 'utf8'))) : base; }
    catch {
      this.data = base;
      this.loadError = 'Cannot read local OBS configuration; saved file was preserved and OBS is disabled';
    }
  }
  save(next: ObsPrivateConfig) {
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
      renameSync(temporary, this.file);
    } catch {
      try { unlinkSync(temporary); } catch { /* The private file may not have been created. */ }
      throw new Error('Cannot save local OBS configuration; previous settings were preserved');
    }
    this.data = structuredClone(next);
    this.loadError = null;
  }
}
