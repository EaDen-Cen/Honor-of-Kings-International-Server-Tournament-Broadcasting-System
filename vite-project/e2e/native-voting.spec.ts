import { test, expect } from './fixtures';
import { harness } from './harness';
import { openDockPanel } from './dockNavigation';
test.use({ mockDiscord: true });
test('native Webhook mode hides HTTPS settings, labels soft cutoff and confirms only the selected game MVP', async ({
  page,
  request,
  baseURL,
}) => {
  const h = await harness(baseURL);
  const headers = { Authorization: 'Bearer e2e-control' };
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
    await page.goto('/control#token=e2e-control');
    await openDockPanel(page, 'voting');
    const panel = page.getByRole('region', { name: '三分钟 MVP 投票 / Strict MVP voting' });
    await expect(panel.getByLabel('投票模式 / Voting mode')).toHaveValue('native');
    await expect(panel.getByLabel('公开 HTTPS 域名 / Public HTTPS origin')).toHaveCount(0);
    await expect(panel).toContainText('没有可靠的三分钟票数快照');
    await panel
      .getByLabel('确认比赛结束后自动发布 / Auto-publish after game-end confirmation')
      .check();
    await panel.getByRole('button', { name: '保存投票设置 / Save vote settings' }).click();
    await h.fill();
    await h.send({ type: 'commit_game' });
    expect(
      (await (await request.get('/api/v1/discord/strict-vote', { headers })).json()).votes,
    ).toHaveLength(0);
    await panel.getByLabel('本局胜方 / Winner').selectOption('blue');
    await panel.getByRole('button', { name: '确认本局比赛已结束 / Confirm game ended' }).click();
    await expect
      .poll(
        async () =>
          (await (await request.get('/api/v1/discord/strict-vote', { headers })).json()).votes[0]
            ?.opening.status,
      )
      .toBe('sent');
    const vote = (await (await request.get('/api/v1/discord/strict-vote', { headers })).json())
      .votes[0];
    expect(vote.opening.poll.duration).toBe(1);
    expect(vote.opening.poll.answers).toHaveLength(10);
    expect(vote.deadline - vote.startedAt).toBe(180000);
    await expect(panel.getByLabel('候选名单 / Candidates')).not.toContainText('票 / votes');
    await panel.getByRole('button', { name: '发送软截止公告 / Send soft deadline notice' }).click();
    await panel.getByLabel('人工选择 MVP / Select MVP').selectOption(vote.candidates[0].rowId);
    await panel
      .getByLabel('已核对票数与本局选手身份 / Results and player identity verified')
      .check();
    await panel.getByRole('button', { name: '确认赛事 MVP / Confirm final MVP' }).click();
    await expect.poll(() => h.state().postGameReports[0].selectedMvpPlayerId).toBe('B1');
    await expect
      .poll(
        async () =>
          (await (await request.get('/api/v1/discord/strict-vote', { headers })).json()).votes[0]
            ?.closing.status,
      )
      .toBe('sent');
    await panel.getByLabel('投票模式 / Voting mode').selectOption('web');
    await expect(panel.getByLabel('公开 HTTPS 域名 / Public HTTPS origin')).toBeVisible();
    await page.screenshot({ path: 'artifacts/native-poll-controls.png' });
  } finally {
    h.close();
  }
});
