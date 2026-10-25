import { CARD_ART_LAYOUTS } from './generated/card-art-layout-data.js';

const finite = (value, fallback, min, max) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

// Placement belongs to the PNG, not to gameplay. Shared by every card view.
export function getCardArtLayout(visual = {}, context = 'full') {
  const frame = context === 'collection' ? { x: 50, y: 50 } : CARD_ART_LAYOUTS.frames[visual.family] || { x: 50, y: 44.65 };
  const placement = CARD_ART_LAYOUTS.assets[visual.icon] || {};
  return {
    x: frame.x, y: frame.y,
    offsetX: finite(placement.offsetX, 0, -25, 25),
    offsetY: finite(placement.offsetY, 0, -25, 25),
    scale: finite(placement.scale, 1, .5, 1.5),
  };
}

export function cardArtTransform(layout) {
  return `translate(-50%, -50%) scale(${layout.scale}) translate(${layout.offsetX}%, ${layout.offsetY}%)`;
}

export function cardArtStyle(visual, context = 'full') {
  const layout = getCardArtLayout(visual, context);
  return `--card-art-x:${layout.x}%;--card-art-y:${layout.y}%;--card-art-offset-x:${layout.offsetX}%;--card-art-offset-y:${layout.offsetY}%;--card-art-scale:${layout.scale}`;
}
