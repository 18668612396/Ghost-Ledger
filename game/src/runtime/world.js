import { evaluate, numeric } from './expressions.js';

const alive = enemy => enemy && enemy.hp > 0 && !enemy.escaped;
const clone = value => structuredClone(value);
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value);
const expression = value => value && typeof value === 'object' && !Array.isArray(value) && ['stat', 'op', 'count', 'debt', 'random'].some(key => Object.hasOwn(value, key));

function roll(random) {
  const value = random();
  if (!Number.isFinite(value)) throw new RangeError('随机源必须返回有限数。');
  return Math.min(1 - Number.EPSILON, Math.max(0, value));
}
function pick(items, random) {
  if (!items.length) throw new RangeError('不能从空的候选表中选择。');
  return items[Math.floor(roll(random) * items.length)];
}
function weighted(items, random) {
  if (!items.length) throw new RangeError('没有可选的加权条目。');
  const total = items.reduce((sum, item) => sum + (item.weight ?? 1), 0);
  if (!(total > 0)) throw new RangeError('候选权重总和必须大于零。');
  let threshold = roll(random) * total;
  for (const item of items) { threshold -= item.weight ?? 1; if (threshold < 0) return item; }
  return items.at(-1);
}
function shuffle(items, random) {
  const output = [...items];
  for (let i = output.length - 1; i > 0; i--) { const j = Math.floor(roll(random) * (i + 1)); [output[i], output[j]] = [output[j], output[i]]; }
  return output;
}
function seeded(seed) {
  let value = (Number(seed) >>> 0) ^ 0x7f4a7c15;
  value ^= value >>> 16; value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13; value = Math.imul(value, 0xc2b2ae35);
  value = (value ^ (value >>> 16)) >>> 0;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}
function envFor(state, enemy, content, random, preview = false) {
  return { state, player: state, source: enemy, target: state, content, context: {}, event: {}, card: {}, random, preview };
}
function resolveInitial(value, env) {
  if (expression(value)) return evaluate(value, env);
  if (Array.isArray(value)) return value.map(item => resolveInitial(item, env));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveInitial(item, env)]));
  return value;
}

/** Encounters compose fixed groups, one variant, independent slots, or a finite bag. */
export function sampleConfiguredEncounter(poolId, random = Math.random, content, excludeIds = []) {
  const all = Object.values(content?.encounters || {});
  const pool = all.filter(item => item.pools?.includes(poolId));
  const source = pool.length ? pool : [content?.encounters?.[poolId]].filter(Boolean);
  if (!source.length) throw new RangeError(`未知或空的遭遇池：${poolId}`);
  const filtered = source.filter(item => !excludeIds.includes(item.id));
  const selected = weighted(filtered.length ? filtered : source, random);
  const composition = selected.composition || { fixed: selected.enemies || [] };
  let enemies = [];
  if (composition.fixed) enemies.push(...composition.fixed);
  if (composition.variants) {
    const variants = composition.variants.map(item => Array.isArray(item) ? { enemies: item, weight: 1 } : item);
    enemies.push(...weighted(variants, random).enemies);
  }
  for (const slot of composition.slots || []) {
    const options = slot.options.map(item => typeof item === 'string' ? { id: item, weight: 1 } : item);
    for (let count = 0; count < (slot.count ?? 1); count++) enemies.push(weighted(options, random).id);
  }
  if (composition.bag) {
    const bag = [...composition.bag];
    if ((composition.count ?? 1) > bag.length) throw new RangeError(`遭遇 ${selected.id} 的袋子不足以抽取所需数量。`);
    for (let count = 0; count < (composition.count ?? 1); count++) enemies.push(bag.splice(Math.floor(roll(random) * bag.length), 1)[0]);
  }
  if (enemies.length < 1 || enemies.length > 5 || enemies.some(id => !content?.enemies?.[id])) throw new Error(`遭遇 ${selected.id} 包含无效的敌人组合。`);
  return { id: selected.id, label: selected.label, enemies, ...(selected.reward ? { reward: clone(selected.reward) } : {}) };
}

