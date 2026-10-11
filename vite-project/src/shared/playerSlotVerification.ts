import type {PlayerSlotSolution} from './playerSlots.js';

export interface VerificationEvidence {
  signature:string;
  frames:number;
  bestConfidence:number[];
  minMargin:number;
}

export function mergeVerification(
  previous:VerificationEvidence|undefined,
  solution:PlayerSlotSolution|undefined,
):{evidence?:VerificationEvidence;solution?:PlayerSlotSolution} {
  if(!solution)return {};
  if(solution.automatic)return {solution};
  // Repeated ambiguous suffixes are still ambiguous; never erase OCR guards.
  if(solution.anomalies.length)return {solution};

  const signature=solution.order.join(',');
  const evidence:VerificationEvidence=previous?.signature===signature
    ? {
      signature,
      frames:previous.frames+1,
      bestConfidence:solution.confidence.map((score,index)=>Math.max(score,previous.bestConfidence[index]??0)),
      minMargin:Math.min(previous.minMargin,solution.margin),
    }
    : {
      signature,
      frames:1,
      bestConfidence:[...solution.confidence],
      minMargin:solution.margin,
    };

  const average=evidence.bestConfidence.reduce((sum,value)=>sum+value,0)/evidence.bestConfidence.length;
  const verified=evidence.frames>=2
    && evidence.minMargin>=.06
    && evidence.bestConfidence.every(value=>value>=.80)
    && average>=.90;

  return {
    evidence,
    solution:verified
      ? {
        ...solution,
        confidence:evidence.bestConfidence,
        average,
        anomalies:[],
        automatic:true,
        verificationFrames:evidence.frames,
      }
      : {...solution,verificationFrames:evidence.frames},
  };
}

