import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdventure, isValidSave } from '../../game/src/engine.js';
import { createProfile, isValidProfile, settleRun } from '../../game/src/progression.js';
import { createSaveStore, collectRunAssets, SAVE_KEYS } from '../../game/src/save-store.js';
import { assertPlatform, PLATFORM_IDS } from '../../game/src/platform/contract.js';
import { createStorageAccess, createWebPlatform } from '../../game/src/platform/web.js';
import { createWeChatPlatform } from '../../game/src/platform/wechat.js';
import { createSessionTracker, isValidSession, buildPlaytestReport, durationText } from '../../game/src/playtest-session.js';
import { GUIDE_STEPS, validGuide } from '../../game/src/onboarding.js';

function memory(t, initial = {}) {
  const records = new Map(Object.entries(initial)), calls = [], rules = [];
  function operation(method, key, value) {
    calls.push({ method, key, value });
    const rule = rules.find(rule => rule.method === method && rule.key === key && ++rule.seen === rule.at);
    if (rule) throw Object.assign(new Error('simulated storage failure'), { name: rule.name });
    if (method === 'getItem') return records.get(key) ?? null;
    if (method === 'setItem') records.set(key, String(value));
    if (method === 'removeItem') records.delete(key);
  }
  const backend = Object.fromEntries(['getItem', 'setItem', 'removeItem'].map(method => [method, t.mock.fn((key, value) => operation(method, key, value))]));
  return { records, backend, storage: createStorageAccess(backend), calls, fail(method, key, { at = 1, name = 'SecurityError' } = {}) { rules.push({ method, key, at, seen: 0, name }); }, writes: () => calls.filter(call => call.method !== 'getItem') };
}
const run = (id = 'save-regression', seed = 419) => createAdventure(seed, { runId: id });
function session(runId = 'save-regression') {
  const tracker = createSessionTracker({ now: () => 1000, monotonic: () => 0 });
  tracker.sync({ runId, phase: 'map', route: { completedIds: [] } }, false);
  return tracker.snapshot();
}
function store(storage, options = {}) {
  return createSaveStore(storage, { validateRun: isValidSave, validateProfile: isValidProfile, validateSession: isValidSession, now: () => 1000, ...options });
}
function backup(save, state = run('incoming')) {
  const result = save.createBackup({ run: state, profile: createProfile(), sound: false, guide: { version: 1, completed: true }, session: session(state.runId) });
  assert.equal(result.ok, true); return result.text;
}
const stored = state => ({ [SAVE_KEYS.run]: JSON.stringify(state), [SAVE_KEYS.profile]: JSON.stringify(createProfile()), [SAVE_KEYS.sound]: 'on', [SAVE_KEYS.guide]: JSON.stringify({ version: 1, completed: false }), [SAVE_KEYS.session]: JSON.stringify(session(state.runId)) });

test('storage adapters surface unavailable storage, security errors and quota errors without throwing', t => {
  for (const operation of ['read', 'write', 'remove']) assert.equal(createStorageAccess(null)[operation]('x', 'value').error.code, 'storage-unavailable');
  const mem = memory(t);
  mem.fail('getItem', 'blocked'); mem.fail('removeItem', 'blocked'); mem.fail('setItem', 'full', { name: 'QuotaExceededError' });
  assert.equal(mem.storage.read('blocked').error.code, 'storage-unavailable');
  assert.equal(mem.storage.remove('blocked').error.code, 'storage-unavailable');
  assert.equal(mem.storage.write('full', 'value').error.code, 'storage-full');
  assert.equal(mem.storage.write('number', 123).ok, true); assert.equal(mem.records.get('number'), '123');
});

test('a corrupted current run/profile falls back to valid backups while preserving raw records', t => {
  const previousRun = run(), previousProfile = createProfile(); previousProfile.experience = 10;
  const mem = memory(t, { [SAVE_KEYS.run]: '{broken', [`${SAVE_KEYS.run}.previous`]: JSON.stringify(previousRun), [SAVE_KEYS.profile]: '{broken profile', [`${SAVE_KEYS.profile}.previous`]: JSON.stringify(previousProfile) });
  const loaded = store(mem.storage).load();
  assert.deepEqual(loaded.run, previousRun); assert.deepEqual(loaded.profile, previousProfile);
  assert.equal(loaded.notices.length, 2); assert.ok(loaded.notices.every(text => /恢复/.test(text)));
  assert.equal(mem.records.get(SAVE_KEYS.run), '{broken'); assert.equal(mem.writes().length, 0);
});

test('invalid backup schemas and inaccessible storage become explicit notices rather than fresh overwrites', t => {
  const mem = memory(t, { [SAVE_KEYS.run]: 'invalid', [`${SAVE_KEYS.run}.previous`]: JSON.stringify({ version: 4 }), [SAVE_KEYS.profile]: 'invalid', [`${SAVE_KEYS.profile}.previous`]: '[]' });
  const loaded = store(mem.storage).load();
  assert.equal(loaded.run, null); assert.equal(loaded.profile, null); assert.equal(loaded.notices.length, 2); assert.equal(mem.writes().length, 0);
  const blocked = store(createStorageAccess(null)).load();
  assert.equal(blocked.run, null); assert.equal(blocked.profile, null); assert.equal(blocked.notices.length, 2);
});

