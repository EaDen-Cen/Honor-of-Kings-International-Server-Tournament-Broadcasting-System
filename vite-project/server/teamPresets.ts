import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Team, TeamPreset, ReservePlayer } from '../src/shared/types.js';

function asset(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1000 || /[\s\\]/.test(value) || [...value].some(c => c.charCodeAt(0) < 32)) return false;
  if (!value || /^\/(?!\/)/.test(value)) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password; } catch { return false; }
}
function fields(input: unknown): Omit<Team, 'id'> {
  if (!input || typeof input !== 'object') throw new Error('presetInvalid');
  const t = input as Team;
  if (typeof t.name !== 'string' || !t.name.trim() || t.name.length > 60 || !asset(t.logo) ||
    !Array.isArray(t.players) || t.players.length !== 5 || t.players.some(p => typeof p !== 'string' || p.length > 40) ||
    !Array.isArray(t.playerRoles) || t.playerRoles.length !== 5 || t.playerRoles.some(r => !['clash','jungle','mid','farm','roam'].includes(r)) ||
    !Array.isArray(t.playerPortraits) || t.playerPortraits.length !== 5 || t.playerPortraits.some(p => !asset(p))) throw new Error('presetInvalid');
  return structuredClone({name:t.name.trim(),logo:t.logo,players:t.players,playerRoles:t.playerRoles,playerPortraits:t.playerPortraits});
}
function substitutes(value: unknown): ReservePlayer[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new Error('substitutesInvalid');
  const result = value.map(p => {
    if (!p || typeof p.id !== 'string' || !/^[0-9a-f-]{36}$/.test(p.id) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 40 || !['clash','jungle','mid','farm','roam'].includes(p.role) || !asset(p.portrait)) throw new Error('substitutesInvalid');
    return {id:p.id,name:p.name.trim(),role:p.role,portrait:p.portrait};
  });
  if (new Set(result.map(p => p.id)).size !== result.length || new Set(result.map(p => p.name.trim().toLocaleLowerCase())).size !== result.length) throw new Error('substitutesInvalid');
  return result;
}
export type LibraryImportConflict = 'skip' | 'replace';

/** Parse every incoming team before performing filesystem writes. */
export function validateImportedTeams(input: unknown): TeamPreset[] {
  if (!Array.isArray(input) || input.length > 300) throw new Error('teamTransferInvalid');
  const ids = new Set<string>();
  return input.map(value => {
    const team = value as TeamPreset;
    if (!team || typeof team.id !== 'string' || !/^team-[0-9a-f-]{36}$/.test(team.id) ||
      !Number.isSafeInteger(team.createdAt) || !Number.isSafeInteger(team.updatedAt) ||
      team.createdAt < 0 || team.updatedAt < team.createdAt || ids.has(team.id)) throw new Error('teamTransferInvalid');
    ids.add(team.id);
    return {...fields(team),substitutes:substitutes(team.substitutes),id:team.id,createdAt:team.createdAt,updatedAt:team.updatedAt};
  });
}

export class TeamPresetStore {
  private teams: TeamPreset[] = [];
  constructor(private file: string) {
    if (existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.teams)) throw new Error('Invalid team library');
      this.teams = saved.teams.map((t: TeamPreset) => {
        if (typeof t.id !== 'string' || !/^team-[0-9a-f-]{36}$/.test(t.id) || !Number.isFinite(t.createdAt) || !Number.isFinite(t.updatedAt)) throw new Error('Invalid team library');
        return { ...fields(t), substitutes:substitutes(t.substitutes), id:t.id, createdAt:t.createdAt, updatedAt:t.updatedAt };
      });
      if (new Set(this.teams.map(t => t.id)).size !== this.teams.length) throw new Error('Duplicate team identity');
    }
  }
  list() { return structuredClone(this.teams); }
  get(id: string) { return this.list().find(t => t.id === id); }
  private persist(teams: TeamPreset[]) {
    mkdirSync(dirname(this.file), {recursive:true});
    const fd = openSync(this.file + '.tmp', 'w');
    try { writeFileSync(fd, JSON.stringify({version:1,teams}, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(this.file + '.tmp', this.file);
    this.teams = teams;
  }
  create(input: unknown) {
    const now = Date.now();
    const team = {...fields(input),substitutes:substitutes((input as TeamPreset)?.substitutes),id:`team-${randomUUID()}`,createdAt:now,updatedAt:now};
    this.persist([...this.teams,team]); return structuredClone(team);
  }
  update(id: string, input: unknown) {
    const previous = this.get(id); if (!previous) throw new Error('presetMissing');
    const team = {...fields(input),substitutes:substitutes((input as TeamPreset)?.substitutes ?? previous.substitutes),id,createdAt:previous.createdAt,updatedAt:Date.now()};
    this.persist(this.teams.map(t => t.id === id ? team : t)); return structuredClone(team);
  }
  importBatch(input: unknown, conflict: LibraryImportConflict) {
    if (!['skip', 'replace'].includes(conflict)) throw new Error('teamTransferInvalid');
    const incoming = validateImportedTeams(input);
    const current = new Map(this.teams.map(t => [t.id,t]));
    let added = 0, replaced = 0, skipped = 0;
    for (const team of incoming) {
      if (current.has(team.id)) {
        if (conflict === 'skip') { skipped++; continue; }
        replaced++;
      } else added++;
      current.set(team.id, team);
    }
    if (added || replaced) this.persist([...current.values()]);
    return {added,replaced,skipped,total:this.teams.length};
  }
  delete(id: string) {
    if (!this.get(id)) throw new Error('presetMissing');
    this.persist(this.teams.filter(t => t.id !== id));
  }
}