export function createConfiguredEnemy(id, state, position = 0, content, random = Math.random, hpOverride = null) {
  const definition = content?.enemies?.[id];
  if (!definition) throw new Error(`未配置的敌人：${id}`);
  const range = definition.hpRange || [definition.maxHp, definition.maxHp];
  const difficulty = content?.acts?.[state.actId]?.difficultyModifiers?.find(item => item.id === (state.difficulty || 0));
  const hp = hpOverride ?? Math.ceil((range[0] + Math.floor(roll(random) * (range[1] - range[0] + 1))) * (difficulty?.hpMultiplier ?? 1));
  if (!Number.isFinite(hp) || hp <= 0) throw new RangeError(`敌人 ${id} 的生命不合法。`);
  state.nextEnemyUid = state.nextEnemyUid || 1;
  const enemy = { id, uid: `c-enemy-${state.nextEnemyUid++}`, hp, maxHp: hp, block: 0, strength: 0, dexterity: 0, weak: 0, exposed: 0, frail: 0, artifact: 0, burn: 0, curlUp: 0, angry: 0, enrage: 0, ritual: 0, sharpHide: 0, stolen: 0, turns: 0, intentIndex: 0, dead: false, escaped: false, powers: {}, triggerCounts: {}, ai: { history: [], position }, intent: null };
  const initial = resolveInitial(definition.initial || {}, envFor(state, enemy, content, random));
  const initialAi = initial.ai || {};
  Object.assign(enemy, initial);
  enemy.ai = { history: [], ...initialAi, position };
  // An inherited split HP is the new maximum too; initial data cannot override it.
  enemy.hp = hp; enemy.maxHp = hp; enemy.attackBonus = difficulty?.attackBonus ?? 0;
  return enemy;
}

function snapshotEffects(effects, env, targetUid) {
  return effects.map(effect => {
    const result = clone(effect);
    if (effect.op === 'if') {
      result.then = snapshotEffects(effect.then || [], env, targetUid);
      if (effect.else) result.else = snapshotEffects(effect.else, env, targetUid);
    }
    for (const key of ['amount', 'hits', 'strengthScale', 'upgradeLevel']) if (Object.hasOwn(effect, key)) result[key] = numeric(effect[key], env);
    if (effect.target === 'ally') result.targetUid = targetUid;
    return result;
  });
}

/** Also used by generic changeIntent effects, without advancing the monster's turn. */
export function getConfiguredMoveIntent(state, enemy, moveId, content, random = Math.random) {
  const definition = content?.enemies?.[enemy.id];
  const move = definition?.moves?.[moveId];
  if (!move) throw new Error(`敌人 ${enemy.id} 未配置行动 ${moveId}。`);
  const env = envFor(state, enemy, content, random);
  const allies = (state.enemies || []).filter(candidate => alive(candidate) && candidate.uid !== enemy.uid);
  const allyRequired = JSON.stringify(move.effects || []).includes('"ally"');
  const targetUid = allyRequired ? (allies.length ? pick(allies, random).uid : enemy.uid) : null;
  const effects = snapshotEffects([...(move.effects || []), ...(move.after || [])], env, targetUid);
  return { move: moveId, label: move.label || moveId, effects, ...(targetUid ? { targetUid } : {}), ...(move.description ? { description: move.description } : {}) };
}

