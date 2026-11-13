import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deserialize, serialize } from 'node:v8';
import { setImmediate as yieldToEvents } from 'node:timers/promises';

export type PortraitView = {
  penalty: number;
  features: { values: Float64Array; blocks: Float64Array; residual: number };
};
export type HeroTemplate = { heroId: number; square: PortraitView[]; circle: PortraitView[] };

const signature = Buffer.from('HOK-PORTRAIT-1\0');
const digestLength = 32;
const headerLength = signature.length + digestLength * 2;

async function checksum(data: Buffer) {
  const hash = createHash('sha256');
  const chunk = 4 * 1024 * 1024;
  for (let offset = 0; offset < data.length; offset += chunk) {
    hash.update(data.subarray(offset, offset + chunk));
    if (offset + chunk < data.length) await yieldToEvents();
  }
  return hash.digest();
}

export async function readPortraitPack(
  file: URL,
  sourceKey: Buffer,
  ids: number[],
  squareLength: number,
  circleLength: number,
  blockLength: number,
) {
  try {
    const handle = await open(file, 'r');
    let bytes: Buffer;
    try {
      const stat = await handle.stat();
      // At most 16 template views per shape; allow for V8 object metadata.
      const bytesPerView = (squareLength + circleLength + 2 * blockLength) * 8 + 1024;
      if (
        !stat.isFile() ||
        stat.size < headerLength ||
        stat.size > 4096 + ids.length * 16 * bytesPerView
      )
        return;
      bytes = Buffer.allocUnsafe(stat.size);
      const hash = createHash('sha256');
      let hashed = headerLength;
      let position = 0;
      while (position < bytes.length) {
        const length = Math.min(4 * 1024 * 1024, bytes.length - position);
        // Hash the completed block while the next block is being read.
        const reading = handle.read(bytes, position, length, position);
        if (position > hashed) {
          hash.update(bytes.subarray(hashed, position));
          hashed = position;
        }
        const { bytesRead } = await reading;
        if (!bytesRead) return;
        position += bytesRead;
      }
      hash.update(bytes.subarray(hashed));
      if (!hash.digest().equals(bytes.subarray(headerLength - digestLength, headerLength))) return;
    } finally {
      await handle.close();
    }
    const payload = bytes.subarray(headerLength);
    if (
      !bytes.subarray(0, signature.length).equals(signature) ||
      !bytes.subarray(signature.length, headerLength - digestLength).equals(sourceKey)
    )
      return;
    const rows: HeroTemplate[] = deserialize(payload);
    if (!Array.isArray(rows) || rows.length !== ids.length) return;
    for (const [i, row] of rows.entries()) {
      if (row.heroId !== ids[i]) return;
      for (const shape of ['square', 'circle'] as const) {
        const views = row[shape];
        if (!Array.isArray(views) || !views.length || views.length > 16) return;
        for (const { features, penalty } of views) {
          if (
            !Number.isFinite(penalty) ||
            !Number.isFinite(features.residual) ||
            !(features.values instanceof Float64Array) ||
            features.values.length !== (shape === 'square' ? squareLength : circleLength) ||
            !(features.blocks instanceof Float64Array) ||
            features.blocks.length !== blockLength
          )
            return;
        }
      }
    }
    return { catalog: rows, bytes: bytes.length };
  } catch {
    // This file is derived from the shipped artwork; the caller can rebuild it.
    return;
  }
}

export async function writePortraitPack(file: URL, sourceKey: Buffer, rows: HeroTemplate[]) {
  const payload = serialize(rows);
  const header = Buffer.concat([signature, sourceKey, await checksum(payload)]);
  const path = fileURLToPath(file);
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + '.' + randomUUID() + '.tmp';
  const handle = await open(temporary, 'wx');
  try {
    try {
      await handle.writeFile(header);
      await handle.writeFile(payload);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  return header.length + payload.length;
}
