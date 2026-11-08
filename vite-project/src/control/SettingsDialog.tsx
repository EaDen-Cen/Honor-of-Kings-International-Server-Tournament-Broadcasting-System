import { useEffect, useRef, type ReactNode } from 'react';
export function SettingsDialog({
  children,
  label,
  closeLabel,
  onClose,
  id = 'match-settings',
}: {
  id?: string;
  children: ReactNode;
  label: string;
  closeLabel: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const modal = id === 'game-rules-dialog';
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [modal]);
  const content = (
    <>
      <header>
        <strong>{label}</strong>
        <button type="button" onClick={onClose}>
          {closeLabel}
        </button>
      </header>
      {children}
    </>
  );
  return modal ? (
    <dialog
      ref={dialog}
      id={id}
      className="settings-inline"
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {content}
    </dialog>
  ) : (
    <section
      id={id}
      className="settings-inline"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      {content}
    </section>
  );
}
