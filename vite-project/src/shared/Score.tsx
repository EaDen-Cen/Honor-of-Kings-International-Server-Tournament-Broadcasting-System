import type { MatchState, Side } from './types';
import { seriesWins } from './draftRules';
export function Score({ state, side }: { state: MatchState; side: Side }) {
  const score = state[`${side}Score`];
  return state.scoreDisplay === 'boxes'
    ? <span className={`score-boxes ${side}-score`} role="img" data-series-games={Number(state.seriesFormat.slice(2))} aria-label={`${state[`${side}Team`].name}: ${score} / ${seriesWins(state)}`}>
      {Array.from({ length: seriesWins(state) }, (_, index) => <i key={index} className={`score-box ${index < score ? 'lit' : ''}`} />)}
    </span>
    : <strong className={`${side}-score`}>{score}</strong>;
}
