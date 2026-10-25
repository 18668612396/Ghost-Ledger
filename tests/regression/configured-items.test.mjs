import test from 'node:test';
import assert from 'node:assert/strict';
import { readContent } from '../../tools/compile-content.mjs';
import { validateContent } from '../../game/src/runtime/content-schema.js';
import { createConfiguredAdventure, transitionConfigured, isValidConfiguredSave, restoreConfiguredRun } from '../../game/src/runtime/game.js';
import { getConfiguredAvailableNodes, createConfiguredEnemy, getConfiguredMoveIntent } from '../../game/src/runtime/world.js';
import { makeCard } from '../../game/src/runtime/effects.js';

const source = await readContent();
const clone = () => structuredClone(source);
function start(content = clone(), options = {}) { return createConfiguredAdventure(419, { content, ...options }); }
function enter(state) { return transitionConfigured(state, { type: 'selectNode', nodeId: getConfiguredAvailableNodes(state)[0].id }); }
function action(state, type, fields = {}) {
  const next = transitionConfigured(state, { type, ...fields });
  assert.notEqual(next.lastEvent?.kind, 'invalid', next.notice);
  return next;
}

test('item source tables are validated and new snapshots use only version 5/config-v2', () => {
  assert.deepEqual(validateContent(source), []);
  assert.equal(Object.keys(source.relics).length, 8);
  assert.equal(Object.keys(source.potions).length, 4);
  const run = start();
  assert.equal(run.version, 5); assert.equal(run.ruleset, 'config-v2');
  assert.ok(isValidConfiguredSave(run));
  const old = { ...run, version: 4, ruleset: 'config-v1' }, before = structuredClone(old);
  assert.equal(restoreConfiguredRun(old), null); assert.deepEqual(old, before);
});

test('configured opening effects preserve block, attributes, energy and initial draw', () => {
  let run = start();
  run.relics = ['blood_ember', 'bell', 'anchor', 'vajra', 'smooth_stone', 'bag', 'lantern'];
  run = enter(run);
  assert.equal(run.phase, 'combat'); assert.equal(run.block, 16);
  assert.equal(run.strength, 1); assert.equal(run.dexterity, 1);
  assert.equal(run.energy, 4); assert.equal(run.hand.length, 7);
});

test('opening draw modifiers do not overdraw an innate-heavy starting deck', () => {
  const content = clone();
  content.cards.ic_strike.keywords = ['innate'];
  content.acts.act1.starting.deck = [{ cardId: 'ic_strike', count: 9 }];
  let run = start(content); run.relics.push('bag'); run = enter(run);
  assert.equal(run.hand.length, 9); assert.equal(run.drawPile.length, 0);
});

test('repayment relic triggers once per turn, only after actual combat repayment', () => {
  let run = enter(start());
  const empty = transitionConfigured(run, { type: 'repay' }); assert.equal(empty.lastEvent.kind, 'invalid'); assert.equal(empty.block, 0);
  run = action(action(run, 'borrow'), 'borrow');
  run = action(run, 'repay'); assert.equal(run.block, 3);
  run = action(run, 'repay'); assert.equal(run.block, 3);
  run = action(run, 'endTurn');
  run = action(action(run, 'borrow'), 'repay'); assert.equal(run.block, 3);
  let without = enter(start()); without.relics = without.relics.filter(id => id !== 'lamp');
  without = action(action(without, 'borrow'), 'repay'); assert.equal(without.block, 0);
});

test('a new configured victory relic executes common effects without an id branch', () => {
  const content = clone();
  content.relics.custom_ember = { ...content.relics.blood_ember, id: 'custom_ember', name: '测试余烬', triggers: [{ event: 'combatVictory', effects: [{ op: 'heal', amount: 11 }] }] };
  assert.deepEqual(validateContent(content), []);
  let run = enter(start(content)); run.hp = 68; run.relics = ['custom_ember'];
  run.hand = [makeCard(run, 'ic_cleave')]; run.enemies.forEach(enemy => { enemy.hp = 1; });
  run = action(run, 'play', { uid: run.hand[0].uid });
  assert.equal(run.phase, 'reward'); assert.equal(run.hp, 79); assert.equal(run.stats.battlesWon, 1);
});

