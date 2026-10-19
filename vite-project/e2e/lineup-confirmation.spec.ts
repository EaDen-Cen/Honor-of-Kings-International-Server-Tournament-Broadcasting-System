import {test,expect,type Page} from './fixtures';
import {harness} from './harness';
import {initialState,type Action,type Snapshot} from '../src/shared/types';
import heroes from '../src/components/HeroList';
import sharp from 'sharp';
import {defaultCaptureSlots,type CaptureSlotKey} from '../src/control/bpCaptureLayout';

type MatchHarness=Awaited<ReturnType<typeof harness>>;
type LineupCommand={type:'action';id:string;revision:number;action:Extract<Action,{type:'set_lineup_assignments'}>};

async function prepareLineup(page:Page,match:MatchHarness,automatic=true){
  const state=initialState();
  state.language='eng';state.bpInputMode='screen';state.banCount=0;state.sideSwapMode='colorsOnly';
  state.blueTeam.players=['Alpha','Bravo','Charlie','Delta','Echo'];
  state.redTeam.players=['Fox','Golf','Hotel','India','Juliet'];
  state.blueTeam.playerRoles=['jungle','clash','mid','farm','roam'];
  await match.send({type:'settings',settings:state});
  await match.send({type:'set_player_slot_order',side:'blue',order:[1,0,2,3,4],expectedPlayers:state.blueTeam.players});
  await match.fill();
  await page.addInitScript(({automatic,slots})=>{
    localStorage.setItem('hok-capture-auto-watch','0');
    localStorage.setItem('hok-player-slot-auto','0');
    localStorage.setItem('hok-lineup-auto',automatic?'1':'0');
    localStorage.setItem('hok-window-capture-slots-v3',JSON.stringify(slots));
    Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>{
      const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
      const context=canvas.getContext('2d')!;context.fillStyle='#172d49';context.fillRect(0,0,1920,1080);
      context.fillStyle='#cdddeb';context.fillRect(300,150,1000,650);
      for(const side of ['blue','red'] as const)for(let index=0;index<5;index++){
        const region=slots[`${side}Pick${index+1}` as CaptureSlotKey];
        context.fillStyle=`rgb(${40+index*35},80,180)`;
        context.fillRect(region.x*1920,region.y*1080,region.width*1920,region.height*1080);
      }
      return canvas.captureStream(10);
    }});
  },{automatic,slots:defaultCaptureSlots});
  const before=match.state();
  return {bluePicks:[...before.bluePicks],redPicks:[...before.redPicks],blue:[...before.blueAssignments],red:[...before.redAssignments]};
}

async function capturedSlot(image:string){
  const {data,info}=await sharp(Buffer.from(image.split(',')[1],'base64')).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const center=(Math.floor(info.height/2)*info.width+Math.floor(info.width/2))*info.channels;
  const slot=Math.round((data[center]-40)/35);
  expect(slot).toBeGreaterThanOrEqual(0);expect(slot).toBeLessThan(5);
  return slot;
}

async function mockRecognition(page:Page,picks:{bluePicks:number[];redPicks:number[]},options:{stallAfterScans?:number;redConfidence?:number}={}){
  let calls=0,completedScans=0,waiting=0,scan=0,release=()=>{};
  const gate=new Promise<void>(resolve=>{release=resolve;});
  let decoded=Promise.resolve(0),completedSlots=new Set<string>();
  const blue=[...picks.bluePicks.slice(1),picks.bluePicks[0]],red=[...picks.redPicks.slice(1),picks.redPicks[0]];
  await page.route('**/api/recognize-frame',async route=>{
    const input=route.request().postDataJSON(),ids=input.allowedHeroIds as number[];
    calls++;
    // Source pixels identify a slot independently of cancelled requests. Queue
    // only decoding to preserve the first-slot boundary of concurrent scans.
    const job=decoded.then(()=>capturedSlot(input.image));decoded=job.catch(()=>0);
    const slot=await job,blueSide=ids.join(',')===picks.bluePicks.join(','),target=blueSide?blue:red;
    if(blueSide&&slot===0){scan++;completedSlots=new Set();}
    const currentScan=scan;
    if(options.stallAfterScans&&completedScans>=options.stallAfterScans){waiting++;await gate;}
    const sent=await route.fulfill({json:{preview:input.image,candidates:[{heroId:target[slot],confidence:blueSide ? .99 : options.redConfidence??.99}]}}).then(()=>true).catch(()=>false);
    if(sent&&currentScan===scan){
      const alreadyComplete=completedSlots.size===10;
      completedSlots.add(`${blueSide?'blue':'red'}:${slot}`);
      if(!alreadyComplete&&completedSlots.size===10)completedScans++;
    }
  });
  return {blue,red,release,calls:()=>calls,completedScans:()=>completedScans,waiting:()=>waiting};
}

