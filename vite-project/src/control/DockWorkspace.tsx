import { ControlDraftWorkspace } from './ControlDraftWorkspace';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Actions, DockLocation, Layout, Model, type TabNode } from 'flexlayout-react';
import {
  panelNames,
  presetLayout,
  restoreLayout,
  tab,
  workspaceKey,
  type PanelId,
  type Preset,
} from './workspaceLayout';
import 'flexlayout-react/style/dark.css';
import './control.css';
import './dockWorkspace.css';

function DockSlot({ host, parking }: { host: HTMLDivElement; parking: HTMLDivElement }) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    slot.current?.appendChild(host);
    return () => {
      parking.appendChild(host);
    };
  }, [host, parking]);
  return <div className="dock-slot" ref={slot} />;
}
/** Business components live in stable portal hosts owned by this workspace.
 * FlexLayout only owns slots. Moving, hiding or changing a layout reparents the
 * same host DOM without remounting React, media streams or capture timers.
 * Closing a tab hides its UI; necessary recognition continues in the parking
 * area. Leaving Control unmounts portals normally and releases their resources.
 */
export function DockWorkspace({ panels, zh }: { panels: Record<PanelId, ReactNode>; zh: boolean }) {
  const [hosts] = useState(
    () =>
      Object.fromEntries(
        Object.keys(panelNames).map((id) => {
          const host = document.createElement('div');
          host.className = 'dock-panel';
          host.dataset.panel = id;
          return [id, host];
        }),
      ) as Record<PanelId, HTMLDivElement>,
  );
  const [parking] = useState(() => {
    const el = document.createElement('div');
    el.hidden = true;
    return el;
  });
  const parkingRef = useRef<HTMLDivElement>(null);
  const [model, setModel] = useState(() => {
    try {
      return Model.fromJson(
        restoreLayout(JSON.parse(localStorage.getItem(workspaceKey) || 'null')) ??
          presetLayout('default'),
      );
    } catch {
      return Model.fromJson(presetLayout('default'));
    }
  });
  const [presets, setPresets] = useState<Record<string, ReturnType<Model['toJson']>>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(workspaceKey + '-presets') || '{}');
      return Object.fromEntries(
        Object.entries(raw)
          .slice(0, 10)
          .flatMap(([name, layout]) => {
            const valid = restoreLayout({ version: 1, layout });
            return valid ? [[name, valid]] : [];
          }),
      );
    } catch {
      return {};
    }
  });
  const [small, setSmall] = useState(() => window.innerWidth <= 900);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const update = () => setSmall(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const [selected, setSelected] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(workspaceKey) || 'null')?.preset;
      return typeof saved === 'string' &&
        (['default', 'bp', 'live', 'postgame'].includes(saved) ||
          (saved.startsWith('saved:') &&
            Object.prototype.hasOwnProperty.call(presets, saved.slice(6))))
        ? saved
        : 'default';
    } catch {
      return 'default';
    }
  });
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [, refresh] = useState(0);
  useLayoutEffect(() => {
    parkingRef.current?.appendChild(parking);
    return () => parking.remove();
  }, [parking]);
  function persist(next: Model, selection = selected) {
    try {
      localStorage.setItem(
        workspaceKey,
        JSON.stringify({ version: 1, preset: selection, layout: next.toJson() }),
      );
    } catch {
      setMessage(
        zh
          ? '无法保存到浏览器；当前布局仍可使用。'
          : 'Browser storage unavailable; layout remains usable.',
      );
    }
    refresh((n) => n + 1);
  }
  function open(id: PanelId) {
    if (!model.getNodeById(id)) {
      const target = model.getActiveTabset() ?? model.getFirstTabSet();
      model.doAction(Actions.addNode(tab(id), target.getId(), DockLocation.CENTER, -1));
    }
    model.doAction(Actions.selectTab(id));
    persist(model);
  }
  useEffect(() => {
    function reveal(event: Event) {
      const id = (event as CustomEvent<string>).detail;
      const target = document.getElementById(id);
      const panel = target?.closest<HTMLElement>('[data-panel]')?.dataset.panel as
        | PanelId
        | undefined;
      if (panel) open(panel);
    }
    document.addEventListener('hok-open-panel', reveal);
    return () => document.removeEventListener('hok-open-panel', reveal);
  });
  function select(value: string) {
    const json = value.startsWith('saved:')
      ? presets[value.slice(6)]
      : presetLayout(value as Preset);
    if (!json) return;
    const next = Model.fromJson(json);
    setModel(next);
    setSelected(value);
    persist(next, value);
  }
  const factory = (node: TabNode) => (
    <DockSlot host={hosts[node.getComponent() as PanelId]} parking={parking} />
  );
  return (
    <section className="dock-workspace" aria-label={zh ? '可停靠工作区' : 'Dockable workspace'}>
      <div className="dock-toolbar">
        <label>
          {zh ? '工作区' : 'Workspace'}{' '}
          <select
            aria-label="Workspace preset"
            value={selected}
            onChange={(e) => select(e.target.value)}
          >
            {(['default', 'bp', 'live', 'postgame'] as const).map((id, index) => (
              <option key={id} value={id}>
                {
                  (zh
                    ? ['默认', 'BP 导播', '局内直播', '赛后']
                    : ['Default', 'BP', 'Live', 'Post-game'])[index]
                }
              </option>
            ))}
            {Object.keys(presets).map((key) => (
              <option key={key} value={'saved:' + key}>
                {key}
              </option>
            ))}
          </select>
        </label>
        <input
          aria-label="Workspace name"
          maxLength={40}
          value={name}
          placeholder={zh ? '自定义布局名称' : 'Custom layout name'}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          disabled={
            !name.trim() ||
            (!Object.prototype.hasOwnProperty.call(presets, name.trim()) &&
              Object.keys(presets).length >= 10)
          }
          onClick={() => {
            const next = { ...presets, [name.trim()]: model.toJson() };
            setPresets(next);
            setSelected('saved:' + name.trim());
            persist(model, 'saved:' + name.trim());
            try {
              localStorage.setItem(workspaceKey + '-presets', JSON.stringify(next));
              setMessage(zh ? '布局已保存' : 'Layout saved');
            } catch {
              setMessage(
                zh ? '保存失败：浏览器存储不可用' : 'Save failed: browser storage unavailable',
              );
            }
          }}
        >
          {zh ? '保存布局' : 'Save layout'}
        </button>
        <button type="button" onClick={() => select('default')}>
          {zh ? '恢复默认' : 'Restore default'}
        </button>
        <details className="dock-panel-menu">
          <summary>{zh ? '面板列表' : 'Panels'}</summary>
          <div>
            {(Object.keys(panelNames) as PanelId[]).map((id) => (
              <button type="button" key={id} onClick={() => open(id)}>
                {panelNames[id][zh ? 0 : 1]}
              </button>
            ))}
          </div>
        </details>
        <span role="status">{message}</span>
      </div>
      <p className="dock-hint">
        {zh
          ? '拖动标签到高亮区域可停靠或组合；拖动分隔条调整大小，双击标签栏最大化。关闭面板后，可从面板列表重新打开；采集任务继续运行。'
          : 'Drag tabs to highlighted targets to dock or group. Drag dividers to resize; double-click the tab bar to maximize. Closed panels can be reopened from Panels; capture keeps running.'}
      </p>
      {small ? (
        <div className="dock-mobile">
          <ControlDraftWorkspace monitor={<DockSlot host={hosts.monitor} parking={parking} />}>
            <DockSlot host={hosts.draft} parking={parking} />
          </ControlDraftWorkspace>
          {(Object.keys(panelNames) as PanelId[])
            .filter((id) => id !== 'monitor' && id !== 'draft')
            .map((id) => (
              <section key={id}>
                <h2>{panelNames[id][zh ? 0 : 1]}</h2>
                <DockSlot host={hosts[id]} parking={parking} />
              </section>
            ))}
        </div>
      ) : (
        <div className="dock-layout">
          <Layout
            model={model}
            factory={factory}
            onModelChange={(next) => persist(next)}
            onRenderTab={(node, values) => {
              values.content =
                panelNames[node.getComponent() as PanelId]?.[zh ? 0 : 1] ?? values.content;
            }}
          />
        </div>
      )}
      <div ref={parkingRef} />
      {(Object.keys(panelNames) as PanelId[]).map((id) => createPortal(panels[id], hosts[id], id))}
    </section>
  );
}
