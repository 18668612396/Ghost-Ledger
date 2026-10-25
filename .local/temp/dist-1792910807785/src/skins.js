import { SKIN_DATA } from './skin-data.js';

const BUTTON_SELECTOR = '.primary-button,.secondary-button,.borrow-button,.repay-button,.end-button,.event-choice';
const SCROLL_SELECTOR = '.parchment-modal.paper-panel,.scroll-surface';
const watched = new Set();
const assets = new Map(SKIN_DATA.assets.map(asset => [asset.filename, asset]));
let observer = null;

export function getSkinGeometry(kind, width, height, options = {}) {
  const skin = SKIN_DATA.skins[kind];
  if (!skin || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const insets = skin.insets;
  const proposed = kind === 'button' ? height / skin.referenceSize[1] : options.scale > 0 ? options.scale : width / skin.referenceSize[0];
  const horizontalLimit = Math.max(1, width - 1) / (insets.left + insets.right);
  const verticalLimit = kind === 'button' ? proposed : Math.max(1, height - 1) / (insets.top + insets.bottom);
  const scale = Math.min(proposed, horizontalLimit, verticalLimit);
  return {
    scale,
    left: insets.left * scale,
    right: insets.right * scale,
    top: (insets.top ?? 0) * scale,
    bottom: (insets.bottom ?? 0) * scale,
    height: kind === 'button' ? skin.referenceSize[1] * scale : height,
    pieces: Object.entries(skin.parts).map(([part, filename]) => {
      const asset = assets.get(filename);
      return { part, filename, width: asset.size[0] * scale, height: asset.size[1] * scale };
    }),
  };
}

function updateSkin(element) {
  if (!element.isConnected) return;
  const kind = element.dataset.skinKind;
  const width = element.offsetWidth, height = element.offsetHeight;
  const scale = Number.parseFloat(getComputedStyle(element).getPropertyValue('--skin-scroll-scale'));
  const geometry = getSkinGeometry(kind, width, height, { scale });
  if (!geometry) return;
  for (const side of ['left', 'right', 'top', 'bottom']) element.style.setProperty(`--skin-${side}`, `${geometry[side]}px`);
  element.style.setProperty('--skin-cap-left', `${geometry.left}px`);
  element.style.setProperty('--skin-cap-right', `${geometry.right}px`);
  element.style.setProperty('--skin-height', `${geometry.height}px`);
  const layer = [...element.children].find(child => child.classList.contains('bitmap-skin'));
  if (!layer) return;
  for (const piece of geometry.pieces) {
    const target = [...layer.children].find(child => child.dataset.skinPart === piece.part);
    if (!target) continue;
    target.style.setProperty('--skin-piece-width', `${piece.width}px`);
    target.style.setProperty('--skin-piece-height', `${piece.height}px`);
  }
}

function decorate(element, kind) {
  const skin = SKIN_DATA.skins[kind];
  if (!skin) return;
  element.classList.add('skin-host', `skin-${kind}-host`);
  element.dataset.skinKind = kind;
  let layer = [...element.children].find(child => child.classList.contains('bitmap-skin'));
  if (!layer) {
    layer = document.createElement('span');
    layer.className = `bitmap-skin skin-layer-${kind}`;
    layer.setAttribute('aria-hidden', 'true');
    for (const [part, filename] of Object.entries(skin.parts)) {
      const piece = document.createElement('span');
      piece.className = `skin-piece skin-piece-${part}`;
      piece.dataset.skinPart = part;
      piece.style.backgroundImage = `url("${new URL(`../public/assets/${filename}`, import.meta.url).href}")`;
      layer.append(piece);
    }
    element.prepend(layer);
  }
  if (!watched.has(element)) {
    watched.add(element);
    observer?.observe(element);
  }
  updateSkin(element);
}

function matching(root, selector) {
  return [...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)];
}

export function decorateSkins(root) {
  if (!root?.querySelectorAll) return;
  if (!observer && typeof ResizeObserver === 'function') observer = new ResizeObserver(entries => entries.forEach(entry => updateSkin(entry.target)));
  for (const element of watched) {
    if (!element.isConnected) {
      observer?.unobserve(element);
      watched.delete(element);
    }
  }
  for (const element of matching(root, BUTTON_SELECTOR)) decorate(element, 'button');
  for (const element of matching(root, SCROLL_SELECTOR)) decorate(element, 'scroll');
}
