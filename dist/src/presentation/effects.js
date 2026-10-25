/** Bitmap-only battle presentation. Rules have already resolved before this runs. */
const TYPES = new Map([
  ['cardCommitted', 'play'], ['cardDiscarded', 'discard'], ['cardExhausted', 'play'],
  ['attackHit', 'slash'], ['blockGained', 'guard'], ['debtRepaid', 'soul'],
  ['powerGained', 'soul'], ['healed', 'soul'], ['statusApplied', 'curse'],
]);
const CARD_EVENTS = new Set(['cardCommitted', 'cardDiscarded', 'cardExhausted']);
const clamp = (value, low, high) => Math.max(low, Math.min(high, Number(value) || 0));

/** Keeps multi-hit and multi-enemy feedback bounded without delaying combat rules. */
export function planVisualEvents(events = []) {
  const result = [], committed = new Set(events.filter(e => e.type === 'cardCommitted').map(e => e.cardUid));
  const cards = new Set(), hitCounts = new Map();
  let actorIndex = -1, baseDelay = 0, discardIndex = 0;
  for (const event of events) {
    if (event.type === 'enemyAction') { actorIndex += 1; baseDelay = 180 + Math.min(actorIndex, 4) * 175; continue; }
    const fallback = TYPES.get(event.type);
    if (!fallback) continue;
    if (event.type === 'cardExhausted' && committed.has(event.cardUid)) continue;
    let delay = baseDelay;
    if (CARD_EVENTS.has(event.type)) {
      if (!event.cardUid || cards.has(event.cardUid)) continue;
      cards.add(event.cardUid);
      if (event.type !== 'cardCommitted') delay += Math.min(discardIndex++ * 22, 88);
    } else {
      const key = `${actorIndex}:${event.targetUid || 'player'}:${event.type}`;
      const count = hitCounts.get(key) || 0;
      // Hundreds of damage events can occur in one combo; render up to three
      // readable pulses per actor/target while rules still resolve every hit.
      if (count >= 3) continue;
      hitCounts.set(key, count + 1);
      delay += 65 + count * 42;
    }
    result.push({ event, effectId: CARD_EVENTS.has(event.type) ? fallback : (event.impact || fallback), delay });
  }
  return result;
}

function rectValue(rect) {
  return { x: rect.x ?? rect.left, y: rect.y ?? rect.top, width: rect.width, height: rect.height };
}
function center(rect) { return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; }
function reducedMotion() { return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false; }

/**
 * root is an element, or a function returning the current #app.
 * capture BEFORE render(), then await play(next.events, snapshot) AFTER render().
 * The portal is outside #app so replacing innerHTML does not remove animation.
 */
