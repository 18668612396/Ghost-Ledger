import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_DEFS, createRun, createAdventure, transition, getAvailableNodes, getEnemyIntent, debtTotal, isValidSave, migrateRun } from '../src/engine.js';
import { createRoute, isValidRoute } from '../src/journey.js';
import { MODES, getMode, createModeRun } from '../src/modes.js';
import { createProfile, settleRun } from '../src/progression.js';

test('reloading an unmigrated legacy ending cannot award its progression twice', () => {
  let legacy = createRun(145);
  while (legacy.phase === 'combat') legacy = transition(legacy, { type: 'endTurn' });
  const firstLoad = migrateRun(JSON.parse(JSON.stringify(legacy)));
  const secondLoad = migrateRun(JSON.parse(JSON.stringify(legacy)));
  assert.equal(firstLoad.runId, secondLoad.runId);
  const first = settleRun(createProfile(), firstLoad);
  const second = settleRun(first.profile, secondLoad);
  assert.equal(first.profile.totalRuns, 1);
  assert.equal(second.alreadySettled, true);
  assert.equal(second.profile.totalRuns, 1);
});

function adventure(seed = 17, options = {}) {
  return createAdventure(seed, { runId: `test-${seed}`, ...options });
}

function chooseNode(state, nodeId) {
  assert.ok(getAvailableNodes(state).some(node => node.id === nodeId), `Expected ${nodeId} to be available`);
  return transition(state, { type: 'selectNode', nodeId });
}

function finishBattle(state) {
  const prepared = structuredClone(state);
  prepared.enemy.hp = 1;
  prepared.enemy.block = 0;
  prepared.hand = [{ uid: `finish-${state.nodeIndex}`, cardId: 'brush' }];
  prepared.energy = 1;
  return transition(prepared, { type: 'play', uid: prepared.hand[0].uid });
}

function firstFork(options = {}) {
  return transition(finishBattle(chooseNode(adventure(17, options), 'paper')), { type: 'reward', cardId: null });
}

function secondFork(options = {}) {
  let state = firstFork(options);
  state = chooseNode(state, 'rest');
  state = transition(state, { type: 'event', choiceId: 'rest' });
  state = chooseNode(state, 'collector');
  return transition(finishBattle(state), { type: 'reward', cardId: null });
}

test('adventures start on a deterministic seven-node branching map with all battle fields present', () => {
  const state = adventure(19);
  assert.equal(state.phase, 'map');
  assert.equal(state.modeId, 'classic');
  assert.equal(state.runId, 'test-19');
  assert.equal(state.relicId, 'lamp');
  assert.equal(state.difficulty, 0);
  assert.equal(state.hp, 54);
  assert.equal(state.hand.length, 0);
  assert.equal(state.deck.length, 10);
  assert.equal(state.route.nodes.length, 7);
  assert.deepEqual(state.route.path, []);
  assert.equal(state.route.currentId, null);
  assert.deepEqual(getAvailableNodes(state).map(node => node.id), ['paper']);
  assert.deepEqual(state.route, adventure(19).route);
  assert.equal(isValidSave(state), true);
  assert.notEqual(createAdventure(19).runId, createAdventure(19).runId);
  for (const seed of [0, 1, 2, 3, 999]) assert.equal(isValidRoute(createRoute(seed)), true);
  assert.notEqual(createRoute(0).nodes.find(node => node.id === 'rest').column, createRoute(1).nodes.find(node => node.id === 'rest').column);
  assert.notEqual(createRoute(0).nodes.find(node => node.id === 'soup').column, createRoute(2).nodes.find(node => node.id === 'soup').column);
});

