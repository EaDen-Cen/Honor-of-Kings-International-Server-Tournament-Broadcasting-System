import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as pause } from 'node:timers/promises';
test(
  'real backend process restart restores encrypted AI, Discord, OBS and operator preferences',
  { timeout: 45000 },
  async (t) => {
    if (process.platform !== 'win32' && !process.env.HOK_CONFIG_KEY)
      return t.skip('OS encryption unavailable');
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const address = probe.address();
    if (!address || typeof address === 'string') throw Error('Missing port');
    const port = address.port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const directory = mkdtempSync(join(tmpdir(), 'hok-restart-')),
      base = `http://127.0.0.1:${port}`;
    let child: ChildProcess | undefined;
    let starts=0;
    const stop = async () => {
      const current = child;
      if (!current || current.exitCode !== null || current.signalCode !== null) return;
      const closed = new Promise<void>((resolve) => current.once('exit', () => resolve()));
      current.kill();
      await closed;
      child = undefined;
    };
    t.after(stop);
    async function start() {
      child = spawn(process.execPath, ['--import', 'tsx', 'server/server.ts'], {
        env: {
          ...process.env,
          HOST: '127.0.0.1',
          PORT: String(port),
          NODE_ENV: 'development',
          DATA_FILE: join(directory, 'match.json'),
          CONTROL_TOKEN: 'restart-control-token',
          CASTER_TOKEN: 'restart-caster-token',
          OVERLAY_TOKEN: 'restart-overlay-token',
          ACCESS_PASSWORD: '',
          OBS_WS_URL: starts===0?'ws://127.0.0.1:1':'',
          OBS_WS_PASSWORD: starts===0?'fake-obs-restart-secret':'',
        },
        stdio: 'ignore',
      });
      starts++;
      for (let n = 0; n < 100; n++) {
        if (child.exitCode !== null) throw Error('Isolated backend exited');
        try {
          if ((await fetch(base + '/api/health', { signal: AbortSignal.timeout(300) })).ok) return;
        } catch {
          /* Wait for this child to listen. */
        }
        await pause(100);
      }
      throw Error('Isolated backend startup timed out');
    }
    async function api(path: string, method = 'GET', body?: unknown) {
      const r = await fetch(base + '/api/v1/' + path, {
        method,
        headers: {
          Authorization: 'Bearer restart-control-token',
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      assert.equal(r.status, 200, path);
      return r.json();
    }
    await start();
    await api('ai-recognition/profiles', 'POST', {
      name: 'Saved',
      enabled: false,
      vendor: 'openai',
      endpoint: '',
      model: 'restart-vision',
      apiKey: 'fake-ai-restart-secret',
    });
    await api('discord/config', 'PUT', {
      botToken: 'fake-bot-restart-secret',
      guildId: '123456789012345678',
      channelId: '123456789012345679',
    });
    await api('obs/config', 'PUT', {
      address: 'ws://127.0.0.1:1',
    });
    await api('operator-preferences', 'PUT', { 'hok-obs-scene-cues-v1': '{"game":"Game"}' });
    const disk = readFileSync(join(directory, 'secure-settings.json'), 'utf8');
    assert.ok(
      !disk.includes('fake-ai-restart-secret') &&
        !disk.includes('fake-bot-restart-secret') &&
        !disk.includes('fake-obs-restart-secret'),
    );
    await stop();
    await start();
    const ai = await api('ai-recognition/config'),
      discord = await api('discord/config'),
      obs = await api('obs/config'),
      preferences = await api('operator-preferences');
    assert.equal(ai.model, 'restart-vision');
    assert.equal(ai.configured, true);
    assert.equal(discord.configured, true);
    assert.equal(discord.channelId, '123456789012345679');
    assert.equal(obs.configured, true);
    assert.equal(obs.address, 'ws://127.0.0.1:1/');
    assert.equal(preferences['hok-obs-scene-cues-v1'], '{"game":"Game"}');
  },
);
