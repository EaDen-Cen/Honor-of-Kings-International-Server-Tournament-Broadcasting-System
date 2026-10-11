import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hero } from '../../src/data/heroTypes.js';
import type { HeroOverride } from './generated.js';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const repoRoot = resolve(projectRoot, '..');

const START_ROSTER = '<!-- HERO-SYNC:ROSTER:START -->';
const END_ROSTER = '<!-- HERO-SYNC:ROSTER:END -->';
const START_STATUS = '<!-- HERO-SYNC:STATUS:START -->';
const END_STATUS = '<!-- HERO-SYNC:STATUS:END -->';
const START_M14 = '<!-- HERO-SYNC:M14:START -->';
const END_M14 = '<!-- HERO-SYNC:M14:END -->';
const START_INDEX = '<!-- HERO-SYNC:INDEX:START -->';
const END_INDEX = '<!-- HERO-SYNC:INDEX:END -->';

function replaceManagedBlock(source: string, start: string, end: string, body: string) {
  const block = `${start}\n${body.trim()}\n${end}`;
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);
  if (startIndex >= 0 && endIndex > startIndex) {
    return source.slice(0, startIndex) + block + source.slice(endIndex + end.length);
  }
  return source;
}

function effectiveHeroes(baseHeroes: Hero[], autoHeroes: Hero[], overrides: Record<number, HeroOverride>) {
  const byId = new Map<number, Hero>();
  for (const hero of baseHeroes) byId.set(hero.id, structuredClone(hero));
  for (const hero of autoHeroes) byId.set(hero.id, structuredClone(hero));
  for (const [idText, override] of Object.entries(overrides)) {
    const id = Number(idText);
    const current = byId.get(id);
    if (!current) continue;
    byId.set(id, {
      ...current,
      ...override,
      aliases: [...new Set([...(current.aliases || []), ...(override.aliases || [])])],
      combo: current.combo,
      counter: current.counter,
      beCountered: current.beCountered,
    });
  }
  return [...byId.values()]
    .filter(hero => hero.englishName.trim() && hero.chineseName.trim())
    .sort((a, b) => a.id - b.id);
}

function rosterBlock(heroes: Hero[]) {
  const rows = heroes.map(hero => `| ${hero.id} | ${hero.chineseName} | ${hero.englishName} |`).join('\n');
  return `## 程序内英雄池

当前仓库版本程序内共有 **${heroes.length} 个有效英雄条目**。英雄 ID 采用国际服官网 Launch Time 的**从旧到新连续编号**：ID 越大代表越晚上架；同批上线英雄采用固定的确定性顺序。旧版存档会在加载时自动迁移到这套编号。

> 本表由 Hero Data Synchronizer 自动生成，用于快速核对程序当前实际包含的英雄。请勿手工维护表格；英雄同步 PR 会自动刷新这里。头像资源文件名与英雄 ID 已解耦，历史 \`/heroesImg/*\` 文件无需随编号迁移重命名。

| ID | 中文名 | English |
| ---: | --- | --- |
${rows}`;
}

export async function updateHeroDocuments(args: {
  baseHeroes: Hero[];
  autoHeroes: Hero[];
  overrides: Record<number, HeroOverride>;
  checkedAt: string;
  remoteCount: number;
}) {
  const heroes = effectiveHeroes(args.baseHeroes, args.autoHeroes, args.overrides);
  const checkedDate = args.checkedAt.slice(0, 10);

  const heroRosterPath = resolve(repoRoot, 'docs/research/hero-roster.md');
  const heroSyncPath = resolve(repoRoot, 'docs/research/hero-sync.md');
  const milestonesPath = resolve(repoRoot, 'MILESTONES.md');
  const researchIndexPath = resolve(repoRoot, 'docs/research/README.md');

  let heroRoster = await readFile(heroRosterPath, 'utf8');
  const roster = `${START_ROSTER}\n${rosterBlock(heroes)}\n${END_ROSTER}`;
  if (heroRoster.includes(START_ROSTER)) {
    heroRoster = replaceManagedBlock(heroRoster, START_ROSTER, END_ROSTER, rosterBlock(heroes));
  } else {
    heroRoster = heroRoster.replace(/## 程序内英雄池[\s\S]*?(?=\n## 说明|$)/, roster);
  }

  let heroSync = await readFile(heroSyncPath, 'utf8');
  const statusBody = `## 当前自动同步状态

- 最近同步检查：**${checkedDate}**
- 程序内有效英雄：**${heroes.length}**
- 本次远端目录条目：**${args.remoteCount}**
- 独立英雄名单、本文状态、研究索引和 M14 状态均由同步器自动刷新。

> 这些数字只描述最近一次成功生成候选更新时的仓库状态；是否允许进入具体赛事房仍需按赛事规则人工确认。`;
  if (heroSync.includes(START_STATUS)) {
    heroSync = replaceManagedBlock(heroSync, START_STATUS, END_STATUS, statusBody);
  } else {
    heroSync = heroSync.replace(/^(# .+\n)/, `$1\n${START_STATUS}\n${statusBody}\n${END_STATUS}\n`);
  }

  let milestones = await readFile(milestonesPath, 'utf8');
  const m14Body = `当前自动同步基线：**${checkedDate}**；程序内 **${heroes.length}** 个有效英雄条目，最近远端目录返回 **${args.remoteCount}** 条。独立英雄名单和相关 Hero Sync 文档会随候选同步 PR 自动刷新。`;
  if (milestones.includes(START_M14)) {
    milestones = replaceManagedBlock(milestones, START_M14, END_M14, m14Body);
  } else {
    milestones = milestones.replace(
      /(## M14 — Hero Database 持续维护\n\n\*\*状态：[^\n]+\*\*\n)/,
      `$1\n${START_M14}\n${m14Body}\n${END_M14}\n`,
    );
  }

  let researchIndex = await readFile(researchIndexPath, 'utf8');
  const indexBody = `- 当前 Hero Sync 基线：**${checkedDate}**，程序内 **${heroes.length}** 个有效英雄条目；最近远端目录 **${args.remoteCount}** 条。
- [程序内英雄名单](hero-roster.md)：当前有效英雄、中文/英文名称与 release-order ID。
- [英雄数据自动同步](hero-sync.md)：每周检查国际服名单、自动刷新相关文档、生成审计记录并通过 PR 提交候选更新。`;
  if (researchIndex.includes(START_INDEX)) {
    researchIndex = replaceManagedBlock(researchIndex, START_INDEX, END_INDEX, indexBody);
  } else {
    researchIndex = researchIndex.replace(
      /- \[英雄数据自动同步\]\(hero-sync\.md\)[^\n]*\n/,
      `${START_INDEX}\n${indexBody}\n${END_INDEX}\n`,
    );
  }

  await Promise.all([
    writeFile(heroRosterPath, heroRoster, 'utf8'),
    writeFile(heroSyncPath, heroSync, 'utf8'),
    writeFile(milestonesPath, milestones, 'utf8'),
    writeFile(researchIndexPath, researchIndex, 'utf8'),
  ]);

  return { heroCount: heroes.length, checkedDate: checkedDate };
}
