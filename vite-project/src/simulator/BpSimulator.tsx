import { ViewportCanvas } from '../shared/ViewportCanvas';
import { useEffect, useMemo } from 'react';
import { allPoolHeroes,heroesForPool } from '../shared/heroPool';
import { phases, type Side } from '../shared/types';
import { simulatorBanVisualKeys, simulatorRandomPlayerOrder, simulatorSlotForPhase, simulatorSlotKey, simulatorSlotsForTurn } from './bpSimulatorModel';
import { useBpSimulatorState } from './bpSimulatorState';
import './bpSimulator.css';

const roles=['Roaming','Jungling','Mid Lane','Clash Lane','Farm Lane'];

function heroName(id:number|undefined) {
  const hero=allPoolHeroes.find(item=>item.id===id);
  return hero?.chineseName||hero?.englishName||'—';
}

function heroImage(id:number|undefined) {
  return allPoolHeroes.find(item=>item.id===id)?.imageLink||'';
}

function PickLockCue() {
  return <svg className="sim-pick-checkmark" viewBox="0 0 32 32" aria-label="pick locked"><path d="M 16 0 L 32 16 L 16 32 L 0 16 Z" fill="currentColor"/><path d="M 7 16 L 13 23 L 25 10" stroke="#b9eaff" strokeWidth="4" fill="none"/></svg>;
}

function LockCue() {
  return <svg className="sim-lock-cue" viewBox="0 0 24 26" aria-label="locked"><path d="M 5 12 V 7 A 7 7 0 0 1 19 7 V 12" stroke="white" strokeWidth="4" fill="none"/><path d="M 1 10 H 23 V 24 H 1 Z M 10 16 V 21 H 14 V 16 Z" fill="white" fillRule="evenodd"/></svg>;
}

