import type { ReactNode } from 'react';
export function SettingsDialog({ children, label, closeLabel, onClose, id = 'match-settings' }: { id?: string; children: ReactNode; label: string; closeLabel: string; onClose: () => void }) {
  return <section id={id} className="settings-inline" aria-label={label} onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
    <header><strong>{label}</strong><button type="button" onClick={onClose}>{closeLabel}</button></header>{children}
  </section>;
}