test('selecting map nodes is pure and rejects jumping, backwards movement, and unfinished encounters', () => {
  const initial = adventure();
  const original = structuredClone(initial);
  const jump = transition(initial, { type: 'selectNode', nodeId: 'judge' });
  assert.equal(jump.phase, 'map');
  assert.deepEqual(jump.route.path, []);
  assert.match(jump.notice, /不能跳层/);
  assert.deepEqual(initial, original);
  let state = chooseNode(initial, 'paper');
  assert.equal(state.phase, 'combat');
  assert.deepEqual(state.route.path, ['paper']);
  assert.equal(state.turn, 1);
  assert.equal(state.hand.length, 5);
  assert.deepEqual(getAvailableNodes(state), []);
  const unfinished = transition(state, { type: 'selectNode', nodeId: 'rest' });
  assert.equal(unfinished.phase, 'combat');
  assert.deepEqual(unfinished.route, state.route);
  state = finishBattle(state);
  assert.equal(state.phase, 'reward');
  assert.deepEqual(state.route.completedIds, []);
  assert.equal(transition(state, { type: 'selectNode', nodeId: 'market' }).phase, 'reward');
  state = transition(state, { type: 'reward', cardId: null });
  assert.equal(state.phase, 'map');
  assert.deepEqual(state.route.completedIds, ['paper']);
  assert.deepEqual(new Set(getAvailableNodes(state).map(node => node.id)), new Set(['rest', 'market']));
  assert.deepEqual(transition(state, { type: 'selectNode', nodeId: 'paper' }).route, state.route);
  assert.deepEqual(transition(state, { type: 'selectNode', nodeId: 'collector' }).route, state.route);
  state = chooseNode(state, 'rest');
  assert.equal(transition(state, { type: 'selectNode', nodeId: 'market' }).event.id, 'rest');
  state = transition(state, { type: 'event', choiceId: 'rest' });
  assert.deepEqual(getAvailableNodes(state).map(node => node.id), ['collector']);
  assert.deepEqual(transition(state, { type: 'selectNode', nodeId: 'market' }).route, state.route);
  assert.equal(isValidSave(state), true);
});

test('resting and praying offer different benefits without advancing global time', () => {
  const fork = firstFork();
  fork.hp = 30;
  fork.debts = [{ id: 'late', amount: 2, dueTurn: 5 }, { id: 'early', amount: 4, dueTurn: 3 }];
  const event = chooseNode(fork, 'rest');
  assert.equal(event.event.id, 'rest');
  assert.equal(event.event.choices.length, 2);
  const healed = transition(event, { type: 'event', choiceId: 'rest' });
  assert.equal(healed.hp, 40);
  assert.equal(debtTotal(healed), 6);
  const repaid = transition(event, { type: 'event', choiceId: 'repay' });
  assert.equal(repaid.hp, 32);
  assert.deepEqual(repaid.debts, [{ id: 'late', amount: 2, dueTurn: 5 }]);
  assert.equal(repaid.block, 0);
  assert.equal(repaid.turn, fork.turn);
  assert.equal(repaid.phase, 'map');
  assert.equal(repaid.lastEvent.repaid, 4);
  const debtFreeEvent = chooseNode(firstFork(), 'rest');
  assert.equal(debtFreeEvent.event.choices.find(choice => choice.id === 'repay').disabled, true);
  assert.equal(transition(debtFreeEvent, { type: 'event', choiceId: 'repay' }).phase, 'event');
});

test('market card purchases, healing, and borrowing return to the same map stage', () => {
  const fork = firstFork();
  fork.hp = 40;
  const market = chooseNode(fork, 'market');
  const healed = transition(market, { type: 'event', choiceId: 'warmth' });
  assert.equal(healed.hp, 48);
  const bought = transition(market, { type: 'event', choiceId: 'fire' });
  assert.equal(bought.hp, 36);
  assert.ok(bought.deck.includes('fire'));
  const borrowed = transition(market, { type: 'event', choiceId: 'ferry' });
  assert.ok(borrowed.deck.includes('ferry'));
  assert.equal(debtTotal(borrowed), 2);
  assert.equal(borrowed.debts[0].dueTurn, 3);
  for (const result of [healed, bought, borrowed]) {
    assert.equal(result.phase, 'map');
    assert.equal(result.turn, 1);
    assert.equal(result.nodeIndex, 1);
    assert.deepEqual(result.route.path, ['paper', 'market']);
    assert.deepEqual(result.route.completedIds, result.route.path);
    assert.equal(isValidSave(result), true);
  }
});

