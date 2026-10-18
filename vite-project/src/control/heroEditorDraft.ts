import type { Hero } from '../data/heroTypes.js';
import type { HeroDataOverride } from '../shared/types.js';

export function parseHeroAliases(value: string) {
  return value.split(/[,，\n]/).map(alias => alias.trim()).filter(Boolean);
}

export function heroDataDraft(base: Hero, runtime?: HeroDataOverride): HeroDataOverride {
  return {
    englishName: runtime?.englishName ?? base.englishName,
    chineseName: runtime?.chineseName ?? base.chineseName,
    occupation: runtime?.occupation ?? base.occupation,
    altOccupation: runtime?.altOccupation ?? base.altOccupation ?? '',
    aliases: runtime?.aliases ?? base.aliases ?? [],
    imageLink: runtime?.imageLink ?? base.imageLink,
    artLink: runtime?.artLink ?? base.artLink ?? '',
  };
}

/** Match the server's baseline diff, omitting blank optional images. */
export function heroDataChanges(base: Hero, draft: HeroDataOverride): HeroDataOverride {
  const result: HeroDataOverride = {};
  const englishName = (draft.englishName ?? base.englishName).trim();
  const chineseName = (draft.chineseName ?? base.chineseName).trim();
  if (englishName !== base.englishName) result.englishName = englishName;
  if (chineseName !== base.chineseName) result.chineseName = chineseName;
  if (draft.occupation !== undefined && draft.occupation !== base.occupation) result.occupation = draft.occupation;
  if (draft.altOccupation !== undefined && draft.altOccupation !== (base.altOccupation ?? '')) result.altOccupation = draft.altOccupation;
  const aliases = [...new Set((draft.aliases ?? base.aliases ?? []).map(alias => alias.trim()).filter(Boolean))];
  if (JSON.stringify(aliases) !== JSON.stringify(base.aliases ?? [])) result.aliases = aliases;
  const imageLink = draft.imageLink?.trim() || base.imageLink;
  const artLink = draft.artLink?.trim() || base.artLink || '';
  if (imageLink !== base.imageLink) result.imageLink = imageLink;
  if (artLink && artLink !== (base.artLink ?? '')) result.artLink = artLink;
  return result;
}

export function validHeroSource(value: string) {
  if (/\s|\\/.test(value) || [...value].some(char => char.charCodeAt(0) < 32)) return false;
  if (/^\/(?!\/)/.test(value)) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password; } catch { return false; }
}

export function heroDataIssue(override: HeroDataOverride): 'name' | 'aliases' | 'source' | undefined {
  if (override.englishName !== undefined && (!override.englishName || override.englishName.length > 60)) return 'name';
  if (override.chineseName !== undefined && (!override.chineseName || override.chineseName.length > 60)) return 'name';
  if (override.aliases && (override.aliases.length > 20 || override.aliases.some(alias => alias.length > 60))) return 'aliases';
  if ([override.imageLink, override.artLink].some(value => value !== undefined && (value.length > 1000 || !validHeroSource(value)))) return 'source';
}