test('legacy saves are retained and explained without loading an older runtime', t => {
  const legacy = JSON.stringify({ version: 4, ruleset: 'config-v1', hp: 80 });
  const mem = memory(t, { 'ghost-ledger.run.v4': legacy });
  const loaded = store(mem.storage).load();
  assert.equal(loaded.run, null); assert.match(loaded.notices.join(''), /旧版/); assert.equal(mem.records.get('ghost-ledger.run.v4'), legacy); assert.equal(mem.writes().length, 0);
});

test('saving backs up the last valid value and quarantines invalid raw values', t => {
  const old = run('old'), next = run('next', 420), mem = memory(t, { [SAVE_KEYS.run]: JSON.stringify(old) }), save = store(mem.storage);
  assert.equal(save.saveJson(SAVE_KEYS.run, next).ok, true);
  assert.deepEqual(JSON.parse(mem.records.get(`${SAVE_KEYS.run}.previous`)), old);
  assert.deepEqual(JSON.parse(mem.records.get(SAVE_KEYS.run)), next);
  mem.records.set(SAVE_KEYS.run, '{unreadable raw');
  assert.equal(save.saveJson(SAVE_KEYS.run, old).ok, true);
  assert.equal(mem.records.get(`${SAVE_KEYS.run}.rejected`), '{unreadable raw');
});

test('invalid saves and failed backup writes cannot overwrite the current run', t => {
  const old = run('original'), mem = memory(t, { [SAVE_KEYS.run]: JSON.stringify(old) }), save = store(mem.storage);
  assert.equal(save.saveJson(SAVE_KEYS.run, { version: 4 }).ok, false); assert.equal(mem.writes().length, 0);
  mem.fail('setItem', `${SAVE_KEYS.run}.previous`, { name: 'QuotaExceededError' });
  assert.equal(save.saveJson(SAVE_KEYS.run, run('replacement')).error.code, 'storage-full');
  assert.deepEqual(JSON.parse(mem.records.get(SAVE_KEYS.run)), old);
  assert.equal(save.saveJson('unrecognized', {}).error.code, 'unknown-save-key');
});

test('session saves use the supplied session validator before writing', t => {
  const mem = memory(t), save = store(mem.storage);
  const result = save.saveJson(SAVE_KEYS.session, { version: 99, runId: 'malformed' });
  assert.equal(result.ok, false); assert.equal(mem.writes().length, 0);
  const valid = session(); assert.equal(save.saveJson(SAVE_KEYS.session, valid).ok, true);
});

test('a backup round-trip preserves a valid run/profile/preferences/session and archives prior raw records', t => {
  const initialRun = run('before'), mem = memory(t, stored(initialRun)), save = store(mem.storage), incoming = run('incoming', 420);
  const text = backup(save, incoming), checked = save.inspectBackup(text);
  assert.equal(checked.ok, true); assert.equal(mem.writes().length, 0);
  const result = save.importBackup(text);
  assert.equal(result.ok, true); assert.deepEqual(JSON.parse(mem.records.get(SAVE_KEYS.run)), incoming);
  assert.equal(mem.records.get(SAVE_KEYS.sound), 'off'); assert.equal(JSON.parse(mem.records.get(SAVE_KEYS.session)).runId, 'incoming');
  const archive = JSON.parse(mem.records.get('ghost-ledger.before-import.v1'));
  assert.equal(archive.savedAt, 1000); assert.equal(archive.records[SAVE_KEYS.run], JSON.stringify(initialRun));
});

test('backup inspection rejects JSON abuse, old formats and invalid preferences before any storage writes', t => {
  const mem = memory(t, stored(run('before'))), save = store(mem.storage), good = JSON.parse(backup(save));
  const cases = [
    ['not-json', 'invalid-json'], ['{"__proto__":{"polluted":true}}', 'invalid-json'],
    [JSON.stringify({ ...good, version: 0 }), 'unsupported-backup'],
    [JSON.stringify({ ...good, runtime: { version: 4, ruleset: 'config-v1' } }), 'unsupported-backup'],
    [JSON.stringify({ ...good, data: { ...good.data, run: { version: 4 } } }), 'unsupported-run'],
    [JSON.stringify({ ...good, data: { ...good.data, profile: {} } }), 'invalid-profile'],
    [JSON.stringify({ ...good, data: { ...good.data, sound: 'on' } }), 'invalid-profile'],
    [JSON.stringify({ ...good, data: { ...good.data, guide: { version: 9, completed: true } } }), 'invalid-preferences'],
    [JSON.stringify({ ...good, data: { ...good.data, session: { ...good.data.session, runId: 'other-run' } } }), 'invalid-session'],
    [JSON.stringify({ ...good, data: { ...good.data, run: null, session: good.data.session } }), 'invalid-session'],
    ['x'.repeat(4 * 1024 * 1024 + 1), 'backup-too-large'],
  ];
  const before = new Map(mem.records);
  for (const [text, code] of cases) { const result = save.importBackup(text); assert.equal(result.ok, false); assert.equal(result.error.code, code); }
  assert.deepEqual(mem.records, before); assert.equal(mem.writes().length, 0); assert.equal({}.polluted, undefined);
});