test('soup rest and shrine choices provide real route-dependent rewards', () => {
  const fork = secondFork();
  fork.hp = 24;
  fork.debts = [{ id: 'owed', amount: 4, dueTurn: 6 }];
  const soup = transition(chooseNode(fork, 'soup'), { type: 'event', choiceId: 'soup' });
  assert.equal(soup.hp, 38);
  assert.equal(debtTotal(soup), 2);
  assert.equal(soup.turn, 2);
  const shrine = chooseNode(fork, 'shrine');
  const signed = transition(shrine, { type: 'event', choiceId: 'seal' });
  assert.equal(signed.hp, 18);
  assert.ok(signed.deck.includes('seal'));
  const bell = transition(shrine, { type: 'event', choiceId: 'bell' });
  assert.equal(bell.hp, 24);
  assert.ok(bell.deck.includes('bell'));
  assert.equal(debtTotal(bell), 6);
  assert.ok(bell.debts.some(debt => debt.amount === 2 && debt.dueTurn === 4));
  const avoided = transition(shrine, { type: 'event', choiceId: 'leave' });
  assert.equal(avoided.hp, 28);
  assert.equal(debtTotal(avoided), 4);
  for (const result of [soup, signed, bell, avoided]) {
    assert.equal(result.phase, 'map');
    assert.deepEqual(getAvailableNodes(result).map(node => node.id), ['judge']);
    assert.equal(result.turn, 2);
    assert.equal(isValidSave(result), true);
  }
});

test('shrine rejects lethal blood offerings and unknown choices without consuming the node', () => {
  const fork = secondFork();
  fork.hp = 6;
  const shrine = chooseNode(fork, 'shrine');
  assert.equal(shrine.event.choices.find(choice => choice.id === 'seal').disabled, true);
  for (const choiceId of ['seal', 'unknown']) {
    const failed = transition(shrine, { type: 'event', choiceId });
    assert.equal(failed.hp, 6);
    assert.equal(failed.phase, 'event');
    assert.deepEqual(failed.route.completedIds, shrine.route.completedIds);
    assert.deepEqual(failed.deck, shrine.deck);
  }
});

test('debt survives the map and events; only entering a later battle advances its deadline', () => {
  let state = chooseNode(adventure(), 'paper');
  state = transition(state, { type: 'borrow' });
  state = transition(finishBattle(state), { type: 'reward', cardId: null });
  assert.equal(state.turn, 1);
  assert.equal(state.debts[0].dueTurn, 3);
  state = chooseNode(state, 'rest');
  state = transition(state, { type: 'event', choiceId: 'rest' });
  assert.equal(state.turn, 1);
  assert.equal(debtTotal(state), 2);
  state = chooseNode(state, 'collector');
  assert.equal(state.turn, 2);
  assert.equal(state.combatTurn, 1);
  assert.equal(state.hp, 54);
  state.block = 100;
  state = transition(state, { type: 'endTurn' });
  assert.equal(state.turn, 3);
  assert.equal(state.hp, 50);
  assert.equal(debtTotal(state), 0);
  assert.equal(state.stats.debtDamage, 4);
  assert.equal(isValidSave(state), true);
});

test('lamp and bell have different effects, and bell protection resets per battle only', () => {
  let bell = chooseNode(adventure(55, { relicId: 'bell' }), 'paper');
  assert.equal(bell.block, 6);
  bell = transition(bell, { type: 'borrow' });
  bell = transition(bell, { type: 'repay' });
  assert.equal(bell.block, 6);
  assert.equal(bell.lastEvent.block, 0);
  assert.doesNotMatch(bell.notice, /引魂灯/);
  bell = transition(bell, { type: 'endTurn' });
  assert.equal(bell.block, 0);
  assert.equal(bell.hp, 54);
  bell = transition(finishBattle(bell), { type: 'reward', cardId: null });
  bell = transition(chooseNode(bell, 'rest'), { type: 'event', choiceId: 'rest' });
  bell = chooseNode(bell, 'collector');
  assert.equal(bell.block, 6);
  let lamp = chooseNode(adventure(55), 'paper');
  assert.equal(lamp.block, 0);
  lamp = transition(transition(lamp, { type: 'borrow' }), { type: 'repay' });
  assert.equal(lamp.block, 3);
  assert.equal(isValidSave(bell), true);
});

