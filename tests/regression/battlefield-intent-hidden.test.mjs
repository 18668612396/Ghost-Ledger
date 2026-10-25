import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdventure, getEnemyIntent } from '../../game/src/engine.js';
import { createConfiguredEnemy, getConfiguredMoveIntent } from '../../game/src/runtime/world.js';
import { renderBattlefield } from '../../game/src/battlefield-view.js';

const render = (state, options = {}) => renderBattlefield(state, { asset: id => `/public/assets/${id}.png`, icon: () => '', healthMarkup: (hp, max) => `<span>${hp}/${max}</span>`, ...options });
function scenario(ids) {
  const state = createAdventure(77);
  state.enemies = ids.map((id, index) => createConfiguredEnemy(id, state, index, state.contentSnapshot, () => .2));
  return state;
}

test('the battlefield hides intent copy while the details API retains the full announcement', () => {
  const state = scenario(['jaw']), enemy = state.enemies[0];
  enemy.strength = 3;
  enemy.intent = getConfiguredMoveIntent(state, enemy, 'chomp', state.contentSnapshot, () => 0);
  const before = structuredClone(state), detail = getEnemyIntent(state, enemy.uid);
  const html = render(state);
  assert.doesNotMatch(html, /class="intent|data-action="enemy-info"|大颚咬|攻击 14|结束回合后/);
  assert.match(html, /data-action="enemy" data-enemy-uid="c-enemy-1"/);
  assert.equal(detail.amount, 14);
  assert.deepEqual(getEnemyIntent(state, enemy.uid), detail);
  assert.deepEqual(state, before);
});

test('each monster keeps its health, name and selectable target without a separate intent target', () => {
  const state = scenario(['gremlin_mad', 'gremlin_sneaky', 'gremlin_wizard', 'gremlin_shield', 'gremlin_fat']);
  const html = render(state, { pendingTarget: { uid: 'held-card' } });
  assert.equal((html.match(/class="enemy-target"/g) || []).length, 5);
  assert.equal((html.match(/class="enemy-head-health"/g) || []).length, 5);
  for (const enemy of state.enemies) {
    assert.ok(html.includes(`data-action="enemy" data-enemy-uid="${enemy.uid}"`));
    assert.ok(html.includes(`选择目标：${state.contentSnapshot.enemies[enemy.id].name}`));
  }
  assert.doesNotMatch(html, /data-action="enemy-info"|class="intent/);
});

test('departed monsters retain empty slots without leaving health or intent displays behind', () => {
  const state = scenario(['cultist', 'jaw', 'looter']);
  state.enemies[1].hp = 0;
  state.enemies[2].escaped = true;
  const html = render(state);
  assert.match(html, /enemy-count-3/);
  assert.equal((html.match(/class="enemy-vacancy"/g) || []).length, 2);
  assert.equal((html.match(/class="enemy-target"/g) || []).length, 1);
  assert.equal((html.match(/class="enemy-head-health"/g) || []).length, 1);
  assert.doesNotMatch(html, /class="intent/);
});
