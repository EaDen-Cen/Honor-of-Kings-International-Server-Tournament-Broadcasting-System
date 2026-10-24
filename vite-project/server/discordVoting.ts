import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SecureSettings } from './secureSettings.js';
import {
  voteCandidates,
  type AudienceVote,
  type DiscordPublicConfig,
  type VoteCandidate,
} from '../src/shared/audienceVote.js';
import type { MatchState } from '../src/shared/types.js';
import { currentPostGameReport } from '../src/shared/postGame.js';

type Config = Omit<
  DiscordPublicConfig,
  'configured' | 'webhookConfigured' | 'tokenMask' | 'storageError'
> & { botToken: string; webhookUrl: string };
export type DiscordRequest = (
  path: string,
  method: string,
  body?: unknown,
) => Promise<Record<string, unknown>>;
const snowflake = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{16,22}$/.test(value);
const defaults: Config = {
  guildId: '',
  channelId: '',
  botToken: '',
  webhookUrl: '',
  minutes: 3,
  scope: 'all',
  hideLiveVotes: false,
  autoStart: false,
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const answerLabel = (candidate: VoteCandidate, index: number) =>
  `${index + 1}. ${candidate.name} · ${candidate.team}`.slice(0, 55);
class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class DiscordVoting {
  private config: Config;
  private votes: AudienceVote[] = [];
  private busy = false;
  private retryAt = 0;
  private error = '';
  constructor(
    private file: string,
    private storage: SecureSettings,
    private requestOverride?: DiscordRequest,
    private now = Date.now,
  ) {
    this.config = { ...defaults, ...storage.get<Config>('discord') };
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.votes))
        throw Error('Unsupported vote archive; original file preserved');
      if (
        data.votes.some(
          (v: AudienceVote) =>
            !v ||
            typeof v.id !== 'string' ||
            typeof v.gameKey !== 'string' ||
            !snowflake(v.channelId) ||
            (v.messageId !== null && !snowflake(v.messageId)) ||
            !Number.isSafeInteger(v.deadline) ||
            !Number.isSafeInteger(v.gameNumber) ||
            ![
              'creating',
              'creation-uncertain',
              'active',
              'ending',
              'pending',
              'finalized',
              'cancelled',
              'failed',
            ].includes(v.status) ||
            !Array.isArray(v.candidates) ||
            ![5, 10].includes(v.candidates.length) ||
            new Set(v.candidates.map((c) => c?.rowId)).size !== v.candidates.length ||
            v.candidates.some(
              (c) =>
                !c ||
                typeof c.rowId !== 'string' ||
                typeof c.name !== 'string' ||
                typeof c.team !== 'string' ||
                !['blue', 'red'].includes(c.side),
            ) ||
            !Array.isArray(v.winners) ||
            v.winners.some((id) => !v.candidates.some((c) => c.rowId === id)) ||
            (v.counts !== null &&
              (!Array.isArray(v.counts) ||
                v.counts.length !== v.candidates.length ||
                v.counts.some((count) => !Number.isSafeInteger(count) || count < 0))),
        )
      )
        throw Error('Invalid vote archive; original file preserved');
      this.votes = data.votes;
      for (const vote of this.votes)
        if (vote.status === 'creating') {
          vote.status = 'creation-uncertain';
          vote.error = '创建请求结果未知；请从 Discord 核对消息 ID 后恢复，避免重复发起。';
        }
    }
  }
  publicConfig(): DiscordPublicConfig {
    const { botToken, webhookUrl, ...config } = this.config;
    return {
      ...config,
      configured: !!botToken,
      webhookConfigured: !!webhookUrl,
      tokenMask: botToken ? '••••••' + (botToken.length > 8 ? botToken.slice(-4) : '') : '',
      storageError: this.storage.error,
    };
  }
  saveConfig(input: Record<string, unknown>) {
    if (this.busy) throw Error('投票任务处理中，请稍后更改连接');
    const next = { ...this.config };
    for (const key of ['guildId', 'channelId'] as const)
      if (input[key] !== undefined) {
        if (input[key] !== '' && !snowflake(input[key])) throw Error('Invalid Discord ID');
        next[key] = input[key] as string;
      }
    if (input.botToken !== undefined) {
      if (
        typeof input.botToken !== 'string' ||
        input.botToken.length > 256 ||
        /[\r\n]/.test(input.botToken)
      )
        throw Error('Invalid Bot token');
      next.botToken = input.botToken.trim();
    }
    if (input.webhookUrl !== undefined) {
      if (typeof input.webhookUrl !== 'string') throw Error('Invalid webhook URL');
      if (
        input.webhookUrl &&
        !/^https:\/\/discord\.com\/api\/webhooks\/\d{16,22}\/[A-Za-z0-9_-]{20,200}$/.test(
          input.webhookUrl,
        )
      )
        throw Error('Use an official discord.com webhook URL');
      next.webhookUrl = input.webhookUrl;
    }
    if (input.minutes !== undefined) {
      if (
        !Number.isInteger(input.minutes) ||
        Number(input.minutes) < 2 ||
        Number(input.minutes) > 5
      )
        throw Error('投票时长为 2–5 分钟');
      next.minutes = Number(input.minutes);
    }
    if (input.scope !== undefined) {
      if (input.scope !== 'all' && input.scope !== 'winner') throw Error('Invalid candidate scope');
      next.scope = input.scope;
    }
    for (const key of ['hideLiveVotes', 'autoStart'] as const)
      if (input[key] !== undefined) {
        if (typeof input[key] !== 'boolean') throw Error('Invalid voting option');
        next[key] = input[key];
      }
    const active = this.votes.find((v) => !['finalized', 'cancelled', 'failed'].includes(v.status));
    if (
      active &&
      (next.botToken !== this.config.botToken ||
        next.channelId !== this.config.channelId ||
        next.guildId !== this.config.guildId)
    )
      throw Error('先完成或取消当前投票，再更换 Bot / 频道');
    this.storage.set('discord', next);
    this.config = next;
    return this.publicConfig();
  }
  snapshot(overlay = false) {
    const votes = structuredClone(this.votes);
    if (overlay && this.config.hideLiveVotes)
      for (const vote of votes)
        if (vote.status !== 'finalized') {
          vote.counts = null;
          vote.total = null;
        }
    return { votes, hideLiveVotes: this.config.hideLiveVotes, error: this.error };
  }
  private save() {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify({ version: 1, votes: this.votes }), {
      mode: 0o600,
    });
    renameSync(this.file + '.tmp', this.file);
  }
  private async request(
    path: string,
    method = 'GET',
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    if (this.now() < this.retryAt) throw Error('Discord 限流冷却中，稍后自动重试');
    if (this.requestOverride) return this.requestOverride(path, method, body);
    if (!this.config.botToken) throw Error('请先配置 Discord Bot');
    let response: Response;
    try {
      response = await fetch('https://discord.com/api/v10' + path, {
        method,
        headers: {
          Authorization: 'Bot ' + this.config.botToken,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
    } catch {
      throw Error('Discord 网络请求失败；状态保留，可重试');
    }
    const text = await response.text();
    if (text.length > 1000000) throw Error('Discord response too large');
    let data: Record<string, unknown> = {};
    try {
      data = object(JSON.parse(text || '{}'));
    } catch {
      throw Error('Discord returned invalid JSON');
    }
    if (response.status === 429) {
      this.retryAt =
        this.now() +
        Math.max(
          1000,
          Math.min(
            3600000,
            Number(data.retry_after || response.headers.get('retry-after') || 5) * 1000,
          ),
        );
      throw new DiscordApiError(429, 'Discord API 限流，等待后重试');
    }
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining === '0')
      this.retryAt =
        this.now() +
        Math.max(1000, Number(response.headers.get('x-ratelimit-reset-after') || 1) * 1000);
    if (!response.ok)
      throw new DiscordApiError(
        response.status,
        `Discord HTTP ${response.status}；请检查 Bot 权限、频道与凭证`,
      );
    return data;
  }
  async testConnection() {
    const user = await this.request('/users/@me');
    const channel = await this.request(`/channels/${this.config.channelId}`);
    if (channel.guild_id !== this.config.guildId) throw Error('频道不属于已配置的服务器');
    // Reading verifies identity and access; Send Polls / Send Messages also need a real poll rehearsal.
    return {
      ok: true,
      bot: typeof user.username === 'string' ? user.username : 'Bot',
      channel: typeof channel.name === 'string' ? channel.name : '',
    };
  }
  async start(state: MatchState, input: Record<string, unknown> = {}) {
    if (this.busy) throw Error('投票任务处理中');
    const report = currentPostGameReport(state);
    if (!state.committedGameId && !report) throw Error('请先进入赛后并核对本局');
    const gameKey = state.committedGameId || report!.id;
    if (
      this.votes.some(
        (v) =>
          v.status !== 'failed' && (v.gameKey === gameKey || (report && v.reportId === report.id)),
      )
    )
      throw Error('本局已有投票记录，禁止重复发布');
    if (this.votes.some((v) => !['finalized', 'cancelled', 'failed'].includes(v.status)))
      throw Error('请先处理尚未完成的投票');
    if (
      !snowflake(this.config.channelId) ||
      !snowflake(this.config.guildId) ||
      (!this.config.botToken && !this.requestOverride)
    )
      throw Error('请先配置 Discord Bot、服务器和频道');
    const winner = input.winner === 'blue' || input.winner === 'red' ? input.winner : undefined;
    const candidates = (input.candidates ??
      voteCandidates(state, this.config.scope, winner)) as VoteCandidate[];
    const source = voteCandidates(state, 'all');
    if (
      !Array.isArray(candidates) ||
      ![5, 10].includes(candidates.length) ||
      new Set(candidates.map((c) => c?.rowId)).size !== candidates.length ||
      candidates.some(
        (c) =>
          !c ||
          typeof c.name !== 'string' ||
          !c.name.trim() ||
          c.name.length > 60 ||
          typeof c.team !== 'string' ||
          c.team.length > 60 ||
          !source.some((p) => p.rowId === c.rowId && p.side === c.side),
      )
    )
      throw Error('候选人必须为本局 5 或 10 个不同选手，昵称最多 60 字');
    const minutes = input.minutes ?? this.config.minutes;
    if (!Number.isInteger(minutes) || Number(minutes) < 2 || Number(minutes) > 5)
      throw Error('投票时长为 2–5 分钟');
    const vote: AudienceVote = {
      id: randomUUID(),
      gameKey,
      gameNumber: state.gameNumber,
      blueTeam: state.blueTeam.name,
      redTeam: state.redTeam.name,
      reportId: report?.id ?? null,
      candidates: candidates.map((c) => ({
        ...source.find((p) => p.rowId === c.rowId)!,
        name: c.name.trim(),
        team: c.team,
      })),
      counts: null,
      total: null,
      winners: [],
      status: 'creating',
      channelId: this.config.channelId,
      messageId: null,
      createdAt: this.now(),
      deadline: this.now() + Number(minutes) * 60000,
    };
    this.busy = true;
    try {
      await this.testConnection();
      this.votes.push(vote);
      this.save();
      const nonce = createHash('sha256').update(gameKey).digest('hex').slice(0, 24);
      const result = await this.request(`/channels/${vote.channelId}/messages`, 'POST', {
        content: `观众 MVP · 第 ${vote.gameNumber} 局 · ${vote.blueTeam} vs ${vote.redTeam}\n${minutes} 分钟后由 Bot 截止，请单选。`,
        allowed_mentions: { parse: [] },
        nonce,
        enforce_nonce: true,
        poll: {
          question: { text: '本局观众 MVP 是谁？' },
          answers: vote.candidates.map((c, i) => ({ poll_media: { text: answerLabel(c, i) } })),
          duration: 1,
          allow_multiselect: false,
          layout_type: 1,
        },
      });
      if (!snowflake(result.id)) throw Error('Discord 未返回消息 ID');
      vote.messageId = result.id;
      vote.status = 'active';
      vote.error = undefined;
      this.save();
      return vote;
    } catch (error) {
      if (this.votes.includes(vote)) {
        vote.status =
          error instanceof DiscordApiError && error.status >= 400 && error.status < 500
            ? 'failed'
            : 'creation-uncertain';
        vote.error = error instanceof Error ? error.message : '创建失败';
        this.save();
      }
      throw error;
    } finally {
      this.busy = false;
    }
  }
  async recover(id: string, messageId: string) {
    const vote = this.votes.find((v) => v.id === id);
    if (!vote || vote.status !== 'creation-uncertain' || !snowflake(messageId))
      throw Error('Invalid recovery');
    const me = await this.request('/users/@me'),
      message = await this.request(`/channels/${vote.channelId}/messages/${messageId}`);
    const poll = object(message.poll),
      answers = poll.answers;
    if (
      object(message.author).id !== me.id ||
      !Array.isArray(answers) ||
      answers.length !== vote.candidates.length ||
      answers.some(
        (a, i) => object(object(a).poll_media).text !== answerLabel(vote.candidates[i], i),
      )
    )
      throw Error('消息不是同一 Bot 创建的本局候选投票');
    vote.messageId = messageId;
    vote.status = 'active';
    vote.error = undefined;
    this.save();
    return vote;
  }
  async finish(id: string, cancel = false) {
    const vote = this.votes.find((v) => v.id === id);
    if (!vote) throw Error('Vote not found');
    if (['finalized', 'cancelled'].includes(vote.status)) return vote;
    if (this.busy) throw Error('投票任务处理中');
    if (!vote.messageId) {
      if (!cancel) throw Error('请先核对并恢复 Discord 消息 ID');
      throw Error('创建状态未知，需恢复消息 ID 后取消，避免遗留投票仍可投票');
    }
    vote.cancelRequested = cancel || vote.cancelRequested;
    vote.status = 'ending';
    this.save();
    await this.tick(true);
    return vote;
  }
  private readResults(vote: AudienceVote, message: Record<string, unknown>) {
    const poll = object(message.poll),
      results = object(poll.results),
      counts = results.answer_counts;
    if (!Array.isArray(counts)) return;
    const answers = poll.answers;
    if (!Array.isArray(answers) || answers.length !== vote.candidates.length)
      throw Error('Discord 投票选项不完整');
    const values = vote.candidates.map((_, index) => {
      const id = object(answers[index]).answer_id;
      const count = counts.find((item) => object(item).id === id);
      const value = count === undefined ? 0 : object(count).count;
      return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
    });
    if (values.some((v) => v === null)) return;
    vote.counts = values as number[];
    vote.total = vote.counts.reduce((a, b) => a + b, 0);
    if (results.is_finalized === true) {
      vote.status = vote.cancelRequested ? 'cancelled' : 'finalized';
      const max = Math.max(...vote.counts);
      vote.winners =
        vote.total && !vote.cancelRequested
          ? vote.candidates.filter((_, i) => vote.counts![i] === max).map((c) => c.rowId)
          : [];
    }
  }
  async tick(force = false) {
    if (this.busy || (this.now() < this.retryAt && !force)) return;
    const vote = this.votes.find((v) => ['active', 'ending', 'pending'].includes(v.status));
    if (!vote?.messageId) return;
    this.busy = true;
    try {
      if (vote.deadline <= this.now() || vote.status === 'ending') {
        vote.status = 'pending';
        this.save();
        try {
          await this.request(`/channels/${vote.channelId}/polls/${vote.messageId}/expire`, 'POST');
        } catch (error) {
          // Already ended polls may reject expire; fetch remains the source of truth.
          vote.error = error instanceof Error ? error.message : '结束请求失败';
        }
      }
      const message = await this.request(`/channels/${vote.channelId}/messages/${vote.messageId}`);
      this.readResults(vote, message);
      vote.error = undefined;
      if (vote.status === 'pending') vote.error = '等待 Discord 最终计票；可重试，尚未确认最终 MVP';
      this.save();
      this.error = '';
      if (vote.status === 'finalized' && !vote.announced) await this.announce(vote);
    } catch (error) {
      vote.error = error instanceof Error ? error.message : 'Discord 同步失败';
      this.error = vote.error;
      this.save();
    } finally {
      this.busy = false;
    }
  }
  private async announce(vote: AudienceVote) {
    const winners = vote.candidates.filter((c) => vote.winners.includes(c.rowId));
    const content = `第 ${vote.gameNumber} 局 · 观众 MVP：${!vote.total ? '无人投票' : winners.length > 1 ? '最高票并列：' + winners.map((c) => c.name).join('、') : winners[0]?.name}（${vote.total} 票）。数据 MVP 独立保留。`;
    // Mark before sending: a crash or ambiguous timeout must never auto-spam announcements.
    vote.announced = true;
    vote.announcementError = '公告发送中或上次发送未确认；请在频道核对。';
    this.save();
    try {
      await this.request(`/channels/${vote.channelId}/messages`, 'POST', {
        content,
        allowed_mentions: { parse: [] },
        message_reference: { message_id: vote.messageId },
      });
      if (this.config.webhookUrl) {
        const response = await fetch(this.config.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
          signal: AbortSignal.timeout(8000),
          redirect: 'error',
        });
        if (!response.ok) throw Error();
      }
      vote.announcementError = undefined;
      this.save();
    } catch {
      vote.announcementError = '公告发送未确认，请在频道核对；投票结果已保存。';
      this.save();
    }
  }
  async autoStart(state: MatchState) {
    const report = currentPostGameReport(state);
    if (!this.config.autoStart || !report || this.busy) return;
    if (this.votes.some((v) => v.reportId === report.id || v.gameKey === state.committedGameId))
      return;
    try {
      await this.start(state);
    } catch (error) {
      this.error = error instanceof Error ? error.message : '自动发起失败';
    }
  }
}
