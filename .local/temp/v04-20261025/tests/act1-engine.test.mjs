import test from 'node:test';
import assert from 'node:assert/strict';
// Import the standalone module first to guard against an ESM gateway cycle.
import { createAct1Enemy, planAct1EnemyIntent, RELIC_DEFS, POTION_DEFS } from '../src/act1-engine.js';
import { createAct1Adventure, createRun, createAdventure, transition, getEnemies, getEnemyIntent, getCardView, isCardPlayable, getAvailableNodes, getEventView, isValidSave, migrateRun, debtTotal, CARD_DEFS, ENEMY_DEFS } from '../src/engine.js';
import { ACT1_ENEMY_DEFS } from '../src/act1-content.js';
import { createProfile, getAdventureOptions, claimMilestone } from '../src/progression.js';

function firstBattle(seed = 42, options = {}) {
  const state = createAct1Adventure(seed, { runId: `test-${seed}`, ...options });
  return transition(state, { type: 'selectNode', nodeId: getAvailableNodes(state)[0].id });
}

function withCards(state, ids) {
  state.hand = []; state.drawPile = []; state.discard = []; state.exhaust = []; state.upgrades = {};
  const permanent = ids.filter(id => CARD_DEFS[id].type !== 'status').map(cardId => ({ uid: `a-card-${state.nextUid++}`, cardId, upgraded: false }));
  if (permanent.length) { state.deckCards = permanent; state.deck = permanent.map(card => card.cardId); }
  let permanentIndex = 0;
  state.hand = ids.map(cardId => CARD_DEFS[cardId].type === 'status' ? { uid: `a-card-${state.nextUid++}`, cardId, upgraded: false, temporary: true } : { ...permanent[permanentIndex++] });
  return state;
}

function scenario(ids, cards = [], seed = 42) {
  const state = firstBattle(seed); withCards(state, cards);
  state.enemies = ids.map((id, index) => createAct1Enemy(state, id, index));
  for (const enemy of state.enemies) enemy.intent = planAct1EnemyIntent(state, enemy);
  state.enemy = state.enemies[0]; state.encounterId = 'test-encounter'; state.encounterKind = 'battle'; state.energy = 10;
  return state;
}

function play(state, cardId, targetUid = undefined) {
  const card = state.hand.find(held => held.cardId === cardId);
  assert.ok(card, `${cardId} should be in hand`);
  return transition(state, { type: 'play', uid: card.uid, targetUid });
}

function endProtected(state) { const prepared = structuredClone(state); prepared.block = 10000; return transition(prepared, { type: 'endTurn' }); }
function allCards(state) { return ['hand', 'drawPile', 'discard', 'exhaust'].flatMap(zone => state[zone]); }
function freeze(value) { Object.freeze(value); for (const child of Object.values(value)) if (child && typeof child === 'object' && !Object.isFrozen(child)) freeze(child); return value; }

test('new act uses an 80HP ten-card baseline while both legacy APIs and saves remain intact', () => {
  const state = createAct1Adventure(17, { runId: 'fixed' });
  assert.equal(state.version, 3); assert.equal(state.ruleset, 'act1'); assert.equal(state.phase, 'map'); assert.equal(state.hp, 80);
  assert.equal(state.deck.filter(id => id === 'a_strike').length, 5); assert.equal(state.deck.filter(id => id === 'a_defend').length, 4); assert.equal(state.deck.at(-1), 'a_bash');
  assert.equal(state.gold, 99); assert.deepEqual(state.relics, ['blood_ember', 'lamp']); assert.equal(state.route.floorCount, 16);
  assert.deepEqual(state, createAct1Adventure(17, { runId: 'fixed' })); assert.equal(isValidSave(state), true);
  for (const old of [createRun(17), createAdventure(17, { runId: 'old' })]) { const migrated = migrateRun(old); assert.equal(migrated.version, 1); assert.equal(isValidSave(migrated), true); assert.deepEqual(migrated.hand, old.hand); assert.equal(migrated.rngState, old.rngState); }
  assert.equal(Object.keys(ACT1_ENEMY_DEFS).length, 25); assert.equal(Object.keys(ENEMY_DEFS).length, 28);
  assert.equal(RELIC_DEFS.blood_ember.name, '归魂余烬'); assert.equal(POTION_DEFS.fire.target, 'enemy');
});

test('new transitions are pure and invalid targets never consume cards, energy or potion charges', () => {
  const original = freeze(scenario(['spike_s', 'spike_s'], ['a_strike', 'a_defend'])); const snapshot = JSON.stringify(original);
  for (const action of [{ type: 'borrow' }, { type: 'play', uid: original.hand[0].uid }, { type: 'play', uid: original.hand[0].uid, targetUid: 'dead' }, { type: 'endTurn' }]) transition(original, action);
  assert.equal(JSON.stringify(original), snapshot);
  for (const targetUid of [undefined, 'missing']) { const rejected = play(original, 'a_strike', targetUid); assert.equal(rejected.energy, original.energy); assert.deepEqual(rejected.hand, original.hand); assert.deepEqual(rejected.enemies, original.enemies); assert.match(rejected.notice, /目标/); }
  assert.equal(getCardView(original, original.hand[0]).playable, true); assert.equal(isCardPlayable(original, original.hand[0]), false);
  assert.equal(isCardPlayable(original, original.hand[0], original.enemies[0].uid), true);
  const next = play(original, 'a_defend'); assert.equal(next.block, 5);
});

test('five independent enemies act left-to-right once, and only one global debt turn advances', () => {
  let state = scenario(['spike_s', 'spike_s', 'spike_s', 'acid_s', 'acid_s']);
  const uids = state.enemies.map(enemy => enemy.uid); assert.equal(new Set(uids).size, 5);
  state = transition(state, { type: 'borrow' }); state = endProtected(state);
  assert.equal(state.turn, 2); assert.equal(state.combatTurn, 2); assert.equal(debtTotal(state), 2);
  assert.deepEqual(state.lastEvent.actions.map(action => action.enemyUid), uids); assert.ok(state.enemies.every(enemy => enemy.turns === 1));
  state = endProtected(state); assert.equal(state.turn, 3); assert.equal(state.hp, 76); assert.equal(state.stats.debtDamage, 4); assert.equal(debtTotal(state), 0);
});

