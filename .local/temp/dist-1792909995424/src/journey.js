import { ACT1_BOSSES, ACT1_ELITES, ACT1_ENEMY_DEFS } from './act1-content.js';

const NODE_BLUEPRINTS = [
  { id: 'paper', label: '纸扎巷', type: 'battle', row: 0, column: 1, next: ['rest', 'market'], enemyId: 'paper', stageIndex: 0, description: '纸扎童子挡住去路。战后可选一道新符。' },
  { id: 'rest', label: '灯下歇息', type: 'rest', row: 1, column: 0, next: ['collector'], eventId: 'rest', stageIndex: 1, description: '歇脚恢复生命，或静心偿还更多阴债。' },
  { id: 'market', label: '鬼市借灯', type: 'event', row: 1, column: 2, next: ['collector'], eventId: 'market', stageIndex: 1, description: '恢复生命，或用代价换取新符与摆渡钱。' },
  { id: 'collector', label: '忘川渡', type: 'battle', row: 2, column: 1, next: ['soup', 'shrine'], enemyId: 'collector', stageIndex: 2, description: '讨债鬼会随你携带的阴债加重攻击。' },
  { id: 'soup', label: '孟婆茶摊', type: 'rest', row: 3, column: 0, next: ['judge'], eventId: 'soup', stageIndex: 3, description: '喝汤恢复、还债，或留汤换一盏莲灯。' },
  { id: 'shrine', label: '纸灯神龛', type: 'event', row: 3, column: 2, next: ['judge'], eventId: 'shrine', stageIndex: 3, description: '用血或阴债换取强力符箓，也可绕路小憩。' },
  { id: 'judge', label: '判官终审', type: 'boss', row: 4, column: 1, next: [], enemyId: 'judge', stageIndex: 4, description: '通过终审，余下阴债尽数勾销。' },
];

export const CANONICAL_PATH = ['paper', 'market', 'collector', 'soup', 'judge'];

export function createRoute(seed = 0) {
  const nodes = structuredClone(NODE_BLUEPRINTS);
  const normalized = Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0;
  if (normalized & 1) for (const node of nodes.filter(candidate => candidate.row === 1)) node.column = 2 - node.column;
  if (normalized & 2) for (const node of nodes.filter(candidate => candidate.row === 3)) node.column = 2 - node.column;
  return { nodes, completedIds: [], currentId: null, path: [] };
}

export function getAvailableNodes(state) {
  if (state?.route?.version === 2) return getAvailableAct1Nodes(state);
  if (state?.phase !== 'map' || !isValidRoute(state.route)) return [];
  if (state.route.currentId === null) return state.route.nodes.filter(node => node.row === 0);
  if (!state.route.completedIds.includes(state.route.currentId)) return [];
  const current = state.route.nodes.find(node => node.id === state.route.currentId);
  return state.route.nodes.filter(node => current.next.includes(node.id) && !state.route.completedIds.includes(node.id));
}

export function completeCurrentNode(route) {
  if (route.currentId !== null && !route.completedIds.includes(route.currentId)) route.completedIds.push(route.currentId);
}

export function createLegacyRoute(state) {
  const route = createRoute(0);
  route.path = CANONICAL_PATH.slice(0, state.nodeIndex + 1);
  route.currentId = route.path.at(-1) ?? null;
  route.completedIds = state.phase === 'victory' ? [...route.path] : route.path.slice(0, -1);
  return route;
}

