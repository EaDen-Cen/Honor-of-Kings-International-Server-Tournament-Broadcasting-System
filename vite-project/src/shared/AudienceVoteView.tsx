import { useEffect, useState } from 'react';
import { apiURL } from './config';
import type { AudienceVote } from './audienceVote';
export const voteStatusLabel: Record<AudienceVote['status'], string> = {
  creating: '发布中',
  'creation-uncertain': '创建待核对',
  active: '投票进行中',
  ending: '正在截止',
  pending: '等待最终计票',
  finalized: '已确认',
  cancelled: '已取消',
  failed: '创建被拒绝，可检查配置后重试',
};
export function useAudienceVotes(token: string) {
  const [votes, setVotes] = useState<AudienceVote[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await fetch(`${apiURL}/api/v1/audience-vote`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
        });
        const data = await r.json();
        if (!r.ok) throw Error(data.error || '投票状态不可用');
        setVotes(data.votes);
        setError(data.error || '');
      } catch (e) {
        if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [token]);
  return { votes, error };
}
export function AudienceVoteView({ vote }: { vote: AudienceVote }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (vote.status !== 'active') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [vote.status]);
  const seconds = Math.max(0, Math.ceil((vote.deadline - now) / 1000));
  return (
    <div className="vote-results">
      <h3>
        {vote.blueTeam} <span>VS</span> {vote.redTeam} · GAME {vote.gameNumber}
      </h3>
      <p role="status">
        {voteStatusLabel[vote.status]}{' '}
        {vote.status === 'active'
          ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
          : ''}{' '}
        · {vote.total === null ? '等待数据 / 结束后揭晓' : `共 ${vote.total} 票`}
      </p>
      <div className="vote-candidates">
        {vote.candidates.map((c, i) => (
          <div
            key={c.rowId}
            className={`vote-candidate ${c.side}${vote.winners.includes(c.rowId) ? ' winner' : ''}`}
          >
            <b>
              {c.team} · {c.name}
            </b>
            <span>
              {vote.counts === null
                ? '等待数据'
                : `${vote.counts[i]} 票 · ${vote.total ? Math.round((vote.counts[i] / vote.total) * 100) : 0}%`}
            </span>
            <progress
              aria-label={`${c.name} 投票进度`}
              max={Math.max(1, vote.total || 0)}
              value={vote.counts?.[i] ?? 0}
            />
          </div>
        ))}
      </div>
      {vote.status === 'finalized' && (
        <strong className="audience-result">
          {!vote.total
            ? '无人投票'
            : vote.winners.length > 1
              ? '最高票并列，按赛前规则处理'
              : '观众 MVP'}{' '}
          ·{' '}
          {vote.candidates
            .filter((c) => vote.winners.includes(c.rowId))
            .map((c) => c.name)
            .join(' / ')}
        </strong>
      )}
      {vote.error && <p role="alert">{vote.error}</p>}
      {vote.announcementError && <p role="alert">{vote.announcementError}</p>}
    </div>
  );
}
export function AudienceVoteOverlay({ token }: { token: string }) {
  const { votes, error } = useAudienceVotes(token),
    vote = votes.at(-1);
  return (
    <section className="audience-vote-overlay">
      <div className="pg-eyebrow">CHASING WIND · AUDIENCE MVP</div>
      <h1>观众 MVP · Discord 投票</h1>
      {vote ? <AudienceVoteView vote={vote} /> : <p>暂无投票</p>}
      {error && <p role="status">{error}</p>}
    </section>
  );
}
