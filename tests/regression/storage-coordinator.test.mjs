import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinateStorage } from '../../game/src/storage-coordinator.js';
import { createStorageAccess } from '../../game/src/platform/web.js';
import { createSaveStore, SAVE_KEYS } from '../../game/src/save-store.js';
import { createAdventure, isValidSave } from '../../game/src/engine.js';
import { createProfile, isValidProfile } from '../../game/src/progression.js';
import { isValidSession } from '../../game/src/playtest-session.js';

const protectedKeys = Object.values(SAVE_KEYS);
function twoContexts(t, initial = {}) {
  const records = new Map(Object.entries(initial)), tabs = [];
  function tab(name, { initialReadFailure = null } = {}) {
    const readFailures = new Map(initialReadFailure ? [[initialReadFailure, 1]] : []), writeFailures = new Map(), removeFailures = new Map(), events = [];
    const fail = (failures, key, errorName) => { const remaining = failures.get(key) || 0; if (remaining > 0) { failures.set(key, remaining - 1); throw Object.assign(new Error(`simulated ${errorName}`), { name: errorName }); } };
    const changed = (key, previous, next) => { if (previous !== next) for (const target of tabs) if (target.name !== name) target.events.push({ key, oldValue: previous, newValue: next }); };
    const raw = {
      getItem: t.mock.fn(key => { fail(readFailures, key, 'SecurityError'); return records.get(key) ?? null; }),
      setItem: t.mock.fn((key, value) => { fail(writeFailures, key, 'QuotaExceededError'); const previous = records.get(key) ?? null; records.set(key, String(value)); changed(key, previous, String(value)); }),
      removeItem: t.mock.fn(key => { fail(removeFailures, key, 'SecurityError'); const previous = records.get(key) ?? null; records.delete(key); changed(key, previous, null); }),
    };
    const conflicts = t.mock.fn(), storage = coordinateStorage(createStorageAccess(raw), { keys: protectedKeys, onConflict: conflicts });
    const context = { name, events, raw, storage, conflicts, failRead: (key, count = 1) => readFailures.set(key, count), failWrite: (key, count = 1) => writeFailures.set(key, count), failRemove: (key, count = 1) => removeFailures.set(key, count) };
    tabs.push(context); return context;
  }
  function deliver(context) {
    while (context.events.length) { const event = context.events.shift(); if (protectedKeys.includes(event.key) || event.key === null) context.storage.check(); }
  }
  return { records, tab, deliver };
}
const recording = runId => ({ version: 1, runId, startedAt: 1000, activeMs: 0, actionCount: 0, partial: false, actions: [] });
function saveFixture() {
  const before = createAdventure(419, { runId: 'before-import' }), incoming = createAdventure(420, { runId: 'after-import' });
  return { before, incoming, initial: { [SAVE_KEYS.run]: JSON.stringify(before), [SAVE_KEYS.profile]: JSON.stringify({ ...createProfile(), experience: 10 }), [SAVE_KEYS.sound]: 'on', [SAVE_KEYS.guide]: JSON.stringify({ version: 1, completed: false }), [SAVE_KEYS.session]: JSON.stringify(recording(before.runId)) } };
}
function saves(storage) { return createSaveStore(storage, { validateRun: isValidSave, validateProfile: isValidProfile, validateSession: isValidSession, now: () => 1000 }); }
function importText(save, run) {
  const backup = save.createBackup({ run, profile: createProfile(), sound: false, guide: { version: 1, completed: true }, session: recording(run.runId) });
  assert.equal(backup.ok, true); return backup.text;
}

test('one context can repeatedly write and remove its own protected records without self-conflict', t => {
  const shared = twoContexts(t), a = shared.tab('a');
  for (let i = 0; i < 5; i++) { assert.equal(a.storage.write(SAVE_KEYS.run, `run-${i}`).ok, true); assert.equal(a.storage.write(SAVE_KEYS.session, `session-${i}`).ok, true); assert.equal(a.storage.check().ok, true); }
  assert.equal(a.storage.remove(SAVE_KEYS.run).ok, true); assert.equal(a.storage.write(SAVE_KEYS.run, 'new-run').ok, true);
  assert.equal(shared.records.get(SAVE_KEYS.run), 'new-run'); assert.equal(a.conflicts.mock.callCount(), 0); assert.equal(a.storage.conflicted, false);
});

