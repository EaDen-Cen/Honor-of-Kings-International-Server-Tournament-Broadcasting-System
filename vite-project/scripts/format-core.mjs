import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const prettier = resolve(dirname(require.resolve('prettier/package.json')), 'bin/prettier.cjs');
// Adopt formatting incrementally: keep recognition/OBS changes readable without
// rewriting generated hero catalogs, screenshots or unrelated legacy modules.
const core = [
  '.prettierrc.json',
  'package.json',
  'eslint.config.js',
  'scripts/format-core.mjs',
  'scripts/cache-broadcast-art.ts',
  'scripts/benchmark-hud-recognition.ts',
  'server/capture.ts',
  'server/gameDataRecognition.ts',
  'server/playerRecognition.ts',
  'server/server.ts',
  'server/recognitionPerformance.test.ts',
  'src/control/LineupAssignments.tsx',
  'src/control/LiveHudCapturePanel.tsx',
  'src/control/LiveGamePanel.tsx',
  'src/control/SettlementCapturePanel.tsx',
  'src/control/hudCapture.ts',
  'src/control/useGameDataCapture.tsx',
  'src/control/ObsDirectorPanel.tsx',
  'src/control/OperatorGuide.tsx',
  'src/overlay/DraftOverlay.tsx',
  'src/overlay/HeroReveal.tsx',
  'src/overlay/GameHud.tsx',
  'src/overlay/MvpOverlay.tsx',
  'src/overlay/PostGameBroadcast.tsx',
  'src/overlay/prepareArtwork.ts',
  'src/shared/broadcastArtwork.ts',
  'src/shared/liveGame.ts',
  'e2e/recognition-performance.spec.ts',
];
const files = process.argv.slice(2).filter((value) => !value.startsWith('--'));
const result = spawnSync(
  process.execPath,
  [
    prettier,
    process.argv.includes('--check') ? '--check' : '--write',
    ...(files.length ? files : core),
  ],
  { stdio: 'inherit' },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
