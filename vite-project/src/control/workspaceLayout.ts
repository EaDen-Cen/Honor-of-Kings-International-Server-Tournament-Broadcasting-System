import { Model, type IJsonModel, type IJsonTabSetNode } from 'flexlayout-react';
export const panelNames = {
  monitor: ['比赛控制 / BP 预览', 'Match / BP preview'],
  draft: ['BP 与识别', 'Draft & recognition'],
  players: ['玩家管理', 'Players'],
  hud: ['局内 GHUD', 'Live GHUD'],
  obs: ['OBS 导播', 'OBS director'],
  postgame: ['赛后数据', 'Post-game'],
  recovery: ['备份与恢复', 'Backup & recovery'],
  analysis: ['英雄与历史', 'Heroes & history'],
  voting: ['MVP 投票', 'MVP voting'],
  settings: ['设置中心', 'Settings'],
} as const;
export type PanelId = keyof typeof panelNames;
export type Preset = 'default' | 'bp' | 'live' | 'postgame' | 'obs';
export const workspaceKey = 'hok-dock-workspace-v1';
export const tab = (id: PanelId) => ({ type: 'tab', id, component: id, name: panelNames[id][0] });
export function presetLayout(preset: Preset): IJsonModel {
  const group = (id: string, panels: PanelId[], weight = 50): IJsonTabSetNode => ({
    type: 'tabset',
    id,
    weight,
    children: panels.map(tab),
  });
  const secondary: PanelId[] = [
    'hud',
    'obs',
    'postgame',
    'voting',
    'settings',
    'recovery',
    'analysis',
  ];
  return {
    global: {
      tabEnableRename: false,
      tabEnablePopout: false,
      tabEnableRenderOnDemand: false,
      tabSetEnableDeleteWhenEmpty: false,
      tabSetMinWidth: 240,
      tabSetMinHeight: 160,
      splitterSize: 8,
    },
    borders: [],
    layout: {
      type: 'row',
      children:
        preset === 'obs'
          ? [
              group('main', ['obs'], 65),
              {
                type: 'row',
                children: [
                  group('right', ['monitor', 'draft', 'players', 'hud']),
                  group('lower', ['voting', 'postgame', 'settings', 'recovery', 'analysis']),
                ],
              },
            ]
          : preset === 'live'
            ? [
                group('main', ['hud', 'postgame'], 60),
                {
                  type: 'row',
                  children: [
                    group('right', ['obs', 'voting', 'settings', 'recovery']),
                    group('lower', ['monitor', 'draft', 'players', 'analysis']),
                  ],
                },
              ]
            : preset === 'postgame'
              ? [
                  group('main', ['postgame', 'hud'], 65),
                  {
                    type: 'row',
                    children: [
                      group('right', ['voting', 'obs', 'settings', 'recovery']),
                      group('lower', ['analysis', 'monitor', 'draft', 'players']),
                    ],
                  },
                ]
              : [
                  {
                    type: 'row',
                    weight: preset === 'bp' ? 30 : 40,
                    children: [
                      group('main', ['monitor']),
                      group('lower', ['players', ...secondary]),
                    ],
                  },
                  group('right', ['draft'], preset === 'bp' ? 70 : 60),
                ],
    },
  };
}
/** Storage is untrusted and versioned. Reject unknown components, duplicate
 * IDs, excessive nesting, and popouts before asking the library to restore it.
 * A future schema must migrate here or fall back to the default workspace. */
export function restoreLayout(raw: unknown): IJsonModel | undefined {
  if (!raw || typeof raw !== 'object') return;
  const value = raw as { version?: number; layout?: IJsonModel };
  if (value.version !== 1 || !value.layout || JSON.stringify(value.layout).length > 50000) return;
  let count = 0;
  const seen = new Set<string>();
  function check(node: unknown, depth = 0): boolean {
    if (!node || typeof node !== 'object' || depth > 12 || ++count > 80) return false;
    const n = node as { type?: string; id?: string; component?: string; children?: unknown[] };
    if (n.type === 'tab') {
      if (
        !n.id ||
        n.id !== n.component ||
        !Object.prototype.hasOwnProperty.call(panelNames, n.id) ||
        seen.has(n.id)
      )
        return false;
      seen.add(n.id);
      return true;
    }
    return (
      (n.type === 'row' || n.type === 'tabset') &&
      Array.isArray(n.children) &&
      n.children.every((child) => check(child, depth + 1))
    );
  }
  if (
    !check(value.layout.layout) ||
    value.layout.borders?.length ||
    Object.keys(value.layout.popouts ?? {}).length
  )
    return;
  try {
    const model = Model.fromJson(value.layout).toJson();
    model.global = { ...presetLayout('default').global };
    return model;
  } catch {
    return;
  }
}
