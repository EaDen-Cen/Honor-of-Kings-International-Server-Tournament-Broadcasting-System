import { useEffect, useMemo, useState } from 'react';
import type { MatchState } from '../shared/types';
import { canVerifyPlayerOrder } from '../shared/playerOrderPreflight';
import { apiURL } from '../shared/config';
import { getSharedWindowCaptureStream, subscribeSharedWindowCapture } from './sharedWindowCapture';

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/** These observations never inherit a pass from the operator's checkboxes. */
export function PreflightStatus({
  token,
  connected,
  zh,
  state,
  onChecks,
}: {
  token: string;
  connected: boolean;
  zh: boolean;
  state: MatchState;
  onChecks: (checks: Check[]) => void;
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
    setChecks(
      [
        'Node',
        zh ? '模板 / 观看连接' : 'Templates / viewers',
        'OBS',
        zh ? '录制磁盘' : 'Recording disk',
        zh ? '备份' : 'Backup',
      ].map((name) => ({ name, ok: false, detail: zh ? '等待查询完成' : 'Awaiting observations' })),
    );
    setCheckedAt('');
    async function check(
      name: string,
      path: string,
      inspect: (
        data: Record<string, unknown>,
      ) => Omit<Check, 'name'> | Promise<Omit<Check, 'name'>>,
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
        return { name, ...(await inspect(data as Record<string, unknown>)) };
      } catch {
        return { name, ok: false, detail: unavailable };
      }
    }
    void Promise.all(
      [
        check('Node', '/api/health', (data) => ({
          ok: data.ok === true,
          detail: data.ok === true ? 'OK' : unavailable,
        })),
        check(
          zh ? '模板 / 观看连接' : 'Templates / viewers',
          '/api/v1/preflight-status',
          (data) => ({
            ok:
              data.heroesReady === true &&
              Number(data.casterConnections) > 0 &&
              Number(data.overlayConnections) > 0,
            detail: `Node ${data.node ?? '—'} · ${zh ? '缺少模板' : 'Missing templates'}: ${data.missingTemplates ?? '—'} · Caster: ${data.casterConnections ?? 0} · Overlay: ${data.overlayConnections ?? 0}`,
          }),
        ),
        check('OBS', '/api/v1/obs/status', async (data) => {
          let browserReady = false;
          if (data.connected === true && typeof data.programScene === 'string') {
            const response = await fetch(
              `${apiURL}/api/v1/obs/layout?scene=${encodeURIComponent(data.programScene)}`,
              { headers: { Authorization: `Bearer ${token}` }, signal, cache: 'no-store' },
            );
            if (response.ok) {
              const layout = (await response.json()) as {
                sources?: { enabled?: boolean; width?: number; height?: number }[];
              };
              browserReady =
                Array.isArray(layout.sources) &&
                layout.sources.some(
                  (source) =>
                    source.enabled === true && source.width === 1920 && source.height === 1080,
                );
            }
          }
          return {
            ok:
              data.connected === true &&
              data.recording === true &&
              typeof data.programScene === 'string' &&
              !!data.programScene &&
              browserReady,
            detail:
              data.connected === true
                ? `${typeof data.programScene === 'string' ? data.programScene : '—'} · ${data.recording === true ? (zh ? '录制中' : 'Recording') : zh ? '未确认录制' : 'Recording unconfirmed'} · Browser Source 1920×1080: ${browserReady ? 'OK' : unavailable}`
                : unavailable,
          };
        }),
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
      ].map((task) =>
        task.then((result) => {
          if (!controller.signal.aborted)
            setChecks((current) =>
              current.map((check) => (check.name === result.name ? result : check)),
            );
          return result;
        }),
      ),
    ).then((results) => {
      if (controller.signal.aborted) return;
      setChecks(results);
      setCheckedAt(new Date().toLocaleTimeString());
    });
    return () => controller.abort();
  }, [token, revision, zh, state.gameNumber, state.draftGameNumber]);
  const live = capture?.getVideoTracks().some((track) => track.readyState === 'live') === true;
  const rows: Check[] = useMemo(
    () => [
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
      {
        name: zh ? '名单 / Logo / 赛制' : 'Rosters / logos / series',
        ok: canVerifyPlayerOrder(state) && !!state.blueTeam.logo && !!state.redTeam.logo,
        detail: `${state.seriesFormat} · ${state.blueTeam.name} / ${state.redTeam.name} · ${zh ? 'P1–P5 顺序仍需对照画面确认' : 'P1–P5 order still requires visual confirmation'}`,
      },
      ...(checks.length
        ? checks
        : [
            {
              name: zh ? '后端查询' : 'Backend queries',
              ok: false,
              detail: zh ? '等待查询完成' : 'Awaiting observations',
            },
          ]),
    ],
    [connected, zh, live, checks, state],
  );
  useEffect(() => onChecks(rows), [rows, onChecks]);
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
