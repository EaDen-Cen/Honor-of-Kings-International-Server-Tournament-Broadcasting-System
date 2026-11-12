import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { on, once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { Store } from './store.js';
import type { RecoveryArchive } from './recovery.js';

test(
  'backup and export include queued actions and graceful shutdown drains a slow save',
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hok-durable-operations-'));
    const file = join(directory, 'match.json');
    const token = randomUUID();
    const child = fork(new URL('./fixtures/paused-match-write.mjs', import.meta.url), [], {
      execArgv: ['--import', 'tsx'],
      silent: true,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        PORT: '0',
        DATA_FILE: file,
        UPLOAD_DIR: join(directory, 'uploads'),
        CONTROL_TOKEN: token,
        OVERLAY_TOKEN: randomUUID(),
        CASTER_TOKEN: randomUUID(),
        ACCESS_PASSWORD: '',
        HOK_CONFIG_KEY: randomBytes(32).toString('base64'),
        OBS_WS_URL: '',
        OBS_WS_PASSWORD: '',
      },
    });
    child.stdout?.resume();
    child.stderr?.resume();
    const exited = once(child, 'exit');
    const signal = AbortSignal.timeout(25000);
    const events = on(child, 'message', { signal, close: ['exit'] });
    const next = async () => {
      const event = await events.next();
      assert.ok(!event.done, 'server exited before completing the pending operation');
      return event.value[0];
    };
    let ws: WebSocket | undefined;
    try {
      const port = await next();
      assert.equal(typeof port, 'number');
      const base = 'http://127.0.0.1:' + port;
      ws = new WebSocket(base.replace('http:', 'ws:') + '/ws');
      const messages = on(ws, 'message', { signal, close: ['close'] });
      const until = async (type: string) => {
        for (;;) {
          const message = await messages.next();
          assert.ok(!message.done);
          const data = JSON.parse(message.value[0].toString());
          if (data.type === type) return data;
        }
      };
      await once(ws, 'open', { signal });
      ws.send(JSON.stringify({ type: 'auth', token }));
      assert.equal((await until('match_state_update')).revision, 0);
      const send = (revision: number, team: string) => {
        const id = randomUUID();
        ws!.send(
          JSON.stringify({
            type: 'action',
            revision,
            id,
            action: { type: 'score', team, delta: 1 },
          }),
        );
        return id;
      };
      const first = send(0, 'blue');
      assert.equal(await next(), 'flushing');
      const options = { headers: { Authorization: 'Bearer ' + token }, signal };
      const exporting = fetch(base + '/api/match-export', options);
      const backingUp = fetch(base + '/api/recovery', { ...options, method: 'POST' });
      assert.deepEqual([await next(), await next()].sort(), ['/api/match-export', '/api/recovery']);
      child.send('resume');
      assert.equal((await until('ack')).id, first);
      const [exported, saved] = await Promise.all([exporting, backingUp]);
      assert.equal(exported.status, 200);
      assert.equal(saved.status, 201);
      const backup = join(directory, 'backups', (await saved.json()).file);
      for (const archive of [
        await exported.json(),
        JSON.parse(await readFile(backup, 'utf8')),
      ] as RecoveryArchive[]) {
        const persisted = archive.entries.find((entry) => entry.path === archive.matchFile);
        assert.ok(persisted);
        const match = JSON.parse(Buffer.from(persisted.base64, 'base64').toString());
        assert.equal(match.revision, 1);
        assert.equal(match.state.blueScore, 1);
      }
      const second = send(1, 'red');
      assert.equal(await next(), 'flushing');
      child.send('stop');
      assert.equal(await next(), 'stopping');
      const late = send(2, 'red');
      const rejected = await until('error');
      assert.equal(rejected.id, late);
      assert.match(rejected.error, /正在停止/);
      assert.equal(await next(), 'held past connection timeout');
      child.send('resume');
      assert.equal((await until('ack')).id, second);
      assert.equal((await exited)[0], 0);
      const restored = new Store(file).data;
      assert.equal(restored.revision, 2);
      assert.equal(restored.state.redScore, 1);
      assert.deepEqual(restored.ids, [first, second]);
    } finally {
      ws?.terminate();
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exited;
      await rm(directory, { recursive: true, force: true });
    }
  },
);
