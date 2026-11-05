import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultShortcuts,
  validateShortcuts,
  shortcutForEvent,
} from '../src/shared/workspaceShortcuts.js';
import { operatorPreferenceKey } from '../src/shared/operatorPreferences.js';
test('custom workspace shortcuts reject duplicates/reserved simple chords and persist through preference allowlist', () => {
  assert.deepEqual(validateShortcuts(defaultShortcuts), defaultShortcuts);
  assert.throws(() => validateShortcuts({ ...defaultShortcuts, 'postgame-tools': 'Ctrl+Alt+1' }));
  for (const value of ['Ctrl+W', 'Alt+F4', 'Enter', 'Ctrl+Alt+😀', 1])
    assert.throws(() => validateShortcuts({ ...defaultShortcuts, 'postgame-tools': value }));
  assert.equal(
    validateShortcuts({ ...defaultShortcuts, 'postgame-tools': '' })['postgame-tools'],
    '',
  );
  assert.equal(
    shortcutForEvent({
      code: 'KeyK',
      ctrlKey: true,
      altKey: true,
      shiftKey: false,
      metaKey: false,
    }),
    'Ctrl+Alt+K',
  );
  assert.equal(
    shortcutForEvent({
      code: 'Digit1',
      ctrlKey: false,
      altKey: true,
      shiftKey: true,
      metaKey: false,
    }),
    'Alt+Shift+1',
  );
  assert.equal(
    shortcutForEvent({ code: 'KeyK', ctrlKey: true, altKey: true, shiftKey: true, metaKey: false }),
    '',
  );
  assert.equal(operatorPreferenceKey('hok-workspace-shortcuts-v1'), true);
});
