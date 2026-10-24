import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { PlayerRecognitionProvider } from '../server/playerRecognition.js';
import { recognizeSettlement } from '../server/gameDataRecognition.js';
import type { PostGamePage, PostGameReport } from '../src/shared/postGame.js';
const at = process.argv.indexOf('--output'),
  output = at < 0 ? 'artifacts/settlement-benchmark.json' : process.argv[at + 1];
const bytes = await readFile(
  new URL('../server/fixtures/settlement-page-semantics.json', import.meta.url),
);
const fixture = JSON.parse(bytes.toString()) as {
  pages: Array<{ page: PostGamePage; image: string }>;
};
const report = {
  id: 'benchmark-static-report',
  players: Array.from({ length: 10 }, (_, i) => ({
    rowId: `row-${i}`,
    playerId: `Player${i}`,
    side: i < 5 ? 'blue' : 'red',
  })),
} as PostGameReport;
const provider = new PlayerRecognitionProvider();
const samples = [];
try {
  await provider.prepare();
  await provider.prepareNumbers();
  for (let run = 0; run < 3; run++)
    for (const page of fixture.pages.filter((p) => ['summary', 'overview'].includes(p.page))) {
      const result = await recognizeSettlement(
        Buffer.from(page.image, 'base64'),
        page.page,
        report,
        provider,
      );
      samples.push({
        run,
        page: page.page,
        elapsedMs: result.elapsedMs,
        timings: result.timings,
        values: result.candidates.map((c) => ({
          row: c.screenRow,
          metric: c.metric,
          value: c.value,
          confidence: c.confidence,
        })),
        gradeWarning: result.gradeWarning,
      });
    }
  const values = samples.map((s) => s.elapsedMs).sort((a, b) => a - b);
  const summary = {
    n: values.length,
    p50Ms: values[Math.ceil(values.length * 0.5) - 1],
    p95Ms: values.at(-1),
    fixtureSha256: createHash('sha256').update(bytes).digest('hex'),
    cpu: cpus()[0]?.model,
    node: process.version,
    scope:
      'Recorded summary/overview full-frame OCR after worker warmup; excludes capture, cloud, network, frontend and real match roster identity accuracy.',
  };
  await writeFile(output, JSON.stringify({ summary, samples }, null, 2));
  console.log(JSON.stringify(summary));
} finally {
  await provider.close();
}