async function gateLineupCommands(page:Page,mode:'hold-ack'|'reject'|'hold-request'|'disconnect'){
  const commands:LineupCommand[]=[],errors:string[]=[];
  let releaseAck:(()=>void)|undefined,releaseRequest:((revision:number)=>void)|undefined;
  await page.routeWebSocket('**/ws',socket=>{
    const server=socket.connectToServer();
    socket.onMessage(message=>{
      const value=JSON.parse(String(message));
      if(value.type!=='action'||value.action?.type!=='set_lineup_assignments'){server.send(message);return;}
      const command=value as LineupCommand;commands.push(command);
      if(mode==='reject'){
        socket.send(JSON.stringify({type:'error',id:command.id,error:'Lineup rejected: operator review required'}));return;
      }
      if(mode==='hold-request'){releaseRequest=revision=>server.send(JSON.stringify({...command,revision}));return;}
      if(mode==='disconnect'){socket.close({code:1012,reason:'Test connection interruption'});return;}
      server.send(message);
    });
    server.onMessage(message=>{
      const value=JSON.parse(String(message));
      const command=commands.some(item=>item.id===value.id);
      if(command&&value.type==='error')errors.push(value.error);
      if(command&&value.type==='ack'&&mode==='hold-ack'){releaseAck=()=>socket.send(message);return;}
      socket.send(message);
    });
  });
  return {commands,errors,ackWaiting:()=>!!releaseAck,releaseAck:()=>{
    const release=releaseAck;releaseAck=undefined;
    if(!release)throw new Error('No held lineup ACK');release();
  },releaseRequest:(revision:number)=>{
    if(!releaseRequest)throw new Error('No held lineup command');releaseRequest(revision);
  }};
}

async function openCapture(page:Page){
  await page.goto('/control#token=e2e-control');
  await expect(page.locator('.status')).toHaveText('Connected');
  await page.getByRole('button',{name:'Choose game window',exact:true}).click();
  const panel=page.locator('.lineup-sync');
  await expect(panel.getByRole('button',{name:'Recognize and apply swap now',exact:true})).toBeEnabled();
  return panel;
}

async function savedSnapshot(page:Page):Promise<Snapshot>{
  const response=await page.request.get('/api/match',{headers:{Authorization:'Bearer e2e-control'}});
  expect(response.ok()).toBe(true);return response.json() as Promise<Snapshot>;
}

test('two stable lineup scans require ACK plus the matching saved state and retain registered player roles',async({page,baseURL})=>{
  const match=await harness(baseURL);
  try{
    const picks=await prepareLineup(page,match),recognition=await mockRecognition(page,picks);
    const gate=await gateLineupCommands(page,'hold-ack'),panel=await openCapture(page);
    await expect.poll(()=>gate.commands.length).toBe(1);
    expect(recognition.completedScans()).toBeGreaterThanOrEqual(2);
    expect(gate.commands[0].action.expectedContext).toEqual(expect.any(String));
    await expect.poll(()=>match.state().blueAssignments).toEqual(recognition.blue);
    await expect(panel.locator('.lineup-team.blue select').first()).toHaveValue(String(recognition.blue[0]));
    await expect(panel).toHaveAttribute('data-lineup-state','submitting');
    await expect(panel.locator('.lineup-status')).not.toContainText('Applied · server confirmed');
    const saved=await savedSnapshot(page);
    expect(saved.state.blueAssignments).toEqual(recognition.blue);expect(saved.state.redAssignments).toEqual(recognition.red);
    expect(saved.state.bluePicks).toEqual(picks.bluePicks);expect(saved.state.redPicks).toEqual(picks.redPicks);
    await expect.poll(gate.ackWaiting).toBe(true);gate.releaseAck();
    await expect(panel).toHaveAttribute('data-lineup-state','applied');
    await expect(panel.locator('.lineup-status')).toContainText('Applied · server confirmed');
    expect(gate.commands).toHaveLength(1);
    await panel.screenshot({path:'artifacts/lineup-reliability-20261019/lineup-applied.png'});
    await match.send({type:'commit_game'});await match.send({type:'post_game_begin'});
    const player=match.state().postGameReports[0].players.find(item=>item.side==='blue'&&item.slot===0)!;
    expect({id:player.playerId,role:player.role,hero:player.heroId}).toEqual({id:'Bravo',role:'clash',hero:recognition.blue[0]});
    await page.goto('/overlay/postgame-clash');await expect(page.locator('.pg-player.blue strong')).toHaveText('Bravo');
  }finally{match.close();}
});

