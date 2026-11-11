import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { uploadPortrait } from './portraits.js';

test('portrait uploads preserve exact PNG/WebP bytes, normalize JPEG orientation and reject broken raster data', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'hok-portrait-upload-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const server = createServer((req, res) => {
    void uploadPortrait(req, res, directory);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const send = (input: Buffer, mime: string) =>
    new Promise<{ status?: number; body: { url: string; previewOriginal?: boolean } }>(
      (resolve, reject) => {
        const req = request(
          {
            hostname: '127.0.0.1',
            port: address.port,
            method: 'POST',
            headers: { 'Content-Type': mime, 'Content-Length': input.length },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('error', reject);
            res.on('end', () =>
              resolve({
                status: res.statusCode,
                body: JSON.parse(Buffer.concat(chunks).toString()),
              }),
            );
          },
        );
        req.on('error', reject);
        req.end(input);
      },
    );
  const source = sharp({
    create: {
      width: 32,
      height: 16,
      channels: 4,
      background: { r: 12, g: 60, b: 180, alpha: 0.4 },
    },
  });
  const png = await source.clone().png().toBuffer();
  const webp = await source.clone().webp({ lossless: true }).toBuffer();
  for (const [mime, bytes] of [
    ['image/png', png],
    ['image/webp', webp],
  ] as const) {
    const { status, body } = await send(bytes, mime);
    assert.equal(status, 201);
    assert.equal(body.previewOriginal, true);
    assert.deepEqual(await readFile(join(directory, basename(body.url))), bytes);
  }
  const jpeg = await source
    .clone()
    .withMetadata({ orientation: 6 })
    .jpeg({ progressive: true })
    .toBuffer();
  const normalized = await send(jpeg, 'image/jpeg');
  assert.equal(normalized.status, 201);
  assert.equal(normalized.body.previewOriginal, false);
  const rotated = await sharp(join(directory, basename(normalized.body.url))).metadata();
  assert.deepEqual([rotated.width, rotated.height], [16, 32]);
  const invalidPng = Buffer.from(png);
  const idat = invalidPng.indexOf('IDAT');
  assert.ok(idat > 0);
  invalidPng[idat + 4] = 0xff; // Invalid deflate header after a valid IHDR.
  assert.equal((await sharp(invalidPng).metadata()).width, 32);
  assert.equal((await send(invalidPng, 'image/png')).status, 415);
  assert.equal((await send(png, 'image/webp')).status, 415);
  assert.equal((await readdir(directory)).length, 3);
});
