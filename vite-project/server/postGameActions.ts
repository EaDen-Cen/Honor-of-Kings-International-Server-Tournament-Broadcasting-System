import { canMergePostGameField } from '../src/shared/postGame.js';
import { validGoldTimeline } from '../src/shared/postGameTimeline.js';
import {
  validatePostGameField,
  validatePostGameGrade,
  validatePostGameCurve,
} from './postGameValidation.js';
import type { Action, MatchState, GameDraftRecord } from '../src/shared/types.js';
import { normalizePlayerSlotOrder } from '../src/shared/playerSlots.js';

/** Create an empty report only once; never wipe earlier game data. */
export function preparePostGameReport(state: MatchState, game: GameDraftRecord) {
  if (!state.postGameReports.some((report) => report.id === game.id))
    state.postGameReports.push({
      id: game.id,
      gameNumber: game.gameNumber,
      seriesFormat: state.seriesFormat,
      stage: state.stage,
      selectedMvpPlayerId: null,
      selectedMvpRowId: null,
      players: (['blue', 'red'] as const).flatMap((side) =>
        game[`${side}Assignments`].map((heroId, slot) => {
          const team = game[`${side}Team`],
            rosterIndex = normalizePlayerSlotOrder(game[`${side}PlayerSlotOrder`])[slot];
          return {
            rowId: `${team.id}:${rosterIndex}`,
            playerId: team.players[rosterIndex],
            side,
            slot,
            rosterIndex,
            teamName: team.name,
            portrait: team.playerPortraits[rosterIndex],
            role: team.playerRoles[rosterIndex],
            heroId,
            fields: {},
          };
        }),
      ),
    });
}

