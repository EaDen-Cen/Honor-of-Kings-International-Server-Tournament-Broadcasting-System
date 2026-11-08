import {
  liveCaptureRects,
  validLiveCaptureRects,
  type CaptureRect,
  type LiveCaptureKey,
} from '../shared/gameCapture.js';
const storageKey = 'hok-ghud-calibration-v2';
type Regions = Record<LiveCaptureKey, CaptureRect>;
export function loadHudCalibration(storage: Pick<Storage, 'getItem'>, source: string): Regions {
  try {
    const profiles = JSON.parse(storage.getItem(storageKey) || '[]');
    const match = Array.isArray(profiles) ? profiles.find((p) => p?.source === source) : undefined;
    if (validLiveCaptureRects(match?.regions)) return match.regions;
    if (!source.startsWith('["adb"')) {
      const legacy = JSON.parse(storage.getItem('hok-ghud-calibration-v1') || 'null');
      if (validLiveCaptureRects(legacy)) return legacy;
    }
  } catch {
    /* Corrupt preferences never authorize a source automatically. */
  }
  return structuredClone(liveCaptureRects);
}
export function saveHudCalibration(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  source: string,
  regions: Regions,
) {
  if (!validLiveCaptureRects(regions)) throw Error('Invalid HUD calibration');
  let previous: unknown;
  try {
    previous = JSON.parse(storage.getItem(storageKey) || '[]');
  } catch {
    previous = [];
  }
  const profiles = Array.isArray(previous)
    ? previous.filter(
        (p) =>
          p?.source !== source &&
          typeof p?.source === 'string' &&
          validLiveCaptureRects(p?.regions),
      )
    : [];
  storage.setItem(storageKey, JSON.stringify([...profiles.slice(-11), { source, regions }]));
}
