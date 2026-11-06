import { useEffect, useState } from 'react';
import type { Action, MatchState, Side } from '../shared/types';
import type { StrictVoteConfig, StrictVoteSnapshot } from '../shared/strictVote';
import { VoteCountdown } from '../shared/VoteCountdown';
import { apiURL } from '../shared/config';
export function StrictVotePanel({
  token,
  state,
  send,
  disabled,
  onMode,
}: {
  token: string;
  state: MatchState;
  send: (action: Action) => boolean;
  disabled: boolean;
  onMode?: (mode: string) => void;
}) {
  const [data, setData] = useState<StrictVoteSnapshot>(),
    [config, setConfig] = useState<StrictVoteConfig>();
  const [recoveryId, setRecoveryId] = useState('');
  useEffect(() => {
    onMode?.(config?.mode ?? 'native');
  }, [config?.mode, onMode]);
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [winner, setWinner] = useState<Side | ''>('');
  const [history, setHistory] = useState(''),
    [chosen, setChosen] = useState(''),
    [checked, setChecked] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  useEffect(() => {
    const abort = new AbortController();
    let stopped = false;
    async function refresh() {
      try {
        const response = await fetch(`${apiURL}/api/v1/discord/strict-vote`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: abort.signal,
        });
        const result = await response.json();
        if (!response.ok) throw Error(result.error);
        if (!stopped) {
          setData(result);
          setConfig((old) => old ?? result.config);
        }
      } catch (e) {
        if (!stopped) setMessage(e instanceof Error ? e.message : 'Connection failed');
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => {
      stopped = true;
      abort.abort();
      clearInterval(timer);
    };
  }, [token]);
  const report = state.postGameReports.find((r) => r.id === (history || state.committedGameId));
  const vote = data?.votes.find((v) => v.reportId === report?.id);
  const notice =
    vote && (['active', 'pending'].includes(vote.status) ? vote.opening : vote.closing);
  useEffect(() => {
    setChosen('');
    setChecked(false);
    setUncertain(false);
    setWinner('');
  }, [report?.id]);
  async function command(method: string, body: unknown) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`${apiURL}/api/v1/discord/strict-vote`, {
        method,
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      setData(result);
      setMessage('已保存 / Saved');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }
  const candidates =
    vote?.candidates ??
    report?.players
      .filter((p) => data?.config.scope !== 'winner' || p.side === (report.winner || winner))
      .map((p) => ({ rowId: p.rowId, name: p.playerId, team: p.teamName }));
  const identityMatches = report?.players.some(
    (p) =>
      p.rowId === chosen && p.playerId === vote?.candidates.find((c) => c.rowId === chosen)?.name,
  );
  const native = (vote?.mode ?? config?.mode ?? 'native') === 'native';
  const recoverNative = native && vote?.opening.status === 'uncertain';
  return (
    <section className="panel" aria-label="三分钟 MVP 投票 / Strict MVP voting">
      <h2>Webhook · 三分钟 MVP 投票 / 180-second MVP vote</h2>
      <p>
        {native
          ? 'Discord 原生投票：1 小时原生持续时间，发布成功后 180 秒软截止。Discord 可能继续收票；没有可靠的三分钟票数快照，导播须人工核对。 / Native Poll stays open for 1 hour; 3-minute soft deadline only.'
          : '独立网页投票：服务器严格执行 180 秒截止。匿名浏览器防重复不能保证一人一票。 / Web ballot: strict 180-second server deadline; anonymous browser deduplication.'}
      </p>
      <label>
        查看局数 / Game
        <select value={history} onChange={(e) => setHistory(e.target.value)}>
          <option value="">当前局 / Current</option>
          {state.postGameReports.map((r) => (
            <option key={r.id} value={r.id}>
              GAME {r.gameNumber}
            </option>
          ))}
        </select>
      </label>
      <p>
        GAME {report?.gameNumber ?? '—'} ·{' '}
        {vote?.status ??
          (report?.endedAt ? '待发布 / Ready' : '待确认比赛结束 / Awaiting game-end confirmation')}
      </p>
      {config && (
        <details open>
          <summary>投票设置 / Vote settings</summary>
          <label>
            投票模式 / Voting mode
            <select
              value={config.mode ?? 'web'}
              onChange={(e) =>
                setConfig({ ...config, mode: e.target.value as StrictVoteConfig['mode'] })
              }
            >
              <option value="native">Discord 原生投票 · 三分钟软截止 / Native soft deadline</option>
              <option value="web">独立网页投票 · 严格截止 / Strict web ballot</option>
              <option value="bot">可选 Bot 原生投票 / Optional Bot</option>
            </select>
          </label>
          {config.mode === 'bot' && (
            <p>
              需要 Bot 安装权限；请在下方面板配置和操作。 / Bot installation required; use the panel
              below.
            </p>
          )}
          {(config.mode ?? 'web') === 'web' && (
            <>
              <label>
                公开 HTTPS 域名 / Public HTTPS origin
                <input
                  value={config.publicOrigin}
                  placeholder="https://broadcast.example.com"
                  onChange={(e) => setConfig({ ...config, publicOrigin: e.target.value.trim() })}
                />
              </label>
              <p>
                该域名需指向本服务，并允许 /vote/ 与 /api/v1/public-votes/；无需向观众提供 Control
                口令。保存设置不会自动部署域名。
              </p>
            </>
          )}
          <label>
            候选范围 / Candidates
            <select
              value={config.scope}
              onChange={(e) => setConfig({ ...config, scope: e.target.value as 'all' | 'winner' })}
            >
              <option value="all">全部十人 / All ten</option>
              <option value="winner">获胜方五人 / Winning five</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={config.autoStart}
              onChange={(e) => setConfig({ ...config, autoStart: e.target.checked })}
            />
            确认比赛结束后自动发布 / Auto-publish after game-end confirmation
          </label>
          <button disabled={busy} onClick={() => void command('PUT', config)}>
            保存投票设置 / Save vote settings
          </button>
          <p>
            设置只影响尚未创建的投票。启用自动发布会处理当前已确认结束的局。 / Settings affect
            future ballots only.
          </p>
        </details>
      )}
      {report && !report.endedAt && report.id === state.committedGameId && (
        <div>
          <label>
            本局胜方 / Winner
            <select value={winner} onChange={(e) => setWinner(e.target.value as Side)}>
              <option value="">请选择 / Choose</option>
              <option value="blue">{state.blueTeam.name}</option>
              <option value="red">{state.redTeam.name}</option>
            </select>
          </label>
          <button
            disabled={disabled || busy || !winner}
            onClick={() =>
              winner && send({ type: 'confirm_game_end', reportId: report.id, winner })
            }
          >
            确认本局比赛已结束 / Confirm game ended
          </button>
          <p>此确认不会自动修改比分。 / This confirmation does not change the score.</p>
        </div>
      )}
      <div hidden={config?.mode === 'bot'}>
        <ul aria-label="候选名单 / Candidates">
          {candidates?.map((c, i) => (
            <li key={c.rowId}>
              {c.team} · {c.name}
              {vote && !native && ` — ${vote.counts[i]} 票 / votes`}
            </li>
          ))}
        </ul>
        {vote?.rosterChanged && (
          <p role="alert">
            名单或分路已变更；本次投票保留发布时选项。请人工核对；身份不一致时请在赛后面板选择 MVP。
            / Roster changed; ballot options remain frozen.
          </p>
        )}
        {vote && (
          <>
            <p>
              <VoteCountdown
                deadline={vote.deadline}
                serverNow={data!.serverNow}
                active={vote.status === 'active'}
              />{' '}
              ·{' '}
              {!native && (
                <a href={vote.url} target="_blank" rel="noreferrer">
                  投票页面 / Vote page
                </a>
              )}
            </p>
            <p>
              发布时间 / Published:{' '}
              {vote.startedAt ? new Date(vote.startedAt).toLocaleString() : '待确认 / Pending'} ·{' '}
              {native ? '规定软截止 / Soft deadline' : '截止 / Deadline'}:{' '}
              {vote.deadline ? new Date(vote.deadline).toLocaleString() : '—'}
            </p>
            <p>
              开始公告 / Opening: {vote.opening.status} {vote.opening.messageId}{' '}
              {vote.opening.error}
            </p>
            <p>
              结束公告 / Closing: {vote.closing.status} {vote.closing.messageId}{' '}
              {vote.closing.error}
            </p>
          </>
        )}
        <div className="toolbar">
          <button
            disabled={busy || !report?.endedAt || !!vote || report.id !== state.committedGameId}
            onClick={() => void command('POST', { action: 'start', reportId: report?.id })}
          >
            发布三分钟投票 / Publish vote
          </button>
          <button
            disabled={busy || vote?.status !== 'active'}
            onClick={() => void command('POST', { action: 'end', id: vote?.id })}
          >
            {native ? '发送软截止公告 / Send soft deadline notice' : '提前截止 / Close early'}
          </button>
          <button
            disabled={busy || !vote || vote.status === 'cancelled'}
            onClick={() => {
              if (window.confirm('取消并作废本局票数？ / Cancel and void ballots?'))
                void command('POST', { action: 'cancel', id: vote?.id });
            }}
          >
            取消投票 / Cancel vote
          </button>
          <button
            disabled={
              busy ||
              !notice ||
              notice.status === 'sent' ||
              notice.status === 'sending' ||
              recoverNative ||
              (notice.status === 'uncertain' && !uncertain)
            }
            onClick={() =>
              void command('POST', { action: 'retry', id: vote?.id, confirmUncertain: uncertain })
            }
          >
            重试公告 / Retry announcement
          </button>
        </div>
        {recoverNative && (
          <label>
            原生 Poll 消息 ID / Original Poll message ID
            <input value={recoveryId} onChange={(e) => setRecoveryId(e.target.value)} />
            <button
              disabled={busy || !recoveryId}
              onClick={() =>
                void command('POST', { action: 'recover', id: vote?.id, messageId: recoveryId })
              }
            >
              核对并恢复，不重发 / Recover without repost
            </button>
          </label>
        )}
        {notice?.status === 'uncertain' && !recoverNative && (
          <label>
            <input
              type="checkbox"
              checked={uncertain}
              onChange={(e) => setUncertain(e.target.checked)}
            />
            已核对频道，允许可能重复的公告 / Checked channel; permit retry
          </label>
        )}
        {vote?.status === 'closed' && (
          <div>
            <label>
              人工选择 MVP / Select MVP
              <select
                value={chosen}
                onChange={(e) => {
                  setChosen(e.target.value);
                  setChecked(false);
                }}
              >
                <option value="">请选择 / Choose</option>
                {vote.candidates.map((c) => (
                  <option key={c.rowId} value={c.rowId}>
                    {c.team} · {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              已核对票数与本局选手身份 / Results and player identity verified
            </label>
            <button
              disabled={disabled || !checked || !identityMatches}
              onClick={() => {
                if (
                  send({
                    type: 'select_mvp',
                    reportId: vote.reportId,
                    rowId: chosen,
                    expectedPlayerId: vote.candidates.find((c) => c.rowId === chosen)!.name,
                    activate: false,
                  })
                )
                  setChecked(false);
              }}
            >
              确认赛事 MVP / Confirm final MVP
            </button>
            <p>已确认 / Confirmed: {report?.selectedMvpPlayerId || '—'}</p>
          </div>
        )}
      </div>
      <p role="status">{message || data?.error}</p>
    </section>
  );
}
