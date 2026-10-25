import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdventure, getCardView, getEnemyMechanics } from '../../game/src/engine.js';
import { cardCollectionKey } from '../../game/src/collection-view.js';
import { getCardFamily, getCardVisual } from '../../game/src/card-visuals.js';

test('compendium uses the same dynamic card description evaluator without an active run', () => {
  for (const id of ['ic_rampage', 'ic_searing_blow', 'ic_body_slam', 'ic_perfected_strike']) {
    const card = getCardView(null, id);
    assert.ok(card.name); assert.doesNotMatch(card.description, /\{\w+\}|NaN|undefined/);
  }
});
test('pile groups preserve individual cost and growth differences while merging identical copies', () => {
  const run = createAdventure(8), base = { cardId: 'ic_blood_for_blood', upgradeLevel: 0 };
  const first = getCardView(run, { ...base, costReduction: -1 });
  const second = getCardView(run, { ...base, costReduction: -3 });
  assert.notEqual(first.cost, second.cost); assert.notEqual(cardCollectionKey(first), cardCollectionKey(second));
  assert.equal(cardCollectionKey(first), cardCollectionKey(getCardView(run, { ...base, costReduction: -1, uid: 'other-copy' })));
  assert.notEqual(cardCollectionKey(getCardView(run, { cardId: 'ic_rampage', rampageDamage: 5 })), cardCollectionKey(getCardView(run, { cardId: 'ic_rampage', rampageDamage: 10 })));
  assert.notEqual(cardCollectionKey(getCardView(run, { cardId: 'ic_searing_blow', upgradeLevel: 1 })), cardCollectionKey(getCardView(run, { cardId: 'ic_searing_blow', upgradeLevel: 2 })));
});
test('a configured card absent from the global catalog still presents all four layers from its run snapshot', () => {
  const run = createAdventure(9), definition = { ...run.contentSnapshot.cards.ic_strike, id: 'custom_new_card', name: '新符', visual: { ...run.contentSnapshot.cards.ic_strike.visual, family: 'oath' } };
  run.contentSnapshot.cards[definition.id] = definition;
  const view = getCardView(run, definition.id), visual = getCardVisual(view);
  assert.equal(getCardFamily(view).id, 'oath'); assert.equal(visual.frame, 'card-frame-vivid-oath');
  assert.ok(visual.background && visual.icon && visual.cost);
});
test('mechanic labels are authored trait expressions rather than monster ID branches', () => {
  const run = createAdventure(10);
  run.contentSnapshot.enemies.custom_counter = { traits: [{ display: [{ when: { stat: 'source.ai.remaining' }, text: '还需 {n} 伤害', textValues: { n: { stat: 'source.ai.remaining' } } }] }] };
  assert.deepEqual(getEnemyMechanics(run, { id: 'custom_counter', ai: { remaining: 17 } }), ['还需 17 伤害']);
  assert.deepEqual(getEnemyMechanics(run, { id: 'custom_counter', ai: { remaining: 0 } }), []);
});
