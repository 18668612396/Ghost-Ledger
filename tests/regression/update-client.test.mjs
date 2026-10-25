import test from 'node:test';
import assert from 'node:assert/strict';
import { checkForUpdate } from '../../game/src/update-client.js';
import { createProfile, isValidProfile, settleRun } from '../../game/src/progression.js';
import { createAdventure } from '../../game/src/engine.js';

test('update pointer stays within a Pages project subpath and bypasses the cache', async () => {
  let url, options;
  const result = await checkForUpdate({ currentRelease: 'v0.5.0-web-old', entryUrl: 'https://example.github.io/Ghost-Ledger/', fetcher: async (u, o) => { url = u; options = o; return { ok: true, json: async () => ({ schemaVersion: 1, target: 'web', version: '0.5.1', releaseId: 'v0.5.1-web-new' }) }; } });
  assert.equal(url, 'https://example.github.io/Ghost-Ledger/release.json'); assert.equal(options.cache, 'no-store'); assert.equal(result.available, true);
});
test('development and reserved native targets do not fetch a browser update', async () => {
  for (const [currentRelease, target] of [['development', 'web'], ['v0.5.0-windows-x', 'windows'], ['v0.5.0-android-x', 'android']]) {
    const result = await checkForUpdate({ currentRelease, target, fetcher: () => { throw new Error('must not fetch'); } }); assert.equal(result.skipped, true);
  }
});
test('unavailable, malformed and foreign platform releases cannot offer an update', async () => {
  for (const response of [{ ok: false }, { ok: true, json: async () => ({ schemaVersion: 1, target: 'android', releaseId: 'v1' }) }, { ok: true, json: async () => ({ schemaVersion: 1, target: 'web', version: '1', releaseId: '../../bad' }) }]) {
    const result = await checkForUpdate({ currentRelease: 'v0.5.0-web-old', entryUrl: 'https://example.com/game/', fetcher: async () => response }); assert.equal(result.ok, false); assert.equal(result.available, undefined);
  }
});
test('terminal history keeps seed, content, active duration and precise cause once', () => {
  const run = createAdventure(123, { runId: 'history-session' }); run.phase = 'defeat'; run.lastEvent = { kind: 'defeat', cause: 'debt', sourceUid: 'debt', cardId: null };
  const session = { runId: run.runId, activeMs: 12345, startedAt: 100, endedAt: 99999 };
  const result = settleRun(createProfile(), run, { session });
  assert.equal(isValidProfile(result.profile), true);
  const entry = result.profile.history[0]; assert.equal(entry.seed, 123); assert.equal(entry.contentRevision, run.contentRevision); assert.equal(entry.cause, 'debt'); assert.equal(entry.activeMs, 12345); assert.equal(entry.endedAt, 99999);
  assert.equal(settleRun(result.profile, run, { session }).alreadySettled, true);
  assert.equal(isValidProfile({ ...result.profile, history: [{ ...entry, activeMs: -1 }] }), false);
});
