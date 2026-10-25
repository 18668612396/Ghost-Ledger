import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfiguredAdventure, transitionConfigured, getConfiguredCardView, contentFor, isValidConfiguredSave } from '../src/runtime/game.js';
import { getConfiguredAvailableNodes, createConfiguredEnemy, planConfiguredIntent } from '../src/runtime/world.js';
import { makeCard } from '../src/runtime/effects.js';

// These are controlled encounters entered through the public game state machine.
// Numerical expectations come from the card reference, not a second effect interpreter.
function card(state, spec) {
  const [cardId, upgradeLevel = 0] = Array.isArray(spec) ? spec : [spec];
  return makeCard(state, cardId, { upgradeLevel });
}
function scenario(specs, { enemies = 1, energy = 30, seed = 17 } = {}) {
  let state = createConfiguredAdventure(seed, { runId: `card-rules-${seed}` });
  state = transitionConfigured(state, { type: 'selectNode', nodeId: getConfiguredAvailableNodes(state)[0].id });
  assert.equal(state.phase, 'combat');
  state.relics = [];
  state.enemies = Array.from({ length: enemies }, (_, index) => createConfiguredEnemy('jaw', state, index, contentFor(state), () => 0));
  state.enemies.forEach(enemy => { enemy.hp = 1000; enemy.maxHp = 1000; enemy.intent = planConfiguredIntent(state, enemy, contentFor(state), () => 0); });
  state.enemy = state.enemies[0];
  state.hand = specs.map(spec => card(state, spec));
  state.drawPile = []; state.discard = []; state.exhaust = []; state.limbo = []; state.powerZone = [];
  state.energy = energy; state.strength = 0; state.dexterity = 0; state.block = 0; state.weak = 0; state.exposed = 0; state.frail = 0;
  state.debts = []; state.repaidThisTurn = 0;
  state.powers = {}; state.pendingChoice = null;
  return state;
}
function play(state, id, targetUid = state.enemies[0]?.uid) {
  const held = state.hand.find(item => item.cardId === id);
  assert.ok(held, `missing card ${id}`);
  const next = transitionConfigured(state, { type: 'play', uid: held.uid, targetUid });
  assert.notEqual(next.lastEvent.kind, 'invalid', `${id}: ${next.notice}`);
  return next;
}
function choose(state, uid) {
  assert.ok(state.pendingChoice);
  const next = transitionConfigured(state, { type: 'chooseCard', uid });
  assert.notEqual(next.lastEvent.kind, 'invalid', next.notice);
  return next;
}
function withDraw(state, ids) { state.drawPile = ids.map(id => card(state, id)); return state; }
function inCombat(state, uid) { return ['hand', 'drawPile', 'discard', 'exhaust', 'powerZone', 'limbo'].flatMap(zone => state[zone]).find(item => item.uid === uid); }
function hold(state, id) { return state.hand.find(item => item.cardId === id); }
function costOf(state, uid) { return getConfiguredCardView(state, inCombat(state, uid)).cost; }
function pass(state) {
  const prepared = structuredClone(state);
  for (const enemy of prepared.enemies) enemy.intent = { move: 'test_wait', label: '静候', effects: [] };
  return transitionConfigured(prepared, { type: 'endTurn' });
}
function debt(state, amount, dueTurn = state.turn + 2) {
  state.debts.push({ id: `receipt-${state.nextDebtId++}`, amount, dueTurn, originalDueTurn: dueTurn, delayed: false });
  return state;
}
const drawEvents = state => state.events.filter(event => event.type === 'cardDrawn');

test('Double Tap+ duplicates each of the next two attacks once; skills do not consume a charge', () => {
  let state = scenario([['ic_double_tap', 1], 'ic_strike', 'ic_defend', 'ic_strike', 'ic_strike']);
  state = play(state, 'ic_double_tap');
  state = play(state, 'ic_strike');
  assert.equal(state.enemies[0].hp, 988);
  state = play(state, 'ic_defend');
  state = play(state, 'ic_strike');
  assert.equal(state.enemies[0].hp, 976);
  state = play(state, 'ic_strike');
  assert.equal(state.enemies[0].hp, 970);
  assert.equal(state.stats.cardsPlayed, 7);
});

