import { fileURLToPath } from 'node:url';
import { inspectLocalStorage, maintainGeneratedStorage } from '../server/storageMaintenance.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const flags = process.argv.slice(2);
if (flags.some((f) => f !== '--apply' && f !== '--dry-run')) {
  console.error('Usage: npm run storage:inspect, or npm run storage:cleanup');
  process.exitCode = 2;
} else {
  try {
    const inventory = inspectLocalStorage(root);
    const report = maintainGeneratedStorage(root, { apply: flags.includes('--apply') });
    console.log(JSON.stringify({
      mode: flags.includes('--apply') ? 'cleanup' : 'dry-run',
      ...report,
      inventory,
      note: 'Only expired generated CI/E2E output. Match data, backups, uploads, active logs and OBS recordings are excluded.',
    }, null, 2));
    if (report.failed) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Storage maintenance failed');
    process.exitCode = 1;
  }
}
