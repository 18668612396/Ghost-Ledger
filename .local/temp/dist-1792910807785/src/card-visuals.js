import { CONTENT } from './generated/content-data.js';

function family(id, label) {
  return Object.freeze({ id, label, frame: `card-frame-vivid-${id}` });
}

export const CARD_FAMILIES = Object.freeze([
  family('strike', '攻伐'),
  family('ward', '护身'),
  family('spirit', '灵术'),
  family('oath', '阴契'),
]);

export const CARD_FAMILY_BY_ID = Object.freeze(Object.fromEntries(
  Object.values(CONTENT.cards).map(card => [card.id, CARD_FAMILIES.find(family => family.id === card.visual.family)]),
));

export function getCardFamily(cardOrId) {
  const definition = typeof cardOrId === 'string' ? CONTENT.cards[cardOrId] : cardOrId;
  const result = CARD_FAMILIES.find(family => family.id === definition?.visual?.family);
  if (!result) throw new RangeError(`未配置卡牌视觉分组：${String(definition?.id || cardOrId)}`);
  return result;
}

function visual(cardId, definition) {
  return Object.freeze({
    frame: getCardFamily(definition).frame,
    ...definition.visual,
  });
}

export const CARD_VISUALS = Object.freeze(Object.fromEntries(
  Object.entries(CONTENT.cards).map(([cardId, definition]) => [cardId, visual(cardId, definition)]),
));

export function getCardVisual(cardOrId) {
  const definition = typeof cardOrId === 'string' ? CONTENT.cards[cardOrId] : cardOrId;
  if (!definition?.visual) throw new RangeError(`未配置卡牌视觉素材：${String(cardOrId)}`);
  return visual(definition.id, definition);
}