test('winning and visiting an event do not erase debt or advance time; next combat advances exactly once', () => {
  let state = firstBattle(17); state = transition(state, { type: 'borrow' });
  withCards(state, ['a_cleave']); state.enemies.forEach(enemy => { enemy.hp = 1; });
  state = play(state, 'a_cleave'); assert.equal(state.phase, 'reward'); assert.equal(state.turn, 1); assert.equal(debtTotal(state), 2);
  state = transition(state, { type: 'reward', cardId: null }); const event = getAvailableNodes(state).find(node => node.type === 'event');
  state = transition(state, { type: 'selectNode', nodeId: event.id }); const choice = getEventView(state).choices.find(item => ['heal', 'leave'].includes(item.id));
  state = transition(state, { type: 'event', choiceId: choice.id }); assert.equal(state.turn, 1); assert.equal(debtTotal(state), 2);
  state = transition(state, { type: 'selectNode', nodeId: getAvailableNodes(state).find(node => node.type === 'battle').id });
  assert.equal(state.turn, 2); assert.equal(state.combatTurn, 1); assert.equal(debtTotal(state), 2); state = endProtected(state); assert.equal(state.turn, 3); assert.equal(debtTotal(state), 0); assert.equal(state.stats.debtDamage, 4);
});

test('borrowing caps at two, repayment pays earliest debt, and lamp only triggers on real first payment', () => {
  let state = scenario(['gremlin_wizard'], ['vow', 'a_defend']); state.energy = 3;
  state = transition(transition(state, { type: 'borrow' }), { type: 'borrow' }); const rejected = transition(state, { type: 'borrow' });
  assert.equal(rejected.energy, 5); assert.equal(rejected.debts.length, 2); assert.ok(rejected.debts.every(debt => debt.dueTurn === 3)); assert.match(rejected.notice, /两次/);
  state.debts = [{ id: 'late', amount: 4, dueTurn: 8 }, { id: 'first', amount: 1, dueTurn: 3 }, { id: 'second', amount: 3, dueTurn: 4 }];
  state = transition(state, { type: 'repay' }); assert.equal(state.block, 3); assert.deepEqual(state.debts.map(debt => [debt.id, debt.amount]), [['second', 2], ['late', 4]]);
  state = play(state, 'vow'); assert.equal(state.block, 7); assert.equal(state.repaidThisTurn, 4);
  state.hp = 3; state.debts = [{ id: 'lethal', amount: 100, dueTurn: 2 }]; state = endProtected(state);
  assert.equal(state.phase, 'defeat'); assert.equal(state.lastEvent.cause, 'debt'); assert.equal(state.stats.debtDamage, 3); assert.equal(state.hp, 0);
});

test('single targeting, AoE, kills and one-time rewards are separate from encounter wins', () => {
  let state = scenario(['spike_s', 'spike_s', 'spike_s'], ['a_strike', 'a_cleave', 'a_cleave']);
  state.enemies.forEach(enemy => { enemy.hp = 10; enemy.maxHp = 10; });
  const firstUid = state.enemies[0].uid; state = play(state, 'a_strike', firstUid); assert.deepEqual(state.enemies.map(enemy => enemy.hp), [4, 10, 10]);
  state = play(state, 'a_cleave'); assert.deepEqual(state.enemies.map(enemy => enemy.hp), [0, 2, 2]); assert.equal(state.stats.kills, 1); assert.equal(state.stats.battlesWon, 0);
  const before = state.energy; const bad = play(state, 'a_cleave', firstUid); assert.equal(bad.phase, 'reward'); assert.equal(bad.stats.kills, 3); assert.equal(bad.stats.battlesWon, 1); assert.equal(bad.energy, before - 1);
  const gold = bad.gold; const repeated = transition(bad, { type: 'endTurn' }); assert.equal(repeated.gold, gold); assert.equal(repeated.stats.battlesWon, 1);
  assert.equal(bad.rewards.length, 3); assert.equal(new Set(bad.rewards).size, 3);
});

test('dead single targets reject without consuming a card even while other enemies remain', () => {
  let state = scenario(['spike_s', 'spike_s'], ['verdict', 'a_strike']); const uid = state.enemies[0].uid;
  state = play(state, 'verdict', uid); assert.equal(state.enemies[0].hp, 0); assert.equal(state.phase, 'combat');
  const bad = play(state, 'a_strike', uid); assert.equal(bad.energy, state.energy); assert.deepEqual(bad.hand, state.hand); assert.match(bad.notice, /离场/);
  const next = play(state, 'a_strike'); assert.equal(next.enemies[1].hp, state.enemies[1].hp - 6);
});

test('strength, weak, vulnerable and frail use real damage/block modifiers and artifact only blocks debuffs', () => {
  let state = scenario(['sentry'], ['a_bash', 'a_bash', 'a_defend']); state.enemies[0].hp = 40; state.enemies[0].maxHp = 40;
  state = play(state, 'a_bash'); assert.equal(state.enemy.hp, 32); assert.equal(state.enemy.artifact, 0); assert.equal(state.enemy.exposed, 0);
  state = play(state, 'a_bash'); assert.equal(state.enemy.hp, 24); assert.equal(state.enemy.exposed, 2);
  state.strength = 2; state.dexterity = 2; state.frail = 1; state = play(state, 'a_defend'); assert.equal(state.block, 5);
  state = withCards(state, ['a_strike']); state.energy = 1; state.weak = 1; const hp = state.enemy.hp;
  state = play(state, 'a_strike'); assert.equal(hp - state.enemy.hp, 9); // floor((6+2)*.75*1.5)
});

