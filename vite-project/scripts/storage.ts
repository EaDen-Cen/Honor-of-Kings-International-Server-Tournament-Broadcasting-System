import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StorageMaintenance, storageReferences } from '../server/storageMaintenance.js';
const index = process.argv.indexOf('--root');
const root = resolve(
  index >= 0 ? process.argv[index + 1] : fileURLToPath(new URL('../', import.meta.url)),
);
const data = dirname(resolve(process.env.DATA_FILE || resolve(root, 'data/match.json')));
const service = new StorageMaintenance(
  root,
  resolve(data, 'storage-maintenance.json'),
  () => storageReferences(data),
  async () => 'CLI is read-only; execute a fresh preview in local Control',
);
await service.load();
console.log(JSON.stringify(await service.inspect(), null, 2));
