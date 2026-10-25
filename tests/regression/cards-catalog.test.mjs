import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluate } from '../../game/src/runtime/expressions.js';
import { makeCard, initializeResolution, commitCard, drainEffects, resolveChoice, definitionFor } from '../../game/src/runtime/effects.js';

const root = new URL('../../game/', import.meta.url);
const cards = JSON.parse(fs.readFileSync(new URL('content/cards.json', root), 'utf8'));
const powers = JSON.parse(fs.readFileSync(new URL('content/powers.json', root), 'utf8'));
const content = { cards: Object.fromEntries(cards.map(card => [card.id, card])), powers: Object.fromEntries(powers.map(power => [power.id, power])), enemies: {} };
const byId = id => content.cards[id];
const ironclad = cards.filter(card => card.pool === 'ironclad');

test('catalog contains all 75 distinct original functional indices and the approved 12 debt cards', () => {
  const expected = `Strike|Bash|Anger|Body Slam|Clash|Cleave|Clothesline|Headbutt|Heavy Blade|Iron Wave|Perfected Strike|Pommel Strike|Sword Boomerang|Thunderclap|Twin Strike|Wild Strike|Blood for Blood|Carnage|Dropkick|Hemokinesis|Pummel|Rampage|Reckless Charge|Searing Blow|Sever Soul|Uppercut|Whirlwind|Bludgeon|Feed|Fiend Fire|Immolate|Reaper|Defend|Armaments|Flex|Havoc|Shrug It Off|True Grit|Warcry|Battle Trance|Bloodletting|Burning Pact|Disarm|Dual Wield|Entrench|Flame Barrier|Ghostly Armor|Infernal Blade|Intimidate|Power Through|Rage|Second Wind|Seeing Red|Sentinel|Shockwave|Spot Weakness|Double Tap|Exhume|Impervious|Limit Break|Offering|Combust|Dark Embrace|Evolve|Feel No Pain|Fire Breathing|Inflame|Metallicize|Rupture|Barricade|Berserk|Brutality|Corruption|Demon Form|Juggernaut`.split('|');
  assert.deepEqual(ironclad.map(card => card.source.card).sort(), expected.sort());
  assert.equal(cards.filter(card => card.pool === 'debt').length, 12);
  assert.equal(new Set(cards.map(card => card.id)).size, cards.length);
  assert.deepEqual(['attack', 'skill', 'power'].map(type => ironclad.filter(card => card.type === type).length), [32, 29, 14]);
  assert.deepEqual(['basic', 'common', 'uncommon', 'rare'].map(rarity => ironclad.filter(card => card.rarity === rarity).length), [3, 20, 36, 16]);
});

test('every card uses four existing bitmap layers and an explicit visual family', () => {
  for (const card of cards) {
    assert.ok(['strike', 'ward', 'spirit', 'oath'].includes(card.visual.family), card.id);
    for (const name of [card.visual.icon, card.visual.background, card.visual.cost, `card-frame-vivid-${card.visual.family}`, `collection-frame-${card.visual.family}`]) {
      assert.ok(fs.existsSync(fileURLToPath(new URL(`public/assets/${name}.png`, root))), `${card.id}: ${name}`);
    }
  }
  assert.equal(new Set(cards.map(card => card.visual.background)).size, 15);
});

test('source fixes include Immolate, Shrug It Off and final-version self damage values', () => {
  assert.equal(byId('ic_immolate').effects[0].amount, 21);
  assert.equal(byId('ic_immolate').upgrade.effects[0].amount, 28);
  assert.equal(byId('ic_shrug_it_off').effects[0].amount, 8);
  assert.equal(byId('ic_shrug_it_off').upgrade.effects[0].amount, 11);
  assert.equal(byId('ic_hemokinesis').effects[0].amount, 2);
  assert.equal(byId('ic_bloodletting').effects[0].amount, 3);
  assert.equal(byId('ic_offering').effects[0].amount, 6);
});

test('upgrades change actual costs, exhaust behavior and trigger values', () => {
  for (const [id, cost] of Object.entries({ ic_body_slam: 0, ic_havoc: 0, ic_infernal_blade: 0, ic_seeing_red: 0, ic_exhume: 0, ic_entrench: 1, ic_dark_embrace: 1, ic_barricade: 2, ic_corruption: 2, ic_blood_for_blood: 3, debt_delay: 0 })) assert.equal(byId(id).upgrade.cost, cost, id);
  assert.deepEqual(byId('ic_limit_break').upgrade.keywords, []);
  assert.deepEqual(byId('ic_brutality').upgrade.keywords, ['innate']);
  assert.equal(byId('ic_sentinel').onExhaust[0].amount, 2);
  assert.equal(byId('ic_sentinel').upgrade.onExhaust[0].amount, 3);
  assert.equal(byId('ic_true_grit').upgrade.effects[1].selection, 'chosen');
});

test('repeat upgrades and strike counting are expressed by shared data operations', () => {
  const formula = byId('ic_searing_blow').effects[0].amount;
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(upgradeLevel => evaluate(formula, { card: { upgradeLevel } })), [12, 16, 21, 27, 34, 42]);
  assert.equal(byId('ic_searing_blow').upgradePolicy, 'repeat');
  assert.deepEqual(ironclad.filter(card => card.tags.includes('strike')).map(card => card.source.card).sort(), ['Perfected Strike', 'Pommel Strike', 'Strike', 'Twin Strike', 'Wild Strike']);
});

