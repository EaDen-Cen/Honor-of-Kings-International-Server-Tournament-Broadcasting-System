import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { panelNames, presetLayout, restoreLayout } from '../src/control/workspaceLayout.js';
test('every built-in workspace restores with all real panels once', () => {
  for (const id of ['default', 'bp', 'live', 'postgame'] as const) {
    const restored = restoreLayout({ version: 1, layout: presetLayout(id) });
    assert.ok(restored);
    for (const panel of Object.keys(panelNames))
      assert.equal(JSON.stringify(restored).split('"component":"' + panel + '"').length - 1, 1);
  }
});
test('unknown versions, components, duplicate tabs and popouts fall back', () => {
  assert.equal(restoreLayout({ version: 2, layout: presetLayout('default') }), undefined);
  const bad = presetLayout('default');
  bad.layout.children = [
    { type: 'tabset', children: [{ type: 'tab', id: 'evil', component: 'evil' }] },
  ];
  assert.equal(restoreLayout({ version: 1, layout: bad }), undefined);
  const duplicated = presetLayout('default');
  duplicated.layout.children.push(duplicated.layout.children[0]);
  assert.equal(restoreLayout({ version: 1, layout: duplicated }), undefined);
});