test('power cards leave to the power zone and never activate exhaust draw or block', () => {
  let state = withDraw(scenario(['ic_feel_no_pain', 'ic_dark_embrace', 'ic_corruption']), ['ic_strike', 'ic_strike']);
  state = play(state, 'ic_feel_no_pain');
  state = play(state, 'ic_dark_embrace');
  state = play(state, 'ic_corruption');
  assert.equal(state.powerZone.length, 3);
  assert.equal(state.exhaust.length, 0);
  assert.equal(state.block, 0);
  assert.equal(state.drawPile.length, 2);
  assert.equal(drawEvents(state).length, 0);
});

test('Corruption, True Grit+, Sentinel, Feel No Pain and Dark Embrace resolve their shared chain', () => {
  let state = withDraw(scenario(['ic_feel_no_pain', 'ic_dark_embrace', 'ic_corruption', ['ic_true_grit', 1], 'ic_sentinel', 'ic_defend'], { energy: 12 }), ['ic_strike', 'ic_strike']);
  for (const id of ['ic_feel_no_pain', 'ic_dark_embrace', 'ic_corruption']) state = play(state, id);
  const sentinelUid = hold(state, 'ic_sentinel').uid;
  assert.equal(getConfiguredCardView(state, hold(state, 'ic_true_grit')).cost, 0);
  state = play(state, 'ic_true_grit');
  assert.equal(state.block, 9);
  state = choose(state, sentinelUid);
  assert.equal(state.block, 15); // 9 from the card, then 3 for each of two exhausts.
  assert.equal(state.energy, 8); // 12 - three powers' 6 energy + Sentinel's 2.
  assert.deepEqual(state.exhaust.map(item => item.cardId).sort(), ['ic_sentinel', 'ic_true_grit']);
  assert.equal(drawEvents(state).length, 2);
  assert.deepEqual(state.hand.map(item => item.cardId).sort(), ['ic_defend', 'ic_strike', 'ic_strike']);
});

test('Second Wind grants block once per exhausted card; Feel No Pain ignores Dexterity and Frail', () => {
  let state = scenario(['ic_feel_no_pain', 'ic_second_wind', 'status_wound', 'status_dazed', 'ic_defend', 'ic_strike']);
  state.dexterity = 2; state.frail = 1;
  state = play(state, 'ic_feel_no_pain');
  state = play(state, 'ic_second_wind');
  assert.equal(state.exhaust.length, 3);
  assert.equal(state.block, 24); // Three times floor((5 + 2) * .75) + three fixed 3.
  assert.equal(state.events.filter(event => event.type === 'blockGained').length, 6);
  assert.deepEqual(state.hand.map(item => item.cardId), ['ic_strike']);
});

test('Blood for Blood discounts only actual player HP loss, not enemy damage or blocked hits', () => {
  let state = scenario(['ic_blood_for_blood', 'ic_strike', 'ic_hemokinesis']);
  const uid = hold(state, 'ic_blood_for_blood').uid;
  state = play(state, 'ic_strike'); assert.equal(costOf(state, uid), 4);
  state = play(state, 'ic_hemokinesis'); assert.equal(costOf(state, uid), 3);
  state.block = 20;
  state.enemies[0].intent = { move: 'test_attack', label: '试击', effects: [{ op: 'damage', amount: 5, target: 'player' }] };
  state = transitionConfigured(state, { type: 'endTurn' });
  assert.equal(costOf(state, uid), 3);
  assert.equal(state.hp, 78);
  state.enemies[0].intent = { move: 'test_attack', label: '试击', effects: [{ op: 'damage', amount: 5, target: 'player' }] };
  state = transitionConfigured(state, { type: 'endTurn' });
  assert.equal(costOf(state, uid), 2);
  assert.equal(state.hp, 73);
});

