import globalHeroes from '../components/HeroList.js';
import { cnHeroCatalog as catalog } from '../data/cnHeroCatalog.js';
import type { Hero } from '../data/heroTypes.js';
export type HeroPool='global'|'cn';
export type BanCount=0|1|2|3|4|5;
const normalized=(name:string)=>name.replace(/[\s·（）()]/g,'').replace(/鎧/g,'铠').replace(/凱/g,'凯').replace(/雲/g,'云').trim();
const globalNames=new Map(globalHeroes.filter(h=>h.chineseName.trim()).map(h=>[normalized(h.chineseName),h]));
const sourceEntries:ReadonlyArray<{officialId:number;name:string;type:number|undefined}>=catalog.entries;
const newNames=catalog.contemporaryNames;
function defaultLane(kind:number|undefined):string {
  return ({1:'Clash Lane',2:'Mid Lane',3:'Clash Lane',4:'Jungling',5:'Farm Lane',6:'Roaming'} as Record<number,string>)[kind??0]||'Clash Lane';
}
/** Preserve all global IDs. Distinct CN-only heroes live in a separate namespace. */
const builtCnHeroes:Hero[]=[];
const seen=new Set<string>();
for(const entry of [...sourceEntries,...newNames.map((name:string,index:number)=>({officialId:1000+index,name,type:undefined}))]){
  const key=normalized(entry.name);if(!key||seen.has(key))continue;seen.add(key);
  const shared=globalNames.get(key);
  if(shared){builtCnHeroes.push(shared);continue;}
  const knownOfficial=entry.officialId<1000;
  builtCnHeroes.push({
    id:20000+entry.officialId,
    englishName:entry.name,
    chineseName:entry.name,
    imageLink:knownOfficial?`https://game.gtimg.cn/images/yxzj/img201606/heroimg/${entry.officialId}/${entry.officialId}.jpg`:'',
    occupation:defaultLane(entry.type),
    combo:[],counter:[],beCountered:[],relationshipStatus:'unverified',
  });
}
// Extend historical CN source with confidently shared modern heroes already present
// in the international catalog. Do not confuse release dates with source certainty.
for(const hero of globalHeroes){
  const key=normalized(hero.chineseName);
  if(!key||key==='刀锋宝贝'||key==='劳拉'||key==='王维'||key==='Comingsoon'||seen.has(key))continue;
  seen.add(key);builtCnHeroes.push(hero);
}
export const cnHeroes:Hero[]=builtCnHeroes;
// Working CN snapshot is not a claim of complete live-server release parity.
export const cnPoolCatalogStatus='partial-snapshot' as const;
export const allPoolHeroes:Hero[]=Array.from(new Map([...globalHeroes,...cnHeroes].map(hero=>[hero.id,hero])).values());
const cnIds=new Set(cnHeroes.map(h=>h.id));
export function heroesForPool(pool:HeroPool='global'):Hero[]{return pool==='cn'?cnHeroes:globalHeroes;}
export function heroAllowed(pool:HeroPool|undefined,id:number){return pool==='cn'?cnIds.has(id):globalHeroes.some(h=>h.id===id);}
export function defaultBansForMode(mode:'match'|'normal'):BanCount{return mode==='match'?4:2;}
export function isBanCount(value:unknown):value is BanCount{return Number.isInteger(value)&&Number(value)>=0&&Number(value)<=5;}
