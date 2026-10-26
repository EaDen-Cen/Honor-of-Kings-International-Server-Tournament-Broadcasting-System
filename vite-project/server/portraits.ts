import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import sharp from 'sharp';

export const MAX_PORTRAIT_BYTES = 5 * 1024 * 1024;
const mimeByExtension: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

/** Never trust a filename or MIME alone; only these raster containers are served. */
export function portraitFormat(data: Buffer): 'png' | 'jpg' | 'webp' | undefined {
  if (data.length >= 45 && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    let offset = 8, header = false, pixels = false;
    while (offset + 12 <= data.length) {
      const length = data.readUInt32BE(offset), type = data.toString('ascii', offset + 4, offset + 8);
      if (offset + 12 + length > data.length) return;
      if (!header) {
        if (type !== 'IHDR' || length !== 13 || !data.readUInt32BE(offset + 8) || !data.readUInt32BE(offset + 12)) return;
        header = true;
      }
      if (type === 'IDAT' && length > 0) pixels = true;
      offset += length + 12;
      if (type === 'IEND') return pixels && length === 0 && offset === data.length ? 'png' : undefined;
    }
    return;
  }
  if (data.length > 20 && data[0] === 255 && data[1] === 216 && data[2] === 255 && data.at(-2) === 255 && data.at(-1) === 217) {
    let offset = 2, frame = false;
    while (offset + 4 < data.length) {
      if (data[offset++] !== 255) return;
      while (offset < data.length && data[offset] === 255) offset++;
      if (offset + 3 > data.length) return;
      const marker = data[offset++];
      if (marker === 218) return frame ? 'jpg' : undefined;
      const length = data.readUInt16BE(offset);
      if (length < 2 || offset + length > data.length) return;
      if ([192, 193, 194].includes(marker)) {
        if (length < 8) return;
        const pixels = data.readUInt16BE(offset + 3) * data.readUInt16BE(offset + 5);
        if (!pixels) return;
        frame = true;
      }
      offset += length;
    }
  }
  if (data.length >= 30 && data.toString('ascii', 0, 4) === 'RIFF' && data.readUInt32LE(4) + 8 === data.length && data.toString('ascii', 8, 12) === 'WEBP') {
    const type = data.toString('ascii', 12, 16), length = data.readUInt32LE(16);
    if (20 + length > data.length) return;
    let width = 0, height = 0;
    if (type === 'VP8X' && length >= 10) { width = data.readUIntLE(24, 3) + 1; height = data.readUIntLE(27, 3) + 1; }
    if (type === 'VP8L' && length >= 5 && data[20] === 47) { const bits = data.readUInt32LE(21); width = (bits & 16383) + 1; height = ((bits >>> 14) & 16383) + 1; }
    if (type === 'VP8 ' && length >= 10 && data.subarray(23, 26).equals(Buffer.from('9d012a', 'hex'))) { width = data.readUInt16LE(26) & 16383; height = data.readUInt16LE(28) & 16383; }
    if (width * height > 0) return 'webp';
  }
}

export async function uploadPortrait(req: IncomingMessage, res: ServerResponse, directory: string) {
  const json = (status: number, body: object) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const mime = req.headers['content-type']?.split(';')[0];
  let filename = '';
  try { filename = decodeURIComponent(String(req.headers['x-file-name'] || '')); } catch { json(415, { error: 'uploadFormat' }); return; }
  const extension = filename.split('.').at(-1)?.toLowerCase() || '';
  if (!mime || !Object.values(mimeByExtension).includes(mime) || (filename && mimeByExtension[extension] !== mime)) { json(415, { error: 'uploadFormat' }); req.resume(); return; }
  if (Number(req.headers['content-length']) > MAX_PORTRAIT_BYTES) { json(413, { error: 'uploadTooLarge' }); req.resume(); return; }
  req.setTimeout(15000, () => { if (!res.writableEnded) json(408, { error: 'uploadFailed' }); req.destroy(); });
  try {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_PORTRAIT_BYTES) { json(413, { error: 'uploadTooLarge' }); req.resume(); return; }
      chunks.push(Buffer.from(chunk));
    }
    const data = Buffer.concat(chunks);
    // The old hand-written JPEG segment scanner rejected otherwise decodable files.
    // Ask libvips to fully decode and normalize the image instead of guessing from markers.
    let encoded: Buffer;
    let format: 'png' | 'jpg' | 'webp';
    try {
      const pipeline = sharp(data, { limitInputPixels: 25_000_000, failOn: 'error' }).rotate();
      const metadata = await pipeline.metadata();
      if (!metadata.width || !metadata.height || !['jpeg', 'png', 'webp'].includes(metadata.format)) throw new Error('Invalid image');
      format = metadata.format === 'jpeg' ? 'jpg' : metadata.format as 'png' | 'webp';
      if (mimeByExtension[format] !== mime) { json(415, { error: 'uploadFormat' }); return; }
      encoded = await pipeline.toFormat(metadata.format as 'jpeg' | 'png' | 'webp').toBuffer();
    } catch {
      json(415, { error: 'uploadFormat' }); return;
    }
    const name = `${randomUUID()}.${format}`;
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, name), encoded, { flag: 'wx' });
    json(201, { url: `/uploads/player-portraits/${name}` });
  } catch { if (!res.writableEnded) json(500, { error: 'uploadFailed' }); }
  finally { req.setTimeout(0); }
}

export async function servePortrait(pathname: string, res: ServerResponse, directory: string) {
  const name = pathname.slice('/uploads/player-portraits/'.length);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/.test(name)) { res.writeHead(404); res.end(); return; }
  try {
    const data = await readFile(join(directory, name));
    res.writeHead(200, { 'Content-Type': mimeByExtension[name.split('.').at(-1)!], 'Content-Security-Policy': "default-src 'none'", 'Cache-Control': 'public, max-age=31536000, immutable' });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
}
