import { useEffect, useState } from 'react';
import { apiURL } from '../shared/config';
import { getSharedWindowCaptureStream, subscribeSharedWindowCapture } from './sharedWindowCapture';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/** These observations never inherit a pass from the operator's checkboxes. */
export function PreflightStatus({
  token,
  connected,
  zh,
}: {
  token: string;
  connected: boolean;
  zh: boolean;
}) {
  const [checks, setChecks] = useState<Check[]>([]);
  const [revision, setRevision] = useState(0);
  const [checkedAt, setCheckedAt] = useState('');
  const [capture, setCapture] = useState(getSharedWindowCaptureStream);
  useEffect(() => {
    const unsubscribe = subscribeSharedWindowCapture(setCapture);
    return () => {
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]);
    const unavailable = zh ? '未验证 / 不可用' : 'Unverified / unavailable';
    setChecks([]);
    setCheckedAt('');
    async function check(
      name: string,
      path: string,
      inspect: (data: Record<string, unknown>) => Omit<Check, 'name'>,
    ): Promise<Check> {
      try {
        const response = await fetch(`${apiURL}${path}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal,
        });
        if (!response.ok)
          return { name, ok: false, detail: `${unavailable} (HTTP ${response.status})` };
        const data: unknown = await response.json();
        if (!data || typeof data !== 'object' || Array.isArray(data))
          throw new Error('Invalid status');
        return { name, ...inspect(data as Record<string, unknown>) };
      } catch {
        return { name, ok: false, detail: unavailable };
      }
    }
    void Promise.all([
      check('Node', '/api/health', (data) => ({
        ok: data.ok === true,
        detail: data.ok === true ? 'OK' : unavailable,
      })),
      check('OBS', '/api/v1/obs/status', (data) => ({
        ok:
          data.connected === true &&
          data.recording === true &&
          typeof data.programScene === 'string' &&
          !!data.programScene,
        detail:
          data.connected === true
            ? `${typeof data.programScene === 'string' ? data.programScene : '—'} · ${data.recording === true ? (zh ? '录制中' : 'Recording') : zh ? '未确认录制' : 'Recording unconfirmed'}`
            : unavailable,
      })),
      check(zh ? '录制磁盘' : 'Recording disk', '/api/v1/obs/storage', (data) => ({
        ok:
          data.ok === true &&
          data.low === false &&
          data.source === 'obs' &&
          typeof data.freeBytes === 'number' &&
          data.freeBytes > 0,
        detail:
          data.ok === true && typeof data.freeBytes === 'number'
            ? `${(data.freeBytes / 1024 ** 3).toFixed(1)} GiB · ${typeof data.directory === 'string' ? data.directory : '—'}${data.source !== 'obs' ? (zh ? '（配置路径；未核实 OBS）' : ' (configured path; OBS unverified)') : ''}${data.low === true ? (zh ? ' · 空间不足' : ' · Low space') : ''}`
            : unavailable,
      })),
      check(zh ? '备份' : 'Backup', '/api/recovery', (data) => ({
        ok: Array.isArray(data.backups) && data.backups.length > 0 && !data.error,
        detail: Array.isArray(data.backups)
          ? `${data.backups.length} · ${typeof data.lastBackup === 'string' ? data.lastBackup : '—'}${data.error ? (zh ? ' · 备份错误' : ' · Backup error') : ''}`
          : unavailable,
      })),
    ]).then((results) => {
      if (controller.signal.aborted) return;
      setChecks(results);
      setCheckedAt(new Date().toLocaleTimeString());
    });
    return () => controller.abort();
  }, [token, revision, zh]);
  const live = capture?.getVideoTracks().some((track) => track.readyState === 'live') === true;
  const rows: Check[] = [
    {
      name: 'WebSocket',
      ok: connected,
      detail: connected ? (zh ? '已连接' : 'Connected') : zh ? '已断开' : 'Disconnected',
    },
    {
      name: zh ? '共享采集' : 'Shared capture',
      ok: live,
      detail: live
        ? zh
          ? '实时流存在；仍需核对 ROI'
          : 'Live stream; verify ROI manually'
        : zh
          ? '无实时流'
          : 'No live stream',
    },
    ...checks,
  ];
  return (
    <section aria-label={zh ? '自动预检状态' : 'Automatic preflight status'}>
      <p className="muted">
        {zh
          ? '实际查询结果不受人工勾选影响。OBS 查询仅限本机；此结果不证明画面、音频、模板或公网可用。'
          : 'Observed status is independent of manual confirmation. OBS queries require local Control. This does not verify video, audio, templates or public access.'}
      </p>
      <ul>
        {rows.map((check) => (
          <li key={check.name} data-check={check.name} data-passed={check.ok}>
            {check.ok ? '✓' : '⚠'} {check.name}: {check.detail}
          </li>
        ))}
      </ul>
      <p>
        {checkedAt
          ? `${zh ? '查询时间' : 'Checked at'}: ${checkedAt}`
          : zh
            ? '查询中…'
            : 'Checking…'}
      </p>
      <button type="button" onClick={() => setRevision((value) => value + 1)}>
        {zh ? '刷新实际状态' : 'Refresh actual status'}
      </button>
    </section>
  );
}
