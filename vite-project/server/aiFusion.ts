import { aiRecognition, type AiRecognitionService } from './aiRecognition.js';
import { parseLiveNumber, type LiveCandidate } from '../src/shared/gameCapture.js';
import { parsePostGameNumber, type PostGameMetric } from '../src/shared/postGame.js';
import type { PlayerOcrCandidateInput } from '../src/shared/playerSlots.js';

/** Reuse existing field parsers and publication gates. Model confidence alone
 * is not evidence: a credible conflicting OCR result always wins. */
export function fuseHud(
  images: unknown[],
  candidates: LiveCandidate[],
  context: string,
  service: AiRecognitionService = aiRecognition,
): LiveCandidate[] {
  return candidates.map((local, index) => {
    if (local.value !== null && local.confidence >= 0.85) return local;
    const ai = service.value(
      images[index],
      `${context}:hud:${local.key}`,
      `Read only ${local.key}; timer as mm:ss, gold may use k units`,
    );
    if (!ai) return local;
    const value = parseLiveNumber(ai.text, local.key);
    if (
      value === null ||
      (local.value !== null && local.value !== value && local.confidence >= 0.65)
    )
      return local;
    return { ...local, ...ai, value, source: 'ai' };
  });
}
export function fusePostGame(
  image: unknown,
  metric: PostGameMetric,
  context: string,
  local: { text: string; confidence: number },
  service: AiRecognitionService = aiRecognition,
) {
  const value = parsePostGameNumber(local.text, metric);
  if (value !== null && local.confidence >= 0.85) return local;
  const ai = service.value(
    image,
    context,
    `Read the single ${metric} numeric value, preserving units and decimal precision`,
  );
  if (!ai) return local;
  const parsed = parsePostGameNumber(ai.text, metric);
  return parsed !== null && !(value !== null && value !== parsed && local.confidence >= 0.65)
    ? { ...ai, source: 'ai' as const }
    : local;
}
export function fusePlayers(
  images: unknown[],
  candidates: PlayerOcrCandidateInput[][],
  rosters: [string[], string[]],
  context: string,
  service: AiRecognitionService = aiRecognition,
): PlayerOcrCandidateInput[][] {
  return candidates.map((local, index) => {
    const roster = rosters[index < 5 ? 0 : 1];
    if (local.some((c) => c.confidence >= 0.85 && roster.includes(c.text))) return local;
    // Do not put roster guesses into the prompt: require a visual transcription
    // followed by exact, case/punctuation-sensitive membership validation.
    const ai = service.value(
      images[index],
      `${context}:player:${index}`,
      'Transcribe the one player ID; preserve case and punctuation',
    );
    if (
      !ai ||
      !roster.includes(ai.text) ||
      local.some((c) => c.confidence >= 0.65 && roster.includes(c.text) && c.text !== ai.text)
    )
      return local;
    return [...local, { ...ai, variant: 'ai' }];
  });
}
