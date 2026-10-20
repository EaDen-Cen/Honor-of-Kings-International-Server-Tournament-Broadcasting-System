import assets from '../data/broadcastArtAssets.js';
import type { Hero } from '../data/heroTypes.js';

/** Only substitute the exact reviewed source. Operator image overrides and
 * newly released heroes continue to work without regenerating the asset pack. */
export function broadcastArtwork(hero: Pick<Hero, 'id' | 'artLink' | 'imageLink'>): string {
  const cached = assets[String(hero.id)];
  return cached && cached.source === hero.artLink ? cached.local : hero.artLink || hero.imageLink;
}
