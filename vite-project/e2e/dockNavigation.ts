import type { Page } from '@playwright/test';
const labels = {
  hud: /^(Live GHUD|局内 GHUD)$/,
  postgame: /^(Post-game|赛后数据)$/,
  recovery: /^(Backup & recovery|备份与恢复)$/,
  obs: /^(OBS director|OBS 导播)$/,
  players: /^(Players|玩家管理)$/,
};
/** Use the same visible menu as an operator; do not force-click hidden tools. */
export async function openDockPanel(page: Page, id: keyof typeof labels) {
  const menu = page.locator('.dock-panel-menu');
  if ((await menu.getAttribute('open')) === null) await menu.locator('summary').click();
  await menu.getByRole('button', { name: labels[id] }).click();
  await menu.locator('summary').click();
}
