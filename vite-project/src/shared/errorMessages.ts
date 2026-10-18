import type { Language } from './types';
import { translate, type MessageKey } from './i18n';

const ruleErrors = new Set<MessageKey>(['emptyBanOnlyDuringBan', 'flowbornAlreadyUsed', 'lineupInvalid', 'lineupIncomplete', 'heroArtCropInvalid', 'heroArtOverrideInvalid', 'heroDataOverrideInvalid', 'substitutesInvalid', 'presetLocked', 'presetDuplicate', 'presetMissing', 'presetInvalid', 'presetSaveFailed', 'opponentAlreadyUsed', 'portraitInvalid', 'portraitsInvalid', 'firstPickLocked', 'playerMissing', 'usedByPlayer', 'usedByTeam', 'gameAlreadyCommitted', 'completeDraftFirst', 'commitBeforeNext', 'updateScoreBeforeNext', 'seriesHasEnded', 'swapOnlyBetweenGames', 'committedDraftReset', 'rulesLocked', 'duplicatePlayerIds', 'rosterLocked']);

const englishMessages = new Map<string, string>([
  ['暂时无法连接服务器', 'Unable to connect to the server. Please try again shortly.'],
  ['连接已断开，正在重新加载比赛状态。请确认当前选禁结果后再重试。', 'Connection lost. Reloading the match state. Check the current draft before trying again.'],
  ['操作确认超时，正在重新加载比赛状态。请确认结果后再重试。', 'The action confirmation timed out. Reloading the match state. Check the result before trying again.'],
  ['比赛存档无效，请恢复有效备份', 'The saved match data is invalid. Restore a valid backup.'],
  ['操作编号无效，请刷新页面后重试', 'The action ID is invalid. Refresh the page and try again.'],
  ['比赛状态已更新，请确认当前选禁结果后重试', 'The match state has changed. Check the current draft and try again.'],
  ['操作无效', 'Invalid action.'],
  ['当前选禁阶段不支持此操作，请确认轮次和队伍', 'This action is not allowed in the current draft phase. Check the turn and team.'],
  ['找不到该英雄', 'Hero not found.'],
  ['该英雄已被选择或禁用', 'This hero has already been picked or banned.'],
  ['没有可以撤销的操作', 'There are no actions to undo.'],
  ['比赛设置无效，请检查赛制、语言和画面布局', 'Invalid match settings. Check the format, language, and overlay layout.'],
  ['比分或局数不符合当前赛制', 'The score or game number is not valid for the selected series format.'],
  ['请填写队伍信息', 'Enter the team details.'],
  ['每支队伍必须填写 5 个选手位置', 'Each team must have 5 player slots.'],
  ['每支队伍必须设置 5 个选手分路', 'Each team must have 5 player roles.'],
  ['选手分路无效', 'Invalid player role.'],
  ['队伍名称不能为空', 'The team name cannot be empty.'],
  ['队标地址须使用加密网页链接，或以单个斜线开头的本地路径', 'Use an HTTPS URL for the team logo, or a local path starting with a single slash.'],
  ['请先重置选禁，再修改选禁赛制', 'Reset the draft before changing the draft format.'],
  ['不支持此操作', 'This action is not supported.'],
  ['比赛状态保存失败，本次操作未生效，请联系导播检查服务器存储后重试', 'The match state could not be saved, so this action was not applied. Ask the director to check server storage before trying again.'],
  ['不支持此请求方式', 'This request method is not supported.'],
  ['访问口令缺失或无效，请重新输入', 'The access token is missing or invalid. Enter it again.'],
  ['找不到请求的内容', 'The requested content was not found.'],
  ['找不到页面或文件，请联系导播检查网页是否已构建', 'The page or file was not found. Ask the director to check that the website has been built.'],
  ['此页面地址无权连接', 'This page is not authorized to connect.'],
  ['身份验证超时，请重试', 'Authentication timed out. Please try again.'],
  ['操作过于频繁，请稍后重试', 'Too many actions. Please wait a moment and try again.'],
  ['消息格式无效，请重新连接后重试', 'Invalid message format. Reconnect and try again.'],
  ['访问口令无效', 'Invalid access token.'],
  ['当前页面仅供查看，无法修改比赛', 'This page is read-only and cannot change the match.'],
  ['不支持此消息类型', 'This message type is not supported.'],
  ['消息无效', 'Invalid message.'],
  ['服务器正在停止', 'The server is shutting down.'],
]);

const accessMessages = new Map<string, string>([
  ['Access service unavailable. Please try again.', '访问服务暂时不可用，请稍后重试。'],
  ['Invalid access service response. Please try again.', '访问服务返回异常，请重试。'],
  ['Access check timed out. Enter your password or token to connect.', '访问检查超时，请输入密码或访问口令连接。'],
  ['Invalid login response. Please try again.', '登录返回异常，请重试。'],
  ['Login failed. Check your password or token.', '登录失败，请检查密码或访问口令。'],
  ['Login failed. Please try again.', '登录失败，请重试。'],
  ['Login timed out. Please try again.', '登录超时，请重试。'],
]);

/** Translate at render time so an existing error follows the selected language. */
export function errorMessage(error: string, lang: Language): string {
  if (ruleErrors.has(error as MessageKey)) return translate(lang, error as MessageKey);
  if (lang === 'zh') return accessMessages.get(error) || error;
  if (!error) return error;

  const translated = englishMessages.get(error);
  if (translated) return translated;

  const integer = /^请输入\s*(-?\d+)\s*至\s*(-?\d+)\s*之间的整数$/.exec(error);
  if (integer) return `Enter a whole number between ${integer[1]} and ${integer[2]}.`;

  const text = /^文字格式不正确，最多可输入\s*(\d+)\s*个字符$/.exec(error);
  if (text) return `Enter valid text with no more than ${text[1]} characters.`;

  return /[\u3400-\u9fff]/.test(error)
    ? 'Something went wrong. Check the current match state before trying again.'
    : error;
}