test('louse bite is rolled once, curl-up needs actual attack HP loss and only occurs once', () => {
  let state = scenario(['louse_red'], ['a_strike', 'a_strike']); const bite = state.enemy.ai.biteDamage; const curl = state.enemy.curlUp;
  state.enemy.block = 6; const initialHp = state.enemy.hp; state = play(state, 'a_strike'); assert.equal(state.enemy.hp, initialHp); assert.equal(state.enemy.curlUp, curl); assert.equal(state.enemy.block, 0);
  state = play(state, 'a_strike'); assert.equal(state.enemy.hp, initialHp - 6); assert.equal(state.enemy.curlUp, 0); assert.equal(state.enemy.block, curl);
  state = endProtected(state); assert.equal(state.enemy.ai.biteDamage, bite); assert.equal(state.enemy.curlUp, 0);
});

test('shield ally protection survives a later ally action and never silently becomes an attack', () => {
  let state = scenario(['gremlin_shield', 'gremlin_sneaky'], ['verdict']); const shield = state.enemies[0];
  assert.equal(shield.intent.move, 'shield'); state = endProtected(state); assert.equal(state.enemies[1].block, 7);
  state = withCards(state, ['verdict']); state.energy = 3; state.enemies[1].block = 0;
  state = play(state, 'verdict', state.enemies[1].uid); assert.equal(getEnemies(state).length, 1); assert.equal(state.enemies[0].intent.move, 'shield');
  state = endProtected(state); assert.equal(state.enemies[0].block, 7); assert.equal(state.enemies[0].intent.move, 'shield_attack');
});

test('cultist scales after its first attack, mad gremlin scales per damaging attack, wizard recharges', () => {
  let cultist = scenario(['cultist']); cultist = endProtected(cultist); assert.equal(cultist.enemy.ritual, 3); assert.equal(getEnemyIntent(cultist).amount, 6);
  cultist = endProtected(cultist); assert.equal(getEnemyIntent(cultist).amount, 9); cultist = endProtected(cultist); assert.equal(getEnemyIntent(cultist).amount, 12);
  let mad = scenario(['gremlin_mad'], ['a_strike', 'a_strike']); mad.enemy.block = 6; mad = play(mad, 'a_strike'); assert.equal(mad.enemy.strength, 0); mad = play(mad, 'a_strike'); assert.equal(mad.enemy.strength, 1);
  let wizard = scenario(['gremlin_wizard']); const sequence = [];
  for (let i = 0; i < 7; i += 1) { sequence.push(getEnemyIntent(wizard).total); wizard = endProtected(wizard); }
  assert.deepEqual(sequence, [0, 0, 25, 0, 0, 0, 25]);
});

test('red slaver entangle and fresh enemy debuffs survive the next player turn and then expire', () => {
  let state = scenario(['slaver_red'], ['a_strike', 'a_defend']);
  state.enemy.intent = { move: 'entangle', label: '缠绕', entangled: 1 }; state = endProtected(state);
  assert.equal(state.entangled, 1); assert.match(getCardView(state, state.hand.find(card => card.cardId === 'a_strike')).reason, /缠绕/);
  const rejected = play(state, 'a_strike'); assert.equal(rejected.energy, state.energy);
  state.enemy.intent = { move: 'charge', label: '蓄咒' }; state = endProtected(state); assert.equal(state.entangled, 0); assert.equal(state.enemy.ai.entangled, true);
  state.enemy.intent = { move: 'blue_rake', label: '钩斩', damage: 7, weak: 1 }; state = endProtected(state); assert.equal(state.weak, 1);
});

test('looter steals through full block, returns money on death, and can actually escape', () => {
  let state = scenario(['looter']); state = endProtected(state); assert.equal(state.gold, 84); assert.equal(state.enemy.stolen, 15);
  state = endProtected(state); assert.equal(state.gold, 69); assert.equal(state.enemy.stolen, 30);
  const escaped = structuredClone(state); let fleeing = escaped;
  for (let i = 0; i < 4 && fleeing.phase === 'combat'; i += 1) fleeing = endProtected(fleeing);
  assert.equal(fleeing.phase, 'reward'); assert.equal(fleeing.stats.enemiesEscaped, 1); assert.equal(fleeing.stats.kills, 0); assert.ok(fleeing.gold < 99);
  state.enemy.hp = 10; state.potions.push({ uid: 'fire-bottle', id: 'fire' });
  state = transition(state, { type: 'usePotion', potionId: 'fire-bottle' }); assert.equal(state.stats.goldRecovered, 30); assert.equal(state.potions.length, 0); assert.ok(state.gold >= 109);
});

test('fungi death applies vulnerable without explosion damage and affects the remaining enemy', () => {
  let state = scenario(['fungi', 'fungi'], ['verdict']); state.enemies[0].hp = 20;
  state.enemies[1].intent = { move: 'fungi_attack', label: '菌兽撕咬', damage: 6 };
  state = play(state, 'verdict', state.enemies[0].uid); assert.equal(state.hp, 80); assert.equal(state.exposed, 2);
  assert.equal(getEnemyIntent(state).amount, 9); state = transition(state, { type: 'endTurn' }); assert.equal(state.hp, 71); assert.equal(state.exposed, 1);
});

test('sentries have independent artifact and alternate 9+4 statuses then 18+2 statuses', () => {
  let state = scenario(['sentry', 'sentry', 'sentry']);
  assert.deepEqual(getEnemies(state).map(enemy => getEnemyIntent(state, enemy.uid).total), [0, 9, 0]);
  state = endProtected(state); assert.equal(allCards(state).filter(card => card.cardId === 'a_dazed').length, 4);
  assert.deepEqual(getEnemies(state).map(enemy => getEnemyIntent(state, enemy.uid).total), [9, 0, 9]);
  state = endProtected(state); assert.equal(allCards(state).filter(card => card.cardId === 'a_dazed').length, 6); assert.ok(state.enemies.every(enemy => enemy.artifact === 1));
});

