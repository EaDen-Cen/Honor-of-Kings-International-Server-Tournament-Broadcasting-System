import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { allPoolHeroes } from '../src/shared/heroPool.js';
import { publicAiAddress, visionTransport, type VisionTransport } from './aiTransport.js';
export type AiVendor =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'deepseek'
  | 'qwen'
  | 'doubao'
  | 'glm'
  | 'kimi'
  | 'baidu'
  | 'custom';
export interface AiPublicConfig {
  enabled: boolean;
  vendor: AiVendor;
  model: string;
  endpoint: string;
  configured: boolean;
}
type Settings = Omit<AiPublicConfig, 'configured'> & { apiKey: string };
const defaults: Record<AiVendor, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  deepseek: 'https://api.deepseek.com/chat/completions',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  doubao: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
  glm: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  kimi: 'https://api.moonshot.cn/v1/chat/completions',
  baidu: 'https://qianfan.baidubce.com/v2/chat/completions',
  custom: '',
};

const names = new Map(allPoolHeroes.map((h) => [h.id, `${h.chineseName} / ${h.englishName}`]));
const TTL_MS = 4000;
export interface AiValue {
  text: string;
  confidence: number;
}
function parseObject(raw: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return;
  }
}
/** A single bounded scheduler shared by all tasks. Tests inject a transport and
 * clock, so failure/latency coverage never calls a paid API or public network. */
