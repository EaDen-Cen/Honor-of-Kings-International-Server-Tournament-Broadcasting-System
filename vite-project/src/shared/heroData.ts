import { allPoolHeroes, heroesForPool } from './heroPool';
import type { Hero } from '../data/heroTypes';
import type { MatchState } from './types';

const heroesById=new Map(allPoolHeroes.map(hero=>[hero.id,hero]));

export function heroForState(state: Pick<MatchState, 'heroDataOverrides'>, id: number): Hero | undefined {
  const base = heroesById.get(id);
  if (!base) return undefined;
  const override = state.heroDataOverrides?.[String(id)];
  if (!override) return base;
  return {
    ...base,
    ...override,
    aliases: override.aliases ?? base.aliases,
  };
}

export function heroesForState(state: Pick<MatchState, 'heroDataOverrides'> & {heroPool?:MatchState['heroPool']}): Hero[] {
  return heroesForPool(state.heroPool).map(hero => heroForState(state, hero.id) ?? hero);
}
