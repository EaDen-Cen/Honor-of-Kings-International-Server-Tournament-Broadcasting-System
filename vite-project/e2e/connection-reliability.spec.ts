import { openDockPanel } from './dockNavigation';
import { expect, test } from './fixtures';
import type { Snapshot } from '../src/shared/types';
import { harness } from './harness';

test('authentication errors preserve the server policy close and stop reconnecting', async ({ page }) => {
  let connections = 0;
  await page.routeWebSocket('**/ws', socket => {
    connections++;
    socket.onMessage(message => {
      if (JSON.parse(String(message)).type !== 'auth') return;
      socket.send(JSON.stringify({ type: 'error', error: '访问口令无效' }));
      socket.close({ code: 1008, reason: '访问口令无效' });
    });
  });
  await page.clock.install();
  await page.goto('/control#token=e2e-control');
  await expect(page.locator('.login')).toContainText('无访问权限');
  await page.clock.fastForward(30000);
  await expect(page.locator('.login input')).toBeVisible();
  expect(connections).toBe(1);
});

test('invalid HTTP snapshots retry without crashing or enabling match controls', async ({ page, baseURL }) => {
  const match = await harness(baseURL);
  const errors: string[] = [];
  let requests = 0;
  page.on('pageerror', error => errors.push(error.message));
  try {
    await match.send({ type: 'reset_match' });
    await page.route('**/api/match', async route => {
      if (++requests === 1) await route.fulfill({ json: { type: 'match_state_update', revision: 0, state: null } });
      else await route.continue();
    });
    await page.goto('/control#token=e2e-control');
    await expect(page.locator('.status')).toHaveText('已连接');
    await expect(page.getByRole('alert')).toContainText('消息格式无效');
    await expect(page.getByRole('button', { name: '重置整场比赛', exact: true })).toBeEnabled();
    expect(requests).toBeGreaterThan(1);
    expect(errors).toEqual([]);
  } finally { match.close(); }
});

test('closed sockets cannot inject stale state, acknowledgements, or access tokens', async ({ page, baseURL }) => {
  const match = await harness(baseURL);
  let connections = 0;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await match.send({ type: 'reset_match' });
    await page.addInitScript(() => {
      const sockets: WebSocket[] = [];
      const NativeSocket = WebSocket;
      class ObservedSocket extends NativeSocket {
        constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); sockets.push(this); }
      }
      window.WebSocket = ObservedSocket;
      (window as Window & { observedSockets?: WebSocket[] }).observedSockets = sockets;
    });
    await page.routeWebSocket('**/ws', socket => {
      connections++;
      socket.connectToServer();
    });
    await page.goto('/control#token=e2e-control');
    await expect(page.locator('.status')).toHaveText('已连接');
    await page.evaluate(async () => {
      const snapshot: Snapshot = await (await fetch('/api/match', { headers: { Authorization: 'Bearer e2e-control' } })).json();
      snapshot.state.language = 'eng';
      const socket = (window as Window & { observedSockets?: WebSocket[] }).observedSockets![0];
      const deliver = (data: unknown) => socket.onmessage?.call(socket, new MessageEvent('message', { data: JSON.stringify(data) }));
      // The first invalid payload must synchronously invalidate this socket,
      // even if React has not rendered or a native close callback is delayed.
      deliver({ type: 'match_state_update', revision: 1, state: [] });
      deliver(snapshot);
      deliver({ type: 'ack', id: 'stale-action' });
      deliver({ type: 'access_token_update', token: 'stale-token' });
    });
    await expect.poll(() => connections).toBeGreaterThan(1);
    await expect(page.locator('.status')).toHaveText('已连接');
    expect(await page.evaluate(() => sessionStorage.getItem('hok-control'))).toBe('e2e-control');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    expect(errors).toEqual([]);
  } finally { match.close(); }
});