/** Rules are ordered; the first eligible rule picks a move, weighted set or sequence. */
export function planConfiguredIntent(state, enemy, content, random = Math.random) {
  const definition = content?.enemies?.[enemy.id];
  if (!definition) throw new Error(`未配置的敌人：${enemy.id}`);
  enemy.ai ||= { history: [] };
  enemy.ai.history ||= [];
  enemy.ai.allyCount = (state.enemies || []).filter(candidate => alive(candidate) && candidate.uid !== enemy.uid).length;
  enemy.ai.lastMove = enemy.ai.history.at(-1) || '';
  const env = envFor(state, enemy, content, random);
  for (const rule of definition.ai?.rules || []) {
    if (rule.when !== undefined && !evaluate(rule.when, env)) continue;
    let moveId = rule.move;
    if (rule.sequence) {
      const moves = rule.sequence.moves;
      const raw = Math.max(0, Math.floor(numeric(rule.sequence.index ?? { stat: 'source.turns' }, env)));
      moveId = moves[rule.sequence.loop === false ? Math.min(raw, moves.length - 1) : raw % moves.length];
    }
    if (rule.weighted) {
      const choices = rule.weighted.filter(item => {
        if (item.when !== undefined && !evaluate(item.when, env)) return false;
        let repeats = 0;
        for (let i = enemy.ai.history.length - 1; i >= 0 && enemy.ai.history[i] === item.move; i--) repeats++;
        return repeats < (item.maxRepeat ?? Infinity);
      });
      if (!choices.length) continue;
      moveId = weighted(choices, random).move;
    }
    if (moveId) return getConfiguredMoveIntent(state, enemy, moveId, content, random);
  }
  throw new Error(`敌人 ${enemy.id} 在当前状态没有可用行动。`);
}

function previewEffects(effects, env) {
  return effects.flatMap(effect => effect.op === 'if' ? previewEffects(evaluate(effect.condition, env) ? effect.then || [] : effect.else || [], env) : [effect]);
}

function intentEffectTarget(state, enemy, effect) {
  if (effect.target === 'player') return state;
  if (effect.target === 'ally') {
    const allies = (state.enemies || []).filter(candidate => alive(candidate) && !candidate.dead);
    if (effect.targetUid) return allies.find(candidate => candidate.uid === effect.targetUid) || enemy;
    return allies.find(candidate => candidate.uid === enemy.intent.targetUid && candidate.uid !== enemy.uid) || allies.find(candidate => candidate.uid !== enemy.uid) || enemy;
  }
  return enemy;
}

function intentBlockAmount(effect, target, env) {
  return Math.max(0, Math.floor((numeric(effect.amount, env) + (effect.modified === false ? 0 : target.dexterity || 0)) * (effect.modified !== false && target.frail > 0 ? .75 : 1)));
}

