import { test, expect } from './fixtures';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import type { MatchSettings, Snapshot } from '../src/shared/types';
import additionalHeroes from '../src/data/additionalHeroes';
import heroes from '../src/components/HeroList';

async function renameTestTeams(baseURL: string | undefined, blueName: string, redName: string) {
  expect(baseURL).toBe('http://127.0.0.1:3101');
  const socket = new WebSocket(new URL('/ws', baseURL).href.replace(/^http/, 'ws'));
  await new Promise<void>((resolve, reject) => {
    let sent = false;
    const id = randomUUID();
    const timer = setTimeout(() => finish(new Error('Timed out changing test team names')), 10000);
    function finish(error?: Error) {
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve();
    }
    socket.on('open', () => socket.send(JSON.stringify({ type: 'auth', token: 'e2e-control' })));
    socket.on('error', finish);
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'error') return finish(new Error(message.error));
      if (message.type === 'ack' && message.id === id) return finish();
      if (message.type !== 'match_state_update' || sent) return;
      sent = true;
      const { state, revision } = message as Snapshot;
      const settings: MatchSettings = {
        blueTeam: { ...state.blueTeam, name: blueName },
        redTeam: { ...state.redTeam, name: redName },
        blueScore: state.blueScore,
        redScore: state.redScore,
        gameNumber: state.gameNumber,
        seriesFormat: state.seriesFormat,
        stage: state.stage,
        draftMode: state.draftMode,
        draftRuleMode: state.draftRuleMode,
        firstPickSide: state.firstPickSide,
        sideSwapMode: state.sideSwapMode,
        language: state.language,
        overlayLayout: state.overlayLayout,
      };
      socket.send(JSON.stringify({ type: 'action', id, revision, action: { type: 'settings', settings } }));
    });
  });
}

