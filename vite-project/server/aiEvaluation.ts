import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { aiRecognition, fuseHeroCandidate, type AiRecognitionService } from './aiRecognition.js';
import type { HeroRecognitionProvider, RecognitionRequest } from './recognitionProvider.js';
import type { AiEvaluationResult } from '../src/shared/aiEvaluation.js';

/** Paired evidence on one crop. Ground truth is deliberately never sent to AI.
 * Uses the production scheduler and fusion gate; never publishes match state. */
export async function evaluateHero(
  input: RecognitionRequest & { allowedHeroIds: number[] },
  provider: HeroRecognitionProvider,
  service: AiRecognitionService = aiRecognition,
  wait: () => Promise<void> = () => delay(100),
): Promise<AiEvaluationResult> {
  const config = service.publicConfig();
  if (!config.enabled || !config.configured || !config.model)
    throw Error('请先在 Control 配置并启用视觉 AI');
  const start = performance.now();
  const local = await provider.recognize(input);
  const localMs = performance.now() - start;
  let assisted = local;
  let outcome: AiEvaluationResult['outcome'] = 'local-strong';
  if (!(local.candidates[0]?.confidence >= 0.85)) {
    const scope = `evaluation:${randomUUID()}`;
    let candidate = service.hero(input.image, input.allowedHeroIds, scope);
    // Exactly one dispatch attempt. Busy, cooldown, failures and invalid output
    // stay visible as unavailable; polling may only read this sample's cache.
    for (let attempt = 0; !candidate && attempt < 20; attempt++) {
      await wait();
      candidate = service.hero(input.image, input.allowedHeroIds, scope, false);
    }
    if (candidate) {
      assisted = fuseHeroCandidate(local, candidate);
      outcome = assisted === local ? 'conflict' : 'ai-used';
    } else outcome = 'unavailable';
  }
  const top = (result: typeof local) => ({
    heroId: result.candidates[0]?.heroId ?? null,
    confidence: result.candidates[0]?.confidence ?? 0,
  });
  return {
    local: top(local),
    assisted: top(assisted),
    localMs,
    assistedMs: performance.now() - start,
    outcome,
    model: config.model,
    vendor: config.vendor,
  };
}
