import { test, expect } from './fixtures';
import { harness } from './harness';
import { phases } from '../src/shared/types';
import { heroesForPool } from '../src/shared/heroPool';

async function prepareReplay(h: Awaited<ReturnType<typeof harness>>, seedPrevious = true) {
  const settings = h.state();
  settings.language = 'eng';
  settings.bpInputMode = 'screen';
  settings.recognitionAutoAccept = true;
  settings.recognitionThreshold = 90;
  await h.send({ type: 'settings', settings });
  const sequence = phases(settings.draftMode, settings.firstPickSide, settings.banCount);
  let nextHero = 1;
  const picks: { blue: number[]; red: number[] } = { blue: [], red: [] };
  for (const phase of sequence.slice(0, -1)) {
    if (phase.action === 'pick') picks[phase.team].push(nextHero);
    if (seedPrevious)
      await h.send(
        phase.action === 'ban'
          ? { type: 'skip_ban', team: phase.team }
          : { type: 'draft_action', ...phase, heroId: nextHero },
      );
    if (phase.action === 'pick') nextHero++;
  }
  const side = sequence.at(-1)!.team;
  picks[side].push(nextHero);
  return { side, nextHero, picks, sequence };
}

test('a swap before the last scan recovers the missing Pick without rewriting earlier picks', async ({
  page,
  baseURL,
}) => {
  const h = await harness(baseURL);
  try {
    const { side, nextHero } = await prepareReplay(h);
    const recorded = [...h.state()[`${side}Picks`]];
    const visible = [...recorded, recorded[1]];
    await page.addInitScript(() => {
      localStorage.setItem('hok-capture-auto-watch', '0');
      Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
        value: async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 960;
          canvas.height = 540;
          const ctx = canvas.getContext('2d')!;
          const repaint = (time: number) => {
            ctx.fillStyle = time % 2 ? '#222' : '#333';
            ctx.fillRect(0, 0, 960, 540);
            requestAnimationFrame(repaint);
          };
          requestAnimationFrame(repaint);
          return canvas.captureStream(30);
        },
      });
    });
    let marked = false;
    const sent: number[][] = [];
    page.on('websocket', (socket) =>
      socket.on('framesent', ({ payload }) => {
        const action = JSON.parse(payload.toString()).action;
        if (action?.type === 'draft_pick_group') sent.push(action.heroIds);
      }),
    );
    await page.route('**/api/recognize-frame', (route) => {
      const { slot } = route.request().postDataJSON();
      const heroId = visible[Number(slot.slice(-1)) - 1];
      return route.fulfill({
        json: {
          candidates: [{ heroId, confidence: 0.98 }],
          lockCue: marked ? 'checkmark' : 'none',
        },
      });
    });
    await page.goto('/control');
    await page.getByRole('button', { name: 'Choose game window', exact: true }).click();
    const scan = page.getByRole('button', { name: 'Recognize now', exact: true });
    const read = async () => {
      await scan.click();
      await expect(scan).toBeEnabled();
    };
    // The incomplete picture contains the same teammate twice.
    await read();
    await read();
    await read();
    expect(sent).toEqual([]);
    expect(h.state().draftComplete).toBe(false);
    // The exchanged full lineup is visible. Its markers disappeared: review only.
    visible[1] = nextHero;
    await read();
    await read();
    await expect(page.locator('.screen-input-message')).toContainText('lock marker is unconfirmed');
    expect(sent).toEqual([]);
    // Each of two subsequent scans carries the new hero's own lock marker.
    marked = true;
    await read();
    await scan.click();
    await expect.poll(() => h.state().draftComplete).toBe(true);
    expect(sent).toEqual([[nextHero]]);
    expect(h.state()[`${side}Picks`]).toEqual([...recorded, nextHero]);
    expect(h.state()[`${side}Assignments`]).toEqual([...recorded, nextHero]);
  } finally {
    h.close();
  }
});

