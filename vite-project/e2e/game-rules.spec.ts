import { test, expect } from './fixtures';
import { harness } from './harness';
import { openDockPanel } from './dockNavigation';
import { initialState, type GameRules } from '../src/shared/types';

const blindRules: GameRules = {
  mode: 'blind',
  heroPool: 'global',
  banCount: 0,
  draftRuleMode: 'global',
  enforcePreviousHistory: true,
  contributeToFutureHistory: false,
  recordHeroes: false,
  requireLineupConfirmation: false,
  firstPickSide: 'blue',
  sideSwapMode: 'moveTeams',
  flowbornFormsIndependent: true,
};

test('manager displays seven planned games and persists a single-game override only after server ACK', async ({
  page,
  baseURL,
}) => {
  const h = await harness(baseURL);
  try {
    await h.send({ type: 'settings', settings: { ...initialState(), language: 'eng' } });
    await page.goto('/control');
    await page
      .locator('.control-monitor')
      .getByRole('button', { name: 'Game Rules Manager', exact: true })
      .click();
    const manager = page.getByRole('region', { name: 'Game Rules Manager', exact: true });
    await manager.getByLabel('Rules series format').selectOption('BO7');
    await expect(manager.locator('[data-game-rule]')).toHaveCount(7);
    await manager.getByLabel('Game 3 mode', { exact: true }).selectOption('blind');
    await expect(manager.getByLabel('Game 3 ban count', { exact: true })).toHaveValue('0');
    await manager.getByLabel('Game 4 hero pool', { exact: true }).selectOption('cn');
    await manager.getByLabel('Game 4 ban count', { exact: true }).selectOption('5');
    await manager.getByRole('button', { name: 'Save game rules', exact: true }).click();
    await expect(manager.getByRole('status')).toContainText('Server confirmed');
    await expect.poll(() => h.state().seriesFormat).toBe('BO7');
    expect(h.state().seriesRules?.games['3'].mode).toBe('blind');
    expect(h.state().seriesRules?.games['4'].heroPool).toBe('cn');
    await page.reload();
    await page
      .locator('.control-monitor')
      .getByRole('button', { name: 'Game Rules Manager', exact: true })
      .click();
    await expect(manager.getByLabel('Game 3 mode', { exact: true })).toHaveValue('blind');
    await expect(manager.getByLabel('Game 4 ban count', { exact: true })).toHaveValue('5');
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(
      page.getByRole('dialog', { name: 'Game Rules Manager', exact: true }),
    ).toBeVisible();
    for (const game of [1, 7]) {
      const bounds = await manager.locator(`[data-game-rule="${game}"]`).boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(1080);
    }
    await page.screenshot({ path: 'artifacts/game-rules-bo7.png', fullPage: true });
  } finally {
    h.close();
  }
});

test('blind game starts without heroes, stays consistent after reconnect and renders BO7 on caster and OBS', async ({
  page,
  context,
  baseURL,
}) => {
  const h = await harness(baseURL);
  try {
    await h.send({
      type: 'settings',
      settings: {
        ...initialState(),
        language: 'eng',
        scoreDisplay: 'boxes',
        bpInputMode: 'screen',
      },
    });
    await h.send({ type: 'delay', seconds: 0 });
    await h.send({
      type: 'series_rules',
      seriesFormat: 'BO7',
      rules: { defaultGameRules: blindRules, games: {} },
    });
    await page.goto('/control');
    await expect(page.locator('.blind-game-panel')).toBeVisible();
    await expect(page.locator('.screen-input')).toHaveCount(0);
    await expect(page.locator('.hero-grid')).toHaveCount(0);
    await page.getByRole('button', { name: 'Start blind game', exact: true }).click();
    await expect.poll(() => h.state().committedGameId).not.toBeNull();
    const id = h.state().committedGameId!;
    expect(h.state().postGameReports.find((report) => report.id === id)?.players).toHaveLength(10);
    await h.send({
      type: 'live_game_stats',
      stats: { ...h.state().liveGameStats, blueKills: 9, redKills: 5 },
    });
    await page.reload();
    await expect(page.locator('.blind-game-panel')).toBeVisible();
    await expect(page.getByLabel('Current game rules')).toContainText('Blind');
    await page.getByRole('button', { name: 'Match settings', exact: true }).click();
    const settings = page.locator('.match-settings-panel');
    for (const label of ['BP format', 'Draft starting side', 'Side swap behavior']) {
      await expect(settings.getByLabel(label, { exact: true })).toBeDisabled();
    }
    await page.getByRole('button', { name: 'Hide match settings', exact: true }).click();
    await openDockPanel(page, 'preparation');
    await page
      .getByLabel('Broadcast startup checklist', { exact: true })
      .locator('summary')
      .first()
      .click();
    await expect(page.getByLabel('Next game rules')).toContainText('Next game · Game 2');
    await expect(page.getByLabel('Next game rules')).toContainText('Blind Pick · global · 0 Ban');
    const overlay = await context.newPage();
    await overlay.setViewportSize({ width: 1920, height: 1080 });
    await overlay.goto('/overlay/draft');
    await expect(overlay.locator('.broadcast-meta')).toContainText('BO7');
    await expect(overlay.locator('.broadcast-overlay')).toContainText(/Blind/i);
    await expect(overlay.locator('.broadcast-bans')).toHaveCount(0);
    await expect(overlay.locator('.broadcast-card.filled')).toHaveCount(0);
    await expect(overlay.locator('.blue-score .score-box')).toHaveCount(4);
    expect(await overlay.evaluate(() => document.documentElement.scrollWidth)).toBe(1920);
    const caster = await context.newPage();
    await caster.goto('/caster');
    await expect(caster.locator('.board')).toContainText(/Blind/i);
    await h.send({ type: 'confirm_game_end', reportId: id, winner: 'blue' });
    await h.send({ type: 'score', team: 'blue', delta: 1 });
    await expect(overlay.locator('.blue-score .score-box.lit')).toHaveCount(1);
    await h.send({ type: 'next_game' });
    await expect(page.getByLabel('Next game rules')).toHaveCount(0);
    await expect(overlay.locator('.broadcast-meta')).toContainText('GAME 2');
    expect(h.state().postGameReports[0].id).toBe(id);
    expect(h.state().postGameReports[0].players.every((player) => player.heroId == null)).toBe(
      true,
    );
    await overlay.screenshot({ path: 'artifacts/bo7-blind-overlay.png', omitBackground: true });
  } finally {
    h.close();
  }
});