export function BpSimulator() {
  const [state,update]=useBpSimulatorState();
  const sequence=useMemo(()=>phases(state.mode,state.firstPickSide,state.banCount),[state.mode,state.firstPickSide,state.banCount]);
  const activeSlots=simulatorSlotsForTurn(state.mode,state.firstPickSide,state.phaseIndex,state.banCount);
  const active=activeSlots[0];
  const activeKeys=useMemo(()=>new Set(activeSlots.map(simulatorSlotKey)),[activeSlots]);
  const activeKey=active?simulatorSlotKey(active):'';
  const activeLocked=activeSlots.length>0&&activeSlots.every(slot=>state.locked.includes(simulatorSlotKey(slot)));

  const phaseByKey=useMemo(()=>{
    const map=new Map<string,number>();
    sequence.forEach((_,index)=>{
      const slot=simulatorSlotForPhase(state.mode,state.firstPickSide,index,state.banCount);
      if(slot) map.set(simulatorSlotKey(slot),index);
    });
    return map;
  },[sequence,state.firstPickSide,state.mode]);

  const visibleState=(key:string)=>{
    if(state.testMode==='lineup'&&key.includes('Pick')) return {visible:true,isCurrent:false,isLocked:true,empty:false};
    const slotPhase=phaseByKey.get(key);
    const visible=slotPhase!==undefined&&(slotPhase<state.phaseIndex||activeKeys.has(key));
    const isLocked=(slotPhase!==undefined&&slotPhase<state.phaseIndex)||state.locked.includes(key);
    const isCurrent=activeKeys.has(key)&&!state.locked.includes(key);
    return {visible,isCurrent,isLocked,empty:state.emptyBans.includes(key)};
  };

  const activeHeroId=activeKey?state.slotHeroes[activeKey]:undefined;
  const heroPool=useMemo(()=>{
    const base=heroesForPool(state.heroPool).slice(0,28);
    if(activeHeroId===undefined||base.some(hero=>hero.id===activeHeroId)) return base;
    const activeHero=allPoolHeroes.find(hero=>hero.id===activeHeroId);
    return activeHero?[activeHero,...base.slice(1)]:base;
  },[activeHeroId]);

  useEffect(()=>{
    const listener=(event:KeyboardEvent)=>{
      if(event.key.toLowerCase()==='f'){
        event.preventDefault();
        if(document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      }
      if(event.key.toLowerCase()==='c'){
        event.preventDefault();
        window.open('/tools/bp-simulator-control','hok-bp-simulator-control');
      }
    };
    window.addEventListener('keydown',listener);
    return()=>window.removeEventListener('keydown',listener);
  },[]);

  const startPlayerOrderTest=()=>{
    if(!state.playerRosterPrepared) return;
    update(current=>({
      ...current,
      scene:'draft',
      phaseIndex:0,
      locked:[],
      emptyBans:[],
      autoPlay:false,
      bluePlayerOrder:simulatorRandomPlayerOrder(),
      redPlayerOrder:simulatorRandomPlayerOrder(),
      playerOrderTestStartedAt:Date.now(),
      playerOrderTestCompletedAt:null,
    }));
  };

  const playerForScreenSlot=(side:Side,index:number)=>{
    const players=side==='blue'?state.bluePlayers:state.redPlayers;
    const order=side==='blue'?state.bluePlayerOrder:state.redPlayerOrder;
    return players[order[index]??index]||`${side.toUpperCase()}.P${index+1}`;
  };

  if(state.testMode==='player-order'&&state.scene==='lobby') {
    return <main className="bp-simulator-stage-page" aria-label="HOK custom room simulator">
      <ViewportCanvas width={1600} height={900} className="bp-simulator-stage sim-room-stage">
        <header className="sim-room-header">
          <span>CUSTOM ROOM</span>
          <strong>PLAYER ORDER TEST</strong>
          <small>队伍名单已固定；开始后只在各自队伍内部随机房间位置</small>
        </header>
        <section className="sim-room-team blue">
          <h2>BLUE TEAM</h2>
          {state.bluePlayers.map((player,index)=><div className="sim-room-player" key={player}><b>{index+1}</b><span>{player}</span></div>)}
        </section>
        <section className="sim-room-team red">
          <h2>RED TEAM</h2>
          {state.redPlayers.map((player,index)=><div className="sim-room-player" key={player}><b>{index+1}</b><span>{player}</span></div>)}
        </section>
        <div className="sim-room-center">
          <p>{state.playerRosterPrepared?'Control 测试名单已准备':'请先在 Simulator 控制台准备测试名单'}</p>
          <button className="sim-room-start" disabled={!state.playerRosterPrepared} onClick={startPlayerOrderTest}>START</button>
          <small>开始瞬间计时；进入 BP 后蓝/红分别随机排序</small>
        </div>
        <div className="sim-bottom-status"><small>F: FULLSCREEN · C: CONTROL</small></div>
      </ViewportCanvas>
    </main>;
  }

  const renderBan=(key:string)=>{
    const side=key.startsWith('blue')?'blue':'red';
    const stateForSlot=visibleState(key);
    const id=state.slotHeroes[key];
    return <div
      className={'sim-ban-slot '+side+' '+(stateForSlot.isCurrent?'active ':'')+(stateForSlot.visible?'visible ':'')+(stateForSlot.isLocked?'locked':'')}
      key={key}
      data-slot={key}
    >
      <div className="sim-ban-avatar" style={{width:state.banSize,height:state.banSize}}>
        {stateForSlot.visible&&!stateForSlot.empty&&<img src={heroImage(id)} alt={heroName(id)} />}
        {stateForSlot.visible&&stateForSlot.empty&&<span className="sim-empty-ban">∅</span>}
        {stateForSlot.isLocked&&<LockCue />}
      </div>
    </div>;
  };

  const renderPlayer=(side:Side,index:number)=>{
    const key=side+'Pick'+(index+1);
    const stateForSlot=visibleState(key);
    const id=state.slotHeroes[key];
    return <div
      className={'sim-player-row '+side+' '+(stateForSlot.isCurrent?'active ':'')+(stateForSlot.visible?'visible ':'')+(stateForSlot.isLocked?'locked':'')}
      key={key}
      data-slot={key}
    >
      <div className="sim-pick-avatar" style={{width:state.pickSize,height:state.pickSize}}>
        {stateForSlot.visible&&<img src={heroImage(id)} alt={heroName(id)} />}
        {stateForSlot.isLocked&&<PickLockCue />}
        {!stateForSlot.visible&&<span className="sim-player-placeholder">{index+1}</span>}
      </div>
      <div className="sim-player-copy">
        <strong data-player-id={playerForScreenSlot(side,index)}>{playerForScreenSlot(side,index)}</strong>
        <span>{roles[(side==='blue'?state.bluePlayerOrder:state.redPlayerOrder)[index]??index]}</span>
        {stateForSlot.visible&&<small>{heroName(id)}</small>}
      </div>
    </div>;
  };

  const actionLabel=active?.action==='ban'?'Ban':active?.action==='pick'?'Pick':'Complete';

  return <main className="bp-simulator-stage-page" aria-label="HOK BP capture simulator">
    <ViewportCanvas width={1600} height={900} className={'bp-simulator-stage '+(state.testMode==='player-order'?'sim-player-id-test ':'')+(state.testMode==='lineup'?'sim-lineup-stage':'')}>
      <div className="sim-side-wash blue" />
      <div className="sim-side-wash red" />

      {state.testMode!=='lineup'&&<>
        <div className="sim-ban-row blue">
          {simulatorBanVisualKeys('blue',state.banCount).map(renderBan)}
        </div>
        <div className="sim-ban-row red">
          {simulatorBanVisualKeys('red',state.banCount).map(renderBan)}
        </div>
      </>}

      <div className="sim-pick-column blue">
        {[0,1,2,3,4].map(index=>renderPlayer('blue',index))}
      </div>
      <div className="sim-pick-column red">
        {[0,1,2,3,4].map(index=>renderPlayer('red',index))}
      </div>

      {state.testMode==='lineup'?<section className="sim-game-center sim-lineup-center">
        <header className="sim-game-title">
          <span>INTEGRATION TEST</span>
          <strong>LINEUP SWAP</strong>
          <small>FINAL 10-PLAYER HERO OWNERSHIP</small>
        </header>
        <div className="sim-lineup-center-copy">
          <b>只测试换英雄后的最终归属</b>
          <p>先在 Simulator 控制台同步基线到 Control，再交换左右任意两名选手的英雄。</p>
          <span>BP 识别在另一个独立测试模式中，不参与这里的结果。</span>
        </div>
      </section>:<section className="sim-game-center">
        <header className="sim-game-title">
          <span>Phase</span>
          <strong>{actionLabel}</strong>
          <small>{active?((active.side==='blue'?'BLUE':'RED')+' · '+activeSlots.map(slot=>'P'+(slot.slotIndex+1)).join(' + ')):'DRAFT COMPLETE'}</small>
        </header>

        <nav className="sim-role-tabs" aria-hidden="true">
          <span>ALL</span><span>CLASH</span><span>JUNGLE</span><span>MID</span><span>FARM</span><span>ROAM</span>
        </nav>

        <div className="sim-hero-grid">
          {heroPool.map(hero=>{
            const selected=activeHeroId===hero.id&&!!active;
            return <div className={'sim-hero-cell '+(selected?'selected':'')} key={hero.id}>
              <img src={hero.imageLink} alt="" />
              <span>{hero.englishName}</span>
            </div>;
          })}
        </div>

        <div className="sim-game-actions">
          <button className="ghost">REQUEST</button>
          <button className={'primary '+(activeLocked?'locked':'')}>
            {activeLocked?'LOCKED':actionLabel.toUpperCase()}
          </button>
          <button className="ghost">PRESELECT</button>
        </div>
      </section>}

      <div className="sim-bottom-status">
        <span>{state.testMode==='lineup'?'LINEUP SWAP TEST':activeSlots.length?activeSlots.map(simulatorSlotKey).join(' + '):'DRAFT COMPLETE'}</span>
        <strong>{state.testMode==='lineup'?'FINAL HERO OWNERSHIP':activeLocked?'LOCKED / TRANSITIONED':'PRESELECT'}</strong>
        <small>F: FULLSCREEN · C: CONTROL</small>
      </div>
    </ViewportCanvas>
  </main>;
}
