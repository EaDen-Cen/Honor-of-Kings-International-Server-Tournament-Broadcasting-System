import {
  lstatSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
} from 'node:fs';
import { resolve, relative, sep, join } from 'node:path';

/**
 * Only generated test/CI output is eligible for unattended deletion.
 *
 * Deliberately EXCLUDED: data/, data/backups/, uploaded portraits, cached
 * broadcast artwork, node_modules/, dist/, OBS recordings, all top-level
 * runtime artifacts (including live logs and tunnel/process metadata).
 */
export interface StorageMaintenanceOptions {
  apply?: boolean;
  now?: number;
  ageDays?: number;
  maxDeletes?: number;
  maxBytes?: number;
}
export interface StorageMaintenanceReport {
  scanned: number;
  eligible: number;
  removed: number;
  eligibleBytes: number;
  reclaimedBytes: number;
  skippedLinks: number;
  failed: number;
  limited: boolean;
}

interface Candidate { path: string; modified: number; bytes: number }
const DAY_MS = 86_400_000;
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;

function isInside(root: string, file: string) {
  const rel = relative(root, file);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !rel.startsWith(sep);
}

function safeFileType(path: string) {
  try { return lstatSync(path); } catch { return undefined; }
}

/** Never accept an arbitrary directory that is not an actual vite-project checkout. */
function assertProjectRoot(root: string) {
  const stat = safeFileType(root);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw Error('Invalid storage root');
  const manifest = join(root, 'package.json');
  if (safeFileType(manifest)?.isSymbolicLink()) throw Error('Unsafe package manifest');
  const packageJson = JSON.parse(readFileSync(manifest, 'utf8'));
  if (packageJson.name !== 'vite-project') throw Error('Not a HOK vite-project directory');
}

export function maintainGeneratedStorage(
  projectRoot: string,
  options: StorageMaintenanceOptions = {},
): StorageMaintenanceReport {
  const root = resolve(projectRoot);
  assertProjectRoot(root);
  const now = options.now ?? Date.now();
  const ageDays = options.ageDays ?? 14;
  const maxDeletes = options.maxDeletes ?? 500;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isFinite(now) || !Number.isInteger(ageDays) || ageDays < 7 ||
      !Number.isInteger(maxDeletes) || maxDeletes < 1 || maxDeletes > 5000 ||
      !Number.isFinite(maxBytes) || maxBytes < 1 || maxBytes > 2 * 1024 ** 3) {
    throw Error('Unsafe storage maintenance settings');
  }
  const report: StorageMaintenanceReport = {
    scanned: 0, eligible: 0, removed: 0, eligibleBytes: 0,
    reclaimedBytes: 0, skippedLinks: 0, failed: 0, limited: false,
  };
  const cutoff = now - ageDays * DAY_MS;
  const candidates: Candidate[] = [];
  const parents = new Set<string>();
  const dirs: string[] = [];
  const appendScope = (path: string) => {
    if (isInside(root, path) && safeFileType(path)?.isDirectory() &&
        !safeFileType(path)?.isSymbolicLink()) dirs.push(path);
  };

  // No recursive scan of the user's match data, source, images or OBS files.
  appendScope(resolve(root, 'artifacts/ci'));
  appendScope(resolve(root, 'test-results'));
  appendScope(resolve(root, 'playwright-report'));
  const artifacts = resolve(root, 'artifacts');
  if (safeFileType(artifacts)?.isDirectory() && !safeFileType(artifacts)?.isSymbolicLink()) {
    for (const entry of readdirSync(artifacts, { withFileTypes: true })) {
      if (/^e2e-[a-zA-Z0-9_-]{1,80}$/.test(entry.name) && entry.isDirectory() &&
          !entry.isSymbolicLink()) appendScope(resolve(artifacts, entry.name));
    }
  }

  const walk = (dir: string, depth = 0) => {
    if (depth > 12 || report.scanned >= 50_000) { report.limited = true; return; }
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { report.failed++; return; }
    for (const entry of entries) {
      if (report.scanned >= 50_000) { report.limited = true; return; }
      const full = resolve(dir, entry.name);
      if (!isInside(root, full)) continue;
      report.scanned++;
      const stats = safeFileType(full);
      if (!stats) { report.failed++; continue; }
      if (stats.isSymbolicLink()) { report.skippedLinks++; continue; }
      if (stats.isDirectory()) { walk(full, depth + 1); parents.add(full); continue; }
      if (!stats.isFile() || stats.mtimeMs > cutoff) continue;
      // Hidden retain markers are never generated scratch files.
      if (entry.name === '.gitkeep' || entry.name === '.keep') continue;
      candidates.push({ path: full, modified: stats.mtimeMs, bytes: stats.size });
    }
  };
  for (const dir of dirs) { walk(dir); parents.add(dir); }
  candidates.sort((a, b) => a.modified - b.modified);
  report.eligible = candidates.length;
  report.eligibleBytes = candidates.reduce((sum, c) => sum + c.bytes, 0);

  let budget = maxBytes;
  for (const item of candidates) {
    if (report.removed >= maxDeletes || item.bytes > budget) { report.limited = true; continue; }
    if (options.apply !== true) continue;
    const stats = safeFileType(item.path);
    // Revalidate immediately before removal; never follow a replaced symlink
    // or remove a file recently rewritten by a concurrent test run.
    if (!stats?.isFile() || stats.isSymbolicLink() || stats.mtimeMs > cutoff ||
        stats.size !== item.bytes) continue;
    try {
      unlinkSync(item.path);
      report.removed++;
      report.reclaimedBytes += item.bytes;
      budget -= item.bytes;
    } catch { report.failed++; }
  }
  if (options.apply === true) {
    for (const folder of [...parents].sort((a, b) => b.length - a.length)) {
      const stats = safeFileType(folder);
      if (!stats?.isDirectory() || stats.isSymbolicLink()) continue;
      try { if (readdirSync(folder).length === 0) rmdirSync(folder); }
      catch { /* In-use, freshly populated and permission-protected folders stay. */ }
    }
  }
  return report;
}


