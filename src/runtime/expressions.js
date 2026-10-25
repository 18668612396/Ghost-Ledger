// Small, serializable expression language for designer-authored content.
// No JavaScript strings or dynamic property evaluation are accepted.
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
export function readPath(object, path) {
  const parts = String(path).split('.');
  if (parts.some(part => forbidden.has(part))) return undefined;
  return parts.reduce((value, key) => value != null && Object.hasOwn(Object(value), key) ? value[key] : undefined, object);
}
export function evaluate(value, env = {}) {
  if (value === null || typeof value !== 'object') return value;
  if (Object.hasOwn(value, 'stat')) return readPath(env, value.stat) ?? 0;
  if (value.debt) {
    const state = env.player || env.state || {};
    const debts = state.debts || [];
    if (value.debt === 'total') return debts.reduce((sum, debt) => sum + debt.amount, 0);
    if (value.debt === 'dueNext') return debts.filter(debt => debt.dueTurn <= state.turn + 1).reduce((sum, debt) => sum + debt.amount, 0);
    if (value.debt === 'repaidCombat') return state.combatCounters?.repaid || 0;
    if (value.debt === 'repaidTurn') return state.repaidThisTurn || 0;
    if (value.debt === 'eligibleDelay') return debts.filter(debt => !debt.delayed).length;
    throw new Error(`未知阴债查询 ${value.debt}`);
  }
  if (value.count) {
    const state = env.player || env.state || {};
    const { zone, type, tag, excludeSelf } = value.count;
    const cards = zone === 'combat' ? ['hand', 'drawPile', 'discard', 'limbo'].flatMap(key => state[key] || []) : state[zone] || [];
    return cards.filter(card => {
      const definition = env.content?.cards?.[card.cardId];
      return (!excludeSelf || card.uid !== env.card?.uid) && (!type || definition?.type === type) && (!tag || definition?.tags?.includes(tag));
    }).length;
  }
  if (value.random) {
    const [minimum, maximum] = value.random.map(item => Number(evaluate(item, env)));
    // Previews never advance the run's random stream.
    return env.preview || !env.random ? minimum : minimum + Math.floor(env.random() * (maximum - minimum + 1));
  }
  if (value.op) {
    const args = (value.args || []).map(arg => evaluate(arg, env));
    const [a = 0, b = 0] = args;
    switch (value.op) {
      case 'add': return args.reduce((sum, item) => sum + Number(item), 0);
      case 'sub': return a - b;
      case 'mul': return args.reduce((product, item) => product * Number(item), 1);
      case 'div': return b === 0 ? 0 : a / b;
      case 'min': return Math.min(...args);
      case 'max': return Math.max(...args);
      case 'floor': return Math.floor(a);
      case 'ceil': return Math.ceil(a);
      case 'abs': return Math.abs(a);
      case 'pow': return a ** b;
      case 'mod': return b === 0 ? 0 : a % b;
      case 'eq': return a === b;
      case 'ne': return a !== b;
      case 'lt': return a < b;
      case 'lte': return a <= b;
      case 'gt': return a > b;
      case 'gte': return a >= b;
      case 'and': return args.every(Boolean);
      case 'or': return args.some(Boolean);
      case 'not': return !a;
      default: throw new Error(`未知表达式 ${value.op}`);
    }
  }
  throw new Error(`不支持的表达式 ${JSON.stringify(value)}`);
}
export function numeric(value, env) {
  const result = Number(evaluate(value, env));
  if (!Number.isFinite(result)) throw new Error('内容表达式产生非有限数值');
  return result;
}
export function randomFromState(state) {
  let value = state.rngState >>> 0 || 0x9e3779b9;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  state.rngState = value >>> 0;
  return state.rngState / 4294967296;
}
export function shuffled(state, items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(randomFromState(state) * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}
