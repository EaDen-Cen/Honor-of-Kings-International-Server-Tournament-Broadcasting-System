import { invalidateHudCache } from './hudOcrCache.js';
import { evaluateHero } from './aiEvaluation.js';
import { fuseHud, fusePlayers, fusePostGame } from './aiFusion.js';
import { recognizeAiWithFallback, aiRecognition } from './aiRecognition.js';
import sharp from 'sharp';
import { postGameCaptureRowIds } from './postGameCaptureRows.js';
import { isBroadcastPageRoute } from './uiRoutes.js';
import {
  parsePostGameNumber,
  postGameNumberResolution,
  postGameMetrics,
} from '../src/shared/postGame.js';
import {
  decodeGameFrame,
  frameHasVisualContent,
  recognizeLiveHud,
  recognizeLiveHudCrops,
  recognizeSettlement,
} from './gameDataRecognition.js';
import {
  liveCaptureRects,
  liveCaptureProfile,
  validLiveCaptureRects,
  settlementPages,
} from '../src/shared/gameCapture.js';
import { liveGameContext } from '../src/shared/liveGame.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Diagnostics } from './diagnostics.js';
import { recordingDiskSpace } from './recordingStorage.js';
import { acquireBackendLock, RecoveryManager, archiveData } from './recovery.js';
import { PlayerRecognitionProvider } from './playerRecognition.js';
import { solvePlayerSlotCandidates } from '../src/shared/playerSlots.js';
import type { HeroRecognitionProvider } from './recognitionProvider.js';
import { AccessStore } from './access.js';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { heroesForPool } from '../src/shared/heroPool.js';
import type { Role } from '../src/shared/types.js';
import { TeamPresetStore } from './teamPresets.js';
import { exportTeamLibrary, previewTeamLibrary, importTeamLibrary } from './teamTransfer.js';
import { Store } from './store.js';
import { ObsBridge } from './obsBridge.js';
import { SecureSettings } from './secureSettings.js';
import { AiProfiles } from './aiProfiles.js';
import { DiscordVoting } from './discordVoting.js';
import { PostGameCarousel } from './postGameCarousel.js';
import { recognizeSettlementGoldCurve } from './settlementGoldCurve.js';
import { operatorPreferenceKey } from '../src/shared/operatorPreferences.js';
import { uploadPortrait, servePortrait } from './portraits.js';
import {
  captureRegion,
  captureRegions,
  localCaptureRequest,
  prepareHeroTemplates,
  recognizeClientFrame,
  recognizeLineup,
  recognizeScreen,
} from './capture.js';

const recognitionProvider: HeroRecognitionProvider = {
  id: 'local-template-v2',
  recognize: (input) =>
    recognizeClientFrame(input.image, input.allowedHeroIds, input.shape, input.lockImage),
};
let evaluationBusy = false;
void prepareHeroTemplates().catch(() => {
  // Keep manual entry available; the next recognition request retries loading.
});
const playerRecognition = new PlayerRecognitionProvider(
  process.env.HOK_OCR_MODEL_DIR,
  process.env.HOK_OCR_LANGUAGES || 'chi_sim+eng',
);
void playerRecognition
  .prepare()
  .then(() => playerRecognition.prepareNumbers())
  .catch(() => {
    // A numeric warm-up failure is retried on demand; player OCR stays usable.
  });
const production = process.env.NODE_ENV === 'production';
// Every privileged local endpoint uses the same guard. The Vite dev origin
// exception is explicit here, and cannot be enabled by a production request.
const localOperatorRequest = (req: Parameters<typeof localCaptureRequest>[0]) =>
  localCaptureRequest(req, !production);