test('missing runtime art refuses both restore and import before mutating the current slot', t => {
  const state = run(), names = collectRunAssets(state); assert.ok(names.length > 100);
  const mem = memory(t, stored(state)), accepted = store(mem.storage), text = backup(accepted, state), denied = store(mem.storage, { hasAsset: name => name !== names[0] });
  assert.equal(denied.load().run, null); assert.equal(denied.inspectBackup(text).error.code, 'unsupported-run');
  assert.equal(denied.importBackup(text).error.code, 'unsupported-run'); assert.equal(mem.writes().length, 0);
  assert.equal(mem.records.get(SAVE_KEYS.run), JSON.stringify(state));
});

test('an import write failure rolls back every touched primary key and retains a recovery archive', t => {
  const initial = stored(run('before'));
  initial[SAVE_KEYS.profile] = JSON.stringify({ ...createProfile(), experience: 10 });
  const mem = memory(t, initial), save = store(mem.storage), text = backup(save);
  mem.fail('setItem', SAVE_KEYS.session, { name: 'QuotaExceededError' });
  const result = save.importBackup(text);
  assert.equal(result.error.code, 'import-write-failed'); assert.match(result.error.message, /已恢复/);
  for (const [key, value] of Object.entries(initial)) assert.equal(mem.records.get(key), value, key);
  assert.equal(JSON.parse(mem.records.get('ghost-ledger.before-import.v1')).records[SAVE_KEYS.run], initial[SAVE_KEYS.run]);
});

test('rollback restores deleted records and removes newly created slots that were originally absent', t => {
  const initial = stored(run('before')), deleting = memory(t, initial), save = store(deleting.storage);
  const empty = save.createBackup({ run: null, profile: createProfile(), sound: false, guide: null, session: null });
  deleting.fail('removeItem', SAVE_KEYS.guide);
  assert.equal(save.importBackup(empty.text).error.code, 'import-write-failed');
  for (const [key, value] of Object.entries(initial)) assert.equal(deleting.records.get(key), value, key);
  const absent = memory(t, { [SAVE_KEYS.profile]: JSON.stringify(createProfile()), [SAVE_KEYS.sound]: 'on' }), importing = store(absent.storage), text = backup(importing);
  absent.fail('setItem', SAVE_KEYS.sound);
  assert.equal(importing.importBackup(text).error.code, 'import-write-failed');
  assert.equal(absent.records.has(SAVE_KEYS.run), false); assert.equal(absent.records.has(SAVE_KEYS.guide), false); assert.equal(absent.records.has(SAVE_KEYS.session), false);
  assert.equal(absent.records.get(SAVE_KEYS.sound), 'on');
});

test('read/archive failures stop before primary writes and a rollback failure remains explicitly recoverable', t => {
  for (const target of ['read', 'archive']) {
    const initial = stored(run('before')), mem = memory(t, initial), save = store(mem.storage), text = backup(save);
    mem.fail(target === 'read' ? 'getItem' : 'setItem', target === 'read' ? SAVE_KEYS.profile : 'ghost-ledger.before-import.v1');
    assert.equal(save.importBackup(text).ok, false);
    for (const [key, value] of Object.entries(initial)) assert.equal(mem.records.get(key), value);
    assert.ok(mem.writes().every(call => call.key === 'ghost-ledger.before-import.v1'));
  }
  const initial = stored(run('before'));
  initial[SAVE_KEYS.profile] = JSON.stringify({ ...createProfile(), experience: 10 });
  const mem = memory(t, initial), save = store(mem.storage), text = backup(save);
  mem.fail('setItem', SAVE_KEYS.sound); mem.fail('setItem', SAVE_KEYS.profile, { at: 2 });
  const result = save.importBackup(text);
  assert.equal(result.error.code, 'import-write-failed'); assert.match(result.error.message, /保持页面打开/);
  assert.equal(JSON.parse(mem.records.get(SAVE_KEYS.profile)).experience, 0);
  assert.equal(JSON.parse(mem.records.get('ghost-ledger.before-import.v1')).records[SAVE_KEYS.run], initial[SAVE_KEYS.run]);
});

