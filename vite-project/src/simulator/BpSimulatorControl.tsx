import { useEffect, useMemo, useRef, useState } from 'react';
import heroes from '../components/HeroList';
import { useAccess } from '../shared/access';
import { useMatch } from '../shared/useMatch';
import { initialState, phases, type Action, type MatchSettings, type MatchState, type Side } from '../shared/types';
import {
  simulatorAllSlotKeys,
  randomizeSimulatorSlots,
  simulatorControlSync,
  simulatorPlayerOrdersMatch,
  simulatorPlayerTestRoster,
  type SimulatorPlayerProfile,
  type SimulatorTestMode,
  simulatorNextTurnPhase,
  simulatorPreviousTurnPhase,
  simulatorRandomDelayMs,
  simulatorPreselectSwitchMoments,
  simulatorSlotForPhase,
  simulatorSlotKey,
  simulatorSlotsForTurn,
  swapSimulatorPickHeroes,
} from './bpSimulatorModel';
import { useBpSimulatorState } from './bpSimulatorState';
import './bpSimulator.css';

function heroName(id:number|undefined) {
  const hero=heroes.find(item=>item.id===id);
  return hero?.chineseName||hero?.englishName||'—';
}

function unique<T>(values:T[]) {
  return [...new Set(values)];
}

function sameNumbers(a:readonly (number|null)[],b:readonly number[]) {
  return a.length===b.length&&a.every((value,index)=>value===b[index]);
}

function playerTestSettings(state:MatchState,bluePlayers:string[],redPlayers:string[]):MatchSettings {
  return {
    blueTeam:{...state.blueTeam,players:[...bluePlayers]},
    redTeam:{...state.redTeam,players:[...redPlayers]},
    blueScore:state.blueScore,
    redScore:state.redScore,
    gameNumber:state.gameNumber,
    seriesFormat:state.seriesFormat,
    stage:state.stage,
    draftMode:state.draftMode,
    draftRuleMode:state.draftRuleMode,
    flowbornFormsIndependent:state.flowbornFormsIndependent,
    firstPickSide:state.firstPickSide,
    sideSwapMode:state.sideSwapMode,
    language:state.language,
    overlayLayout:state.overlayLayout,
    scoreDisplay:state.scoreDisplay,
    bpInputMode:'screen',
    recognitionAutoAccept:state.recognitionAutoAccept,
    recognitionThreshold:state.recognitionThreshold,
    showHeroName:state.showHeroName,
    artSourceMode:state.artSourceMode,
  };
}

function lineupTestSettings(state:MatchState):MatchSettings {
  return {
    blueTeam:state.blueTeam,
    redTeam:state.redTeam,
    blueScore:state.blueScore,
    redScore:state.redScore,
    gameNumber:state.gameNumber,
    seriesFormat:state.seriesFormat,
    stage:state.stage,
    draftMode:'normal',
    draftRuleMode:'normal',
    flowbornFormsIndependent:true,
    firstPickSide:'blue',
    sideSwapMode:state.sideSwapMode,
    language:state.language,
    overlayLayout:state.overlayLayout,
    scoreDisplay:state.scoreDisplay,
    bpInputMode:'screen',
    recognitionAutoAccept:state.recognitionAutoAccept,
    recognitionThreshold:state.recognitionThreshold,
    showHeroName:state.showHeroName,
    artSourceMode:state.artSourceMode,
  };
}

function pickLineup(slotHeroes:Record<string,number>,side:Side) {
  return [0,1,2,3,4].map(index=>slotHeroes[`${side}Pick${index+1}`]);
}

function createLineupFixtureActions(slotHeroes:Record<string,number>):Action[] {
  const blue=pickLineup(slotHeroes,'blue');
  const red=pickLineup(slotHeroes,'red');
  if([...blue,...red].some(value=>!Number.isInteger(value)))throw new Error('10 个 Pick 槽必须都有英雄');
  if(new Set([...blue,...red]).size!==10)throw new Error('换英雄测试的 10 个 Pick 槽必须使用不同英雄');

  const reserved=new Set([...blue,...red]);
  const banPool=heroes.map(hero=>hero.id).filter(id=>!reserved.has(id));
  let banIndex=0;
  return phases('normal','blue').map((phase,index)=>{
    const slot=simulatorSlotForPhase('normal','blue',index)!;
    const heroId=phase.action==='pick'?slotHeroes[simulatorSlotKey(slot)]:banPool[banIndex++];
    if(!Number.isInteger(heroId))throw new Error('无法建立独立换英雄测试基线');
    return {type:'draft_action',team:phase.team,action:phase.action,heroId} as Action;
  });
}

type PlayerSetup={step:'resetting'|'syncing';blue:string[];red:string[]};
type DraftSync={
  stage:'resetting'|'settings'|'draft';
  actions:Action[];
  index:number;
  targetBlue:number[];
  targetRed:number[];
};

