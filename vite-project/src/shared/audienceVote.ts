import type { MatchState, Side } from './types.js';
import { currentPostGameReport } from './postGame.js';
export interface VoteCandidate {
  rowId: string;
  name: string;
  team: string;
  side: Side;
  portrait: string;
}
export interface AudienceVote {
  id: string;
  gameKey: string;
  gameNumber: number;
  blueTeam: string;
  redTeam: string;
  reportId: string | null;
  candidates: VoteCandidate[];
  counts: number[] | null;
  total: number | null;
  winners: string[];
  status:
    | 'creating'
    | 'creation-uncertain'
    | 'active'
    | 'ending'
    | 'pending'
    | 'finalized'
    | 'cancelled'
    | 'failed';
  channelId: string;
  messageId: string | null;
  deadline: number;
  createdAt: number;
  error?: string;
  cancelRequested?: boolean;
  announced?: boolean;
  announcementError?: string;
}
export interface DiscordPublicConfig {
  guildId: string;
  channelId: string;
  minutes: number;
  scope: 'all' | 'winner';
  hideLiveVotes: boolean;
  autoStart: boolean;
  configured: boolean;
  webhookConfigured: boolean;
  tokenMask: string;
  storageError?: string;
}
export function voteCandidates(
  state: MatchState,
  scope: 'all' | 'winner' = 'all',
  winner?: Side,
): VoteCandidate[] {
  const report = currentPostGameReport(state);
  const players = report?.players;
  if (players)
    return players
      .filter((p) => scope === 'all' || p.side === winner)
      .map((p) => ({
        rowId: p.rowId,
        name: p.playerId,
        team: p.teamName,
        side: p.side,
        portrait: p.portrait,
      }));
  return (['blue', 'red'] as const).flatMap((side) =>
    scope === 'winner' && side !== winner
      ? []
      : state[`${side}Team`].players.map((name, index) => ({
          rowId: `${state[`${side}Team`].id}:${index}`,
          name,
          team: state[`${side}Team`].name,
          side,
          portrait: state[`${side}Team`].playerPortraits[index] || '',
        })),
  );
}
