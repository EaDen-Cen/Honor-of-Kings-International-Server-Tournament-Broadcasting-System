import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import heroes from '../src/components/HeroList.js';
import * as current from '../server/capture.js';

type Sample = {
  image: string;
  shape: 'square' | 'circle';
  lockImage?: string;
  expectedHeroId?: number;
};
const baselinePath = process.env.HOK_BASELINE_PATH;
const baseline = baselinePath
  ? ((await import(
      pathToFileURL(
        resolve(
          baselinePath.endsWith('.ts') ? baselinePath : join(baselinePath, 'server/capture.ts'),
        ),
      ).href
    )) as typeof current)
  : undefined;
const samples: Sample[] = [];
const privateFixture = process.env.HOK_HERO_RECOGNITION_SAMPLE;
if (privateFixture) {
  const fixture = JSON.parse(await readFile(privateFixture, 'utf8'));
  for (const entry of fixture.samples) samples.push({ ...entry, shape: entry.shape ?? 'square' });
} else {
  // Calibrated browser-size crops, including every Flowborn form and Lady Sun.
  const group = [
    ...new Set([
      ...heroes.filter((_, i) => i % 11 === 0),
      ...heroes.filter((h) => h.variantGroup === 'flowborn' || h.englishName === 'Lady Sun'),
    ]),
  ];
  for (const [i, hero] of group.entries()) {
    const file = await readFile('public' + (hero.recognitionImageLink || hero.imageLink));
    for (const shape of ['square', 'circle'] as const) {
      const size = 64 + (i % 3) * 8;
      const data = await sharp(file)
        .resize(size, size)
        .modulate({ brightness: 1 - (i % 5) * 0.04 })
        .jpeg({ quality: 65 })
        .toBuffer();
      const lockImage =
        shape === 'square'
          ? 'data:image/png;base64,' +
            (
              await sharp(data)
                .extend({ bottom: Math.round(size * 0.3), background: '#192536' })
                .png()
                .toBuffer()
            ).toString('base64')
          : undefined;
      samples.push({
        image: 'data:image/jpeg;base64,' + data.toString('base64'),
        shape,
        lockImage,
        expectedHeroId: hero.id,
      });
    }
  }
}
assert.ok(
  samples.length > 1,
  'Need at least two crops for the first unprepared request and warmed measurements',
);

const durations = (times: number[]) => {
  const sorted = times.toSorted((a, b) => a - b);
  const quantile = (p: number) => sorted[Math.ceil(sorted.length * p) - 1];
  return {
    samples: sorted.length,
    p50Ms: quantile(0.5),
    p95Ms: quantile(0.95),
    maxMs: quantile(1),
    over100ms: sorted.filter((t) => t >= 100).length,
  };
};

async function measure(module: typeof current) {
  const port = process.env.HOK_BENCHMARK_PORT;
  const run = async (sample: Sample) => {
    if (!port)
      return module.recognizeClientFrame(sample.image, undefined, sample.shape, sample.lockImage);
    const response = await fetch('http://127.0.0.1:' + port + '/api/recognize-frame', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.HOK_BENCHMARK_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: sample.image,
        shape: sample.shape,
        lockImage: sample.lockImage,
        revision: 0,
        omitEchoPreview: true,
      }),
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, 200);
    return (await response.json()) as Awaited<ReturnType<typeof module.recognizeClientFrame>>;
  };
  const coldStart = performance.now();
  const first = await run(samples[0]);
  const coldMs = performance.now() - coldStart;
  if (samples[0].expectedHeroId !== undefined)
    assert.equal(first.candidates[0]?.heroId, samples[0].expectedHeroId);
  const preparedHeroes = port ? undefined : (await module.prepareHeroTemplates()).length;
  const results = [first];
  const times: number[] = [];
  let lastTick = performance.now(),
    maxTimerGapMs = 0;
  const tick = () => {
    const now = performance.now();
    maxTimerGapMs = Math.max(maxTimerGapMs, now - lastTick);
    lastTick = now;
  };
  const timer = setInterval(tick, 4);
  try {
    for (const sample of samples.slice(1)) {
      const start = performance.now();
      const result = await run(sample);
      times.push(performance.now() - start);
      if (sample.expectedHeroId !== undefined)
        assert.equal(result.candidates[0]?.heroId, sample.expectedHeroId);
      results.push(result);
    }
    tick();
  } finally {
    clearInterval(timer);
  }
  const hits = [];
  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    await run(samples.at(-1)!);
    hits.push(performance.now() - start);
  }
  return {
    stats: {
      preparedHeroes,
      coldMs,
      distinct: durations(times),
      identicalCacheHits: durations(hits),
      maxTimerGapMs: port ? undefined : maxTimerGapMs,
    },
    results,
  };
}

const before = baseline && !process.env.HOK_BENCHMARK_PORT ? await measure(baseline) : undefined;
const after = await measure(current);
async function measureBatches(port: string) {
  const slots = samples
    .filter((sample) => sample.shape === 'square' && sample.expectedHeroId !== undefined)
    .slice(0, 10);
  if (slots.length < 10) return;
  const teams = [slots.slice(0, 5), slots.slice(5)].map((team) =>
    team.map((s) => s.expectedHeroId!),
  );
  const times = {
    firstFive: [] as number[],
    repeatedFive: [] as number[],
    firstTen: [] as number[],
    repeatedTen: [] as number[],
  };
  const post = async (
    crops: { image: string; allowedHeroIds?: number[] }[],
    expected: Sample[],
  ) => {
    const start = performance.now();
    const response = await fetch('http://127.0.0.1:' + port + '/api/v1/recognition/portraits', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.HOK_BENCHMARK_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ revision: 0, crops }),
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    const elapsed = performance.now() - start;
    assert.deepEqual(
      data.results.map((r: { candidates: { heroId: number }[] }) => r.candidates[0].heroId),
      expected.map((s) => s.expectedHeroId),
    );
    return elapsed;
  };
  for (let trial = 0; trial < 3; trial++) {
    const crops = await Promise.all(
      slots.map(async (slot) => {
        const pixels = await sharp(Buffer.from(slot.image.split(',')[1], 'base64'))
          .resize(72 + trial, 72 + trial)
          .png()
          .toBuffer();
        return { image: 'data:image/png;base64,' + pixels.toString('base64') };
      }),
    );
    const five = crops.slice(0, 5);
    const ten = crops.map((crop, i) => ({ ...crop, allowedHeroIds: teams[Math.floor(i / 5)] }));
    times.firstFive.push(await post(five, slots.slice(0, 5)));
    times.repeatedFive.push(await post(five, slots.slice(0, 5)));
    times.firstTen.push(await post(ten, slots));
    times.repeatedTen.push(await post(ten, slots));
  }
  return Object.fromEntries(
    Object.entries(times).map(([kind, values]) => [kind, durations(values)]),
  );
}
const batches = process.env.HOK_BENCHMARK_PORT
  ? await measureBatches(process.env.HOK_BENCHMARK_PORT)
  : undefined;
if (before)
  assert.deepEqual(
    after.results,
    before.results,
    'Candidate order, scores, lock evidence and previews must match',
  );
console.log(
  JSON.stringify(
    {
      fixture: privateFixture ? 'private annotated crops' : 'synthetic template crops',
      frames: samples.length,
      transport: process.env.HOK_BENCHMARK_PORT
        ? 'loopback HTTP /api/recognize-frame'
        : 'in-process recognition',
      before: before?.stats,
      after: after.stats,
      batches,
      exactEvidenceMatch: before ? true : undefined,
    },
    null,
    2,
  ),
);
