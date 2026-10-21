export interface NeutralObjective {
  id: string;
  name: string;
  icon: string;
  blue: number;
  red: number;
  status?: 'alive' | 'down' | 'unknown';
}
import type { MatchState } from './types.js';
import {
  consistentLiveValue,
  liveCaptureKeys,
  parseLiveNumber,
  type LiveCandidate,
  type LiveCaptureKey,
} from './gameCapture.js';
export interface LiveFieldSource {
  source: 'manual' | 'ocr';
  capturedAt: number;
  confidence: number;
}
export interface LiveHudSample {
  capturedAt: number;
  candidates: LiveCandidate[];
  profile?: string;
}
export interface LiveGameStats {
  blueKills: number;
  redKills: number;
  blueTowers: number;
  redTowers: number;
  blueGold?: number;
  redGold?: number;
  gameTimeSeconds?: number;
  sources?: Partial<Record<LiveCaptureKey, LiveFieldSource>>;
  neutralObjectives: NeutralObjective[];
  density: 'compact' | 'full';
  widthPercent?: number;
  heightPx?: number;
}
export const liveGameContext = (state: MatchState) =>
  JSON.stringify([
    state.draftGameNumber ?? state.gameNumber,
    state.blueTeam.id,
    state.redTeam.id,
    state.committedGameId,
    state.bluePicks,
    state.redPicks,
  ]);
export function trustedLiveUpdates(
  stats: LiveGameStats,
  previous: LiveHudSample,
  sample: LiveHudSample,
) {
  const updates: Partial<Record<LiveCaptureKey, number>> = {};
  if (previous.profile !== sample.profile) return updates;
  const elapsed = sample.capturedAt - previous.capturedAt;
  const clock = sample.candidates.find((c) => c.key === 'gameTimeSeconds'),
    oldClock = previous.candidates.find((c) => c.key === 'gameTimeSeconds');
  if (
    (clock?.source === 'ai' && oldClock?.source === 'ai') ||
    clock?.value == null ||
    oldClock?.value == null ||
    clock.value <= oldClock.value ||
    !Number.isInteger(clock.value) ||
    !Number.isInteger(oldClock.value) ||
    oldClock.value < 0 ||
    clock.value > 7200 ||
    clock.confidence < 0.85 ||
    oldClock.confidence < 0.85 ||
    !consistentLiveValue('gameTimeSeconds', oldClock.value, clock.value, elapsed)
  )
    return updates;
  for (const key of liveCaptureKeys) {
    const incoming = sample.candidates.find((c) => c.key === key),
      prior = previous.candidates.find((c) => c.key === key),
      source = stats.sources?.[key];
    if (
      // Replaying one cached AI answer is not two independent observations.
      (incoming?.source === 'ai' && prior?.source === 'ai') ||
      incoming?.value == null ||
      prior?.value == null ||
      incoming.confidence < 0.85 ||
      prior.confidence < 0.85 ||
      source?.source === 'manual'
    )
      continue;
    const encoded = (value: number) =>
      key === 'gameTimeSeconds'
        ? `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
        : String(value);
    if (
      parseLiveNumber(encoded(incoming.value), key) !== incoming.value ||
      parseLiveNumber(encoded(prior.value), key) !== prior.value
    )
      continue;
    if (!consistentLiveValue(key, prior.value, incoming.value, elapsed)) continue;
    if (source) {
      const since = sample.capturedAt - source.capturedAt,
        current = stats[key] ?? 0;
      if (since <= 0 || incoming.value < current) continue;
      // A disconnected capture may resume after 30 seconds. The two new
      // samples still need a progressing clock and agreement; compare them
      // with the last published value using the actual elapsed interval.
      const windows = Math.max(1, Math.ceil(since / 15000));
      const maxDelta = key.endsWith('Gold')
        ? Math.max(1500, since * 0.3)
        : key === 'gameTimeSeconds'
          ? Math.ceil(since / 1000) + 2
          : key.endsWith('Towers')
            ? 3 * windows
            : 5 * windows;
      if (incoming.value - current > maxDelta) continue;
    }
    updates[key] = incoming.value;
  }
  return updates;
}
export const initialLiveGameStats = (): LiveGameStats => ({
  blueKills: 0,
  redKills: 0,
  blueTowers: 0,
  redTowers: 0,
  neutralObjectives: [
    { id: 'tyrant', name: '暴君 / Tyrant', icon: '', blue: 0, red: 0, status: 'unknown' },
    { id: 'overlord', name: '主宰 / Overlord', icon: '', blue: 0, red: 0, status: 'unknown' },
  ],
  density: 'compact',
  widthPercent: 65,
  heightPx: 132,
});
export function nextLiveGameStats(previous: LiveGameStats): LiveGameStats {
  return {
    ...initialLiveGameStats(),
    density: previous.density,
    widthPercent: previous.widthPercent ?? 65,
    heightPx: previous.heightPx ?? 132,
    neutralObjectives: previous.neutralObjectives.map((item) => ({
      ...item,
      blue: 0,
      red: 0,
      status: 'unknown',
    })),
  };
}

/** Never invent elapsed game time: advance only a recently verified OCR
 * clock anchor. Manual values remain static until edited by the operator. */
export function displayedGameSeconds(stats: LiveGameStats, now: number): number | undefined {
  const base = stats.gameTimeSeconds;
  if (base === undefined) return undefined;
  const source = stats.sources?.gameTimeSeconds;
  if (source?.source !== 'ocr' || !Number.isFinite(source.capturedAt)) return base;
  const age = now - source.capturedAt;
  if (age < 0 || age > 15000) return base;
  return Math.min(7200, base + Math.floor(age / 1000));
}
/** Translate the built-in bilingual names without rewriting saved match data.
 * A renamed or custom objective keeps the operator's exact label. */
export function neutralObjectiveLabel(item: NeutralObjective, zh: boolean): string {
  if (item.id === 'tyrant' && item.name === '暴君 / Tyrant') return zh ? '暴君' : 'Tyrant';
  if (item.id === 'overlord' && item.name === '主宰 / Overlord') return zh ? '主宰' : 'Overlord';
  return item.name;
}
export const totalNeutralObjectives = (stats: LiveGameStats, side: 'blue' | 'red') =>
  stats.neutralObjectives.reduce((sum, item) => sum + item[side], 0);
