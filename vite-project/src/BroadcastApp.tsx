import { AiRecognitionSettings } from './control/AiRecognitionSettings';
import { PostGamePanel } from './control/PostGamePanel';
import { MvpOverlay } from './overlay/MvpOverlay';
import { PostGameBroadcast } from './overlay/PostGameBroadcast';
import { LiveGamePanel } from './control/LiveGamePanel';
import { GameHud } from './overlay/GameHud';
import { RecoveryPanel } from './control/RecoveryPanel';
import { PlayerSlotAlignment } from './control/PlayerSlotAlignment';
import { lazy, Suspense, useEffect, useState } from 'react';
import './broadcast.css';
import './BroadcastApp.css';
import { heroForState } from './shared/heroData';
import {
  phases,
  type Action,
  type Language,
  type MatchSettings,
  type MatchState,
  type PlayerRole,
  type Role,
  type Side,
} from './shared/types';
import { ViewportCanvas } from './shared/ViewportCanvas';
import { useAccess } from './shared/access';
import { AccessSettings } from './control/AccessSettings';
import { useMatch } from './shared/useMatch';
import { portraitAssetURL } from './shared/config';
import { connectionLabel, phaseName, seriesName, stageName, teamName, draftRuleName } from './shared/display';
import { translator } from './shared/i18n';
import { errorMessage } from './shared/errorMessages';
import { currentGame, displaySides, normalizeState, ruleLocked } from './shared/draftRules';
import { TeamLibrary } from './control/TeamLibrary';
import { PortraitField } from './control/PortraitField';
import { ControlHeroPicker } from './control/ControlHeroPicker';
import { ControlDraftWorkspace } from './control/ControlDraftWorkspace';
import { useSettingsDraft } from './control/useSettingsDraft';
import { SettingsDialog } from './control/SettingsDialog';
import { TeamSettingsDialog } from './control/TeamSettingsDialog';
const ScreenInput=lazy(()=>import('./control/ScreenInput').then(module=>({default:module.ScreenInput})));
const HeroArtEditorDialog=lazy(()=>import('./control/HeroArtEditorDialog').then(module=>({default:module.HeroArtEditorDialog})));
import { LineupAssignments } from './control/LineupAssignments';
import { Score } from './shared/Score';
import { DraftHistory } from './shared/DraftHistory';
import { OperatorGuide } from './control/OperatorGuide';
import { ObsDirectorPanel } from './control/ObsDirectorPanel';
import { DraftLifecycle } from './control/DraftLifecycle';
import { DraftOverlay } from './overlay/DraftOverlay';
const name = (state: MatchState, id: number, lang: Language) => { const h = heroForState(state, id); return h ? (lang === 'zh' ? h.chineseName : h.englishName) : '—'; };
function HeroSlot({ state, id, ban = false, lang }: { state: MatchState; id?: number | null; ban?: boolean; lang: Language }) {
  const t = translator(lang);
  const skipped = ban && id === null;
  return <div className={`hero-slot ${ban ? 'ban' : ''} ${id ? 'filled' : ''} ${skipped ? 'skipped-ban' : ''}`} key={id ?? (skipped ? 'skipped' : 'empty')}>
    {id ? <><img src={heroForState(state,id)?.imageLink} alt={name(state,id, lang)} /><span>{name(state,id, lang)}</span>{ban && <b className="ban-mark">╱</b>}</>
      : <span className={skipped ? 'empty skipped-ban-label' : 'empty'}>{skipped ? t('emptyBan') : t(ban ? 'ban' : 'emptyPick')}</span>}
  </div>;
}
function Board({ state, lang, compact = false }: { state: MatchState; lang: Language; compact?: boolean }) {
  const t = translator(lang);
  const phase = phases(state.draftMode, state.firstPickSide,state.banCount)[state.currentPhase];
  return <section className={`board ${compact ? 'compact-board' : ''}`}><div className="match-strip"><span>{t('gameTitle')}</span><span>{stageName(state.stage, lang)} · {t('gameNumber', { number: currentGame(state) })} · {seriesName(state.seriesFormat, lang)} · {draftRuleName(state, lang)}</span></div>
    <div className="team-grid">{displaySides(state).map(side => <section key={side} className={`team ${side} ${phase?.team === side ? 'active' : ''}`}><header>{state[`${side}Team`].logo && <img className="logo" src={portraitAssetURL(state[`${side}Team`].logo)} alt="" />}<h2>{teamName(state, side)}</h2><Score state={state} side={side} /></header><div className="picks">{Array.from({ length: 5 }, (_, i) => <HeroSlot key={i} state={state} id={state[`${side}Picks`][i]} lang={lang} />)}</div><div className="bans"><small>{t('ban')}</small>{Array.from({ length: state.banCount }, (_, i) => <HeroSlot key={i} state={state} id={state[`${side}Bans`][i]} ban lang={lang} />)}</div></section>)}</div>
    <footer className={`phase ${phase?.team || ''}`} key={state.currentPhase}>{phase ? `${phaseName(state, lang)} · ${t('phaseStep', { step: state.currentPhase + 1, total: phases(state.draftMode, state.firstPickSide,state.banCount).length })}` : t('draftComplete')}</footer></section>;
}
function TeamAnalysis({
  state,
  lang,
  side,
}: {
  state: MatchState;
  lang: Language;
  side: Side;
}) {
  const t = translator(lang);
  const picks = state[`${side}Picks`], enemy = state[`${side === 'blue' ? 'red' : 'blue'}Picks`];
  const selected = [...state.bluePicks, ...state.redPicks];
  const groups = [
    { title: t('synergy'), sources: picks, field: 'combo' as const },
    { title: t('ourCounters'), sources: picks, field: 'counter' as const },
    { title: t('counteredBy'), sources: picks, field: 'beCountered' as const },
    { title: t('enemyCounters'), sources: enemy, field: 'beCountered' as const },
  ];
  return <section className={`panel analysis analysis-${side}`} data-side={side}>
    <header className="analysis-team-header">
      {state[`${side}Team`].logo && <img className="analysis-logo" src={portraitAssetURL(state[`${side}Team`].logo)} alt="" />}
      <div><span className="analysis-side">{t(side === 'blue' ? 'blueAnalysis' : 'redAnalysis')}</span><h2>{teamName(state, side)}</h2></div>
      <span className="analysis-opponent">{t('opponent', { team: teamName(state, side === 'blue' ? 'red' : 'blue') })}</span>
    </header>
    <small>{t('relationshipHint')}</small><div className="analysis-grid">{groups.map(g => {
      const ids = [...new Set(g.sources.flatMap(id => heroForState(state,id)?.[g.field] || []))].filter(id => heroForState(state,id) && !state.blueBans.includes(id) && !state.redBans.includes(id));
      return <article key={g.title}><h3>{g.title}</h3>{ids.length ? <div className="recommendations">{ids.map(id => <div className="recommendation" key={id}><img src={heroForState(state,id)?.imageLink} alt="" /><div><b>{name(state,id, lang)}{selected.includes(id) ? ' ✓' : ''}</b><small>{g.sources.filter(s => heroForState(state,s)?.[g.field]?.includes(id)).map(s => name(state,s, lang)).join(' · ')}</small></div></div>)}</div> : <p className="muted">{t('noRelationships')}</p>}</article>;
    })}</div></section>;
}
function Analysis({
  state,
  lang,
}: {
  state: MatchState;
  lang: Language;
}) {
  return (
    <section className="dual-analysis">
      {displaySides(state).map(side => <TeamAnalysis key={state[`${side}Team`].id} state={state} lang={lang} side={side} />)}
    </section>
  );
}
const settingsFromState = (state: MatchState): MatchSettings => ({
  blueTeam: state.blueTeam,
  redTeam: state.redTeam,
  blueScore: state.blueScore,
  redScore: state.redScore,
  gameNumber: state.gameNumber,
  seriesFormat: state.seriesFormat,
  stage: state.stage,
  draftMode: state.draftMode,
  heroPool:state.heroPool,
  banCount:state.banCount,
  draftRuleMode: state.draftRuleMode,
  flowbornFormsIndependent: state.flowbornFormsIndependent,
  firstPickSide: state.firstPickSide,
  sideSwapMode: state.sideSwapMode,
  language: state.language,
  overlayLayout: state.overlayLayout,
  scoreDisplay: state.scoreDisplay,
  bpInputMode: state.bpInputMode,
  recognitionAutoAccept: state.recognitionAutoAccept ?? false,
  recognitionThreshold: state.recognitionThreshold ?? 90,
  showHeroName: state.showHeroName,
  artSourceMode: state.artSourceMode,
});

