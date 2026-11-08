import { readFile } from 'node:fs/promises';
import type { Locator } from '@playwright/test';
import { test, expect, type Page } from './fixtures';
import { harness } from './harness';
import { initialState, type GameRules, type SeriesRules } from '../src/shared/types';

const defaults: GameRules = {
  mode: 'match',
  heroPool: 'global',
  banCount: 4,
  draftRuleMode: 'global',
  enforcePreviousHistory: true,
  contributeToFutureHistory: true,
  recordHeroes: true,
  requireLineupConfirmation: false,
  firstPickSide: 'blue',
  sideSwapMode: 'moveTeams',
  flowbornFormsIndependent: true,
};

const blind: GameRules = {
  ...defaults,
  mode: 'blind',
  banCount: 0,
  recordHeroes: false,
  contributeToFutureHistory: false,
};

async function openManager(page: Page) {
  await page.goto('/control');
  await page
    .locator('.control-monitor')
    .getByRole('button', { name: 'Game Rules Manager', exact: true })
    .click();
  return page.getByRole('region', { name: 'Game Rules Manager', exact: true });
}

async function save(manager: Locator) {
  await manager.getByRole('button', { name: 'Save game rules', exact: true }).click();
  await expect(manager.getByRole('status')).toContainText('Server confirmed');
  await expect(
    manager.getByRole('button', { name: 'Save game rules', exact: true }),
  ).toBeDisabled();
}