test('server rejection preserves the detected candidate and exposes its reason without changing picks or assignments',async({page,baseURL})=>{
  const match=await harness(baseURL);
  try{
    const picks=await prepareLineup(page,match,false),recognition=await mockRecognition(page,picks);
    const gate=await gateLineupCommands(page,'reject'),panel=await openCapture(page);
    await panel.getByRole('button',{name:'Recognize and apply swap now',exact:true}).click();
    await expect(panel).toHaveAttribute('data-lineup-state','rejected');
    await expect(panel.locator('.lineup-status')).toContainText('Lineup rejected: operator review required');
    await expect(panel.getByRole('button',{name:'Apply this scan',exact:true})).toBeEnabled();
    expect(await panel.locator('.lineup-detected').allTextContents()).toHaveLength(10);
    expect(recognition.completedScans()).toBe(1);expect(gate.commands).toHaveLength(1);
    const saved=await savedSnapshot(page);
    expect(saved.state.blueAssignments).toEqual(picks.blue);expect(saved.state.redAssignments).toEqual(picks.red);
    expect(saved.state.bluePicks).toEqual(picks.bluePicks);expect(saved.state.redPicks).toEqual(picks.redPicks);
    await panel.screenshot({path:'artifacts/lineup-reliability-20261019/lineup-rejected.png'});
  }finally{match.close();}
});

test('the displayed unique lineup proposal uses its second-ranked hero and confidence when the top choice conflicts',async({page,baseURL})=>{
  const match=await harness(baseURL);
  try{
    const picks=await prepareLineup(page,match,false);
    const target=[picks.bluePicks[1],picks.bluePicks[0],...picks.bluePicks.slice(2)];
    await page.route('**/api/recognize-frame',async route=>{
      const input=route.request().postDataJSON(),ids=input.allowedHeroIds as number[],key=ids.join(',');
      const slot=await capturedSlot(input.image);
      const blue=key===picks.bluePicks.join(',');
      const candidates=blue&&slot===1
        ? [{heroId:target[0],confidence:.98},{heroId:target[1],confidence:.90}]
        : [{heroId:blue?target[slot]:ids[slot],confidence:.99}];
      await route.fulfill({json:{preview:input.image,candidates}});
    });
    const gate=await gateLineupCommands(page,'reject'),panel=await openCapture(page);
    await panel.getByRole('button',{name:'Recognize and apply swap now',exact:true}).click();
    await expect(panel).toHaveAttribute('data-lineup-state','rejected');
    expect(gate.commands).toHaveLength(1);expect(gate.commands[0].action.blue).toEqual(target);
    const names=target.map(id=>heroes.find(hero=>hero.id===id)!.englishName);
    await expect(panel.locator('.lineup-team.blue .lineup-detected').nth(0)).toHaveText(`${names[0]} 99%`);
    await expect(panel.locator('.lineup-team.blue .lineup-detected').nth(1)).toHaveText(`${names[1]} 90%`);
    await expect(panel.getByRole('button',{name:'Apply this scan',exact:true})).toBeEnabled();
    const saved=await savedSnapshot(page);
    expect(saved.state.blueAssignments).toEqual(picks.blue);expect(saved.state.bluePicks).toEqual(picks.bluePicks);
  }finally{match.close();}
});

