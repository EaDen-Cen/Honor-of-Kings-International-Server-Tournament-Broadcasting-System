import { useEffect, useState } from 'react';
import { apiURL } from '../shared/config';
import { currentPostGameReport } from '../shared/postGame';
import type { MatchState, Side } from '../shared/types';
import {
  voteCandidates,
  type DiscordPublicConfig,
  type VoteCandidate,
} from '../shared/audienceVote';
import { AudienceVoteView, useAudienceVotes, voteStatusLabel } from '../shared/AudienceVoteView';
export function DiscordVotePanel({ token, state }: { token: string; state: MatchState }) {
  const { votes, error } = useAudienceVotes(token);
  const [config, setConfig] = useState<DiscordPublicConfig>();
  const [candidates, setCandidates] = useState<VoteCandidate[]>([]),
    [winner, setWinner] = useState<Side | ''>('');
  const [minutes, setMinutes] = useState(3),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [recoveryId, setRecoveryId] = useState('');
  const key = currentPostGameReport(state)?.id || state.committedGameId || '';
  useEffect(() => {
    const update = (event: Event) => {
      const value = (event as CustomEvent<DiscordPublicConfig>).detail;
      setConfig(value);
      setMinutes(value.minutes);
    };
    document.addEventListener('hok-discord-config', update);
    return () => document.removeEventListener('hok-discord-config', update);
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    fetch(`${apiURL}/api/v1/discord/config`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: abort.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw Error('请在本机配置 Discord');
        return r.json();
      })
      .then((data) => {
        setConfig(data);
        setMinutes(data.minutes);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setMessage(String(e));
      });
    return () => abort.abort();
  }, [token]);
  const roster = JSON.stringify(voteCandidates(state, config?.scope, winner || undefined));
  useEffect(() => setCandidates(JSON.parse(roster)), [roster]);
  async function command(action: string, body: unknown) {
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch(`${apiURL}/api/v1/discord/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error || '操作失败');
      setMessage('已执行，正在同步投票状态…');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const current =
    votes
      .filter(
        (v) =>
          v.gameKey === state.committedGameId ||
          (v.reportId && v.reportId === state.activePostGameReportId),
      )
      .at(-1) ?? votes.at(-1);
  const duplicate = votes.some(
    (v) => v.status !== 'failed' && (v.gameKey === key || v.reportId === key),
  );
  return (
    <section className="panel discord-vote-panel" aria-label="Discord MVP 投票">
      <h2>Discord · 观众 MVP 投票</h2>
      <p className="muted">
        默认全场 10 人、3 分钟单选。观众 MVP 独立存档，不覆盖原有 MVP。连接凭证在设置中心配置。
      </p>
      {config?.scope === 'winner' && (
        <label>
          已确认胜方
          <select value={winner} onChange={(e) => setWinner(e.target.value as Side | '')}>
            <option value="">请选择获胜队伍</option>
            <option value="blue">{state.blueTeam.name}</option>
            <option value="red">{state.redTeam.name}</option>
          </select>
        </label>
      )}
      <label>
        投票时长
        <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
          {[2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n} 分钟
            </option>
          ))}
        </select>
      </label>
      <details>
        <summary>核对 / 编辑候选人（{candidates.length}）</summary>
        <div className="vote-candidates">
          {candidates.map((c, i) => (
            <label key={c.rowId}>
              {c.team}
              <input
                maxLength={60}
                value={c.name}
                onChange={(e) =>
                  setCandidates((all) =>
                    all.map((p, j) => (i === j ? { ...p, name: e.target.value } : p)),
                  )
                }
              />
            </label>
          ))}
        </div>
      </details>
      <div className="toolbar">
        <button
          className="primary"
          disabled={busy || !key || duplicate || !config?.configured || ![5, 10].includes(candidates.length)}
          onClick={() => void command('start', { candidates, minutes, winner })}
        >
          开始 MVP 投票
        </button>
        <button
          disabled={busy || !current || !['active', 'pending'].includes(current.status)}
          onClick={() => void command('end', { id: current?.id })}
        >
          提前结束
        </button>
        <button
          disabled={busy || !current || !['active', 'pending'].includes(current.status)}
          onClick={() => void command('cancel', { id: current?.id })}
        >
          取消投票
        </button>
        <button disabled={busy} onClick={() => void command('retry', {})}>
          重试同步 / 最终计票
        </button>
      </div>
      {current && <AudienceVoteView vote={current} />}
      {current?.status === 'creation-uncertain' && (
        <label>
          核对同一 Bot 的投票消息 ID
          <input value={recoveryId} onChange={(e) => setRecoveryId(e.target.value)} />
          <button
            disabled={busy || !recoveryId}
            onClick={() => void command('recover', { id: current.id, messageId: recoveryId })}
          >
            恢复投票（不重发）
          </button>
        </label>
      )}
      <a href="/overlay/audience-mvp" target="_blank" rel="noreferrer">
        观众 MVP Overlay · 1920×1080
      </a>
      <details>
        <summary>历史记录（{votes.length}）</summary>
        {votes.map((v) => (
          <details key={v.id}>
            <summary>
              GAME {v.gameNumber} · {voteStatusLabel[v.status]}
            </summary>
            <AudienceVoteView vote={v} />
          </details>
        ))}
      </details>
      <p role="status">{message || error}</p>
    </section>
  );
}
