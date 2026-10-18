export interface SharingTokens { caster: string; overlay: string }
interface AccessSettingsResult { token?: string; tokens?: SharingTokens }
type FailureCode = 'timeout' | 'unauthorized' | 'invalidResponse' | 'rejected';

export class AccessSettingsFailure extends Error {
  constructor(readonly code: FailureCode, readonly detail = '') { super(code); }
}

export function publicWebsiteBase(value: string, fallback: string) {
  const url = new URL(value.trim() || fallback);
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid website address');
  return url.origin;
}

export function sharingLinks(base: string, tokens: SharingTokens) {
  return { caster: `${base}/caster#token=${encodeURIComponent(tokens.caster)}`, overlay: `${base}/overlay/draft#token=${encodeURIComponent(tokens.overlay)}` };
}

export async function fetchAccessSettings(url: string, token: string, { password, signal, timeoutMs = 15000, fetcher = fetch }: {
  password?: string; signal?: AbortSignal; timeoutMs?: number; fetcher?: typeof fetch;
} = {}): Promise<AccessSettingsResult> {
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  if (signal?.aborted) abort.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; abort.abort(); }, timeoutMs);
  try {
    const saving = password !== undefined;
    const response = await fetcher(url, {
      method: saving ? 'PUT' : 'GET', cache: 'no-store', signal: abort.signal,
      headers: { Authorization: `Bearer ${token}`, ...(saving ? { 'Content-Type': 'application/json' } : {}) },
      ...(saving ? { body: JSON.stringify({ password }) } : {}),
    });
    if ([401, 403].includes(response.status)) throw new AccessSettingsFailure('unauthorized');
    const data: unknown = await response.json();
    if (!response.ok) throw new AccessSettingsFailure('rejected', data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : '');
    if (!data || typeof data !== 'object') throw new AccessSettingsFailure('invalidResponse');
    if (saving) {
      if (!('token' in data) || typeof data.token !== 'string' || !data.token.trim()) throw new AccessSettingsFailure('invalidResponse');
      return { token: data.token };
    }
    if (!('tokens' in data) || !data.tokens || typeof data.tokens !== 'object') throw new AccessSettingsFailure('unauthorized');
    const tokens = data.tokens;
    if (!('caster' in tokens) || !('overlay' in tokens) || typeof tokens.caster !== 'string' || !tokens.caster.trim() || typeof tokens.overlay !== 'string' || !tokens.overlay.trim()) throw new AccessSettingsFailure('invalidResponse');
    return { tokens: { caster: tokens.caster, overlay: tokens.overlay } };
  } catch (cause) {
    if (timedOut) throw new AccessSettingsFailure('timeout');
    if (cause instanceof SyntaxError) throw new AccessSettingsFailure('invalidResponse');
    throw cause;
  } finally {
    clearTimeout(timeout); signal?.removeEventListener('abort', onAbort);
  }
}
