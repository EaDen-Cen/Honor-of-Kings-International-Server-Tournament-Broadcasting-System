import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formDraftDirty, rebaseFormDraft } from '../src/shared/formDraft.js';

test('settings preserve local edits while adopting independent remote changes', () => {
  const base = { stage: 'Final', language: 'zh', score: 0 };
  const updated = rebaseFormDraft({ base, form: { ...base, stage: 'Grand Final' }, conflicts: [] }, { ...base, language: 'eng', score: 1 });
  assert.deepEqual(updated.form, { stage: 'Grand Final', language: 'eng', score: 1 });
  assert.deepEqual(updated.conflicts, []);
  assert.equal(formDraftDirty(updated), true);
});
test('simultaneous edits remain conflicts until accepted or reset, while save acknowledgement clears dirty state', () => {
  const base = { team: { name: 'A' }, language: 'zh' };
  const conflict = rebaseFormDraft({ base, form: { ...base, team: { name: 'Local' } }, conflicts: [] }, { ...base, team: { name: 'Remote' } });
  assert.deepEqual(conflict.conflicts, ['team']);
  assert.equal(conflict.form.team.name, 'Local');
  assert.deepEqual(rebaseFormDraft(conflict, { ...conflict.base, language: 'eng' }).conflicts, ['team']);
  const acknowledged = rebaseFormDraft(conflict, conflict.form);
  assert.deepEqual(acknowledged.conflicts, []);
  assert.equal(formDraftDirty(acknowledged), false);
});
