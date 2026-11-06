import type { LiveGameStats, NeutralObjective } from './liveGame.js';
import type { Side } from './types.js';
import { validCaptureRect, type CaptureRect } from './gameCapture.js';

export interface NeutralRegion {
  id: string;
  side: Side;
  region: CaptureRect;
}
export function validNeutralRegions(value: unknown): value is NeutralRegion[] {
  if (!Array.isArray(value) || !value.length || value.length > 12) return false;
  const valid =
    value.every(
      (v) =>
        v &&
        typeof v.id === 'string' &&
        v.id.length > 0 &&
        v.id.length <= 100 &&
        ['blue', 'red'].includes(v.side) &&
        validCaptureRect(v.region) &&
        v.region.width >= 0.005 &&
        v.region.width <= 0.12 &&
        v.region.height >= 0.008 &&
        v.region.height <= 0.1,
    ) && new Set(value.map((v) => JSON.stringify([v.id, v.side]))).size === value.length;
  if (!valid) return false;
  for (let i = 0; i < value.length; i++)
    for (let j = i + 1; j < value.length; j++) {
      const a = value[i].region,
        b = value[j].region;
      const overlap =
        Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
        Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      if (overlap > Math.min(a.width * a.height, b.width * b.height) * 0.3) return false;
    }
  return true;
}

export interface NeutralCandidate {
  id: string;
  side: Side;
  value: number | null;
  confidence: number;
}
export interface NeutralSample {
  capturedAt: number;
  profile: string;
  frameHash: string;
  clock: { value: number | null; confidence: number };
  candidates: NeutralCandidate[];
}
/** Absolute counters only: never turn a repeated banner or presence flag into +1. */
export function trustedNeutralUpdates(
  stats: LiveGameStats,
  previous: NeutralSample,
  sample: NeutralSample,
) {
  const elapsed = sample.capturedAt - previous.capturedAt;
  const clock = sample.clock.value,
    priorClock = previous.clock.value;
  if (
    previous.profile !== sample.profile ||
    previous.frameHash === sample.frameHash ||
    elapsed < 300 ||
    elapsed > 15000 ||
    clock === null ||
    priorClock === null ||
    sample.clock.confidence < 0.85 ||
    previous.clock.confidence < 0.85 ||
    clock <= priorClock ||
    clock - priorClock > Math.ceil(elapsed / 1000) + 2 ||
    clock < (stats.gameTimeSeconds ?? 0)
  )
    return [];
  return sample.candidates.filter((candidate) => {
    const objective = stats.neutralObjectives.find((item) => item.id === candidate.id);
    const prior = previous.candidates.find(
      (item) => item.id === candidate.id && item.side === candidate.side,
    );
    if (
      !objective ||
      objective.countFrozen?.[candidate.side] !== false ||
      candidate.value === null ||
      candidate.confidence < 0.85 ||
      prior?.confidence === undefined ||
      prior.confidence < 0.85 ||
      prior.value !== candidate.value
    )
      return false;
    if (
      previous.capturedAt <= (objective.countEpoch?.[candidate.side] ?? 0) ||
      candidate.value < objective[candidate.side]
    )
      return false;
    const source = objective.countSources?.[candidate.side];
    if (source?.source === 'ocr' && candidate.value === objective[candidate.side]) return false;
    if (
      source &&
      (sample.capturedAt <= source.capturedAt ||
        candidate.value - objective[candidate.side] >
          1 + Math.floor((sample.capturedAt - source.capturedAt) / 90000))
    )
      return false;
    return Number.isInteger(candidate.value) && candidate.value >= 0 && candidate.value <= 99;
  });
}
export function validateNeutralSample(sample: NeutralSample, now: number) {
  const numeric = (value: number | null) =>
    value === null || (Number.isInteger(value) && value >= 0 && value <= 7200);
  const confidence = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
  if (
    !sample ||
    !Number.isSafeInteger(sample.capturedAt) ||
    sample.capturedAt < 0 ||
    sample.capturedAt > now ||
    now - sample.capturedAt > 30000 ||
    typeof sample.profile !== 'string' ||
    sample.profile.length > 4096 ||
    !sample.profile ||
    !/^[a-f0-9]{64}$/.test(sample.frameHash) ||
    !sample.clock ||
    !numeric(sample.clock.value) ||
    !confidence(sample.clock.confidence) ||
    !Array.isArray(sample.candidates) ||
    !sample.candidates.length ||
    sample.candidates.length > 12 ||
    sample.candidates.some(
      (c) =>
        !c ||
        typeof c.id !== 'string' ||
        !c.id ||
        c.id.length > 100 ||
        !['blue', 'red'].includes(c.side) ||
        !numeric(c.value) ||
        (c.value !== null && c.value > 99) ||
        !confidence(c.confidence),
    ) ||
    new Set(sample.candidates.map((c) => JSON.stringify([c.id, c.side]))).size !==
      sample.candidates.length
  )
    throw Error('Invalid or expired neutral-objective sample');
}
export function manualNeutralObjectives(
  previous: NeutralObjective[],
  next: NeutralObjective[],
  now: number,
) {
  return next.map((item) => {
    const old = previous.find((v) => v.id === item.id);
    const value: NeutralObjective = {
      id: item.id,
      name: item.name.trim(),
      icon: item.icon,
      blue: item.blue,
      red: item.red,
      status: item.status ?? 'unknown',
      countSources: { ...old?.countSources },
      countFrozen: { ...old?.countFrozen },
      countEpoch: { ...old?.countEpoch },
    };
    for (const side of ['blue', 'red'] as const)
      if (
        old
          ? item[side] !== old[side] || item.name.trim() !== old.name || item.icon !== old.icon
          : item[side] !== 0
      ) {
        value.countSources![side] = { source: 'manual', confidence: 1, capturedAt: now };
        value.countFrozen![side] = true;
        value.countEpoch![side] = now;
      }
    return value;
  });
}
