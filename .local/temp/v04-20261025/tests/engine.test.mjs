import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_DEFS, ENEMY_DEFS, createRun, transition, getEnemyIntent, debtTotal, debtSchedule, isValidSave } from '../src/engine.js';

function withCards(cardIds, options = {}) {
  const state = createRun(42);
  state.hand = cardIds.map((cardId, index) => ({ uid: `fixture-${index}`, cardId }));
  state.drawPile = [];
  state.discard = [];
  state.exhaust = [];
  return Object.assign(state, options);
}

function play(state, cardId) {
  const card = state.hand.find((held) => held.cardId === cardId);
  assert.ok(card, `Expected ${cardId} in hand`);
  return transition(state, { type: 'play', uid: card.uid });
}

function defeatCurrent(state) {
  const prepared = structuredClone(state);
  prepared.enemy.hp = 1;
  prepared.enemy.block = 0;
  prepared.hand = [{ uid: `finisher-${state.nodeIndex}`, cardId: 'brush' }];
  prepared.energy = 1;
  return play(prepared, 'brush');
}

function deepFreeze(value) {
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child);
  }
  return value;
}

test('new run is deterministic, complete, and starts with a playable five-card hand', () => {
  const state = createRun(784);
  assert.deepEqual(state, createRun(784));
  assert.notDeepEqual(state.hand, createRun(785).hand);
  assert.equal(state.phase, 'combat');
  assert.equal(state.hp, 54);
  assert.equal(state.hand.length, 5);
  assert.equal(state.drawPile.length, 5);
  assert.equal(state.deck.length, 10);
  assert.equal(state.turn, 1);
  assert.equal(state.combatTurn, 1);
  assert.equal(isValidSave(state), true);
  for (const definition of Object.values(CARD_DEFS)) {
    assert.ok(definition.name && definition.description && definition.flavor && definition.art);
    assert.ok(['attack', 'skill', 'curse', 'status'].includes(definition.type));
  }
  assert.deepEqual(['paper', 'collector', 'judge'].filter(id => ENEMY_DEFS[id]), ['paper', 'collector', 'judge']);
});

test('all combat transitions leave deeply frozen input unchanged', () => {
  const original = deepFreeze(createRun(25));
  const snapshot = JSON.stringify(original);
  transition(original, { type: 'borrow' });
  transition(original, { type: 'endTurn' });
  transition(original, { type: 'play', uid: original.hand[0].uid });
  assert.equal(JSON.stringify(original), snapshot);
});

test('borrowing grants one energy, creates two debt due exactly two global turns later, and caps at twice', () => {
  let state = createRun(8);
  state = transition(state, { type: 'borrow' });
  assert.equal(state.energy, 4);
  assert.equal(state.debts[0].dueTurn, 3);
  assert.deepEqual(debtSchedule(state), [{ dueTurn: 3, turnsUntil: 2, amount: 2, hpCost: 4 }]);
  state = transition(state, { type: 'borrow' });
  assert.equal(state.energy, 5);
  assert.equal(debtTotal(state), 4);
  assert.deepEqual(debtSchedule(state), [{ dueTurn: 3, turnsUntil: 2, amount: 4, hpCost: 8 }]);
  const rejected = transition(state, { type: 'borrow' });
  assert.equal(rejected.energy, 5);
  assert.equal(rejected.borrowedThisTurn, 2);
  assert.equal(debtTotal(rejected), 4);
  assert.match(rejected.notice, /两次/);
});

test('debt does not mature early and ignores armor when it matures', () => {
  let state = transition(createRun(11), { type: 'borrow' });
  state.enemy.intentIndex = 1;
  state = transition(state, { type: 'endTurn' });
  assert.equal(state.turn, 2);
  assert.equal(state.hp, 54);
  assert.equal(debtTotal(state), 2);
  assert.equal(state.borrowedThisTurn, 0);
  state.block = 100;
  state = transition(state, { type: 'endTurn' });
  assert.equal(state.turn, 3);
  assert.equal(state.hp, 50);
  assert.equal(debtTotal(state), 0);
  assert.equal(state.stats.defaults, 2);
  assert.equal(state.lastEvent.debtDamage, 4);
});

