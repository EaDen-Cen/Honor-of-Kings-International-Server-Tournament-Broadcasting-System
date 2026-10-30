import { useCallback, useEffect, useRef, useState } from 'react';
import { CaptureRequest } from './captureRequest';
import type { Action, MatchState } from '../shared/types';
import { liveGameContext, trustedLiveUpdates, liveHudReviewStates, type LiveHudSample, type LiveHudReviewState } from '../shared/liveGame';
import {
  liveCaptureLabel,
  liveCaptureRects,
  validLiveCaptureRects,
  type LiveCaptureKey,
  type CaptureRect,
} from '../shared/gameCapture';
import { LiveHudCalibration } from './LiveHudCalibration';
import './liveHudCalibration.css';
import { useGameDataCapture } from './useGameDataCapture';
import { captureHudImages } from './hudCapture';

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
  const capture = useGameDataCapture(zh);
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
  const cancelCapture = useCallback(() => {
    epoch.current++;
    pending.current.cancel();
    running.current = false;
    setBusy(false);
  }, []);
  stateRef.current = state;
  signature.current = JSON.stringify([context, capture.generation.current, disabled, token]);
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
      localStorage.setItem('hok-ghud-calibration-v1', JSON.stringify(regions));
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
      const canvas = capture.frame();
      const images = captureHudImages(canvas, regions);
      const response = await fetch(
        `${(import.meta.env.VITE_API_URL || '').replace(/\/$/, '')}/api/v1/recognition/live-hud`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ images, context, regions }),
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
      setPrevious(prior);
      setResult(next);
      last.current = next;
      const updates = prior ? trustedLiveUpdates(stateRef.current.liveGameStats, prior, next) : {};
      if (publish && calibrated && !capture.isStill && prior && Object.keys(updates).length)
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
  }, [capture.sourceVersion, cancelCapture]);
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
  const review = result ? liveHudReviewStates(state.liveGameStats, previous, result) : undefined;
  const reviewLabel: Record<LiveHudReviewState, string> = zh
    ? {
        'first-read': '首帧候选 · 等待第二次采样',
        published: '已核验并同步到赛事数据',
        manual: '人工冻结 · 保留手动值',
        'low-confidence': '低置信度 / OCR 无有效数值（需 ≥85%）',
        'clock-stalled': '游戏计时未前进 · 截图或暂停画面',
        verified: '两帧一致 · 可以应用',
        rejected: '尚未通过核验 · 保留原值',
      }
    : {
        'first-read': 'First read · waiting for another',
        published: 'Verified and published to match data',
        manual: 'Manually frozen · value preserved',
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
      {capture.controls}
      <LiveHudCalibration
        zh={zh}
        regions={regions}
        onRegionsChange={editRegions}
        selected={calibrationField}
        onSelectedChange={setCalibrationField}
        preview={preview}
        onPreview={() => {
          try {
            setPreview(capture.frame().toDataURL('image/jpeg', 0.88));
            setMessage('');
          } catch (e) {
            setMessage(e instanceof Error ? e.message : 'Capture not ready');
          }
        }}
        ready={capture.ready}
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
          disabled={disabled || !calibrated || capture.isStill || !Object.keys(updates).length}
          onClick={() => {
            if (previous && result)
              send({ type: 'live_game_ocr', context, previous, sample: result });
          }}
        >
          {zh ? '应用已核验字段' : 'Apply verified fields'}
        </button>
      </div>
      {result && (
        <div className="post-game-table">
          {result.candidates.map((c) => (
            <div className="toolbar" key={c.key}>
              <b>{liveCaptureLabel(c.key, zh)}</b>
              <span>
                {c.value ?? '—'} · {Math.round(c.confidence * 100)}% · OCR: {c.text || '—'}
              </span>
              <small className={review?.[c.key] === 'verified' || review?.[c.key] === 'published' ? '' : 'error'}>
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
