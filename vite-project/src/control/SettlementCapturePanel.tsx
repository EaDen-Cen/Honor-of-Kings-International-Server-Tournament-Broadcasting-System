import { useCallback, useEffect, useRef, useState } from 'react';
import { CaptureRequest } from './captureRequest';
import type { Action, Side } from '../shared/types';
import { portraitAssetURL } from '../shared/config';
import {
  canMergePostGameField,
  formatPostGameValue,
  postGameDecimalMetrics,
  postGamePercentMetrics,
  postGameGrades,
  postGameMetricLabel,
  postGameTeamMetricLabel,
  type PostGameGradeField,
  type PostGameMetric,
  type PostGamePage,
  type PostGameReport,
  type PostGameTeamMetric,
} from '../shared/postGame';
import {
  settlementPages,
  settlementPageLabel,
  settlementPageMetrics,
  type NumericCandidate,
} from '../shared/gameCapture';
import {
  mergeSettlementIdentityMapping,
  defaultSettlementIdentityMapping,
} from '../shared/settlementIdentity';
import {
  frameDifference,
  frameFingerprint,
  framePageHint,
  useGameDataCapture,
} from './useGameDataCapture';
import { hasPostGameFieldUpdate } from './postGameUpdates';
import { ManualNumberInput } from './ManualNumberInput';
import './settlementCapture.css';
import type { GoldDifferencePoint } from '../shared/postGameTimeline';
import { EconomyAdvantageChart } from '../overlay/EconomyAdvantageChart';

