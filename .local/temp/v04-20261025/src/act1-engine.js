import { CARD_DEFS } from './card-defs.js';
export { ACT1_CARD_DEFS } from './card-defs.js';
import { ACT1_ENEMY_DEFS, sampleAct1Encounter } from './act1-content.js';
import { createAct1Route, isValidAct1Route, getAvailableAct1Nodes } from './journey.js';

export const ACT1_VERSION = 3;
export const RELIC_DEFS = {
  blood_ember: { id: 'blood_ember', name: '归魂余烬', description: '每场战斗胜利后恢复 6 点生命。', art: 'fire' },
  lamp: { id: 'lamp', name: '引魂灯', description: '每回合首次实际偿还阴债，获得 3 点护甲。', art: 'lotus' },
  bell: { id: 'bell', name: '镇魂铃', description: '每场战斗首回合获得 6 点护甲。', art: 'bell' },
  anchor: { id: 'anchor', name: '定魂锚', description: '每场战斗首回合获得 10 点护甲。', art: 'chain' },
  vajra: { id: 'vajra', name: '金刚杵', description: '每场战斗开始时获得 1 点力量。', art: 'seal' },
  smooth_stone: { id: 'smooth_stone', name: '温润魂石', description: '每场战斗开始时获得 1 点敏捷。', art: 'coin' },
  bag: { id: 'bag', name: '行脚符袋', description: '每场战斗首回合额外抽 2 张牌。', art: 'ledger' },
  lantern: { id: 'lantern', name: '长明烛', description: '每场战斗首回合额外获得 1 点香火。', art: 'fire' },
};

export const POTION_DEFS = {
  healing: { id: 'healing', name: '回魂露', target: 'self', description: '恢复 20 点生命。', art: 'lotus' },
  fire: { id: 'fire', name: '离火瓶', target: 'enemy', description: '对一名敌人造成 20 点伤害。', art: 'fire' },
  block: { id: 'block', name: '护身散', target: 'self', description: '获得 12 点护甲。', art: 'talisman' },
  weak: { id: 'weak', name: '散魂香', target: 'enemy', description: '使一名敌人虚弱 3 回合。', art: 'bell' },
};

const STARTING_DECK = ['a_strike', 'a_strike', 'a_strike', 'a_strike', 'a_strike', 'a_defend', 'a_defend', 'a_defend', 'a_defend', 'a_bash'];
const REWARD_POOL = ['a_cleave', 'a_flame', 'chain', 'vow', 'step', 'coin', 'fire', 'bell', 'seal', 'lotus', 'blood', 'ledger', 'mirror', 'ferry', 'verdict'];
const LEGACY_ENEMY_TARGETS = ['brush', 'chain', 'coin', 'fire', 'bell', 'seal', 'blood', 'verdict'];
const PHASES = ['map', 'combat', 'reward', 'event', 'victory', 'defeat'];
const STATUS_KEYS = ['weak', 'exposed', 'frail', 'entangled'];
const ENEMY_NUMBERS = ['hp', 'maxHp', 'block', 'burn', 'weak', 'exposed', 'frail', 'strength', 'artifact', 'curlUp', 'enrage', 'angry', 'ritual', 'sharpHide', 'turns', 'stolen'];
const MOVE_NAMES = {
  ritual: '招魂仪式', cultist_attack: '邪祟啄击', chomp: '大颚咬', thrash: '冲撞护身', bellow: '鼓胀', bite: '叮咬', grow: '膨胀', louse_weak: '酸液吐息',
  acid_spit: '腐蚀喷吐', acid_tackle: '酸躯撞击', acid_lick: '黏舐', spike_attack: '尖刺撞击', spike_lick: '黏液缠身', split: '分裂',
  blue_stab: '刺击', blue_rake: '钩斩', red_stab: '重刺', red_scrape: '碎甲斩', entangle: '缠绕', looter_mug: '劫掠', looter_lunge: '突刺', smoke: '烟雾护身', escape: '逃跑',
  fungi_attack: '菌兽撕咬', fungi_grow: '菌丝膨大', fat_attack: '拖累重击', mad_attack: '狂怒拳', shield: '持盾庇护', shield_attack: '盾击', sneaky_attack: '背刺', charge: '蓄咒', wizard_attack: '终末法术',
  nob_bellow: '怒吼', nob_rush: '冲撞', nob_skull: '碎颅', sleep: '沉睡', stunned: '受惊停顿', lag_attack: '沉重斩击', siphon: '摄取魂力', sentry_beam: '魂束', sentry_bolt: '震魂',
  goop: '喷洒黏液', prepare: '准备砸击', slam: '重砸', guardian_charge: '积蓄护甲', guardian_bash: '猛击', guardian_vent: '喷出蒸汽', whirlwind: '旋风', defensive: '防御形态', roll: '滚击', twin: '双重砸击',
  activate: '点燃六火', divider: '分割', sear: '灼烧', tackle: '二连击', inflame: '火势渐盛', inferno: '炼狱',
};

const clone = state => structuredClone(state);
const alive = enemy => Boolean(enemy && enemy.hp > 0 && !enemy.escaped);
const totalDebt = state => state.debts.reduce((sum, debt) => sum + debt.amount, 0);
const log = (state, text) => { state.log = [...state.log, text].slice(-8); };
const invalid = (state, notice) => ({ ...state, notice, lastEvent: { kind: 'invalid', message: notice } });
const hasRelic = (state, id) => state.relics.includes(id);
const pick = (state, list) => list[Math.floor(random(state) * list.length)];
const int = (state, minimum, maximum) => minimum + Math.floor(random(state) * (maximum - minimum + 1));

function random(state) {
  let value = state.rngState >>> 0;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  state.rngState = value >>> 0;
  return state.rngState / 4294967296;
}

function shuffle(state, items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) { const j = int(state, 0, i); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}

function syncEnemy(state) { state.enemy = state.enemies.find(alive) ?? state.enemies[0] ?? null; }
export function getAct1Enemies(state) { return Array.isArray(state.enemies) ? state.enemies.filter(alive) : []; }

function makeCard(state, cardId, temporary = false) {
  return { uid: `a-card-${state.nextUid++}`, cardId, upgraded: false, ...(temporary ? { temporary: true } : {}) };
}

function addPermanentCard(state, cardId) {
  state.deck.push(cardId); state.deckCards.push(makeCard(state, cardId));
}

function draw(state, count) {
  let drawn = 0;
  while (drawn < count && state.hand.length < 10) {
    if (!state.drawPile.length && state.discard.length) { state.drawPile = shuffle(state, state.discard); state.discard = []; }
    if (!state.drawPile.length) break;
    state.hand.push(state.drawPile.pop()); drawn += 1;
  }
  return drawn;
}

function addStatusCards(state, cardId, count) {
  for (let i = 0; i < count; i += 1) state.discard.push(makeCard(state, cardId, true));
}

function addDebt(state, amount) {
  const debt = { id: `a-debt-${state.nextDebtId++}`, amount, dueTurn: state.turn + 2 };
  state.debts.push(debt); state.stats.borrowed += amount;
  return debt;
}

function repay(state, amount) {
  let left = amount;
  const debts = [...state.debts].sort((a, b) => a.dueTurn - b.dueTurn);
  for (const debt of debts) { const paid = Math.min(left, debt.amount); debt.amount -= paid; left -= paid; }
  state.debts = debts.filter(debt => debt.amount > 0);
  const paid = amount - left;
  if (paid > 0) {
    if (state.phase === 'combat' && state.repaidThisTurn === 0 && hasRelic(state, 'lamp')) state.block += 3;
    state.repaidThisTurn += paid; state.stats.repaid += paid;
  }
  return paid;
}

function hurtPlayer(state, amount, ignoreBlock = false) {
  const prevented = ignoreBlock ? 0 : Math.min(state.block, Math.max(0, amount));
  state.block -= prevented;
  const damage = Math.min(state.hp, Math.max(0, amount - prevented));
  state.hp -= damage; state.stats.damageTaken += damage;
  return damage;
}

function lose(state, cause, message) {
  state.phase = 'defeat'; state.notice = message; state.lastEvent = { kind: 'defeat', cause, message }; log(state, message);
}

function settleDebt(state) {
  const amount = state.debts.filter(debt => debt.dueTurn <= state.turn).reduce((sum, debt) => sum + debt.amount, 0);
  state.debts = state.debts.filter(debt => debt.dueTurn > state.turn);
  const damage = hurtPlayer(state, amount * 2, true);
  state.stats.defaults += amount; state.stats.debtDamage += damage;
  if (amount) log(state, `${amount} 点阴债到期，索命 ${damage} 点，无视护甲。`);
  if (!state.hp) lose(state, 'debt', '阴债到期，灯尽人亡。请在债期之前还愿。');
  return damage;
}

