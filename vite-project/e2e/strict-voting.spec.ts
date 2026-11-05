import { test, expect } from './fixtures';
import { harness } from './harness';
import { openDockPanel } from './dockNavigation';
import { randomUUID } from 'node:crypto';
const headers = { Authorization: 'Bearer e2e-control' };
const endpoint = '/api/v1/discord/strict-vote';
test.use({ mockDiscord: true });

test('Webhook-only automatic poll runs a real 180 seconds; public browser, exact close and manual MVP use authoritative state', async ({
  page,
  request,
  baseURL,
  context,
}) => {
  test.setTimeout(240000);
  const h = await harness(baseURL);
  try {
    await h.send({
      type: 'settings',
      settings: {
        ...h.state(),
        blueTeam: {
          ...h.state().blueTeam,
          players: ['Blue A', 'Blue B', 'Blue C', 'Blue D', 'Blue E'],
        },
        redTeam: { ...h.state().redTeam, players: ['Red A', 'Red B', 'Red C', 'Red D', 'Red E'] },
      },
    });
    expect(
      (
        await request.put('/api/v1/discord/config', {
          headers,
          data: {
            webhookUrl:
              'https://discord.com/api/webhooks/123456789012345678/TEST_ONLY_WEBHOOK_1234567890',
          },
        })
      ).ok(),
    ).toBeTruthy();
    await page.goto('/control#token=e2e-control');
    await openDockPanel(page, 'voting');
    const panel = page.getByRole('region', { name: '三分钟 MVP 投票 / Strict MVP voting' });
    await panel.getByText('投票设置 / Vote settings', { exact: true }).click();
    await panel
      .getByLabel('公开 HTTPS 域名 / Public HTTPS origin')
      .fill('https://broadcast.example.com');
    await panel
      .getByLabel('确认比赛结束后自动发布 / Auto-publish after game-end confirmation')
      .check();
    await panel.getByRole('button', { name: '保存投票设置 / Save vote settings' }).click();
    await expect(panel.getByRole('status')).toContainText('Saved');
    await h.fill();
    await h.send({ type: 'commit_game' });
    expect((await (await request.get(endpoint, { headers })).json()).votes).toHaveLength(0);
    await panel.getByLabel('本局胜方 / Winner').selectOption('blue');
    await panel.getByRole('button', { name: '确认本局比赛已结束 / Confirm game ended' }).click();
    await expect
      .poll(
        async () =>
          (await (await request.get(endpoint, { headers })).json()).votes[0]?.opening.status,
      )
      .toBe('sent');
    const vote = (await (await request.get(endpoint, { headers })).json()).votes[0];
    expect(vote.candidates).toHaveLength(10);
    expect(vote.deadline - vote.startedAt).toBe(180000);
    const audience = await context.newPage();
    await audience.goto(`/vote/${vote.id}`);
    await audience.evaluate(() => {
      Date.now = () => 9999999999999;
    });
    await expect(audience.getByLabel('服务器倒计时 / Server countdown')).toHaveText(/[0-2]:\d{2}/);
    await audience.getByRole('radio').first().check();
    await audience.getByRole('button', { name: '提交投票 / Submit vote' }).click();
    await expect(audience.getByRole('status')).toContainText('Vote recorded');
    await audience.reload();
    await audience.getByRole('radio').first().check();
    await audience.getByRole('button', { name: '提交投票 / Submit vote' }).click();
    await expect(audience.getByRole('status')).toContainText('Vote recorded');
    expect((await (await request.get(endpoint, { headers })).json()).votes[0].counts[0]).toBe(1);
    expect(h.state().postGameReports[0].selectedMvpRowId).toBeNull();
    expect((await request.get(endpoint)).status()).toBe(403);
    expect(
      (
        await request.post(`/api/v1/public-votes/${vote.id}`, {
          data: { voter: randomUUID(), rowId: 'bad' },
        })
      ).status(),
    ).toBe(400);
    // Real server wall-clock passage, no reduced product duration or mocked server clock.
    await expect
      .poll(
        async () => (await (await request.get(`/api/v1/public-votes/${vote.id}`)).json()).status,
        { timeout: 190000, intervals: [1000] },
      )
      .toBe('closed');
    expect(
      (
        await request.post(`/api/v1/public-votes/${vote.id}`, {
          data: { voter: randomUUID(), rowId: vote.candidates[0].rowId },
        })
      ).status(),
    ).toBe(400);
    await expect
      .poll(
        async () =>
          (await (await request.get(endpoint, { headers })).json()).votes[0]?.closing.status,
      )
      .toBe('sent');
    await expect(audience.getByRole('button', { name: '提交投票 / Submit vote' })).toBeDisabled();
    await panel.getByLabel('人工选择 MVP / Select MVP').selectOption(vote.candidates[0].rowId);
    await panel
      .getByLabel('已核对票数与本局选手身份 / Results and player identity verified')
      .check();
    await panel.getByRole('button', { name: '确认赛事 MVP / Confirm final MVP' }).click();
    await expect
      .poll(() => h.state().postGameReports[0].selectedMvpRowId)
      .toBe(vote.candidates[0].rowId);
    const overlay = await context.newPage();
    await overlay.goto('/overlay/mvp#token=e2e-overlay');
    await expect(overlay.locator('body')).toContainText('Blue A');
  } finally {
    h.close();
  }
});

