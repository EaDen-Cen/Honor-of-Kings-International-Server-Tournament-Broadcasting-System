import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Action, MatchState, Side } from '../shared/types';
import { gameRoles, rolesForGame } from '../shared/gameLineup';
import { normalizePlayerSlotOrder } from '../shared/playerSlots';
import { heroForState, heroesForState } from '../shared/heroData';
import { translator } from '../shared/i18n';
import { lanes, laneName } from '../shared/display';
import { sameDraftHero } from '../shared/draftRules';
import { heroMatchesSearch } from './heroSearch';
import { portraitAssetURL } from '../shared/config';
import './directLineup.css';

type Slot = { side: Side; kind: 'ban' | 'pick'; index: number };
type Selection = { side: Side; roster: number; kind: 'player' | 'hero' };

export function DirectLineup({
  state,
  disabled,
  send,
  acknowledged,
  error,
  mode,
  renderBoard,
}: {
  state: MatchState;
  disabled: boolean;
  send: (action: Action) => boolean;
  acknowledged?: { id: string; action: Action };
  error: string;
  mode: 'draft' | 'lineup';
  renderBoard?: (select: (slot: Slot) => void) => ReactNode;
}) {
  const zh = state.language === 'zh',
    t = translator(state.language);
  const [gameId, setGameId] = useState('');
  const record = state.draftHistory.find((game) => game.id === gameId);
  const game = record ?? state;
  const [slot, setSlot] = useState<Slot>();
  const [candidate, setCandidate] = useState<number>();
  const [search, setSearch] = useState('');
  const [lane, setLane] = useState('all');
  const [selection, setSelection] = useState<Selection>();
  const [pending, setPending] = useState<Action>();
  const [message, setMessage] = useState('');
  const pointer = useRef<{ x: number; y: number; source: Selection }>();
  const suppressClick = useRef(false);
  const [hover, setHover] = useState<string>();
  const guard = useRef(false);
  const touchSubmitted = useRef(false);
  const submitted = useRef<Action>();
  const editContext = JSON.stringify([
    gameId,
    state.draftGameNumber,
    state.gameNumber,
    game.blueTeam,
    game.redTeam,
    game.blueBans,
    game.redBans,
    game.bluePicks,
    game.redPicks,
    game.blueAssignments,
    game.redAssignments,
    game.bluePlayerSlotOrder,
    game.redPlayerSlotOrder,
    game.blueGameRoles,
    game.redGameRoles,
    game.lineupConfirmed,
  ]);
  useEffect(() => {
    if (!disabled) guard.current = false;
  }, [disabled]);
  useEffect(() => {
    if (
      submitted.current &&
      acknowledged &&
      JSON.stringify(submitted.current) === JSON.stringify(acknowledged.action)
    ) {
      setMessage(zh ? '服务器已确认，画面已同步' : 'Server confirmed; displays synchronized');
      submitted.current = undefined;
      guard.current = false;
    }
  }, [acknowledged, zh]);
  useEffect(() => {
    setSlot(undefined);
    setCandidate(undefined);
    setSelection(undefined);
    setPending(undefined);
    guard.current = false;
  }, [editContext]);
  const historical = !!record && record.id !== state.committedGameId;
  const context = record ? { gameId: record.id } : {};
  const propose = (action: Action) => {
    if (!disabled) setPending(action);
  };
  function submit(action: Action) {
    if (disabled || guard.current) return;
    guard.current = true;
    if (send(action)) {
      submitted.current = action;
      setPending(undefined);
      setSlot(undefined);
      setCandidate(undefined);
      setMessage(zh ? '已发送，等待服务器确认' : 'Sent; awaiting server confirmation');
    } else {
      guard.current = false;
      setMessage(zh ? '连接不可用，请重试' : 'Unavailable; retry');
    }
  }
  function confirmation(action: Action) {
    return {
      onPointerDown: () => {
        touchSubmitted.current = false;
      },
      onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
        // Chromium may suppress the next synthesized click after a touch drag.
        if (event.pointerType === 'touch' && event.isPrimary) {
          touchSubmitted.current = true;
          if (
            document.elementFromPoint(event.clientX, event.clientY)?.closest('button') ===
            event.currentTarget
          )
            submit(action);
        }
      },
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
        if (event.detail === 0 || !touchSubmitted.current) submit(action);
      },
    };
  }
  function exchange(source: Selection, target: Selection) {
    if (
      source.side !== target.side ||
      source.roster === target.roster ||
      source.kind !== target.kind ||
      game.lineupConfirmed
    )
      return;
    if (source.kind === 'player') {
      const roles = [...rolesForGame(game, source.side)];
      [roles[source.roster], roles[target.roster]] = [roles[target.roster], roles[source.roster]];
      propose({ type: 'set_game_roles', side: source.side, roles, ...context });
    } else {
      const order = normalizePlayerSlotOrder(game[`${source.side}PlayerSlotOrder`]);
      propose({
        type: 'swap_assignments',
        team: source.side,
        from: order.indexOf(source.roster),
        to: order.indexOf(target.roster),
        ...context,
      });
    }
    setSelection(undefined);
  }
  function targetAt(x: number, y: number): Selection | undefined {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-lineup-target]');
    if (!element) return;
    const [side, kind, roster] = element.dataset.lineupTarget!.split(':');
    if ((side !== 'blue' && side !== 'red') || (kind !== 'player' && kind !== 'hero')) return;
    return { side, kind, roster: Number(roster) };
  }
  function interaction(value: Selection) {
    return {
      'data-lineup-target': `${value.side}:${value.kind}:${value.roster}`,
      'aria-pressed':
        selection?.side === value.side &&
        selection.kind === value.kind &&
        selection.roster === value.roster,
      onClick: () => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        if (selection) exchange(selection, value);
        else setSelection(value);
      },
      onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0) return;
        suppressClick.current = false;
        pointer.current = { x: event.clientX, y: event.clientY, source: value };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
        if (!pointer.current) return;
        const target = targetAt(event.clientX, event.clientY);
        setHover(target ? `${target.side}:${target.kind}:${target.roster}` : undefined);
      },
      onPointerCancel: () => {
        pointer.current = undefined;
        setHover(undefined);
      },
      onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
        const start = pointer.current;
        pointer.current = undefined;
        setHover(undefined);
        if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) < 8) return;
        suppressClick.current = true;
        const target = targetAt(event.clientX, event.clientY);
        if (target) exchange(start.source, target);
      },
    };
  }
  function unavailable(id: number) {
    if (!slot) return true;
    return (['blue', 'red'] as const).some((side) =>
      (['ban', 'pick'] as const).some((kind) =>
        (game[`${side}${kind === 'ban' ? 'Bans' : 'Picks'}`] ?? []).some(
          (picked, index) =>
            !(side === slot.side && kind === slot.kind && index === slot.index) &&
            picked !== null &&
            sameDraftHero(state, picked, id),
        ),
      ),
    );
  }
  const view = { ...state, heroPool: record?.heroPool ?? state.heroPool };
  const heroes = heroesForState(view).filter(
    (hero) =>
      heroMatchesSearch(hero, search, state.language) &&
      (lane === 'all' || hero.occupation === lane || hero.altOccupation === lane),
  );
  const name = (id: number | null | undefined) => {
    const hero = id ? heroForState(state, id) : undefined;
    return hero ? (zh ? hero.chineseName : hero.englishName) : '—';
  };
  if (gameId && !record)
    return (
      <section className="panel">
        <p role="alert">
          {zh ? '历史局已变更，请重新选择' : 'Archived game changed; select a game again'}
        </p>
        <button onClick={() => setGameId('')}>
          {zh ? '返回当前局' : 'Return to current game'}
        </button>
      </section>
    );
  return (
    <section
      className="panel direct-lineup"
      aria-label={mode === 'draft' ? 'Visual BP correction' : 'Game role lineup'}
    >
      <h3>
        {mode === 'draft'
          ? zh
            ? '点击头像纠正 BP'
            : 'Click a portrait to correct BP'
          : zh
            ? '本局实际阵容'
            : 'Actual game lineup'}
      </h3>
      <label>
        {zh ? '对局' : 'Game'}{' '}
        <select
          aria-label={`${mode} game`}
          value={gameId}
          onChange={(event) => setGameId(event.target.value)}
        >
          <option value="">{zh ? '当前局' : 'Current game'}</option>
          {state.draftHistory
            .filter((item) => item.id !== state.committedGameId)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {zh ? '历史局' : 'Archived game'} {item.gameNumber}
              </option>
            ))}
        </select>
      </label>
      {mode === 'draft' ? (
        <>
          {!record && renderBoard
            ? renderBoard((value) => {
                setSlot(value);
                setCandidate(undefined);
              })
            : (['blue', 'red'] as const).map((side) => (
                <div key={side}>
                  <h4>{game[`${side}Team`].name}</h4>
                  {(['ban', 'pick'] as const).map((kind) => (
                    <div className="direct-slots" key={kind}>
                      {(game[`${side}${kind === 'ban' ? 'Bans' : 'Picks'}`] ?? []).map(
                        (id, index) => (
                          <button
                            key={index}
                            disabled={disabled}
                            data-draft-target={`${side}:${kind}:${index}`}
                            aria-label={`Correct ${side} ${kind} ${index + 1}`}
                            onClick={() => {
                              setSlot({ side, kind, index });
                              setCandidate(undefined);
                              setPending(undefined);
                            }}
                          >
                            {id && <img src={heroForState(state, id)?.imageLink} alt="" />}
                            <span>
                              {kind.toUpperCase()} {index + 1} · {name(id)}
                            </span>
                          </button>
                        ),
                      )}
                    </div>
                  ))}
                </div>
              ))}
          {slot && (
            <div className="direct-picker" aria-label="Correction hero picker">
              <p>
                {game[`${slot.side}Team`].name} · {slot.kind.toUpperCase()} {slot.index + 1} ·{' '}
                {name(game[`${slot.side}${slot.kind === 'ban' ? 'Bans' : 'Picks'}`]?.[slot.index])}{' '}
                → {name(candidate)}
              </p>
              <label>
                {zh ? '搜索英雄' : 'Search heroes'}
                <input
                  autoFocus
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <label>
                {zh ? '分路' : 'Lane'}
                <select value={lane} onChange={(event) => setLane(event.target.value)}>
                  {lanes.map((value) => (
                    <option key={value} value={value}>
                      {laneName(value, state.language)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="direct-heroes">
                {heroes.map((hero) => (
                  <button
                    key={hero.id}
                    disabled={disabled || unavailable(hero.id)}
                    aria-pressed={candidate === hero.id}
                    onPointerDown={(event) => {
                      if (event.button === 0)
                        event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerUp={(event) => {
                      const target = document
                        .elementFromPoint(event.clientX, event.clientY)
                        ?.closest<HTMLElement>('[data-draft-target]');
                      if (!target) return;
                      const [side, kind, index] = target.dataset.draftTarget!.split(':');
                      if (
                        (side === 'blue' || side === 'red') &&
                        (kind === 'ban' || kind === 'pick')
                      ) {
                        setSlot({ side, kind, index: Number(index) });
                        setCandidate(hero.id);
                      }
                    }}
                    onClick={() => setCandidate(hero.id)}
                  >
                    <img loading="lazy" src={hero.imageLink} alt="" />
                    {name(hero.id)}
                  </button>
                ))}
              </div>
              <button
                disabled={
                  disabled ||
                  candidate === undefined ||
                  (candidate !== undefined && unavailable(candidate))
                }
                {...confirmation({
                  type: 'replace_draft_hero',
                  team: slot.side,
                  action: slot.kind,
                  index: slot.index,
                  heroId: candidate!,
                  ...context,
                })}
              >
                {zh ? '确认替换并同步' : 'Confirm replacement'}
              </button>
              <button onClick={() => setSlot(undefined)}>{zh ? '取消' : 'Cancel'}</button>
            </div>
          )}
        </>
      ) : (
        <>
          <p role="status">
            {game.lineupConfirmed
              ? zh
                ? '本局阵容已确认'
                : 'Game lineup confirmed'
              : zh
                ? '待人工确认 · 自动分路证据不足'
                : 'Awaiting manual confirmation · insufficient role evidence'}
          </p>
          {game.lineupAutomationBlocked && (
            <p>
              {zh
                ? '本局采用人工阵容，自动识别不会改写。'
                : 'Manual lineup active for this game; automatic recognition cannot overwrite it.'}
            </p>
          )}
          <p>
            {zh
              ? '拖动选手交换分路，拖动英雄交换归属。也可依次点击来源与目标。'
              : 'Drag players to swap roles, or heroes to swap ownership. You can also click source then destination.'}
          </p>
          {(['blue', 'red'] as const).map((side) => (
            <div key={side}>
              <h4>{game[`${side}Team`].name}</h4>
              <div className="direct-cards">
                {gameRoles.map((role) => {
                  const roster = rolesForGame(game, side).indexOf(role),
                    team = game[`${side}Team`];
                  const screenSlot = normalizePlayerSlotOrder(
                    game[`${side}PlayerSlotOrder`],
                  ).indexOf(roster);
                  const hero = game[`${side}Assignments`][screenSlot];
                  return (
                    <article
                      key={role}
                      className={
                        hover?.startsWith(`${side}:`) && hover.endsWith(`:${roster}`)
                          ? 'drop-target'
                          : ''
                      }
                    >
                      <strong>{t(role)}</strong>
                      <button
                        aria-label={`${side} ${role} player`}
                        disabled={
                          disabled || game.lineupConfirmed || (!record && !state.draftComplete)
                        }
                        {...interaction({ side, roster, kind: 'player' })}
                      >
                        {team.playerPortraits[roster] && (
                          <img src={portraitAssetURL(team.playerPortraits[roster])} alt="" />
                        )}
                        {team.players[roster] || '—'}
                      </button>
                      <button
                        aria-label={`${side} ${role} hero`}
                        disabled={
                          disabled || game.lineupConfirmed || (!record && !state.draftComplete)
                        }
                        {...interaction({ side, roster, kind: 'hero' })}
                      >
                        {hero && <img src={heroForState(state, hero)?.imageLink} alt="" />}
                        {name(hero)}
                      </button>
                    </article>
                  );
                })}
              </div>
              <button
                disabled={disabled || game.lineupConfirmed || (!record && !state.draftComplete)}
                onClick={() =>
                  propose({
                    type: 'set_game_roles',
                    side,
                    roles: [...rolesForGame({ ...game, [`${side}GameRoles`]: undefined }, side)],
                    ...context,
                  })
                }
              >
                {zh ? '恢复本局默认分路' : 'Restore game default roles'}
              </button>
            </div>
          ))}
          <button
            disabled={disabled || (!record && !state.draftComplete)}
            onClick={() =>
              propose({ type: 'confirm_game_lineup', confirmed: !game.lineupConfirmed, ...context })
            }
          >
            {game.lineupConfirmed
              ? zh
                ? '解除确认并纠错'
                : 'Unlock lineup'
              : zh
                ? '确认并锁定本局阵容'
                : 'Confirm and lock lineup'}
          </button>
          {selection && (
            <button onClick={() => setSelection(undefined)}>
              {zh ? '取消选择' : 'Cancel selection'}
            </button>
          )}
          {pending && (
            <div role="group" aria-label="Lineup change preview">
              <p>
                {historical
                  ? zh
                    ? '将修正历史局'
                    : 'Correct archived game'
                  : zh
                    ? '将更新当前局'
                    : 'Update current game'}{' '}
                {game.gameNumber}
              </p>
              {pending.type === 'set_game_roles' && (
                <p>
                  {pending.roles
                    .map(
                      (role, index) => `${game[`${pending.side}Team`].players[index]} → ${t(role)}`,
                    )
                    .join(' · ')}
                </p>
              )}
              {pending.type === 'swap_assignments' && (
                <p>
                  {name(game[`${pending.team}Assignments`][pending.from])} ↔{' '}
                  {name(game[`${pending.team}Assignments`][pending.to])}
                </p>
              )}
              <button disabled={disabled} {...confirmation(pending)}>
                {zh ? '确认并同步' : 'Confirm and sync'}
              </button>
              <button onClick={() => setPending(undefined)}>{zh ? '取消' : 'Cancel'}</button>
            </div>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p aria-live="polite">{message}</p>}
    </section>
  );
}
