import { useEffect, useState } from 'react';
import {
  defaultShortcuts,
  shortcutKey,
  shortcutForEvent,
  validateShortcuts,
  type WorkspaceShortcuts,
} from '../shared/workspaceShortcuts';
import { openWorkspace } from './workspaceNavigation';

export function WorkspaceShortcutSettings({ zh }: { zh: boolean }) {
  const [saved, setSaved] = useState(() => {
    try {
      return validateShortcuts(JSON.parse(localStorage.getItem(shortcutKey) || 'null'));
    } catch {
      return { ...defaultShortcuts };
    }
  });
  const [draft, setDraft] = useState(saved),
    [message, setMessage] = useState('');
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        document.querySelector('[role="dialog"], dialog:modal')
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]'))
      )
        return;
      const binding = shortcutForEvent(event);
      const workspace =
        binding && Object.entries(saved).find(([, value]) => value === binding)?.[0];
      if (workspace) {
        event.preventDefault();
        openWorkspace(workspace);
      }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [saved]);
  function save(value: WorkspaceShortcuts) {
    try {
      const next = validateShortcuts(value);
      localStorage.setItem(shortcutKey, JSON.stringify(next));
      setSaved(next);
      setDraft(next);
      setMessage(zh ? '快捷键已保存。' : 'Shortcuts saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save shortcuts');
    }
  }
  const labels = zh
    ? ['BP 工作区', '局内 HUD', 'OBS 导播', '赛后数据', '设置中心']
    : ['Draft workspace', 'Live HUD', 'OBS director', 'Post-game', 'Settings'];
  return (
    <details className="panel" aria-label={zh ? '自定义导航快捷键' : 'Custom navigation shortcuts'}>
      <summary>{zh ? '自定义导航快捷键' : 'Custom navigation shortcuts'}</summary>
      <p>
        {zh
          ? '只切换工作区，不提交比分、英雄或切换 OBS。使用 Ctrl+Alt+字母/数字 或 Alt+Shift+字母/数字；留空禁用。输入文字、输入法组合和对话框内不触发。'
          : 'Navigate only; never submit scores, heroes or OBS commands. Use Ctrl+Alt+letter/digit or Alt+Shift+letter/digit; blank disables. Ignored while typing, composing or in dialogs.'}
      </p>
      {(Object.keys(draft) as (keyof WorkspaceShortcuts)[]).map((key, index) => (
        <label key={key}>
          {labels[index]}
          <input
            aria-label={`Shortcut ${key}`}
            maxLength={16}
            value={draft[key]}
            onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
          />
        </label>
      ))}
      <button onClick={() => save(draft)}>{zh ? '保存快捷键' : 'Save shortcuts'}</button>
      <button onClick={() => save({ ...defaultShortcuts })}>
        {zh ? '恢复默认快捷键' : 'Reset shortcuts'}
      </button>
      <p role="status">{message}</p>
    </details>
  );
}