/** The preview uses the exact announced effect list and never rolls randomness. */
export function getConfiguredIntentView(state, enemy, content) {
  if (!enemy || !alive(enemy) || !enemy.intent) return { kind: 'none', label: '静候', amount: 0, hits: 1, total: 0, actions: [{ kind: 'prepare', text: '本轮不攻击' }], detail: '没有尚在战场上的敌人。' };
  const env = envFor(state, enemy, content, null, true);
  const effects = previewEffects(enemy.intent.effects || [], env);
  const attacks = effects.filter(effect => effect.op === 'damage' && effect.target === 'player');
  const strikes = attacks.map(effect => {
    const base = numeric(effect.amount, env);
    const amount = effect.attack === false ? Math.max(0, Math.floor(base)) : Math.max(0, Math.floor(Math.max(0, base + (enemy.attackBonus || 0) + enemy.strength * (effect.strengthScale ?? 1)) * (enemy.weak > 0 ? .75 : 1) * (state.exposed > 0 ? 1.5 : 1)));
    return { amount, hits: Math.max(0, Math.floor(numeric(effect.hits ?? 1, env))) };
  });
  const total = strikes.reduce((sum, hit) => sum + hit.amount * hit.hits, 0);
  const actions = strikes.map(item => ({ kind: 'attack', text: `攻击 ${item.amount}${item.hits > 1 ? `×${item.hits}` : ''}` }));
  const pieces = strikes.map(item => `造成 ${item.amount}${item.hits > 1 ? `×${item.hits}` : ''} 点伤害`);
  if (strikes.length > 1 || strikes.some(item => item.hits > 1)) {
    actions.push({ kind: 'attack', text: `合计 ${total}伤害` });
    pieces.push(`合计 ${total} 点伤害`);
  }
  const names = { weak: '虚弱', exposed: '易伤', frail: '脆弱', entangled: '缠绕', strength: '力量', dexterity: '敏捷', artifact: '御符', ritual: '仪式', enrage: '激怒', sharpHide: '荆甲', burn: '业火', curlUp: '蜷缩', angry: '愤怒', noDraw: '无法抽牌' };
  const timedStatuses = ['weak', 'exposed', 'frail', 'entangled', 'noDraw'];
  const zones = { hand: '手牌', drawPile: '抽牌堆', discard: '弃牌堆', exhaust: '消耗堆', powerZone: '能力区', limbo: '结算区' };
  const shortZones = { ...zones, drawPile: '抽牌', discard: '弃牌', exhaust: '消耗' };
  const add = (kind, text, detail = text) => { actions.push({ kind, text }); pieces.push(detail); };
  const targetName = target => target === state ? '你' : target === enemy ? '自身' : content.enemies?.[target.id]?.name || '同伴';
  for (const [index, effect] of effects.entries()) {
    const target = intentEffectTarget(state, enemy, effect);
    const subject = targetName(target);
    if (effect.op === 'block') {
      const amount = intentBlockAmount(effect, target, env);
      add('defend', `${target === state ? '你' : ''}护甲 +${amount}`, `${subject}获得 ${amount} 点护甲`);
      if (target !== state && target !== enemy) actions.push({ kind: 'defend', text: `给予 ${subject}` });
    }
    if (effect.op === 'status') {
      const amount = numeric(effect.amount, env), name = names[effect.key] || effect.key;
      const timed = timedStatuses.includes(effect.key);
      const debuff = amount > 0 && [...timedStatuses, 'burn'].includes(effect.key) || amount < 0 && ['strength', 'dexterity'].includes(effect.key);
      const text = timed ? `${subject}${name} ${amount}回合` : amount < 0 ? `${subject}失去 ${Math.abs(amount)}${name}` : `${target === enemy ? '' : subject}${name} +${amount}`;
      const detail = effect.key === 'entangled' && amount > 0 ? `${text}，期间无法打出攻击牌` : text;
      add(debuff ? 'debuff' : 'buff', text, detail);
      if (effect.key === 'ritual' && amount > 0) add('buff', `行动后力量 +${(target.ritual || 0) + amount}`, `${subject}此后每次行动结束时，获得 ${(target.ritual || 0) + amount} 点力量`);
      if (effect.key === 'enrage' && amount > 0) add('buff', `术法触发力量 +${(target.enrage || 0) + amount}`, `你每打出一张术法牌，${subject}获得 ${(target.enrage || 0) + amount} 点力量`);
    }
    if (effect.op === 'addCard') {
      const amount = numeric(effect.amount ?? 1, env), name = content.cards?.[effect.cardId]?.name || '状态牌', zone = zones[effect.zone] || effect.zone || '弃牌堆';
      add('debuff', `${shortZones[effect.zone] || zone} +${amount} ${name}`, `向${zone}加入 ${amount} 张${name}`);
    }
    if (effect.op === 'steal') add('debuff', `盗走 ≤${numeric(effect.amount, env)}冥钱`, `盗走最多 ${numeric(effect.amount, env)} 冥钱，盗款不受护甲抵挡`);
    if (effect.op === 'summon') {
      const verb = effect.replaceSource ? '分裂' : '召唤';
      const children = effect.ids.map(id => content.enemies?.[id]?.name || '子体');
      const same = children.every(name => name === children[0]);
      const text = `${verb} ${children.length}只`;
      add('split', text, `${verb}${effect.replaceSource ? '为' : ''} ${children.length} 只${same ? children[0] : `子体（${children.join('、')}）`}${effect.inheritHp ? `，各继承行动时的剩余生命（当前 ${enemy.hp}）` : ''}`);
      for (const name of new Set(children)) actions.push({ kind: 'split', text: `子体 ${name}×${children.filter(child => child === name).length}` });
      if (effect.inheritHp) actions.push({ kind: 'split', text: '继承剩余生命' });
    }
    if (effect.op === 'escape') {
      add('escape', '逃离战场', enemy.stolen > 0 ? `带走已盗的 ${enemy.stolen} 冥钱并逃离` : '逃离战场');
      if (enemy.stolen > 0) actions.push({ kind: 'escape', text: `带走 ${enemy.stolen}冥钱` });
    }
    if (effect.op === 'set' && ['block', 'sharpHide'].includes(effect.path)) {
      // Only the final assignment is visible when a move sets a value twice.
      if (effects.slice(index + 1).some(later => later.op === 'set' && later.path === effect.path && intentEffectTarget(state, enemy, later) === target)) continue;
      const amount = numeric(effect.value, env);
      if (effect.path === 'block') {
        add('defend', amount > 0 ? `${target === state ? '你' : ''}护甲变为 ${amount}` : `清除${target === state ? '你' : ''}护甲`, amount > 0 ? `${subject}护甲变为 ${amount}` : `清除${subject}护甲`);
        if (target !== state && target !== enemy) actions.push({ kind: 'defend', text: `给予 ${subject}` });
      } else add('buff', amount > 0 ? `攻击牌反伤 ${amount}` : '移除荆甲反伤', amount > 0 ? `${subject}获得 ${amount} 荆甲：你每打出一张攻击牌，受到 ${amount} 点可被护甲抵挡的反伤` : `${subject}移除荆甲反伤`);
    }
    if (effect.op === 'transformCards') {
      const from = content.cards?.[effect.from]?.name || effect.from, to = content.cards?.[effect.to]?.name || effect.to;
      const affectedZones = (effect.zones || Object.keys(zones)).map(zone => zones[zone] || zone).join('、');
      add('debuff', `全部${from}→${to}`, `将${affectedZones}中的所有${from}替换为${to}`);
    }
  }
  if (!actions.length) actions.push({ kind: 'prepare', text: '本轮不攻击' });
  if (enemy.intent.description) pieces.push(enemy.intent.description);
  const first = strikes[0];
  const block = effects.find(effect => effect.op === 'block');
  const kind = strikes.length ? 'attack' : actions.some(action => action.kind === 'defend') ? 'defend' : actions.some(action => action.kind === 'split') ? 'split' : actions.some(action => action.kind === 'escape') ? 'escape' : actions.some(action => action.kind === 'debuff') ? 'debuff' : actions[0].kind;
  const primary = actions.findIndex(action => action.kind === kind);
  if (primary > 0) actions.unshift(...actions.splice(primary, 1));
  let detail = pieces.join('；') || '本轮不攻击。';
  if (strikes.length) detail += `${/[。！？]$/.test(detail) ? '' : '。'}伤害按当前状态计算，未扣除你的护甲。`;
  return { move: enemy.intent.move, kind, label: enemy.intent.label, amount: first?.amount ?? (block ? intentBlockAmount(block, intentEffectTarget(state, enemy, block), env) : 0), hits: first?.hits ?? 1, total, actions, detail, targetUid: enemy.intent.targetUid };
}