test('a new lineup after an applied swap needs fresh stable frames and its own ACK before it can show Applied',async({page,baseURL})=>{
  const match=await harness(baseURL);let release=()=>{};
  try{
    const picks=await prepareLineup(page,match,false),options:{stallAfterScans?:number}={};
    const recognition=await mockRecognition(page,picks,options);release=recognition.release;
    const gate=await gateLineupCommands(page,'hold-ack'),panel=await openCapture(page);
    await panel.getByRole('button',{name:'Recognize and apply swap now',exact:true}).click();
    await expect.poll(gate.ackWaiting).toBe(true);gate.releaseAck();
    await expect(panel).toHaveAttribute('data-lineup-state','applied');
    const first=await savedSnapshot(page);
    // A different proposal must not inherit the previous successful status.
    recognition.blue.push(recognition.blue.shift()!);recognition.red.push(recognition.red.shift()!);
    options.stallAfterScans=2;
    await panel.getByRole('checkbox',{name:'Automatically detect and sync hero swaps',exact:true}).check();
    await expect.poll(recognition.completedScans).toBe(2);
    await expect(panel).toHaveAttribute('data-lineup-state','detected');
    await expect(panel.locator('.lineup-team.blue .lineup-detected').first()).toHaveText(`${heroes.find(hero=>hero.id===recognition.blue[0])!.englishName} 99%`);
    await expect(panel.locator('.lineup-team.blue select').first()).toHaveValue(String(first.state.blueAssignments[0]));
    expect(gate.commands).toHaveLength(1);
    expect((await savedSnapshot(page)).state.blueAssignments).toEqual(first.state.blueAssignments);
    await expect.poll(recognition.waiting).toBeGreaterThanOrEqual(2);release();
    await expect.poll(()=>gate.commands.length).toBe(2);
    await expect.poll(gate.ackWaiting).toBe(true);
    await expect(panel).toHaveAttribute('data-lineup-state','submitting');
    const second=await savedSnapshot(page);
    expect(second.state.blueAssignments).toEqual(recognition.blue);expect(second.state.redAssignments).toEqual(recognition.red);
    expect(second.state.bluePicks).toEqual(picks.bluePicks);expect(second.state.redPicks).toEqual(picks.redPicks);
    gate.releaseAck();await expect(panel).toHaveAttribute('data-lineup-state','applied');
    expect(gate.commands).toHaveLength(2);
  }finally{release();match.close();}
});

test('an unready socket before React sees disconnection retains the candidate and pauses automatic submissions',async({page,baseURL})=>{
  const match=await harness(baseURL);let release=()=>{};
  try{
    const picks=await prepareLineup(page,match),recognition=await mockRecognition(page,picks,{stallAfterScans:1});release=recognition.release;
    await page.addInitScript(()=>{
      const NativeSocket=WebSocket,probe={sockets:[] as WebSocket[],commandIds:[] as string[],blocked:false};
      class ObservedSocket extends NativeSocket {
        constructor(url:string|URL,protocols?:string|string[]){
          super(url,protocols);probe.sockets.push(this);
          if(probe.blocked)Object.defineProperty(this,'readyState',{value:NativeSocket.CLOSING,configurable:true});
        }
        send(data:Parameters<WebSocket['send']>[0]){
          if(typeof data==='string'){
            let message;try{message=JSON.parse(data);}catch{/* Non-JSON transport messages are irrelevant. */}
            if(message?.type==='action'&&message.action?.type==='set_lineup_assignments')probe.commandIds.push(message.id);
          }
          super.send(data);
        }
      }
      (window as Window&{lineupSocketProbe?:typeof probe}).lineupSocketProbe=probe;
      Object.defineProperty(window,'WebSocket',{value:ObservedSocket,configurable:true});
    });
    // Keep this case on native WebSockets. Playwright's routeWebSocket shim
    // wraps another socket, so changing that inner instance would not test the
    // readyState read by useMatch.send().
    const panel=await openCapture(page);
    await expect.poll(recognition.waiting).toBeGreaterThanOrEqual(2);
    const forced=await page.evaluate(()=>{
      const probe=(window as Window&{lineupSocketProbe?:{sockets:WebSocket[];blocked:boolean}}).lineupSocketProbe;
      if(!probe)throw new Error('Native socket probe was not installed');
      const sockets=probe.sockets.filter(item=>item.readyState===WebSocket.OPEN);
      if(!sockets.length)throw new Error('No authenticated browser socket');
      probe.blocked=true;
      // Do not dispatch close: exercise send()'s synchronous channel guard
      // before React receives any connection-state event.
      for(const socket of sockets)Object.defineProperty(socket,'readyState',{value:WebSocket.CLOSING,configurable:true});
      return {count:sockets.length,states:sockets.map(socket=>socket.readyState)};
    });
    expect(forced.count).toBeGreaterThan(0);expect(forced.states.every(state=>state===2)).toBe(true);
    const sentCommands=()=>page.evaluate(()=>(window as Window&{lineupSocketProbe?:{commandIds:string[]}}).lineupSocketProbe!.commandIds.length);
    await expect(page.locator('.status')).toHaveText('Connected');release();
    await expect(panel).toHaveAttribute('data-lineup-state','unconfirmed');
    await expect(panel.locator('.lineup-status')).toContainText('Not submitted: server channel is not ready. Candidate retained');
    await expect(panel.getByRole('checkbox',{name:'Automatically detect and sync hero swaps',exact:true})).not.toBeChecked();
    await expect(panel.getByRole('button',{name:'Apply this scan',exact:true})).toBeEnabled();
    const calls=recognition.calls();expect(recognition.completedScans()).toBe(2);expect(await sentCommands()).toBe(0);
    await page.clock.install();await page.clock.fastForward(5000);
    expect(recognition.calls()).toBe(calls);expect(await sentCommands()).toBe(0);
    const saved=await savedSnapshot(page);
    expect(saved.state.blueAssignments).toEqual(picks.blue);expect(saved.state.redAssignments).toEqual(picks.red);
    expect(saved.state.bluePicks).toEqual(picks.bluePicks);expect(saved.state.redPicks).toEqual(picks.redPicks);
  }finally{release();match.close();}
});

