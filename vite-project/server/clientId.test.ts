import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClientUUID } from '../src/shared/clientId.js';
import { TeamPresetStore } from './teamPresets.js';
import { initialState } from '../src/shared/types.js';

test('entity UUIDs without secure-context randomUUID remain valid for saved substitutes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hok-lan-ids-'));
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    for (const crypto of [{ getRandomValues: webcrypto.getRandomValues.bind(webcrypto) }, undefined]) {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: crypto });
      const ids = Array.from({ length: 100 }, () => createClientUUID());
      assert.equal(new Set(ids).size, ids.length);
      assert(ids.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)));
      const store = new TeamPresetStore(join(directory, 'teams.json'));
      const saved = store.create({ ...initialState().blueTeam, substitutes: [{ id: ids[0], name: 'Reserve', role: 'roam', portrait: '' }] });
      assert.equal(saved.substitutes[0].id, ids[0]);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
    if (original) Object.defineProperty(globalThis, 'crypto', original);
    else Reflect.deleteProperty(globalThis, 'crypto');
  }
});
