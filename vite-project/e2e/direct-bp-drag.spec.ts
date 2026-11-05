import { test, expect } from './fixtures';
import { harness } from './harness';
import heroes from '../src/components/HeroList';
import { phases } from '../src/shared/types';

test('dragging a gallery portrait corrects an early locked Ban without advancing the draft', async ({
  page,
  baseURL,
}) => {
  const h = await harness(baseURL);
  try {
    await h.send({ type: 'reset_match' });
    await h.send({
      type: 'settings',
      settings: { ...h.state(), language: 'eng', firstPickSide: 'blue' },
    });
    for (const [index, phase] of phases('match').slice(0, 2).entries())
      await h.send({ type: 'draft_action', ...phase, heroId: heroes[index].id });
    const before = h.state().currentPhase,
      original = h.state().blueBans[0],
      replacement = heroes[35];
    await page.goto('/control#token=e2e-control');
    await page
      .locator('.flexlayout__tab_button')
      .filter({ hasText: 'Match / BP preview' })
      .dblclick();
    const target = page.getByRole('button', { name: 'Correct blue ban 1', exact: true });
    await target.click();
    const picker = page.getByLabel('Correction hero picker');
    await picker.getByLabel('Search heroes').fill(replacement.englishName);
    const source = picker.getByRole('button', { name: replacement.englishName, exact: true });
    await source.scrollIntoViewIfNeeded();
    await expect(target).toBeInViewport();
    const a = await source.boundingBox(),
      b = await target.boundingBox();
    if (!a || !b) throw new Error('Missing gallery drag targets');
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await expect(target).toHaveClass(/direct-drop-target/);
    await page.mouse.up();
    await expect(source).toHaveAttribute('aria-pressed', 'true');
    await picker.getByRole('button', { name: 'Confirm replacement' }).click();
    await expect.poll(() => h.state().blueBans[0]).toBe(replacement.id);
    expect(h.state().currentPhase).toBe(before);
    await h.send({ type: 'undo' });
    expect(h.state().blueBans[0]).toBe(original);
    expect(h.state().currentPhase).toBe(before);
  } finally {
    h.close();
  }
});
