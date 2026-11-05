export const shortcutKey = 'hok-workspace-shortcuts-v1';
export const defaultShortcuts = {
  'draft-workspace': 'Ctrl+Alt+1',
  'live-hud-workspace': 'Ctrl+Alt+2',
  'obs-workspace': 'Ctrl+Alt+3',
  'postgame-tools': 'Ctrl+Alt+4',
  'integration-settings': 'Ctrl+Alt+5',
};
export type WorkspaceShortcuts = typeof defaultShortcuts;
export function validateShortcuts(value: unknown): WorkspaceShortcuts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid shortcuts');
  const input = value as Record<string, unknown>,
    result = { ...defaultShortcuts },
    seen = new Set<string>();
  for (const key of Object.keys(result) as (keyof WorkspaceShortcuts)[]) {
    const binding = input[key];
    if (
      typeof binding !== 'string' ||
      (binding !== '' && !/^(Ctrl\+Alt|Alt\+Shift)\+[A-Z0-9]$/.test(binding)) ||
      (binding && seen.has(binding))
    )
      throw Error(
        'Use unique Ctrl+Alt+key or Alt+Shift+key bindings (A–Z, 0–9), or blank to disable',
      );
    if (binding) seen.add(binding);
    result[key] = binding;
  }
  return result;
}
export function shortcutForEvent(
  event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>,
) {
  if (event.metaKey || !/^(Key[A-Z]|Digit[0-9])$/.test(event.code)) return '';
  const key = event.code.replace(/^(Key|Digit)/, '');
  if (event.ctrlKey && event.altKey && !event.shiftKey) return `Ctrl+Alt+${key}`;
  if (!event.ctrlKey && event.altKey && event.shiftKey) return `Alt+Shift+${key}`;
  return '';
}