function heal(state, amount) { const actual = Math.min(state.maxHp - state.hp, amount); state.hp += actual; return actual; }
function damageValue(base, strength, weak, exposed) { return Math.max(0, Math.floor(Math.max(0, base + strength) * (weak > 0 ? 0.75 : 1) * (exposed > 0 ? 1.5 : 1))); }
function blockValue(state, base) { return Math.max(0, Math.floor(Math.max(0, base + state.dexterity) * (state.frail > 0 ? 0.75 : 1))); }

function debuffEnemy(state, enemy, key, amount) {
  if (!alive(enemy)) return false;
  if (enemy.artifact > 0) { enemy.artifact -= 1; log(state, `${ACT1_ENEMY_DEFS[enemy.id].name}的人工制品抵消了减益。`); return false; }
  enemy[key] += amount;
  return true;
}

function debuffPlayer(state, key, amount, fresh = null) {
  if (state.artifact > 0) { state.artifact -= 1; return false; }
  if (key === 'strength' || key === 'dexterity') state[key] -= amount;
  else { state[key] += amount; fresh?.add(key); }
  return true;
}

function deadEnemy(state, enemy) {
  if (enemy.hp > 0 || enemy.dead || enemy.escaped) return;
  enemy.dead = true; state.stats.kills += 1; state.stats.enemiesKilled += 1;
  if (enemy.id === 'fungi') { debuffPlayer(state, 'exposed', 2); log(state, '真菌兽散出孢子：你获得 2 回合易伤。'); }
  if (enemy.id === 'looter' && enemy.stolen) { state.gold += enemy.stolen; state.stats.goldRecovered += enemy.stolen; enemy.stolen = 0; }
  log(state, `击败${ACT1_ENEMY_DEFS[enemy.id].name}。`);
}

function hurtEnemy(state, enemy, amount, attack = true, ignoreBlock = false) {
  if (!alive(enemy)) return 0;
  const absorbed = ignoreBlock ? 0 : Math.min(enemy.block, amount);
  enemy.block -= absorbed;
  const damage = Math.min(enemy.hp, Math.max(0, amount - absorbed));
  enemy.hp -= damage; state.stats.damageDealt += damage;
  if (enemy.hp > 0 && damage > 0) {
    if (attack && enemy.curlUp > 0) { enemy.block += enemy.curlUp; enemy.curlUp = 0; }
    if (attack && enemy.angry > 0) enemy.strength += enemy.angry;
    if (enemy.id === 'lagavulin' && !enemy.ai.awake) { enemy.ai.awake = true; enemy.ai.stunned = true; enemy.ai.awakeStep = 0; enemy.block = 0; enemy.intent = intent('stunned'); }
    if (enemy.id === 'guardian' && enemy.ai.phase === 'offense') {
      enemy.ai.shiftRemaining = Math.max(0, enemy.ai.shiftRemaining - damage);
      if (enemy.ai.shiftRemaining === 0) { enemy.ai.phase = 'defense'; enemy.ai.defenseStep = 0; enemy.block += 20; enemy.intent = intent('defensive'); log(state, '守护者形态转换：取消原意图，立即获得 20 护甲。'); }
    }
    if (['acid_l', 'spike_l', 'slime_boss'].includes(enemy.id) && enemy.hp <= enemy.maxHp / 2) enemy.intent = intent('split');
  }
  deadEnemy(state, enemy);
  return damage;
}

function intent(move, data = {}) { return { move, label: MOVE_NAMES[move], ...data }; }

function weightedMove(state, enemy, entries, limits = {}) {
  const history = enemy.ai.history;
  const allowed = entries.filter(([move]) => {
    const limit = limits[move] ?? Infinity;
    let repeats = 0; for (let i = history.length - 1; i >= 0 && history[i] === move; i -= 1) repeats += 1;
    return repeats < limit;
  });
  let roll = random(state) * allowed.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [move, weight] of allowed) { roll -= weight; if (roll < 0) return move; }
  return allowed.at(-1)[0];
}

function planIntent(state, enemy) {
  const id = enemy.id; let move;
  if (['acid_l', 'spike_l', 'slime_boss'].includes(id) && enemy.hp <= enemy.maxHp / 2) return intent('split');
  if (id === 'cultist') return enemy.turns === 0 ? intent('ritual', { ritual: 3 }) : intent('cultist_attack', { damage: 6 });
  if (id === 'jaw') { move = enemy.turns === 0 ? 'chomp' : weightedMove(state, enemy, [['chomp', 25], ['thrash', 30], ['bellow', 45]], { chomp: 1, thrash: 2, bellow: 1 }); return intent(move, move === 'chomp' ? { damage: 11 } : move === 'thrash' ? { damage: 7, block: 5 } : { strength: 3, block: 6 }); }
  if (id.startsWith('louse_')) { move = weightedMove(state, enemy, [['bite', 75], [id === 'louse_red' ? 'grow' : 'louse_weak', 25]], { bite: 2, grow: 1, louse_weak: 2 }); return intent(move, move === 'bite' ? { damage: enemy.ai.biteDamage } : move === 'grow' ? { strength: 3 } : { weak: 2 }); }
  if (id.startsWith('acid_')) {
    const size = id.at(-1); const large = size === 'l';
    move = size === 's' ? weightedMove(state, enemy, [['acid_tackle', 50], ['acid_lick', 50]], { acid_tackle: 2, acid_lick: 2 }) : weightedMove(state, enemy, [['acid_spit', 30], ['acid_tackle', 40], ['acid_lick', 30]], { acid_spit: 2, acid_tackle: 1, acid_lick: 2 });
    return intent(move, move === 'acid_spit' ? { damage: large ? 11 : 7, status: 'a_slimed', count: large ? 2 : 1 } : move === 'acid_tackle' ? { damage: size === 's' ? 3 : large ? 16 : 10 } : { weak: large ? 2 : 1 });
  }
  if (id.startsWith('spike_')) { const size = id.at(-1); move = size === 's' ? 'spike_attack' : weightedMove(state, enemy, [['spike_attack', 30], ['spike_lick', 70]], { spike_attack: 2, spike_lick: 2 }); return intent(move, move === 'spike_attack' ? { damage: size === 's' ? 5 : size === 'm' ? 8 : 16, ...(size !== 's' ? { status: 'a_slimed', count: size === 'l' ? 2 : 1 } : {}) } : { frail: size === 'l' ? 2 : 1 }); }
  if (id === 'slaver_blue') { move = weightedMove(state, enemy, [['blue_stab', 65], ['blue_rake', 35]], { blue_stab: 2, blue_rake: 2 }); return intent(move, move === 'blue_stab' ? { damage: 12 } : { damage: 7, weak: 1 }); }
  if (id === 'slaver_red') {
    move = enemy.turns === 0 ? 'red_stab' : weightedMove(state, enemy, enemy.ai.entangled ? [['red_stab', 65], ['red_scrape', 35]] : [['red_stab', 40], ['red_scrape', 35], ['entangle', 25]], { red_stab: 2, red_scrape: 2 });
    return intent(move, move === 'red_stab' ? { damage: 13 } : move === 'red_scrape' ? { damage: 8, exposed: 1 } : { entangled: 1 });
  }
  if (id === 'looter') { if (enemy.turns < 2) return intent('looter_mug', { damage: 10, steal: 15 }); if (enemy.ai.history.at(-1) === 'smoke') return intent('escape'); if (enemy.ai.history.at(-1) === 'looter_lunge') return intent('smoke', { block: 6 }); return random(state) < 0.5 ? intent('looter_lunge', { damage: 12, steal: 15 }) : intent('smoke', { block: 6 }); }
  if (id === 'fungi') { move = weightedMove(state, enemy, [['fungi_attack', 60], ['fungi_grow', 40]], { fungi_attack: 2, fungi_grow: 1 }); return intent(move, move === 'fungi_attack' ? { damage: 6 } : { strength: 3 }); }
  if (id === 'gremlin_fat') return intent('fat_attack', { damage: 4, weak: 1 });
  if (id === 'gremlin_mad') return intent('mad_attack', { damage: 4 });
  if (id === 'gremlin_sneaky') return intent('sneaky_attack', { damage: 9 });
  if (id === 'gremlin_shield') { const other = getAct1Enemies(state).filter(candidate => candidate.uid !== enemy.uid); return other.length ? intent('shield', { block: 7, targetUid: pick(state, other).uid }) : intent('shield_attack', { damage: 6 }); }
  if (id === 'gremlin_wizard') return enemy.turns >= 2 && (enemy.turns - 2) % 4 === 0 ? intent('wizard_attack', { damage: 25 }) : intent('charge');
  if (id === 'nob') { if (enemy.turns === 0) return intent('nob_bellow', { enrage: 2 }); move = weightedMove(state, enemy, [['nob_skull', 33], ['nob_rush', 67]], { nob_rush: 2 }); return intent(move, move === 'nob_rush' ? { damage: 14 } : { damage: 6, exposed: 2 }); }
  if (id === 'lagavulin') { if (!enemy.ai.awake) return intent('sleep'); if (enemy.ai.stunned) return intent('stunned'); return enemy.ai.awakeStep % 3 === 2 ? intent('siphon') : intent('lag_attack', { damage: 18 }); }
  if (id === 'sentry') return (enemy.turns + enemy.ai.position) % 2 === 1 ? intent('sentry_beam', { damage: 9 }) : intent('sentry_bolt', { status: 'a_dazed', count: 2 });
  if (id === 'slime_boss') return [intent('goop', { status: 'a_slimed', count: 3 }), intent('prepare'), intent('slam', { damage: 35 })][enemy.turns % 3];
  if (id === 'guardian') {
    if (enemy.ai.phase === 'defense') return [intent('defensive'), intent('roll', { damage: 9 }), intent('twin', { damage: 8, hits: 2 })][enemy.ai.defenseStep];
    return [intent('guardian_charge', { block: 9 }), intent('guardian_bash', { damage: 32 }), intent('guardian_vent', { weak: 2, exposed: 2 }), intent('whirlwind', { damage: 5, hits: 4 })][enemy.ai.offenseStep];
  }
  if (id === 'hexaghost') {
    if (enemy.turns === 0) return intent('activate');
    if (enemy.turns === 1) return intent('divider', { damage: Math.floor(state.hp / 12) + 1, hits: 6 });
    return [intent('sear', { damage: 6, status: enemy.ai.infernoUsed ? 'a_burn_plus' : 'a_burn', count: 1 }), intent('tackle', { damage: 5, hits: 2 }), intent('sear', { damage: 6, status: enemy.ai.infernoUsed ? 'a_burn_plus' : 'a_burn', count: 1 }), intent('inflame', { strength: 2, block: 12 }), intent('tackle', { damage: 5, hits: 2 }), intent('sear', { damage: 6, status: enemy.ai.infernoUsed ? 'a_burn_plus' : 'a_burn', count: 1 }), intent('inferno', { damage: 2, hits: 6, status: 'a_burn_plus', count: 3 })][(enemy.turns - 2) % 7];
  }
  throw new Error(`尚未定义的敌人行为：${id}`);
}

