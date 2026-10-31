import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { ObsBridge, validateLocalObsUrl } from './obsBridge.js';

test('OBS bridge refuses a remote WebSocket endpoint before connecting', () => {
  assert.throws(() => validateLocalObsUrl('ws://example.com:4455/'), /must be/);
  assert.throws(() => validateLocalObsUrl('wss://127.0.0.1:4455/'), /must be/);
  assert.throws(() => validateLocalObsUrl('ws://127.0.0.1:4455/private'), /must be/);
  const optional = new ObsBridge('ws://remote.example.com:4455', 'secret');
  assert.equal(optional.configured, true);
  optional.close();
});

test('OBS WebSocket v5 authenticates locally, reports recording, and confirms scene switching', async () => {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => wss.once('listening', resolve));
  const address = wss.address();
  if (!address || typeof address === 'string') throw new Error('Missing test WS port');
  const challenge = 'test-challenge',
    salt = 'test-salt',
    password = 'test-password';
  const digest = (value: string) => createHash('sha256').update(value).digest('base64');
  const expected = digest(digest(password + salt) + challenge);
  let scene = 'BP',
    authenticated = false,
    musicVolume = 0.65,
    otherVolume = 0;
  wss.on('connection', (socket) => {
    socket.send(
      JSON.stringify({
        op: 0,
        d: { obsWebSocketVersion: '5.5.0', rpcVersion: 1, authentication: { challenge, salt } },
      }),
    );
    socket.on('message', (raw) => {
      const packet = JSON.parse(raw.toString()) as {
        op: number;
        d: {
          authentication?: string;
          requestId?: string;
          requestType?: string;
          requestData?: { sceneName?: string; inputName?: string; inputVolumeMul?: number };
        };
      };
      if (packet.op === 1) {
        assert.equal(packet.d.authentication, expected);
        authenticated = true;
        socket.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
      }
      if (packet.op === 6) {
        let responseData: Record<string, unknown> = {};
        if (packet.d.requestType === 'GetSceneList')
          responseData = {
            scenes: [{ sceneName: 'BP' }, { sceneName: 'Game' }],
            currentProgramSceneName: scene,
          };
        else if (packet.d.requestType === 'GetRecordStatus') responseData = { outputActive: true };
        else if (packet.d.requestType === 'GetRecordDirectory') responseData = { recordDirectory: 'E:\\OBS-Recordings' };
        else if (packet.d.requestType === 'GetInputList')
          responseData = {
            inputs: [{ inputName: 'Music' }, { inputName: 'OtherMusic' }, { inputName: 'Video' }],
          };
        else if (packet.d.requestType === 'GetSceneItemList')
          responseData = {
            sceneItems: [
              { sourceName: 'Draft Overlay', sceneItemIndex: 0, sceneItemEnabled: true },
              { sourceName: 'Game Capture', sceneItemIndex: 1, sceneItemEnabled: true },
            ],
          };
        else if (packet.d.requestType === 'GetInputSettings')
          responseData =
            packet.d.requestData?.inputName === 'Draft Overlay'
              ? {
                  inputKind: 'browser_source',
                  inputSettings: {
                    url: 'http://localhost/private#token=never-expose',
                    width: 1920,
                    height: 1080,
                  },
                }
              : { inputKind: 'game_capture', inputSettings: {} };
        else if (packet.d.requestType === 'GetInputVolume') {
          if (!['Music', 'OtherMusic'].includes(packet.d.requestData?.inputName || '')) {
            socket.send(
              JSON.stringify({
                op: 7,
                d: {
                  requestId: packet.d.requestId,
                  requestStatus: { result: false, code: 600, comment: 'Not an audio input' },
                },
              }),
            );
            return;
          }
          responseData = {
            inputVolumeMul: packet.d.requestData?.inputName === 'Music' ? musicVolume : otherVolume,
          };
        } else if (packet.d.requestType === 'SetInputVolume') {
          if (packet.d.requestData?.inputName === 'Music')
            musicVolume = packet.d.requestData.inputVolumeMul!;
          else if (packet.d.requestData?.inputName === 'OtherMusic')
            otherVolume = packet.d.requestData.inputVolumeMul!;
          else throw new Error('Unexpected input');
        } else if (packet.d.requestType === 'SetCurrentProgramScene') {
          scene = packet.d.requestData?.sceneName || scene;
          socket.send(
            JSON.stringify({
              op: 5,
              d: { eventType: 'CurrentProgramSceneChanged', eventData: { sceneName: scene } },
            }),
          );
        }
        socket.send(
          JSON.stringify({
            op: 7,
            d: {
              requestId: packet.d.requestId,
              requestStatus: { result: true, code: 100 },
              responseData,
            },
          }),
        );
      }
    });
  });
  const bridge = new ObsBridge(`ws://127.0.0.1:${address.port}`, password);
  try {
    const first = await bridge.status();
    assert.equal(authenticated, true);
    assert.equal(first.programScene, 'BP');
    assert.equal(first.recording, true);
    assert.equal(await bridge.recordDirectory(), 'E:\\OBS-Recordings');
    assert.deepEqual(first.scenes, ['BP', 'Game']);
    await assert.rejects(() => bridge.switchScene('Nonexistent'), /not present/);
    const changed = await bridge.switchScene('Game');
    assert.equal(changed.programScene, 'Game');
    assert.equal(changed.recording, true);
    assert.deepEqual(await bridge.audioInputs(), [
      { name: 'Music', volume: 0.65 },
      { name: 'OtherMusic', volume: 0 },
    ]);
    const layout = await bridge.browserSourceLayout('BP');
    assert.deepEqual(layout, [
      { name: 'Draft Overlay', enabled: true, index: 0, width: 1920, height: 1080 },
    ]);
    assert.equal(JSON.stringify(layout).includes('never-expose'), false);
    await assert.rejects(() => bridge.browserSourceLayout('Unknown'), /not present/);
    await assert.rejects(() => bridge.fadeInput('Music', -1, 1000), /0 and 200/);
    await assert.rejects(() => bridge.fadeInput('Music', 0, 6000), /0–5000/);
    assert.equal(await bridge.fadeInput('Music', 0, 400), 0);
    assert.equal(await bridge.fadeInput('Music', 0.65, 0), 0.65);
    const old = bridge.fadeInput('Music', 0, 500).catch((error) => error.message);
    await new Promise((resolve) => setTimeout(resolve, 120));
    await bridge.switchScene('BP');
    assert.equal(await bridge.fadeInput('Music', 0.4, 100), 0.4);
    assert.match(await old, /replaced/);
    await bridge.crossfade('Music', 'OtherMusic', 0.7, 100);
    assert.equal(musicVolume, 0);
    assert.equal(otherVolume, 0.7);
    await assert.rejects(bridge.crossfade('Music', 'Music', 1, 100), /different/);
    assert.equal((await bridge.status()).recording, true);
  } finally {
    bridge.close();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  }
});
