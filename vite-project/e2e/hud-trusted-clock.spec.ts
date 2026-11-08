import { test, expect } from './fixtures';
import { harness } from './harness';
import { liveGameContext } from '../src/shared/liveGame';
import { liveCaptureKeys } from '../src/shared/gameCapture';
test('Overlay keeps last trusted OCR time during missing reads, then displays newly verified time', async ({
  page,
  baseURL,
}) => {
  const h = await harness(baseURL);
  try {
    const now = Date.now(),
      context = liveGameContext(h.state());
    const sample = (at: number, value: number) => ({
      capturedAt: at,
      candidates: liveCaptureKeys.map((key) => ({
        key,
        value: key === 'gameTimeSeconds' ? value : 0,
        text: '',
        confidence: 0.99,
      })),
    });
    await h.send({
      type: 'live_game_ocr',
      context,
      previous: sample(now - 5000, 120),
      sample: sample(now - 4000, 121),
    });
    await page.goto('/overlay/game-hud');
    const clock = page.locator('.game-hud-clock');
    await expect(clock).toHaveText('2:01');
    await page.clock.install();
    await page.clock.fastForward(5000);
    await expect(clock).toHaveText('2:01');
    await h.send({
      type: 'live_game_ocr',
      context,
      previous: sample(now - 2000, 123),
      sample: sample(now - 1000, 124),
    });
    await expect(clock).toHaveText('2:04');
  } finally {
    h.close();
  }
});