export function createAct1Enemy(state, id, position = 0, inheritedHp = null) {
  const definition = ACT1_ENEMY_DEFS[id];
  if (!definition) throw new Error(`未知的塔底敌人：${id}`);
  const range = definition.hpRange ?? [definition.maxHp, definition.maxHp];
  const rolled = inheritedHp ?? int(state, range[0], range[1]);
  const maxHp = inheritedHp ?? (state.difficulty === 1 ? Math.ceil(rolled * 1.15) : rolled);
  return {
    id, uid: `a-enemy-${state.nextEnemyUid++}`, hp: maxHp, maxHp, block: id === 'lagavulin' ? 8 : 0,
    burn: 0, weak: 0, exposed: 0, frail: 0, strength: 0, artifact: id === 'sentry' ? 1 : 0,
    curlUp: id.startsWith('louse_') ? int(state, 3, 7) : 0, enrage: 0, angry: id === 'gremlin_mad' ? 1 : 0,
    ritual: 0, sharpHide: 0, turns: 0, stolen: 0, dead: false, escaped: false,
    ai: { history: [], position, biteDamage: id.startsWith('louse_') ? int(state, 5, 7) : 0, awake: false, stunned: false, awakeStep: 0, entangled: false, phase: 'offense', shiftThreshold: 30, shiftRemaining: 30, offenseStep: 0, defenseStep: 0, infernoUsed: false },
    intent: intent('charge'), intentIndex: 0,
  };
}

export function getAct1EnemyIntent(state, uid) {
  const enemy = uid ? state.enemies.find(candidate => candidate.uid === uid && alive(candidate)) : state.enemies.find(alive);
  if (!enemy) return { kind: 'none', label: '静候', amount: 0, hits: 1, total: 0, detail: '没有尚在战场上的敌人。' };
  const action = enemy.intent;
  const hits = action.hits ?? 1;
  const amount = action.damage === undefined ? action.block ?? 0 : damageValue(action.damage + (state.difficulty === 1 ? 2 : 0), enemy.strength, enemy.weak, state.exposed);
  const pieces = [];
  if (action.damage !== undefined) pieces.push(`造成 ${amount}${hits > 1 ? `×${hits}` : ''} 点伤害`);
  if (action.block) pieces.push(`获得 ${action.block} 点护甲`);
  if (action.strength) pieces.push(`获得 ${action.strength} 点力量`);
  if (action.ritual) pieces.push(`获得仪式 ${action.ritual}，之后每轮增长力量`);
  if (action.enrage) pieces.push(`获得激怒 ${action.enrage}，技能牌会使它增加力量`);
  for (const [key, name] of [['weak', '虚弱'], ['exposed', '易伤'], ['frail', '脆弱'], ['entangled', '缠绕']]) if (action[key]) pieces.push(`施加 ${action[key]} 回合${name}`);
  if (action.status) pieces.push(`向弃牌堆加入 ${action.count} 张${CARD_DEFS[action.status].name}`);
  if (action.steal) pieces.push(`偷取 ${Math.min(state.gold, action.steal)} 金币，格挡无法防止偷窃`);
  if (action.move === 'split') pieces.push(`分裂成两只子体，各继承行动时的 ${enemy.hp} 点剩余生命；可继续压低或击杀母体`);
  if (action.move === 'sleep') pieces.push('维持 8 护甲；失去生命会提前苏醒并停顿，第三轮后自然醒来');
  if (action.move === 'siphon') pieces.push('先降低你 1 点敏捷，再降低 1 点力量');
  if (action.move === 'defensive') pieces.push('获得尖刺外壳 3；每张攻击牌反伤 3，可被护甲抵挡');
  if (action.move === 'shield') pieces.push('保护已选择的同伴；若它离场则保护自己');
  if (action.move === 'escape') pieces.push('携带未追回的金币离场');
  if (action.move === 'inferno') pieces.push('升级所有已有灼伤，此后的灼烧也加入升级灼伤');
  return { ...action, kind: action.damage !== undefined ? 'attack' : action.block ? 'defend' : action.status || action.weak || action.exposed || action.frail || action.entangled || action.move === 'siphon' ? 'hex' : 'buff', label: action.label, amount, hits, total: action.damage === undefined ? 0 : amount * hits, detail: `${pieces.join('；') || '本次不造成伤害'}。`, enemyUid: enemy.uid };
}

export function getAct1CardView(state, cardOrId, uid) {
  const card = typeof cardOrId === 'object' && cardOrId ? cardOrId : uid ? [...state.hand, ...state.deckCards].find(candidate => candidate.uid === uid) : null;
  const cardId = card?.cardId ?? cardOrId;
  const base = CARD_DEFS[cardId];
  if (!base) return null;
  const upgraded = Boolean(card?.upgraded);
  const target = base.target ?? (LEGACY_ENEMY_TARGETS.includes(cardId) ? 'enemy' : 'self');
  const description = upgraded ? base.upgradeDescription ?? base.description : base.description;
  let reason = '';
  if (state.phase !== 'combat') reason = '此刻不在战斗中。';
  else if (base.unplayable) reason = base.ethereal ? '眩晕无法打出；回合结束留在手中会消耗。' : '灼伤无法打出；可用护甲抵挡其回合末伤害。';
  else if (base.type === 'attack' && state.entangled > 0) reason = '你被缠绕，本回合无法使用攻击牌。';
  else if (state.energy < base.cost) reason = '香火不足。可以借火，或先使用其他牌。';
  return { ...base, name: `${base.name}${upgraded ? '+' : ''}`, description, target, upgraded, upgradeable: base.type !== 'status' && !upgraded, playable: !reason, reason, cost: base.cost, uid: card?.uid };
}

export function isAct1CardPlayable(state, cardOrUid, targetUid) {
  const requestedUid = typeof cardOrUid === 'object' && cardOrUid ? cardOrUid.uid : cardOrUid;
  const card = state.hand.find(candidate => candidate.uid === requestedUid);
  if (!card) return false;
  const view = getAct1CardView(state, card);
  if (!view?.playable) return false;
  if (view.target === 'enemy') return targetUid ? state.enemies.some(enemy => enemy.uid === targetUid && alive(enemy)) : getAct1Enemies(state).length === 1;
  return true;
}