test('importing null optional state removes run/guide/session while preserving the account profile', t => {
  const mem = memory(t, stored(run())), save = store(mem.storage);
  const empty = save.createBackup({ run: null, profile: createProfile(), sound: true, guide: null, session: null });
  assert.equal(empty.ok, true); assert.equal(save.importBackup(empty.text).ok, true);
  for (const key of [SAVE_KEYS.run, SAVE_KEYS.guide, SAVE_KEYS.session]) assert.equal(mem.records.has(key), false);
  assert.equal(isValidProfile(JSON.parse(mem.records.get(SAVE_KEYS.profile))), true); assert.equal(mem.records.get(SAVE_KEYS.sound), 'on');
  assert.equal(save.createBackup({ run: null, profile: createProfile(), session: session('orphan') }).error.code, 'invalid-session');
});

function replacementFixture(t) {
  const current = run('replacement-original'), profile = createProfile(), next = run('replacement-next', 420);
  const settled = settleRun(profile, current, { abandoned: true, session: session(current.runId) }).profile;
  const initial = { ...stored(current), [SAVE_KEYS.run]: `\n${JSON.stringify(current, null, 2)}\n`, [SAVE_KEYS.profile]: ` ${JSON.stringify(profile)}\n`, [SAVE_KEYS.session]: `\n${JSON.stringify(session(current.runId))} ` };
  const mem = memory(t, initial), save = store(mem.storage);
  return { current, profile, next, settled, initial, mem, save };
}
function unchangedPrimary(f) {
  for (const [key, text] of Object.entries(f.initial)) assert.equal(f.mem.records.get(key), text, key);
  const profile = JSON.parse(f.mem.records.get(SAVE_KEYS.profile));
  assert.equal(profile.totalRuns, 0); assert.equal(profile.settledRunIds.includes(f.current.runId), false);
  assert.equal(f.save.load().run.runId, f.current.runId);
}

test('switch failures at each of the three slots restore exact original text without leaving a settled profile', t => {
  for (const key of [SAVE_KEYS.profile, SAVE_KEYS.run, SAVE_KEYS.session]) {
    const f = replacementFixture(t); f.mem.fail('setItem', key, { name: 'QuotaExceededError' });
    const result = f.save.replaceProgress({ run: f.next, profile: f.settled, session: session(f.next.runId) });
    assert.equal(result.error.code, 'replacement-write-failed'); assert.match(result.error.message, /已恢复/); unchangedPrimary(f);
    const archive = JSON.parse(f.mem.records.get('ghost-ledger.before-replacement.v1'));
    assert.equal(archive.records[SAVE_KEYS.run], f.initial[SAVE_KEYS.run]); assert.equal(archive.records[SAVE_KEYS.profile], f.initial[SAVE_KEYS.profile]); assert.equal(archive.records[SAVE_KEYS.session], f.initial[SAVE_KEYS.session]);
  }
});

test('abandon failures on profile write or run/session removal restore all three original slots', t => {
  for (const [method, key] of [['setItem', SAVE_KEYS.profile], ['removeItem', SAVE_KEYS.run], ['removeItem', SAVE_KEYS.session]]) {
    const f = replacementFixture(t); f.mem.fail(method, key);
    const result = f.save.replaceProgress({ run: null, profile: f.settled, session: null });
    assert.equal(result.error.code, 'replacement-write-failed'); assert.match(result.error.message, /已恢复/); unchangedPrimary(f);
    assert.equal(JSON.parse(f.mem.records.get('ghost-ledger.before-replacement.v1')).records[SAVE_KEYS.run], f.initial[SAVE_KEYS.run]);
  }
});

test('successful replacement commits settlement, the new run and its matching session together', t => {
  const f = replacementFixture(t), recording = session(f.next.runId), input = JSON.stringify({ run: f.next, profile: f.settled, session: recording });
  assert.equal(f.save.replaceProgress({ run: f.next, profile: f.settled, session: recording }).ok, true);
  const loaded = f.save.load(); assert.equal(loaded.run.runId, f.next.runId); assert.equal(loaded.profile.totalRuns, 1); assert.ok(loaded.profile.settledRunIds.includes(f.current.runId));
  assert.equal(loaded.profile.settledRunIds.includes(f.next.runId), false); assert.equal(JSON.parse(f.mem.records.get(SAVE_KEYS.session)).runId, f.next.runId);
  assert.equal(f.mem.records.get(SAVE_KEYS.sound), f.initial[SAVE_KEYS.sound]); assert.equal(f.mem.records.get(SAVE_KEYS.guide), f.initial[SAVE_KEYS.guide]);
  assert.equal(JSON.stringify({ run: f.next, profile: f.settled, session: recording }), input);
  assert.equal(JSON.parse(f.save.rawRecords()['ghost-ledger.before-replacement.v1']).records[SAVE_KEYS.run], f.initial[SAVE_KEYS.run]);
});

