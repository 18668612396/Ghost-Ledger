import { CARD_DEFS } from './engine.js';

function family(id, label) {
  return Object.freeze({ id, label, frame: `card-frame-vivid-${id}` });
}

export const CARD_FAMILIES = Object.freeze([
  family('strike', '攻伐'),
  family('ward', '护身'),
  family('spirit', '灵术'),
  family('oath', '阴契'),
]);

const CARD_IDS_BY_FAMILY = {
  strike: ['brush', 'coin', 'fire', 'a_strike', 'a_bash', 'a_cleave', 'a_flame'],
  ward: ['talisman', 'step', 'lotus', 'mirror', 'a_defend'],
  spirit: ['bell', 'ledger', 'ferry'],
  oath: ['chain', 'vow', 'seal', 'blood', 'verdict', 'a_slimed', 'a_dazed', 'a_burn', 'a_burn_plus'],
};

const BACKGROUND_ALIASES = { a_strike: 'brush', a_defend: 'talisman', a_bash: 'coin', a_cleave: 'fire', a_flame: 'brush', a_slimed: 'vow', a_dazed: 'chain', a_burn: 'blood', a_burn_plus: 'verdict' };

export const CARD_FAMILY_BY_ID = Object.freeze(Object.fromEntries(
  CARD_FAMILIES.flatMap(cardFamily => CARD_IDS_BY_FAMILY[cardFamily.id].map(cardId => [cardId, cardFamily])),
));

export function getCardFamily(cardId) {
  if (typeof cardId !== 'string' || !Object.hasOwn(CARD_DEFS, cardId)) throw new RangeError(`未知卡牌：${String(cardId)}`);
  if (!Object.hasOwn(CARD_FAMILY_BY_ID, cardId)) throw new RangeError(`未配置卡牌视觉分组：${cardId}`);
  return CARD_FAMILY_BY_ID[cardId];
}

function visual(cardId, definition) {
  return Object.freeze({
    frame: getCardFamily(cardId).frame,
    background: `card-pattern-color-${BACKGROUND_ALIASES[cardId] || cardId}`,
    icon: cardId === 'a_slimed' ? 'enemy-acid' : `card-art-${definition.art}`,
    cost: 'card-cost-flame',
  });
}

export const CARD_VISUALS = Object.freeze(Object.fromEntries(
  Object.entries(CARD_DEFS).map(([cardId, definition]) => [cardId, visual(cardId, definition)]),
));

export function getCardVisual(cardId) {
  if (typeof cardId !== 'string' || !Object.hasOwn(CARD_VISUALS, cardId)) throw new RangeError(`未配置卡牌视觉素材：${String(cardId)}`);
  return CARD_VISUALS[cardId];
}
