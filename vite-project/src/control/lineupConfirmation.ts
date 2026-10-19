import type { MatchState, Side } from '../shared/types.js';
import { lineupIdentityContext, lineupWriteContext } from '../shared/lineupContext.js';
import { solveLineupTeam, type SlotResult } from './lineupRecognition.js';

export type SolvedLineup=NonNullable<ReturnType<typeof solveLineupTeam>>;
export interface LineupTarget { blue:number[];red:number[] }
export interface LineupCandidate {
  results:SlotResult[];
  blue?:SolvedLineup;
  red?:SolvedLineup;
  identityContext:string;
  writeContext:string;
  signature:string;
  stableCount:number;
}
export interface LineupSubmission {
  id:string;
  target:LineupTarget;
  identityContext:string;
  expectedContext:string;
  baseRevision:number;
  submittedAt:number;
  phase:'submitting'|'applied'|'rejected'|'unconfirmed'|'expired';
  origin?:'manual'|'recognition';
  acknowledgedRevision?:number;
  error?:string;
}
interface Feedback {
  id:string;
  status:'pending'|'acknowledged'|'rejected'|'unconfirmed';
  error?:string;
  revision?:number;
}

export const sameLineup=(a:readonly(number|null)[],b:readonly number[])=>a.length===b.length&&a.every((value,index)=>value===b[index]);
export const lineupTargetMatches=(target:LineupTarget,state:MatchState)=>sameLineup(state.blueAssignments,target.blue)&&sameLineup(state.redAssignments,target.red);
export const trustedLineup=(solution:SolvedLineup|undefined):solution is SolvedLineup=>!!solution&&Number.isFinite(solution.minimum)&&Number.isFinite(solution.average)&&solution.minimum>=.50&&solution.average>=.65;
export const validLineupOrder=(order:readonly(number|null)[],picks:readonly number[]):order is number[]=>order.length===5&&picks.length===5&&new Set(order).size===5&&new Set(picks).size===5&&order.every(value=>value!==null&&picks.includes(value));

/** A manual one-team review may retain the other team's legal saved lineup.
 * OCR below the original thresholds never supplies the other team's heroes. */
export function reviewedLineupTarget(candidate:LineupCandidate,state:MatchState,side?:Side):LineupTarget|undefined{
  if(candidate.writeContext!==lineupWriteContext(state))return;
  const blue=side==='red'?state.blueAssignments:trustedLineup(candidate.blue)?candidate.blue.heroes:undefined;
  const red=side==='blue'?state.redAssignments:trustedLineup(candidate.red)?candidate.red.heroes:undefined;
  if(!blue||!red||!validLineupOrder(blue,state.bluePicks)||!validLineupOrder(red,state.redPicks))return;
  return {blue:[...blue],red:[...red]};
}

/** Sending is not saving. Both the matching ACK and its authoritative snapshot
 * must confirm this game's exact roster/slot context and target assignment. */
export function reconcileLineupSubmission(submission:LineupSubmission,state:MatchState,revision:number,feedback:Feedback|undefined,now=Date.now()):LineupSubmission{
  if(submission.identityContext!==lineupIdentityContext(state))return {...submission,phase:'expired',error:'Lineup context changed; scan again'};
  if(submission.phase==='applied')return lineupTargetMatches(submission.target,state)?submission:{...submission,phase:'expired',error:'Saved lineup changed after confirmation; review again'};
  if(submission.phase==='expired'||submission.phase==='rejected')return submission;
  const matching=feedback?.id===submission.id?feedback:undefined;
  if(matching?.status==='rejected')return {...submission,phase:'rejected',error:matching.error||'Server rejected the lineup'};
  if(matching?.status==='unconfirmed')return {...submission,phase:'unconfirmed',error:matching.error||'Connection lost or confirmation timed out; verify saved lineup'};
  const acknowledgedRevision=matching?.status==='acknowledged'?matching.revision:submission.acknowledgedRevision;
  if(acknowledgedRevision!==undefined&&acknowledgedRevision>submission.baseRevision&&revision>=acknowledgedRevision&&lineupTargetMatches(submission.target,state)){
    return {...submission,phase:'applied',acknowledgedRevision,error:undefined};
  }
  if(now-submission.submittedAt>=10000)return {...submission,phase:'unconfirmed',acknowledgedRevision,error:acknowledgedRevision!==undefined?'ACK received, but the saved lineup has not been verified':'Confirmation timed out; verify saved lineup before retrying'};
  return acknowledgedRevision===undefined?submission:{...submission,acknowledgedRevision,error:'ACK received; waiting for the matching saved lineup'};
}
