import { test, expect } from './fixtures';
import { harness } from './harness';
import { initialState, phases } from '../src/shared/types';
import heroes from '../src/components/HeroList';
import { broadcastArtwork } from '../src/shared/broadcastArtwork';

test('workspace links open nested HUD tools and the OBS workspace without losing the page', async ({
  page,
  baseURL,
}) => {
  const h = await harness(baseURL);
  try {
    await h.send({ type: 'settings', settings: { ...initialState(), language: 'eng' } });
    await page.goto('/control');
    await page.getByRole('link', { name: 'Live capture & HUD', exact: true }).click();
    await expect(page.locator('#live-hud-workspace')).toHaveAttribute('open', '');
    await expect(page.getByRole('button', { name: 'Sample GHUD', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'OBS scenes & audio', exact: true }).click();
    await expect(page.locator('#obs-workspace')).toHaveAttribute('open', '');
  } finally {
    h.close();
  }
});

test('OBS decodes local artwork before reveal and discards an image that finishes after undo', async ({
  page,
  baseURL,
}) => {
  const h = await harness(baseURL);
  let release = () => {};
  try {
    await h.send({ type: 'settings', settings: { ...initialState(), language: 'eng' } });
    while (
      phases(h.state().draftMode, h.state().firstPickSide, h.state().banCount)[
        h.state().currentPhase
      ].action === 'ban'
    ) {
      const phase = phases(h.state().draftMode, h.state().firstPickSide, h.state().banCount)[
        h.state().currentPhase
      ];
      await h.send({
        type: 'draft_action',
        ...phase,
        heroId: heroes[90 + h.state().currentPhase].id,
      });
    }
    const hero = heroes[0],
      asset = broadcastArtwork(hero);
    const response = await page.request.get(asset);
    expect(response.headers()['cache-control']).toContain('immutable');
    const cached = await page.request.get(asset, {
      headers: { 'If-None-Match': response.headers().etag },
    });
    expect(cached.status()).toBe(304);
    expect((await cached.body()).length).toBe(0);
    let requested = false;
    await page.route(`**${asset}`, async (route) => {
      requested = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({ response });
    });
    await page.goto('/overlay/draft');
    await expect(page.locator('.hero-reveal')).toHaveCount(10);
    const phase = phases(h.state().draftMode, h.state().firstPickSide, h.state().banCount)[
      h.state().currentPhase
    ];
    await h.send({ type: 'draft_action', ...phase, heroId: hero.id });
    await expect.poll(() => requested).toBe(true);
    const reveal = page.locator(`.pick-team.${phase.team} .hero-reveal`).first();
    await expect(reveal).toHaveAttribute('data-showing-hero', '');
    await expect(reveal.locator('.reveal-white')).toHaveCount(0);
    await h.send({ type: 'undo' });
    release();
    await page.waitForTimeout(350);
    await expect(reveal).toHaveAttribute('data-showing-hero', '');
    await expect(reveal.locator('.hero-art')).toHaveCount(0);
    await page.unroute(`**${asset}`);
    await page.route(`**${asset}`, (route) => route.abort('failed'));
    await h.send({ type: 'draft_action', ...phase, heroId: hero.id });
    await expect(reveal.locator('.hero-art')).toHaveAttribute('data-art-source', 'legacy');
    const replacement = broadcastArtwork(heroes[1]);
    await h.send({
      type: 'hero_data_override',
      heroId: hero.id,
      override: { artLink: replacement },
    });
    await expect(reveal.locator('.hero-art')).toHaveAttribute('src', replacement);
    await expect(reveal.locator('.hero-art')).toHaveAttribute('data-art-source', 'full');
    await expect
      .poll(() =>
        reveal.locator('.hero-art').evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
  } finally {
    release();
    h.close();
  }
});

test('final hero swaps keep two-read validation without a 1.6-second polling penalty', async ({
  page,
  baseURL,
}) => {
  const h = await harness(baseURL);
  try {
    await h.send({
      type: 'settings',
      settings: { ...initialState(), language: 'eng', bpInputMode: 'screen' },
    });
    await h.fill();
    const blue = [...h.state().bluePicks].reverse(),
      red = [...h.state().redPicks].reverse();
    await page.addInitScript(() => {
      localStorage.setItem('hok-capture-auto-watch', '0');
      localStorage.setItem('hok-player-slot-auto', '0');
      localStorage.setItem('hok-lineup-auto', '1');
      Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
        value: async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 1920;
          canvas.height = 1080;
          canvas.getContext('2d')!.fillRect(0, 0, 1920, 1080);
          return canvas.captureStream(30);
        },
      });
    });
    let calls = 0,
      swap = false;
    await page.route('**/api/recognize-frame', async (route) => {
      calls++;
      const input = route.request().postDataJSON();
      const side = input.slot.startsWith('blue') ? 'blue' : 'red';
      const lineup = swap ? (side === 'blue' ? blue : red) : h.state()[`${side}Picks`];
      const desired = lineup[Number(input.slot.slice(-1)) - 1];
      await new Promise((resolve) => setTimeout(resolve, 35));
      await route.fulfill({
        json: {
          preview: input.image,
          candidates: input.allowedHeroIds
            .map((heroId: number) => ({ heroId, confidence: heroId === desired ? 0.99 : 0.1 }))
            .sort(
              (a: { confidence: number }, b: { confidence: number }) => b.confidence - a.confidence,
            ),
        },
      });
    });
    await page.goto('/control');
    await page.getByRole('button', { name: 'Choose game window', exact: true }).click();
    await expect(page.locator('.lineup-sync').getByRole('status').last()).toContainText(
      'Swap scan',
    );
    await expect(
      page.getByRole('button', { name: 'Recognize and apply swap now', exact: true }),
    ).toBeEnabled();
    // Time a live hero swap after capture is running, not page/module startup.
    const started = Date.now();
    const beforeSwap = calls;
    swap = true;
    await expect
      .poll(() => `${h.state().blueAssignments}|${h.state().redAssignments}`, {
        intervals: [20, 30, 50],
      })
      .toBe(`${blue}|${red}`);
    const elapsed = Date.now() - started;
    console.log(
      `Two-read final-lineup detection and server confirmation: ${elapsed} ms (${calls} crops)`,
    );
    expect(calls - beforeSwap).toBeGreaterThanOrEqual(20);
    expect(elapsed).toBeLessThan(1500);
  } finally {
    h.close();
  }
});