for (const scenario of [
  'capture opened at the final pick',
  'capture opened at a textured empty final slot',
  'nine previous picks captured',
  'one painted frame between lock and swap',
  'the final video frame frozen until capture resumes',
] as const)
  test(`real local recognition recovers an immediate swap with ${scenario}`, async ({
    page,
    baseURL,
  }) => {
    const h = await harness(baseURL);
    try {
      const watched = !scenario.startsWith('capture opened');
      const { side, picks, sequence } = await prepareReplay(h, !watched);
      const lineup = { blue: [...picks.blue], red: [...picks.red] };
      [lineup[side][1], lineup[side][4]] = [lineup[side][4], lineup[side][1]];
      const icons = Object.fromEntries(
        heroesForPool(h.state().heroPool).map((h) => [h.id, h.imageLink]),
      );
      await page.addInitScript(
        ({
          lineup,
          side,
          icons,
          picks,
          watched,
          showLockFrame,
          freezeAfterSwap,
          texturedEmptySlot,
        }) => {
          const commands = new Map<string, 'pick' | 'lineup'>();
          window.WebSocket = class extends WebSocket {
            constructor(url: string | URL, protocols?: string | string[]) {
              super(url, protocols);
              this.addEventListener('message', ({ data }) => {
                const received = performance.now();
                if (typeof data !== 'string' || !commands.size) return;
                const { type, id, state } = JSON.parse(data);
                if (
                  type === 'match_state_update' &&
                  state?.draftComplete &&
                  state[side + 'Picks']?.[4] === picks[side][4] &&
                  !performance.getEntriesByName('snapshot-pick').length
                )
                  performance.mark('snapshot-pick', { startTime: received });
                const action = commands.get(id);
                if (type === 'ack' && action) {
                  performance.mark('ack-' + action, { startTime: received });
                  commands.delete(id);
                }
              });
            }
            override send(data: Parameters<WebSocket['send']>[0]) {
              if (
                typeof data === 'string' &&
                performance.getEntriesByName('final-pick-painted').length
              ) {
                const { id, action } = JSON.parse(data);
                if (action?.type === 'draft_pick_group') {
                  performance.mark('submitted-pick', { detail: action.heroIds });
                  if (
                    action.team === side &&
                    action.heroIds.length === 1 &&
                    action.heroIds[0] === picks[side][4]
                  )
                    commands.set(id, 'pick');
                }
                if (
                  action?.type === 'set_lineup_assignments' &&
                  (['blue', 'red'] as const).every(
                    (team) => JSON.stringify(action[team]) === JSON.stringify(lineup[team]),
                  )
                )
                  commands.set(id, 'lineup');
              }
              super.send(data);
            }
          };
          const width = 1024,
            height = 512,
            size = 72;
          const slots = Object.fromEntries(
            (['blue', 'red'] as const).flatMap((team) =>
              lineup[team].map((_, i) => [
                `${team}Pick${i + 1}`,
                {
                  x: (team === 'blue' ? 40 : 860) / width,
                  y: (8 + i * 100) / height,
                  width: size / width,
                  height: size / height,
                },
              ]),
            ),
          );
          localStorage.setItem('hok-window-capture-slots-v3', JSON.stringify(slots));
          localStorage.setItem('hok-capture-auto-watch', '1');
          localStorage.setItem('hok-lineup-auto', '1');
          localStorage.setItem('hok-player-slot-auto', '0');
          Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
            value: async () => {
              const canvas = document.createElement('canvas');
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d')!;
              const heroes = await Promise.all(
                (['blue', 'red'] as const).flatMap((team) =>
                  lineup[team].map(async (id, i) => {
                    const image = new Image();
                    image.src = icons[id];
                    await image.decode();
                    const original = new Image();
                    original.src = icons[picks[team][i]];
                    await original.decode();
                    return {
                      team,
                      i,
                      image,
                      original,
                      x: team === 'blue' ? 40 : 860,
                      y: 8 + i * 100,
                    };
                  }),
                ),
              );
              let locked = false,
                swapped = false;
              const stream = canvas.captureStream(freezeAfterSwap ? 0 : 60);
              const manualTrack = freezeAfterSwap
                ? (stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack)
                : undefined;
              let pausedBeforeSwap = false;
              window.addEventListener('test-pause-before-swap', () => {
                pausedBeforeSwap = true;
              });
              let visible = { blue: 0, red: 0 };
              window.addEventListener('test-locked-picks', (event) => {
                visible = (event as CustomEvent<typeof visible>).detail;
              });
              window.addEventListener('test-final-swap', () => {
                locked = true;
                swapped = !showLockFrame;
              });
              const paint = () => {
                if (pausedBeforeSwap && !locked) {
                  requestAnimationFrame(paint);
                  return;
                }
                ctx.fillStyle = '#111';
                ctx.fillRect(0, 0, width, height);
                for (const { team, i, image, original, x, y } of heroes) {
                  if (!locked && (watched ? i >= visible[team] : team === side && i === 4)) {
                    if (texturedEmptySlot && team === side && i === 4) {
                      const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
                      gradient.addColorStop(0, '#213552');
                      gradient.addColorStop(1, '#080f22');
                      ctx.fillStyle = gradient;
                      ctx.fillRect(x, y, size, size);
                      ctx.strokeStyle = '#466183';
                      ctx.strokeRect(x + 2, y + 2, size - 4, size - 4);
                    }
                    continue;
                  }
                  ctx.drawImage(swapped ? image : original, x, y, size, size);
                  if (watched || team === side) {
                    ctx.save();
                    ctx.translate(x + 26, y + size + 1);
                    ctx.scale(0.6, 0.6);
                    ctx.fillStyle = '#9e294c';
                    ctx.fill(new Path2D('M16 0L32 16L16 32L0 16Z'));
                    ctx.strokeStyle = '#b9eaff';
                    ctx.lineWidth = 4;
                    ctx.stroke(new Path2D('M7 16L13 23L25 10'));
                    ctx.restore();
                  }
                }
                if (locked && !performance.getEntriesByName('final-pick-painted').length)
                  performance.mark('final-pick-painted');
                if (locked) swapped = true;
                manualTrack?.requestFrame();
                if (locked && freezeAfterSwap) {
                  window.addEventListener(
                    'test-resume-capture',
                    () => {
                      freezeAfterSwap = false;
                      requestAnimationFrame(paint);
                    },
                    { once: true },
                  );
                } else requestAnimationFrame(paint);
              };
              paint();
              return stream;
            },
          });
        },
        {
          lineup,
          side,
          icons,
          picks,
          watched,
          showLockFrame: scenario === 'one painted frame between lock and swap',
          freezeAfterSwap: scenario === 'the final video frame frozen until capture resumes',
          texturedEmptySlot: scenario === 'capture opened at a textured empty final slot',
        },
      );
      await page.goto('/control');
      await page.getByRole('button', { name: 'Choose game window', exact: true }).click();
      const preview = page.locator('.window-capture-preview.ready video');
      await expect(preview).toBeVisible();
      await preview.evaluate(
        (element: HTMLVideoElement) =>
          new Promise<void>((resolve) => {
            element.requestVideoFrameCallback(() =>
              element.requestVideoFrameCallback(() => resolve()),
            );
          }),
      );
      if (watched) {
        while (h.state().currentPhase < sequence.length - 1) {
          const start = h.state().currentPhase;
          const phase = sequence[start];
          if (phase.action === 'ban') {
            await h.send({ type: 'skip_ban', team: phase.team });
            continue;
          }
          const visible = { blue: h.state().bluePicks.length, red: h.state().redPicks.length };
          let next = start;
          while (
            next < sequence.length - 1 &&
            sequence[next].action === 'pick' &&
            sequence[next].team === phase.team
          ) {
            visible[phase.team]++;
            next++;
          }
          await page.evaluate(
            (positions) =>
              window.dispatchEvent(new CustomEvent('test-locked-picks', { detail: positions })),
            visible,
          );
          await expect.poll(() => h.state().currentPhase, { timeout: 10000 }).toBe(next);
          expect(h.state()[`${phase.team}Picks`]).toEqual(
            picks[phase.team].slice(0, visible[phase.team]),
          );
        }
      }
      if (scenario === 'the final video frame frozen until capture resumes') {
        await page.evaluate(() => window.dispatchEvent(new Event('test-pause-before-swap')));
        await page.waitForTimeout(250);
        await expect(
          page.getByRole('button', { name: 'Recognize now', exact: true }),
        ).toBeEnabled();
      }
      await page.evaluate(() => window.dispatchEvent(new Event('test-final-swap')));
      if (scenario === 'the final video frame frozen until capture resumes') {
        await page.waitForFunction(
          () => {
            const paint = performance.getEntriesByName('final-pick-painted')[0];
            return (
              paint &&
              performance
                .getEntriesByType('resource')
                .some(
                  (r) =>
                    r.startTime >= paint.startTime &&
                    /api\/(recognize-frame|v1\/recognition\/portraits)$/.test(r.name),
                )
            );
          },
          undefined,
          { timeout: 10000 },
        );
        // Hold the actual video track still well beyond the two-observation window.
        await page.waitForTimeout(500);
        expect(h.state()[`${side}Picks`]).toEqual(picks[side].slice(0, 4));
        expect(
          await page.evaluate(() => performance.getEntriesByName('submitted-pick').length),
        ).toBe(0);
        await page.evaluate(() => window.dispatchEvent(new Event('test-resume-capture')));
      }
      await expect.poll(() => h.state()[`${side}Picks`], { timeout: 10000 }).toEqual(picks[side]);
      await expect
        .poll(() => h.state()[`${side}Assignments`], { timeout: 10000 })
        .toEqual(lineup[side]);
      await page.waitForFunction(() => performance.getEntriesByName('ack-lineup').length > 0);
      const sample = await page.evaluate(() => {
        const mark = (name: string) => performance.getEntriesByName(name)[0].startTime;
        const start = mark('final-pick-painted');
        return {
          pickMs: Number((mark('ack-pick') - start).toFixed(3)),
          pickSubmitMs: Number((mark('submitted-pick') - start).toFixed(3)),
          pickSnapshotMs: Number((mark('snapshot-pick') - start).toFixed(3)),
          lineupMs: Number((mark('ack-lineup') - start).toFixed(3)),
          submittedPicks: performance
            .getEntriesByName('submitted-pick')
            .map((entry) => (entry as PerformanceMark).detail),
          reads: performance
            .getEntriesByType('resource')
            .filter(
              (r) =>
                r.startTime + r.duration >= start &&
                /api\/(recognize-frame|v1\/recognition\/portraits)$/.test(r.name),
            )
            .map((r) => [
              r.name.split('/').at(-1),
              Math.round(r.startTime - start),
              Math.round(r.duration),
            ]),
        };
      });
      expect(sample.submittedPicks).toEqual([[picks[side][4]]]);
      expect(sample.pickMs).toBeGreaterThanOrEqual(0);
      expect(sample.lineupMs).toBeGreaterThanOrEqual(sample.pickMs);
      console.log('Final Pick painted to browser ACK', JSON.stringify({ scenario, ...sample }));
      if (
        scenario !== 'the final video frame frozen until capture resumes' &&
        process.env.HOK_ASSERT_PICK_100MS === '1'
      )
        expect(sample.pickMs).toBeLessThanOrEqual(100);
    } finally {
      h.close();
    }
  });
