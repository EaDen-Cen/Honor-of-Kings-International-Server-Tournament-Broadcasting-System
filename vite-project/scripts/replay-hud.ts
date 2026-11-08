import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { PlayerRecognitionProvider } from '../server/playerRecognition.js';
import { recognizeLiveHudCrops } from '../server/gameDataRecognition.js';
import { Store } from '../server/store.js';
import { liveGameContext, trustedLiveUpdates, type LiveHudSample } from '../src/shared/liveGame.js';
import {
  liveCaptureKeys,
  liveCaptureRects,
  validLiveCaptureRects,
  pixelRect,
  type LiveCaptureKey,
} from '../src/shared/gameCapture.js';
const option = (key: string) => {
  const i = process.argv.indexOf(key);
  return i < 0 ? undefined : process.argv[i + 1];
};
const manifestFile = option('--manifest'),
  output = option('--output');
if (!manifestFile || !output) throw Error('Use --manifest <labelled.json> --output <report.json>');
type Frame = {
  file: string;
  atMs: number;
  stage: 'normal' | 'occluded' | 'recovered';
  expected: Partial<Record<LiveCaptureKey, number>>;
};
const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as {
  kind: 'emulator' | 'real-match' | 'synthetic';
  frames: Frame[];
  regions?: typeof liveCaptureRects;
};
if (
  !['emulator', 'real-match', 'synthetic'].includes(manifest.kind) ||
  !Array.isArray(manifest.frames) ||
  !manifest.frames.length ||
  manifest.frames.length > 3600
)
  throw Error('Invalid kind / frames (1–3600)');
const regions = manifest.regions ?? liveCaptureRects;
if (!validLiveCaptureRects(regions)) throw Error('Invalid calibration');
for (let i = 0; i < manifest.frames.length; i++) {
  const f = manifest.frames[i];
  if (
    !f ||
    typeof f.file !== 'string' ||
    !Number.isFinite(f.atMs) ||
    f.atMs < 0 ||
    (i > 0 && f.atMs <= manifest.frames[i - 1].atMs) ||
    !['normal', 'occluded', 'recovered'].includes(f.stage) ||
    !f.expected ||
    Object.entries(f.expected).some(
      ([k, v]) => !liveCaptureKeys.includes(k as LiveCaptureKey) || !Number.isFinite(v),
    )
  )
    throw Error('Frames require increasing atMs, stage and numeric labels');
}
const provider = new PlayerRecognitionProvider(undefined, 'eng');
const percentile = (values: number[]) =>
  values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] : null;