test('an attack generated after HP loss does not inherit historical Blood for Blood reductions', () => {
  let state = scenario(['ic_blood_for_blood', 'ic_hemokinesis', 'ic_infernal_blade']);
  state.contentSnapshot = structuredClone(contentFor(state));
  for (const definition of Object.values(state.contentSnapshot.cards)) if (definition.type === 'attack') definition.generation = { combat: definition.id === 'ic_blood_for_blood' };
  const oldUid = hold(state, 'ic_blood_for_blood').uid;
  state = play(state, 'ic_hemokinesis');
  state = play(state, 'ic_infernal_blade');
  const created = state.hand.find(item => item.cardId === 'ic_blood_for_blood' && item.uid !== oldUid);
  assert.ok(created);
  assert.equal(created.costReduction || 0, 0);
  state = pass(state);
  assert.equal(costOf(state, oldUid), 3);
  assert.equal(costOf(state, created.uid), 4);
});

test('Rupture responds to immediate card self damage but excludes an unpaid debt default', () => {
  let state = scenario(['ic_rupture', 'ic_bloodletting', 'debt_blood']);
  state = play(state, 'ic_rupture');
  state = play(state, 'ic_bloodletting');
  assert.equal(state.strength, 1);
  state = play(state, 'debt_blood');
  state = pass(pass(state));
  assert.equal(state.stats.debtDamage, 4);
  assert.equal(state.hp, 73);
  assert.equal(state.strength, 1);
  assert.equal(state.stats.repaid, 0);
});

test('Whirlwind spends exactly X energy and applies strength independently to every hit and enemy', () => {
  let state = scenario(['ic_whirlwind'], { energy: 2, enemies: 3 });
  state.strength = 2;
  state = play(state, 'ic_whirlwind');
  assert.equal(state.energy, 0);
  assert.deepEqual(state.enemies.map(enemy => enemy.hp), [986, 986, 986]);
  assert.equal(state.events.filter(event => event.type === 'attackHit').length, 6);
  let zero = scenario(['ic_whirlwind'], { energy: 0 });
  zero = play(zero, 'ic_whirlwind');
  assert.equal(zero.enemies[0].hp, 1000);
  assert.equal(zero.events.filter(event => event.type === 'attackHit').length, 0);
});

test('Searing Blow can be permanently upgraded repeatedly and uses its saved level in damage', () => {
  let state = scenario(['ic_searing_blow']);
  const permanent = { ...hold(state, 'ic_searing_blow') };
  state.deckCards = [permanent]; state.deck = [permanent.cardId];
  for (let level = 1; level <= 3; level++) {
    state.phase = 'event'; state.event = { id: 'rest' };
    state = transitionConfigured(state, { type: 'event', choiceId: 'upgrade' });
    state = transitionConfigured(state, { type: 'event', choiceId: `upgrade:${permanent.uid}` });
    assert.equal(state.deckCards[0].upgradeLevel, level);
  }
  state.phase = 'combat'; state.hand = [{ ...state.deckCards[0] }];
  state = play(state, 'ic_searing_blow');
  assert.equal(state.enemies[0].hp, 973);
  assert.equal(state.deckCards[0].upgradeLevel, 3);
});

test('Armaments selection excludes statuses, curses and ordinary cards already upgraded', () => {
  let state = scenario(['ic_armaments', 'status_wound', 'curse_injury', ['ic_strike', 1], ['ic_searing_blow', 2], 'ic_defend']);
  const searing = hold(state, 'ic_searing_blow').uid, defend = hold(state, 'ic_defend').uid;
  state = play(state, 'ic_armaments');
  assert.deepEqual([...state.pendingChoice.cardUids].sort(), [searing, defend].sort());
  state = choose(state, searing);
  assert.equal(hold(state, 'ic_searing_blow').upgradeLevel, 3);
  assert.equal(hold(state, 'status_wound').upgradeLevel, 0);
});

