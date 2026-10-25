import { createRoute, createLegacyRoute, getAvailableNodes as availableRouteNodes, isValidRoute, completeCurrentNode } from './journey.js';
import { ACT1_ENEMY_DEFS } from './act1-content.js';
import { getAvailableAct1Nodes } from './journey.js';
import { CARD_DEFS } from './card-defs.js';
import { createAct1Adventure, transitionAct1, getAct1Enemies, getAct1EnemyIntent, getAct1CardView, isAct1CardPlayable, getAct1EventView, isValidAct1Save, migrateAct1Run, RELIC_DEFS, POTION_DEFS } from './act1-engine.js';

export { CARD_DEFS, createAct1Adventure, RELIC_DEFS, POTION_DEFS };
const usesAct1 = state => state?.ruleset === 'act1' || state?.version === 3;

export const ENEMY_DEFS = {
  paper: { id: 'paper', name: '纸扎童子', title: '纸扎巷 · 第一难', description: '它抱着一把纸剪，等你陪它玩到天亮。折纸时会暂时护住自己。', art: 'paper', maxHp: 38 },
  collector: { id: 'collector', name: '讨债鬼', title: '忘川渡 · 第二难', description: '它闻得到香火借据的味道。每点阴债都会加重它的攻击，最多增加 8 点伤害。', art: 'collector', maxHp: 62 },
  judge: { id: 'judge', name: '夜巡判官', title: '阎罗殿 · 终审', description: '判官半血时所有攻击提高 3 点。久战会让阴司的追索越来越凶。', art: 'judge', maxHp: 92 },
  ...ACT1_ENEMY_DEFS,
};

const VERSION = 1;
const STARTING_DECK = ['brush', 'brush', 'brush', 'talisman', 'talisman', 'talisman', 'chain', 'vow', 'step', 'coin'];
const REWARD_CARDS = ['fire', 'bell', 'seal', 'lotus', 'blood', 'ledger', 'mirror', 'ferry', 'verdict'];
const PHASES = ['map', 'combat', 'reward', 'event', 'victory', 'defeat'];

function writeLog(state, message) {
  state.log = [...state.log, message].slice(-8);
}

function random(state) {
  let value = state.rngState >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.rngState = value >>> 0;
  return state.rngState / 4294967296;
}