const project = fileURLToPath(new URL('../', import.meta.url));
const dataFile = resolve(process.env.DATA_FILE || resolve(project, 'data/match.json'));
const releaseBackendLock = acquireBackendLock(dirname(dataFile));
process.once('exit', releaseBackendLock);
const access = new AccessStore(resolve(dirname(dataFile), 'access.json'));
const roleFor = (token: unknown) => access.role(token);
const loginAttempts = new Map<string, { count: number; until: number }>();
const presets = new TeamPresetStore(resolve(dirname(dataFile), 'team-presets.json'));
const store = new Store(dataFile, Date.now, presets);
const uploadDirectory = resolve(
  process.env.UPLOAD_DIR || resolve(dirname(dataFile), 'uploads/player-portraits'),
);
const diagnostics = new Diagnostics(resolve(dirname(dataFile), 'logs'));
const secureSettings = new SecureSettings(resolve(dirname(dataFile), 'secure-settings.json'));
const aiProfiles = new AiProfiles(secureSettings);
const savedObs = secureSettings.get<{ address: string; password: string }>('obs');
let obsBridge = new ObsBridge(
  savedObs?.address || process.env.OBS_WS_URL,
  savedObs?.password ?? process.env.OBS_WS_PASSWORD,
);
const carousel = new PostGameCarousel(
  secureSettings,
  () => store.data.state,
  (scene, isCurrent) => obsBridge.switchScene(scene, isCurrent),
);
const carouselTimer = setInterval(() => void carousel.tick(), 250);
carouselTimer.unref();
let discord: DiscordVoting | undefined;
let discordLoadError = '';
try {
  discord = new DiscordVoting(resolve(dirname(dataFile), 'audience-votes.json'), secureSettings);
} catch {
  discordLoadError = '投票记录加载失败；原文件已保留，自动投票已停用。';
}
const discordTimer = setInterval(() => {
  void discord
    ?.tick()
    .then(() => discord?.autoStart(store.data.state))
    .catch(() => diagnostics.record('discord_sync_failed'));
}, 5000);
discordTimer.unref();
diagnostics.record('server_start', { ocrEnabled: true });
const recovery = new RecoveryManager(dataFile, uploadDirectory);
recovery.automatic();
const recoveryTimer = setInterval(() => {
  recovery.automatic();
  if (recovery.error) diagnostics.record('backup_failed');
}, 60000);
recoveryTimer.unref();
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.headers.origin && allowedOrigins.includes(req.headers.origin)) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-File-Name');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  }
  const json = (status: number, data: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/api/v1/recognition/gold-curve') {
      if (
        roleFor(req.headers.authorization?.replace(/^Bearer /, '')) !== 'control' ||
        !localOperatorRequest(req)
      ) {
        json(403, { error: 'Local Control only' });
        req.resume();
        return;
      }
      if (req.method !== 'POST') {
        json(405, { error: 'POST required' });
        req.resume();
        return;
      }
      try {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 6 * 1024 * 1024) throw Error('Curve crop too large');
        }
        const input = JSON.parse(body);
        if (
          typeof input.image !== 'string' ||
          !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(input.image) ||
          !store.data.state.postGameReports.some((r) => r.id === input.reportId)
        )
          throw Error('Invalid curve image or report');
        const started = performance.now();
        const frame = await sharp(Buffer.from(input.image.split(',')[1], 'base64'), {
          limitInputPixels: 9000000,
        })
          .png()
          .toBuffer();
        const result = await recognizeSettlementGoldCurve(frame, playerRecognition);
        if (!store.data.state.postGameReports.some((r) => r.id === input.reportId))
          throw Error('Report changed');
        await mkdir(uploadDirectory, { recursive: true });
        const name = `${randomUUID()}.png`;
        await writeFile(resolve(uploadDirectory, name), frame, { flag: 'wx' });
        json(200, {
          page: 'recap',
          reportId: input.reportId,
          capturedAt: Date.now(),
          evidence: `/uploads/player-portraits/${name}`,
          rows: [],
          candidates: [],
          goldCurve: result,
          elapsedMs: performance.now() - started,
        });
      } catch (error) {
        json(400, { error: error instanceof Error ? error.message : '经济曲线识别失败' });
      }
      return;
    }
    if (url.pathname === '/api/v1/postgame-carousel') {
      const role = roleFor(req.headers.authorization?.replace(/^Bearer /, ''));
      if (!role) {
        json(403, { error: 'Authorization required' });
        return;
      }
      if (req.method === 'GET') {
        json(200, carousel.snapshot());
        return;
      }
      if (role !== 'control' || !localOperatorRequest(req)) {
        json(403, { error: 'Local Control only' });
        req.resume();
        return;
      }
      try {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 16000) throw Error('Request too large');
        }
        const input = JSON.parse(body);
        if (req.method === 'PUT') json(200, carousel.configure(input));
        else if (req.method === 'POST') json(200, await carousel.command(input.action, input.page));
        else json(405, { error: 'GET, PUT or POST required' });
      } catch (error) {
        json(400, { error: error instanceof Error ? error.message : 'Carousel failed' });
      }
      return;
    }
    if (url.pathname === '/api/v1/audience-vote') {
      const role = roleFor(req.headers.authorization?.replace(/^Bearer /, ''));
      if (!role) {
        json(403, { error: 'Authorization required' });
        return;
      }
      if (req.method !== 'GET') {
        json(405, { error: 'GET required' });
        return;
      }
      json(200, discord?.snapshot(role !== 'control') ?? { votes: [], error: discordLoadError });
      return;
    }
    if (
      url.pathname.startsWith('/api/v1/discord/') ||
      url.pathname === '/api/v1/obs/config' ||
      url.pathname === '/api/v1/operator-preferences' ||
      url.pathname.startsWith('/api/v1/ai-recognition/profiles') ||
      url.pathname === '/api/v1/ai-recognition/test'
    ) {
      if (
        roleFor(req.headers.authorization?.replace(/^Bearer /, '')) !== 'control' ||
        !localOperatorRequest(req)
      ) {
        json(403, { error: 'Local Control only' });
        req.resume();
        return;
      }
      try {
        let body = '';
        if (req.method !== 'GET')
          for await (const chunk of req) {
            body += chunk;
            if (body.length > (url.pathname === '/api/v1/operator-preferences' ? 250000 : 64000))
              throw Error('Request too large');
          }
        const input = body ? JSON.parse(body) : {};
        if (!input || typeof input !== 'object' || Array.isArray(input))
          throw Error('Invalid input');
        if (url.pathname === '/api/v1/operator-preferences') {
          if (req.method === 'GET') {
            json(200, secureSettings.get('preferences') ?? {});
            return;
          }
          if (req.method !== 'PUT') {
            json(405, { error: 'GET or PUT required' });
            return;
          }
          if (
            Object.entries(input).some(
              ([key, value]) =>
                !operatorPreferenceKey(key) || typeof value !== 'string' || value.length > 100000,
            )
          )
            throw Error('Invalid operator preferences');
          secureSettings.set('preferences', input);
          json(200, { ok: true });
          return;
        }
        if (url.pathname === '/api/v1/obs/config') {
          const current = secureSettings.get<{ address: string; password: string }>('obs');
          if (req.method === 'GET') {
            json(200, {
              address: current?.address || process.env.OBS_WS_URL || 'ws://127.0.0.1:4455',
              configured: current ? !!current.password : !!process.env.OBS_WS_PASSWORD,
              storageError: secureSettings.error,
            });
            return;
          }
          if (req.method !== 'PUT') {
            json(405, { error: 'GET or PUT required' });
            return;
          }
          const { validateLocalObsUrl } = await import('./obsBridge.js');
          const address = validateLocalObsUrl(input.address);
          let environmentAddress = '';
          try {
            environmentAddress = validateLocalObsUrl(process.env.OBS_WS_URL || '');
          } catch {
            /* Invalid environment addresses cannot retain credentials. */
          }
          if (
            input.password !== undefined &&
            (typeof input.password !== 'string' || input.password.length > 512)
          )
            throw Error('Invalid OBS password');
          const password =
            input.password ??
            (current?.address === address
              ? current.password
              : environmentAddress === address
                ? process.env.OBS_WS_PASSWORD || ''
                : '');
          secureSettings.set('obs', { address, password });
          obsBridge.close();
          obsBridge = new ObsBridge(address, password);
          json(200, { ok: true });
          return;
        }
        if (url.pathname === '/api/v1/ai-recognition/test') {
          if (req.method !== 'POST') {
            json(405, { error: 'POST required' });
            return;
          }
          json(200, await aiRecognition.testConnection());
          return;
        }
        if (url.pathname === '/api/v1/ai-recognition/profiles') {
          if (req.method === 'POST') {
            json(200, aiProfiles.save(input));
            return;
          }
          if (req.method === 'PUT') {
            json(200, aiProfiles.select(input.activeId, input.backupId || ''));
            return;
          }
          if (req.method === 'DELETE') {
            json(200, aiProfiles.remove(input.id));
            return;
          }
          json(405, { error: 'POST, PUT or DELETE required' });
          return;
        }
        if (!discord) throw Error(discordLoadError);
        const action = url.pathname.split('/').at(-1);
        if (action === 'config' && req.method === 'GET') {
          json(200, discord.publicConfig());
          return;
        }
        if (action === 'config' && req.method === 'PUT') {
          json(200, discord.saveConfig(input));
          return;
        }
        if (req.method !== 'POST') {
          json(405, { error: 'POST required' });
          return;
        }
        if (action === 'test') json(200, await discord.testConnection());
        else if (action === 'start') json(200, await discord.start(store.data.state, input));
        else if (action === 'end' || action === 'cancel')
          json(200, await discord.finish(input.id, action === 'cancel'));
        else if (action === 'retry') {
          await discord.tick(true);
          json(200, discord.snapshot());
        } else if (action === 'recover')
          json(200, await discord.recover(input.id, input.messageId));
        else json(404, { error: 'Unknown Discord action' });
      } catch (error) {
        json(400, { error: error instanceof Error ? error.message : 'Integration request failed' });
      }
      return;
    }
    if (
      url.pathname === '/api/v1/obs/status' ||
      url.pathname === '/api/v1/obs/storage' ||
      url.pathname === '/api/v1/obs/scene' ||
      url.pathname === '/api/v1/obs/audio' ||
      url.pathname === '/api/v1/obs/layout' ||
      url.pathname === '/api/v1/obs/crossfade'
    ) {
      // This integration never accepts a remotely proxied Control session:
      // the OBS WebSocket is deliberately bound to the local operator machine.
      if (
        roleFor(req.headers.authorization?.replace(/^Bearer /, '')) !== 'control' ||
        !localOperatorRequest(req)
      ) {
        json(403, { error: 'Local Control only' });
        req.resume();
        return;
      }
      if (url.pathname.endsWith('/storage')) {
        if (req.method !== 'GET') {
          json(405, { error: 'GET required' });
          return;
        }
        // Never guess the OBS output drive from DATA_FILE or the project directory.
        // An explicit local fallback is useful if OBS WebSocket is offline.
        let directory = '';
        let source: 'obs' | 'configured' = 'obs';
        try {
          directory = await obsBridge.recordDirectory();
        } catch {
          directory = process.env.HOK_RECORDING_DIR?.trim() || '';
          source = 'configured';
        }
        if (!directory) {
          json(200, {
            ok: false,
            error:
              'OBS recording directory unavailable. Connect local OBS WebSocket or set HOK_RECORDING_DIR.',
          });
          return;
        }
        try {
          json(200, { ok: true, directory, source, ...(await recordingDiskSpace(directory)) });
        } catch {
          json(200, {
            ok: false,
            directory,
            source,
            error: 'Cannot read free space for the actual recording volume',
          });
        }
        return;
      }
      if (url.pathname.endsWith('/status')) {
        if (req.method !== 'GET') {
          json(405, { error: 'GET required' });
          return;
        }
        json(200, await obsBridge.status());
        return;
      }
      if (url.pathname.endsWith('/layout')) {
        if (req.method !== 'GET') {
          json(405, { error: 'GET required' });
          return;
        }
        const scene = url.searchParams.get('scene') || '';
        if (!scene.trim() || scene.length > 128) {
          json(400, { error: 'Invalid OBS scene' });
          return;
        }
        try {
          json(200, { scene, sources: await obsBridge.browserSourceLayout(scene) });
        } catch (error) {
          json(409, { error: error instanceof Error ? error.message : 'OBS layout unavailable' });
        }
        return;
      }
      if (url.pathname.endsWith('/audio') || url.pathname.endsWith('/crossfade')) {
        if (req.method === 'GET') {
          try {
            json(200, { inputs: await obsBridge.audioInputs() });
          } catch (error) {
            json(409, {
              error: error instanceof Error ? error.message : 'OBS audio inputs unavailable',
            });
          }
          return;
        }
        if (req.method !== 'POST') {
          json(405, { error: 'GET or POST required' });
          return;
        }
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 512) {
            json(413, { error: 'Request too large' });
            return;
          }
        }
        let input: unknown;
        try {
          input = JSON.parse(body);
        } catch {
          json(400, { error: 'Invalid request' });
          return;
        }
        const values =
          input && typeof input === 'object' && !Array.isArray(input)
            ? (input as Record<string, unknown>)
            : {};
        const { inputName, targetVolume, durationMs } = values;
        if (url.pathname.endsWith('/crossfade')) {
          if (
            typeof values.from !== 'string' ||
            typeof values.to !== 'string' ||
            typeof targetVolume !== 'number' ||
            !Number.isFinite(targetVolume) ||
            targetVolume < 0 ||
            targetVolume > 2 ||
            !Number.isInteger(durationMs) ||
            Number(durationMs) < 0 ||
            Number(durationMs) > 5000
          ) {
            json(400, { error: 'Invalid crossfade request' });
            return;
          }
          try {
            json(
              200,
              await obsBridge.crossfade(values.from, values.to, targetVolume, Number(durationMs)),
            );
          } catch (error) {
            json(409, { error: error instanceof Error ? error.message : 'Crossfade failed' });
          }
          return;
        }
        if (
          typeof inputName !== 'string' ||
          !inputName.trim() ||
          inputName.length > 128 ||
          typeof targetVolume !== 'number' ||
          !Number.isFinite(targetVolume) ||
          targetVolume < 0 ||
          targetVolume > 2 ||
          typeof durationMs !== 'number' ||
          !Number.isInteger(durationMs) ||
          durationMs < 0 ||
          durationMs > 5000
        ) {
          json(400, { error: 'Invalid OBS audio fade settings' });
          return;
        }
        try {
          json(200, {
            inputName,
            volume: await obsBridge.fadeInput(inputName, targetVolume, durationMs),
          });
        } catch (error) {
          json(409, { error: error instanceof Error ? error.message : 'OBS audio fade failed' });
        }
        return;
      }
      if (req.method !== 'POST') {
        json(405, { error: 'POST required' });
        return;
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 512) {
          json(413, { error: 'Request too large' });
          return;
        }
      }
      let input: unknown;
      try {
        input = JSON.parse(body);
      } catch {
        json(400, { error: 'Invalid request' });
        return;
      }
      const scene =
        typeof input === 'object' && input !== null
          ? 'scene' in input
            ? (input as { scene: unknown }).scene
            : undefined
          : undefined;
      if (typeof scene !== 'string' || !scene.trim() || scene.length > 128) {
        json(400, { error: 'Invalid scene name' });
        return;
      }
      try {
        carousel.pause();
        json(200, await obsBridge.switchScene(scene));
      } catch (error) {
        json(409, { error: error instanceof Error ? error.message : 'OBS scene change failed' });
      }
      return;
    }
    if (url.pathname === '/api/v1/ai-recognition/evaluate') {
      if (
        roleFor(req.headers.authorization?.replace(/^Bearer /, '')) !== 'control' ||
        !localOperatorRequest(req)
      ) {
        json(403, { error: 'Local Control only' });
        req.resume();
        return;
      }
      if (req.method !== 'POST') {
        json(405, { error: 'POST required' });
        req.resume();
        return;
      }
      if (evaluationBusy) {
        json(409, { error: '评测正在进行，请稍后重试' });
        req.resume();
        return;
      }
      evaluationBusy = true;
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        req.setTimeout(10000, () => req.destroy());
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 3 * 1024 * 1024) {
            json(413, { error: 'Image too large' });
            req.resume();
            return;
          }
          chunks.push(chunk);
        }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (
          !input ||
          typeof input.image !== 'string' ||
          !['global', 'cn'].includes(input.heroPool) ||
          !['square', 'circle'].includes(input.shape)
        ) {
          json(400, { error: 'Invalid evaluation sample' });
          return;
        }
        const allowedHeroIds = heroesForPool(input.heroPool).map((hero) => hero.id);
        json(
          200,
          await evaluateHero(
            { image: input.image, shape: input.shape, allowedHeroIds },
            recognitionProvider,
          ),
        );
      } catch (error) {
        json(400, { error: error instanceof Error ? error.message : 'Evaluation failed' });
      } finally {
        evaluationBusy = false;
      }
      return;
    }
    if (url.pathname === '/api/v1/ai-recognition/config') {
      // Keys and AI settings are local operator-only; no CORS-proxied sessions.
      if (
        roleFor(req.headers.authorization?.replace(/^Bearer /, '')) !== 'control' ||
        !localOperatorRequest(req)
      ) {
        json(403, { error: 'Local Control only' });
        req.resume();
        return;
      }
      if (req.method === 'GET') {
        json(200, { ...aiProfiles.publicConfig(), diagnostics: aiRecognition.diagnostics() });
        return;
      }
      if (req.method !== 'PUT') {
        json(405, { error: 'GET or PUT required' });
        return;
      }
      try {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 4096) {
            json(413, { error: 'Configuration too large' });
            return;
          }
        }
        json(200, aiProfiles.save({ ...JSON.parse(body), id: aiProfiles.publicConfig().activeId }));
      } catch (error) {
        json(400, {
          error: error instanceof Error ? error.message : 'Invalid AI settings or endpoint',
        });
      }
      return;
    }
    if (url.pathname === '/api/access') {
      const local = localOperatorRequest(req);
      const currentRole = roleFor(req.headers.authorization?.replace(/^Bearer /, ''));
      const requestedRole = url.searchParams.get('role');
      const role: Role =
        requestedRole === 'caster' || requestedRole === 'overlay' ? requestedRole : 'control';
      if (req.method === 'GET') {
        json(200, {
          local,
          configured: access.configured,
          ...(currentRole === 'control'
            ? {
                tokens: {
                  control: access.token('control'),
                  caster: access.token('caster'),
                  overlay: access.token('overlay'),
                },
              }
            : {}),
          ...(local ? { token: access.token(role) } : {}),
        });
        return;
      }
      if (req.method !== 'POST' && req.method !== 'PUT') {
        json(405, { error: 'Unsupported method' });
        return;
      }
      if (
        req.headers.origin &&
        !allowedOrigins.includes(req.headers.origin) &&
        req.headers.origin !== `http://${req.headers.host}` &&
        req.headers.origin !== `https://${req.headers.host}`
      ) {
        json(403, { error: 'Origin rejected' });
        req.resume();
        return;
      }
      if (req.method === 'PUT' && currentRole !== 'control') {
        json(403, { error: 'Control only' });
        req.resume();
        return;
      }
      const address = req.socket.remoteAddress ?? '';
      const now = Date.now();
      for (const [key, value] of loginAttempts) if (value.until <= now) loginAttempts.delete(key);
      if (req.method === 'POST' && (loginAttempts.get(address)?.count ?? 0) >= 10) {
        json(429, { error: 'Too many attempts; retry in one minute' });
        req.resume();
        return;
      }
      let body = '';
      req.setTimeout(10000, () => req.destroy());
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 4096) {
          json(413, { error: 'Request too large' });
          return;
        }
      }
      let input;
      try {
        input = JSON.parse(body);
      } catch {
        json(400, { error: 'Invalid request' });
        return;
      }
      if (req.method === 'PUT') {
        try {
          access.setPassword(input.password);
        } catch (error) {
          json(400, {
            error: error instanceof Error ? error.message : 'Could not save access settings',
          });
          return;
        }
        // Existing authenticated pages receive only their own role credential.
        for (const [ws, client] of clients)
          if (client.role && ws.readyState === WebSocket.OPEN)
            ws.send(
              JSON.stringify({ type: 'access_token_update', token: access.token(client.role) }),
            );
        json(200, { token: access.token('control'), configured: true });
      } else {
        if (roleFor(input.password) !== role && !access.verify(input.password)) {
          if (!loginAttempts.has(address) && loginAttempts.size >= 1000)
            loginAttempts.delete(loginAttempts.keys().next().value!);
          const attempt = loginAttempts.get(address) ?? { count: 0, until: now + 60000 };
          attempt.count++;
          loginAttempts.set(address, attempt);
          json(401, { error: 'Password is missing or invalid' });
          return;
        }
        loginAttempts.delete(address);
        json(200, { token: access.token(role) });
      }
      return;
    }
    if (
      url.pathname === '/api/v1/recognition/settlement' ||
      url.pathname === '/api/v1/recognition/live-hud'
    ) {
      if (req.method !== 'POST') {
        json(405, { error: 'POST required' });
        return;
      }
      if (roleFor(req.headers.authorization?.replace(/^Bearer /, '')) !== 'control') {
        json(403, { error: 'Control only' });
        req.resume();
        return;
      }
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        req.setTimeout(30000, () => req.destroy());
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 5 * 1024 * 1024) {
            json(413, { error: 'Frame too large' });
            return;
          }
          chunks.push(chunk);
        }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const capturedAt = Date.now(),
          context = liveGameContext(store.data.state);
        if (url.pathname.endsWith('live-hud')) {
          if (input.context !== context) {
            json(409, { error: 'Game changed; capture again' });
            return;
          }
          if (input.regions !== undefined && !validLiveCaptureRects(input.regions)) {
            json(400, { error: 'Invalid HUD crop calibration' });
            return;
          }
        } else {
          if (!store.data.state.postGameReports.some((report) => report.id === input.reportId)) {
            json(409, { error: 'Prepare the game report first' });
            return;
          }
          if (input.page !== 'auto' && !settlementPages.includes(input.page)) {
            json(400, { error: 'Invalid settlement page' });
            return;
          }
        }
        if (playerRecognition.status !== 'ready') {
          json(503, { error: 'Local OCR is not ready' });
          return;
        }
        if (url.pathname.endsWith('live-hud') && input.images !== undefined) {
          const regions = input.regions ?? liveCaptureRects;
          const result = await recognizeLiveHudCrops(
            input.images,
            playerRecognition,
            regions,
            JSON.stringify([context, liveCaptureProfile(regions)]),
          );
          if (liveGameContext(store.data.state) !== context) {
            json(409, { error: 'Game changed; capture again' });
            return;
          }
          json(200, {
            ...result,
            capturedAt,
            context,
            profile: liveCaptureProfile(regions),
            candidates: fuseHud(
              input.images,
              result.candidates,
              JSON.stringify([context, store.data.revision, liveCaptureProfile(regions)]),
            ),
          });
          return;
        }
        const frame = await decodeGameFrame(input.image, input.region);
        if (!(await frameHasVisualContent(frame))) {
          json(422, {
            error:
              'Game capture is blank or mostly black. Preview the actual game screen or upload a valid screenshot.',
          });
          return;
        }
        if (url.pathname.endsWith('live-hud')) {
          if (input.context !== context) {
            json(409, { error: 'Game changed; capture again' });
            return;
          }
          const regions = input.regions ?? liveCaptureRects;
          const result = await recognizeLiveHud(
            frame,
            playerRecognition,
            regions,
            JSON.stringify([context, store.data.revision, liveCaptureProfile(regions)]),
          );
          if (liveGameContext(store.data.state) !== context) {
            json(409, { error: 'Game changed; capture again' });
            return;
          }
          json(200, {
            ...result,
            capturedAt,
            context,
            profile: liveCaptureProfile(regions),
          });
        } else {
          const report = store.data.state.postGameReports.find((r) => r.id === input.reportId);
          if (!report) {
            json(409, { error: 'Prepare the game report first' });
            return;
          }
          if (input.page !== 'auto' && !settlementPages.includes(input.page)) {
            json(400, { error: 'Invalid settlement page' });
            return;
          }
          if (
            input.leftSide !== undefined &&
            input.leftSide !== 'blue' &&
            input.leftSide !== 'red'
          ) {
            json(400, { error: 'Invalid settlement left side' });
            return;
          }
          const result = await recognizeSettlement(
            frame,
            input.page,
            report,
            playerRecognition,
            input.leftSide,
            JSON.stringify([report.id, store.data.revision]),
          );
          if (!store.data.state.postGameReports.some((r) => r.id === report.id)) {
            json(409, { error: 'Report changed' });
            return;
          }
          await mkdir(uploadDirectory, { recursive: true });
          const name = `${randomUUID()}.png`;
          await writeFile(resolve(uploadDirectory, name), frame, { flag: 'wx' });
          json(200, {
            ...result,
            reportId: report.id,
            capturedAt,
            evidence: `/uploads/player-portraits/${name}`,
          });
        }
      } catch (error) {
        json(400, { error: error instanceof Error ? error.message : 'Game data capture failed' });
      }
      return;
    }
    if (url.pathname === '/api/v1/recognition/postgame') {
      if (req.method !== 'POST') {
        json(405, { error: 'POST required' });
        return;
      }
      if (roleFor(req.headers.authorization?.replace(/^Bearer /, '')) !== 'control') {
        json(403, { error: 'Control only' });
        req.resume();
        return;
      }
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        req.setTimeout(10000, () => req.destroy());
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) {
            json(413, { error: 'Crops too large' });
            return;
          }
          chunks.push(chunk);
        }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!postGameMetrics.includes(input.metric)) {
          json(400, { error: 'Valid post-game metric required' });
          return;
        }
        const report = store.data.state.postGameReports.find((r) => r.id === input.reportId);
        if (!report) {
          json(409, { error: 'Prepare the game report first' });
          return;
        }
        if (playerRecognition.status !== 'ready') {
          json(503, { error: 'Local OCR is not ready' });
          return;
        }
        const rowIds = postGameCaptureRowIds(
          report.players.map((p) => p.rowId),
          input.rowIds,
          input.images,
        );
        // Reject completely blank screen crops instead of storing black evidence.
        const visible: number[] = [];
        for (let index = 0; index < input.images.length; index++) {
          const data = input.images[index];
          if (
            typeof data !== 'string' ||
            !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(data) ||
            data.length > 180000
          )
            throw new Error('Invalid numeric crop');
          const { channels } = await sharp(Buffer.from(data.split(',')[1], 'base64'), {
            limitInputPixels: 1000000,
          }).stats();
          if (channels.some((c) => c.stdev > 5)) visible.push(index);
        }
        if (!visible.length) {
          json(422, {
            error: 'The selected number regions are blank; preview and redraw your crop boxes',
          });
          return;
        }
        const result = await playerRecognition.recognizeNumbers(
          visible.map((index) => input.images[index]),
        );
        if (!store.data.state.postGameReports.some((r) => r.id === input.reportId)) {
          json(409, { error: 'Report changed' });
          return;
        }
        await mkdir(uploadDirectory, { recursive: true });
        const candidates = await Promise.all(
          result.texts.map(async (localText, index) => {
            const fused = fusePostGame(
              input.images[visible[index]],
              input.metric,
              JSON.stringify([
                store.data.revision,
                report.id,
                rowIds[visible[index]],
                input.metric,
              ]),
              { text: localText, confidence: result.confidences[index] },
            );
            const text = fused.text;
            const sourceIndex = visible[index],
              value = parsePostGameNumber(text, input.metric);
            const name = `${randomUUID()}.png`;
            // Provider verified and decoded these bounded PNG crops before OCR.
            await writeFile(
              resolve(uploadDirectory, name),
              await sharp(Buffer.from(input.images[sourceIndex].split(',')[1], 'base64'))
                .png()
                .toBuffer(),
              { flag: 'wx' },
            );
            return {
              rowId: rowIds[sourceIndex],
              value,
              resolution: postGameNumberResolution(text, input.metric),
              confidence: value === null ? 0 : fused.confidence,
              text,
              evidence: `/uploads/player-portraits/${name}`,
            };
          }),
        );
        json(200, {
          candidates,
          elapsedMs: result.elapsedMs,
        });
      } catch {
        json(400, { error: 'Post-game capture failed; check regions or retry after player OCR' });
      }
      return;
    }
    if (url.pathname === '/api/recovery' || url.pathname === '/api/match-export') {
      if (roleFor(req.headers.authorization?.replace(/^Bearer /, '')) !== 'control') {
        json(403, { error: 'Control only' });
        req.resume();
        return;
      }
      if (url.pathname === '/api/match-export' && req.method === 'GET') {
        json(200, archiveData(dataFile, uploadDirectory, false));
        return;
      }
      if (req.method === 'GET') {
        json(200, {
          backups: recovery.list(),
          lastBackup: recovery.lastBackup,
          error: recovery.error,
        });
        return;
      }
      if (req.method === 'POST') {
        try {
          json(201, { file: recovery.create(true) });
        } catch {
          diagnostics.record('backup_failed');
          json(500, { error: 'Backup failed; check server storage' });
        }
        return;
      }
      json(405, { error: 'Unsupported method' });
      return;
    }
    if (url.pathname === '/api/v1/recognition/players') {
      if (roleFor(req.headers.authorization?.replace(/^Bearer /, '')) !== 'control') {
        json(403, { error: 'Control only' });
        req.resume();
        return;
      }
      if (req.method === 'GET') {
        json(200, {
          provider: playerRecognition.id,
          status: playerRecognition.status,
          error: playerRecognition.error,
        });
        return;
      }
      if (req.method !== 'POST') {
        json(405, { error: 'POST required' });
        return;
      }
      if (store.data.state.bpInputMode !== 'screen') {
        json(409, { error: 'Screen input is not enabled' });
        req.resume();
        return;
      }
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        req.setTimeout(10000, () => req.destroy());
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) {
            json(413, { error: 'ID crops too large' });
            return;
          }
          chunks.push(chunk);
        }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const state = store.data.state;
        // BP revisions may advance while OCR runs: bind to roster/game instead.
        const context = JSON.stringify([
          state.blueTeam.players,
          state.redTeam.players,
          state.gameNumber,
          state.draftGameNumber,
          state.committedGameId,
        ]);
        if (
          JSON.stringify(input.players) !==
            JSON.stringify([state.blueTeam.players, state.redTeam.players]) ||
          input.gameNumber !== state.gameNumber ||
          state.committedGameId
        ) {
          json(409, { error: 'Roster or game changed' });
          return;
        }
        if (playerRecognition.status !== 'ready') {
          json(503, { error: playerRecognition.error || 'Local OCR model is not ready' });
          return;
        }
        const result = await playerRecognition.recognizePlayerIds(input.images, [
          state.blueTeam.players,
          state.redTeam.players,
        ]);
        const current = store.data.state;
        if (
          context !==
          JSON.stringify([
            current.blueTeam.players,
            current.redTeam.players,
            current.gameNumber,
            current.draftGameNumber,
            current.committedGameId,
          ])
        ) {
          json(409, { error: 'Roster or game changed' });
          return;
        }
        const candidates = fusePlayers(
          input.images,
          result.candidates,
          [state.blueTeam.players, state.redTeam.players],
          JSON.stringify([context, store.data.revision]),
        );
        json(200, {
          ...result,
          candidates,
          blue: solvePlayerSlotCandidates(candidates.slice(0, 5), state.blueTeam.players),
          red: solvePlayerSlotCandidates(candidates.slice(5), state.redTeam.players),
        });
      } catch (error) {
        json(400, { error: error instanceof Error ? error.message : 'Player recognition failed' });
      }
      return;
    }
    if (url.pathname === '/api/recognize-frame' || url.pathname === '/api/v1/recognition/frame') {
      if (req.method !== 'POST') {
        json(405, { error: 'POST required' });
        return;
      }
      if (roleFor(req.headers.authorization?.replace(/^Bearer /, '')) !== 'control') {
        json(403, { error: 'Control only' });
        req.resume();
        return;
      }
      if (store.data.state.bpInputMode !== 'screen') {
        json(409, { error: 'Screen input is not enabled' });
        req.resume();
        return;
      }
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        req.setTimeout(10000, () => req.destroy());
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 4 * 1024 * 1024) {
            json(413, { error: 'Frame too large' });
            return;
          }
          chunks.push(chunk);
        }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (input.revision !== store.data.revision) {
          json(409, { error: 'Stale capture' });
          return;
        }
        const result = await recognizeAiWithFallback(
          input.image,
          input.allowedHeroIds,
          () => recognitionProvider.recognize(input),
          JSON.stringify([store.data.revision, store.data.state.heroPool]),
        );
        if (input.revision !== store.data.revision) {
          json(409, { error: 'State changed during capture' });
          return;
        }
        json(200, result);
      } catch {
        json(400, { error: 'Browser frame recognition failed' });
      }
      return;
    }
    if (url.pathname === '/api/capture') {
      if (req.method !== 'POST') {
        json(405, { error: 'POST required' });
        return;
      }
      if (
        roleFor(req.headers.authorization?.replace(/^Bearer /, '')) !== 'control' ||
        !localOperatorRequest(req)
      ) {
        json(403, { error: 'Local control only' });
        req.resume();
        return;
      }
      if (
        process.platform !== 'win32' ||
        process.env.HOK_CAPTURE_ENABLED !== '1' ||
        store.data.state.bpInputMode !== 'screen'
      ) {
        json(503, { error: 'Windows capture is not enabled' });
        req.resume();
        return;
      }
      try {
        let body = '';
        req.setTimeout(5000, () => req.destroy());
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 2048) {
            json(413, { error: 'Request too large' });
            return;
          }
        }
        const input = JSON.parse(body);
        if (input.revision !== store.data.revision) {
          json(409, { error: 'Stale capture' });
          return;
        }
        const result = await recognizeScreen(captureRegion(input.region));
        if (input.revision !== store.data.revision) {
          json(409, { error: 'State changed during capture' });
          return;
        }
        json(200, result);
      } catch {
        json(400, { error: 'Capture failed; check region and visible desktop' });
      }
      return;
    }
    if (url.pathname === '/api/capture-lineup') {
      if (req.method !== 'POST') {
        json(405, { error: 'POST required' });
        return;
      }
      if (
        roleFor(req.headers.authorization?.replace(/^Bearer /, '')) !== 'control' ||
        !localOperatorRequest(req)
      ) {
        json(403, { error: 'Local control only' });
        req.resume();
        return;
      }
      if (
        process.platform !== 'win32' ||
        process.env.HOK_CAPTURE_ENABLED !== '1' ||
        store.data.state.bpInputMode !== 'screen'
      ) {
        json(503, { error: 'Windows capture is not enabled' });
        req.resume();
        return;
      }
      if (!store.data.state.draftComplete || store.data.state.committedGameId) {
        json(409, { error: 'Lineup sync requires a completed uncommitted draft' });
        req.resume();
        return;
      }
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        req.setTimeout(5000, () => req.destroy());
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 16384) {
            json(413, { error: 'Request too large' });
            return;
          }
          chunks.push(chunk);
        }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (input.revision !== store.data.revision) {
          json(409, { error: 'Stale capture' });
          return;
        }
        const regions = captureRegions(input.regions);
        const state = store.data.state;
        const allowed = [
          ...Array.from({ length: 5 }, () => [...state.bluePicks]),
          ...Array.from({ length: 5 }, () => [...state.redPicks]),
        ];
        const results = await recognizeLineup(regions, allowed);
        if (input.revision !== store.data.revision) {
          json(409, { error: 'State changed during capture' });
          return;
        }
        json(200, {
          slots: results.map((result, index) => ({
            side: index < 5 ? 'blue' : 'red',
            playerIndex: index % 5,
            ...result,
          })),
        });
      } catch {
        json(400, {
          error: 'Lineup capture failed; check all ten player regions and visible desktop',
        });
      }
      return;
    }
    if (url.pathname === '/api/team-presets' || url.pathname.startsWith('/api/team-presets/')) {
      const role = roleFor(req.headers.authorization?.replace(/^Bearer /, ''));
      if (
        role !== 'control' ||
        (production && req.headers.origin && !allowedOrigins.includes(req.headers.origin))
      ) {
        json(role ? 403 : 401, { error: 'uploadUnauthorized' });
        req.resume();
        return;
      }
      if (url.pathname === '/api/team-presets/transfer/export' && req.method === 'GET') {
        try {
          json(200, exportTeamLibrary(presets, uploadDirectory, resolve(project, 'public')));
        } catch (error) {
          json(422, { error: error instanceof Error ? error.message : 'teamTransferInvalid' });
        }
        return;
      }
      if (
        ['/api/team-presets/transfer/preview', '/api/team-presets/transfer/import'].includes(
          url.pathname,
        )
      ) {
        if (req.method !== 'POST') {
          json(405, { error: 'POST required' });
          req.resume();
          return;
        }
        if (!req.headers['content-type']?.startsWith('application/json')) {
          json(415, { error: 'teamTransferInvalid' });
          req.resume();
          return;
        }
        try {
          const limit = 135 * 1024 * 1024;
          const chunks: Buffer[] = [];
          let size = 0;
          if (Number(req.headers['content-length']) > limit) {
            json(413, { error: 'teamTransferTooLarge' });
            req.resume();
            return;
          }
          req.setTimeout(120000, () => req.destroy());
          for await (const chunk of req) {
            size += chunk.length;
            if (size > limit) {
              json(413, { error: 'teamTransferTooLarge' });
              req.destroy();
              return;
            }
            chunks.push(Buffer.from(chunk));
          }
          req.setTimeout(0);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (url.pathname.endsWith('/preview')) {
            json(200, await previewTeamLibrary(body.bundle, presets));
          } else {
            // Preserve a point-in-time backup before replacing any existing roster.
            recovery.create(true);
            json(
              200,
              await importTeamLibrary(body.bundle, presets, uploadDirectory, body.conflict),
            );
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          const status =
            message === 'teamTransferTooLarge'
              ? 413
              : message === 'teamTransferMissingAsset'
                ? 422
                : error instanceof SyntaxError ||
                    ['teamTransferInvalid', 'presetInvalid', 'substitutesInvalid'].includes(message)
                  ? 400
                  : 500;
          const expectedErrors = [
            'teamTransferTooLarge',
            'teamTransferMissingAsset',
            'teamTransferInvalid',
            'presetInvalid',
            'substitutesInvalid',
          ];
          json(status, {
            error: expectedErrors.includes(message) ? message : 'teamTransferFailed',
          });
        }
        return;
      }
      const id = url.pathname.slice('/api/team-presets/'.length);
      const collection = url.pathname === '/api/team-presets';
      try {
        if (req.method === 'GET' && collection) {
          json(200, { teams: presets.list() });
          return;
        }
        if (req.method === 'DELETE' && !collection) {
          presets.delete(id);
          json(200, { ok: true });
          return;
        }
        if ((req.method === 'POST' && collection) || (req.method === 'PUT' && !collection)) {
          if (!req.headers['content-type']?.startsWith('application/json')) {
            json(415, { error: 'presetInvalid' });
            req.resume();
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          req.setTimeout(15000, () => req.destroy());
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 65536) {
              json(413, { error: 'presetInvalid' });
              return;
            }
            chunks.push(chunk);
          }
          let input;
          try {
            input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            json(400, { error: 'presetInvalid' });
            return;
          }
          json(
            collection ? 201 : 200,
            collection ? presets.create(input) : presets.update(id, input),
          );
          return;
        }
        json(405, { error: '不支持此请求方式' });
        return;
      } catch (e) {
        const error = e instanceof Error ? e.message : '';
        json(
          error === 'presetMissing'
            ? 404
            : ['presetInvalid', 'substitutesInvalid'].includes(error)
              ? 400
              : 500,
          {
            error: ['presetMissing', 'presetInvalid', 'substitutesInvalid'].includes(error)
              ? error
              : 'presetSaveFailed',
          },
        );
        return;
      }
    }
    if (url.pathname === '/api/uploads/player-portrait' && req.method === 'POST') {
      const role = roleFor(req.headers.authorization?.replace(/^Bearer /, ''));
      if (role !== 'control') {
        json(role ? 403 : 401, { error: 'uploadUnauthorized' });
        req.resume();
        return;
      }
      if (production && req.headers.origin && !allowedOrigins.includes(req.headers.origin)) {
        json(403, { error: 'uploadUnauthorized' });
        req.resume();
        return;
      }
      await uploadPortrait(req, res, uploadDirectory);
      return;
    }
    if (req.method !== 'GET') {
      json(405, { error: '不支持此请求方式' });
      return;
    }
    if (url.pathname.startsWith('/uploads/player-portraits/')) {
      await servePortrait(url.pathname, res, uploadDirectory);
      return;
    }
    if (url.pathname === '/api/health') {
      json(200, { ok: true });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const role = roleFor(req.headers.authorization?.replace(/^Bearer /, ''));
      if (!role) {
        json(401, { error: '访问口令缺失或无效，请重新输入' });
        return;
      }
      if (url.pathname === '/api/match') json(200, store.snapshot(role));
      else if (url.pathname === '/api/v1/capabilities')
        json(200, {
          version: 1,
          recognition: {
            provider: recognitionProvider.id,
            endpoint: '/api/v1/recognition/frame',
            confidence: 'similarity',
            shapes: ['square', 'circle'],
            revisionRequired: true,
          },
          playerRecognition: {
            provider: playerRecognition.id,
            status: playerRecognition.status,
            endpoint: '/api/v1/recognition/players',
            batchSize: 10,
            context: 'roster-and-game',
          },
          postGame: {
            endpoint: '/api/v1/recognition/postgame',
            settlementEndpoint: '/api/v1/recognition/settlement',
            pageSelection: 'template-or-manual',
            pages: settlementPages,
            mvpSelection: 'manual',
          },
          liveHud: {
            endpoint: '/api/v1/recognition/live-hud',
            experimental: true,
            verificationFrames: 2,
          },
        });
      else if (url.pathname === '/api/heroes')
        json(200, heroesForPool(url.searchParams.get('pool') === 'cn' ? 'cn' : 'global'));
      else json(404, { error: '找不到请求的内容' });
      return;
    }
    const root = resolve(project, 'dist');
    const route = isBroadcastPageRoute(url.pathname);
    const file = resolve(root, route ? 'index.html' : `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(root + '/') && !file.startsWith(root + '\\')) {
      json(404, { error: '找不到请求的内容' });
      return;
    }
    const mime: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
    };
    const metadata = await stat(file);
    if (!metadata.isFile()) {
      json(404, { error: 'File not found' });
      return;
    }
    // Match snapshots remain no-store. Public artwork is reusable across OBS
    // scene changes; content-addressed art and Vite chunks are immutable.
    const versioned =
      /\/assets\/.*-[\w-]{8,}\.(?:js|css)$/.test(url.pathname) ||
      /\/heroesArt\/broadcast-\d+-[a-f0-9]{12}-[a-f0-9]{12}\.webp$/.test(url.pathname);
    const etag = `W/"${metadata.size.toString(16)}-${metadata.mtimeMs.toString(16)}"`;
    res.setHeader(
      'Cache-Control',
      extname(file) === '.html'
        ? 'no-cache'
        : versioned
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=3600',
    );
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304);
      res.end();
      return;
    }
    res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    res.removeHeader('ETag');
    json(404, { error: '找不到页面或文件，请联系导播检查网页是否已构建' });
  }
});
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 65536 });
interface Client {
  role?: Role;
  last?: string;
  alive: boolean;
  count: number;
  window: number;
}
const clients = new Map<WebSocket, Client>();
const snapshotPayloads = new Map<Role, { version: string; payload: string }>();
function update(ws: WebSocket, force = false) {
  const c = clients.get(ws);
  if (!c?.role || ws.readyState !== WebSocket.OPEN) return;
  const version = store.snapshotVersion(c.role);
  let cached = snapshotPayloads.get(c.role);
  if (!cached || cached.version !== version) {
    cached = { version, payload: JSON.stringify(store.snapshot(c.role)) };
    snapshotPayloads.set(c.role, cached);
  }
  const payload = cached.payload;
  if (force || c.last !== payload) {
    if (ws.bufferedAmount > 1024 * 1024) {
      ws.terminate();
      return;
    }
    ws.send(payload);
    c.last = payload;
  }
}
wss.on('connection', (ws, req) => {
  const origin = req.headers.origin;
  if (production && origin && !allowedOrigins.includes(origin) && !localOperatorRequest(req)) {
    ws.close(1008, '此页面地址无权连接');
    return;
  }
  clients.set(ws, { alive: true, count: 0, window: Date.now() });
  const authTimeout = setTimeout(() => {
    if (!clients.get(ws)?.role) ws.close(1013, '身份验证超时，请重试');
  }, 5000);
  ws.on('pong', () => {
    const c = clients.get(ws);
    if (c) c.alive = true;
  });
  ws.on('error', () => ws.terminate());
  ws.on('close', () => {
    clearTimeout(authTimeout);
    clients.delete(ws);
  });
  ws.on('message', (raw) => {
    const c = clients.get(ws)!;
    let id: unknown;
    try {
      if (Date.now() - c.window > 1000) {
        c.window = Date.now();
        c.count = 0;
      }
      if (++c.count > 30) {
        ws.close(1008, '操作过于频繁，请稍后重试');
        return;
      }
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        throw new Error('消息格式无效，请重新连接后重试');
      }
      if (!message || typeof message !== 'object')
        throw new Error('消息格式无效，请重新连接后重试');
      id = message.id;
      if (!c.role) {
        c.role = message.type === 'auth' ? roleFor(message.token) : undefined;
        if (!c.role) {
          ws.close(1008, '访问口令无效');
          return;
        }
        clearTimeout(authTimeout);
        update(ws, true);
        return;
      }
      if (message.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      if (c.role !== 'control') throw new Error('当前页面仅供查看，无法修改比赛');
      if (message.type !== 'action') throw new Error('不支持此消息类型');
      store.apply(message.id, message.revision, message.action);
      // Authoritative mutations supersede in-flight cloud interpretations.
      aiRecognition.invalidate();
      if (
        ['reset_match', 'reset_draft', 'next_game', 'settings', 'restore'].includes(
          message.action.type,
        )
      )
        invalidateHudCache();
      for (const client of clients.keys()) update(client);
      ws.send(JSON.stringify({ type: 'ack', id: message.id }));
    } catch (e) {
      diagnostics.record('action_rejected', { revision: store.data.revision });
      ws.send(
        JSON.stringify({
          type: 'error',
          id: typeof id === 'string' ? id : undefined,
          error: e instanceof Error ? e.message : '消息无效',
        }),
      );
      update(ws, true);
    }
  });
});
const tick = setInterval(() => {
  for (const ws of clients.keys()) update(ws);
}, 200);
const heartbeat = setInterval(() => {
  for (const [ws, c] of clients) {
    if (!c.alive) ws.terminate();
    else {
      c.alive = false;
      ws.ping();
    }
  }
}, 15000);
server.listen(
  Number(process.env.PORT || 3001),
  process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1'),
  () => console.log('HOK Broadcast server ready on port ' + (process.env.PORT || 3001)),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    diagnostics.record('server_stop');
    clearInterval(recoveryTimer);
    void playerRecognition.close();
    clearInterval(tick);
    clearInterval(heartbeat);
    for (const ws of clients.keys()) ws.close(1001, '服务器正在停止');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