test('a configured relic can react to an enemy death without owning that enemy', () => {
  const content = clone();
  content.relics.custom_harvest = { id: 'custom_harvest', name: '收魂符', description: '敌人倒下时恢复2生命。', art: 'lotus', triggers: [{ event: 'enemyDeath', effects: [{ op: 'heal', amount: 2 }] }] };
  assert.deepEqual(validateContent(content), []);
  let run = enter(start(content)); run.hp = 50; run.relics = ['custom_harvest'];
  run.hand = [makeCard(run, 'ic_strike')]; run.enemies[0].hp = 1;
  run = action(run, 'play', { uid: run.hand[0].uid, targetUid: run.enemies[0].uid });
  assert.equal(run.hp, 52);
});

test('fatal common effects triggered by victory cannot produce a living reward screen', () => {
  const content = clone();
  content.relics.custom_price = { id: 'custom_price', name: '祭夜符', description: '胜利时付出5生命。', art: 'fire', triggers: [{ event: 'combatVictory', effects: [{ op: 'loseHp', amount: 5, cause: 'ritual' }] }] };
  assert.deepEqual(validateContent(content), []);
  let run = enter(start(content)); run.hp = 3; run.relics = ['custom_price'];
  run.hand = [makeCard(run, 'ic_cleave')]; run.enemies.forEach(enemy => { enemy.hp = 1; });
  run = action(run, 'play', { uid: run.hand[0].uid });
  assert.equal(run.phase, 'defeat'); assert.equal(run.hp, 0);
  assert.equal(run.lastEvent.cause, 'ritual'); assert.deepEqual(run.rewards, []);
});

test('potion effects, phase restrictions and item snapshots are configuration-driven', () => {
  const content = clone();
  content.potions.custom_focus = { id: 'custom_focus', name: '清明露', description: '获得2香火。', art: 'lotus', target: 'self', usablePhases: ['combat'], price: 45, effects: [{ op: 'energy', amount: 2 }] };
  assert.deepEqual(validateContent(content), []);
  let run = enter(start(content)); run.hp = 30;
  run.potions = [{ uid: 'p1', id: 'healing' }, { uid: 'p2', id: 'custom_focus' }];
  content.potions.healing.effects[0].amount = 1;
  run = action(run, 'usePotion', { potionId: 'p1' }); assert.equal(run.hp, 50);
  run = action(run, 'usePotion', { potionId: 'p2' }); assert.equal(run.energy, 5); assert.deepEqual(run.potions, []);
  const map = start(content); map.potions = [{ uid: 'p3', id: 'custom_focus' }];
  const denied = transitionConfigured(map, { type: 'usePotion', potionId: 'p3' });
  assert.equal(denied.lastEvent.kind, 'invalid'); assert.deepEqual(denied.potions, map.potions);
  map.hp = 30; map.potions = [{ uid: 'p4', id: 'healing' }];
  assert.equal(action(map, 'usePotion', { potionId: 'p4' }).hp, 31);
});

test('enemy potions require a living target and preserve potion use/discard semantics', () => {
  let run = enter(start()); run.potions = [{ uid: 'p1', id: 'fire' }, { uid: 'p2', id: 'weak' }, { uid: 'p3', id: 'block' }];
  const target = run.enemies[0], before = structuredClone(run);
  const denied = transitionConfigured(run, { type: 'usePotion', potionId: 'p1', targetUid: 'missing' });
  assert.equal(denied.lastEvent.kind, 'invalid'); assert.deepEqual(denied.potions, before.potions);
  run = action(run, 'usePotion', { potionId: 'p1', targetUid: target.uid }); assert.equal(run.enemies[0].hp, before.enemies[0].hp - 20);
  run = action(run, 'usePotion', { potionId: 'p2', targetUid: target.uid }); assert.equal(run.enemies[0].weak, 3);
  run = action(run, 'discardPotion', { potionId: 'p3' }); assert.equal(run.block, 0); assert.deepEqual(run.potions, []);
});

