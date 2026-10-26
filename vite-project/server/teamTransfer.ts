import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { MAX_PORTRAIT_BYTES } from './portraits.js';
import { TeamPresetStore, validateImportedTeams, type LibraryImportConflict } from './teamPresets.js';
import type { TeamPreset } from '../src/shared/types.js';

const FORMAT = 'hok-team-library-v1';
const MAX_ASSETS = 2000;
const MAX_BYTES = 96 * 1024 * 1024;
const LOCAL_PREFIX = '/uploads/player-portraits/';
type Asset = { url: string; base64: string; sha256: string };
export type TeamLibraryBundle = {
  format: typeof FORMAT;
  createdAt: string;
  teams: TeamPreset[];
  assets: Asset[];
  externalAssets: string[];
};

const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
const assetFields = (team: TeamPreset) => [
  team.logo,
  ...team.playerPortraits,
  ...team.substitutes.map(player => player.portrait),
].filter(Boolean);

function isStoredAsset(url: string) {
  return /^\/uploads\/player-portraits\/[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$/.test(url);
}
function isBundledPublicAsset(url: string) {
  try {
    const decoded = decodeURIComponent(url);
    return /^\/(?:teamLogo|playerImg)\/[^/.][^/\\]*\.(?:png|jpg|jpeg|webp)$/i.test(decoded) &&
      !decoded.includes('..') && !/[\x00-\x1f]/.test(decoded);
  } catch { return false; }
}
function localFile(url: string, uploads: string, publicRoot: string): string | undefined {
  if (isStoredAsset(url)) return resolve(uploads, url.slice(LOCAL_PREFIX.length));
  if (isBundledPublicAsset(url)) return resolve(publicRoot, decodeURIComponent(url).slice(1));
}
function collectAssets(teams: TeamPreset[]) {
  return [...new Set(teams.flatMap(assetFields))].filter(Boolean);
}

/** Exports only team records and referenced local artwork, never access tokens, matches or secrets. */
export function exportTeamLibrary(presets: TeamPresetStore, uploads: string, publicRoot: string): TeamLibraryBundle {
  const teams = presets.list();
  const assets: Asset[] = [], externalAssets: string[] = [];
  let bytes = 0;
  for (const url of collectAssets(teams)) {
    const file = localFile(url, uploads, publicRoot);
    if (!file) { externalAssets.push(url); continue; }
    if (!existsSync(file)) throw new Error('teamTransferMissingAsset');
    const buffer = readFileSync(file);
    bytes += buffer.length;
    if (buffer.length > MAX_PORTRAIT_BYTES || bytes > MAX_BYTES || assets.length >= MAX_ASSETS) throw new Error('teamTransferTooLarge');
    assets.push({url,base64:buffer.toString('base64'),sha256:sha256(buffer)});
  }
  return {format:FORMAT,createdAt:new Date().toISOString(),teams,assets,externalAssets};
}

async function validateBundle(input: unknown) {
  const data = input as TeamLibraryBundle;
  if (!data || data.format !== FORMAT || !Array.isArray(data.teams) ||
    !Array.isArray(data.assets) || data.assets.length > MAX_ASSETS ||
    !Array.isArray(data.externalAssets) || data.externalAssets.length > MAX_ASSETS ||
    typeof data.createdAt !== 'string') throw new Error('teamTransferInvalid');
  const teams = validateImportedTeams(data.teams);
  const refs = new Set(collectAssets(teams));
  const expected = new Set<string>();
  for (const ref of refs) if (isStoredAsset(ref) || isBundledPublicAsset(ref)) expected.add(ref);
  const decoded = new Map<string, {buffer:Buffer;extension:string}>();
  let bytes = 0;
  for (const asset of data.assets) {
    if (!asset || typeof asset.url !== 'string' || !expected.has(asset.url) || decoded.has(asset.url) ||
      typeof asset.base64 !== 'string' || asset.base64.length % 4 !== 0 ||
      asset.base64.length > Math.ceil(MAX_PORTRAIT_BYTES / 3) * 4 + 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.base64) || typeof asset.sha256 !== 'string') throw new Error('teamTransferInvalid');
    const buffer = Buffer.from(asset.base64, 'base64');
    bytes += buffer.length;
    if (buffer.length === 0 || buffer.length > MAX_PORTRAIT_BYTES || bytes > MAX_BYTES) throw new Error('teamTransferTooLarge');
    if (sha256(buffer) !== asset.sha256 || buffer.toString('base64') !== asset.base64) throw new Error('teamTransferInvalid');
    try {
      // Fully decode the image (not just metadata), so corrupt archives cannot poison the library.
      const source = sharp(buffer, {limitInputPixels:25_000_000,failOn:'error'});
      const info = await source.metadata();
      if (!['png','jpeg','webp'].includes(info.format) || !info.width || !info.height) throw new Error();
      await source.raw().toBuffer();
      decoded.set(asset.url, {buffer,extension:info.format === 'jpeg' ? 'jpg' : info.format});
    } catch { throw new Error('teamTransferInvalid'); }
  }
  if (decoded.size !== expected.size) throw new Error('teamTransferMissingAsset');
  const externalAssets = [...refs].filter(ref => !expected.has(ref));
  return {teams,decoded,externalAssets};
}

/** Preview validates the archive without touching the database or uploaded images. */
export async function previewTeamLibrary(input: unknown, presets: TeamPresetStore) {
  const {teams,decoded,externalAssets} = await validateBundle(input);
  const current = new Set(presets.list().map(team => team.id));
  return {
    teams: teams.length,
    images: decoded.size,
    newTeams: teams.filter(team => !current.has(team.id)).length,
    conflicts: teams.filter(team => current.has(team.id)).length,
    externalAssets,
  };
}

/** Import local images first, then merge all teams in one atomic store write; roll back new images on error. */
export async function importTeamLibrary(
  input: unknown, presets: TeamPresetStore, uploads: string, conflict: LibraryImportConflict,
) {
  if (!['skip','replace'].includes(conflict)) throw new Error('teamTransferInvalid');
  const {teams,decoded,externalAssets} = await validateBundle(input);
  const existing = new Set(presets.list().map(team => team.id));
  const selected = teams.filter(team => conflict === 'replace' || !existing.has(team.id));
  const needed = new Set(collectAssets(selected));
  const rewritten = new Map<string,string>(), created: string[] = [];
  try {
    mkdirSync(uploads,{recursive:true});
    for (const [url,asset] of decoded) {
      if (!needed.has(url)) continue;
      const name = `${randomUUID()}.${asset.extension}`;
      const file = resolve(uploads,name);
      writeFileSync(file,asset.buffer,{flag:'wx',mode:0o600});
      created.push(file);
      rewritten.set(url,`${LOCAL_PREFIX}${name}`);
    }
    const normalize = (url:string) => rewritten.get(url) ?? url;
    const changed = selected.map(team => ({
      ...team,
      logo:normalize(team.logo),
      playerPortraits:team.playerPortraits.map(normalize),
      substitutes:team.substitutes.map(player => ({...player,portrait:normalize(player.portrait)})),
    }));
    const result = presets.importBatch(changed, 'replace');
    const skipped = teams.length - selected.length;
    return {...result,skipped,images:created.length,externalAssets};
  } catch (error) {
    for (const file of created) rmSync(file,{force:true});
    throw error;
  }
}
