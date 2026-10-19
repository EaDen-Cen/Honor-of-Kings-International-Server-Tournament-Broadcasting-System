import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultObsConfig,type ObsStatus } from '../src/shared/obsProtocol.js';
import { isObsCommandResult,isObsPublicConfig,isObsSnapshot,isObsStatus,validObsResponse } from '../src/control/obsDirectorValidation.js';

function status():ObsStatus {
  const output={active:null,paused:null,reconnecting:null,durationMs:null,bytes:null};
  return {connection:'disconnected',lastError:null,connectedAt:null,obsVersion:null,sceneName:null,scenes:[],inputs:[],recording:{...output},streaming:{...output},recordHealth:{directory:null,directorySource:null,freeBytes:null,estimatedMinutes:null,rateBytesPerSecond:null,level:'unknown',warnings:[]},warnings:[],lastCommand:null,observedAt:null};
}
test('OBS UI refuses incomplete telemetry instead of treating it as a ready connection',()=>{
  assert.equal(isObsSnapshot({config:{},status:{}}),false);
  assert.equal(isObsStatus({...status(),connection:'connected',inputs:undefined}),false);
  assert.equal(isObsStatus({...status(),recording:{active:false}}),false);
  assert.equal(isObsStatus({...status(),recordHealth:{}}),false);
  assert.equal(isObsSnapshot({config:defaultObsConfig(),status:status()}),true);
});
test('OBS public config never accepts a password echo or invalid audio bindings',()=>{
  assert.equal(isObsPublicConfig({...defaultObsConfig(),password:'should-never-return'}),false);
  const config=defaultObsConfig();config.presets.bp.audio.bgm={volume:2,muted:false};
  assert.equal(isObsPublicConfig(config),false);
  config.presets.bp.audio.bgm={volume:.5,muted:false};config.presets.bp.fadeMs=3001;
  assert.equal(isObsPublicConfig(config),false);
  assert.equal(validObsResponse('/connect',defaultObsConfig()),false);
  assert.equal(validObsResponse('/config',status()),false);
});
test('OBS command confirmation requires its ID, known terminal state and finite time',()=>{
  const command={id:'ui-action-1',type:'preset',status:'succeeded',message:'Confirmed',startedAt:1,finishedAt:2};
  assert.equal(isObsCommandResult(command),true);
  assert.equal(isObsCommandResult({...command,id:undefined}),false);
  assert.equal(isObsCommandResult({...command,status:'sent'}),false);
  assert.equal(isObsCommandResult({...command,finishedAt:NaN}),false);
  assert.equal(isObsStatus({...status(),lastCommand:{...command,id:''}}),false);
});