test('Armaments+ upgrades only eligible hand cards and leaves the permanent deck unchanged', () => {
  let state = scenario([['ic_armaments', 1], 'status_wound', 'curse_injury', ['ic_strike', 1], ['ic_searing_blow', 2], 'ic_defend']);
  const originalDeck = structuredClone(state.deckCards);
  state = play(state, 'ic_armaments');
  assert.equal(hold(state, 'status_wound').upgradeLevel, 0);
  assert.equal(hold(state, 'curse_injury').upgradeLevel, 0);
  assert.equal(hold(state, 'ic_strike').upgradeLevel, 1);
  assert.equal(hold(state, 'ic_searing_blow').upgradeLevel, 3);
  assert.equal(hold(state, 'ic_defend').upgradeLevel, 1);
  assert.deepEqual(state.deckCards, originalDeck);
});

test('No Draw expires before ethereal exhaust; Dark Embrace draws survive end-turn clearing', () => {
  let state = withDraw(scenario(['ic_dark_embrace', 'ic_battle_trance', 'ic_carnage', 'status_dazed']), Array(9).fill('ic_strike'));
  state = play(state, 'ic_dark_embrace'); state = play(state, 'ic_battle_trance');
  assert.equal(state.hand.length, 5);
  const retained = state.drawPile.slice(-2).map(item => item.uid);
  state = pass(state);
  assert.equal(state.exhaust.length, 2);
  for (const uid of retained) assert.ok(state.hand.some(item => item.uid === uid), `ethereal-trigger draw ${uid} should survive`);
  assert.equal(state.hand.length, 7); // Two exhaust draws plus five cards for the new turn.
  assert.equal(state.powers.no_draw, undefined);
});

test('Flame Barrier retaliates per blocked hit and expires after enemy actions', () => {
  let state = scenario(['ic_flame_barrier']);
  state = play(state, 'ic_flame_barrier');
  state.enemies[0].intent = { move: 'test_multi', label: '三连击', effects: [{ op: 'damage', amount: 3, hits: 3, target: 'player' }] };
  state = transitionConfigured(state, { type: 'endTurn' });
  assert.equal(state.hp, 80);
  assert.equal(state.enemies[0].hp, 988);
  assert.equal(state.powers.flame_barrier, undefined);
});

test('Flex strength repayment is a debuff and can be blocked before or after gaining strength', () => {
  let before = scenario(['ic_flex']); before.artifact = 1;
  before = play(before, 'ic_flex'); before = pass(before);
  assert.equal(before.strength, 2); assert.equal(before.artifact, 0);
  let after = scenario(['ic_flex', ['ic_flex', 1]]);
  after = play(after, 'ic_flex'); after = play(after, 'ic_flex');
  after.artifact = 1; after = pass(after);
  assert.equal(after.strength, 6); assert.equal(after.artifact, 0);
});

test('debt Chain gains damage while indebted and only its own kill repays principal', () => {
  let state = debt(scenario(['debt_chain'], { enemies: 2 }), 4);
  state.enemies[0].hp = 9;
  state = play(state, 'debt_chain');
  assert.equal(state.enemies[0].hp, 0);
  assert.equal(state.debts[0].amount, 2);
  assert.equal(state.stats.repaid, 2);
  let noKill = debt(scenario(['debt_chain']), 4);
  noKill = play(noKill, 'debt_chain');
  assert.equal(noKill.enemies[0].hp, 989);
  assert.equal(noKill.stats.repaid, 0);
});

test('Vow repays only outstanding principal, while Lotus is a finite-use stronger defense', () => {
  let vow = debt(scenario(['debt_vow']), 1);
  vow = play(vow, 'debt_vow');
  assert.equal(vow.block, 4); assert.equal(vow.stats.repaid, 1); assert.equal(vow.debts.length, 0);
  let lotus = debt(scenario([['debt_lotus', 1]]), 2);
  lotus = play(lotus, 'debt_lotus');
  assert.equal(lotus.block, 11); assert.equal(lotus.stats.repaid, 2);
  assert.deepEqual(lotus.exhaust.map(item => item.cardId), ['debt_lotus']);
});

