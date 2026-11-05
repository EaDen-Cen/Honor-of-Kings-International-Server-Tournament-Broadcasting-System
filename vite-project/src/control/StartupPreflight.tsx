import { useCallback, useRef, useState } from 'react';
import type { MatchState } from '../shared/types';
import { currentGame } from '../shared/draftRules';
import { PreflightStatus, type Check } from './PreflightStatus';
import { playerOrderCheckKey } from '../shared/playerOrderPreflight';

interface Progress {
  flags: number;
  done: boolean;
  bypassed?: boolean;
  recordedAt?: string;
  unchecked?: string[];
}
const storageKey = 'hok-director-preflight-v1';
const logKey = 'hok-preflight-bypass-log-v1';
interface BypassRecord {
  game: number;
  at: string;
  unchecked: string[];
  unresolved: Check[];
}
function readLog(): BypassRecord[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(logKey) || '[]');
    return Array.isArray(value)
      ? value
          .filter(
            (item) =>
              item &&
              Number.isSafeInteger(item.game) &&
              typeof item.at === 'string' &&
              Array.isArray(item.unchecked) &&
              item.unchecked.every((label: unknown) => typeof label === 'string') &&
              Array.isArray(item.unresolved) &&
              item.unresolved.every(
                (check: Check) =>
                  check &&
                  typeof check.name === 'string' &&
                  typeof check.detail === 'string' &&
                  typeof check.ok === 'boolean',
              ),
          )
          .slice(-50)
      : [];
  } catch {
    return [];
  }
}
const readSaved = (): Record<string, Progress> => {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) || '{}') as Record<
      string,
      Progress
    >;
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
};

