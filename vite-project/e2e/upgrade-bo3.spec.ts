import { test, expect } from './fixtures';
import { harness } from './harness';
import { openDockPanel } from './dockNavigation';
import { initialState } from '../src/shared/types';
import { carouselPages, defaultCarouselConfig } from '../src/shared/postGameCarousel';
import type { AudienceVote } from '../src/shared/audienceVote';

test('BO3 rehearsal recommends game before commit and rotates six verified postgame pages each round', async ({
  page,
  baseURL,
  request,
}) => {
  test.setTimeout(180000);
  const h = await harness(baseURL);
  const headers = { Authorization: 'Bearer e2e-control' };
  await page.route('**/api/v1/obs/status', (route) =>
    route.fulfill({
      json: {
        configured: true,
        connected: true,
        scenes: ['Waiting', 'BP', 'Game'],
        programScene: 'Waiting',
        recording: true,
      },
    }),
  );
  await page.route('**/api/v1/obs/audio', (route) => route.fulfill({ json: { inputs: [] } }));
  try {
    const settings = initialState();
    settings.seriesFormat = 'BO3';
    settings.blueTeam.players = ['B1', 'B2', 'B3', 'B4', 'B5'];
    settings.redTeam.players = ['R1', 'R2', 'R3', 'R4', 'R5'];
    await h.send({ type: 'settings', settings });
    await page.goto('/control#token=e2e-control');
    await openDockPanel(page, 'obs');
    const obs = page.getByTestId('obs-director');
    await obs.locator(':scope > summary').click();
    const config = defaultCarouselConfig();
    for (const p of carouselPages) config.seconds[p] = 2;
    expect(
      (await request.put('/api/v1/postgame-carousel', { headers, data: config })).ok(),
    ).toBeTruthy();
    for (let game = 1; game <= 3; game++) {
      await h.fill();
      expect(h.state().committedGameId).toBeNull();
      await expect(obs.getByTestId('obs-cue-game')).toHaveClass(/is-recommended/);
      await h.send({ type: 'commit_game' });
      await h.send({ type: 'post_game_begin' });
      await expect(obs.getByTestId('obs-cue-postgame')).toHaveClass(/is-recommended/);
      const report = h
        .state()
        .postGameReports.find((r) => r.id === h.state().activePostGameReportId)!;
      await h.send({
        type: 'post_game_fields',
        reportId: report.id,
        updates: report.players.flatMap((p) =>
          (['kills', 'deaths', 'assists'] as const).map((metric) => ({
            rowId: p.rowId,
            metric,
            field: { value: 1, sourcePage: 'summary', confidence: 1, manual: true },
          })),
        ),
      });
      await h.send({
        type: 'post_game_gold_timeline',
        reportId: report.id,
        points: [
          { timeSeconds: 0, blueGold: 1500, redGold: 1500 },
          { timeSeconds: 60, blueGold: 4000, redGold: 3500 },
        ],
      });
      const begin = await request.post('/api/v1/postgame-carousel', {
        headers,
        data: { action: 'start' },
      });
      expect(begin.ok()).toBeTruthy();
      for (const p of carouselPages)
        await expect
          .poll(
            async () => {
              const r = await request.get('/api/v1/postgame-carousel', { headers });
              return (await r.json()).page;
            },
            { timeout: 6000, intervals: [100, 200] },
          )
          .toBe(p);
      await expect
        .poll(
          async () => {
            const r = await request.get('/api/v1/postgame-carousel', { headers });
            return (await r.json()).status;
          },
          { timeout: 6000 },
        )
        .toBe('stopped');
      await h.send({ type: 'score', team: game === 2 ? 'red' : 'blue', delta: 1 });
      if (game < 3) await h.send({ type: 'next_game' });
    }
    expect(h.state().draftHistory).toHaveLength(3);
    expect(h.state().blueScore).toBe(2);
    expect(h.state().redScore).toBe(1);
    await page.getByLabel('Workspace preset', { exact: true }).selectOption('postgame');
    await page.screenshot({ path: 'artifacts/upgrade-postgame-1440.png', fullPage: true });
    await openDockPanel(page, 'settings');
    await expect(page.getByRole('heading', { name: '设置中心 · 外部连接' })).toBeVisible();
    await page.screenshot({ path: 'artifacts/upgrade-settings.png', fullPage: true });
  } finally {
    h.close();
  }
});