test('repayment consumes energy and always pays oldest debt first', () => {
  let state = withCards([], { debts: [{ id: 'later', amount: 2, dueTurn: 5 }, { id: 'first', amount: 1, dueTurn: 3 }, { id: 'middle', amount: 3, dueTurn: 4 }] });
  state = transition(state, { type: 'repay' });
  assert.equal(state.energy, 2);
  assert.deepEqual(state.debts, [{ id: 'middle', amount: 2, dueTurn: 4 }, { id: 'later', amount: 2, dueTurn: 5 }]);
  assert.equal(state.block, 3);
  assert.equal(state.repaidThisTurn, 2);
  state = transition(state, { type: 'repay' });
  assert.equal(state.block, 3);
  assert.equal(state.stats.repaid, 4);
  assert.deepEqual(state.debts, [{ id: 'later', amount: 2, dueTurn: 5 }]);
});

test('lamp triggers only on an actual repayment, once per turn, including card repayments', () => {
  let state = withCards(['vow', 'lotus'], { debts: [{ id: 'first', amount: 6, dueTurn: 9 }] });
  state = play(state, 'vow');
  assert.equal(state.block, 7);
  state = play(state, 'lotus');
  assert.equal(state.block, 15);
  state.enemy.intentIndex = 1;
  state = transition(state, { type: 'endTurn' });
  state = transition(state, { type: 'repay' });
  assert.equal(state.block, 3);
  assert.equal(state.repaidThisTurn, 2);
  const debtFree = play(withCards(['vow']), 'vow');
  assert.equal(debtFree.block, 4);
  assert.equal(debtFree.repaidThisTurn, 0);
});

test('invalid actions leave resources and cards intact and explain why', () => {
  const state = withCards(['brush'], { energy: 0 });
  const failed = play(state, 'brush');
  assert.equal(failed.energy, 0);
  assert.deepEqual(failed.hand, state.hand);
  assert.deepEqual(failed.enemy, state.enemy);
  assert.match(failed.notice, /香火不足/);
  assert.match(transition(createRun(1), { type: 'repay' }).notice, /阴债已清/);
  assert.match(transition(state, { type: 'play', uid: 'missing' }).notice, /不在手中/);
  assert.match(transition(state, null).notice, /没有生效/);
});

test('drawing, discarding, reshuffling, and exhaustion preserve card identity', () => {
  let state = withCards(['coin', 'brush']);
  state.drawPile = [{ uid: 'drawn', cardId: 'talisman' }];
  state = play(state, 'coin');
  assert.equal(state.energy, 3);
  assert.deepEqual(state.hand.map((card) => card.cardId), ['brush', 'talisman']);
  assert.equal(state.exhaust[0].cardId, 'coin');
  state = play(state, 'brush');
  assert.equal(state.discard[0].cardId, 'brush');
  state.enemy.intentIndex = 1;
  state = transition(state, { type: 'endTurn' });
  assert.equal(state.hand.length, 2);
  assert.equal(state.exhaust.length, 1);
  const instances = [...state.hand, ...state.drawPile, ...state.discard, ...state.exhaust];
  assert.equal(new Set(instances.map((card) => card.uid)).size, 3);
  assert.equal(state.energy, 3);
  assert.equal(state.block, 0);
});

test('a turn draws at most five cards and clears old armor', () => {
  let state = createRun(9);
  state.block = 100;
  state.energy = 0;
  state = transition(state, { type: 'endTurn' });
  assert.equal(state.hand.length, 5);
  assert.equal(state.discard.length, 5);
  assert.equal(state.energy, 3);
  assert.equal(state.block, 0);
  assert.equal(state.enemy.intentIndex, 1);
});

test('negative-state card combos apply damage and weakness for two player turns', () => {
  let state = withCards(['bell', 'brush', 'brush']);
  state = play(state, 'bell');
  state = play(state, 'brush');
  assert.equal(state.enemy.hp, 27);
  assert.equal(state.enemy.exposed, 2);
  state = transition(state, { type: 'endTurn' });
  assert.equal(state.enemy.exposed, 1);
  state = transition(state, { type: 'endTurn' });
  assert.equal(state.enemy.exposed, 0);
});

test('fire bypasses armor and can end combat before the enemy attack', () => {
  let state = withCards(['fire']);
  state.enemy.hp = 4;
  state.enemy.block = 20;
  state = play(state, 'fire');
  assert.equal(state.enemy.hp, 4);
  state = transition(state, { type: 'endTurn' });
  assert.equal(state.phase, 'reward');
  assert.equal(state.hp, 54);
  assert.equal(state.stats.battlesWon, 1);
});

test('fire crossing the judge half-health threshold cannot change the already announced attack', () => {
  let state = createRun(31);
  state.nodeIndex = 4;
  state.hp = 3;
  state.block = 12;
  state.enemy = { id: 'judge', hp: 47, maxHp: 92, block: 0, burn: 2, exposed: 0, intentIndex: 0 };
  assert.equal(getEnemyIntent(state).amount, 12);
  state = transition(state, { type: 'endTurn' });
  assert.equal(state.phase, 'combat');
  assert.equal(state.hp, 3);
  assert.equal(state.enemy.hp, 45);
  assert.equal(state.lastEvent.damage, 0);
  assert.equal(state.lastEvent.burnDamage, 2);
  assert.equal(getEnemyIntent(state).amount, 11);
});

