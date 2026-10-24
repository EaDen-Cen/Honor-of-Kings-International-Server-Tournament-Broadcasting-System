import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiscordVoting, type DiscordRequest } from './discordVoting.js';
import { SecureSettings } from './secureSettings.js';
import { initialState } from '../src/shared/types.js';
const crypt = (v: string, d = false) =>
  Buffer.from(v, d ? 'base64' : 'utf8').toString(d ? 'utf8' : 'base64');
function harness() {
  const directory = mkdtempSync(join(tmpdir(), 'hok-vote-'));
  const storage = new SecureSettings(join(directory, 'settings.json'), crypt);
  let now = 1000000,
    finalized = false,
    counts: unknown = undefined,
    creationFailure = false;
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const request: DiscordRequest = async (path, method, body) => {
    calls.push({ path, method, body });
    if (path === '/users/@me') return { id: '123456789012345678', username: 'TestBot' };
    if (path === '/channels/123456789012345679')
      return { id: '123456789012345679', guild_id: '123456789012345680' };
    if (method === 'POST' && path.endsWith('/messages')) {
      if ((body as { poll?: unknown })?.poll && creationFailure) throw Error('ambiguous timeout');
      return { id: '123456789012345681' };
    }
    if (path.endsWith('/expire')) return {};
    return {
      author: { id: '123456789012345678' },
      poll: {
        answers: Array.from({ length: 10 }, (_, i) => ({
          answer_id: i + 10,
          poll_media: { text: `${i + 1}. P${i} · ${i < 5 ? 'Blue' : 'Red'}` },
        })),
        ...(counts === undefined
          ? {}
          : { results: { is_finalized: finalized, answer_counts: counts } }),
      },
    };
  };
  const state = initialState();
  state.committedGameId = 'game-1';
  state.blueTeam.name = 'Blue';
  state.redTeam.name = 'Red';
  state.blueTeam.players = ['P0', 'P1', 'P2', 'P3', 'P4'];
  state.redTeam.players = ['P5', 'P6', 'P7', 'P8', 'P9'];
  const file = join(directory, 'votes.json'),
    create = () => new DiscordVoting(file, storage, request, () => now),
    voting = create();
  voting.saveConfig({
    botToken: 'fake-bot-secret',
    channelId: '123456789012345679',
    guildId: '123456789012345680',
  });
  return {
    voting,
    state,
    calls,
    create,
    file,
    clock: (n: number) => {
      now += n;
    },
    results: (value: unknown, final = false) => {
      counts = value;
      finalized = final;
    },
    failCreate: () => {
      creationFailure = true;
    },
  };
}
test('10-person single-select poll survives restart, expires after 3 minutes and waits for finalized counts; ties never pick randomly', async () => {
  const h = harness();
  const vote = await h.voting.start(h.state);
  const sent = h.calls.find((c) => (c.body as { poll?: unknown })?.poll)?.body as {
    poll: { allow_multiselect: boolean; duration: number; answers: unknown[] };
  };
  assert.equal(sent.poll.answers.length, 10);
  assert.equal(sent.poll.allow_multiselect, false);
  assert.equal(sent.poll.duration, 1);
  await h.voting.tick();
  assert.equal(h.voting.snapshot().votes[0].total, null);
  await assert.rejects(h.voting.start(h.state), /已有投票/);
  const restored = h.create();
  h.clock(180001);
  await restored.tick();
  assert.equal(restored.snapshot().votes[0].status, 'pending');
  assert.equal(h.calls.filter((c) => (c.body as { poll?: unknown })?.poll).length, 1);
  h.results(
    [
      { id: 10, count: 8 },
      { id: 11, count: 8 },
      { id: 12, count: 1 },
    ],
    true,
  );
  await restored.tick();
  const result = restored.snapshot().votes[0];
  assert.equal(result.status, 'finalized');
  assert.equal(result.total, 17);
  assert.equal(result.winners.length, 2);
  assert.equal(result.messageId, vote.messageId);
  assert.equal(JSON.stringify(restored.publicConfig()).includes('fake-bot-secret'), false);
  assert.equal(readFileSync(h.file, 'utf8').includes('fake-bot-secret'), false);
});
test('live vote privacy, cancellation and zero-vote finalization are explicit', async () => {
  const h = harness();
  h.voting.saveConfig({ hideLiveVotes: true });
  const vote = await h.voting.start(h.state);
  h.results([{ id: 10, count: 3 }]);
  await h.voting.tick();
  assert.equal(h.voting.snapshot().votes[0].total, 3);
  assert.equal(h.voting.snapshot(true).votes[0].total, null);
  h.results([], true);
  await h.voting.finish(vote.id, true);
  assert.equal(h.voting.snapshot().votes[0].status, 'cancelled');
  assert.deepEqual(h.voting.snapshot().votes[0].winners, []);
  const other = harness();
  await other.voting.start(other.state);
  other.results([], true);
  await other.voting.tick();
  assert.equal(other.voting.snapshot().votes[0].status, 'finalized');
  assert.equal(other.voting.snapshot().votes[0].total, 0);
});
test('uncertain create persists and restart never resends; recovery requires same bot and exact candidates', async () => {
  const h = harness();
  h.failCreate();
  await assert.rejects(h.voting.start(h.state), /ambiguous/);
  const restored = h.create();
  await restored.tick();
  assert.equal(h.calls.filter((c) => (c.body as { poll?: unknown })?.poll).length, 1);
  assert.equal(restored.snapshot().votes[0].status, 'creation-uncertain');
  await restored.recover(restored.snapshot().votes[0].id, '123456789012345681');
  assert.equal(restored.snapshot().votes[0].status, 'active');
});
test('HTTP 429 honors retry_after without extra requests and recovers after cooldown', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'hok-rate-'));
  const storage = new SecureSettings(join(directory, 'settings.json'), crypt);
  let clock = 0,
    calls = 0;
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (input) => {
    calls++;
    if (calls === 1) return new Response(JSON.stringify({ retry_after: 2 }), { status: 429 });
    return new Response(
      JSON.stringify(
        String(input).endsWith('/users/@me')
          ? { username: 'TestBot' }
          : { guild_id: '123456789012345680' },
      ),
      { status: 200 },
    );
  };
  const voting = new DiscordVoting(join(directory, 'votes.json'), storage, undefined, () => clock);
  voting.saveConfig({
    botToken: 'fake-rate-secret',
    guildId: '123456789012345680',
    channelId: '123456789012345679',
  });
  await assert.rejects(voting.testConnection(), /限流/);
  await assert.rejects(voting.testConnection(), /冷却/);
  assert.equal(calls, 1);
  clock = 2001;
  assert.equal((await voting.testConnection()).ok, true);
  assert.equal(calls, 3);
});
