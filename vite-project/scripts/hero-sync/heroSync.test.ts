import assert from 'node:assert/strict';
import test from 'node:test';
import type { Hero } from '../../src/data/heroTypes.js';
import { detectImage } from './assets.js';
import { compareLocalHeroes, makePlan, nextLocalIds } from './compare.js';
import { mergeOverride } from './generated.js';
import { preferredChineseHeroName } from './localizedNames.js';
import { normalizeName } from './normalize.js';
import { extractOfficialHeroArt, extractOfficialPickRate } from './fetchOfficial.js';
import { heroArtCrop } from '../../src/data/heroArtFocus.js';
import sharedHeroArtFocusOverrides from '../../src/data/heroArtFocusOverrides.js';
import { mergeRuntimeHeroArtFocus, renderHeroArtFocusOverrides } from './artFocusSync.js';
import type { CatalogHero, SourceSnapshot } from './types.js';
import heroes from '../../src/components/HeroList.js';
import { sortHeroes } from '../../src/control/heroSort.js';
import { allPoolHeroes, cnHeroes, heroAllowed } from '../../src/shared/heroPool.js';

const local = (overrides: Partial<Hero> = {}): Hero => ({
  id: 1,
  englishName: "Ao'yin",
  chineseName: '敖隐',
  imageLink: '/heroesImg/1.png',
  occupation: 'Farm Lane',
  aliases: ['Loong'],
  combo: [2],
  counter: [],
  beCountered: [],
  ...overrides,
});

const remote = (overrides: Partial<CatalogHero> = {}): CatalogHero => ({
  campId: 254,
  englishName: "Ao'yin",
  occupation: 'Farm Lane',
  imageUrl: 'https://camp.honorofkings.com/test.png',
  detailUrl: 'https://wiki.bittopup.com/hok/254',
  source: 'bittopup',
  ...overrides,
});


test('Flowborn localized names replace generic or coming-soon placeholders', () => {
  assert.equal(preferredChineseHeroName('Flowborn (Assassin)', 'Coming soon'), '元流之子（刺客）');
  assert.equal(preferredChineseHeroName('Flowborn (Roamer)', '元流之子'), '元流之子（辅助）');
  assert.equal(preferredChineseHeroName('Flowborn (Support)', undefined), '元流之子（辅助）');
  assert.equal(preferredChineseHeroName('Flowborn (Mage)', '元流之子'), '元流之子（法师）');
});

test('Dunshan is the newest global Roaming hero and reuses the CN stable identity', () => {
  const dunshan = heroes.find(hero => hero.id === 120);
  assert.ok(dunshan);
  assert.equal(dunshan.englishName, 'Dunshan');
  assert.equal(dunshan.chineseName, '盾山');
  assert.equal(dunshan.campId, 509);
  assert.equal(dunshan.occupation, 'Roaming');
  assert.equal(dunshan.imageLink, '/heroesImg/121.png');
  assert.equal(heroes.filter(hero => hero.englishName === 'Dunshan').length, 1);
  assert.equal(heroes.at(-1)?.id, 120);
  assert.ok(allPoolHeroes.some(hero => hero.id === dunshan.id));
  assert.ok(cnHeroes.some(hero => hero.id === dunshan.id));
  assert.ok(heroAllowed('global', dunshan.id));
  assert.ok(heroAllowed('cn', dunshan.id));
});

test('Wang Wei uses reviewed simplified Chinese display name and newest canonical ID', () => {
  assert.equal(preferredChineseHeroName('Wang Wei', '王維'), '王维');
  const wangWei = heroes.find(hero => hero.id === 119);
  assert.ok(wangWei);
  assert.equal(wangWei.englishName, 'Wang Wei');
  assert.equal(wangWei.chineseName, '王维');
  assert.equal(wangWei.campId, 138);
  assert.equal(wangWei.imageLink, '/heroesImg/120.png');
});

test('normalization matches historical aliases without creating a duplicate hero', () => {
  assert.equal(normalizeName("Ao'yin"), 'aoyin');
  const plan = makePlan([local()], [remote({ englishName: 'Loong' })]);
  assert.equal(plan.additions.length, 0);
  assert.equal(plan.matches.length, 1);
});

test('a source rename keeps identity through the previous camp snapshot', () => {
  const previous: SourceSnapshot = {
    checkedAt: '2026-01-01T00:00:00Z',
    source: 'test',
    heroes: [remote({ englishName: 'Old Name' })],
  };
  const hero = local({ englishName: 'Old Name', aliases: [] });
  const plan = makePlan([hero], [remote({ englishName: 'New Name' })], previous);
  assert.equal(plan.additions.length, 0);
  assert.equal(plan.matches[0].local.id, hero.id);
  assert.ok(plan.sourceChanges.some(change => change.field === 'englishName'));
});


