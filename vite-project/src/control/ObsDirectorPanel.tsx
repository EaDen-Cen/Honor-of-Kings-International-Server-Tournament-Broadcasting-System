import { useCallback, useEffect, useRef, useState } from 'react';
import { apiURL } from '../shared/config';
import type { MatchState } from '../shared/types';
import {
  obsCueKeys,
  obsCueLabels,
  parseObsCueMap,
  recommendedObsCue,
  resolveObsCue,
  type ObsCueMap,
  type ObsCue,
} from './obsCues';

interface ObsStatus {
  configured: boolean;
  connected: boolean;
  scenes: string[];
  programScene: string | null;
  recording: boolean | null;
  error?: string;
}

function readSceneOrder(): string[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem('hok-obs-scene-order-v1') || '[]');
    return Array.isArray(data)
      ? data
          .filter(
            (name): name is string =>
              typeof name === 'string' && name.length > 0 && name.length <= 128,
          )
          .slice(0, 100)
          .filter((name, index, all) => all.indexOf(name) === index)
      : [];
  } catch {
    return [];
  }
}
function orderedScenes(scenes: string[], saved: string[]): string[] {
  return [...scenes].sort((a, b) => {
    const ai = saved.indexOf(a),
      bi = saved.indexOf(b);
    return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi);
  });
}
interface ObsAudioInput {
  name: string;
  volume: number;
}
interface ObsBrowserSource {
  name: string;
  enabled: boolean;
  index: number;
  width: number | null;
  height: number | null;
}

