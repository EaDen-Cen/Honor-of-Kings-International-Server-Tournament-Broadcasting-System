/** One verified screen-row mapping per game, reused by every statistics page.
 * A fresh OCR pass can suggest new names, but must never silently reorder
 * previously approved rows. The operator can change any row explicitly.
 */
export interface SettlementIdentityRow { screenRow:number; rowId:string|null }
export function mergeSettlementIdentityMapping(existing:Record<string,string>,rows:SettlementIdentityRow[]){
  const next={...existing};
  for(const row of rows){
    if(!Number.isInteger(row.screenRow)||row.screenRow<0||row.screenRow>=10)continue;
    const key=String(row.screenRow);
    if(!next[key]&&row.rowId)next[key]=row.rowId;
  }
  return next;
}

/** Default settlement screen row P1–P5 to the same team's authoritative
 * player slot P1–P5. Explicit per-report operator corrections take precedence. */
export function defaultSettlementIdentityMapping(
  players:readonly {rowId:string;side:'blue'|'red';slot:number}[],
  leftSide:'blue'|'red',
  saved:Record<string,string>={},
):Record<string,string>{
  const next:Record<string,string>={};
  const sides=leftSide==='blue'?['blue','red'] as const:['red','blue'] as const;
  for(let group=0;group<2;group++){
    for(let slot=0;slot<5;slot++){
      const player=players.find(p=>p.side===sides[group]&&p.slot===slot);
      if(player)next[String(group*5+slot)]=player.rowId;
    }
  }
  // Keep only valid saved corrections on the corresponding side; reject
  // duplicates so a stale mapping cannot silently bind two OCR rows together.
  for(const [key,rowId] of Object.entries(saved)){
    const index=Number(key);
    if(!Number.isInteger(index)||index<0||index>=10)continue;
    const side=sides[index<5?0:1];
    if(players.some(p=>p.rowId===rowId&&p.side===side))next[key]=rowId;
  }
  return next;
}