test('existing heroes are compared against the current remote roster on every sync', () => {
  const hero = local({
    id: 88,
    campId: 519,
    englishName: 'Old Display Name',
    occupation: 'Mid Lane',
    aliases: [],
  });
  const plan = makePlan([hero], [remote({
    campId: 519,
    englishName: "Ao'yin",
    occupation: 'Farm Lane',
  })]);

  assert.equal(plan.matches.length, 1);
  assert.deepEqual(
    plan.localDifferences.map(item => [item.field, item.actionable]),
    [
      ['englishName', true],
      ['occupation', false],
    ],
  );
  assert.equal(plan.changed, true);
});

test('missing camp IDs are backfilled when the current hero identity still matches', () => {
  const hero = local({
    id: 88,
    campId: undefined,
    englishName: "Ao'yin",
    occupation: 'Farm Lane',
  });
  const plan = makePlan([hero], [remote({ campId: 519, englishName: "Ao'yin" })]);

  assert.equal(plan.matches.length, 1);
  assert.deepEqual(
    plan.localDifferences.map(item => [item.field, item.actionable]),
    [['campId', true]],
  );
  assert.equal(plan.changed, true);
});

test('non-actionable local lane differences are still reported without forcing a sync update', () => {
  const match = {
    local: local({ campId: 254, occupation: 'Mid Lane' }),
    remote: remote({ occupation: 'Farm Lane' }),
    matchedBy: 'campId' as const,
  };
  const differences = compareLocalHeroes([match]);
  assert.equal(differences.length, 1);
  assert.equal(differences[0].field, 'occupation');
  assert.equal(differences[0].actionable, false);

  const plan = makePlan([match.local], [match.remote], {
    checkedAt: '2026-01-01T00:00:00Z',
    source: 'test',
    heroes: [match.remote],
  });
  assert.equal(plan.changed, false);
});

test('remote omissions never remove local heroes', () => {
  const plan = makePlan([local()], []);
  assert.equal(plan.missingLocal.length, 1);
  assert.equal(plan.missingLocal[0].id, 1);
});

test('new local IDs are append-only and deterministic', () => {
  assert.deepEqual(nextLocalIds([local({ id: 117 })], 3), [118, 119, 120]);
});

test('safe override merge cannot invent relationship fields', () => {
  const result = mergeOverride(
    { aliases: ['Old'] },
    { englishName: 'New', aliases: ['Old', 'Legacy'] },
  );
  assert.deepEqual(result.aliases, ['Old', 'Legacy']);
  assert.equal(result.englishName, 'New');
  assert.equal('counter' in result, false);
});

test('image magic validation supports PNG/JPEG/WebP and rejects text', () => {
  assert.equal(detectImage(Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))?.extension, 'png');
  assert.equal(detectImage(Uint8Array.from([0xff,0xd8,0xff,0x00]))?.extension, 'jpg');
  assert.equal(detectImage(Uint8Array.from([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x45,0x42,0x50]))?.extension, 'webp');
  assert.equal(detectImage(new TextEncoder().encode('not an image')), undefined);
});

test('official artwork parser prefers main hero key art and ignores skins/icons', () => {
  const html = `
    <img class="site-logo" src="https://world.honorofkings.com/logo.png" alt="logo">
    <img class="hero-kv character-cover" src="https://camp.honorofkings.com/art/heino-1920x1080.jpg" alt="HEINO" width="1920" height="1080">
    <img class="hero-icon" src="https://camp.honorofkings.com/icon/heino.png" alt="HEINO icon">
    <section>SKIN APPRECIATION</section>
    <img src="https://camp.honorofkings.com/skins/heino-skin.jpg" alt="SKIN APPRECIATION-Temporal Agent">
  `;
  assert.equal(
    extractOfficialHeroArt(html, 'https://world.honorofkings.com/zlkdatasys/ip/hero/en/563.html', 'Heino'),
    'https://camp.honorofkings.com/art/heino-1920x1080.jpg',
  );
});

test('official artwork parser accepts trusted relative official assets and rejects third-party images', () => {
  const html = `
    <img class="hero-cover" src="https://untrusted.example.com/heino.jpg" alt="HEINO">
    <img class="hero-cover" src="/assets/hero/heino-poster.webp" alt="HEINO">
  `;
  assert.equal(
    extractOfficialHeroArt(html, 'https://world.honorofkings.com/zlkdatasys/ip/hero/en/563.html', 'HEINO'),
    'https://world.honorofkings.com/assets/hero/heino-poster.webp',
  );
});

test('safe override merge supports artwork metadata without touching relationships', () => {
  const result = mergeOverride(undefined, {
    artLink: 'https://camp.honorofkings.com/art/hero.jpg',
    artPosition: '50% 22%',
    campId: 563,
  });
  assert.equal(result.artLink, 'https://camp.honorofkings.com/art/hero.jpg');
  assert.equal(result.artPosition, '50% 22%');
  assert.equal(result.campId, 563);
  assert.equal('combo' in result, false);
});


