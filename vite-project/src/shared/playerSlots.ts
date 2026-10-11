import type { MatchState, Side } from './types.js';

export const validPlayerSlotOrder = (value: unknown): value is number[] =>
  Array.isArray(value) && value.length === 5 && new Set(value).size === 5 &&
  value.every(index => Number.isInteger(index) && index >= 0 && index < 5);
export const normalizePlayerSlotOrder = (value: unknown) =>
  validPlayerSlotOrder(value) ? [...value] : [0,1,2,3,4];
export function playerAtSlot(state: MatchState, side: Side, slot: number) {
  const team = state[`${side}Team`];
  const index = normalizePlayerSlotOrder(state[`${side}PlayerSlotOrder`])[slot];
  return { index, id: team.players[index] || '', role: team.playerRoles[index], portrait: team.playerPortraits[index] || '' };
}

// Preserve punctuation for exact matching; confusion folding only affects similarity.
export const normalizePlayerText = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s/g,'');
function normalizedSimilarity(a:string,b:string) {
  if (!a || !b) return 0;
  const exactA=normalizePlayerText(a), exactB=normalizePlayerText(b);
  if (exactA===exactB) return 1;
  const fold=(value:string)=>value.replace(/[0o]/g,'o').replace(/[1il|]/g,'l').replace(/[5s]/g,'s').replace(/[8b]/g,'b');
  const x=[...fold(exactA)], y=[...fold(exactB)];
  let row=y.map((_,i)=>i+1);row.unshift(0);
  for(let i=1;i<=x.length;i++) {
    const next=[i];
    for(let j=1;j<=y.length;j++) next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(x[i-1]===y[j-1]?0:1));
    row=next;
  }
  return Math.max(0,1-row[y.length]/Math.max(x.length,y.length))*.96;
}

/**
 * OCR crops may include the player ID plus role/hero labels. Compare the full
 * OCR block and each visible line/token, then keep the strongest match.
 */
function similarity(ocrText:string,player:string) {
  if(!ocrText||!player)return 0;
  const variants=new Set<string>([ocrText]);
  for(const line of ocrText.split(/[\r\n]+/)) {
    const trimmed=line.trim();
    if(trimmed)variants.add(trimmed);
    for(const token of trimmed.split(/\s+/)) if(token) variants.add(token);
  }
  let best=0;
  for(const variant of variants) best=Math.max(best,normalizedSimilarity(variant,player));
  return best;
}
const permutations = (values: number[]): number[][] => values.length <= 1 ? [values] :
  values.flatMap((value,index)=>permutations(values.filter((_,i)=>i!==index)).map(rest=>[value,...rest]));
const orders = permutations([0,1,2,3,4]);
export interface PlayerSlotSolution {
  order:number[];
  confidence:number[];
  average:number;
  margin:number;
  automatic:boolean;
  anomalies:number[];
  ocrConfidence?:number[];
  ocrText?:string[];
  ocrVariant?:string[];
  verificationFrames?:number;
}
export interface PlayerOcrCandidateInput {
  text:string;
  confidence:number;
  variant?:string;
}
/** Globally solve all 120 bijections, rejecting blank/out-of-roster and ambiguous IDs. */
export function solvePlayerSlots(texts: string[], players: string[], ocrConfidence: number[] = [1,1,1,1,1]): PlayerSlotSolution | undefined {
  if (texts.length !== 5 || players.length !== 5 || players.some(p=>!normalizePlayerText(p)) || new Set(players.map(normalizePlayerText)).size !== 5) return;
  const matrix = texts.map(text=>players.map(player=>similarity(text,player)));
  const ranked = orders.map(order=>{
    const confidence=order.map((index,slot)=>matrix[slot][index]);
    return {order,confidence,average:confidence.reduce((a,b)=>a+b,0)/5};
  }).sort((a,b)=>b.average-a.average);
  const best=ranked[0], margin=best.average-ranked[1].average;
  const anomalies=best.confidence.flatMap((score,i)=>score<.80 || (ocrConfidence[i]??0)<.65 ? [i] : []);
  // A confusion-equivalent ID must still beat the runner-up; two I/l/1 IDs fail safely.
  const confidence=best.confidence.map((score,index)=>Math.min(score,ocrConfidence[index]??0));
  const average=confidence.reduce((a,b)=>a+b,0)/5;
  return {...best,confidence,average,margin,anomalies,automatic:anomalies.length===0 && average>=.90 && margin>=.06};
}


