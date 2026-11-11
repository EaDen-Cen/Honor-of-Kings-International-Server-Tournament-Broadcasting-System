import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { on, once } from 'node:events';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { Store } from '../server/store.js';

// Pass a second checkout's vite-project as the sole argument to run the very same client against it.
const project = resolve(process.argv[2] ?? fileURLToPath(new URL('../', import.meta.url)));
const port = 3128,
  warmup = 8,
  samples = 40;
const temp = await realpath(tmpdir());

async function run(events: number) {
  const directory = await mkdtemp(join(temp, 'hok-action-ack-'));
  const file = join(directory, 'match.json'),
    token = randomUUID();
  const seed = new Store().data;
  seed.revision = events;
  seed.events = Array.from({ length: events }, (_, i) => ({
    id: `fixture-${String(i).padStart(5, '0')}`,
    type: 'score',
    timestamp: i,
    revision: i + 1,
    resultingState: seed.state,
  }));
  seed.ids = seed.events.map((e) => e.id);
  seed.history = Array(Math.min(events, 200)).fill(seed.state);
  const initial = JSON.stringify(seed);
  await writeFile(file, initial);
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/server.ts'], {
    cwd: project,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      NODE_ENV: 'development',
      DATA_FILE: file,
      UPLOAD_DIR: join(directory, 'uploads'),
      CONTROL_TOKEN: token,
      CASTER_TOKEN: randomUUID(),
      OVERLAY_TOKEN: randomUUID(),
      ACCESS_PASSWORD: '',
      HOK_CONFIG_KEY: randomBytes(32).toString('base64'),
      OBS_WS_URL: '',
      OBS_WS_PASSWORD: '',
    },
  });
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  let ws: WebSocket | undefined,
    output = '',
    launchError: Error | undefined;
  child.on('error', (error) => {
    launchError = error;
  });
  child.stdout.on('data', (b) => {
    output = (output + b.toString()).slice(-8192);
  });
  child.stderr.resume();
  try {
    // A failed bind must never connect the driver to another running service.
    const deadline = Date.now() + 20000;
    while (!output.includes('HOK Broadcast server ready on port ' + port)) {
      if (launchError) throw launchError;
      if (Date.now() > deadline || child.exitCode !== null || child.signalCode !== null)
        throw Error('Isolated server could not start at 127.0.0.1:' + port);
      await pause(50);
    }
    ws = new WebSocket('ws://127.0.0.1:' + port + '/ws');
    const signal = AbortSignal.timeout(60000);
    const messages = on(ws, 'message', { signal, close: ['close'] });
    const receive = async () => {
      const result = await messages.next();
      if (result.done) throw Error('Premature WebSocket close');
      return JSON.parse(result.value[0].toString());
    };
    await once(ws, 'open', { signal });
    ws.send(JSON.stringify({ type: 'auth', token }));
    const auth = await receive();
    assert.equal(auth.type, 'match_state_update');
    assert.equal(auth.revision, events);
    let revision = auth.revision;
    const timings: number[] = [];
    // Both servers normally prepare recognition assets at startup. Keep that work out of the timed samples.
    const options = { headers: { Authorization: 'Bearer ' + token }, signal };
    const base = 'http://127.0.0.1:' + port;
    const preflight = await fetch(base + '/api/v1/preflight-status', options);
    assert.ok(preflight.ok);
    for (;;) {
      const capability = await fetch(base + '/api/v1/capabilities', options);
      assert.ok(capability.ok);
      if ((await capability.json()).playerRecognition.status !== 'loading') break;
      await pause(100);
    }
    for (let i = 0; i < warmup + samples; i++) {
      await pause(50); // Outside timing, well below the actual server rate limit.
      const id = randomUUID(),
        delta = i % 2 === 0 ? 1 : -1;
      const payload = JSON.stringify({
        type: 'action',
        id,
        revision,
        action: { type: 'score', team: 'blue', delta },
      });
      const start = performance.now();
      ws.send(payload);
      const snapshot = await receive();
      assert.equal(snapshot.type, 'match_state_update');
      assert.equal(snapshot.revision, ++revision);
      assert.equal(snapshot.state.blueScore, delta > 0 ? 1 : 0);
      const ack = await receive();
      const elapsed = performance.now() - start;
      assert.deepEqual(ack, { type: 'ack', id });
      const persisted = JSON.parse(await readFile(file, 'utf8'));
      assert.equal(persisted.revision, revision);
      assert.equal(persisted.ids.at(-1), id);
      assert.deepEqual(persisted.state, snapshot.state);
      if (i >= warmup) timings.push(elapsed);
    }
    timings.sort((a, b) => a - b);
    const percentile = (fraction: number) =>
      Number(timings[Math.ceil(timings.length * fraction) - 1].toFixed(2));
    return {
      initialEvents: events,
      initialUndo: seed.history.length,
      initialBytes: Buffer.byteLength(initial),
      warmup,
      samples,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
    };
  } finally {
    ws?.terminate();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
    assert.equal(dirname(directory), temp);
    await rm(directory, { recursive: true, force: true });
  }
}

const results = [await run(0), await run(600)];
console.log(
  JSON.stringify(
    { transport: 'loopback WebSocket, Control score action to durable ACK', port, results },
    null,
    2,
  ),
);