test('broadcast artwork uses current version-controlled per-hero crop presets', () => {
  assert.deepEqual(heroArtCrop(1, 'panel'), sharedHeroArtFocusOverrides[1]?.panel);
  assert.deepEqual(heroArtCrop(1, 'side'), sharedHeroArtFocusOverrides[1]?.side);
  assert.deepEqual(heroArtCrop(19, 'panel'), sharedHeroArtFocusOverrides[19]?.panel);
  assert.deepEqual(heroArtCrop(19, 'side'), sharedHeroArtFocusOverrides[19]?.side);
});


test('runtime director crop overrides version-controlled artwork framing', () => {
  assert.deepEqual(
    heroArtCrop(19, 'side', { side: { x: 44, y: 23, scale: 1.41 } }),
    { x: 44, y: 23, scale: 1.41 },
  );
  assert.deepEqual(heroArtCrop(19, 'panel'), sharedHeroArtFocusOverrides[19]?.panel);
  assert.deepEqual(heroArtCrop(1, 'side'), sharedHeroArtFocusOverrides[1]?.side);
});

test('runtime hero crop metadata can be promoted into tracked shared defaults', () => {
  const merged = mergeRuntimeHeroArtFocus(
    sharedHeroArtFocusOverrides,
    {
      '1': {
        useLegacyImage: true,
        panel: { x: 42, y: 27, scale: 1.37 },
        side: { x: 105, y: -4, scale: 0.5 },
      },
      '9999': { panel: { x: 1, y: 2, scale: 1.1 } },
    },
    new Set(heroes.map(hero => hero.id)),
  );
  assert.deepEqual(merged[1]?.panel, { x: 42, y: 27, scale: 1.37 });
  assert.deepEqual(merged[1]?.side, { x: 100, y: 0, scale: 1 });
  assert.equal(merged[9999], undefined);
  const rendered = renderHeroArtFocusOverrides(merged);
  assert.match(rendered, /heroArtFocusOverrides/);
  assert.doesNotMatch(rendered, /"useLegacyImage"\s*:/);
});

test('crop promotion supports separately namespaced CN-only heroes',()=>{
  const hero=cnHeroes.find(item=>!heroAllowed('global',item.id));assert.ok(hero);
  const crop={x:44,y:29,scale:1.3};
  const merged=mergeRuntimeHeroArtFocus({}, {[String(hero.id)]:{panel:crop}},new Set(allPoolHeroes.map(item=>item.id)));
  assert.deepEqual(merged[hero.id]?.panel,crop);
});


test('hero art crop never shrinks an already-cover-cropped source image', () => {
  assert.deepEqual(
    heroArtCrop(1, 'panel', { panel: { x: 47, y: 0, scale: 0.6 } }),
    { x: 47, y: 0, scale: 1 },
  );
});


test("reviewed Ao'yin artwork override wins over auto-synced full art", () => {
  const aoyin = heroes.find(hero => hero.id === 88);
  assert.ok(aoyin);
  assert.equal(aoyin.chineseName, '敖隐');
  assert.equal(
    aoyin.artLink,
    "/heroesArt/ao'yin.jpg",
  );
});


test('hero picker sorting keeps unavailable heroes last for every mode', () => {
  const sample: Hero[] = [
    local({ id: 10, chineseName: '赵云', englishName: 'Zilong', occupation: 'Jungling', officialPickRate: 8 }),
    local({ id: 11, chineseName: '安琪拉', englishName: 'Angela', occupation: 'Mid Lane', officialPickRate: 22 }),
    local({ id: 12, chineseName: '后羿', englishName: 'Hou Yi', occupation: 'Farm Lane', officialPickRate: 30 }),
    local({ id: 13, chineseName: '吕布', englishName: 'Lu Bu', occupation: 'Clash Lane' }),
    local({ id: 14, chineseName: '张飞', englishName: 'Zhang Fei', occupation: 'Roaming', officialPickRate: 2 }),
  ];
  const unavailable = new Set([11, 12]);
  for (const mode of ['name-zh', 'name-en', 'release', 'pick-rate', 'lane'] as const) {
    const sorted = sortHeroes(sample, mode, id => unavailable.has(id));
    assert.deepEqual(sorted.slice(-2).map(hero => hero.id).sort(), [11, 12]);
  }
  assert.deepEqual(sortHeroes(sample, 'lane', () => false).map(hero => hero.occupation), [
    'Clash Lane', 'Mid Lane', 'Farm Lane', 'Jungling', 'Roaming',
  ]);
  assert.deepEqual(sortHeroes(sample, 'release', () => false).map(hero => hero.id), [14, 13, 12, 11, 10]);
  assert.equal(sortHeroes(sample, 'pick-rate', () => false).at(-1)?.id, 13);
});


test('official ranked pick-rate parser accepts structured and visible CAMP formats', () => {
  assert.equal(extractOfficialPickRate('<script>window.hero={pickRate:"12.34"}</script>'), 12.34);
  assert.equal(extractOfficialPickRate('<div>Pick Rate</div><strong>0.28%</strong>'), 0.28);
  assert.equal(extractOfficialPickRate('<div>101.2% Pick Rate</div>'), undefined);
});
