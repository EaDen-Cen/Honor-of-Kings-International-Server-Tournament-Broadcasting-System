import type { MatchState } from '../shared/types';
import { phaseName } from '../shared/display';
import { seriesFinished } from '../shared/draftRules';
import { isPlayerSlotVerified, validateGameReady } from '../shared/gamePreflight';

export function OperatorGuide({ state, connected, pending, onTeams, onSettings }: {
  state: MatchState; connected: boolean; pending: boolean; onTeams: () => void; onSettings: () => void;
}) {
  const zh = state.language === 'zh';
  const idOrderVerified = isPlayerSlotVerified(state, 'blue') && isPlayerSlotVerified(state, 'red');
  const preflight = validateGameReady(state);
  const step = state.committedGameId ? 3 : state.draftComplete ? 2 : state.currentPhase > 0 ? 1 : 0;
  const labels = zh ? ['赛前准备', '选禁操作', '确认阵容', '记录与下一局'] : ['Preparation', 'Draft', 'Confirm lineup', 'Record & next game'];
  const hint = !connected
    ? (zh ? '连接中断：画面保留最后一次状态，恢复连接后再继续操作。' : 'Connection lost: showing the last state. Wait for reconnection before continuing.')
    : pending ? (zh ? '正在等待服务器确认，请稍候。' : 'Waiting for server confirmation.')
      : step === 0 ? (zh ? '先检查队伍、首发、赛制和解说延迟，再开始选禁。' : 'Check teams, starters, rules and caster delay before drafting.')
        : step === 1 ? `${zh ? '当前操作：' : 'Current turn: '}${phaseName(state, state.language)}`
          : step === 2 ? (zh ? '核对双方 P1–P5 与最终英雄归属，然后提交本局。提交后再更新比分。' : 'Verify P1–P5 and final hero assignments, then commit this game before updating the score.')
            : seriesFinished(state) ? (zh ? '系列赛已结束。核对比分后，可处理赛后数据并导出备份。' : 'Series complete. Verify the score, prepare post-game data and export a backup.')
              : (zh ? '核对本局结果并更新系列赛比分，再进入下一局。' : 'Check the result and update the series score before starting the next game.');
  return <section className="operator-guide panel" aria-label={zh ? '导播操作指引' : 'Operator guide'}>
    <ol className="operator-steps">{labels.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
    <p role="status" aria-live="polite">{hint}</p>
    <div className={'operator-id-preflight'+(idOrderVerified?' verified':'')} data-id-verified={idOrderVerified} role="status">
      <span>{idOrderVerified?(zh?'选手 ID / P1–P5 已由服务器核验保存。':'Player IDs / P1–P5 verified and saved by server.'):
        (zh?'开播检查：选手 ID / P1–P5 尚未完成服务器核验。':'Preflight: Player IDs / P1–P5 are not server verified.')}</span>
      <a href="#player-id-alignment">{zh?'核验 / 调整选手 ID':'Verify / align Player IDs'}</a>
    </div>
    {state.draftComplete&&<div className={'operator-game-preflight'+(preflight.ready?' verified':'')} data-game-ready={preflight.ready}>
      <strong>{preflight.ready?(zh?'比赛预设检查通过':'Game preset checks passed'):(zh?'进入比赛前仍需处理：':'Before entering Game:')}</strong>
      {preflight.issues.length>0&&<ul>{preflight.issues.map(issue=><li key={issue.code}>{issue.message}</li>)}</ul>}
      {!preflight.ready&&<a href={preflight.issues.some(issue=>issue.code==='player_order')?'#player-id-alignment':preflight.issues.some(issue=>issue.code==='current_game')?'#game-lifecycle':'#draft-workspace'}>{zh?'前往修复':'Review and repair'}</a>}
    </div>}
    <nav className="toolbar" aria-label={zh ? '工作区导航' : 'Workspace navigation'}>
      <button type="button" onClick={onTeams}>{zh ? '设置队伍' : 'Set up teams'}</button>
      <button type="button" onClick={onSettings}>{zh ? '检查赛制与显示' : 'Review rules & display'}</button>
      <a href="#draft-workspace">{zh ? '选禁工作区' : 'Draft workspace'}</a>
      <a href="#game-lifecycle">{zh ? '比分与下一局' : 'Score & next game'}</a>
      <a href="#postgame-tools">{zh ? '赛后与备份' : 'Post-game & backups'}</a>
    </nav>
  </section>;
}