interface SettlementResult {
  page: PostGamePage;
  reportId: string;
  capturedAt: number;
  evidence: string;
  elapsedMs: number;
  leftSide?: Side;
  rows: Array<{
    screenRow: number;
    text: string;
    rowId: string | null;
    suggestedRowId: string | null;
  }>;
  candidates: Array<
    NumericCandidate & { screenRow: number; metric: PostGameMetric; resolution?: number }
  >;
  grades?: Array<{
    screenRow: number;
    value: PostGameGradeField['value'] | null;
    confidence: number;
    text: string;
  }>;
  gradeWarning?: string;
  teamCandidates?: Array<NumericCandidate & { side: 'left' | 'right'; metric: PostGameTeamMetric }>;
  goldCurve?: {
    points: GoldDifferencePoint[];
    maxDifference: number;
    durationSeconds?: number;
    confidence: number;
    error?: string;
    warning?: string;
  };
}
function readMapping(reportId: string) {
  try {
    const value = JSON.parse(localStorage.getItem('hok-settlement-mapping-v1:' + reportId) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}
function readLeftSide(reportId: string): Side {
  try {
    return localStorage.getItem('hok-settlement-left-side-v1:' + reportId) === 'red'
      ? 'red'
      : 'blue';
  } catch {
    return 'blue';
  }
}
export function SettlementCapturePanel({
  report,
  zh,
  token,
  disabled,
  send,
}: {
  report: PostGameReport;
  zh: boolean;
  token: string;
  disabled: boolean;
  send: (action: Action) => void;
}) {
  const capture = useGameDataCapture(zh),
    [page, setPage] = useState<PostGamePage | 'auto'>('auto'),
    [results, setResults] = useState<Partial<Record<PostGamePage, SettlementResult>>>({}),
    [selected, setSelected] = useState<PostGamePage>('overview');
  const [mapping, setMapping] = useState<Record<string, string>>(() =>
      defaultSettlementIdentityMapping(
        report.players,
        readLeftSide(report.id),
        readMapping(report.id),
      ),
    ),
    [busy, setBusy] = useState(false),
    [auto, setAuto] = useState(false),
    [message, setMessage] = useState('');
  const [recapLeft, setRecapLeft] = useState<Side | ''>('');
  const [leftSide, setLeftSide] = useState<Side>(() => readLeftSide(report.id));
  const active = useRef(''),
    running = useRef(false),
    epoch = useRef(0);
  const pending = useRef(new CaptureRequest());
  const cancelCapture = useCallback(() => {
    epoch.current++;
    pending.current.cancel();
    running.current = false;
    setBusy(false);
  }, []);
  // Reset identity review on report changes, not on each field update/ACK.
  // The ref supplies the new report roster without discarding an active review.
  const identityPlayers = useRef(report.players);
  identityPlayers.current = report.players;
  active.current = JSON.stringify([
    report.id,
    page,
    leftSide,
    capture.generation.current,
    disabled,
    token,
  ]);
  useEffect(() => {
    setResults({});
    setMapping(
      defaultSettlementIdentityMapping(
        identityPlayers.current,
        readLeftSide(report.id),
        readMapping(report.id),
      ),
    );
    setLeftSide(readLeftSide(report.id));
    setRecapLeft('');
    setAuto(false);
    cancelCapture();
  }, [report.id, cancelCapture]);
  useEffect(() => {
    cancelCapture();
  }, [page, leftSide, capture.sourceVersion, disabled, token, cancelCapture]);
  useEffect(() => {
    try {
      localStorage.setItem('hok-settlement-mapping-v1:' + report.id, JSON.stringify(mapping));
    } catch {
      /* Retain in-memory review. */
    }
  }, [report.id, mapping]);
  useEffect(() => {
    try {
      localStorage.setItem('hok-settlement-left-side-v1:' + report.id, leftSide);
    } catch {
      /* Retain in-memory direction. */
    }
  }, [report.id, leftSide]);
  function changeLeftSide(next: Side) {
    if (next === leftSide) return;
    cancelCapture();
    setLeftSide(next);
    // Existing numbers describe the old screen direction. Keep the draft for
    // review, but never approve its identities automatically for the new side.
    setMapping({});
    setAuto(false);
    setResults((old) => {
      const drafts = { ...old };
      for (const key of settlementPages) {
        const draft = drafts[key];
        if (draft && draft.page !== 'recap')
          drafts[key] = {
            ...draft,
            leftSide: next,
            rows: draft.rows.map((row) => ({ ...row, rowId: null, suggestedRowId: null })),
          };
      }
      return drafts;
    });
    setMessage(
      zh
        ? '已切换十人页左侧队伍，数字草稿保留；请重新确认十位选手对应关系。'
        : 'Player-page left team changed. Numerical drafts are retained; confirm all ten player bindings again.',
    );
  }
  useEffect(() => {
    const request = pending.current;
    return () => {
      request.cancel();
    };
  }, []);
  async function recognize(canvas: HTMLCanvasElement) {
    if (running.current || disabled) return false;
    running.current = true;
    setBusy(true);
    const signature = active.current,
      version = epoch.current,
      source = capture.generation.current,
      request = pending.current.start(30000);
    try {
      const response = await fetch(
        `${(import.meta.env.VITE_API_URL || '').replace(/\/$/, '')}/api/v1/recognition/settlement`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: canvas.toDataURL('image/jpeg', 0.94),
            reportId: report.id,
            page,
            leftSide,
          }),
          signal: request.signal,
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (
        !request.isCurrent() ||
        request.signal.aborted ||
        active.current !== signature ||
        epoch.current !== version ||
        source !== capture.generation.current
      )
        return false;
      const data = result as SettlementResult;
      if (data.leftSide && data.leftSide !== leftSide)
        throw new Error(
          zh
            ? '识别队伍方向不符，请重新采集。'
            : 'Recognized team direction differs; capture again.',
        );
      setResults((old) => ({ ...old, [data.page]: data }));
      setSelected(data.page);
      setMapping((old) => mergeSettlementIdentityMapping(old, data.rows));
      setMessage(
        zh
          ? `已采集${settlementPageLabel(data.page, true)}页；请核对身份及数字后应用。`
          : `Captured ${data.page}; review identities and values before applying.`,
      );
      return true;
    } catch (e) {
      if (
        request.isCurrent() &&
        epoch.current === version &&
        active.current === signature &&
        source === capture.generation.current
      )
        setMessage(
          request.signal.reason instanceof Error
            ? request.signal.reason.message
            : e instanceof Error
              ? e.message
              : 'Capture failed',
        );
      return false;
    } finally {
      if (request.finish()) {
        running.current = false;
        setBusy(false);
      }
    }
  }
  const recognizeRef = useRef(recognize);
  recognizeRef.current = recognize;
  const captureRef = useRef(capture);
  captureRef.current = capture;
  useEffect(() => {
    if (!auto || !capture.ready || capture.isStill || disabled) return;
    let previous: Uint8ClampedArray | undefined,
      submitted: Uint8ClampedArray | undefined,
      count = 0,
      source = captureRef.current.generation.current,
      tab = -1,
      submittedTab = -1,
      lastAttempt = 0;
    const timer = window.setInterval(() => {
      if (running.current) return;
      if (source !== captureRef.current.generation.current) {
        source = captureRef.current.generation.current;
        previous = undefined;
        submitted = undefined;
        count = 0;
      }
      try {
        const frame = captureRef.current.frame(),
          fingerprint = frameFingerprint(frame),
          hint = framePageHint(frame);
        count =
          previous && tab === hint && frameDifference(previous, fingerprint) < 1.5 ? count + 1 : 0;
        previous = fingerprint;
        tab = hint;
        if (
          count >= 2 &&
          Date.now() - lastAttempt > 5000 &&
          (!submitted || submittedTab !== hint || frameDifference(submitted, fingerprint) > 3)
        ) {
          lastAttempt = Date.now();
          void recognizeRef.current(frame).then((ok) => {
            if (ok) {
              submitted = fingerprint;
              submittedTab = hint;
            }
          });
        }
      } catch {
        setAuto(false);
        setMessage(zh ? '采集已停止，请重新选择窗口。' : 'Capture stopped; choose a window again.');
      }
    }, 600);
    return () => window.clearInterval(timer);
  }, [auto, capture.ready, capture.isStill, disabled, zh, page]);
  const result = results[selected];
  const resultLeft = result?.leftSide ?? leftSide;
  const mappings = result?.rows.map((row) => mapping[String(row.screenRow)] || '') ?? [];
  const complete =
    mappings.length === 10 &&
    mappings.every(Boolean) &&
    new Set(mappings).size === 10 &&
    mappings.every((id, index) =>
      report.players.some(
        (p) =>
          p.rowId === id &&
          p.side === (index < 5 ? resultLeft : resultLeft === 'blue' ? 'red' : 'blue'),
      ),
    );
  const updates =
    result?.candidates
      .filter((c) => c.value !== null && c.confidence >= 0.85)
      .map((c) => ({
        rowId: mappings[c.screenRow],
        metric: c.metric,
        field: {
          value: c.value!,
          resolution: c.resolution,
          confidence: c.confidence,
          manual: false,
          sourcePage: result.page,
          evidence: result.evidence,
          capturedAt: result.capturedAt,
        },
      }))
      .filter((update) => {
        const player = report.players.find((player) => player.rowId === update.rowId);
        return !!player && hasPostGameFieldUpdate(player.fields[update.metric], update.field);
      }) ?? [];
  const metrics = settlementPageMetrics(selected);
  const gradeUpdates =
    result?.grades
      ?.filter((c) => c.value !== null && c.confidence >= 0.85)
      .map((c) => ({
        rowId: mappings[c.screenRow],
        field: {
          value: c.value!,
          confidence: c.confidence,
          manual: false,
          sourcePage: 'summary' as const,
          evidence: result.evidence,
          capturedAt: result.capturedAt,
        },
      })) ?? [];
  return (
    <details className="panel" open>
      <summary>
        {zh ? '结算整页采集 · 实机模板' : 'Full-page settlement capture · game template'}
      </summary>
      <p>
        {zh
          ? '① 在游戏中打开结算页 → ② 点击「采集整页」→ ③ 核对十人数据并应用。默认使用 BP 窗口，不需要逐项框选。'
          : 'Open a settlement page → Capture full page → Review ten players and apply. Uses the BP window by default; no individual boxes needed.'}
      </p>
      <p className="muted">
        {zh
          ? '默认蓝方 P1–P5 对应系统蓝方 P1–P5、红方同理；仅在实际换位时手动修正。各页复用。可逐页上传截图，已采集页面会保留。低置信度数字留在草稿，不会自动入库。'
          : 'Each side defaults to Control P1–P5 in the same order; adjust only if the actual settlement order differs. Upload pages one by one; previous drafts are retained. Uncertain reads remain drafts.'}
      </p>
      {capture.controls}
      <div className="toolbar">
        <label>
          {zh ? '十人页面左侧队伍' : 'Player pages: left team'}
          <select
            aria-label="Settlement left team"
            value={leftSide}
            disabled={disabled}
            onChange={(e) => changeLeftSide(e.target.value as Side)}
          >
            {(['blue', 'red'] as const).map((side) => (
              <option value={side} key={side}>
                {report.players.find((p) => p.side === side)?.teamName} ({side})
              </option>
            ))}
          </select>
        </label>
        <label>
          {zh ? '页面类型' : 'Page type'}
          <select
            aria-label="Settlement page type"
            value={page}
            onChange={(e) => {
              cancelCapture();
              setPage(e.target.value as PostGamePage | 'auto');
            }}
          >
            <option value="auto">{zh ? '自动判页' : 'Detect automatically'}</option>
            {settlementPages.map((p) => (
              <option key={p} value={p}>
                {settlementPageLabel(p, zh)}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={disabled || busy || !capture.ready}
          onClick={() => {
            try {
              void recognize(capture.frame());
            } catch (e) {
              setMessage(String(e));
            }
          }}
        >
          {busy ? (zh ? '整页识别中…' : 'Reading page…') : zh ? '采集整页' : 'Capture full page'}
        </button>
        <label>
          <input
            type="checkbox"
            checked={auto}
            disabled={disabled || capture.isStill}
            onChange={(e) => {
              cancelCapture();
              setAuto(e.target.checked);
            }}
          />
          {zh ? '稳定画面后自动采集草稿' : 'Collect drafts when frames stabilize'}
        </label>
      </div>
      <div className="toolbar">
        {settlementPages.map((p) => (
          <button aria-pressed={selected === p} key={p} onClick={() => setSelected(p)}>
            {settlementPageLabel(p, zh)} {results[p] ? '✓' : '—'}
          </button>
        ))}
      </div>
      <p>
        <b>{settlementPageLabel(selected, zh)} → </b>
        {selected === 'recap'
          ? zh
            ? '两队 KDA、总经济、推塔、战略资源和经济优势曲线（中间零线，上蓝下红）。'
            : 'Team KDA, gold, towers, objectives and economy advantage curve (blue above zero, red below).'
          : metrics.map((metric) => postGameMetricLabel(metric, zh)).join('、')}
        {selected === 'summary' &&
          (zh ? '、字母评级（B / A / A+ / S 等）' : ' and letter grade (B / A / A+ / S…)')}
      </p>
      {selected === 'damage' && (
        <p className="muted">
          {zh
            ? '伤害转化比读取画面中的 0.8、1.5 等小数，按倍数展示；不是经济占比。'
            : 'Damage conversion uses the on-screen decimal ratio (0.8, 1.5…), not gold share.'}
        </p>
      )}
      {(selected === 'overview' || selected === 'economy') && (
        <p className="muted">
          {zh
            ? '经济占比读取总经济下方的百分比。7.6k 是四舍五入的总经济，7589 是总览中的精确值，优先保留精确值。'
            : 'Gold share is the percentage below total gold. Prefer exact summary totals (7589) over rounded displays (7.6k).'}
        </p>
      )}
      {selected === 'summary' && (
        <p className="muted">
          {zh
            ? '截图显示字母评级，没有数字游戏评分；7589 等四位数是经济，不是评分。评级单独保存，不换算成分数。'
            : 'This page shows letter grades, not numeric ratings. Four-digit totals are gold. Grades are stored separately without inventing scores.'}
        </p>
      )}
      {!result && (
        <p className="muted">
          {zh
            ? '此页尚未采集。在游戏中打开对应页面，或上传该页截图，然后点击「采集整页」。'
            : 'Open this page in game or upload its screenshot, then Capture full page.'}
        </p>
      )}
      {result && (
        <>
          <p className="muted">
            {zh
              ? '本局默认同队 P1→P1、P2→P2、P3→P3、P4→P4、P5→P5；有换位时才需调整，各页复用。表格上方是本次识别值，下方输入框是已保存值；留空表示尚未保存，可直接输入修正。'
              : 'Player rows default to matching Control P1–P5 on each side; change only if the screen order differs. Each cell shows this read above and its saved value below; empty inputs are unsaved. Type a correction directly if needed.'}
          </p>
          <p>
            {Math.round(result.elapsedMs)} ms ·{' '}
            <a href={portraitAssetURL(result.evidence)} target="_blank" rel="noreferrer">
              {zh ? '整页原图证据' : 'Page evidence'}
            </a>
          </p>
          {result.gradeWarning && (
            <p role="note">
              {zh
                ? '字母评级暂未读出，KDA 和经济仍可核对保存；可重新采集本页或直接选择评级。'
                : 'Letter grades could not be read. Review and save KDA and gold, then retry this page or choose grades manually.'}{' '}
              {result.gradeWarning}
            </p>
          )}
          {result.page === 'recap' && (
            <>
              <label>
                {zh ? '对局页左侧「我方」对应' : 'Recap left / friendly side maps to'}
                <select
                  aria-label="Recap left side"
                  value={recapLeft}
                  onChange={(e) => setRecapLeft(e.target.value as Side | '')}
                >
                  <option value="">{zh ? '请确认队伍' : 'Confirm team'}</option>
                  {(['blue', 'red'] as const).map((side) => (
                    <option value={side} key={side}>
                      {report.players.find((p) => p.side === side)?.teamName} ({side})
                    </option>
                  ))}
                </select>
              </label>
              <div className="post-game-table">
                {result.teamCandidates?.map((c) => {
                  const side = recapLeft
                      ? c.side === 'left'
                        ? recapLeft
                        : recapLeft === 'blue'
                          ? 'red'
                          : 'blue'
                      : null,
                    stored = side ? report.teamFields?.[side]?.[c.metric] : undefined;
                  return (
                    <div className="toolbar" key={`${c.side}:${c.metric}`}>
                      <b>
                        {c.side} · {postGameTeamMetricLabel(c.metric, zh)}
                      </b>
                      <span className={c.value === null || c.confidence < 0.85 ? 'error' : ''}>
                        {c.value ?? '—'} ({Math.round(c.confidence * 100)}%)
                      </span>
                      {side && (
                        <ManualNumberInput
                          label={`Recap ${side} ${c.metric}`}
                          zh={zh}
                          min={0}
                          max={c.metric === 'gold' ? 1000000 : 999}
                          disabled={disabled}
                          key={`${side}:${c.metric}`}
                          value={stored?.value}
                          placeholder={zh ? '人工修正' : 'Manual correction'}
                          onCommit={(value) =>
                            send({
                              type: 'post_game_team_fields',
                              reportId: report.id,
                              updates: [
                                {
                                  side,
                                  metric: c.metric,
                                  field: {
                                    value: value!,
                                    confidence: 1,
                                    manual: true,
                                    sourcePage: 'recap',
                                  },
                                },
                              ],
                            })
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              {result.goldCurve && (
                <div className="panel">
                  <b>{zh ? '自动识别经济优势曲线' : 'Automatic economy advantage curve'}</b>
                  {result.goldCurve.confidence >= 0.85 && result.goldCurve.points.length >= 2 ? (
                    <>
                      <p>
                        {zh
                          ? `已提取 ${result.goldCurve.points.length} 个曲线标记，纵轴范围 ±${result.goldCurve.maxDifference.toLocaleString()}。核对左右队伍后，与本页数据一起应用。`
                          : `Read ${result.goldCurve.points.length} chart markers, scale ±${result.goldCurve.maxDifference.toLocaleString()}. Confirm sides, then apply with this page.`}
                      </p>
                      <p className="muted">
                        {zh
                          ? '曲线读取截图标记及刻度，时间和差值为像素估计；不是双方经济总量曲线。'
                          : 'Samples are estimated from visible markers and axis labels, not reconstructed from team gold totals.'}
                      </p>
                      {result.goldCurve.warning && <p role="note">{result.goldCurve.warning}</p>}
                      <EconomyAdvantageChart
                        points={result.goldCurve.points.map((p) => ({
                          ...p,
                          difference: p.difference * (recapLeft === 'red' ? -1 : 1),
                        }))}
                        maxDifference={result.goldCurve.maxDifference}
                        durationSeconds={result.goldCurve.durationSeconds}
                        zh={zh}
                      />
                      <a href="/overlay/game-progress" target="_blank" rel="noreferrer">
                        {zh ? '打开经济优势图' : 'Open economy advantage overlay'}
                      </a>
                    </>
                  ) : (
                    <p className="error">
                      {zh
                        ? '曲线识别不足，保留已保存曲线；请确保对局页包含完整刻度。'
                        : 'Curve unreadable; existing curve preserved. Capture the full recap including its axes.'}{' '}
                      {result.goldCurve.error}
                    </p>
                  )}
                </div>
              )}
              <button
                disabled={
                  disabled ||
                  !recapLeft ||
                  (!result.teamCandidates?.some((c) => c.value !== null && c.confidence >= 0.85) &&
                    !(result.goldCurve && result.goldCurve.confidence >= 0.85))
                }
                onClick={() => {
                  if (!recapLeft) return;
                  const curve = result.goldCurve;
                  send({
                    type: 'post_game_team_fields',
                    reportId: report.id,
                    updates: (result.teamCandidates ?? [])
                      .filter((c) => c.value !== null && c.confidence >= 0.85)
                      .map((c) => ({
                        side: c.side === 'left' ? recapLeft : recapLeft === 'blue' ? 'red' : 'blue',
                        metric: c.metric,
                        field: {
                          value: c.value!,
                          confidence: c.confidence,
                          manual: false,
                          sourcePage: 'recap',
                          capturedAt: result.capturedAt,
                          evidence: result.evidence,
                        },
                      })),
                    ...(curve && curve.confidence >= 0.85 && curve.points.length >= 2
                      ? {
                          goldDifference: {
                            points: curve.points.map((p) => ({
                              ...p,
                              difference: p.difference * (recapLeft === 'blue' ? 1 : -1),
                            })),
                            maxDifference: curve.maxDifference,
                            durationSeconds: curve.durationSeconds,
                            confidence: curve.confidence,
                            partial: !!curve.warning,
                            source: 'settlement',
                            evidence: result.evidence,
                            capturedAt: result.capturedAt,
                          },
                        }
                      : {}),
                  });
                }}
              >
                {zh ? '应用已核对队伍汇总' : 'Apply reviewed team recap'}
              </button>
            </>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table className="settlement-review">
              <thead>
                <tr>
                  <th>{zh ? '画面 / 对应选手' : 'Screen / player'}</th>
                  {metrics.map((metric) => (
                    <th key={metric}>{postGameMetricLabel(metric, zh)}</th>
                  ))}
                  {result.page === 'summary' && <th>{zh ? '字母评级' : 'Letter grade'}</th>}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => {
                  const rowId = mappings[row.screenRow],
                    player = report.players.find((p) => p.rowId === rowId),
                    side = row.screenRow < 5 ? resultLeft : resultLeft === 'blue' ? 'red' : 'blue';
                  const duplicate = !!rowId && mappings.filter((id) => id === rowId).length > 1;
                  const grade = result.grades?.find((c) => c.screenRow === row.screenRow);
                  return (
                    <tr key={row.screenRow}>
                      <td>
                        <label>
                          {side} · {(row.screenRow % 5) + 1} · OCR: {row.text || '—'}{' '}
                          {row.rowId && rowId && row.rowId !== rowId && (
                            <small className="error">
                              {zh
                                ? '本页 OCR 与已保存排序不同，请核实'
                                : 'This page OCR differs from the saved order; review'}
                            </small>
                          )}{' '}
                          {duplicate && (
                            <small className="error">
                              {zh
                                ? '同一选手被重复绑定，请先修正对应关系'
                                : 'Player mapped more than once; correct the mapping first'}
                            </small>
                          )}{' '}
                          <select
                            aria-label={`Settlement identity ${row.screenRow}`}
                            value={rowId}
                            disabled={disabled}
                            onChange={(e) =>
                              setMapping((old) => ({
                                ...old,
                                [String(row.screenRow)]: e.target.value,
                              }))
                            }
                          >
                            <option value="">
                              {zh ? '请确认对应选手' : 'Confirm player identity'}
                            </option>
                            {report.players
                              .filter((p) => p.side === side)
                              .map((p) => (
                                <option value={p.rowId} key={p.rowId}>
                                  {p.teamName} · {p.playerId || `P${p.slot + 1}`}
                                </option>
                              ))}
                          </select>
                        </label>
                      </td>
                      {metrics.map((metric) => {
                        const c = result.candidates.find(
                            (c) => c.screenRow === row.screenRow && c.metric === metric,
                          ),
                          stored = player?.fields[metric];
                        return (
                          <td
                            key={metric}
                            title={c ? `OCR: ${c.text} · ${Math.round(c.confidence * 100)}%` : ''}
                            className={!c || c.value === null || c.confidence < 0.85 ? 'error' : ''}
                          >
                            {formatPostGameValue(c?.value ?? null, metric)}
                            {c && c.confidence < 0.85 && (
                              <small>{zh ? ' 待核对' : ' Review'}</small>
                            )}
                            {player && (
                              <ManualNumberInput
                                label={`Settlement ${row.screenRow} ${metric}`}
                                zh={zh}
                                min={0}
                                max={
                                  postGamePercentMetrics.includes(metric) || metric === 'rating'
                                    ? 100
                                    : 1e9
                                }
                                integer={!postGameDecimalMetrics.includes(metric)}
                                disabled={disabled || duplicate}
                                key={`${player.rowId}:${metric}`}
                                value={stored?.value}
                                placeholder={zh ? '确认 / 修正' : 'Confirm / edit'}
                                onCommit={(value) =>
                                  send({
                                    type: 'post_game_fields',
                                    reportId: report.id,
                                    updates: [
                                      {
                                        rowId: player.rowId,
                                        metric,
                                        field: {
                                          value: value!,
                                          confidence: 1,
                                          manual: true,
                                          sourcePage: selected,
                                        },
                                      },
                                    ],
                                  })
                                }
                              />
                            )}
                            {player &&
                              c?.value !== null &&
                              c?.value !== undefined &&
                              !canMergePostGameField(stored, {
                                value: c.value,
                                resolution: c.resolution,
                                confidence: c.confidence,
                                manual: false,
                                sourcePage: selected,
                              }) && (
                                <small> · {zh ? '保留已有值' : 'Existing value protected'}</small>
                              )}
                          </td>
                        );
                      })}
                      {result.page === 'summary' && (
                        <td>
                          <span className={!grade?.value || grade.confidence < 0.85 ? 'error' : ''}>
                            {grade?.value ?? '—'}
                            {grade && grade.confidence < 0.85 && (zh ? ' 待核对' : ' Review')}
                          </span>
                          {player && (
                            <select
                              aria-label={`Grade ${row.screenRow}`}
                              value={player.grade?.value ?? ''}
                              disabled={disabled || duplicate}
                              onChange={(e) => {
                                if (e.target.value)
                                  send({
                                    type: 'post_game_grades',
                                    reportId: report.id,
                                    updates: [
                                      {
                                        rowId: player.rowId,
                                        field: {
                                          value: e.target.value as PostGameGradeField['value'],
                                          sourcePage: 'summary',
                                          manual: true,
                                          confidence: 1,
                                        },
                                      },
                                    ],
                                  });
                              }}
                            >
                              <option value="">{zh ? '确认 / 修正' : 'Confirm / edit'}</option>
                              {postGameGrades.map((value) => (
                                <option key={value}>{value}</option>
                              ))}
                            </select>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {result.page !== 'recap' && (
            <>
              <button
                disabled={disabled || !complete || (!updates.length && !gradeUpdates.length)}
                onClick={() => {
                  send({
                    type: 'post_game_fields',
                    reportId: report.id,
                    updates,
                    grades: gradeUpdates,
                  });
                  setMessage(
                    zh
                      ? '已提交本页高置信度数据；人工值和真实冲突保留。可切换游戏页面继续采集。'
                      : 'Submitted this page’s high-confidence data; manual values and real conflicts remain protected. Open the next game page to continue.',
                  );
                }}
              >
                {zh ? '应用本页已核对的高置信度字段' : 'Apply reviewed high-confidence fields'}
              </button>
              {!complete && (
                <p className="error">
                  {zh
                    ? '必须确认同队五人一一对应，不能重复绑定选手。'
                    : 'Confirm a unique five-player mapping for each team.'}
                </p>
              )}
            </>
          )}
        </>
      )}
      <p role="status">{message}</p>
    </details>
  );
}
