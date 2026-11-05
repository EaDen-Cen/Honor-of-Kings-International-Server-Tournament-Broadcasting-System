export interface StrictCandidate {
  rowId: string;
  name: string;
  team: string;
  side: 'blue' | 'red';
  role: string;
}
export interface VoteNotice {
  id: string;
  content: string;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'uncertain';
  messageId?: string;
  error?: string;
}
export interface StrictVote {
  id: string;
  reportId: string;
  gameNumber: number;
  candidates: StrictCandidate[];
  rosterFingerprint: string;
  startedAt: number;
  deadline: number;
  closedAt?: number;
  status: 'active' | 'closed' | 'cancelled';
  url: string;
  counts: number[];
  opening: VoteNotice;
  closing: VoteNotice;
}
export interface StrictVoteConfig {
  autoStart: boolean;
  scope: 'all' | 'winner';
  publicOrigin: string;
}
export interface StrictVoteSnapshot {
  serverNow: number;
  config: StrictVoteConfig;
  votes: Array<StrictVote & { rosterChanged: boolean }>;
  error?: string;
}
