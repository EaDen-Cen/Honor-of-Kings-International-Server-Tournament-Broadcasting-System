import { useEffect, useRef, useState } from 'react';
import { apiURL } from '../shared/config';
import { createClientUUID } from '../shared/clientId';
import type { MatchState } from '../shared/types';
import { currentPostGameReport } from '../shared/postGame';

interface Preview {
  id: string;
  kind: string;
  pollUrl?: string;
  content: string;
  hash: string;
}
interface Notice extends Preview {
  createdAt: number;
  status: 'sending' | 'sent' | 'failed' | 'uncertain';
  error?: string;
  retryAt?: number;
  messageId?: string;
}
interface Status {
  configured: boolean;
  notices: Notice[];
  busy: boolean;
}
export function DiscordWebhookPanel({ token, state }: { token: string; state: MatchState }) {
  const [kind, setKind] = useState('start'),
    [pollUrl, setPollUrl] = useState('');
  const [preview, setPreview] = useState<Preview>();
  const [status, setStatus] = useState<Status>();
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [confirmUncertain, setConfirmUncertain] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const report = currentPostGameReport(state);
  const key = JSON.stringify([
    token,
    state.stage,
    state.seriesFormat,
    state.blueTeam.name,
    state.redTeam.name,
    state.blueScore,
    state.redScore,
    state.draftGameNumber ?? state.gameNumber,
    state.committedGameId,
    report?.id,
    report?.selectedMvpRowId,
    kind,
    pollUrl,
  ]);
  const context = useRef(key);
  context.current = key;
  useEffect(() => {
    setPreview(undefined);
    setConfirmUncertain(false);
  }, [key]);
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`${apiURL}/api/v1/discord/webhook`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
    })
      .then(async (response) => {
        if (!response.ok) throw Error('Webhook 状态不可用，请在本机 Control 重试');
        return response.json() as Promise<Status>;
      })
      .then((data) => {
        if (!abort.signal.aborted) setStatus(data);
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          setMessage(error instanceof Error ? error.message : '状态查询失败');
      });
    return () => abort.abort();
  }, [token, refresh]);
  async function command(send: boolean) {
    if (send && !preview) return;
    const version = context.current;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(
        `${apiURL}/api/v1/discord/webhook-${send ? 'send' : 'preview'}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(
            send ? { ...preview, previewHash: preview!.hash, confirmUncertain } : { kind, pollUrl },
          ),
          signal: AbortSignal.timeout(15000),
        },
      );
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Webhook 操作失败');
      if (send) {
        setStatus(data);
        setMessage('请核对下方发送状态与日志。');
      } else if (context.current === version)
        setPreview({ ...data, id: createClientUUID(), kind, pollUrl });
      else setMessage('比赛状态已变化，请重新预览。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '请求未确认，请刷新日志后核对频道');
    } finally {
      setBusy(false);
    }
  }
  const sent = status?.notices.find((notice) => notice.id === preview?.id);
  return (
    <section className="panel" aria-label="Discord Webhook 通知">
      <h2>Discord · Webhook 通知（无需 Bot）</h2>
      <p>
        在设置中心保存 Webhook 即可使用。Webhook 只发送消息，不读取反应或投票；可由成员使用 Discord
        原生投票，再到赛后面板人工确认 MVP。MVP 公告与现有 MVP Overlay 使用同一已确认选手。
      </p>
      <label>
        公告类型
        <select value={kind} disabled={busy} onChange={(event) => setKind(event.target.value)}>
          <option value="start">赛事开始</option>
          <option value="score">队伍 / 比分</option>
          <option value="game-end">本局结束</option>
          <option value="mvp">已确认 MVP</option>
          <option value="series-end">赛事结束</option>
          <option value="poll-link">外部投票链接</option>
        </select>
      </label>
      {kind === 'poll-link' && (
        <label>
          外部投票 HTTPS 链接
          <input
            type="url"
            value={pollUrl}
            disabled={busy}
            onChange={(event) => setPollUrl(event.target.value)}
          />
        </label>
      )}
      <div className="toolbar">
        <button disabled={busy} onClick={() => void command(false)}>
          生成发送预览
        </button>
        <button disabled={busy} onClick={() => setRefresh((value) => value + 1)}>
          刷新发送日志
        </button>
      </div>
      {!status?.configured && (
        <p>尚未配置 Webhook；可先预览。无需填写 Bot Token、服务器 ID 或频道 ID。</p>
      )}
      {preview && (
        <div>
          <pre aria-label="Webhook 发送预览" style={{ whiteSpace: 'pre-wrap' }}>
            {preview.content}
          </pre>
          {sent?.status === 'uncertain' && (
            <label>
              <input
                type="checkbox"
                checked={confirmUncertain}
                onChange={(event) => setConfirmUncertain(event.target.checked)}
              />
              我已核对 Discord 频道，确认需要重发（可能产生重复消息）
            </label>
          )}
          <button
            disabled={
              busy ||
              !status?.configured ||
              sent?.status === 'sent' ||
              (sent?.status === 'uncertain' && !confirmUncertain)
            }
            onClick={() => void command(true)}
          >
            {sent ? '按原预览重试' : '确认发送到 Discord'}
          </button>
        </div>
      )}
      <p role="status">{message}</p>
      <ol aria-label="Webhook 发送日志">
        {[...(status?.notices ?? [])].reverse().map((notice) => (
          <li key={notice.id}>
            <strong>{notice.status}</strong> · {new Date(notice.createdAt).toLocaleString()}{' '}
            {notice.messageId && `· Message ${notice.messageId}`} {notice.error}
            {notice.retryAt && (
              <span> · 可重试时间 {new Date(notice.retryAt).toLocaleTimeString()}</span>
            )}
            <details>
              <summary>查看原公告</summary>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{notice.content}</pre>
            </details>
            {(notice.status === 'failed' || notice.status === 'uncertain') && (
              <button
                disabled={busy}
                onClick={() => {
                  setPreview(notice);
                  setConfirmUncertain(false);
                }}
              >
                加载原预览以重试
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
