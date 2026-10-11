export interface HeroLockStability {
  phaseKey:string;
  heroId:number|null;
  count:number;
}
export const freshHeroLockStability=():HeroLockStability=>({phaseKey:'',heroId:null,count:0});
/** Stable identity and its own positive marker must coexist in two scans. */
export function updateHeroLockStability(previous:HeroLockStability,input:{
  phaseKey:string;
  heroId?:number;
  candidateReady:boolean;
  action:'pick'|'ban';
  lockCue?:'checkmark'|'padlock'|'none';
}) {
  const heroId=input.heroId??null;
  const present=input.candidateReady&&heroId!==null&&input.lockCue===(input.action==='pick'?'checkmark':'padlock');
  const same=previous.phaseKey===input.phaseKey&&previous.heroId===heroId;
  const stability={phaseKey:input.phaseKey,heroId,count:present?(same?previous.count+1:1):0};
  return {stability,locked:stability.count>=2};
}
