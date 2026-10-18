import { createClientUUID } from '../shared/clientId';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { initialState, type Action, type MatchSettings, type MatchState, type Side, type Team, type TeamPreset, type ReservePlayer } from '../shared/types';
import { apiURL } from '../shared/config';
import { translator } from '../shared/i18n';
import { errorMessage } from '../shared/errorMessages';
import { PortraitField } from './PortraitField';

export function TeamLibrary({state, form, token, disabled, send, onRosterApply}: {state:MatchState;form:MatchSettings;token:string;disabled:boolean;send:(action:Action)=>void;onRosterApply:(side:Side,index:number,player:ReservePlayer)=>void}) {
  const t = translator(state.language);
  const [teams,setTeams] = useState<TeamPreset[]>([]);
  const [selected,setSelected] = useState({blue:'',red:''});
  const [replacement,setReplacement] = useState({blue:{player:'',slot:0,source:''},red:{player:'',slot:0,source:''}});
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState<'presetSaved'|'presetDeleted'|'substituteFilled'|null>(null);
  const [open,setOpen] = useState(false);
  const [query,setQuery] = useState('');
  const [draft,setDraft] = useState<Team & {substitutes:ReservePlayer[]}>(() => ({...initialState().blueTeam,id:'',name:'',substitutes:[]}));
  const [uploads,setUploads] = useState<Set<number>>(() => new Set());
  const dialog = useRef<HTMLDialogElement>(null);
  const busyRef = useRef(false);
  const refreshVersion = useRef(0);
  const cleanDraft = useRef(JSON.stringify(draft));
  const dirty = JSON.stringify(draft) !== cleanDraft.current;
  const locked = state.currentPhase !== 0 || state.draftHistory.length > 0 || !!state.committedGameId;
  const request = useCallback(async (path = '', method = 'GET', body?:Team) => {
    const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(),15000);
    try {
      const response = await fetch(`${apiURL}/api/team-presets${path}`,{method,signal:controller.signal,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body ? JSON.stringify(body) : undefined});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'presetSaveFailed');
      return data;
    } finally { window.clearTimeout(timer); }
  },[token]);
  const refresh = useCallback(async (isActive:()=>boolean = ()=>true) => {
    const version = ++refreshVersion.current;
    const data = await request();
    if (isActive() && version === refreshVersion.current) setTeams(data.teams);
  },[request]);
  useEffect(() => {
    let active = true;
    void refresh(()=>active).catch(() => { if (active) setError('presetSaveFailed'); });
    return () => { active = false; };
  },[refresh]);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); },[open]);
  const run = async (task:()=>Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);setError('');setNotice(null);
    try { await task(); } catch (e) { setError(e instanceof Error && ['substitutesInvalid','presetInvalid','presetMissing','presetSaveFailed','uploadUnauthorized'].includes(e.message) ? e.message : 'presetSaveFailed'); }
    finally {busyRef.current = false;setBusy(false);}
  };
  const edit = (team:Team & {substitutes?:ReservePlayer[]}) => {
    const next = {...structuredClone(team),substitutes:structuredClone(team.substitutes || [])};
    cleanDraft.current = JSON.stringify(next);
    setDraft(next);
  };
  const discard = () => !dirty || confirm(state.language === 'zh'
    ? '队伍资料有未保存的修改。放弃这些修改并继续？'
    : 'This team has unsaved changes. Discard them and continue?');
  const close = () => { if (!busyRef.current && discard()) { setOpen(false); edit({...initialState().blueTeam,id:'',name:'',substitutes:[]}); } };
  const save = (team:Team, update:boolean) => void run(async () => {
    const saved:TeamPreset = await request(update ? `/${team.id}` : '',update ? 'PUT' : 'POST',team);
    // The mutation response already confirms persistence. A second GET must
    // never turn a successful creation into an apparent failure and duplicate.
    refreshVersion.current++;
    setTeams(previous => previous.some(item=>item.id===saved.id) ? previous.map(item => item.id === saved.id ? saved : item) : [...previous,saved]);
    setNotice('presetSaved');
    if (open) edit(saved);
  });
  const load = (side:Side,id:string) => {
    if (id && !disabled && !busyRef.current && !locked && (!open || discard()) && confirm(t('confirmLoadTeam'))) { setOpen(false);send({type:'load_team_preset',side,presetId:id}); }
  };
  const blank = () => edit({...initialState().blueTeam,id:'',name:'',substitutes:[]});
  const roster = (side:Side): ReservePlayer[] => {
    const team = teams.find(team => team.id === (replacement[side].source || state[`${side}Team`].id));
    return team ? [...team.players.map((name,i) => ({id:'starter-'+i,name,role:team.playerRoles[i],portrait:team.playerPortraits[i]})),...(team.substitutes || [])].filter(p => p.name.trim()) : [];
  };
  const unavailable = disabled || busy || uploads.size > 0;
  const status = <>{error && <p role="alert" className="error">{error === 'uploadUnauthorized' ? t('uploadUnauthorized') : errorMessage(error,state.language)}</p>}{notice && <p className="library-status" role="status">{t(notice)}</p>}</>;
  return <section className="team-library">
    <div className="toolbar"><h3>{t('teamLibrary')}</h3><button type="button" onClick={() => {setOpen(true);void run(refresh);}}>{t('manageTeams')}</button><button type="button" disabled={busy} onClick={() => void run(refresh)}>{t('refreshTeams')}</button></div>
    <p className="muted">{t('presetCopyHint')}</p>
    {locked && <p>{t('presetLocked')}</p>}
    {!open && status}
    <div className="library-sides">{(['blue','red'] as const).map(side => <div key={side}>
      <label>{t(side === 'blue' ? 'blueTeam' : 'redTeam')} · {t('chooseTeam')}<select aria-label={`${t('chooseTeam')} ${t(side === 'blue' ? 'blueTeam' : 'redTeam')}`} value={selected[side]} disabled={unavailable || locked} onChange={e => setSelected({...selected,[side]:e.target.value})}>
        <option value="">{t('chooseTeam')}</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
      </select></label>
      <div className="toolbar"><button type="button" disabled={unavailable || locked || !selected[side] || state[side === 'blue' ? 'redTeam' : 'blueTeam'].id === selected[side]} onClick={() => load(side,selected[side])}>{t('loadTeam')}</button>
        <button type="button" disabled={unavailable} onClick={() => save(form[`${side}Team`],false)}>{t('saveNewTeam')}</button>
        <button type="button" disabled={unavailable || !teams.some(team => team.id === form[`${side}Team`].id)} onClick={() => confirm(t('confirmUpdateTeam')) && save(form[`${side}Team`],true)}>{t('updateSavedTeam')}</button></div>
      <section className="quick-substitution">
        <h4>{t('quickSubstitution')}</h4><p className="muted">{t('substituteHint')}</p>
        <label>{t('rosterSource')}<select aria-label={t('rosterSource')} disabled={unavailable} value={replacement[side].source || (teams.some(team => team.id === state[`${side}Team`].id) ? state[`${side}Team`].id : '')} onChange={e => setReplacement({...replacement,[side]:{...replacement[side],source:e.target.value,player:''}})}><option value="">{t('chooseTeam')}</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
        {teams.some(team => team.id === (replacement[side].source || state[`${side}Team`].id)) ? <>
          <label>{t('chooseRosterPlayer')}<select aria-label={t('chooseRosterPlayer')} value={replacement[side].player} disabled={unavailable} onChange={e => setReplacement({...replacement,[side]:{...replacement[side],player:e.target.value}})}><option value="">{t('chooseRosterPlayer')}</option>{roster(side).map(p => <option key={p.id} value={p.id}>{p.name} · {t(p.role)} · {t(p.id.startsWith('starter-') ? 'starter' : 'reserve')}</option>)}</select></label>
          <label>{t('targetSlot')}<select aria-label={t('targetSlot')} value={replacement[side].slot} disabled={unavailable} onChange={e => setReplacement({...replacement,[side]:{...replacement[side],slot:Number(e.target.value)}})}>{form[`${side}Team`].players.map((name,i) => <option key={i} value={i}>{t('playerNumber',{number:i+1})} · {name || '—'}</option>)}</select></label>
          <button type="button" disabled={unavailable || !roster(side).some(p => p.id === replacement[side].player)} onClick={() => {const player=roster(side).find(p => p.id === replacement[side].player);if(player){onRosterApply(side,replacement[side].slot,player);setNotice('substituteFilled');}}}>{t('applySubstitute')}</button>
        </> : <p>{t('substituteNeedsTeam')}</p>}
      </section>
    </div>)}</div>
    {open && createPortal(<dialog className="library-dialog" ref={dialog} onCancel={e => {e.preventDefault();e.stopPropagation();close();}}>
      <header className="toolbar"><h2>{t('teamLibrary')}</h2><button type="button" disabled={busy} onClick={close}>{t('closeLibrary')}</button></header>
      {status}
      <div className="library-manager"><aside>
        <label>{t('searchTeams')}<input value={query} onChange={e => setQuery(e.target.value)} /></label>
        <button type="button" disabled={unavailable} onClick={() => {if(discard())blank();}}>{t('newTeam')}</button>
        <div className="library-list">{teams.filter(team => team.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(team => <button className={draft.id === team.id ? 'selected' : ''} type="button" key={team.id} disabled={unavailable} onClick={() => {if(!discard())return;edit(team);setError('');setNotice(null);}}>{team.name}</button>)}{!teams.length && <p>{t('noTeams')}</p>}</div>
      </aside><section className="library-editor">
        <label>{t('teamName')}<input maxLength={60} disabled={unavailable} value={draft.name} onChange={e => setDraft({...draft,name:e.target.value})} /></label>
        <label>{t('logoAddress')}<input maxLength={1000} disabled={unavailable} value={draft.logo} onChange={e => setDraft({...draft,logo:e.target.value})} /></label>
        {draft.players.map((player,index) => <div className="player-setting-row" key={`${draft.id}-${index}`}>
          <label>{t('playerNumber',{number:index+1})}<input maxLength={40} disabled={unavailable} value={player} onChange={e => setDraft({...draft,players:draft.players.map((p,i) => i === index ? e.target.value : p)})} /></label>
          <label>{t('lane')}<select disabled={unavailable} value={draft.playerRoles[index]} onChange={e => setDraft({...draft,playerRoles:draft.playerRoles.map((r,i) => i === index ? e.target.value as typeof r : r)})}>{(['clash','jungle','mid','farm','roam'] as const).map(role => <option key={role} value={role}>{t(role)}</option>)}</select></label>
          <PortraitField library value={draft.playerPortraits[index]} token={token} lang={state.language} disabled={disabled || busy} onChange={url => setDraft(previous => ({...previous,playerPortraits:previous.playerPortraits.map((p,i) => i === index ? url : p)}))} onBusy={uploading => setUploads(previous => {const next = new Set(previous);if(uploading)next.add(index);else next.delete(index);return next;})} />
        </div>)}
        <section className="substitute-editor"><h3>{t('substitutes')}</h3>
          {draft.substitutes.map((player,index) => <div className="player-setting-row reserve-row" key={player.id}>
            <label>{t('substituteName')}<input maxLength={40} disabled={unavailable} value={player.name} onChange={e => setDraft({...draft,substitutes:draft.substitutes.map((p,i) => i === index ? {...p,name:e.target.value} : p)})}/></label>
            <label>{t('lane')}<select disabled={unavailable} value={player.role} onChange={e => setDraft({...draft,substitutes:draft.substitutes.map((p,i) => i === index ? {...p,role:e.target.value as typeof p.role} : p)})}>{(['clash','jungle','mid','farm','roam'] as const).map(role => <option key={role} value={role}>{t(role)}</option>)}</select></label>
            <PortraitField library value={player.portrait} token={token} lang={state.language} disabled={disabled || busy} onChange={url => setDraft(previous => ({...previous,substitutes:previous.substitutes.map(p => p.id === player.id ? {...p,portrait:url} : p)}))} onBusy={uploading => setUploads(previous => {const next=new Set(previous);if(uploading)next.add(index+5);else next.delete(index+5);return next;})}/>
            <button type="button" disabled={unavailable} onClick={() => setDraft({...draft,substitutes:draft.substitutes.filter(p => p.id !== player.id)})}>{t('removeSubstitute')}</button>
          </div>)}
          <button type="button" disabled={unavailable || draft.substitutes.length >= 20} onClick={() => setDraft({...draft,substitutes:[...draft.substitutes,{id:createClientUUID(),name:'',role:'roam',portrait:''}]})}>{t('addSubstitute')}</button>
        </section>
        <div className="toolbar"><button type="button" className="primary" disabled={unavailable || !draft.name.trim()} onClick={() => (!draft.id || confirm(t('confirmUpdateTeam'))) && save(draft,!!draft.id)}>{t('saveTeam')}</button>
          <button type="button" disabled={unavailable || !draft.id} onClick={() => {if(confirm(t('confirmDeleteTeam'))) void run(async () => {await request(`/${draft.id}`,'DELETE');refreshVersion.current++;setTeams(previous=>previous.filter(team=>team.id!==draft.id));setSelected(previous=>({blue:previous.blue===draft.id?'':previous.blue,red:previous.red===draft.id?'':previous.red}));blank();setNotice('presetDeleted');});}}>{t('deleteTeam')}</button>
          {(['blue','red'] as const).map(side => <button key={side} type="button" disabled={unavailable || locked || !draft.id || state[side === 'blue' ? 'redTeam' : 'blueTeam'].id === draft.id} onClick={() => load(side,draft.id)}>{t('loadTeam')} · {t(side === 'blue' ? 'blueTeam' : 'redTeam')}</button>)}
        </div>
      </section></div>
    </dialog>,document.body)}
  </section>;
}