test('manual Apply can take over a retained candidate while a later automatic scan is busy',async({page,baseURL})=>{
  const match=await harness(baseURL);let release=()=>{};
  try{
    const picks=await prepareLineup(page,match),recognition=await mockRecognition(page,picks,{stallAfterScans:1});release=recognition.release;
    const panel=await openCapture(page);
    await expect.poll(recognition.waiting).toBeGreaterThanOrEqual(2);
    await expect(panel.getByRole('button',{name:'Recognizing…',exact:true})).toBeDisabled();
    const apply=panel.getByRole('button',{name:'Apply this scan',exact:true});await expect(apply).toBeEnabled();await apply.click();
    await expect(panel).toHaveAttribute('data-lineup-state','applied');
    await expect(panel.getByRole('checkbox',{name:'Automatically detect and sync hero swaps',exact:true})).not.toBeChecked();
    expect((await savedSnapshot(page)).state.blueAssignments).toEqual(recognition.blue);
    release();await expect(panel).toHaveAttribute('data-lineup-state','applied');
    expect(match.state().bluePicks).toEqual(picks.bluePicks);expect(match.state().redPicks).toEqual(picks.redPicks);
  }finally{release();match.close();}
});

test('one weak team prevents automatic two-team publication while its verified opponent can be reviewed separately',async({page,baseURL})=>{
  const match=await harness(baseURL);
  try{
    const picks=await prepareLineup(page,match),recognition=await mockRecognition(page,picks,{redConfidence:.4});
    const panel=await openCapture(page);
    await expect.poll(recognition.completedScans).toBeGreaterThanOrEqual(2);
    await expect(panel).toHaveAttribute('data-lineup-state','review');
    expect(match.state().blueAssignments).toEqual(picks.blue);expect(match.state().redAssignments).toEqual(picks.red);
    await panel.getByRole('button',{name:'Apply verified blue team',exact:true}).click();
    await expect(panel).toHaveAttribute('data-lineup-state','applied');
    const saved=await savedSnapshot(page);
    expect(saved.state.blueAssignments).toEqual(recognition.blue);expect(saved.state.redAssignments).toEqual(picks.red);
  }finally{match.close();}
});

