import { playerAtSlot } from '../shared/playerSlots';
import { useEffect, useRef, useState } from 'react';
import { heroesForState } from '../shared/heroData';
import { draftHeroUsed, draftRestriction } from '../shared/draftRules';
import { lanes, laneName, phaseName } from '../shared/display';
import { translator } from '../shared/i18n';
import { phases, type Action, type MatchState } from '../shared/types';
import { heroSortCoverage, heroSortModes, sortHeroes, type HeroSortMode } from './heroSort';
import { enterTarget, heroMatchesSearch } from './heroSearch';

export function ControlHeroPicker({ state, disabled, active, send, acknowledged }: {
  state: MatchState; disabled: boolean; active: boolean; send: (action: Action) => void;
  acknowledged?: { id: string; action: Action };
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sortMode, setSortMode] = useState<HeroSortMode>(() => {
    let saved: HeroSortMode | null = null;
    try { saved = localStorage.getItem('hok-hero-sort-mode') as HeroSortMode | null; } catch { /* Sorting still works without browser storage. */ }
    return saved && heroSortModes.includes(saved) ? saved : (state.language === 'zh' ? 'name-zh' : 'name-en');
  });
  const [recorded, setRecorded] = useState<Action>();
  const searchInput = useRef<HTMLInputElement>(null);
  const activeRef = useRef(active); activeRef.current = active;
  const t = translator(state.language), phase = phases(state.draftMode, state.firstPickSide,state.banCount)[state.currentPhase];
  const heroes = heroesForState(state);
  const unavailable = (id: number) => disabled || !phase || !!state.committedGameId || draftHeroUsed(state, id) || !!draftRestriction(state, phase.team, phase.action, id);
  const filtered = heroes.filter(h => (filter === 'all' || h.occupation === filter || h.altOccupation === filter)
    && heroMatchesSearch(h, search, state.language));
  const visible = sortHeroes(filtered, sortMode, unavailable);
  const eligible = visible.filter(h => !unavailable(h.id));
  const enterHero = enterTarget(eligible, search);
  const sortCoverage = heroSortCoverage(filtered, sortMode);
  const metadataSort = sortMode === 'release' || sortMode === 'pick-rate';
  useEffect(() => {
    if (!acknowledged || !['draft_action','skip_ban'].includes(acknowledged.action.type)) { setRecorded(undefined); return; }
    setSearch(''); setRecorded(acknowledged.action);
    const frame = requestAnimationFrame(() => { if (activeRef.current) searchInput.current?.focus({ preventScroll: true }); });
    const timer = setTimeout(() => setRecorded(undefined), 1000);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [acknowledged]);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (!active || event.isComposing || event.repeat || document.querySelector('dialog[open]')) return;
      const target = event.target as HTMLElement;
      const editing = target.closest('input, textarea, select, [contenteditable="true"]');
      if (editing && target !== searchInput.current) return;
      if ((!event.ctrlKey && !event.metaKey && event.key === '/') || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')) {
        event.preventDefault(); searchInput.current?.focus({ preventScroll: true }); searchInput.current?.select();
      }
      if (event.key === 'Escape') { event.preventDefault(); setSearch(''); }
    }
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, [active]);
  const recordedHero = recorded?.type === 'draft_action' ? heroes.find(h => h.id === recorded.heroId) : undefined;
  return <section className="panel control-hero-picker">
    <div className={`picker-heading side-${phase?.team || 'none'}`}>
      <div className="current-phase" aria-live="polite">
        <h2>{phaseName(state, state.language)}</h2>
        {phase && <span>{phase.action === 'ban' ? t('banCount', {number:state[`${phase.team}Bans`].length + 1,total:state.banCount}) : t('pickingFor', {player:playerAtSlot(state, phase.team, state[`${phase.team}Picks`].length).id || t('playerNumber',{number:state[`${phase.team}Picks`].length + 1}),slot:state[`${phase.team}Picks`].length + 1})}</span>}
        {phase && <small>{t('phaseStep',{step:state.currentPhase+1,total:phases(state.draftMode,state.firstPickSide,state.banCount).length})}</small>}
      </div>
      <input ref={searchInput} aria-label={t('searchHeroes')} placeholder={t('searchHeroes')} value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => {
        if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.repeat) return;
        e.preventDefault();
        if (active && phase && enterHero) send({type:'draft_action',...phase,heroId:enterHero.id});
      }} />
      <p className="quick-input-hint">{t('quickInputHint')}</p>
      <div className="record-feedback" role="status">
        {recorded?.type === 'draft_action' && recordedHero && t('recordAccepted',{side:t(recorded.team === 'blue' ? 'blueSide' : 'redSide'),action:t(recorded.action === 'ban' ? 'banAction' : 'pickAction'),hero:state.language === 'zh' ? recordedHero.chineseName : recordedHero.englishName})}
        {recorded?.type === 'skip_ban' && t('emptyBanRecorded',{side:t(recorded.team === 'blue' ? 'blueSide' : 'redSide')})}
      </div>
      {phase?.action === 'ban' && <div className="empty-ban-control">
        <button
          type="button"
          className="empty-ban-button"
          disabled={disabled || !!state.committedGameId}
          onClick={() => send({type:'skip_ban',team:phase.team})}
        >{t('emptyBanButton')}</button>
        <small>{t('emptyBanManualHint')}</small>
      </div>}
      <div className="picker-tools">
        <div className="filters">{lanes.map(r => <button key={r} className={filter === r ? 'selected' : ''} onClick={() => setFilter(r)}>{laneName(r,state.language)}</button>)}</div>
        <label className="hero-sort-control">{t('heroSort')}
          <select aria-label={t('heroSort')} value={sortMode} onChange={event => {
            const next = event.target.value as HeroSortMode;
            setSortMode(next);
            try { localStorage.setItem('hok-hero-sort-mode', next); } catch { /* Keep the current selection for this page. */ }
          }}>
            <option value="name-zh">{t('heroSortChinese')}</option>
            <option value="name-en">{t('heroSortEnglish')}</option>
            <option value="release">{t('heroSortRelease')}</option>
            <option value="pick-rate">{t('heroSortPickRate')}</option>
            <option value="lane">{t('heroSortLane')}</option>
          </select>
        </label>
      </div>
      {metadataSort && sortCoverage < filtered.length && <p className="sort-data-note">{t('heroSortDataCoverage',{known:sortCoverage,total:filtered.length})}</p>}
    </div>
    <div className="hero-grid-scroll"><div className="hero-grid">{visible.map(h => {
      const reason = phase && draftRestriction(state,phase.team,phase.action,h.id);
      const label = state.language === 'zh' ? h.chineseName : h.englishName;
      return <button key={h.id} title={label} className={enterHero?.id === h.id ? 'enter-target' : ''} disabled={unavailable(h.id)} onClick={() => phase && send({type:'draft_action',...phase,heroId:h.id})}>
        <img src={h.imageLink} alt=""/><span>{label}</span>{reason && <small className="eligibility-reason">{t(reason)}</small>}
      </button>;
    })}</div>{!visible.length && <p className="muted">{t('noMatchingHeroes')}</p>}</div>
    <small className="picker-note">{t('availabilityHint')}</small>
  </section>;
}
