import { useState } from 'react';
import { apiURL } from '../shared/config';
import type { StoragePreview, StorageConfig, CleanupResult } from '../../server/storageMaintenance';
export function StorageMaintenancePanel({ token, zh }: { token: string; zh: boolean }) {
  const [preview, setPreview] = useState<StoragePreview>(),
    [history, setHistory] = useState<CleanupResult[]>([]);
  const [config, setConfig] = useState<StorageConfig>({
    enabled: false,
    retentionDays: 14,
    intervalHours: 24,
  });
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [loaded, setLoaded] = useState(false);
  const size = (bytes: number) => (bytes / 1048576).toFixed(2) + ' MiB';
  async function request(action: 'inspect' | 'clean' | 'config') {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`${apiURL}/api/v1/storage`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          ...(action === 'clean' ? { id: preview?.id } : action === 'config' ? { config } : {}),
        }),
        signal: AbortSignal.timeout(60000),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Maintenance failed');
      setConfig(data.config);
      setHistory(data.history);
      setLoaded(true);
      if (action === 'inspect') setPreview(data.preview);
      else setPreview(undefined);
      if (data.result)
        setMessage(
          data.result.deferred
            ? `${zh ? '已延后' : 'Deferred'}: ${data.result.deferred}`
            : `${zh ? '已删除' : 'Deleted'} ${data.result.deleted} · ${size(data.result.bytes)}`,
        );
      if (action === 'config')
        setMessage(zh ? '设置已保存，请重新预览。' : 'Settings saved; preview again.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Maintenance failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="panel">
      <summary>{zh ? '本地空间与安全清理' : 'Local storage and safe cleanup'}</summary>
      <p>
        {zh
          ? '仅本机 Control 可用。扫描应用目录；不跟随链接。比赛资料、备份、素材、模型、依赖和未知文件不自动删除。旧文件没有生成凭据时仅统计。'
          : 'Local Control only. Links are skipped. Match data, backups, media, models, dependencies and unknown files are protected. Old files without producer receipts are counted only.'}
      </p>
      <div className="toolbar">
        <button disabled={busy} onClick={() => void request('inspect')}>
          {zh ? '查看空间占用 / 仅预览' : 'Inspect storage / preview only'}
        </button>
        <button
          disabled={busy || !preview?.items.some((i) => i.eligible)}
          onClick={() => void request('clean')}
        >
          {zh ? '立即清理已预览项目' : 'Clean previewed files now'}
        </button>
      </div>
      {preview && (
        <>
          <p>{preview.root}</p>
          <p>
            {zh ? '预计可回收' : 'Estimated reclaimable'}: {size(preview.reclaimable)} ·{' '}
            {preview.retentionDays} {zh ? '天保留期' : 'days retention'}
            {preview.partial &&
              (zh ? ' · 扫描达到上限，所列大小为下限' : ' · Scan capped; sizes are lower bounds')}
          </p>
          <table>
            <thead>
              <tr>
                {(zh
                  ? ['目录', '大小', '文件数', '类别 / 用途', '可回收']
                  : ['Directory', 'Size', 'Files', 'Category / purpose', 'Reclaimable']
                ).map((s) => (
                  <th key={s}>{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((r) => (
                <tr key={r.path}>
                  <td>{r.path}</td>
                  <td>{size(r.bytes)}</td>
                  <td>{r.files}</td>
                  <td>
                    {r.category} · {r.purpose}
                  </td>
                  <td>{size(r.reclaimable)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <details>
            <summary>
              {zh ? '清理命中与跳过原因' : 'Candidates and exclusions'} ({preview.items.length})
            </summary>
            <ul>
              {preview.items.map((i) => (
                <li key={i.path}>
                  {i.path} · {size(i.bytes)} · {i.reason}
                </li>
              ))}
            </ul>
            {preview.notes.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </details>
        </>
      )}
      <fieldset disabled={busy || !loaded}>
        <legend>{zh ? '定期清理（默认关闭）' : 'Scheduled cleanup (off by default)'}</legend>
        <label>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
          />
          {zh ? '启用定期清理' : 'Enable scheduled cleanup'}
        </label>
        <label>
          {zh ? '保留天数' : 'Retention days'}
          <input
            type="number"
            min={1}
            max={365}
            value={config.retentionDays}
            onChange={(e) => setConfig({ ...config, retentionDays: Number(e.target.value) })}
          />
        </label>
        <label>
          {zh ? '间隔小时' : 'Interval hours'}
          <input
            type="number"
            min={1}
            max={168}
            value={config.intervalHours}
            onChange={(e) => setConfig({ ...config, intervalHours: Number(e.target.value) })}
          />
        </label>
        <button onClick={() => void request('config')}>
          {zh ? '保存清理设置' : 'Save cleanup settings'}
        </button>
      </fieldset>
      <p>
        {zh
          ? '比赛、录制或 OBS 状态未知时延后。每次最多 200 文件 / 256 MiB / 5 秒工作预算。保留文件可创建同名 .keep 文件。'
          : 'Deferred during a match, recording or unknown OBS state. Each run: at most 200 files / 256 MiB / 5-second work budget. Add a matching .keep file to retain an artifact.'}
      </p>
      <p role="status">{message}</p>
      <details>
        <summary>{zh ? '最近清理记录' : 'Recent cleanup history'}</summary>
        {history.map((r, index) => (
          <div key={index}>
            <p>
              {new Date(r.at).toLocaleString()} · {r.deleted} · {size(r.bytes)} · {r.deferred}
            </p>
            <ul>
              {r.deletedFiles?.map((s) => (
                <li key={s.path}>
                  {zh ? '已删除' : 'Deleted'}: {s.path} · {size(s.bytes)}
                </li>
              ))}
              {r.skipped.map((s, i) => (
                <li key={i}>
                  {s.path}: {s.reason}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </details>
    </details>
  );
}
