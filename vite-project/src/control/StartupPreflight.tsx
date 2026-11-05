import { useState } from 'react';
import type { MatchState } from '../shared/types';
import { currentGame } from '../shared/draftRules';

interface Progress { flags: number; done: boolean; bypassed?: boolean }
const storageKey = 'hok-director-preflight-v1';
const readSaved = (): Record<string, Progress> => {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) || '{}') as Record<string, Progress>;
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
};

export function StartupPreflight({state}: {state: MatchState}) {
  const zh = state.language === 'zh';
  const game = currentGame(state);
  const key = [state.blueTeam.id, state.redTeam.id, game].join(':');
  const [saved, setSaved] = useState<Record<string, Progress>>(readSaved);
  const progress = saved[key] ?? {flags:0,done:false};
  const labels = zh ? [
    '核对队伍、首发、P1–P5 与本局赛制 / BP 规则',
    '连接并测试 BP 采集画面；准备好错误英雄人工纠正入口',
    '检查 OBS 的场景、音频、录制状态与实际录制磁盘剩余空间',
    '检查备份、导播/解说 Overlay 与公网访问',
  ] : [
    'Verify teams, P1–P5 order, series and BP rules',
    'Test BP capture; locate the manual locked-hero correction',
    'Check OBS scenes, audio, recording status and actual recording disk space',
    'Check backup, overlays and remote connectivity',
  ];
  const change = (next: Progress) => {
    const updated = {...saved,[key]:next};
    setSaved(updated);
    try { sessionStorage.setItem(storageKey,JSON.stringify(updated)); } catch { /* session fallback */ }
  };
  return <section className="panel preflight-checklist" aria-label={zh?'开播强提醒':'Broadcast startup checklist'}>
    <div className="toolbar">
      <h3>{zh ? `第 ${game} 局开播流程` : `Game ${game} startup checklist`}</h3>
      <strong role="status">{progress.done ? (progress.bypassed ? (zh?'紧急跳过（未验证）':'Bypassed; unverified') : (zh?'本次已人工确认':'Confirmed for this game')) : (zh?'未完成 · 开播前需检查':'Not complete · preflight required')}</strong>
    </div>
    {!progress.done ? <>
      <p className="muted">{zh ? '逐项确认后关闭提醒；每局重新出现。此流程故意采用“伪强制”，以免临场故障把导播彻底锁死。未通过的项目不能假装为通过。' : 'Confirm each item before dismissing. The checklist restarts every game. Emergency bypass prevents live-operation lockout.'}</p>
      {labels.map((label,index)=><label key={index} className="preflight-check">
        <input type="checkbox" checked={!!(progress.flags&(1<<index))} onChange={e=>change({flags:e.target.checked?progress.flags|(1<<index):progress.flags&~(1<<index),done:false})}/>
        <span>{label}</span>
      </label>)}
      <div className="toolbar">
        <button type="button" className="primary" disabled={progress.flags !== 15} onClick={()=>change({flags:15,done:true})}>{zh ? '确认完成开播检查' : 'Finish preflight'}</button>
        <button type="button" onClick={() => {
          if(confirm(zh ? '紧急跳过所有未完成的开播检查？这些项目将标记为未验证；请尽快补查。' : 'Bypass unfinished checks? They remain unverified.'))
            change({flags:progress.flags,done:true,bypassed:true});
        }}>{zh ? '紧急跳过（保留警告）' : 'Emergency bypass'}</button>
      </div>
    </> : <button type="button" onClick={()=>change({flags:0,done:false})}>{zh?'重新执行检查':'Repeat checks'}</button>}
  </section>;
}