test('status cards are temporary; slimed consumes energy but does not enrage Nob, dazed is ethereal', () => {
  let state = scenario(['nob'], ['a_defend']); state = endProtected(state); assert.equal(state.enemy.enrage, 2);
  state = withCards(state, ['a_slimed', 'a_defend', 'a_dazed']); state.energy = 3;
  state = play(state, 'a_slimed'); assert.equal(state.energy, 2); assert.equal(state.enemy.strength, 0); assert.equal(state.exhaust[0].cardId, 'a_slimed');
  state = play(state, 'a_defend'); assert.equal(state.enemy.strength, 2); assert.equal(getCardView(state, state.hand[0]).cost, null); assert.equal(getCardView(state, state.hand[0]).playable, false);
  const rejected = play(state, 'a_dazed'); assert.equal(rejected.energy, state.energy);
  state = endProtected(state); assert.ok(state.exhaust.some(card => card.cardId === 'a_dazed')); assert.ok(!state.deck.includes('a_slimed')); assert.ok(!state.deck.includes('a_dazed'));
});

test('a resolving Step stays out of discard and cannot reshuffle and draw itself', () => {
  let state = scenario(['gremlin_wizard'], ['step']); const uid = state.hand[0].uid; const energy = state.energy;
  state = play(state, 'step'); assert.equal(state.energy, energy - 1); assert.equal(state.block, 5); assert.equal(state.lastEvent.drawn, 0);
  assert.equal(state.hand.length, 0); assert.equal(state.drawPile.length, 0); assert.deepEqual(state.discard.map(card => card.uid), [uid]); assert.equal(new Set(allCards(state).map(card => card.uid)).size, 1);
});

test('Step with one discarded card draws exactly that card and only then enters discard', () => {
  let state = scenario(['gremlin_wizard'], ['step', 'a_strike']); const stepUid = state.hand[0].uid; const strike = state.hand.pop(); state.discard.push(strike);
  state = play(state, 'step'); assert.deepEqual(state.hand.map(card => card.uid), [strike.uid]); assert.deepEqual(state.discard.map(card => card.uid), [stepUid]); assert.equal(state.lastEvent.drawn, 1);
  assert.equal(allCards(state).length, 2); assert.equal(new Set(allCards(state).map(card => card.uid)).size, 2);
});

test('a finishing Flame reaches discard before victory cleanup and leaves no temporary Burn', () => {
  let state = scenario(['spike_s'], ['a_flame']); const uid = state.hand[0].uid; state.enemy.hp = 10;
  state = play(state, 'a_flame'); assert.equal(state.phase, 'reward'); assert.equal(state.stats.battlesWon, 1); assert.equal(state.stats.kills, 1);
  assert.deepEqual(state.discard.map(card => card.uid), [uid]); assert.ok(allCards(state).every(card => !card.temporary)); assert.ok(!allCards(state).some(card => card.cardId === 'a_burn'));
  assert.deepEqual(state.deck, ['a_flame']);
});

test('Burn/Burn+ happen before enemies, can be blocked, and a lethal Burn prevents enemy actions', () => {
  let state = scenario(['gremlin_wizard'], ['a_burn', 'a_burn_plus', 'a_dazed']); state.block = 3; state = transition(state, { type: 'endTurn' });
  assert.equal(state.hp, 77); assert.equal(state.stats.damageTaken, 3); assert.equal(state.enemy.turns, 1); assert.ok(state.exhaust.some(card => card.cardId === 'a_dazed'));
  state = scenario(['spike_s'], ['a_burn_plus']); state.hp = 3; state.block = 0; state = transition(state, { type: 'endTurn' }); assert.equal(state.phase, 'defeat'); assert.equal(state.lastEvent.cause, 'burn'); assert.equal(state.enemy.turns, 0);
});

test('a dazed discarded before turn end is not exhausted from discard', () => {
  let state = scenario(['gremlin_wizard'], ['a_dazed']); const dazed = state.hand.pop(); state.discard.push(dazed); state.drawPile = state.deckCards.slice(0, 5).map(card => ({ ...card }));
  state = endProtected(state); assert.ok(state.discard.some(card => card.uid === dazed.uid)); assert.ok(!state.exhaust.some(card => card.uid === dazed.uid));
});

test('Nob A0 starts with Bellow, skills enrage only afterwards, and Rush cannot occur three times', () => {
  let state = scenario(['nob'], ['a_defend']); state = play(state, 'a_defend'); assert.equal(state.enemy.strength, 0);
  state = endProtected(state); assert.equal(state.enemy.enrage, 2);
  const moves = [];
  for (let i = 0; i < 30; i += 1) { moves.push(state.enemy.intent.move); state = endProtected(state); }
  assert.ok(moves.includes('nob_skull') && moves.includes('nob_rush')); assert.ok(!moves.join(',').includes('nob_rush,nob_rush,nob_rush'));
});

test('Lagavulin sleep uses HP damage, early wake stuns once, natural wake attacks turn four', () => {
  let state = scenario(['lagavulin'], ['a_bash']); const hp = state.enemy.hp;
  state = play(state, 'a_bash'); assert.equal(state.enemy.hp, hp); assert.equal(state.enemy.ai.awake, false);
  state = withCards(state, ['verdict']); state.energy = 3; state = play(state, 'verdict'); assert.equal(state.enemy.ai.awake, true); assert.equal(state.enemy.intent.move, 'stunned');
  const oldHp = state.hp; state = transition(state, { type: 'endTurn' }); assert.equal(state.hp, oldHp); assert.equal(state.enemy.intent.move, 'lag_attack');
  state = endProtected(endProtected(state)); assert.equal(state.enemy.intent.move, 'siphon'); state.artifact = 1; state = endProtected(state); assert.equal(state.dexterity, 0); assert.equal(state.strength, -1);
  let natural = scenario(['lagavulin']); for (let i = 0; i < 3; i += 1) natural = transition(natural, { type: 'endTurn' });
  assert.equal(natural.hp, 80); assert.equal(natural.combatTurn, 4); assert.equal(natural.enemy.intent.move, 'lag_attack'); natural = transition(natural, { type: 'endTurn' }); assert.equal(natural.hp, 62);
});

