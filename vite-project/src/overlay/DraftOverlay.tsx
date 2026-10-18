import { playerAtSlot } from '../shared/playerSlots';
import { useLayoutEffect, useRef } from 'react';
import heroes from '../components/HeroList';
import { heroForState } from '../shared/heroData';
import { Score } from '../shared/Score';
import { HeroReveal } from './HeroReveal';
import { PlayerPortrait } from '../shared/PlayerPortrait';
import { portraitAssetURL } from '../shared/config';
import { currentGame, displaySides } from '../shared/draftRules';
import { DraftHistory } from '../shared/DraftHistory';
import { draftRuleName, phaseName, stageName } from '../shared/display';
import { translator } from '../shared/i18n';
import { phases, type MatchState, type PlayerRole, type Side } from '../shared/types';
import { heroArtCrop } from '../data/heroArtFocus';

const rolePaths: Record<PlayerRole, string> = {
  clash: 'M7 4 20 17l-3 3L4 7V4h3Zm13 0h-3L4 17l3 3L20 7V4ZM3 21l4-4m10 0 4 4',
  jungle: 'M12 22C4 16 3 10 4 4l6 6L12 2l2 8 6-6c1 6 0 12-8 18ZM12 11v9',
  mid: 'm3 17 14-14 4 4L7 21l-4-4Zm0-9V3h5m8 18h5v-5',
  farm: 'M5 3c15 1 15 17 0 18l8-9L5 3Zm0 0v18M3 12h18m-3-3 3 3-3 3',
  roam: 'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4Zm0 4v11m-4-7h8',
};
export function PositionIcon({ role, label }: { role: PlayerRole; label: string }) {
  return <svg className="position-icon" viewBox="0 0 24 24" role="img" aria-label={label}><title>{label}</title><path d={rolePaths[role]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function AutoFitPlayerId({ value, layout }: { value: string; layout: MatchState['overlayLayout'] }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    const container = element?.parentElement;
    if (!element || !container) return;

    const max = layout === 'side' ? 30 : 28;
    const min = 6;
    const fit = () => {
      const available = Math.max(1, container.clientWidth - 12);
      let low = min;
      let high = max;
      let best = min;
      for (let i = 0; i < 12; i++) {
        const size = (low + high) / 2;
        element.style.fontSize = `${size}px`;
        if (element.scrollWidth <= available) {
          best = size;
          low = size;
        } else {
          high = size;
        }
      }
      element.style.fontSize = `${best.toFixed(2)}px`;
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [value, layout]);

  return <span ref={ref} className="player-id player-id-only" title={value}>{value}</span>;
}

function HeroArtwork({ hero, alt, state }: { hero: (typeof heroes)[number]; alt: string; state: MatchState }) {
  const runtime = state.heroArtOverrides?.[String(hero.id)];
  const useLegacy = state.artSourceMode === 'legacy' || runtime?.useLegacyImage === true || !hero.artLink;
  const primary = useLegacy ? hero.imageLink : hero.artLink!;
  const crop = heroArtCrop(hero.id, state.overlayLayout, runtime);
  const hasRuntimeCrop = Boolean(runtime?.[state.overlayLayout]);
  const position = hasRuntimeCrop ? `${crop.x}% ${crop.y}%` : (hero.artPosition || `${crop.x}% ${crop.y}%`);
  return <img
    className={`hero-art ${useLegacy ? 'hero-art-icon' : 'hero-art-full'}`}
    data-art-source={useLegacy ? 'legacy' : 'full'}
    src={primary}
    alt={alt}
    style={{
      objectPosition: position,
      transform: useLegacy ? undefined : `scale(${crop.scale})`,
      transformOrigin: position,
    }}
    onError={event => {
      if (event.currentTarget.src.endsWith(hero.imageLink)) return;
      event.currentTarget.src = hero.imageLink;
      event.currentTarget.dataset.artSource = 'legacy';
      event.currentTarget.classList.remove('hero-art-full');
      event.currentTarget.classList.add('hero-art-icon');
      event.currentTarget.style.objectPosition = '50% 50%';
      event.currentTarget.style.transform = 'none';
      event.currentTarget.style.transformOrigin = '50% 50%';
    }}
  />;
}
function PickCard({ state, side, index, position }: { state: MatchState; side: Side; index: number; position: 'left' | 'right' }) {
  const t = translator(state.language), team = state[`${side}Team`];
  const id = state[`${side}Assignments`][index] ?? undefined, hero = id ? heroForState(state, id) : undefined;
  const heroName = hero ? (state.language === 'zh' ? hero.chineseName : hero.englishName) : t('emptyPick');
  const identity = playerAtSlot(state, side, index);
  const player = identity.id || t('playerNumber', { number: index + 1 });
  const role = identity.role;
  return <article className={`broadcast-card ${hero ? 'filled' : ''}`} data-slot={index} data-team-id={team.id}>
    <HeroReveal heroId={id} layout={state.overlayLayout} position={position} renderArt={shownId => {
      const shown = typeof shownId === 'number' ? heroForState(state, shownId) : undefined;
      return shown ? <HeroArtwork hero={shown} alt={state.language === 'zh' ? shown.chineseName : shown.englishName} state={state} /> :
        <PlayerPortrait key={identity.portrait + team.logo} portrait={identity.portrait} logo={team.logo} label={player} slot={index} />;
    }}
    captionClassName={state.showHeroName ? '' : 'player-only'}
    caption={<>
      {state.showHeroName && <strong title={heroName}>{heroName}</strong>}
      {state.showHeroName
        ? <span className="player-id" title={player}>{player}</span>
        : <AutoFitPlayerId value={player} layout={state.overlayLayout} />}
    </>} />
    <div className="position-bar"><PositionIcon role={role} label={t(role)} /></div>
  </article>;
}
export function DraftOverlay({ state }: { state: MatchState }) {
  const t = translator(state.language), phase = phases(state.draftMode, state.firstPickSide,state.banCount)[state.currentPhase];
  const sides = displaySides(state), [left, right] = sides;
  return <section className={`broadcast-overlay broadcast-${state.overlayLayout} ${state.showHeroName ? 'hero-names-visible' : 'hero-names-hidden'}`}>
    <div className="broadcast-top"><header className="broadcast-header">
      <div className="broadcast-brand">{t('gameTitle')}</div>
      <div className="broadcast-meta">{stageName(state.stage, state.language)} · {state.seriesFormat} · {t('gameNumber', { number: currentGame(state) })} · {draftRuleName(state)}</div>
      {sides.map((side, position) => <div key={state[`${side}Team`].id} className={`broadcast-team ${side} display-${position === 0 ? 'left' : 'right'}`}>
        {state[`${side}Team`].logo && <img src={portraitAssetURL(state[`${side}Team`].logo)} alt="" />}
        <h2>{state[`${side}Team`].name}</h2><small className="color-label">{t(side === 'blue' ? 'blueSide' : 'redSide')}</small>
      </div>)}
      <div className="broadcast-score" aria-label={t('seriesScore')}><Score state={state} side={left} /><span>:</span><Score state={state} side={right} /></div>
    </header></div>
    <div className="broadcast-center" aria-hidden="true" />
    <div className="broadcast-bottom">
      {state.draftHistory.length > 0 && <DraftHistory state={state} compact />}
      <div className="broadcast-bans">{sides.map((side, position) => <div className={`ban-team ${side} display-${position === 0 ? 'left' : 'right'}`} key={state[`${side}Team`].id}><span>{t(side === 'blue' ? 'blueSide' : 'redSide')} · {t('ban')}</span><div className="bans">
        {Array.from({ length: state.banCount }, (_, index) => {
          const value = state[`${side}Bans`][index];
          const skipped = value === null;
          const hero = typeof value === 'number' ? heroForState(state, value) : undefined;
          const label = skipped ? t('emptyBan') : hero ? (state.language === 'zh' ? hero.chineseName : hero.englishName) : t('ban');
          return <div className={`hero-slot ban ${skipped ? 'skipped-ban' : ''}`} key={index} title={label}>
            {hero ? <><img src={hero.imageLink} alt={label} /><b className="ban-mark">╱</b>{state.showHeroName && <span className="ban-name">{label}</span>}</>
              : <span className={skipped ? 'empty skipped-ban-label' : 'empty'}>{skipped ? t('emptyBan') : '—'}</span>}
          </div>;
        })}</div></div>)}</div>
      <div className="broadcast-picks">{sides.map((side, position) => <div key={state[`${side}Team`].id} className={`pick-team ${side} display-${position === 0 ? 'left' : 'right'} ${phase?.team === side ? 'acting' : ''}`}>
        {Array.from({ length: 5 }, (_, index) => <PickCard key={index} state={state} side={side} index={index} position={position === 0 ? 'left' : 'right'} />)}
      </div>)}</div>
      <footer className={`phase ${phase?.team || ''}`}>{state.committedGameId ? t('gameCommitted') : phaseName(state)}</footer>
    </div>
  </section>;
}