/** Control-only, local OBS bridge. Never exposes the OBS WebSocket password. */
export function ObsDirectorPanel({
  token,
  zh,
  state,
}: {
  token: string;
  zh: boolean;
  state: MatchState;
}) {
  const inferred = recommendedObsCue(state);
  const [manualCue, setManualCue] = useState<ObsCue | ''>('');
  const suggested = manualCue || inferred;
  const [automation, setAutomation] = useState<'hint' | 'prepare' | 'auto'>('hint');
  const autoCue = useRef('');
  useEffect(() => {
    setManualCue('');
    autoCue.current = '';
  }, [state.draftGameNumber, state.blueTeam.id, state.redTeam.id]);
  const [cueMap, setCueMap] = useState<ObsCueMap>(() => {
    try {
      return parseObsCueMap(localStorage.getItem('hok-obs-scene-cues-v1'));
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('hok-obs-scene-cues-v1', JSON.stringify(cueMap));
    } catch {
      /* Storage disabled: session-only mapping. */
    }
  }, [cueMap]);
  const [status, setStatus] = useState<ObsStatus>();
  const [selected, setSelected] = useState('');
  const [sceneOrder, setSceneOrder] = useState<string[]>(readSceneOrder);
  const [editingSceneOrder, setEditingSceneOrder] = useState(false);
  const scenes = orderedScenes(status?.scenes ?? [], sceneOrder);
  useEffect(() => {
    try {
      localStorage.setItem('hok-obs-scene-order-v1', JSON.stringify(sceneOrder));
    } catch {
      /* In-memory order still works. */
    }
  }, [sceneOrder]);
  const moveScene = (name: string, delta: number) => {
    const next = [...scenes],
      index = next.indexOf(name),
      destination = index + delta;
    if (index < 0 || destination < 0 || destination >= next.length) return;
    [next[index], next[destination]] = [next[destination], next[index]];
    setSceneOrder(next);
  };
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [previousScene, setPreviousScene] = useState('');
  const sceneCommand = useRef(false);
  const statusVersion = useRef(0);
  const [audioInputs, setAudioInputs] = useState<ObsAudioInput[]>([]);
  const [audioName, setAudioName] = useState('');
  const [hadAudioPreferences] = useState(() => {
    try {
      return localStorage.getItem('hok-obs-audio-v1') !== null;
    } catch {
      return false;
    }
  });
  const [targetVolume, setTargetVolume] = useState(() => {
    try {
      return Math.min(
        200,
        Math.max(
          0,
          Number(JSON.parse(localStorage.getItem('hok-obs-audio-v1') || '{}').targetVolume ?? 100),
        ),
      );
    } catch {
      return 100;
    }
  });
  const [fadeMs, setFadeMs] = useState(() => {
    try {
      const value = JSON.parse(localStorage.getItem('hok-obs-audio-v1') || '{}').fadeMs;
      return [0, 1000, 3000, 5000].includes(value) ? value : 3000;
    } catch {
      return 3000;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('hok-obs-audio-v1', JSON.stringify({ targetVolume, fadeMs }));
    } catch {
      /* Session controls remain usable. */
    }
  }, [targetVolume, fadeMs]);
  const [crossfadeTo, setCrossfadeTo] = useState('');
  const fadeGeneration = useRef(0);
  const [layout, setLayout] = useState<{ scene: string; sources: ObsBrowserSource[] } | null>(null);
  const [layoutError, setLayoutError] = useState('');
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioError, setAudioError] = useState('');
  const polling = useRef(false);
  const audioInitialized = useRef(false);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (polling.current || sceneCommand.current) return;
      const version = statusVersion.current;
      polling.current = true;
      try {
        const res = await fetch(`${apiURL}/api/v1/obs/status`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
            : AbortSignal.timeout(8000),
          cache: 'no-store',
        });
        if (!res.ok)
          throw new Error(
            res.status === 403
              ? 'OBS control is only available from the local Control page.'
              : 'Unable to load OBS status.',
          );
        const next = (await res.json()) as ObsStatus;
        if (version !== statusVersion.current) return;
        setStatus(next);
        setSelected((current) =>
          next.scenes.includes(current) ? current : next.programScene || next.scenes[0] || '',
        );
      } catch (error) {
        if (signal?.aborted || version !== statusVersion.current) return;
        setStatus({
          configured: false,
          connected: false,
          scenes: [],
          programScene: null,
          recording: null,
          error: error instanceof Error ? error.message : 'OBS unavailable',
        });
      } finally {
        polling.current = false;
      }
    },
    [token],
  );
  const refreshAudio = useCallback(async () => {
    try {
      const res = await fetch(`${apiURL}/api/v1/obs/audio`, {
        signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const result = (await res.json()) as { inputs?: ObsAudioInput[]; error?: string };
      if (!res.ok) throw new Error(result.error || 'Unable to load OBS audio inputs');
      const inputs = result.inputs ?? [];
      setAudioInputs(inputs);
      if (!audioInitialized.current && inputs[0]) {
        if (!hadAudioPreferences) setTargetVolume(Math.round(inputs[0].volume * 100));
        audioInitialized.current = true;
      }
      setAudioName((current) =>
        inputs.some((input) => input.name === current) ? current : (inputs[0]?.name ?? ''),
      );
      setAudioError('');
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : 'OBS audio unavailable');
    }
  }, [token, hadAudioPreferences]);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => void refresh(controller.signal), 4000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (status?.connected) void refreshAudio();
    else {
      setAudioInputs([]);
      audioInitialized.current = false;
    }
  }, [status?.connected, refreshAudio]);
  const inspectLayout = async () => {
    if (!selected || !status?.connected || layoutBusy) return;
    setLayoutBusy(true);
    setLayoutError('');
    setLayout(null);
    try {
      const res = await fetch(`${apiURL}/api/v1/obs/layout?scene=${encodeURIComponent(selected)}`, {
        signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const result = (await res.json()) as {
        scene?: string;
        sources?: ObsBrowserSource[];
        error?: string;
      };
      if (!res.ok) throw new Error(result.error || 'OBS layout inspection failed');
      setLayout({ scene: result.scene ?? selected, sources: result.sources ?? [] });
    } catch (error) {
      setLayoutError(error instanceof Error ? error.message : 'OBS layout unavailable');
    } finally {
      setLayoutBusy(false);
    }
  };
  const fadeAudio = async (target: number) => {
    if (!audioName || !status?.connected) return;
    const generation = ++fadeGeneration.current;
    setAudioBusy(true);
    setAudioError('');
    try {
      const res = await fetch(`${apiURL}/api/v1/obs/audio`, {
        method: 'POST',
        signal: AbortSignal.timeout(fadeMs + 8000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputName: audioName,
          targetVolume: target / 100,
          durationMs: fadeMs,
        }),
      });
      const result = (await res.json()) as { error?: string; volume?: number };
      if (!res.ok) throw new Error(result.error || 'OBS audio fade failed');
      await refreshAudio();
    } catch (error) {
      if (generation === fadeGeneration.current)
        setAudioError(error instanceof Error ? error.message : 'OBS audio fade failed');
    } finally {
      if (generation === fadeGeneration.current) setAudioBusy(false);
    }
  };
  const switchScene = async (target = selected) => {
    if (
      !target ||
      sceneCommand.current ||
      !status?.connected ||
      !status.scenes.includes(target) ||
      target === status.programScene
    )
      return;
    sceneCommand.current = true;
    statusVersion.current++;
    const fromScene = status.programScene;
    setBusy(true);
    setMessage(
      zh ? `正在切换至「${target}」，等待 OBS 确认…` : `Switching to ${target}; waiting for OBS…`,
    );
    try {
      const res = await fetch(`${apiURL}/api/v1/obs/scene`, {
        method: 'POST',
        signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene: target }),
      });
      const result = (await res.json()) as ObsStatus & { error?: string };
      if (!res.ok) throw new Error(result.error || 'OBS rejected the scene change');
      if (result.programScene !== target)
        throw new Error(
          zh ? 'OBS 未确认切换到目标场景。' : 'OBS did not confirm the requested scene.',
        );
      setStatus(result);
      setPreviousScene(fromScene ?? '');
      setSelected(target);
      setMessage(
        zh ? `OBS 已确认切换至「${target}」。` : `OBS confirmed program scene: ${target}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Scene change failed');
      // A timed-out command may still have reached OBS. Re-read actual state.
      sceneCommand.current = false;
      await refresh();
    } finally {
      sceneCommand.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    const target = resolveObsCue(suggested, status?.scenes ?? [], cueMap);
    const eventKey = `${state.draftGameNumber}:${suggested}`;
    if (
      automation === 'hint' ||
      !target ||
      !status?.connected ||
      manualCue ||
      autoCue.current === eventKey
    )
      return;
    autoCue.current = eventKey;
    if (automation === 'prepare') setSelected(target);
    else if (target !== status.programScene) void switchScene(target);
    // Only a new stage may execute; manual scene changes must not be fought by polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggested, automation, status?.connected, cueMap, state.draftGameNumber, manualCue]);
  return (
    <details id="obs-workspace" className="panel obs-director" data-testid="obs-director">
      <summary>
        {zh ? 'OBS 导播工作区（本地）' : 'OBS director workspace (local)'} ·{' '}
        {status?.connected ? (zh ? '已连接' : 'Connected') : zh ? '未连接' : 'Disconnected'}
        {status?.recording === true ? ' · REC' : ''}
      </summary>
      <div className="obs-director-content">
        <div className="obs-director-status-grid" aria-label={zh ? 'OBS 运行状态' : 'OBS status'}>
          <div className="obs-status-tile">
            <span>{zh ? '连接状态' : 'Connection'}</span>
            <strong>
              {status?.connected ? (zh ? '已连接' : 'Connected') : zh ? '未连接' : 'Disconnected'}
            </strong>
          </div>
          <div className="obs-status-tile">
            <span>{zh ? '当前节目场景' : 'Program scene'}</span>
            <strong>{status?.programScene || '—'}</strong>
          </div>
          <div className="obs-status-tile">
            <span>{zh ? '录制状态' : 'Recording'}</span>
            <strong>
              {status?.recording === true
                ? '● REC'
                : status?.recording === false
                  ? zh
                    ? '未录制'
                    : 'Stopped'
                  : '—'}
            </strong>
          </div>
          <div className="obs-status-tile">
            <span>{zh ? '比赛阶段建议' : 'Suggested stage'}</span>
            <strong>{zh ? obsCueLabels[suggested].zh : obsCueLabels[suggested].eng}</strong>
          </div>
        </div>
        {status?.connected && status.recording === false && suggested === 'game' && (
          <p role="status" className="obs-recording-warning">
            {zh
              ? '当前比赛已进入局内阶段，但 OBS 显示未录制。若需要本地回放，请先在 OBS 确认录制已启动。'
              : 'Game stage is active, but OBS reports recording stopped. Start recording in OBS if a local replay is required.'}
          </p>
        )}
        <div className="obs-director-toolbar">
          <button type="button" onClick={() => void refresh()}>
            {zh ? '刷新 OBS 状态' : 'Refresh OBS status'}
          </button>
          <button
            type="button"
            disabled={
              busy ||
              !status?.connected ||
              !previousScene ||
              !status.scenes.includes(previousScene) ||
              previousScene === status.programScene
            }
            onClick={() => void switchScene(previousScene)}
          >
            {zh ? '返回上一场景' : 'Return to previous scene'}
            {previousScene ? ` · ${previousScene}` : ''}
          </button>
          <span className="muted">
            {zh
              ? '默认仅提示；自动切镜需在下方明确开启，人工切镜会暂停赛后轮播。'
              : 'Match state is read-only here; OCR and match progress never switch scenes automatically.'}
          </span>
        </div>
        {!status?.configured ? (
          <p role="status">
            {status?.error ||
              (zh
                ? '本地 OBS 尚未配置：在服务端 .env 设置 OBS_WS_URL 和 OBS_WS_PASSWORD。'
                : 'Configure OBS_WS_URL and OBS_WS_PASSWORD in the local server environment.')}
          </p>
        ) : !status.connected ? (
          <p role="status">{status.error || (zh ? '正在连接 OBS…' : 'Connecting to OBS…')}</p>
        ) : null}
        {!status?.connected && (
          <p className="muted">
            {zh
              ? '连接检查：在 OBS「工具 → WebSocket 服务器设置」启用服务器，确认端口（通常 4455）与密码；本地服务端 .env 中设置 OBS_WS_URL=ws://127.0.0.1:4455 和 OBS_WS_PASSWORD，然后重启本地服务。'
              : 'Enable OBS Tools → WebSocket Server Settings, verify port (usually 4455) and password, configure OBS_WS_URL and OBS_WS_PASSWORD in the local server .env, then restart the local server.'}
          </p>
        )}
        <div className="obs-workspace-grid">
          <section
            className="obs-workspace-card obs-cue-card"
            aria-label={zh ? '赛事场景联动' : 'Match scene cues'}
          >
            <div className="obs-workspace-heading">
              <h4>{zh ? '赛事阶段 · 一键切镜' : 'Match stages · scene cues'}</h4>
              <span className="muted">{zh ? '手动确认执行' : 'Manual only'}</span>
            </div>
            <p className="muted">
              {zh
                ? '根据导播控制台当前 BP、开局及赛后状态提示推荐场景；先将每个阶段绑定到 OBS 中的真实场景。'
                : 'Suggestions follow Control BP, game and postgame state. Map each stage to an actual OBS scene first.'}
            </p>
            <div className="toolbar">
              <label>
                {zh ? '建议模式' : 'Cue mode'}
                <select
                  value={automation}
                  onChange={(e) => {
                    autoCue.current = '';
                    setAutomation(e.target.value as typeof automation);
                  }}
                >
                  <option value="hint">仅提示</option>
                  <option value="prepare">半自动：准备后人工切换</option>
                  <option value="auto">自动切镜（本次会话明确授权）</option>
                </select>
              </label>
              <label>
                人工阶段覆盖
                <select
                  value={manualCue}
                  onChange={(e) => setManualCue(e.target.value as ObsCue | '')}
                >
                  <option value="">跟随系统推断</option>
                  {obsCueKeys.map((c) => (
                    <option value={c} key={c}>
                      {obsCueLabels[c].zh}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="muted">
              {manualCue
                ? '依据：导播人工指定'
                : inferred === 'postgame'
                  ? '依据：本局已确认 / 已有赛后报告'
                  : inferred === 'game'
                    ? '依据：BP 已完成，推断加载 / 入局；无需先确认本局有效'
                    : inferred === 'draft'
                      ? '依据：已有 BP 操作'
                      : '依据：尚未开始 BP'}
              。实际播出以 OBS 确认状态为准。
            </p>
            <div className="obs-cue-list">
              {obsCueKeys.map((cue) => {
                const mapped = resolveObsCue(cue, status?.scenes ?? [], cueMap);
                const active = !!mapped && status?.programScene === mapped;
                const recommended = cue === suggested;
                return (
                  <div
                    className={`obs-cue-row${recommended ? ' is-recommended' : ''}`}
                    key={cue}
                    data-testid={`obs-cue-${cue}`}
                  >
                    <label htmlFor={`obs-cue-map-${cue}`}>
                      {zh ? obsCueLabels[cue].zh : obsCueLabels[cue].eng}
                      {recommended ? <small> · {zh ? '建议' : 'Suggested'}</small> : null}
                    </label>
                    <select
                      id={`obs-cue-map-${cue}`}
                      aria-label={`OBS cue map ${cue}`}
                      value={cueMap[cue] ?? mapped ?? ''}
                      onChange={(e) =>
                        setCueMap((previous) => ({ ...previous, [cue]: e.target.value }))
                      }
                    >
                      <option value="">{zh ? '未绑定' : 'Unmapped'}</option>
                      {(status?.scenes ?? []).map((scene) => (
                        <option key={scene} value={scene}>
                          {scene}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!status?.connected || busy || !mapped || active}
                      onClick={() => void switchScene(mapped ?? '')}
                    >
                      {active ? (zh ? '播出中' : 'On air') : zh ? '切换' : 'Take'}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
          <section
            className="obs-workspace-card"
            aria-label={zh ? '手动场景与音源' : 'Manual scene and audio'}
          >
            <div className="obs-workspace-heading">
              <h4>{zh ? '手动场景控制' : 'Manual scene control'}</h4>
            </div>
            <div className="obs-workspace-heading">
              <span className="muted">
                {zh
                  ? '点击按钮切换实际 OBS 场景；正在播出的场景不可重复切换。'
                  : 'Click a scene button to take it on air.'}
              </span>
              <button
                type="button"
                aria-pressed={editingSceneOrder}
                onClick={() => setEditingSceneOrder((value) => !value)}
              >
                {editingSceneOrder ? (zh ? '完成排序' : 'Done') : zh ? '自定义顺序' : 'Reorder'}
              </button>
            </div>
            <div className="obs-scene-button-grid" data-testid="obs-scene-buttons">
              {scenes.map((scene, index) => (
                <div className="obs-scene-button-item" key={scene}>
                  <button
                    type="button"
                    className={scene === status?.programScene ? 'is-on-air' : ''}
                    aria-label={`OBS quick scene ${scene}`}
                    aria-pressed={scene === status?.programScene}
                    disabled={!status?.connected || busy || scene === status.programScene}
                    onClick={() => void switchScene(scene)}
                  >
                    {scene === status?.programScene ? '● ' : ''}
                    {scene}
                  </button>
                  {editingSceneOrder && (
                    <span className="obs-scene-order-actions">
                      <button
                        type="button"
                        aria-label={`Move ${scene} up`}
                        disabled={index === 0}
                        onClick={() => moveScene(scene, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${scene} down`}
                        disabled={index === scenes.length - 1}
                        onClick={() => moveScene(scene, 1)}
                      >
                        ↓
                      </button>
                    </span>
                  )}
                </div>
              ))}
              {!scenes.length && (
                <p className="muted">
                  {zh ? '连接 OBS 后自动加载场景快捷按钮。' : 'Connect OBS to load scene buttons.'}
                </p>
              )}
            </div>
            <details className="obs-scene-advanced">
              <summary>
                {zh
                  ? '高级：按名称选择场景与布局检查'
                  : 'Advanced: select scene for layout inspection'}
              </summary>
              <div className="obs-director-toolbar">
                <label>
                  {zh ? '检查场景' : 'Inspect scene'}{' '}
                  <select
                    aria-label="OBS scene"
                    value={selected}
                    disabled={!status?.connected || busy}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    {scenes.map((scene) => (
                      <option key={scene} value={scene}>
                        {scene}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={
                    busy || !status?.connected || !selected || selected === status.programScene
                  }
                  onClick={() => void switchScene()}
                >
                  {zh ? '确认切换' : 'Take selected scene'}
                </button>
              </div>
            </details>
            {message && <p role="status">{message}</p>}
            <div className="obs-source-guide">
              <h4>{zh ? 'OBS 浏览器源布局' : 'OBS Browser Source layout'}</h4>
              <p>
                {zh
                  ? '以下为建议源路径，均保持 1920×1080 透明画布。将 HUD 置于游戏捕获上层；比分条宽度在「局内 HUD」中调整。'
                  : 'Suggested overlay paths use a 1920×1080 transparent canvas. Place the HUD above game capture and adjust its width in Live HUD.'}
              </p>
              <div>
                <code>/overlay/draft</code>
                <span>{zh ? 'BP 选禁图形' : 'Draft overlay'}</span>
              </div>
              <div>
                <code>/overlay/game-hud</code>
                <span>{zh ? '局内比分 HUD' : 'Game HUD'}</span>
              </div>
              <div>
                <code>/overlay/mvp</code>
                <span>{zh ? '赛后 MVP' : 'MVP overlay'}</span>
              </div>
              <div>
                <code>/overlay/game-progress</code>
                <span>{zh ? '经济时间线' : 'Game progress'}</span>
              </div>
              <p className="muted">
                {zh
                  ? '画面联动只切换已映射的 OBS 场景；不会自动添加、删除或修改 OBS 来源。'
                  : 'Scene cues do not create, delete or modify OBS sources.'}
              </p>
              <div className="obs-layout-audit" data-testid="obs-layout-audit">
                <button
                  type="button"
                  disabled={!status?.connected || !selected || layoutBusy}
                  onClick={() => void inspectLayout()}
                >
                  {layoutBusy
                    ? zh
                      ? '检查中…'
                      : 'Inspecting…'
                    : zh
                      ? '检查所选场景的浏览器源布局'
                      : 'Inspect selected scene layout'}
                </button>
                {layoutError && <p role="alert">{layoutError}</p>}
                {layout?.scene === selected && (
                  <div role="status">
                    {layout.sources.length === 0 ? (
                      <p>
                        {zh
                          ? '此场景未发现可检查的 OBS 浏览器源。'
                          : 'No inspectable Browser Sources found in this scene.'}
                      </p>
                    ) : (
                      layout.sources.map((source, i) => (
                        <div key={`${source.name}:${i}`}>
                          <strong>{source.name}</strong>
                          <span>
                            {source.width ?? '?'} × {source.height ?? '?'} ·{' '}
                            {source.enabled
                              ? zh
                                ? '已启用'
                                : 'Enabled'
                              : zh
                                ? '已隐藏'
                                : 'Hidden'}
                          </span>
                          {(source.width !== 1920 || source.height !== 1080) && (
                            <small>
                              {zh
                                ? '请核对设计分辨率（建议 1920×1080）'
                                : 'Check source canvas size (recommended 1920×1080)'}
                            </small>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
        {status?.connected && (
          <div className="obs-audio-mixer obs-workspace-card" data-testid="obs-audio-mixer">
            <h4>{zh ? 'OBS 音频淡入淡出' : 'OBS audio fades'}</h4>
            <div className="toolbar">
              <label>
                {zh ? '音频源' : 'Audio input'}{' '}
                <select
                  aria-label="OBS audio input"
                  value={audioName}
                  disabled={audioBusy}
                  onChange={(e) => {
                    const input = audioInputs.find((item) => item.name === e.target.value);
                    setAudioName(e.target.value);
                    if (input) setTargetVolume(Math.round(input.volume * 100));
                  }}
                >
                  {audioInputs.map((input) => (
                    <option key={input.name} value={input.name}>
                      {input.name}
                    </option>
                  ))}
                </select>
              </label>
              <span>
                {zh ? '当前音量' : 'Current'}：
                {audioInputs.find((input) => input.name === audioName)
                  ? Math.round(
                      audioInputs.find((input) => input.name === audioName)!.volume * 100,
                    ) + '%'
                  : '—'}
              </span>
              <button type="button" disabled={audioBusy} onClick={() => void refreshAudio()}>
                {zh ? '刷新音频源' : 'Refresh inputs'}
              </button>
            </div>
            {audioInputs.length === 0 ? (
              <p className="muted">
                {zh
                  ? '未找到可控制音量的 OBS 音频源。请在 OBS 混音器确认来源，并刷新。'
                  : 'No audio-capable OBS inputs found. Check the OBS audio mixer and refresh.'}
              </p>
            ) : (
              <>
                <div className="toolbar">
                  <label htmlFor="obs-target-volume">
                    {zh ? '淡入目标音量' : 'Fade-in target'}：{targetVolume}%
                  </label>
                  <input
                    id="obs-target-volume"
                    aria-label="OBS target volume"
                    type="range"
                    min={0}
                    max={200}
                    step={5}
                    value={targetVolume}
                    onChange={(e) => setTargetVolume(Number(e.target.value))}
                  />
                  <label>
                    {zh ? '渐变时长' : 'Fade duration'}{' '}
                    <select
                      aria-label="OBS fade duration"
                      value={fadeMs}
                      onChange={(e) => setFadeMs(Number(e.target.value))}
                    >
                      <option value={0}>{zh ? '立即' : 'Instant'}</option>
                      <option value={1000}>1s</option>
                      <option value={3000}>3s</option>
                      <option value={5000}>5s</option>
                    </select>
                  </label>
                </div>
                <div className="toolbar">
                  <button type="button" disabled={audioBusy} onClick={() => void fadeAudio(0)}>
                    {zh ? '淡出至静音' : 'Fade out to silence'}
                  </button>
                  <button
                    type="button"
                    disabled={audioBusy}
                    onClick={() => void fadeAudio(targetVolume)}
                  >
                    {zh ? '淡入至目标音量' : 'Fade to target volume'}
                  </button>
                  <button
                    type="button"
                    disabled={!audioBusy}
                    onClick={() => void fadeAudio(targetVolume)}
                  >
                    中断旧渐变并应用当前目标
                  </button>
                </div>
                <div className="toolbar">
                  <label>
                    交叉淡化至持久音源
                    <select value={crossfadeTo} onChange={(e) => setCrossfadeTo(e.target.value)}>
                      <option value="">请选择另一个 BGM</option>
                      {audioInputs
                        .filter((i) => i.name !== audioName)
                        .map((i) => (
                          <option key={i.name} value={i.name}>
                            {i.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={!crossfadeTo || audioBusy}
                    onClick={() => {
                      setAudioBusy(true);
                      setAudioError('');
                      void fetch(`${apiURL}/api/v1/obs/crossfade`, {
                        method: 'POST',
                        headers: {
                          Authorization: `Bearer ${token}`,
                          'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                          from: audioName,
                          to: crossfadeTo,
                          targetVolume: targetVolume / 100,
                          durationMs: fadeMs,
                        }),
                        signal: AbortSignal.timeout(fadeMs + 15000),
                      })
                        .then(async (r) => {
                          const data = await r.json();
                          if (!r.ok) throw Error(data.error);
                          await refreshAudio();
                        })
                        .catch((e) => setAudioError(String(e)))
                        .finally(() => setAudioBusy(false));
                    }}
                  >
                    交叉淡化
                  </button>
                </div>
                <p className="muted">
                  跨场景持续播放要求这些音源在 OBS
                  中持续存在，并在相关场景引用同一源；媒体源应关闭切换时重新播放 /
                  隐藏时关闭。只控制所选 BGM，不处理游戏或解说音源。
                </p>
                <p className="muted">
                  {zh
                    ? '只调整所选音频源音量；可中断旧渐变并从当前实际音量接续。'
                    : 'Only adjusts the selected input volume. Recording and streaming remain unchanged; fade-out does not toggle OBS mute.'}
                </p>
              </>
            )}
            {audioError && <p role="alert">{audioError}</p>}
          </div>
        )}
        <p className="muted">
          {zh
            ? '默认手动执行；自动模式仅在本次会话明确授权后按阶段变化执行。音频为手动渐变；磁盘容量预警尚未实现。'
            : 'Manual by default. Session-authorized automation follows stage changes. Audio fades are manual; disk alerts are not implemented.'}
        </p>
      </div>
    </details>
  );
}
