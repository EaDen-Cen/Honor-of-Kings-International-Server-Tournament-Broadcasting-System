import { useEffect, useState } from 'react';
import type { AiBudgetLimits } from '../shared/aiBudget';
import { apiURL } from '../shared/config';

interface Status {
  limits: AiBudgetLimits;
  day: string;
  calls: number;
  estimatedUsd: number;
  error: string;
  model?: string;
  diagnostics?: { requests: number; imageBytes: number; inputTokens: number; outputTokens: number };
}
export function AiBudgetSettings({ token, zh }: { token: string; zh: boolean }) {
  const [status, setStatus] = useState<Status>();
  const [limits, setLimits] = useState<AiBudgetLimits>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setStatus(undefined);
    setLimits(undefined);
    void fetch(`${apiURL}/api/v1/ai-recognition/budget`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]),
    })
      .then(async (response) => {
        if (!response.ok) throw Error('Local Control required');
        const data = (await response.json()) as Status;
        if (abort.signal.aborted) return;
        setStatus(data);
        setLimits(data.limits);
        setError(data.error || '');
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError(
            zh ? '预算查询失败，请在本机重试。' : 'Budget unavailable; retry from local Control.',
          );
      });
    return () => abort.abort();
  }, [token, refresh, zh]);
  async function save() {
    setBusy(true);
    try {
      const response = await fetch(`${apiURL}/api/v1/ai-recognition/budget`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(limits),
        signal: AbortSignal.timeout(8000),
      });
      const data = (await response.json()) as Status & { error?: string };
      if (!response.ok) throw Error(data.error || 'Budget save failed');
      setStatus(data);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Budget save failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="panel" aria-label={zh ? 'AI 费用保护' : 'AI cost protection'}>
      <summary>
        {zh
          ? 'AI 费用保护 · 默认停止付费请求'
          : 'AI cost protection · paid requests blocked by default'}
      </summary>
      <p>
        {zh
          ? '先设置预算和保守的单次估价，再启用 AI。包含连接测试、失败及备用模型请求；不退款式扣回。每日按 UTC 重置，重启不清零。估价不是实际账单，需在服务商设置真实消费上限。'
          : 'Set a budget and conservative per-request estimate before enabling AI. Connection tests, failures and fallback attempts count. Resets daily in UTC, not on restart. Estimates are not invoices; set a provider-side spending limit.'}
      </p>
      {limits && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {(
            [
              ['dailyCalls', zh ? '每日最多请求次数' : 'Daily request limit', 0, 10000, 1],
              [
                'dailyUsd',
                zh ? '每日估算预算（USD）' : 'Daily estimated budget (USD)',
                0,
                1000,
                0.001,
              ],
              [
                'estimatedRequestUsd',
                zh
                  ? '单次保守估价（USD，含备用模型）'
                  : 'Conservative estimate per request (USD, cover backup model)',
                0,
                10,
                0.001,
              ],
              [
                'maxImageBytes',
                zh ? '单次图片上限（字节）' : 'Per-request image byte limit',
                1024,
                2000000,
                1,
              ],
            ] as const
          ).map(([key, label, min, max, step]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                required
                min={min}
                max={max}
                step={step}
                value={limits[key]}
                disabled={busy}
                onChange={(event) => setLimits({ ...limits, [key]: event.target.valueAsNumber })}
              />
            </label>
          ))}
          <button type="submit" disabled={busy}>
            {zh ? '保存费用保护' : 'Save cost protection'}
          </button>
        </form>
      )}
      <button type="button" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>
        {zh ? '刷新费用状态' : 'Refresh cost status'}
      </button>
      {status && (
        <p role="status">
          UTC {status.day} · {zh ? '已预留请求' : 'Reserved requests'}: {status.calls} ·{' '}
          {zh ? '估算 USD' : 'Estimated USD'}: {status.estimatedUsd.toFixed(4)} ·{' '}
          {zh ? '实际账单：未知' : 'Actual invoice: unknown'}
          {status.model ? ` · ${status.model}` : ''}
        </p>
      )}
      {status?.diagnostics && (
        <p>
          {zh ? '本进程' : 'This process'}: {status.diagnostics.requests} requests ·{' '}
          {status.diagnostics.imageBytes} image bytes · {status.diagnostics.inputTokens}/
          {status.diagnostics.outputTokens} input/output tokens (
          {zh ? '仅服务商返回的用量' : 'reported usage only'})
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