function finishNode(state) {
  const route = state.route;
  if (!route.completedIds.includes(route.currentId)) route.completedIds.push(route.currentId);
  state.phase = 'map'; state.event = null; state.rewards = []; state.block = 0; state.shop = null;
  state.notice = '收好灯火，选择下一处落脚地。'; state.lastEvent = { kind: 'map' };
}

function cleanStatuses(state) {
  for (const zone of ['hand', 'drawPile', 'discard', 'exhaust']) state[zone] = state[zone].filter(card => !card.temporary);
}

function grantRelic(state) {
  const choices = Object.keys(RELIC_DEFS).filter(id => !['lamp', 'bell', 'blood_ember'].includes(id) && !state.relics.includes(id));
  if (!choices.length) { state.gold += 35; return null; }
  const id = pick(state, choices); state.relics.push(id); return id;
}

function grantPotion(state) {
  if (state.potions.length >= 3) return null;
  const id = pick(state, Object.keys(POTION_DEFS));
  state.potions.push({ uid: `a-potion-${state.nextPotionUid++}`, id }); return id;
}

function winCombat(state) {
  if (state.phase !== 'combat' || getAct1Enemies(state).length) return;
  state.stats.battlesWon += 1;
  const healing = hasRelic(state, 'blood_ember') ? heal(state, 6) : 0;
  cleanStatuses(state);
  const gold = state.encounterKind === 'elite' ? int(state, 25, 35) : state.encounterKind === 'boss' ? int(state, 95, 105) : int(state, 10, 20);
  state.gold += gold;
  const relicId = state.encounterKind === 'elite' ? grantRelic(state) : null;
  const potionId = random(state) < 0.35 ? grantPotion(state) : null;
  state.rewardInfo = { gold, healing, relicId, potionId, kills: state.stats.kills - state.combatKillsStart };
  if (state.encounterKind === 'boss') {
    const forgiven = totalDebt(state); state.debts = [];
    if (!state.route.completedIds.includes(state.route.currentId)) state.route.completedIds.push(state.route.currentId);
    state.phase = 'victory'; state.notice = '塔底已渡。判官销清旧契，这一幕阴路走到了尽头。';
    state.lastEvent = { kind: 'victory', final: true, forgiven, ...state.rewardInfo }; log(state, state.notice);
  } else {
    state.phase = 'reward'; state.rewards = shuffle(state, state.rewardPool).slice(0, 3);
    state.notice = `战斗胜利，获得 ${gold} 金币${healing ? `，恢复 ${healing} 生命` : ''}。选择一道符箓，或跳过。`;
    state.lastEvent = { kind: 'victory', final: false, ...state.rewardInfo }; log(state, state.notice);
  }
}

function beginTurn(state, first = false) {
  state.energy = state.maxEnergy; state.block = 0; state.borrowedThisTurn = 0; state.repaidThisTurn = 0;
  const debtDamage = settleDebt(state); if (state.phase === 'defeat') return debtDamage;
  draw(state, first && hasRelic(state, 'bag') ? 7 : 5);
  if (first) {
    if (hasRelic(state, 'bell')) state.block += 6;
    if (hasRelic(state, 'anchor')) state.block += 10;
    if (hasRelic(state, 'lantern')) state.energy += 1;
  }
  return debtDamage;
}

function beginCombat(state, encounter, kind = 'battle', normal = true) {
  if (state.stats.battlesStarted > 0) state.turn += 1;
  state.stats.battlesStarted += 1; state.combatTurn = 1; state.phase = 'combat'; state.encounterKind = kind;
  state.encounterId = encounter.id; state.event = null; state.rewards = []; state.rewardInfo = null; state.shop = null;
  state.strength = hasRelic(state, 'vajra') ? 1 : 0; state.dexterity = hasRelic(state, 'smooth_stone') ? 1 : 0;
  for (const key of STATUS_KEYS) state[key] = 0; state.artifact = 0;
  state.enemies = encounter.enemies.map((id, index) => createAct1Enemy(state, id, index));
  state.hand = []; state.drawPile = shuffle(state, state.deckCards.map(card => ({ ...card }))); state.discard = []; state.exhaust = [];
  state.combatKillsStart = state.stats.kills;
  if (kind === 'battle' && normal) state.normalBattles += 1;
  state.encounterHistory.push(encounter.id); state.encounterHistory = state.encounterHistory.slice(-8);
  const debtDamage = beginTurn(state, true);
  for (const enemy of state.enemies) enemy.intent = planIntent(state, enemy);
  syncEnemy(state);
  if (state.phase === 'defeat') return;
  state.notice = `${encounter.label ?? '鬼影拦路'}。每只敌人独立行动；单体牌需要选定目标。${debtDamage ? `旧契索命 ${debtDamage} 点。` : ''}`;
  state.lastEvent = { kind: 'encounter', encounterId: encounter.id, enemyIds: state.enemies.map(enemy => enemy.id), debtDamage }; log(state, state.notice);
}

function play(state, card, target) {
  const view = getAct1CardView(state, card); const u = view.upgraded;
  const value = (normal, upgraded) => u ? upgraded : normal;
  state.energy -= view.cost; state.hand = state.hand.filter(held => held.uid !== card.uid);
  // The active card is held locally until every effect has resolved. It is
  // not part of either shuffleable pile, so draw effects cannot draw it back.
  state.stats.cardsPlayed += 1;
  const reflectors = view.type === 'attack' ? getAct1Enemies(state).filter(enemy => enemy.sharpHide > 0).map(enemy => enemy.sharpHide) : [];
  if (view.type === 'skill') for (const enemy of getAct1Enemies(state)) enemy.strength += enemy.enrage;
  let damage = 0; let block = 0; let paid = 0; let drawn = 0; let debt = 0; let burn = 0; let exposed = 0;
  switch (card.cardId) {
    case 'a_strike': damage = value(6, 9); break;
    case 'a_defend': block = value(5, 8); break;
    case 'a_bash': damage = value(8, 10); exposed = value(2, 3); break;
    case 'a_cleave': damage = value(8, 11); break;
    case 'a_flame': damage = value(14, 18); addStatusCards(state, 'a_burn', 1); break;
    case 'a_slimed': break;
    case 'brush': damage = value(7, 10); break;
    case 'talisman': block = value(6, 9); break;
    case 'chain': damage = value(7, 10) + (totalDebt(state) ? value(4, 6) : 0); break;
    case 'vow': block = value(4, 7); paid = repay(state, value(2, 3)); break;
    case 'step': block = value(5, 8); drawn = draw(state, 1); break;
    case 'coin': damage = value(3, 5); drawn = draw(state, 1); break;
    case 'fire': damage = value(5, 8); burn = value(4, 6); break;
    case 'bell': block = value(3, 5); exposed = value(2, 3); break;
    case 'seal': damage = value(16, 21) + (totalDebt(state) ? value(6, 8) : 0); break;
    case 'lotus': block = value(8, 11); paid = repay(state, value(2, 3)); break;
    case 'blood': damage = value(10, 14); debt = 2; addDebt(state, debt); break;
    case 'ledger': paid = repay(state, value(4, 6)); drawn = draw(state, value(2, 3)); break;
    case 'mirror': block = value(7, 10) + (state.repaidThisTurn ? value(6, 8) : 0); break;
    case 'ferry': paid = repay(state, value(2, 3)); state.energy += value(1, 2); break;
    case 'verdict': damage = value(24, 32) + Math.min(value(16, 24), totalDebt(state) * 2); break;
  }
  const gainedBlock = block ? blockValue(state, block) : 0; state.block += gainedBlock;
  let dealt = 0;
  const targets = view.target === 'all' ? [...getAct1Enemies(state)] : target ? [target] : [];
  for (const enemy of targets) {
    if (damage > 0) dealt += hurtEnemy(state, enemy, damageValue(damage, state.strength, state.weak, enemy.exposed));
    if (exposed) debuffEnemy(state, enemy, 'exposed', exposed);
    if (burn) debuffEnemy(state, enemy, 'burn', burn);
  }
  if (card.cardId === 'chain' && target?.hp === 0) paid += repay(state, 2);
  for (const amount of reflectors) hurtPlayer(state, amount);
  (view.exhaust ? state.exhaust : state.discard).push(card);
  const parts = [damage ? `造成 ${dealt} 伤害` : '', gainedBlock ? `获得 ${gainedBlock} 护甲` : '', paid ? `偿还 ${paid} 阴债` : '', drawn ? `抽 ${drawn} 张牌` : '', debt ? `新增 ${debt} 阴债` : ''].filter(Boolean);
  state.notice = `${view.name}：${parts.join('，') || (card.cardId === 'a_slimed' ? '清理黏液并消耗' : '符光一闪')}。`;
  state.lastEvent = { kind: 'play', cardId: card.cardId, uid: card.uid, targetUid: target?.uid ?? null, targetUids: targets.map(enemy => enemy.uid), damage: dealt, block: gainedBlock, repaid: paid, drawn, addedDebt: debt }; log(state, state.notice);
  if (state.hp <= 0) lose(state, 'enemy', '尖刺外壳反噬，灯火熄灭。');
  else winCombat(state);
}

