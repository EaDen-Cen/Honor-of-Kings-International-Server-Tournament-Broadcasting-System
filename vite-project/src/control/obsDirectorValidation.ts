import { OBS_AUDIO_ROLES,OBS_PRESET_IDS,type ObsCommandResult,type ObsPublicConfig,type ObsSnapshot,type ObsStatus } from '../shared/obsProtocol.js';

type ObjectValue=Record<string,unknown>;
const object=(value:unknown):value is ObjectValue=>!!value&&typeof value==='object'&&!Array.isArray(value);
const number=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const nullableNumber=(value:unknown)=>value===null||number(value);
const nullableBoolean=(value:unknown)=>value===null||typeof value==='boolean';
const text=(value:unknown):value is string=>typeof value==='string';
const nullableText=(value:unknown)=>value===null||text(value);
const strings=(value:unknown):value is string[]=>Array.isArray(value)&&value.every(text);
const member=(value:unknown,allowed:readonly string[])=>typeof value==='string'&&allowed.includes(value);
const audioTarget=(value:unknown)=>object(value)&&number(value.volume)&&value.volume<=1&&typeof value.muted==='boolean';
const preset=(value:unknown)=>object(value)&&text(value.sceneName)&&number(value.fadeMs)&&value.fadeMs<=3000&&object(value.audio)&&Object.entries(value.audio).every(([key,target])=>(OBS_AUDIO_ROLES as readonly string[]).includes(key)&&audioTarget(target));

/** Validate before React sees a response. Partial telemetry is unknown, never a
 * successful connection, a blank binding, or an inactive recording. */
export function isObsPublicConfig(value:unknown):value is ObsPublicConfig {
  if(!object(value)||'password' in value||'clearPassword' in value)return false;
  const {inputs,presets}=value;
  return typeof value.enabled==='boolean'&&text(value.url)&&typeof value.passwordConfigured==='boolean'&&typeof value.reconnect==='boolean'
    &&object(inputs)&&OBS_AUDIO_ROLES.every(role=>text(inputs[role]))
    &&object(presets)&&OBS_PRESET_IDS.every(id=>preset(presets[id]))
    &&text(value.recordDirectory)&&number(value.lowDiskGb)&&number(value.remainingMinutesWarning);
}
export function isObsCommandResult(value:unknown):value is ObsCommandResult {
  return object(value)&&text(value.id)&&/^[\w.-]{1,128}$/.test(value.id)
    &&member(value.type,['preset','scene','bgm','cancel','refresh'])
    &&member(value.status,['running','succeeded','failed','cancelled','unconfirmed'])
    &&text(value.message)&&number(value.startedAt)&&(value.finishedAt===undefined||number(value.finishedAt));
}
const output=(value:unknown)=>object(value)&&nullableBoolean(value.active)&&nullableBoolean(value.paused)&&nullableBoolean(value.reconnecting)&&nullableNumber(value.durationMs)&&nullableNumber(value.bytes);
const input=(value:unknown)=>object(value)&&text(value.inputName)&&text(value.inputKind)&&nullableNumber(value.volume)&&nullableBoolean(value.muted);
function recordHealth(value:unknown){
  return object(value)&&nullableText(value.directory)&&(value.directorySource===null||member(value.directorySource,['obs','manual']))&&nullableNumber(value.freeBytes)&&nullableNumber(value.estimatedMinutes)&&nullableNumber(value.rateBytesPerSecond)&&member(value.level,['unknown','ok','warning','critical'])&&strings(value.warnings);
}
export function isObsStatus(value:unknown):value is ObsStatus {
  return object(value)&&member(value.connection,['disconnected','connecting','connected','reconnecting','error'])
    &&nullableText(value.lastError)&&nullableNumber(value.connectedAt)&&nullableText(value.obsVersion)&&nullableText(value.sceneName)
    &&strings(value.scenes)&&Array.isArray(value.inputs)&&value.inputs.every(input)
    &&output(value.recording)&&output(value.streaming)&&recordHealth(value.recordHealth)
    &&strings(value.warnings)&&(value.lastCommand===null||isObsCommandResult(value.lastCommand))&&nullableNumber(value.observedAt);
}
export function isObsSnapshot(value:unknown):value is ObsSnapshot {
  return object(value)&&isObsPublicConfig(value.config)&&isObsStatus(value.status);
}
export function validObsResponse(path:string,value:unknown):boolean {
  if(path==='')return isObsSnapshot(value);
  if(path==='/config')return isObsPublicConfig(value);
  if(path==='/status'||path==='/connect'||path==='/disconnect')return isObsStatus(value);
  if(path==='/command')return isObsCommandResult(value);
  return false;
}
