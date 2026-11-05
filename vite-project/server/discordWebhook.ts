import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MatchState } from '../src/shared/types.js';
import { currentGame, seriesFinished } from '../src/shared/draftRules.js';
import { currentPostGameReport } from '../src/shared/postGame.js';
import type { SecureSettings } from './secureSettings.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const webhookPattern = /^https:\/\/discord\.com\/api\/webhooks\/\d{16,22}\/[A-Za-z0-9_-]{20,200}$/;
interface Notice {
  id: string;
  hash: string;
  target: string;
  content: string;
  createdAt: number;
  kind: string;
  pollUrl?: string;
  status: 'sending' | 'sent' | 'failed' | 'uncertain';
  messageId?: string;
  error?: string;
  retryAt?: number;
}

/** One-way announcements, independent of the optional Bot/voting archive. */
export class DiscordWebhook {
  private notices: Notice[] = [];
  private busy = false;
  constructor(
    private file: string,
    private storage: SecureSettings,
    private fetcher: typeof fetch = fetch,
    private now = Date.now,
  ) {
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { version: number; notices: Notice[] };
      if (
        raw.version !== 1 ||
        !Array.isArray(raw.notices) ||
        raw.notices.length > 100 ||
        raw.notices.some(
          (notice) =>
            !notice ||
            typeof notice.id !== 'string' ||
            !/^[a-f0-9-]{36}$/.test(notice.id) ||
            typeof notice.content !== 'string' ||
            notice.content.length > 2000 ||
            !/^[a-f0-9]{64}$/.test(notice.hash) ||
            !/^[a-f0-9]{64}$/.test(notice.target) ||
            !Number.isSafeInteger(notice.createdAt) ||
            !['sending', 'sent', 'failed', 'uncertain'].includes(notice.status),
        )
      )
        throw Error('Invalid Webhook log; preserve and repair the original file');
      this.notices = raw.notices.map((notice) =>
        notice.status === 'sending'
          ? {
              ...notice,
              status: 'uncertain',
              error: 'Previous send unconfirmed; check Discord before retrying.',
            }
          : notice,
      );
    }
  }
  snapshot() {
    return {
      configured: !!this.storage.get<{ webhookUrl?: string }>('discord')?.webhookUrl,
      notices: this.notices.map((notice) => ({ ...notice, target: undefined })),
      busy: this.busy,
    };
  }
  preview(state: MatchState, input: Record<string, unknown>) {
    const game = currentGame(state),
      report = currentPostGameReport(state);
    const score = `${state.blueTeam.name} ${state.blueScore} : ${state.redScore} ${state.redTeam.name}`;
    let content: string;
    switch (input.kind) {
      case 'start':
        content = `赛事开始 / Match starting · ${state.stage} · ${state.seriesFormat}\n${score}`;
        break;
      case 'score':
        content = `比分 / Score update · 第 ${game} 局 / Game ${game}\n${score}`;
        break;
      case 'game-end':
        if (!state.committedGameId)
          throw Error('Confirm the completed game before announcing its end');
        content = `本局结束 / Game ${game} complete\n${score}`;
        break;
      case 'mvp': {
        const player = report?.players.find((row) => row.rowId === report.selectedMvpRowId);
        if (!player) throw Error('Select and confirm the current report MVP in Post-game first');
        content = `第 ${game} 局 MVP / Game ${game} MVP: ${player.playerId} · ${player.teamName}\n导播已确认 / Operator confirmed. Not an automatically collected Discord vote result.`;
        break;
      }
      case 'series-end':
        if (!seriesFinished(state)) throw Error('The series score is not final');
        content = `赛事结束 / Series complete · ${state.stage} · ${state.seriesFormat}\n${score}`;
        break;
      case 'poll-link': {
        if (typeof input.pollUrl !== 'string' || input.pollUrl.length > 500)
          throw Error('Invalid poll link');
        const url = new URL(input.pollUrl);
        if (
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          url.pathname.includes('/api/webhooks/')
        )
          throw Error('Use a public HTTPS poll link without credentials');
        content = `外部投票 / External poll · 第 ${game} 局\n${url.href}\n由外部平台计票，导播人工确认结果 / External tally; operator confirmation required.`;
        break;
      }
      default:
        throw Error('Unknown announcement type');
    }
    if (content.length > 2000) throw Error('Announcement too long');
    return {
      content,
      hash: hash(JSON.stringify([state.committedGameId, report?.id, game, input.kind, content])),
    };
  }
  private save() {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify({ version: 1, notices: this.notices }), {
      mode: 0o600,
    });
    renameSync(this.file + '.tmp', this.file);
  }
  async send(state: MatchState, input: Record<string, unknown>) {
    const preview = this.preview(state, input);
    if (input.previewHash !== preview.hash) throw Error('Match or preview changed; preview again');
    return this.deliver(preview, input);
  }
  /** Internal, frozen vote notices share the same delivery journal and secret storage. */
  async publish(id: string, content: string, confirmUncertain = false) {
    if (!content || content.length > 2000) throw Error('Invalid announcement content');
    await this.deliver({ content, hash: hash(content) }, { id, kind: 'strict-vote', confirmUncertain });
    return this.snapshot().notices.find(notice => notice.id === id)!;
  }
  private async deliver(preview: { content: string; hash: string }, input: Record<string, unknown>) {
    if (typeof input.id !== 'string' || !/^[a-f0-9-]{36}$/.test(input.id))
      throw Error('Invalid announcement ID');
    const url = this.storage.get<{ webhookUrl?: string }>('discord')?.webhookUrl;
    if (!url || !webhookPattern.test(url))
      throw Error('Configure an official Discord Webhook first; no Bot is required');
    const prior = this.notices.find((notice) => notice.id === input.id);
    if (prior && (prior.hash !== preview.hash || prior.target !== hash(url)))
      throw Error('Announcement or destination changed; preview again');
    if (prior?.status === 'sent') return this.snapshot();
    if (this.busy) throw Error('Webhook send in progress');
    if (prior?.status === 'uncertain' && input.confirmUncertain !== true)
      throw Error('Delivery uncertain; check the channel and explicitly confirm before retrying');
    if (this.notices.some((notice) => (notice.retryAt || 0) > this.now()))
      throw Error('Discord rate limit; retry after the recorded cooldown');
    const notice: Notice = prior ?? {
      id: input.id,
      hash: preview.hash,
      target: hash(url),
      content: preview.content,
      kind: String(input.kind),
      ...(typeof input.pollUrl === 'string' ? { pollUrl: input.pollUrl } : {}),
      createdAt: this.now(),
      status: 'sending',
    };
    notice.status = 'sending';
    notice.error = undefined;
    if (!prior) this.notices = [...this.notices.slice(-99), notice];
    this.save();
    this.busy = true;
    try {
      const response = await this.fetcher(url + '?wait=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: notice.content, allowed_mentions: { parse: [] } }),
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      });
      const data = (await response.json().catch(() => ({}))) as {
        id?: unknown;
        retry_after?: unknown;
      };
      if (response.status === 429) {
        const seconds =
          typeof data.retry_after === 'number' &&
          Number.isFinite(data.retry_after) &&
          data.retry_after > 0
            ? Math.min(data.retry_after, 86400)
            : 60;
        notice.status = 'failed';
        notice.retryAt = this.now() + Math.ceil(seconds * 1000);
        notice.error = 'Discord rate limited; retry after cooldown';
      } else if (response.ok && typeof data.id === 'string' && /^\d{16,22}$/.test(data.id)) {
        notice.status = 'sent';
        notice.messageId = data.id;
      } else if (response.status >= 400 && response.status < 500 && response.status !== 408) {
        notice.status = 'failed';
        notice.error = `Discord rejected announcement (HTTP ${response.status})`;
      } else {
        notice.status = 'uncertain';
        notice.error = 'Delivery unconfirmed; check the channel before retrying';
      }
    } catch {
      notice.status = 'uncertain';
      notice.error = 'Delivery unconfirmed; check the channel before retrying';
    } finally {
      this.busy = false;
      this.save();
    }
    return this.snapshot();
  }
}