test('chain benefits from debt and repays two debt on a killing blow', () => {
  let state = withCards(['chain']);
  state.enemy.hp = 11;
  state = transition(state, { type: 'borrow' });
  state = play(state, 'chain');
  assert.equal(state.phase, 'reward');
  assert.equal(debtTotal(state), 0);
  assert.equal(state.stats.repaid, 2);
  assert.equal(state.stats.damageDealt, 11);
});

test('debt, repayment, and payoff cards form distinct combinations', () => {
  let state = withCards(['blood', 'mirror', 'ferry', 'seal'], { energy: 3 });
  state.enemy.hp = 100;
  state.enemy.maxHp = 100;
  state = play(state, 'blood');
  assert.equal(debtTotal(state), 2);
  state = play(state, 'seal');
  assert.equal(state.enemy.hp, 68);
  state = play(state, 'ferry');
  assert.equal(state.energy, 2);
  assert.equal(debtTotal(state), 0);
  state = play(state, 'mirror');
  assert.equal(state.block, 16);
  assert.equal(state.exhaust.length, 2);
});

test('public intentions reflect debt, half-health rage, and escalating pursuit', () => {
  const state = createRun(32);
  assert.equal(getEnemyIntent(state).amount, 6);
  state.combatTurn = 9;
  assert.equal(getEnemyIntent(state).amount, 10);
  state.enemy.id = 'collector';
  state.combatTurn = 1;
  state.debts = [{ id: 'owed', amount: 4, dueTurn: 3 }];
  assert.equal(getEnemyIntent(state).amount, 14);
  state.enemy.intentIndex = 1;
  assert.equal(getEnemyIntent(state).kind, 'hex');
  state.enemy.id = 'judge';
  state.enemy.maxHp = 92;
  state.enemy.hp = 47;
  state.enemy.intentIndex = 0;
  assert.equal(getEnemyIntent(state).amount, 12);
  state.enemy.hp = 46;
  assert.equal(getEnemyIntent(state).amount, 15);
});

test('collector and judge actually add the debt described by their intentions', () => {
  for (const enemyId of ['collector', 'judge']) {
    let state = createRun(18);
    state.enemy.id = enemyId;
    state.enemy.intentIndex = 1;
    state = transition(state, { type: 'endTurn' });
    assert.equal(debtTotal(state), 2);
    assert.equal(state.debts[0].dueTurn, 3);
    assert.equal(state.turn, 2);
    assert.equal(state.enemy.block, enemyId === 'collector' ? 5 : 0);
  }
});

test('doing nothing cannot survive indefinitely and terminal runs reject combat actions', () => {
  let state = createRun(27);
  for (let index = 0; index < 30 && state.phase === 'combat'; index += 1) state = transition(state, { type: 'endTurn' });
  assert.equal(state.phase, 'defeat');
  assert.equal(state.hp, 0);
  assert.equal(state.lastEvent.kind, 'defeat');
  assert.equal(state.lastEvent.cause, 'enemy');
  assert.equal(isValidSave(state), true);
  const terminal = transition(state, { type: 'borrow' });
  assert.equal(terminal.phase, 'defeat');
  assert.equal(terminal.hp, 0);
  assert.equal(debtTotal(terminal), debtTotal(state));
});

test('debt can kill at the next turn start before drawing any cards', () => {
  let state = withCards(['brush'], { hp: 3, block: 100, debts: [{ id: 'due', amount: 2, dueTurn: 2 }] });
  state = transition(state, { type: 'endTurn' });
  assert.equal(state.phase, 'defeat');
  assert.equal(state.hand.length, 0);
  assert.equal(state.hp, 0);
  assert.equal(debtTotal(state), 0);
  assert.equal(state.lastEvent.kind, 'defeat');
  assert.equal(state.lastEvent.cause, 'debt');
  assert.match(state.notice, /阴债到期/);
});

test('debt loss statistics count only remaining health when a debt overkills the player', () => {
  let state = withCards([], { hp: 3, block: 100, debts: [{ id: 'lethal', amount: 4, dueTurn: 2 }] });
  assert.equal(state.stats.debtDamage, 0);
  state = transition(state, { type: 'endTurn' });
  assert.equal(state.phase, 'defeat');
  assert.equal(state.stats.defaults, 4);
  assert.equal(state.stats.debtDamage, 3);
  assert.equal(state.stats.damageTaken, 3);
  assert.equal(isValidSave(state), true);
});