export function isValidRoute(route) {
  if (route?.version === 2) return isValidAct1Route(route);
  if (!route || !Array.isArray(route.nodes) || route.nodes.length !== NODE_BLUEPRINTS.length || !Array.isArray(route.completedIds) || !Array.isArray(route.path)) return false;
  const nodes = new Map();
  for (const node of route.nodes) {
    if (!node || typeof node.id !== 'string' || nodes.has(node.id)) return false;
    const blueprint = NODE_BLUEPRINTS.find(candidate => candidate.id === node.id);
    if (!blueprint || typeof node.label !== 'string' || !node.label.trim() || typeof node.description !== 'string' || !node.description.trim()) return false;
    if (node.row !== blueprint.row || node.stageIndex !== blueprint.stageIndex || node.type !== blueprint.type || node.enemyId !== blueprint.enemyId || node.eventId !== blueprint.eventId) return false;
    if (!Number.isInteger(node.column) || ![0, 1, 2].includes(node.column) || ([0, 2, 4].includes(node.row) && node.column !== 1) || ([1, 3].includes(node.row) && node.column === 1)) return false;
    if (!Array.isArray(node.next) || node.next.length !== blueprint.next.length || new Set(node.next).size !== node.next.length || !blueprint.next.every(nodeId => node.next.includes(nodeId))) return false;
    nodes.set(node.id, node);
  }
  for (const row of [1, 3]) if (new Set(route.nodes.filter(node => node.row === row).map(node => node.column)).size !== 2) return false;
  if (route.path.length > 5 || new Set(route.path).size !== route.path.length || !route.path.every(nodeId => nodes.has(nodeId))) return false;
  if (route.completedIds.length > route.path.length || route.completedIds.length < Math.max(0, route.path.length - 1)) return false;
  if (!route.completedIds.every((nodeId, index) => nodeId === route.path[index])) return false;
  if (route.path.length === 0) return route.currentId === null && route.completedIds.length === 0;
  if (route.currentId !== route.path.at(-1) || route.path[0] !== 'paper') return false;
  return route.path.every((nodeId, index) => index === 0 || nodes.get(route.path[index - 1]).next.includes(nodeId));
}

const ACT1_FLOOR_TYPES = Object.freeze([
  ['battle'],
  ['event', 'battle', 'battle'],
  ['battle', 'battle', 'battle'],
  ['rest', 'battle', 'shop'],
  ['battle', 'event', 'battle'],
  ['elite', 'battle', 'rest'],
  ['battle', 'battle', 'battle'],
  ['shop', 'battle', 'elite'],
  ['treasure'],
  ['battle', 'event', 'battle'],
  ['battle', 'event', 'shop'],
  ['rest', 'battle', 'event'],
  ['elite', 'shop', 'battle'],
  ['battle', 'battle', 'battle'],
  ['rest'],
  ['boss'],
]);

function routeRandom(seed) {
  let value = seed ^ (seed >>> 16);
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35);
  value = (value ^ (value >>> 16)) >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function act1Node(type, row, column, boss, elite, eventId) {
  const node = { id: `a1-${row + 1}-${column}`, label: '', type, row, column, floor: row + 1, stageIndex: row, next: [], description: '' };
  if (type === 'battle') Object.assign(node, { label: row < 5 ? '阴路交锋' : '百鬼拦路', encounterPool: 'normal', description: '普通交锋：前三场普通战来自弱遭遇池，之后加入更复杂的组合。战后获得冥钱与选牌。' });
  else if (type === 'elite') Object.assign(node, { label: elite.label, enemyId: elite.enemies[0], encounterId: elite.id, description: `精英：${ACT1_ENEMY_DEFS[elite.enemies[0]].description} 胜利可得一件局内遗物与更多冥钱。` });
  else if (type === 'boss') Object.assign(node, { label: boss.label, enemyId: boss.enemies[0], encounterId: boss.id, description: `首领：${ACT1_ENEMY_DEFS[boss.enemies[0]].description} 通过此战，勾销所有余债。` });
  else if (type === 'rest') Object.assign(node, { label: row === 14 ? '终审前歇脚' : '纸灯歇脚处', eventId: 'rest', description: '恢复最大生命的30%，或升级牌组中的一张符。歇脚不会推进阴债到期。' });
  else if (type === 'shop') Object.assign(node, { label: '忘川鬼市', eventId: 'shop', description: '花冥钱购买符箓、药水，或移除牌组中的一张牌。' });
  else if (type === 'treasure') Object.assign(node, { label: '封魂宝箱', eventId: 'treasure', description: '开启宝箱，获得一件本次夜巡生效的遗物。' });
  else {
    const events = {
      shrine: ['纸灯神龛', '供奉生命或冥钱换取力量，也可绕行。'],
      market: ['鬼市借灯', '用眼前的代价换取恢复、符箓或偿债。'],
      mushrooms: ['孽菌荒冢', '一片安静的菌冢，既可能带来恢复，也可能唤起三只孽菌童。'],
      gold: ['遗落冥钱', '路旁的旧钱袋，拿取与否由你决定。'],
    };
    Object.assign(node, { label: events[eventId][0], eventId, description: events[eventId][1] });
  }
  return node;
}