test('higher difficulty scales enemy health and every attack while preserving announced intentions', () => {
  let state = chooseNode(adventure(39, { difficulty: 1 }), 'paper');
  assert.equal(state.hp, 54);
  assert.equal(state.maxHp, 54);
  assert.equal(state.enemy.maxHp, 44);
  assert.equal(getEnemyIntent(state).amount, 8);
  assert.match(getEnemyIntent(state).detail, /额外增加 2/);
  state.block = 6;
  state = transition(state, { type: 'endTurn' });
  assert.equal(state.hp, 52);
  assert.equal(getEnemyIntent(state).kind, 'defend');
  assert.equal(getEnemyIntent(state).amount, 6);
  let later = secondFork({ difficulty: 1 });
  assert.equal(later.enemy.maxHp, 72);
  later = transition(chooseNode(later, 'soup'), { type: 'event', choiceId: 'soup' });
  later = chooseNode(later, 'judge');
  assert.equal(later.enemy.maxHp, 106);
  assert.equal(getEnemyIntent(later).amount, 14);
  later.enemy.intentIndex = 1;
  assert.equal(getEnemyIntent(later).amount, 10);
});

test('explicit reward pools remain isolated, unique, and safe from caller mutations', () => {
  const pool = ['bell', 'seal', 'ferry', 'bell'];
  let state = adventure(19, { rewardPool: pool });
  pool.push('verdict');
  assert.deepEqual(state.rewardPool, ['bell', 'seal', 'ferry']);
  state = finishBattle(chooseNode(state, 'paper'));
  assert.deepEqual(new Set(state.rewards), new Set(['bell', 'seal', 'ferry']));
  assert.equal(state.rewards.length, 3);
  assert.equal(isValidSave(state), true);
  assert.equal(transition(state, { type: 'reward', cardId: 'verdict' }).phase, 'reward');
  for (const options of [{ rewardPool: [] }, { rewardPool: ['fire', 'bell'] }, { rewardPool: ['fire', 'bell', 'missing'] }, { rewardPool: 'fire' }, { relicId: 'unknown' }, { difficulty: 2 }, { runId: '' }]) assert.throws(() => adventure(3, options));
});

test('mode registration exposes one playable module and refuses all unavailable modes', () => {
  assert.deepEqual(MODES.map(mode => mode.id), ['classic', 'trial', 'endless']);
  assert.equal(MODES.filter(mode => !mode.disabled).length, 1);
  assert.equal(getMode('classic').name, '阴路夜巡');
  assert.equal(getMode('unknown'), null);
  const state = createModeRun('classic', 82, { runId: 'registered', relicId: 'bell', difficulty: 1 });
  assert.equal(state.phase, 'map');
  assert.equal(state.runId, 'registered');
  assert.equal(state.relicId, 'bell');
  assert.equal(state.difficulty, 1);
  for (const modeId of ['trial', 'endless', 'unknown']) assert.throws(() => createModeRun(modeId, 1));
});

test('legacy combat, reward, event, victory, and defeat saves migrate in place without rerolls', () => {
  let legacy = transition(createRun(71), { type: 'borrow' });
  const snapshots = [legacy];
  legacy = finishBattle(legacy); snapshots.push(legacy);
  legacy = transition(legacy, { type: 'reward', cardId: null }); snapshots.push(legacy);
  legacy = transition(legacy, { type: 'event', choiceId: 'warmth' }); snapshots.push(legacy);
  legacy = finishBattle(legacy); snapshots.push(legacy);
  legacy = transition(legacy, { type: 'reward', cardId: null }); snapshots.push(legacy);
  legacy = transition(legacy, { type: 'event', choiceId: 'soup' }); snapshots.push(legacy);
  legacy = finishBattle(legacy); snapshots.push(legacy);
  const dead = createRun(6);
  dead.hp = 1;
  snapshots.push(transition(dead, { type: 'endTurn' }));
  for (const saved of snapshots) {
    const original = structuredClone(saved);
    assert.equal(isValidSave(saved), true);
    const migrated = migrateRun(saved);
    assert.ok(migrated, `Migration failed for ${saved.phase} at node ${saved.nodeIndex}`);
    assert.equal(isValidSave(migrated), true);
    assert.deepEqual(saved, original);
    for (const field of ['version', 'phase', 'hp', 'maxHp', 'energy', 'block', 'hand', 'drawPile', 'discard', 'exhaust', 'deck', 'debts', 'seed', 'rngState', 'turn', 'combatTurn', 'nodeIndex', 'enemy', 'stats', 'event', 'rewards']) assert.deepEqual(migrated[field], saved[field], field);
    assert.equal(migrated.relicId, 'lamp');
    assert.equal(migrated.route.currentId, ['paper', 'market', 'collector', 'soup', 'judge'][saved.nodeIndex]);
    assert.deepEqual(migrated.route.path, ['paper', 'market', 'collector', 'soup', 'judge'].slice(0, saved.nodeIndex + 1));
  }
  const migratedReward = migrateRun(snapshots[1]);
  const afterReward = transition(migratedReward, { type: 'reward', cardId: null });
  assert.equal(afterReward.phase, 'map');
  assert.equal(getAvailableNodes(afterReward).length, 2);
  const migratedEvent = migrateRun(snapshots[2]);
  const afterEvent = transition(migratedEvent, { type: 'event', choiceId: 'warmth' });
  assert.equal(afterEvent.phase, 'map');
  assert.deepEqual(getAvailableNodes(afterEvent).map(node => node.id), ['collector']);
  assert.equal(afterEvent.turn, snapshots[2].turn);
});

