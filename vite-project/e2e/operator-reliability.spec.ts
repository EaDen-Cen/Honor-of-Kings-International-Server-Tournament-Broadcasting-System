import { test, expect } from './fixtures';
import { harness } from './harness';

async function resetMatch(match: Awaited<ReturnType<typeof harness>>) {
  await match.send({ type: 'reset_match' });
  await match.send({ type: 'settings', settings: { ...match.state(), language: 'zh' } });
}

test('operator guide follows the actual draft and exposes reachable workspaces on mobile', async ({ page, baseURL }) => {
  const match = await harness(baseURL);
  try {
    await resetMatch(match);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/control#token=e2e-control');
    await expect(page.locator('.status')).toHaveText('已连接');
    const guide = page.getByRole('region', { name: '导播操作指引' });
    await expect(guide.locator('[aria-current="step"]')).toContainText('赛前准备');
    await guide.getByRole('link', { name: '比分与下一局' }).click();
    await expect(page.locator('#game-lifecycle')).toBeInViewport();
    await match.send({ type: 'skip_ban', team: 'blue' });
    await expect(guide.locator('[aria-current="step"]')).toContainText('选禁操作');
    await guide.getByRole('button', { name: '设置队伍' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { match.close(); }
});

test('malformed socket messages reconnect without losing the last draft', async ({ page, baseURL }) => {
  const match = await harness(baseURL);
  let connections = 0;
  let corrupt: (() => void) | undefined;
  try {
    await resetMatch(match);
    await page.routeWebSocket('**/ws', socket => {
      connections++;
      const server = socket.connectToServer();
      server.onMessage(message => socket.send(message));
      corrupt = () => socket.send('{broken-json');
    });
    await page.goto('/control#token=e2e-control');
    await expect(page.locator('.status')).toHaveText('已连接');
    corrupt!();
    await expect.poll(() => connections).toBeGreaterThan(1);
    await expect(page.locator('.status')).toHaveText('已连接');
    await expect(page.getByRole('button', { name: '重置整场比赛', exact: true })).toBeEnabled();
    await expect(page.locator('.operator-guide')).toContainText('赛前准备');
  } finally { match.close(); }
});

test('an unacknowledged action times out and reloads state without replaying it', async ({ page, baseURL }) => {
  const match = await harness(baseURL);
  let actions = 0;
  try {
    await resetMatch(match);
    await page.routeWebSocket('**/ws', socket => {
      const server = socket.connectToServer();
      socket.onMessage(message => {
        const data = JSON.parse(String(message));
        if (data.type === 'action') { actions++; return; }
        server.send(message);
      });
    });
    await page.goto('/control#token=e2e-control');
    await expect(page.locator('.status')).toHaveText('已连接');
    await page.getByLabel('解说延迟秒数').fill('181');
    await page.getByRole('button', { name: '设置延迟', exact: true }).click();
    await expect(page.locator('.operator-guide')).toContainText('正在等待服务器确认');
    await expect(page.getByRole('button', { name: '设置延迟', exact: true })).toBeDisabled();
    await expect(page.getByRole('alert')).toContainText('操作确认超时', { timeout: 15000 });
    await expect(page.getByRole('button', { name: '设置延迟', exact: true })).toBeEnabled();
    expect(actions).toBe(1);
  } finally { match.close(); }
});

test('guide follows lineup, commit and next-game transitions in both languages', async ({ page, baseURL }) => {
  const match = await harness(baseURL);
  try {
    await resetMatch(match);
    await page.goto('/control#token=e2e-control');
    await expect(page.locator('.status')).toHaveText('已连接');
    await match.fill();
    await expect(page.locator('.operator-guide [aria-current="step"]')).toContainText('确认阵容');
    await match.send({ type: 'commit_game' });
    await expect(page.locator('.operator-guide [aria-current="step"]')).toContainText('记录与下一局');
    await expect(page.getByRole('button', { name: '开始下一局', exact: true })).toBeDisabled();
    await match.send({ type: 'score', team: 'blue', delta: 1 });
    await match.send({ type: 'next_game' });
    await expect(page.locator('.operator-guide [aria-current="step"]')).toContainText('赛前准备');
    await match.send({ type: 'settings', settings: { ...match.state(), language: 'eng' } });
    await expect(page.getByRole('region', { name: 'Operator guide' })).toContainText('Preparation');
    await page.screenshot({ path: 'artifacts/operator-guide-desktop.png' });
  } finally { match.close(); }
});