export class AiRecognitionService {
  private settings: Settings = {
    enabled: false,
    vendor: 'openai',
    model: '',
    endpoint: '',
    apiKey: '',
  };
  private epoch = 0;
  private active?: { controller: AbortController; epoch: number; scope: string; key: string };
  private lastDispatch = -Infinity;
  private cooldownUntil = 0;
  private cache = new Map<string, { until: number; raw: string }>();
  private stats = { dispatched: 0, hits: 0, skipped: 0, failed: 0, cancelled: 0, completed: 0 };
  constructor(
    private transport: VisionTransport = visionTransport,
    private now = Date.now,
  ) {}
  publicConfig(): AiPublicConfig {
    const { enabled, vendor, model, endpoint, apiKey } = this.settings;
    return { enabled, vendor, model, endpoint, configured: !!apiKey };
  }
  diagnostics() {
    return { ...this.stats, busy: !!this.active, cached: this.cache.size };
  }
  configure(input: unknown): AiPublicConfig {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw Error('Invalid AI settings');
    const v = input as Record<string, unknown>;
    if (
      !Object.prototype.hasOwnProperty.call(defaults, v.vendor as string) ||
      typeof v.enabled !== 'boolean' ||
      typeof v.model !== 'string' ||
      v.model.length > 100 ||
      typeof v.endpoint !== 'string' ||
      v.endpoint.length > 300 ||
      (v.apiKey !== undefined && (typeof v.apiKey !== 'string' || v.apiKey.length > 512))
    )
      throw Error('Invalid AI settings');
    const vendor = v.vendor as AiVendor;
    const url = new URL(v.endpoint.trim() || defaults[vendor]);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.port && url.port !== '443') ||
      !host.includes('.') ||
      host.includes(':') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.endsWith('.localhost') ||
      (isIP(host) && !publicAiAddress(host))
    )
      throw Error('AI endpoint must be public HTTPS');
    if (vendor !== 'custom' && url.origin !== new URL(defaults[vendor]).origin)
      throw Error('Use Custom for third-party gateways');
    // Never carry an existing credential to a different gateway, even for the
    // same vendor. An explicit empty key clears it; omission keeps it only here.
    const endpoint = url.href;
    const same = vendor === this.settings.vendor && endpoint === this.settings.endpoint;
    const apiKey = typeof v.apiKey === 'string' ? v.apiKey : same ? this.settings.apiKey : '';
    this.invalidate();
    this.settings = { enabled: v.enabled, vendor, model: v.model.trim(), endpoint, apiKey };
    this.lastDispatch = -Infinity;
    this.cooldownUntil = 0;
    return this.publicConfig();
  }
  /** Match reset/configuration changes invalidate pending results as well as
   * caches. Abort alone is insufficient: a transport can finish concurrently. */
  invalidate() {
    this.epoch++;
    if (this.active) {
      this.active.controller.abort();
      this.stats.cancelled++;
    }
    this.cache.clear();
  }
  private async ask(
    image: string,
    prompt: string,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image);
    if (!match || match[2].length > 2_700_000) return;
    const requestEpoch = this.epoch;
    const current = { ...this.settings },
      mime = 'image/' + match[1],
      data = match[2];
    let target = current.endpoint;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let body: unknown;
    if (current.vendor === 'gemini') {
      target =
        target.replace(/\/$/, '') +
        '/models/' +
        encodeURIComponent(current.model) +
        ':generateContent';
      headers['x-goog-api-key'] = current.apiKey;
      body = {
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data } }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 256 },
      };
    } else if (current.vendor === 'anthropic') {
      headers['x-api-key'] = current.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      body = {
        model: current.model,
        max_tokens: 256,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image', source: { type: 'base64', media_type: mime, data } },
            ],
          },
        ],
      };
    } else {
      headers.Authorization = 'Bearer ' + current.apiKey;
      body = {
        model: current.model,
        temperature: 0,
        max_tokens: 256,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: image } },
            ],
          },
        ],
      };
    }
    const response = await this.transport(target, headers, body, signal);
    if (signal.aborted || requestEpoch !== this.epoch) return;
    if (response.status === 429 || response.status >= 500) this.cooldownUntil = this.now() + 10_000;
    if (response.status < 200 || response.status >= 300) throw Error('AI request failed');
    const json = response.data as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      content?: { text?: string }[];
      choices?: { message?: { content?: string } }[];
    };
    const reply =
      current.vendor === 'gemini'
        ? json?.candidates?.[0]?.content?.parts?.[0]?.text
        : current.vendor === 'anthropic'
          ? json?.content?.[0]?.text
          : json?.choices?.[0]?.message?.content;
    return typeof reply === 'string' && reply.length <= 8000 ? reply : undefined;
  }
  /** Return immediately; a repeated exact image can consume the result later.
   * Scopes include authoritative game/revision, field/row and ROI calibration.
   * An obsolete request for the same stream is aborted, never queued. */
  suggest(image: unknown, scope: string, prompt: string): string | undefined {
    if (
      !this.settings.enabled ||
      !this.settings.apiKey ||
      !this.settings.model ||
      typeof image !== 'string' ||
      image.length > 2_700_050 ||
      prompt.length > 16000
    )
      return;
    const key = createHash('sha256')
      .update(JSON.stringify([this.epoch, scope, prompt, image]))
      .digest('hex');
    const now = this.now();
    for (const [id, item] of this.cache) if (item.until <= now) this.cache.delete(id);
    const cached = this.cache.get(key);
    if (cached) {
      this.stats.hits++;
      return cached.raw;
    }
    if (this.active?.scope === scope && this.active.key !== key) this.active.controller.abort();
    if (this.active || now < this.cooldownUntil || now - this.lastDispatch < 1200) {
      this.stats.skipped++;
      return;
    }
    this.lastDispatch = now;
    this.stats.dispatched++;
    const job = { controller: new AbortController(), epoch: this.epoch, scope, key };
    this.active = job;
    const timeout = setTimeout(() => job.controller.abort(), 1800);
    // Deadline race also frees the scheduler for a misbehaving transport which
    // ignores AbortSignal. Its eventual result has no path back into the cache.
    const aborted = new Promise<undefined>((resolve) =>
      job.controller.signal.addEventListener('abort', () => resolve(undefined), { once: true }),
    );
    void Promise.race([this.ask(image, prompt, job.controller.signal), aborted])
      .then((raw) => {
        if (!raw || job.epoch !== this.epoch || job.controller.signal.aborted) return;
        this.cache.set(key, { raw, until: this.now() + TTL_MS });
        this.stats.completed++;
        if (this.cache.size > 80) this.cache.delete(this.cache.keys().next().value!);
      })
      .catch(() => {
        this.stats.failed++;
      })
      .finally(() => {
        clearTimeout(timeout);
        if (this.active === job) this.active = undefined;
      });
    return;
  }
  hero(image: unknown, ids: number[], scope: string) {
    if (!ids.length || ids.length > 250 || !ids.every((id) => names.has(id))) return;
    const raw = this.suggest(
      image,
      scope,
      'Identify this Honor of Kings hero from catalog ' +
        ids.map((id) => id + ': ' + names.get(id)).join('; ') +
        '. Return ONLY JSON {"heroId":number,"confidence":number}. Unknown: {"heroId":0,"confidence":0}.',
    );
    const v = raw ? parseObject(raw) : undefined;
    if (
      !v ||
      !Number.isSafeInteger(v.heroId) ||
      !ids.includes(v.heroId as number) ||
      typeof v.confidence !== 'number' ||
      !Number.isFinite(v.confidence) ||
      v.confidence < 0.9 ||
      v.confidence > 1
    )
      return;
    return { heroId: v.heroId as number, confidence: Math.min(0.95, v.confidence) };
  }
  value(image: unknown, scope: string, instruction: string): AiValue | undefined {
    const raw = this.suggest(
      image,
      scope,
      instruction +
        '. Return ONLY JSON {"text":string|null,"confidence":number}. Use null if obscured; never infer a value.',
    );
    const v = raw ? parseObject(raw) : undefined;
    if (
      !v ||
      typeof v.text !== 'string' ||
      v.text.length > 80 ||
      typeof v.confidence !== 'number' ||
      !Number.isFinite(v.confidence) ||
      v.confidence < 0.9 ||
      v.confidence > 1
    )
      return;
    return { text: v.text, confidence: Math.min(0.95, v.confidence) };
  }
}
export const aiRecognition = new AiRecognitionService();
export const aiPublicConfig = () => aiRecognition.publicConfig();
export const setAiConfig = (input: unknown) => aiRecognition.configure(input);
/** Preserve local lock fingerprints and existing stable-frame / draft rules.
 * AI may fill an unknown or corroborate weak OCR; it never overrules a credible
 * conflicting local candidate or manufactures a lock/phase transition. */
export async function recognizeAiWithFallback<
  T extends { candidates: { heroId: number; confidence: number }[] },
>(image: string, ids: number[] | undefined, local: () => Promise<T>, scope = 'legacy'): Promise<T> {
  const result = await local();
  if (!ids?.length || result.candidates[0]?.confidence >= 0.85) return result;
  const candidate = aiRecognition.hero(image, ids, scope);
  if (!candidate) return result;
  const first = result.candidates[0];
  if (first && first.heroId !== candidate.heroId && first.confidence >= 0.65) return result;
  return {
    ...result,
    candidates: [candidate, ...result.candidates.filter((c) => c.heroId !== candidate.heroId)],
  };
}