test('successful abandon commits settlement and removes both current run and session', t => {
  const f = replacementFixture(t);
  assert.equal(f.save.replaceProgress({ run: null, profile: f.settled, session: null }).ok, true);
  assert.equal(f.mem.records.has(SAVE_KEYS.run), false); assert.equal(f.mem.records.has(SAVE_KEYS.session), false);
  const loaded = f.save.load(); assert.equal(loaded.run, null); assert.equal(loaded.profile.totalRuns, 1); assert.equal(loaded.profile.history[0].cause, 'abandoned');
  assert.ok(loaded.profile.settledRunIds.includes(f.current.runId)); assert.equal(f.mem.records.get(SAVE_KEYS.sound), f.initial[SAVE_KEYS.sound]);
});

test('replacement read/archive failures stop before primary writes and initially absent slots remain absent after rollback', t => {
  for (const key of [SAVE_KEYS.profile, SAVE_KEYS.run, SAVE_KEYS.session, 'ghost-ledger.before-replacement.v1']) {
    const f = replacementFixture(t); f.mem.fail(key === 'ghost-ledger.before-replacement.v1' ? 'setItem' : 'getItem', key);
    assert.equal(f.save.replaceProgress({ run: f.next, profile: f.settled, session: session(f.next.runId) }).ok, false); unchangedPrimary(f);
    assert.ok(f.mem.writes().every(call => call.key === 'ghost-ledger.before-replacement.v1'));
  }
  const mem = memory(t), save = store(mem.storage), next = run('empty-storage-next'); mem.fail('setItem', SAVE_KEYS.session);
  assert.equal(save.replaceProgress({ run: next, profile: createProfile(), session: session(next.runId) }).error.code, 'replacement-write-failed');
  for (const key of [SAVE_KEYS.profile, SAVE_KEYS.run, SAVE_KEYS.session]) assert.equal(mem.records.has(key), false);
});

test('repeated replacements and imports export both recovery archives without recursively nesting either archive', t => {
  const f = replacementFixture(t);
  assert.equal(f.save.replaceProgress({ run: f.next, profile: f.settled, session: session(f.next.runId) }).ok, true);
  const nextProfile = settleRun(f.settled, f.next, { abandoned: true }).profile, third = run('replacement-third', 421);
  assert.equal(f.save.replaceProgress({ run: third, profile: nextProfile, session: session(third.runId) }).ok, true);
  assert.equal(JSON.parse(f.mem.records.get('ghost-ledger.before-replacement.v1')).records[SAVE_KEYS.run], JSON.stringify(f.next));
  const imported = run('import-after-replacements', 422); assert.equal(f.save.importBackup(backup(f.save, imported)).ok, true);
  const finalProfile = settleRun(createProfile(), imported, { abandoned: true }).profile;
  assert.equal(f.save.replaceProgress({ run: null, profile: finalProfile, session: null }).ok, true);
  const raw = f.save.rawRecords();
  for (const key of ['ghost-ledger.before-replacement.v1', 'ghost-ledger.before-import.v1']) {
    assert.equal(typeof raw[key], 'string'); const archive = JSON.parse(raw[key]);
    assert.equal(archive.records['ghost-ledger.before-replacement.v1'], undefined); assert.equal(archive.records['ghost-ledger.before-import.v1'], undefined);
  }
});

test('an already settled active run is rejected on backup/import/replacement and cannot resume, with its raw slot preserved', t => {
  const f = replacementFixture(t), good = JSON.parse(backup(f.save, f.current)); good.data.profile = f.settled;
  const text = JSON.stringify(good);
  assert.equal(f.save.inspectBackup(text).error.code, 'settled-active-run'); assert.equal(f.save.importBackup(text).error.code, 'settled-active-run');
  assert.equal(f.save.createBackup({ run: f.current, profile: f.settled, session: session(f.current.runId) }).error.code, 'settled-active-run');
  assert.equal(f.save.replaceProgress({ run: f.current, profile: f.settled, session: session(f.current.runId) }).error.code, 'settled-active-run'); assert.equal(f.mem.writes().length, 0);
  f.mem.records.set(SAVE_KEYS.profile, JSON.stringify(f.settled)); const loaded = f.save.load();
  assert.equal(loaded.run, null); assert.ok(loaded.profile.settledRunIds.includes(f.current.runId)); assert.match(loaded.notices.join(''), /已结算/);
  assert.equal(f.save.rawRecords()[SAVE_KEYS.run], f.initial[SAVE_KEYS.run]); assert.equal(f.mem.writes().length, 0);
});

