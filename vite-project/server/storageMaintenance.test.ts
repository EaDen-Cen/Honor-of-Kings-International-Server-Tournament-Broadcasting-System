import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  realpath,
  mkdir,
  writeFile,
  readFile,
  rm,
  utimes,
  symlink,
  appendFile,
  link,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  StorageMaintenance,
  registerTestArtifact,
  storageReferences,
} from './storageMaintenance.js';

test('failed settings writes stay disabled; deferred automatic cleanup retries and survives restart', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'hok-schedule-'));
  try {
    await writeFile(join(root, 'blocked'), 'file');
    const broken = new StorageMaintenance(
      root,
      join(root, 'blocked/settings.json'),
      async () => '',
      async () => undefined,
    );
    await assert.rejects(broken.configure({ enabled: true, retentionDays: 14, intervalHours: 1 }));
    assert.equal(broken.config.enabled, false);
    let now = Date.now(),
      calls = 0,
      defer = true;
    const config = join(root, 'data/storage-maintenance.json');
    const service = new StorageMaintenance(
      root,
      config,
      async () => '',
      async (automatic) => {
        assert.equal(automatic, true);
        return defer && ++calls === 2 ? 'match-active' : undefined;
      },
      () => now,
    );
    await service.configure({ enabled: true, retentionDays: 14, intervalHours: 24 });
    await service.tick();
    assert.equal(service.history[0].deferred, 'match-active');
    defer = false;
    await service.tick();
    assert.equal(service.history.length, 2);
    assert.equal(service.history[0].deferred, undefined);
    await service.tick();
    assert.equal(service.history.length, 2, 'successful task respects its interval');
    now += 2 * 3600000;
    await service.configure({ enabled: true, retentionDays: 14, intervalHours: 1 });
    await service.tick();
    assert.equal(service.history.length, 3, 'new interval takes effect');
    const restored = new StorageMaintenance(
      root,
      config,
      async () => '',
      async () => undefined,
      () => now,
    );
    await restored.load();
    await restored.tick();
    assert.equal(restored.history.length, 3, 'restart preserves last run deadline');
    await mkdir(join(root, '.maintenance/receipts'), { recursive: true });
    await writeFile(
      join(root, '.maintenance/receipts/invalid.json'),
      JSON.stringify({
        producer: 'playwright',
        path: 'artifacts/../node_modules/model.png',
        size: 1,
        createdAt: 0,
        sha256: 'a'.repeat(64),
      }),
    );
    await assert.rejects(restored.inspect(), /Invalid artifact receipt/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('hardlinks and file symlinks are protected; each deletion run is bounded', async (t) => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'hok-storage-bounds-')),
    old = Date.now() - 30 * 86400000;
  try {
    await mkdir(join(root, 'artifacts'));
    const file = join(root, 'artifacts/original.png');
    await writeFile(file, 'x');
    await utimes(file, old / 1000, old / 1000);
    await registerTestArtifact(root, file, old);
    await link(file, join(root, 'outside-hardlink.png'));
    let symbolic = true;
    try {
      await symlink(file, join(root, 'artifacts/link.png'), 'file');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EPERM') throw e;
      symbolic = false;
      t.diagnostic(
        'Windows file symlink privilege unavailable; junction regression still runs separately',
      );
    }
    const service = new StorageMaintenance(
      root,
      join(root, 'data/storage-maintenance.json'),
      async () => '',
      async () => undefined,
    );
    assert.equal((await service.clean((await service.inspect()).id)).deleted, 0);
    assert.equal(await readFile(file, 'utf8'), 'x');
    if (symbolic)
      await assert.rejects(registerTestArtifact(root, 'artifacts/link.png', old), /link/);
    for (let i = 0; i < 205; i++) {
      const path = join(root, `artifacts/frame-${i}.png`);
      await writeFile(path, 'x');
      await utimes(path, old / 1000, old / 1000);
      await registerTestArtifact(root, path, old);
    }
    const result = await service.clean((await service.inspect()).id);
    assert.ok(result.deleted > 0 && result.deleted <= 200);
    assert.ok(result.skipped.some((s) => s.reason === 'run-limit'));
    assert.equal(result.bytes, result.deleted);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cleanup requires producer receipt, expiry, no references, unchanged content and fresh preview', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'hok-storage-')),
    now = Date.now(),
    old = now - 30 * 86400000;
  let refs = '',
    active: string | undefined;
  const service = new StorageMaintenance(
    root,
    join(root, 'data/storage-maintenance.json'),
    async () => refs,
    async () => active,
    () => now,
  );
  const make = async (name: string, registered = true, at = old) => {
    const file = join(root, name);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, 'sample');
    await utimes(file, at / 1000, at / 1000);
    if (registered) await registerTestArtifact(root, file, at);
    return file;
  };
  try {
    const temporary = await make('artifacts/test.png');
    const evidence = await make('artifacts/evidence.png');
    refs = JSON.stringify({ postGameReports: [{ evidence: 'artifacts/evidence.png' }] });
    const fresh = await make('test-results/fresh.png', true, now);
    const writing = await make('test-results/writing.png');
    const kept = await make('artifacts/retained.png');
    await writeFile(kept + '.keep', '');
    const unknown = await make('artifacts/unknown.png', false);
    const data = await make('data/match.png');
    const preview = await service.inspect();
    assert.equal(
      preview.items.find((i) => i.path.endsWith('evidence.png'))?.reason,
      'referenced-by-match-or-backup',
    );
    assert.equal((await readFile(temporary)).toString(), 'sample', 'preview never deletes');
    await appendFile(writing, 'active write');
    const result = await service.clean(preview.id);
    assert.equal(result.deleted, 1);
    assert.equal(result.bytes, 6);
    assert.deepEqual(
      result.deletedFiles.map((f) => f.path),
      ['artifacts/test.png'],
    );
    assert.equal(
      result.skipped.find((s) => s.path.endsWith('writing.png'))?.reason,
      'changed-or-being-written',
    );
    for (const file of [evidence, fresh, writing, kept, unknown, data]) await readFile(file);
    await assert.rejects(readFile(temporary));
    await assert.rejects(service.clean(preview.id), /Preview/);
    assert.equal((await service.clean((await service.inspect()).id)).deleted, 0);
    active = 'match-active';
    assert.equal((await service.clean((await service.inspect()).id)).deferred, 'match-active');
    await service.configure({ enabled: true, retentionDays: 14, intervalHours: 1 });
    await service.tick();
    const restored = new StorageMaintenance(
      root,
      join(root, 'data/storage-maintenance.json'),
      async () => refs,
      async () => undefined,
    );
    await restored.load();
    assert.equal(restored.config.enabled, true);
    assert.ok(restored.history.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Windows junctions and symlinks cannot redirect scan or deletion even after preview', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'hok-links-')),
    outside = await mkdtemp(join(await realpath(tmpdir()), 'hok-outside-'));
  const at = Date.now() - 30 * 86400000;
  const service = new StorageMaintenance(
    root,
    join(root, 'data/storage-maintenance.json'),
    async () => '',
    async () => undefined,
  );
  try {
    await mkdir(join(root, 'artifacts/sub'), { recursive: true });
    await writeFile(join(root, 'artifacts/sub/frame.png'), 'inside');
    await utimes(join(root, 'artifacts/sub/frame.png'), at / 1000, at / 1000);
    await registerTestArtifact(root, 'artifacts/sub/frame.png', at);
    const p = await service.inspect();
    await writeFile(join(outside, 'frame.png'), 'outside');
    await rm(join(root, 'artifacts/sub'), { recursive: true });
    await symlink(
      outside,
      join(root, 'artifacts/sub'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const result = await service.clean(p.id);
    assert.equal(result.deleted, 0);
    assert.equal(result.skipped[0].reason, 'link-or-junction');
    assert.equal(await readFile(join(outside, 'frame.png'), 'utf8'), 'outside');
    const scan = await service.inspect();
    assert.ok(scan.notes.some((n) => n.includes('link skipped')));
    await assert.rejects(registerTestArtifact(root, 'artifacts/sub/frame.png', at), /link/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('historical backup references and malformed protected JSON fail closed', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'hok-reference-'));
  try {
    await mkdir(join(root, 'backups'));
    await writeFile(join(root, 'backups/old.json'), JSON.stringify({ evidence: 'old.png' }));
    assert.match(await storageReferences(root), /old.png/);
    await writeFile(join(root, 'match.json'), '{broken');
    await assert.rejects(storageReferences(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