test('malformed item definitions and corrupt saved item references are rejected safely', () => {
  for (const mutate of [c => { delete c.relics; }, c => { c.potions.fire.effects = [null]; }, c => { c.potions.fire.usablePhases = 'combat'; }, c => { c.potions.fire.price = -1; }, c => { c.relics.lamp.triggers[0].event = 'unknown'; }, c => { c.relics.lamp.starter.unlockId = 'bad key'; }, c => { c.relics.lamp.modifiers = { typo: 2 }; }, c => { c.potions.fire.effects[0].op = 'javascript'; }, c => { c.acts.act1.starting.relics.push('missing'); }, c => { c.potions.healing.effects.push({ op: 'relic', id: 'missing' }); }, c => { c.potions.fire.usablePhases = ['map']; }, c => { c.potions.fire.target = 'self'; }, c => { c.potions.fire.target = 'all'; }, c => { c.relics.bell.starter.unlockId = null; }, c => { c.relics.lamp.starter.unlockId = 'first-night'; }]) {
    const content = clone(); mutate(content); let errors; assert.doesNotThrow(() => { errors = validateContent(content); }); assert.ok(errors.length);
  }
  const run = start(); run.potions = [{ uid: 'bad', id: 'missing' }]; assert.equal(isValidConfiguredSave(run), false);
  run.potions = []; run.relics.push('missing'); assert.equal(isValidConfiguredSave(run), false);
});

test('card self-damage defeat preserves its actual cause and source card', () => {
  let run = enter(start()); run.hp = 1; run.hand = [makeCard(run, 'ic_bloodletting')];
  run = action(run, 'play', { uid: run.hand[0].uid });
  assert.equal(run.phase, 'defeat'); assert.equal(run.lastEvent.cause, 'card');
  assert.equal(run.lastEvent.sourceUid, 'player'); assert.equal(run.lastEvent.cardId, 'ic_bloodletting');
});

test('an enemy fatal hit overrides an earlier nonfatal debt loss in the same action', () => {
  const content = clone();
  content.cards.status_burn.onHandEnd = [{ op: 'loseHp', amount: 2, cause: 'debt' }];
  let run = enter(start(content)); run.hp = 5; run.hand = [makeCard(run, 'status_burn')];
  const enemy = createConfiguredEnemy('jaw', run, 0, run.contentSnapshot, () => .2);
  enemy.intent = getConfiguredMoveIntent(run, enemy, 'chomp', run.contentSnapshot, () => .2);
  run.enemies = [enemy];
  run = action(run, 'endTurn');
  assert.equal(run.phase, 'defeat'); assert.equal(run.lastEvent.cause, 'enemy');
  assert.equal(run.lastEvent.sourceUid, enemy.uid); assert.equal(run.lastEvent.cardId, null);
  const losses = run.events.filter(event => event.type === 'hpLost' && event.targetUid === 'player' && event.amount > 0);
  assert.equal(losses[0].cause, 'debt'); assert.equal(losses.at(-1).cause, 'enemy');
});

test('defeat without an attributable positive HP loss is marked unknown', () => {
  const run = enter(start()); run.hp = 0;
  const next = transitionConfigured(run, { type: 'endTurn' });
  assert.equal(next.phase, 'defeat'); assert.equal(next.lastEvent.cause, 'unknown');
  assert.equal(next.lastEvent.sourceUid, 'unknown'); assert.equal(next.lastEvent.cardId, null);
});
