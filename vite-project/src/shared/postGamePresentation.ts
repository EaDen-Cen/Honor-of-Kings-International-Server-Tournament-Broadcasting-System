import type {MatchState,PlayerRole} from './types.js';
import {reliableField,type PostGameMetric,type PostGamePlayer,type PostGameReport} from './postGame.js';

export const playerRoleLabel=(role:PlayerRole,zh:boolean)=>({clash:['对抗路','Clash'],jungle:['打野','Jungle'],mid:['中路','Mid'],farm:['发育路','Farm'],roam:['游走','Roam']}[role][zh?0:1]);

/** Resolve roster identity, never the screen row or P1–P5's default lane. */
export function postGamePlayerIdentity(state:MatchState,player:PostGamePlayer):PostGamePlayer {
  const team=[state.blueTeam,state.redTeam].find(team=>player.rowId===`${team.id}:${player.rosterIndex}`&&team.players[player.rosterIndex]===player.playerId);
  return team?{...player,role:team.playerRoles[player.rosterIndex]??player.role,portrait:team.playerPortraits[player.rosterIndex]??player.portrait}:player;
}
export const mvpPrimaryMetrics:Record<PlayerRole,readonly PostGameMetric[]>={
  clash:['damageTaken','participation','totalDamage'],
  jungle:['damageConversion','participation','totalDamage'],
  mid:['totalDamage','damageShare','participation'],
  farm:['totalDamage','damageConversion','towerDamage'],
  roam:['participation','healing','control'],
};
const metricFamilies:Partial<Record<PostGameMetric,string>>={
  totalDamage:'damage',damageShare:'damage',damageTaken:'taken',damageTakenShare:'taken',
  gold:'gold',goldShare:'gold',healing:'healing',healingShare:'healing',
  control:'control',controlShare:'control',towerDamage:'tower',towerDamageShare:'tower',
  jungleGold:'jungleGold',jungleGoldShare:'jungleGold',lastHits:'lastHits',lastHitsShare:'lastHits',
};
const candidates:PostGameMetric[]=['participation','damageConversion','damageShare','damageTakenShare','healingShare','controlShare','towerDamageShare','goldShare','jungleGoldShare','lastHits','totalDamage','damageTaken','healing','control','towerDamage','gold','jungleGold'];
/** Compare each metric only with same-team peers; raw gold and percentages
 * are incomparable. This chooses display highlights, never the match MVP. */
export function mvpStatSelection(player:PostGamePlayer,report:PostGameReport){
  const primary=[...mvpPrimaryMetrics[player.role]],used=new Set(primary.map(key=>metricFamilies[key]??key));
  const ranked=candidates.filter(key=>!used.has(metricFamilies[key]??key)&&reliableField(player.fields[key])).map((key,index)=>{
    const peers=report.players.filter(p=>p.side===player.side&&reliableField(p.fields[key])).map(p=>p.fields[key]!.value);
    const value=player.fields[key]!.value,max=Math.max(...peers,1);
    return {key,index,score:peers.length>=2?peers.filter(v=>v<value).length/peers.length+value/max/peers.length:-1};
  }).sort((a,b)=>b.score-a.score||a.index-b.index);
  const highlights:PostGameMetric[]=[];
  for(const {key} of ranked){const family=metricFamilies[key]??key;if(used.has(family))continue;used.add(family);highlights.push(key);if(highlights.length===3)break;}
  return {primary,highlights};
}
