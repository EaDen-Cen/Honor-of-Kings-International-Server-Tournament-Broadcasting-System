import { useEffect, useRef, useState } from 'react';
import type { Action, GameRules, MatchState, SeriesFormat, SeriesRules } from '../shared/types';
import { currentGame } from '../shared/draftRules';
import { gameRulesFor, gameRulesLocked, validateSeriesRules } from '../shared/gameRules';
import './gameRulesManager.css';

const templateKey = 'hok-game-rules-templates-v1';
const formats: SeriesFormat[] = ['BO1', 'BO3', 'BO5', 'BO7'];
const clone = <T,>(value: T): T => structuredClone(value);
type Template = { version: 1; format: SeriesFormat; rules: SeriesRules };
const ruleKeys: (keyof GameRules)[] = [
  'mode',
  'heroPool',
  'banCount',
  'draftRuleMode',
  'enforcePreviousHistory',
  'contributeToFutureHistory',
  'recordHeroes',
  'requireLineupConfirmation',
  'firstPickSide',
  'sideSwapMode',
  'flowbornFormsIndependent',
];
function parseTemplate(raw: unknown): Template {
  if (!raw || typeof raw !== 'object') throw Error('Invalid rules template');
  const value = raw as Template;
  if (value.version !== 1 || !formats.includes(value.format))
    throw Error('Unsupported rules template version or format');
  validateSeriesRules(value.rules, value.format);
  return value;
}
export function GameRulesManager({
  state,
  disabled,
  send,
  acknowledged,
  error,
}: {
  state: MatchState;
  disabled: boolean;
  send: (action: Action) => boolean;
  acknowledged?: { id: string; action: Action };
  error: string;
}) {
  const zh = state.language === 'zh';
  const baseline = state.seriesRules ?? { defaultGameRules: gameRulesFor(state, 1), games: {} };
  const [rules, setRules] = useState<SeriesRules>(() => clone(baseline));
  const [format, setFormat] = useState<SeriesFormat>(state.seriesFormat);
  const [base, setBase] = useState(() => JSON.stringify([state.seriesFormat, baseline]));
  const [message, setMessage] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [copyFrom, setCopyFrom] = useState(1);
  const [copyTo, setCopyTo] = useState(2);
  const [correctionGame, setCorrectionGame] = useState('');
  const [correctionContribution, setCorrectionContribution] = useState(false);
  const [correctionReason, setCorrectionReason] = useState('');
  const [templates, setTemplates] = useState<Record<string, Template>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(templateKey) || '{}');
      return Object.fromEntries(
        Object.entries(raw)
          .slice(0, 20)
          .flatMap(([key, value]) => {
            try {
              return [[key, parseTemplate(value)]];
            } catch {
              return [];
            }
          }),
      );
    } catch {
      return {};
    }
  });
  const submitted = useRef<Action>();
  const serverKey = JSON.stringify([state.seriesFormat, baseline]);
  const conflict = base !== serverKey;
  const count = Number(format.slice(2));
  const games = Array.from({ length: count }, (_, i) => i + 1);
  const locked = (n: number) => gameRulesLocked(state, n);
  const resolve = (plan: SeriesRules, n: number): GameRules => ({
    ...plan.defaultGameRules,
    ...plan.games[String(n)],
  });
  const changes = games.flatMap((n) => {
    const before = gameRulesFor(state, n),
      after = resolve(rules, n);
    const fields = ruleKeys.filter((key) => before[key] !== after[key]);
    return fields.length ? [{ n, before, after, fields }] : [];
  });
  const changed =
    changes.length > 0 ||
    format !== state.seriesFormat ||
    JSON.stringify(rules) !== JSON.stringify(baseline);
  const label: Record<keyof GameRules, string> = {
    mode: zh ? '模式' : 'Mode',
    heroPool: zh ? '英雄池' : 'Hero pool',
    banCount: 'Ban',
    draftRuleMode: zh ? '跨局规则' : 'Draft rule',
    enforcePreviousHistory: zh ? '受历史限制' : 'Enforce history',
    contributeToFutureHistory: zh ? '贡献未来历史' : 'Contribute history',
    recordHeroes: zh ? '记录英雄' : 'Record heroes',
    requireLineupConfirmation: zh ? '要求阵容确认' : 'Require lineup confirmation',
    firstPickSide: zh ? '先选方' : 'First pick',
    sideSwapMode: zh ? '换边策略' : 'Side policy',
    flowbornFormsIndependent: zh ? '元流形态独立' : 'Independent Flowborn forms',
  };
  useEffect(() => {
    if (
      submitted.current &&
      acknowledged &&
      JSON.stringify(acknowledged.action) === JSON.stringify(submitted.current)
    ) {
      setMessage(zh ? '服务器已确认逐局规则' : 'Server confirmed game rules');
      setBase(serverKey);
      const [, confirmedRules] = JSON.parse(serverKey) as [SeriesFormat, SeriesRules];
      setRules(clone(confirmedRules));
      submitted.current = undefined;
    }
  }, [acknowledged, serverKey, zh]);
  useEffect(() => {
    if (error && submitted.current) {
      setMessage(error);
      submitted.current = undefined;
    }
  }, [error]);
  const sanitize = (value: GameRules): GameRules => ({
    ...value,
    ...(value.mode === 'blind' ? { banCount: 0 as const, requireLineupConfirmation: false } : {}),
    ...(value.mode !== 'blind'
      ? { recordHeroes: true }
      : !value.recordHeroes
        ? { contributeToFutureHistory: false }
        : {}),
  });
  function preserveLocked(next: SeriesRules) {
    const plan = clone(next);
    for (const n of games)
      if (locked(n))
        plan.games[String(n)] =
          state.draftHistory.find((game) => game.gameNumber === n)?.rules ??
          (n === currentGame(state) ? state.currentGameRules : undefined) ??
          gameRulesFor(state, n);
    return plan;
  }
  function update(n: number, patch: Partial<GameRules>) {
    if (locked(n)) return;
    setRules((previous) => ({
      ...previous,
      games: { ...previous.games, [n]: sanitize({ ...resolve(previous, n), ...patch }) },
    }));
  }
  function batch(patch?: Partial<GameRules>) {
    setRules((previous) => {
      const next = clone(previous);
      for (const n of games)
        if (!locked(n)) {
          if (patch) next.games[String(n)] = sanitize({ ...resolve(previous, n), ...patch });
          else delete next.games[String(n)];
        }
      return next;
    });
  }
  function loadTemplate(value: Template) {
    if (state.draftHistory.some((game) => game.gameNumber > Number(value.format.slice(2))))
      throw Error(zh ? '模板赛制不能删除历史对局' : 'Template format cannot remove recorded games');
    setFormat(value.format);
    setRules(preserveLocked(value.rules));
    setMessage(
      zh
        ? '模板已载入草稿；已锁定局保留，保存后生效'
        : 'Template loaded as draft; locked games preserved. Save to apply.',
    );
  }
  const fields = (
    value: GameRules,
    change: (patch: Partial<GameRules>) => void,
    prefix: string,
    readOnly = false,
  ) => (
    <>
      <label>
        {label.mode}
        <select
          aria-label={`${prefix} mode`}
          value={value.mode}
          disabled={readOnly}
          onChange={(e) => change({ mode: e.target.value as GameRules['mode'] })}
        >
          <option value="match">{zh ? '常规 BP' : 'Match BP'}</option>
          <option value="normal">{zh ? '普通 BP' : 'Normal BP'}</option>
          <option value="blind">{zh ? '盲选' : 'Blind Pick'}</option>
        </select>
      </label>
      <label>
        {label.heroPool}
        <select
          aria-label={`${prefix} hero pool`}
          value={value.heroPool}
          disabled={readOnly}
          onChange={(e) => change({ heroPool: e.target.value as GameRules['heroPool'] })}
        >
          <option value="global">{zh ? '国际服' : 'Global'}</option>
          <option value="cn">{zh ? '国服' : 'CN'}</option>
        </select>
      </label>
      <label>
        {label.banCount}
        <select
          aria-label={`${prefix} ban count`}
          value={value.banCount}
          disabled={readOnly || value.mode === 'blind'}
          onChange={(e) => change({ banCount: Number(e.target.value) as GameRules['banCount'] })}
        >
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label>
        {label.draftRuleMode}
        <select
          aria-label={`${prefix} draft rule`}
          value={value.draftRuleMode}
          disabled={readOnly}
          onChange={(e) => change({ draftRuleMode: e.target.value as GameRules['draftRuleMode'] })}
        >
          {['normal', 'player', 'global'].map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </label>
    </>
  );
  const advanced = (
    value: GameRules,
    change: (patch: Partial<GameRules>) => void,
    prefix: string,
    readOnly = false,
  ) => (
    <details>
      <summary>{zh ? '历史、阵容与换边' : 'History, lineup & sides'}</summary>
      <div className="game-rules-fields">
        {(
          [
            'enforcePreviousHistory',
            'contributeToFutureHistory',
            'recordHeroes',
            'requireLineupConfirmation',
            'flowbornFormsIndependent',
          ] as const
        ).map((key) => (
          <label className="game-rules-check" key={key}>
            <input
              type="checkbox"
              aria-label={`${prefix} ${key}`}
              checked={value[key]}
              disabled={
                readOnly ||
                (key === 'contributeToFutureHistory' && !value.recordHeroes) ||
                (key === 'requireLineupConfirmation' && value.mode === 'blind') ||
                (key === 'recordHeroes' && value.mode !== 'blind')
              }
              onChange={(e) => change({ [key]: e.target.checked })}
            />
            {label[key]}
          </label>
        ))}
        <label>
          {label.firstPickSide}
          <select
            aria-label={`${prefix} first pick`}
            value={value.firstPickSide}
            disabled={readOnly}
            onChange={(e) =>
              change({ firstPickSide: e.target.value as GameRules['firstPickSide'] })
            }
          >
            <option value="blue">{zh ? '蓝方' : 'Blue'}</option>
            <option value="red">{zh ? '红方' : 'Red'}</option>
          </select>
        </label>
        <label>
          {label.sideSwapMode}
          <select
            aria-label={`${prefix} side policy`}
            value={value.sideSwapMode}
            disabled={readOnly}
            onChange={(e) => change({ sideSwapMode: e.target.value as GameRules['sideSwapMode'] })}
          >
            <option value="moveTeams">{zh ? '队伍随换边移动' : 'Move teams'}</option>
            <option value="colorsOnly">{zh ? '仅交换颜色' : 'Colors only'}</option>
          </select>
        </label>
      </div>
    </details>
  );
  return (
    <section
      className="panel game-rules-manager"
      aria-label="Game Rules Manager"
      data-unsaved={changed}
    >
      <p>
        {zh
          ? '系列默认规则供未覆盖的对局继承。已锁定和已完成局只读；修改默认或导入模板不会改写它们。'
          : 'Games inherit series defaults until overridden. Locked and recorded games remain read-only when defaults or templates change.'}
      </p>
      <label>
        {zh ? '赛制' : 'Series format'}{' '}
        <select
          aria-label="Rules series format"
          disabled={disabled}
          value={format}
          onChange={(e) => {
            const nextFormat = e.target.value as SeriesFormat;
            const max = Number(nextFormat.slice(2));
            if (games.some((n) => n > max && locked(n))) {
              setMessage(zh ? '缩短赛制不能删除已锁定局' : 'Shortening cannot remove locked games');
              return;
            }
            setFormat(nextFormat);
            setRules((previous) => ({
              ...previous,
              games: Object.fromEntries(
                Object.entries(previous.games).filter(([n]) => Number(n) <= max),
              ),
            }));
          }}
        >
          {formats.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </label>
      <details>
        <summary>{zh ? '系列默认规则' : 'Series defaults'}</summary>
        <div className="game-rules-fields">
          {fields(
            rules.defaultGameRules,
            (patch) =>
              setRules(
                preserveLocked({
                  ...rules,
                  defaultGameRules: sanitize({ ...rules.defaultGameRules, ...patch }),
                }),
              ),
            'Default',
            disabled,
          )}
        </div>
        {advanced(
          rules.defaultGameRules,
          (patch) =>
            setRules(
              preserveLocked({
                ...rules,
                defaultGameRules: sanitize({ ...rules.defaultGameRules, ...patch }),
              }),
            ),
          'Default',
          disabled,
        )}
      </details>
      <div className="game-rules-batch">
        <button disabled={disabled} onClick={() => batch()}>
          {zh ? '未开始局统一采用默认' : 'Use defaults for unstarted games'}
        </button>
        <label>
          {zh ? '批量英雄池' : 'Batch hero pool'}
          <select
            aria-label="Batch hero pool"
            disabled={disabled}
            value=""
            onChange={(e) => batch({ heroPool: e.target.value as GameRules['heroPool'] })}
          >
            <option value="">—</option>
            <option value="global">Global</option>
            <option value="cn">CN</option>
          </select>
        </label>
        <label>
          {zh ? '批量 Ban' : 'Batch bans'}
          <select
            aria-label="Batch ban count"
            disabled={disabled}
            value=""
            onChange={(e) => batch({ banCount: Number(e.target.value) as GameRules['banCount'] })}
          >
            <option value="">—</option>
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          {zh ? '复制局' : 'Copy from'}
          <select
            aria-label="Copy rules from"
            value={copyFrom}
            onChange={(e) => setCopyFrom(Number(e.target.value))}
          >
            {games.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          {zh ? '到局' : 'To game'}
          <select
            aria-label="Copy rules to"
            value={copyTo}
            onChange={(e) => setCopyTo(Number(e.target.value))}
          >
            {games.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <button
          disabled={disabled || locked(copyTo) || copyTo > count}
          onClick={() => update(copyTo, resolve(rules, copyFrom))}
        >
          {zh ? '复制' : 'Copy rules'}
        </button>
      </div>
      <div className="game-rules-table">
        <table>
          <thead>
            <tr>
              <th>Game</th>
              <th>{zh ? '规则' : 'Rules'}</th>
              <th>{zh ? '状态 / 操作' : 'Status / actions'}</th>
            </tr>
          </thead>
          <tbody>
            {games.map((n) => {
              const value = resolve(rules, n),
                readOnly = disabled || locked(n),
                record = state.draftHistory.find((game) => game.gameNumber === n),
                completed =
                  !!record &&
                  (n < currentGame(state) ||
                    !!state.postGameReports.find((report) => report.id === record.id)?.endedAt);
              return (
                <tr key={n} data-game-rule={n}>
                  <th scope="row">
                    {n}
                    <small>
                      {rules.games[String(n)]
                        ? zh
                          ? '自定义'
                          : 'Override'
                        : zh
                          ? '继承'
                          : 'Inherited'}
                    </small>
                  </th>
                  <td>
                    <div className="game-rules-fields">
                      {fields(value, (patch) => update(n, patch), `Game ${n}`, readOnly)}
                    </div>
                    {advanced(value, (patch) => update(n, patch), `Game ${n}`, readOnly)}
                  </td>
                  <td>
                    <p>
                      {completed
                        ? zh
                          ? '已完成'
                          : 'Completed'
                        : locked(n)
                          ? zh
                            ? '已锁定 / 进行中'
                            : 'Locked / in progress'
                          : zh
                            ? '未开始'
                            : 'Not started'}
                    </p>
                    <div className="game-rules-actions">
                      <button
                        disabled={readOnly || n === 1}
                        onClick={() => update(n, resolve(rules, n - 1))}
                      >
                        {zh ? '复制上一局' : 'Copy previous'}
                      </button>
                      <button
                        disabled={readOnly}
                        onClick={() =>
                          update(n, {
                            mode: 'blind',
                            banCount: 0,
                            recordHeroes: false,
                            contributeToFutureHistory: false,
                            requireLineupConfirmation: false,
                          })
                        }
                      >
                        {zh ? '设为盲选' : 'Set blind'}
                      </button>
                      <button
                        disabled={readOnly}
                        onClick={() =>
                          setRules((previous) => {
                            const next = clone(previous);
                            delete next.games[String(n)];
                            return next;
                          })
                        }
                      >
                        {zh ? '恢复默认' : 'Reset to default'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <details>
        <summary>{zh ? '模板保存、导入与导出' : 'Save, import & export templates'}</summary>
        <div className="game-rules-batch">
          <input
            aria-label="Rules template name"
            maxLength={40}
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder={zh ? '模板名称' : 'Template name'}
          />
          <button
            disabled={!templateName.trim()}
            onClick={() => {
              try {
                const next = {
                  ...templates,
                  [templateName.trim()]: parseTemplate({ version: 1, format, rules }),
                };
                if (Object.keys(next).length > 20)
                  throw Error(zh ? '最多保存 20 个模板' : 'Up to 20 templates');
                localStorage.setItem(templateKey, JSON.stringify(next));
                setTemplates(next);
                setMessage(zh ? '模板已保存到此浏览器' : 'Template saved in this browser');
              } catch (e) {
                setMessage(String(e));
              }
            }}
          >
            {zh ? '保存模板' : 'Save template'}
          </button>
          <select
            aria-label="Load rules template"
            value=""
            disabled={disabled}
            onChange={(e) => {
              try {
                loadTemplate(templates[e.target.value]);
              } catch (error) {
                setMessage(String(error));
              }
            }}
          >
            <option value="">{zh ? '载入模板' : 'Load template'}</option>
            {Object.keys(templates).map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <button
            onClick={() => {
              try {
                const data = JSON.stringify(parseTemplate({ version: 1, format, rules }), null, 2);
                const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
                const a = document.createElement('a');
                a.href = url;
                a.download = 'hok-game-rules.json';
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              } catch (e) {
                setMessage(String(e));
              }
            }}
          >
            {zh ? '导出 JSON' : 'Export JSON'}
          </button>
          <label>
            {zh ? '导入 JSON' : 'Import JSON'}
            <input
              type="file"
              accept="application/json,.json"
              aria-label="Import rules JSON"
              disabled={disabled}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  if (file.size > 32768) throw Error('Template too large');
                  loadTemplate(parseTemplate(JSON.parse(await file.text())));
                } catch (error) {
                  setMessage(String(error));
                }
              }}
            />
          </label>
        </div>
      </details>
      <div className="game-rules-diff">
        <strong>
          {zh ? `影响 ${changes.length} 局` : `${changes.length} games affected`}
          {format !== state.seriesFormat ? ` · ${state.seriesFormat} → ${format}` : ''}
        </strong>
        <ul>
          {changes.map(({ n, before, after, fields }) => (
            <li key={n}>
              G{n}:{' '}
              {fields
                .map((key) => `${label[key]} ${String(before[key])} → ${String(after[key])}`)
                .join(' · ')}
            </li>
          ))}
        </ul>
      </div>
      {conflict && (
        <p role="alert">
          {zh
            ? '服务器规则已变化，请重新载入再修改。'
            : 'Server rules changed. Reload before editing.'}
        </p>
      )}
      <div className="toolbar">
        <button
          className="primary"
          disabled={disabled || conflict || !changed}
          onClick={() => {
            try {
              const proposed = preserveLocked(rules);
              validateSeriesRules(proposed, format);
              const action: Action = {
                type: 'series_rules',
                rules: proposed,
                seriesFormat: format,
                expectedRules: state.seriesRules,
              };
              if (send(action)) {
                submitted.current = action;
                setMessage(zh ? '正在等待服务器确认…' : 'Waiting for server confirmation…');
              } else
                setMessage(zh ? '未连接，规则尚未保存' : 'Not connected; rules were not saved');
            } catch (e) {
              setMessage(String(e));
            }
          }}
        >
          {zh ? '保存逐局规则' : 'Save game rules'}
        </button>
        <button
          onClick={() => {
            setRules(clone(baseline));
            setFormat(state.seriesFormat);
            setBase(serverKey);
            setMessage('');
          }}
        >
          {zh ? '重新载入' : 'Reload rules'}
        </button>
      </div>
      <details>
        <summary>
          {zh ? '管理员纠错：历史贡献资格' : 'Administrator correction: history contribution'}
        </summary>
        <p>
          {zh
            ? '仅用于修正已记录局的历史贡献开关。必须填写原因并确认，服务器验证后留下审计记录；误操作可用 Undo 恢复。'
            : 'Correct only the contribution flag of a recorded game. A reason and confirmation are required; the server validates and audits the change. Undo restores a mistaken correction.'}
        </p>
        <div className="game-rules-batch">
          <label>
            Game
            <select
              aria-label="Correction game"
              value={correctionGame}
              onChange={(e) => {
                setCorrectionGame(e.target.value);
                setCorrectionContribution(
                  state.draftHistory.find((game) => game.id === e.target.value)?.rules
                    ?.contributeToFutureHistory ?? true,
                );
              }}
            >
              <option value="">—</option>
              {state.draftHistory.map((game) => (
                <option key={game.id} value={game.id}>
                  G{game.gameNumber}
                </option>
              ))}
            </select>
          </label>
          <label className="game-rules-check">
            <input
              type="checkbox"
              aria-label="Correct history contribution"
              checked={correctionContribution}
              onChange={(e) => setCorrectionContribution(e.target.checked)}
            />
            {zh ? '贡献后续历史' : 'Contribute to later history'}
          </label>
          <label>
            {zh ? '纠错原因' : 'Reason'}
            <input
              aria-label="Correction reason"
              maxLength={200}
              value={correctionReason}
              onChange={(e) => setCorrectionReason(e.target.value)}
            />
          </label>
          <button
            disabled={disabled || !correctionGame || correctionReason.trim().length < 5}
            onClick={() => {
              if (
                !confirm(
                  zh
                    ? '确认纠正此历史局的贡献资格？操作会被审计，可用 Undo 恢复。'
                    : 'Correct this recorded game? The action is audited and can be undone.',
                )
              )
                return;
              const action: Action = {
                type: 'correct_history_rules',
                gameId: correctionGame,
                contributeToFutureHistory: correctionContribution,
                reason: correctionReason.trim(),
              };
              if (send(action)) {
                submitted.current = action;
                setMessage(zh ? '等待服务器确认…' : 'Waiting for server confirmation…');
              }
            }}
          >
            {zh ? '确认历史纠错' : 'Confirm history correction'}
          </button>
        </div>
      </details>
      <p role="status">{message}</p>
    </section>
  );
}
