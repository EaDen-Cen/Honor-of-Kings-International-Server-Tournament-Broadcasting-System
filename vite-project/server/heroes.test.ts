import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import heroes from '../src/components/HeroList.js';
import { trustedRemoteHeroImage } from './capture.js';
import { releaseOrderEnglishNames } from '../src/data/heroIdOrder.js';

const addedNames = [
  'Yango', 'Flowborn (Tank)', 'Garuda', 'Arke', 'Bai Qi', 'Fatih', 'Umbrosa',
  'Flowborn (Marksman)', 'Lapulapu', 'Chano', 'Xuance', 'Annette', 'Yixing',
  'Sakeer', 'Haya', 'Devara', 'Feyd', 'Chicha', 'Florentino', 'Lorion', 'Flowborn (Mage)',
];
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngDimensions(bytes: Buffer, label: string) {
  assert.deepEqual(bytes.subarray(0, 8), pngSignature, `${label}: PNG signature`);
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR', `${label}: PNG header`);
  assert.equal(bytes.readUInt32BE(8), 13, `${label}: PNG header length`);
  const compressed: Buffer[] = [];
  let ended = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    const next = offset + size + 12;
    assert.ok(next <= bytes.length, `${label}: truncated PNG chunk`);
    const kind = bytes.toString('ascii', offset + 4, offset + 8);
    if (kind === 'IDAT') compressed.push(bytes.subarray(offset + 8, offset + 8 + size));
    if (kind === 'IEND') { ended = true; break; }
    offset = next;
  }
  assert.ok(ended && compressed.length > 0, `${label}: complete PNG image data`);
  assert.ok(inflateSync(Buffer.concat(compressed)).length > 0, `${label}: decodable PNG data`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

// Three upstream assets use JPEG/WebP bytes despite their .png filenames.
// Keep these existing portraits usable while checking the actual file format.
function legacyImageDimensions(bytes: Buffer, label: string) {
  if (bytes.subarray(0, 8).equals(pngSignature)) return pngDimensions(bytes, label);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    assert.equal(bytes.readUInt16BE(bytes.length - 2), 0xffd9, `${label}: complete JPEG`);
    for (let offset = 2; offset + 9 <= bytes.length;) {
      assert.equal(bytes[offset], 0xff, `${label}: JPEG marker`);
      const marker = bytes[offset + 1];
      if (marker === 0xff) { offset++; continue; }
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)];
      }
      const size = bytes.readUInt16BE(offset + 2);
      assert.ok(size >= 2, `${label}: JPEG segment length`);
      offset += size + 2;
    }
  }
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    assert.equal(bytes.readUInt32LE(4) + 8, bytes.length, `${label}: complete WebP`);
    const format = bytes.toString('ascii', 12, 16);
    if (format === 'VP8 ') {
      assert.equal(bytes.toString('hex', 23, 26), '9d012a', `${label}: WebP frame signature`);
      return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
    }
    if (format === 'VP8X') return [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1];
    if (format === 'VP8L' && bytes[20] === 0x2f) {
      return [1 + bytes[21] + ((bytes[22] & 0x3f) << 8), 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10)];
    }
  }
  assert.fail(`${label}: unsupported or invalid image encoding`);
}

test('hero IDs are contiguous and match canonical oldest-to-newest launch order', () => {
  const ids = new Set<number>();
  const names = new Set<string>();
  assert.equal(heroes.length, releaseOrderEnglishNames.length);
  heroes.forEach((hero, index) => {
    assert.equal(hero.id, index + 1, `${hero.englishName}: release-order ID`);
    assert.equal(hero.englishName, releaseOrderEnglishNames[index], `ID ${hero.id}: canonical launch-order name`);
    assert.ok(!ids.has(hero.id), `Duplicate ID: ${hero.id}`);
    assert.ok(hero.englishName.trim(), `ID ${hero.id} needs an English name`);
    assert.ok(hero.chineseName.trim(), `ID ${hero.id} needs a display name for Chinese mode`);
    const normalizedName = hero.englishName.trim().toLowerCase();
    assert.ok(!names.has(normalizedName), `Duplicate English name: ${hero.englishName}`);
    ids.add(hero.id);
    names.add(normalizedName);
  });
});

test('all 21 audited additions exist under new IDs, including distinct Flowborn forms', () => {
  for (const name of addedNames) {
    const hero = heroes.find(candidate => candidate.englishName === name);
    assert.ok(hero, `Missing audited hero: ${name}`);
    assert.ok(hero.id >= 1 && hero.id <= heroes.length, `${name} must use a canonical release-order ID`);
  }
});

test('hero relationships reference existing heroes and contain no self references or misspelled counter field', () => {
  const ids = new Set(heroes.map(hero => hero.id));
  for (const hero of heroes) {
    assert.ok(!Object.hasOwn(hero, 'couter'), `${hero.englishName}: misspelled counter field`);
    for (const field of ['counter', 'beCountered', 'combo'] as const) {
      for (const target of hero[field] ?? []) {
        assert.ok(ids.has(target), `${hero.englishName}.${field} references missing ID ${target}`);
        assert.notEqual(target, hero.id, `${hero.englishName}.${field} references itself`);
      }
    }
  }
});

test('every hero has a local portrait or an explicitly trusted temporary official portrait', () => {
  for (const hero of heroes) {
    if (hero.recognitionImageLink) {
      assert.ok(
        trustedRemoteHeroImage(hero.recognitionImageLink),
        `${hero.englishName}: untrusted recognition-only portrait`,
      );
    }
    if (!hero.imageLink.startsWith('/')) {
      assert.ok(trustedRemoteHeroImage(hero.imageLink), `${hero.englishName}: untrusted remote portrait`);
      assert.equal(hero.relationshipStatus, 'unverified', `${hero.englishName}: remote portrait is only allowed for a new unverified hero`);
      continue;
    }
    assert.match(hero.imageLink, /^\/heroesImg\/(?:\d+|sync-\d+-[a-f0-9]{16})\.(png|jpe?g|webp)$/);
    const label = `${hero.englishName} (${hero.imageLink})`;
    const bytes = readFileSync(new URL(`../public${hero.imageLink}`, import.meta.url));
    if (hero.imageLink.includes('/sync-')) {
      assert.ok(hero.imageLink.startsWith(`/heroesImg/sync-${hero.campId}-`), label);
      assert.ok(hero.imageLink.includes(`-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.`), label);
    }
    assert.ok(bytes.length >= 32, `${label}: missing image data`);
    const [width, height] = legacyImageDimensions(bytes, label);
    assert.ok(width > 0 && height > 0, `${label}: invalid dimensions ${width}×${height}`);
  }
});