test('slime split replaces intent, inherits final remaining HP in both children and they wait a turn', () => {
  let state = scenario(['slime_boss'], ['a_strike', 'brush']); state.enemy.hp = 75;
  state = play(state, 'a_strike'); assert.equal(state.enemy.hp, 69); assert.equal(state.enemy.intent.move, 'split'); assert.equal(state.enemies.length, 1);
  state = play(state, 'brush'); assert.equal(state.enemy.hp, 62); state = transition(state, { type: 'endTurn' });
  assert.deepEqual(state.enemies.map(enemy => [enemy.id, enemy.hp, enemy.maxHp, enemy.turns]), [['acid_l', 62, 62, 0], ['spike_l', 62, 62, 0]]);
  assert.equal(state.lastEvent.actions.length, 1); assert.equal(state.lastEvent.actions[0].kind, 'split'); assert.equal(state.stats.kills, 0); assert.equal(state.stats.battlesWon, 0);
  let killed = scenario(['acid_l'], ['verdict']); killed.enemy.hp = 12; killed = play(killed, 'verdict'); assert.equal(killed.phase, 'reward'); assert.equal(killed.enemies.length, 1); assert.equal(killed.stats.kills, 1);
});

test('Guardian shift counts only health damage, immediately cancels intent, and retains full defense sequence', () => {
  let state = scenario(['guardian'], ['a_strike', 'verdict', 'a_strike']); state.enemy.block = 6;
  state = play(state, 'a_strike'); assert.equal(state.enemy.ai.shiftRemaining, 30);
  state = play(state, 'verdict'); state = play(state, 'a_strike'); assert.equal(state.enemy.hp, 210); assert.equal(state.enemy.block, 20); assert.equal(state.enemy.intent.move, 'defensive'); assert.equal(state.enemy.sharpHide, 0);
  state = transition(state, { type: 'endTurn' }); assert.equal(state.hp, 80); assert.equal(state.enemy.sharpHide, 3); assert.equal(state.enemy.intent.move, 'roll');
  state = withCards(state, ['a_cleave']); state.energy = 1; state = play(state, 'a_cleave'); assert.equal(state.hp, 77); assert.equal(state.enemy.hp, 202);
  state = endProtected(state); assert.equal(state.enemy.intent.move, 'twin'); state = endProtected(state); assert.equal(state.enemy.sharpHide, 0); assert.equal(state.enemy.ai.shiftRemaining, 40); assert.equal(state.enemy.intent.move, 'whirlwind'); assert.equal(getEnemyIntent(state).amount, 5); assert.equal(getEnemyIntent(state).hits, 4);
});

test('Hexaghost Divider snapshots current turn-two HP; Inferno uses strength and upgrades all Burn', () => {
  let state = scenario(['hexaghost']); state.hp = 47; state = endProtected(state); assert.equal(getEnemyIntent(state).amount, 4); assert.equal(getEnemyIntent(state).hits, 6);
  state.potions.push({ uid: 'heal', id: 'healing' }); state = transition(state, { type: 'usePotion', potionId: 'heal' }); assert.equal(state.hp, 67); assert.equal(getEnemyIntent(state).amount, 4);
  const moves = [];
  for (let i = 0; i < 7; i += 1) { moves.push(state.enemy.intent.move); state = endProtected(state); }
  assert.deepEqual(moves, ['divider', 'sear', 'tackle', 'sear', 'inflame', 'tackle', 'sear']); assert.equal(state.combatTurn, 9); assert.equal(state.enemy.intent.move, 'inferno'); assert.equal(getEnemyIntent(state).amount, 4); assert.equal(getEnemyIntent(state).total, 24);
  state = endProtected(state); assert.equal(state.enemy.intent.move, 'sear'); assert.equal(state.enemy.intent.status, 'a_burn_plus'); assert.ok(allCards(state).filter(card => card.cardId.startsWith('a_burn')).every(card => card.cardId === 'a_burn_plus'));
});

test('Hexaghost snapshots turn-start debt loss before Divider, then ignores healing during that turn', () => {
  let state = scenario(['hexaghost']); state.hp = 49; state.debts = [{ id: 'due', amount: 1, dueTurn: 2 }];
  state = endProtected(state); assert.equal(state.hp, 47); assert.equal(getEnemyIntent(state).amount, 4);
  state.potions.push({ uid: 'heal', id: 'healing' }); state = transition(state, { type: 'usePotion', potionId: 'heal' }); assert.equal(state.hp, 67); assert.equal(getEnemyIntent(state).amount, 4);
});

test('elite victory grants gold and a usable unique relic exactly once and cleans temporary statuses', () => {
  let state = scenario(['nob'], ['verdict', 'a_burn', 'a_dazed']); state.enemy.hp = 12; state.encounterKind = 'elite'; state.hp = 60;
  const gold = state.gold; state = play(state, 'verdict'); assert.equal(state.phase, 'reward'); assert.ok(state.gold - gold >= 25 && state.gold - gold <= 35); assert.equal(state.hp, 66);
  assert.equal(state.relics.length, 3); assert.ok(RELIC_DEFS[state.rewardInfo.relicId]); assert.ok(allCards(state).every(card => !card.temporary));
  const repeated = transition(state, { type: 'endTurn' }); assert.equal(repeated.hp, 66); assert.equal(repeated.relics.length, 3); assert.equal(repeated.stats.battlesWon, 1);
});

test('all 25 definitions have executable independent AI, A0 HP and constrained move histories', () => {
  for (const [id, definition] of Object.entries(ACT1_ENEMY_DEFS)) {
    let state = scenario([id]); assert.ok(state.enemy.hp >= definition.hpRange[0] && state.enemy.hp <= definition.hpRange[1], id);
    const uid = state.enemy.uid;
    for (let turn = 0; turn < 12 && state.phase === 'combat'; turn += 1) { const shown = getEnemyIntent(state, uid); assert.equal(typeof shown.detail, 'string', id); assert.ok(Number.isSafeInteger(shown.amount), id); assert.ok(Number.isSafeInteger(shown.hits), id); state = endProtected(state); }
    assert.ok(state.stats.damageTaken === 0, id); assert.ok(state.enemy.ai.history.length <= 3, id);
  }
});