function splitEnemy(state, enemy) {
  const ids = enemy.id === 'slime_boss' ? ['acid_l', 'spike_l'] : enemy.id === 'acid_l' ? ['acid_m', 'acid_m'] : ['spike_m', 'spike_m'];
  const children = ids.map((id, index) => createAct1Enemy(state, id, index, enemy.hp));
  const index = state.enemies.findIndex(candidate => candidate.uid === enemy.uid);
  state.enemies.splice(index, 1, ...children);
  log(state, `${ACT1_ENEMY_DEFS[enemy.id].name}分裂：两只子体各有 ${enemy.hp} 生命。`);
}

function executeEnemy(state, enemy, fresh, actions) {
  let action = enemy.intent;
  const hadRitual = enemy.ritual;
  let burnDamage = 0;
  if (enemy.burn > 0) { burnDamage = hurtEnemy(state, enemy, enemy.burn, false, true); enemy.burn -= 1; log(state, `${ACT1_ENEMY_DEFS[enemy.id].name}受到 ${burnDamage} 业火伤害。`); }
  if (!alive(enemy)) { actions.push({ enemyUid: enemy.uid, kind: 'burn-death', label: '业火', damage: 0, burnDamage }); return; }
  // HP-triggered split/mode-shift can replace this intent before it executes.
  action = enemy.intent;
  if (action.move === 'split') { actions.push({ enemyUid: enemy.uid, kind: 'split', move: 'split', label: action.label, damage: 0, inheritedHp: enemy.hp, burnDamage }); splitEnemy(state, enemy); return; }
  const shown = getAct1EnemyIntent(state, enemy.uid);
  let lost = 0;
  if (action.damage !== undefined) for (let hit = 0; hit < (action.hits ?? 1) && state.hp > 0; hit += 1) lost += hurtPlayer(state, shown.amount);
  actions.push({ enemyUid: enemy.uid, kind: shown.kind, move: action.move, label: action.label, damage: lost, amount: shown.amount, hits: shown.hits, burnDamage });
  if (action.damage !== undefined) log(state, `${ACT1_ENEMY_DEFS[enemy.id].name}使出${action.label}，你失去 ${lost} 生命。`);
  if (!state.hp) { lose(state, 'enemy', `你倒在${ACT1_ENEMY_DEFS[enemy.id].name}面前。`); return; }
  if (action.block) {
    if (action.move === 'shield') { const ally = state.enemies.find(candidate => candidate.uid === action.targetUid && alive(candidate)) ?? enemy; ally.block += action.block; }
    else enemy.block += action.block;
  }
  if (action.strength) enemy.strength += action.strength;
  if (action.ritual) enemy.ritual += action.ritual;
  if (action.enrage) enemy.enrage += action.enrage;
  if (action.status) addStatusCards(state, action.status, action.count);
  for (const key of STATUS_KEYS) if (action[key]) debuffPlayer(state, key, action[key], fresh);
  if (action.steal) { const amount = Math.min(state.gold, action.steal); state.gold -= amount; enemy.stolen += amount; state.stats.goldStolen += amount; }
  if (action.move === 'entangle') enemy.ai.entangled = true;
  if (action.move === 'escape') { enemy.escaped = true; state.stats.enemiesEscaped += 1; log(state, '强盗带着赃款逃走了。'); }
  if (action.move === 'sleep') { enemy.block = 8; if (enemy.turns >= 2) { enemy.ai.awake = true; enemy.ai.awakeStep = 0; enemy.block = 0; } }
  if (action.move === 'stunned') enemy.ai.stunned = false;
  if (action.move === 'lag_attack' || action.move === 'siphon') enemy.ai.awakeStep += 1;
  if (action.move === 'siphon') { debuffPlayer(state, 'dexterity', 1); debuffPlayer(state, 'strength', 1); }
  if (enemy.id === 'guardian') {
    if (action.move === 'defensive') { enemy.sharpHide = 3; enemy.ai.defenseStep = 1; }
    else if (action.move === 'roll') enemy.ai.defenseStep = 2;
    else if (action.move === 'twin') { enemy.sharpHide = 0; enemy.ai.phase = 'offense'; enemy.ai.offenseStep = 3; enemy.ai.shiftThreshold += 10; enemy.ai.shiftRemaining = enemy.ai.shiftThreshold; }
    else enemy.ai.offenseStep = (enemy.ai.offenseStep + 1) % 4;
  }
  if (action.move === 'inferno') {
    enemy.ai.infernoUsed = true;
    for (const zone of ['hand', 'drawPile', 'discard', 'exhaust']) for (const card of state[zone]) if (card.cardId === 'a_burn') card.cardId = 'a_burn_plus';
  }
  if (hadRitual) enemy.strength += hadRitual;
  enemy.ai.history = [...enemy.ai.history, action.move].slice(-3); enemy.turns += 1; enemy.intentIndex = enemy.turns;
  for (const key of ['weak', 'exposed', 'frail']) enemy[key] = Math.max(0, enemy[key] - 1);
}

function endTurn(state) {
  const oldHp = state.hp;
  for (const card of state.hand) {
    if (card.cardId === 'a_burn' || card.cardId === 'a_burn_plus') hurtPlayer(state, card.cardId === 'a_burn' ? 2 : 4);
    (CARD_DEFS[card.cardId].ethereal ? state.exhaust : state.discard).push(card);
  }
  state.hand = [];
  if (!state.hp) { lose(state, 'burn', '灼伤在回合结束时耗尽了你的生命。'); return; }
  const fresh = new Set();
  const actions = [];
  const actingUids = getAct1Enemies(state).map(enemy => enemy.uid);
  // All old monster block expires together, before any ally grants new block.
  // Otherwise a shield gremlin acting before its ally would erase its own gift.
  for (const enemy of getAct1Enemies(state)) enemy.block = 0;
  for (const uid of actingUids) {
    const enemy = state.enemies.find(candidate => candidate.uid === uid);
    if (enemy && alive(enemy)) executeEnemy(state, enemy, fresh, actions);
    if (state.phase === 'defeat') { state.lastEvent.actions = actions; return; }
  }
  winCombat(state); if (state.phase !== 'combat') { state.lastEvent.actions = actions; return; }
  for (const key of STATUS_KEYS) if (!fresh.has(key)) state[key] = Math.max(0, state[key] - 1);
  state.turn += 1; state.combatTurn += 1;
  const debtDamage = beginTurn(state);
  if (state.phase === 'defeat') { state.lastEvent.actions = actions; return; }
  // Announce the following round only after every actor and turn-start debt
  // has resolved. Divider therefore snapshots actual turn-two health once.
  for (const enemy of getAct1Enemies(state)) enemy.intent = planIntent(state, enemy);
  state.notice = debtDamage ? `新巡更开始，旧契索命 ${debtDamage} 点。香火已补满。` : '新回合：香火复燃，抽取五张牌。先看每只鬼怪的意图。';
  state.lastEvent = { kind: debtDamage ? 'debt' : 'enemy', damage: oldHp - state.hp - debtDamage, debtDamage, actions }; log(state, state.notice);
}

function makeShop(state) {
  const cards = shuffle(state, state.rewardPool).slice(0, 3);
  state.shop = { removalUsed: false, offers: cards.map((cardId, index) => ({ id: `card-${index}`, kind: 'card', cardId, price: [45, 60, 75][index], sold: false })) };
  const potionId = pick(state, Object.keys(POTION_DEFS)); state.shop.offers.push({ id: 'potion', kind: 'potion', potionId, price: 30, sold: false });
}

