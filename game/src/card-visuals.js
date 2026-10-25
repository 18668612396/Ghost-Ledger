import { CONTENT } from './generated/content-data.js';

// These shared objects still serve events and inventory; card illustrations are independent.
export const COMMON_CARD_ART_IDS = Object.freeze(['brush', 'talisman', 'chain', 'step', 'fire', 'bell', 'seal', 'coin', 'lotus', 'mirror', 'ledger']);

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

export function getCardVisual(cardOrId, { latestArtwork = false } = {}) {
  const definition = typeof cardOrId === 'string' ? CONTENT.cards[cardOrId] : cardOrId;
  if (!definition?.visual) throw new RangeError(`未配置卡牌视觉素材：${String(cardOrId)}`);
  // Ongoing runs keep their rules snapshot; game views may refresh just the PNG.
  // Authored objects (including editor drafts and snapshot-only cards) stay intact.
  const current = latestArtwork && Object.hasOwn(CONTENT.cards, definition.id) ? CONTENT.cards[definition.id] : null;
  return visual(definition.id, current ? { ...definition, visual: { ...definition.visual, icon: current.visual.icon } } : definition);
}
