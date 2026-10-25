import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdventure, transition, getAvailableNodes, getCardEnemyTargets } from '../../game/src/engine.js';
import { makeCard } from '../../game/src/runtime/effects.js';
import { createConfiguredEnemy } from '../../game/src/runtime/world.js';
import { renderBattlefield } from '../../game/src/battlefield-view.js';

const render = (state, options = {}) => renderBattlefield(state, { asset: id => `/public/assets/${id}.png`, icon: name => `<span class="icon ${name}"></span>`, healthMarkup: (hp, max) => `${hp}/${max}`, ...options });
function scenario() {
  let state = createAdventure(419);
  state = transition(state, { type: 'selectNode', nodeId: getAvailableNodes(state)[0].id });
  state.enemies = ['jaw', 'cultist', 'looter'].map((id, index) => createConfiguredEnemy(id, state, index, state.contentSnapshot, () => .4));
  state.hand = ['ic_strike'].map(id => makeCard(state, id));
  state.energy = 3;
  return state;
}

test('normal battle has no ready or unavailable state and keeps every monster detail button', () => {
  const state = scenario(), before = structuredClone(state), html = render(state);
  assert.doesNotMatch(html, /target-ready|target-unavailable|data-card-target-eligible|aria-disabled/);
  assert.equal((html.match(/class="enemy-target-arrow" aria-hidden="true"/g) || []).length, 3);
  assert.equal((html.match(/data-action="enemy"/g) || []).length, 3);
  assert.deepEqual(state, before);
});

test('pending card selection renders eligibility from the same rules query including an unavailable cast', () => {
  const state = scenario(), pendingTarget = { kind: 'card', uid: state.hand[0].uid };
  let html = render(state, { pendingTarget, enemyTargets: getCardEnemyTargets(state, pendingTarget.uid) });
  assert.equal((html.match(/data-card-target-eligible="true"/g) || []).length, 3);
  state.energy = 0;
  html = render(state, { pendingTarget, enemyTargets: getCardEnemyTargets(state, pendingTarget.uid) });
  assert.doesNotMatch(html, /target-ready/);
  assert.equal((html.match(/data-card-target-eligible="false"/g) || []).length, 3);
  assert.equal((html.match(/aria-disabled="true"/g) || []).length, 3);
});

test('presentation accepts different eligibility per monster without identifying cards or monsters by name', () => {
  const state = scenario(), before = structuredClone(state);
  const enemyTargets = state.enemies.map((enemy, index) => ({ uid: enemy.uid, eligible: index !== 1, reason: index === 1 ? '受规则限制' : '' }));
  const html = render(state, { pendingTarget: { kind: 'card', uid: state.hand[0].uid }, enemyTargets });
  assert.equal((html.match(/target-ready/g) || []).length, 2);
  assert.equal((html.match(/target-unavailable/g) || []).length, 1);
  assert.match(html, new RegExp(`target-unavailable[^>]+data-enemy-uid="${state.enemies[1].uid}"`));
  assert.deepEqual(state, before);
});
