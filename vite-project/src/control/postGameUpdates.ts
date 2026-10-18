import { canMergePostGameField,type PostGameField } from '../shared/postGame.js';

/** Applying a reviewed page should create history only when a trusted field can improve it. */
export function hasPostGameFieldUpdate(current:PostGameField|undefined,incoming:PostGameField){
  return canMergePostGameField(current,incoming)&&(!current||current.value!==incoming.value||incoming.confidence>current.confidence||incoming.manual&&!current.manual);
}
