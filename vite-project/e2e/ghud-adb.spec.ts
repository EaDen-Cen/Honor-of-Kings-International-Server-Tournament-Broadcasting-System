import { test, expect } from './fixtures';
import { harness } from './harness';
import { openDockPanel } from './dockNavigation';
import { initialState } from '../src/shared/types';
import { liveCaptureKeys } from '../src/shared/gameCapture';
import sharp from 'sharp';

test('ADB requires calibration and invalidates candidates on dimensions/source changes', async ({
  page,
  baseURL,
}) => {
  const h = await harness(baseURL);
  try {
    await h.send({ type: 'settings', settings: { ...initialState(), language: 'eng' } });
    const normal = await sharp({
      create: { width: 1920, height: 1080, channels: 3, background: '#203060' },
    })
      .png()
      .toBuffer();
    const resized = await sharp(normal).resize(1280, 720).png().toBuffer();
    let changed = false,
      clock = 120;
    await page.route('**/api/v1/capture/adb/devices', (route) =>
      route.fulfill({ json: { devices: [{ id: '0', name: 'Test LDPlayer', connected: true }] } }),
    );
    await page.route('**/api/v1/capture/adb/frame?*', (route) =>
      route.fulfill({ contentType: 'image/png', body: changed ? resized : normal }),
    );
    await page.route('**/api/v1/recognition/live-hud', (route) => {
      const input = route.request().postDataJSON();
      const capturedAt = Date.now(),
        time = clock++;
      return route.fulfill({
        json: {
          capturedAt,
          context: input.context,
          profile: JSON.stringify([input.source, input.regions]),
          elapsedMs: 1,
          candidates: liveCaptureKeys.map((key) => ({
            key,
            value: key === 'gameTimeSeconds' ? time : 0,
            confidence: 0.99,
            text: '0',
          })),
          neutral: input.neutral
            ? {
                capturedAt,
                profile: JSON.stringify([input.source, input.neutral.regions]),
                frameHash: (time % 2 ? 'a' : 'b').repeat(64),
                clock: { value: time, confidence: 0.99 },
                candidates: [{ id: 'tyrant', side: 'blue', value: 1, confidence: 0.99 }],
              }
            : undefined,
        },
      });
    });
    await page.goto('/control');
    await openDockPanel(page, 'hud');
    await page.getByText('Live HUD / kills, towers and objectives', { exact: true }).click();
    await page.getByText('GHUD top bar recognition · Experimental', { exact: true }).click();
    const panel = page.locator('#live-hud-workspace');
    await panel.getByLabel('GHUD capture source').selectOption('adb');
    await panel.getByRole('button', { name: 'Refresh LDPlayer instances' }).click();
    await panel.getByLabel('LDPlayer instance', { exact: true }).selectOption('0');
    await panel.getByRole('button', { name: 'Connect / reconnect and preview' }).click();
    await expect(panel.getByText('1920x1080', { exact: true })).toBeVisible();
    const sample = panel.getByRole('button', { name: 'Sample GHUD', exact: true });
    await expect(sample).toBeDisabled();
    await panel
      .getByText('Calibrate the seven HUD digits (confirm for each source)', { exact: true })
      .click();
    await panel.getByRole('button', { name: 'Preview captured frame', exact: true }).click();
    await panel.getByRole('button', { name: 'Save & confirm calibration', exact: true }).click();
    await expect(sample).toBeEnabled();
    await sample.click();
    await expect(
      panel.getByText('First read is a candidate; sample again to verify.', { exact: true }),
    ).toBeVisible();
    await page.waitForTimeout(350);
    await sample.click();
    await expect(
      panel.getByRole('button', { name: 'Apply verified fields', exact: true }),
    ).toBeEnabled();
    await panel
      .getByText('Neutral objective counters (separate calibration)', { exact: true })
      .click();
    const picker = panel.getByLabel('Objective counter selection', { exact: true });
    await picker.scrollIntoViewIfNeeded();
    const box = (await picker.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.1);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.14);
    await page.mouse.up();
    await panel
      .getByRole('button', {
        name: 'Confirm these are the matching cumulative counters',
        exact: true,
      })
      .click();
    await page.getByLabel('Tyrant blue frozen', { exact: true }).click();
    await expect
      .poll(() => h.state().liveGameStats.neutralObjectives[0].countFrozen?.blue)
      .toBe(false);
    await sample.click();
    await expect(sample).toBeEnabled();
    await page.waitForTimeout(350);
    await sample.click();
    await expect(panel.getByLabel('Objective OCR candidates')).toContainText(
      'Verified in two reads',
    );
    await panel.getByRole('button', { name: 'Apply verified fields', exact: true }).click();
    await expect.poll(() => h.state().liveGameStats.neutralObjectives[0].blue).toBe(1);
    await expect(sample).toBeEnabled();
    const trustedTime = h.state().liveGameStats.gameTimeSeconds;
    changed = true;
    await sample.click();
    await expect(sample).toBeDisabled();
    await expect(
      panel.getByRole('button', { name: 'Apply verified fields', exact: true }),
    ).toBeDisabled();
    await panel.getByLabel('GHUD capture source').selectOption('window');
    await expect(sample).toBeDisabled();
    expect(h.state().liveGameStats.gameTimeSeconds).toBe(trustedTime);
    expect(h.state().liveGameStats.neutralObjectives[0].blue).toBe(1);
  } finally {
    h.close();
  }
});

