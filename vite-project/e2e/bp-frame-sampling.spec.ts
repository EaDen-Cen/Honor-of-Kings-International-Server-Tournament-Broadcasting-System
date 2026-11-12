import { test, expect } from './fixtures';
import { harness } from './harness';

test('automatic BP reads a new video frame after a slow upload and leaves a frozen window idle', async ({
  page,
  baseURL,
}) => {
  const h = await harness(baseURL);
  let release = () => {};
  try {
    await h.send({
      type: 'settings',
      settings: { ...h.state(), language: 'eng', bpInputMode: 'screen' },
    });
    await page.addInitScript(() => {
      localStorage.setItem('hok-capture-auto-watch', '1');
      localStorage.setItem('hok-player-slot-auto', '0');
      Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
        value: async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 640;
          canvas.height = 360;
          const stream = canvas.captureStream(0);
          const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
          let color = 0;
          const present = () => {
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = color++ % 2 ? '#eee' : '#333';
            ctx.fillRect(0, 0, 640, 360);
            track.requestFrame();
          };
          window.addEventListener('test-present-bp-frame', present);
          requestAnimationFrame(present);
          return stream;
        },
      });
    });
    let requests = 0;
    await page.route('**/api/recognize-frame', async (route) => {
      if (++requests === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      await route.fulfill({ json: { candidates: [], lockCue: 'none' } });
    });
    await page.goto('/control');
    await page.getByRole('button', { name: 'Choose game window', exact: true }).click();
    const present = () =>
      page.evaluate(() => {
        window.dispatchEvent(new Event('test-present-bp-frame'));
      });
    await expect
      .poll(async () => {
        await present();
        return requests;
      })
      .toBe(1);
    for (let i = 0; i < 5; i++) await present();
    expect(requests).toBe(1);
    release();
    await expect(page.getByRole('button', { name: 'Recognize now', exact: true })).toBeEnabled();
    await expect
      .poll(async () => {
        await present();
        return requests;
      })
      .toBe(2);
    await expect(page.getByRole('button', { name: 'Recognize now', exact: true })).toBeEnabled();
    const settled = requests;
    await page.waitForTimeout(400);
    expect(requests).toBe(settled);
  } finally {
    release();
    h.close();
  }
});
