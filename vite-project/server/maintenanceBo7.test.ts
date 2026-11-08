import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, mkdir, writeFile, utimes, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.js';
import { StorageMaintenance, registerTestArtifact } from './storageMaintenance.js';
import { recognizeHudNumbers } from './hudOcrCache.js';
import { phases, type Action } from '../src/shared/types.js';
import { legacyGameRules } from '../src/shared/gameRules.js';
import { draftHeroUsed, draftRestriction } from '../src/shared/draftRules.js';
import { heroesForPool } from '../src/shared/heroPool.js';
import { liveGameContext } from '../src/shared/liveGame.js';
import { liveCaptureKeys } from '../src/shared/gameCapture.js';

test('BO7 normal BP → unrecorded zero-ban blind → normal preserves reports and isolates OCR and cleanup', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'hok-maintenance-bo7-'));
  let now = Date.now();
  const store = new Store(undefined, () => now);
  const act = (a: Action) => store.apply(randomUUID(), store.data.revision, a);
  const service = new StorageMaintenance(
    root,
    join(root, 'data/storage-maintenance.json'),
    async () => JSON.stringify(store.data),
    async () => undefined,
    () => now,
  );
  let calls = 0;
  const provider = {
    recognizeNumbers: async () => {
      calls++;
      return { texts: ['1'], confidences: [0.99], elapsedMs: 1 };
    },
  };
  try {
    act({
      type: 'settings',
      settings: {
        ...store.data.state,
        blueTeam: { ...store.data.state.blueTeam, players: ['A', 'B', 'C', 'D', 'E'] },
        redTeam: { ...store.data.state.redTeam, players: ['F', 'G', 'H', 'I', 'J'] },
      },
    });
    act({
      type: 'series_rules',
      seriesFormat: 'BO7',
      rules: {
        defaultGameRules: legacyGameRules(store.data.state),
        games: {
          '2': {
            mode: 'blind',
            banCount: 0,
            recordHeroes: false,
            contributeToFutureHistory: false,
          },
        },
      },
    });
    const evidence: string[] = [],
      contexts: string[] = [];
    for (let game = 1; game <= 3; game++) {
      if (game === 2) {
        act({ type: 'start_blind_game' });
        assert.throws(() => act({ type: 'draft_action', team: 'blue', action: 'pick', heroId: 1 }));
        assert.deepEqual(store.data.state.bluePicks, []);
        assert.equal(store.data.state.banCount, 0);
      } else {
        while (!store.data.state.draftComplete) {
          const s = store.data.state,
            p = phases(s.draftMode, s.firstPickSide, s.banCount)[s.currentPhase];
          if (p.action === 'ban') act({ type: 'skip_ban', team: p.team });
          else {
            const h = heroesForPool(s.heroPool).find(
              (h) => !draftHeroUsed(s, h.id) && !draftRestriction(s, p.team, 'pick', h.id),
            )!;
            assert.ok(h);
            act({ type: 'draft_action', ...p, heroId: h.id });
          }
        }
        act({ type: 'commit_game' });
      }
      const report = store.data.state.postGameReports.find(
        (r) => r.id === store.data.state.committedGameId,
      )!;
      const evidenceId = randomUUID();
      const name = `artifacts/${evidenceId}.png`,
        path = join(root, name),
        at = now - 30 * 86400000;
      await mkdir(join(root, 'artifacts'), { recursive: true });
      await writeFile(path, 'proof');
      await utimes(path, at / 1000, at / 1000);
      await registerTestArtifact(root, path, at);
      evidence.push(path);
      act({
        type: 'post_game_fields',
        reportId: report.id,
        updates: [
          {
            rowId: report.players[0].rowId,
            metric: 'kills',
            field: {
              value: 1,
              confidence: 1,
              manual: true,
              sourcePage: 'record',
              evidence: `/uploads/player-portraits/${evidenceId}.png`,
            },
          },
        ],
      });
      const context = liveGameContext(store.data.state);
      contexts.push(context);
      await recognizeHudNumbers(['same'], provider, context);
      const candidate = (at: number, time: number) => ({
        capturedAt: at,
        candidates: liveCaptureKeys.map((key) => ({
          key,
          value: key === 'gameTimeSeconds' ? time : 0,
          text: '',
          confidence: 0.99,
        })),
      });
      now += 2000;
      if (game > 1)
        assert.throws(
          () =>
            act({
              type: 'live_game_ocr',
              context: contexts[game - 2],
              previous: candidate(now - 1000, 1),
              sample: candidate(now, 2),
            }),
          /Game changed/,
        );
      act({
        type: 'live_game_ocr',
        context,
        previous: candidate(now - 1000, 1),
        sample: candidate(now, 2),
      });
      if (game === 2) {
        const record = store.data.state.draftHistory.find((r) => r.id === report.id)!;
        assert.deepEqual(record.bluePicks, []);
        assert.deepEqual(record.redPicks, []);
        assert.equal(record.rules?.contributeToFutureHistory, false);
      }
      act({ type: 'confirm_game_end', reportId: report.id, winner: 'blue' });
      act({ type: 'score', team: 'blue', delta: 1 });
      if (game < 3) act({ type: 'next_game' });
    }
    assert.equal(calls, 3, 'new game must not reuse previous cached crop');
    const before = structuredClone(store.data);
    const clean = await service.clean((await service.inspect()).id);
    assert.equal(clean.deleted, 0);
    assert.deepEqual(store.data, before);
    assert.equal(store.data.state.postGameReports.length, 3);
    for (const path of evidence) assert.equal(await readFile(path, 'utf8'), 'proof');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