test('non-card block, actual repayment and temporary powers retain explicit semantic boundaries', () => {
  assert.equal(byId('ic_entrench').effects[0].modified, false);
  for (const id of ['rage', 'metallicize', 'feel_no_pain']) assert.equal(content.powers[id].triggers[0].effects[0].modified, false, id);
  assert.equal(content.powers.flame_barrier.expires, 'roundEnd');
  assert.equal(content.powers.no_draw.debuff, true);
  assert.equal(content.powers.temporary_strength_loss.debuff, true);
  assert.equal(content.powers.debt_register.triggers[0].limit, 'oncePerTurn');
  assert.equal(evaluate(byId('debt_ferry').effects[1].condition, { context: { lastPaid: 0 } }), false);
  assert.equal(evaluate(byId('debt_ferry').effects[1].condition, { context: { lastPaid: 1 } }), true);
  assert.equal(evaluate(content.powers.rupture.triggers[0].when, { event: { cause: 'debt', hpLoss: 4 } }), false);
  assert.equal(evaluate(content.powers.rupture.triggers[0].when, { event: { cause: 'card', hpLoss: 2 } }), true);
});

test('hp-loss discount only observes the owner and excludes newly generated healing attacks', () => {
  const trigger = byId('ic_blood_for_blood').triggers[0];
  assert.equal(evaluate(trigger.when, { event: { hpLoss: 8, targetUid: 'enemy-1' } }), false);
  assert.equal(evaluate(trigger.when, { event: { hpLoss: 1, targetUid: 'player' } }), true);
  assert.deepEqual(trigger.zones, ['hand', 'drawPile', 'discard']);
  assert.equal(byId('ic_feed').generation.combat, false);
  assert.equal(byId('ic_reaper').generation.combat, false);
  assert.deepEqual(byId('ic_exhume').effects[0].excludeIds, ['ic_exhume']);
});

function fixture(cardId, upgradeLevel) {
  const state = { version: 5, ruleset: 'config-v2', phase: 'combat', pendingChoice: null, hp: 80, maxHp: 80, block: 12, strength: 2, dexterity: 1, energy: 8, maxEnergy: 3, gold: 99, turn: 1, combatTurn: 1, nextUid: 1, nextDebtId: 2, rngState: 1234, debts: [{ id: 'debt-1', amount: 8, dueTurn: 2, originalDueTurn: 2, delayed: false }], repaidThisTurn: 1, stats: { battlesStarted: 1 }, relics: [], powers: {}, hand: [], drawPile: [], discard: [], exhaust: [], powerZone: [], limbo: [], events: [], log: [], enemies: [{ uid: 'enemy-1', id: 'dummy', hp: 1000, maxHp: 1000, block: 0, strength: 0, exposed: 1, intentAttacks: true, powers: {} }, { uid: 'enemy-2', id: 'dummy', hp: 1000, maxHp: 1000, block: 0, strength: 0, powers: {} }] };
  initializeResolution(state);
  const candidate = makeCard(state, cardId, { upgradeLevel });
  state.hand = [candidate, makeCard(state, 'ic_strike'), makeCard(state, 'ic_defend'), makeCard(state, 'ic_sentinel')];
  if (cardId === 'ic_clash') state.hand = state.hand.filter(card => card.uid === candidate.uid || content.cards[card.cardId].type === 'attack');
  state.drawPile = [makeCard(state, 'ic_strike'), makeCard(state, 'ic_defend'), makeCard(state, 'ic_strike'), makeCard(state, 'ic_strike')];
  state.discard = [makeCard(state, 'ic_defend')];
  state.exhaust = [makeCard(state, 'ic_strike')];
  return { state, candidate };
}

test('all 87 playable catalog entries resolve at both upgrade levels through the same interpreter', () => {
  for (const definition of cards.filter(card => ['ironclad', 'debt'].includes(card.pool))) for (const upgradeLevel of [0, 1]) {
    const { state, candidate } = fixture(definition.id, upgradeLevel);
    assert.equal(commitCard(state, content, candidate, 'enemy-1'), true, definition.id);
    drainEffects(state, content);
    for (let choice = 0; state.pendingChoice && choice < 20; choice++) {
      assert.equal(resolveChoice(state, content, state.pendingChoice.cardUids[0]), true);
      drainEffects(state, content);
    }
    assert.equal(state.pendingChoice, null, `${definition.id}+${upgradeLevel} pending choice`);
    assert.equal(state.effectQueue.length, 0, `${definition.id}+${upgradeLevel} queue`);
    assert.equal(state.limbo.length, 0, `${definition.id}+${upgradeLevel} limbo`);
    assert.ok(Number.isFinite(state.hp) && Number.isFinite(state.energy) && state.hp > 0, definition.id);
    const view = definitionFor(content, candidate);
    const expectedZone = view.type === 'power' ? 'powerZone' : view.keywords.includes('exhaust') ? 'exhaust' : 'discard';
    assert.ok(state[expectedZone].some(card => card.uid === candidate.uid), `${definition.id}+${upgradeLevel} destination ${expectedZone}`);
  }
});
