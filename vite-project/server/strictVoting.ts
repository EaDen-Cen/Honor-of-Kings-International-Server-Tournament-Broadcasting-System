import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  mkdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { MatchState } from '../src/shared/types.js';
import type { PostGameReport } from '../src/shared/postGame.js';
import type {
  StrictVote,
  StrictVoteConfig,
  VoteNotice,
  StrictVoteSnapshot,
} from '../src/shared/strictVote.js';
import type { DiscordWebhook } from './discordWebhook.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const uuid = /^[a-f0-9-]{36}$/;
const roster = (report: PostGameReport) =>
  report.players.map((p) => ({
    rowId: p.rowId,
    name: p.playerId,
    team: p.teamName,
    side: p.side,
    role: p.role,
  }));
const fingerprint = (report: PostGameReport) =>
  hash(JSON.stringify([report.endedAt, report.winner, roster(report)]));
interface SavedVote extends StrictVote {
  ballots: Record<string, number>;
}
interface Data {
  version: 1;
  config: StrictVoteConfig;
  votes: SavedVote[];
}

/** Vote archive is separate from match state: Undo never reopens a closed ballot. */
export class StrictVoting {
  private data: Data = {
    version: 1,
    config: { autoStart: false, scope: 'all', publicOrigin: '', mode: 'native' },
    votes: [],
  };
  private busy = false;
  private persistenceError = '';
  private error = '';
  constructor(
    private file: string,
    private webhook: DiscordWebhook,
    private now = Date.now,
  ) {
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Data;
      if (raw.version !== 1 || !Array.isArray(raw.votes))
        throw Error('Invalid vote archive; preserve original file');
      raw.config.mode ??= 'web';
      this.validateConfig(raw.config);
      for (const v of raw.votes) {
        if (
          !v ||
          !uuid.test(v.id) ||
          typeof v.reportId !== 'string' ||
          !Number.isSafeInteger(v.gameNumber) ||
          typeof v.url !== 'string' ||
          (v.mode !== 'native' &&
            (!v.url.startsWith('https://') || new URL(v.url).pathname !== `/vote/${v.id}`)) ||
          (v.mode !== undefined && !['web', 'native'].includes(v.mode)) ||
          !/^[a-f0-9]{64}$/.test(v.rosterFingerprint) ||
          !Number.isSafeInteger(v.startedAt) ||
          (v.mode === 'native' && v.startedAt === 0
            ? v.deadline !== 0
            : v.deadline !== v.startedAt + 180000) ||
          !['pending', 'active', 'closed', 'cancelled'].includes(v.status) ||
          !Array.isArray(v.candidates) ||
          ![5, 10].includes(v.candidates.length) ||
          new Set(v.candidates.map((c) => c.rowId)).size !== v.candidates.length ||
          v.candidates.some(
            (c) =>
              !c ||
              ['rowId', 'name', 'team', 'side', 'role'].some(
                (k) => typeof c[k as keyof typeof c] !== 'string',
              ),
          ) ||
          !Array.isArray(v.counts) ||
          v.counts.length !== v.candidates.length ||
          !v.ballots ||
          typeof v.ballots !== 'object' ||
          Array.isArray(v.ballots) ||
          Object.entries(v.ballots).some(
            ([key, n]) =>
              !/^[a-f0-9]{64}$/.test(key) ||
              !Number.isInteger(n) ||
              n < 0 ||
              n >= v.candidates.length,
          ) ||
          v.counts.some(
            (count, i) =>
              !Number.isSafeInteger(count) ||
              count < 0 ||
              count !== Object.values(v.ballots).filter((n) => n === i).length,
          )
        )
          throw Error('Invalid vote archive; preserve original file');
        for (const notice of [v.opening, v.closing]) {
          if (
            !notice ||
            !uuid.test(notice.id) ||
            typeof notice.content !== 'string' ||
            notice.content.length > 2000 ||
            !['pending', 'sending', 'sent', 'failed', 'uncertain'].includes(notice.status)
          )
            throw Error('Invalid vote notice');
          if (notice.status === 'sending') {
            const saved = webhook.snapshot().notices.find((n) => n.id === notice.id);
            notice.status = saved?.status === 'sent' ? 'sent' : 'uncertain';
            notice.messageId = saved?.messageId;
            notice.sentAt = saved?.sentAt;
            notice.error = saved?.error || 'Check Discord before retrying / 请先核对 Discord';
          }
        }
      }
      if (
        new Set(raw.votes.map((v) => v.id)).size !== raw.votes.length ||
        new Set(raw.votes.map((v) => v.reportId)).size !== raw.votes.length
      )
        throw Error('Duplicate vote archive entries');
      this.data = raw;
      for (const v of raw.votes) this.activateNative(v);
    }
    this.expire();
  }
  private validateConfig(config: StrictVoteConfig) {
    if (
      !config ||
      typeof config.autoStart !== 'boolean' ||
      (config.mode !== undefined && !['web', 'native', 'bot'].includes(config.mode)) ||
      !['all', 'winner'].includes(config.scope) ||
      typeof config.publicOrigin !== 'string'
    )
      throw Error('Invalid vote configuration');
    if (config.publicOrigin) {
      const url = new URL(config.publicOrigin);
      if (
        url.protocol !== 'https:' ||
        url.origin !== config.publicOrigin ||
        url.username ||
        url.password ||
        url.hostname === 'localhost' ||
        url.hostname.endsWith('.localhost')
      )
        throw Error('Use a public HTTPS origin without a path / 请填写公开 HTTPS 域名');
    }
    if (config.autoStart && (config.mode ?? 'web') === 'web' && !config.publicOrigin)
      throw Error('Public HTTPS origin required');
  }
  configure(input: StrictVoteConfig) {
    this.validateConfig(input);
    this.mutate(() => {
      this.data.config = {
        autoStart: input.autoStart,
        mode: input.mode ?? 'web',
        scope: input.scope,
        publicOrigin: input.publicOrigin,
      };
    });
  }
  private save() {
    mkdirSync(dirname(this.file), { recursive: true });
    const fd = openSync(this.file + '.tmp', 'w', 0o600);
    try {
      writeFileSync(fd, JSON.stringify(this.data));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(this.file + '.tmp', this.file);
  }
  private mutate(change: () => void) {
    if (this.persistenceError) throw Error(this.persistenceError);
    const previous = structuredClone(this.data);
    try {
      change();
      this.save();
    } catch (error) {
      this.data = previous;
      this.persistenceError =
        'Vote persistence failed; restart after repairing storage / 投票保存失败，请修复存储后重启';
      throw error;
    }
  }
  private expire() {
    if (this.persistenceError) throw Error(this.persistenceError);
    if (this.data.votes.some((v) => v.status === 'active' && this.now() >= v.deadline))
      this.mutate(() => {
        for (const v of this.data.votes)
          if (v.status === 'active' && this.now() >= v.deadline) {
            v.status = 'closed';
            v.closedAt = v.deadline;
          }
      });
  }
  snapshot(state: MatchState): StrictVoteSnapshot {
    this.expire();
    return {
      serverNow: this.now(),
      error: this.error,
      config: { ...this.data.config },
      votes: this.data.votes.map((v) => {
        const report = state.postGameReports.find((r) => r.id === v.reportId);
        const { ballots: _ballots, ...publicVote } = v;
        void _ballots;
        return {
          ...structuredClone(publicVote),
          rosterChanged: !report || fingerprint(report) !== v.rosterFingerprint,
        };
      }),
    };
  }
  publicVote(id: string) {
    this.expire();
    const v = this.find(id);
    if (v.mode === 'native') throw Error('Discord native Poll has no web ballot');
    return {
      id: v.id,
      gameNumber: v.gameNumber,
      candidates: structuredClone(v.candidates),
      status: v.status,
      deadline: v.deadline,
      serverNow: this.now(),
    };
  }
  private find(id: string) {
    const vote = this.data.votes.find((v) => v.id === id);
    if (!vote) throw Error('Vote not found / 找不到投票');
    return vote;
  }
  cast(id: string, voter: unknown, rowId: unknown) {
    this.expire();
    const v = this.find(id);
    if (v.mode === 'native' || v.status !== 'active' || this.now() >= v.deadline)
      throw Error('Voting closed / 投票已截止');
    if (typeof voter !== 'string' || !/^[a-f0-9-]{36}$/.test(voter))
      throw Error('Invalid browser ballot ID');
    const index = v.candidates.findIndex((c) => c.rowId === rowId);
    if (index < 0) throw Error('Invalid candidate');
    const key = hash(v.id + ':' + voter);
    if (Object.hasOwn(v.ballots, key)) {
      if (v.ballots[key] !== index) throw Error('Already voted / 已投票，不可重复提交');
      return;
    }
    this.mutate(() => {
      v.ballots[key] = index;
      v.counts[index]++;
    });
  }
  start(state: MatchState, reportId: string) {
    const existing = this.data.votes.find((v) => v.reportId === reportId);
    if (existing) return existing.id;
    const report = state.postGameReports.find((r) => r.id === reportId);
    if (!report?.endedAt || !report.winner || state.committedGameId !== reportId)
      throw Error('Confirm this game has ended first / 请先确认本局比赛结束');
    const native = this.data.config.mode === 'native';
    if (this.data.config.mode === 'bot') throw Error('Use the optional Bot panel');
    if ((!native && !this.data.config.publicOrigin) || !this.webhook.snapshot().configured)
      throw Error('Configure public HTTPS origin and Webhook first');
    const candidates = roster(report).filter(
      (c) => this.data.config.scope === 'all' || c.side === report.winner,
    );
    if (
      candidates.length !== (this.data.config.scope === 'all' ? 10 : 5) ||
      new Set(candidates.map((c) => c.rowId)).size !== candidates.length ||
      candidates.some((c) => !c.name.trim())
    )
      throw Error('Verify candidate roster / 请核对候选名单');
    const id = randomUUID(),
      startedAt = native ? 0 : this.now(),
      deadline = native ? 0 : startedAt + 180000;
    const url = native ? '' : `${this.data.config.publicOrigin}/vote/${id}`;
    const v: SavedVote = {
      id,
      mode: native ? 'native' : 'web',
      reportId,
      gameNumber: report.gameNumber,
      candidates,
      rosterFingerprint: fingerprint(report),
      startedAt,
      deadline,
      status: native ? 'pending' : 'active',
      url,
      counts: candidates.map(() => 0),
      ballots: {},
      opening: {
        id: randomUUID(),
        status: 'pending',
        ...(native
          ? {
              poll: {
                question: { text: `第 ${report.gameNumber} 局观众 MVP 投票` },
                answers: candidates.map((c, i) => ({
                  poll_media: { text: `${i + 1}. ${c.team.slice(0, 16)} · ${c.name.slice(0, 30)}` },
                })),
                duration: 1 as const,
                allow_multiselect: false as const,
              },
            }
          : {}),
        content: native
          ? '规定投票时间为发布成功后 180 秒。Discord 原生 Poll 持续 1 小时，三分钟仅为软截止，可能仍收票；导播人工核对最终 MVP。 / 3-minute soft deadline; native Poll remains open for 1 hour. No exact 3-minute tally is available.'
          : `第 ${report.gameNumber} 局 MVP 投票 / Game ${report.gameNumber} MVP vote\n${url}\n服务器截止 / Server deadline: <t:${Math.floor(deadline / 1000)}:T>（180 秒 / seconds）。非 Discord 原生 Poll；匿名浏览器防重复，不能保证一人一票。最终 MVP 由导播核实。`,
      },
      closing: {
        id: randomUUID(),
        status: 'pending',
        content: native
          ? `第 ${report.gameNumber} 局 MVP 投票的规定投票时间已结束。Discord 原生投票可能仍允许继续投票，请以导播核对的有效结果为准。 / Soft deadline reached; Discord may still accept votes. No reliable 3-minute snapshot is available.`
          : `第 ${report.gameNumber} 局 MVP 投票已结束 / Game ${report.gameNumber} MVP voting ended\n${url}\n服务器已停止收票，结果由导播核对 / Submissions closed; operator review required.`,
      },
    };
    this.mutate(() => this.data.votes.push(v));
    return id;
  }
  private activateNative(v: SavedVote) {
    if (v.mode !== 'native' || v.startedAt || v.opening.status !== 'sent' || !v.opening.sentAt)
      return;
    v.startedAt = v.opening.sentAt;
    v.deadline = v.startedAt + 180000;
    if (v.status === 'pending') v.status = this.now() >= v.deadline ? 'closed' : 'active';
  }
  async recover(id: string, messageId: string) {
    const v = this.find(id);
    if (this.busy || v.mode !== 'native' || v.opening.status !== 'uncertain')
      throw Error('No uncertain native Poll to recover');
    this.busy = true;
    try {
      const found = await this.webhook.recoverPublished(v.opening.id, messageId);
      this.mutate(() => {
        v.opening.status = 'sent';
        v.opening.messageId = found.messageId;
        v.opening.sentAt = found.sentAt;
        v.opening.error = undefined;
        this.activateNative(v);
      });
    } finally {
      this.busy = false;
    }
  }
  finish(id: string, cancel = false) {
    this.expire();
    const v = this.find(id);
    if (v.status === 'pending' && !cancel) throw Error('Publication has not been confirmed');
    if (v.status === 'cancelled' || (!cancel && v.status === 'closed')) return;
    this.mutate(() => {
      v.status = cancel ? 'cancelled' : 'closed';
      v.closedAt = this.now();
      if (cancel)
        v.closing = {
          id: randomUUID(),
          status: 'pending',
          content: `第 ${v.gameNumber} 局 MVP 投票已取消 / Vote cancelled\n${v.url}\n票数作废；若为 Discord 原生投票，它可能仍开放。 / Ballots void; a native Discord Poll may remain open.`,
        };
    });
  }
  private async deliver(notice: VoteNotice, confirmUncertain = false) {
    this.mutate(() => {
      notice.status = 'sending';
      notice.error = undefined;
    });
    try {
      const sent = await this.webhook.publish(
        notice.id,
        notice.content,
        confirmUncertain,
        notice.poll,
      );
      this.mutate(() => {
        notice.status = sent.status;
        notice.messageId = sent.messageId;
        notice.sentAt = sent.sentAt;
        for (const vote of this.data.votes) this.activateNative(vote);
        notice.error = sent.error;
      });
    } catch (error) {
      const recorded = this.webhook.snapshot().notices.find((n) => n.id === notice.id);
      this.mutate(() => {
        notice.status =
          recorded?.status === 'sent'
            ? 'sent'
            : recorded?.status === 'uncertain' || recorded?.status === 'sending'
              ? 'uncertain'
              : 'failed';
        notice.messageId = recorded?.messageId;
        notice.error = error instanceof Error ? error.message : 'Delivery failed';
      });
    }
  }
  async retry(id: string, confirmUncertain: boolean) {
    if (this.busy) throw Error('Publication in progress');
    this.expire();
    const v = this.find(id),
      notice = ['active', 'pending'].includes(v.status) ? v.opening : v.closing;
    if (v.mode === 'native' && notice === v.opening && notice.status === 'uncertain')
      throw Error('Recover the original Discord message ID; do not repost a native Poll');
    if (notice.status === 'sent') return;
    if (notice.status === 'uncertain' && !confirmUncertain)
      throw Error('Check Discord and confirm before retrying / 请先核对频道');
    this.busy = true;
    try {
      await this.deliver(notice, confirmUncertain);
    } finally {
      this.busy = false;
    }
  }
  observe(state: MatchState) {
    try {
      if (this.data.config.autoStart && this.data.config.mode !== 'bot' && state.committedGameId) {
        const report = state.postGameReports.find((r) => r.id === state.committedGameId);
        if (report?.endedAt) this.start(state, report.id);
      }
      this.error = '';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Vote creation failed';
    }
  }
  async tick(state: MatchState) {
    this.expire();
    if (this.busy) return;
    this.busy = true;
    try {
      this.observe(state);
      for (const vote of this.data.votes) {
        const notice = ['active', 'pending'].includes(vote.status) ? vote.opening : vote.closing;
        if (notice.status === 'pending') await this.deliver(notice);
      }
    } finally {
      this.busy = false;
    }
  }
}
