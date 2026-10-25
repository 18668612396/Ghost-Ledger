import { CONTENT } from '../generated/content-data.js';

// Catalogue views only. Rule execution always reads the run's content snapshot.
export const RELIC_DEFS = CONTENT.relics;
export const POTION_DEFS = CONTENT.potions;
export const DEFAULT_STARTER_RELIC_ID = Object.values(CONTENT.relics || {}).find(relic => relic.starter?.unlockId === null)?.id;