function MatchSettingsPanel({ state, send, disabled, token }: { state: MatchState; send: (a: Action) => void; disabled: boolean; token: string }) {
  const t = translator(state.language);
  const { form, setForm, dirty, conflicts, reset } = useSettingsDraft(settingsFromState(state));
  const firstPickLocked = state.currentPhase > 0;
  return <form data-unsaved={dirty} className="panel settings match-settings-panel" onSubmit={event => {
    event.preventDefault();
    if (disabled || conflicts.length) return;
    send({ type: 'settings', settings: {
      ...form,
      blueTeam: state.blueTeam,
      redTeam: state.redTeam,
      blueScore: state.blueScore,
      redScore: state.redScore,
      gameNumber: state.gameNumber,
    } });
  }}>
    <AiRecognitionSettings token={token} zh={state.language === 'zh'} />
    <div className="match-settings-grid">
      <section><h3>{t('matchDisplay')}</h3>
        <label>{t('stage')}<input maxLength={80} value={form.stage} onChange={e => setForm({ ...form, stage: e.target.value })} /></label>
        <label>{t('seriesFormat')}<select disabled={state.draftHistory.length > 0} value={form.seriesFormat} onChange={e => setForm({ ...form, seriesFormat: e.target.value as MatchSettings['seriesFormat'] })}>
          {(['BO1', 'BO3', 'BO5'] as const).map(format => <option key={format} value={format}>{seriesName(format, state.language)}</option>)}
        </select></label>
        <label>{t('currentGame')}<div className="readonly-field">{t('gameNumber', { number: state.gameNumber })} · {t('automatic')}</div></label>
        <label>{t('draftMode')}<select disabled={state.currentPhase > 0} value={form.draftMode} onChange={e => setForm({ ...form, draftMode: e.target.value as MatchSettings['draftMode'],banCount:e.target.value==='normal'?2:4 })}>
          <option value="match">{t('matchMode')}</option><option value="normal">{t('normalMode')}</option>
        </select></label>
        <label>{state.language==='zh'?'英雄池服务器':'Hero pool region'}<select aria-label="Hero pool" disabled={ruleLocked(state)} value={form.heroPool} onChange={e=>setForm({...form,heroPool:e.target.value as MatchSettings['heroPool'],recognitionAutoAccept:false})}>
          <option value="global">{state.language==='zh'?'国际服 · Honor of Kings':'Global · Honor of Kings'}</option>
          <option value="cn">{state.language==='zh'?'国服 · 王者荣耀':'CN · 王者荣耀'}</option>
        </select><small>{state.language==='zh'?'国服英雄资料使用独立目录；若使用屏幕识别，请先校准国服头像模板。':'CN heroes use a separate catalog. Calibrate CN hero recognition before auto capture.'}</small></label>
        <label>{state.language==='zh'?'每队 Ban 数量':'Bans per team'}<select aria-label="Bans per team" disabled={ruleLocked(state)} value={form.banCount} onChange={e=>setForm({...form,banCount:Number(e.target.value) as MatchSettings['banCount']})}>
          {([0,1,2,3,4,5] as const).map(count=><option key={count} value={count}>{count} Ban / {state.language==='zh'?'每队':'side'}</option>)}
        </select><small>{state.language==='zh'?'Match 模式先 Ban 最多两轮，余下 Ban 在第二次选人阶段后执行；Normal 模式先完成全部 Ban。':'Match mode bans up to two each before picks and the remainder mid-draft. Normal mode bans all first.'}</small></label>
        <label>{t('draftRules')}<select aria-label={t('draftRules')} disabled={ruleLocked(state)} value={form.draftRuleMode} onChange={e => setForm({ ...form, draftRuleMode: e.target.value as MatchSettings['draftRuleMode'] })}>
          <option value="normal">{t('ruleNormal')}</option><option value="player">{t('rulePlayer')}</option><option value="global">{t('ruleGlobal')}</option>
        </select></label>
        <label>{t('flowbornRule')}<select aria-label={t('flowbornRule')} disabled={ruleLocked(state)} value={form.flowbornFormsIndependent ? 'independent' : 'shared'} onChange={e => setForm({ ...form, flowbornFormsIndependent: e.target.value === 'independent' })}>
          <option value="independent">{t('flowbornIndependent')}</option>
          <option value="shared">{t('flowbornShared')}</option>
        </select><small>{t('flowbornRuleHint')}</small></label>
        {ruleLocked(state) && <p className="muted">{t('rulesLocked')}</p>}
      </section>
      <section><h3>{t('matchSettings')}</h3>
        <label>{t('firstPickSide')}<select aria-label={t('firstPickSide')} disabled={firstPickLocked} value={form.firstPickSide} onChange={e => setForm({ ...form, firstPickSide: e.target.value as Side })}>
          <option value="blue">{t('blueSide')}</option><option value="red">{t('redSide')}</option>
        </select></label>
        <label>{t('sideSwapMode')}<select aria-label={t('sideSwapMode')} value={form.sideSwapMode} onChange={e => setForm({ ...form, sideSwapMode: e.target.value as MatchSettings['sideSwapMode'] })}>
          <option value="moveTeams">{t('moveTeams')}</option><option value="colorsOnly">{t('colorsOnly')}</option>
        </select></label>
        <label>{t('language')}<select aria-label={t('language')} value={form.language} onChange={e => setForm({ ...form, language: e.target.value as Language })}>
          <option value="zh">{t('chinese')}</option><option value="eng">{t('english')}</option>
        </select><small>{t('languageHint')}</small></label>
        <label>{t('scoreDisplay')}<select value={form.scoreDisplay || 'number'} onChange={e => setForm({ ...form, scoreDisplay: e.target.value as MatchSettings['scoreDisplay'] })}><option value="number">{t('scoreNumber')}</option><option value="boxes">{t('scoreBoxes')}</option></select></label>
        <label>{t('bpInputMode')}<select value={form.bpInputMode || 'manual'} onChange={e => setForm({ ...form, bpInputMode: e.target.value as MatchSettings['bpInputMode'] })}><option value="manual">{t('manualInput')}</option><option value="screen">{t('screenInput')}</option></select></label>
        {form.bpInputMode === 'screen' && <details className="advanced-options"><summary>{state.language === 'zh' ? '屏幕识别 · 高级选项' : 'Screen recognition · advanced'}</summary>
          <label className="settings-checkbox"><span>{state.language === 'zh' ? '高相似度自动输入' : 'Automatically accept high similarity'}</span><input type="checkbox" disabled={form.heroPool==='cn'} checked={form.heroPool!=='cn'&&(form.recognitionAutoAccept ?? false)} onChange={e => setForm({...form, recognitionAutoAccept:e.target.checked})} /></label>
          <label>{state.language === 'zh' ? '相似度阈值 (%)' : 'Similarity threshold (%)'}<input type="number" min={50} max={100} step={1} value={form.recognitionThreshold ?? 90} onChange={e => setForm({...form, recognitionThreshold:Number(e.target.value)})} /></label>
          <small>{state.language === 'zh' ? '国服暂未训练独有英雄模板，因此自动输入强制关闭。相似度不是准确率；仍需稳定帧和锁定证据。低于或等于阈值、空 Ban 均需审核。' : 'Similarity is not accuracy. Stable frames and lock evidence remain required. At or below the threshold, and empty bans, require review.'}</small>
        </details>}
        <label>{t('overlayLayout')}<select value={form.overlayLayout} onChange={e => setForm({ ...form, overlayLayout: e.target.value as MatchSettings['overlayLayout'] })}>
          <option value="panel">{t('panelLayout')}</option><option value="side">{t('sideLayout')}</option>
        </select></label>
        <label>{t('heroImageSource')}<select value={form.artSourceMode} onChange={e => setForm({ ...form, artSourceMode: e.target.value as MatchSettings['artSourceMode'] })}>
          <option value="auto">{t('heroImageAuto')}</option><option value="legacy">{t('heroImageLegacy')}</option>
        </select></label>
        <label className="settings-checkbox"><span>{t('showHeroName')}</span><input type="checkbox" checked={form.showHeroName} onChange={e => setForm({ ...form, showHeroName: e.target.checked })} /><small>{t('showHeroNameHint')}</small></label>
      </section>
    </div>
    <SettingsDraftNotice zh={state.language === 'zh'} dirty={dirty} conflict={conflicts.length > 0} reset={reset} />
    <button disabled={disabled || conflicts.length > 0} className="primary">{t('saveSettings')}</button>
  </form>;
}

