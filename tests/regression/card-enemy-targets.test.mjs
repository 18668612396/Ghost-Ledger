import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdventure, transition, getAvailableNodes, getCardEnemyTargets } from '../../game/src/engine.js';
import { createConfiguredEnemy } from '../../game/src/runtime/world.js';
import { makeCard } from '../../game/src/runtime/effects.js';

function scenario(ids = ['ic_strike']) {
  let state = createAdventure(951, { runId: 'card-enemy-targets' });
  state = transition(state, { type: 'selectNode', nodeId: getAvailableNodes(state)[0].id });
  assert.equal(state.phase, 'combat');
  state.enemies = ['jaw', 'cultist', 'looter'].map((id, index) => createConfiguredEnemy(id, state, index, state.contentSnapshot, () => .3));
  state.hand = ids.map(id => makeCard(state, id));
  state.energy = 3;
  return state;
}
const options = state => state.enemies.map(enemy => ({ uid: enemy.uid, eligible: true, reason: '' }));

test('single-enemy cards expose every living target by instance, held uid or definition id', () => {
  const state = scenario();
  for (const card of [state.hand[0], state.hand[0].uid, state.hand[0].cardId]) assert.deepEqual(getCardEnemyTargets(state, card), options(state));
});

test('group and random-enemy cards expose all possible enemies while self cards expose none', () => {
  const state = scenario(['ic_cleave', 'ic_sword_boomerang', 'ic_defend']);
  assert.deepEqual(getCardEnemyTargets(state, state.hand[0]), options(state));
  assert.deepEqual(getCardEnemyTargets(state, state.hand[1]), options(state));
  assert.deepEqual(getCardEnemyTargets(state, state.hand[2]), []);
});

test('unaffordable, entangled and globally conditional cards cannot advertise available targets', () => {
  const state = scenario(['ic_strike', 'ic_clash', 'ic_defend']);
  state.energy = 0;
  assert.ok(getCardEnemyTargets(state, state.hand[0]).every(target => !target.eligible && target.reason === '香火不足'));
  state.energy = 3; state.entangled = 1;
  assert.ok(getCardEnemyTargets(state, state.hand[0]).every(target => !target.eligible && target.reason.includes('缠绕')));
  state.entangled = 0;
  assert.ok(getCardEnemyTargets(state, state.hand[1]).every(target => !target.eligible && target.reason === '其他手牌必须全为攻击牌。'));
});

test('pending choices, noncombat scenes and cards outside the hand have no eligible targets', () => {
  const state = scenario();
  state.pendingChoice = {};
  assert.ok(getCardEnemyTargets(state, state.hand[0]).every(target => !target.eligible && target.reason.includes('选牌')));
  state.pendingChoice = null; state.phase = 'map';
  assert.ok(getCardEnemyTargets(state, state.hand[0]).every(target => !target.eligible && target.reason.includes('战斗')));
  state.phase = 'combat';
  const removed = state.hand.shift();
  assert.ok(getCardEnemyTargets(state, removed).every(target => !target.eligible && target.reason.includes('手中')));
});

test('dead and departed enemies disappear from eligibility without treating defensive states as immunity', () => {
  const state = scenario();
  state.enemies[0].hp = 0; state.enemies[1].escaped = true;
  state.enemies[2].block = 999; state.enemies[2].artifact = 5;
  assert.deepEqual(getCardEnemyTargets(state, state.hand[0]), [{ uid: state.enemies[2].uid, eligible: true, reason: '' }]);
  state.enemies[2].dead = true;
  assert.deepEqual(getCardEnemyTargets(state, state.hand[0]), []);
});

test('repeated target queries never mutate state or consume random choices', () => {
  const state = scenario(['ic_sword_boomerang']);
  const before = structuredClone(state);
  for (let index = 0; index < 25; index++) assert.deepEqual(getCardEnemyTargets(state, state.hand[0]), options(state));
  assert.deepEqual(state, before);
  assert.deepEqual(getCardEnemyTargets(null, 'ic_strike'), []);
  assert.deepEqual(getCardEnemyTargets(state, null), []);
});

test('play validation accepts advertised targets and rejects an unavailable cast without paying', () => {
  const state = scenario(), held = state.hand[0];
  const target = getCardEnemyTargets(state, held)[1];
  const played = transition(state, { type: 'play', uid: held.uid, targetUid: target.uid });
  assert.notEqual(played.lastEvent.kind, 'invalid');
  assert.equal(played.enemies[1].hp, state.enemies[1].hp - 6);
  assert.equal(played.energy, 2);
  state.energy = 0;
  const denied = transition(state, { type: 'play', uid: held.uid, targetUid: target.uid });
  assert.equal(denied.lastEvent.kind, 'invalid');
  assert.equal(denied.energy, 0);
  assert.deepEqual(denied.hand, state.hand);
  assert.deepEqual(denied.enemies, state.enemies);
});
