// Public game API. All content and runs use the single configured runtime.
import { CONTENT } from './generated/content-data.js';
import { evaluate } from './runtime/expressions.js';
import { createConfiguredAdventure, transitionConfigured, getConfiguredCardView, getConfiguredEnemyIntent, getConfiguredEventView, getConfiguredEnemies, isValidConfiguredSave, restoreConfiguredRun, contentFor } from './runtime/game.js';
export { RELIC_DEFS, POTION_DEFS } from './runtime/items.js';
export { CONTENT, CONTENT_REVISION } from './generated/content-data.js';
export { contentFor } from './runtime/game.js';
export { getConfiguredAvailableNodes as getAvailableNodes } from './runtime/world.js';
export const CARD_DEFS = Object.fromEntries(Object.entries(CONTENT.cards).map(([id, card]) => [id, { ...card, description: card.text, art: card.visual.icon.replace('card-art-', '') }]));
export const ENEMY_DEFS = CONTENT.enemies;
export const createAdventure = createConfiguredAdventure;
export const transition = transitionConfigured;
export const getCardView = getConfiguredCardView;
export const getEnemyIntent = getConfiguredEnemyIntent;
export const getEnemies = getConfiguredEnemies;
export const getEventView = getConfiguredEventView;
export const isValidSave = isValidConfiguredSave;
export const restoreRun = restoreConfiguredRun;
export const isCardPlayable = (state, card) => Boolean(getCardView(state, card)?.playable);
export const debtTotal = state => state.debts.reduce((sum, debt) => sum + debt.amount, 0);
export function debtSchedule(state) {
  const grouped = new Map();
  for (const debt of state.debts) grouped.set(debt.dueTurn, (grouped.get(debt.dueTurn) || 0) + debt.amount);
  return [...grouped.entries()].sort((a, b) => a[0] - b[0]).map(([dueTurn, amount]) => ({ dueTurn, amount, turnsUntil: dueTurn - state.turn, hpCost: amount * 2 }));
}
export function getActivePowers(state) {
  const content = contentFor(state);
  return Object.entries(state.powers || {}).map(([id, value]) => ({ ...content.powers[id], amount: value.amount })).filter(power => power.id);
}
export function getEnemyMechanics(state, instance) {
  const content = contentFor(state), definition = content.enemies[instance.id];
  const env = { player: state, state, source: instance, target: state, content, preview: true };
  return (definition.traits || []).flatMap(trait => trait.display || [])
    .filter(line => !line.when || evaluate(line.when, env))
    .map(line => line.text.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, key) => Object.hasOwn(line.textValues || {}, key) ? String(evaluate(line.textValues[key], env)) : match));
}