test('legacy nonterminal saves reconstruct prior debt loss and then accumulate actual future loss', () => {
  let state = createRun(61);
  state.hp = 48;
  state.block = 100;
  state.debts = [{ id: 'next', amount: 2, dueTurn: 2 }];
  state.stats.defaults = 3;
  state.stats.damageTaken = 6;
  delete state.stats.debtDamage;
  state = JSON.parse(JSON.stringify(state));
  assert.equal(state.phase, 'combat');
  assert.equal(isValidSave(state), true);
  state = transition(state, { type: 'endTurn' });
  assert.equal(state.hp, 44);
  assert.equal(state.stats.defaults, 5);
  assert.equal(state.stats.debtDamage, 10);
  state.hp = 3;
  state.debts = [{ id: 'last', amount: 2, dueTurn: 3 }];
  state = transition(state, { type: 'endTurn' });
  assert.equal(state.phase, 'defeat');
  assert.equal(state.stats.defaults, 7);
  assert.equal(state.stats.debtDamage, 13);
  assert.equal(isValidSave(state), true);
});

test('combat rewards, intervening events, and the next battle preserve debt and advance global time exactly once', () => {
  let state = transition(createRun(20), { type: 'borrow' });
  state = defeatCurrent(state);
  assert.equal(state.phase, 'reward');
  assert.equal(state.rewards.length, 3);
  assert.equal(debtTotal(state), 2);
  const invalid = transition(state, { type: 'reward', cardId: 'brush' });
  assert.equal(invalid.phase, 'reward');
  const reward = state.rewards[0];
  state = transition(state, { type: 'reward', cardId: reward });
  assert.equal(state.phase, 'event');
  assert.equal(state.nodeIndex, 1);
  assert.equal(state.turn, 1);
  assert.ok(state.deck.includes(reward));
  assert.equal(debtTotal(state), 2);
  state = transition(state, { type: 'event', choiceId: 'warmth' });
  assert.equal(state.phase, 'combat');
  assert.equal(state.nodeIndex, 2);
  assert.equal(state.enemy.id, 'collector');
  assert.equal(state.turn, 2);
  assert.equal(state.combatTurn, 1);
  assert.equal(debtTotal(state), 2);
  assert.equal(state.debts[0].dueTurn, 3);
  assert.equal(state.hand.length + state.drawPile.length, 11);
  state.block = 100;
  state = transition(state, { type: 'endTurn' });
  assert.equal(state.hp, 50);
  assert.equal(debtTotal(state), 0);
});

test('events reject disabled choices, heal within maximum, and return exhausted cards next combat', () => {
  let state = withCards(['coin']);
  state = play(state, 'coin');
  state = defeatCurrent(state);
  state.hp = 4;
  state = transition(state, { type: 'reward', cardId: null });
  const failed = transition(state, { type: 'event', choiceId: 'fire' });
  assert.equal(failed.phase, 'event');
  assert.equal(failed.hp, 4);
  state = transition(state, { type: 'event', choiceId: 'warmth' });
  assert.equal(state.hp, 12);
  assert.equal(state.exhaust.length, 0);
  assert.equal([...state.hand, ...state.drawPile].filter((card) => card.cardId === 'coin').length, 1);
});

test('soup event leads to boss and final victory clears outstanding debt', () => {
  let state = defeatCurrent(createRun(5));
  state = transition(state, { type: 'reward', cardId: null });
  state = transition(state, { type: 'event', choiceId: 'warmth' });
  state = defeatCurrent(state);
  state = transition(state, { type: 'reward', cardId: null });
  assert.equal(state.nodeIndex, 3);
  assert.equal(state.event.id, 'soup');
  state.hp = 20;
  state.debts = [{ id: 'owed', amount: 2, dueTurn: 8 }];
  state = transition(state, { type: 'event', choiceId: 'soup' });
  assert.equal(state.hp, 34);
  assert.equal(debtTotal(state), 0);
  assert.equal(state.enemy.id, 'judge');
  assert.equal(state.turn, 3);
  state = transition(state, { type: 'borrow' });
  state = defeatCurrent(state);
  assert.equal(state.phase, 'victory');
  assert.equal(state.nodeIndex, 4);
  assert.equal(state.stats.battlesWon, 3);
  assert.equal(debtTotal(state), 0);
  assert.equal(state.lastEvent.forgiven, 2);
  assert.equal(isValidSave(state), true);
});

