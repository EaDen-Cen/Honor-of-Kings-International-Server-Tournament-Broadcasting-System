import { heroForState } from './heroData';
import { displaySides, historyForTeam } from './draftRules';
import { translator } from './i18n';
import type { MatchState } from './types';

export function DraftHistory({ state, compact = false }: { state: MatchState; compact?: boolean }) {
  const t = translator(state.language);
  if (!state.draftHistory.length) return null;
  return <section className={`draft-history ${compact ? 'compact' : 'panel'}`}>
    <header><h2>{t('historyTitle')}</h2>{!compact && <p className="muted">{t(({ normal: 'historyNormal', player: 'historyPlayer', global: 'historyGlobal' } as const)[state.draftRuleMode])}</p>}</header>
    {state.draftHistory.length ? state.draftHistory.map(record => {
      const report = state.postGameReports.find(report => report.id === record.id);
      const winner = report?.winner ? record[`${report.winner}Team`].name : undefined;
      return <div key={record.id} className="history-game" data-game={record.gameNumber}>
      {displaySides(state).map((side, position) => {
        const entry = historyForTeam(record, state[`${side}Team`].id);
        return <div key={side} className={`history-team ${side} display-${position === 0 ? 'left' : 'right'}`}>
          {!compact && <strong>{entry?.team.name}</strong>}
          <div className="history-heroes">{record.rules?.recordHeroes !== false && entry?.assignments.map((id, index) => {
            const hero = id === null ? undefined : heroForState(state, id);
            const name = state.language === 'zh' ? hero?.chineseName : hero?.englishName;
            if (!hero) return <span key={index}>{state.language === 'zh' ? '英雄未记录' : 'Hero not recorded'}</span>;
            return <img key={index} src={hero?.imageLink} alt={name} title={`${name} · ${entry.team.players[entry.playerSlotOrder[index]] || t('playerNumber', { number: index + 1 })}`} />;
          })}</div>
        </div>;
      })}
      <span className="history-game-number">{t('gameNumber', { number: record.gameNumber })}{record.rules && <small> · {record.rules.mode === 'blind' ? t('blindPick') : record.rules.mode === 'match' ? 'Match' : 'Normal'} · {record.rules.heroPool.toUpperCase()} · {record.rules.banCount} Ban · {record.rules.contributeToFutureHistory ? (state.language === 'zh' ? '计入历史' : 'History on') : (state.language === 'zh' ? '不计历史' : 'History off')}</small>}</span>
      {!compact && <small>{winner ? `${state.language === 'zh' ? '胜者' : 'Winner'}: ${winner}` : (state.language === 'zh' ? '结果待确认' : 'Result pending')}</small>}
    </div>;}) : <p className="history-empty">{t('noHistory')}</p>}
  </section>;
}
