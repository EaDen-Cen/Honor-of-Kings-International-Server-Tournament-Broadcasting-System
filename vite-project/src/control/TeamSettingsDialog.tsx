import { createPortal } from 'react-dom';
import { useEffect, useRef, type ReactNode } from 'react';

export function TeamSettingsDialog({
  children,
  label,
  closeLabel,
  onClose,
}: {
  children: ReactNode;
  label: string;
  closeLabel: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => {
      if (element.open) element.close();
    };
  }, []);

  return createPortal(
    <dialog
      id="team-settings"
      ref={dialog}
      className="team-settings-dialog"
      aria-label={label}
      onCancel={event => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="team-settings-dialog-header">
        <strong>{label}</strong>
        <button type="button" onClick={onClose}>{closeLabel}</button>
      </header>
      {children}
    </dialog>,
    document.body,
  );
}
