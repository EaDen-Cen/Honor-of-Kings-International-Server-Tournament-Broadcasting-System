import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile, realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../server/store.js';

const directory = await mkdtemp(join(await realpath(tmpdir()), 'hok-bp-http-'));
const file = join(directory, 'match.json'),
  token = randomUUID(),
  port = '3148';
const seed = new Store().data;
seed.state.bpInputMode = 'screen';
await writeFile(file, JSON.stringify(seed));
const child = spawn(process.execPath, ['--import', 'tsx', 'server/server.ts'], {
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'ignore'],
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: port,
    NODE_ENV: 'development',
    DATA_FILE: file,
    UPLOAD_DIR: join(directory, 'uploads'),
    ACCESS_PASSWORD: '',
    CONTROL_TOKEN: token,
    CASTER_TOKEN: randomUUID(),
    OVERLAY_TOKEN: randomUUID(),
    HOK_CONFIG_KEY: randomBytes(32).toString('base64'),
    OBS_WS_URL: '',
    OBS_WS_PASSWORD: '',
  },
});
let output = '',
  launchError = false;
child.stdout.on('data', (data) => {
  output = (output + data).slice(-8192);
});
child.once('error', () => {
  launchError = true;
});
const closed = new Promise<void>((done) => child.once('close', () => done()));
try {
  const deadline = performance.now() + 20_000;
  while (!output.includes('HOK Broadcast server ready on port ' + port)) {
    assert.ok(
      !launchError &&
        child.exitCode === null &&
        child.signalCode === null &&
        performance.now() < deadline,
      'Isolated benchmark did not start',
    );
    await delay(5);
  }
  process.env.HOK_BENCHMARK_PORT = port;
  process.env.HOK_BENCHMARK_TOKEN = token;
  await import('./benchmark-recognition.js');
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill();
  await closed;
  assert.equal(dirname(directory), await realpath(tmpdir()));
  await rm(directory, { recursive: true, force: true });
}