test('potion target validation is atomic and fire can finish an encounter', () => {
  let state = scenario(['spike_s', 'spike_s']); state.potions = [{ uid: 'bottle', id: 'fire' }];
  const bad = transition(state, { type: 'usePotion', potionId: 'bottle' }); assert.deepEqual(bad.potions, state.potions); assert.deepEqual(bad.enemies, state.enemies);
  state = transition(state, { type: 'usePotion', potionId: 'bottle', targetUid: state.enemies[0].uid }); assert.equal(state.stats.kills, 1); assert.equal(state.potions.length, 0); assert.equal(state.phase, 'combat');
});

test('enemy defeat stops later actors and terminal actions preserve the recorded defeat cause', () => {
  let state = scenario(['spike_s', 'nob']); state.hp = 3; state.block = 0;
  state = transition(state, { type: 'endTurn' }); assert.equal(state.phase, 'defeat'); assert.equal(state.lastEvent.cause, 'enemy'); assert.equal(state.hp, 0);
  assert.equal(state.enemies[1].turns, 0); assert.equal(state.lastEvent.actions.length, 1); assert.equal(state.turn, 1); assert.equal(isValidSave(state), true);
  const ignored = transition(state, { type: 'borrow' }); assert.equal(ignored.lastEvent.cause, 'enemy'); assert.equal(ignored.energy, state.energy); assert.equal(debtTotal(ignored), debtTotal(state));
  assert.equal(createAct1Adventure(42, { runId: 'again' }).hp, 80);
});

function forceMapThrough(state, targetType) {
  // Economy fixtures only: use legal graph edges while bypassing unrelated
  // combat arithmetic. End-to-end simulation below never uses this helper.
  for (let step = 0; step < 16; step += 1) {
    const choices = getAvailableNodes(state); const target = choices.find(node => node.type === targetType);
    if (target) return transition(state, { type: 'selectNode', nodeId: target.id });
    const next = choices.find(node => node.type !== 'boss') ?? choices[0]; if (!next) throw new Error('No route');
    state = transition(state, { type: 'selectNode', nodeId: next.id });
    state.route.completedIds.push(state.route.currentId); state.phase = 'map'; state.event = null; state.rewards = []; state.shop = null;
  }
  throw new Error(`No ${targetType} on route`);
}

test('rest heals 30%, upgrades one specific duplicate, and never advances debt time', () => {
  let state = forceMapThrough(createAct1Adventure(41, { runId: 'rest' }), 'rest'); const turn = state.turn;
  state.hp = 20; const healed = transition(state, { type: 'event', choiceId: 'rest' }); assert.equal(healed.hp, 44); assert.equal(healed.turn, turn);
  state = transition(state, { type: 'event', choiceId: 'upgrade' }); const choice = getEventView(state).choices.find(item => item.cardId === 'a_strike');
  state = transition(state, { type: 'event', choiceId: choice.id }); assert.equal(state.deckCards.filter(card => card.upgraded).length, 1); assert.equal(state.upgrades[choice.cardUid], 1); assert.equal(state.turn, turn); assert.equal(isValidSave(state), true);
  assert.match(getCardView(state, state.deckCards.find(card => card.uid === choice.cardUid)).description, /9/);
});

test('shop purchases are finite, removal affects one copy, and treasure grants a real relic', () => {
  let state = forceMapThrough(createAct1Adventure(47, { runId: 'shop' }), 'shop'); state.gold = 300; const turn = state.turn;
  const choice = getEventView(state).choices.find(item => item.cardId); const originalDeck = state.deck.length; state = transition(state, { type: 'event', choiceId: choice.id }); assert.equal(state.deck.length, originalDeck + 1); assert.equal(state.turn, turn);
  const repeated = transition(state, { type: 'event', choiceId: choice.id }); assert.equal(repeated.gold, state.gold); assert.equal(repeated.deck.length, state.deck.length);
  state = transition(state, { type: 'event', choiceId: 'remove' }); const removed = getEventView(state).choices.find(item => item.cardUid); state = transition(state, { type: 'event', choiceId: removed.id }); assert.equal(state.deck.length, originalDeck); assert.equal(state.removePrice, 100); assert.equal(state.event.id, 'shop'); assert.equal(isValidSave(state), true);
  state = forceMapThrough(createAct1Adventure(47, { runId: 'box' }), 'treasure'); const count = state.relics.length; state = transition(state, { type: 'event', choiceId: 'open' }); assert.equal(state.relics.length, count + 1); assert.ok(RELIC_DEFS[state.relics.at(-1)]); assert.equal(state.phase, 'map');
});

test('each shop allows one removal, refuses repeated payment, and a later shop resets only its service flag', () => {
  let state = forceMapThrough(createAct1Adventure(47, { runId: 'shop-limit' }), 'shop'); state.gold = 500;
  assert.equal(state.shop.removalUsed, false); state = transition(state, { type: 'event', choiceId: 'remove' });
  const first = getEventView(state).choices.find(choice => choice.cardUid); state = transition(state, { type: 'event', choiceId: first.id });
  assert.equal(state.shop.removalUsed, true); assert.equal(state.removePrice, 100); assert.equal(getEventView(state).choices.find(choice => choice.id === 'remove').disabled, true);
  const gold = state.gold; const count = state.deck.length;
  for (const choiceId of ['remove', first.id]) { const rejected = transition(state, { type: 'event', choiceId }); assert.equal(rejected.gold, gold); assert.equal(rejected.deck.length, count); assert.equal(rejected.event.id, 'shop'); assert.equal(rejected.shop.removalUsed, true); }
  const restored = migrateRun(JSON.parse(JSON.stringify(state))); assert.equal(restored.shop.removalUsed, true); assert.equal(getEventView(restored).choices.find(choice => choice.id === 'remove').disabled, true);
  state = transition(state, { type: 'event', choiceId: 'leave' }); state = forceMapThrough(state, 'shop');
  assert.equal(state.shop.removalUsed, false); assert.equal(state.removePrice, 100); assert.equal(getEventView(state).choices.find(choice => choice.id === 'remove').disabled, false);
});

