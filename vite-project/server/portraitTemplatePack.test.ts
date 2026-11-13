import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  truncate,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { loadHeroTemplates, prepareHeroTemplates, writeHeroTemplatePack } from './capture.js';

function imageBytes(reverse = false) {
  const pixels = Buffer.from(Array.from({ length: 16 * 16 * 3 }, (_, i) => (i * 37) % 251));
  if (reverse) pixels.reverse();
  // Uncompressed RGB makes the replacement exactly the same length.
  return sharp(pixels, { raw: { width: 16, height: 16, channels: 3 } })
    .png({ compressionLevel: 0 })
    .toBuffer();
}

test('read the complete precomputed features and rebuild from the current artwork if a pack is missing, stale or damaged', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'hok-portrait-pack-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = pathToFileURL(directory + sep);
  const pack = new URL('features.bin', root);
  const portrait = new URL('first.png', root);
  const roster = [
    { id: 4, imageLink: '/first.png' },
    { id: 7, imageLink: '/display-only.png', recognitionImageLink: '/second.png' },
  ];
  const [original, replacement] = await Promise.all([imageBytes(), imageBytes(true)]);
  assert.equal(original.length, replacement.length);
  await Promise.all([
    writeFile(portrait, original),
    writeFile(new URL('second.png', root), replacement),
  ]);

  const direct = await loadHeroTemplates(pack, roster, root);
  assert.equal(direct.source, 'images');
  const generated = await writeHeroTemplatePack(pack, roster, root);
  const saved = await readFile(pack);
  assert.equal(generated.bytes, saved.length);
  assert.equal(generated.heroes, roster.length);
  assert.equal((await writeHeroTemplatePack(pack, roster, root)).reused, true);
  const loaded = await loadHeroTemplates(pack, roster, root);
  assert.equal(loaded.source, 'pack');
  assert.deepEqual(
    loaded.catalog,
    direct.catalog,
    'all square/circle views, feature vectors, scores and hero order',
  );
  for (const row of loaded.catalog) {
    for (const shape of ['square', 'circle'] as const) {
      assert.ok(row[shape].length > 1);
      assert.ok(row[shape][0].features.values instanceof Float64Array);
      assert.ok(row[shape][0].features.blocks instanceof Float64Array);
    }
  }

  const flipped = Buffer.from(saved);
  flipped[flipped.length - 1] ^= 1;
  for (const broken of [Buffer.from('old-format'), saved.subarray(0, saved.length - 1), flipped]) {
    await writeFile(pack, broken);
    const fallback = await loadHeroTemplates(pack, roster, root);
    assert.equal(fallback.source, 'images');
    assert.deepEqual(fallback.catalog, direct.catalog);
  }
  // A two-hero pack cannot legitimately occupy this much space.
  await truncate(pack, 16 * 1024 * 1024);
  assert.equal((await loadHeroTemplates(pack, roster, root)).source, 'images');
  await writeFile(pack, saved);
  const reordered = await loadHeroTemplates(pack, [roster[1], roster[0]], root);
  assert.deepEqual(
    reordered.catalog.map((row) => row.heroId),
    [7, 4],
  );
  const restricted = await loadHeroTemplates(pack, [roster[0]], root);
  assert.deepEqual(
    restricted.catalog.map((row) => row.heroId),
    [4],
  );

  const previous = await stat(portrait);
  await writeFile(portrait, replacement);
  await utimes(portrait, previous.atime, previous.mtime);
  const changed = await loadHeroTemplates(pack, roster, root);
  assert.equal(changed.source, 'images', 'same-size artwork edited since the pack was built');
  assert.notDeepEqual(
    changed.catalog[0].square[0].features.values,
    direct.catalog[0].square[0].features.values,
  );
  assert.deepEqual(changed.catalog[1], direct.catalog[1]);

  await Promise.all([
    writeHeroTemplatePack(pack, roster, root),
    writeHeroTemplatePack(pack, roster, root),
  ]);
  const after = await loadHeroTemplates(pack, roster, root);
  assert.equal(after.source, 'pack');
  assert.deepEqual(after.catalog, changed.catalog);
  assert.deepEqual((await readdir(root)).sort(), ['features.bin', 'first.png', 'second.png']);
});

test('a build never snapshots remote portraits and a later load can retry an unavailable hero', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'hok-remote-portrait-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = pathToFileURL(directory + sep);
  const pack = new URL('features.bin', root);
  const local = { id: 1, imageLink: '/local.png' };
  const remote = { id: 2, imageLink: 'https://world.honorofkings.com/remote.png' };
  const bytes = await imageBytes();
  await writeFile(new URL('local.png', root), bytes);
  let available = false;
  const fetch = t.mock.method(globalThis, 'fetch', async () =>
    available ? new Response(Uint8Array.from(bytes)) : new Response(null, { status: 503 }),
  );
  const made = await writeHeroTemplatePack(pack, [remote, local], root);
  assert.equal(made.heroes, 1);
  assert.equal(fetch.mock.callCount(), 0);
  const unavailable = await loadHeroTemplates(pack, [remote, local], root);
  assert.deepEqual(
    unavailable.catalog.map((row) => row.heroId),
    [1],
  );
  available = true;
  const online = await loadHeroTemplates(pack, [remote, local], root);
  assert.deepEqual(
    online.catalog.map((row) => row.heroId),
    [2, 1],
  );
  assert.equal(fetch.mock.callCount(), 2);
});

test('concurrent server warmup and first recognition share the same catalog build', async () => {
  const start = prepareHeroTemplates();
  assert.equal(start, prepareHeroTemplates());
  const catalog = await start;
  assert.ok(catalog.length > 0);
  assert.equal(await prepareHeroTemplates(), catalog);
});
