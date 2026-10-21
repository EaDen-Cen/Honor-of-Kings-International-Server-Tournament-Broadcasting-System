import { test, expect } from './fixtures';
import { harness } from './harness';
import { initialState } from '../src/shared/types';

test('active capture survives docking presets, dragging and responsive reparenting', async ({
  page,
  baseURL,
}) => {
  const h = await harness(baseURL);
  try {
    await h.send({
      type: 'settings',
      settings: { ...initialState(), language: 'eng', bpInputMode: 'screen' },
    });
    await page.addInitScript(() => {
      localStorage.setItem('hok-capture-auto-watch', '0');
      localStorage.setItem('hok-player-slot-auto', '0');
      const streams: MediaStream[] = [];
      (window as Window & { captureStreams?: MediaStream[] }).captureStreams = streams;
      Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
        value: async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 1920;
          canvas.height = 1080;
          canvas.getContext('2d')!.fillRect(0, 0, 1920, 1080);
          const stream = canvas.captureStream(5);
          streams.push(stream);
          return stream;
        },
      });
    });
    await page.goto('/control');
    await page.getByRole('button', { name: 'Choose game window', exact: true }).click();
    const connected = page.locator('.screen-input .window-capture-status');
    await expect(connected).toHaveClass(/connected/);
    for (const preset of ['live', 'postgame', 'bp', 'default']) {
      await page.getByLabel('Workspace preset', { exact: true }).selectOption(preset);
    }
    await page
      .locator('.flexlayout__tab_button')
      .filter({ hasText: 'Draft & recognition' })
      .dragTo(page.locator('.flexlayout__tab_button').filter({ hasText: 'Match / BP preview' }));
    await page.setViewportSize({ width: 760, height: 1000 });
    await expect(connected).toHaveClass(/connected/);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Restore default', exact: true }).click();
    await expect(connected).toHaveClass(/connected/);
    expect(
      await page.evaluate(() => {
        const streams = (window as Window & { captureStreams?: MediaStream[] }).captureStreams!;
        return { count: streams.length, state: streams[0].getVideoTracks()[0].readyState };
      }),
    ).toEqual({ count: 1, state: 'live' });
  } finally {
    h.close();
  }
});