test('updated roster portraits, aliases and new heroes work across all three pages', async ({ browser }) => {
  const context = await browser.newContext();
  const control = await context.newPage(), caster = await context.newPage(), overlay = await context.newPage();
  await control.goto('/control#token=e2e-control');
  await expect(control.locator('.status')).toHaveText('已连接');
  control.on('dialog', dialog => dialog.accept());
  await control.getByRole('button', { name: '重置整场比赛', exact: true }).click();
  await expect(control.getByRole('button', { name: '重置整场比赛', exact: true })).toBeEnabled();
  await control.getByLabel('解说延迟秒数').fill('180');
  await control.getByRole('button', { name: '设置延迟' }).click();
  await expect(control.getByRole('button', { name: '设置延迟' })).toBeEnabled();
  await caster.goto('/caster#token=e2e-caster');
  await overlay.setViewportSize({ width: 1920, height: 1080 });
  await overlay.goto('/overlay/draft#token=e2e-overlay');
  await expect(control.locator('.hero-grid button')).toHaveCount(heroes.length);
  for (const entry of additionalHeroes) {
    const portrait = control.getByTitle(entry.chineseName, { exact: true }).locator('img');
    await expect(portrait).toHaveAttribute('src', entry.imageLink);
    await expect.poll(() => portrait.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await control.getByLabel('搜索英雄').fill('Loong');
  await expect(control.locator('.hero-grid button')).toHaveCount(1);
  await expect(control.locator('.hero-grid button')).toHaveAttribute('title', "敖隐");
  await control.getByLabel('搜索英雄').fill('');
  await control.getByRole('button', { name: '打野', exact: true }).click();
  await expect(control.getByTitle('暃', { exact: true })).toBeVisible();
  await expect(control.getByTitle('海月', { exact: true })).toHaveCount(0);
  await control.getByRole('button', { name: '全部', exact: true }).click();
  for (const [index, entry] of additionalHeroes.slice(0, 5).entries()) {
    await control.getByTitle(entry.chineseName, { exact: true }).click();
    await expect(overlay.locator('.hero-slot img')).toHaveCount(index + 1);
    if (index === 0) {
      await expect(caster.locator('.hero-slot img')).toHaveCount(0);
      await control.getByLabel('解说延迟秒数').fill('0');
      await control.getByRole('button', { name: '设置延迟' }).click();
    }
    await expect(caster.locator('.hero-slot img')).toHaveCount(index + 1);
    for (const page of [control, caster, overlay]) {
      // Overlay picks now load official main art, while bans/Control keep icons.
      const portrait = page.locator(`img[alt="${entry.chineseName}"]`).first();
      await expect.poll(() => portrait.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    }
  }
  await overlay.bringToFront(); await overlay.screenshot({ path: 'artifacts/updated-heroes-overlay.png', omitBackground: true });
  await context.close();
});

test('operator, caster and OBS keep separate timelines and recover', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  let dropPackets = false;
  await context.routeWebSocket('**/ws', route => {
    const upstream = route.connectToServer();
    route.onMessage(message => { if (!dropPackets) upstream.send(message); });
    upstream.onMessage(message => { if (!dropPackets) route.send(message); });
  });
  const control = await context.newPage(), caster = await context.newPage(), overlay = await context.newPage();
  const errors: string[] = [];
  for (const page of [control, caster, overlay]) page.on('pageerror', e => errors.push(e.message));
  await control.goto('/control#token=e2e-control');
  await expect(control.locator('.status')).toHaveText('已连接');
  control.on('dialog', dialog => dialog.accept());
  await control.getByRole('button', { name: '重置整场比赛', exact: true }).click();
  await expect(control.getByRole('button', { name: '重置整场比赛', exact: true })).toBeEnabled();
  await control.getByLabel('解说延迟秒数').fill('180');
  await control.getByRole('button', { name: '设置延迟' }).click();
  await expect(control.getByRole('button', { name: '设置延迟' })).toBeEnabled();
  await caster.goto('/caster#token=e2e-caster');
  await overlay.setViewportSize({ width: 1920, height: 1080 });
  await overlay.goto('/overlay/draft#token=e2e-overlay');
  await expect(caster.locator('.status')).toHaveText('已连接');
  const blueAnalysisTitle = caster.locator('.analysis[data-side="blue"] h2');
  const redAnalysisTitle = caster.locator('.analysis[data-side="red"] h2');
  await expect(blueAnalysisTitle).toContainText('蓝方队伍');
  await expect(redAnalysisTitle).toContainText('红方队伍');
  await renameTestTeams(baseURL, '青龙测试队', '朱雀测试队');
  await expect(control.locator('.blue h2')).toHaveText('青龙测试队');
  await expect(control.locator('.red h2')).toHaveText('朱雀测试队');
  await expect(overlay.locator('.blue h2')).toHaveText('青龙测试队');
  await expect(overlay.locator('.red h2')).toHaveText('朱雀测试队');
  // Roster and presentation settings are live even while gameplay is delayed.
  await expect(blueAnalysisTitle).toContainText('青龙测试队');
  await expect(redAnalysisTitle).toContainText('朱雀测试队');
  await control.getByTitle('澜', { exact: true }).click();
  await expect(control.locator('.blue .bans img')).toHaveCount(1);
  await expect(overlay.locator('.blue .bans img')).toHaveCount(1);
  await expect(caster.locator('.blue .bans img')).toHaveCount(0);
  await expect(caster.locator('.hero-grid')).toHaveCount(0);
  await control.reload();
  await expect(control.locator('.status')).toHaveText('已连接');
  await expect(control.locator('.blue .bans img')).toHaveCount(1);
  await control.getByLabel('解说延迟秒数').fill('0');
  await control.getByRole('button', { name: '设置延迟' }).click();
  await expect(caster.locator('.blue .bans img')).toHaveCount(1);
  await expect(blueAnalysisTitle).toContainText('青龙测试队');
  await expect(blueAnalysisTitle).not.toContainText('朱雀测试队');
  await expect(redAnalysisTitle).toContainText('朱雀测试队');
  await expect(redAnalysisTitle).not.toContainText('青龙测试队');
  await expect(caster.locator('.blue h2')).toHaveText('青龙测试队');
  await expect(caster.locator('.red h2')).toHaveText('朱雀测试队');
  await control.getByRole('button', { name: '撤销上次操作' }).click();
  await expect(overlay.locator('.blue .bans img')).toHaveCount(0);
  await expect(caster.locator('.blue .bans img')).toHaveCount(0);
  for (let i = 0; i < 18; i++) {
    await control.locator('.hero-grid button:not(:disabled)').first().click();
    await expect(control.getByRole('button', { name: '重置整场比赛', exact: true })).toBeEnabled();
  }
  await expect(overlay.locator('.phase')).toHaveText('选禁完成');
  await expect(caster.locator('.picks img')).toHaveCount(10);
  dropPackets = true;
  await expect(control.locator('.status')).not.toHaveText('已连接', { timeout: 30000 });
  dropPackets = false;
  await expect(control.locator('.status')).toHaveText('已连接', { timeout: 20000 });
  await expect(caster.locator('.status')).toHaveText('已连接', { timeout: 20000 });
  await expect(overlay.locator('.phase')).toHaveText('选禁完成');
  expect(await overlay.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  expect(await overlay.evaluate(() => document.documentElement.scrollWidth)).toBe(1920);
  for (const page of [control, caster, overlay]) {
    await expect(page.locator('body')).not.toContainText(/Draft intelligence|Original hero relationship data|All \/ 全部|Undo \/|Search hero \/|HOK BROADCAST SYSTEM/);
    const broken = await page.locator('img').evaluateAll(images => images.filter(i => !(i as HTMLImageElement).complete || (i as HTMLImageElement).naturalWidth === 0).map(i => (i as HTMLImageElement).src));
    expect(broken).toEqual([]);
  }
  await control.bringToFront(); await control.screenshot({ path: 'artifacts/control.png', fullPage: true });
  await caster.bringToFront(); await caster.screenshot({ path: 'artifacts/caster.png', fullPage: true });
  await overlay.bringToFront(); await overlay.screenshot({ path: 'artifacts/overlay.png', omitBackground: true });
  expect(errors).toEqual([]);
  await context.close();
});