/**
 * Solve player slots from multiple OCR preprocessing candidates per row.
 * UI confidence is roster-match confidence, while raw Tesseract confidence is
 * retained separately for diagnostics. Exact/fuzzy roster matching therefore
 * does not collapse to 0% merely because the stylized font got a low OCR score.
 */
export function solvePlayerSlotCandidates(
  candidates:PlayerOcrCandidateInput[][],
  players:string[],
):PlayerSlotSolution|undefined {
  if(
    candidates.length!==5||
    players.length!==5||
    players.some(player=>!normalizePlayerText(player))||
    new Set(players.map(normalizePlayerText)).size!==5
  )return;

  const cells=candidates.map(row=>players.map(player=>{
    let best={match:0,ocr:0,text:'',variant:''};
    for(const candidate of row){
      const match=similarity(candidate.text,player);
      if(match>best.match||(match===best.match&&candidate.confidence>best.ocr)){
        best={
          match,
          ocr:Math.max(0,Math.min(1,candidate.confidence||0)),
          text:candidate.text,
          variant:candidate.variant||'',
        };
      }
    }
    return best;
  }));

  const ranked=orders.map(order=>{
    const confidence=order.map((playerIndex,slot)=>cells[slot][playerIndex].match);
    return {
      order,
      confidence,
      average:confidence.reduce((sum,value)=>sum+value,0)/5,
    };
  }).sort((a,b)=>b.average-a.average);

  const best=ranked[0];
  if(!best)return;
  const margin=best.average-(ranked[1]?.average??0);
  const chosen=best.order.map((playerIndex,slot)=>cells[slot][playerIndex]);
  const ocrConfidence=chosen.map(cell=>cell.ocr);
  const ocrText=chosen.map(cell=>cell.text);
  const ocrVariant=chosen.map(cell=>cell.variant);
  // Near-identical roster IDs (e.g. "Pemain 1"…"Pemain 5") cannot be
  // disambiguated by matching the shared prefix. A full five-player bijection
  // must not turn missing/blurred suffixes into confident automatic identities.
  const discriminativeEvidence=best.order.map((playerIndex,slot)=>{
    const chosenText=normalizePlayerText(ocrText[slot]||'');
    const target=normalizePlayerText(players[playerIndex]);
    if(!chosenText)return false;
    const rivals=players.filter((_,i)=>i!==playerIndex).map(normalizePlayerText);
    // For similar names require an exact distinguishing token, including
    // numeric suffixes. Confusion-folded OCR is not conclusive evidence.
    if(rivals.some(other=>normalizedSimilarity(target,other)>=.65)){
      return chosenText===target || chosenText.split(/[^\\p{L}\\p{N}]+/u).includes(target);
    }
    return true;
  });
  const anomalies=best.confidence.flatMap((score,index)=>{
    if(!discriminativeEvidence[index])return [index];
    if(!ocrText[index])return [index];
    if(score<.80)return [index];
    // Extremely weak OCR is acceptable only when the normalized text exactly
    // matches the known roster ID; otherwise require a small amount of OCR evidence.
    if(ocrConfidence[index]<.15&&normalizePlayerText(ocrText[index])!==normalizePlayerText(players[best.order[index]]))return [index];
    return [];
  });

  return {
    ...best,
    margin,
    anomalies,
    ocrConfidence,
    ocrText,
    ocrVariant,
    automatic:anomalies.length===0&&best.average>=.90&&margin>=.06,
  };
}
