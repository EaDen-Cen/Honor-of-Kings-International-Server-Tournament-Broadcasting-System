import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { Worker, createWorker } from 'tesseract.js';
import { recognizeLiveHud, recognizeLiveHudCrops } from './gameDataRecognition.js';
import { PlayerRecognitionProvider } from './playerRecognition.js';
import { liveCaptureKeys, liveCaptureRects, pixelRect } from '../src/shared/gameCapture.js';
import { broadcastArtwork } from '../src/shared/broadcastArtwork.js';
import assets from '../src/data/broadcastArtAssets.js';
import heroes from '../src/components/HeroList.js';

test('small lossless HUD transport keeps exactly the full-frame OCR inputs and rejects invalid crops', async () => {
  const fixture = JSON.parse(
    await readFile(new URL('./fixtures/game-data-screenshots.json', import.meta.url), 'utf8'),
  );
  const frame = Buffer.from(fixture.hud, 'base64');
  const images = await Promise.all(
    liveCaptureKeys.map(
      async (key) =>
        'data:image/png;base64,' +
        (
          await sharp(frame)
            .extract(pixelRect(liveCaptureRects[key], 1920, 1080))
            .png()
            .toBuffer()
        ).toString('base64'),
    ),
  );
  const calls: string[][] = [];
  const provider = {
    recognizeNumbers: async (input: string[]) => {
      calls.push(input);
      return {
        texts: ['1', '2', '3.5k', '4k', '1', '2', '1:20'],
        confidences: Array(7).fill(0.99),
        elapsedMs: 1,
      };
    },
  };
  const before = await recognizeLiveHud(frame, provider as PlayerRecognitionProvider);
  const after = await recognizeLiveHudCrops(images, provider, liveCaptureRects);
  assert.deepEqual(calls[0], calls[1], 'cyan filtering and field order must not change');
  assert.deepEqual(before.candidates, after.candidates);
  await assert.rejects(recognizeLiveHudCrops(images.slice(1), provider, liveCaptureRects), /Seven/);
  await assert.rejects(
    recognizeLiveHudCrops(
      images.map((v, i) => (i === 0 ? images[2] : v)),
      provider,
      liveCaptureRects,
    ),
    /dimensions/,
  );
  const blank = await Promise.all(
    liveCaptureKeys.map(async (key) => {
      const r = pixelRect(liveCaptureRects[key], 1920, 1080);
      return (
        'data:image/png;base64,' +
        (
          await sharp({
            create: { width: r.width, height: r.height, channels: 4, background: '#000' },
          })
            .png()
            .toBuffer()
        ).toString('base64')
      );
    }),
  );
  await assert.rejects(recognizeLiveHudCrops(blank, provider, liveCaptureRects), /blank/);
  assert.equal(calls.length, 2, 'invalid evidence must not reach OCR');
});

test('numeric worker warm-up is shared and weak HUD cells are not recognized twice identically', async () => {
  let created = 0,
    reads = 0;
  const factory: typeof createWorker = async () => {
    created++;
    return {
      setParameters: async () => {},
      terminate: async () => {},
      recognize: async () => {
        reads++;
        return {
          data: {
            text: '1',
            confidence: 90,
            blocks: [
              {
                paragraphs: [
                  {
                    lines: Array.from({ length: 7 }, (_, i) => ({
                      text: '1',
                      confidence: 40,
                      bbox: { y0: i * 64 + 12, y1: i * 64 + 48 },
                    })),
                  },
                ],
              },
            ],
          },
        };
      },
    } as unknown as Worker;
  };
  const provider = new PlayerRecognitionProvider(undefined, 'eng', factory);
  try {
    await provider.prepare();
    await Promise.all([provider.prepareNumbers(), provider.prepareNumbers()]);
    assert.equal(created, 2, 'one player worker and one resident numeric worker');
    const image =
      'data:image/png;base64,' +
      (
        await sharp({ create: { width: 60, height: 40, channels: 3, background: '#ddd' } })
          .png()
          .toBuffer()
      ).toString('base64');
    const result = await provider.recognizeNumbers(Array(7).fill(image));
    assert.equal(reads, 8, 'one page and one isolated retry per weak field');
    assert.deepEqual(result.confidences, Array(7).fill(0.9));
  } finally {
    await provider.close();
  }
});

test('known Latin rosters use one language on the fast path while retaining roster validation', async () => {
  const names = [
    'Alpha',
    'Bravo',
    'Charlie',
    'Delta',
    'Echo',
    'Fox',
    'Golf',
    'Hotel',
    'India',
    'Juliet',
  ];
  const reads: Record<string, number> = {};
  const factory: typeof createWorker = async (language) =>
    ({
      setParameters: async () => {},
      terminate: async () => {},
      recognize: async () => {
        const key = String(language);
        reads[key] = (reads[key] ?? 0) + 1;
        return {
          data: {
            text: names.join('\n'),
            confidence: 99,
            blocks: [
              {
                paragraphs: [
                  {
                    lines: names.map((text, i) => ({
                      text,
                      confidence: 99,
                      bbox: { y0: i * 64 + 12, y1: i * 64 + 48 },
                    })),
                  },
                ],
              },
            ],
          },
        };
      },
    }) as unknown as Worker;
  const provider = new PlayerRecognitionProvider(undefined, 'eng+chi_sim', factory);
  try {
    await provider.prepare();
    const image =
      'data:image/png;base64,' +
      (
        await sharp({ create: { width: 60, height: 40, channels: 3, background: '#ddd' } })
          .png()
          .toBuffer()
      ).toString('base64');
    const result = await provider.recognizePlayerIds(Array(10).fill(image), [
      names.slice(0, 5),
      names.slice(5),
    ]);
    assert.deepEqual(result.texts, names);
    assert.equal(reads.eng, 1);
    assert.equal(reads.chi_sim ?? 0, 0);
  } finally {
    await provider.close();
  }
});

test('every catalog artwork has a bounded local WebP with content-addressed identity; custom sources stay custom', async () => {
  for (const hero of heroes.filter((h) => h.artLink)) {
    const asset = assets[String(hero.id)];
    assert.equal(asset?.source, hero.artLink, hero.englishName);
    const bytes = await readFile(new URL(`../public${asset.local}`, import.meta.url));
    assert.ok(
      asset.local.endsWith(
        `-${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}.webp`,
      ),
    );
    const meta = await sharp(bytes).metadata();
    assert.ok(meta.width! <= 1600 && meta.height! <= 1600);
    assert.equal(broadcastArtwork(hero), asset.local);
    assert.equal(
      broadcastArtwork({ ...hero, artLink: 'https://example.com/custom.jpg' }),
      'https://example.com/custom.jpg',
    );
  }
});