export function createAct1Route(seed = 0) {
  const normalized = Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0;
  const random = routeRandom(normalized);
  const boss = ACT1_BOSSES[Math.floor(random() * ACT1_BOSSES.length)];
  const rows = [];
  const usedElites = new Set();
  for (let row = 0; row < ACT1_FLOOR_TYPES.length; row += 1) {
    const types = shuffled(ACT1_FLOOR_TYPES[row], random);
    const floor = types.map((type, index) => {
      const column = types.length === 1 ? 1 : index;
      const eliteChoices = ACT1_ELITES.filter(candidate => !usedElites.has(candidate.id));
      const elite = eliteChoices[Math.floor(random() * eliteChoices.length)];
      if (type === 'elite') usedElites.add(elite.id);
      const eventId = ['shrine', 'market', 'mushrooms', 'gold'][Math.floor(random() * 4)];
      return act1Node(type, row, column, boss, elite, eventId);
    });
    rows.push(floor);
  }
  for (let row = 0; row < rows.length - 1; row += 1) {
    const current = rows[row], next = rows[row + 1];
    for (const node of current) {
      const allowed = next.filter(candidate => !(node.type === 'rest' && candidate.type === 'rest'));
      let destinations = next.length === 1 || current.length === 1
        ? allowed
        : allowed.filter(candidate => candidate.column === node.column || candidate.column === node.column + (row % 2 ? -1 : 1));
      if (!destinations.length) destinations = allowed.filter(candidate => Math.abs(candidate.column - node.column) <= 1);
      node.next = destinations.map(candidate => candidate.id);
    }
    // 休息点的相邻限制不可制造不可达站点。
    for (const destination of next) {
      if (current.some(node => node.next.includes(destination.id))) continue;
      const candidates = current.filter(node => !(node.type === 'rest' && destination.type === 'rest'));
      const nearest = candidates.sort((first, second) => Math.abs(first.column - destination.column) - Math.abs(second.column - destination.column))[0];
      nearest.next.push(destination.id);
    }
  }
  return { version: 2, act: 1, seed: normalized, floorCount: 16, bossId: boss.id, nodes: rows.flat(), completedIds: [], currentId: null, path: [] };
}

export function isValidAct1Route(route) {
  if (!route || route.version !== 2 || route.act !== 1 || route.floorCount !== 16 || !Number.isInteger(route.seed) || route.seed < 0 || route.seed > 0xffffffff) return false;
  if (!Array.isArray(route.nodes) || !Array.isArray(route.completedIds) || !Array.isArray(route.path)) return false;
  const baseline = createAct1Route(route.seed);
  if (route.bossId !== baseline.bossId || route.nodes.length !== baseline.nodes.length) return false;
  const nodes = new Map();
  for (const node of route.nodes) {
    if (!node || nodes.has(node.id)) return false;
    const expected = baseline.nodes.find(candidate => candidate.id === node.id);
    if (!expected) return false;
    for (const key of ['row', 'column', 'floor', 'stageIndex', 'type', 'enemyId', 'eventId', 'encounterPool', 'encounterId']) if (node[key] !== expected[key]) return false;
    if (typeof node.label !== 'string' || !node.label.trim() || typeof node.description !== 'string' || !node.description.trim()) return false;
    if (!Array.isArray(node.next) || node.next.length !== expected.next.length || new Set(node.next).size !== node.next.length || !expected.next.every(id => node.next.includes(id))) return false;
    nodes.set(node.id, node);
  }
  if (route.path.length > 16 || new Set(route.path).size !== route.path.length || route.path.some(id => !nodes.has(id))) return false;
  if (route.completedIds.length < Math.max(0, route.path.length - 1) || route.completedIds.length > route.path.length) return false;
  if (!route.completedIds.every((id, index) => id === route.path[index])) return false;
  if (!route.path.length) return route.currentId === null && route.completedIds.length === 0;
  if (route.currentId !== route.path.at(-1) || nodes.get(route.path[0]).row !== 0) return false;
  return route.path.every((id, index) => !index || nodes.get(route.path[index - 1]).next.includes(id));
}

export function getAvailableAct1Nodes(state) {
  if (state?.phase !== 'map' || !isValidAct1Route(state.route)) return [];
  const route = state.route;
  if (route.currentId === null) return route.nodes.filter(node => node.row === 0);
  if (!route.completedIds.includes(route.currentId)) return [];
  const current = route.nodes.find(node => node.id === route.currentId);
  return route.nodes.filter(node => current.next.includes(node.id) && !route.completedIds.includes(node.id));
}
