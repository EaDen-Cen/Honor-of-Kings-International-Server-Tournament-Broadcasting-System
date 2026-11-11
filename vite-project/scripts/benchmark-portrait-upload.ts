import { createServer, request } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import type * as Portraits from '../server/portraits.js';

// From vite-project: node --import tsx scripts/benchmark-portrait-upload.ts [--baseline ../other/vite-project]
const { values } = parseArgs({
  options: {
    baseline: { type: 'string' },
    png: { type: 'string' },
    jpeg: { type: 'string' },
    rounds: { type: 'string', default: '7' },
  },
});
const rounds = Number(values.rounds);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 100) throw Error('rounds must be 1..100');
const inputs = [
  {
    format: 'png',
    data: values.png
      ? await readFile(values.png)
      : await sharp('public/heroesImg/54.png').resize(1600, 1600).png().toBuffer(),
  },
  { format: 'jpeg', data: await readFile(values.jpeg || "public/heroesArt/ao'yin.jpg") },
];
const endpoint = '/api/uploads/player-portrait';
const percentile = (times: number[], p: number) =>
  [...times].sort((a, b) => a - b)[Math.ceil(times.length * p) - 1];

async function roundTrip(port: number, path: string, data?: Buffer, mime?: string) {
  return new Promise<Buffer>((accept, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: data ? 'POST' : 'GET',
        headers: data ? { 'Content-Type': mime!, 'Content-Length': data.length } : {},
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () =>
          response.statusCode === (data ? 201 : 200)
            ? accept(Buffer.concat(chunks))
            : reject(Error('Portrait handler HTTP ' + response.statusCode)),
        );
      },
    );
    req.setTimeout(20000, () => req.destroy(Error('timeout')));
    req.on('error', reject);
    req.end(data);
  });
}

for (const app of [...(values.baseline ? [resolve(values.baseline)] : []), process.cwd()]) {
  const module = (await import(
    pathToFileURL(join(app, 'server', 'portraits.ts')).href
  )) as typeof Portraits;
  const directory = await mkdtemp(join(tmpdir(), 'hok-portrait-benchmark-'));
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === endpoint)
      void module.uploadPortrait(req, res, directory);
    else void module.servePortrait(req.url || '', res, directory);
  });
  try {
    await new Promise<void>((ok, fail) => {
      server.once('error', fail);
      server.listen(0, '127.0.0.1', ok);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('No test port');
    for (const { format, data } of inputs) {
      const times: number[] = [],
        complete: number[] = [];
      let previewBytes = 0,
        storedBytes = 0;
      for (let i = 0; i <= rounds; i++) {
        const start = performance.now();
        const response = JSON.parse(
          (await roundTrip(address.port, endpoint, data, 'image/' + format)).toString(),
        );
        const uploaded = performance.now();
        previewBytes =
          response.previewOriginal === true
            ? 0
            : (await roundTrip(address.port, response.url)).length;
        const previewReady = performance.now();
        const saved = join(directory, basename(response.url));
        storedBytes = (await stat(saved)).size;
        await rm(saved);
        if (i > 0) {
          times.push(uploaded - start);
          complete.push(previewReady - start);
        }
      }
      console.log(
        JSON.stringify({
          app,
          format,
          rounds,
          uploadBytes: data.length,
          storedBytes,
          previewDownloadBytes: previewBytes,
          postMedianMs: percentile(times, 0.5),
          postP95Ms: percentile(times, 0.95),
          postAndPreviewTransferMedianMs: percentile(complete, 0.5),
          postAndPreviewTransferP95Ms: percentile(complete, 0.95),
        }),
      );
    }
  } finally {
    await new Promise<void>((ok) => server.close(() => ok()));
    await rm(directory, { recursive: true, force: true });
  }
}