test('Seal checks next debt maturity; delaying it removes the timing bonus', () => {
  let soon = debt(scenario(['debt_seal']), 2, 2);
  soon = play(soon, 'debt_seal'); assert.equal(soon.enemies[0].hp, 978);
  let delayed = debt(scenario([['debt_delay', 1], 'debt_seal']), 2, 2);
  delayed = play(delayed, 'debt_delay'); delayed = play(delayed, 'debt_seal');
  assert.equal(delayed.enemies[0].hp, 984);
});

test('Borrowed strike still creates a surviving receipt when its attack ends the battle', () => {
  let state = scenario(['debt_blood']); state.enemies[0].hp = 1;
  state = play(state, 'debt_blood');
  assert.equal(state.phase, 'reward');
  assert.equal(state.debts[0].amount, 2);
  assert.equal(state.debts[0].dueTurn, 3);
  assert.equal(state.stats.borrowed, 2);
  assert.equal(state.stats.repaid, 0);
});

test('Ledger draws even with no debt; Mirror rewards repayment before it is played', () => {
  let ledger = withDraw(scenario(['debt_ledger']), ['ic_strike', 'ic_defend']);
  ledger = play(ledger, 'debt_ledger');
  assert.equal(ledger.stats.repaid, 0); assert.equal(drawEvents(ledger).length, 2);
  assert.equal(ledger.exhaust[0].cardId, 'debt_ledger');
  let before = debt(scenario(['debt_mirror', 'debt_vow']), 2);
  before = play(before, 'debt_mirror'); before = play(before, 'debt_vow');
  assert.equal(before.block, 11);
  let after = debt(scenario(['debt_mirror', 'debt_vow']), 2);
  after = play(after, 'debt_vow'); after = play(after, 'debt_mirror');
  assert.equal(after.block, 17);
});

test('Ferry produces energy only when it actually repays debt', () => {
  let empty = scenario([['debt_ferry', 1]], { energy: 0 }); empty = play(empty, 'debt_ferry');
  assert.equal(empty.energy, 0); assert.equal(empty.stats.repaid, 0);
  let owing = debt(scenario([['debt_ferry', 1]], { energy: 0 }), 1);
  owing = play(owing, 'debt_ferry');
  assert.equal(owing.energy, 2); assert.equal(owing.stats.repaid, 1);
  assert.equal(owing.exhaust[0].cardId, 'debt_ferry');
});

test('Verdict rewards actual combat repayments and caps its bonus independently of remaining debt', () => {
  let state = debt(scenario([['debt_ledger', 1], ['debt_ledger', 1], 'debt_verdict']), 12);
  state = play(state, 'debt_ledger'); state = play(state, 'debt_ledger');
  assert.equal(state.combatCounters.repaid, 12); assert.equal(state.debts.length, 0);
  state = play(state, 'debt_verdict');
  assert.equal(state.enemies[0].hp, 960); // 24 base + capped 16 bonus, not 48.
  let fresh = scenario(['debt_verdict']); fresh.stats.repaid = 100;
  fresh = play(fresh, 'debt_verdict');
  assert.equal(fresh.enemies[0].hp, 976); // Adventure history is not this combat's repayments.
});