const DEFAULT_LABELS = {
  battle: ['阴路交锋', '普通交锋，前三场来自弱遭遇池，之后进入强遭遇池。'],
  elite: ['鬼将镇路', '精英交锋，胜利获得遗物与更多冥钱。'],
  boss: ['终审', '击败本幕首领，完成夜巡。'],
  rest: ['纸灯歇脚处', '恢复生命或升级一道符箓，歇脚不推进债期。'],
  shop: ['忘川鬼市', '购买符箓与药水，或移除一张永久牌。'],
  treasure: ['封魂宝箱', '开启魂匣，获得一件本局遗物。'],
  event: ['阴路奇遇', '选择收获与代价。'],
};

function routeNode(type, row, column, act, boss, content, random) {
  const text = act.nodeLabels?.[type] || DEFAULT_LABELS[type];
  const node = { id: `${act.id}-f${row + 1}-c${column}`, row, column, floor: row + 1, stageIndex: row, type, label: text[0], description: text[1], next: [] };
  if (type === 'battle') node.encounterPool = 'normal';
  if (type === 'elite' || type === 'boss') {
    const encounter = type === 'boss' ? boss : sampleConfiguredEncounter(act.encounterPools.elite, random, content);
    Object.assign(node, { encounterId: encounter.id, enemyId: encounter.enemies[0], label: encounter.label });
    node.description = `${type === 'elite' ? '精英' : '首领'}：${content.enemies[encounter.enemies[0]].description}`;
  }
  if (type === 'event') {
    const id = pick(act.eventPool, random);
    const event = content.events[id];
    Object.assign(node, { eventId: id, label: event.title, description: event.description });
  }
  if (['rest', 'shop', 'treasure'].includes(type)) node.eventId = type;
  return node;
}

