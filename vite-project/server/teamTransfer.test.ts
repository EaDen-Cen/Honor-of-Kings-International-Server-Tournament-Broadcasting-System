import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { initialState } from '../src/shared/types.js';
import { TeamPresetStore } from './teamPresets.js';
import { exportTeamLibrary, importTeamLibrary, previewTeamLibrary } from './teamTransfer.js';
import { uploadPortrait } from './portraits.js';

test('portable library round trip keeps team IDs, logos, starters, substitutes and image bytes', async () => {
  const a = mkdtempSync(join(tmpdir(),'hok-transfer-a-'));
  const b = mkdtempSync(join(tmpdir(),'hok-transfer-b-'));
  try {
    const source = new TeamPresetStore(join(a,'teams.json'));
    const target = new TeamPresetStore(join(b,'teams.json'));
    const portrait = await sharp({create:{width:32,height:32,channels:3,background:'#cc8833'}}).jpeg({progressive:true}).toBuffer();
    const logo = await sharp({create:{width:24,height:24,channels:4,background:'#3399bb'}}).png().toBuffer();
    const portraitName = randomUUID()+'.jpg',logoName = randomUUID()+'.png';
    const uploadA = join(a,'uploads'),uploadB = join(b,'uploads');
    const {mkdirSync} = await import('node:fs');
    mkdirSync(uploadA);mkdirSync(uploadB);
    writeFileSync(join(uploadA,portraitName),portrait);
    writeFileSync(join(uploadA,logoName),logo);
    const starterURL = '/uploads/player-portraits/'+portraitName;
    const logoURL = '/uploads/player-portraits/'+logoName;
    const team = source.create({
      ...initialState().blueTeam,name:'Exported Team',logo:logoURL,
      players:['Alpha','','','',''],playerPortraits:[starterURL,'','','',''],
      substitutes:[{id:randomUUID(),name:'Reserve',role:'roam',portrait:starterURL}],
    });
    const bundle = exportTeamLibrary(source,uploadA,join(a,'public'));
    assert.equal(bundle.teams.length,1);
    assert.equal(bundle.assets.length,2);
    assert.equal(bundle.externalAssets.length,0);
    const preview = await previewTeamLibrary(bundle,target);
    assert.deepEqual({newTeams:preview.newTeams,images:preview.images,conflicts:preview.conflicts},{newTeams:1,images:2,conflicts:0});
    const applied = await importTeamLibrary(bundle,target,uploadB,'skip');
    assert.equal(applied.added,1);
    assert.equal(applied.images,2);
    const saved = target.get(team.id)!;
    assert.equal(saved.id,team.id);
    assert.equal(saved.name,'Exported Team');
    assert.equal(saved.players[0],'Alpha');
    assert.equal(saved.substitutes[0].name,'Reserve');
    assert.equal(saved.substitutes[0].portrait,saved.playerPortraits[0]);
    assert.notEqual(saved.logo,logoURL);
    assert.deepEqual(readFileSync(join(uploadB,saved.logo.split('/').at(-1)!)),logo);
    assert.deepEqual(readFileSync(join(uploadB,saved.playerPortraits[0].split('/').at(-1)!)),portrait);
    const repeated = await importTeamLibrary(bundle,target,uploadB,'skip');
    assert.equal(repeated.skipped,1);
    assert.equal(repeated.images,0);
    source.update(team.id,{...team,name:'Updated Team'});
    const overwrite = await importTeamLibrary(exportTeamLibrary(source,uploadA,join(a,'public')),target,uploadB,'replace');
    assert.equal(overwrite.replaced,1);
    assert.equal(target.get(team.id)?.name,'Updated Team');
  } finally {rmSync(a,{recursive:true,force:true});rmSync(b,{recursive:true,force:true});}
});

test('invalid archive checksum, missing image and duplicate team ID cannot touch existing teams',async()=>{
  const root = mkdtempSync(join(tmpdir(),'hok-transfer-invalid-'));
  try {
    const source = new TeamPresetStore(join(root,'source.json'));
    const dest = new TeamPresetStore(join(root,'dest.json'));
    const saved = source.create({...initialState().blueTeam,name:'Valid Team'});
    const good = exportTeamLibrary(source,join(root,'uploads'),join(root,'public'));
    const malformed = structuredClone(good);
    malformed.teams.push(structuredClone(saved));
    await assert.rejects(()=>previewTeamLibrary(malformed,dest),/teamTransferInvalid/);
    const missing = structuredClone(good);
    missing.teams[0].logo='/uploads/player-portraits/'+randomUUID()+'.png';
    await assert.rejects(()=>importTeamLibrary(missing,dest,join(root,'uploads'),'replace'),/teamTransferMissingAsset/);
    assert.deepEqual(dest.list(),[]);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('JPEG upload accepts valid progressive JPEG and stores a normalized decodable file', async()=>{
  const root = mkdtempSync(join(tmpdir(),'hok-jpeg-'));
  const server = createServer((req,res)=>{void uploadPortrait(req,res,root);});
  try {
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',()=>resolve()));
    const addr = server.address();
    if (!addr || typeof addr==='string') throw new Error('Missing TCP port');
    const jpeg = await sharp({create:{width:1080,height:1080,channels:3,background:'#ffffff'}})
      .jpeg({progressive:true}).toBuffer();
    const response = await fetch(`http://127.0.0.1:${addr.port}/upload`,{
      method:'POST',headers:{'Content-Type':'image/jpeg','X-File-Name':encodeURIComponent('测试头像.jpeg')},body:jpeg,
    });
    assert.equal(response.status,201);
    const data = await response.json() as {url:string};
    assert.match(data.url,/^\/uploads\/player-portraits\/[a-f0-9-]+\.jpg$/);
    const image = await sharp(readFileSync(join(root,data.url.split('/').at(-1)!))).metadata();
    assert.equal(image.format,'jpeg');
    assert.equal(image.width,1080);
    assert.equal(image.height,1080);
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(root,{recursive:true,force:true});}
});