test('a storage event makes an old context read-only without covering the newer progress', t => {
  const shared = twoContexts(t, { [SAVE_KEYS.run]: 'initial' }), old = shared.tab('old'), active = shared.tab('active');
  assert.equal(active.storage.write(SAVE_KEYS.run, 'new-progress').ok, true); shared.deliver(old);
  assert.equal(old.storage.conflicted, true); assert.equal(old.storage.write(SAVE_KEYS.run, 'stale-progress').error.code, 'storage-conflict');
  assert.equal(old.storage.remove(SAVE_KEYS.run).error.code, 'storage-conflict'); assert.equal(shared.records.get(SAVE_KEYS.run), 'new-progress');
  assert.equal(old.raw.setItem.mock.callCount(), 0); assert.equal(old.raw.removeItem.mock.callCount(), 0);
  assert.equal(old.storage.read(SAVE_KEYS.run).value, 'new-progress');
});

test('write-before-event delivery still detects the new value, including external deletion', t => {
  for (const deletion of [false, true]) {
    const shared = twoContexts(t, { [SAVE_KEYS.run]: 'initial' }), old = shared.tab('old'), active = shared.tab('active');
    assert.equal((deletion ? active.storage.remove(SAVE_KEYS.run) : active.storage.write(SAVE_KEYS.run, 'new-progress')).ok, true);
    assert.ok(old.events.length > 0); assert.equal(old.conflicts.mock.callCount(), 0);
    assert.equal(old.storage.write(SAVE_KEYS.run, 'pagehide-stale').error.code, 'storage-conflict');
    assert.equal(shared.records.get(SAVE_KEYS.run) ?? null, deletion ? null : 'new-progress'); assert.equal(old.raw.setItem.mock.callCount(), 0);
  }
});

test('any changed protected slot guards the whole run while unrelated keys do not lock it', t => {
  const shared = twoContexts(t, { [SAVE_KEYS.run]: 'initial' }), a = shared.tab('a'), b = shared.tab('b');
  assert.equal(b.storage.write('otherKey', 'unrelated preference').ok, true); shared.deliver(a); assert.equal(a.storage.check().ok, true);
  assert.equal(a.storage.write('anotherOtherKey', 'allowed').ok, true); assert.equal(a.storage.write(SAVE_KEYS.run, 'a-progress').ok, true); assert.equal(a.conflicts.mock.callCount(), 0);
  const reopened = shared.tab('reopened'); assert.equal(reopened.storage.write(SAVE_KEYS.profile, 'new profile').ok, true);
  assert.equal(a.storage.write(SAVE_KEYS.session, 'old run timer').error.code, 'storage-conflict'); assert.equal(shared.records.has(SAVE_KEYS.session), false);
});

test('conflict remains latched and invokes its callback exactly once across events, checks and writes', t => {
  const shared = twoContexts(t, { [SAVE_KEYS.run]: 'initial' }), a = shared.tab('a'), b = shared.tab('b');
  b.storage.write(SAVE_KEYS.run, 'new'); shared.deliver(a); a.storage.check(); a.storage.write(SAVE_KEYS.run, 'stale'); a.storage.remove(SAVE_KEYS.profile);
  b.storage.write(SAVE_KEYS.run, 'initial'); shared.deliver(a);
  assert.equal(a.storage.check().error.code, 'storage-conflict'); assert.equal(a.conflicts.mock.callCount(), 1); assert.equal(shared.records.get(SAVE_KEYS.run), 'initial');
  const fresh = shared.tab('fresh'); assert.equal(fresh.storage.write(SAVE_KEYS.run, 'explicit reload').ok, true);
});

test('a failed check read cannot advance the baseline or silently allow a later external overwrite', t => {
  const shared = twoContexts(t, { [SAVE_KEYS.run]: 'initial' }), a = shared.tab('a'), b = shared.tab('b');
  a.failRead(SAVE_KEYS.run); assert.equal(a.storage.write(SAVE_KEYS.run, 'not-written').error.code, 'storage-unavailable'); assert.equal(a.raw.setItem.mock.callCount(), 0); assert.equal(a.storage.conflicted, false);
  assert.equal(b.storage.write(SAVE_KEYS.run, 'external-after-read-error').ok, true);
  assert.equal(a.storage.write(SAVE_KEYS.run, 'stale').error.code, 'storage-conflict'); assert.equal(shared.records.get(SAVE_KEYS.run), 'external-after-read-error');
});

