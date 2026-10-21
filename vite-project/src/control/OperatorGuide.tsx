import { useState } from 'react';
import type { MatchState } from '../shared/types';
import { phaseName } from '../shared/display';
import { seriesFinished } from '../shared/draftRules';
import { canVerifyPlayerOrder, playerOrderCheckKey } from '../shared/playerOrderPreflight';

/** Anchor navigation must reveal collapsed tools before the browser scrolls.
 * Keep every capture component mounted so jumping workspaces never drops it. */
function openWorkspace(id: string) {
  document.dispatchEvent(new CustomEvent('hok-open-panel', { detail: id }));
  let element: HTMLElement | null = document.getElementById(id);
  while (element) {
    if (element instanceof HTMLDetailsElement) element.open = true;
    element = element.parentElement;
  }
}

export function OperatorGuide({
  state,
  connected,
  pending,
  onTeams,
  onSettings,
}: {
  state: MatchState;
  connected: boolean;
  pending: boolean;
  onTeams: () => void;
  onSettings: () => void;
}) {
  const zh = state.language === 'zh';
  const checkKey = playerOrderCheckKey(state);
  const rostersReady = canVerifyPlayerOrder(state);
  const [verifiedIds, setVerifiedIds] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(
        sessionStorage.getItem('hok-director-player-order-checks') || '{}',
      ) as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  const idOrderVerified = rostersReady && !!verifiedIds[checkKey];
  const setOrderVerified = (value: boolean) => {
    const next = { ...verifiedIds, [checkKey]: value };
    setVerifiedIds(next);
    try {
      sessionStorage.setItem('hok-director-player-order-checks', JSON.stringify(next));
    } catch {
      /* session-only fallback */
    }
  };
  // BP completion is not proof the match has ended. Commitment archives the
  // valid game after play; never infer a new lifecycle stage from panel visits.
  const step = state.committedGameId ? 3 : state.draftComplete ? 2 : state.currentPhase > 0 ? 1 : 0;
  const labels = zh
    ? ['赛前准备', '选禁操作', '确认阵容', '记录与下一局']
    : ['Preparation', 'Draft', 'Confirm lineup', 'Record & next game'];
  const hint = !connected
    ? zh
      ? '连接中断：画面保留最后一次状态，恢复连接后再继续操作。'
      : 'Connection lost: showing the last state. Wait for reconnection before continuing.'
    : pending
      ? zh
        ? '正在等待服务器确认，请稍候。'
        : 'Waiting for server confirmation.'
      : step === 0
        ? zh
          ? '先检查队伍、首发、赛制和解说延迟，再开始选禁。'
          : 'Check teams, starters, rules and caster delay before drafting.'
        : step === 1
          ? `${zh ? '当前操作：' : 'Current turn: '}${phaseName(state, state.language)}`
          : step === 2
            ? zh
              ? '先核对 P1–P5 与最终英雄归属；比赛进行时使用局内 HUD 和 OBS。比赛结束后再确认本局有效、更新比分。'
              : 'Verify P1–P5 and hero ownership; use Live HUD and OBS during play. Commit the valid game and update the score after play ends.'
            : seriesFinished(state)
              ? zh
                ? '系列赛已结束。核对比分后，可处理赛后数据并导出备份。'
                : 'Series complete. Verify the score, prepare post-game data and export a backup.'
              : zh
                ? '核对本局结果并更新系列赛比分，再进入下一局。'
                : 'Check the result and update the series score before starting the next game.';
  return (
    <section className="operator-guide panel" aria-label={zh ? '导播操作指引' : 'Operator guide'}>
      <ol className="operator-steps">
        {labels.map((label, index) => (
          <li key={label} aria-current={step === index ? 'step' : undefined}>
            <span>{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <p role="status" aria-live="polite">
        {hint}
      </p>
      {state.bpInputMode === 'screen' && !state.committedGameId && (
        <div className={'operator-id-preflight' + (idOrderVerified ? ' verified' : '')}>
          <label>
            <input
              type="checkbox"
              checked={idOrderVerified}
              disabled={!connected || pending || !rostersReady}
              onChange={(event) => setOrderVerified(event.target.checked)}
            />
            <span>
              {!rostersReady
                ? zh
                  ? '请先为双方填写五名不重复的选手 ID，再核对 P1–P5。'
                  : 'Enter five unique player IDs per team before checking P1–P5.'
                : idOrderVerified
                  ? zh
                    ? '本局 P1–P5 已人工核对（顺序或名单变化后需重新确认）'
                    : 'P1–P5 manually checked (recheck after roster/order changes)'
                  : zh
                    ? '开播检查：对照真实画面核对下列 P1–P5 顺序，确认后再勾选。'
                    : 'Preflight: compare the P1–P5 order below with the live feed before checking.'}
            </span>
          </label>
          {(['blue', 'red'] as const).map((side) => (
            <p key={side} className="muted">
              <strong>{side === 'blue' ? (zh ? '蓝方' : 'Blue') : zh ? '红方' : 'Red'}：</strong>
              {state[`${side}PlayerSlotOrder`]
                .map(
                  (roster, index) => `P${index + 1} ${state[`${side}Team`].players[roster] || '—'}`,
                )
                .join(' · ')}
            </p>
          ))}
          <a href="#player-slot-alignment" onClick={() => openWorkspace('player-slot-alignment')}>
            {zh ? '前往 P1–P5 自动识别 / 手动调整' : 'Go to P1–P5 recognition / manual adjustment'}
          </a>
          <small className="muted">
            {zh
              ? '此勾选只记录人工核对，不代表 OCR 成功，也不会修改服务器顺序。'
              : 'This checkbox records human review only; it does not prove OCR succeeded or update the server.'}
          </small>
        </div>
      )}
      <nav className="toolbar" aria-label={zh ? '工作区导航' : 'Workspace navigation'}>
        <button type="button" onClick={onTeams}>
          {zh ? '设置队伍' : 'Set up teams'}
        </button>
        <button type="button" onClick={onSettings}>
          {zh ? '检查赛制与显示' : 'Review rules & display'}
        </button>
        <a href="#draft-workspace" onClick={() => openWorkspace('draft-workspace')}>
          {zh ? '选禁工作区' : 'Draft workspace'}
        </a>
        <a href="#live-hud-workspace" onClick={() => openWorkspace('live-hud-workspace')}>
          {zh ? '局内采集与 HUD' : 'Live capture & HUD'}
        </a>
        <a href="#obs-workspace" onClick={() => openWorkspace('obs-workspace')}>
          {zh ? 'OBS 切镜与音源' : 'OBS scenes & audio'}
        </a>
        <a href="#game-lifecycle" onClick={() => openWorkspace('game-lifecycle')}>
          {zh ? '比分与下一局' : 'Score & next game'}
        </a>
        <a href="#postgame-tools" onClick={() => openWorkspace('postgame-tools')}>
          {zh ? '赛后与备份' : 'Post-game & backups'}
        </a>
      </nav>
    </section>
  );
}
