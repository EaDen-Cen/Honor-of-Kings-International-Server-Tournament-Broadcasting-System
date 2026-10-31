import { useState } from 'react';
import { heroesForState } from '../shared/heroData';
import type { Action, MatchState, Side } from '../shared/types';

/** Separate from the normal draft turn: corrections must not advance BP or undo lock cues. */
export function DraftHeroCorrection({state, disabled, send}: {
  state: MatchState; disabled: boolean; send: (action: Action) => void;
}) {
  const zh = state.language === 'zh';
  const [gameId, setGameId] = useState('current');
  const [side, setSide] = useState<Side>('blue');
  const [kind, setKind] = useState<'pick' | 'ban'>('pick');
  const [slot, setSlot] = useState('');
  const [heroId, setHeroId] = useState('');
  const record = gameId === 'current' ? undefined : state.draftHistory.find(game => game.id === gameId);
  const draft = record ?? state;
  const values = kind === 'pick' ? draft[`${side}Picks`] : draft[`${side}Bans`] ?? [];
  const index = slot === '' ? -1 : Number(slot);
  const oldId = values[index];
  const available = heroesForState({...state,heroPool:record?.heroPool ?? state.heroPool});
  const currentHero = available.find(hero => hero.id === oldId);
  const chosen = available.find(hero => hero.id === Number(heroId));
  const label = (id: number | null) =>
    id === null ? (zh ? '空 Ban' : 'Empty ban') :
    available.find(hero => hero.id === id)?.[zh ? 'chineseName' : 'englishName'] ?? String(id);
  return <details className="panel" id="locked-hero-correction">
    <summary>{zh ? '纠正已锁定英雄（人工优先）' : 'Correct locked heroes (manual override)'}</summary>
    <p className="muted">{zh
      ? '用于元流之子被识别成孙尚香等误判。修改指定 Ban/Pick 槽位，不回退 BP 步骤、不重置比分；已确认局和赛后英雄头像同步更新，数字和 MVP 不清空。'
      : 'Fix a mistaken locked Ban/Pick slot without rewinding phases or scores. Committed game and report hero portraits stay synchronized.'}</p>
    <div className="toolbar">
      <label>{zh ? '目标对局' : 'Game'}
        <select aria-label="Correction game" value={gameId} onChange={e=>{setGameId(e.target.value);setSlot('');setHeroId('');}}>
          <option value="current">{zh ? '正在操作的局' : 'Current live game'}</option>
          {state.draftHistory.filter(game => game.id !== state.committedGameId).map(game =>
            <option key={game.id} value={game.id}>{zh ? `历史第 ${game.gameNumber} 局` : `Archived game ${game.gameNumber}`}</option>)}
        </select>
      </label>
      <label>{zh ? '阵营' : 'Side'}
        <select aria-label="Correction side" value={side} onChange={e=>{setSide(e.target.value as Side);setSlot('');setHeroId('');}}>
          <option value="blue">{zh ? '蓝方' : 'Blue'}</option><option value="red">{zh ? '红方' : 'Red'}</option>
        </select>
      </label>
      <label>{zh ? '类型' : 'Type'}
        <select aria-label="Correction type" value={kind} onChange={e=>{setKind(e.target.value as 'pick'|'ban');setSlot('');setHeroId('');}}>
          <option value="pick">Pick</option><option value="ban">Ban</option>
        </select>
      </label>
      <label>{zh ? '已锁定位置' : 'Locked slot'}
        <select aria-label="Correction slot" value={slot} onChange={e=>{setSlot(e.target.value);setHeroId('');}}>
          <option value="">{zh ? '选择槽位' : 'Select slot'}</option>
          {values.map((id,index)=><option key={index} value={index}>{kind.toUpperCase()} {index+1} · {label(id)}</option>)}
        </select>
      </label>
      <label>{zh ? '正确英雄' : 'Correct hero'}
        <select aria-label="Correct hero" value={heroId} onChange={e=>setHeroId(e.target.value)}>
          <option value="">{zh ? '选择正确英雄' : 'Select correct hero'}</option>
          {available.map(hero=><option key={hero.id} value={hero.id}>{zh ? hero.chineseName : hero.englishName}</option>)}
        </select>
      </label>
    </div>
    {index >= 0 && <p role="status">{zh ? '当前' : 'Before'}：{currentHero ? label(currentHero.id) : label(oldId ?? null)}
      {chosen && ` → ${label(chosen.id)}`}</p>}
    <button type="button" className="primary" disabled={disabled||index<0||!chosen||oldId===chosen.id} onClick={() => {
      if(!chosen || index<0) return;
      const confirmation = zh
        ? `确认修改${record ? `历史第 ${record.gameNumber} 局` : `当前第 ${state.draftGameNumber??state.gameNumber} 局`} ${side==='blue'?'蓝方':'红方'} ${kind.toUpperCase()} ${index+1}：${label(oldId??null)} → ${label(chosen.id)}？修改会实时同步到 Overlay，可通过撤销回滚。`
        : `Replace ${label(oldId??null)} with ${label(chosen.id)} in ${kind.toUpperCase()} ${index+1}? Overlay will update; Undo can revert.`;
      if(confirm(confirmation))send({type:'replace_draft_hero',team:side,action:kind,index,heroId:chosen.id,...(record?{gameId:record.id}:{})});
    }}>{zh ? '确认并同步英雄纠错' : 'Confirm hero correction'}</button>
    <p className="muted">{zh ? '这是人工事实修正，不会自动修改对局胜负。仍禁止同局重复英雄与不属于所选服务器的英雄。' : 'Manual correction does not change the match score. Duplicate or unavailable heroes remain disallowed.'}</p>
  </details>;
}