test('map saves clone without resetting progress and corrupt graphs or illegal paths are rejected', () => {
  const state = secondFork();
  const clone = migrateRun(state);
  assert.deepEqual(clone, state);
  assert.notEqual(clone, state);
  assert.notEqual(clone.route, state.route);
  const mutations = [
    saved => { saved.route = null; },
    saved => { saved.route.nodes[0].next.push('judge'); },
    saved => { saved.route.nodes[1].column = saved.route.nodes[2].column; },
    saved => { saved.route.nodes[0].type = 'rest'; },
    saved => { saved.route.nodes[0].enemyId = 'judge'; },
    saved => { saved.route.nodes[0].stageIndex = 4; },
    saved => { saved.route.nodes[0].id = 'other'; },
    saved => { saved.route.path = ['paper', 'judge']; saved.route.completedIds = ['paper']; saved.route.currentId = 'judge'; },
    saved => { saved.route.path.push('paper'); },
    saved => { saved.route.currentId = 'paper'; },
    saved => { saved.route.completedIds.reverse(); },
    saved => { saved.route.completedIds.pop(); },
    saved => { saved.nodeIndex = 4; },
    saved => { saved.modeId = 'endless'; },
    saved => { saved.runId = ''; },
    saved => { saved.relicId = 'other'; },
    saved => { saved.difficulty = 2; },
    saved => { delete saved.route; },
  ];
  for (const mutate of mutations) {
    const corrupt = structuredClone(state);
    mutate(corrupt);
    assert.equal(isValidSave(corrupt), false, mutate.toString());
    assert.equal(migrateRun(corrupt), null);
  }
});

test('boss victory completes the chosen path and clears debt; entry debt can also end the run', () => {
  let state = secondFork();
  state = transition(chooseNode(state, 'shrine'), { type: 'event', choiceId: 'bell' });
  state = chooseNode(state, 'judge');
  assert.equal(state.turn, 3);
  assert.equal(state.route.completedIds.length, 4);
  assert.equal(debtTotal(state), 2);
  state = finishBattle(state);
  assert.equal(state.phase, 'victory');
  assert.deepEqual(state.route.path, ['paper', 'rest', 'collector', 'shrine', 'judge']);
  assert.deepEqual(state.route.completedIds, state.route.path);
  assert.equal(state.lastEvent.forgiven, 2);
  assert.equal(debtTotal(state), 0);
  assert.equal(isValidSave(state), true);
  assert.deepEqual(getAvailableNodes(state), []);
  let doomed = secondFork();
  doomed = transition(chooseNode(doomed, 'soup'), { type: 'event', choiceId: 'soup' });
  doomed.hp = 3;
  doomed.debts = [{ id: 'due', amount: 2, dueTurn: 3 }];
  doomed = chooseNode(doomed, 'judge');
  assert.equal(doomed.phase, 'defeat');
  assert.equal(doomed.lastEvent.cause, 'debt');
  assert.equal(doomed.hand.length, 0);
  assert.equal(doomed.route.path.at(-1), 'judge');
  assert.equal(doomed.route.completedIds.length, 4);
  assert.equal(isValidSave(doomed), true);
});

