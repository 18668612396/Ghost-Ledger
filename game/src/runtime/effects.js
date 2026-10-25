import { evaluate, numeric, readPath, randomFromState, shuffled } from './expressions.js';
import { isAllowedStatePath } from './content-schema.js';

const zones = ['hand', 'drawPile', 'discard', 'exhaust', 'powerZone', 'limbo'];
const detrimental = new Set(['weak', 'exposed', 'frail', 'entangled', 'burn', 'noDraw']);
const ownEvents = new Set(['hpLost', 'attacked', 'blockGained', 'enemyDeath']);
export const living = enemy => Boolean(enemy && enemy.hp > 0 && !enemy.escaped && !enemy.dead);
export const liveEnemies = state => (state.enemies || []).filter(living);
export const actorByUid = (state, uid) => !uid || uid === 'player' ? state : state.enemies.find(enemy => enemy.uid === uid);
export const cardByUid = (state, uid) => zones.flatMap(zone => state[zone] || []).find(card => card.uid === uid);
export function emit(state, type, details = {}) { state.events ||= []; state.events.push({ type, ...details }); }
export function makeCard(state, cardId, { upgradeLevel = 0, temporary = false } = {}) {
  return { uid: `v4-card-${state.nextUid++}`, cardId, upgradeLevel, upgraded: upgradeLevel > 0, ...(temporary ? { temporary: true } : {}) };
}
export function definitionFor(content, card) {
  const base = content.cards[typeof card === 'string' ? card : card.cardId];
  if (!base) return null;
  const level = typeof card === 'object' ? card.upgradeLevel || (card.upgraded ? 1 : 0) : 0;
  return level > 0 ? { ...base, ...base.upgrade, id: base.id, upgrade: base.upgrade } : base;
}
function powersOf(actor) { return actor.powers ||= {}; }
export function modifier(state, actor, content, name) {
  return Object.entries(actor.powers || {}).reduce((total, [id, instance]) => {
    const value = content.powers[id]?.modifiers?.[name];
    if (value == null) return total;
    const amount = evaluate(value, { player: state, source: actor, power: instance });
    return total + (typeof amount === 'boolean' ? Number(amount) : Number(amount) * instance.amount);
  }, 0);
}
export function frameEnvironment(state, content, frame = {}) {
  const source = actorByUid(state, frame.sourceUid) || state;
  const target = actorByUid(state, frame.targetUid) || state;
  return { player: state, state, source, target, card: cardByUid(state, frame.cardUid) || frame.card || {}, context: frame.context ||= {}, event: frame.event || {}, power: frame.power || {}, content, random: () => randomFromState(state) };
}
export function cardView(state, card, content) {
  const instance = typeof card === 'string' ? { cardId: card, upgradeLevel: 0 } : card;
  const def = definitionFor(content, instance);
  if (!def) return null;
  const env = { player: state, state, source: state, target: liveEnemies(state)[0] || {}, card: instance, context: {}, content, preview: true };
  const keywords = def.keywords || [];
  let cost = def.cost;
  if (typeof cost === 'number') {
    cost = Math.max(0, cost + Number(evaluate(def.costModifier || 0, env)));
    if (def.type === 'skill' && modifier(state, state, content, 'skillCostZero')) cost = 0;
    if (instance.temporaryCost != null) cost = instance.temporaryCost;
  }
  let reason = '';
  if (keywords.includes('unplayable') || cost === null) reason = '这张牌不能主动打出';
  else if (state.entangled > 0 && def.type === 'attack') reason = '缠绕中，无法打出攻击牌';
  else if (def.playCondition && !evaluate(def.playCondition, env)) reason = def.playConditionText || '尚未满足出牌条件';
  else if (typeof cost === 'number' && state.energy < cost) reason = '香火不足';
  else if (state.pendingChoice) reason = '请先完成当前选牌';
  const description = (def.text || '').replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, key) => Object.hasOwn(def.textValues || {}, key) ? String(evaluate(def.textValues[key], env)) : match);
  return { ...def, cost, name: `${def.name}${instance.upgradeLevel > 0 || instance.upgraded ? `+${instance.upgradeLevel > 1 ? instance.upgradeLevel : ''}` : ''}`, description, upgraded: Boolean(instance.upgradeLevel || instance.upgraded), upgradeLevel: instance.upgradeLevel || 0, exhaust: keywords.includes('exhaust'), ethereal: keywords.includes('ethereal'), playable: !reason, reason };
}
export function initializeResolution(state) {
  state.effectQueue ||= []; state.resolutionFrames ||= {}; state.nextFrameId ||= 1;
  state.limbo ||= []; state.powers ||= {}; state.powerZone ||= []; state.events ||= [];
  state.combatCounters ||= { repaid: 0, hpLossEvents: 0, cardsPlayed: 0 };
}
export function newFrame(state, details = {}) {
  initializeResolution(state);
  const id = `frame-${state.nextFrameId++}`;
  state.resolutionFrames[id] = { sourceUid: 'player', context: {}, ...details };
  return id;
}
export function queueEffects(state, effects, frameId, front = true) {
  const entries = (effects || []).map(effect => ({ effect, frameId }));
  if (front) state.effectQueue.unshift(...entries); else state.effectQueue.push(...entries);
}
function triggerList(state, content, frame, triggers, triggerOwnerKey, event, eventName, items) {
  for (const [index, trigger] of (triggers || []).entries()) {
    if (trigger.event !== eventName) continue;
    const env = frameEnvironment(state, content, { ...frame, event });
    if (trigger.when && !evaluate(trigger.when, env)) continue;
    const key = `${triggerOwnerKey}:${trigger.id || index}:${eventName}`;
    const turnKey = `${state.stats.battlesStarted}:${state.turn}`;
    state.triggerUsage ||= {};
    if (trigger.limit === 'oncePerTurn' && state.triggerUsage[key] === turnKey) continue;
    if (trigger.limit === 'oncePerCombat' && state.triggerUsage[key] === state.stats.battlesStarted) continue;
    if (trigger.limit) state.triggerUsage[key] = trigger.limit === 'oncePerTurn' ? turnKey : state.stats.battlesStarted;
    const id = newFrame(state, { ...frame, event: { ...event }, context: {} });
    items.push(...trigger.effects.map(effect => ({ effect, frameId: id })));
  }
}
export function fireEvent(state, content, name, data = {}) {
  const event = { ...data };
  const items = [];
  for (const id of state.relics || []) {
    if (name !== 'enemyDeath' && ownEvents.has(name) && event.targetUid !== 'player') continue;
    triggerList(state, content, { sourceUid: 'player', targetUid: event.sourceUid }, content.relics[id]?.triggers, `relic:${id}`, event, name, items);
  }
  for (const owner of [state, ...(state.enemies || [])]) {
    const uid = owner === state ? 'player' : owner.uid;
    if (ownEvents.has(name) && event.targetUid !== uid) continue;
    if (name.startsWith('enemyAction') && event.actorUid !== uid) continue;
    if (owner !== state && !living(owner) && name !== 'enemyDeath') continue;
    for (const [id, power] of Object.entries(owner.powers || {})) {
      triggerList(state, content, { sourceUid: uid, targetUid: event.sourceUid, power: { ...power } }, content.powers[id]?.triggers, `${uid}:${id}`, event, name, items);
    }
    if (owner !== state) triggerList(state, content, { sourceUid: uid, targetUid: event.sourceUid }, content.enemies[owner.id]?.triggers, uid, event, name, items);
  }
  for (const zone of ['hand', 'drawPile', 'discard', 'exhaust', 'limbo']) {
    for (const card of state[zone] || []) {
      const def = definitionFor(content, card);
      triggerList(state, content, { sourceUid: 'player', cardUid: card.uid }, (def?.triggers || []).filter(trigger => !trigger.zones || trigger.zones.includes(zone)), card.uid, event, name, items);
    }
  }
  state.effectQueue.unshift(...items);
}
function getTargets(state, frame, target = 'self') {
  const source = actorByUid(state, frame.sourceUid) || state;
  if (target === 'player') return [state];
  if (target === 'self' || target === 'source') return [source];
  if (target === 'attacker') return [actorByUid(state, frame.event?.sourceUid)].filter(Boolean);
  if (target === 'allEnemies') return liveEnemies(state);
  if (target === 'randomEnemy') { const enemies = liveEnemies(state); return enemies.length ? [enemies[Math.floor(randomFromState(state) * enemies.length)]] : []; }
  if (target === 'ally') {
    const selected = liveEnemies(state).find(enemy => enemy.uid === frame.targetUid && enemy.uid !== source.uid);
    return [selected || liveEnemies(state).find(enemy => enemy.uid !== source.uid) || source];
  }
  if (target === 'enemy' || target === 'target') return [actorByUid(state, frame.targetUid)].filter(actor => actor && (actor === state || living(actor)));
  return [actorByUid(state, target)].filter(Boolean);
}
const uidOf = (state, actor) => actor === state ? 'player' : actor.uid;
function countStat(state, key, amount) { state.stats[key] = (state.stats[key] || 0) + amount; }
function log(state, text) { state.log = [...(state.log || []), text].slice(-8); }
export function applyHpLoss(state, content, target, amount, { sourceUid = 'player', attack = false, hit = false, cause = 'card', ignoreBlock = true, cardUid = null, cardId = null, impact = 'soul' } = {}) {
  const raw = Math.max(0, Math.floor(amount));
  const prevented = ignoreBlock ? 0 : Math.min(target.block || 0, raw);
  target.block = Math.max(0, (target.block || 0) - prevented);
  const damage = Math.min(target.hp, raw - prevented);
  target.hp -= damage;
  const targetUid = uidOf(state, target);
  if (target === state) { countStat(state, 'damageTaken', damage); if (damage) state.combatCounters.hpLossEvents++; }
  else countStat(state, 'damageDealt', damage);
  const event = { sourceUid, targetUid, amount: damage, hpLoss: damage, raw, attack, cause, cardUid, cardId, impact };
  emit(state, attack || hit ? 'attackHit' : 'hpLost', event);
  // Player HP loss is also an audit event; the presentation consumes attackHit
  // and ignores hpLost, so this does not duplicate animation or rule triggers.
  if (target === state && (attack || hit) && damage > 0) emit(state, 'hpLost', event);
  if (target !== state && target.hp <= 0 && !target.dead) {
    target.dead = true; countStat(state, 'kills', 1); countStat(state, 'enemiesKilled', 1);
    if (target.stolen) { state.gold += target.stolen; countStat(state, 'goldRecovered', target.stolen); target.stolen = 0; }
    emit(state, 'enemyDeath', event); fireEvent(state, content, 'enemyDeath', event);
  }
  // The event queues are prepended; enqueue in reverse semantic order.
  if (damage) fireEvent(state, content, 'hpLost', event);
  if (attack) fireEvent(state, content, 'attacked', event);
  return damage;
}
export function addDebt(state, amount, delay = 2) {
  const debt = { id: `v4-debt-${state.nextDebtId++}`, amount, dueTurn: state.turn + delay, originalDueTurn: state.turn + delay, delayed: false };
  if (amount > 0) { state.debts.push(debt); countStat(state, 'borrowed', amount); emit(state, 'debtAdded', { amount, dueTurn: debt.dueTurn }); }
  return debt;
}
export function repayDebt(state, content, amount) {
  let remaining = Math.max(0, amount);
  state.debts.sort((a, b) => a.dueTurn - b.dueTurn);
  for (const debt of state.debts) { const paid = Math.min(debt.amount, remaining); debt.amount -= paid; remaining -= paid; }
  const actual = Math.max(0, amount) - remaining;
  state.debts = state.debts.filter(debt => debt.amount > 0);
  if (actual) {
    state.repaidThisTurn += actual; state.combatCounters.repaid += actual; countStat(state, 'repaid', actual);
    emit(state, 'debtRepaid', { amount: actual, targetUid: 'player' });
    fireEvent(state, content, 'debtRepaid', { amount: actual, targetUid: 'player', sourceUid: 'player' });
  }
  return actual;
}
function removeFromZones(state, uid) {
  for (const zone of zones) { const index = state[zone]?.findIndex(card => card.uid === uid); if (index >= 0) return state[zone].splice(index, 1)[0]; }
  return null;
}
function addToZone(state, card, zone, position) {
  const destination = zone === 'hand' && state.hand.length >= 10 ? 'discard' : zone;
  if (position === 'random' && destination === 'drawPile') state.drawPile.splice(Math.floor(randomFromState(state) * (state.drawPile.length + 1)), 0, card);
  else state[destination].push(card);
}
function exhaustCard(state, content, card, frameId, onEach) {
  const removed = removeFromZones(state, card.uid);
  if (!removed) return;
  state.exhaust.push(removed);
  const definition = definitionFor(content, removed);
  emit(state, 'cardExhausted', { cardUid: removed.uid, cardId: removed.cardId });
  if (onEach?.length) queueEffects(state, onEach, frameId);
  if (definition.onExhaust?.length) queueEffects(state, definition.onExhaust, newFrame(state, { cardUid: removed.uid }));
  fireEvent(state, content, 'cardExhausted', { cardUid: removed.uid, cardId: removed.cardId, cardType: definition.type, sourceUid: 'player', targetUid: 'player' });
}
function chooseCandidates(state, content, effect, frame) {
  const cards = state[effect.from || 'hand'] || [];
  return cards.filter(card => {
    const def = definitionFor(content, card);
    return card.uid !== frame.cardUid && (!effect.types || effect.types.includes(def.type)) && (!effect.excludeIds || !effect.excludeIds.includes(card.cardId)) && (effect.op !== 'upgrade' || def.upgradePolicy === 'repeat' || def.upgrade && !card.upgradeLevel);
  });
}
function requestChoice(state, content, effect, frameId) {
  const frame = state.resolutionFrames[frameId];
  const candidates = chooseCandidates(state, content, effect, frame);
  if (!candidates.length) { if (effect.op === 'exhaust') frame.context.exhausted = 0; return; }
  state.pendingChoice = { id: `choice-${state.nextFrameId++}`, title: effect.prompt || ({ exhaust: '选择一张牌消耗', moveCard: '选择取回的牌', copyCard: '选择复制的牌', upgrade: '选择一张牌升级' }[effect.op]), cardUids: candidates.map(card => card.uid), zone: effect.from || 'hand', effect, frameId };
}
export function resolveChoice(state, content, uid) {
  const choice = state.pendingChoice;
  if (!choice || !choice.cardUids.includes(uid)) return false;
  state.pendingChoice = null;
  const frame = state.resolutionFrames[choice.frameId]; frame.context.selectedCardUid = uid;
  queueEffects(state, [{ ...choice.effect, selection: 'resolved', selectedUid: uid }], choice.frameId);
  return true;
}
function upgradeCard(card, content) {
  const def = content.cards[card.cardId];
  if (def.upgradePolicy === 'repeat' || def.upgrade && !card.upgradeLevel) { card.upgradeLevel = (card.upgradeLevel || 0) + 1; card.upgraded = true; }
}
export function commitCard(state, content, card, targetUid, { free = false, forceExhaust = false, autoplay = false } = {}) {
  const view = cardView(state, card, content);
  const amount = view.cost === 'X' ? state.energy : view.cost;
  const source = removeFromZones(state, card.uid);
  if (!source) return false;
  state.limbo.push(source);
  const canAuto = !view.keywords?.includes('unplayable') && view.cost !== null && (!view.playCondition || evaluate(view.playCondition, { player: state, source: state, target: actorByUid(state, targetUid) || {}, card: source, content }));
  if (autoplay && !canAuto) {
    exhaustCard(state, content, source, newFrame(state, { cardUid: card.uid })); return true;
  }
  if (!free) state.energy -= amount;
  const frameId = newFrame(state, { cardUid: source.uid, targetUid, context: { x: view.cost === 'X' ? state.energy + (free ? 0 : amount) : 0, exhausted: 0, lastDamage: 0, lastPaid: 0, lastKilled: false } });
  let repeats = 1;
  if (view.type === 'attack' && state.repeatNext > 0) { repeats = 2; state.repeatNext--; }
  const finish = { op: '_finishCard', exhaust: forceExhaust || view.exhaust || (view.type === 'skill' && modifier(state, state, content, 'exhaustSkills') > 0), power: view.type === 'power' };
  const sequence = [];
  for (let i = 0; i < repeats; i++) sequence.push({ op: '_cardPlayed', type: view.type }, ...view.effects);
  sequence.push(finish);
  queueEffects(state, sequence, frameId);
  emit(state, 'cardCommitted', { cardUid: card.uid, cardId: card.cardId, targetUid, impact: view.visual.impact });
  return true;
}
function safeSet(actor, path, value) {
  if (!isAllowedStatePath(path)) throw new Error(`不允许修改状态路径 ${path}`);
  const parts = path.split('.'); let object = actor;
  while (parts.length > 1) { const key = parts.shift(); object = object[key] ||= {}; }
  object[parts[0]] = value;
}
export function expirePowers(state, content, boundary) {
  for (const owner of [state, ...state.enemies]) for (const [id, instance] of Object.entries(owner.powers || {})) {
    if (instance.expires === boundary || content.powers[id]?.expires === boundary) delete owner.powers[id];
  }
}
export function drainEffects(state, content, hooks = {}) {
  initializeResolution(state);
  let processed = 0;
  while (state.effectQueue.length && !state.pendingChoice && state.hp > 0) {
    if (++processed > 12000) throw new Error('效果触发超出保护上限，请检查循环触发配置');
    const { effect: effect, frameId } = state.effectQueue.shift();
    const frame = state.resolutionFrames[frameId];
    if (!frame) throw new Error('结算帧缺失');
    const env = frameEnvironment(state, content, frame);
    const value = (field, fallback = 0) => numeric(effect[field] ?? fallback, env);
    const targets = () => effect.targetUid && effect.target === 'ally' ? [liveEnemies(state).find(enemy => enemy.uid === effect.targetUid) || env.source] : getTargets(state, frame, effect.target);
    switch (effect.op) {
      case 'if': queueEffects(state, evaluate(effect.condition, env) ? effect.then : effect.else, frameId); break;
      case 'damage': {
        frame.context.lastDamage = 0; frame.context.lastKilled = false;
        const instructions = [];
        const hits = Math.max(0, Math.floor(value('hits', 1)));
        for (let hit = 0; hit < hits; hit++) instructions.push({ ...effect, op: '_damageHit', hits: 1 });
        queueEffects(state, instructions, frameId); break;
      }
      case '_damageHit': {
        const victims = targets(); let healed = 0;
        for (const target of victims) {
          if (target !== state && !living(target)) continue;
          const attack = effect.attack !== false;
          const base = Math.max(0, value('amount') + (attack ? (env.source.strength || 0) * value('strengthScale', 1) + (env.source.attackBonus || 0) : 0));
          const amount = Math.floor(base * (attack && env.source.weak > 0 ? .75 : 1) * (attack && target.exposed > 0 ? 1.5 : 1));
          const damage = applyHpLoss(state, content, target, amount, { sourceUid: frame.sourceUid, attack, hit: true, ignoreBlock: Boolean(effect.ignoreBlock), cause: effect.cause || (env.source === state ? 'card' : 'enemy'), cardUid: env.card.uid, cardId: env.card.cardId, impact: effect.impact || definitionFor(content, env.card)?.visual?.impact || env.power.impact || 'slash' });
          frame.context.lastDamage += damage; healed += damage;
          if (target !== state && target.hp <= 0) { frame.context.lastKilled = true; if (effect.fatalMaxHp && !target.minion) { const gain = value('fatalMaxHp'); state.maxHp += gain; state.hp += gain; } }
        }
        if (effect.healFromDamage) { const gain = Math.min(healed, state.maxHp - state.hp); state.hp += gain; emit(state, 'healed', { amount: gain, targetUid: 'player' }); }
        break;
      }
      case 'block': for (const target of targets()) {
        const gained = Math.max(0, Math.floor((value('amount') + (effect.modified === false ? 0 : target.dexterity || 0)) * (effect.modified !== false && target.frail > 0 ? .75 : 1)));
        target.block += gained; emit(state, 'blockGained', { amount: gained, targetUid: uidOf(state, target), impact: 'guard' });
        if (gained) fireEvent(state, content, 'blockGained', { amount: gained, sourceUid: frame.sourceUid, targetUid: uidOf(state, target) });
      } break;
      case 'energy': state.energy = Math.max(0, state.energy + value('amount')); break;
      case 'loseHp': applyHpLoss(state, content, env.source, value('amount'), { sourceUid: frame.sourceUid, cause: effect.cause || 'card', cardUid: env.card.uid, cardId: env.card.cardId }); break;
      case 'heal': { const amount = Math.min(state.maxHp - state.hp, value('amount')); state.hp += amount; emit(state, 'healed', { amount, targetUid: 'player' }); break; }
      case 'status': for (const target of targets()) {
        const amount = value('amount');
        const debuff = effect.debuff ?? (detrimental.has(effect.key) && amount > 0 || ['strength', 'dexterity'].includes(effect.key) && amount < 0);
        if (debuff && target.artifact > 0) { target.artifact--; emit(state, 'artifactBlocked', { targetUid: uidOf(state, target) }); }
        else { target[effect.key] = (target[effect.key] || 0) + amount; if (target === state && ['enemies', 'handEnd'].includes(state.turnStage) && detrimental.has(effect.key)) state.freshStatuses[effect.key] = true; }
      } break;
      case 'power': for (const target of targets()) {
        if (!content.powers[effect.id]) throw new Error(`能力不存在 ${effect.id}`);
        if (content.powers[effect.id].debuff && target.artifact > 0) { target.artifact--; break; }
        const powers = powersOf(target); const old = powers[effect.id];
        powers[effect.id] = { amount: (old?.amount || 0) + value('amount', 1), impact: effect.impact || definitionFor(content, env.card)?.visual?.impact || old?.impact || 'soul', ...(effect.duration === 'turn' ? { expires: 'turnEnd' } : effect.duration ? { expires: effect.duration } : {}) };
        emit(state, 'powerGained', { powerId: effect.id, amount: powers[effect.id].amount, targetUid: uidOf(state, target) });
      } break;
      case 'draw': if (!modifier(state, state, content, 'noDraw')) queueEffects(state, Array.from({ length: Math.max(0, Math.floor(value('amount'))) }, () => ({ op: '_drawOne' })), frameId); break;
      case '_drawOne': {
        if (state.hand.length >= 10 || modifier(state, state, content, 'noDraw')) break;
        if (!state.drawPile.length && state.discard.length) { state.drawPile = shuffled(state, state.discard); state.discard = []; }
        const card = state.drawPile.pop(); if (!card) break;
        delete card.temporaryCost; state.hand.push(card); const def = definitionFor(content, card);
        emit(state, 'cardDrawn', { cardUid: card.uid, cardId: card.cardId });
        if (def.onDraw?.length) queueEffects(state, def.onDraw, newFrame(state, { cardUid: card.uid }));
        fireEvent(state, content, 'cardDrawn', { cardUid: card.uid, cardId: card.cardId, cardType: def.type, sourceUid: 'player', targetUid: 'player' });
        break;
      }
      case 'addCard': for (let index = 0; index < value('amount', 1); index++) addToZone(state, makeCard(state, effect.cardId, { temporary: true, upgradeLevel: value('upgradeLevel') }), effect.zone, effect.position); break;
      case 'exhaust': {
        if (effect.selection === 'chosen') { requestChoice(state, content, effect, frameId); break; }
        let cards = effect.selection === 'resolved' ? [cardByUid(state, effect.selectedUid)].filter(Boolean) : [...state.hand];
        if (effect.selection === 'nonAttacks') cards = cards.filter(card => definitionFor(content, card).type !== 'attack');
        if (effect.selection === 'randomHand') cards = shuffled(state, cards).slice(0, value('amount', 1));
        frame.context.exhausted = cards.length;
        queueEffects(state, cards.map(card => ({ op: '_exhaustOne', uid: card.uid, onEach: effect.onEach })), frameId); break;
      }
      case '_exhaustOne': { const card = cardByUid(state, effect.uid); if (card) exhaustCard(state, content, card, frameId, effect.onEach); break; }
      case 'moveCard':
        if (effect.selection === 'chosen') requestChoice(state, content, effect, frameId);
        else { const card = removeFromZones(state, effect.selectedUid); if (card) addToZone(state, card, effect.to, effect.position); }
        break;
      case 'copyCard': {
        if (effect.selection === 'chosen') { requestChoice(state, content, effect, frameId); break; }
        const original = effect.selection === 'self' ? env.card : cardByUid(state, effect.selectedUid);
        if (!original) break;
        for (let index = 0; index < value('amount', 1); index++) {
          const card = { ...structuredClone(original), uid: `v4-card-${state.nextUid++}`, temporary: true };
          if (effect.temporaryCost != null) card.temporaryCost = value('temporaryCost');
          addToZone(state, card, effect.zone || 'hand');
        }
        break;
      }
      case 'upgrade':
        if (effect.selection === 'chosen') requestChoice(state, content, effect, frameId);
        else for (const card of effect.selection === 'allHand' ? state.hand : [cardByUid(state, effect.selectedUid)].filter(Boolean)) upgradeCard(card, content);
        break;
      case 'modifyCard': {
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(effect.key) || ['uid', 'cardId', '__proto__', 'constructor', 'prototype'].includes(effect.key)) throw new Error('非法卡牌修改字段');
        env.card[effect.key] = effect.operation === 'set' ? value('amount') : (env.card[effect.key] || 0) + value('amount'); break;
      }
      case 'playTop': {
        if (!state.drawPile.length && state.discard.length) { state.drawPile = shuffled(state, state.discard); state.discard = []; }
        const card = state.drawPile.at(-1); if (!card) break;
        const enemies = liveEnemies(state); const target = enemies[Math.floor(randomFromState(state) * enemies.length)];
        commitCard(state, content, card, target?.uid, { free: true, forceExhaust: effect.exhaust !== false, autoplay: true }); break;
      }
      case 'generateCard': {
        const pool = Object.values(content.cards).filter(card => card.pool === 'ironclad' && card.type === effect.pool && card.generation?.combat !== false);
        if (!pool.length) break;
        const def = pool[Math.floor(randomFromState(state) * pool.length)]; const card = makeCard(state, def.id, { temporary: true }); card.temporaryCost = value('temporaryCost'); addToZone(state, card, 'hand'); break;
      }
      case 'repeatNext': state.repeatNext = (state.repeatNext || 0) + value('amount'); break;
      case 'debt': addDebt(state, value('amount'), value('delay', 2)); break;
      case 'repay': frame.context.lastPaid = repayDebt(state, content, value('amount')); break;
      case 'delayDebt': {
        const debt = [...state.debts].filter(item => !item.delayed).sort((a, b) => a.dueTurn - b.dueTurn)[0];
        if (debt) { debt.dueTurn += value('amount', 1); debt.delayed = true; emit(state, 'debtDelayed', { debtId: debt.id, dueTurn: debt.dueTurn }); } break;
      }
      case 'set': for (const target of targets()) safeSet(target, effect.path, evaluate(effect.value, env)); break;
      case 'summon': if (hooks.summon) hooks.summon(state, env.source, effect); else throw new Error('缺少召唤处理器'); break;
      case 'steal': { const amount = Math.min(state.gold, value('amount')); state.gold -= amount; env.source.stolen = (env.source.stolen || 0) + amount; countStat(state, 'goldStolen', amount); break; }
      case 'escape': env.source.escaped = true; countStat(state, 'enemiesEscaped', 1); break;
      case 'changeIntent': if (hooks.changeIntent) hooks.changeIntent(state, env.source, effect.move); break;
      case 'transformCards': for (const zone of effect.zones || zones) for (const card of state[zone] || []) if (card.cardId === effect.from) card.cardId = effect.to; break;
      case 'gold': state.gold = Math.max(0, state.gold + value('amount')); break;
      case 'permanentCard': { const card = makeCard(state, effect.cardId); state.deckCards.push(card); state.deck.push(card.cardId); break; }
      case 'relic': hooks.relic?.(state, effect); break;
      case '_cardPlayed': {
        countStat(state, 'cardsPlayed', 1); state.combatCounters.cardsPlayed++;
        fireEvent(state, content, 'cardPlayed', { cardUid: env.card.uid, cardId: env.card.cardId, cardType: effect.type, sourceUid: 'player', targetUid: frame.targetUid }); break;
      }
      case '_finishCard': {
        const card = cardByUid(state, frame.cardUid); if (!card) break;
        if (effect.power) { removeFromZones(state, card.uid); state.powerZone.push(card); }
        else if (effect.exhaust) exhaustCard(state, content, card, frameId);
        else { removeFromZones(state, card.uid); state.discard.push(card); }
        break;
      }
      default: if (!hooks.step?.(state, effect, frameId)) throw new Error(`未知效果 ${effect.op}`);
    }
  }
  if (!state.effectQueue.length && !state.pendingChoice) state.resolutionFrames = {};
  if (state.hp <= 0) { state.effectQueue = []; state.pendingChoice = null; state.resolutionFrames = {}; }
  return state;
}
