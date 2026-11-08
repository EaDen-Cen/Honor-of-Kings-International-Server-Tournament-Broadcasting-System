import {
  lstat,
  realpath,
  opendir,
  readFile,
  writeFile,
  mkdir,
  rename,
  unlink,
  open,
} from 'node:fs/promises';
import { resolve, relative, sep, basename, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';

export interface StorageConfig {
  enabled: boolean;
  retentionDays: number;
  intervalHours: number;
}
export interface Artifact {
  path: string;
  size: number;
  mtimeMs: number;
  dev: number;
  ino: number;
  sha256: string;
  createdAt: number;
  producer: 'playwright';
}
export interface StorageRow {
  path: string;
  bytes: number;
  files: number;
  category: string;
  purpose: string;
  reclaimable: number;
}
export interface CleanupItem {
  path: string;
  bytes: number;
  reason: string;
  eligible: boolean;
}
export interface StoragePreview {
  root: string;
  id: string;
  at: number;
  retentionDays: number;
  rows: StorageRow[];
  items: CleanupItem[];
  reclaimable: number;
  partial: boolean;
  notes: string[];
}
export interface CleanupResult {
  deletedFiles: { path: string; bytes: number; reason: string }[];
  at: number;
  deleted: number;
  bytes: number;
  skipped: { path: string; reason: string }[];
  deferred?: string;
}
const allowed = /^(artifacts|test-results|playwright-report)\//;
const generated = /\.(png|jpg|jpeg|webm|zip|html|css|js)$/i;
const limits = { files: 200, bytes: 256 * 1024 * 1024, entries: 100000, milliseconds: 5000 };
const slash = (s: string) => s.split(sep).join('/');
const inside = (root: string, target: string) => {
  const r = relative(root, target);
  return (
    !!r &&
    r !== '..' &&
    !r.startsWith('..' + sep) &&
    !resolve(target).startsWith('\\\\') &&
    !r.includes(':')
  );
};
/** Never follows a junction/symlink, including any ancestor of the project. */
export async function safeStoragePath(root: string, name: string) {
  const path = resolve(root, name);
  if (!inside(root, path)) throw Error('outside-root');
  for (let p = path; ; p = dirname(p)) {
    const s = await lstat(p);
    if (s.isSymbolicLink()) throw Error('link-or-junction');
    if (p === dirname(p)) break;
  }
  if (resolve(await realpath(path)).toLowerCase() !== path.toLowerCase())
    throw Error('redirected-path');
  return path;
}
const fingerprint = async (path: string) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
const identity = (a: Artifact, b: Awaited<ReturnType<typeof lstat>>) =>
  b.isFile() &&
  b.nlink === 1 &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.dev === b.dev &&
  a.ino === b.ino;
const reason = (e: unknown) =>
  e instanceof Error && ['link-or-junction', 'outside-root', 'redirected-path'].includes(e.message)
    ? e.message
    : 'unavailable-or-changing';

/** Called by the producer after closing its output, never by directory-age discovery. */
export async function registerTestArtifact(root: string, file: string, now = Date.now()) {
  const name = slash(relative(root, resolve(root, file)));
  if (!allowed.test(name) || !generated.test(name)) return;
  const path = await safeStoragePath(root, name),
    stat = await lstat(path);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > limits.bytes) return;
  const artifact: Artifact = {
    path: name,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    dev: stat.dev,
    ino: stat.ino,
    sha256: await fingerprint(path),
    createdAt: now,
    producer: 'playwright',
  };
  const directory = resolve(root, '.maintenance/receipts');
  try {
    await safeStoragePath(root, '.maintenance');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    await mkdir(resolve(root, '.maintenance'), { recursive: true });
  }
  await mkdir(directory, { recursive: true });
  await safeStoragePath(root, '.maintenance/receipts');
  const receipt = resolve(directory, createHash('sha256').update(name).digest('hex') + '.json');
  const temporary = receipt + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(artifact), { mode: 0o600, flag: 'wx' });
  await rename(temporary, receipt);
}

