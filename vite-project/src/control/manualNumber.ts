export interface ManualNumberRules { min:number; max:number; integer?:boolean; allowEmpty?:boolean }
export type ManualNumberResult = { valid:true; value:number|undefined } | { valid:false; reason:'required'|'number'|'range'|'integer' };

/** Validate the whole draft before sending it; intermediate keystrokes never become match data. */
export function parseManualNumber(text:string,rules:ManualNumberRules):ManualNumberResult {
  if(!text.trim())return rules.allowEmpty?{valid:true,value:undefined}:{valid:false,reason:'required'};
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text.trim()))return {valid:false,reason:'number'};
  const value=Number(text);
  if(!Number.isFinite(value))return {valid:false,reason:'number'};
  if(value<rules.min||value>rules.max)return {valid:false,reason:'range'};
  if(rules.integer&&!Number.isInteger(value))return {valid:false,reason:'integer'};
  return {valid:true,value};
}
