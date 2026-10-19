import { useEffect, useState } from 'react';
import type { MatchState } from '../shared/types';
import { phaseName } from '../shared/display';
import { seriesFinished } from '../shared/draftRules';

const checkStorage='hok-director-player-order-check-v2';
interface IdentityCheck { context:string; verified:boolean }
function readIdentityCheck():IdentityCheck {
  try {
    const value:unknown=JSON.parse(sessionStorage.getItem(checkStorage)||'null');
    if(value&&typeof value==='object'&&'context' in value&&typeof value.context==='string'&&'verified' in value&&typeof value.verified==='boolean')return {context:value.context,verified:value.verified};
  }catch{/* A blocked or invalid store must never imply verification. */}
  return {context:'',verified:false};
}
function persistIdentityCheck(value:IdentityCheck) {
  try{sessionStorage.setItem(checkStorage,JSON.stringify(value));}catch{/* Session-only fallback. */}
}

export function OperatorGuide({ state, connected, pending, onTeams, onSettings }: {
  state: MatchState; connected: boolean; pending: boolean; onTeams: () => void; onSettings: () => void;
}) {
  const zh = state.language === 'zh';
  const checkKey=JSON.stringify([
    state.stage,state.draftGameNumber??state.gameNumber,state.draftHistory.length,state.displayLeftSide,
    state.blueTeam.id,state.blueTeam.players,state.blueTeam.playerRoles,state.bluePlayerSlotOrder,
    state.redTeam.id,state.redTeam.players,state.redTeam.playerRoles,state.redPlayerSlotOrder,
  ]);
  const [identityCheck,setIdentityCheck]=useState(readIdentityCheck);
  const idOrderVerified=identityCheck.context===checkKey&&identityCheck.verified;
  // An earlier identity snapshot is not a check of the changed lineup. Retain
  // only the current snapshot so changing away and back cannot restore a check.
  useEffect(()=>{
    if(identityCheck.context===checkKey)return;
    const next={context:checkKey,verified:false};
    setIdentityCheck(next);persistIdentityCheck(next);
  },[checkKey,identityCheck.context]);
  const setOrderVerified=(value:boolean)=>{
    const next={context:checkKey,verified:value};
    setIdentityCheck(next);persistIdentityCheck(next);
  };
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
    {state.bpInputMode==='screen'&&!state.committedGameId&&<label className={'operator-id-preflight'+(idOrderVerified?' verified':'')}>
      <input type="checkbox" checked={idOrderVerified} onChange={event=>setOrderVerified(event.target.checked)}/>
      <span>{idOrderVerified?(zh?'本局选手 ID / P1–P5 已由导播核对':'Player IDs / P1–P5 checked for this game'):
        (zh?'开播检查：尚未确认本局 P1–P5 选手 ID 对应顺序，赛后对位可能错配。':'Preflight: Player ID / P1–P5 order not confirmed for this game; postgame matchups may be wrong.')}</span>
    </label>}
    <nav className="toolbar" aria-label={zh ? '工作区导航' : 'Workspace navigation'}>
      <button type="button" onClick={onTeams}>{zh ? '设置队伍' : 'Set up teams'}</button>
      <button type="button" onClick={onSettings}>{zh ? '检查赛制与显示' : 'Review rules & display'}</button>
      <a href="#draft-workspace">{zh ? '选禁工作区' : 'Draft workspace'}</a>
      <a href="#game-lifecycle">{zh ? '比分与下一局' : 'Score & next game'}</a>
      <a href="#postgame-tools">{zh ? '赛后与备份' : 'Post-game & backups'}</a>
    </nav>
  </section>;
}