export function getAct1EventView(state) {
  if (state.phase !== 'event' || !state.event) return null;
  const id = state.event.id; let title; let description; let choices;
  if (id === 'rest') {
    title = '灯下歇脚'; description = '阴路不等人，但这一刻你可以照料自己。歇脚不推进债期。';
    choices = [{ id: 'rest', title: `休息 · 恢复 ${Math.floor(state.maxHp * 0.3)} 生命`, description: '恢复最大生命的30%。' }, { id: 'upgrade', title: '锻符 · 升级一张牌', description: '只升级所选永久牌副本，效果持续本局。', disabled: !state.deckCards.some(card => !card.upgraded) }, { id: 'repay', title: '还愿 · 偿还4点阴债', description: '优先清偿最早到期的借据，并恢复4生命。', disabled: totalDebt(state) === 0 }];
  } else if (id === 'upgrade' || id === 'remove') {
    title = id === 'upgrade' ? '选择一道符箓锻造' : '选择一道符箓移除'; description = id === 'upgrade' ? '升级只作用于这一张永久牌，不会改变其他同名副本。' : `本次移除花费 ${state.removePrice} 金币；完成后仍可继续逛店。`;
    choices = state.deckCards.filter(card => id === 'remove' || !card.upgraded).map(card => ({ id: `${id}:${card.uid}`, cardId: card.cardId, cardUid: card.uid, title: getAct1CardView(state, card).name, description: id === 'upgrade' ? getAct1CardView(state, { ...card, upgraded: true }).description : '将此副本从本局牌组中移除。', disabled: id === 'remove' && (state.shop.removalUsed || state.gold < state.removePrice || state.deck.length <= 1) }));
    choices.push({ id: 'cancel', title: '暂不选择', description: id === 'upgrade' ? '返回歇脚处。' : '返回商店。' });
  } else if (id === 'shop') {
    title = '鬼市符铺'; description = `持有 ${state.gold} 金币。购买、删牌均不推进债期。`;
    choices = state.shop.offers.map(offer => ({ id: `buy:${offer.id}`, cardId: offer.cardId, price: offer.price, title: `${offer.kind === 'card' ? CARD_DEFS[offer.cardId].name : POTION_DEFS[offer.potionId].name} · ${offer.price} 金币`, description: offer.sold ? '已经售出。' : offer.kind === 'card' ? CARD_DEFS[offer.cardId].description : POTION_DEFS[offer.potionId].description, disabled: offer.sold || state.gold < offer.price || (offer.kind === 'potion' && state.potions.length >= 3) }));
    choices.push({ id: 'remove', title: state.shop.removalUsed ? '删牌 · 本店已用' : `删牌 · ${state.removePrice} 金币`, description: state.shop.removalUsed ? `每家店只可移除一张牌。下一家费用为${state.removePrice}金币。` : '移除一张永久牌；每店限一次，后续费用增加25。', disabled: Boolean(state.shop.removalUsed) || state.gold < state.removePrice || state.deck.length <= 1 }, { id: 'leave', title: '离开鬼市', description: '回到地图，继续夜巡。' });
  } else if (id === 'treasure') {
    title = '遗落的魂匣'; description = '匣中有一件旧物，也许能照亮接下来的阴路。'; choices = [{ id: 'open', title: '开启魂匣', description: '获得一件本局遗物。' }, { id: 'leave', title: '轻装离开', description: '不取遗物，继续前行。' }];
  } else if (id === 'mushrooms') {
    title = '孢子鬼林'; description = '三团菌影围住了散落的符纸。'; choices = [{ id: 'fight', title: '驱散三只真菌兽', description: '进入三敌事件战，胜利后获得金币与选牌。' }, { id: 'leave', title: '绕开鬼林', description: '沿小路走开，恢复4生命。' }];
  } else if (id === 'shrine') {
    title = '纸灯神龛'; description = '灯前有人留了两张符，代价写在背面。'; choices = [{ id: 'blood', title: '以血换签', description: '失去6生命，获得生死签。', disabled: state.hp <= 6 }, { id: 'debt', title: '欠契取铃', description: '欠2阴债，获得摄魂铃。' }, { id: 'leave', title: '绕路小憩', description: '恢复4生命。' }];
  } else {
    title = id === 'market' ? '鬼市借灯' : '路旁供桌'; description = '来路有余温，前路有代价。'; choices = [{ id: 'heal', title: '收下热汤', description: '恢复10生命。' }, { id: 'gold', title: '借走供钱', description: '获得35金币，欠下2阴债。' }, { id: 'leave', title: '合掌离开', description: '不作交易，继续前行。' }];
  }
  return { id, title, description, choices };
}

function refreshEvent(state) { state.event = getAct1EventView(state); }

function eventAction(state, action) {
  const view = getAct1EventView(state); const choice = view.choices.find(item => item.id === action.choiceId);
  if (!choice || choice.disabled) return false;
  const id = view.id; const selected = choice.id;
  if (id === 'rest' && selected === 'upgrade') { state.event = { id: 'upgrade' }; refreshEvent(state); return true; }
  if (id === 'rest') { if (selected === 'rest') heal(state, Math.floor(state.maxHp * 0.3)); else { repay(state, 4); heal(state, 4); } finishNode(state); return true; }
  if (id === 'upgrade' || id === 'remove') {
    if (selected === 'cancel') { state.event = { id: id === 'upgrade' ? 'rest' : 'shop' }; refreshEvent(state); return true; }
    const card = state.deckCards.find(item => item.uid === choice.cardUid);
    if (!card) return false;
    if (id === 'upgrade') { card.upgraded = true; state.upgrades[card.uid] = 1; for (const zone of ['hand', 'drawPile', 'discard', 'exhaust']) for (const held of state[zone]) if (held.uid === card.uid) held.upgraded = true; log(state, `${CARD_DEFS[card.cardId].name}已升级。`); finishNode(state); }
    else { const index = state.deckCards.indexOf(card); state.shop.removalUsed = true; state.gold -= state.removePrice; state.removePrice += 25; state.deckCards.splice(index, 1); state.deck.splice(index, 1); delete state.upgrades[card.uid]; for (const zone of ['hand', 'drawPile', 'discard', 'exhaust']) state[zone] = state[zone].filter(held => held.uid !== card.uid); state.event = { id: 'shop' }; refreshEvent(state); }
    return true;
  }
  if (id === 'shop') {
    if (selected === 'leave') finishNode(state);
    else if (selected === 'remove') { state.event = { id: 'remove' }; refreshEvent(state); }
    else { const offer = state.shop.offers.find(item => `buy:${item.id}` === selected); state.gold -= offer.price; offer.sold = true; if (offer.kind === 'card') addPermanentCard(state, offer.cardId); else state.potions.push({ uid: `a-potion-${state.nextPotionUid++}`, id: offer.potionId }); refreshEvent(state); }
    return true;
  }
  if (id === 'treasure') { const relicId = selected === 'open' ? grantRelic(state) : null; finishNode(state); state.notice = relicId ? `获得遗物：${RELIC_DEFS[relicId].name}。` : '收好灯火，继续前行。'; state.lastEvent = { kind: 'treasure', relicId }; return true; }
  if (id === 'mushrooms' && selected === 'fight') { beginCombat(state, { id: 'event_mushrooms', label: '孢子鬼林', enemies: ['fungi', 'fungi', 'fungi'] }, 'battle', false); return true; }
  if (id === 'shrine') { if (selected === 'blood') { hurtPlayer(state, 6, true); addPermanentCard(state, 'seal'); } else if (selected === 'debt') { addDebt(state, 2); addPermanentCard(state, 'bell'); } else heal(state, 4); }
  else if (id === 'mushrooms') heal(state, 4);
  else if (selected === 'heal') heal(state, 10);
  else if (selected === 'gold') { state.gold += 35; addDebt(state, 2); }
  finishNode(state); return true;
}

export function createAct1Adventure(seed = Date.now(), options = {}) {
  const normalized = Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 1;
  const relicId = options.relicId ?? 'lamp'; const difficulty = options.difficulty ?? 0;
  if (!['lamp', 'bell'].includes(relicId) || ![0, 1].includes(difficulty)) throw new Error('尚未开放的法器或难度。');
  if (options.rewardPool !== undefined && options.rewardPool !== null && !Array.isArray(options.rewardPool)) throw new Error('奖励池必须是卡牌列表。');
  const pool = [...new Set(['a_cleave', 'a_flame', ...(options.rewardPool ?? REWARD_POOL)])];
  if (pool.length < 3 || pool.some(id => !CARD_DEFS[id] || CARD_DEFS[id].type === 'status')) throw new Error('奖励池需至少三张可获得的牌。');
  if (options.runId !== undefined && (typeof options.runId !== 'string' || !options.runId.trim())) throw new Error('夜巡编号不能为空。');
  const state = {
    version: ACT1_VERSION, ruleset: 'act1', seed: normalized, rngState: normalized || 0x9e3779b9, modeId: 'classic', runId: options.runId ?? `act1-${normalized}-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`,
    phase: 'map', hp: 80, maxHp: 80, block: 0, energy: 3, maxEnergy: 3, strength: 0, dexterity: 0, weak: 0, exposed: 0, frail: 0, entangled: 0, artifact: 0,
    hand: [], drawPile: [], discard: [], exhaust: [], deck: [], deckCards: [], upgrades: {}, debts: [], turn: 1, combatTurn: 1, borrowedThisTurn: 0, repaidThisTurn: 0,
    enemies: [], enemy: null, nodeIndex: 0, route: createAct1Route(normalized), normalBattles: 0, encounterId: null, encounterKind: null, encounterHistory: [], combatKillsStart: 0,
    rewards: [], rewardInfo: null, event: null, shop: null, gold: 99, removePrice: 75, relicId, relics: ['blood_ember', relicId], potions: [], difficulty, rewardPool: pool,
    stats: { damageDealt: 0, damageTaken: 0, borrowed: 0, repaid: 0, defaults: 0, debtDamage: 0, cardsPlayed: 0, battlesWon: 0, battlesStarted: 0, kills: 0, enemiesKilled: 0, enemiesEscaped: 0, goldStolen: 0, goldRecovered: 0 },
    nextUid: 1, nextDebtId: 1, nextEnemyUid: 1, nextPotionUid: 1, log: [], notice: '提灯踏入塔底。前三场普通遭遇较弱，地图顶端已显出今夜首领。', lastEvent: { kind: 'map' },
  };
  for (const id of STARTING_DECK) addPermanentCard(state, id);
  log(state, state.notice); return state;
}

