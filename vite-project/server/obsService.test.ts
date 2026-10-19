import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultObsConfig } from '../src/shared/obsProtocol.js';
import { ObsService } from './obs/ObsService.js';
import { localObsUrl } from './obs/ObsConfig.js';
import { recordHealth } from './obs/ObsRecordHealth.js';
import { startMockObs } from './testHelpers/mockObs.js';

async function until(check: () => boolean, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!check()) { if (Date.now() > deadline) throw new Error('OBS test condition timed out'); await new Promise(resolve => setTimeout(resolve, 15)); }
}
async function fixture(options: Parameters<typeof startMockObs>[0] = {}, serviceOptions: ConstructorParameters<typeof ObsService>[1] = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hok-obs-'));
  const mock = await startMockObs(options);
  const file = join(root, 'obs-connection.local.json');
  const service = new ObsService(file, { requestTimeoutMs: 500, reconnectMs: 30, pollMs: 60000, diskProbe: async () => 30 * 1024 ** 3, ...serviceOptions });
  const defaults = defaultObsConfig();
  defaults.inputs = { game: 'GameAudio', caster: 'Mic', bgm: 'Music', sfx: 'SFX' };
  defaults.presets.waiting.sceneName = 'Waiting'; defaults.presets.game.sceneName = 'Game'; defaults.presets.mvp.sceneName = 'MVP'; defaults.presets.safe.sceneName = 'Safe';
  for (const preset of Object.values(defaults.presets)) preset.fadeMs = 0;
  const { passwordConfigured: _, ...config } = defaults; void _;
  try { await service.updateConfig({ ...config, enabled: true, url: mock.url, password: mock.password }); }
  catch (error) { await service.close(); await mock.close(); rmSync(root, { recursive: true, force: true }); throw error; }
  return { service, mock, file, async close() { await service.close(); await mock.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('OBS private settings validate loopback/password and never return credentials in public snapshots', async () => {
  const f = await fixture();
  try {
    assert.equal(f.service.getConfig().passwordConfigured, true);
    assert.equal(JSON.stringify(f.service.getSnapshot()).includes(f.mock.password), false);
    assert.equal(JSON.parse(readFileSync(f.file, 'utf8')).password, f.mock.password);
    assert.equal(localObsUrl('ws://localhost:4455'), 'ws://127.0.0.1:4455');
    for (const url of ['http://127.0.0.1:4455', 'ws://192.168.1.2:4455', 'ws://example.com', 'ws://127.0.0.1:4455/private', 'ws://a:b@127.0.0.1:4455', 'ws://127.0.0.1:4455?x=secret']) await assert.rejects(f.service.updateConfig({ url }));
    await assert.rejects(f.service.updateConfig({ clearPassword: true }), /password is required/);
    await assert.rejects(f.service.updateConfig({ passwordConfigured: true }), /Unknown/);
    await assert.rejects(f.service.updateConfig({ inputs: { game: 'Mic', caster: 'Mic', bgm: '', sfx: '' } }), /different input/);
    await f.service.updateConfig({ enabled: false, clearPassword: true });
    assert.equal(f.service.getConfig().passwordConfigured, false);
    await assert.rejects(f.service.connect(), /password first/);
    writeFileSync(f.file, '{"password":"do-not-echo",bad-json');
    const damaged = new ObsService(f.file);
    assert.equal(damaged.getConfig().enabled, false);
    assert.match(damaged.getStatus().lastError ?? '', /saved file was preserved/);
    assert.equal(JSON.stringify(damaged.getSnapshot()).includes('do-not-echo'), false);
    assert.equal(readFileSync(f.file, 'utf8'), '{"password":"do-not-echo",bad-json');
    await damaged.close();
  } finally { await f.close(); }
});

test('actual OBS 5 authentication reads authoritative telemetry and deduplicates only whitelisted scene commands', async () => {
  const f = await fixture();
  try {
    const status = await f.service.connect();
    assert.equal(status.connection, 'connected'); assert.equal(status.sceneName, 'Waiting');
    assert.equal(status.obsVersion, '32.0.1');
    assert.equal(status.recording.active, true); assert.equal(status.streaming.active, true);
    assert.equal(status.recordHealth.directorySource, 'obs'); assert.equal(status.recordHealth.level, 'ok');
    assert.equal(status.inputs.some(i => i.inputName === 'Camera'), false);
    const result = await f.service.command({ id: 'cut-1', type: 'scene', sceneName: 'Draft' });
    assert.equal(result.status, 'succeeded'); assert.equal(f.service.getStatus().sceneName, 'Draft');
    assert.deepEqual(await f.service.command({ id: 'cut-1', type: 'scene', sceneName: 'Draft' }), result);
    assert.equal(f.mock.requests.filter(r => r.requestType === 'SetCurrentProgramScene').length, 1);
    assert.throws(() => f.service.command({ id: 'cut-1', type: 'scene', sceneName: 'MVP' }), /already used/);
    assert.throws(() => f.service.command({ id: 'bad', type: 'request', requestType: 'StopRecord' }), /Unsupported/);
    assert.equal((await f.service.command({ id: 'unknown', type: 'scene', sceneName: 'Fake Scene' })).status, 'failed');
    await assert.rejects(f.service.updateConfig({ inputs: { game: 'GameAudio', caster: 'Mic', bgm: 'Camera', sfx: 'SFX' } }), /existing OBS/);
    f.mock.manualScene('MVP'); await until(() => f.service.getStatus().sceneName === 'MVP');
    await f.service.disconnect();
    assert.equal(f.mock.state.recording, true); assert.equal(f.mock.state.streaming, true);
    assert.equal(f.mock.requests.some(r => /^(Start|Stop|Toggle)/.test(r.requestType)), false);
  } finally { await f.close(); }
});

test('wrong authentication, missing required server authentication and incompatible handshake fail closed', async () => {
  const wrong = await fixture();
  try {
    await wrong.service.updateConfig({ password: 'incorrect-password', reconnect: false });
    await assert.rejects(wrong.service.connect());
    assert.notEqual(wrong.service.getStatus().connection, 'connected');
    assert.equal(wrong.mock.requests.length, 0);
    assert.equal(JSON.stringify(wrong.service.getStatus()).includes('incorrect-password'), false);
  } finally { await wrong.close(); }
  for (const options of [{ authentication: false }, { rpcVersion: 0 }]) {
    const f = await fixture(options);
    try { await f.service.updateConfig({ reconnect: false }); await assert.rejects(f.service.connect()); assert.equal(f.mock.requests.length, 0); }
    finally { await f.close(); }
  }
});

test('manual OBS audio or scene overrides cancel a running preset without cutting back', async () => {
  const f = await fixture();
  try {
    const presets = f.service.getConfig().presets; presets.mvp.fadeMs = 600;
    await f.service.updateConfig({ presets }); await f.service.connect();
    const pending = f.service.command({ id: 'fade-mvp', type: 'preset', preset: 'mvp' });
    await until(() => f.mock.requests.some(r => r.requestType === 'SetInputVolume'));
    f.mock.manualVolume('Music', 0.123);
    assert.equal((await pending).status, 'cancelled');
    assert.equal(f.mock.state.volumes.Music, 0.123);
    assert.equal(f.mock.requests.some(r => r.requestType === 'SetCurrentProgramScene'), false);
    const next = f.service.command({ id: 'fade-mvp-2', type: 'preset', preset: 'mvp' });
    await until(() => f.service.getStatus().lastCommand?.id === 'fade-mvp-2');
    f.mock.manualScene('Draft');
    assert.equal((await next).status, 'cancelled'); assert.equal(f.mock.state.scene, 'Draft');
    assert.equal((await f.service.command({ id: 'mute', type: 'bgm', muted: true })).status, 'succeeded');
    assert.equal(f.service.getStatus().inputs.find(i => i.inputName === 'Music')?.muted, true);
  } finally { await f.close(); }
});

test('Game guards are rechecked after fades and direct game scene commands cannot bypass readiness', async () => {
  let ready = true;
  const f = await fixture({}, { canEnterGame: () => ({ ready, issues: ready ? [] : [{ code: 'identity', message: 'Verify current P1–P5 IDs' }] }) });
  try {
    const presets = f.service.getConfig().presets; presets.game.fadeMs = 300;
    await f.service.updateConfig({ presets }); await f.service.connect();
    const pending = f.service.command({ id: 'enter-game', type: 'preset', preset: 'game' });
    await until(() => f.mock.requests.some(r => r.requestType === 'SetInputVolume')); ready = false;
    assert.equal((await pending).status, 'failed'); assert.equal(f.mock.state.scene, 'Waiting');
    const direct = await f.service.command({ id: 'direct-game', type: 'scene', sceneName: 'Game' });
    assert.equal(direct.status, 'failed'); assert.match(direct.message, /Verify current/);
    ready = true;
    assert.equal((await f.service.command({ id: 'game-now', type: 'scene', sceneName: 'Game' })).status, 'succeeded');
  } finally { await f.close(); }
});

test('response timeout is unconfirmed, reconnect reads actual state and never replays a previous command', async () => {
  const f = await fixture({}, { requestTimeoutMs: 200 });
  try {
    await f.service.connect(); f.mock.ignore.add('SetCurrentProgramScene');
    const command = { id: 'uncertain-cut', type: 'scene' as const, sceneName: 'Draft' };
    const result = await f.service.command(command);
    assert.equal(result.status, 'unconfirmed');
    f.mock.ignore.clear(); f.mock.state.scene = 'MVP';
    await until(() => f.mock.state.connections > 1 && f.service.getStatus().connection === 'connected' && f.service.getStatus().sceneName === 'MVP');
    assert.deepEqual(await f.service.command(command), result);
    assert.equal(f.mock.requests.filter(r => r.requestType === 'SetCurrentProgramScene').length, 1);
    f.mock.drop();
    await until(() => f.mock.state.connections > 2 && f.service.getStatus().connection === 'connected');
    assert.equal(f.mock.state.scene, 'MVP');
  } finally { await f.close(); }
});

test('recording stopped events persist an alert; free-space and estimated-time health warn without modifying OBS outputs', async () => {
  const f = await fixture();
  try {
    await f.service.connect(); f.mock.state.recording = false;
    f.mock.emit('RecordStateChanged', { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED' });
    await until(() => f.service.getStatus().warnings.some(w => w.startsWith('Recording stopped')));
    assert.equal(f.service.getStatus().recording.active, false);
    const low = await recordHealth({ directory: process.cwd(), source: 'obs', lowDiskGb: 10, remainingMinutesWarning: 60, rate: 1024 ** 2, probe: async () => 512 * 1024 ** 2 });
    assert.equal(low.level, 'critical'); assert.ok(low.estimatedMinutes! < 60);
    const unavailable = await recordHealth({ directory: process.cwd(), source: 'manual', lowDiskGb: 10, remainingMinutesWarning: 60, rate: null, probe: async () => { throw new Error('not accessible'); } });
    assert.equal(unavailable.level, 'warning'); assert.equal(unavailable.freeBytes, null);
    const unknown = await recordHealth({ directory: null, source: null, lowDiskGb: 10, remainingMinutesWarning: 60, rate: null, probe: async () => 123 });
    assert.equal(unknown.level, 'unknown');
    assert.equal(f.mock.requests.some(r => /^(Start|Stop|Toggle)/.test(r.requestType)), false);
  } finally { await f.close(); }
});

test('editing bindings preserves the live OBS connection and all four preset audio fades fit within one fade duration', async () => {
  const f = await fixture();
  try {
    await f.service.connect();
    const presets = f.service.getConfig().presets;
    presets.mvp = { sceneName: 'MVP', fadeMs: 300, audio: {
      game: { volume: 0.2, muted: false }, caster: { volume: 0.8, muted: false },
      bgm: { volume: 0.6, muted: false }, sfx: { volume: 0, muted: true },
    } };
    await f.service.updateConfig({ presets });
    assert.equal(f.service.getStatus().connection, 'connected');
    assert.equal(f.mock.state.connections, 1);
    const started = Date.now();
    assert.equal((await f.service.command({ id: 'parallel', type: 'preset', preset: 'mvp' })).status, 'succeeded');
    assert.ok(Date.now() - started < 900, 'parallel 300 ms fades must not serialize into four 300 ms waits');
    assert.equal(f.mock.state.scene, 'MVP');
    assert.equal(f.mock.state.volumes.GameAudio, 0.2); assert.equal(f.mock.state.volumes.Mic, 0.8);
    assert.equal(f.mock.state.volumes.Music, 0.6); assert.equal(f.mock.state.muted.SFX, true);
  } finally { await f.close(); }
});

test('explicit cancel and a failed preset step stop remaining work, preserve actual state, and do not cut the scene', async () => {
  const f = await fixture();
  try {
    const presets = f.service.getConfig().presets; presets.mvp.fadeMs = 600;
    await f.service.updateConfig({ presets }); await f.service.connect();
    const pending = f.service.command({ id: 'cancel-fade', type: 'preset', preset: 'mvp' });
    await until(() => f.mock.requests.some(r => r.requestType === 'SetInputVolume'));
    assert.equal((await f.service.command({ id: 'cancel', type: 'cancel' })).status, 'succeeded');
    assert.equal((await pending).status, 'cancelled');
    assert.equal(f.mock.requests.some(r => r.requestType === 'SetCurrentProgramScene'), false);
    f.mock.fail.set('SetInputVolume', 500);
    const result = await f.service.command({ id: 'failed-step', type: 'preset', preset: 'mvp' });
    assert.equal(result.status, 'failed'); assert.match(result.message, /SetInputVolume failed/);
    assert.equal(f.mock.state.scene, 'Waiting');
    assert.equal(f.service.getStatus().lastCommand?.id, 'failed-step');
    assert.equal(f.mock.state.recording, true);
  } finally { await f.close(); }
});

test('late poll responses cannot overwrite newer scene, audio or recording events', async () => {
  const f = await fixture();
  try {
    await f.service.connect();
    f.mock.delay.set('GetSceneList', 120); f.mock.delay.set('GetInputVolume', 120);
    const initialCount = f.mock.requests.length;
    const refresh = f.service.command({ id: 'refresh-race', type: 'refresh' });
    await until(() => f.mock.requests.slice(initialCount).some(r => r.requestType === 'GetSceneList'));
    f.mock.manualScene('Draft');
    f.mock.state.recording = false; f.mock.emit('RecordStateChanged', { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED' });
    await until(() => f.mock.requests.slice(initialCount).some(r => r.requestType === 'GetInputVolume'));
    f.mock.manualVolume('Music', 0.321);
    assert.equal((await refresh).status, 'succeeded');
    assert.equal(f.service.getStatus().sceneName, 'Draft');
    assert.equal(f.service.getStatus().recording.active, false);
    assert.equal(f.service.getStatus().inputs.find(i => i.inputName === 'Music')?.volume, 0.321);
  } finally { await f.close(); }
});

test('slow disk inspection warns without failing OBS authentication, and unsupported directory lookup uses explicit manual path', async () => {
  const f = await fixture({}, { requestTimeoutMs: 100, diskProbe: () => new Promise<number>(() => {}) });
  try {
    f.mock.fail.set('GetRecordDirectory', 204);
    await f.service.updateConfig({ recordDirectory: process.cwd() });
    const status = await f.service.connect();
    assert.equal(status.connection, 'connected');
    assert.equal(status.recordHealth.directorySource, 'manual');
    assert.equal(status.recordHealth.level, 'warning');
    assert.equal(status.recordHealth.freeBytes, null);
    assert.match(status.recordHealth.warnings.join(' '), /Cannot inspect/);
  } finally { await f.close(); }
});
