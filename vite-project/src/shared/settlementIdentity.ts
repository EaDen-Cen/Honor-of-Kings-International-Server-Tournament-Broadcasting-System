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