function webHost(t, { backend = memory(t).backend, audio = false } = {}) {
  const host = new EventTarget(), document = new EventTarget(), nodes = [], timers = [], urls = [];
  document.hidden = false; document.body = { append: node => nodes.push(node) };
  document.createElement = tag => { const node = new EventTarget(); Object.assign(node, { tag, files: [], removed: false, click: t.mock.fn(), remove: t.mock.fn(() => { node.removed = true; }) }); return node; };
  Object.assign(host, { document, localStorage: backend, performance: { now: () => 123.5 }, Blob, URL: { createObjectURL: t.mock.fn(() => 'blob:mock-backup'), revokeObjectURL: t.mock.fn(url => urls.push(url)) }, setTimeout: fn => { timers.push(fn); return timers.length; } });
  let context;
  if (audio) host.AudioContext = class {
    constructor() { context = this; this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    suspend = t.mock.fn(async () => { this.state = 'suspended'; }); resume = t.mock.fn(async () => { this.state = 'running'; });
    createOscillator() { return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: gain => gain, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  };
  return { host, document, nodes, timers, urls, context: () => context, emit: (target, type) => target.dispatchEvent(new Event(type)), flushTimers: () => { while (timers.length) timers.shift()(); } };
}

test('the platform contract requires each service and DOM targets stay distinct from deferred WeChat rendering', t => {
  assert.deepEqual(PLATFORM_IDS, ['web', 'windows', 'android', 'wechat']);
  const f = webHost(t);
  for (const target of ['web', 'windows', 'android']) assert.equal(assertPlatform(createWebPlatform({ host: f.host, target })).id, target);
  assert.throws(() => createWebPlatform({ host: f.host, target: 'wechat' }), /WebView/);
  assert.throws(() => createWebPlatform({ host: null }), /WebView/);
  const platform = createWebPlatform({ host: f.host });
  for (const [service, method] of [['storage', 'read'], ['files', 'download'], ['audio', 'pause'], ['lifecycle', 'subscribe'], ['clock', 'monotonic']]) assert.throws(() => assertPlatform({ ...platform, [service]: { ...platform[service], [method]: null } }), new RegExp(`${service}\\.${method}`));
  assert.equal(platform.clock.monotonic(), 123.5); assert.deepEqual(platform.input.point({ clientX: 20, clientY: 30 }), { x: 20, y: 30 });
});

test('blocked browser storage is a supported degraded platform rather than a startup exception', t => {
  const f = webHost(t); Object.defineProperty(f.host, 'localStorage', { get() { throw new Error('privacy mode'); } });
  const platform = createWebPlatform({ host: f.host });
  assert.equal(platform.capabilities.storage, false); assert.equal(platform.storage.read('x').error.code, 'storage-unavailable');
  assert.equal(platform.audio.tone(440).error.code, 'audio-unavailable'); platform.audio.setEnabled(false); assert.equal(platform.audio.tone(440).skipped, true);
});

test('browser lifecycle deduplicates visibility/focus events, pauses audio and unsubscribes cleanly', t => {
  const f = webHost(t, { audio: true }), platform = createWebPlatform({ host: f.host }), events = [], unsubscribe = platform.lifecycle.subscribe(event => events.push(event));
  assert.equal(platform.audio.tone(440).ok, true);
  f.emit(f.host, 'blur'); f.document.hidden = true; f.emit(f.document, 'visibilitychange'); f.emit(f.host, 'pagehide');
  assert.deepEqual(events, [{ type: 'pause', reason: 'blur' }]); assert.equal(f.context().suspend.mock.callCount(), 1);
  f.document.hidden = false; f.emit(f.document, 'visibilitychange'); f.emit(f.host, 'pageshow'); f.emit(f.host, 'focus');
  assert.deepEqual(events[1], { type: 'resume', reason: 'visibility' }); assert.equal(events.length, 2); assert.equal(f.context().resume.mock.callCount(), 1);
  unsubscribe(); f.emit(f.host, 'blur'); assert.equal(events.length, 2);
});

test('file import handles selection, size limits, read errors and cancellation without touching storage', async t => {
  for (const scenario of ['valid', 'large', 'unreadable', 'cancel', 'focus-cancel']) {
    const mem = memory(t), f = webHost(t, { backend: mem.backend }), platform = createWebPlatform({ host: f.host }), result = platform.files.pickText({ maxBytes: 10 }), input = f.nodes.at(-1);
    if (scenario === 'cancel') f.emit(input, 'cancel');
    else if (scenario === 'focus-cancel') { f.emit(f.host, 'focus'); f.flushTimers(); }
    else { input.files = [{ name: 'backup.json', size: scenario === 'large' ? 11 : 2, text: t.mock.fn(async () => { if (scenario === 'unreadable') throw new Error('read failed'); return '{}'; }) }]; f.emit(input, 'change'); }
    const value = await result;
    if (scenario === 'valid') assert.deepEqual(value, { ok: true, text: '{}', name: 'backup.json' });
    else if (scenario === 'large') { assert.equal(value.error.code, 'file-too-large'); assert.equal(input.files[0].text.mock.callCount(), 0); }
    else if (scenario === 'unreadable') assert.equal(value.error.code, 'file-unreadable');
    else assert.equal(value.cancelled, true);
    assert.equal(input.removed, true); assert.equal(mem.writes().length, 0);
  }
});

test('backup download sanitizes the filename and releases its temporary object URL', t => {
  const f = webHost(t), platform = createWebPlatform({ host: f.host });
  assert.equal(platform.files.download('{}', '../bad\\name\n.json').ok, true);
  const anchor = f.nodes.at(-1); assert.equal(anchor.href, 'blob:mock-backup'); assert.doesNotMatch(anchor.download, /[\\/\u0000-\u001f]/); assert.equal(anchor.removed, true);
  f.flushTimers(); assert.deepEqual(f.urls, ['blob:mock-backup']);
  f.host.URL.createObjectURL = () => { throw new Error('not supported'); };
  assert.equal(platform.files.download('{}', 'backup.json').error.code, 'download-unavailable');
});

test('WeChat adapter exposes storage/lifecycle contracts while explicitly marking rendering and files unfinished', async t => {
  const values = new Map(), hide = new Set(), show = new Set();
  const wxApi = { getStorageSync: t.mock.fn(key => values.get(key) ?? ''), setStorageSync: t.mock.fn((key, value) => values.set(key, value)), removeStorageSync: t.mock.fn(key => values.delete(key)), onHide: fn => hide.add(fn), onShow: fn => show.add(fn), offHide: fn => hide.delete(fn), offShow: fn => show.delete(fn) };
  assert.throws(() => createWeChatPlatform({ wxApi: null }), /wx/);
  const platform = createWeChatPlatform({ wxApi }), events = [], off = platform.lifecycle.subscribe(event => events.push(event));
  assert.equal(platform.id, 'wechat'); assert.equal(platform.capabilities.rendererReady, false); assert.equal(platform.capabilities.renderer, 'canvas-required');
  assert.equal(platform.storage.read('missing').value, null); platform.storage.write('value', 123); assert.equal(platform.storage.read('value').value, '123'); platform.storage.remove('value'); assert.equal(values.has('value'), false);
  for (const fn of hide) fn(); for (const fn of show) fn(); assert.deepEqual(events.map(event => event.type), ['pause', 'resume']); off(); assert.equal(hide.size + show.size, 0);
  assert.equal(platform.files.download('{}', 'backup.json').error.code, 'capability-not-integrated'); assert.equal((await platform.files.pickText()).error.code, 'capability-not-integrated');
  assert.equal(platform.audio.tone(440).error.code, 'capability-not-integrated');
  assert.deepEqual(platform.input.point({ touches: [{ x: 5, y: 6 }] }), { x: 5, y: 6 }); assert.deepEqual(platform.input.point({ changedTouches: [{ clientX: 7, clientY: 8 }] }), { x: 7, y: 8 });
  wxApi.getStorageSync = () => { throw new Error('storage denied'); }; assert.equal(platform.storage.read('x').error.code, 'storage-unavailable');
});

test('session timing counts active gameplay only across pause, resume and terminal phases', () => {
  let tick = 0;
  const tracker = createSessionTracker({ now: () => 1000, monotonic: () => tick }), state = { runId: 'timed', phase: 'map', route: { completedIds: [] } };
  assert.equal(tracker.snapshot(), null); tracker.sync(state, true); tick += 1200; assert.equal(tracker.snapshot().activeMs, 1200);
  tracker.sync(state, false); tick += 5000; assert.equal(tracker.snapshot().activeMs, 1200);
  tracker.sync(state, true); tick += 800; tracker.sync({ ...state, phase: 'victory' }, true); tick += 9000;
  assert.equal(tracker.snapshot().activeMs, 2000); assert.equal(tracker.snapshot().partial, false);
});

test('restored sessions exclude closed-page time and snapshots/replace do not share mutable state', () => {
  let tick = 10000;
  const initial = { ...session('restored'), activeMs: 500 }, tracker = createSessionTracker({ initial, now: () => 1000, monotonic: () => tick });
  initial.activeMs = 9999; assert.equal(tracker.snapshot().activeMs, 500);
  const state = { runId: 'restored', phase: 'combat', turn: 1 }; tracker.sync(state, true); tick += 250; const snapshot = tracker.snapshot();
  assert.equal(snapshot.activeMs, 750); snapshot.actions.push({ corrupted: true }); assert.equal(tracker.snapshot().actions.length, 0);
  tracker.replace({ ...session('other'), activeMs: 25 }); tick += 3000; assert.equal(tracker.snapshot().activeMs, 25);
  tracker.replace({ version: 99 }); assert.equal(tracker.snapshot(), null);
});

test('action records keep primitive replay inputs, outcomes and bounded history with explicit partial status', () => {
  const tracker = createSessionTracker({ now: () => 1000, monotonic: () => 0 }), before = { runId: 'actions', phase: 'combat', turn: 3 }, after = { phase: 'combat', lastEvent: { kind: 'cardPlayed' } };
  const action = { type: 'play', cardId: 'card-1', targetUid: 'enemy-1', optional: null, nested: { secret: true }, callback() {} };
  tracker.record(action, before, after); action.targetUid = 'modified';
  const saved = tracker.snapshot(); assert.equal(saved.partial, true); assert.equal(saved.actionCount, 1); assert.deepEqual(saved.actions[0].action, { type: 'play', cardId: 'card-1', targetUid: 'enemy-1', optional: null });
  assert.equal(saved.actions[0].result, 'cardPlayed'); assert.equal(saved.actions[0].phase, 'combat'); assert.equal(saved.actions[0].turn, 3);
  tracker.record({ type: 'openSettings' }, before, after); assert.equal(tracker.snapshot().actionCount, 1);
  for (let i = 0; i < 2001; i++) tracker.record({ type: 'endTurn' }, before, after);
  const bounded = tracker.snapshot(); assert.equal(bounded.actionCount, 2002); assert.equal(bounded.actions.length, 2000); assert.equal(bounded.actions[0].n, 3); assert.equal(bounded.partial, true); assert.equal(isValidSession(bounded), true);
});

test('new/resumed map sessions distinguish full and partial records and validate malformed imports', () => {
  const tracker = createSessionTracker({ now: () => 1000 });
  tracker.sync({ runId: 'new', phase: 'map', route: { completedIds: [] } }, false); assert.equal(tracker.snapshot().partial, false);
  tracker.sync({ runId: 'continued', phase: 'map', route: { completedIds: ['floor-1'] } }, false); assert.equal(tracker.snapshot().partial, true); assert.equal(tracker.snapshot().actionCount, 0);
  const good = session();
  for (const invalid of [null, [], { ...good, version: 2 }, { ...good, activeMs: -1 }, { ...good, startedAt: Infinity }, { ...good, runId: 'x'.repeat(161) }, { ...good, actions: Array(2001).fill({ n: 1, action: { type: 'endTurn' } }) }, { ...good, actions: [{ n: 1, action: { type: 'unsupported' } }] }, { ...good, actions: [{ n: 1, action: { type: 'play', nested: {} } }] }]) assert.equal(isValidSession(invalid), false);
});

test('feedback exports seed, timing, build and actual terminal cause without exposing unrelated account fields', () => {
  const state = { ...run('feedback', 123), phase: 'defeat', hp: 0, turn: 7, lastEvent: { kind: 'defeat', cause: 'debt', sourceUid: 'debt-2', cardId: 'debt_loan' }, stats: { played: 12 }, log: ['最后一回合'], privateToken: 'never-export' }, profile = { ...createProfile(), privateToken: 'never-export' }, recording = { ...session('feedback'), activeMs: 65000 };
  const result = buildPlaytestReport({ run: state, profile, session: recording, build: { releaseId: 'release-id', version: '0.5.0', contentRevision: 'installed-revision' }, platform: 'android', environment: { viewport: { width: 390, height: 844 }, pixelRatio: 3, language: 'zh-CN', privateToken: 'never-export' }, now: 1000 });
  assert.equal(result.run.seed, 123); assert.equal(result.run.cause, 'debt'); assert.equal(result.run.sourceUid, 'debt-2'); assert.equal(result.run.cardId, 'debt_loan'); assert.equal(result.session.activeMs, 65000);
  assert.equal(result.release.platform, 'android'); assert.equal(result.release.installedContentRevision, 'installed-revision'); assert.equal(result.run.contentRevision, state.contentRevision); assert.equal(result.createdAt, new Date(1000).toISOString());
  assert.equal(JSON.stringify(result).includes('never-export'), false); result.run.stats.played = 99; result.session.activeMs = 0; assert.equal(state.stats.played, 12); assert.equal(recording.activeMs, 65000);
  assert.equal(buildPlaytestReport({ run: { ...state, phase: 'combat' }, session: { version: 99 } }).run.cause, null);
  assert.equal(buildPlaytestReport({ run: { ...state, phase: 'victory', lastEvent: {} } }).run.cause, 'victory');
  assert.equal(buildPlaytestReport({ run: { ...state, lastEvent: {} } }).run.cause, 'unknown'); assert.equal(buildPlaytestReport({ run: state, session: { version: 99 } }).session, null);
  assert.equal(buildPlaytestReport({ run: state, session: session('unrelated-run') }).session, null);
  assert.equal(buildPlaytestReport({ run: null, session: recording }).session, null);
  assert.equal(durationText(65000), '1分5秒'); assert.equal(durationText(-100), '0秒');
});

test('onboarding only treats the current completed marker as finished and keeps each step readable', () => {
  assert.equal(validGuide({ version: 1, completed: true }), true);
  for (const invalid of [null, {}, { version: 1, completed: false }, { version: 0, completed: true }, { version: 1, completed: 'true' }]) assert.equal(validGuide(invalid), false);
  assert.equal(new Set(GUIDE_STEPS.map(step => step.title)).size, GUIDE_STEPS.length); assert.ok(GUIDE_STEPS.length >= 4);
  for (const step of GUIDE_STEPS) { assert.ok(step.title.trim().length > 0); assert.ok(step.text.trim().length > 10); }
});
