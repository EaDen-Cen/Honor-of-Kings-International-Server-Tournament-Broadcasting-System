import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StrictVoting } from './strictVoting.js';
import { DiscordWebhook } from './discordWebhook.js';
import { SecureSettings } from './secureSettings.js';
import { Store } from './store.js';
import { initialState, phases, type Action } from '../src/shared/types.js';
import { heroesForPool } from '../src/shared/heroPool.js';
import { banRestriction, pickRestriction } from '../src/shared/draftRules.js';

function setup(fetcher?: typeof fetch) {
  const dir = mkdtempSync(join(tmpdir(), 'hok-strict-vote-'));
  let now = 1000000,
    calls = 0;
  const clock = () => now;
  const storage = new SecureSettings(join(dir, 'secure.json'), (v, decrypt = false) =>
    Buffer.from(v, decrypt ? 'base64' : 'utf8').toString(decrypt ? 'utf8' : 'base64'),
  );
  storage.set('discord', {
    webhookUrl: 'https://discord.com/api/webhooks/123456789012345678/TEST_ONLY_WEBHOOK_1234567890',
  });
  const request: typeof fetch = async (...args) => {
    calls++;
    return fetcher
      ? fetcher(...args)
      : new Response(JSON.stringify({ id: String(123456789012345678n + BigInt(calls)) }));
  };
  const webhook = () => new DiscordWebhook(join(dir, 'notices.json'), storage, request, clock);
  const file = join(dir, 'votes.json');
  const restore = () => new StrictVoting(file, webhook(), clock);
  const votes = restore();
  votes.configure({ autoStart: true, scope: 'all', publicOrigin: 'https://broadcast.example.com' });
  const store = new Store(join(dir, 'match.json'), clock);
  const apply = (action: Action) => store.apply(randomUUID(), store.data.revision, action);
  const base = initialState();
  apply({
    type: 'settings',
    settings: {
      ...base,
      blueTeam: { ...base.blueTeam, players: ['B1', 'B2', 'B3', 'B4', 'B5'] },
      redTeam: { ...base.redTeam, players: ['R1', 'R2', 'R3', 'R4', 'R5'] },
    },
  });
  const commit = () => {
    while (!store.data.state.draftComplete) {
      const s = store.data.state,
        phase = phases(s.draftMode, s.firstPickSide, s.banCount)[s.currentPhase];
      const hero = heroesForPool(s.heroPool).find(
        (h) =>
          !(phase.action === 'ban'
            ? banRestriction(s, phase.team, h.id)
            : pickRestriction(s, phase.team, s[`${phase.team}Picks`].length, h.id)) &&
          ![...s.bluePicks, ...s.redPicks, ...s.blueBans, ...s.redBans].includes(h.id),
      );
      assert.ok(hero);
      apply({ type: 'draft_action', ...phase, heroId: hero.id });
    }
    apply({ type: 'commit_game' });
    return store.data.state.committedGameId!;
  };
  const end = (reportId: string, winner: 'blue' | 'red' = 'blue') =>
    apply({ type: 'confirm_game_end', reportId, winner });
  return {
    dir,
    file,
    votes,
    restore,
    store,
    apply,
    commit,
    end,
    setNow: (n: number) => (now = n),
    calls: () => calls,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('BP commit does not trigger voting; authoritative game-end confirmation does, without changing score or preset', async () => {
  const h = setup();
  try {
    const id = h.commit();
    await h.votes.tick(h.store.data.state);
    assert.equal(h.calls(), 0);
    assert.throws(() => h.votes.start(h.store.data.state, id), /ended/);
    const before = structuredClone(h.store.data.state);
    h.end(id);
    await h.votes.tick(h.store.data.state);
    const vote = h.votes.snapshot(h.store.data.state).votes[0];
    assert.equal(vote.candidates.length, 10);
    assert.equal(vote.deadline - vote.startedAt, 180000);
    assert.equal(vote.opening.status, 'sent');
    assert.ok(vote.opening.messageId);
    assert.deepEqual(h.store.data.state.blueTeam, before.blueTeam);
    assert.equal(h.store.data.state.blueScore, before.blueScore);
    assert.equal(h.store.data.state.currentPhase, before.currentPhase);
    h.end(id);
    await h.votes.tick(h.store.data.state);
    assert.equal(h.calls(), 1);
    assert.throws(() => h.end(id, 'red'), /already confirmed/);
  } finally {
    h.cleanup();
  }
});

test('accepts at 179999ms, rejects at 180000ms without timer; browser replay is idempotent and survives restart', async () => {
  const h = setup();
  try {
    const game = h.commit();
    h.end(game);
    await h.votes.tick(h.store.data.state);
    const v = h.votes.snapshot(h.store.data.state).votes[0],
      voter = randomUUID();
    h.votes.cast(v.id, voter, v.candidates[0].rowId);
    h.votes.cast(v.id, voter, v.candidates[0].rowId);
    assert.throws(() => h.votes.cast(v.id, voter, v.candidates[1].rowId), /Already voted/);
    let restored = h.restore();
    restored.cast(v.id, voter, v.candidates[0].rowId);
    h.setNow(v.deadline - 1);
    restored.cast(v.id, randomUUID(), v.candidates[1].rowId);
    h.setNow(v.deadline);
    assert.throws(() => restored.cast(v.id, randomUUID(), v.candidates[1].rowId), /closed/);
    restored = h.restore();
    await restored.tick(h.store.data.state);
    const closed = restored.snapshot(h.store.data.state).votes[0];
    assert.deepEqual(closed.counts.slice(0, 2), [1, 1]);
    assert.equal(closed.status, 'closed');
    assert.equal(closed.closing.status, 'sent');
    assert.equal(h.calls(), 2);
    await h.restore().tick(h.store.data.state);
    assert.equal(h.calls(), 2);
    assert.ok(!JSON.stringify(restored.publicVote(v.id)).includes('ballots'));
    assert.ok(!readFileSync(h.file, 'utf8').includes(voter));
    assert.equal(h.store.data.state.postGameReports[0].selectedMvpRowId, null);
  } finally {
    h.cleanup();
  }
});

for (const format of ['BO1', 'BO3', 'BO5'] as const)
  test(`${format}: independent games, frozen roles and explicit historical MVP preserve current report`, async () => {
    const h = setup();
    try {
      h.apply({ type: 'settings', settings: { ...h.store.data.state, seriesFormat: format } });
      const id = h.commit();
      h.end(id);
      await h.votes.tick(h.store.data.state);
      const v = h.votes.snapshot(h.store.data.state).votes[0];
      h.votes.cast(v.id, randomUUID(), v.candidates[0].rowId);
      h.apply({
        type: 'set_game_roles',
        side: 'blue',
        roles: ['farm', 'jungle', 'mid', 'clash', 'roam'],
      });
      assert.equal(h.votes.snapshot(h.store.data.state).votes[0].rosterChanged, true);
      assert.deepEqual(h.votes.publicVote(v.id).candidates, v.candidates);
      h.votes.finish(v.id);
      if (format !== 'BO1') {
        h.apply({ type: 'score', team: 'blue', delta: 1 });
        h.apply({ type: 'next_game' });
        const second = h.commit();
        h.end(second, 'red');
        await h.votes.tick(h.store.data.state);
        assert.equal(h.votes.snapshot(h.store.data.state).votes.length, 2);
        const active = h.store.data.state.activePostGameReportId;
        h.apply({
          type: 'select_mvp',
          reportId: id,
          rowId: v.candidates[0].rowId,
          expectedPlayerId: v.candidates[0].name,
          activate: false,
        });
        assert.equal(h.store.data.state.activePostGameReportId, active);
        assert.equal(h.store.data.state.postGameReports[1].selectedMvpRowId, null);
      } else
        h.apply({
          type: 'select_mvp',
          reportId: id,
          rowId: v.candidates[0].rowId,
          expectedPlayerId: v.candidates[0].name,
          activate: false,
        });
      assert.equal(
        h.store.snapshot('overlay').state.postGameReports[0].selectedMvpRowId,
        v.candidates[0].rowId,
      );
      const restoredStore = new Store(join(h.dir, 'match.json'));
      assert.equal(restoredStore.data.state.postGameReports[0].endedAt, 1000000);
      assert.equal(
        restoredStore.data.state.postGameReports[0].selectedMvpPlayerId,
        v.candidates[0].name,
      );
      assert.throws(
        () =>
          h.apply({
            type: 'select_mvp',
            reportId: id,
            rowId: v.candidates[0].rowId,
            expectedPlayerId: 'different-person',
            activate: false,
          }),
        /identity changed/,
      );
    } finally {
      h.cleanup();
    }
  });

test('winning five, early finish, cancellation and Undo never reopen or replace the vote', async () => {
  const h = setup();
  try {
    h.votes.configure({
      autoStart: true,
      scope: 'winner',
      publicOrigin: 'https://broadcast.example.com',
    });
    const id = h.commit();
    h.end(id, 'red');
    await h.votes.tick(h.store.data.state);
    const v = h.votes.snapshot(h.store.data.state).votes[0];
    assert.equal(v.candidates.length, 5);
    assert.ok(v.candidates.every((c) => c.side === 'red'));
    h.votes.finish(v.id);
    await h.votes.tick(h.store.data.state);
    h.votes.finish(v.id, true);
    await h.votes.tick(h.store.data.state);
    assert.throws(() => h.votes.cast(v.id, randomUUID(), v.candidates[0].rowId), /closed/);
    h.apply({ type: 'undo' });
    h.end(id, 'red');
    assert.equal(h.votes.start(h.store.data.state, id), v.id);
    const restored = h.restore();
    await restored.tick(h.store.data.state);
    assert.equal(restored.snapshot(h.store.data.state).votes[0].status, 'cancelled');
    assert.equal(h.calls(), 3);
  } finally {
    h.cleanup();
  }
});

test('Discord uncertain delivery requires explicit retry, preserves original deadline, never duplicates ballot', async () => {
  let fail = true;
  const h = setup(async () => {
    if (fail) throw Error('timeout after send');
    return new Response(JSON.stringify({ id: '123456789012345679' }));
  });
  try {
    const id = h.commit();
    h.end(id);
    await h.votes.tick(h.store.data.state);
    const v = h.votes.snapshot(h.store.data.state).votes[0];
    assert.equal(v.opening.status, 'uncertain');
    const restored = h.restore();
    await restored.tick(h.store.data.state);
    assert.equal(h.calls(), 1);
    await assert.rejects(restored.retry(v.id, false), /confirm/);
    fail = false;
    h.setNow(v.startedAt + 10000);
    await restored.retry(v.id, true);
    const retried = restored.snapshot(h.store.data.state).votes[0];
    assert.equal(retried.opening.status, 'sent');
    assert.equal(retried.deadline, v.deadline);
    assert.equal(restored.snapshot(h.store.data.state).votes.length, 1);
  } finally {
    h.cleanup();
  }
});

test('429 cooldown is retained, then safe retry sends the same announcement', async () => {
  let fail = true;
  const h = setup(async () =>
    fail
      ? new Response(JSON.stringify({ retry_after: 5 }), { status: 429 })
      : new Response(JSON.stringify({ id: '123456789012345679' })),
  );
  try {
    const id = h.commit();
    h.end(id);
    await h.votes.tick(h.store.data.state);
    const v = h.votes.snapshot(h.store.data.state).votes[0];
    assert.equal(v.opening.status, 'failed');
    fail = false;
    h.setNow(v.startedAt + 5001);
    const restored = h.restore();
    await restored.retry(v.id, false);
    assert.equal(restored.snapshot(h.store.data.state).votes[0].opening.status, 'sent');
    assert.equal(h.calls(), 2);
  } finally {
    h.cleanup();
  }
});

test('restart after process interruption reconciles sent message without repost; unknown delivery stays uncertain', async () => {
  const h = setup();
  try {
    const id = h.commit();
    h.end(id);
    await h.votes.tick(h.store.data.state);
    const raw = JSON.parse(readFileSync(h.file, 'utf8'));
    raw.votes[0].opening.status = 'sending';
    writeFileSync(h.file, JSON.stringify(raw));
    const restored = h.restore();
    await restored.tick(h.store.data.state);
    assert.equal(h.calls(), 1);
    assert.equal(restored.snapshot(h.store.data.state).votes[0].opening.status, 'sent');
    raw.votes[0].opening.id = randomUUID();
    writeFileSync(h.file, JSON.stringify(raw));
    const uncertain = h.restore();
    await uncertain.tick(h.store.data.state);
    assert.equal(h.calls(), 1);
    assert.equal(uncertain.snapshot(h.store.data.state).votes[0].opening.status, 'uncertain');
    raw.votes[0].counts[0] = 10;
    writeFileSync(h.file, JSON.stringify(raw));
    assert.throws(h.restore, /Invalid vote archive/);
  } finally {
    h.cleanup();
  }
});

test('simultaneous publication and game-end observation preserves next game even when operator advances immediately', async () => {
  let release: (() => void) | undefined;
  const h = setup(async () => {
    await new Promise<void>((r) => (release = r));
    return new Response(JSON.stringify({ id: '123456789012345679' }));
  });
  try {
    const first = h.commit();
    h.end(first);
    const pending = h.votes.tick(h.store.data.state);
    h.apply({ type: 'score', team: 'blue', delta: 1 });
    h.apply({ type: 'next_game' });
    const second = h.commit();
    h.end(second, 'red');
    h.votes.observe(h.store.data.state);
    assert.equal(h.votes.snapshot(h.store.data.state).votes.length, 2);
    // Cancel both to keep this test focused on in-flight observation, not additional sends.
    h.votes.finish(h.votes.snapshot(h.store.data.state).votes[1].id, true);
    release!();
    await new Promise((r) => setImmediate(r));
    release!();
    await pending;
    assert.equal(h.votes.snapshot(h.store.data.state).votes.length, 2);
  } finally {
    h.cleanup();
  }
});

test('failed atomic persistence rejects the ballot and fails closed until restart without losing accepted votes', async () => {
  const h = setup();
  try {
    const game = h.commit();
    h.end(game);
    await h.votes.tick(h.store.data.state);
    const v = h.votes.snapshot(h.store.data.state).votes[0];
    h.votes.cast(v.id, randomUUID(), v.candidates[0].rowId);
    const before = readFileSync(h.file, 'utf8');
    mkdirSync(h.file + '.tmp');
    assert.throws(() => h.votes.cast(v.id, randomUUID(), v.candidates[1].rowId));
    assert.equal(readFileSync(h.file, 'utf8'), before);
    assert.throws(
      () => h.votes.cast(v.id, randomUUID(), v.candidates[1].rowId),
      /persistence failed/,
    );
    assert.deepEqual(h.restore().snapshot(h.store.data.state).votes[0].counts.slice(0, 2), [1, 0]);
  } finally {
    h.cleanup();
  }
});

test('manual start respects saved scope and rejects invalid public destinations and unconfirmed games', async () => {
  const h = setup();
  try {
    for (const publicOrigin of [
      'http://example.com',
      'https://localhost',
      'https://u:p@example.com',
      'https://example.com/path',
    ])
      assert.throws(() => h.votes.configure({ autoStart: true, scope: 'all', publicOrigin }));
    h.votes.configure({
      autoStart: false,
      scope: 'all',
      publicOrigin: 'https://broadcast.example.com',
    });
    const game = h.commit();
    h.end(game);
    await h.votes.tick(h.store.data.state);
    assert.equal(h.votes.snapshot(h.store.data.state).votes.length, 0);
    const id = h.votes.start(h.store.data.state, game);
    assert.equal(h.votes.start(h.store.data.state, game), id);
    await h.votes.tick(h.store.data.state);
    assert.equal(h.calls(), 1);
    h.votes.configure({
      autoStart: false,
      scope: 'winner',
      publicOrigin: 'https://new.example.com',
    });
    assert.equal(h.votes.publicVote(id).candidates.length, 10);
    assert.match(
      h.votes.snapshot(h.store.data.state).votes[0].url,
      /^https:\/\/broadcast.example.com/,
    );
  } finally {
    h.cleanup();
  }
});

test('native Poll payload, confirmed publication clock, restart and soft-deadline notice', async () => {
  const payloads: Array<{
    poll?: {
      answers: Array<{ poll_media: { text: string } }>;
      duration: number;
      allow_multiselect: boolean;
    };
    content: string;
  }> = [];
  const h = setup(async (_url, init) => {
    payloads.push(JSON.parse(String(init?.body)));
    assert.equal((init?.headers as Record<string, string>).Authorization, undefined);
    if (payloads.length === 1) h.setNow(1012000);
    return new Response(JSON.stringify({ id: '123456789012345679' }));
  });
  try {
    h.votes.configure({ autoStart: true, scope: 'all', publicOrigin: '', mode: 'native' });
    const game = h.commit();
    await h.votes.tick(h.store.data.state);
    assert.equal(payloads.length, 0);
    h.end(game);
    const id = h.votes.start(h.store.data.state, game);
    assert.equal(h.votes.snapshot(h.store.data.state).votes[0].status, 'pending');
    assert.equal(h.votes.snapshot(h.store.data.state).votes[0].deadline, 0);
    await h.votes.tick(h.store.data.state);
    const v = h.votes.snapshot(h.store.data.state).votes[0];
    assert.equal(v.startedAt, 1012000);
    assert.equal(v.deadline, 1192000);
    assert.equal(v.opening.messageId, '123456789012345679');
    const poll = payloads[0].poll!;
    assert.equal(poll.duration, 1);
    assert.equal(poll.allow_multiselect, false);
    assert.equal(poll.answers.length, 10);
    assert.ok(poll.answers.every((a) => a.poll_media.text.length <= 55));
    assert.match(payloads[0].content, /soft deadline/);
    assert.throws(() => h.votes.cast(id, randomUUID(), v.candidates[0].rowId), /closed/);
    assert.throws(() => h.votes.publicVote(id), /no web ballot/);
    const restored = h.restore();
    h.setNow(1191999);
    assert.equal(restored.snapshot(h.store.data.state).votes[0].status, 'active');
    h.setNow(1192000);
    await restored.tick(h.store.data.state);
    assert.equal(payloads.length, 2);
    assert.equal(payloads[1].poll, undefined);
    assert.match(payloads[1].content, /Discord 原生投票可能仍允许继续投票/);
    await h.restore().tick(h.store.data.state);
    assert.equal(payloads.length, 2);
    assert.equal(h.store.data.state.postGameReports[0].selectedMvpRowId, null);
    assert.ok(!JSON.stringify(restored.snapshot(h.store.data.state)).includes('TEST_ONLY_WEBHOOK'));
  } finally {
    h.cleanup();
  }
});

test('unknown native delivery recovers matching Discord message and original timestamp without reposting', async () => {
  let poll: unknown;
  let sends = 0;
  const h = setup(async (_url, init) => {
    if (!init?.method)
      return new Response(
        JSON.stringify({
          id: '123456789012345679',
          webhook_id: '123456789012345678',
          timestamp: new Date(1001000).toISOString(),
          poll,
        }),
      );
    const body = JSON.parse(String(init.body));
    if (body.poll) {
      poll = body.poll;
      sends++;
      throw Error('Lost ack');
    }
    return new Response(JSON.stringify({ id: '123456789012345680' }));
  });
  try {
    h.votes.configure({ autoStart: true, scope: 'winner', publicOrigin: '', mode: 'native' });
    const game = h.commit();
    h.end(game, 'red');
    await h.votes.tick(h.store.data.state);
    const v = h.votes.snapshot(h.store.data.state).votes[0];
    assert.equal(v.candidates.length, 5);
    assert.equal(v.opening.status, 'uncertain');
    const restored = h.restore();
    await restored.tick(h.store.data.state);
    assert.equal(sends, 1);
    await assert.rejects(restored.retry(v.id, true), /original Discord message/);
    h.setNow(1182000);
    await restored.recover(v.id, '123456789012345679');
    const recovered = restored.snapshot(h.store.data.state).votes[0];
    assert.equal(recovered.startedAt, 1001000);
    assert.equal(recovered.deadline, 1181000);
    assert.equal(recovered.status, 'closed');
    await restored.tick(h.store.data.state);
    assert.equal(sends, 1);
    assert.equal(restored.snapshot(h.store.data.state).votes[0].closing.status, 'sent');
  } finally {
    h.cleanup();
  }
});
for (const format of ['BO1', 'BO3', 'BO5'] as const)
  test(`${format}: native cancellation, Undo and mode changes keep one ballot per game`, async () => {
    const h = setup();
    try {
      h.apply({ type: 'settings', settings: { ...h.store.data.state, seriesFormat: format } });
      h.votes.configure({ autoStart: true, scope: 'all', publicOrigin: '', mode: 'native' });
      const game = h.commit();
      h.end(game);
      await h.votes.tick(h.store.data.state);
      const v = h.votes.snapshot(h.store.data.state).votes[0];
      h.votes.finish(v.id, true);
      await h.votes.tick(h.store.data.state);
      h.apply({ type: 'undo' });
      h.end(game);
      await h.votes.tick(h.store.data.state);
      assert.equal(h.calls(), 2);
      h.votes.configure({
        autoStart: true,
        scope: 'all',
        publicOrigin: 'https://broadcast.example.com',
        mode: 'web',
      });
      assert.equal(h.votes.start(h.store.data.state, game), v.id);
      if (format !== 'BO1') {
        h.apply({ type: 'score', team: 'blue', delta: 1 });
        h.apply({ type: 'next_game' });
        const next = h.commit();
        h.end(next);
        await h.votes.tick(h.store.data.state);
        const votes = h.restore().snapshot(h.store.data.state).votes;
        assert.equal(votes.length, 2);
        assert.equal(votes[0].mode, 'native');
        assert.equal(votes[1].mode, 'web');
        assert.equal(votes[0].status, 'cancelled');
        h.votes.cast(votes[1].id, randomUUID(), votes[1].candidates[0].rowId);
        assert.equal(
          h.votes.snapshot(h.store.data.state).votes[0].counts.reduce((a, b) => a + b, 0),
          0,
        );
      }
    } finally {
      h.cleanup();
    }
  });
test('native Retry-After header delays retry and the clock starts only after success', async () => {
  let limited = true;
  const h = setup(async () =>
    limited
      ? new Response('{}', { status: 429, headers: { 'Retry-After': '10' } })
      : new Response(JSON.stringify({ id: '123456789012345679' })),
  );
  try {
    h.votes.configure({ autoStart: true, scope: 'all', publicOrigin: '', mode: 'native' });
    const game = h.commit();
    h.end(game);
    await h.votes.tick(h.store.data.state);
    const v = h.votes.snapshot(h.store.data.state).votes[0];
    assert.equal(v.opening.status, 'failed');
    assert.equal(v.startedAt, 0);
    await h.votes.retry(v.id, false);
    assert.equal(h.calls(), 1);
    limited = false;
    h.setNow(1010001);
    await h.votes.retry(v.id, false);
    assert.equal(h.votes.snapshot(h.store.data.state).votes[0].startedAt, 1010001);
    assert.equal(h.calls(), 2);
  } finally {
    h.cleanup();
  }
});
