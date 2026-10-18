import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allPoolHeroes } from '../../src/shared/heroPool.js';
import sharedHeroArtFocusOverrides from '../../src/data/heroArtFocusOverrides.js';
import type { HeroArtOverride } from '../../src/shared/types.js';
import { mergeRuntimeHeroArtFocus, renderHeroArtFocusOverrides } from './artFocusSync.js';
import { Store } from '../../server/store.js';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const outputPath = resolve(projectRoot, 'src/data/heroArtFocusOverrides.ts');

function runtimeFile() {
  const configured = process.env.DATA_FILE?.trim();
  if (!configured) return resolve(projectRoot, 'data/match.json');
  return isAbsolute(configured) ? configured : resolve(projectRoot, configured);
}

async function main() {
  const inputPath = runtimeFile();
  let runtime: Record<string, HeroArtOverride>;
  try {
    if (!existsSync(inputPath)) throw new Error('Runtime match file does not exist');
    // The store migrates legacy hero IDs before crop metadata is promoted.
    runtime = new Store(inputPath).data.state.heroArtOverrides;
  } catch (error) {
    throw new Error(
      `Unable to read runtime match data from ${inputPath}. Start/save Broadcast first, or set DATA_FILE to the active match.json.`,
      { cause: error },
    );
  }

  if (!runtime || Object.keys(runtime).length === 0) {
    console.log('No runtime hero crop overrides found; shared defaults were not changed.');
    return;
  }

  const validHeroIds = new Set(allPoolHeroes.map(hero => hero.id));
  const merged = mergeRuntimeHeroArtFocus(sharedHeroArtFocusOverrides, runtime, validHeroIds);
  await writeFile(outputPath, renderHeroArtFocusOverrides(merged), 'utf8');

  const promoted = Object.entries(runtime).filter(([id, value]) => {
    const heroId = Number(id);
    return validHeroIds.has(heroId) && Boolean(value?.panel || value?.side);
  }).length;

  console.log(
    `Promoted crop metadata for ${promoted} runtime hero override(s) into src/data/heroArtFocusOverrides.ts. Review the diff, then commit/push it normally.`,
  );
}

await main();
