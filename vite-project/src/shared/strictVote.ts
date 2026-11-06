export interface NativePoll {
  question: { text: string };
  answers: Array<{ poll_media: { text: string } }>;
  duration: 1;
  allow_multiselect: false;
}
export interface StrictCandidate {
  rowId: string;
  name: string;
  team: string;
  side: 'blue' | 'red';
  role: string;
}
export interface VoteNotice {
  poll?: NativePoll;
  sentAt?: number;
  id: string;
  content: string;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'uncertain';
  messageId?: string;
  error?: string;
}
export interface StrictVote {
  mode?: 'web' | 'native';
  id: string;
  reportId: string;
  gameNumber: number;
  candidates: StrictCandidate[];
  rosterFingerprint: string;
  startedAt: number;
  deadline: number;
  closedAt?: number;
  status: 'pending' | 'active' | 'closed' | 'cancelled';
  url: string;
  counts: number[];
  opening: VoteNotice;
  closing: VoteNotice;
}
export interface StrictVoteConfig {
  mode?: 'web' | 'native' | 'bot';
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