test('connection settings are masked, reject remote control, and preserve keys when editing model', async ({
  request,
  page,
}) => {
  const headers = { Authorization: 'Bearer e2e-control' };
  const saved = await request.post('/api/v1/ai-recognition/profiles', {
    headers,
    data: {
      name: 'Local saved vision',
      enabled: false,
      vendor: 'openai',
      model: 'test-vision',
      endpoint: '',
      apiKey: 'fake-regression-secret',
    },
  });
  expect(saved.ok()).toBeTruthy();
  const first = await saved.json();
  const edited = await request.post('/api/v1/ai-recognition/profiles', {
    headers,
    data: {
      id: first.activeId,
      name: 'Updated',
      enabled: false,
      vendor: 'openai',
      model: 'test-vision-2',
      endpoint: '',
    },
  });
  expect((await edited.json()).configured).toBe(true);
  const discord = await request.put('/api/v1/discord/config', {
    headers,
    data: {
      botToken: 'fake-discord-token',
      guildId: '123456789012345678',
      channelId: '123456789012345679',
    },
  });
  expect(discord.ok()).toBeTruthy();
  expect(JSON.stringify(await discord.json())).not.toContain('fake-discord-token');
  const denied = await request.get('/api/v1/discord/config', {
    headers: { Authorization: 'Bearer e2e-overlay' },
  });
  expect(denied.status()).toBe(403);
  const remote = await request.get('/api/v1/discord/config', {
    headers: { ...headers, 'x-forwarded-for': '8.8.8.8' },
  });
  expect(remote.status()).toBe(403);
  await page.goto('/control#token=e2e-control');
  await page.getByRole('button', { name: '设置中心', exact: true }).click();
  await expect(page.getByLabel('视觉模型 ID')).toHaveValue('test-vision-2');
  await page.reload();
  await page.getByRole('button', { name: '设置中心', exact: true }).click();
  await expect(page.getByLabel('视觉模型 ID')).toHaveValue('test-vision-2');
});
test('audience overlay shows unknown data, then reveals ties without replacing tournament MVP', async ({
  page,
}) => {
  const vote: AudienceVote = {
    id: 'overlay-test',
    gameKey: 'game',
    gameNumber: 1,
    blueTeam: '逐风蓝队',
    redTeam: '逐风红队',
    reportId: null,
    candidates: Array.from({ length: 10 }, (_, i) => ({
      rowId: `player-${i}`,
      name: `选手 ${i + 1}`,
      team: i < 5 ? '逐风蓝队' : '逐风红队',
      side: i < 5 ? 'blue' : 'red',
      portrait: '',
    })),
    counts: null,
    total: null,
    winners: [],
    status: 'active',
    channelId: '123456789012345679',
    messageId: '123456789012345681',
    createdAt: Date.now(),
    deadline: Date.now() + 180000,
  };
  await page.route('**/api/v1/audience-vote', (route) =>
    route.fulfill({ json: { votes: [vote], error: '' } }),
  );
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/overlay/audience-mvp#token=e2e-overlay');
  await expect(page.getByRole('heading', { name: '观众 MVP · Discord 投票' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('等待数据');
  expect(await page.locator('.vote-candidate').count()).toBe(10);
  vote.status = 'finalized';
  vote.counts = [5, 5, 0, 0, 0, 0, 0, 0, 0, 0];
  vote.total = 10;
  vote.winners = ['player-0', 'player-1'];
  await expect(page.locator('.audience-result')).toContainText('最高票并列', { timeout: 8000 });
  await expect(page.locator('.vote-candidate.winner')).toHaveCount(2);
  await expect(page.locator('.audience-result')).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: 'artifacts/upgrade-audience-mvp-1920.png', fullPage: true });
});