test('Loan gives energy now, preserves principal on exhaust and can only be delayed once', () => {
  let state = scenario(['debt_loan', ['debt_delay', 1], ['debt_delay', 1]], { energy: 0 });
  state = play(state, 'debt_loan'); assert.equal(state.energy, 2);
  const id = state.debts[0].id;
  state = play(state, 'debt_delay');
  assert.deepEqual(state.debts[0], { id, amount: 4, dueTurn: 4, originalDueTurn: 3, delayed: true });
  const copy = JSON.parse(JSON.stringify(state));
  assert.equal(isValidConfiguredSave(copy), true);
  const nextDelay = hold(copy, 'debt_delay');
  assert.equal(getConfiguredCardView(copy, nextDelay).playable, false);
  const rejected = transitionConfigured(copy, { type: 'play', uid: nextDelay.uid });
  assert.equal(rejected.lastEvent.kind, 'invalid');
  assert.deepEqual(rejected.debts, state.debts);
  assert.equal(rejected.energy, state.energy);
});

test('Register stacks draw amount but fires once per turn and ignores zero repayment', () => {
  let state = withDraw(debt(scenario(['debt_register', ['debt_register', 1], 'debt_vow', 'debt_ferry']), 4), Array(10).fill('ic_strike'));
  state = play(state, 'debt_register'); state = play(state, 'debt_register');
  state = play(state, 'debt_vow'); assert.equal(drawEvents(state).length, 3);
  state = play(state, 'debt_ferry'); assert.equal(drawEvents(state).length, 0);
  assert.equal(state.stats.repaid, 4);
  let empty = withDraw(scenario(['debt_register', 'debt_vow']), ['ic_strike']);
  empty = play(empty, 'debt_register'); empty = play(empty, 'debt_vow');
  assert.equal(drawEvents(empty).length, 0);
  assert.equal(empty.stats.repaid, 0);
});

test('Feed excludes minions and Reaper heals actual enemy HP loss, excluding block and overkill', () => {
  let feed = scenario(['ic_feed'], { enemies: 2 }); feed.enemies[0].hp = 3; feed.enemies[0].minion = true;
  feed = play(feed, 'ic_feed'); assert.equal(feed.maxHp, 80);
  let normal = scenario(['ic_feed'], { enemies: 2 }); normal.enemies[0].hp = 3;
  normal = play(normal, 'ic_feed'); assert.equal(normal.maxHp, 83);
  let reaper = scenario(['ic_reaper'], { enemies: 3 }); reaper.hp = 40;
  reaper.enemies[0].hp = 2; reaper.enemies[1].block = 3;
  reaper = play(reaper, 'ic_reaper');
  assert.equal(reaper.hp, 47); // 2 actual HP + (4 - 3 block) + 4 actual HP.
});

test('Evolve and Fire Breathing react to drawing a status, not to directly adding Wounds', () => {
  let state = withDraw(scenario(['ic_evolve', 'ic_fire_breathing', 'ic_power_through', 'ic_shrug_it_off']), ['ic_strike', 'status_wound']);
  state = play(state, 'ic_evolve'); state = play(state, 'ic_fire_breathing');
  state = play(state, 'ic_power_through');
  assert.equal(state.enemies[0].hp, 1000);
  assert.equal(drawEvents(state).length, 0);
  assert.equal(state.hand.filter(item => item.cardId === 'status_wound').length, 2);
  state = play(state, 'ic_shrug_it_off');
  assert.equal(state.enemies[0].hp, 994);
  assert.equal(drawEvents(state).length, 2);
  assert.equal(state.hand.filter(item => item.cardId === 'status_wound').length, 3);
});

test('Rupture only reacts to unblocked Burn HP loss, while Burn can use existing block', () => {
  let state = scenario(['ic_rupture', 'status_burn']);
  state = play(state, 'ic_rupture'); state.block = 2;
  state = pass(state);
  assert.equal(state.hp, 80); assert.equal(state.strength, 0);
  state = pass(state);
  assert.equal(state.hp, 78); assert.equal(state.strength, 1);
});