function category(name: string) {
  if (['data', 'public'].includes(name)) return ['protected', '比赛资料 / 备份 / 上传素材'];
  if (
    ['node_modules', 'dist', 'server', 'src', '.git'].includes(name) ||
    /model|tessdata/i.test(name)
  )
    return ['required', '依赖 / 源码 / 模型 / 版本记录'];
  if (['artifacts', 'test-results', 'playwright-report'].includes(name))
    return ['generated', '测试产物（只有生成凭据核验通过才可清理）'];
  return ['unknown', '用途未证明，禁止自动清理'];
}
export class StorageMaintenance {
  config: StorageConfig = { enabled: false, retentionDays: 14, intervalHours: 24 };
  history: CleanupResult[] = [];
  private preview?: StoragePreview;
  private busy = false;
  private nextRun = 0;
  constructor(
    readonly root: string,
    private configFile: string,
    private references: () => Promise<string>,
    private activity: (automatic?: boolean) => Promise<string | undefined>,
    private now = Date.now,
  ) {}
  async load() {
    try {
      const data = JSON.parse(await readFile(this.configFile, 'utf8'));
      this.validate(data.config);
      this.config = data.config;
      this.history = Array.isArray(data.history) ? data.history.slice(-20) : [];
      this.nextRun =
        (this.history.find((h) => !h.deferred)?.at ?? 0) + this.config.intervalHours * 3600000;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
        throw Error('Storage settings unreadable; preserve file and repair');
    }
  }
  private validate(value: StorageConfig) {
    if (
      !value ||
      typeof value.enabled !== 'boolean' ||
      !Number.isInteger(value.retentionDays) ||
      value.retentionDays < 1 ||
      value.retentionDays > 365 ||
      !Number.isInteger(value.intervalHours) ||
      value.intervalHours < 1 ||
      value.intervalHours > 168
    )
      throw Error('Invalid retention (1–365 days) or interval (1–168 hours)');
  }
  private async save() {
    await mkdir(dirname(this.configFile), { recursive: true });
    await writeFile(
      this.configFile + '.tmp',
      JSON.stringify({ config: this.config, history: this.history }),
      { mode: 0o600 },
    );
    await rename(this.configFile + '.tmp', this.configFile);
  }
  async configure(value: StorageConfig) {
    this.validate(value);
    if (this.busy) throw Error('Maintenance busy');
    this.busy = true;
    const previous = this.config;
    this.config = {
      enabled: value.enabled,
      retentionDays: value.retentionDays,
      intervalHours: value.intervalHours,
    };
    try {
      await this.save();
      this.preview = undefined;
      this.nextRun =
        (this.history.find((h) => !h.deferred)?.at ?? 0) + this.config.intervalHours * 3600000;
    } catch (e) {
      this.config = previous;
      throw e;
    } finally {
      this.busy = false;
    }
  }
  private async receipts() {
    const entries: Artifact[] = [];
    try {
      const path = await safeStoragePath(this.root, '.maintenance/receipts');
      for await (const item of await opendir(path)) {
        if (entries.length >= 10000) throw Error('Too many receipts; manual inspection required');
        if (!item.name.endsWith('.json')) continue;
        const file = await safeStoragePath(this.root, '.maintenance/receipts/' + item.name);
        if ((await lstat(file)).size > 4096) throw Error('Invalid artifact receipt');
        const a = JSON.parse(await readFile(file, 'utf8')) as Artifact;
        if (
          a.producer !== 'playwright' ||
          typeof a.path !== 'string' ||
          !allowed.test(a.path) ||
          slash(relative(this.root, resolve(this.root, a.path))) !== a.path ||
          !generated.test(a.path) ||
          !Number.isFinite(a.createdAt) ||
          !Number.isFinite(a.size) ||
          a.size < 0 ||
          a.size > limits.bytes ||
          !/^[a-f0-9]{64}$/.test(a.sha256)
        )
          throw Error('Invalid artifact receipt');
        entries.push(a);
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    return entries;
  }
  private async qualify(a: Artifact, refs: string, hash = false): Promise<string | undefined> {
    try {
      const path = await safeStoragePath(this.root, a.path);
      if (
        refs.includes(a.path.toLowerCase()) ||
        refs.includes(basename(a.path).toLowerCase()) ||
        refs.includes(path.toLowerCase())
      )
        return 'referenced-by-match-or-backup';
      try {
        await lstat(path + '.keep');
        return 'manually-retained';
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      const stat = await lstat(path);
      if (!identity(a, stat)) return 'changed-or-being-written';
      if (this.now() - Math.max(a.createdAt, stat.mtimeMs) < this.config.retentionDays * 86400000)
        return 'within-retention';
      if (hash && (await fingerprint(path)) !== a.sha256) return 'content-changed';
    } catch (e) {
      return reason(e);
    }
  }
  async inspect(): Promise<StoragePreview> {
    if (this.busy) throw Error('Maintenance busy');
    this.busy = true;
    try {
      const rows = new Map<string, StorageRow>(),
        notes: string[] = [],
        start = performance.now();
      let count = 0,
        partial = false;
      const walk = async (directory: string, group?: string): Promise<void> => {
        for await (const entry of await opendir(directory)) {
          if (++count > limits.entries || performance.now() - start > limits.milliseconds) {
            partial = true;
            return;
          }
          const name = group ?? entry.name;
          if (!rows.has(name)) {
            const [kind, purpose] = category(name);
            rows.set(name, {
              path: name,
              bytes: 0,
              files: 0,
              category: kind,
              purpose,
              reclaimable: 0,
            });
          }
          const path = resolve(directory, entry.name),
            row = rows.get(name)!;
          try {
            const stat = await lstat(path);
            if (stat.isSymbolicLink()) {
              notes.push(slash(relative(this.root, path)) + ': link skipped');
              continue;
            }
            if (stat.isDirectory()) {
              await safeStoragePath(this.root, relative(this.root, path));
              await walk(path, name);
            } else if (stat.isFile()) {
              row.bytes += stat.size;
              row.files++;
            }
          } catch {
            notes.push(slash(relative(this.root, path)) + ': unreadable');
          }
          if (count % 100 === 0) await pause(2);
          if (partial) return;
        }
      };
      await walk(this.root);
      let refs = '';
      let referenceError = false;
      try {
        refs = (await this.references()).toLowerCase();
      } catch {
        referenceError = true;
        notes.push('Protected references unavailable; all cleanup disabled');
      }
      const items: CleanupItem[] = [];
      for (const a of await this.receipts()) {
        const why = referenceError
          ? 'protected-references-unavailable'
          : await this.qualify(a, refs);
        items.push({
          path: a.path,
          bytes: a.size,
          eligible: !why,
          reason: why ?? 'producer-receipt-and-expired',
        });
        if (!why) {
          const row = rows.get(a.path.split('/')[0]);
          if (row) row.reclaimable += a.size;
        }
      }
      this.preview = {
        root: this.root,
        id: randomUUID(),
        at: this.now(),
        retentionDays: this.config.retentionDays,
        rows: [...rows.values()].sort((a, b) => b.bytes - a.bytes),
        items,
        reclaimable: items.filter((i) => i.eligible).reduce((n, i) => n + i.bytes, 0),
        partial,
        notes: notes.slice(0, 100),
      };
      return this.preview;
    } finally {
      this.busy = false;
    }
  }
  async clean(id: string, automatic = false): Promise<CleanupResult> {
    if (this.busy) throw Error('Maintenance busy');
    const preview = this.preview;
    if (!preview || preview.id !== id || this.now() - preview.at > 300000)
      throw Error('Preview expired; inspect again');
    this.busy = true;
    this.preview = undefined;
    const result: CleanupResult = {
      at: this.now(),
      deleted: 0,
      bytes: 0,
      skipped: [],
      deletedFiles: [],
    };
    let lock: Awaited<ReturnType<typeof open>> | undefined;
    const lockPath = resolve(this.root, '.maintenance/cleanup.lock');
    try {
      const active = await this.activity(automatic);
      if (active) {
        result.deferred = active;
        return result;
      }
      await mkdir(dirname(lockPath), { recursive: true });
      await safeStoragePath(this.root, '.maintenance');
      lock = await open(lockPath, 'wx');
      const receipts = new Map((await this.receipts()).map((a) => [a.path, a]));
      const start = performance.now();
      for (const item of preview.items.filter((i) => i.eligible)) {
        if (
          result.deleted >= limits.files ||
          result.bytes + item.bytes > limits.bytes ||
          performance.now() - start > limits.milliseconds
        ) {
          result.skipped.push({ path: item.path, reason: 'run-limit' });
          continue;
        }
        const active = await this.activity(automatic);
        if (active) {
          result.deferred = active;
          break;
        }
        const a = receipts.get(item.path);
        if (!a) {
          result.skipped.push({ path: item.path, reason: 'missing-receipt' });
          continue;
        }
        const refs = (await this.references()).toLowerCase();
        let why = await this.qualify(a, refs, true);
        if (!why) {
          await pause(25);
          why = await this.qualify(a, (await this.references()).toLowerCase());
        }
        if (why) {
          result.skipped.push({ path: a.path, reason: why });
          continue;
        }
        try {
          // No recursive delete: recheck every ancestor immediately before unlink.
          const path = await safeStoragePath(this.root, a.path);
          if (!identity(a, await lstat(path))) throw Error('changed');
          await unlink(path);
          result.deleted++;
          result.bytes += a.size;
          result.deletedFiles.push({
            path: a.path,
            bytes: a.size,
            reason: 'producer-receipt-and-expired',
          });
          const receiptName =
            '.maintenance/receipts/' + createHash('sha256').update(a.path).digest('hex') + '.json';
          await safeStoragePath(this.root, receiptName)
            .then(unlink)
            .catch(() => {});
        } catch (e) {
          result.skipped.push({ path: a.path, reason: reason(e) });
        }
      }
      return result;
    } finally {
      if (lock) {
        await lock.close();
        await unlink(lockPath).catch(() => {});
      }
      this.history = [result, ...this.history].slice(0, 20);
      try {
        await this.save();
      } finally {
        this.busy = false;
      }
    }
  }
  async tick() {
    if (!this.config.enabled || this.busy || this.now() < this.nextRun) return;
    const active = await this.activity(true);
    if (active) return;
    const preview = await this.inspect();
    const result = await this.clean(preview.id, true);
    if (!result.deferred) this.nextRun = this.now() + this.config.intervalHours * 3600000;
  }
}

/** Include historical/recovery JSON too; unknown/unreadable evidence fails closed. */
export async function storageReferences(directory: string): Promise<string> {
  let text = '',
    bytes = 0,
    entries = 0;
  const start = performance.now();
  const walk = async (path: string): Promise<void> => {
    for await (const entry of await opendir(path)) {
      if (++entries > 2000 || performance.now() - start > 5000)
        throw Error('Protected reference scan limit; cleanup disabled');
      const file = resolve(path, entry.name),
        stat = await lstat(file);
      if (stat.isSymbolicLink()) throw Error('Protected data contains a link; cleanup disabled');
      if (stat.isDirectory() && !['uploads', 'logs'].includes(entry.name)) await walk(file);
      else if (entry.name.endsWith('.json') && !entry.name.startsWith('storage-maintenance')) {
        bytes += stat.size;
        if (bytes > 64 * 1024 * 1024)
          throw Error('Protected reference scan limit; cleanup disabled');
        const content = await readFile(file, 'utf8');
        JSON.parse(content);
        text += content + '\n';
      }
    }
  };
  try {
    await lstat(directory);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    return '';
  }
  await walk(directory);
  return text;
}