test('login only submits once and malformed responses remain retryable', async ({ page }) => {
  let submissions = 0;
  let release: (() => void) | undefined;
  await page.route('**/api/access?role=control', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: { local: false } }); return; }
    submissions++;
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: { token: { invalid: true } } });
  });
  await page.goto('/control');
  await page.locator('.login input').fill('e2e-control');
  // Programmatic submit events deliberately bypass the disabled button so the
  // hook itself must also enforce one request at a time.
  await page.locator('.login form').evaluate(form => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await expect.poll(() => submissions).toBe(1);
  release!();
  await expect(page.locator('.login')).toContainText(/登录返回异常|Invalid login response/);
  await expect(page.locator('.login button')).toBeEnabled();
  expect(await page.evaluate(() => sessionStorage.getItem('hok-control'))).toBeNull();
});

test('a stalled access check releases the login screen and a timed-out login can retry', async ({ page }) => {
  let accessChecks = 0;
  let submissions = 0;
  await page.route('**/api/access?role=control', async route => {
    if (route.request().method() === 'GET') { accessChecks++; return; }
    submissions++;
    if (submissions > 1) await route.fulfill({ json: { token: 'e2e-control' } });
  });
  await page.clock.install();
  await page.goto('/control');
  await expect.poll(() => accessChecks).toBe(1);
  await page.clock.fastForward(8100);
  await expect(page.locator('.login input')).toBeVisible();
  await page.locator('.login input').fill('e2e-control');
  await page.locator('.login button').click();
  await expect.poll(() => submissions).toBe(1);
  await page.clock.fastForward(8100);
  await expect(page.locator('.login')).toContainText(/登录超时|Login timed out/);
  await page.locator('.login button').click();
  await expect(page.locator('.status')).toHaveText('已连接');
  expect(submissions).toBe(2);
});

test('actions work on LAN browsers without crypto.randomUUID', async ({ page, baseURL }) => {
  const match = await harness(baseURL);
  try {
    await match.send({ type: 'reset_match' });
    await page.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true }));
    await page.goto('/control#token=e2e-control');
    await expect(page.locator('.status')).toHaveText('已连接');
    await page.getByLabel('解说延迟秒数').fill('121');
    await page.getByRole('button', { name: '设置延迟', exact: true }).click();
    await expect.poll(() => page.getByLabel('解说延迟秒数').inputValue()).toBe('121');
    await expect(page.getByRole('button', { name: '设置延迟', exact: true })).toBeEnabled();
    expect((await page.request.get('/api/match', { headers: { Authorization: 'Bearer e2e-control' } })).ok()).toBe(true);
    const snapshot: Snapshot = await (await page.request.get('/api/match', { headers: { Authorization: 'Bearer e2e-control' } })).json();
    expect(snapshot.casterDelaySeconds).toBe(121);
    await match.send({ type: 'settings', settings: { ...match.state(), language: 'eng' } });
    await openDockPanel(page,'hud');await page.getByText('Live HUD / kills, towers and objectives', { exact: true }).click();
    await page.getByLabel('Objective name', { exact: true }).fill('LAN Dragon');
    await page.getByRole('button', { name: 'Add objective', exact: true }).click();
    await expect.poll(() => match.state().liveGameStats.neutralObjectives.some(item => item.name === 'LAN Dragon')).toBe(true);
    await page.getByRole('button', { name: 'Team settings', exact: true }).click();
    await page.getByRole('button', { name: 'Manage saved teams', exact: true }).click();
    const manager = page.locator('.library-dialog');
    await manager.getByLabel('Team name', { exact: true }).fill('LAN roster');
    await manager.getByRole('button', { name: 'Add substitute', exact: true }).click();
    await manager.getByLabel('Substitute player ID', { exact: true }).fill('LAN reserve');
    await manager.getByRole('button', { name: 'Save team', exact: true }).click();
    await expect(manager.locator('.library-status')).toHaveText('Team saved');
    const teams = await (await page.request.get('/api/team-presets', { headers: { Authorization: 'Bearer e2e-control' } })).json();
    expect(teams.teams[0].substitutes[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally { match.close(); }
});
