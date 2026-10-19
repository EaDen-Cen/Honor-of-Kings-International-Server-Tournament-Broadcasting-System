import type { Side } from '../shared/types.js';

export interface Candidate { heroId:number; confidence:number }
export interface SlotResult {
  side: Side;
  playerIndex: number;
  preview: string;
  candidates: Candidate[];
}
export interface SolvedTeam {
  heroes: number[];
  confidence: number[];
  average: number;
  minimum: number;
}

function permutations(values:number[]):number[][] {
  if(values.length<=1) return [values];
  return values.flatMap((value,index)=>
    permutations([...values.slice(0,index),...values.slice(index+1)]).map(rest=>[value,...rest]));
}

/** A high-scoring tie is still ambiguous and must not overwrite the lineup. */
export function solveLineupTeam(slots:SlotResult[],picks:number[]):SolvedTeam|undefined {
  if(slots.length!==5||picks.length!==5||new Set(picks).size!==5)return;
  let best:SolvedTeam|undefined;
  let secondBest=-Infinity;
  for(const order of permutations(picks)) {
    const confidence=order.map((heroId,index)=>
      slots[index].candidates.find(candidate=>candidate.heroId===heroId)?.confidence ?? -1);
    if(confidence.some(value=>!Number.isFinite(value)||value<0||value>1))continue;
    const average=confidence.reduce((sum,value)=>sum+value,0)/confidence.length;
    if(!best||average>best.average){
      if(best)secondBest=best.average;
      best={heroes:order,confidence,average,minimum:Math.min(...confidence)};
    }else secondBest=Math.max(secondBest,average);
  }
  // The total score of the runner-up must trail by at least 0.075 across five
  // slots. Repeated frames cannot make an indistinguishable assignment safe.
  if(best&&best.average-secondBest>=.015)return best;
}

/** Apply only sides proven reliable; preserve the other side's authoritative
 * assignments. One team's uncertain OCR must never block a safe swap on the
 * other team, and must never write guessed hero IDs into MatchState. */
export function planTrustedLineupUpdate(
  blue:SolvedTeam|undefined,
  red:SolvedTeam|undefined,
  currentBlue:readonly (number|null)[],
  currentRed:readonly (number|null)[],
):{blue:number[];red:number[];changedBlue:boolean;changedRed:boolean;trustedBlue:boolean;trustedRed:boolean}|undefined {
  const complete=(a:readonly (number|null)[])=>a.length===5&&a.every((id):id is number=>Number.isInteger(id)&&id!==null);
  if(!complete(currentBlue)||!complete(currentRed))return;
  const trusted=(team:SolvedTeam|undefined)=>!!team&&team.heroes.length===5&&new Set(team.heroes).size===5&&team.minimum>=.50&&team.average>=.65;
  const trustedBlue=trusted(blue),trustedRed=trusted(red);
  const nextBlue=trustedBlue?blue!.heroes:[...currentBlue] as number[];
  const nextRed=trustedRed?red!.heroes:[...currentRed] as number[];
  return {
    blue:nextBlue,
    red:nextRed,
    changedBlue:trustedBlue&&nextBlue.some((id,i)=>id!==currentBlue[i]),
    changedRed:trustedRed&&nextRed.some((id,i)=>id!==currentRed[i]),
    trustedBlue,
    trustedRed,
  };
}