function TeamSettingsPanel({ state, send, disabled, token }: { state: MatchState; send: (a: Action) => void; disabled: boolean; token: string }) {
  const t = translator(state.language);
  const { form, setForm, dirty, conflicts, reset } = useSettingsDraft(settingsFromState(state));
  const [uploads, setUploads] = useState<Set<string>>(() => new Set());
  return <form data-unsaved={dirty} className="panel settings team-settings-panel" onSubmit={event => {
    event.preventDefault();
    if (disabled || uploads.size || conflicts.length) return;
    send({ type: 'settings', settings: {
      ...settingsFromState(state),
      blueTeam: form.blueTeam,
      redTeam: form.redTeam,
      blueScore: state.blueScore,
      redScore: state.redScore,
      gameNumber: state.gameNumber,
    } });
  }}>
    <TeamLibrary onRosterApply={(side,index,player) => setForm(previous => {const key = side === 'blue' ? 'blueTeam' : 'redTeam';const team=previous[key];return {...previous,[key]:{...team,players:team.players.map((p,i) => i === index ? player.name : p),playerRoles:team.playerRoles.map((r,i) => i === index ? player.role : r),playerPortraits:team.playerPortraits.map((p,i) => i === index ? player.portrait : p)}};})} state={state} form={form} token={token} disabled={disabled || uploads.size > 0} send={send} />
    <div className="settings-grid team-settings-grid">
      {displaySides(state).map(side => {
        const teamKey = side === 'blue' ? 'blueTeam' : 'redTeam';
        const updateTeam = (patch: Partial<MatchState['blueTeam']>) => setForm(previous => ({ ...previous, [teamKey]: { ...previous[teamKey], ...patch } }));
        return <section key={side}>
          <h3>{t(teamKey)}</h3>
          <label>{t('teamName')}<input required maxLength={60} value={form[teamKey].name} onChange={e => updateTeam({ name: e.target.value })} /></label>
          <label>{t('logoAddress')}<input maxLength={1000} placeholder={t('logoPlaceholder')} value={form[teamKey].logo} onChange={e => updateTeam({ logo: e.target.value })} /></label>
          <b>{t('players')}</b>
          {form[teamKey].players.map((player, index) => <div className="player-setting-row" key={index}>
            <label>{t('playerNumber', { number: index + 1 })}<input maxLength={40} disabled={disabled} value={player} onChange={e => updateTeam({ players: form[teamKey].players.map((p, i) => i === index ? e.target.value : p) })} /></label>
            <label>{t('lane')}<select disabled={disabled} value={form[teamKey].playerRoles[index]} onChange={e => updateTeam({ playerRoles: form[teamKey].playerRoles.map((r, i) => i === index ? e.target.value as typeof r : r) })}>
              {(['clash', 'jungle', 'mid', 'farm', 'roam'] as const).map(role => <option key={role} value={role}>{t(role)}</option>)}
            </select></label>
            <PortraitField value={form[teamKey].playerPortraits[index]} token={token} lang={state.language} disabled={disabled}
              onChange={url => setForm(previous => ({...previous,[teamKey]:{...previous[teamKey],playerPortraits:previous[teamKey].playerPortraits.map((p,i) => i === index ? url : p)}}))}
              onBusy={busy => setUploads(previous => { const next = new Set(previous); if(busy) next.add(`${side}-${index}`); else next.delete(`${side}-${index}`); return next; })} />
          </div>)}
        </section>;
      })}
    </div>
    <SettingsDraftNotice zh={state.language === 'zh'} dirty={dirty} conflict={conflicts.length > 0} reset={reset} />
    <button disabled={disabled || uploads.size > 0 || conflicts.length > 0} className="primary">{t('saveSettings')}</button>
  </form>;
}
function SettingsDraftNotice({ zh, dirty, conflict, reset }: { zh: boolean; dirty: boolean; conflict: boolean; reset: () => void }) {
  return <div className="settings-draft-notice">
    <p role={conflict ? 'alert' : 'status'} className={conflict ? 'error' : 'muted'}>{conflict
      ? (zh ? '这些设置已在其他页面更改。请重新载入后再编辑，避免覆盖。' : 'These settings changed in another page. Reload them before editing to avoid overwriting changes.')
      : dirty ? (zh ? '有尚未保存的修改。' : 'You have unsaved changes.') : (zh ? '设置已同步。' : 'Settings are up to date.')}</p>
    {(dirty || conflict) && <button type="button" onClick={reset}>{zh ? '重新载入设置' : 'Reload settings'}</button>}
  </div>;
}
function mayCloseSettings(id: string, zh: boolean) {
  return !document.getElementById(id)?.querySelector('[data-unsaved="true"]')
    || confirm(zh ? '设置尚未保存，确定放弃修改并关闭？' : 'Discard unsaved settings and close?');
}
function savedLanguage(role: Role): Language {
  try { return sessionStorage.getItem(`hok-language-${role}`) === 'eng' ? 'eng' : 'zh'; }
  catch { return 'zh'; }
}
export default function BroadcastApp() {
  const role: Role = location.pathname === '/caster' ? 'caster' : location.pathname.startsWith('/overlay/') ? 'overlay' : 'control';
  const {token,saveToken:setToken,local,checking,accessError,loggingIn,login}=useAccess(role);
  const [showAccess,setShowAccess]=useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showTeamSettings, setShowTeamSettings] = useState(false);
  const [showHeroArtEditor, setShowHeroArtEditor] = useState(false);
  const [manualFallbackOpen, setManualFallbackOpen] = useState(false);
  const [delayInput, setDelayInput] = useState('');
  const [lastLanguage, setLastLanguage] = useState<Language>(() => savedLanguage(role));
  const { snapshot, status, error, pending, send, acknowledged } = useMatch(role, token, setToken);
  const connected = status === 'Connected';
  const compatible = !!snapshot?.state && Array.isArray(snapshot.state.draftHistory) && !!snapshot.state.draftRuleMode && !!snapshot.state.firstPickSide && !!snapshot.state.sideSwapMode && !!snapshot.state.displayLeftSide && typeof snapshot.state.showHeroName === 'boolean' && !!snapshot.state.artSourceMode && !!snapshot.state.heroArtOverrides && typeof snapshot.state.flowbornFormsIndependent === 'boolean';
  const disabled = !connected || pending || !compatible;
  const state = snapshot?.state ? normalizeState(snapshot.state) : undefined;
  const lang: Language = token && !['Invalid token', 'Access rejected'].includes(status) ? state?.language ?? lastLanguage : lastLanguage;
  const t = translator(lang);
  useEffect(() => {
    document.documentElement.lang = lang === 'eng' ? 'en' : 'zh-CN';
    document.title = translator(lang)('appName');
    try { sessionStorage.setItem(`hok-language-${role}`, lang); } catch { /* Browser storage is optional. */ }
    setLastLanguage(lang);
  }, [lang, role]);
  const serverDelay = snapshot?.casterDelaySeconds;
  useEffect(() => {
    if (serverDelay !== undefined) setDelayInput(String(serverDelay));
  }, [serverDelay]);
  function closeMatchSettings() { if (mayCloseSettings('match-settings', lang === 'zh')) setShowSettings(false); }
  function closeTeamSettings() { if (mayCloseSettings('team-settings', lang === 'zh')) setShowTeamSettings(false); }
  if (checking) return <main className="login panel">{t('connectingServer')}</main>;
  if (!token || status === 'Invalid token' || status === 'Access rejected') {
    return <main className="login panel">
      <p>{t('appName')}</p><h1>{role === 'overlay' ? (lang === 'zh' ? '直播画面登录' : 'Overlay login') : t(role === 'caster' ? 'casterLogin' : 'controlLogin')}</h1>
      <form onSubmit={e => { e.preventDefault(); void login(tokenInput); }}>
        <label>{lang === 'zh'?'访问密码 / Token':'Password / Token'}<input type="password" required value={tokenInput} onChange={e => setTokenInput(e.target.value)} /></label>
        <button disabled={loggingIn} className="primary">{loggingIn ? (lang === 'zh' ? '正在连接…' : 'Connecting…') : t('connect')}</button>
      </form><p>{accessError ? errorMessage(accessError, lang) : connectionLabel(status, lang)}</p>
    </main>;
  }
  const matchupRole=/^\/overlay\/postgame-(clash|jungle|mid|farm|roam)$/.exec(location.pathname)?.[1] as PlayerRole|undefined;
  if (role === 'overlay') return <ViewportCanvas className="overlay">{state ? (location.pathname==='/overlay/game-hud'?<GameHud state={state}/>:location.pathname==='/overlay/mvp'?<MvpOverlay state={state}/>:matchupRole?<PostGameBroadcast state={state} mode="compare" compareRole={matchupRole}/>:location.pathname==='/overlay/postgame-compare'?<PostGameBroadcast state={state} mode="compare"/>:location.pathname==='/overlay/game-progress'?<PostGameBroadcast state={state} mode="progress"/>:<DraftOverlay state={state} />) : <p className="notice">{connectionLabel(status,lang)}</p>}</ViewportCanvas>;
  return <main className={`workspace ${role === 'control' ? 'control-workspace' : ''}`}>
    <header className="topbar">
      <div><span className="eyebrow">{t(role === 'caster' ? 'casterEyebrow' : 'controlEyebrow')}</span><h1>{t('brandTitle')} <span>{t('brandSubtitle')}</span></h1></div>
      <div className="toolbar">
        <b className={connected ? 'status live' : 'status'}>{connectionLabel(status, lang)}</b>
        <span>{role === 'caster' ? t('delayedFeed', { seconds: snapshot?.casterDelaySeconds ?? '—' }) : t('controlRealtime')}</span>
        {role === 'control' && <button onClick={()=>setShowAccess(value=>!value)}>{lang === 'zh'?'访问与网站设置':'Access and website settings'}</button>}
        {!local && <button onClick={() => setToken('')}>{t('logout')}</button>}
      </div>
    </header>
    {showAccess && role === 'control' && <SettingsDialog id="access-settings" label={lang === 'zh'?'访问与网站设置':'Access and website settings'} closeLabel={t('hideSettings')} onClose={()=>setShowAccess(false)}><AccessSettings token={token} onToken={setToken} zh={lang === 'zh'} /></SettingsDialog>}
    {!connected && <p className="notice">{t('disconnectedNotice')}</p>}
    {connected && !compatible && <p className="notice">{t('backendUpgrade')}</p>}
    {error && <p role="alert" className="error">{errorMessage(error, lang)}</p>}
    {state ? <>
      {role === 'caster' && <Board state={state} lang={lang} />}
      {role === 'control' && <>
        <OperatorGuide state={state} connected={connected} pending={pending} onTeams={() => setShowTeamSettings(true)} onSettings={() => setShowSettings(true)} />
        <ObsDirectorPanel token={token} zh={lang==='zh'} state={state} />
        <ControlDraftWorkspace monitor={<>
          <Board state={state} lang={lang} compact />
          <section className="operator-bar panel">
            <div className="toolbar">
              <button disabled={disabled || !snapshot?.canUndo} onClick={() => send({ type: 'undo' })}>{t('undo')}</button>
              <button disabled={disabled} onClick={() => confirm(t('confirmResetDraft')) && send({ type: 'reset_draft' })}>{t('resetDraft')}</button>
              <button className="danger" disabled={disabled} onClick={() => confirm(t('confirmResetMatch')) && send({ type: 'reset_match' })}>{t('resetMatch')}</button>
              <button aria-expanded={showSettings} aria-controls="match-settings" onClick={() => showSettings ? closeMatchSettings() : setShowSettings(true)}>{t('matchSettings')}</button>
              <button onClick={() => setShowTeamSettings(true)}>{t('teamSettings')}</button>
              <button onClick={() => setShowHeroArtEditor(true)}>{t('heroImageSettings')}</button>
            </div>
            <div className="delay-controls">
              <b>{t('casterDelay', { seconds: snapshot?.casterDelaySeconds ?? '—' })}</b>
              {[-10, -5, -1, 1, 5, 10].map(n => <button key={n}
                aria-label={t(n > 0 ? 'increaseDelay' : 'decreaseDelay', { seconds: Math.abs(n) })}
                disabled={disabled || (snapshot?.casterDelaySeconds || 0) + n < 0 || (snapshot?.casterDelaySeconds || 0) + n > 3600}
                onClick={() => send({ type: 'delay', seconds: (snapshot?.casterDelaySeconds || 0) + n })}>{n > 0 ? '+' : ''}{n} {t('secondsShort')}</button>)}
              <input aria-label={t('delayInput')} type="number" min={0} max={3600} value={delayInput} onChange={e => setDelayInput(e.target.value)} />
              <button disabled={disabled || !delayInput.trim() || !Number.isInteger(Number(delayInput)) || Number(delayInput) < 0 || Number(delayInput) > 3600} onClick={() => send({ type: 'delay', seconds: Number(delayInput) })}>{t('setDelay')}</button>
            </div>
          </section>

          <DraftLifecycle state={state} send={send} disabled={disabled} />
          {showSettings && <SettingsDialog label={t('matchSettings')} closeLabel={t('hideSettings')} onClose={closeMatchSettings}><MatchSettingsPanel state={state} send={send} disabled={disabled} token={token} /></SettingsDialog>}
          {state.bpInputMode!=='screen'&&<PlayerSlotAlignment state={state} token={token} disabled={disabled} send={send} />}
          {state.bpInputMode!=='screen'&&<LineupAssignments state={state} revision={snapshot!.revision} token={token} disabled={disabled} send={send} acknowledged={acknowledged} error={error} />}
        </>}>
          {state.bpInputMode === 'screen'
            ? <div className="screen-recognition-workspace">
              <Suspense fallback={<p>{t('connectingServer')}</p>}><ScreenInput state={state} revision={snapshot!.revision} token={token} disabled={disabled} send={send} /></Suspense>
              <PlayerSlotAlignment state={state} token={token} disabled={disabled} send={send} />
              <LineupAssignments state={state} revision={snapshot!.revision} token={token} disabled={disabled} send={send} acknowledged={acknowledged} error={error} />
              <details className="manual-picker-fallback" onToggle={event=>setManualFallbackOpen(event.currentTarget.open)}>
                <summary>{t('manualFallbackTitle')}</summary>
                <p className="muted">{t('manualFallbackHint')}</p>
                <ControlHeroPicker state={state} disabled={disabled} active={manualFallbackOpen && !showAccess && !showSettings && !showTeamSettings && !showHeroArtEditor} send={send} acknowledged={acknowledged} />
              </details>
            </div>
            : <ControlHeroPicker state={state} disabled={disabled} active={!showAccess && !showSettings && !showTeamSettings && !showHeroArtEditor} send={send} acknowledged={acknowledged} />}
        </ControlDraftWorkspace>
        {showTeamSettings && <TeamSettingsDialog label={t('teamSettings')} closeLabel={t('closeTeamSettings')} onClose={closeTeamSettings}>
          <TeamSettingsPanel state={state} send={send} disabled={disabled} token={token} />
        </TeamSettingsDialog>}
        {showHeroArtEditor && <Suspense fallback={<p>{t('connectingServer')}</p>}><HeroArtEditorDialog state={state} send={send} disabled={disabled} onClose={() => setShowHeroArtEditor(false)} /></Suspense>}
        <section id="postgame-tools" className="control-secondary-tools" aria-label={lang==='zh'?'赛后与维护工具':'Post-game and maintenance tools'}>
          <PostGamePanel state={state} token={token} disabled={disabled} send={send} />
          <LiveGamePanel state={state} token={token} disabled={disabled} send={send} />
          <RecoveryPanel token={token} zh={state.language==='zh'} />
        </section>
      </>}
      <DraftHistory state={state} />
      <Analysis state={state} lang={lang} />
    </> : <section className="panel"><h2>{t('connectingServer')}</h2></section>}
    <footer className="page-footer">{t('communitySystem')} · {t(role === 'caster' ? 'readOnlyFooter' : 'serverFooter')} · {t('rosterUpdated', { date: '2026-09-16' })}</footer>
  </main>;
}
