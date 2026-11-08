import { useEffect, useRef, useState } from 'react';
import type { Action, MatchState, Side } from '../shared/types';
import { heroesForPool } from '../shared/heroPool';
import { gameRulesFor } from '../shared/gameRules';
import { currentGame, seriesFinished } from '../shared/draftRules';

export function BlindGamePanel({
  state,
  disabled,
  send,
  acknowledged,
  error,
  gameId,
}: {
  state: MatchState;
  disabled: boolean;
  send: (action: Action) => boolean;
  acknowledged?: { id: string; action: Action };
  error: string;
  gameId?: string;
}) {
  const zh = state.language === 'zh';
  const record = state.draftHistory.find((game) => game.id === gameId);
  const game = record ?? state;
  const rules = record?.rules ?? state.currentGameRules ?? gameRulesFor(state, currentGame(state));
  const [blue, setBlue] = useState<Array<number | null>>(() =>
    Array.from({ length: 5 }, (_, i) => game.blueAssignments[i] ?? null),
  );
  const [red, setRed] = useState<Array<number | null>>(() =>
    Array.from({ length: 5 }, (_, i) => game.redAssignments[i] ?? null),
  );
  const [message, setMessage] = useState('');
  const submitted = useRef<Action>();
  const signature = JSON.stringify([
    record?.id ?? state.draftGameNumber,
    state.gameNumber,
    game.blueAssignments,
    game.redAssignments,
  ]);
  useEffect(() => {
    const [, , savedBlue, savedRed] = JSON.parse(signature) as [
      unknown,
      unknown,
      Array<number | null>,
      Array<number | null>,
    ];
    setBlue(Array.from({ length: 5 }, (_, i) => savedBlue[i] ?? null));
    setRed(Array.from({ length: 5 }, (_, i) => savedRed[i] ?? null));
  }, [signature]);
  useEffect(() => {
    if (
      submitted.current &&
      acknowledged &&
      JSON.stringify(submitted.current) === JSON.stringify(acknowledged.action)
    ) {
      setMessage(zh ? '服务器已确认' : 'Server confirmed');
      submitted.current = undefined;
    }
  }, [acknowledged, zh]);
  useEffect(() => {
    if (error && submitted.current) {
      setMessage(error);
      submitted.current = undefined;
    }
  }, [error]);
  function submit(action: Action) {
    if (send(action)) {
      submitted.current = action;
      setMessage(zh ? '等待服务器确认…' : 'Waiting for server confirmation…');
    } else setMessage(zh ? '未连接，操作尚未提交' : 'Not connected; action was not submitted');
  }
  return (
    <section className="panel blind-game-panel" aria-label="Blind Pick">
      <h2>{zh ? '盲选模式' : 'Blind Pick'}</h2>
      <p>
        {zh
          ? '本局跳过传统 BP，无需识别或填写英雄即可开局。比赛胜负、GHUD 与赛后报告照常记录。'
          : 'This game skips traditional BP. Start without hero recognition or hero entry; results, GHUD and post-game reports remain available.'}
      </p>
      {!record && (
        <button
          className="primary"
          disabled={disabled || !!state.committedGameId || seriesFinished(state)}
          onClick={() => submit({ type: 'start_blind_game' })}
        >
          {state.committedGameId
            ? zh
              ? '本局已开始'
              : 'Game started'
            : zh
              ? '开始盲选局'
              : 'Start blind game'}
        </button>
      )}
      {!rules.recordHeroes ? (
        <p>
          {zh
            ? '本局不记录英雄，也不贡献跨局英雄限制。'
            : 'Heroes are not recorded or added to later history restrictions.'}
        </p>
      ) : (
        <details>
          <summary>
            {zh
              ? '补充实际英雄（可选，不阻止开局）'
              : 'Add actual heroes (optional; never blocks start)'}
          </summary>
          <div className="blind-lineup-sides">
            {(['blue', 'red'] as Side[]).map((side) => (
              <div key={side}>
                <h3>{game[`${side}Team`].name}</h3>
                {Array.from({ length: 5 }, (_, index) => (
                  <label key={index}>
                    P{index + 1} ·{' '}
                    {game[`${side}Team`].players[
                      game[`${side}PlayerSlotOrder`]?.[index] ?? index
                    ] || '—'}
                    <select
                      aria-label={`Blind ${side} hero ${index + 1}`}
                      value={(side === 'blue' ? blue : red)[index] ?? ''}
                      disabled={disabled}
                      onChange={(event) => {
                        const id = event.target.value ? Number(event.target.value) : null;
                        (side === 'blue' ? setBlue : setRed)((values) =>
                          values.map((old, i) => (i === index ? id : old)),
                        );
                      }}
                    >
                      <option value="">{zh ? '未知 / 未记录' : 'Unknown / not recorded'}</option>
                      {heroesForPool(rules.heroPool).map((hero) => (
                        <option value={hero.id} key={hero.id}>
                          {zh ? hero.chineseName : hero.englishName}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            ))}
          </div>
          <button
            disabled={disabled || (!record && !state.committedGameId)}
            onClick={() =>
              submit({ type: 'blind_lineup', blue, red, ...(record ? { gameId: record.id } : {}) })
            }
          >
            {zh ? '保存实际阵容' : 'Save actual lineup'}
          </button>
        </details>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