for(const failure of ['timeout','disconnect'] as const){
  test(`a lineup ${failure} stays unconfirmed and does not replay the command after reconnecting`,async({page,baseURL})=>{
    const match=await harness(baseURL);
    try{
      const picks=await prepareLineup(page,match,false);await mockRecognition(page,picks);
      const gate=await gateLineupCommands(page,failure==='timeout'?'hold-request':'disconnect'),panel=await openCapture(page);
      await page.clock.install();
      await panel.getByRole('button',{name:'Recognize and apply swap now',exact:true}).click();
      await expect.poll(()=>gate.commands.length).toBe(1);
      if(failure==='timeout')await page.clock.fastForward(8500);
      await expect(panel).toHaveAttribute('data-lineup-state','unconfirmed');
      await expect(panel.locator('.lineup-status')).toContainText('Unconfirmed · verify saved lineup');
      await page.clock.fastForward(2500);await expect(page.locator('.status')).toHaveText('Connected');
      await expect(panel).not.toHaveAttribute('data-lineup-state','applied');
      const saved=await savedSnapshot(page);
      expect(saved.state.blueAssignments).toEqual(picks.blue);expect(saved.state.redAssignments).toEqual(picks.red);
      expect(gate.commands).toHaveLength(1);
    }finally{match.close();}
  });
}

for(const change of ['player order','side swap','next game'] as const){
  test(`a late lineup write after ${change} is rejected even with a fresh revision`,async({page,baseURL})=>{
    const match=await harness(baseURL);
    try{
      const picks=await prepareLineup(page,match,false);await mockRecognition(page,picks);
      const gate=await gateLineupCommands(page,'hold-request'),panel=await openCapture(page);
      await panel.getByRole('button',{name:'Recognize and apply swap now',exact:true}).click();
      await expect.poll(()=>gate.commands.length).toBe(1);
      if(change==='player order')await match.send({type:'set_player_slot_order',side:'blue',order:[0,1,2,3,4],expectedPlayers:match.state().blueTeam.players});
      else if(change==='side swap'){
        await match.send({type:'reset_draft'});await match.send({type:'swap_sides'});await match.fill();
      }
      else{
        await match.send({type:'commit_game'});await match.send({type:'score',team:'blue',delta:1});await match.send({type:'next_game'});
      }
      const before=await savedSnapshot(page);
      gate.releaseRequest(before.revision);
      await expect.poll(()=>gate.errors.some(error=>error.includes('Lineup context changed'))).toBe(true);
      const after=await savedSnapshot(page);
      expect(after.state.blueAssignments).toEqual(before.state.blueAssignments);expect(after.state.redAssignments).toEqual(before.state.redAssignments);
      expect(after.state.bluePicks).toEqual(before.state.bluePicks);expect(after.state.redPicks).toEqual(before.state.redPicks);
      await expect(page.locator('.lineup-sync[data-lineup-state="applied"]')).toHaveCount(0);
      expect(gate.commands).toHaveLength(1);
    }finally{match.close();}
  });
}

test('ID preflight confirmation expires when identities, roles, player order or displayed sides change',async({page,baseURL})=>{
  const match=await harness(baseURL);
  try{
    const initial=initialState();initial.language='eng';initial.bpInputMode='screen';initial.sideSwapMode='colorsOnly';
    initial.blueTeam.players=['Alpha','Bravo','Charlie','Delta','Echo'];
    await match.send({type:'settings',settings:initial});
    await page.goto('/control#token=e2e-control');
    const checked=page.locator('.operator-id-preflight input');
    await expect(checked).not.toBeChecked();await checked.check();
    await page.reload();await expect(checked).toBeChecked();
    await match.send({type:'settings',settings:{...match.state(),language:'zh'}});await expect(checked).toBeChecked();
    await match.send({type:'settings',settings:{...match.state(),language:'eng'}});
    await match.send({type:'set_player_slot_order',side:'blue',order:[1,0,2,3,4],expectedPlayers:match.state().blueTeam.players});
    await expect(checked).not.toBeChecked();await checked.check();
    const roles=match.state();roles.blueTeam.playerRoles=['jungle','clash','mid','farm','roam'];
    await match.send({type:'settings',settings:roles});await expect(checked).not.toBeChecked();await checked.check();
    const roster=match.state();roster.blueTeam.players[0]='New starter';
    await match.send({type:'settings',settings:roster});await expect(checked).not.toBeChecked();await checked.check();
    await match.send({type:'swap_sides'});await expect(checked).not.toBeChecked();
    await match.send({type:'swap_sides'});await expect(checked).not.toBeChecked();
    await page.reload();await expect(checked).not.toBeChecked();
    await checked.check();await match.fill();await expect(checked).toBeChecked();
    await match.send({type:'score',team:'blue',delta:1});await expect(checked).toBeChecked();
  }finally{match.close();}
});
