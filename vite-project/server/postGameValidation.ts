import {
  postGameMetrics, postGameTeamMetrics, postGameGrades, postGamePercentMetrics,
  postGameDecimalMetrics, postGameUnitMetrics,
  type PostGameMetric, type PostGameTeamMetric, type PostGameField, type PostGameGradeField,
} from '../src/shared/postGame.js';
import { settlementPages } from '../src/shared/gameCapture.js';
import { validGoldDifferenceTimeline, type GoldDifferenceTimeline } from '../src/shared/postGameTimeline.js';

const evidencePath = /^\/uploads\/player-portraits\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.png$/;
function metadata(field: { confidence: number; manual?: boolean; capturedAt?: number; evidence?: string }) {
  if (typeof field.confidence !== 'number' || !Number.isFinite(field.confidence) || field.confidence < 0 || field.confidence > 1) throw new Error('Invalid post-game confidence');
  if (field.capturedAt !== undefined && (!Number.isSafeInteger(field.capturedAt) || field.capturedAt < 0)) throw new Error('Invalid capture time');
  if (field.evidence !== undefined && (typeof field.evidence !== 'string' || !evidencePath.test(field.evidence))) throw new Error('Invalid evidence');
}

/** Apply the same rules to live actions and restored reports. */
export function validatePostGameField(metric: PostGameMetric | PostGameTeamMetric, value: unknown, scope: 'player' | 'team'): asserts value is PostGameField {
  if (!value || typeof value !== 'object') throw new Error('Invalid post-game value');
  const field = value as PostGameField;
  metadata(field);
  if (typeof field.manual !== 'boolean' || typeof field.value !== 'number' || !Number.isFinite(field.value) || field.value < 0) throw new Error('Invalid post-game value');
  if (scope === 'team') {
    if (!postGameTeamMetrics.includes(metric as PostGameTeamMetric) || field.sourcePage !== 'recap' || !Number.isInteger(field.value) || field.value > (metric === 'gold' ? 1000000 : 999)) throw new Error('Invalid team field');
  } else {
    const playerMetric = metric as PostGameMetric;
    if (!postGameMetrics.includes(playerMetric) || !settlementPages.includes(field.sourcePage) || field.sourcePage === 'recap' || field.value > 1e9) throw new Error('Invalid post-game field');
    if (postGamePercentMetrics.includes(playerMetric) && field.value > 100) throw new Error('Percentage must be 0–100');
    if (playerMetric === 'rating' && field.value > 100) throw new Error('Rating must be 0–100');
    if (!postGameDecimalMetrics.includes(playerMetric) && !Number.isInteger(field.value)) throw new Error('Integer required');
  }
  if (field.resolution !== undefined && ((!postGameUnitMetrics.includes(metric as PostGameMetric) && field.resolution !== 1) || ![1, 10, 100, 1000, 10000].includes(field.resolution) || field.manual && field.resolution !== 1)) throw new Error('Invalid numeric resolution');
}

export function validatePostGameGrade(value: unknown): asserts value is PostGameGradeField {
  if (!value || typeof value !== 'object') throw new Error('Invalid game grade');
  const field = value as PostGameGradeField;
  if (!postGameGrades.includes(field.value) || field.sourcePage !== 'summary' || typeof field.manual !== 'boolean') throw new Error('Invalid game grade');
  metadata(field);
}

export function validatePostGameCurve(value: unknown): asserts value is GoldDifferenceTimeline {
  if (!validGoldDifferenceTimeline(value)) throw new Error('Invalid economy advantage curve');
  metadata(value);
}