/** Route topology, row sizes and node types all consume the seed stream. */
export function createConfiguredRoute(actId, seed = 0, content) {
  const act = content?.acts?.[actId];
  if (!act) throw new Error(`未配置的幕：${actId}`);
  const map = act.map;
  const normalized = Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0;
  const random = seeded(normalized);
  const boss = sampleConfiguredEncounter(act.encounterPools.boss, random, content);
  const rows = [];
  const constraints = map.constraints || {};
  const noConsecutive = constraints.noConsecutive || [];
  const compatible = (first, second) => first.type !== second.type || !noConsecutive.includes(first.type);
  for (let row = 0; row < map.floors; row++) {
    const floor = row + 1;
    const fixed = map.fixedFloors?.[floor];
    const count = fixed?.count ?? map.nodeCount[0] + Math.floor(roll(random) * (map.nodeCount[1] - map.nodeCount[0] + 1));
    const columns = count === 1 ? [Math.floor(map.columns / 2)] : shuffle(Array.from({ length: map.columns }, (_, column) => column), random).slice(0, count).sort((a, b) => a - b);
    const previous = rows.at(-1) || [];
    const nextFixed = map.fixedFloors?.[floor + 1];
    const types = fixed ? columns.map(() => fixed.type) : columns.map(() => {
      const choices = Object.entries(map.typeWeights).filter(([type, weight]) => weight > 0 && floor >= (constraints.minFloor?.[type] ?? 1) && floor <= (constraints.maxFloor?.[type] ?? map.floors) && (!noConsecutive.includes(type) || (!previous.length || previous.some(node => node.type !== type)) && nextFixed?.type !== type)).map(([type, weight]) => ({ type, weight }));
      return weighted(choices, random).type;
    });
    // A battle lane guarantees a compatible exit even if all other lanes are rest/shop.
    const battleAllowed = map.typeWeights.battle > 0 && floor >= (constraints.minFloor?.battle ?? 1) && floor <= (constraints.maxFloor?.battle ?? map.floors) && (!noConsecutive.includes('battle') || (!previous.length || previous.some(node => node.type !== 'battle')) && nextFixed?.type !== 'battle');
    if (!fixed && types.length > 1 && !types.includes('battle') && battleAllowed) types[Math.floor(roll(random) * types.length)] = 'battle';
    rows.push(columns.map((column, index) => routeNode(types[index], row, column, act, boss, content, random)));
  }
  for (let row = 0; row < rows.length - 1; row++) {
    const current = rows[row], next = rows[row + 1];
    for (const node of current) {
      const allowed = next.filter(candidate => compatible(node, candidate));
      if (!allowed.length) throw new Error(`幕 ${actId} 的第 ${row + 1} 层被节点限制堵死。`);
      const local = allowed.filter(candidate => Math.abs(candidate.column - node.column) <= 1);
      const candidates = local.length ? local : allowed;
      const first = pick(candidates, random);
      node.next = [first.id];
      if ((map.maxLinks ?? 2) > 1 && roll(random) < (map.branchChance ?? .45)) {
        const extra = candidates.filter(candidate => candidate.id !== first.id);
        if (extra.length) node.next.push(pick(extra, random).id);
      }
    }
    for (const destination of next) {
      if (current.some(node => node.next.includes(destination.id))) continue;
      const candidates = current.filter(node => compatible(node, destination));
      if (!candidates.length) throw new Error(`幕 ${actId} 的第 ${row + 2} 层存在不可达节点。`);
      const ranked = shuffle(candidates, random).sort((a, b) => a.next.length - b.next.length || Math.abs(a.column - destination.column) - Math.abs(b.column - destination.column));
      ranked[0].next.push(destination.id);
    }
  }
  return { version: 3, ruleset: 'config-v1', act: act.number ?? 1, actId, seed: normalized, floorCount: map.floors, columnCount: map.columns, bossId: boss.id, nodes: rows.flat(), completedIds: [], currentId: null, path: [] };
}

