import { phases, type MatchState, type Side } from './types.js';
import { defaultBansForMode,type BanCount } from './heroPool.js';

export interface DraftTurn {
  startPhase:number;
  endPhaseExclusive:number;
  team:Side;
  action:'ban'|'pick';
  phaseIndexes:number[];
}

/**
 * Groups the still-unrecorded phases that the game exposes at the same time.
 *
 * HOK keeps bans atomic, but consecutive same-team pick phases are simultaneous
 * in the client (for example R P1+P2 and B P2+P3 in Match BP).
 *
 * The function intentionally groups forward from currentPhase only. If a manual
 * action already consumed the first pick of a double-pick turn, the remaining
 * phase is treated as a one-slot remainder rather than rewinding state.
 */
export function draftTurnAtPhase(
  mode:MatchState['draftMode'],
  firstPickSide:Side,
  phaseIndex:number,
  banCount:BanCount=defaultBansForMode(mode),
):DraftTurn|undefined {
  const sequence=phases(mode,firstPickSide,banCount);
  const first=sequence[phaseIndex];
  if(!first) return undefined;

  let end=phaseIndex+1;
  if(first.action==='pick') {
    while(
      end<sequence.length
      && sequence[end].action==='pick'
      && sequence[end].team===first.team
    ) end++;
  }

  return {
    startPhase:phaseIndex,
    endPhaseExclusive:end,
    team:first.team,
    action:first.action,
    phaseIndexes:Array.from({length:end-phaseIndex},(_,index)=>phaseIndex+index),
  };
}

export function nextDraftTurn(
  mode:MatchState['draftMode'],
  firstPickSide:Side,
  phaseIndex:number,
  banCount:BanCount=defaultBansForMode(mode),
) {
  const current=draftTurnAtPhase(mode,firstPickSide,phaseIndex,banCount);
  return current ? draftTurnAtPhase(mode,firstPickSide,current.endPhaseExclusive,banCount) : undefined;
}


export function nextOpponentPickTurn(
  mode:MatchState['draftMode'],
  firstPickSide:Side,
  phaseIndex:number,
  banCount:BanCount=defaultBansForMode(mode),
) {
  const current=draftTurnAtPhase(mode,firstPickSide,phaseIndex,banCount);
  if(!current||current.action!=='pick') return undefined;
  const sequence=phases(mode,firstPickSide,banCount);
  for(let cursor=current.endPhaseExclusive;cursor<sequence.length;cursor++){
    const phase=sequence[cursor];
    if(phase.action==='pick'&&phase.team!==current.team) return draftTurnAtPhase(mode,firstPickSide,cursor,banCount);
  }
  return undefined;
}

export function immediateNextTurnIsBan(
  mode:MatchState['draftMode'],
  firstPickSide:Side,
  phaseIndex:number,
  banCount:BanCount=defaultBansForMode(mode),
) {
  return nextDraftTurn(mode,firstPickSide,phaseIndex,banCount)?.action==='ban';
}

export function previousDraftTurnStart(
  mode:MatchState['draftMode'],
  firstPickSide:Side,
  phaseIndex:number,
  banCount:BanCount=defaultBansForMode(mode),
) {
  if(phaseIndex<=0) return 0;
  const sequence=phases(mode,firstPickSide,banCount);
  let cursor=0;
  let previous=0;
  while(cursor<Math.min(phaseIndex,sequence.length)) {
    previous=cursor;
    const turn=draftTurnAtPhase(mode,firstPickSide,cursor,banCount);
    if(!turn||turn.endPhaseExclusive>=phaseIndex) break;
    cursor=turn.endPhaseExclusive;
  }
  return previous;
}