export function transitionAct1(state, action) {
  if (!action || typeof action.type !== 'string') return invalid(state, '这一步没有生效。');
  if (['victory', 'defeat'].includes(state.phase)) return { ...state, notice: '这一夜已经结束。回府后可重新出发。' };
  if (action.type === 'selectNode') {
    if (state.phase !== 'map') return invalid(state, '请先完成眼前的战斗或际遇。');
    const node = getAvailableAct1Nodes(state).find(candidate => candidate.id === action.nodeId);
    if (!node) return invalid(state, '这条路尚未相通，不能跳层、回退或重走。');
    const next = clone(state); next.route.currentId = node.id; next.route.path.push(node.id); next.nodeIndex = node.stageIndex ?? node.row;
    if (['battle', 'elite', 'boss'].includes(node.type)) {
      const pool = node.encounterId ?? (node.type === 'boss' ? node.enemyId ?? next.route.bossId : node.type === 'elite' ? 'elite' : next.normalBattles < 3 ? 'weak' : 'strong');
      const recentNormal = next.encounterHistory.filter(id => id.startsWith('weak_') || id.startsWith('strong_')).slice(-2);
      const encounter = sampleAct1Encounter(pool, () => random(next), node.type === 'battle' ? recentNormal : []);
      beginCombat(next, encounter, node.type, true);
    } else {
      next.phase = 'event'; const eventId = node.type === 'rest' ? 'rest' : node.type === 'treasure' ? 'treasure' : node.type === 'shop' ? 'shop' : node.eventId ?? 'gold';
      if (eventId === 'shop') makeShop(next); next.event = { id: eventId }; refreshEvent(next); next.notice = next.event.description; next.lastEvent = { kind: 'event-open', eventId }; log(next, `来到${node.label}。`);
    }
    syncEnemy(next); return next;
  }
  if (['play', 'borrow', 'repay', 'endTurn'].includes(action.type) && state.phase !== 'combat') return invalid(state, '此刻不在战斗中。');
  if (action.type === 'play') {
    const card = state.hand.find(candidate => candidate.uid === action.uid);
    if (!card) return invalid(state, '这张符箓已不在手中。');
    const view = getAct1CardView(state, card);
    if (!view?.playable) return invalid(state, view?.reason ?? '这张牌无法打出。');
    const enemies = getAct1Enemies(state);
    const target = view.target === 'enemy' ? action.targetUid ? enemies.find(enemy => enemy.uid === action.targetUid) : enemies.length === 1 ? enemies[0] : null : null;
    if (view.target === 'enemy' && !target) return invalid(state, action.targetUid ? '目标已离场或不在这场战斗中。' : '请选择一名存活敌人作为目标。');
    const next = clone(state); play(next, next.hand.find(item => item.uid === card.uid), target ? next.enemies.find(enemy => enemy.uid === target.uid) : null); syncEnemy(next); return next;
  }
  if (action.type === 'borrow') {
    if (state.borrowedThisTurn >= 2) return invalid(state, '本回合已借火两次，阴司不肯再赊。');
    const next = clone(state); next.energy += 1; next.borrowedThisTurn += 1; const debt = addDebt(next, 2);
    next.notice = `借得1香火，欠2阴债，第${debt.dueTurn}巡更开始到期；每点未偿阴债索命2点。`; next.lastEvent = { kind: 'borrow', amount: 2, dueTurn: debt.dueTurn }; log(next, next.notice); return next;
  }
  if (action.type === 'repay') {
    if (!totalDebt(state)) return invalid(state, '阴债已清，无需还愿。'); if (state.energy < 1) return invalid(state, '还愿需要1香火。');
    const next = clone(state); const oldBlock = next.block; next.energy -= 1; const amount = repay(next, 2); next.notice = `还愿：偿还最早到期的 ${amount} 点阴债。`; next.lastEvent = { kind: 'repay', amount, block: next.block - oldBlock }; log(next, next.notice); return next;
  }
  if (action.type === 'endTurn') { const next = clone(state); endTurn(next); syncEnemy(next); return next; }
  if (action.type === 'reward') {
    if (state.phase !== 'reward' || (action.cardId !== null && !state.rewards.includes(action.cardId))) return invalid(state, '请从眼前的符箓中选择，或跳过。');
    const next = clone(state); if (action.cardId) addPermanentCard(next, action.cardId); finishNode(next); next.lastEvent = { kind: 'reward', cardId: action.cardId }; return next;
  }
  if (action.type === 'event') {
    if (state.phase !== 'event') return invalid(state, '此刻没有可回应的际遇。');
    const next = clone(state); if (!eventAction(next, action)) return invalid(state, '现在无法选择这条路。'); syncEnemy(next); return next;
  }
  if (action.type === 'usePotion' || action.type === 'discardPotion') {
    const potion = state.potions.find(item => item.uid === action.potionId) ?? state.potions.find(item => item.id === action.potionId);
    if (!potion) return invalid(state, '这瓶药已不在行囊中。');
    const definition = POTION_DEFS[potion.id];
    const enemies = getAct1Enemies(state); const target = definition.target === 'enemy' ? action.targetUid ? enemies.find(enemy => enemy.uid === action.targetUid) : enemies.length === 1 ? enemies[0] : null : null;
    if (action.type === 'usePotion' && definition.target === 'enemy' && (state.phase !== 'combat' || !target)) return invalid(state, '请在战斗中选择一名存活敌人。');
    if (action.type === 'usePotion' && potion.id !== 'healing' && state.phase !== 'combat') return invalid(state, '这瓶药只能在战斗中使用。');
    const next = clone(state); next.potions = next.potions.filter(item => item.uid !== potion.uid);
    if (action.type === 'discardPotion') { next.notice = '已放下这瓶药。'; return next; }
    if (potion.id === 'healing') heal(next, 20);
    else if (potion.id === 'block') next.block += 12;
    else if (potion.id === 'fire') hurtEnemy(next, next.enemies.find(enemy => enemy.uid === target.uid), 20, false);
    else debuffEnemy(next, next.enemies.find(enemy => enemy.uid === target.uid), 'weak', 3);
    next.notice = `使用${definition.name}。`; next.lastEvent = { kind: 'potion', potionId: potion.id, targetUid: target?.uid ?? null }; log(next, next.notice); if (next.phase === 'combat') winCombat(next); syncEnemy(next); return next;
  }
  return invalid(state, '这一步没有生效。');
}

