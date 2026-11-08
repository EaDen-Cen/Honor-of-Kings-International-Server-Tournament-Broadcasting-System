import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, utimesSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { maintainGeneratedStorage } from './storageMaintenance.js';

const DAY = 86_400_000;
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'hok-storage-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'vite-project' }));
  const put = (relative: string, daysOld: number) => {
    const file = join(root, relative);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, 'evidence');
    const date = new Date(Date.now() - DAY * daysOld);
    utimesSync(file, date, date);
    return file;
  };
  return { root, put };
}

test('dry run reports generated artifacts but never deletes anything', (t) => {
  const { root, put } = fixture(t);
  const generated = put('artifacts/e2e-smoke/old.png', 30);
  const match = put('data/match.json', 90);
  const backup = put('data/backups/backup-2026.json', 90);
  const log = put('artifacts/server.log', 90);
  const report = maintainGeneratedStorage(root);
  assert.equal(report.eligible, 1);
  assert.equal(report.removed, 0);
  for (const f of [generated, match, backup, log]) assert.equal(existsSync(f), true);
});

test('automatic cleanup removes only expired known generated output', (t) => {
  const { root, put } = fixture(t);
  const old = put('artifacts/e2e-regression/test.png', 28);
  const oldCi = put('artifacts/ci/build.log', 31);
  const oldReport = put('playwright-report/index.html', 28);
  const fresh = put('artifacts/e2e-regression/new.png', 1);
  const unknown = put('artifacts/operator-notes.txt', 200);
  const protectedFile = put('public/playerImg/portrait.png', 200);
  const retained = put('artifacts/ci/.keep', 200);
  const result = maintainGeneratedStorage(root, { apply: true });
  assert.equal(result.removed, 3);
  assert.equal(result.reclaimedBytes, 3 * 'evidence'.length);
  for (const f of [old, oldCi, oldReport]) assert.equal(existsSync(f), false);
  for (const f of [fresh, unknown, protectedFile, retained]) assert.equal(existsSync(f), true);
});

test('never follows symlinks into match data, even from a generated directory', (t) => {
  const { root, put } = fixture(t);
  const match = put('data/match.json', 100);
  const folder = join(root, 'artifacts/e2e-test');
  mkdirSync(folder, { recursive: true });
  try { symlinkSync(join(root, 'data'), join(folder, 'escape'), 'dir'); }
  catch { t.skip('Symlink creation requires OS privileges'); return; }
  const result = maintainGeneratedStorage(root, { apply: true });
  assert.ok(result.skippedLinks >= 1);
  assert.equal(readFileSync(match, 'utf8'), 'evidence');
});

test('invalid roots and unsafe age or deletion limits are rejected', (t) => {
  const { root } = fixture(t);
  assert.throws(() => maintainGeneratedStorage(join(root, 'data')), /storage root/);
  assert.throws(() => maintainGeneratedStorage(root, { apply: true, ageDays: 0 }), /Unsafe/);
  assert.throws(() => maintainGeneratedStorage(root, { apply: true, maxDeletes: 100_000 }), /Unsafe/);
});

test('deletion cap protects against unexpected bulk cleanup', (t) => {
  const { root, put } = fixture(t);
  const a = put('test-results/old-a.log', 60);
  const b = put('test-results/old-b.log', 60);
  const report = maintainGeneratedStorage(root, { apply: true, maxDeletes: 1 });
  assert.equal(report.removed, 1);
  assert.equal(report.limited, true);
  assert.notEqual(existsSync(a), existsSync(b));
});
