import { cardArtStyle } from './card-art-layout.js';

const PURPOSES = Object.freeze({
  'collection-card': '查看卡牌详情',
  'collection-enemy': '查看怪物详情',
  'collection-item': '查看物品详情',
  'resolve-choice': '选择此牌',
});
const FAMILIES = new Set(['strike', 'ward', 'spirit', 'oath']);
// Group only copies that show the same state. Growth and temporary cost changes
// belong to an individual card and must remain visible in draw/discard piles.
export function cardCollectionKey(card) {
  return `card:${JSON.stringify([card.id, card.upgradeLevel || 0, card.cost, card.description, Boolean(card.exhaust), Boolean(card.ethereal)])}`;
}
const OPTIONAL_DATA = Object.freeze([
  ['cardId', 'card-id'], ['enemyId', 'enemy-id'], ['itemKind', 'item-kind'],
  ['itemId', 'item-id'], ['itemUid', 'item-uid'],
]);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function attribute(name, value) {
  return ` ${name}="${escapeHtml(value)}"`;
}

function renderTile(entry, asset) {
  const purpose = Object.hasOwn(PURPOSES, entry.action) ? PURPOSES[entry.action] : null;
  if (!purpose) throw new RangeError(`未知的藏品操作：${String(entry.action)}`);

  const hasCost = entry.cost !== undefined;
  const hasCount = entry.count !== undefined;
  const costLabel = entry.cost === null ? '不可打出' : `费用${entry.cost}香火`;
  const label = [
    `${purpose}：${entry.name ?? ''}`,
    entry.typeLabel,
    hasCost ? costLabel : '',
    hasCount ? `数量${entry.count}` : '',
    entry.upgraded ? '已升级' : '',
    entry.locked ? '待解锁' : '',
  ].filter(Boolean).join('，');
  const classes = ['collection-tile', entry.locked ? 'is-locked' : '', entry.upgraded ? 'is-upgraded' : ''].filter(Boolean).join(' ');
  const data = [
    attribute('data-action', entry.action),
    attribute('data-collection-key', entry.key),
    FAMILIES.has(entry.family) ? attribute('data-card-family', entry.family) : '',
    ...OPTIONAL_DATA.map(([key, name]) => entry[key] !== undefined && entry[key] !== null ? attribute(`data-${name}`, entry[key]) : ''),
  ].join('');
  const cost = hasCost
    ? `<span class="collection-tile-cost"${attribute('aria-label', costLabel)}><img class="collection-tile-cost-art"${attribute('src', asset('card-cost-flame'))} alt="" aria-hidden="true" draggable="false"/><span class="collection-tile-cost-number">${entry.cost === null ? '—' : escapeHtml(entry.cost)}</span></span>`
    : '';
  const count = hasCount ? `<span class="collection-tile-count">×${escapeHtml(entry.count)}</span>` : '';
  const lock = entry.locked ? '<span class="collection-tile-lock">待解锁</span>' : '';
  const frame = FAMILIES.has(entry.family) ? `collection-frame-${entry.family}` : 'collection-slot';
  const paper = `<img class="collection-tile-paper"${attribute('src', asset(frame))} alt="" aria-hidden="true" draggable="false"/>`;
  const foreground = `<img class="collection-tile-art"${attribute('style', cardArtStyle({ family: entry.family, icon: entry.icon }, 'collection'))}${attribute('src', asset(entry.icon))} alt="" aria-hidden="true" draggable="false" loading="lazy" decoding="async"/>`;
  const picture = entry.background
    ? `<span class="collection-tile-picture" aria-hidden="true"><img class="collection-tile-background"${attribute('src', asset(entry.background))} alt="" draggable="false"/>${foreground}</span>`
    : foreground;

  return `<button type="button"${attribute('class', classes)}${data}${attribute('aria-label', label)}>${paper.repeat(2)}${picture}${cost}<strong class="collection-tile-name">${escapeHtml(entry.name)}</strong><small class="collection-tile-type">${escapeHtml(entry.typeLabel)}</small>${count}${lock}</button>`;
}

export function renderCollectionGrid(entries, { asset, emptyMessage = '这里暂时没有符牌。' } = {}) {
  if (!Array.isArray(entries)) throw new TypeError('藏品网格需要条目数组。');
  if (!entries.length) return `<div class="collection-grid"><p class="collection-empty">${escapeHtml(emptyMessage)}</p></div>`;
  if (typeof asset !== 'function') throw new TypeError('藏品网格需要素材路径函数asset。');
  return `<div class="collection-grid">${entries.map(entry => renderTile(entry, asset)).join('')}</div>`;
}
