/** Rebase untouched fields while preserving local edits and detecting concurrent edits. */
export type FormDraft<T extends object> = { base: T; form: T; conflicts: (keyof T)[] };
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
export function rebaseFormDraft<T extends object>(previous: FormDraft<T>, incoming: T): FormDraft<T> {
  const form = { ...previous.form };
  const conflicts: (keyof T)[] = [];
  for (const key of Object.keys(incoming) as (keyof T)[]) {
    const edited = !same(previous.form[key], previous.base[key]);
    if (!edited) form[key] = incoming[key];
    if (edited && !same(form[key], incoming[key]) && (previous.conflicts.includes(key) || !same(previous.base[key], incoming[key]))) conflicts.push(key);
  }
  return { base: incoming, form, conflicts };
}
export function formDraftDirty<T extends object>({ form, base }: FormDraft<T>): boolean {
  return (Object.keys(base) as (keyof T)[]).some(key => !same(form[key], base[key]));
}
