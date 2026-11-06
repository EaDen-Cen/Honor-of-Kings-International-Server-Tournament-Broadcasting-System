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
import { ControlDraftWorkspace } from './ControlDraftWorkspace';
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
export function DockWorkspace({
  panels,
  zh,
  status,
  fileTools,
  editTools,
}: {
  panels: Record<PanelId, ReactNode>;
  zh: boolean;
  status?: ReactNode;
  fileTools?: ReactNode;
  editTools?: ReactNode;
}) {
  const [floating, setFloating] = useState<PanelId[]>([]);
  const [mobilePanel, setMobilePanel] = useState<PanelId>('draft');
  const [zoom, setZoom] = useState(100);
  const [compact, setCompact] = useState(false);
  const menus = useRef<HTMLElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!menus.current?.contains(event.target as Node))
        menus.current
          ?.querySelectorAll('details[open]')
          .forEach((el) => el.removeAttribute('open'));
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
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
  const workspace = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const fit = () => {
      const layout = element.querySelector<HTMLElement>('.dock-layout');
      if (layout)
        layout.style.height = `${Math.max(180, (window.innerHeight - layout.getBoundingClientRect().top - 4) / (zoom / 100))}px`;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element.parentElement!);
    window.addEventListener('resize', fit);
    fit();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [small, zoom]);
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
        (['default', 'bp', 'live', 'postgame', 'obs'].includes(saved) ||
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
  const [previousLayout, setPreviousLayout] = useState<ReturnType<Model['toJson']>>();
  const [, refresh] = useState(0);
  useLayoutEffect(() => {
    parkingRef.current?.appendChild(parking);
    return () => parking.remove();
  }, [parking]);
  function saveable(next: Model, floatingIds = floating) {
    const saved = Model.fromJson(next.toJson());
    for (const id of floatingIds)
      if (!saved.getNodeById(id))
        saved.doAction(
          Actions.addNode(tab(id), saved.getFirstTabSet().getId(), DockLocation.CENTER, -1),
        );
    return saved.toJson();
  }
  function persist(next: Model, selection = selected, floatingIds = floating) {
    try {
      localStorage.setItem(
        workspaceKey,
        JSON.stringify({ version: 1, preset: selection, layout: saveable(next, floatingIds) }),
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
    setMobilePanel(id);
    setFloating((old) => old.filter((item) => item !== id));
    if (!model.getNodeById(id)) {
      const target = model.getActiveTabset() ?? model.getFirstTabSet();
      model.doAction(Actions.addNode(tab(id), target.getId(), DockLocation.CENTER, -1));
    }
    const maximized = model.getMaximizedTabset();
    if (maximized && maximized !== model.getNodeById(id)?.getParent())
      model.doAction(Actions.maximizeToggle(maximized.getId()));
    model.doAction(Actions.selectTab(id));
    persist(model);
  }
  function float(id: PanelId) {
    const node = model.getNodeById(id),
      parent = node?.getParent();
    const next = [...floating.filter((item) => item !== id), id];
    setFloating(next);
    if (node) model.doAction(Actions.deleteTab(id));
    let groups = 0;
    model.visitNodes((item) => {
      if (item.getType() === 'tabset') groups++;
    });
    if (parent && parent.getChildren().length === 0 && groups > 1)
      model.doAction(Actions.deleteTabset(parent.getId()));
    persist(model, selected, next);
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
    setFloating([]);
    const next = Model.fromJson(json);
    setPreviousLayout(saveable(model));
    setModel(next);
    setSelected(value);
    persist(next, value, []);
  }
  const factory = (node: TabNode) => (
    <DockSlot host={hosts[node.getComponent() as PanelId]} parking={parking} />
  );
  return (
    <section
      ref={workspace}
      className="dock-workspace"
      aria-label={zh ? '可停靠工作区' : 'Dockable workspace'}
    >
      <nav
        ref={menus}
        className="desktop-menu"
        aria-label={zh ? '应用菜单' : 'Application menu'}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            const menu = (event.target as HTMLElement).closest('details');
            menu?.removeAttribute('open');
            menu?.querySelector('summary')?.focus();
          }
        }}
      >
        <details>
          <summary>{zh ? '文件' : 'File'}</summary>
          <div className="desktop-dropdown">
            <button onClick={() => open('recovery')}>
              {zh ? '比赛备份 / 恢复 / 导入 / 导出' : 'Backup / restore / import / export'}
            </button>
            {fileTools}
          </div>
        </details>
        <details>
          <summary>{zh ? '编辑' : 'Edit'}</summary>
          <div className="desktop-dropdown">
            {editTools}
            <button onClick={() => open('monitor')}>{zh ? 'BP 纠错' : 'Correct BP'}</button>
            <button onClick={() => open('players')}>
              {zh ? '选手换位 / 英雄归属' : 'Player roles / hero assignments'}
            </button>
          </div>
        </details>
        <details>
          <summary>{zh ? '视图' : 'View'}</summary>
          <div className="desktop-dropdown">
            <button
              onClick={() => {
                const task = document.fullscreenElement
                  ? document.exitFullscreen()
                  : document.documentElement.requestFullscreen();
                void task.catch(() => setMessage(zh ? '全屏不可用' : 'Fullscreen unavailable'));
              }}
            >
              {zh ? '全屏' : 'Fullscreen'}
            </button>
            <label>
              {zh ? '界面缩放' : 'UI scale'}
              <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
                {[80, 90, 100, 110, 125].map((n) => (
                  <option key={n} value={n}>
                    {n}%
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={compact}
                onChange={(e) => setCompact(e.target.checked)}
              />
              {zh ? '紧凑模式' : 'Compact mode'}
            </label>
          </div>
        </details>
        <details className="window-menu">
          <summary>{zh ? '窗口' : 'Window'}</summary>
          <div className="dock-toolbar desktop-dropdown">
            <label>
              {zh ? '工作区' : 'Workspace'}{' '}
              <select
                aria-label="Workspace preset"
                value={selected}
                onChange={(e) => select(e.target.value)}
              >
                {(['default', 'bp', 'live', 'postgame', 'obs'] as const).map((id, index) => (
                  <option key={id} value={id}>
                    {
                      (zh
                        ? ['默认', 'BP 导播', '局内直播', '赛后分析', 'OBS 导播']
                        : ['Default', 'BP', 'Live', 'Post-game', 'OBS'])[index]
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
                const next = { ...presets, [name.trim()]: saveable(model) };
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
            <button
              type="button"
              disabled={!previousLayout}
              onClick={() => {
                if (!previousLayout) return;
                setFloating([]);
                const old = saveable(model);
                const next = Model.fromJson(previousLayout);
                setModel(next);
                setPreviousLayout(old);
                persist(next, selected, []);
              }}
            >
              {zh ? '恢复上一次布局' : 'Restore previous layout'}
            </button>
            <button
              type="button"
              disabled={!selected.startsWith('saved:')}
              onClick={() => {
                const next = { ...presets };
                delete next[selected.slice(6)];
                try {
                  localStorage.setItem(workspaceKey + '-presets', JSON.stringify(next));
                  setPresets(next);
                  select('default');
                } catch {
                  setMessage(zh ? '删除布局失败' : 'Could not delete layout');
                }
              }}
            >
              {zh ? '删除当前自定义布局' : 'Delete selected custom layout'}
            </button>
            {small && (
              <button type="button" onClick={() => float(mobilePanel)}>
                {zh ? '浮动当前面板' : 'Float active panel'}
              </button>
            )}
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
        </details>
        <details>
          <summary>{zh ? '帮助' : 'Help'}</summary>
          <div className="desktop-dropdown">
            <button onClick={() => open('help')}>
              {zh ? '操作指南 / 版本' : 'Guide / version'}
            </button>
            <button onClick={() => open('settings')}>{zh ? '快捷键' : 'Keyboard shortcuts'}</button>
            <button onClick={() => open('preparation')}>
              {zh ? '系统诊断与赛前准备' : 'Diagnostics & preparation'}
            </button>
          </div>
        </details>
        <div className="desktop-status">{status}</div>
      </nav>
      <div
        className={compact ? 'desktop-content is-compact' : 'desktop-content'}
        style={{ zoom: zoom / 100 }}
      >
        {small ? (
          <div className="dock-mobile">
            <select
              aria-label="Active panel"
              value={mobilePanel}
              onChange={(e) => open(e.target.value as PanelId)}
            >
              {(Object.keys(panelNames) as PanelId[]).map((id) => (
                <option key={id} value={id}>
                  {panelNames[id][zh ? 0 : 1]}
                </option>
              ))}
            </select>
            {mobilePanel === 'draft' || mobilePanel === 'monitor' ? (
              <ControlDraftWorkspace
                monitor={
                  !floating.includes('monitor') && (
                    <DockSlot host={hosts.monitor} parking={parking} />
                  )
                }
              >
                {!floating.includes('draft') && <DockSlot host={hosts.draft} parking={parking} />}
              </ControlDraftWorkspace>
            ) : (
              !floating.includes(mobilePanel) && (
                <DockSlot host={hosts[mobilePanel]} parking={parking} />
              )
            )}
          </div>
        ) : (
          <div className="dock-layout">
            <Layout
              model={model}
              factory={factory}
              onAction={(action) => {
                if (action.type !== 'FlexLayout_SelectTab') setPreviousLayout(model.toJson());
                return action;
              }}
              onModelChange={(next) => persist(next)}
              onRenderTab={(node, values) => {
                values.buttons.push(
                  <button
                    key="float"
                    aria-label={`${zh ? '浮动' : 'Float'} ${panelNames[node.getComponent() as PanelId][zh ? 0 : 1]}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      float(node.getComponent() as PanelId);
                    }}
                  >
                    {zh ? '浮' : 'Float'}
                  </button>,
                );
                values.content =
                  panelNames[node.getComponent() as PanelId]?.[zh ? 0 : 1] ?? values.content;
              }}
            />
          </div>
        )}
      </div>
      {floating.map((id) => (
        <FloatingPanel
          key={id}
          label={panelNames[id][zh ? 0 : 1]}
          dock={() => open(id)}
          close={() => {
            const next = floating.filter((item) => item !== id);
            setFloating(next);
            persist(model, selected, next);
          }}
        >
          <DockSlot host={hosts[id]} parking={parking} />
        </FloatingPanel>
      ))}
      <div ref={parkingRef} />
      {(Object.keys(panelNames) as PanelId[]).map((id) => createPortal(panels[id], hosts[id], id))}
    </section>
  );
}

function FloatingPanel({
  label,
  dock,
  close,
  children,
}: {
  label: string;
  dock: () => void;
  close: () => void;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fit = () => {
      const el = box.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.left = `${Math.max(0, Math.min(innerWidth - 100, r.left))}px`;
      el.style.top = `${Math.max(0, Math.min(innerHeight - 40, r.top))}px`;
    };
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return (
    <div ref={box} className="desktop-floating" role="dialog" aria-label={label}>
      <header
        tabIndex={0}
        onKeyDown={(event) => {
          if (!event.key.startsWith('Arrow') || !box.current) return;
          event.preventDefault();
          const r = box.current.getBoundingClientRect();
          box.current.style.left = `${Math.max(0, Math.min(innerWidth - 100, r.left + (event.key === 'ArrowRight' ? 10 : event.key === 'ArrowLeft' ? -10 : 0)))}px`;
          box.current.style.top = `${Math.max(0, Math.min(innerHeight - 40, r.top + (event.key === 'ArrowDown' ? 10 : event.key === 'ArrowUp' ? -10 : 0)))}px`;
        }}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('button')) return;
          const el = box.current!;
          const r = el.getBoundingClientRect(),
            x = event.clientX,
            y = event.clientY;
          event.currentTarget.setPointerCapture(event.pointerId);
          const head = event.currentTarget;
          head.onpointermove = (e) => {
            el.style.left = `${Math.max(0, Math.min(innerWidth - 100, r.left + e.clientX - x))}px`;
            el.style.top = `${Math.max(0, Math.min(innerHeight - 40, r.top + e.clientY - y))}px`;
          };
          head.onpointerup = head.onpointercancel = () => {
            head.onpointermove = null;
          };
        }}
      >
        <b>{label}</b>
        <button onClick={dock}>停靠 / Dock</button>
        <button onClick={close}>关闭 / Close</button>
      </header>
      {children}
      <button
        className="float-resize"
        aria-label="Resize floating panel"
        onPointerDown={(event) => {
          event.preventDefault();
          const el = box.current!,
            r = el.getBoundingClientRect(),
            x = event.clientX,
            y = event.clientY;
          const handle = event.currentTarget;
          handle.setPointerCapture(event.pointerId);
          handle.onpointermove = (e) => {
            el.style.width = `${Math.max(280, Math.min(innerWidth - r.left, r.width + e.clientX - x))}px`;
            el.style.height = `${Math.max(180, Math.min(innerHeight - r.top, r.height + e.clientY - y))}px`;
          };
          handle.onpointerup = handle.onpointercancel = () => {
            handle.onpointermove = null;
          };
        }}
      >
        ◢
      </button>
    </div>
  );
}
