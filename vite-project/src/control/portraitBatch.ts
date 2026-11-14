import { apiURL } from '../shared/config';
import type { CaptureSlotKey } from './bpCaptureLayout';

let supported: boolean | undefined;
export const recognizesPortraitBatches = () => supported === true;
export const canTryPortraitBatches = () => supported !== false;
export function observePortraitBatchSupport(response: { portraitBatch?: boolean }) {
  supported = response.portraitBatch === true;
}

export type PortraitCrop = {
  image: string;
  allowedHeroIds?: number[];
  lockImage?: string;
  slot?: CaptureSlotKey;
};
export type PortraitRead = {
  candidates: { heroId: number; confidence: number }[];
  lockCue?: 'checkmark' | 'padlock' | 'none';
};
export async function recognizePortraitBatch(
  crops: PortraitCrop[],
  revision: number,
  token: string,
  signal: AbortSignal,
): Promise<PortraitRead[]> {
  const body = JSON.stringify({ crops, revision });
  // Image data URLs and numeric candidate IDs are ASCII. Keep the legacy 4 MiB wire limit.
  if (body.length > 4 * 1024 * 1024 && crops.length > 1) {
    const middle = Math.ceil(crops.length / 2);
    const first = await recognizePortraitBatch(crops.slice(0, middle), revision, token, signal);
    return first.concat(await recognizePortraitBatch(crops.slice(middle), revision, token, signal));
  }
  const response = await fetch(`${apiURL}/api/v1/recognition/portraits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
    signal,
  });
  if (!response.ok) {
    if (response.status === 404 || response.status === 405) supported = false;
    throw new Error('Portrait recognition failed (' + response.status + ')');
  }
  const { results } = await response.json();
  if (!Array.isArray(results) || results.length !== crops.length)
    throw new Error('Incomplete portrait batch');
  supported = true;
  return results as PortraitRead[];
}
