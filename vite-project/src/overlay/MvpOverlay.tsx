import { useState } from 'react';
import type { MatchState } from '../shared/types';
import { heroForState } from '../shared/heroData';
import { broadcastArtwork } from '../shared/broadcastArtwork';
import { heroArtCrop } from '../data/heroArtFocus';
import { portraitAssetURL } from '../shared/config';
import {
  mvpStatSelection,
  playerRoleLabel,
  postGamePlayerIdentity,
} from '../shared/postGamePresentation';
import {
  formatPostGameValue,
  postGameMetricLabel,
  reliableField,
  type PostGameMetric,
} from '../shared/postGame';
import './mvpOverlay.css';
function MvpPortrait({
  sources,
  photo,
  position,
  scale,
  name,
}: {
  sources: string[];
  photo: string;
  position: string;
  scale: number;
  name: string;
}) {
  const [index, setIndex] = useState(0),
    src = sources[index];
  const focal = src === photo ? '50% 24%' : position;
  return src ? (
    <img
      className={src === photo ? 'mvp-player-photo' : 'mvp-hero-art'}
      src={src}
      alt={name}
      style={{ objectPosition: focal, transform: `scale(${scale})`, transformOrigin: focal }}
      onError={() => setIndex((old) => old + 1)}
    />
  ) : (
    <div className="mvp-screen-initials">{name.slice(0, 2).toUpperCase()}</div>
  );
}
export function MvpOverlay({ state }: { state: MatchState }) {
  const report = state.postGameReports.find((r) => r.id === state.activePostGameReportId),
    zh = state.language === 'zh';
  const saved = report?.players.find((p) => p.rowId === report.selectedMvpRowId),
    player = saved ? postGamePlayerIdentity(state, saved) : undefined;
  if (!player || !report) return null;
  const hero = heroForState(state, player.heroId);
  const value = (key: PostGameMetric) =>
    formatPostGameValue(reliableField(player.fields[key]) ? player.fields[key]!.value : null, key);
  const { primary: statTiles, highlights } = mvpStatSelection(player, report);
  const runtime = state.heroArtOverrides?.[String(player.heroId)],
    crop = heroArtCrop(player.heroId, 'panel', runtime);
  const heroArt =
    state.artSourceMode === 'legacy' || runtime?.useLegacyImage
      ? hero?.imageLink
      : hero
        ? broadcastArtwork(hero)
        : undefined;
  const photo = portraitAssetURL(player.portrait);
  const sources = [
    ...new Set([photo, heroArt, hero?.imageLink].filter((src): src is string => !!src)),
  ];
  const artPosition = runtime?.panel
    ? `${crop.x}% ${crop.y}%`
    : hero?.artPosition || `${crop.x}% ${crop.y}%`;
  const scale = report.mvpArtScale ?? 1;
  return (
    <article className={`mvp-screen ${player.side}`}>
      <div className="mvp-screen-accent" />
      <header className="mvp-screen-header">
        <span>CHASING WIND · ESPORT BROADCAST</span>
        <span>
          {report.stage} · GAME {report.gameNumber} · {report.seriesFormat}
        </span>
      </header>
      <section className="mvp-screen-portrait">
        <MvpPortrait
          key={`${player.rowId}:${sources.join('|')}`}
          sources={sources}
          photo={photo}
          position={artPosition}
          scale={scale}
          name={player.playerId || `P${player.slot + 1}`}
        />
        <div className="mvp-screen-portrait-label">MOST VALUABLE PLAYER</div>
      </section>
      <section className="mvp-screen-info">
        <div className="mvp-screen-kicker">
          {zh ? '全场最佳选手' : 'MATCH MVP'} <span>★</span>
        </div>
        <h1>MVP</h1>
        <div className="mvp-screen-team">
          {player.teamName} <span>· {playerRoleLabel(player.role, zh)}</span>
        </div>
        <h2>{player.playerId || `P${player.slot + 1}`}</h2>
        {player.grade && (player.grade.manual || player.grade.confidence >= 0.85) && (
          <div className="mvp-screen-hero">
            {zh ? '游戏评级' : 'Game grade'} · {player.grade.value}
          </div>
        )}
        {reliableField(player.fields.rating) && (
          <div className="mvp-screen-hero">
            {zh ? '游戏评分' : 'Game rating'} · {value('rating')}
          </div>
        )}
        <div className="mvp-screen-hero">
          {hero?.imageLink && <img src={hero.imageLink} alt="" />}
          <span>{zh ? hero?.chineseName : hero?.englishName || '—'}</span>
        </div>
        <div className="mvp-screen-kda">
          <strong>
            {value('kills')} <em>/</em> {value('deaths')} <em>/</em> {value('assists')}
          </strong>
          <small>K / D / A</small>
        </div>
        {statTiles.length > 0 && (
          <div
            className="mvp-screen-metrics"
            style={{ gridTemplateColumns: `repeat(${statTiles.length},minmax(0,1fr))` }}
          >
            {statTiles.map((key) => (
              <div key={key}>
                <span>{postGameMetricLabel(key, zh)}</span>
                <strong>{value(key)}</strong>
              </div>
            ))}
          </div>
        )}
        <div className="mvp-screen-highlights">
          {highlights.map((key) => (
            <span key={key}>
              {postGameMetricLabel(key, zh)} · <b>{value(key)}</b>
            </span>
          ))}
        </div>
      </section>
      <footer className="mvp-screen-footer">
        <span>
          {zh
            ? '赛事方选择 · 系统不自动决定 MVP'
            : 'SELECTED BY EVENT ORGANIZERS · NOT AUTOMATICALLY SCORED'}
        </span>
        <span>01 / MVP</span>
      </footer>
    </article>
  );
}