// Frozen 6b5abd9 cache behavior, used only for A/B. Production never calls this baseline.
function baselineCache(clock: () => number) {
  const fields = new Map<
    number,
    { key: string; text: string; confidence: number; until: number }
  >();
  return {
    recognizeNumbers: async (images: unknown) => {
      const values = images as string[],
        now = clock(),
        samples = values.map((key, index) => {
          const p = fields.get(index);
          return p?.key === key && p.until > now ? p : undefined;
        });
      const changed = values.flatMap((_, index) => (samples[index] ? [] : [index]));
      if (changed.length) {
        const r = await provider.recognizeNumbers(changed.map((i) => values[i]));
        changed.forEach((index, offset) => {
          const s = {
            key: values[index],
            text: r.texts[offset],
            confidence: r.confidences[offset],
            until: now + 4000,
          };
          samples[index] = s;
          fields.set(index, s);
        });
      }
      return {
        texts: samples.map((s) => s!.text),
        confidences: samples.map((s) => s!.confidence),
        elapsedMs: 0,
      };
    },
  };
}
try {
  await provider.prepare();
  await provider.prepareNumbers();
  const results = [];
  for (const mode of ['before', 'after'] as const) {
    let now = Date.now(),
      previous: LiveHudSample | undefined;
    const epoch = now,
      store = new Store(undefined, () => now),
      baseline = baselineCache(() => now);
    const fields = Object.fromEntries(
      liveCaptureKeys.map((k) => [
        k,
        {
          samples: 0,
          correct: 0,
          rejected: 0,
          published: 0,
          wrongPublished: 0,
          occludedWrongPublished: 0,
        },
      ]),
    ) as Record<
      LiveCaptureKey,
      {
        samples: number;
        correct: number;
        rejected: number;
        published: number;
        wrongPublished: number;
        occludedWrongPublished: number;
      }
    >;
    const timings: number[] = [],
      trace: unknown[] = [],
      recoveries: { field: LiveCaptureKey; frames: number | null; seconds: number | null }[] = [];
    const recovery = manifest.frames.findIndex((f) => f.stage === 'recovered');
    for (const key of liveCaptureKeys) recoveries.push({ field: key, frames: null, seconds: null });
    for (let index = 0; index < manifest.frames.length; index++) {
      const f = manifest.frames[index],
        start = performance.now();
      now = epoch + f.atMs;
      const bytes = await readFile(resolve(dirname(resolve(manifestFile)), f.file));
      const meta = await sharp(bytes, { limitInputPixels: 9000000 }).metadata();
      if (meta.width !== 1920 || !meta.height || meta.height < 100 || meta.height > 1080)
        throw Error('Replay expects 1920-wide normalized frames or top strips >=100px');
      const crops = await Promise.all(
        liveCaptureKeys.map(
          async (key) =>
            'data:image/png;base64,' +
            (
              await sharp(bytes)
                .extract(pixelRect(regions[key], 1920, 1080))
                .png()
                .toBuffer()
            ).toString('base64'),
        ),
      );
      const result = await recognizeLiveHudCrops(
        crops,
        mode === 'before' ? baseline : provider,
        regions,
        mode === 'before' ? undefined : 'replay-after',
        () => now,
      );
      const sample: LiveHudSample = {
        ...result,
        capturedAt: now,
        profile: 'replay',
        ...(mode === 'before' ? { frameHash: undefined } : {}),
      };
      const updates = previous
        ? trustedLiveUpdates(store.data.state.liveGameStats, previous, sample)
        : {};
      if (previous && Object.keys(updates).length)
        store.apply(randomUUID(), store.data.revision, {
          type: 'live_game_ocr',
          context: liveGameContext(store.data.state),
          previous,
          sample,
        });
      for (const key of liveCaptureKeys) {
        const expected = f.expected[key];
        if (expected === undefined) continue;
        const field = fields[key],
          candidate = sample.candidates.find((c) => c.key === key)!;
        field.samples++;
        if (candidate.value === expected) field.correct++;
        if (updates[key] === undefined) field.rejected++;
        else {
          field.published++;
          if (updates[key] !== expected) {
            field.wrongPublished++;
            if (f.stage === 'occluded') field.occludedWrongPublished++;
          }
        }
        const recoveryRow = recoveries.find((r) => r.field === key)!;
        if (
          recovery >= 0 &&
          index >= recovery &&
          recoveryRow.frames === null &&
          updates[key] === expected
        ) {
          recoveryRow.frames = index - recovery + 1;
          recoveryRow.seconds = (f.atMs - manifest.frames[recovery].atMs) / 1000;
        }
      }
      const elapsedMs = performance.now() - start;
      timings.push(elapsedMs);
      trace.push({
        file: f.file,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        atMs: f.atMs,
        stage: f.stage,
        candidates: sample.candidates,
        updates,
        expected: f.expected,
        elapsedMs,
      });
      previous = sample;
    }
    results.push({
      mode,
      fields: Object.fromEntries(
        liveCaptureKeys.map((key) => [
          key,
          {
            ...fields[key],
            accuracy: fields[key].samples ? fields[key].correct / fields[key].samples : null,
            rejectionRate: fields[key].samples ? fields[key].rejected / fields[key].samples : null,
          },
        ]),
      ),
      recoveries,
      p95PipelineMs: percentile(timings),
      trace,
    });
  }
  const covered = manifest.frames.filter((f) => f.stage === 'occluded');
  const assessed =
    covered.length > 0 &&
    manifest.frames.some((f) => f.stage === 'normal') &&
    manifest.frames.some((f) => f.stage === 'recovered') &&
    covered.every(
      (f) =>
        f.expected.blueKills !== undefined &&
        f.expected.redKills !== undefined &&
        f.expected.gameTimeSeconds !== undefined,
    );
  const wrong =
    results[1].fields.blueKills.occludedWrongPublished +
    results[1].fields.redKills.occludedWrongPublished;
  const acceptance = {
    assessed,
    occludedFrames: covered.length,
    wrongPublished: wrong,
    passed: assessed
      ? wrong === 0 &&
        results[1].recoveries.find((r) => r.field === 'gameTimeSeconds')!.frames !== null
      : null,
  };
  const report = {
    acceptance,
    baseline:
      'main 6b5abd9 cache + legacy clock-gated publication; unchanged preprocessing and local engine',
    kind: manifest.kind,
    frames: manifest.frames.length,
    scope:
      'Offline file decode → calibrated crops → local OCR → in-memory authoritative Store. Excludes capture, HTTP/WS transport and OBS. Rejection includes first read, unchanged/frozen/cache and protected values, not just OCR failure.',
    results,
  };
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
  const escape = (v: unknown) =>
    String(v).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
    );
  const html = `<!doctype html><meta charset="utf-8"><title>HOK OCR A/B</title><style>body{font:16px system-ui;margin:30px;background:#102031;color:#eee}table{border-collapse:collapse}td,th{padding:10px;border:1px solid #567}pre{white-space:pre-wrap}details{margin-top:20px}</style><h1>HOK OCR · ${escape(manifest.kind)} · ${manifest.frames.length} frames</h1><p>${escape(report.scope)}</p><p>遮挡验收：${acceptance.assessed ? (acceptance.passed ? '通过（仅此标注集）' : '失败') : '缺少完整标注三阶段样本，未验收'} · 错误比分发布 ${acceptance.wrongPublished}</p>${results
    .map(
      (r) =>
        `<h2>${r.mode} · P95 ${r.p95PipelineMs?.toFixed(1)} ms</h2><table><tr><th>Field</th><th>N</th><th>Accuracy</th><th>Rejected</th><th>Wrong published</th><th>Occluded wrong</th><th>Recovery</th></tr>${liveCaptureKeys
          .map((k) => {
            const v = r.fields[k],
              rec = r.recoveries.find((x) => x.field === k)!;
            return `<tr><td>${k}</td><td>${v.samples}</td><td>${v.accuracy === null ? 'n/a' : (100 * v.accuracy).toFixed(1) + '%'}</td><td>${v.rejected}</td><td>${v.wrongPublished}</td><td>${v.occludedWrongPublished}</td><td>${rec.frames ?? 'not observed'} frames / ${rec.seconds ?? '—'} s</td></tr>`;
          })
          .join(
            '',
          )}</table><details><summary>逐帧候选 / 实际提交</summary><pre>${escape(JSON.stringify(r.trace, null, 2))}</pre></details>`,
    )
    .join('')}`;
  await writeFile(output.replace(/\.json$/i, '') + '.html', html);
  console.log(
    JSON.stringify(
      {
        ...report,
        results: results.map((r) => ({
          mode: r.mode,
          fields: r.fields,
          recoveries: r.recoveries,
          p95PipelineMs: r.p95PipelineMs,
        })),
      },
      null,
      2,
    ),
  );
  if (wrong > 0 || acceptance.passed === false) process.exitCode = 1;
} finally {
  await provider.close();
}
