import type { MatchState, PlayerRole } from './types.js';
import { postGamePlayerIdentity } from './postGamePresentation.js';
import { postGameMetrics, reliableField, currentPostGameReport } from './postGame.js';
import { reportGoldDifference } from './postGameTimeline.js';
export const carouselPages = ['clash', 'mid', 'farm', 'jungle', 'roam', 'economy'] as const;
export type CarouselPage = (typeof carouselPages)[number];
export interface CarouselConfig {
  order: CarouselPage[];
  seconds: Record<CarouselPage, number>;
  scenes: Partial<Record<CarouselPage, string>>;
  endScene: string;
  skipMissing: boolean;
}
export interface CarouselSnapshot {
  config: CarouselConfig;
  page: CarouselPage | null;
  status: 'stopped' | 'running' | 'paused';
  deadline: number | null;
  reportId: string | null;
  error: string;
  missing: CarouselPage[];
}
export const defaultCarouselConfig = (): CarouselConfig => ({
  order: [...carouselPages],
  seconds: Object.fromEntries(carouselPages.map((p) => [p, 8])) as Record<CarouselPage, number>,
  scenes: {},
  endScene: '',
  skipMissing: true,
});
export function carouselReady(state: MatchState, page: CarouselPage) {
  const report = currentPostGameReport(state);
  if (!report) return false;
  if (page === 'economy') return reportGoldDifference(report).length >= 2;
  const players = report.players.map((p) => postGamePlayerIdentity(state, p));
  const sides = (['blue', 'red'] as const).map((side) =>
    players.filter((p) => p.side === side && p.role === (page as PlayerRole)),
  );
  return (
    sides.every((p) => p.length === 1) &&
    postGameMetrics.filter((key) => sides.every((p) => reliableField(p[0].fields[key]))).length >= 3
  );
}
