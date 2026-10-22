import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import { AiRecognitionService } from './aiRecognition.js';
import { evaluateHero } from './aiEvaluation.js';
import { heroesForPool } from '../src/shared/heroPool.js';
import { summarizeAiEvaluation, type AiEvaluationRow } from '../src/shared/aiEvaluation.js';
const [a, b] = heroesForPool('global').map((h) => h.id);
const input = { image: 'data:image/png;base64,aGVsbG8=', allowedHeroIds: [a, b] };
const provider = (confidence: number) => ({
  id: 'test',
  recognize: async () => ({
    preview: '',
    fingerprint: 'keep',
    lockFingerprint: 'keep',
    meanLuma: 50,
    candidates: [{ heroId: a, confidence }],
  }),
});
function service(reply: unknown) {
  const ai = new AiRecognitionService(async () => ({
    status: 200,
    data: { choices: [{ message: { content: JSON.stringify(reply) } }] },
  }));
  ai.configure({
    enabled: true,
    vendor: 'openai',
    model: 'test-model',
    endpoint: '',
    apiKey: 'test',
  });
  return ai;
}
test('paired evaluation uses production conflict gate and never redispatches when polling', async () => {
  for (const [confidence, outcome, heroId] of [
    [0.4, 'ai-used', b],
    [0.7, 'conflict', a],
    [0.9, 'local-strong', a],
  ] as const) {
    const ai = service({ heroId: b, confidence: 0.96 });
    const result = await evaluateHero(input, provider(confidence), ai, tick);
    assert.equal(result.local.heroId, a);
    assert.equal(result.assisted.heroId, heroId);
    assert.equal(result.outcome, outcome);
    assert.equal(ai.diagnostics().dispatched, confidence >= 0.85 ? 0 : 1);
    assert.ok(result.assistedMs >= result.localMs);
  }
});
test('invalid AI output stays in denominator as local fallback, with one dispatch only', async () => {
  const ai = service({ heroId: b, confidence: 0.5 });
  const result = await evaluateHero(input, provider(0.4), ai, tick);
  assert.equal(result.outcome, 'unavailable');
  assert.deepEqual(result.assisted, result.local);
  assert.equal(ai.diagnostics().dispatched, 1);
});
test('disabled AI rejects before local work and read-only polling does not dispatch', async () => {
  const ai = new AiRecognitionService();
  await assert.rejects(evaluateHero(input, provider(0.4), ai, tick), /配置/);
  const enabled = service({ heroId: b, confidence: 0.95 });
  assert.equal(enabled.hero(input.image, [a, b], 'empty', false), undefined);
  assert.equal(enabled.diagnostics().dispatched, 0);
});
test('summary reports percentage points, corrections, regressions and nearest-rank P95', () => {
  const base = { confidence: 0.5 };
  const row = (local: number, assisted: number, ms: number): AiEvaluationRow => ({
    name: 'sample',
    expected: a,
    local: { ...base, heroId: local },
    assisted: { ...base, heroId: assisted },
    localMs: ms,
    assistedMs: ms + 100,
    outcome: 'ai-used',
    model: 'test',
    vendor: 'openai',
  });
  const summary = summarizeAiEvaluation([
    row(b, a, 10),
    row(a, b, 20),
    row(b, a, 30),
    { ...row(b, b, 40), outcome: 'unavailable' },
  ]);
  assert.equal(summary.gainPoints, 25);
  assert.equal(summary.corrected, 2);
  assert.equal(summary.regressed, 1);
  assert.equal(summary.unavailable, 1);
  assert.equal(summary.localP95, 40);
  assert.equal(summary.assistedP95, 140);
  assert.equal(summarizeAiEvaluation([]).gainPoints, null);
});