test('winning five, early close, second game and historical confirmation stay isolated', async ({
  page,
  request,
  baseURL,
}) => {
  const h = await harness(baseURL);
  try {
    await h.send({
      type: 'settings',
      settings: {
        ...h.state(),
        blueTeam: { ...h.state().blueTeam, players: ['B1', 'B2', 'B3', 'B4', 'B5'] },
        redTeam: { ...h.state().redTeam, players: ['R1', 'R2', 'R3', 'R4', 'R5'] },
      },
    });
    await request.put('/api/v1/discord/config', {
      headers,
      data: {
        webhookUrl:
          'https://discord.com/api/webhooks/123456789012345678/TEST_ONLY_WEBHOOK_1234567890',
      },
    });
    await request.put(endpoint, {
      headers,
      data: { autoStart: true, scope: 'winner', publicOrigin: 'https://broadcast.example.com' },
    });
    await h.fill();
    await h.send({ type: 'commit_game' });
    const first = h.state().committedGameId!;
    await h.send({ type: 'confirm_game_end', reportId: first, winner: 'red' });
    await expect
      .poll(async () => (await (await request.get(endpoint, { headers })).json()).votes.length)
      .toBe(1);
    const vote = (await (await request.get(endpoint, { headers })).json()).votes[0];
    expect(vote.candidates).toHaveLength(5);
    expect(vote.candidates.every((c: { side: string }) => c.side === 'red')).toBeTruthy();
    await request.post(endpoint, { headers, data: { action: 'end', id: vote.id } });
    await h.send({ type: 'score', team: 'red', delta: 1 });
    await h.send({ type: 'next_game' });
    await h.fill();
    await h.send({ type: 'commit_game' });
    const second = h.state().committedGameId!;
    await h.send({ type: 'confirm_game_end', reportId: second, winner: 'blue' });
    await page.goto('/control#token=e2e-control');
    await openDockPanel(page, 'voting');
    const panel = page.getByRole('region', { name: '三分钟 MVP 投票 / Strict MVP voting' });
    await panel.getByLabel('查看局数 / Game').selectOption(first);
    await panel.getByLabel('人工选择 MVP / Select MVP').selectOption(vote.candidates[0].rowId);
    await panel
      .getByLabel('已核对票数与本局选手身份 / Results and player identity verified')
      .check();
    await panel.getByRole('button', { name: '确认赛事 MVP / Confirm final MVP' }).click();
    await expect
      .poll(() => h.state().postGameReports[0].selectedMvpRowId)
      .toBe(vote.candidates[0].rowId);
    expect(h.state().activePostGameReportId).toBe(second);
    expect(h.state().postGameReports[1].selectedMvpRowId).toBeNull();
    await panel.getByLabel('查看局数 / Game').selectOption('');
    page.once('dialog', (dialog) => dialog.accept());
    await panel.getByRole('button', { name: '取消投票 / Cancel vote' }).click();
    await expect
      .poll(async () => (await (await request.get(endpoint, { headers })).json()).votes[1].status)
      .toBe('cancelled');
    expect((await (await request.get(endpoint, { headers })).json()).votes[0].status).toBe(
      'closed',
    );
  } finally {
    h.close();
  }
});
