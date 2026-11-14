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

for (const watched of [false, true])
  test(`real local recognition recovers an immediate swap with ${watched ? 'nine previous picks captured' : 'capture opened at the final pick'}`, async ({
    page,
    baseURL,
  }) => {
    const h = await harness(baseURL);
    try {
      const { side, picks, sequence } = await prepareReplay(h, !watched);
      const lineup = { blue: [...picks.blue], red: [...picks.red] };
      [lineup[side][1], lineup[side][4]] = [lineup[side][4], lineup[side][1]];
      const icons = Object.fromEntries(
        heroesForPool(h.state().heroPool).map((h) => [h.id, h.imageLink]),
      );
      await page.addInitScript(
        ({ lineup, side, icons, picks, watched }) => {
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
              let swapped = false;
              let visible = { blue: 0, red: 0 };
              window.addEventListener('test-locked-picks', (event) => {
                visible = (event as CustomEvent<typeof visible>).detail;
              });
              window.addEventListener('test-final-swap', () => {
                swapped = true;
              });
              const paint = () => {
                ctx.fillStyle = '#111';
                ctx.fillRect(0, 0, width, height);
                for (const { team, i, image, original, x, y } of heroes) {
                  if (!swapped && (watched ? i >= visible[team] : team === side)) continue;
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
                requestAnimationFrame(paint);
              };
              paint();
              return canvas.captureStream(60);
            },
          });
        },
        { lineup, side, icons, picks, watched },
      );
      let pickAck = 0,
        lineupAck = 0;
      const commands = new Map<string, string>();
      page.on('websocket', (ws) => {
        ws.on('framesent', ({ payload }) => {
          const msg = JSON.parse(payload.toString());
          if (msg.type === 'action') commands.set(msg.id, msg.action.type);
        });
        ws.on('framereceived', ({ payload }) => {
          const msg = JSON.parse(payload.toString());
          if (msg.type !== 'ack') return;
          if (commands.get(msg.id) === 'draft_pick_group') pickAck = Date.now();
          if (commands.get(msg.id) === 'set_lineup_assignments') lineupAck = Date.now();
        });
      });
      await page.goto('/control');
      await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/recognize-frame') && r.ok()),
        page.getByRole('button', { name: 'Choose game window', exact: true }).click(),
      ]);
      await expect(page.locator('.window-capture-preview.ready')).toBeVisible();
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
      const started = await page.evaluate(() => {
        window.dispatchEvent(new Event('test-final-swap'));
        return Date.now();
      });
      await expect.poll(() => h.state()[`${side}Picks`], { timeout: 10000 }).toEqual(picks[side]);
      await expect
        .poll(() => h.state()[`${side}Assignments`], { timeout: 10000 })
        .toEqual(lineup[side]);
      await expect.poll(() => lineupAck).toBeGreaterThan(0);
      expect(pickAck).toBeGreaterThanOrEqual(started);
      const reads = await page.evaluate(
        (started) =>
          performance
            .getEntriesByType('resource')
            .filter(
              (r) =>
                r.startTime + performance.timeOrigin >= started &&
                /api\/(recognize-frame|v1\/recognition\/portraits)$/.test(r.name),
            )
            .map((r) => [
              r.name.split('/').at(-1),
              Math.round(r.startTime + performance.timeOrigin - started),
              Math.round(r.duration),
            ]),
        started,
      );
      console.log(
        'Real recognition HTTP (route, start after swap, duration in ms)',
        JSON.stringify(reads),
      );
      console.log(
        `Synthetic swap trigger to durable ACK (real local matcher): final Pick ${pickAck - started} ms, actual lineup ${lineupAck - started} ms`,
      );
    } finally {
      h.close();
    }
  });
