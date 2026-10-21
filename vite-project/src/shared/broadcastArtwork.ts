import assets from '../data/broadcastArtAssets.js';
import { allPoolHeroes } from './heroPool.js';
const catalogArt = new Map(allPoolHeroes.map((hero) => [hero.id, hero.artLink]));
import type { Hero } from '../data/heroTypes.js';

/** Only substitute the exact reviewed source. Operator image overrides and
 * newly released heroes continue to work without regenerating the asset pack. */
export function broadcastArtwork(hero: Pick<Hero, 'id' | 'artLink' | 'imageLink'>): string {
  const cached = assets[String(hero.id)];
  if (cached && cached.source === hero.artLink) return cached.local;
  // A missing catalog download must not stall live reveals on an external CDN.
  // Explicit operator overrides remain supported; default catalog art falls
  // back to the shipped portrait until the next successful preparation.
  if (hero.artLink === catalogArt.get(hero.id) && !hero.artLink?.startsWith('/'))
    return hero.imageLink;
  return hero.artLink || hero.imageLink;
}
