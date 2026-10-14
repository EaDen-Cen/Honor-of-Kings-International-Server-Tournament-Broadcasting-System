import { writeFile } from 'node:fs/promises';
/** Fetch the official CN hero list; fail closed rather than corrupting existing catalog. */
const source='https://pvp.qq.com/web201605/js/herolist.json';
const response=await fetch(source,{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'HOKBroadcast-RosterSync/1.0'}});
if(!response.ok)throw new Error(`CN hero catalog fetch failed: HTTP ${response.status}`);
const raw=await response.json() as unknown;
if(!Array.isArray(raw)||raw.length<90||raw.length>500)throw new Error('CN hero catalog incomplete or unexpected shape; previous snapshot preserved');
const data=raw.map(item=>{
  if(!item||typeof item!=='object')throw new Error('Malformed CN hero record');
  const record=item as Record<string,unknown>;
  const officialId=Number(record.ename),name=String(record.cname??'').trim(),type=Number(record.hero_type??0);
  if(!Number.isInteger(officialId)||officialId<1||officialId>9999||name.length<1||name.length>24||!Number.isInteger(type))throw new Error('Malformed CN hero ID, name or role');
  return {officialId,name,type};
});
if(new Set(data.map(h=>h.officialId)).size!==data.length||new Set(data.map(h=>h.name)).size!==data.length)throw new Error('CN hero IDs or names are duplicated');
const catalog={source,snapshot:new Date().toISOString().slice(0,10)+' official CN feed',sourceMirror:'',entries:data,contemporaryNames:[]};
const output='/** AUTO-GENERATED from official CN hero catalog; review diff before commit. */\nexport const cnHeroCatalog='+JSON.stringify(catalog,null,2)+' as const;\n';
await writeFile(new URL('../../src/data/cnHeroCatalog.ts',import.meta.url),output,'utf8');
console.log(`Updated CN catalog: ${data.length} heroes from ${source}. Review diff and run build/tests before commit.`);
