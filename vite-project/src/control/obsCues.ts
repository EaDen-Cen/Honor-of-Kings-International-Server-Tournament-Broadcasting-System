import type { MatchState } from '../shared/types.js';

export const obsCueKeys=['waiting','draft','game','pause','postgame','mvp','safe'] as const;
export type ObsCue=typeof obsCueKeys[number];
export type ObsCueMap=Partial<Record<ObsCue,string>>;
export const obsCueLabels:Record<ObsCue,{zh:string;eng:string}>={
  waiting:{zh:'赛前等待',eng:'Waiting'},
  draft:{zh:'BP 选禁',eng:'Draft / BP'},
  game:{zh:'局内比赛',eng:'Game'},
  pause:{zh:'暂停/中场',eng:'Pause'},
  postgame:{zh:'赛后结算',eng:'Postgame'},
  mvp:{zh:'MVP',eng:'MVP'},
  safe:{zh:'安全画面',eng:'Safe'},
};

/** MatchState is authoritative; this function never initiates OBS actions. */
export function recommendedObsCue(state:Pick<MatchState,'currentPhase'|'draftComplete'|'committedGameId'|'activePostGameReportId'>):ObsCue {
  if(state.activePostGameReportId)return 'postgame';
  if(state.committedGameId)return 'game';
  if(state.currentPhase>0||state.draftComplete)return 'draft';
  return 'waiting';
}

/** Exact scene-name matching only: no substring/approximate guesses for live output. */
export function resolveObsCue(cue:ObsCue,scenes:string[],mapping:ObsCueMap):string|null {
  const explicit=mapping[cue];
  if(explicit!==undefined)return scenes.includes(explicit)?explicit:null;
  const aliases:Record<ObsCue,string[]>={
    waiting:['Waiting','Lobby','赛前','等待'],
    draft:['BP','Draft','Pick Ban','选禁'],
    game:['Game','Gameplay','比赛','局内'],
    pause:['Pause','Break','暂停','中场'],
    postgame:['Postgame','Post-game','赛后','结算'],
    mvp:['MVP','最佳选手'],
    safe:['Safe','Standby','安全画面'],
  };
  for(const alias of aliases[cue]){
    const scene=scenes.find(name=>name.toLowerCase()===alias.toLowerCase());
    if(scene)return scene;
  }
  return null;
}

export function parseObsCueMap(raw:string|null):ObsCueMap {
  if(!raw)return {};
  try{
    const value:unknown=JSON.parse(raw);
    if(!value||typeof value!=='object'||Array.isArray(value))return {};
    const object=value as Record<string,unknown>;
    const mapping:ObsCueMap={};
    for(const cue of obsCueKeys){
      if(typeof object[cue]==='string'&&(object[cue] as string).length<=128)mapping[cue]=object[cue] as string;
    }
    return mapping;
  }catch{return {};}
}
