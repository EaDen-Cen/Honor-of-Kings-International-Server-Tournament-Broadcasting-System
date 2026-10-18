import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import globalHeroes from '../../src/components/HeroList.js';
import { allPoolHeroes, cnHeroes } from '../../src/shared/heroPool.js';
import { validateLocalImage } from './assets.js';
import { LANES } from './types.js';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const publicDir = resolve(projectRoot, 'public');

async function main() {
  const errors: string[] = [];
  const ids = new Set<number>();
  const campIds = new Map<number, number>();
  const heroes = allPoolHeroes;
  const validIds = new Set(heroes.map(hero => hero.id));
  if (new Set(cnHeroes.map(hero => hero.id)).size !== cnHeroes.length) errors.push('Duplicate CN hero ID');

  for (const hero of heroes) {
    if (ids.has(hero.id)) errors.push(`Duplicate local hero id: ${hero.id}`);
    ids.add(hero.id);

    if (!hero.englishName.trim()) errors.push(`Hero #${hero.id} has an empty English name`);
    if (!hero.chineseName.trim()) errors.push(`Hero #${hero.id} has an empty Chinese name`);
    if (!LANES.includes(hero.occupation as typeof LANES[number])) {
      errors.push(`Hero #${hero.id} ${hero.englishName} has unsupported occupation: ${hero.occupation}`);
    }
    if (hero.altOccupation && !LANES.includes(hero.altOccupation as typeof LANES[number])) {
      errors.push(`Hero #${hero.id} ${hero.englishName} has unsupported altOccupation: ${hero.altOccupation}`);
    }

    if (hero.campId !== undefined) {
      const previous = campIds.get(hero.campId);
      if (previous !== undefined) errors.push(`Duplicate campId ${hero.campId}: local #${previous} and #${hero.id}`);
      campIds.set(hero.campId, hero.id);
    }

    for (const field of ['combo', 'counter', 'beCountered'] as const) {
      for (const referenced of hero[field] || []) {
        if (!validIds.has(referenced)) errors.push(`Hero #${hero.id} ${field} references missing local id ${referenced}`);
        if (referenced === hero.id) errors.push(`Hero #${hero.id} ${field} references itself`);
      }
    }

    if (hero.imageLink.startsWith('/heroesImg/')) {
      const file = resolve(publicDir, hero.imageLink.replace(/^\//, ''));
      try {
        if (!await validateLocalImage(file)) errors.push(`Hero #${hero.id} has an invalid image file: ${hero.imageLink}`);
      } catch {
        errors.push(`Hero #${hero.id} image is missing: ${hero.imageLink}`);
      }
    }
  }

  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
    return;
  }

  console.log(`Hero data valid: ${globalHeroes.length} global heroes, ${cnHeroes.length} CN heroes, ${heroes.length} distinct heroes, ${campIds.size} stable camp IDs; all relationship references and local images passed. Remote CN images were not fetched.`);
}

await main();
