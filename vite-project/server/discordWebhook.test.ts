import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DiscordWebhook } from './discordWebhook.js';
import { SecureSettings } from './secureSettings.js';
import { initialState } from '../src/shared/types.js';

const secret = 'TEST_ONLY_WEBHOOK_TOKEN_123456';
const url = `https://discord.com/api/webhooks/123456789012345678/${secret}`;
const crypt = (v: string, decrypt = false) =>
  Buffer.from(v, decrypt ? 'base64' : 'utf8').toString(decrypt ? 'utf8' : 'base64');
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'hok-webhook-'));
  const storage = new SecureSettings(join(dir, 'settings.json'), crypt);
  storage.set('discord', { webhookUrl: url });
  return { dir, storage, file: join(dir, 'notices.json'), state: initialState() };
}
test('Webhook-only preview/send needs no Bot, confirms response, disables mentions and deduplicates across restart', async () => {
  const h = setup();
  let calls = 0;
  const request: typeof fetch = async (target, init) => {
    calls++;
    assert.equal(target, url + '?wait=true');
    assert.equal(init?.redirect, 'error');
    assert.deepEqual(JSON.parse(String(init?.body)).allowed_mentions, { parse: [] });
    assert.equal((init?.headers as Record<string, string>).Authorization, undefined);
    return new Response(JSON.stringify({ id: '123456789012345679' }), { status: 200 });
  };
  try {
    let service = new DiscordWebhook(h.file, h.storage, request);
    const preview = service.preview(h.state, { kind: 'start' });
    assert.equal(calls, 0);
    const input = { kind: 'start', id: randomUUID(), previewHash: preview.hash };
    assert.equal((await service.send(h.state, input)).notices[0].status, 'sent');
    service = new DiscordWebhook(h.file, h.storage, request);
    await service.send(h.state, input);
    assert.equal(calls, 1);
    assert.ok(!readFileSync(h.file, 'utf8').includes(secret));
    assert.ok(!JSON.stringify(service.snapshot()).includes(secret));
    h.state.blueScore++;
    await assert.rejects(service.send(h.state, input), /preview changed/);
    assert.equal(calls, 1);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});
test('unknown delivery never auto-resends; explicit retry and 429 cooldown survive restart', async () => {
  const h = setup();
  let now = 100000,
    calls = 0,
    response = 'timeout';
  const request: typeof fetch = async () => {
    calls++;
    if (response === 'timeout') throw Error(url);
    if (response === '429')
      return new Response(JSON.stringify({ retry_after: 2 }), { status: 429 });
    return new Response(JSON.stringify({ id: '123456789012345679' }), { status: 200 });
  };
  try {
    let service = new DiscordWebhook(h.file, h.storage, request, () => now);
    const input = {
      kind: 'start',
      id: randomUUID(),
      previewHash: service.preview(h.state, { kind: 'start' }).hash,
    };
    assert.equal((await service.send(h.state, input)).notices[0].status, 'uncertain');
    assert.ok(!readFileSync(h.file, 'utf8').includes(secret));
    service = new DiscordWebhook(h.file, h.storage, request, () => now);
    await assert.rejects(service.send(h.state, input), /uncertain/);
    assert.equal(calls, 1);
    response = '429';
    assert.equal(
      (await service.send(h.state, { ...input, confirmUncertain: true })).notices[0].status,
      'failed',
    );
    service = new DiscordWebhook(h.file, h.storage, request, () => now);
    await assert.rejects(service.send(h.state, input), /rate limit/);
    now += 2001;
    response = 'ok';
    assert.equal((await service.send(h.state, input)).notices[0].status, 'sent');
    assert.equal(calls, 3);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});
test('unconfirmed MVP, unfinished series and unsafe poll URLs cannot be announced; interrupted send stays uncertain', async () => {
  const h = setup();
  try {
    let service = new DiscordWebhook(h.file, h.storage, async () => {
      throw Error('No network expected');
    });
    for (const kind of ['mvp', 'game-end', 'series-end'])
      assert.throws(() => service.preview(h.state, { kind }));
    h.state.activePostGameReportId = 'report-1';
    h.state.postGameReports = [{
      id: 'report-1', gameNumber: 1, seriesFormat: 'BO3', stage: 'Test', selectedMvpRowId: 'blue-0', selectedMvpPlayerId: 'Player A',
      players: [{ rowId: 'blue-0', playerId: 'Player A', teamName: 'Team A', side: 'blue', slot: 0, rosterIndex: 0, portrait: '', role: 'clash', heroId: 1, fields: {} }],
    }];
    assert.match(service.preview(h.state, { kind: 'mvp' }).content, /Player A.*Team A/);
    h.state.activePostGameReportId = null;
    for (const pollUrl of ['http://example.com/poll', 'https://user:password@example.com', url])
      assert.throws(() => service.preview(h.state, { kind: 'poll-link', pollUrl }));
    assert.match(
      service.preview(h.state, { kind: 'poll-link', pollUrl: 'https://example.com/poll' }).content,
      /External tally/,
    );
    const input = {
      kind: 'start',
      id: randomUUID(),
      previewHash: service.preview(h.state, { kind: 'start' }).hash,
    };
    await service.send(h.state, input);
    const raw = JSON.parse(readFileSync(h.file, 'utf8'));
    raw.notices[0].status = 'sending';
    writeFileSync(h.file, JSON.stringify(raw));
    service = new DiscordWebhook(h.file, h.storage);
    assert.equal(service.snapshot().notices[0].status, 'uncertain');
    await assert.rejects(service.send(h.state, input), /uncertain/);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});
