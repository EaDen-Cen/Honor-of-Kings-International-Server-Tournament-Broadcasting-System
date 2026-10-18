import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { allPoolHeroes, cnHeroes } from '../src/shared/heroPool.js';
import { heroDataChanges, heroDataDraft, heroDataIssue, parseHeroAliases } from '../src/control/heroEditorDraft.js';

test('unmodified heroes from either pool submit an empty baseline diff including heroes without full art', () => {
  for (const hero of allPoolHeroes) assert.deepEqual(heroDataChanges(hero, heroDataDraft(hero)), {}, hero.chineseName);
  assert.ok(cnHeroes.some(hero => !hero.artLink));
});

test('CN-only heroes retain their baseline names and portrait when editing metadata', () => {
  const hero = cnHeroes.find(hero => hero.id > 100000)!;
  const draft = heroDataDraft(hero, { occupation: 'Mid Lane' });
  assert.equal(draft.chineseName, hero.chineseName); assert.equal(draft.imageLink, hero.imageLink);
  assert.equal(heroDataIssue(heroDataChanges(hero, draft)), undefined);
});

test('hero edits trim names, deduplicate aliases and restore default image sources when blank', () => {
  const hero = allPoolHeroes[0];
  const draft = { ...heroDataDraft(hero), englishName: ' Custom ', aliases: [' One ', 'One', 'Two'], imageLink: '', artLink: '' };
  const changes = heroDataChanges(hero, draft);
  assert.deepEqual(changes, { englishName: 'Custom', aliases: ['One', 'Two'] });
  assert.equal(heroDataIssue(changes), undefined);
  assert.deepEqual(parseHeroAliases('One, Two，三\n四, '), ['One', 'Two', '三', '四']);
});

test('hero editor catches invalid names, aliases and unsafe image sources before sending', () => {
  assert.equal(heroDataIssue({ englishName: '' }), 'name');
  assert.equal(heroDataIssue({ aliases: Array.from({ length: 21 }, (_, index) => String(index)) }), 'aliases');
  for (const imageLink of ['http://example.com/image.png', '//example.com/a.png', '/image with space.png', 'https://user:password@example.com/a.png']) assert.equal(heroDataIssue({ imageLink }), 'source');
  for (const imageLink of ['/heroesImg/custom.png', 'https://example.com/art.jpg']) assert.equal(heroDataIssue({ imageLink }), undefined);
});