test('objective shortcuts persist manual freeze and update the live Overlay', async ({
  page,
  context,
  baseURL,
}) => {
  const h = await harness(baseURL);
  try {
    await h.send({ type: 'settings', settings: { ...initialState(), language: 'eng' } });
    const overlay = await context.newPage();
    await overlay.goto('/overlay/game-hud');
    await page.goto('/control');
    await openDockPanel(page, 'hud');
    await page.getByText('Live HUD / kills, towers and objectives', { exact: true }).click();
    await page.getByRole('button', { name: 'Tyrant blue plus', exact: true }).click();
    await expect(
      overlay.getByTestId('game-hud-blue-objectives').locator('.game-hud-cell-value'),
    ).toHaveText('1');
    await expect(page.getByLabel('Tyrant blue frozen', { exact: true })).toBeChecked();
    await page.getByLabel('Tyrant blue frozen', { exact: true }).click();
    await expect
      .poll(() => h.state().liveGameStats.neutralObjectives[0].countFrozen?.blue)
      .toBe(false);
    await page.getByRole('button', { name: 'Tyrant blue minus', exact: true }).click();
    await expect(
      overlay.getByTestId('game-hud-blue-objectives').locator('.game-hud-cell-value'),
    ).toHaveText('0');
    await expect(page.getByLabel('Tyrant blue frozen', { exact: true })).toBeChecked();
    await h.send({ type: 'undo' });
    await expect(
      overlay.getByTestId('game-hud-blue-objectives').locator('.game-hud-cell-value'),
    ).toHaveText('1');
    await overlay.reload();
    await expect(
      overlay.getByTestId('game-hud-blue-objectives').locator('.game-hud-cell-value'),
    ).toHaveText('1');
  } finally {
    h.close();
  }
});

test('ADB HTTP endpoints reject unauthenticated, non-Control and forwarded requests before device access', async ({
  request,
}) => {
  for (const path of ['/api/v1/capture/adb/devices', '/api/v1/capture/adb/frame?device=0']) {
    for (const headers of [
      {},
      { Authorization: 'Bearer e2e-overlay' },
      { Authorization: 'Bearer e2e-control', 'X-Forwarded-For': '203.0.113.5' },
    ]) {
      const response = await request.get(path, { headers });
      expect(response.status()).toBe(403);
    }
  }
  expect(
    (
      await request.get('/api/v1/capture/adb/frame?device=arbitrary', {
        headers: { Authorization: 'Bearer e2e-control' },
      })
    ).status(),
  ).toBe(400);
});
