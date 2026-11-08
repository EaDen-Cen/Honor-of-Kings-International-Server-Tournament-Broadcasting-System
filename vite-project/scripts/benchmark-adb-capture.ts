import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { AdbCapture } from '../server/adbCapture.js';
import { PlayerRecognitionProvider } from '../server/playerRecognition.js';
import { recognizeLiveHudCrops } from '../server/gameDataRecognition.js';
import {
  liveCaptureKeys,
  pixelRect,
  validLiveCaptureRects,
  type LiveCandidate,
} from '../src/shared/gameCapture.js';

// Real local screenshots only. No device controls and no match-state writes.
const option = (key: string) => {
  const i = process.argv.indexOf(key);
  return i < 0 ? undefined : process.argv[i + 1];
};
const samples = Number(option('--samples') ?? 30),
  interval = Number(option('--interval') ?? 1000);
if (
  !Number.isInteger(samples) ||
  samples < 1 ||
  samples > 3600 ||
  !Number.isInteger(interval) ||
  interval < 1000
)
  throw Error('Use 1–3600 samples and an interval of at least 1000 ms');
if (!option('--output')) throw Error('--output must name a local evidence directory');
const output = resolve(option('--output')!),
  adb = new AdbCapture();
const devices = (await adb.discover()).filter((d) => d.connected);
const device =
  devices.find((d) => d.id === option('--device')) ??
  (devices.length === 1 && !option('--device') ? devices[0] : undefined);
if (!device)
  throw Error(`Choose --device from: ${devices.map((d) => d.id + ' ' + d.name).join(', ')}`);
const regions = option('--regions')
  ? JSON.parse(await readFile(resolve(option('--regions')!), 'utf8'))
  : undefined;
if (regions && !validLiveCaptureRects(regions))
  throw Error('Invalid calibrated seven-field regions');
const provider = regions ? new PlayerRecognitionProvider(undefined, 'eng') : undefined;
const rows: {
  capturedAt?: number;
  candidates?: LiveCandidate[];
  captureMs: number;
  decodeMs: number;
  ocrMs?: number;
  totalMs: number;
  rss: number;
  bytes: number;
  error?: string;
}[] = [];
await mkdir(output, { recursive: true });
try {
  if (provider) {
    await provider.prepare();
    await provider.prepareNumbers();
  }
  const started = performance.now(),
    cpu = process.cpuUsage();
  for (let i = 0; i < samples; i++) {
    const tick = performance.now();
    try {
      const frame = await adb.capture(device.id);
      if (i === 0 || i === samples - 1)
        await writeFile(join(output, i === 0 ? 'first.png' : 'last.png'), frame.image);
      let ocrMs: number | undefined, candidates: LiveCandidate[] | undefined;
      if (regions && provider) {
        if (Math.abs(frame.width / frame.height - 16 / 9) > 0.025)
          throw Error('Select a 16:9 content crop before benchmarking OCR');
        const normalized = await sharp(frame.image).resize(1920, 1080).png().toBuffer();
        await sharp(normalized)
          .extract({ left: 0, top: 0, width: 1920, height: 100 })
          .png()
          .toFile(join(output, `hud-${String(i + 1).padStart(3, '0')}.png`));
        const images = await Promise.all(
          liveCaptureKeys.map(
            async (key) =>
              'data:image/png;base64,' +
              (
                await sharp(normalized)
                  .extract(pixelRect(regions[key], 1920, 1080))
                  .png()
                  .toBuffer()
              ).toString('base64'),
          ),
        );
        const result = await recognizeLiveHudCrops(images, provider, regions);
        ocrMs = result.elapsedMs;
        candidates = result.candidates;
        if (i === samples - 1)
          await writeFile(join(output, 'last-candidates.json'), JSON.stringify(result, null, 2));
      }
      rows.push({
        capturedAt: frame.capturedAt,
        candidates,
        captureMs: frame.captureMs,
        decodeMs: frame.decodeMs,
        ocrMs,
        totalMs: performance.now() - tick,
        rss: process.memoryUsage().rss,
        bytes: frame.image.length,
      });
    } catch (error) {
      rows.push({
        captureMs: 0,
        decodeMs: 0,
        totalMs: performance.now() - tick,
        rss: process.memoryUsage().rss,
        bytes: 0,
        error: error instanceof Error ? error.message : 'Capture failed',
      });
    }
    if ((i + 1) % 10 === 0) console.log(`Captured ${i + 1}/${samples}; no queued frames`);
    if (i < samples - 1) await delay(Math.max(0, interval - (performance.now() - tick)));
  }
  const elapsedMs = performance.now() - started,
    used = process.cpuUsage(cpu);
  const percentile = (values: number[], q: number) => {
    const sorted = values.sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] ?? null;
  };
  const good = rows.filter((r) => !r.error);
  const timing = Object.fromEntries(
    ['captureMs', 'decodeMs', 'ocrMs', 'totalMs'].map((key) => {
      const values = good.map((r) => r[key as 'captureMs']).filter((v) => typeof v === 'number');
      return [key, { p50: percentile(values, 0.5), p95: percentile(values, 0.95) }];
    }),
  );
  const report = {
    device: device.name,
    samples,
    successful: good.length,
    elapsedMs,
    throughputFps: good.length / (elapsedMs / 1000),
    timing,
    nodeCpuMs: (used.user + used.system) / 1000,
    rssMin: Math.min(...rows.map((r) => r.rss)),
    rssMax: Math.max(...rows.map((r) => r.rss)),
    limitations:
      'Node CPU excludes ADB child processes. No browser transport or authoritative match ACK measured. Does not establish long-duration stability or Windows-capture equivalence.',
    rows,
  };
  await writeFile(join(output, 'measurements.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
} finally {
  await provider?.close();
}