export interface StorageFolderUsage {
  bytes: number;
  files: number;
  directories: number;
}
export interface StorageInventory {
  categories: Record<string, StorageFolderUsage>;
  skippedLinks: number;
  truncated: boolean;
}

/** Read-only local inventory. Returns aggregate sizes, never user filenames or secrets. */
export function inspectLocalStorage(projectRoot: string, maxEntries = 200_000): StorageInventory {
  const root = resolve(projectRoot);
  assertProjectRoot(root);
  const categories: Record<string, StorageFolderUsage> = {};
  const report: StorageInventory = { categories, skippedLinks: 0, truncated: false };
  const scopes = ['node_modules', 'dist', 'data', 'artifacts', 'public',
    'test-results', 'playwright-report'];
  let seen = 0;
  const traverse = (path: string, usage: StorageFolderUsage, depth: number) => {
    if (seen >= maxEntries || depth > 25) { report.truncated = true; return; }
    const stats = safeFileType(path);
    if (!stats) return;
    if (stats.isSymbolicLink()) { report.skippedLinks++; return; }
    seen++;
    if (stats.isFile()) { usage.bytes += stats.size; usage.files++; return; }
    if (!stats.isDirectory()) return;
    usage.directories++;
    let names: string[];
    try { names = readdirSync(path); } catch { report.truncated = true; return; }
    for (const name of names) {
      if (seen >= maxEntries) { report.truncated = true; return; }
      const child = resolve(path, name);
      if (isInside(root, child)) traverse(child, usage, depth + 1);
    }
  };
  for (const scope of scopes) {
    const stats = safeFileType(resolve(root, scope));
    const usage: StorageFolderUsage = { bytes: 0, files: 0, directories: 0 };
    if (stats && !stats.isSymbolicLink())
      traverse(resolve(root, scope), usage, 0);
    categories[scope] = usage;
  }
  return report;
}
