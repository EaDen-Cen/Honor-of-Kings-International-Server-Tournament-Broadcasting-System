import { createHash } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
const hash = (value: string) => createHash('sha256').update(value).digest('base64');

/** Actual OBS 5 JSON frames over an OS-assigned loopback WebSocket port. */
export async function startMockObs(options: { authentication?: boolean; password?: string; rpcVersion?: number } = {}) {
  const password = options.password ?? 'mock-obs-password';
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mock OBS did not bind');
  const requests: Array<{ requestType: string; requestData: Record<string, unknown> }> = [];
  const ignore = new Set<string>(), fail = new Map<string, number>(), delay = new Map<string, number>();
  const state = { scene: 'Waiting', scenes: ['Waiting', 'Draft', 'Game', 'MVP', 'Safe'],
    volumes: { Music: 0.5, GameAudio: 1, Mic: 1, SFX: 1 } as Record<string, number>,
    muted: { Music: false, GameAudio: false, Mic: false, SFX: false } as Record<string, boolean>,
    recording: true, paused: false, streaming: true, bytes: 200000, duration: 10000, directory: process.cwd(), connections: 0 };
  const emit = (eventType: string, eventData: Record<string, unknown>, socket?: WebSocket) => {
    for (const client of socket ? [socket] : server.clients) if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ op: 5, d: { eventType, eventIntent: 1, eventData } }));
  };
  server.on('connection', socket => {
    state.connections++;
    let identified = false;
    socket.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.6.3', rpcVersion: options.rpcVersion ?? 1,
      ...(options.authentication === false ? {} : { authentication: { salt: 'mock-salt', challenge: 'mock-challenge' } }) } }));
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.op === 1) {
        if (options.authentication !== false && message.d.authentication !== hash(hash(password + 'mock-salt') + 'mock-challenge')) { socket.close(4009, 'Authentication failed'); return; }
        identified = true;
        socket.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } })); return;
      }
      if (message.op !== 6 || !identified) return;
      const { requestType, requestId, requestData = {} } = message.d;
      requests.push({ requestType, requestData });
      if (ignore.has(requestType)) return;
      let responseData: Record<string, unknown> = {}, code = fail.get(requestType) ?? 100;
      if (code === 100) switch (requestType) {
      case 'GetVersion': responseData = { obsVersion: '32.0.1', obsWebSocketVersion: '5.6.3', rpcVersion: 1, availableRequests: [], supportedImageFormats: [], platform: 'windows', platformDescription: 'Mock OBS' }; break;
      case 'GetSceneList': responseData = { currentProgramSceneName: state.scene, currentPreviewSceneName: null, scenes: state.scenes.map((sceneName, sceneIndex) => ({ sceneName, sceneIndex })) }; break;
      case 'GetCurrentProgramScene': responseData = { sceneName: state.scene, sceneUuid: 'mock-scene' }; break;
      case 'GetInputList': responseData = { inputs: [...Object.keys(state.volumes).map(inputName => ({ inputName, inputKind: 'wasapi_input_capture' })), { inputName: 'Camera', inputKind: 'dshow_input' }] }; break;
      case 'GetInputVolume': if (!(requestData.inputName in state.volumes)) code = 604; else responseData = { inputVolumeMul: state.volumes[requestData.inputName], inputVolumeDb: -6 }; break;
      case 'GetInputMute': if (!(requestData.inputName in state.muted)) code = 604; else responseData = { inputMuted: state.muted[requestData.inputName] }; break;
      case 'GetRecordStatus': responseData = { outputActive: state.recording, outputPaused: state.paused, outputTimecode: '00:00:10.000', outputDuration: state.duration, outputBytes: state.bytes }; break;
      case 'GetStreamStatus': responseData = { outputActive: state.streaming, outputReconnecting: false, outputTimecode: '00:00:10.000', outputDuration: state.duration, outputBytes: state.bytes, outputCongestion: 0, outputSkippedFrames: 0, outputTotalFrames: 300 }; break;
      case 'GetRecordDirectory': responseData = { recordDirectory: state.directory }; break;
      case 'SetCurrentProgramScene':
        if (!state.scenes.includes(requestData.sceneName)) code = 600;
        else { state.scene = requestData.sceneName; emit('CurrentProgramSceneChanged', { sceneName: state.scene }, socket); }
        break;
      case 'SetInputVolume': state.volumes[requestData.inputName] = requestData.inputVolumeMul; emit('InputVolumeChanged', { inputName: requestData.inputName, inputVolumeMul: requestData.inputVolumeMul, inputVolumeDb: -6 }, socket); break;
      case 'SetInputMute': state.muted[requestData.inputName] = requestData.inputMuted; emit('InputMuteStateChanged', { inputName: requestData.inputName, inputMuted: requestData.inputMuted }, socket); break;
      default: code = 204;
      }
      const response = JSON.stringify({ op: 7, d: { requestType, requestId, requestStatus: { result: code === 100, code }, responseData } });
      if (delay.has(requestType)) setTimeout(() => { if (socket.readyState === WebSocket.OPEN) socket.send(response); }, delay.get(requestType));
      else socket.send(response);
    });
  });
  return { url: `ws://127.0.0.1:${address.port}`, password, requests, ignore, fail, delay, state, emit,
    manualScene(sceneName: string) { state.scene = sceneName; emit('CurrentProgramSceneChanged', { sceneName }); },
    manualVolume(inputName: string, volume: number) { state.volumes[inputName] = volume; emit('InputVolumeChanged', { inputName, inputVolumeMul: volume, inputVolumeDb: -6 }); },
    drop() { for (const client of server.clients) client.terminate(); },
    async close() { for (const client of server.clients) client.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}