function shuffle(state, items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random(state) * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

function createCard(state, cardId) {
  const card = { uid: `card-${state.nextUid}`, cardId };
  state.nextUid += 1;
  return card;
}

function drawCards(state, amount) {
  let drawn = 0;
  for (let index = 0; index < amount; index += 1) {
    if (state.hand.length >= 10) break;
    if (state.drawPile.length === 0 && state.discard.length > 0) {
      state.drawPile = shuffle(state, state.discard);
      state.discard = [];
    }
    if (state.drawPile.length === 0) break;
    state.hand.push(state.drawPile.pop());
    drawn += 1;
  }
  return drawn;
}

export function debtTotal(state) {
  return state.debts.reduce((total, debt) => total + debt.amount, 0);
}

export function debtSchedule(state) {
  const grouped = new Map();
  for (const debt of state.debts) grouped.set(debt.dueTurn, (grouped.get(debt.dueTurn) || 0) + debt.amount);
  return [...grouped.entries()].sort(([firstTurn], [secondTurn]) => firstTurn - secondTurn).map(([dueTurn, amount]) => ({
    dueTurn,
    turnsUntil: Math.max(0, dueTurn - state.turn),
    amount,
    hpCost: amount * 2,
  }));
}

function addDebt(state, amount) {
  const debt = { id: `debt-${state.nextDebtId}`, amount, dueTurn: state.turn + 2 };
  state.nextDebtId += 1;
  state.debts.push(debt);
  return debt;
}

function repayDebt(state, amount) {
  let remaining = amount;
  const ordered = [...state.debts].sort((first, second) => first.dueTurn - second.dueTurn);
  for (const debt of ordered) {
    const payment = Math.min(remaining, debt.amount);
    debt.amount -= payment;
    remaining -= payment;
    if (remaining === 0) break;
  }
  state.debts = ordered.filter((debt) => debt.amount > 0);
  const paid = amount - remaining;
  if (paid > 0) {
    if (state.repaidThisTurn === 0 && state.phase === 'combat' && (state.relicId ?? 'lamp') === 'lamp') {
      state.block += 3;
      writeLog(state, '引魂灯亮起：本回合首次还债，获得 3 护甲。');
    }
    state.repaidThisTurn += paid;
    state.stats.repaid += paid;
  }
  return paid;
}

function hurtPlayer(state, amount) {
  const actual = Math.min(state.hp, Math.max(0, amount));
  state.hp -= actual;
  state.stats.damageTaken += actual;
  return actual;
}

function hurtEnemy(state, amount, ignoreBlock = false) {
  const absorbed = ignoreBlock ? 0 : Math.min(state.enemy.block, amount);
  state.enemy.block -= absorbed;
  const actual = Math.min(state.enemy.hp, Math.max(0, amount - absorbed));
  state.enemy.hp -= actual;
  state.stats.damageDealt += actual;
  return actual;
}

function settleDebt(state) {
  const due = state.debts.filter((debt) => debt.dueTurn <= state.turn);
  const amount = due.reduce((total, debt) => total + debt.amount, 0);
  state.debts = state.debts.filter((debt) => debt.dueTurn > state.turn);
  if (amount === 0) return 0;
  const damage = hurtPlayer(state, amount * 2);
  state.stats.debtDamage = (state.stats.debtDamage ?? state.stats.defaults * 2) + damage;
  state.stats.defaults += amount;
  writeLog(state, `第 ${state.turn} 回合：${amount} 点阴债到期，失去 ${damage} 生命（无视护甲）。`);
  return damage;
}

function lose(state, reason, cause) {
  state.phase = 'defeat';
  state.notice = reason;
  state.lastEvent = { kind: 'defeat', cause, message: reason };
  writeLog(state, reason);
}

function winBattle(state) {
  state.enemy.hp = 0;
  state.stats.battlesWon += 1;
  if (state.nodeIndex === 4) {
    const forgiven = debtTotal(state);
    state.phase = 'victory';
    state.debts = [];
    if (state.route) completeCurrentNode(state.route);
    state.notice = '判官收起朱笔，将你的名字从阴债簿上划去。天将亮，归途已开。';
    state.lastEvent = { kind: 'victory', final: true, forgiven };
    writeLog(state, `终审已过。剩余 ${forgiven} 点阴债获判销清。`);
    return;
  }
  state.phase = 'reward';
  state.rewards = shuffle(state, state.rewardPool ?? REWARD_CARDS).slice(0, 3);
  state.notice = '鬼影消散。选一张符箓收入牌组，或轻装前行。阴债仍会随你过桥。';
  state.lastEvent = { kind: 'victory', final: false };
  writeLog(state, `击败${ENEMY_DEFS[state.enemy.id].name}。未到期的阴债会保留。`);
}

function beginTurn(state) {
  state.energy = state.maxEnergy;
  state.block = 0;
  state.borrowedThisTurn = 0;
  state.repaidThisTurn = 0;
  const debtDamage = settleDebt(state);
  if (state.hp <= 0) {
    lose(state, '阴债到期，灯尽人亡。下一次，记得在到期前还愿。', 'debt');
    return debtDamage;
  }
  drawCards(state, 5);
  return debtDamage;
}

function beginCombat(state, enemyId, nodeIndex, advanceTurn) {
  const definition = ENEMY_DEFS[enemyId];
  state.phase = 'combat';
  state.nodeIndex = nodeIndex;
  state.combatTurn = 1;
  if (advanceTurn) state.turn += 1;
  const maxHp = state.difficulty === 1 ? Math.ceil(definition.maxHp * 1.15) : definition.maxHp;
  state.enemy = { id: enemyId, hp: maxHp, maxHp, block: 0, burn: 0, exposed: 0, intentIndex: 0 };
  state.hand = [];
  state.discard = [];
  state.exhaust = [];
  state.drawPile = shuffle(state, state.deck.map((cardId) => createCard(state, cardId)));
  state.event = null;
  state.rewards = [];
  const debtDamage = beginTurn(state);
  if (state.phase === 'defeat') return;
  if (state.relicId === 'bell') {
    state.block += 6;
    writeLog(state, '镇魂铃响起：开战首回合获得 6 护甲。');
  }
  state.notice = debtDamage > 0 ? `过桥时，旧阴债到期，失去 ${debtDamage} 生命。${definition.name}挡住归路。` : `${definition.name}挡住归路。先看它的意图，再决定如何出牌。`;
  state.lastEvent = { kind: debtDamage > 0 ? 'debt' : 'encounter', debtDamage, enemyId };
  writeLog(state, `来到${definition.title}。第 ${state.turn} 回合，香火复燃。`);
}

function createState(seed = Date.now()) {
  const normalizedSeed = Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 1;
  const state = {
    version: VERSION,
    seed: normalizedSeed,
    rngState: normalizedSeed || 0x9e3779b9,
    phase: 'combat',
    hp: 54,
    maxHp: 54,
    block: 0,
    energy: 3,
    maxEnergy: 3,
    hand: [],
    drawPile: [],
    discard: [],
    exhaust: [],
    deck: [...STARTING_DECK],
    debts: [],
    turn: 1,
    combatTurn: 1,
    borrowedThisTurn: 0,
    repaidThisTurn: 0,
    enemy: null,
    nodeIndex: 0,
    rewards: [],
    event: null,
    stats: { damageDealt: 0, damageTaken: 0, borrowed: 0, repaid: 0, defaults: 0, debtDamage: 0, cardsPlayed: 0, battlesWon: 0 },
    log: [],
    notice: '',
    lastEvent: { kind: 'start' },
    nextUid: 1,
    nextDebtId: 1,
  };
  return state;
}

export function createRun(seed = Date.now()) {
  const state = createState(seed);
  beginCombat(state, 'paper', 0, false);
  return state;
}

function validRewardPool(pool) {
  return pool === null || (Array.isArray(pool) && pool.length >= 3 && new Set(pool).size === pool.length && pool.every(cardId => Object.hasOwn(CARD_DEFS, cardId)));
}

function createRunId(seed) {
  return `night-${seed.toString(36)}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

export function createAdventure(seed = Date.now(), options = {}) {
  const relicId = options.relicId ?? 'lamp';
  const difficulty = options.difficulty ?? 0;
  const rewardPool = options.rewardPool == null ? null : Array.isArray(options.rewardPool) ? [...new Set(options.rewardPool)] : options.rewardPool;
  if (!['lamp', 'bell'].includes(relicId)) throw new Error('这件法器尚不可用。');
  if (![0, 1].includes(difficulty)) throw new Error('请选择已开放的难度。');
  if (!validRewardPool(rewardPool)) throw new Error('奖励池必须包含至少三种有效卡牌。');
  if (options.runId !== undefined && (typeof options.runId !== 'string' || !options.runId.trim())) throw new Error('夜巡编号不能为空。');
  const state = createState(seed);
  state.phase = 'map';
  state.modeId = 'classic';
  state.runId = options.runId ?? createRunId(state.seed);
  state.relicId = relicId;
  state.difficulty = difficulty;
  state.rewardPool = rewardPool;
  state.route = createRoute(state.seed);
  const maxHp = difficulty === 1 ? Math.ceil(ENEMY_DEFS.paper.maxHp * 1.15) : ENEMY_DEFS.paper.maxHp;
  state.enemy = { id: 'paper', hp: maxHp, maxHp, block: 0, burn: 0, exposed: 0, intentIndex: 0 };
  state.notice = '先选纸扎巷踏出第一步。岔路上的歇脚与际遇，由你决定。';
  state.lastEvent = { kind: 'map' };
  writeLog(state, '提灯出发。阴路有岔，先看清前路再落脚。');
  return state;
}

export function getAvailableNodes(state) {
  if (usesAct1(state)) return getAvailableAct1Nodes(state);
  return availableRouteNodes(state);
}

export function getEnemies(state) {
  if (usesAct1(state)) return getAct1Enemies(state);
  return state?.enemy?.hp > 0 ? [state.enemy] : [];
}

export function getCardView(state, cardOrId, uid) {
  if (usesAct1(state)) return getAct1CardView(state, cardOrId, uid);
  const card = typeof cardOrId === 'object' && cardOrId ? cardOrId : null;
  const base = CARD_DEFS[card?.cardId ?? cardOrId];
  if (!base) return null;
  const reason = state.phase !== 'combat' ? '此刻不在战斗中。' : state.energy < base.cost ? '香火不足。' : '';
  return { ...base, target: base.type === 'attack' || base.id === 'bell' ? 'enemy' : 'self', upgraded: false, playable: !reason, reason, uid: card?.uid ?? uid };
}

export function isCardPlayable(state, cardOrUid, targetUid) {
  if (usesAct1(state)) return isAct1CardPlayable(state, cardOrUid, targetUid);
  const card = state.hand.find(candidate => candidate.uid === (typeof cardOrUid === 'object' && cardOrUid ? cardOrUid.uid : cardOrUid));
  return Boolean(card && state.hand.some(candidate => candidate.uid === card.uid) && getCardView(state, card)?.playable);
}

export function getEventView(state) {
  if (usesAct1(state)) return getAct1EventView(state);
  return state.phase === 'event' && state.event ? makeEvent(state, state.event.id) : null;
}

export function getEnemyIntent(state, uid) {
  if (usesAct1(state)) return getAct1EnemyIntent(state, uid);
  if (!state.enemy || !ENEMY_DEFS[state.enemy.id]) return { kind: 'none', label: '静候', amount: 0, detail: '前路暂时安静。' };
  const enemy = state.enemy;
  const step = enemy.intentIndex % 4;
  const pressure = Math.floor((state.combatTurn - 1) / 4) * 2;
  const challenge = state.difficulty === 1 ? 2 : 0;
  const challengeDetail = challenge ? '险路难度：额外增加 2 点攻击。' : '';
  if (enemy.id === 'paper') {
    if (step === 1) return { kind: 'defend', label: '折纸护身', amount: 6, detail: '获得 6 点护甲。可以趁机整理阴债。' };
    const amount = [6, 0, 10, 8][step] + pressure + challenge;
    return { kind: 'attack', label: step === 2 ? '剪影索命' : '纸剪', amount, detail: `造成 ${amount} 点伤害${pressure ? `，其中追索加成 ${pressure} 点` : ''}。${challengeDetail}` };
  }
  if (enemy.id === 'collector') {
    if (step === 1) return { kind: 'hex', label: '记下阴账', amount: 2, detail: `使你欠下 2 点阴债（第 ${state.turn + 2} 回合到期），并获得 5 点护甲。` };
    const debtBonus = Math.min(8, debtTotal(state));
    const amount = [10, 0, 14, 8][step] + debtBonus + pressure + challenge;
    return { kind: 'attack', label: step === 2 ? '连本带利' : '追债', amount, detail: `造成 ${amount} 点伤害。当前阴债额外增加 ${debtBonus} 点${pressure ? `，追索额外增加 ${pressure} 点` : ''}。${challengeDetail}` };
  }
  const enraged = enemy.hp <= enemy.maxHp / 2;
  const rage = enraged ? 3 : 0;
  if (step === 2) return { kind: 'defend', label: '生死簿', amount: 10, detail: '获得 10 点护甲。判官半血后所有攻击提高 3 点。' };
  const amount = [12, 8, 0, 18][step] + rage + pressure + challenge;
  if (step === 1) return { kind: 'attack-debt', label: '朱批追命', amount, detail: `造成 ${amount} 点伤害，并使你欠下 2 点阴债（第 ${state.turn + 2} 回合到期）。${enraged ? '判官已震怒。' : ''}${challengeDetail}` };
  return { kind: 'attack', label: step === 3 ? '断魂铡' : '惊堂木', amount, detail: `造成 ${amount} 点伤害。${enraged ? '半血震怒：攻击提高 3 点。' : '半血时攻击提高 3 点。'}${pressure ? `追索额外增加 ${pressure} 点。` : ''}${challengeDetail}` };
}

function invalid(state, notice) {
  return { ...state, notice, lastEvent: { kind: 'invalid', message: notice } };
}

function playCard(state, card) {
  const definition = CARD_DEFS[card.cardId];
  state.energy -= definition.cost;
  state.hand = state.hand.filter((held) => held.uid !== card.uid);
  if (definition.exhaust) state.exhaust.push(card);
  else state.discard.push(card);
  state.stats.cardsPlayed += 1;
  let damage = 0;
  let block = 0;
  let paid = 0;
  let drawn = 0;
  let addedDebt = 0;
  switch (card.cardId) {
    case 'brush': damage = 7; break;
    case 'talisman': block = 6; break;
    case 'chain': damage = 7 + (debtTotal(state) > 0 ? 4 : 0); break;
    case 'vow': block = 4; paid = repayDebt(state, 2); break;
    case 'step': block = 5; drawn = drawCards(state, 1); break;
    case 'coin': damage = 3; drawn = drawCards(state, 1); break;
    case 'fire': damage = 5; state.enemy.burn += 4; break;
    case 'bell': block = 3; state.enemy.exposed = Math.max(state.enemy.exposed, 2); break;
    case 'seal': damage = 16 + (debtTotal(state) > 0 ? 6 : 0); break;
    case 'lotus': block = 8; paid = repayDebt(state, 2); break;
    case 'blood': damage = 10; addedDebt = 2; addDebt(state, 2); state.stats.borrowed += 2; break;
    case 'ledger': paid = repayDebt(state, 4); drawn = drawCards(state, 2); break;
    case 'mirror': block = 7 + (state.repaidThisTurn > 0 ? 6 : 0); break;
    case 'ferry': paid = repayDebt(state, 2); state.energy += 1; break;
    case 'verdict': damage = 24 + Math.min(16, debtTotal(state) * 2); break;
  }
  state.block += block;
  const amplified = damage > 0 && state.enemy.exposed > 0 ? Math.ceil(damage * 1.5) : damage;
  const dealt = amplified > 0 ? hurtEnemy(state, amplified) : 0;
  if (card.cardId === 'chain' && state.enemy.hp <= 0) paid += repayDebt(state, 2);
  const parts = [dealt > 0 ? `造成 ${dealt} 伤害` : '', block > 0 ? `获得 ${block} 护甲` : '', paid > 0 ? `偿还 ${paid} 阴债` : '', drawn > 0 ? `抽 ${drawn} 张牌` : '', addedDebt > 0 ? `欠下 ${addedDebt} 阴债` : ''].filter(Boolean);
  state.notice = `${definition.name}：${parts.join('，') || '符光一闪'}。`;
  state.lastEvent = { kind: 'play', cardId: card.cardId, damage: dealt, block, repaid: paid, drawn, addedDebt };
  writeLog(state, state.notice);
  if (state.enemy.hp <= 0) winBattle(state);
}

function endTurn(state) {
  const intent = getEnemyIntent(state);
  state.discard.push(...state.hand);
  state.hand = [];
  let burnDamage = 0;
  if (state.enemy.burn > 0) {
    burnDamage = hurtEnemy(state, state.enemy.burn, true);
    state.enemy.burn -= 1;
    writeLog(state, `业火灼烧：${ENEMY_DEFS[state.enemy.id].name}失去 ${burnDamage} 生命。`);
    if (state.enemy.hp <= 0) {
      winBattle(state);
      return;
    }
  }
  state.enemy.block = 0;
  let damage = 0;
  let addedDebt = 0;
  if (intent.kind === 'attack' || intent.kind === 'attack-debt') {
    const blocked = Math.min(state.block, intent.amount);
    state.block -= blocked;
    damage = hurtPlayer(state, intent.amount - blocked);
    writeLog(state, `${ENEMY_DEFS[state.enemy.id].name}使出${intent.label}：护甲抵挡 ${blocked}，失去 ${damage} 生命。`);
  }
  if (state.hp <= 0) {
    lose(state, `你倒在${ENEMY_DEFS[state.enemy.id].name}面前，归路隐入长夜。`, 'enemy');
    return;
  }
  if (intent.kind === 'defend') {
    state.enemy.block = intent.amount;
    writeLog(state, `${ENEMY_DEFS[state.enemy.id].name}获得 ${intent.amount} 护甲。`);
  }
  if (intent.kind === 'hex' || intent.kind === 'attack-debt') {
    addDebt(state, 2);
    addedDebt = 2;
    if (intent.kind === 'hex') state.enemy.block = 5;
    writeLog(state, `阴司添账：欠下 2 点阴债，第 ${state.turn + 2} 回合到期。`);
  }
  state.enemy.exposed = Math.max(0, state.enemy.exposed - 1);
  state.enemy.intentIndex += 1;
  state.turn += 1;
  state.combatTurn += 1;
  const debtDamage = beginTurn(state);
  if (state.phase === 'defeat') return;
  state.notice = debtDamage > 0 ? `阴债到期，失去 ${debtDamage} 生命。新回合：香火补满，抽 5 张牌。` : '新回合：香火补满，抽 5 张牌。护甲不会保留。';
  state.lastEvent = { kind: debtDamage > 0 ? 'debt' : 'enemy', damage, debtDamage, burnDamage, addedDebt, intent: intent.label };
}

function makeEvent(state, eventId = state.nodeIndex === 1 ? 'market' : 'soup') {
  if (eventId === 'rest') return {
    id: 'rest',
    title: '灯下歇息',
    description: '屋檐下尚有一盏余温未散的纸灯。你可以歇一歇，也可以趁无人追索，静心还愿。',
    choices: [
      { id: 'rest', title: '添灯歇脚', description: '恢复 10 点生命。' },
      { id: 'repay', title: '静心还愿', description: '恢复 2 点生命，偿还最早到期的 4 点阴债。', disabled: debtTotal(state) === 0 },
    ],
  };
  if (eventId === 'shrine') return {
    id: 'shrine',
    title: '纸灯神龛',
    description: '无名神龛里，纸灯亮着不属于活人的颜色。供桌上放着一支生死签和一只铜铃，旁边写着各自的价。',
    choices: [
      { id: 'seal', title: '以血请签', description: '失去 6 点生命，获得「生死签」（2 费：16 伤害，有债额外 6 伤害）。', disabled: state.hp <= 6 },
      { id: 'bell', title: '赊下一只摄魂铃', description: `获得「摄魂铃」（1 费：3 护甲，2 回合易伤），欠 2 点阴债，第 ${state.turn + 2} 回合到期。` },
      { id: 'leave', title: '绕路避过神龛', description: '恢复 4 点生命，不取供物。' },
    ],
  };
  if (eventId === 'market') return {
    id: 'market',
    title: '鬼市借灯',
    description: '纸灯下，摊主露出半张笑脸：“借来的火，总有人记账。客官要买一条更好走的路吗？”',
    choices: [
      { id: 'warmth', title: '讨一碗热茶', description: '恢复 8 点生命。平安路，慢慢走。' },
      { id: 'ferry', title: '赊一枚摆渡钱', description: `获得「摆渡钱」（0 费：还 2 债、获得 1 香火、消耗），欠 2 点阴债，第 ${state.turn + 2} 回合到期。` },
      { id: 'fire', title: '换一张业火符', description: '失去 4 点生命，获得「业火符」（1 费：5 伤害，4 层业火）。', disabled: state.hp <= 4 },
    ],
  };
  return {
    id: 'soup',
    title: '孟婆留汤',
    description: '她把一碗温汤推到你面前：“忘了来路的人，往往走不到归处。喝多少，你自己定。”',
    choices: [
      { id: 'soup', title: '饮一碗忘忧汤', description: '恢复 14 点生命，偿还最早到期的 2 点阴债。' },
      { id: 'lotus', title: '把汤留给后来人', description: '恢复 8 点生命，获得「莲灯渡」（1 费：8 护甲、还 2 债、消耗）。' },
      { id: 'borrow', title: '借来一夜阳寿', description: `恢复 22 点生命，欠 4 点阴债，第 ${state.turn + 2} 回合到期。` },
    ],
  };
}

function chooseEvent(state, choiceId) {
  const eventId = state.event.id;
  const previousRepaid = state.stats.repaid;
  const previousBorrowed = state.stats.borrowed;
  let healed = 0;
  if (eventId === 'market') {
    if (choiceId === 'warmth') healed = 8;
    if (choiceId === 'ferry') {
      state.deck.push('ferry');
      addDebt(state, 2);
      state.stats.borrowed += 2;
    }
    if (choiceId === 'fire') {
      hurtPlayer(state, 4);
      state.deck.push('fire');
    }
  } else if (eventId === 'soup') {
    if (choiceId === 'soup') { healed = 14; repayDebt(state, 2); }
    if (choiceId === 'lotus') { healed = 8; state.deck.push('lotus'); }
    if (choiceId === 'borrow') { healed = 22; addDebt(state, 4); state.stats.borrowed += 4; }
  } else if (eventId === 'rest') {
    if (choiceId === 'rest') healed = 10;
    if (choiceId === 'repay') { healed = 2; repayDebt(state, 4); }
  } else if (eventId === 'shrine') {
    if (choiceId === 'seal') { hurtPlayer(state, 6); state.deck.push('seal'); }
    if (choiceId === 'bell') { addDebt(state, 2); state.stats.borrowed += 2; state.deck.push('bell'); }
    if (choiceId === 'leave') healed = 4;
  }
  const actualHeal = Math.min(healed, state.maxHp - state.hp);
  state.hp += actualHeal;
  const choice = state.event.choices.find((option) => option.id === choiceId);
  writeLog(state, `${state.event.title}：${choice.title}${actualHeal > 0 ? `，恢复 ${actualHeal} 生命` : ''}。`);
  if (state.route) {
    returnToMap(state, `${choice.title}。前方的岔路，仍由你选择。`, { kind: 'event', eventId, choiceId, healed: actualHeal, repaid: state.stats.repaid - previousRepaid, addedDebt: state.stats.borrowed - previousBorrowed });
    return;
  }
  beginCombat(state, eventId === 'market' ? 'collector' : 'judge', eventId === 'market' ? 2 : 4, true);
  if (state.phase !== 'defeat') state.lastEvent = { ...state.lastEvent, eventId, choiceId, healed: actualHeal };
}

function returnToMap(state, notice, lastEvent) {
  completeCurrentNode(state.route);
  state.phase = 'map';
  state.event = null;
  state.rewards = [];
  state.block = 0;
  state.notice = notice;
  state.lastEvent = lastEvent;
}

export function transition(state, action) {
  if (usesAct1(state)) return transitionAct1(state, action);
  if (!action || typeof action.type !== 'string') return invalid(state, '这一步没有生效。请重新选择行动。');
  if (state.phase === 'victory' || state.phase === 'defeat') return invalid(state, '这段夜路已经结束。再启一局，便是新的归途。');
  if (action.type === 'selectNode') {
    if (state.phase !== 'map' || !state.route) return invalid(state, '请先完成眼前的战斗或际遇，再选择前路。');
    const node = getAvailableNodes(state).find(candidate => candidate.id === action.nodeId);
    if (!node) return invalid(state, '这条路尚未相通，不能跳层、回退或重走已经过的节点。');
    const next = structuredClone(state);
    next.route.currentId = node.id;
    next.route.path.push(node.id);
    next.nodeIndex = node.stageIndex;
    if (node.type === 'battle' || node.type === 'boss') beginCombat(next, node.enemyId, node.stageIndex, node.row > 0);
    else {
      next.phase = 'event';
      next.event = makeEvent(next, node.eventId);
      next.notice = next.event.description;
      next.lastEvent = { kind: 'event-open', nodeId: node.id, eventId: node.eventId };
      writeLog(next, `来到${node.label}。途中歇脚与际遇不推进巡更。`);
    }
    return next;
  }
  if (['play', 'borrow', 'repay', 'endTurn'].includes(action.type) && state.phase !== 'combat') return invalid(state, '此刻不在战斗中。');
  if (action.type === 'play') {
    const card = state.hand.find((held) => held.uid === action.uid);
    if (!card) return invalid(state, '这张符箓已不在手中。');
    if (!CARD_DEFS[card.cardId]) return invalid(state, '这张符箓无法使用。');
    if (state.energy < CARD_DEFS[card.cardId].cost) return invalid(state, '香火不足。可以借火，或先打出其他牌。');
    const next = structuredClone(state);
    playCard(next, next.hand.find((held) => held.uid === card.uid));
    return next;
  }
  if (action.type === 'borrow') {
    if (state.borrowedThisTurn >= 2) return invalid(state, '本回合已借火两次。阴司不肯再赊。');
    const next = structuredClone(state);
    next.energy += 1;
    next.borrowedThisTurn += 1;
    next.stats.borrowed += 2;
    const debt = addDebt(next, 2);
    next.notice = `借来 1 香火，欠下 2 点阴债。第 ${debt.dueTurn} 回合开始到期，未偿将失去 4 生命。`;
    next.lastEvent = { kind: 'borrow', amount: 2, dueTurn: debt.dueTurn };
    writeLog(next, next.notice);
    return next;
  }
  if (action.type === 'repay') {
    if (debtTotal(state) === 0) return invalid(state, '阴债已清，无需还愿。');
    if (state.energy < 1) return invalid(state, '还愿需要 1 点香火。');
    const next = structuredClone(state);
    next.energy -= 1;
    const paid = repayDebt(next, 2);
    const lampTriggered = state.repaidThisTurn === 0 && (state.relicId ?? 'lamp') === 'lamp';
    next.notice = `还愿：偿还最早到期的 ${paid} 点阴债。${lampTriggered ? '引魂灯护佑，获得 3 护甲。' : ''}`;
    next.lastEvent = { kind: 'repay', amount: paid, block: lampTriggered ? 3 : 0 };
    writeLog(next, next.notice);
    return next;
  }
  if (action.type === 'endTurn') {
    const next = structuredClone(state);
    endTurn(next);
    return next;
  }
  if (action.type === 'reward') {
    if (state.phase !== 'reward') return invalid(state, '现在没有可领取的符箓。');
    if (action.cardId !== null && !state.rewards.includes(action.cardId)) return invalid(state, '请从眼前的三张符箓中选择，或选择跳过。');
    const next = structuredClone(state);
    if (action.cardId) next.deck.push(action.cardId);
    if (next.route) {
      returnToMap(next, action.cardId ? `${CARD_DEFS[action.cardId].name}收入牌组。打开地图，选择下一处落脚地。` : '收好灯火。打开地图，选择下一处落脚地。', { kind: 'reward', cardId: action.cardId });
      writeLog(next, next.notice);
      return next;
    }
    next.phase = 'event';
    next.nodeIndex += 1;
    next.rewards = [];
    next.event = makeEvent(next);
    next.notice = action.cardId ? `${CARD_DEFS[action.cardId].name}收入牌组。前方有人在等你。` : '收好灯火，轻装前行。';
    next.lastEvent = { kind: 'reward', cardId: action.cardId };
    writeLog(next, next.notice);
    return next;
  }
  if (action.type === 'event') {
    if (state.phase !== 'event' || !state.event) return invalid(state, '此刻没有可回应的际遇。');
    const choice = makeEvent(state, state.event.id).choices.find((option) => option.id === action.choiceId);
    if (!choice || choice.disabled) return invalid(state, '现在无法选择这条路。');
    const next = structuredClone(state);
    chooseEvent(next, action.choiceId);
    return next;
  }
  return invalid(state, '这一步没有生效。请重新选择行动。');
}

function validEvent(state) {
  const event = state.event;
  const allowedIds = state.route ? ['rest', 'market', 'soup', 'shrine'] : ['market', 'soup'];
  if (!event || !allowedIds.includes(event.id) || typeof event.title !== 'string' || typeof event.description !== 'string' || !Array.isArray(event.choices)) return false;
  const expected = makeEvent(state, event.id).choices.map(choice => choice.id);
  if (event.choices.length !== expected.length || new Set(event.choices.map(choice => choice?.id)).size !== expected.length) return false;
  return event.choices.every(choice => choice && expected.includes(choice.id) && typeof choice.title === 'string' && typeof choice.description === 'string' && (choice.disabled === undefined || typeof choice.disabled === 'boolean'));
}

function validAdventureState(state) {
  if (state.modeId !== 'classic' || typeof state.runId !== 'string' || !state.runId.trim() || !['lamp', 'bell'].includes(state.relicId) || ![0, 1].includes(state.difficulty) || !validRewardPool(state.rewardPool) || !isValidRoute(state.route)) return false;
  const route = state.route;
  const current = route.nodes.find(node => node.id === route.currentId);
  const completedBattles = route.completedIds.filter(nodeId => route.nodes.find(node => node.id === nodeId).enemyId).length;
  if (state.stats.battlesWon !== completedBattles + (state.phase === 'reward' ? 1 : 0)) return false;
  if (state.nodeIndex !== (current?.stageIndex ?? 0)) return false;
  if (state.phase === 'map') return state.hp > 0 && route.path.length === route.completedIds.length && route.completedIds.length < 5 && state.event === null && state.rewards.length === 0;
  if (!current) return false;
  if (state.phase === 'victory') return route.path.length === 5 && route.completedIds.length === 5 && current.type === 'boss' && debtTotal(state) === 0;
  if (route.path.length !== route.completedIds.length + 1) return false;
  if (state.phase === 'event') return ['rest', 'event'].includes(current.type) && state.event?.id === current.eventId;
  if (!['battle', 'boss'].includes(current.type) || state.enemy.id !== current.enemyId) return false;
  if (state.phase === 'reward') return current.type === 'battle';
  return ['combat', 'defeat'].includes(state.phase) && state.event === null;
}

export function migrateRun(saved) {
  if (usesAct1(saved)) return migrateAct1Run(saved);
  if (!isValidSave(saved)) return null;
  const state = structuredClone(saved);
  if (Object.hasOwn(state, 'route')) return state;
  state.modeId = 'classic';
  state.runId ??= `legacy-${state.seed}`;
  state.relicId ??= 'lamp';
  state.difficulty ??= 0;
  state.rewardPool ??= null;
  state.route = createLegacyRoute(state);
  return isValidSave(state) ? state : null;
}

export function isValidSave(state) {
  if (usesAct1(state)) return isValidAct1Save(state);
  if (!state || typeof state !== 'object' || state.version !== VERSION || !PHASES.includes(state.phase)) return false;
  const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
  if (!integer(state.seed) || state.seed > 4294967295 || !integer(state.rngState, 1) || state.rngState > 4294967295) return false;
  if (!integer(state.hp) || !integer(state.maxHp, 1) || state.hp > state.maxHp || !integer(state.block) || !integer(state.energy)) return false;
  if (!integer(state.maxEnergy, 1) || !integer(state.turn, 1) || !integer(state.combatTurn, 1) || !integer(state.nextUid, 1) || !integer(state.nextDebtId, 1)) return false;
  if (!integer(state.borrowedThisTurn) || state.borrowedThisTurn > 2 || !integer(state.repaidThisTurn) || !integer(state.nodeIndex) || state.nodeIndex > 4) return false;
  if (!Array.isArray(state.deck) || state.deck.length === 0 || !state.deck.every((cardId) => Object.hasOwn(CARD_DEFS, cardId))) return false;
  const allCards = [];
  for (const name of ['hand', 'drawPile', 'discard', 'exhaust']) {
    if (!Array.isArray(state[name])) return false;
    for (const card of state[name]) {
      if (!card || typeof card.uid !== 'string' || !Object.hasOwn(CARD_DEFS, card.cardId)) return false;
      allCards.push(card.uid);
    }
  }
  if (new Set(allCards).size !== allCards.length || state.hand.length > 10) return false;
  if (!Array.isArray(state.debts) || !state.debts.every((debt) => debt && typeof debt.id === 'string' && integer(debt.amount, 1) && integer(debt.dueTurn, 1))) return false;
  if (!state.enemy || !Object.hasOwn(ENEMY_DEFS, state.enemy.id) || !integer(state.enemy.hp) || !integer(state.enemy.maxHp, 1) || state.enemy.hp > state.enemy.maxHp) return false;
  if (!['block', 'burn', 'exposed', 'intentIndex'].every((name) => integer(state.enemy[name]))) return false;
  if (!state.stats || !['damageDealt', 'damageTaken', 'borrowed', 'repaid', 'defaults', 'cardsPlayed', 'battlesWon'].every((name) => integer(state.stats[name]))) return false;
  if (Object.hasOwn(state.stats, 'debtDamage') && !integer(state.stats.debtDamage)) return false;
  if (!Array.isArray(state.log) || state.log.length > 8 || !state.log.every((message) => typeof message === 'string')) return false;
  if (!Array.isArray(state.rewards) || !state.rewards.every((cardId) => Object.hasOwn(CARD_DEFS, cardId)) || typeof state.notice !== 'string') return false;
  if (!state.lastEvent || typeof state.lastEvent.kind !== 'string') return false;
  if (state.relicId !== undefined && !['lamp', 'bell'].includes(state.relicId)) return false;
  if (state.difficulty !== undefined && ![0, 1].includes(state.difficulty)) return false;
  if (state.rewardPool !== undefined && !validRewardPool(state.rewardPool)) return false;
  if (state.phase === 'combat' && (state.hp === 0 || state.enemy.hp === 0 || ![0, 2, 4].includes(state.nodeIndex))) return false;
  if (state.phase === 'reward' && (state.enemy.hp !== 0 || state.rewards.length !== 3 || new Set(state.rewards).size !== 3 || ![0, 2].includes(state.nodeIndex))) return false;
  if (state.phase === 'reward' && state.rewardPool && !state.rewards.every(cardId => state.rewardPool.includes(cardId))) return false;
  if (state.phase === 'event' && (state.hp === 0 || ![1, 3].includes(state.nodeIndex) || !validEvent(state))) return false;
  if (state.phase === 'victory' && (state.enemy.hp !== 0 || state.nodeIndex !== 4 || state.hp === 0)) return false;
  if (state.phase === 'defeat' && state.hp !== 0) return false;
  if (Object.hasOwn(state, 'route')) return validAdventureState(state);
  if (state.phase === 'map') return false;
  return true;
}
