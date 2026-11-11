import { readFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import sharp from 'sharp';
import { test, expect } from './fixtures';
import { harness } from './harness';
import { hudRequestBody } from '../src/control/hudCapture';
import { liveCaptureKeys, liveCaptureRects, pixelRect } from '../src/shared/gameCapture';
import { liveGameContext } from '../src/shared/liveGame';

test('remote GHUD gzip preserves calibrated crops and authoritative checks', async ({
  request,
  baseURL,
}) => {
  const h = await harness(baseURL);
  try {
    const fixture = JSON.parse(
      await readFile(
        new URL('../server/fixtures/game-data-screenshots.json', import.meta.url),
        'utf8',
      ),
    );
    const images = await Promise.all(
      liveCaptureKeys.map(async (key) => {
        const crop = await sharp(Buffer.from(fixture.hud, 'base64'))
          .extract(pixelRect(liveCaptureRects[key], 1920, 1080))
          .png()
          .toBuffer();
        return 'data:image/png;base64,' + crop.toString('base64');
      }),
    );
    const endpoint = '/api/v1/recognition/live-hud';
    const sample = {
      images,
      neutral: {
        regions: [{ id: 'tyrant', side: 'blue', region: liveCaptureRects.blueKills }],
        images: [images[0]],
      },
      regions: liveCaptureRects,
      context: liveGameContext(h.state()),
      source: 'benchmark-window',
    };
    const json = JSON.stringify(sample);
    const remote = new URL(endpoint, 'https://director.example');
    expect(await hudRequestBody(sample, false, remote)).toBe(json);
    expect(await hudRequestBody({ context: 'small' }, true, remote)).toBe('{"context":"small"}');
    for (const origin of ['http://localhost', 'http://127.0.0.1', 'http://[::1]'])
      expect(await hudRequestBody(sample, true, new URL(endpoint, origin))).toBe(json);
    const post = (body: string | Buffer, role = 'control') =>
      request.post(endpoint, {
        data: body,
        headers: {
          Authorization: 'Bearer e2e-' + role,
          'Content-Type': typeof body === 'string' ? 'application/json' : 'application/gzip',
        },
      });
    await expect.poll(async () => (await post(json)).status(), { timeout: 30000 }).toBe(200);
    const plain = await (await post(json)).json();
    expect(plain.acceptsGzip).toBe(true);
    const body = await hudRequestBody(sample, plain.acceptsGzip, remote);
    if (typeof body === 'string') throw Error('Expected compressed remote sample');
    const bytes = Buffer.from(await body.arrayBuffer());
    expect(JSON.parse(gunzipSync(bytes).toString())).toEqual(sample);
    const compressed = await post(bytes);
    expect(compressed.status()).toBe(200);
    const result = await compressed.json();
    expect(result.frameHash).toBe(plain.frameHash);
    const fields = (value: typeof result) =>
      value.candidates.map(
        (c: { key: string; value: number; confidence: number; text: string }) => [
          c.key,
          c.value,
          c.confidence,
          c.text,
        ],
      );
    expect(fields(result)).toEqual(fields(plain));
    expect(result.profile).toBe(plain.profile);
    expect(result.neutral.frameHash).toBe(plain.neutral.frameHash);
    expect(result.neutral.candidates).toEqual(plain.neutral.candidates);
    expect((await post(bytes, 'caster')).status()).toBe(403);
    expect(
      (await post(gzipSync(JSON.stringify({ ...sample, context: 'previous-game' })))).status(),
    ).toBe(409);
    expect((await post(gzipSync(JSON.stringify({ ...sample, regions: {} })))).status()).toBe(400);
    expect((await post(Buffer.from('invalid gzip'))).status()).toBe(400);
    expect((await post(gzipSync(Buffer.alloc(5 * 1024 * 1024 + 1)))).status()).toBe(413);
  } finally {
    h.close();
  }
});