test('save validation rejects corrupted inputs and starting again resets all run progress', () => {
  const state = createRun(46);
  assert.equal(isValidSave(JSON.parse(JSON.stringify(state))), true);
  for (const mutation of [
    { version: 200 }, { hp: -1 }, { phase: 'unknown' }, { hand: [{ uid: 'bad', cardId: 'unknown' }] },
    { debts: [{ id: 'bad', amount: -3, dueTurn: 0 }] }, { enemy: { ...state.enemy, hp: -1 } },
    { nextUid: undefined }, { log: new Array(9).fill('too many') },
    { stats: { ...state.stats, debtDamage: -1 } }, { stats: { ...state.stats, debtDamage: 1.5 } },
  ]) assert.equal(isValidSave({ ...state, ...mutation }), false);
  assert.equal(isValidSave(null), false);
  const advanced = transition(transition(state, { type: 'borrow' }), { type: 'endTurn' });
  assert.notEqual(advanced.turn, createRun(46).turn);
  assert.deepEqual(createRun(46), state);
});

function evaluateTurn(state) {
  if (state.phase === 'reward' || state.phase === 'victory') return 100000 + state.hp * 2 - debtTotal(state) * 4;
  if (state.phase === 'defeat') return -100000;
  const future = transition(state, { type: 'endTurn' });
  if (future.phase === 'defeat') return -100000;
  if (future.phase === 'reward' || future.phase === 'victory') return 100000 + future.hp * 2 - debtTotal(future) * 4;
  return future.hp * 2 + (future.enemy.maxHp - future.enemy.hp) * 1.35 - debtTotal(future) * 4 + future.enemy.burn * 2 + future.enemy.exposed * 2;
}

function planTurn(initial) {
  let frontier = [{ state: initial, score: evaluateTurn(initial) }];
  let best = frontier[0];
  for (let depth = 0; depth < 8; depth += 1) {
    const expanded = [];
    const seen = new Set();
    for (const candidate of frontier) {
      if (candidate.state.phase !== 'combat') continue;
      const actions = [];
      const cardIds = new Set();
      for (const card of candidate.state.hand) {
        if (CARD_DEFS[card.cardId].cost <= candidate.state.energy && !cardIds.has(card.cardId)) {
          actions.push({ type: 'play', uid: card.uid });
          cardIds.add(card.cardId);
        }
      }
      if (candidate.state.borrowedThisTurn < 2) actions.push({ type: 'borrow' });
      if (candidate.state.energy > 0 && debtTotal(candidate.state) > 0) actions.push({ type: 'repay' });
      for (const action of actions) {
        const next = transition(candidate.state, action);
        const key = JSON.stringify([next.energy, next.hand.map((card) => card.uid).sort(), next.enemy, next.debts, next.block, next.borrowedThisTurn]);
        if (seen.has(key)) continue;
        seen.add(key);
        const planned = { state: next, score: evaluateTurn(next) };
        if (planned.score > best.score) best = planned;
        expanded.push(planned);
      }
    }
    expanded.sort((first, second) => second.score - first.score);
    frontier = expanded.slice(0, 28);
    if (frontier.length === 0) break;
  }
  return best.state.phase === 'combat' ? transition(best.state, { type: 'endTurn' }) : best.state;
}

test('a legal strategy using defense, borrowing, repayment, and rewards can win multiple seeded full runs', () => {
  for (const seed of [17, 73, 251]) {
    let state = createRun(seed);
    for (let step = 0; step < 60 && !['victory', 'defeat'].includes(state.phase); step += 1) {
      assert.equal(isValidSave(state), true);
      if (state.phase === 'combat') state = planTurn(state);
      else if (state.phase === 'reward') {
        const priority = ['fire', 'ferry', 'seal', 'bell', 'verdict', 'ledger', 'lotus', 'blood', 'mirror'];
        const cardId = priority.find((candidate) => state.rewards.includes(candidate));
        state = transition(state, { type: 'reward', cardId });
      } else state = transition(state, { type: 'event', choiceId: state.event.id === 'market' && state.hp > 12 ? 'fire' : state.event.id === 'market' ? 'warmth' : 'soup' });
    }
    assert.equal(state.phase, 'victory', `seed ${seed} finished ${state.phase}, hp ${state.hp}, node ${state.nodeIndex}, turn ${state.turn}`);
    assert.equal(state.stats.battlesWon, 3);
    assert.ok(state.stats.cardsPlayed > 20);
    assert.ok(state.stats.borrowed > 0);
    assert.ok(state.stats.repaid > 0);
    assert.equal(isValidSave(state), true);
  }
});
