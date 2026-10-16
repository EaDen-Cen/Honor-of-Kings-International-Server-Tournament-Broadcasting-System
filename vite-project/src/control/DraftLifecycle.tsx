import { currentGame, displaySides, seriesFinished, seriesWins } from '../shared/draftRules';
import { teamName } from '../shared/display';
import { translator } from '../shared/i18n';
import { Score } from '../shared/Score';
import type { Action, MatchState } from '../shared/types';

export function DraftLifecycle({ state, disabled, send }: { state: MatchState; disabled: boolean; send: (action: Action) => void }) {
  const t = translator(state.language);
  const maxWins = seriesWins(state);

  return <section id="game-lifecycle" className="panel lifecycle">
    <p className="side-summary">
      {displaySides(state).map((side, index) =>
        <span key={side} className={side}>
          {t(index === 0 ? 'screenLeft' : 'screenRight')}: {state[`${side}Team`].name} · {t(side === 'blue' ? 'blueSide' : 'redSide')}
        </span>,
      )}
      <span>{t('firstPickSide')}: {t(state.firstPickSide === 'blue' ? 'blueSide' : 'redSide')}</span>
      <span>{t('sideSwapMode')}: {t(state.sideSwapMode)}</span>
    </p>

    <div className="lifecycle-operation-grid">
      <div className="lifecycle-primary-actions">
        <div className="toolbar">
          <button
            className="primary"
            disabled={disabled || !state.draftComplete || !!state.committedGameId}
            onClick={() => confirm(t('confirmCommit')) && send({ type: 'commit_game' })}
          >
            {t(state.committedGameId ? 'gameCommitted' : 'commitGame')}
          </button>

          <button
            disabled={disabled || !state.committedGameId || state.gameNumber !== currentGame(state) + 1 || seriesFinished(state)}
            onClick={() => confirm(t('confirmNext')) && send({ type: 'next_game' })}
          >
            {t('nextGame')}
          </button>

          <button
            disabled={disabled || state.currentPhase > 0 || !!state.committedGameId}
            onClick={() => confirm(t(state.sideSwapMode === 'colorsOnly' ? 'confirmColorsSwap' : 'confirmSwap')) && send({ type: 'swap_sides' })}
          >
            {t('swapSides')}
          </button>
        </div>

        <p className="muted">{t('lifecycleHint')}</p>
      </div>

      <section className="lifecycle-score" aria-label={t('seriesScore')}>
        <div className="lifecycle-score-heading">
          <strong>{t('seriesScore')}</strong>
          <span className="muted">{t('scoreImmediate')}</span>
        </div>

        <div className="lifecycle-score-grid">
          {(['blue', 'red'] as const).map(side => {
            const scoreKey = side === 'blue' ? 'blueScore' : 'redScore';
            const otherScore = side === 'blue' ? state.redScore : state.blueScore;

            return <div className={`score-setting ${side}`} key={side}>
              <p>{teamName(state, side)}</p>
              <div className="score-control">
                <button
                  type="button"
                  aria-label={t('decreaseScore')}
                  disabled={disabled || state[scoreKey] <= 0}
                  onClick={() => send({ type: 'score', team: side, delta: -1 })}
                >
                  −
                </button>

                <Score state={state} side={side} />

                <button
                  type="button"
                  aria-label={t('increaseScore')}
                  disabled={
                    disabled
                    || state[scoreKey] >= maxWins
                    || (otherScore === maxWins && state[scoreKey] + 1 === maxWins)
                  }
                  onClick={() => send({ type: 'score', team: side, delta: 1 })}
                >
                  +
                </button>
              </div>
            </div>;
          })}
        </div>
      </section>
    </div>
  </section>;
}
