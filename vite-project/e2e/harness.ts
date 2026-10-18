import { expect } from '@playwright/test';
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import {heroesForPool} from '../src/shared/heroPool';
import { pickRestriction, banRestriction } from '../src/shared/draftRules';
import { phases, type Action, type Snapshot } from '../src/shared/types';

export async function harness(baseURL: string | undefined) {
  expect(baseURL).toBe('http://127.0.0.1:3101');
  const ws = new WebSocket('ws://127.0.0.1:3101/ws');
  let snapshot: Snapshot;
  const waiting = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  await new Promise<void>((resolve, reject) => {
    ws.on('error', reject);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: 'e2e-control' })));
    ws.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'match_state_update') { snapshot = message; resolve(); }
      const pending = waiting.get(message.id);
      if (pending && message.type === 'ack') { waiting.delete(message.id); pending.resolve(); }
      if (pending && message.type === 'error') { waiting.delete(message.id); pending.reject(new Error(message.error)); }
    });
  });
  const send = async (action: Action) => {
    await new Promise(r => setTimeout(r, 50));
    await new Promise<void>((resolve, reject) => {
      const id = randomUUID(), timer = setTimeout(() => { waiting.delete(id); reject(new Error('Action timed out')); }, 10000);
      waiting.set(id, { resolve: () => { clearTimeout(timer); resolve(); }, reject: error => { clearTimeout(timer); reject(error); } });
      ws.send(JSON.stringify({ type: 'action', id, revision: snapshot.revision, action }));
    });
  };
  const fill = async () => {
    while (!snapshot.state.draftComplete) {
      const state = snapshot.state, phase = phases(state.draftMode, state.firstPickSide,state.banCount)[state.currentPhase];
      const used = [...state.blueBans, ...state.redBans, ...state.bluePicks, ...state.redPicks];
      const hero = heroesForPool(state.heroPool).find(h => !used.includes(h.id) && (phase.action === 'ban' ? !banRestriction(state, phase.team, h.id) : !pickRestriction(state, phase.team, state[`${phase.team}Picks`].length, h.id)));
      if(!hero)throw new Error(`No legal hero for ${phase.team} ${phase.action} at phase ${state.currentPhase}`);
      await send({ type: 'draft_action', ...phase, heroId: hero.id });
    }
  };
  return { send, fill, state: () => snapshot.state, close: () => ws.close() };
}

