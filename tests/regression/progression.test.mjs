import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RELICS,
  MILESTONES,
  createProfile,
  isValidProfile,
  getRank,
  getMilestoneProgress,
  claimMilestone,
  equipRelic,
  getAdventureOptions,
  isDifficultyUnlocked,
  settleRun,
} from '../../game/src/progression.js';

function createRun(overrides = {}) {
  return { runId: 'test-run', seed: 123, phase: 'defeat', nodeIndex: 2, stats: { battlesWon: 1, repaid: 2 }, modeId: 'classic', difficulty: 0, ...overrides };
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

test('a new profile starts with a lamp and no earned unlocks', () => {
  const profile = createProfile();
  assert.equal(isValidProfile(profile), true);
  assert.deepEqual(profile, {
    version: 1, experience: 0, totalRuns: 0, wins: 0, totalBattles: 0, totalRepaid: 0,
    bestPath: 0, claimed: [], equippedRelicId: 'lamp', settledRunIds: [], history: [],
  });
  assert.deepEqual(getRank(profile), { name: '见习鬼差', level: 1, current: 0, needed: 20, progress: 0 });
  assert.deepEqual(getAdventureOptions(profile), { relicId: 'lamp', difficulty: 0 });
  assert.equal(RELICS.length, 2);
  assert.equal(MILESTONES.length, 3);
});

test('fresh profiles and adventure options do not share mutable state', () => {
  const profile = createProfile();
  profile.claimed.push('external-value');
  assert.deepEqual(createProfile().claimed, []);
  const options = getAdventureOptions(createProfile());
  options.relicId = 'bell';
  assert.equal(getAdventureOptions(createProfile()).relicId, 'lamp');
});

test('profile validation accepts JSON saves and rejects malformed state', () => {
  const settled = settleRun(createProfile(), createRun()).profile;
  assert.equal(isValidProfile(JSON.parse(JSON.stringify(settled))), true);
  const invalidProfiles = [
    null, [], {}, { ...settled, version: 2 }, { ...settled, totalRuns: -1 },
    { ...settled, totalRepaid: Number.NaN }, { ...settled, experience: 1.5 },
    { ...settled, wins: 2 }, { ...settled, claimed: ['unknown'] },
    { ...settled, claimed: ['first-night', 'first-night'] },
    { ...createProfile(), claimed: ['first-dawn'] },
    { ...settled, equippedRelicId: 'unknown' }, { ...settled, equippedRelicId: 'bell' },
    { ...settled, settledRunIds: ['test-run', 'test-run'] },
    { ...settled, history: [{ ...settled.history[0], battles: -1 }] },
    { ...settled, history: [{ ...settled.history[0], runId: 'not-settled' }] },
    { ...settled, history: [{ ...settled.history[0], won: true, abandoned: true }] },
    { ...settled, history: [{ ...settled.history[0], difficulty: 2 }] },
  ];
  for (const profile of invalidProfiles) assert.equal(isValidProfile(profile), false);
});

test('settling a defeat keeps completed work and makes the first unlock ready', () => {
  const profile = deepFreeze(createProfile());
  const run = deepFreeze(createRun());
  const result = settleRun(profile, run);
  assert.equal(result.earned, 10);
  assert.equal(result.alreadySettled, false);
  assert.equal(result.profile.totalRuns, 1);
  assert.equal(result.profile.totalBattles, 1);
  assert.equal(result.profile.totalRepaid, 2);
  assert.equal(result.profile.bestPath, 2);
  assert.equal(result.profile.wins, 0);
  assert.equal(result.profile.history[0].abandoned, false);
  assert.deepEqual(getMilestoneProgress(result.profile, 'first-night'), { current: 1, goal: 1, completed: true, claimed: false });
  assert.equal(isValidProfile(result.profile), true);
  assert.equal(profile.totalRuns, 0);
  assert.equal(run.stats.battlesWon, 1);
});

test('victory settles route completion and an additional title reward', () => {
  const result = settleRun(createProfile(), createRun({
    phase: 'victory', nodeIndex: 4, difficulty: 1,
    stats: { battlesWon: 3, repaid: 6 },
    route: { completedIds: ['paper', 'rest', 'collector', 'soup', 'judge'], path: ['paper', 'rest', 'collector', 'soup', 'judge'] },
  }));
  assert.equal(result.earned, 48);
  assert.equal(result.profile.wins, 1);
  assert.equal(result.profile.bestPath, 5);
  assert.deepEqual(result.profile.history[0], {
    runId: 'test-run', won: true, abandoned: false, battles: 3, steps: 5, repaid: 6,
    experience: 48, modeId: 'classic', difficulty: 1, seed: 123, cause: 'victory',
  });
  assert.equal(getRank(result.profile).name, '提灯鬼差');
  assert.equal(isValidProfile(result.profile), true);
});

test('returning home during an active run does not settle any progress', () => {
  for (const phase of ['map', 'combat', 'reward', 'event']) {
    const profile = deepFreeze(createProfile());
    const result = settleRun(profile, deepFreeze(createRun({ phase })));
    assert.equal(result.profile, profile);
    assert.equal(result.earned, 0);
    assert.equal(result.alreadySettled, false);
  }
});

test('explicit abandonment settles completed battles but not an unfinished first battle', () => {
  const partial = settleRun(createProfile(), createRun({ phase: 'combat' }), { abandoned: true });
  assert.equal(partial.earned, 10);
  assert.equal(partial.profile.history[0].abandoned, true);
  assert.equal(partial.profile.totalBattles, 1);
  const early = settleRun(createProfile(), createRun({ phase: 'combat', nodeIndex: 0, stats: { battlesWon: 0, repaid: 4 } }), { abandoned: true });
  assert.equal(early.earned, 0);
  assert.equal(early.profile.experience, 0);
  assert.equal(early.profile.totalRuns, 1);
  assert.equal(early.profile.totalRepaid, 4);
  assert.equal(getMilestoneProgress(early.profile, 'first-night').completed, false);
});

test('terminal outcomes take precedence over an abandonment flag', () => {
  for (const phase of ['victory', 'defeat']) {
    const result = settleRun(createProfile(), createRun({ phase }), { abandoned: true });
    assert.equal(result.profile.history[0].abandoned, false);
    assert.equal(result.profile.history[0].won, phase === 'victory');
  }
});

test('settlement is idempotent after reload and requires a current run identity', () => {
  const first = settleRun(createProfile(), createRun());
  const loaded = JSON.parse(JSON.stringify(first.profile));
  const repeated = settleRun(loaded, createRun({ phase: 'victory', stats: { battlesWon: 3, repaid: 20 } }));
  assert.equal(repeated.profile, loaded);
  assert.equal(repeated.alreadySettled, true);
  assert.equal(repeated.earned, 0);
  assert.equal(repeated.profile.wins, 0);
  const missingIdentity = settleRun(createProfile(), createRun({ runId: undefined }));
  assert.equal(missingIdentity.profile.history.length, 0);
  assert.equal(missingIdentity.earned, 0);
});

test('unknown, locked, unearned, and already claimed choices are stable no-ops', () => {
  const profile = deepFreeze(createProfile());
  assert.equal(claimMilestone(profile, 'first-night'), profile);
  assert.equal(claimMilestone(profile, 'unknown'), profile);
  assert.equal(equipRelic(profile, 'bell'), profile);
  assert.equal(equipRelic(profile, 'unknown'), profile);
  assert.equal(equipRelic(profile, 'lamp'), profile);
  assert.equal(getMilestoneProgress(profile, 'unknown'), null);
  const ready = settleRun(profile, createRun()).profile;
  const claimed = claimMilestone(deepFreeze(ready), 'first-night');
  assert.equal(claimMilestone(claimed, 'first-night'), claimed);
  assert.equal(getMilestoneProgress(claimed, 'first-night').claimed, true);
  assert.equal(claimed.equippedRelicId, 'lamp');
});

test('claiming a short-run unlock enables switching either way without changing the run', () => {
  const pausedRun = deepFreeze(createRun({ runId: 'next-run', phase: 'combat', relicId: 'lamp' }));
  const settled = settleRun(createProfile(), createRun()).profile;
  const claimed = claimMilestone(settled, 'first-night');
  const withBell = equipRelic(claimed, 'bell');
  assert.equal(withBell.equippedRelicId, 'bell');
  assert.equal(getAdventureOptions(withBell).relicId, 'bell');
  assert.equal(equipRelic(withBell, 'lamp').equippedRelicId, 'lamp');
  assert.equal(pausedRun.relicId, 'lamp');
  assert.equal(settled.claimed.length, 0);
  assert.equal(isValidProfile(withBell), true);
});

test('actual repayment accumulates while adventure card pools remain owned by act configuration', () => {
  const first = settleRun(createProfile(), createRun({ runId: 'first', stats: { battlesWon: 1, repaid: 2 } })).profile;
  const second = settleRun(first, createRun({ runId: 'second', stats: { battlesWon: 1, repaid: 4 } })).profile;
  assert.deepEqual(getMilestoneProgress(second, 'paid-oaths'), { current: 6, goal: 6, completed: true, claimed: false });
  assert.equal(Object.hasOwn(getAdventureOptions(second), 'rewardPool'), false);
  const claimed = claimMilestone(second, 'paid-oaths');
  assert.equal(Object.hasOwn(getAdventureOptions(claimed), 'rewardPool'), false);
  assert.equal(isValidProfile(claimed), true);
});

test('ascension unlock requires a claimed victory and does not silently change the next difficulty', () => {
  const profile = createProfile();
  assert.equal(isDifficultyUnlocked(profile, 0), true);
  assert.equal(isDifficultyUnlocked(profile, 1), false);
  assert.equal(isDifficultyUnlocked(profile, 2), false);
  const won = settleRun(profile, createRun({ phase: 'victory' })).profile;
  assert.equal(isDifficultyUnlocked(won, 1), false);
  const claimed = claimMilestone(won, 'first-dawn');
  assert.equal(isDifficultyUnlocked(claimed, 1), true);
  assert.equal(isDifficultyUnlocked(claimed, '1'), false);
  assert.equal(getAdventureOptions(claimed).difficulty, 0);
});

test('rank progression grants titles without permanent player combat attributes', () => {
  const profile = createProfile();
  assert.deepEqual(getRank({ ...profile, experience: 19 }), { name: '见习鬼差', level: 1, current: 19, needed: 20, progress: 0.95 });
  assert.deepEqual(getRank({ ...profile, experience: 20 }), { name: '提灯鬼差', level: 2, current: 0, needed: 40, progress: 0 });
  assert.deepEqual(getRank({ ...profile, experience: 60 }), { name: '司簿鬼差', level: 3, current: 0, needed: 60, progress: 0 });
  assert.deepEqual(getRank({ ...profile, experience: 120 }), { name: '夜巡使', level: 4, current: 0, needed: 0, progress: 1 });
  const advanced = { ...profile, experience: 1000 };
  for (const value of [advanced, getRank(advanced), getAdventureOptions(advanced)]) {
    for (const key of ['hp', 'maxHp', 'attack', 'damage', 'strength', 'maxEnergy']) assert.equal(Object.hasOwn(value, key), false);
  }
  assert.deepEqual(getAdventureOptions(advanced), getAdventureOptions(profile));
});

test('route steps count completed nodes instead of the selected unfinished node', () => {
  const result = settleRun(createProfile(), createRun({
    route: { completedIds: ['paper', 'rest'], path: ['paper', 'rest', 'collector'] },
  }));
  assert.equal(result.profile.bestPath, 2);
  const fallback = settleRun(createProfile(), createRun({ route: { path: ['paper', 'rest', 'collector'] } }));
  assert.equal(fallback.profile.bestPath, 2);
  const pendingReward = createRun({
    phase: 'reward', stats: { battlesWon: 2, repaid: 2 },
    route: { completedIds: ['paper', 'rest'], path: ['paper', 'rest', 'collector'] },
  });
  const beforePicking = settleRun(createProfile(), pendingReward, { abandoned: true });
  const afterPicking = settleRun(createProfile(), {
    ...pendingReward, phase: 'map',
    route: { ...pendingReward.route, completedIds: ['paper', 'rest', 'collector'] },
  }, { abandoned: true });
  assert.equal(beforePicking.profile.bestPath, 3);
  assert.equal(beforePicking.profile.bestPath, afterPicking.profile.bestPath);
});

test('history remains bounded while old settled runs remain protected from duplicate awards', () => {
  let profile = createProfile();
  for (let index = 0; index < 110; index += 1) {
    profile = settleRun(profile, createRun({ runId: `run-${index}` })).profile;
  }
  assert.equal(profile.totalRuns, 110);
  assert.equal(profile.history.length, 10);
  assert.equal(profile.history[0].runId, 'run-109');
  assert.equal(profile.history[9].runId, 'run-100');
  assert.equal(profile.settledRunIds.length, 110);
  assert.equal(settleRun(profile, createRun({ runId: 'run-0' })).alreadySettled, true);
  assert.equal(isValidProfile(profile), true);
  for (let index = 110; index < 520; index += 1) {
    profile = settleRun(profile, createRun({ runId: `run-${index}` })).profile;
  }
  assert.equal(profile.settledRunIds.length, 512);
  assert.equal(profile.settledRunIds[0], 'run-8');
  assert.equal(profile.history[0].runId, 'run-519');
  assert.equal(isValidProfile(profile), true);
});

test('invalid run payloads do not create awards or corrupt a valid profile', () => {
  const profile = createProfile();
  const invalidRuns = [null, {}, createRun({ runId: undefined, seed: undefined }), createRun({ phase: 'unknown' }), createRun({ stats: { battlesWon: -1, repaid: 0 } }), createRun({ stats: { battlesWon: 1, repaid: Number.NaN } })];
  for (const run of invalidRuns) {
    const result = settleRun(profile, run, { abandoned: true });
    assert.equal(result.profile, profile);
    assert.equal(result.earned, 0);
  }
  assert.throws(() => getAdventureOptions({}), TypeError);
  assert.throws(() => settleRun({}, createRun()), TypeError);
});
