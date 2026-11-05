import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiBudget } from './aiBudget.js';
import { AiRecognitionService } from './aiRecognition.js';
import { setImmediate as tick } from 'node:timers/promises';

const limits = { dailyCalls: 2, dailyUsd: 0.02, estimatedRequestUsd: 0.01, maxImageBytes: 1024 };
const config = {
  enabled: true,
  vendor: 'openai',
  model: 'test',
  endpoint: '',
  apiKey: 'test-only',
};

test('budgets fail closed by default, survive restart/config edits, and reset only on a newer UTC day', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hok-ai-budget-'));
  let now = Date.UTC(2026, 10, 3);
  try {
    const file = join(dir, 'budget.json');
    let budget = new AiBudget(file, () => now);
    assert.throws(() => budget.reserve(10), /not configured/);
    budget.configure(limits);
    assert.throws(() => budget.reserve(1025), /per-request/);
    assert.equal(budget.snapshot().calls, 0);
    budget.reserve(10);
    budget = new AiBudget(file, () => now);
    budget.configure(limits);
    budget.reserve(10);
    assert.throws(() => budget.reserve(10), /exhausted/);
    now -= 86400000;
    assert.throws(() => budget.reserve(10), /exhausted/);
    now += 2 * 86400000;
    budget.reserve(10);
    assert.equal(budget.snapshot().calls, 1);
    assert.equal(budget.snapshot().estimatedUsd, 0.01);
    assert.equal(budget.snapshot().actualCostUsd, null);
    writeFileSync(file, '{broken');
    budget = new AiBudget(file, () => now);
    assert.throws(() => budget.reserve(10), /ledger/);
    assert.throws(() => budget.configure(limits), /ledger/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every transport attempt reserves budget including fallback and connection test; failures are not refunded', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hok-ai-attempts-'));
  let now = Date.UTC(2026, 10, 3),
    requests = 0;
  try {
    const budget = new AiBudget(join(dir, 'budget.json'), () => now);
    budget.configure(limits);
    const service = new AiRecognitionService(
      async () => {
        requests++;
        return { status: 400, data: {} };
      },
      () => now,
    );
    service.setBudget(budget);
    service.configure(config);
    service.configureBackup({ ...config, model: 'backup' });
    service.suggest('data:image/png;base64,aGVsbG8=', 'game', 'test');
    await tick();
    assert.equal(requests, 2);
    assert.equal(budget.snapshot().calls, 2);
    assert.equal(service.diagnostics().requests, 2);
    now += 2000;
    await assert.rejects(service.testConnection(), /budget/);
    assert.equal(requests, 2);
    const restarted = new AiBudget(join(dir, 'budget.json'), () => now);
    assert.throws(() => restarted.reserve(10), /exhausted/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
