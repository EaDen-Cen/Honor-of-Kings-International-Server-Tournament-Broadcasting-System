import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { chromium } from '@playwright/test';
import playwrightConfig from '../playwright.config.js';
import { hudRequestBody } from '../src/control/hudCapture.js';
import { liveCaptureKeys, liveCaptureRects, pixelRect } from '../src/shared/gameCapture.js';

const directory = process.argv[2];
if (!directory)
  throw Error('Pass a directory containing normalized 1920-wide hud-*.png frames or top strips');
const files = (await readdir(directory)).filter((f) => /^hud-.*\.png$/i.test(f)).sort();
assert.ok(files.length, 'No hud-*.png samples');
const browser = await chromium.launch(playwrightConfig.use?.launchOptions);
const unzip = promisify(gunzip);
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: 'globalThis.encodeSample = ' + hudRequestBody.toString() });
  const bounds = liveCaptureKeys.map((k) => pixelRect(liveCaptureRects[k], 1920, 1080));
  const rows = [];
  for (const file of files) {
    const frame = (await readFile(resolve(directory, file))).toString('base64');
    const result = await page.evaluate(
      async ({ frame, bounds, regions }) => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + frame;
        await image.decode();
        if (image.width !== 1920) throw Error('Expected 1920-wide normalized frames or strips');
        const images = bounds.map(({ left, top, width, height }) => {
          if (height + top > image.height) throw Error('Missing calibrated region');
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d')!.drawImage(image, left, top, width, height, 0, 0, width, height);
          return canvas.toDataURL('image/png');
        });
        const input = { images, regions, source: 'adb', context: 'benchmark' };
        const start = performance.now();
        const body = await (
          globalThis as unknown as { encodeSample: typeof hudRequestBody }
        ).encodeSample(
          input,
          true,
          new URL('https://director.example/api/v1/recognition/live-hud'),
        );
        const encodeMs = performance.now() - start;
        const binary =
          typeof body === 'string'
            ? undefined
            : Array.from(new Uint8Array(await body.arrayBuffer()));
        return { json: JSON.stringify(input), binary, encodeMs };
      },
      { frame, bounds, regions: liveCaptureRects },
    );
    const bytes = result.binary ? Buffer.from(result.binary) : Buffer.from(result.json);
    const start = performance.now();
    const original = result.binary
      ? await unzip(bytes, { maxOutputLength: 5 * 1024 * 1024 })
      : bytes;
    const decodeMs = performance.now() - start;
    assert.equal(original.toString('utf8'), result.json);
    rows.push({
      original: Buffer.byteLength(result.json),
      sent: bytes.length,
      encodeMs: result.encodeMs,
      decodeMs,
    });
  }
  const p95 = (field: 'encodeMs' | 'decodeMs') =>
    rows.map((r) => r[field]).sort((a, b) => a - b)[Math.ceil(rows.length * 0.95) - 1];
  console.log(
    JSON.stringify(
      {
        frames: rows.length,
        originalBytes: rows.reduce((n, r) => n + r.original, 0),
        sentBytes: rows.reduce((n, r) => n + r.sent, 0),
        p95BrowserEncodeMs: p95('encodeMs'),
        p95ServerInflateMs: p95('decodeMs'),
        verifiedIdenticalBodies: rows.length,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