test('an already-paid card selection survives serialization without paying or executing twice', () => {
  let state = withDraw(scenario(['ic_burning_pact', 'ic_strike'], { energy: 3 }), ['ic_defend', 'ic_strike']);
  const chosenUid = hold(state, 'ic_strike').uid;
  state = play(state, 'ic_burning_pact');
  assert.equal(state.energy, 2); assert.equal(state.pendingChoice.cardUids.length, 1);
  const resumed = JSON.parse(JSON.stringify(state));
  assert.equal(isValidConfiguredSave(resumed), true);
  const rejected = transitionConfigured(resumed, { type: 'endTurn' });
  assert.equal(rejected.lastEvent.kind, 'invalid');
  state = choose(resumed, chosenUid);
  assert.equal(state.energy, 2);
  assert.equal(state.stats.cardsPlayed, 1);
  assert.equal(state.exhaust.length, 1);
  assert.equal(drawEvents(state).length, 2);
  assert.equal(state.effectQueue.length, 0);
});

test('a delayed debt keeps identity across a real reward and next battle; combat repayment totals reset', () => {
  let state = scenario(['debt_loan', 'debt_vow', ['debt_delay', 1], 'ic_cleave'], { seed: 1 });
  state = play(state, 'debt_loan'); state = play(state, 'debt_vow'); state = play(state, 'debt_delay');
  const receipt = structuredClone(state.debts[0]);
  assert.equal(state.combatCounters.repaid, 2);
  state.enemies[0].hp = 1;
  state = play(state, 'ic_cleave');
  assert.equal(state.phase, 'reward');
  state = transitionConfigured(state, { type: 'reward', cardId: null });
  const nextBattle = getConfiguredAvailableNodes(state).find(node => node.type === 'battle');
  assert.ok(nextBattle, 'fixed seed must offer a connected second battle');
  state = transitionConfigured(state, { type: 'selectNode', nodeId: nextBattle.id });
  assert.equal(state.phase, 'combat'); assert.equal(state.turn, 2);
  assert.deepEqual(state.debts, [receipt]);
  assert.equal(state.combatCounters.repaid, 0); assert.equal(state.stats.repaid, 2);
  state = JSON.parse(JSON.stringify(state));
  assert.equal(isValidConfiguredSave(state), true);
  const delayAgain = card(state, ['debt_delay', 1]); state.hand.push(delayAgain);
  assert.equal(getConfiguredCardView(state, delayAgain).playable, false);
});

test('Doubt and Shame apply for the next player turn rather than expiring immediately', () => {
  let state = scenario(['curse_doubt', 'curse_shame', 'ic_strike', 'ic_defend']);
  state = pass(state);
  assert.equal(state.weak, 1);
  assert.equal(state.frail, 1);
  state = play(state, 'ic_strike');
  assert.equal(state.enemies[0].hp, 996);
  state = play(state, 'ic_defend');
  assert.equal(state.block, 3);
});

test('card views evaluate dynamic values for growing damage, upgrades, current block and strike count', () => {
  let rampage = scenario(['ic_rampage']); const rampUid = hold(rampage, 'ic_rampage').uid;
  assert.match(getConfiguredCardView(rampage, inCombat(rampage, rampUid)).description, /^造成8点/);
  rampage = play(rampage, 'ic_rampage');
  assert.match(getConfiguredCardView(rampage, inCombat(rampage, rampUid)).description, /^造成13点/);
  const searing = scenario([['ic_searing_blow', 3]]);
  assert.match(getConfiguredCardView(searing, hold(searing, 'ic_searing_blow')).description, /^造成27点/);
  const slam = scenario(['ic_body_slam']); slam.block = 19;
  assert.match(getConfiguredCardView(slam, hold(slam, 'ic_body_slam')).description, /^造成19点/);
  let perfected = withDraw(scenario(['ic_perfected_strike', 'ic_strike']), ['ic_twin_strike']);
  perfected.discard.push(card(perfected, 'ic_wild_strike'));
  perfected.exhaust.push(card(perfected, 'ic_pommel_strike'));
  assert.match(getConfiguredCardView(perfected, hold(perfected, 'ic_perfected_strike')).description, /^造成14点/);
  perfected = play(perfected, 'ic_perfected_strike');
  assert.equal(perfected.enemies[0].hp, 986);
});
