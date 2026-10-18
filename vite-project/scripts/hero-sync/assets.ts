import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';
import type { AssetRecord } from './types.js';

interface ImageInfo {
  extension: 'png' | 'jpg' | 'webp';
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
}

export function detectImage(buffer: Uint8Array): ImageInfo | undefined {
  if (buffer.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => buffer[index] === byte)) {
    return { extension: 'png', mime: 'image/png' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: 'jpg', mime: 'image/jpeg' };
  }
  if (
    buffer.length >= 12 &&
    String.fromCharCode(...buffer.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...buffer.slice(8, 12)) === 'WEBP'
  ) {
    return { extension: 'webp', mime: 'image/webp' };
  }
  return undefined;
}

export function sha256(buffer: Uint8Array) {
  return createHash('sha256').update(buffer).digest('hex');
}

function allowedAssetUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('Hero asset must use HTTPS');
  if (url.hostname !== 'camp.honorofkings.com') throw new Error(`Untrusted hero asset host: ${url.hostname}`);
  if (url.username || url.password) throw new Error('Hero asset URL must not contain credentials');
  return url;
}

const MAX_ASSET_BYTES = 8 * 1024 * 1024;
async function assetBody(response: Response) {
  if (Number(response.headers.get('content-length')) > MAX_ASSET_BYTES) throw new Error('Hero image is unexpectedly large');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Hero image response is empty');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_ASSET_BYTES) throw new Error(`Hero image is unexpectedly large: more than ${MAX_ASSET_BYTES} bytes`);
      chunks.push(chunk.value);
    }
    const body = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return body;
  } catch (error) {
    try { await reader.cancel(); } catch { /* Preserve the original download error. */ }
    throw error;
  } finally { reader.releaseLock(); }
}

async function decodableImage(data: Uint8Array) {
  if (!detectImage(data)) return false;
  try { await sharp(data, { limitInputPixels: 64 * 1024 * 1024, failOn: 'error' }).stats(); return true; }
  catch { return false; }
}

export async function downloadHeroAsset(args: {
  heroId: number;
  campId: number;
  sourceUrl: string;
  publicDir: string;
}): Promise<AssetRecord> {
  if (![args.heroId, args.campId].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid hero asset identity');
  const url = allowedAssetUrl(args.sourceUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'HOK-Broadcast-Hero-Sync/1.0' },
    });
    if (!response.ok) throw new Error(`Image download failed: HTTP ${response.status} ${url}`);
    const body = await assetBody(response);
    const info = detectImage(body);
    if (!info || !await decodableImage(body)) throw new Error(`Unsupported or invalid hero image: ${url}`);

    // Release-order IDs no longer equal legacy asset filenames. For example,
    // current hero #119 uses /heroesImg/120.png; new #120 must not overwrite it.
    const checksum = sha256(body);
    const name = `sync-${args.campId}-${checksum.slice(0, 16)}.${info.extension}`;
    const relative = `/heroesImg/${name}`;
    const destination = `${args.publicDir}/heroesImg/${name}`;
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, body);

    return {
      heroId: args.heroId,
      campId: args.campId,
      sourceUrl: url.toString(),
      localPath: relative,
      sha256: checksum,
      mime: info.mime,
      bytes: body.byteLength,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function validateLocalImage(file: string) {
  const data = new Uint8Array(await readFile(file));
  return decodableImage(data);
}