test('an initial baseline read failure preserves write protection instead of omitting that key forever', t => {
  for (const externalChange of [false, true]) {
    const shared = twoContexts(t, { [SAVE_KEYS.run]: 'initial' }), a = shared.tab('a', { initialReadFailure: SAVE_KEYS.run }), b = shared.tab('b');
    if (externalChange) assert.equal(b.storage.write(SAVE_KEYS.run, 'external').ok, true);
    const denied = a.storage.write(SAVE_KEYS.run, 'stale');
    assert.equal(denied.ok, false); assert.equal(denied.error.code, 'storage-unverified');
    assert.equal(a.storage.check().error.code, 'storage-unverified'); assert.equal(a.storage.reason.code, 'storage-unverified'); assert.equal(a.conflicts.mock.callCount(), 1);
    assert.equal(a.raw.setItem.mock.callCount(), 0); assert.equal(shared.records.get(SAVE_KEYS.run), externalChange ? 'external' : 'initial');
  }
});

test('failed writes/removes do not change the baseline or cause a false self-conflict', t => {
  const shared = twoContexts(t, { [SAVE_KEYS.run]: 'initial' }), a = shared.tab('a');
  a.failWrite(SAVE_KEYS.run); assert.equal(a.storage.write(SAVE_KEYS.run, 'failed').error.code, 'storage-full');
  assert.equal(shared.records.get(SAVE_KEYS.run), 'initial'); assert.equal(a.storage.check().ok, true);
  assert.equal(a.storage.write(SAVE_KEYS.run, 'successful retry').ok, true);
  a.failRemove(SAVE_KEYS.run); assert.equal(a.storage.remove(SAVE_KEYS.run).error.code, 'storage-unavailable'); assert.equal(a.storage.check().ok, true);
  assert.equal(a.storage.remove(SAVE_KEYS.run).ok, true); assert.equal(a.conflicts.mock.callCount(), 0);
});

test('a real five-slot backup import updates its own baseline after every committed write', t => {
  const f = saveFixture(), shared = twoContexts(t, f.initial), a = shared.tab('a'), b = shared.tab('b'), save = saves(a.storage), text = importText(save, f.incoming);
  assert.equal(save.importBackup(text).ok, true); assert.equal(a.storage.check().ok, true); assert.equal(a.conflicts.mock.callCount(), 0);
  assert.deepEqual(a.raw.setItem.mock.calls.map(call => call.arguments[0]), ['ghost-ledger.before-import.v1', ...protectedKeys]);
  assert.equal(JSON.parse(shared.records.get(SAVE_KEYS.run)).runId, f.incoming.runId); assert.equal(shared.records.get(SAVE_KEYS.sound), 'off'); assert.equal(JSON.parse(shared.records.get(SAVE_KEYS.guide)).completed, true);
  assert.equal(a.storage.write(SAVE_KEYS.session, JSON.stringify({ ...recording(f.incoming.runId), activeMs: 100 })).ok, true);
  shared.deliver(b); assert.equal(b.storage.conflicted, true); assert.equal(b.conflicts.mock.callCount(), 1);
});

test('an import rollback restores all five slots and the local baseline without false conflicts', t => {
  const f = saveFixture(), shared = twoContexts(t, f.initial), a = shared.tab('a'), b = shared.tab('b'), save = saves(a.storage), text = importText(save, f.incoming);
  a.failWrite(SAVE_KEYS.session); const result = save.importBackup(text);
  assert.equal(result.error.code, 'import-write-failed'); assert.match(result.error.message, /已恢复/);
  for (const [key, value] of Object.entries(f.initial)) assert.equal(shared.records.get(key), value, key);
  assert.equal(a.storage.check().ok, true); assert.equal(a.conflicts.mock.callCount(), 0);
  shared.deliver(b); assert.equal(b.storage.check().ok, true); assert.equal(b.conflicts.mock.callCount(), 0);
  assert.equal(a.storage.write(SAVE_KEYS.session, JSON.stringify({ ...recording(f.before.runId), activeMs: 200 })).ok, true);
});

test('a conflicting page cannot start an import or create an archive over another page', t => {
  const f = saveFixture(), shared = twoContexts(t, f.initial), a = shared.tab('a'), b = shared.tab('b'), save = saves(a.storage), text = importText(save, f.incoming);
  assert.equal(b.storage.write(SAVE_KEYS.run, JSON.stringify(f.incoming)).ok, true);
  const result = save.importBackup(text);
  assert.equal(result.ok, false); assert.equal(result.error.code, 'storage-conflict'); assert.equal(a.raw.setItem.mock.callCount(), 0);
  assert.equal(shared.records.has('ghost-ledger.before-import.v1'), false); assert.equal(JSON.parse(shared.records.get(SAVE_KEYS.run)).runId, f.incoming.runId);
});
