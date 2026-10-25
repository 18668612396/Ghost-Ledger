import { CONTENT, CONTENT_REVISION } from '../generated/content-data.js';
import { evaluate, randomFromState, shuffled } from './expressions.js';
import { createConfiguredRoute, getConfiguredAvailableNodes, isValidConfiguredRoute, sampleConfiguredEncounter, createConfiguredEnemy, planConfiguredIntent, getConfiguredMoveIntent, getConfiguredIntentView } from './world.js';
import { initializeResolution, makeCard, definitionFor, cardView, liveEnemies, living, newFrame, queueEffects, drainEffects, fireEvent, emit, commitCard, resolveChoice, addDebt, repayDebt, applyHpLoss, expirePowers, modifier, cardByUid } from './effects.js';
import { validateContent } from './content-schema.js';

export const CONFIG_VERSION = 5;
export const contentFor = state => state?.contentSnapshot || CONTENT;
const clone = state => structuredClone(state);
const log = (state, message) => { state.log = [...state.log, message].slice(-8); };
const debtTotal = state => state.debts.reduce((sum, debt) => sum + debt.amount, 0);
const invalid = (state, notice) => ({ ...state, events: [], notice, lastEvent: { kind: 'invalid', message: notice } });
const random = state => randomFromState(state);
const pick = (state, items) => items[Math.floor(random(state) * items.length)];
const upgradeable = (card, content) => content.cards[card.cardId].upgradePolicy === 'repeat' || (!card.upgradeLevel && content.cards[card.cardId].upgrade);
const describe = (state, card) => cardView(state, card, contentFor(state));
export function getConfiguredCardView(state, card) {
  const preview = state || { energy: Infinity, hp: 80, maxHp: 80, block: 0, turn: 1, hand: [], drawPile: [], discard: [], exhaust: [], limbo: [], enemies: [], debts: [], powers: {}, combatCounters: {}, stats: {} };
  return cardView(preview, card, contentFor(state));
}
// Shared by aiming feedback and play validation. Merely inspecting targets must
// not resolve effects, consume randomness, or change the run.
export function getConfiguredCardEnemyTargets(state, card) {
  if (!state || !card) return [];
  const held = (state.hand || []).find(instance => typeof card === 'string'
    ? instance.uid === card || instance.cardId === card
    : instance.uid === card.uid);
  const instance = held || (typeof card === 'string' ? { cardId: card, upgradeLevel: 0 } : card);
  const view = cardView(state, instance, contentFor(state));
  if (!view || !['enemy', 'all'].includes(view.target)) return [];
  const reason = state.phase !== 'combat' ? '此刻不在战斗中。'
    : !held ? '此牌已不在手中。' : view.reason;
  return liveEnemies(state).map(enemy => ({ uid: enemy.uid, eligible: !reason, reason }));
}
export function getConfiguredEnemies(state) { return liveEnemies(state); }
export function getConfiguredEnemyIntent(state, uid) {
  const enemy = uid ? state.enemies.find(item => item.uid === uid) : liveEnemies(state)[0];
  return enemy ? getConfiguredIntentView(state, enemy, contentFor(state)) : null;
}
function addPermanent(state, id, level = 0) { const card = makeCard(state, id, { upgradeLevel: level }); state.deck.push(id); state.deckCards.push(card); return card; }
function grantRelic(state, requested) {
  const definitions = contentFor(state).relics;
  const choices = Object.keys(definitions).filter(id => !state.relics.includes(id));
  const id = requested || pick(state, choices);
  if (id && !state.relics.includes(id) && definitions[id]) { state.relics.push(id); return id; }
  state.gold += 50; return null;
}
function hooksFor(state) {
  const content = contentFor(state);
  return {
    summon(current, source, effect) {
      const children = effect.ids.map((id, position) => createConfiguredEnemy(id, current, position, content, () => random(current), effect.inheritHp ? source.hp : undefined));
      if (effect.replaceSource) current.enemies.splice(current.enemies.indexOf(source), 1, ...children);
      else current.enemies.push(...children.slice(0, Math.max(0, 5 - liveEnemies(current).length)));
      for (const enemy of children) enemy.intent = planConfiguredIntent(current, enemy, content, () => random(current));
      emit(current, 'summoned', { sourceUid: source.uid, targetUids: children.map(enemy => enemy.uid) });
    },
    changeIntent(current, source, move) { source.intent = getConfiguredMoveIntent(current, source, move, content, () => random(current)); source.intentAttacks = source.intent.effects.some(effect => effect.op === 'damage' && effect.attack !== false); },
    relic(current, effect) { grantRelic(current, effect.id); },
    step(current, effect, frameId) { return runPhaseStep(current, content, effect, frameId); },
  };
}
function runEffects(state, effects, details = {}) {
  queueEffects(state, effects, newFrame(state, details));
  drainEffects(state, contentFor(state), hooksFor(state));
}
function resetTurn(state, content) {
  state.energy = state.maxEnergy + modifier(state, state, content, 'energyPerTurn');
  if (!modifier(state, state, content, 'retainBlock')) state.block = 0;
  state.borrowedThisTurn = 0; state.repaidThisTurn = 0; state.repeatNext = 0; state.turnStage = 'player';
  const due = state.debts.filter(debt => debt.dueTurn <= state.turn).reduce((sum, debt) => sum + debt.amount, 0);
  state.debts = state.debts.filter(debt => debt.dueTurn > state.turn);
  if (due) {
    const damage = applyHpLoss(state, content, state, due * 2, { sourceUid: 'debt', cause: 'debt' });
    state.stats.defaults += due; state.stats.debtDamage += damage; log(state, `${due} 点阴债到期，索命 ${damage} 生命。`);
  }
}
function planAll(state, content) {
  for (const enemy of liveEnemies(state)) {
    enemy.intent = planConfiguredIntent(state, enemy, content, () => random(state));
    enemy.intentAttacks = enemy.intent.effects.some(effect => effect.op === 'damage' && effect.attack !== false);
  }
}
function beginCombat(state, encounter, kind, advance = true, normal = kind === 'battle') {
  const content = contentFor(state);
  if (state.stats.battlesStarted && advance) state.turn++;
  state.stats.battlesStarted++; if (normal) state.normalBattles++;
  state.phase = 'combat'; state.encounterId = encounter.id; state.encounterKind = kind;
  state.encounterHistory = [...state.encounterHistory, encounter.id].slice(-8);
  state.event = null; state.rewards = []; state.rewardInfo = null; state.combatTurn = 1;
  for (const key of ['strength', 'dexterity', 'weak', 'exposed', 'frail', 'entangled', 'artifact', 'block']) state[key] = 0;
  state.powers = {}; state.powerZone = []; state.limbo = []; state.exhaust = []; state.hand = []; state.discard = [];
  state.combatCounters = { repaid: 0, hpLossEvents: 0, cardsPlayed: 0 }; state.triggerUsage = {};
  state.effectQueue = []; state.resolutionFrames = {}; state.pendingChoice = null;
  state.drawPile = shuffled(state, state.deckCards.map(card => ({ ...card })));
  const innate = state.drawPile.filter(card => definitionFor(content, card).keywords?.includes('innate'));
  state.drawPile = state.drawPile.filter(card => !innate.includes(card)).concat(innate);
  state.enemies = encounter.enemies.map((id, index) => createConfiguredEnemy(id, state, index, content, () => random(state)));
  resetTurn(state, content);
  fireEvent(state, content, 'combatStart', { sourceUid: 'player', targetUid: 'player' });
  drainEffects(state, content, hooksFor(state));
  const openingDraw = state.relics.reduce((amount, id) => amount + (content.relics[id]?.modifiers?.openingDraw || 0), 0);
  runEffects(state, [{ op: 'draw', amount: Math.max(innate.length, 5 + openingDraw) }]);
  planAll(state, content);
  state.notice = `遭遇${encounter.label || encounter.name || '鬼怪'}。看清意图，再选择目标出牌。`;
  state.lastEvent = { kind: 'encounter', encounterId: encounter.id }; log(state, state.notice);
}
function completeNode(state) {
  if (!state.route.completedIds.includes(state.route.currentId)) state.route.completedIds.push(state.route.currentId);
  state.phase = 'map'; state.event = null; state.rewards = []; state.pendingChoice = null;
  state.notice = '沿相通的灯路，选择下一处落脚。';
}
function weighted(state, weights) {
  const values = Object.entries(weights); let cursor = random(state) * values.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [id, weight] of values) { cursor -= weight; if (cursor < 0) return id; }
  return values.at(-1)?.[0];
}
function rewardCards(state, count = 3) {
  const content = contentFor(state), act = content.acts[state.actId], result = [];
  const available = state.rewardPool.map(id => content.cards[id]).filter(Boolean);
  for (let index = 0; index < count; index++) {
    const rarity = weighted(state, act.rewards?.rarityWeights || { common: 60, uncommon: 37, rare: 3 });
    const wantDebt = !state.baseline && random(state) < (act.rewards?.debtChance?.[rarity] ?? .2);
    let pool = available.filter(card => card.rarity === rarity && (card.pool === 'debt') === wantDebt && !result.includes(card.id));
    if (!pool.length) pool = available.filter(card => card.rarity === rarity && !result.includes(card.id));
    if (!pool.length) pool = available.filter(card => !result.includes(card.id));
    if (pool.length) result.push(pick(state, pool).id);
  }
  return result;
}
function settleDefeat(state) {
  if (state.hp <= 0) {
    const fatal = [...(state.events || [])].reverse().find(event => event.type === 'hpLost' && event.targetUid === 'player' && event.amount > 0);
    state.phase = 'defeat'; state.notice = '灯火熄灭。回府整理这次夜巡的经验。';
    state.lastEvent = { kind: 'defeat', cause: typeof fatal?.cause === 'string' && fatal.cause ? fatal.cause : 'unknown', sourceUid: fatal?.sourceUid || 'unknown', cardId: fatal?.cardId || null, message: state.notice }; return true;
  }
  return false;
}
function settleCombat(state) {
  if (settleDefeat(state)) return;
  if (state.phase !== 'combat' || liveEnemies(state).length) return;
  state.effectQueue = []; state.pendingChoice = null; state.resolutionFrames = {};
  state.stats.battlesWon++;
  fireEvent(state, contentFor(state), 'combatVictory', { sourceUid: 'player', targetUid: 'player' });
  drainEffects(state, contentFor(state), hooksFor(state));
  if (settleDefeat(state)) return;
  if (state.encounterKind === 'boss') {
    completeNode(state); state.phase = 'victory'; state.debts = []; state.notice = '终审已过，此夜债清。'; state.lastEvent = { kind: 'victory' }; log(state, state.notice); return;
  }
  const gold = state.encounterKind === 'elite' ? 25 + Math.floor(random(state) * 11) : 10 + Math.floor(random(state) * 11);
  state.gold += gold; const relicId = state.encounterKind === 'elite' ? grantRelic(state) : null;
  let potionId = null;
  if (state.potions.length < 3 && random(state) < .4) { potionId = pick(state, Object.keys(contentFor(state).potions)); state.potions.push({ uid: `v4-potion-${state.nextPotionUid++}`, id: potionId }); }
  state.rewards = rewardCards(state); state.rewardInfo = { gold, relicId, potionId }; state.phase = 'reward';
  state.notice = '交锋告捷，选择一道新符，或轻装继续。'; state.lastEvent = { kind: 'reward-open' }; log(state, state.notice);
}
function runPhaseStep(state, content, effect, frameId) {
  switch (effect.op) {
    case '_turnEnd': state.turnStage = 'handEnd'; state.freshStatuses = {}; fireEvent(state, content, 'turnEnd', { sourceUid: 'player', targetUid: 'player' }); return true;
    case '_handEnd': {
      const card = state.hand.find(item => item.uid === effect.uid);
      if (card) queueEffects(state, definitionFor(content, card).onHandEnd, newFrame(state, { cardUid: card.uid })); return true;
    }
    case '_clearHandCard': {
      const card = state.hand.find(item => item.uid === effect.uid); if (!card) return true;
      const definition = definitionFor(content, card);
      if (definition.keywords?.includes('ethereal')) queueEffects(state, [{ op: '_exhaustOne', uid: card.uid }], frameId);
      else { state.hand = state.hand.filter(item => item.uid !== card.uid); delete card.temporaryCost; state.discard.push(card); emit(state, 'cardDiscarded', { cardUid: card.uid, cardId: card.cardId }); }
      return true;
    }
    case '_handBoundary': expirePowers(state, content, 'handEnd'); return true;
    case '_enemyBegin':
      expirePowers(state, content, 'turnEnd'); state.repeatNext = 0; state.turnStage = 'enemies';
      for (const enemy of liveEnemies(state)) enemy.block = 0;
      queueEffects(state, [...liveEnemies(state).map(enemy => ({ op: '_enemyAct', uid: enemy.uid })), { op: '_roundEnd' }], frameId); return true;
    case '_enemyAct': {
      const enemy = state.enemies.find(item => item.uid === effect.uid); if (!living(enemy)) return true;
      const action = enemy.intent; const intent = getConfiguredIntentView(state, enemy, content);
      emit(state, 'enemyAction', { enemyUid: enemy.uid, targetUid: 'player', move: action.move, label: action.label, amount: intent.amount, hits: intent.hits });
      const id = newFrame(state, { sourceUid: enemy.uid, targetUid: action.targetUid || 'player', context: {} });
      queueEffects(state, [...action.effects, ...(action.after || []), { op: '_afterEnemy', uid: enemy.uid, move: action.move }], id);
      fireEvent(state, content, 'enemyActionStart', { actorUid: enemy.uid, move: action.move }); return true;
    }
    case '_afterEnemy': {
      const enemy = state.enemies.find(item => item.uid === effect.uid); if (!enemy) return true;
      enemy.turns++; enemy.intentIndex = enemy.turns; enemy.ai.history = [...(enemy.ai.history || []), effect.move].slice(-8);
      for (const key of ['weak', 'exposed', 'frail']) enemy[key] = Math.max(0, (enemy[key] || 0) - 1);
      fireEvent(state, content, 'enemyActionEnd', { actorUid: enemy.uid, move: effect.move }); return true;
    }
    case '_roundEnd':
      expirePowers(state, content, 'roundEnd');
      if (!liveEnemies(state).length) return true;
      for (const key of ['weak', 'exposed', 'frail', 'entangled']) if (!state.freshStatuses[key]) state[key] = Math.max(0, state[key] - 1);
      state.turn++; state.combatTurn++; resetTurn(state, content);
      queueEffects(state, [{ op: '_turnStart' }, { op: 'draw', amount: 5 }, { op: '_planEnemies' }], frameId); return true;
    case '_turnStart': fireEvent(state, content, 'turnStart', { sourceUid: 'player', targetUid: 'player' }); return true;
    case '_planEnemies': planAll(state, content); return true;
    default: return false;
  }
}
function makeShop(state) {
  const cards = rewardCards(state, 3);
  state.shop = { removalUsed: false, offers: cards.map((cardId, index) => ({ id: `card-${index}`, kind: 'card', cardId, price: { common: 50, uncommon: 75, rare: 140 }[contentFor(state).cards[cardId].rarity] || 60, sold: false })) };
  const potions = contentFor(state).potions, potionId = pick(state, Object.keys(potions));
  state.shop.offers.push({ id: 'potion', kind: 'potion', potionId, price: potions[potionId].price, sold: false });
}
export function getConfiguredEventView(state) {
  if (state.phase !== 'event' || !state.event) return null;
  const content = contentFor(state), id = state.event.id;
  if (id === 'rest') return { id, title: '灯下歇脚', description: '照料伤势、锻造一道符，或偿还阴债。歇脚不推进债期。', choices: [
    { id: 'rest', title: `歇脚 · 恢复 ${Math.floor(state.maxHp * .3)} 生命`, description: '恢复最大生命的30%。' },
    { id: 'upgrade', title: '锻符 · 升级一张牌', description: '升级所选的永久副本。', disabled: !state.deckCards.some(card => upgradeable(card, content)) },
    { id: 'repay', title: '还愿 · 偿还4债、恢复4生命', description: '优先偿还最早到期的借据。', disabled: !debtTotal(state) },
  ] };
  if (id === 'upgrade' || id === 'remove') return { id, title: id === 'upgrade' ? '选择锻造的符箓' : '选择移除的符箓', description: '每张副本单独处理。', choices: [
    ...state.deckCards.filter(card => id === 'remove' || upgradeable(card, content)).map(card => ({ id: `${id}:${card.uid}`, cardUid: card.uid, cardId: card.cardId, title: describe(state, card).name, description: id === 'upgrade' ? describe(state, { ...card, upgraded: true, upgradeLevel: card.upgradeLevel + 1 }).description : '移除此永久副本。' })),
    { id: 'cancel', title: '返回', description: '暂不选择。' },
  ] };
  if (id === 'shop') return { id, title: '鬼市符铺', description: `持有 ${state.gold} 冥钱。购买与删牌不推进债期。`, choices: [
    ...state.shop.offers.map(offer => ({ id: `buy:${offer.id}`, cardId: offer.cardId, title: `${offer.kind === 'card' ? content.cards[offer.cardId].name : content.potions[offer.potionId].name} · ${offer.price} 冥钱`, description: offer.sold ? '已经售出。' : offer.kind === 'card' ? describe(state, offer.cardId).description : content.potions[offer.potionId].description, disabled: offer.sold || state.gold < offer.price || offer.kind === 'potion' && state.potions.length >= 3 })),
    { id: 'remove', title: `删牌 · ${state.removePrice} 冥钱`, description: '每店可删一张；下次费用增加25。', disabled: state.shop.removalUsed || state.gold < state.removePrice || state.deck.length <= 1 },
    { id: 'leave', title: '离开鬼市', description: '继续择路。' },
  ] };
  if (id === 'treasure') return { id, title: '遗落的魂匣', description: '一件旧物等着有缘的提灯人。', choices: [{ id: 'open', title: '开启魂匣', description: '获得一件本局法器。' }, { id: 'leave', title: '轻装离开', description: '继续前行。' }] };
  const event = content.events[id]; if (!event) return null;
  const env = { player: state, state, source: state, content, preview: true };
  return { ...event, choices: event.choices.map(choice => ({ ...choice, disabled: Boolean(choice.when && !evaluate(choice.when, env)) })) };
}
function eventAction(state, choiceId) {
  const view = getConfiguredEventView(state), content = contentFor(state);
  const choice = view.choices.find(item => item.id === choiceId); if (!choice || choice.disabled) return false;
  const id = view.id;
  if (id === 'rest') {
    if (choiceId === 'upgrade') { state.event = { id: 'upgrade' }; return true; }
    runEffects(state, choiceId === 'rest' ? [{ op: 'heal', amount: Math.floor(state.maxHp * .3) }] : [{ op: 'repay', amount: 4 }, { op: 'heal', amount: 4 }]); completeNode(state); return true;
  }
  if (id === 'upgrade' || id === 'remove') {
    if (choiceId === 'cancel') { state.event = { id: id === 'upgrade' ? 'rest' : 'shop' }; return true; }
    const card = state.deckCards.find(item => item.uid === choice.cardUid); if (!card) return false;
    if (id === 'upgrade') { card.upgradeLevel++; card.upgraded = true; state.upgrades[card.uid] = card.upgradeLevel; completeNode(state); }
    else {
      if (state.gold < state.removePrice || state.shop.removalUsed || state.deck.length <= 1) return false;
      const index = state.deckCards.indexOf(card); state.deckCards.splice(index, 1); state.deck.splice(index, 1); delete state.upgrades[card.uid]; state.gold -= state.removePrice; state.removePrice += 25; state.shop.removalUsed = true; state.event = { id: 'shop' };
    }
    return true;
  }
  if (id === 'shop') {
    if (choiceId === 'leave') completeNode(state);
    else if (choiceId === 'remove') state.event = { id: 'remove' };
    else { const offer = state.shop.offers.find(item => `buy:${item.id}` === choiceId); state.gold -= offer.price; offer.sold = true; if (offer.kind === 'card') addPermanent(state, offer.cardId); else state.potions.push({ uid: `v4-potion-${state.nextPotionUid++}`, id: offer.potionId }); }
    return true;
  }
  if (id === 'treasure') { const relicId = choiceId === 'open' ? grantRelic(state) : null; completeNode(state); state.lastEvent = { kind: 'treasure', relicId }; return true; }
  runEffects(state, choice.effects || []);
  if (choice.encounterId) beginCombat(state, sampleConfiguredEncounter(choice.encounterId, () => random(state), content, []), 'battle', true, false);
  else completeNode(state);
  return true;
}
export function createConfiguredAdventure(seed = Date.now(), options = {}) {
  const content = options.content || CONTENT, actId = options.actId || 'act1', act = content.acts[actId];
  if (!act) throw new Error(`未配置幕 ${actId}`);
  const normalized = Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 1;
  const start = act.starting || {}, defaultRelic = Object.values(content.relics).find(relic => relic.starter?.unlockId === null);
  const relicId = options.relicId || defaultRelic?.id;
  if (!content.relics[relicId]?.starter) throw new Error('出门法器必须引用已配置的行装。');
  const rewardPool = Object.values(content.cards).filter(card => ((act.cardPools || ['ironclad', 'debt']).includes(card.pool) || act.specialCards?.includes(card.id)) && (!options.baseline || card.pool !== 'debt') && !['status', 'curse'].includes(card.type) && ['common', 'uncommon', 'rare'].includes(card.rarity)).map(card => card.id);
  const state = {
    version: CONFIG_VERSION, ruleset: 'config-v2', contentRevision: options.contentRevision || CONTENT_REVISION, contentSnapshot: clone(content), cardRuleset: 'ironclad-debt-v1', actId, baseline: Boolean(options.baseline),
    seed: normalized, rngState: normalized || 0x9e3779b9, modeId: 'classic', runId: options.runId || `config-${normalized}-${globalThis.crypto?.randomUUID?.() || Date.now().toString(36)}`,
    phase: 'map', hp: start.maxHp || 80, maxHp: start.maxHp || 80, block: 0, energy: start.energy || 3, maxEnergy: start.energy || 3,
    strength: 0, dexterity: 0, weak: 0, exposed: 0, frail: 0, entangled: 0, artifact: 0,
    hand: [], drawPile: [], discard: [], exhaust: [], limbo: [], powerZone: [], deck: [], deckCards: [], upgrades: {}, powers: {}, pendingChoice: null,
    debts: [], turn: 1, combatTurn: 1, borrowedThisTurn: 0, repaidThisTurn: 0, enemies: [], nodeIndex: 0, route: createConfiguredRoute(actId, normalized, content), normalBattles: 0,
    encounterId: null, encounterKind: null, encounterHistory: [], rewards: [], rewardInfo: null, event: null, shop: null, gold: start.gold ?? 99, removePrice: 75,
    relicId, relics: [...new Set((start.relics || []).filter(id => !content.relics[id]?.starter).concat(options.baseline ? [] : [relicId]))], potions: [], difficulty: options.difficulty || 0, rewardPool,
    stats: { damageDealt: 0, damageTaken: 0, borrowed: 0, repaid: 0, defaults: 0, debtDamage: 0, cardsPlayed: 0, battlesWon: 0, battlesStarted: 0, kills: 0, enemiesKilled: 0, enemiesEscaped: 0, goldStolen: 0, goldRecovered: 0 },
    combatCounters: { repaid: 0, hpLossEvents: 0, cardsPlayed: 0 }, nextUid: 1, nextDebtId: 1, nextEnemyUid: 1, nextPotionUid: 1, nextFrameId: 1, effectQueue: [], resolutionFrames: {}, freshStatuses: {},
    log: [], notice: '新夜巡已启。敌方符拖向鬼怪，自身符向下拖回灯前；点牌可细看。', lastEvent: { kind: 'map' }, events: [],
  };
  for (const entry of start.deck || []) for (let index = 0; index < (entry.count || 1); index++) addPermanent(state, entry.cardId);
  if (!state.deck.length) throw new Error('幕配置缺少初始牌组');
  log(state, state.notice); return state;
}
export function transitionConfigured(state, action) {
  if (!action || typeof action.type !== 'string') return invalid(state, '无效操作。');
  if (['victory', 'defeat'].includes(state.phase)) return invalid(state, '这一夜已经结束。');
  if (state.pendingChoice && action.type !== 'chooseCard') return invalid(state, '请先完成当前选牌。');
  const content = contentFor(state), next = clone(state); next.events = [];
  const finish = () => { drainEffects(next, content, hooksFor(next)); settleCombat(next); return next; };
  if (action.type === 'chooseCard') {
    if (!resolveChoice(next, content, action.uid)) return invalid(state, '请选择当前可用的牌。');
    return finish();
  }
  if (action.type === 'selectNode') {
    const node = getConfiguredAvailableNodes(state).find(item => item.id === action.nodeId);
    if (!node) return invalid(state, '只能沿相通的路线前进。');
    next.route.currentId = node.id; next.route.path.push(node.id); next.nodeIndex = node.row;
    const act = content.acts[state.actId];
    if (['battle', 'elite', 'boss'].includes(node.type)) {
      const pool = node.encounterId || (node.type === 'boss' ? next.route.bossId : node.type === 'elite' ? act.encounterPools.elite : next.normalBattles < (act.weakBattleCount ?? 3) ? act.encounterPools.weak : act.encounterPools.strong);
      beginCombat(next, sampleConfiguredEncounter(pool, () => random(next), content, next.encounterHistory.slice(-2)), node.type);
    } else {
      next.phase = 'event'; next.event = { id: node.type === 'event' ? node.eventId : node.type };
      if (node.type === 'shop') makeShop(next);
      next.lastEvent = { kind: 'event-open', eventId: next.event.id }; next.notice = getConfiguredEventView(next)?.description || '';
    }
    return finish();
  }
  if (['play', 'borrow', 'repay', 'endTurn'].includes(action.type) && state.phase !== 'combat') return invalid(state, '此刻不在战斗中。');
  if (action.type === 'play') {
    const card = next.hand.find(item => item.uid === action.uid); if (!card) return invalid(state, '此牌已不在手中。');
    const view = cardView(next, card, content); if (!view.playable) return invalid(state, view.reason);
    const enemies = liveEnemies(next);
    const target = view.target === 'enemy' ? enemies.find(enemy => enemy.uid === action.targetUid) || (!action.targetUid && enemies.length === 1 ? enemies[0] : null) : null;
    if (view.target === 'enemy' && !target) return invalid(state, '请选择存活的鬼怪作为目标。');
    if (view.target === 'enemy' || view.target === 'all') {
      const targets = getConfiguredCardEnemyTargets(next, card);
      const eligible = target ? targets.find(candidate => candidate.uid === target.uid) : targets.find(candidate => candidate.eligible);
      if (!eligible?.eligible) return invalid(state, eligible?.reason || '当前没有可作用的鬼怪。');
    }
    commitCard(next, content, card, target?.uid);
    next.notice = `打出${view.name}。`; next.lastEvent = { kind: 'play', cardId: card.cardId, uid: card.uid, targetUid: target?.uid }; log(next, next.notice); return finish();
  }
  if (action.type === 'borrow') {
    if (state.baseline || state.borrowedThisTurn >= 2) return invalid(state, state.baseline ? '基准试炼关闭借火。' : '本回合已经借火两次。');
    next.energy++; next.borrowedThisTurn++; const debt = addDebt(next, 2);
    next.notice = `借火1点，欠2阴债，第${debt.dueTurn}巡更开始到期。`; next.lastEvent = { kind: 'borrow', amount: 2 }; log(next, next.notice); return finish();
  }
  if (action.type === 'repay') {
    if (!debtTotal(state) || state.energy < 1) return invalid(state, '还愿需要1香火和未偿的阴债。');
    next.energy--; const amount = repayDebt(next, content, 2); next.notice = `还愿，偿还${amount}点阴债。`; next.lastEvent = { kind: 'repay', amount }; log(next, next.notice); return finish();
  }
  if (action.type === 'endTurn') {
    const snapshot = next.hand.map(card => card.uid);
    queueEffects(next, [{ op: '_turnEnd' }, ...snapshot.map(uid => ({ op: '_handEnd', uid })), { op: '_handBoundary' }, ...snapshot.map(uid => ({ op: '_clearHandCard', uid })), { op: '_enemyBegin' }], newFrame(next));
    next.notice = '巡更交替，香火复燃。'; next.lastEvent = { kind: 'enemy' }; return finish();
  }
  if (action.type === 'reward') {
    if (state.phase !== 'reward' || action.cardId !== null && !state.rewards.includes(action.cardId)) return invalid(state, '请选择当前奖励或跳过。');
    if (action.cardId) addPermanent(next, action.cardId); completeNode(next); next.lastEvent = { kind: 'reward', cardId: action.cardId }; return finish();
  }
  if (action.type === 'event') {
    if (state.phase !== 'event' || !eventAction(next, action.choiceId)) return invalid(state, '当前不能这样选择。');
    return finish();
  }
  if (action.type === 'usePotion' || action.type === 'discardPotion') {
    const potion = next.potions.find(item => item.uid === action.potionId || item.id === action.potionId);
    if (!potion) return invalid(state, '药物已经用尽。');
    const def = content.potions[potion.id], targets = liveEnemies(next);
    const target = targets.find(item => item.uid === action.targetUid) || (!action.targetUid && targets.length === 1 ? targets[0] : null);
    if (!def) return invalid(state, '药物定义不存在。');
    if (action.type === 'usePotion' && (!def.usablePhases.includes(next.phase) || def.target === 'enemy' && !target)) return invalid(state, '请在允许的场景中指定有效目标。');
    next.potions = next.potions.filter(item => item.uid !== potion.uid);
    if (action.type === 'usePotion') {
      runEffects(next, def.effects, { targetUid: target?.uid });
    }
    next.lastEvent = { kind: 'potion', potionId: potion.id }; return finish();
  }
  return invalid(state, '未识别的操作。');
}
export function isValidConfiguredSave(state) {
  try {
    if (!state || state.version !== CONFIG_VERSION || state.ruleset !== 'config-v2' || !['map', 'combat', 'reward', 'event', 'victory', 'defeat'].includes(state.phase)) return false;
    const content = contentFor(state);
    if (!state.contentSnapshot || validateContent(content).length) return false;
    if (!content.cards || !content.enemies || !content.acts?.[state.actId] || typeof state.runId !== 'string' || !state.runId || typeof state.contentRevision !== 'string') return false;
    if (!['hp', 'block', 'energy', 'gold', 'nodeIndex', 'normalBattles', 'borrowedThisTurn', 'repaidThisTurn'].every(key => Number.isSafeInteger(state[key]) && state[key] >= 0)) return false;
    if (!['maxHp', 'maxEnergy', 'turn', 'combatTurn', 'nextUid', 'nextEnemyUid', 'nextDebtId', 'nextFrameId', 'rngState'].every(key => Number.isSafeInteger(state[key]) && state[key] > 0) || state.hp > state.maxHp || state.rngState > 0xffffffff) return false;
    const numericStatuses = ['strength', 'dexterity', 'weak', 'exposed', 'frail', 'entangled', 'burn', 'artifact', 'curlUp', 'enrage', 'ritual', 'sharpHide'];
    const safeActor = actor => actor && numericStatuses.every(key => actor[key] === undefined || Number.isSafeInteger(actor[key]))
      && (actor.block === undefined || Number.isSafeInteger(actor.block) && actor.block >= 0)
      && actor.powers && typeof actor.powers === 'object' && !Array.isArray(actor.powers) && Object.entries(actor.powers).every(([id, power]) => content.powers[id] && power && Number.isSafeInteger(power.amount));
    const safeCard = card => card.temporaryCost == null || Number.isSafeInteger(card.temporaryCost) && card.temporaryCost >= 0;
    if (!safeActor(state)) return false;
    if (!Array.isArray(state.deckCards) || !state.deckCards.length || state.deckCards.length !== state.deck.length || !state.deckCards.every((card, index) => card.cardId === state.deck[index] && content.cards[card.cardId] && typeof card.uid === 'string' && Number.isSafeInteger(card.upgradeLevel) && card.upgradeLevel >= 0 && safeCard(card))) return false;
    const seen = new Set();
    for (const zone of ['hand', 'drawPile', 'discard', 'exhaust', 'limbo', 'powerZone']) {
      if (!Array.isArray(state[zone])) return false;
      for (const card of state[zone]) { if (!card || !content.cards[card.cardId] || typeof card.uid !== 'string' || seen.has(card.uid) || !Number.isSafeInteger(card.upgradeLevel) || card.upgradeLevel < 0 || !safeCard(card)) return false; seen.add(card.uid); }
    }
    if (state.hand.length > 10 || !Array.isArray(state.enemies) || liveEnemies(state).length > 5 || !state.enemies.every(enemy => content.enemies[enemy.id] && typeof enemy.uid === 'string' && Number.isSafeInteger(enemy.hp) && Number.isSafeInteger(enemy.maxHp) && enemy.maxHp > 0 && enemy.hp >= 0 && enemy.hp <= enemy.maxHp && enemy.ai && enemy.intent && safeActor(enemy))) return false;
    if (state.rewardInfo && (!Number.isSafeInteger(state.rewardInfo.gold) || state.rewardInfo.gold < 0 || state.rewardInfo.relicId != null && !content.relics[state.rewardInfo.relicId] || state.rewardInfo.potionId != null && !content.potions[state.rewardInfo.potionId])) return false;
    if (!Array.isArray(state.debts) || !state.debts.every(debt => typeof debt.id === 'string' && Number.isSafeInteger(debt.amount) && debt.amount > 0 && Number.isSafeInteger(debt.dueTurn) && debt.dueTurn > 0 && typeof debt.delayed === 'boolean')) return false;
    if (!isValidConfiguredRoute(state.route, content) || !state.stats || !Object.values(state.stats).every(value => Number.isSafeInteger(value) && value >= 0)) return false;
    if (!Array.isArray(state.effectQueue) || !state.resolutionFrames || !Array.isArray(state.relics) || !Array.isArray(state.potions) || !Array.isArray(state.rewards) || !Array.isArray(state.log)) return false;
    if (!content.relics[state.relicId]?.starter || new Set(state.relics).size !== state.relics.length || !state.relics.every(id => content.relics[id])) return false;
    if (!Number.isSafeInteger(state.nextPotionUid) || state.nextPotionUid < 1 || new Set(state.potions.map(potion => potion.uid)).size !== state.potions.length || !state.potions.every(potion => potion && typeof potion.uid === 'string' && content.potions[potion.id])) return false;
    if (state.pendingChoice && (!Array.isArray(state.pendingChoice.cardUids) || !state.pendingChoice.cardUids.every(uid => cardByUid(state, uid)) || !state.resolutionFrames[state.pendingChoice.frameId])) return false;
    return state.phase === 'defeat' ? state.hp === 0 : state.hp > 0;
  } catch { return false; }
}
export function restoreConfiguredRun(saved) { return isValidConfiguredSave(saved) ? clone(saved) : null; }