test('older act1 shops migrate read-only with an unused service flag and invalid flag values are rejected', () => {
  const state = forceMapThrough(createAct1Adventure(47, { runId: 'old-shop' }), 'shop'); delete state.shop.removalUsed;
  const snapshot = JSON.stringify(state); assert.equal(isValidSave(state), true); const migrated = migrateRun(state);
  assert.equal(migrated.shop.removalUsed, false); assert.equal(JSON.stringify(state), snapshot); assert.equal(migrated.rngState, state.rngState); assert.equal(migrated.gold, state.gold); assert.deepEqual(migrated.deckCards, state.deckCards);
  for (const removalUsed of ['yes', 1, null]) { const bad = structuredClone(state); bad.shop.removalUsed = removalUsed; assert.equal(isValidSave(bad), false); assert.equal(migrateRun(bad), null); }
});

test('relics and difficulty affect actual battle resources and announced attacks', () => {
  let state = createAct1Adventure(73, { relicId: 'bell', difficulty: 1, runId: 'relic' }); state.relics.push('anchor', 'vajra', 'smooth_stone', 'bag', 'lantern');
  state = transition(state, { type: 'selectNode', nodeId: getAvailableNodes(state)[0].id }); assert.equal(state.block, 16); assert.equal(state.strength, 1); assert.equal(state.dexterity, 1); assert.equal(state.hand.length, 7); assert.equal(state.energy, 4); assert.equal(isValidSave(state), true);
  const easy = firstBattle(73); assert.ok(state.enemies[0].maxHp >= easy.enemies[0].maxHp);
  for (const enemy of state.enemies) if (enemy.intent.damage !== undefined) assert.equal(getEnemyIntent(state, enemy.uid).amount, enemy.intent.damage + 2);
});

test('profile reward unlocks are honored while both new AoE cards remain available', () => {
  let profile = createProfile(); const options = getAdventureOptions(profile);
  const locked = createAct1Adventure(17, { ...options, runId: 'locked' });
  for (const id of ['ledger', 'mirror', 'verdict']) assert.ok(!locked.rewardPool.includes(id));
  for (const id of ['a_cleave', 'a_flame', 'fire', 'bell', 'seal', 'lotus', 'blood', 'ferry']) assert.ok(locked.rewardPool.includes(id));
  const shop = forceMapThrough(locked, 'shop'); assert.ok(getEventView(shop).choices.every(choice => !['ledger', 'mirror', 'verdict'].includes(choice.cardId)));
  profile.totalRepaid = 6; profile = claimMilestone(profile, 'paid-oaths');
  const unlocked = createAct1Adventure(17, { ...getAdventureOptions(profile), runId: 'unlocked' });
  for (const id of ['ledger', 'mirror', 'verdict']) assert.ok(unlocked.rewardPool.includes(id));
  options.rewardPool.push('ledger'); assert.ok(!locked.rewardPool.includes('ledger'));
  assert.throws(() => createAct1Adventure(1, { rewardPool: ['a_dazed'] }), /奖励池/);
});

test('new saves clone without rerolls and reject corrupt graphs, states, instances or duplicate enemies', () => {
  const state = firstBattle(53); assert.equal(isValidSave(state), true); const saved = JSON.parse(JSON.stringify(state)); assert.deepEqual(migrateRun(saved), saved); assert.notEqual(migrateRun(saved), saved);
  for (const change of [state => { state.enemies[0].hp = -1; }, state => { state.enemies.push(structuredClone(state.enemies[0])); }, state => { state.hand.push(structuredClone(state.hand[0])); }, state => { state.route.nodes[0].next = ['fake']; }, state => { state.deckCards[0].upgraded = true; }, state => { state.stats.debtDamage = -1; }, state => { state.rngState = 0; }, state => { state.enemies = [null]; }, state => { state.enemies[0].intent.hits = 0; }, state => { state.shop = 'not-a-shop'; }, state => { state.phase = 'event'; state.event = { id: 'rest' }; }, state => { state.phase = 'event'; state.event = { id: 'shop' }; state.shop = null; }]) { const corrupt = structuredClone(saved); change(corrupt); assert.equal(isValidSave(corrupt), false); assert.equal(migrateRun(corrupt), null); }
});

function turnScore(state, baseline) {
  if (state.phase === 'defeat') return -1e8;
  if (state.phase !== 'combat') return 1e7 + state.hp * 5 - debtTotal(state) * 5;
  const future = transition(state, { type: 'endTurn' });
  if (future.phase === 'defeat') return -1e8;
  if (future.phase !== 'combat') return 1e7 + future.hp * 5 - debtTotal(future) * 5;
  const remainingHp = getEnemies(future).reduce((sum, enemy) => sum + enemy.hp, 0);
  return future.hp * 5 + (baseline - remainingHp) * 2.5 - debtTotal(future) * 5 + getEnemies(future).reduce((sum, enemy) => sum + enemy.burn * 2 + enemy.exposed * 1.5 - enemy.strength * 1.5, 0);
}