/** Validate actual saved topology, not regeneration against today's edited table. */
export function isValidConfiguredRoute(route, content) {
  if (!route || route.version !== 3 || route.ruleset !== 'config-v1' || !validId(route.actId) || !Number.isInteger(route.seed) || route.seed < 0 || route.seed > 0xffffffff) return false;
  const act = content?.acts?.[route.actId];
  if (!act || route.floorCount !== act.map.floors || route.columnCount !== act.map.columns || !content.encounters?.[route.bossId]) return false;
  if (!Array.isArray(route.nodes) || !Array.isArray(route.path) || !Array.isArray(route.completedIds) || route.nodes.length > route.floorCount * route.columnCount) return false;
  const nodes = new Map();
  const rows = Array.from({ length: route.floorCount }, () => []);
  for (const node of route.nodes) {
    if (!node || !validId(node.id) || nodes.has(node.id) || !Number.isInteger(node.row) || node.row < 0 || node.row >= rows.length || !Number.isInteger(node.column) || node.column < 0 || node.column >= route.columnCount) return false;
    if (node.floor !== node.row + 1 || node.stageIndex !== node.row || !DEFAULT_LABELS[node.type] || typeof node.label !== 'string' || !node.label.trim() || typeof node.description !== 'string') return false;
    if (!Array.isArray(node.next) || new Set(node.next).size !== node.next.length || rows[node.row].some(other => other.column === node.column)) return false;
    if (node.encounterId && !content.encounters[node.encounterId] || node.enemyId && !content.enemies[node.enemyId] || node.type === 'event' && !content.events[node.eventId]) return false;
    if (['elite', 'boss'].includes(node.type) && !node.encounterId || node.type === 'boss' && node.encounterId !== route.bossId) return false;
    const fixed = act.map.fixedFloors?.[node.floor];
    if (fixed && node.type !== fixed.type) return false;
    const constraints = act.map.constraints || {};
    if (node.floor < (constraints.minFloor?.[node.type] ?? 1) || node.floor > (constraints.maxFloor?.[node.type] ?? route.floorCount)) return false;
    nodes.set(node.id, node); rows[node.row].push(node);
  }
  if (rows.some((row, index) => !row.length || act.map.fixedFloors?.[index + 1] && row.length !== act.map.fixedFloors[index + 1].count)) return false;
  const incoming = new Set();
  for (const node of route.nodes) {
    if (node.row === route.floorCount - 1 ? node.next.length !== 0 || node.type !== 'boss' : node.next.length === 0) return false;
    for (const id of node.next) {
      const target = nodes.get(id);
      if (!target || target.row !== node.row + 1 || target.type === node.type && act.map.constraints?.noConsecutive?.includes(node.type)) return false;
      incoming.add(id);
    }
  }
  if (route.nodes.some(node => node.row > 0 && !incoming.has(node.id))) return false;
  if (route.path.length > route.floorCount || new Set(route.path).size !== route.path.length || route.path.some(id => !nodes.has(id))) return false;
  if (route.completedIds.length < Math.max(0, route.path.length - 1) || route.completedIds.length > route.path.length || !route.completedIds.every((id, index) => id === route.path[index])) return false;
  if (!route.path.length) return route.currentId === null && !route.completedIds.length;
  return route.currentId === route.path.at(-1) && nodes.get(route.path[0]).row === 0 && route.path.every((id, index) => !index || nodes.get(route.path[index - 1]).next.includes(id));
}

export function getConfiguredAvailableNodes(state, content = state?.contentSnapshot) {
  if (state?.phase !== 'map' || !isValidConfiguredRoute(state.route, content)) return [];
  const route = state.route;
  if (route.currentId === null) return route.nodes.filter(node => node.row === 0);
  if (!route.completedIds.includes(route.currentId)) return [];
  const current = route.nodes.find(node => node.id === route.currentId);
  return route.nodes.filter(node => current.next.includes(node.id) && !route.completedIds.includes(node.id));
}
