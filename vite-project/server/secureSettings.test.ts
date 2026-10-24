import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecureSettings } from './secureSettings.js';
import { AiProfiles } from './aiProfiles.js';
import { AiRecognitionService } from './aiRecognition.js';
import { setImmediate as tick } from 'node:timers/promises';
import { heroesForPool } from '../src/shared/heroPool.js';
const fakeCrypt = (value: string, decrypt = false) =>
  Buffer.from(value, decrypt ? 'base64' : 'utf8').toString(decrypt ? 'utf8' : 'base64');
test('real OS encryption persists credentials across service recreation without plaintext on disk', (t) => {
  if (process.platform !== 'win32' && !process.env.HOK_CONFIG_KEY)
    return t.skip('OS encryption key is unavailable on this host');
  const file = join(mkdtempSync(join(tmpdir(), 'hok-secret-')), 'settings.json');
  const storage = new SecureSettings(file);
  storage.set('test', { apiKey: 'private-regression-value' });
  assert.equal(readFileSync(file, 'utf8').includes('private-regression-value'), false);
  assert.deepEqual(new SecureSettings(file).get('test'), { apiKey: 'private-regression-value' });
});
test('AI profiles preserve omitted secrets, restore default and fallback, and reject gateway credential carryover', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'hok-profiles-')), 'settings.json');
  const service = new AiRecognitionService(),
    profiles = new AiProfiles(new SecureSettings(file, fakeCrypt), service);
  const first = profiles.save({
    name: 'Main',
    enabled: true,
    vendor: 'openai',
    model: 'vision',
    endpoint: '',
    apiKey: 'private-key',
  });
  profiles.save({
    id: first.activeId,
    name: 'Main',
    enabled: true,
    vendor: 'openai',
    model: 'vision-2',
    endpoint: '',
  });
  assert.equal(service.savedConfig().apiKey, 'private-key');
  const second = profiles.save({
    name: 'Backup',
    enabled: true,
    vendor: 'qwen',
    model: 'vision',
    endpoint: '',
    apiKey: 'other-key',
  });
  profiles.select(first.activeId, second.activeId);
  const restored = new AiProfiles(
    new SecureSettings(file, fakeCrypt),
    new AiRecognitionService(),
  ).publicConfig();
  assert.equal(restored.model, 'vision-2');
  assert.equal(restored.backupId, second.activeId);
  assert.equal(restored.profiles.length, 2);
  assert.equal(JSON.stringify(restored).includes('private-key'), false);
  profiles.save({
    id: first.activeId,
    enabled: true,
    vendor: 'custom',
    model: 'vision',
    endpoint: 'https://example.com/v1/chat/completions',
  });
  assert.equal(service.savedConfig().apiKey, '');
});
test('unreadable or future encrypted settings remain unchanged on attempted writes', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'hok-corrupt-')), 'settings.json');
  const original = JSON.stringify({ version: 999, encrypted: 'broken' });
  writeFileSync(file, original);
  const storage = new SecureSettings(file, fakeCrypt);
  assert.ok(storage.error);
  assert.throws(() => storage.set('ai', {}));
  assert.equal(readFileSync(file, 'utf8'), original);
});
test('a failed primary vision request uses the configured backup inside the same job', async () => {
  const hero = heroesForPool('global')[0].id,
    calls: string[] = [];
  const service = new AiRecognitionService(async (target) => {
    calls.push(target);
    return target.includes('openai.com')
      ? { status: 500, data: {} }
      : {
          status: 200,
          data: {
            choices: [{ message: { content: JSON.stringify({ heroId: hero, confidence: 0.96 }) } }],
          },
        };
  });
  service.configure({
    enabled: true,
    vendor: 'openai',
    model: 'primary',
    endpoint: '',
    apiKey: 'fake-primary',
  });
  service.configureBackup({
    enabled: true,
    vendor: 'qwen',
    model: 'backup',
    endpoint: '',
    apiKey: 'fake-backup',
  });
  const image = 'data:image/png;base64,aGVsbG8=';
  service.hero(image, [hero], 'backup-check');
  for (let i = 0; i < 10 && service.diagnostics().busy; i++) await tick();
  assert.equal(service.hero(image, [hero], 'backup-check', false)?.heroId, hero);
  assert.equal(calls.length, 2);
  assert.equal(service.diagnostics().dispatched, 1);
});
