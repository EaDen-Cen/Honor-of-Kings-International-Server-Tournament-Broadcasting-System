import { useCallback, useEffect, useRef, useState } from 'react';
import { CaptureRequest } from './captureRequest';
import type { Action, MatchState } from '../shared/types';
import {
  liveGameContext,
  trustedLiveUpdates,
  liveHudReviewStates,
  liveFieldHealth,
  type LiveHudSample,
  type LiveHudReviewState,
} from '../shared/liveGame';
import {
  liveCaptureLabel,
  liveCaptureKeys,
  liveCaptureRects,
  validLiveCaptureRects,
  type LiveCaptureKey,
  type CaptureRect,
} from '../shared/gameCapture';
import { LiveHudCalibration } from './LiveHudCalibration';
import './liveHudCalibration.css';
import { useGameDataCapture } from './useGameDataCapture';
import { captureHudImages } from './hudCapture';
import { useAdbHudCapture } from './useAdbHudCapture';
import { loadHudCalibration, saveHudCalibration } from './hudCalibrationProfiles';
import { NeutralHudCalibration } from './NeutralHudCalibration';
import { trustedNeutralUpdates, type NeutralRegion } from '../shared/neutralRecognition';
import { pixelRect } from '../shared/gameCapture';

interface Result extends LiveHudSample {
  context: string;
  elapsedMs: number;
}
export function LiveHudCapturePanel({
  state,
  zh,
  token,
  disabled,
  send,
}: {
  state: MatchState;
  zh: boolean;
  token: string;
  disabled: boolean;
  send: (action: Action) => void;
}) {
  const [captureMode, setCaptureMode] = useState<'window' | 'adb'>('window');
  const windowCapture = useGameDataCapture(zh);
  const adbCapture = useAdbHudCapture(zh, token, captureMode === 'adb');
  const capture = captureMode === 'adb' ? adbCapture : windowCapture;
  const sourceVersion = `${captureMode}:${capture.sourceVersion}`;
  const [neutralRegions, setNeutralRegions] = useState<NeutralRegion[]>([]),
    [neutralApproved, setNeutralApproved] = useState(false);
  const objectiveIdentity = JSON.stringify(
    state.liveGameStats.neutralObjectives.map((o) => [o.id, o.name]),
  );
  const [regions, setRegions] = useState<Record<LiveCaptureKey, CaptureRect>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('hok-ghud-calibration-v1') || 'null');
      return validLiveCaptureRects(saved) ? saved : structuredClone(liveCaptureRects);
    } catch {
      return structuredClone(liveCaptureRects);
    }
  });
  const [calibrated, setCalibrated] = useState(false),
    [preview, setPreview] = useState(''),
    [calibrationField, setCalibrationField] = useState<LiveCaptureKey>('gameTimeSeconds');
  const [result, setResult] = useState<Result>(),
    [previous, setPrevious] = useState<Result>(),
    [auto, setAuto] = useState(false),
    [publish, setPublish] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const context = liveGameContext(state),
    signature = useRef(''),
    last = useRef<Result>(),
    running = useRef(false),
    epoch = useRef(0),
    stateRef = useRef(state);
  const pending = useRef(new CaptureRequest());
  const [elapsedMs, setElapsedMs] = useState<number>();
  const [now, setNow] = useState(Date.now);
  const [captureFailed, setCaptureFailed] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const cancelCapture = useCallback(() => {
    epoch.current++;
    pending.current.cancel();
    running.current = false;
    setBusy(false);
  }, []);
  stateRef.current = state;
  signature.current = JSON.stringify([
    context,
    captureMode,
    capture.calibrationKey,
    capture.generation.current,
    disabled,
    token,
  ]);
  useEffect(() => {
    cancelCapture();
    last.current = undefined;
    setResult(undefined);
    setPrevious(undefined);
    setAuto(false);
    setPublish(false);
  }, [context, token, cancelCapture]);
  // A pending match write briefly disables controls after each OCR publish.
  // Abort in-flight reads, but keep the last accepted frame: otherwise every
  // automatic publish restarts the two-frame verifier at "first read".
  // Context, token, calibration and capture-source changes still reset evidence.
  useEffect(() => {
    if (disabled) cancelCapture();
  }, [disabled, cancelCapture]);
  const manualSources = JSON.stringify([
    Object.entries(state.liveGameStats.sources ?? {}).filter(
      ([, source]) => source.source === 'manual',
    ),
    state.liveGameStats.neutralObjectives.map((o) => [o.id, o.countEpoch, o.countFrozen]),
  ]);
  useEffect(() => {
    // An operator edit requires fresh evidence; ordinary OCR acknowledgements do not.
    cancelCapture();
    last.current = undefined;
    setPrevious(undefined);
    setResult(undefined);
  }, [manualSources, cancelCapture]);
  function editRegions(next: Record<LiveCaptureKey, CaptureRect>) {
    cancelCapture();
    last.current = undefined;
    setPrevious(undefined);
    setResult(undefined);
    setAuto(false);
    setPublish(false);
    setCalibrated(false);
    setRegions(next);
  }
  function confirmRegions() {
    if (!validLiveCaptureRects(regions)) {
      setMessage(
        zh ? '选框无效：检查七项不重叠、位置在画面内。' : 'Invalid seven-region calibration',
      );
      return;
    }
    try {
      saveHudCalibration(localStorage, capture.calibrationKey, regions);
    } catch {
      /* Calibration remains valid for this source without browser storage. */
    }
    cancelCapture();
    last.current = undefined;
    setPrevious(undefined);
    setResult(undefined);
    setAuto(false);
    setPublish(false);
    setCalibrated(true);
    setMessage(
      zh
        ? '采集位置已确认，请先手动采样两次核对 OCR。'
        : 'Calibration saved. Review two OCR readings manually before enabling automation.',
    );
  }
  useEffect(() => {
    const request = pending.current;
    return () => {
      request.cancel();
    };
  }, []);
  async function sample() {
    if (running.current || disabled || !calibrated) return;
    running.current = true;
    setBusy(true);
    const version = epoch.current,
      current = signature.current,
      source = capture.generation.current,
      request = pending.current.start(10000);
    const started = performance.now();
    try {
      const canvas = await capture.frame(request.signal);
      if (
        !request.isCurrent() ||
        version !== epoch.current ||
        source !== capture.generation.current
      )
        return;
      const images = captureHudImages(canvas, regions);
      const neutral =
        neutralApproved && neutralRegions.length
          ? {
              regions: neutralRegions,
              images: neutralRegions.map(({ region }) => {
                const r = pixelRect(region, canvas.width, canvas.height),
                  cropped = document.createElement('canvas');
                cropped.width = r.width;
                cropped.height = r.height;
                cropped
                  .getContext('2d')!
                  .drawImage(canvas, r.left, r.top, r.width, r.height, 0, 0, r.width, r.height);
                return cropped.toDataURL('image/png');
              }),
            }
          : undefined;
      const response = await fetch(
        `${(import.meta.env.VITE_API_URL || '').replace(/\/$/, '')}/api/v1/recognition/live-hud`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            images,
            context,
            regions,
            source: capture.calibrationKey,
            neutral,
          }),
          signal: request.signal,
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (
        !request.isCurrent() ||
        request.signal.aborted ||
        version !== epoch.current ||
        current !== signature.current ||
        source !== capture.generation.current
      )
        return;
      const next = data as Result,
        previousFrame = last.current,
        // A long disconnect needs two fresh observations rather than
        // comparing an old frame with a newly resumed feed.
        prior =
          previousFrame && next.capturedAt - previousFrame.capturedAt <= 15000
            ? previousFrame
            : undefined;
      setElapsedMs(Math.round(performance.now() - started));
      setCaptureFailed(false);
      setPrevious(prior);
      setResult(next);
      last.current = next;
      const updates = prior ? trustedLiveUpdates(stateRef.current.liveGameStats, prior, next) : {};
      const neutralUpdates =
        prior?.neutral && next.neutral
          ? trustedNeutralUpdates(stateRef.current.liveGameStats, prior.neutral, next.neutral)
          : [];
      if (
        publish &&
        calibrated &&
        !capture.isStill &&
        prior &&
        (Object.keys(updates).length || neutralUpdates.length)
      )
        send({ type: 'live_game_ocr', context, previous: prior, sample: next });
      setMessage(
        !prior
          ? zh
            ? '首帧仅作候选，请再次采样以核验。'
            : 'First read is a candidate; sample again to verify.'
          : Object.keys(updates).length
            ? zh
              ? '已验证部分字段；异常跳变、低置信度和人工冻结的字段保留原值。'
              : 'Some fields verified; implausible, weak and manually frozen fields are preserved.'
            : zh
              ? '两帧尚未通过核验：请查看字段原因。静态截图或暂停画面不会产生有效的时间递进。'
              : 'Two reads did not pass verification. Check each field; a still image or paused clock is not live evidence.',
      );
    } catch (e) {
      if (
        request.isCurrent() &&
        version === epoch.current &&
        current === signature.current &&
        source === capture.generation.current
      ) {
        last.current = undefined;
        setPrevious(undefined);
        setCaptureFailed(true);
        setMessage(
          request.signal.reason instanceof Error
            ? request.signal.reason.message
            : e instanceof Error
              ? e.message
              : 'Capture failed',
        );
      }
    } finally {
      if (request.finish()) {
        running.current = false;
        setBusy(false);
      }
    }
  }
  const sampleRef = useRef(sample);
  sampleRef.current = sample;
  useEffect(() => {
    cancelCapture();
    last.current = undefined;
    setPrevious(undefined);
    setResult(undefined);
    setAuto(false);
    setPublish(false);
    setCalibrated(false);
    setPreview('');
    try {
      setRegions(loadHudCalibration(localStorage, capture.calibrationKey));
    } catch {
      setRegions(structuredClone(liveCaptureRects));
    }
  }, [sourceVersion, capture.calibrationKey, cancelCapture]);
  useEffect(() => {
    setNeutralApproved(false);
    setNeutralRegions([]);
    cancelCapture();
    last.current = undefined;
    setPrevious(undefined);
    setResult(undefined);
  }, [sourceVersion, capture.calibrationKey, objectiveIdentity, cancelCapture]);
  useEffect(() => {
    if (!auto || !calibrated || disabled || !capture.ready || capture.isStill) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      const started = performance.now();
      await sampleRef.current();
      // A slow real frame should not miss the next whole interval. Maintain
      // the one-second target without overlapping or queuing stale frames.
      if (active)
        timer = setTimeout(() => void run(), Math.max(50, 1000 - (performance.now() - started)));
    };
    void run();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [auto, calibrated, disabled, capture.ready, capture.isStill]);
  const updates =
    result && previous ? trustedLiveUpdates(state.liveGameStats, previous, result) : {};
  const neutralUpdates =
    previous?.neutral && result?.neutral
      ? trustedNeutralUpdates(state.liveGameStats, previous.neutral, result.neutral)
      : [];
  const review = result ? liveHudReviewStates(state.liveGameStats, previous, result) : undefined;
  const reviewLabel: Record<LiveHudReviewState, string> = zh
    ? {
        'first-read': '首帧候选 · 等待第二次采样',
        published: '已核验并同步到赛事数据',
        manual: '人工冻结 · 保留手动值',
        obscured: '区域无有效内容 / 疑似遮挡 · 保留原值',
        'low-confidence': '低置信度 / OCR 无有效数值（需 ≥85%）',
        'clock-stalled': '游戏计时未前进 · 截图或暂停画面',
        verified: '两帧一致 · 可以应用',
        rejected: '尚未通过核验 · 保留原值',
      }
    : {
        'first-read': 'First read · waiting for another',
        published: 'Verified and published to match data',
        manual: 'Manually frozen · value preserved',
        obscured: 'Blank / possibly obscured region · value preserved',
        'low-confidence': 'Low confidence / unreadable OCR (requires ≥85%)',
        'clock-stalled': 'Game clock did not advance · still frame',
        verified: 'Verified in two reads · ready to apply',
        rejected: 'Not yet verified · value preserved',
      };
  return (
    <details id="live-hud-workspace" className="panel">
      <summary>
        {zh ? 'GHUD 顶栏识别 · Experimental' : 'GHUD top bar recognition · Experimental'}
      </summary>
      <p className="muted">
        {zh
          ? '每秒尝试读取游戏时间、双方人头、经济与推塔（识别未完成时跳过，不重叠请求）。先采样两次核验，再应用或开启自动播出。人工改值会冻结对应字段。断流时保留最后可信值；截图仅用于审核。'
          : 'Attempts to read time, kills, gold and towers once per second (skipping overlapping requests). Verify two reads before applying or enabling automatic output. Manual edits freeze fields. Lost capture retains trusted values; screenshots are for review.'}
      </p>
      <label>
        {zh ? 'GHUD 采集来源' : 'GHUD capture source'}
        <select
          aria-label="GHUD capture source"
          value={captureMode}
          onChange={(e) => {
            cancelCapture();
            setCaptureMode(e.target.value as 'window' | 'adb');
          }}
        >
          <option value="window">
            {zh ? 'Windows 窗口 / 静态截图' : 'Windows window / static screenshot'}
          </option>
          <option value="adb">Android ADB · LDPlayer</option>
        </select>
      </label>
      <div hidden={captureMode !== 'window'}>{windowCapture.controls}</div>
      <div hidden={captureMode !== 'adb'}>{adbCapture.controls}</div>
      <ul aria-label={zh ? '可信字段状态' : 'Trusted field status'}>
        {liveCaptureKeys.map((key) => {
          const source = state.liveGameStats.sources?.[key];
          const health = liveFieldHealth(source, now, captureFailed || !capture.ready);
          const labels = zh
            ? {
                manual: '人工确认 / 已冻结',
                'capture-failed': '采集失败 · 保留最后可信值',
                unverified: '尚无可信采样',
                stale: '数据过期 · 保留最后可信值',
                automatic: '自动识别',
              }
            : {
                manual: 'Manually confirmed / frozen',
                'capture-failed': 'Capture failed · trusted value retained',
                unverified: 'No trusted sample',
                stale: 'Stale · trusted value retained',
                automatic: 'Automatic recognition',
              };
          return (
            <li key={key} data-field={key} data-health={health}>
              {liveCaptureLabel(key, zh)}: {labels[health]}
              {source && ` · ${new Date(source.capturedAt).toLocaleTimeString()}`}
            </li>
          );
        })}
      </ul>
      <LiveHudCalibration
        zh={zh}
        regions={regions}
        onRegionsChange={editRegions}
        selected={calibrationField}
        onSelectedChange={setCalibrationField}
        preview={preview}
        onPreview={async () => {
          if (running.current) return;
          const version = epoch.current,
            current = signature.current;
          running.current = true;
          setBusy(true);
          const request = pending.current.start(15000);
          try {
            const canvas = await capture.frame(request.signal);
            if (!request.isCurrent() || version !== epoch.current || current !== signature.current)
              return;
            setPreview(canvas.toDataURL('image/jpeg', 0.88));
            setMessage('');
          } catch (e) {
            if (request.isCurrent())
              setMessage(e instanceof Error ? e.message : 'Capture not ready');
          } finally {
            if (request.finish()) {
              running.current = false;
              setBusy(false);
            }
          }
        }}
        ready={capture.ready && !busy}
        onConfirm={confirmRegions}
        calibrated={calibrated}
      />
      <div className="toolbar">
        <button
          disabled={disabled || busy || !capture.ready || !calibrated}
          onClick={() => void sample()}
        >
          {busy ? (zh ? '采样中…' : 'Sampling…') : zh ? '采样 GHUD' : 'Sample GHUD'}
        </button>
        <label>
          <input
            type="checkbox"
            checked={auto}
            disabled={disabled || !calibrated || capture.isStill}
            onChange={(e) => {
              cancelCapture();
              setAuto(e.target.checked);
              if (!e.target.checked) setPublish(false);
            }}
          />
          {zh
            ? '每秒尝试采样（上一帧未完成则跳过）'
            : 'Try every second (skip if prior read is busy)'}
        </label>
        <label>
          <input
            type="checkbox"
            checked={publish}
            disabled={disabled || !calibrated || !auto || capture.isStill}
            onChange={(e) => {
              cancelCapture();
              setPublish(e.target.checked);
            }}
          />
          {zh ? '自动播出两帧核验字段' : 'Publish fields verified by two reads'}
        </label>
        <button
          disabled={
            disabled ||
            !calibrated ||
            capture.isStill ||
            !result ||
            now - result.capturedAt > 15000 ||
            (!Object.keys(updates).length && !neutralUpdates.length)
          }
          onClick={() => {
            if (previous && result)
              send({ type: 'live_game_ocr', context, previous, sample: result });
          }}
        >
          {zh ? '应用已核验字段' : 'Apply verified fields'}
        </button>
      </div>
      <NeutralHudCalibration
        zh={zh}
        objectives={state.liveGameStats.neutralObjectives}
        preview={preview}
        regions={neutralRegions}
        approved={neutralApproved}
        onChange={(value) => {
          cancelCapture();
          last.current = undefined;
          setPrevious(undefined);
          setResult(undefined);
          setNeutralApproved(false);
          setNeutralRegions(value);
        }}
        onApprove={() => {
          cancelCapture();
          last.current = undefined;
          setPrevious(undefined);
          setResult(undefined);
          setNeutralApproved(true);
        }}
      />
      {result?.neutral && (
        <ul aria-label="Objective OCR candidates">
          {result.neutral.candidates.map((c) => (
            <li key={`${c.id}:${c.side}`}>
              {state.liveGameStats.neutralObjectives.find((o) => o.id === c.id)?.name} ·{' '}
              {c.side === 'blue' ? (zh ? '蓝方' : 'Blue') : zh ? '红方' : 'Red'}: {c.value ?? '—'} ·{' '}
              {Math.round(c.confidence * 100)}%{' · '}
              {neutralUpdates.some((v) => v.id === c.id && v.side === c.side)
                ? zh
                  ? '两帧核验通过'
                  : 'Verified in two reads'
                : zh
                  ? '待核验或已冻结 · 保留可信值'
                  : 'Pending verification or frozen · trusted value retained'}
            </li>
          ))}
        </ul>
      )}
      {result && (
        <div className="post-game-table">
          {result.candidates.map((c) => (
            <div className="toolbar" key={c.key}>
              <b>{liveCaptureLabel(c.key, zh)}</b>
              <span>
                {c.value ?? '—'} · {Math.round(c.confidence * 100)}% · OCR: {c.text || '—'}
              </span>
              <small
                className={
                  review?.[c.key] === 'verified' || review?.[c.key] === 'published' ? '' : 'error'
                }
              >
                {review ? reviewLabel[review[c.key]] : ''}
              </small>
            </div>
          ))}
        </div>
      )}
      <p role="status">{message}</p>
      {elapsedMs !== undefined && (
        <small aria-label="HUD recognition time">
          {zh ? '本次采样（含采集与传输）' : 'Latest sample including capture and transport'}:{' '}
          {elapsedMs} ms
        </small>
      )}
    </details>
  );
}