/** Mutates only the staged state; Store owns authorization, undo and atomic persistence. */
export function applyPostGameAction(state: MatchState, action: Action): boolean {
  switch (action.type) {
    case 'post_game_begin': {
      const gameId = action.gameId ?? state.committedGameId ?? state.draftHistory.at(-1)?.id;
      const game = state.draftHistory.find((record) => record.id === gameId);
      if (!game) throw new Error('先确认有效局阵容 / Commit the game first');
      state.activePostGameReportId = game.id;
      preparePostGameReport(state, game);
      break;
    }
    case 'post_game_fields': {
      const report = state.postGameReports.find((r) => r.id === action.reportId);
      if (
        !report ||
        !Array.isArray(action.updates) ||
        (!action.updates.length && !action.grades?.length) ||
        action.updates.length > 100
      )
        throw new Error('赛后报告无效 / Invalid post-game report');
      if (action.grades !== undefined) {
        if (!Array.isArray(action.grades) || action.grades.length > 10)
          throw new Error('Invalid grade report');
        for (const { rowId, field } of action.grades) {
          if (!report.players.some((p) => p.rowId === rowId)) throw new Error('Invalid game grade');
          validatePostGameGrade(field);
        }
      }
      for (const update of action.updates) {
        if (!report.players.some((p) => p.rowId === update.rowId))
          throw new Error('赛后字段无效 / Invalid post-game field');
        validatePostGameField(update.metric, update.field, 'player');
      }

      for (const update of action.updates) {
        const field = update.field,
          player = report.players.find((p) => p.rowId === update.rowId)!;
        if (!canMergePostGameField(player.fields[update.metric], field)) continue;
        player.fields[update.metric] = {
          value: field.value,
          confidence: field.confidence,
          manual: field.manual,
          sourcePage: field.sourcePage,
          ...(field.resolution ? { resolution: field.resolution } : {}),
          ...(field.evidence ? { evidence: field.evidence } : {}),
          ...(field.capturedAt !== undefined ? { capturedAt: field.capturedAt } : {}),
        };
      }
      for (const { rowId, field } of action.grades ?? []) {
        const player = report.players.find((p) => p.rowId === rowId)!,
          old = player.grade;
        if (
          field.manual ||
          !old ||
          (!old.manual &&
            (old.confidence < 0.85 || old.value === field.value) &&
            field.confidence >= old.confidence)
        )
          player.grade = {
            value: field.value,
            sourcePage: 'summary',
            confidence: field.confidence,
            manual: field.manual,
            ...(field.evidence ? { evidence: field.evidence } : {}),
            ...(field.capturedAt !== undefined ? { capturedAt: field.capturedAt } : {}),
          };
      }
      break;
    }
    case 'post_game_mvp_art_scale': {
      const report = state.postGameReports.find((r) => r.id === action.reportId);
      if (
        !report ||
        typeof action.scale !== 'number' ||
        !Number.isFinite(action.scale) ||
        action.scale < 1 ||
        action.scale > 2
      )
        throw new Error('Invalid MVP image scale');
      report.mvpArtScale = action.scale;
      break;
    }
    case 'post_game_grades': {
      const report = state.postGameReports.find((r) => r.id === action.reportId);
      if (
        !report ||
        !Array.isArray(action.updates) ||
        !action.updates.length ||
        action.updates.length > 10
      )
        throw new Error('Invalid grade report');
      for (const { rowId, field } of action.updates) {
        if (!report.players.some((p) => p.rowId === rowId)) throw new Error('Invalid game grade');
        validatePostGameGrade(field);
      }

      for (const { rowId, field } of action.updates) {
        const player = report.players.find((p) => p.rowId === rowId)!,
          old = player.grade;
        if (
          field.manual ||
          !old ||
          (!old.manual &&
            (old.confidence < 0.85 || old.value === field.value) &&
            field.confidence >= old.confidence)
        )
          player.grade = {
            value: field.value,
            sourcePage: 'summary',
            confidence: field.confidence,
            manual: field.manual,
            ...(field.evidence ? { evidence: field.evidence } : {}),
            ...(field.capturedAt !== undefined ? { capturedAt: field.capturedAt } : {}),
          };
      }
      break;
    }
    case 'post_game_team_fields': {
      const report = state.postGameReports.find((r) => r.id === action.reportId);
      if (
        !report ||
        !Array.isArray(action.updates) ||
        (!action.updates.length && !action.goldDifference) ||
        action.updates.length > 20
      )
        throw new Error('Invalid team report');
      if (action.goldDifference !== undefined) validatePostGameCurve(action.goldDifference);
      for (const { side, metric, field } of action.updates) {
        if (!['blue', 'red'].includes(side)) throw new Error('Invalid team field');
        validatePostGameField(metric, field, 'team');
      }

      report.teamFields ??= {};
      for (const { side, metric, field } of action.updates) {
        const fields = (report.teamFields[side] ??= {});
        if (canMergePostGameField(fields[metric], field))
          fields[metric] = {
            value: field.value,
            sourcePage: 'recap',
            manual: field.manual,
            confidence: field.confidence,
            ...(field.evidence ? { evidence: field.evidence } : {}),
            ...(field.capturedAt !== undefined ? { capturedAt: field.capturedAt } : {}),
          };
      }
      const curve = action.goldDifference;
      if (
        curve &&
        (curve.source === 'manual' ||
          !report.goldDifference ||
          (report.goldDifference.source !== 'manual' &&
            !(curve.partial && !report.goldDifference.partial) &&
            (curve.confidence >= report.goldDifference.confidence ||
              (report.goldDifference.partial && !curve.partial))))
      )
        report.goldDifference = {
          points: curve.points.map((p) => ({
            timeSeconds: p.timeSeconds,
            difference: p.difference,
          })),
          source: curve.source,
          confidence: curve.confidence,
          maxDifference: curve.maxDifference,
          ...(curve.partial ? { partial: true } : {}),
          ...(curve.durationSeconds !== undefined
            ? { durationSeconds: curve.durationSeconds }
            : {}),
          ...(curve.evidence ? { evidence: curve.evidence } : {}),
          ...(curve.capturedAt !== undefined ? { capturedAt: curve.capturedAt } : {}),
        };
      break;
    }
    case 'post_game_gold_timeline': {
      const report = state.postGameReports.find((r) => r.id === action.reportId);
      if (!report || !validGoldTimeline(action.points))
        throw new Error('Invalid gold time-series; use verified, increasing replay samples');

      report.goldTimeline = action.points.map((point) => ({
        timeSeconds: point.timeSeconds,
        blueGold: point.blueGold,
        redGold: point.redGold,
      }));
      const differencePoints = action.points.map((point) => ({
        timeSeconds: point.timeSeconds,
        difference: point.blueGold - point.redGold,
      }));
      report.goldDifference = {
        points: differencePoints,
        source: 'manual',
        confidence: 1,
        maxDifference: Math.max(1, ...differencePoints.map((point) => Math.abs(point.difference))),
      };
      break;
    }
    case 'select_mvp': {
      const report = state.postGameReports.find((r) => r.id === action.reportId),
        player = report?.players.find((p) => p.rowId === action.rowId);
      if (!report || (action.rowId !== null && !player))
        throw new Error('MVP 选手无效 / Invalid MVP player');
      state.activePostGameReportId = report.id;
      report.selectedMvpRowId = player?.rowId ?? null;
      report.selectedMvpPlayerId = player?.playerId ?? null;
      break;
    }
    default:
      return false;
  }
  return true;
}
