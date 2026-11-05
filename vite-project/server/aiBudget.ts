import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { AiBudgetLimits } from '../src/shared/aiBudget.js';
interface Ledger {
  version: 1;
  day: string;
  calls: number;
  estimatedUsd: number;
  limits: AiBudgetLimits;
}
const defaults: AiBudgetLimits = {
  dailyCalls: 100,
  dailyUsd: 0,
  estimatedRequestUsd: 0,
  maxImageBytes: 512000,
};
function validate(value: unknown): AiBudgetLimits {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid AI budget');
  const v = value as AiBudgetLimits;
  if (
    !Number.isSafeInteger(v.dailyCalls) ||
    v.dailyCalls < 0 ||
    v.dailyCalls > 10000 ||
    !Number.isFinite(v.dailyUsd) ||
    v.dailyUsd < 0 ||
    v.dailyUsd > 1000 ||
    !Number.isFinite(v.estimatedRequestUsd) ||
    v.estimatedRequestUsd < 0 ||
    v.estimatedRequestUsd > 10 ||
    !Number.isSafeInteger(v.maxImageBytes) ||
    v.maxImageBytes < 1024 ||
    v.maxImageBytes > 2000000
  )
    throw Error('Invalid AI budget');
  return {
    dailyCalls: v.dailyCalls,
    dailyUsd: v.dailyUsd,
    estimatedRequestUsd: v.estimatedRequestUsd,
    maxImageBytes: v.maxImageBytes,
  };
}

/** Reserve before transport, including failures and retries: a timeout can still be billed. */
export class AiBudget {
  private data: Ledger;
  private error = '';
  constructor(
    private file: string,
    private now = Date.now,
  ) {
    this.data = {
      version: 1,
      day: this.today(),
      calls: 0,
      estimatedUsd: 0,
      limits: { ...defaults },
    };
    if (existsSync(file))
      try {
        const raw = JSON.parse(readFileSync(file, 'utf8')) as Ledger;
        if (
          raw.version !== 1 ||
          !/^\d{4}-\d{2}-\d{2}$/.test(raw.day) ||
          !Number.isSafeInteger(raw.calls) ||
          raw.calls < 0 ||
          !Number.isFinite(raw.estimatedUsd) ||
          raw.estimatedUsd < 0
        )
          throw Error();
        this.data = { ...raw, limits: validate(raw.limits) };
      } catch {
        this.error =
          'AI budget ledger unavailable; paid requests blocked. Preserve and repair the ledger.';
      }
  }
  private today() {
    return new Date(this.now()).toISOString().slice(0, 10);
  }
  private current(): Ledger {
    return this.today() > this.data.day
      ? { ...this.data, day: this.today(), calls: 0, estimatedUsd: 0 }
      : this.data;
  }
  private save(next: Ledger) {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify(next), { mode: 0o600 });
    renameSync(this.file + '.tmp', this.file);
    this.data = next;
  }
  snapshot() {
    return {
      ...structuredClone(this.current()),
      error: this.error,
      actualCostUsd: null,
      priceSource: 'operator estimate',
    };
  }
  configure(input: unknown) {
    if (this.error) throw Error(this.error);
    this.save({ ...this.current(), limits: validate(input) });
    return this.snapshot();
  }
  reserve(imageBytes: number) {
    if (this.error) throw Error(this.error);
    const next = this.current(),
      limits = next.limits;
    if (!Number.isSafeInteger(imageBytes) || imageBytes < 1 || imageBytes > limits.maxImageBytes)
      throw Error('AI image exceeds per-request budget');
    if (
      limits.estimatedRequestUsd <= 0 ||
      limits.dailyUsd <= 0 ||
      next.calls >= limits.dailyCalls ||
      next.estimatedUsd + limits.estimatedRequestUsd > limits.dailyUsd + 1e-9
    )
      throw Error('AI daily budget exhausted or not configured');
    this.save({
      ...next,
      calls: next.calls + 1,
      estimatedUsd: Math.round((next.estimatedUsd + limits.estimatedRequestUsd) * 1e9) / 1e9,
    });
  }
}
