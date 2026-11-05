import { test, expect } from './fixtures';
import { harness } from './harness';
import { openDockPanel } from './dockNavigation';
import heroes from '../src/components/HeroList';
import { phases } from '../src/shared/types';

test('archived role correction updates MVP while the new draft and personal statistics stay isolated', async ({page,baseURL})=>{
  const h=await harness(baseURL);
  try {
    await h.send({type:'reset_match'});
    await h.send({type:'settings',settings:{...h.state(),language:'eng',seriesFormat:'BO3',blueTeam:{...h.state().blueTeam,players:['Alpha','Bravo','Charlie','Delta','Echo']}}});
    await h.fill();await h.send({type:'commit_game'});
    const report=h.state().postGameReports[0],row=report.players[0];
    await h.send({type:'post_game_fields',reportId:report.id,updates:[{rowId:row.rowId,metric:'kills',field:{value:17,manual:true,confidence:1,sourcePage:'summary'}}]});
    await h.send({type:'select_mvp',reportId:report.id,rowId:row.rowId});
    await h.send({type:'score',team:'blue',delta:1});await h.send({type:'next_game'});
    const phase=phases('match')[0];await h.send({type:'draft_action',...phase,heroId:heroes[0].id});
    const live=JSON.stringify([h.state().blueBans,h.state().redBans,h.state().blueAssignments,h.state().currentPhase]);
    await page.goto('/control#token=e2e-control');await openDockPanel(page,'players');
    const lineup=page.getByLabel('Game role lineup');
    await lineup.getByLabel('lineup game',{exact:true}).selectOption(report.id);
    await lineup.getByRole('button',{name:'blue clash player',exact:true}).click();
    await lineup.getByRole('button',{name:'blue farm player',exact:true}).click();
    await expect(lineup.getByLabel('Lineup change preview')).toContainText('Correct archived game 1');
    await lineup.getByRole('button',{name:'Confirm and sync'}).click();
    await expect.poll(()=>h.state().postGameReports[0].players[0].role).toBe('farm');
    expect(h.state().postGameReports[0].players[0].fields.kills?.value).toBe(17);
    expect(JSON.stringify([h.state().blueBans,h.state().redBans,h.state().blueAssignments,h.state().currentPhase])).toBe(live);
    await h.send({type:'post_game_begin',gameId:report.id});
    await page.goto('/overlay/mvp#token=e2e-overlay');
    await expect(page.locator('.mvp-screen-info h2')).toHaveText('Alpha');
    await expect(page.locator('.mvp-screen-team')).toContainText('Farm');
  } finally {h.close();}
});

test('locked BP portrait correction and game role / hero exchanges synchronize without changing pick order', async ({
  page,
  baseURL,
}) => {
  const h = await harness(baseURL);
  try {
    await h.send({ type: 'reset_match' });
    await h.send({
      type: 'settings',
      settings: {
        ...h.state(),
        language: 'eng',
        blueTeam: {
          ...h.state().blueTeam,
          players: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'],
        },
      },
    });
    for (const [index, phase] of phases('match').entries())
      await h.send({ type: 'draft_action', ...phase, heroId: heroes[index].id });
    await page.goto('/control#token=e2e-control');
    await page.getByRole('button', { name: 'Correct blue pick 1', exact: true }).click();
    const replacement = heroes[35];
    const picker = page.getByLabel('Correction hero picker');
    await picker.getByLabel('Search heroes').fill(replacement.englishName);
    await picker.getByRole('button', { name: replacement.englishName, exact: true }).click();
    await picker.getByRole('button', { name: 'Confirm replacement' }).click();
    await expect.poll(() => h.state().bluePicks[0]).toBe(replacement.id);
    const picks = [...h.state().bluePicks];
    await openDockPanel(page, 'players');
    const lineup = page.getByLabel('Game role lineup');
    await lineup.getByRole('button', { name: 'blue clash player', exact: true }).click();
    await lineup.getByRole('button', { name: 'blue farm player', exact: true }).click();
    await lineup.getByRole('button', { name: 'Confirm and sync' }).click();
    await expect.poll(() => h.state().blueGameRoles?.[0]).toBe('farm');
    const before = [...h.state().blueAssignments];
    const source = lineup.getByRole('button', { name: 'blue clash hero', exact: true });
    const target = lineup.getByRole('button', { name: 'blue farm hero', exact: true });
    await page.locator('.flexlayout__tab_button').filter({ hasText: 'Players' }).dblclick();
    await source.scrollIntoViewIfNeeded();
    await expect(source).toBeInViewport();
    await expect(target).toBeInViewport();
    const a = await source.boundingBox(),
      b = await target.boundingBox();
    if (!a || !b) throw new Error('Missing drag targets');
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
    await lineup.getByRole('button', { name: 'Confirm and sync' }).click();
    await expect.poll(() => h.state().blueAssignments[0]).toBe(before[3]);
    expect(h.state().bluePicks).toEqual(picks);
    await lineup.getByRole('button', { name: 'Confirm and lock lineup' }).click();
    await lineup.getByRole('button', { name: 'Confirm and sync' }).click();
    await expect(
      lineup.getByRole('button', { name: 'blue farm player', exact: true }),
    ).toBeDisabled();
    await page.reload();
    await openDockPanel(page, 'players');
    await expect(lineup.getByRole('status')).toContainText('confirmed');
    const overlay = await page.context().newPage();
    await overlay.goto('/overlay/draft#token=e2e-overlay');
    await expect(
      overlay.locator(`.broadcast-card[data-team-id="${h.state().blueTeam.id}"]`).first(),
    ).toContainText(h.state().blueTeam.players[3]);
    await overlay.close();
  } finally {
    h.close();
  }
});

test('narrow touchscreen uses click-source click-target to exchange roles', async ({
  browser,
  baseURL,
}) => {
  const h = await harness(baseURL);
  const context = await browser.newContext({
    viewport: { width: 768, height: 1024 },
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await h.send({ type: 'reset_match' });
    await h.send({ type: 'settings', settings: { ...h.state(), language: 'eng' } });
    for (const [index, phase] of phases('match').entries())
      await h.send({ type: 'draft_action', ...phase, heroId: heroes[index].id });
    await page.goto(baseURL + '/control#token=e2e-control');
    await openDockPanel(page, 'players');
    const lineup = page.getByLabel('Game role lineup');
    await lineup.getByRole('button', { name: 'blue clash player', exact: true }).tap();
    await lineup.getByRole('button', { name: 'blue farm player', exact: true }).tap();
    await lineup.getByRole('button', { name: 'Confirm and sync' }).tap();
    await expect.poll(() => h.state().blueGameRoles?.[0]).toBe('farm');
    expect(h.state().blueTeam.playerRoles[0]).toBe('clash');
    const source = lineup.getByRole('button', { name: 'blue clash player', exact: true });
    const target = lineup.getByRole('button', { name: 'blue farm player', exact: true });
    await source.scrollIntoViewIfNeeded();
    await expect(target).toBeInViewport();
    const a = await source.boundingBox(),
      b = await target.boundingBox();
    if (!a || !b) throw new Error('Missing touch targets');
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: a.x + a.width / 2, y: a.y + a.height / 2 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await lineup.getByRole('button', { name: 'Confirm and sync' }).tap();
    await expect.poll(() => h.state().blueGameRoles?.[0]).toBe('clash');
  } finally {
    h.close();
    await context.close();
  }
});
