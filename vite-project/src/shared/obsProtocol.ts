/** OBS control is local director state, deliberately separate from MatchState/backups. */
export const OBS_PRESET_IDS = ['waiting', 'bp', 'game', 'pause', 'postgame', 'matchup-clash', 'matchup-jungle', 'matchup-mid', 'matchup-farm', 'matchup-roam', 'mvp', 'safe'] as const;
export type ObsPresetId = typeof OBS_PRESET_IDS[number];
export const OBS_AUDIO_ROLES = ['game', 'caster', 'bgm', 'sfx'] as const;
export type ObsAudioRole = typeof OBS_AUDIO_ROLES[number];
export interface ObsAudioTarget { volume: number; muted: boolean }
export interface ObsPreset { sceneName: string; fadeMs: number; audio: Partial<Record<ObsAudioRole, ObsAudioTarget>> }
export interface ObsPublicConfig {
  enabled: boolean;
  url: string;
  passwordConfigured: boolean;
  reconnect: boolean;
  inputs: Record<ObsAudioRole, string>;
  presets: Record<ObsPresetId, ObsPreset>;
  recordDirectory: string;
  lowDiskGb: number;
  remainingMinutesWarning: number;
}
/** Password is write-only. Omit to retain it; clearPassword explicitly removes it. */
export type ObsConfigUpdate = Partial<Omit<ObsPublicConfig, 'passwordConfigured'>> & { password?: string; clearPassword?: boolean };
export interface ObsInputState { inputName: string; inputKind: string; volume: number | null; muted: boolean | null }
export interface ObsOutputState { active: boolean | null; paused: boolean | null; reconnecting: boolean | null; durationMs: number | null; bytes: number | null }
export interface ObsRecordHealth {
  directory: string | null;
  directorySource: 'obs' | 'manual' | null;
  freeBytes: number | null;
  estimatedMinutes: number | null;
  rateBytesPerSecond: number | null;
  level: 'unknown' | 'ok' | 'warning' | 'critical';
  warnings: string[];
}
export type ObsCommand =
  | { id: string; type: 'preset'; preset: ObsPresetId }
  | { id: string; type: 'scene'; sceneName: string }
  | { id: string; type: 'bgm'; volume?: number; muted?: boolean; fadeMs?: number }
  | { id: string; type: 'cancel' }
  | { id: string; type: 'refresh' };
export interface ObsCommandResult {
  id: string;
  type: ObsCommand['type'];
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unconfirmed';
  message: string;
  startedAt: number;
  finishedAt?: number;
}
export interface ObsStatus {
  connection: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
  lastError: string | null;
  connectedAt: number | null;
  obsVersion: string | null;
  sceneName: string | null;
  scenes: string[];
  inputs: ObsInputState[];
  recording: ObsOutputState;
  streaming: ObsOutputState;
  recordHealth: ObsRecordHealth;
  warnings: string[];
  lastCommand: ObsCommandResult | null;
  observedAt: number | null;
}
export interface ObsSnapshot { config: ObsPublicConfig; status: ObsStatus }
export function defaultObsConfig(): ObsPublicConfig {
  const music = { bgm: { volume: 0.55, muted: false } };
  const presets = Object.fromEntries(OBS_PRESET_IDS.map(id => [id, {
    sceneName: '', fadeMs: 1500,
    audio: id === 'safe' ? { bgm: { volume: 0, muted: true }, sfx: { volume: 0, muted: true } }
      : id === 'game' ? { bgm: { volume: 0, muted: true }, game: { volume: 1, muted: false } }
        : id === 'waiting' || id === 'bp' || id === 'postgame' || id === 'mvp' ? structuredClone(music) : {},
  }])) as Record<ObsPresetId, ObsPreset>;
  return { enabled: false, url: 'ws://127.0.0.1:4455', passwordConfigured: false, reconnect: true,
    inputs: { game: '', caster: '', bgm: '', sfx: '' }, presets, recordDirectory: '', lowDiskGb: 10, remainingMinutesWarning: 60 };
}
