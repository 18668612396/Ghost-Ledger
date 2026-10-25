import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getSkinGeometry } from '../../game/src/skins.js';
import { SKIN_DATA } from '../../game/src/skin-data.js';

async function skinDom(t) {
  const frames = new Map(), observers = [], writes = []; let frameId = 0, phase = 'decorate';
  class Element {
    constructor(tag = 'div', { classes = '', width = 500, height = 300, scale = '' } = {}) {
      this.tagName = tag.toUpperCase(); this.className = classes; this.dataset = {}; this.attributes = new Map(); this.children = []; this.parentElement = null; this.isConnected = true;
      this.width = width; this.height = height; this.scale = scale; this.layoutReads = 0;
      this.classList = { contains: name => this.className.split(/\s+/).includes(name), add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); } };
      const values = new Map(); this.style = { values, setProperty: t.mock.fn((name, value) => { writes.push({ element: this, name, value, phase }); values.set(name, value); }) };
    }
    get offsetWidth() { this.layoutReads++; return this.width; }
    get offsetHeight() { this.layoutReads++; return this.height; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    append(element) { element.parentElement = this; this.children.push(element); }
    prepend(element) { element.parentElement = this; this.children.unshift(element); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; this.isConnected = false; }
    matches(selector) { return selector.split(',').some(part => part.split('.').filter(Boolean).every(name => this.classList.contains(name))); }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  }
  const document = { createElement: t.mock.fn(tag => new Element(tag)) };
  const requestAnimationFrame = t.mock.fn(callback => { frames.set(++frameId, callback); return frameId; });
  const computed = t.mock.fn(element => ({ getPropertyValue: name => name === '--skin-scroll-scale' ? element.scale : '' }));
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.observe = t.mock.fn(); this.unobserve = t.mock.fn(); observers.push(this); }
    deliver(elements) { const prior = phase; phase = 'observer'; try { this.callback(elements.map(target => ({ target, contentRect: { width: 1, height: 1 } }))); } finally { phase = prior; } }
  }
  const replacements = { document, ResizeObserver, requestAnimationFrame, getComputedStyle: computed }, original = new Map();
  for (const [name, value] of Object.entries(replacements)) { original.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); }
  t.after(() => { frames.clear(); for (const [name, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  // A separate real module instance prevents its module-local observer/watched set leaking between tests.
  const runtime = await import(`../../game/src/skins.js?resize-regression=${randomUUID()}`);
  return { Element, runtime, frames, observers, writes, requestAnimationFrame, computed,
    clearWrites() { writes.length = 0; },
    nextFrame() { const batch = [...frames.values()]; frames.clear(); phase = 'frame'; try { for (const callback of batch) callback(16); } finally { phase = 'decorate'; } },
  };
}

test('ResizeObserver delivery performs no layout reads or writes until the next animation frame', async t => {
  const dom = await skinDom(t), panel = new dom.Element('section', { classes: 'scroll-surface', width: 600, height: 800, scale: '.4' });
  dom.runtime.decorateSkins(panel); assert.equal(dom.observers.length, 1); assert.equal(dom.observers[0].observe.mock.callCount(), 1);
  dom.clearWrites(); const reads = panel.layoutReads, computed = dom.computed.mock.callCount();
  dom.observers[0].deliver([panel]);
  assert.equal(dom.writes.length, 0); assert.equal(panel.layoutReads, reads); assert.equal(dom.computed.mock.callCount(), computed); assert.equal(dom.frames.size, 1);
  panel.width = 650; panel.height = 920; dom.nextFrame();
  assert.ok(dom.writes.length > 0); assert.ok(dom.writes.every(write => write.phase === 'frame'));
  assert.equal(panel.style.values.get('--skin-height'), '920px'); assert.equal(panel.style.values.get('--skin-top'), '72px');
});

test('multiple deliveries and duplicate targets merge into one update per element per frame', async t => {
  const dom = await skinDom(t), root = new dom.Element(), panel = new dom.Element('section', { classes: 'scroll-surface', width: 600, height: 800 }), button = new dom.Element('button', { classes: 'primary-button', width: 300, height: 50 });
  root.append(panel); root.append(button); dom.runtime.decorateSkins(root); dom.clearWrites();
  const observer = dom.observers[0]; observer.deliver([panel, panel]); observer.deliver([button, panel]); observer.deliver([button]);
  assert.equal(dom.requestAnimationFrame.mock.callCount(), 1); assert.equal(dom.frames.size, 1); assert.equal(dom.writes.length, 0);
  panel.height = 900; button.height = 60; dom.nextFrame();
  for (const element of [panel, button]) {
    const hostWrites = dom.writes.filter(write => write.element === element);
    assert.equal(hostWrites.filter(write => write.name === '--skin-height').length, 1);
    assert.equal(new Set(hostWrites.map(write => write.name)).size, hostWrites.length);
    const geometry = dom.runtime.getSkinGeometry(element.dataset.skinKind, element.width, element.height);
    assert.equal(element.style.values.get('--skin-height'), `${geometry.height}px`);
  }
  assert.equal(dom.frames.size, 0);
  dom.clearWrites(); observer.deliver([panel]); assert.equal(dom.requestAnimationFrame.mock.callCount(), 2); assert.equal(dom.writes.length, 0); dom.nextFrame();
  assert.equal(dom.writes.filter(write => write.element === panel && write.name === '--skin-height').length, 1);
});

test('a detached pending target is not measured or written and is unobserved on decoration cleanup', async t => {
  const dom = await skinDom(t), root = new dom.Element(), panel = new dom.Element('section', { classes: 'parchment-modal paper-panel' }); root.append(panel);
  dom.runtime.decorateSkins(root); dom.clearWrites(); const reads = panel.layoutReads;
  dom.observers[0].deliver([panel]); panel.remove(); dom.runtime.decorateSkins(root); dom.nextFrame();
  assert.equal(dom.writes.length, 0); assert.equal(panel.layoutReads, reads);
  assert.equal(dom.observers[0].unobserve.mock.callCount(), 1); assert.equal(dom.observers[0].unobserve.mock.calls[0].arguments[0], panel);
});

test('decoration remains idempotent and updates bitmap piece dimensions after a resize', async t => {
  const dom = await skinDom(t), panel = new dom.Element('section', { classes: 'scroll-surface', width: 1009, height: 1485, scale: '.5' });
  dom.runtime.decorateSkins(panel); dom.runtime.decorateSkins(panel);
  const layer = panel.children.find(child => child.classList.contains('bitmap-skin'));
  assert.equal(panel.children.filter(child => child.classList.contains('bitmap-skin')).length, 1); assert.equal(dom.observers[0].observe.mock.callCount(), 1); assert.equal(layer.attributes.get('aria-hidden'), 'true');
  dom.clearWrites(); panel.scale = '.25'; dom.observers[0].deliver([panel, panel]); dom.nextFrame();
  const geometry = dom.runtime.getSkinGeometry('scroll', panel.width, panel.height, { scale: .25 });
  for (const piece of geometry.pieces) {
    const element = layer.children.find(child => child.dataset.skinPart === piece.part);
    assert.equal(element.style.values.get('--skin-piece-width'), `${piece.width}px`); assert.equal(element.style.values.get('--skin-piece-height'), `${piece.height}px`);
    assert.equal(dom.writes.filter(write => write.element === element && write.name === '--skin-piece-width').length, 1);
  }
});

test('geometry preserves button height scaling, narrow cap limits and zero vertical insets', () => {
  const normal = getSkinGeometry('button', 600, 42.6); assert.equal(normal.scale, .1); assert.equal(normal.left, 26); assert.equal(normal.right, 26); assert.equal(normal.height, 42.6); assert.equal(normal.top, 0); assert.equal(normal.bottom, 0);
  const narrow = getSkinGeometry('button', 261, 426); assert.equal(narrow.scale, .5); assert.equal(narrow.left + narrow.right, 260); assert.equal(narrow.height, 213);
});

test('scroll geometry preserves explicit scale, full surface height and original bitmap aspect ratios', () => {
  const half = getSkinGeometry('scroll', 504.5, 742.5); assert.equal(half.scale, .5); assert.equal(half.left, 60); assert.equal(half.top, 90); assert.equal(half.height, 742.5);
  const explicit = getSkinGeometry('scroll', 700, 1000, { scale: .25 }); assert.equal(explicit.scale, .25); assert.equal(explicit.height, 1000);
  for (const piece of explicit.pieces) { const source = SKIN_DATA.assets.find(asset => asset.filename === piece.filename); assert.equal(piece.width, source.size[0] / 4); assert.equal(piece.height, source.size[1] / 4); }
  const limited = getSkinGeometry('scroll', 100, 50, { scale: 3 }); assert.equal(limited.scale, 49 / 360); assert.ok(Math.abs(limited.top + limited.bottom - 49) < 1e-10); assert.ok(limited.left + limited.right <= 99); assert.equal(limited.height, 50);
});

test('invalid geometry inputs return null without producing unusable CSS dimensions', () => {
  for (const [kind, width, height] of [['unknown', 100, 100], ['scroll', 0, 100], ['button', -1, 10], ['scroll', NaN, 100], ['button', Infinity, 20], ['scroll', 100, 0], ['scroll', 100, NaN]]) assert.equal(getSkinGeometry(kind, width, height), null);
});