export function BpSimulatorControl() {
  const [state,update]=useBpSimulatorState();
  const access=useAccess('control');
  const {snapshot,status:controlStatus,error:controlError,pending:controlPending,send:sendControl,acknowledged}=useMatch('control',access.token,access.saveToken);
  const rules=snapshot?.state??initialState();
  const rulesRef=useRef(rules);
  rulesRef.current=rules;
  const [ruleError,setRuleError]=useState('');
  const [controlLink,setControlLink]=useState(()=>localStorage.getItem('hok-simulator-control-link')==='1');
  const [integrationMessage,setIntegrationMessage]=useState('');
  const [playerSetup,setPlayerSetup]=useState<PlayerSetup>();
  const [draftSync,setDraftSync]=useState<DraftSync>();
  const [lineupBaseline,setLineupBaseline]=useState<{blue:number[];red:number[]}>();
  const [swapSide,setSwapSide]=useState<Side>('blue');
  const [swapA,setSwapA]=useState(0);
  const [swapB,setSwapB]=useState(1);
  const [swapStartedAt,setSwapStartedAt]=useState<number|null>(null);
  const [swapCompletedAt,setSwapCompletedAt]=useState<number|null>(null);
  const [clock,setClock]=useState(Date.now());

  const sequence=useMemo(()=>phases(state.mode,state.firstPickSide),[state.mode,state.firstPickSide]);
  const activeSlots=simulatorSlotsForTurn(state.mode,state.firstPickSide,state.phaseIndex);
  const active=activeSlots[0];
  const activeKeys=activeSlots.map(simulatorSlotKey);
  const activeKey=activeKeys[0]??'';
  const activeLocked=activeKeys.length>0&&activeKeys.every(key=>state.locked.includes(key));

  const randomize=(current:typeof state,keys:string[],autoPlay=current.autoPlay)=>{
    try{
      const slotHeroes=randomizeSimulatorSlots(current.slotHeroes,current.mode,current.firstPickSide,rules,new Set(keys),current.emptyBans);
      setRuleError('');
      return {...current,slotHeroes,autoPlay};
    }catch(error){
      setRuleError(error instanceof Error?error.message:'No legal candidates');
      return {...current,autoPlay:false};
    }
  };

  const controlRosterMatches=!!snapshot
    && snapshot.state.blueTeam.players.every((value,index)=>value===state.bluePlayers[index])
    && snapshot.state.redTeam.players.every((value,index)=>value===state.redPlayers[index]);
  const playerOrderMatched=!!snapshot&&controlRosterMatches
    && simulatorPlayerOrdersMatch(snapshot.state.bluePlayerSlotOrder,state.bluePlayerOrder)
    && simulatorPlayerOrdersMatch(snapshot.state.redPlayerSlotOrder,state.redPlayerOrder);

  const targetBlue=pickLineup(state.slotHeroes,'blue');
  const targetRed=pickLineup(state.slotHeroes,'red');
  const targetLineupMatched=!!snapshot&&snapshot.state.draftComplete
    && sameNumbers(snapshot.state.blueAssignments,targetBlue)
    && sameNumbers(snapshot.state.redAssignments,targetRed);
  const baselineMatched=!!snapshot&&!!lineupBaseline&&snapshot.state.draftComplete
    && sameNumbers(snapshot.state.blueAssignments,lineupBaseline.blue)
    && sameNumbers(snapshot.state.redAssignments,lineupBaseline.red);

  const patch=(partial:Partial<typeof state>)=>update(current=>({...current,...partial}));

  const setTestMode=(testMode:SimulatorTestMode)=> {
    setIntegrationMessage('');
    setSwapStartedAt(null);
    setSwapCompletedAt(null);
    setLineupBaseline(undefined);
    setDraftSync(undefined);
    update(current=>({
      ...current,
      testMode,
      scene:testMode==='player-order'?'lobby':'draft',
      autoPlay:false,
      bluePlayerOrder:testMode==='player-order'?current.bluePlayerOrder:[0,1,2,3,4],
      redPlayerOrder:testMode==='player-order'?current.redPlayerOrder:[0,1,2,3,4],
      playerOrderTestStartedAt:null,
      playerOrderTestCompletedAt:null,
    }));
  };

  const resetCurrentTest=()=>{
    setIntegrationMessage('');
    setSwapStartedAt(null);
    setSwapCompletedAt(null);
    setLineupBaseline(undefined);
    setDraftSync(undefined);
    update(current=>({
      ...current,
      phaseIndex:0,
      emptyBans:[],
      locked:[],
      autoPlay:false,
      scene:current.testMode==='player-order'?'lobby':'draft',
      bluePlayerOrder:current.testMode==='player-order'?[0,1,2,3,4]:current.bluePlayerOrder,
      redPlayerOrder:current.testMode==='player-order'?[0,1,2,3,4]:current.redPlayerOrder,
      playerOrderTestStartedAt:null,
      playerOrderTestCompletedAt:null,
    }));
    if(state.testMode==='bp'&&controlLink&&snapshot&&!snapshot.state.committedGameId&&!controlPending&&controlStatus==='Connected'){
      sendControl({type:'reset_draft'});
      setIntegrationMessage('BP 测试已同时重置 Control；下一次英雄结果仍由屏幕识别产生。');
    }
  };

  const setDraftMode=(mode:typeof state.mode)=>update(current=>({...current,mode,phaseIndex:0,emptyBans:[],locked:[],autoPlay:false}));
  const setFirstPickSide=(firstPickSide:Side)=>update(current=>({...current,firstPickSide,phaseIndex:0,emptyBans:[],locked:[],autoPlay:false}));

  const toggleCurrentLock=()=>{
    if(!activeKeys.length)return;
    update(current=>{
      const currentKeys=simulatorSlotsForTurn(current.mode,current.firstPickSide,current.phaseIndex).map(simulatorSlotKey);
      const allLocked=currentKeys.length>0&&currentKeys.every(key=>current.locked.includes(key));
      return {...current,locked:allLocked?current.locked.filter(key=>!currentKeys.includes(key)):unique([...current.locked,...currentKeys])};
    });
  };

  const nextPhase=()=>{
    if(!activeKeys.length||!activeLocked)return;
    update(current=>({...current,phaseIndex:Math.min(phases(current.mode,current.firstPickSide).length,simulatorNextTurnPhase(current.mode,current.firstPickSide,current.phaseIndex))}));
  };

  const previousPhase=()=>update(current=>{
    const next=simulatorPreviousTurnPhase(current.mode,current.firstPickSide,current.phaseIndex);
    const previousKeys=simulatorSlotsForTurn(current.mode,current.firstPickSide,next).map(simulatorSlotKey);
    return {...current,phaseIndex:next,locked:current.locked.filter(item=>!previousKeys.includes(item)),autoPlay:false};
  });

  const toggleEmptyBan=()=>{
    if(!activeKey||active?.action!=='ban')return;
    update(current=>({...current,emptyBans:current.emptyBans.includes(activeKey)?current.emptyBans.filter(key=>key!==activeKey):unique([...current.emptyBans,activeKey])}));
  };

  const randomizeCurrent=()=>update(current=>randomize(current,simulatorSlotsForTurn(current.mode,current.firstPickSide,current.phaseIndex).map(simulatorSlotKey)));
  const randomizeAll=()=>update(current=>randomize(current,simulatorAllSlotKeys.filter(key=>!current.locked.includes(key))));

  const randomizeLineup=()=>update(current=>{
    const available=[...heroes];
    const slotHeroes={...current.slotHeroes};
    for(const side of ['blue','red'] as const)for(let index=0;index<5;index++){
      const pick=Math.floor(Math.random()*available.length);
      const [hero]=available.splice(pick,1);
      slotHeroes[`${side}Pick${index+1}`]=hero.id;
    }
    return {...current,slotHeroes,testMode:'lineup',scene:'draft',autoPlay:false};
  });


  const syncSimulatorFromControl=()=>{
    if(!snapshot||controlStatus!=='Connected'){
      setIntegrationMessage('Control 尚未连接，无法读取当前数据。');
      return;
    }

    const control=snapshot.state;
    if(state.testMode==='lineup'){
      if(!control.draftComplete){
        setIntegrationMessage('Control 的 BP 尚未完成；换英雄测试需要先有 10 个最终英雄。');
        return;
      }
      if(control.committedGameId){
        setIntegrationMessage('当前 Control 本局已经提交，无法继续写入换英雄结果；请进入下一局后再测试。');
        return;
      }
    }

    const synced=simulatorControlSync(control,state.slotHeroes,state.testMode==='lineup');
    update(current=>({
      ...current,
      mode:synced.mode,
      firstPickSide:synced.firstPickSide,
      phaseIndex:synced.phaseIndex,
      slotHeroes:synced.slotHeroes,
      emptyBans:state.testMode==='lineup'?[]:synced.emptyBans,
      locked:synced.locked,
      autoPlay:false,
      scene:state.testMode==='player-order'?current.scene:'draft',
      bluePlayers:synced.bluePlayers,
      redPlayers:synced.redPlayers,
      bluePlayerOrder:synced.bluePlayerOrder,
      redPlayerOrder:synced.redPlayerOrder,
      playerRosterPrepared:state.testMode==='player-order'?true:current.playerRosterPrepared,
      playerOrderTestStartedAt:null,
      playerOrderTestCompletedAt:null,
    }));

    setDraftSync(undefined);
    setSwapStartedAt(null);
    setSwapCompletedAt(null);
    if(state.testMode==='lineup'){
      if(synced.lineupBlue.length!==5||synced.lineupRed.length!==5){
        setLineupBaseline(undefined);
        setIntegrationMessage('Control 最终阵容不完整，无法建立换英雄测试基线。');
        return;
      }
      setLineupBaseline({blue:synced.lineupBlue,red:synced.lineupRed});
      setIntegrationMessage('✓ 已从 Control 读取当前最终阵容；现在可直接交换 Simulator 英雄测试自动同步。');
    }else if(state.testMode==='player-order'){
      setLineupBaseline(undefined);
      setIntegrationMessage('✓ 已从 Control 同步双方 Player ID 与当前 P1–P5 顺序。');
    }else{
      setLineupBaseline(undefined);
      setIntegrationMessage('✓ 已从 Control 同步当前 BP 模式、先手方、已完成 Ban/Pick 与进度。');
    }
  };

  const preparePlayerOrderTest=()=>{
    const roster=simulatorPlayerTestRoster(state.playerProfile);
    update(current=>({...current,testMode:'player-order',scene:'lobby',bluePlayers:roster.blue,redPlayers:roster.red,bluePlayerOrder:[0,1,2,3,4],redPlayerOrder:[0,1,2,3,4],playerRosterPrepared:!controlLink,playerOrderTestStartedAt:null,playerOrderTestCompletedAt:null,phaseIndex:0,locked:[],emptyBans:[],autoPlay:false}));
    setIntegrationMessage('');
    if(!controlLink)return;
    if(!snapshot||controlStatus!=='Connected'||controlPending){setIntegrationMessage('Control 尚未准备好，无法同步测试名单。');return;}
    if(snapshot.state.committedGameId){setIntegrationMessage('当前 Control 已提交本局；请进入下一局或重置比赛后再测试。');return;}
    setPlayerSetup({step:'resetting',blue:roster.blue,red:roster.red});
    sendControl({type:'reset_draft'});
    setIntegrationMessage('正在重置 Control，并同步 10 个测试 Player ID…');
  };

  const syncLineupToControl=()=>{
    if(!controlLink){setIntegrationMessage('请先开启 Control 联动测试。');return;}
    if(!snapshot||controlStatus!=='Connected'||controlPending){setIntegrationMessage('Control 尚未准备好。');return;}
    if(snapshot.state.committedGameId){setIntegrationMessage('当前 Control 已提交本局；请进入下一局或重置比赛。');return;}
    try{
      const actions=createLineupFixtureActions(state.slotHeroes);
      const blue=pickLineup(state.slotHeroes,'blue');
      const red=pickLineup(state.slotHeroes,'red');
      setDraftSync({stage:'resetting',actions,index:0,targetBlue:blue,targetRed:red});
      setLineupBaseline(undefined);
      setSwapStartedAt(null);
      setSwapCompletedAt(null);
      update(current=>({...current,testMode:'lineup',scene:'draft',phaseIndex:phases('normal','blue').length,locked:[...simulatorAllSlotKeys],autoPlay:false}));
      sendControl({type:'reset_draft'});
      setIntegrationMessage('正在把 Simulator 的 10 个英雄配置装载到 Control；这一步不经过 BP 识别。');
    }catch(error){
      setIntegrationMessage(error instanceof Error?error.message:'无法同步英雄配置');
    }
  };

  const swapPicks=()=>{
    if(swapStartedAt&&!swapCompletedAt){setIntegrationMessage('上一轮换英雄仍在识别中，请等待 Control 同步完成。');return;}
    if(!baselineMatched){setIntegrationMessage('请先建立一致基线：可“从 Control 同步模拟器数据”，或把 Simulator 配置同步到 Control。');return;}
    update(current=>({...current,testMode:'lineup',scene:'draft',slotHeroes:swapSimulatorPickHeroes(current.slotHeroes,swapSide,swapA,swapB)}));
    setSwapStartedAt(Date.now());
    setSwapCompletedAt(null);
    setIntegrationMessage('已改变 Simulator 画面；正在等待 Control 通过换英雄识别更新 assignments。');
  };

  useEffect(()=>{
    if(!playerSetup||playerSetup.step!=='resetting'||acknowledged?.action.type!=='reset_draft'||controlPending)return;
    sendControl({type:'settings',settings:playerTestSettings(rules,playerSetup.blue,playerSetup.red)});
    setPlayerSetup({...playerSetup,step:'syncing'});
    setIntegrationMessage('Control 已重置，正在同步测试队伍名单…');
  },[acknowledged,controlPending,playerSetup,rules,sendControl]);

  useEffect(()=>{
    if(!playerSetup||playerSetup.step!=='syncing'||!snapshot)return;
    const blueOk=snapshot.state.blueTeam.players.every((value,index)=>value===playerSetup.blue[index]);
    const redOk=snapshot.state.redTeam.players.every((value,index)=>value===playerSetup.red[index]);
    if(!blueOk||!redOk)return;
    update(current=>({...current,playerRosterPrepared:true}));
    setPlayerSetup(undefined);
    setIntegrationMessage('测试名单已同步到 Control。请在采集页的房间等待画面点击 START。');
  },[playerSetup,snapshot,update]);

  useEffect(()=>{
    if(!draftSync||!acknowledged||controlPending)return;
    if(draftSync.stage==='resetting'&&acknowledged.action.type==='reset_draft'){
      sendControl({type:'settings',settings:lineupTestSettings(rules)});
      setDraftSync({...draftSync,stage:'settings'});
      setIntegrationMessage('Control 已重置，正在建立独立换英雄测试基线…');
      return;
    }
    if(draftSync.stage==='settings'&&acknowledged.action.type==='settings'){
      const first=draftSync.actions[0];
      if(!first)return;
      sendControl(first);
      setDraftSync({...draftSync,stage:'draft',index:0});
      return;
    }
    if(draftSync.stage==='draft'){
      const expected=draftSync.actions[draftSync.index];
      if(!expected||JSON.stringify(acknowledged.action)!==JSON.stringify(expected))return;
      const nextIndex=draftSync.index+1;
      if(nextIndex<draftSync.actions.length){
        sendControl(draftSync.actions[nextIndex]);
        setDraftSync({...draftSync,index:nextIndex});
      }else{
        setLineupBaseline({blue:draftSync.targetBlue,red:draftSync.targetRed});
        setDraftSync(undefined);
        setIntegrationMessage('✓ Control 已完成独立测试基线。现在交换 Simulator 英雄即可单独测试换英雄识别。');
      }
    }
  },[acknowledged,controlPending,draftSync,rules,sendControl]);

  useEffect(()=>{
    if(!state.playerOrderTestStartedAt||state.playerOrderTestCompletedAt||!playerOrderMatched)return;
    update(current=>({...current,playerOrderTestCompletedAt:Date.now()}));
  },[playerOrderMatched,state.playerOrderTestCompletedAt,state.playerOrderTestStartedAt,update]);

  useEffect(()=>{
    if(!swapStartedAt||swapCompletedAt||!targetLineupMatched)return;
    const completed=Date.now();
    setSwapCompletedAt(completed);
    setLineupBaseline({blue:targetBlue,red:targetRed});
    setIntegrationMessage('✓ Control 已从画面同步新的英雄归属。');
  },[swapCompletedAt,swapStartedAt,targetLineupMatched,targetBlue,targetRed]);

  useEffect(()=>{
    if(controlError&&draftSync){
      setDraftSync(undefined);
      setLineupBaseline(undefined);
      setIntegrationMessage(`英雄配置同步失败：${controlError}`);
    }
  },[controlError,draftSync]);

  useEffect(()=>{
    if((state.playerOrderTestStartedAt&&!state.playerOrderTestCompletedAt)||(swapStartedAt&&!swapCompletedAt)){
      const timer=window.setInterval(()=>setClock(Date.now()),50);
      return()=>window.clearInterval(timer);
    }
    setClock(Date.now());
  },[state.playerOrderTestStartedAt,state.playerOrderTestCompletedAt,swapStartedAt,swapCompletedAt]);

  useEffect(()=>{
    if(state.testMode!=='bp'||!state.autoPlay||state.phaseIndex>=sequence.length)return;

    if(activeLocked){
      const timer=window.setTimeout(()=>{
        update(current=>{
          const currentSequence=phases(current.mode,current.firstPickSide);
          const next=Math.min(currentSequence.length,simulatorNextTurnPhase(current.mode,current.firstPickSide,current.phaseIndex));
          return {...current,phaseIndex:next,autoPlay:next<currentSequence.length&&current.autoPlay};
        });
      },state.transitionHoldMs);
      return()=>window.clearTimeout(timer);
    }

    const thinkingMs=simulatorRandomDelayMs(state.intervalMinMs,state.intervalMaxMs);
    const timers:number[]=[];
    if(state.preselectSwitching){
      const moments=simulatorPreselectSwitchMoments(thinkingMs);
      for(const moment of moments){
        timers.push(window.setTimeout(()=>{
          update(current=>{
            const slots=simulatorSlotsForTurn(current.mode,current.firstPickSide,current.phaseIndex);
            const keys=slots.map(simulatorSlotKey).filter(key=>!current.emptyBans.includes(key));
            if(!keys.length||keys.every(key=>current.locked.includes(key)))return current;
            try{
              return {
                ...current,
                slotHeroes:randomizeSimulatorSlots(
                  current.slotHeroes,
                  current.mode,
                  current.firstPickSide,
                  rulesRef.current,
                  new Set(keys),
                  current.emptyBans,
                ),
              };
            }catch{
              return current;
            }
          });
        },moment));
      }
    }

    timers.push(window.setTimeout(()=>{
      update(current=>{
        const currentSlots=simulatorSlotsForTurn(current.mode,current.firstPickSide,current.phaseIndex);
        if(!currentSlots.length)return {...current,autoPlay:false};
        const keys=currentSlots.map(simulatorSlotKey);
        return {...current,locked:unique([...current.locked,...keys])};
      });
    },thinkingMs));

    return()=>timers.forEach(timer=>window.clearTimeout(timer));
  },[
    activeLocked,
    sequence.length,
    state.autoPlay,
    state.firstPickSide,
    state.intervalMaxMs,
    state.intervalMinMs,
    state.mode,
    state.phaseIndex,
    state.preselectSwitching,
    state.testMode,
    state.transitionHoldMs,
    update,
  ]);

  const playerElapsed=state.playerOrderTestStartedAt?(state.playerOrderTestCompletedAt??clock)-state.playerOrderTestStartedAt:null;
  const swapElapsed=swapStartedAt?(swapCompletedAt??clock)-swapStartedAt:null;

  const renderPickEditor=(side:Side,index:number)=>{
    const key=`${side}Pick${index+1}`;
    return <label className="sim-roster-editor" key={key}>
      <span>{side==='blue'?'蓝':'红'} P{index+1}</span>
      <select value={state.slotHeroes[key]??''} onChange={event=>{
        setLineupBaseline(undefined);
        setSwapStartedAt(null);
        setSwapCompletedAt(null);
        update(current=>({...current,slotHeroes:{...current.slotHeroes,[key]:Number(event.target.value)}}));
      }}>
        {heroes.map(hero=><option key={hero.id} value={hero.id}>{hero.chineseName} · {hero.englishName}</option>)}
      </select>
    </label>;
  };

  return <main className="bp-simulator-control-page">
    <header className="sim-control-page-header">
      <div>
        <h1>HOK Broadcast Simulator</h1>
        <p>三个测试完全独立：选手 ID 只测 P1–P5 排序；BP 模拟只测 Draft 识别；角色交换只测最终英雄归属。</p>
      </div>
      <div className="sim-control-page-links">
        <button onClick={()=>window.open('/tools/bp-simulator','hok-bp-simulator-stage')}>打开 / 聚焦采集画面</button>
        <button onClick={resetCurrentTest}>重置当前测试</button>
      </div>
    </header>

    <section className="sim-test-suite">
      <div className="sim-test-tabs" role="tablist" aria-label="Simulator test mode">
        <button className={state.testMode==='player-order'?'active':''} onClick={()=>setTestMode('player-order')}><b>1</b> 选手 ID 排序</button>
        <button className={state.testMode==='bp'?'active':''} onClick={()=>setTestMode('bp')}><b>2</b> BP 模拟</button>
        <button className={state.testMode==='lineup'?'active':''} onClick={()=>setTestMode('lineup')}><b>3</b> 角色交换</button>
      </div>
      <div className="sim-integration-bar">
        <label><input type="checkbox" checked={controlLink} onChange={event=>{
          const enabled=event.target.checked;
          setControlLink(enabled);
          localStorage.setItem('hok-simulator-control-link',enabled?'1':'0');
          setIntegrationMessage(enabled?'已启用 Control 联动测试。':'已关闭 Control 联动；Simulator 不会主动修改 Control。');
        }}/> Control 联动测试</label>
        <span className={controlStatus==='Connected'?'ok':'warn'}>{controlStatus}</span>
        <button className="secondary" disabled={!snapshot||controlStatus!=='Connected'} onClick={syncSimulatorFromControl}>从 Control 同步模拟器数据</button>
        <small>“从 Control 同步”只读取当前比赛状态，不会修改 Control；需要反向写入测试基线时再开启联动。</small>
      </div>
      {(integrationMessage||controlError)&&<p className="sim-integration-message" role="status">{integrationMessage||controlError}</p>}
    </section>

    <section className="sim-control-panel sim-visual-size-panel">
      <div className="sim-visual-size-heading">
        <div>
          <h2>采集画面尺寸</h2>
          <p className="sim-control-note">实时调整 Simulator 采集页中的 Pick 头像与 Ban 位大小。设置会自动保存；Pick 头像大小同时用于 BP、换英雄和 Player ID 测试。</p>
        </div>
        <button className="secondary" onClick={()=>patch({pickSize:72,banSize:38})}>恢复默认</button>
      </div>

      <div className="sim-visual-size-grid">
        <label className="sim-size-control">
          <span>Pick 头像大小</span>
          <input
            type="range"
            min={48}
            max={104}
            step={1}
            value={state.pickSize}
            onChange={event=>patch({pickSize:Number(event.target.value)})}
          />
          <input
            type="number"
            min={48}
            max={104}
            step={1}
            value={state.pickSize}
            onChange={event=>patch({pickSize:Number(event.target.value)})}
          />
          <strong>{state.pickSize}px</strong>
        </label>

        <label className="sim-size-control">
          <span>Ban 位大小</span>
          <input
            type="range"
            min={24}
            max={64}
            step={1}
            value={state.banSize}
            onChange={event=>patch({banSize:Number(event.target.value)})}
          />
          <input
            type="number"
            min={24}
            max={64}
            step={1}
            value={state.banSize}
            onChange={event=>patch({banSize:Number(event.target.value)})}
          />
          <strong>{state.banSize}px</strong>
          <small>{state.testMode==='bp'?'当前 BP 采集页实时生效':'Ban 位只在 BP 识别测试中显示'}</small>
        </label>
      </div>
    </section>

    {state.testMode==='bp'&&<>
      <section className="sim-control-panel sim-test-intro">
        <div><span>BP RECOGNITION</span><h2>完整 Ban / Pick 屏幕识别</h2><p>这个模式只测试 Draft 流程。Control 从 Phase 0 开始跟随 Simulator 画面记录 Ban/Pick；不会自动装载英雄答案。</p></div>
      </section>
      <section className="sim-control-panel">
        <h2>BP 比赛与阶段</h2>
        <p className="sim-control-note">{snapshot?'已连接 Control，随机选角可参考当前比赛规则。':'未连接 Control，按普通 BP 规则模拟。'}</p>
        {ruleError&&<p role="alert">{ruleError}</p>}
        <div className="sim-control-grid separated">
          <label>BP 模式<select value={state.mode} onChange={event=>setDraftMode(event.target.value as typeof state.mode)}><option value="match">Match · 4 Ban</option><option value="normal">Normal · 2 Ban</option></select></label>
          <label>先手方<select value={state.firstPickSide} onChange={event=>setFirstPickSide(event.target.value as Side)}><option value="blue">蓝方</option><option value="red">红方</option></select></label>
          <div className="sim-interval-range"><span>自动脚本随机等待</span>
            <label>最短<input type="number" min={0.3} max={15} step={0.1} value={(state.intervalMinMs/1000).toFixed(1)} onChange={event=>patch({intervalMinMs:Math.round(Number(event.target.value)*1000)})}/><small>秒</small></label>
            <span className="sim-range-separator">—</span>
            <label>最长<input type="number" min={0.3} max={15} step={0.1} value={(state.intervalMaxMs/1000).toFixed(1)} onChange={event=>patch({intervalMaxMs:Math.round(Number(event.target.value)*1000)})}/><small>秒</small></label>
          </div>
          <label className="sim-checkbox-control"><span>随机切换预选英雄</span><input type="checkbox" checked={state.preselectSwitching} onChange={event=>patch({preselectSwitching:event.target.checked})}/><small>锁定前随机换候选，最后至少留约 1.2 秒稳定窗口</small></label>
          <label>锁定后画面保留
            <input type="number" min={0.5} max={2.5} step={0.1} value={(state.transitionHoldMs/1000).toFixed(1)} onChange={event=>patch({transitionHoldMs:Math.round(Number(event.target.value)*1000)})}/>
            <span>{(state.transitionHoldMs/1000).toFixed(1)} 秒</span>
          </label>
        </div>

        <div className="sim-phase-readout">
          <strong>{active?(active.side==='blue'?'蓝方':'红方')+' · '+(active.action==='ban'?'BAN ':'PICK ')+activeSlots.map(slot=>(active.action==='ban'?'B':'P')+(slot.slotIndex+1)).join(' + '):'BP 已完成'}</strong>
          <span>Phase {Math.min(state.phaseIndex+1,sequence.length)}/{sequence.length}</span>
          <span className={activeLocked?'locked':'unlocked'}>{activeLocked?'LOCKED':'PRESELECT'}</span>
        </div>

        <div className="sim-actions large">
          <button onClick={previousPhase} disabled={state.phaseIndex<=0}>← 上一步</button>
          <button onClick={toggleCurrentLock} disabled={!activeKeys.length}>{activeLocked?'解除当前组锁定':'锁定当前组'}</button>
          <button onClick={toggleEmptyBan} disabled={active?.action!=='ban'} className={activeKey&&state.emptyBans.includes(activeKey)?'active':''}>切换空 Ban</button>
          <button onClick={nextPhase} disabled={!activeKeys.length||!activeLocked}>下一轮 →</button>
          <button onClick={()=>update(current=>current.autoPlay?{...current,autoPlay:false}:randomize(current,simulatorAllSlotKeys.filter(key=>!current.locked.includes(key)),true))} className={state.autoPlay?'active':''}>{state.autoPlay?'暂停自动脚本':'启动自动脚本'}</button>
        </div>
      </section>

      <section className="sim-control-panel">
        <h2>当前 BP 预选</h2>
        <div className="sim-current-pick-group">
          {activeSlots.map(slot=>{
            const key=simulatorSlotKey(slot);
            return <label key={key}>{slot.action==='ban'?'B':'P'}{slot.slotIndex+1}<select value={state.slotHeroes[key]??''} disabled={activeLocked} onChange={event=>update(current=>({...current,slotHeroes:{...current.slotHeroes,[key]:Number(event.target.value)}}))}>{heroes.map(hero=><option key={hero.id} value={hero.id}>{hero.chineseName} · {hero.englishName}</option>)}</select></label>;
          })}
          <button onClick={randomizeCurrent} disabled={!activeKeys.length||activeLocked}>随机当前组</button>
          <button onClick={randomizeAll}>随机完整 BP 配置</button>
        </div>
      </section>
    </>}

    {state.testMode==='lineup'&&<>
      <section className="sim-control-panel sim-test-intro lineup">
        <div><span>LINEUP SWAP</span><h2>独立换英雄识别测试</h2><p>不跑 BP 识别。先配置 10 个最终英雄，再用按钮直接把同一基线装载进 Control；之后只测试交换英雄后的自动同步。</p></div>
      </section>

      <section className="sim-control-panel">
        <div className="sim-lineup-heading">
          <div><h2>① 配置最终 10 人英雄</h2><p className="sim-control-note">这些是换人前的 Ground Truth。同步按钮会用真实 Control Action 建立一局已完成的测试 Draft。</p></div>
          <button onClick={randomizeLineup}>随机 10 个不同英雄</button>
        </div>
        <div className="sim-roster-editors sim-lineup-editors">
          <div>{[0,1,2,3,4].map(index=>renderPickEditor('blue',index))}</div>
          <div>{[0,1,2,3,4].map(index=>renderPickEditor('red',index))}</div>
        </div>
      </section>

      <section className="sim-control-panel sim-lineup-sync-panel">
        <div>
          <h2>② 建立一致基线</h2>
          <p className="sim-control-note">推荐直接点顶部“从 Control 同步模拟器数据”，复用当前已完成的真实/测试 Draft；也可以用下方按钮反向把 Simulator 的 10 个英雄装载到 Control。两种方式都不计入换英雄识别时间。</p>
        </div>
        <button className="sim-primary-action" disabled={!controlLink||controlStatus!=='Connected'||controlPending||!!draftSync} onClick={syncLineupToControl}>{draftSync?'正在同步…':'同步 Simulator 英雄配置到 Control'}</button>
        <div className={`sim-test-result ${baselineMatched?'success':''}`}>
          <strong>{baselineMatched?'✓ 基线一致':'等待基线同步'}</strong>
          <span>{baselineMatched?'READY':'—'}</span>
          <small>{snapshot?.state.draftComplete?'Control Draft complete':'Control Draft 尚未完成'} · {baselineMatched?'10 个英雄一致':'尚未匹配 Simulator 配置'}</small>
        </div>
      </section>

      <section className="sim-control-panel">
        <h2>③ 只测试换英雄</h2>
        <div className="sim-swap-row">
          <label>队伍<select value={swapSide} disabled={Boolean(swapStartedAt&&!swapCompletedAt)} onChange={event=>setSwapSide(event.target.value as Side)}><option value="blue">蓝方</option><option value="red">红方</option></select></label>
          <label>选手 A<select value={swapA} disabled={Boolean(swapStartedAt&&!swapCompletedAt)} onChange={event=>setSwapA(Number(event.target.value))}>{[0,1,2,3,4].map(index=><option key={index} value={index}>P{index+1} · {heroName(state.slotHeroes[`${swapSide}Pick${index+1}`])}</option>)}</select></label>
          <span className="sim-swap-arrow">⇄</span>
          <label>选手 B<select value={swapB} disabled={Boolean(swapStartedAt&&!swapCompletedAt)} onChange={event=>setSwapB(Number(event.target.value))}>{[0,1,2,3,4].map(index=><option key={index} value={index}>P{index+1} · {heroName(state.slotHeroes[`${swapSide}Pick${index+1}`])}</option>)}</select></label>
          <button onClick={swapPicks} disabled={swapA===swapB||!baselineMatched||Boolean(swapStartedAt&&!swapCompletedAt)}>交换并开始计时</button>
        </div>
        <div className={`sim-test-result ${swapCompletedAt?'success':''}`}>
          <strong>{!swapStartedAt?'等待交换':swapCompletedAt?'✓ Control 已识别新英雄归属':'等待 Control 从画面识别…'}</strong>
          <span>{swapElapsed===null?'—':(swapElapsed/1000).toFixed(3)+' s'}</span>
          <small>{targetLineupMatched?'当前 10 个 assignments 与 Simulator 一致':'Control 尚未同步当前画面'}</small>
        </div>
      </section>
    </>}

    {state.testMode==='player-order'&&<section className="sim-control-panel sim-player-order-test">
      <div className="sim-test-intro-inline"><span>PLAYER ORDER</span><h2>自定义房间 → BP 的 P1–P5 排序测试</h2></div>
      <p className="sim-control-note">只同步赛前 10 人名单；START 后蓝红各自在本队内部随机位置。Control 必须从 BP 画面 OCR 出真实顺序，Ground Truth 不会直接写入。</p>
      <div className="sim-player-test-toolbar">
        <label>ID 压力测试集<select value={state.playerProfile} onChange={event=>patch({playerProfile:event.target.value as SimulatorPlayerProfile,playerRosterPrepared:false,scene:'lobby'})}><option value="mixed">混合：英文 + 简中</option><option value="latin">英文 / 数字 / 符号</option><option value="zh">简体中文</option><option value="confusable">OCR 易混淆：O/0、I/l/1、S/5</option><option value="ja">日文假名（需 jpn OCR 模型）</option></select></label>
        <button disabled={controlLink&&(controlPending||controlStatus!=='Connected')} onClick={preparePlayerOrderTest}>① 随机 10 个 ID / 准备房间</button>
        <button onClick={()=>window.open('/tools/bp-simulator','hok-bp-simulator-stage')}>② 打开房间采集页</button>
      </div>
      <div className="sim-player-ground-truth">
        <div className="blue"><b>BLUE · Ground truth</b>{state.bluePlayerOrder.map((rosterIndex,slot)=><div key={slot}><span>P{slot+1}</span><strong>{state.bluePlayers[rosterIndex]}</strong><small>roster #{rosterIndex+1}</small></div>)}</div>
        <div className="red"><b>RED · Ground truth</b>{state.redPlayerOrder.map((rosterIndex,slot)=><div key={slot}><span>P{slot+1}</span><strong>{state.redPlayers[rosterIndex]}</strong><small>roster #{rosterIndex+1}</small></div>)}</div>
      </div>
      <div className={`sim-test-result ${state.playerOrderTestCompletedAt?'success':''}`}>
        <strong>{!state.playerOrderTestStartedAt?'等待房间 START':state.playerOrderTestCompletedAt?'✓ Control 顺序已完全同步':'识别计时中…'}</strong>
        <span>{playerElapsed===null?'—':(playerElapsed/1000).toFixed(3)+' s'}</span>
        <small>{controlRosterMatches?'测试名单一致':'Control 名单尚未同步'} · {playerOrderMatched?'P1–P5 匹配':'等待 P1–P5'}</small>
      </div>
      {state.playerProfile==='ja'&&<p className="sim-control-note">默认 OCR 为 eng + chi_sim；日文只有配置 jpn traineddata 后才应作为正式通过项。</p>}
    </section>}
  </main>;
}
