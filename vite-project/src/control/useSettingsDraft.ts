import { useEffect, useMemo, useState, type SetStateAction } from 'react';
import { formDraftDirty, rebaseFormDraft, type FormDraft } from '../shared/formDraft';

export function useSettingsDraft<T extends object>(server: T) {
  const serialized = JSON.stringify(server);
  const incoming = useMemo<T>(() => JSON.parse(serialized), [serialized]);
  const [draft, setDraft] = useState<FormDraft<T>>(() => ({ base: incoming, form: incoming, conflicts: [] }));
  useEffect(() => { setDraft(previous => rebaseFormDraft(previous, incoming)); }, [incoming]);
  const dirty = formDraftDirty(draft);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function setForm(update: SetStateAction<T>) {
    setDraft(previous => {
      const form = typeof update === 'function' ? (update as (value: T) => T)(previous.form) : update;
      return { ...previous, form, conflicts: previous.conflicts.filter(key => JSON.stringify(form[key]) !== JSON.stringify(previous.base[key])) };
    });
  }
  return { form: draft.form, setForm, dirty, conflicts: draft.conflicts, reset: () => setDraft({ base: incoming, form: incoming, conflicts: [] }) };
}
