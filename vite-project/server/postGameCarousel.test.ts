import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostGameCarousel } from './postGameCarousel.js';
import { SecureSettings } from './secureSettings.js';
import { initialState } from '../src/shared/types.js';
import {
  carouselPages,
  defaultCarouselConfig,
  carouselReady,
} from '../src/shared/postGameCarousel.js';
import type { PostGameReport } from '../src/shared/postGame.js';
function setup() {
  const state = initialState();
  state.activePostGameReportId = 'report';
  state.postGameReports = [
    {
      id: 'report',
      gameNumber: 1,
      seriesFormat: 'BO3',
      stage: 'Test',
      selectedMvpPlayerId: null,
      selectedMvpRowId: null,
      players: (['blue', 'red'] as const).flatMap((side) =>
        state[`${side}Team`].players.map((name, i) => ({
          rowId: `${state[`${side}Team`].id}:${i}`,
          playerId: name,
          side,
          slot: i,
          rosterIndex: i,
          teamName: state[`${side}Team`].name,
          portrait: '',
          role: state[`${side}Team`].playerRoles[i],
          heroId: 1,
          fields: {
            kills: { value: 1, confidence: 1, manual: true, sourcePage: 'summary' },
            deaths: { value: 1, confidence: 1, manual: true, sourcePage: 'summary' },
            assists: { value: 1, confidence: 1, manual: true, sourcePage: 'summary' },
          },
        })),
      ),
      goldTimeline: [
        { timeSeconds: 0, blueGold: 1500, redGold: 1500 },
        { timeSeconds: 60, blueGold: 1800, redGold: 1700 },
      ],
    } as PostGameReport,
  ];
  const storage = new SecureSettings(
    join(mkdtempSync(join(tmpdir(), 'hok-carousel-')), 'config.json'),
    (v, d = false) => Buffer.from(v, d ? 'base64' : 'utf8').toString(d ? 'utf8' : 'base64'),
  );
  let now = 0;
  const scenes: string[] = [];
  const carousel = new PostGameCarousel(
    storage,
    () => state,
    async (scene) => {
      scenes.push(scene);
    },
    () => now,
  );
  return {
    state,
    storage,
    carousel,
    scenes,
    advance: () => {
      now += 2001;
    },
  };
}
test('six confirmed pages rotate in requested order, pause independently, finish at selected OBS scene, and restore settings safely', async () => {
  const h = setup();
  const config = defaultCarouselConfig();
  for (const p of carouselPages) {
    config.seconds[p] = 2;
    config.scenes[p] = p;
  }
  config.endScene = 'Waiting';
  h.carousel.configure(config);
  await h.carousel.command('start');
  assert.equal(h.carousel.snapshot().page, 'clash');
  h.carousel.pause();
  h.advance();
  await h.carousel.tick();
  assert.equal(h.carousel.snapshot().page, 'clash');
  await h.carousel.command('resume');
  for (let i = 1; i <= 6; i++) {
    h.advance();
    await h.carousel.tick();
  }
  assert.deepEqual(h.scenes, [...carouselPages, 'Waiting']);
  assert.equal(h.carousel.snapshot().status, 'stopped');
  const restored = new PostGameCarousel(
    h.storage,
    () => h.state,
    async () => {},
  );
  assert.equal(restored.snapshot().config.endScene, 'Waiting');
  assert.equal(restored.snapshot().status, 'stopped');
});
test('manual pause cancels an in-flight scene cue without restarting rotation', async () => {
  const h = setup();
  let release!: () => void;
  let isCurrent!: () => boolean;
  const carousel = new PostGameCarousel(
    h.storage,
    () => h.state,
    async (_scene, current) => {
      isCurrent = current!;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      if (!current!()) throw Error('OBS scene cue cancelled');
    },
  );
  carousel.configure({ ...defaultCarouselConfig(), scenes: { clash: 'Clash' } });
  const starting = carousel.command('start');
  await carousel.command('pause');
  assert.equal(isCurrent(), false);
  release();
  await starting;
  assert.notEqual(carousel.snapshot().status, 'running');
  assert.equal(carousel.snapshot().deadline, null);
});

test('missing fields and ambiguous roles cannot publish, and report change pauses rotation', async () => {
  const h = setup();
  h.state.postGameReports[0].players[0].fields = {};
  assert.equal(carouselReady(h.state, 'clash'), false);
  await assert.rejects(h.carousel.command('show', 'clash'), /未核验/);
  await h.carousel.command('start');
  assert.equal(h.carousel.snapshot().page, 'mid');
  h.state.activePostGameReportId = null;
  await h.carousel.tick();
  assert.equal(h.carousel.snapshot().status, 'paused');
  await assert.rejects(h.carousel.command('resume'), /报告/);
  assert.throws(
    () =>
      h.carousel.configure({
        ...defaultCarouselConfig(),
        order: ['clash', 'clash', 'mid', 'farm', 'roam', 'economy'],
      }),
    /Invalid/,
  );
});