export function StartupPreflight({
  state,
  token,
  connected,
}: {
  state: MatchState;
  token: string;
  connected: boolean;
}) {
  const zh = state.language === 'zh';
  const game = currentGame(state);
  const key = [
    playerOrderCheckKey(state),
    game,
    state.seriesFormat,
    state.draftMode,
    state.banCount,
    state.firstPickSide,
  ].join(':');
  const [saved, setSaved] = useState<Record<string, Progress>>(readSaved);
  const observed = useRef<Check[]>([]);
  const [warnings, setWarnings] = useState(1);
  const [log, setLog] = useState<BypassRecord[]>(readLog);
  const [logError, setLogError] = useState('');
  const onChecks = useCallback((checks: Check[]) => {
    observed.current = checks;
    setWarnings(checks.filter((check) => !check.ok).length);
  }, []);
  const progress = saved[key] ?? { flags: 0, done: false };
  const labels = zh
    ? [
        '核对队伍、Logo、首发、P1–P5 与本局赛制 / BP 规则',
        '连接并测试 BP 采集画面、尺寸与 ROI 校准，核对模板与英雄候选；准备人工纠正入口',
        '检查 OBS 的场景、Browser Source 内容、音频、录制状态与实际录制磁盘剩余空间',
        '检查备份、导播/解说 Overlay 与公网访问',
      ]
    : [
        'Verify teams, logos, P1–P5 order, series and BP rules',
        'Test capture size, ROI, templates and hero candidates; locate manual correction',
        'Check OBS scenes, Browser Source content, audio, recording and actual disk space',
        'Check backup, overlays and remote connectivity',
      ];
  const change = (next: Progress) => {
    const updated = {
      ...saved,
      [key]: {
        ...next,
        recordedAt: new Date().toISOString(),
        unchecked: labels.filter((_, index) => !(next.flags & (1 << index))),
      },
    };
    setSaved(updated);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(updated));
    } catch {
      /* session fallback */
    }
    if (next.bypassed) {
      const entry = {
        game,
        at: updated[key].recordedAt!,
        unchecked: updated[key].unchecked!,
        unresolved: observed.current.filter((check) => !check.ok),
      };
      const records = [...log, entry].slice(-50);
      setLog(records);
      try {
        localStorage.setItem(logKey, JSON.stringify(records));
        setLogError('');
      } catch {
        setLogError(
          zh
            ? '绕过记录无法保存到浏览器；本页关闭后可能丢失。'
            : 'Bypass log could not persist; it may be lost when this page closes.',
        );
      }
    }
  };
  return (
    <details
      className="panel preflight-checklist"
      aria-label={zh ? '开播强提醒' : 'Broadcast startup checklist'}
    >
      <summary className="toolbar">
        <h3>{zh ? `第 ${game} 局开播流程` : `Game ${game} startup checklist`}</h3>
        <strong role="status">
          {progress.done
            ? progress.bypassed
              ? zh
                ? '紧急跳过（未验证）'
                : 'Bypassed; unverified'
              : zh
                ? '本次已人工确认'
                : 'Confirmed for this game'
            : zh
              ? '未完成 · 开播前需检查'
              : 'Not complete · preflight required'}
        </strong>
        {warnings > 0 && (
          <span>
            {zh
              ? `实际状态仍有 ${warnings} 项需检查`
              : `${warnings} observed checks require attention`}
          </span>
        )}
      </summary>
      <PreflightStatus
        token={token}
        connected={connected}
        zh={zh}
        state={state}
        onChecks={onChecks}
      />
      {progress.bypassed && (
        <p role="alert">
          {zh
            ? '本次紧急跳过（历史保存在本浏览器）'
            : 'Current emergency bypass (history stored in this browser)'}
          : {progress.recordedAt} ·{' '}
          {progress.unchecked?.join(' / ') ||
            (zh
              ? '人工项目已勾选；自动状态仍需核查'
              : 'Manual items checked; observed status still requires review')}
        </p>
      )}
      {log.length > 0 && (
        <details aria-label={zh ? '紧急跳过历史' : 'Emergency bypass history'}>
          <summary>
            {zh
              ? '本浏览器绕过记录（最近 50 条，不是服务器审计）'
              : 'Browser bypass history (last 50; not a server audit)'}
          </summary>
          <ul>
            {[...log].reverse().map((entry, index) => (
              <li key={index}>
                Game {entry.game} · {entry.at}
                <ul>
                  {entry.unchecked.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                  {entry.unresolved.map((check) => (
                    <li key={check.name}>
                      {check.name}: {check.detail}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      )}
      {logError && <p role="alert">{logError}</p>}
      {!progress.done ? (
        <>
          <p className="muted">
            {zh
              ? '逐项确认后关闭提醒；每局重新出现。此流程故意采用“伪强制”，以免临场故障把导播彻底锁死。未通过的项目不能假装为通过。'
              : 'Confirm each item before dismissing. The checklist restarts every game. Emergency bypass prevents live-operation lockout.'}
          </p>
          {labels.map((label, index) => (
            <label key={index} className="preflight-check">
              <input
                type="checkbox"
                checked={!!(progress.flags & (1 << index))}
                onChange={(e) =>
                  change({
                    flags: e.target.checked
                      ? progress.flags | (1 << index)
                      : progress.flags & ~(1 << index),
                    done: false,
                  })
                }
              />
              <span>{label}</span>
            </label>
          ))}
          <div className="toolbar">
            <button
              type="button"
              className="primary"
              disabled={progress.flags !== 15}
              onClick={() => change({ flags: 15, done: true })}
            >
              {zh ? '确认完成开播检查' : 'Finish preflight'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  confirm(
                    zh
                      ? '紧急跳过所有未完成的开播检查？这些项目将标记为未验证；请尽快补查。'
                      : 'Bypass unfinished checks? They remain unverified.',
                  )
                )
                  change({ flags: progress.flags, done: true, bypassed: true });
              }}
            >
              {zh ? '紧急跳过（保留警告）' : 'Emergency bypass'}
            </button>
          </div>
        </>
      ) : (
        <button type="button" onClick={() => change({ flags: 0, done: false })}>
          {zh ? '重新执行检查' : 'Repeat checks'}
        </button>
      )}
    </details>
  );
}
