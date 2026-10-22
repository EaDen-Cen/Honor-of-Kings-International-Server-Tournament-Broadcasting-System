export interface AiEvaluationResult {
  local: { heroId: number | null; confidence: number };
  assisted: { heroId: number | null; confidence: number };
  localMs: number;
  assistedMs: number;
  outcome: 'local-strong' | 'ai-used' | 'conflict' | 'unavailable';
  model: string;
  vendor: string;
}
export interface AiEvaluationRow extends AiEvaluationResult {
  name: string;
  expected: number;
}
export function summarizeAiEvaluation(rows: AiEvaluationRow[]) {
  const total = rows.length;
  const localCorrect = rows.filter((r) => r.local.heroId === r.expected).length;
  const assistedCorrect = rows.filter((r) => r.assisted.heroId === r.expected).length;
  const p95 = (values: number[]) =>
    values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] : null;
  return {
    total,
    localCorrect,
    assistedCorrect,
    gainPoints: total ? ((assistedCorrect - localCorrect) / total) * 100 : null,
    corrected: rows.filter((r) => r.local.heroId !== r.expected && r.assisted.heroId === r.expected)
      .length,
    regressed: rows.filter((r) => r.local.heroId === r.expected && r.assisted.heroId !== r.expected)
      .length,
    unavailable: rows.filter((r) => r.outcome === 'unavailable').length,
    localP95: p95(rows.map((r) => r.localMs)),
    assistedP95: p95(rows.map((r) => r.assistedMs)),
  };
}
