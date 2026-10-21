import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import sharp from 'sharp';
import { PlayerRecognitionProvider } from '../server/playerRecognition.js';
import { recognizeLiveHudCrops } from '../server/gameDataRecognition.js';
import { liveCaptureKeys, liveCaptureRects, pixelRect } from '../src/shared/gameCapture.js';
import { parsePostGameNumber, type PostGameMetric } from '../src/shared/postGame.js';
const option = (name: string) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const iterations = Number(option('--iterations') ?? 100);
if (!Number.isInteger(iterations) || iterations < 10 || iterations > 1000)
  throw Error('Use 10–1000 iterations');
const directory = resolve(option('--fixtures-dir') ?? 'server/fixtures');
const bytes = await readFile(resolve(directory, 'game-data-screenshots.json'));
const fixture = JSON.parse(bytes.toString()) as {
  hud: string;
  pages: { page: string; cells: { image: string; metric: PostGameMetric; expected: number }[] }[];
};
const images = await Promise.all(
  liveCaptureKeys.map(
    async (key) =>
      'data:image/png;base64,' +
      (
        await sharp(Buffer.from(fixture.hud, 'base64'))
          .extract(pixelRect(liveCaptureRects[key], 1920, 1080))
          .png()
          .toBuffer()
      ).toString('base64'),
  ),
);
const expected = [0, 0, 1500, 1500, 0, 0, 12];
const provider = new PlayerRecognitionProvider(undefined, 'eng');
const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)];
const summary = (values: number[]) => ({
  n: values.length,
  p50Ms: percentile(values, 0.5),
  p95Ms: percentile(values, 0.95),
  p99Ms: percentile(values, 0.99),
});
try {
  const start = performance.now();
  await provider.prepare();
  await provider.prepareNumbers();
  const modelWarmupMs = performance.now() - start;
  const before: number[] = [],
    after: number[] = [];
  let beforeCorrect = 0,
    afterCorrect = 0;
  // Interleave uncached baseline and optimized ROI replay to reduce warm-up and
  // thermal-order bias. This is a recorded still-frame benchmark, NOT a claim
  // about game-to-OBS latency, video diversity or cloud provider accuracy.
  for (let i = 0; i < iterations; i++) {
    for (const optimized of i % 2 ? [true, false] : [false, true]) {
      const t = performance.now();
      const result = await recognizeLiveHudCrops(
        images,
        provider,
        liveCaptureRects,
        optimized ? 'recorded-still' : undefined,
      );
      (optimized ? after : before).push(performance.now() - t);
      const correct = result.candidates.filter((c, index) => c.value === expected[index]).length;
      if (optimized) afterCorrect += correct;
      else beforeCorrect += correct;
    }
  }
  const postTimes: number[] = [];
  let postCorrect = 0,
    postTotal = 0;
  for (const page of fixture.pages) {
    const t = performance.now();
    const result = await provider.recognizeNumbers(
      page.cells.map((c) => c.image),
      true,
    );
    postTimes.push(performance.now() - t);
    page.cells.forEach((cell, i) => {
      postTotal++;
      if (parsePostGameNumber(result.texts[i], cell.metric) === cell.expected) postCorrect++;
    });
  }
  const report = {
    schema: 1,
    createdAt: new Date().toISOString(),
    fixtureSha256: createHash('sha256').update(bytes).digest('hex'),
    node: process.version,
    cpu: cpus()[0]?.model,
    modelWarmupMs,
    scope:
      'Recorded screenshot crops; HUD preprocessing + OCR only. Excludes capture, HTTP, WebSocket, render and cloud. Repeated still frames favour cache. Post-game quantiles have few page batches; not video P99.',
    hud: {
      before: { ...summary(before), correct: beforeCorrect, total: iterations * 7 },
      after: { ...summary(after), correct: afterCorrect, total: iterations * 7 },
    },
    postgame: { ...summary(postTimes), correct: postCorrect, total: postTotal },
    raw: { before, after, postTimes },
  };
  const output = option('--output');
  if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, raw: undefined }, null, 2));
} finally {
  await provider.close();
}