export function createEffectsPresenter({ root, visuals = {}, assetUrl } = {}) {
  const resolveRoot = () => typeof root === 'function' ? root() : root;
  const resolveScene = () => resolveRoot()?.querySelector('.game-shell') || resolveRoot();
  const definitions = Array.isArray(visuals) ? Object.fromEntries(visuals.map(v => [v.id, v])) : visuals;
  const resolveAsset = assetUrl || (name => new URL(`../../public/assets/${name}.png`, import.meta.url).href);
  const active = new Set();
  let portal, guide, guideAnimation, destroyed = false, portalBounds;

  // Preload the nine small reusable effects before the first combat interaction.
  for (const visual of Object.values(definitions)) {
    if (!visual.asset || typeof Image === 'undefined') continue;
    const preload = new Image(); preload.src = resolveAsset(visual.asset);
  }
  function ensurePortal(bounds = portalBounds || resolveScene()?.getBoundingClientRect()) {
    if (!portal?.isConnected) {
      portal = document.createElement('div'); portal.className = 'fx-portal';
      portal.setAttribute('aria-hidden', 'true'); document.body.append(portal);
    }
    if (bounds) {
      portalBounds = rectValue(bounds);
      Object.assign(portal.style, { left: `${portalBounds.x}px`, top: `${portalBounds.y}px`, width: `${portalBounds.width}px`, height: `${portalBounds.height}px` });
    }
    return portal;
  }
  function animation(element, frames, options = {}) {
    let disposed = false, timer, anim, settle;
    const done = new Promise(resolve => { settle = resolve; });
    const finish = () => { if (disposed) return; disposed = true; clearTimeout(timer); active.delete(finish); element.remove(); settle(); };
    active.add(finish);
    const duration = reducedMotion() ? Math.min(100, options.duration || 100) : options.duration;
    const delay = reducedMotion() ? 0 : options.delay || 0;
    if (typeof element.animate === 'function') {
      anim = element.animate(frames, { ...options, duration, delay, fill: 'both' });
      anim.finished.then(finish, finish);
    }
    timer = setTimeout(finish, (duration || 440) + delay + 80);
    return done;
  }
  function capture() {
    const scene = resolveScene();
    if (!scene) return { cards: new Map(), enemies: new Map() };
    const bounds = rectValue(scene.getBoundingClientRect()), cards = new Map(), enemies = new Map(), enemyClones = new Map();
    for (const element of scene.querySelectorAll('.hand .card[data-uid]')) {
      const rect = rectValue(element.getBoundingClientRect());
      const style = getComputedStyle(element);
      const transform = style.transform === 'none' ? null : new DOMMatrixReadOnly(style.transform);
      const scale = transform ? Math.hypot(transform.a, transform.b) : 1;
      const width = parseFloat(style.width) * scale, height = parseFloat(style.height) * scale;
      const clone = element.cloneNode(true);
      clone.classList.remove('selected', 'dragging', 'unaffordable'); clone.classList.add('fx-card-copy');
      clone.removeAttribute('style'); clone.removeAttribute('id'); clone.setAttribute('tabindex', '-1'); clone.disabled = true;
      clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
      const origin = center(rect);
      cards.set(element.dataset.uid, { clone, rect: { x: origin.x - width / 2, y: origin.y - height / 2, width, height }, angle: transform ? Math.atan2(transform.b, transform.a) * 180 / Math.PI : 0 });
    }
    for (const slot of scene.querySelectorAll('.enemy-slot[data-enemy-uid]')) {
      const target = slot.querySelector('.enemy-target') || slot;
      enemies.set(slot.dataset.enemyUid, rectValue(target.getBoundingClientRect()));
      const clone = target.cloneNode(true);
      clone.classList.add('fx-enemy-copy'); clone.setAttribute('tabindex', '-1'); clone.disabled = true;
      clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
      clone.querySelectorAll('.enemy-float,.enemy-shadow').forEach(node => { node.style.animation = 'none'; });
      enemyClones.set(slot.dataset.enemyUid, clone);
    }
    const commands = scene.querySelector('.command-bar')?.getBoundingClientRect();
    const player = commands ? rectValue(commands) : { x: bounds.x + bounds.width * .2, y: bounds.y + bounds.height * .82, width: bounds.width * .6, height: bounds.height * .13 };
    return { bounds, cards, enemies, enemyClones, player };
  }
  function targetRect(uid, snapshot) {
    const scene = resolveScene();
    if (!uid || uid === 'player') return snapshot.player;
    const slot = [...(scene?.querySelectorAll('.enemy-slot[data-enemy-uid]') || [])].find(node => node.dataset.enemyUid === uid);
    return slot ? rectValue((slot.querySelector('.enemy-target') || slot).getBoundingClientRect()) : snapshot.enemies?.get(uid);
  }
  function visualRect(visual, event, snapshot, fallback) {
    if (visual?.anchor === 'bottom') return snapshot.player;
    if (visual?.anchor === 'card') return snapshot.cards?.get(event.cardUid)?.rect || fallback;
    return targetRect(event.targetUid, snapshot) || fallback;
  }
  function sprite(visual, rect, delay, card = false) {
    if (!visual?.asset || !rect || !rect.width || !rect.height) return Promise.resolve();
    const image = document.createElement('img'); image.className = 'fx-sprite';
    image.src = resolveAsset(visual.asset); image.alt = ''; image.draggable = false;
    const origin = center(rect), bounds = resolveScene()?.getBoundingClientRect();
    const base = card ? Math.max(rect.width, rect.height * .84) : Math.min(Math.max(rect.width, rect.height * .65), (bounds?.width || 480) * .72);
    const size = base * clamp(visual.size || 1, .2, 2);
    ensurePortal();
    image.style.left = `${origin.x - portalBounds.x}px`; image.style.top = `${origin.y - portalBounds.y}px`;
    image.style.width = `${size}px`; image.style.height = `${size}px`;
    ensurePortal().append(image);
    const scales = visual.scale || [.6, 1, 1.2], angles = visual.rotation || [0, 0], travel = visual.travel || [0, 0], opacity = visual.opacity || [0, 1, 0];
    const tx = rect.width * travel[0], ty = rect.height * travel[1];
    const at = (scale, rotation, x, y) => `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${rotation}deg) scale(${scale})`;
    const frames = reducedMotion() ? [{ opacity: .65 }, { opacity: 0 }] : [
      { offset: 0, opacity: opacity[0], transform: at(scales[0], angles[0], 0, 0) },
      { offset: .25, opacity: opacity[1], transform: at(scales[1], (angles[0] + angles[1]) / 2, tx * .3, ty * .3) },
      { offset: 1, opacity: opacity[2], transform: at(scales[2], angles[1], tx, ty) },
    ];
    return animation(image, frames, { duration: clamp(visual.durationMs || 440, 80, 500), delay, easing: 'ease-out' });
  }
  function vanishCard(entry, visual, delay, discard, effectRect) {
    if (!entry) return Promise.resolve();
    const copy = entry.clone.cloneNode(true), { rect, angle } = entry;
    ensurePortal();
    Object.assign(copy.style, { left: `${rect.x - portalBounds.x}px`, top: `${rect.y - portalBounds.y}px`, width: `${rect.width}px`, height: `${rect.height}px`, transform: `rotate(${angle}deg)` });
    ensurePortal().append(copy);
    // Reusing the actual card's bitmap layers keeps its frame, art and cost intact.
    // Shrink/fade reveals the generated ash or flames; no procedural fire is drawn.
    const frames = reducedMotion() ? [{ opacity: 1 }, { opacity: 0 }] : [
      { offset: 0, opacity: 1, transform: `rotate(${angle}deg) scale(1)` },
      { offset: .18, opacity: 1, transform: `translateY(-3%) rotate(${angle}deg) scale(1.025)` },
      { offset: .62, opacity: .28, transform: `translateY(-9%) rotate(${angle + (discard ? 5 : 0)}deg) scale(.87)` },
      { offset: 1, opacity: 0, transform: `translateY(-14%) rotate(${angle + (discard ? 8 : 0)}deg) scale(.6)` },
    ];
    return Promise.all([
      animation(copy, frames, { duration: clamp(visual?.durationMs || 440, 80, 500), delay, easing: 'ease-in' }),
      sprite(visual, effectRect || rect, delay, visual?.anchor === 'card'),
    ]);
  }
  function flashEnemy(uid, delay) {
    const scene = resolveScene(), slot = [...(scene?.querySelectorAll('.enemy-slot[data-enemy-uid]') || []), ...(portal?.querySelectorAll('.fx-enemy-copy[data-enemy-uid]') || [])].find(node => node.dataset.enemyUid === uid);
    const image = slot?.querySelector('.enemy-art');
    if (!image || typeof image.animate !== 'function') return Promise.resolve();
    const scale = Number(getComputedStyle(image).getPropertyValue('--enemy-art-scale')) || 1;
    // A temporary state filter colors the complete existing sprite, including its alpha outline.
    const frames = [
      { offset: 0, filter: 'brightness(1) sepia(0) saturate(1) hue-rotate(0deg)', transform: `translateX(0) scale(${scale})` },
      { offset: .12, filter: 'brightness(.65) sepia(1) saturate(8) hue-rotate(-45deg)', transform: `translateX(-3px) scale(${scale})` },
      { offset: .82, filter: 'brightness(.65) sepia(1) saturate(8) hue-rotate(-45deg)', transform: `translateX(2px) scale(${scale})` },
      { offset: 1, filter: 'brightness(1) sepia(0) saturate(1) hue-rotate(0deg)', transform: `translateX(0) scale(${scale})` },
    ];
    const anim = image.animate(reducedMotion() ? [{ filter: frames[1].filter }, { filter: 'none' }] : frames, { duration: reducedMotion() ? 80 : 340, delay: reducedMotion() ? 0 : delay, easing: 'ease-out' });
    return anim.finished.catch(() => {});
  }
  function departingEnemy(uid, snapshot, lastHitDelay) {
    if (!snapshot.enemyClones?.has(uid)) return Promise.resolve();
    const stillThere = [...(resolveScene()?.querySelectorAll('.enemy-slot[data-enemy-uid]') || [])].some(node => node.dataset.enemyUid === uid);
    if (stillThere) return Promise.resolve();
    const clone = snapshot.enemyClones.get(uid).cloneNode(true), rect = snapshot.enemies.get(uid);
    ensurePortal();
    Object.assign(clone.style, { left: `${rect.x - portalBounds.x}px`, top: `${rect.y - portalBounds.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    clone.dataset.enemyUid = uid; portal.append(clone);
    const frames = reducedMotion() ? [{ opacity: .8 }, { opacity: 0 }] : [
      { offset: 0, opacity: 1, transform: 'scale(1)' },
      { offset: .5, opacity: 1, transform: 'scale(1)' },
      { offset: 1, opacity: 0, transform: 'translateY(-12px) scale(.95)' },
    ];
    return animation(clone, frames, { duration: Math.min(500, lastHitDelay + 340), easing: 'ease-in' });
  }
  async function play(events = [], snapshot = capture()) {
    if (destroyed || !snapshot.bounds) return;
    setSelfGuide({ visible: false });
    ensurePortal(snapshot.bounds);
    const jobs = [], cues = planVisualEvents(events), departed = new Map();
    for (const cue of cues) if (cue.event.type === 'attackHit' && cue.event.targetUid !== 'player') departed.set(cue.event.targetUid, Math.max(cue.delay, departed.get(cue.event.targetUid) || 0));
    for (const [uid, delay] of departed) jobs.push(departingEnemy(uid, snapshot, delay));
    for (const cue of cues) {
      const { event, effectId, delay } = cue;
      const visual = definitions[effectId] || definitions[TYPES.get(event.type)];
      const rect = visualRect(visual, event, snapshot, targetRect(event.targetUid, snapshot));
      if (CARD_EVENTS.has(event.type)) jobs.push(vanishCard(snapshot.cards?.get(event.cardUid), visual, delay, event.type === 'cardDiscarded', rect));
      else {
        jobs.push(sprite(visual, rect, delay, visual?.anchor === 'card'));
        if (event.type === 'attackHit' && event.targetUid !== 'player') jobs.push(flashEnemy(event.targetUid, delay));
      }
    }
    await Promise.allSettled(jobs);
    if (!portal?.childElementCount) { portal?.remove(); portal = null; }
  }
  function setSelfGuide({ visible = false, active: accepted = false, label = '向下拖至自身，松开打出' } = {}) {
    if (destroyed) return;
    const scene = resolveScene(), visual = definitions.selfGuide;
    if (!visible || !scene || !visual) { guideAnimation?.cancel(); guide?.remove(); guide = null; guideAnimation = null; return; }
    if (!guide?.isConnected) {
      guideAnimation?.cancel(); guideAnimation = null;
      guide = document.createElement('div'); guide.className = 'fx-self-guide';
      const image = document.createElement('img'); image.src = resolveAsset(visual.asset); image.alt = ''; image.draggable = false;
      guide.append(image); scene.append(guide);
    }
    guide.setAttribute('role', 'status'); guide.setAttribute('aria-label', label);
    guide.classList.toggle('fx-self-guide-ready', accepted);
    // This guide lives below .combat-bottom (z=5), so it never covers the hand.
    // The visible instruction text belongs in the existing hand-hint, not a new panel.
    if (!guideAnimation && !reducedMotion() && typeof guide.animate === 'function') {
      guideAnimation = guide.animate([{ opacity: .56 }, { opacity: .85 }, { opacity: .56 }], { duration: visual.durationMs || 900, iterations: Infinity, easing: 'ease-in-out' });
    }
  }
  function clear() {
    for (const finish of [...active]) finish();
    portal?.remove(); portal = null; setSelfGuide({ visible: false });
  }
  function destroy() { clear(); destroyed = true; }
  return { capture, play, setSelfGuide, clear, destroy };
}