function turnScore(state) {
  if (['reward', 'victory'].includes(state.phase)) return 100000 + state.hp * 2 - debtTotal(state) * 4;
  const future = transition(state, { type: 'endTurn' });
  if (future.phase === 'defeat') return -100000;
  if (['reward', 'victory'].includes(future.phase)) return 100000 + future.hp * 2 - debtTotal(future) * 4;
  return future.hp * 2 + (future.enemy.maxHp - future.enemy.hp) * 1.35 - debtTotal(future) * 4 + future.enemy.burn * 2 + future.enemy.exposed * 2;
}

function legalCombatTurn(initial) {
  let frontier = [{ state: initial, score: turnScore(initial) }];
  let best = frontier[0];
  for (let depth = 0; depth < 8; depth += 1) {
    const expanded = [];
    const seen = new Set();
    for (const candidate of frontier) {
      if (candidate.state.phase !== 'combat') continue;
      const uniqueCards = [...new Map(candidate.state.hand.map(card => [card.cardId, card])).values()];
      const actions = uniqueCards.filter(card => CARD_DEFS[card.cardId].cost <= candidate.state.energy).map(card => ({ type: 'play', uid: card.uid }));
      if (candidate.state.borrowedThisTurn < 2) actions.push({ type: 'borrow' });
      if (candidate.state.energy > 0 && debtTotal(candidate.state) > 0) actions.push({ type: 'repay' });
      for (const action of actions) {
        const next = transition(candidate.state, action);
        const key = JSON.stringify([next.energy, next.hand.map(card => card.uid).sort(), next.enemy, next.debts, next.block, next.borrowedThisTurn]);
        if (seen.has(key)) continue;
        seen.add(key);
        const candidateTurn = { state: next, score: turnScore(next) };
        if (candidateTurn.score > best.score) best = candidateTurn;
        expanded.push(candidateTurn);
      }
    }
    frontier = expanded.sort((first, second) => second.score - first.score).slice(0, 28);
    if (frontier.length === 0) break;
  }
  return best.state.phase === 'combat' ? transition(best.state, { type: 'endTurn' }) : best.state;
}

test('complete legal runs can win both branch routes with either starting relic', () => {
  for (const scenario of [{ seed: 17, relicId: 'lamp', branch: ['market', 'soup'] }, { seed: 73, relicId: 'bell', branch: ['rest', 'shrine'] }]) {
    let state = adventure(scenario.seed, { relicId: scenario.relicId });
    for (let step = 0; step < 80 && !['victory', 'defeat'].includes(state.phase); step += 1) {
      assert.equal(isValidSave(state), true, `invalid ${state.phase} at ${state.nodeIndex}`);
      if (state.phase === 'map') {
        const available = getAvailableNodes(state);
        const preferred = available.find(node => scenario.branch.includes(node.id)) ?? available[0];
        state = chooseNode(state, preferred.id);
      } else if (state.phase === 'combat') state = legalCombatTurn(state);
      else if (state.phase === 'reward') {
        const cardId = ['fire', 'ferry', 'seal', 'bell', 'verdict', 'ledger', 'lotus', 'blood', 'mirror'].find(candidate => state.rewards.includes(candidate));
        state = transition(state, { type: 'reward', cardId });
      } else {
        const choiceId = { market: state.hp > 12 ? 'fire' : 'warmth', rest: 'rest', soup: 'soup', shrine: state.hp > 22 ? 'seal' : 'leave' }[state.event.id];
        state = transition(state, { type: 'event', choiceId });
      }
    }
    assert.equal(state.phase, 'victory', `${scenario.relicId} ended ${state.phase} at node ${state.nodeIndex} with ${state.hp} HP`);
    assert.equal(state.stats.battlesWon, 3);
    assert.equal(state.route.path.length, 5);
    assert.deepEqual(state.route.completedIds, state.route.path);
    assert.ok(state.stats.cardsPlayed > 20);
    assert.equal(isValidSave(state), true);
  }
});