function planTurn(initial) {
  const baseline = getEnemies(initial).reduce((sum, enemy) => sum + enemy.hp, 0);
  let frontier = [{ state: initial, score: turnScore(initial, baseline) }]; let best = frontier[0];
  for (let depth = 0; depth < 7; depth += 1) {
    const expanded = []; const seen = new Set();
    for (const candidate of frontier) {
      if (candidate.state.phase !== 'combat') continue;
      const actions = []; const kinds = new Set();
      for (const card of candidate.state.hand) {
        const view = getCardView(candidate.state, card); const key = `${card.cardId}:${card.upgraded}`;
        if (!view.playable || kinds.has(key)) continue; kinds.add(key);
        for (const target of view.target === 'enemy' ? getEnemies(candidate.state) : [null]) actions.push({ type: 'play', uid: card.uid, targetUid: target?.uid });
      }
      if (candidate.state.borrowedThisTurn < 2) actions.push({ type: 'borrow' });
      if (candidate.state.energy > 0 && debtTotal(candidate.state)) actions.push({ type: 'repay' });
      for (const action of actions) {
        const next = transition(candidate.state, action); const key = JSON.stringify([next.energy, next.hand.map(card => card.uid).sort(), next.enemies, next.debts, next.block, next.borrowedThisTurn]);
        if (seen.has(key)) continue; seen.add(key); const planned = { state: next, score: turnScore(next, baseline) }; if (planned.score > best.score) best = planned; expanded.push(planned);
      }
    }
    expanded.sort((a, b) => b.score - a.score); frontier = expanded.slice(0, 16); if (!frontier.length) break;
  }
  return best.state.phase === 'combat' ? transition(best.state, { type: 'endTurn' }) : best.state;
}

function campaign(seed) {
  let state = createAct1Adventure(seed, { ...getAdventureOptions(createProfile()), runId: `campaign-${seed}` });
  const rewardPriority = ['fire', 'bell', 'chain', 'a_cleave', 'a_flame', 'blood', 'seal', 'step', 'mirror', 'lotus', 'ferry', 'verdict', 'ledger', 'vow', 'coin'];
  for (let step = 0; step < 350 && !['victory', 'defeat'].includes(state.phase); step += 1) {
    assert.equal(isValidSave(state), true, `seed ${seed}: invalid ${state.phase} at ${state.route.currentId}`);
    if (state.phase === 'combat') {
      const healing = state.potions.find(potion => potion.id === 'healing'); if (healing && state.hp <= state.maxHp - 20) state = transition(state, { type: 'usePotion', potionId: healing.uid });
      const fire = state.potions.find(potion => potion.id === 'fire'); if (fire && (getEnemies(state).some(enemy => enemy.hp <= 20) || state.encounterKind === 'boss')) state = transition(state, { type: 'usePotion', potionId: fire.uid, targetUid: [...getEnemies(state)].sort((a, b) => a.hp - b.hp)[0].uid });
      if (state.phase === 'combat') state = planTurn(state);
    } else if (state.phase === 'reward') {
      const selected = rewardPriority.find(id => state.rewards.includes(id) && state.deck.filter(cardId => cardId === id).length < (['fire', 'a_cleave', 'chain'].includes(id) ? 3 : 1));
      state = transition(state, { type: 'reward', cardId: selected ?? null });
    } else if (state.phase === 'map') {
      const priorities = state.hp < 55 ? ['rest', 'event', 'treasure', 'shop', 'battle', 'elite', 'boss'] : ['shop', 'event', 'treasure', 'rest', 'battle', 'elite', 'boss'];
      const candidates = getAvailableNodes(state); candidates.sort((a, b) => priorities.indexOf(a.type) - priorities.indexOf(b.type)); state = transition(state, { type: 'selectNode', nodeId: candidates[0].id });
    } else {
      const event = getEventView(state); let choice;
      if (event.id === 'rest') choice = state.hp < 60 ? 'rest' : 'upgrade';
      else if (event.id === 'upgrade') choice = [...event.choices].sort((a, b) => (rewardPriority.indexOf(a.cardId) === -1 ? 99 : rewardPriority.indexOf(a.cardId)) - (rewardPriority.indexOf(b.cardId) === -1 ? 99 : rewardPriority.indexOf(b.cardId)))[0].id;
      else if (event.id === 'shop') choice = event.choices.find(item => !item.disabled && item.cardId && rewardPriority.slice(0, 6).includes(item.cardId) && state.deck.filter(id => id === item.cardId).length < 3)?.id ?? 'leave';
      else if (event.id === 'treasure') choice = 'open';
      else if (event.id === 'shrine') choice = !event.choices.find(item => item.id === 'blood').disabled && !state.deck.includes('seal') ? 'blood' : !state.deck.includes('bell') ? 'debt' : 'leave';
      else if (event.id === 'mushrooms') choice = 'leave';
      else choice = 'heal';
      state = transition(state, { type: 'event', choiceId: choice });
    }
  }
  return state;
}

test('legal full-length seeded adventures can reach a boss, win, clear debts, save and restart', { timeout: 120000 }, context => {
  const defeatedBosses = new Set();
  for (const seed of [17, 1000, 1500]) {
    const state = campaign(seed);
    assert.equal(state.phase, 'victory', `seed ${seed}: ${state.phase}, hp=${state.hp}, floor=${state.nodeIndex + 1}, turn=${state.turn}, kills=${state.stats.kills}, deck=${state.deck}`);
    assert.equal(state.route.path.length, 16); assert.equal(state.route.completedIds.length, 16); assert.equal(debtTotal(state), 0); assert.ok(state.stats.battlesWon >= 6); assert.ok(state.stats.kills >= state.stats.battlesWon); assert.ok(state.stats.cardsPlayed > state.stats.battlesWon * 2); assert.ok(state.turn > state.stats.battlesWon); assert.equal(isValidSave(state), true);
    const denied = transition(state, { type: 'borrow' }); assert.equal(denied.phase, 'victory'); assert.equal(denied.stats.battlesWon, state.stats.battlesWon);
    assert.equal(createAct1Adventure(seed, { runId: 'restart' }).stats.kills, 0);
    defeatedBosses.add(state.route.bossId);
    context.diagnostic(`seed ${seed}: boss=${state.route.bossId}, hp=${state.hp}, battles=${state.stats.battlesWon}, kills=${state.stats.kills}, cards=${state.stats.cardsPlayed}, turns=${state.turn}, borrowed=${state.stats.borrowed}, repaid=${state.stats.repaid}, debtDamage=${state.stats.debtDamage}`);
  }
  assert.deepEqual([...defeatedBosses].sort(), ['guardian', 'hexaghost', 'slime_boss']);
});