test('bulk rules, copy, reset and local or JSON templates remain drafts until server ACK', async ({
  page,
  baseURL,
}) => {
  const h = await harness(baseURL);
  try {
    await h.send({ type: 'settings', settings: { ...initialState(), language: 'eng' } });
    await h.send({
      type: 'series_rules',
      seriesFormat: 'BO7',
      rules: { defaultGameRules: defaults, games: {} },
    });
    let manager = await openManager(page);
    await manager.getByLabel('Batch hero pool', { exact: true }).selectOption('cn');
    await manager.getByLabel('Batch ban count', { exact: true }).selectOption('5');
    for (let game = 1; game <= 7; game++) {
      await expect(manager.getByLabel(`Game ${game} hero pool`, { exact: true })).toHaveValue('cn');
      await expect(manager.getByLabel(`Game ${game} ban count`, { exact: true })).toHaveValue('5');
    }
    expect(h.state().heroPool).toBe('global');
    await manager.getByLabel('Game 3 ban count', { exact: true }).selectOption('1');
    await manager
      .locator('[data-game-rule="4"]')
      .getByRole('button', { name: 'Copy previous', exact: true })
      .click();
    await expect(manager.getByLabel('Game 4 ban count', { exact: true })).toHaveValue('1');
    await manager.getByLabel('Copy rules from', { exact: true }).selectOption('3');
    await manager.getByLabel('Copy rules to', { exact: true }).selectOption('6');
    await manager.getByRole('button', { name: 'Copy rules', exact: true }).click();
    await expect(manager.getByLabel('Game 6 ban count', { exact: true })).toHaveValue('1');
    await manager
      .locator('[data-game-rule="6"]')
      .getByRole('button', { name: 'Reset to default', exact: true })
      .click();
    await expect(manager.getByLabel('Game 6 hero pool', { exact: true })).toHaveValue('global');
    await expect(manager.getByLabel('Game 6 ban count', { exact: true })).toHaveValue('4');
    await manager
      .getByRole('button', { name: 'Use defaults for unstarted games', exact: true })
      .click();
    for (let game = 1; game <= 7; game++) {
      await expect(manager.getByLabel(`Game ${game} hero pool`, { exact: true })).toHaveValue(
        'global',
      );
      await expect(manager.getByLabel(`Game ${game} ban count`, { exact: true })).toHaveValue('4');
    }

    await manager.getByLabel('Batch hero pool', { exact: true }).selectOption('cn');
    await manager.getByLabel('Batch ban count', { exact: true }).selectOption('5');
    await manager
      .locator('[data-game-rule="3"]')
      .getByRole('button', { name: 'Set blind', exact: true })
      .click();
    await expect(manager.getByLabel('Game 3 mode', { exact: true })).toHaveValue('blind');
    await expect(manager.getByLabel('Game 3 ban count', { exact: true })).toHaveValue('0');
    await save(manager);
    await expect.poll(() => h.state().seriesRules?.games['3'].recordHeroes).toBe(false);
    const savedPlan = structuredClone(h.state().seriesRules);

    await manager.getByText('Save, import & export templates', { exact: true }).click();
    await manager.getByLabel('Rules template name', { exact: true }).fill('Mixed BO7');
    await manager.getByRole('button', { name: 'Save template', exact: true }).click();
    await expect(manager.getByRole('status')).toHaveText('Template saved in this browser');
    const downloadPromise = page.waitForEvent('download');
    await manager.getByRole('button', { name: 'Export JSON', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('hok-game-rules.json');
    const path = await download.path();
    expect(path).not.toBeNull();
    const exported = await readFile(path!, 'utf8');
    expect(JSON.parse(exported)).toEqual({ version: 1, format: 'BO7', rules: savedPlan });

    await manager.getByLabel('Game 4 hero pool', { exact: true }).selectOption('global');
    await save(manager);
    await expect.poll(() => h.state().seriesRules?.games['4'].heroPool).toBe('global');
    manager = await openManager(page);
    await manager.getByText('Save, import & export templates', { exact: true }).click();
    await manager.getByLabel('Load rules template', { exact: true }).selectOption('Mixed BO7');
    await expect(manager.getByLabel('Game 4 hero pool', { exact: true })).toHaveValue('cn');
    expect(h.state().seriesRules?.games['4'].heroPool).toBe('global');
    await save(manager);
    await expect.poll(() => h.state().seriesRules).toEqual(savedPlan);

    await manager.getByLabel('Game 4 ban count', { exact: true }).selectOption('2');
    await save(manager);
    await expect.poll(() => h.state().seriesRules?.games['4'].banCount).toBe(2);
    await manager.getByLabel('Import rules JSON', { exact: true }).setInputFiles({
      name: 'hok-game-rules.json',
      mimeType: 'application/json',
      buffer: Buffer.from(exported),
    });
    await expect(manager.getByLabel('Game 4 ban count', { exact: true })).toHaveValue('5');
    expect(h.state().seriesRules?.games['4'].banCount).toBe(2);
    await save(manager);
    await expect.poll(() => h.state().seriesRules).toEqual(savedPlan);
  } finally {
    h.close();
  }
});

test('bulk edits and imported templates preserve locked rules, results and reports', async ({
  page,
  baseURL,
}) => {
  const h = await harness(baseURL);
  try {
    await h.send({ type: 'settings', settings: { ...initialState(), language: 'eng' } });
    await h.send({
      type: 'series_rules',
      seriesFormat: 'BO7',
      rules: { defaultGameRules: defaults, games: { '1': blind } },
    });
    await h.send({ type: 'start_blind_game' });
    const gameId = h.state().committedGameId!;
    await h.send({ type: 'confirm_game_end', reportId: gameId, winner: 'blue' });
    await h.send({ type: 'score', team: 'blue', delta: 1 });
    await h.send({ type: 'next_game' });
    const history = structuredClone(h.state().draftHistory);
    const reports = structuredClone(h.state().postGameReports);
    const manager = await openManager(page);
    const lockedRow = manager.locator('[data-game-rule="1"]');
    await expect(lockedRow.getByText('Completed', { exact: true })).toBeVisible();
    await expect(manager.getByLabel('Game 1 mode', { exact: true })).toBeDisabled();
    await expect(
      lockedRow.getByRole('button', { name: 'Reset to default', exact: true }),
    ).toBeDisabled();
    await manager.getByLabel('Copy rules to', { exact: true }).selectOption('1');
    await expect(manager.getByRole('button', { name: 'Copy rules', exact: true })).toBeDisabled();

    await manager.getByLabel('Batch hero pool', { exact: true }).selectOption('cn');
    await manager.getByLabel('Batch ban count', { exact: true }).selectOption('5');
    await expect(manager.getByLabel('Game 1 hero pool', { exact: true })).toHaveValue('global');
    await expect(manager.getByLabel('Game 1 ban count', { exact: true })).toHaveValue('0');
    await expect(manager.getByLabel('Game 2 hero pool', { exact: true })).toHaveValue('cn');
    await save(manager);
    await expect.poll(() => h.state().heroPool).toBe('cn');
    expect(h.state().draftHistory).toEqual(history);
    expect(h.state().postGameReports).toEqual(reports);

    const imported: SeriesRules = {
      defaultGameRules: { ...defaults, mode: 'normal', heroPool: 'cn', banCount: 3 },
      games: { '1': { mode: 'normal', banCount: 2 }, '6': blind },
    };
    await manager.getByText('Save, import & export templates', { exact: true }).click();
    await manager.getByLabel('Import rules JSON', { exact: true }).setInputFiles({
      name: 'new-tournament-rules.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ version: 1, format: 'BO7', rules: imported })),
    });
    await expect(manager.getByLabel('Game 1 mode', { exact: true })).toHaveValue('blind');
    await expect(manager.getByLabel('Game 1 hero pool', { exact: true })).toHaveValue('global');
    await expect(manager.getByLabel('Game 2 mode', { exact: true })).toHaveValue('normal');
    await expect(manager.getByLabel('Game 2 ban count', { exact: true })).toHaveValue('3');
    await expect(manager.getByRole('status')).toContainText('Template loaded as draft');
    expect(h.state().draftMode).toBe('match');
    await save(manager);
    await expect.poll(() => h.state().draftMode).toBe('normal');
    expect(h.state().seriesRules?.games['1']).toEqual(history[0].rules);
    expect(h.state().draftHistory).toEqual(history);
    expect(h.state().postGameReports).toEqual(reports);
    expect(h.state().blueScore).toBe(1);
    expect(h.state().gameNumber).toBe(2);
  } finally {
    h.close();
  }
});