export function isValidAct1Save(state) {
  const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
  const signed = value => Number.isSafeInteger(value) && Math.abs(value) <= 100000;
  if (!state || state.version !== ACT1_VERSION || state.ruleset !== 'act1' || state.modeId !== 'classic' || !PHASES.includes(state.phase)) return false;
  if (state.shop !== undefined && state.shop !== null && (typeof state.shop !== 'object' || Array.isArray(state.shop))) return false;
  if (typeof state.runId !== 'string' || !state.runId.trim() || !integer(state.seed) || state.seed > 0xffffffff || !integer(state.rngState, 1) || state.rngState > 0xffffffff) return false;
  if (!['hp', 'block', 'energy', 'gold', 'normalBattles', 'nodeIndex', 'combatKillsStart', 'borrowedThisTurn', 'repaidThisTurn', 'artifact', ...STATUS_KEYS].every(key => integer(state[key])) || state.borrowedThisTurn > 2) return false;
  if (!['maxHp', 'maxEnergy', 'turn', 'combatTurn', 'nextUid', 'nextDebtId', 'nextEnemyUid', 'nextPotionUid', 'removePrice'].every(key => integer(state[key], 1)) || state.hp > state.maxHp || !signed(state.strength) || !signed(state.dexterity)) return false;
  if (!Array.isArray(state.deck) || !state.deck.length || !state.deck.every(id => CARD_DEFS[id] && CARD_DEFS[id].type !== 'status') || !Array.isArray(state.deckCards) || state.deckCards.length !== state.deck.length) return false;
  const permanent = new Map();
  for (const [i, card] of state.deckCards.entries()) { if (!card || typeof card.uid !== 'string' || !card.uid || permanent.has(card.uid) || card.cardId !== state.deck[i] || typeof card.upgraded !== 'boolean' || card.temporary) return false; permanent.set(card.uid, card); }
  if (!state.upgrades || typeof state.upgrades !== 'object' || Array.isArray(state.upgrades) || !Object.entries(state.upgrades).every(([uid, level]) => level === 1 && permanent.get(uid)?.upgraded) || state.deckCards.some(card => card.upgraded && state.upgrades[card.uid] !== 1)) return false;
  const seen = new Set();
  for (const zone of ['hand', 'drawPile', 'discard', 'exhaust']) {
    if (!Array.isArray(state[zone])) return false;
    for (const card of state[zone]) { if (!card || typeof card.uid !== 'string' || !card.uid || seen.has(card.uid) || !CARD_DEFS[card.cardId] || typeof card.upgraded !== 'boolean') return false; seen.add(card.uid); if (card.temporary) { if (CARD_DEFS[card.cardId].type !== 'status' || permanent.has(card.uid)) return false; } else if (!permanent.has(card.uid) || permanent.get(card.uid).cardId !== card.cardId || permanent.get(card.uid).upgraded !== card.upgraded) return false; }
  }
  if (state.hand.length > 10 || !Array.isArray(state.debts) || new Set(state.debts.map(debt => debt?.id)).size !== state.debts.length || !state.debts.every(debt => debt && typeof debt.id === 'string' && integer(debt.amount, 1) && integer(debt.dueTurn, 1))) return false;
  if (!Array.isArray(state.enemies) || state.enemies.length > 10 || new Set(state.enemies.map(enemy => enemy?.uid)).size !== state.enemies.length || getAct1Enemies(state).length > 5) return false;
  for (const enemy of state.enemies) {
    if (!enemy || !ACT1_ENEMY_DEFS[enemy.id] || typeof enemy.uid !== 'string' || !enemy.uid || !ENEMY_NUMBERS.every(key => integer(enemy[key])) || enemy.maxHp < 1 || enemy.hp > enemy.maxHp || typeof enemy.dead !== 'boolean' || typeof enemy.escaped !== 'boolean') return false;
    if (!enemy.intent || !MOVE_NAMES[enemy.intent.move] || !enemy.ai || !Array.isArray(enemy.ai.history) || enemy.ai.history.length > 3 || !enemy.ai.history.every(move => MOVE_NAMES[move])) return false;
    for (const key of ['damage', 'hits', 'block', 'strength', 'weak', 'exposed', 'frail', 'entangled', 'count', 'steal']) if (enemy.intent[key] !== undefined && !integer(enemy.intent[key], key === 'hits' ? 1 : 0)) return false;
    if (!['position', 'biteDamage', 'awakeStep', 'shiftThreshold', 'shiftRemaining', 'offenseStep', 'defenseStep'].every(key => integer(enemy.ai[key])) || enemy.ai.offenseStep > 3 || enemy.ai.defenseStep > 2 || !['offense', 'defense'].includes(enemy.ai.phase)) return false;
    if (!['awake', 'stunned', 'entangled', 'infernoUsed'].every(key => typeof enemy.ai[key] === 'boolean') || (enemy.intent.status && CARD_DEFS[enemy.intent.status]?.type !== 'status')) return false;
  }
  if (!state.stats || !['damageDealt', 'damageTaken', 'borrowed', 'repaid', 'defaults', 'debtDamage', 'cardsPlayed', 'battlesWon', 'battlesStarted', 'kills', 'enemiesKilled', 'enemiesEscaped', 'goldStolen', 'goldRecovered'].every(key => integer(state.stats[key])) || state.stats.kills !== state.stats.enemiesKilled || state.stats.battlesWon > state.stats.battlesStarted) return false;
  if (!Array.isArray(state.log) || state.log.length > 8 || !state.log.every(text => typeof text === 'string') || typeof state.notice !== 'string' || typeof state.lastEvent?.kind !== 'string') return false;
  if (!['lamp', 'bell'].includes(state.relicId) || ![0, 1].includes(state.difficulty) || !Array.isArray(state.relics) || new Set(state.relics).size !== state.relics.length || !state.relics.every(id => RELIC_DEFS[id]) || !state.relics.includes(state.relicId)) return false;
  if (!Array.isArray(state.potions) || state.potions.length > 3 || new Set(state.potions.map(potion => potion?.uid)).size !== state.potions.length || !state.potions.every(potion => potion && typeof potion.uid === 'string' && POTION_DEFS[potion.id])) return false;
  if (!Array.isArray(state.rewardPool) || state.rewardPool.length < 3 || new Set(state.rewardPool).size !== state.rewardPool.length || !state.rewardPool.every(id => CARD_DEFS[id] && CARD_DEFS[id].type !== 'status') || !Array.isArray(state.rewards) || !state.rewards.every(id => state.rewardPool.includes(id))) return false;
  if (!Array.isArray(state.encounterHistory) || state.encounterHistory.length > 8 || !state.encounterHistory.every(id => typeof id === 'string') || !isValidAct1Route(state.route)) return false;
  const route = state.route; const current = route.nodes.find(node => node.id === route.currentId); const completed = route.completedIds.includes(route.currentId);
  if (state.nodeIndex !== (current?.stageIndex ?? current?.row ?? 0)) return false;
  if (state.phase === 'defeat') return state.hp === 0 && current && !completed;
  if (!state.hp) return false;
  if (state.phase === 'map') return route.path.length === route.completedIds.length && state.event === null && !state.rewards.length;
  if (!current) return false;
  if (state.phase === 'victory') return completed && current.type === 'boss' && state.encounterKind === 'boss' && state.encounterId === current.encounterId && getAct1Enemies(state).length === 0 && totalDebt(state) === 0;
  if (completed) return false;
  if (state.phase === 'combat' || state.phase === 'reward') {
    const kind = current.type === 'event' && current.eventId === 'mushrooms' ? 'battle' : current.type;
    if (!['battle', 'elite', 'boss'].includes(kind) || state.encounterKind !== kind) return false;
    if (current.type === 'event' && state.encounterId !== 'event_mushrooms') return false;
    if (current.encounterId && state.encounterId !== current.encounterId) return false;
    if (current.type === 'battle' && (typeof state.encounterId !== 'string' || !/^(weak_|strong_)/.test(state.encounterId))) return false;
    if (state.phase === 'combat') return getAct1Enemies(state).length > 0 && state.event === null && !state.rewards.length;
    return kind !== 'boss' && getAct1Enemies(state).length === 0 && state.rewards.length === 3 && new Set(state.rewards).size === 3 && state.event === null;
  }
  if (!state.event || !['rest', 'upgrade', 'remove', 'shop', 'treasure', 'mushrooms', 'shrine', 'market', 'gold'].includes(state.event.id)) return false;
  const baseEvent = state.event.id === 'upgrade' ? 'rest' : state.event.id === 'remove' ? 'shop' : state.event.id;
  if (baseEvent !== (current.type === 'event' ? current.eventId : current.type)) return false;
  if (['shop', 'remove'].includes(state.event.id) && (!state.shop || (state.shop.removalUsed !== undefined && typeof state.shop.removalUsed !== 'boolean') || (state.event.id === 'remove' && state.shop.removalUsed) || !Array.isArray(state.shop.offers) || new Set(state.shop.offers.map(offer => offer?.id)).size !== state.shop.offers.length || !state.shop.offers.every(offer => offer && typeof offer.id === 'string' && integer(offer.price, 1) && typeof offer.sold === 'boolean' && (offer.kind === 'card' ? CARD_DEFS[offer.cardId] && CARD_DEFS[offer.cardId].type !== 'status' : offer.kind === 'potion' && POTION_DEFS[offer.potionId])))) return false;
  return Boolean(getAct1EventView(state));
}

export function migrateAct1Run(saved) {
  if (!isValidAct1Save(saved)) return null;
  const state = clone(saved);
  // Older v3 shops did not record their per-visit service use. Preserve the
  // active shop and allow one service from this migration point onward.
  if (state.shop && state.shop.removalUsed === undefined) state.shop.removalUsed = false;
  return state;
}

// Encounter fixtures and content checks share the actual AI, rather than a
// second table of expected-looking placeholder intentions.
export { planIntent as planAct1EnemyIntent };
