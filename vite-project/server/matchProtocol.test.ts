import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchActionId, isMatchSnapshot, parseMatchMessage } from '../src/shared/matchProtocol.js';
import { initialState } from '../src/shared/types.js';
import { Store } from './store.js';

test('every role snapshot and the legacy draft shape pass the transport boundary', () => {
  const store = new Store();
  for (const role of ['control', 'caster', 'overlay'] as const) {
    const snapshot = store.snapshot(role);
    assert(isMatchSnapshot(snapshot));
    assert.deepEqual(parseMatchMessage(JSON.stringify(snapshot)), snapshot);
  }
  const legacy = { type: 'match_state_update', revision: 0, state: {
    blueTeam: { id: 'a', name: 'A', logo: '', players: [] }, redTeam: { id: 'b', name: 'B', logo: '', players: [] },
    blueScore: 0, redScore: 0, gameNumber: 1, seriesFormat: 'BO3', stage: '', language: 'zh', overlayLayout: 'panel',
    draftMode: 'match', currentPhase: 0, draftComplete: false, blueBans: [], redBans: [], bluePicks: [], redPicks: [],
  } };
  assert(isMatchSnapshot(legacy), 'legacy shape remains available for the backend upgrade notice');
});

test('malformed state structures never reach rendering, including nested lists and fields', () => {
  const snapshot = { type: 'match_state_update', revision: 4, state: initialState() };
  const mutations: Array<(value: Record<string, unknown>) => void> = [
    value => { value.state = null; },
    value => { value.revision = '4'; },
    value => { value.revision = -1; },
    value => { (value.state as Record<string, unknown>).draftHistory = {}; },
    value => { (value.state as Record<string, unknown>).blueTeam = []; },
    value => { (value.state as Record<string, unknown>).bluePicks = [null]; },
    value => { (value.state as Record<string, unknown>).blueBans = ['not-a-hero']; },
    value => { (value.state as Record<string, unknown>).blueAssignments = [true]; },
    value => { (value.state as Record<string, unknown>).heroArtOverrides = { 1: { panel: { x: null, y: 0, scale: 1 } } }; },
    value => { (value.state as Record<string, unknown>).postGameReports = [null]; },
    value => { (value.state as Record<string, unknown>).liveGameStats = { ...initialState().liveGameStats, neutralObjectives: [null] }; },
    value => { (value.state as Record<string, unknown>).blueTeam = { ...initialState().blueTeam, players: [null] }; },
  ];
  for (const mutate of mutations) {
    const invalid: Record<string, unknown> = structuredClone(snapshot);
    mutate(invalid);
    assert.equal(isMatchSnapshot(invalid), false);
    assert.equal(parseMatchMessage(JSON.stringify(invalid)), undefined);
  }
  assert.equal(isMatchSnapshot({ ...snapshot, revision: Infinity }), false);
  assert.equal(isMatchSnapshot({ ...snapshot, revision: Number.MAX_SAFE_INTEGER + 1 }), false);
});

test('socket envelopes require known types and typed identifiers and tokens', () => {
  for (const message of ['{broken', 'null', '[]', '{}', '{"type":"unknown"}', '{"type":"ack"}', '{"type":"ack","id":2}', '{"type":"access_token_update","token":{}}', '{"type":"access_token_update","token":" "}', '{"type":"error","error":{}}', '{"type":"error","error":"bad","id":2}']) {
    assert.equal(parseMatchMessage(message), undefined);
  }
  assert.equal(parseMatchMessage(new Uint8Array()), undefined);
  assert.deepEqual(parseMatchMessage('{"type":"pong"}'), { type: 'pong' });
  assert.deepEqual(parseMatchMessage('{"type":"error","error":"bad"}'), { type: 'error', error: 'bad', id: undefined });
  assert.deepEqual(parseMatchMessage('{"type":"ack","id":"action-123"}'), { type: 'ack', id: 'action-123' });
  assert.deepEqual(parseMatchMessage('{"type":"ack","id":"action-123","revision":12}'), { type: 'ack', id: 'action-123', revision: 12 });
  for (const revision of [-1, 1.5, '12', null]) assert.equal(parseMatchMessage(JSON.stringify({type:'ack',id:'action-123',revision})), undefined);
  assert.deepEqual(parseMatchMessage('{"type":"access_token_update","token":"rotated"}'), { type: 'access_token_update', token: 'rotated' });
});

test('LAN HTTP action IDs remain unique and valid without secure-context randomUUID', () => {
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  try {
    const ids = Array.from({ length: 1000 }, () => createMatchActionId());
    assert.equal(new Set(ids).size, ids.length);
    assert(ids.every(id => /^[a-zA-Z0-9-]{8,100}$/.test(id)));
    const store = new Store();
    store.apply(ids[0], 0, { type: 'delay', seconds: 0 });
    assert.equal(store.snapshot('control').revision, 1);
  } finally {
    if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
    else Reflect.deleteProperty(globalThis, 'crypto');
  }
});
