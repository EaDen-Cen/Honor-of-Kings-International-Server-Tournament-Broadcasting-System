import { useEffect, useState } from 'react';
import { apiURL } from '../shared/config';
import { AiRecognitionSettings } from './AiRecognitionSettings';
import type { DiscordPublicConfig } from '../shared/audienceVote';
export function IntegrationSettings({ token, zh }: { token: string; zh: boolean }) {
  const [discord, setDiscord] = useState<DiscordPublicConfig>();
  const [obs, setObs] = useState({ address: 'ws://127.0.0.1:4455', configured: false });
  const [botToken, setBotToken] = useState(''),
    [webhookUrl, setWebhookUrl] = useState(''),
    [password, setPassword] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void Promise.allSettled([
      fetch(`${apiURL}/api/v1/discord/config`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: abort.signal,
      }).then(async (r) => {
        if (!r.ok) throw Error('Discord 配置不可用');
        setDiscord(await r.json());
      }),
      fetch(`${apiURL}/api/v1/obs/config`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: abort.signal,
      }).then(async (r) => {
        if (!r.ok) throw Error('OBS 配置不可用');
        setObs(await r.json());
      }),
    ]).then((results) => {
      if (!abort.signal.aborted)
        setMessage(
          results
            .filter((r) => r.status === 'rejected')
            .map((r) => (r.status === 'rejected' ? String(r.reason) : ''))
            .join('；'),
        );
    });
    return () => abort.abort();
  }, [token]);
  async function action(path: string, method: string, body: unknown) {
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch(`${apiURL}/api/v1/${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error || '操作失败');
      if (path === 'discord/config') {
        setDiscord(data);
        document.dispatchEvent(new CustomEvent('hok-discord-config', { detail: data }));
        setBotToken('');
        setWebhookUrl('');
      }
      if (path === 'obs/config') setPassword('');
      setMessage(
        method === 'PUT' ? '已加密保存，重启后自动加载。' : '连接测试成功：' + (data.bot || ''),
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div id="integration-settings" className="integration-settings">
      <h2>{zh ? '设置中心 · 外部连接' : 'External connections'}</h2>
      <AiRecognitionSettings token={token} zh={zh} />
      <details className="panel">
        <summary>Discord Bot / Webhook</summary>
        {discord && (
          <>
            {discord.storageError && <p role="alert">{discord.storageError}</p>}
            <label>
              Bot Token {discord.tokenMask}
              <input
                type="password"
                autoComplete="off"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
              />
            </label>
            <label>
              服务器 ID
              <input
                value={discord.guildId}
                onChange={(e) => setDiscord({ ...discord, guildId: e.target.value })}
              />
            </label>
            <label>
              频道 ID
              <input
                value={discord.channelId}
                onChange={(e) => setDiscord({ ...discord, channelId: e.target.value })}
              />
            </label>
            <label>
              Webhook URL {discord.webhookConfigured ? '（已保存）' : ''}
              <input
                type="password"
                autoComplete="off"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
            </label>
            <label>
              默认时长
              <select
                value={discord.minutes}
                onChange={(e) => setDiscord({ ...discord, minutes: Number(e.target.value) })}
              >
                {[2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} 分钟
                  </option>
                ))}
              </select>
            </label>
            <label>
              候选范围
              <select
                value={discord.scope}
                onChange={(e) =>
                  setDiscord({ ...discord, scope: e.target.value as 'all' | 'winner' })
                }
              >
                <option value="all">全场 10 人</option>
                <option value="winner">获胜队伍 5 人（人工确认胜方）</option>
              </select>
            </label>
            <label className="settings-checkbox">
              <span>直播端只在结束后揭晓票数</span>
              <input
                type="checkbox"
                checked={discord.hideLiveVotes}
                onChange={(e) => setDiscord({ ...discord, hideLiveVotes: e.target.checked })}
              />
            </label>
            <label className="settings-checkbox">
              <span>创建赛后报告后自动发布（全场模式）</span>
              <input
                type="checkbox"
                checked={discord.autoStart}
                onChange={(e) => setDiscord({ ...discord, autoStart: e.target.checked })}
              />
            </label>
            <div className="toolbar">
              <button
                disabled={busy}
                onClick={() =>
                  void action('discord/config', 'PUT', {
                    ...discord,
                    ...(botToken ? { botToken } : {}),
                    ...(webhookUrl ? { webhookUrl } : {}),
                  })
                }
              >
                保存 Discord
              </button>
              <button
                disabled={busy || !discord.configured}
                onClick={() => void action('discord/test', 'POST', {})}
              >
                测试 Bot 连接
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void action('discord/config', 'PUT', {
                    botToken: '',
                    webhookUrl: '',
                    autoStart: false,
                  })
                }
              >
                删除凭证
              </button>
              <button
                disabled={busy}
                onClick={() => void action('discord/config', 'PUT', { webhookUrl: '' })}
              >
                清除 Webhook
              </button>
            </div>
          </>
        )}
      </details>
      <details className="panel">
        <summary>OBS WebSocket · 持久连接配置</summary>
        <label>
          本机地址
          <input
            value={obs.address}
            onChange={(e) => setObs({ ...obs, address: e.target.value })}
          />
        </label>
        <label>
          密码 {obs.configured ? '（已保存）' : ''}
          <input
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button
          disabled={busy}
          onClick={() =>
            void action('obs/config', 'PUT', {
              address: obs.address,
              ...(password ? { password } : {}),
            })
          }
        >
          保存并重新连接 OBS
        </button>
        <button
          disabled={busy}
          onClick={() => void action('obs/config', 'PUT', { address: obs.address, password: '' })}
        >
          清除密码
        </button>
        <p>
          持续 BGM 应在各场景引用同一音频源，或使用全局音频。切场景时不要销毁或重新开始媒体播放。
        </p>
      </details>
      <p role="status">{message}</p>
    </div>
  );
}
