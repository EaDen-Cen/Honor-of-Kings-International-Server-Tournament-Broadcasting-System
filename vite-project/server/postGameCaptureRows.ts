/** Resolve a small manually-selected set of field OCR rows.
 * Legacy ten-image clients remain supported; unvalidated indexes cannot be
 * used to overwrite a different player's report row. */
export function postGameCaptureRowIds(reportRows:readonly string[],requested:unknown,images:unknown):string[]{
  if(!Array.isArray(images)||images.length<1||images.length>10)throw new Error('Select 1–10 numeric regions');
  if(requested===undefined){
    if(images.length!==reportRows.length)throw new Error('Explicit player rowIds required for partial capture');
    return [...reportRows];
  }
  if(!Array.isArray(requested)||requested.length!==images.length||requested.some(id=>typeof id!=='string'||!reportRows.includes(id))||new Set(requested).size!==requested.length)throw new Error('Invalid or duplicate post-game rowIds');
  return requested as string[];
}
