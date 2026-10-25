// 数值参考《杀戮尖塔 1》A0；名字与美术属于本作地府题材，来源见 ACT1-EXPERIENCE-BASELINE.md。
function enemy(id, name, reference, hpRange, description, options = {}) {
  return Object.freeze({
    id, name, reference, title: options.title ?? name, description,
    archetype: id, art: options.art ?? `enemy-${id}`, kind: options.kind ?? 'normal',
    hpRange: Object.freeze(hpRange), minHp: hpRange[0], maxHp: hpRange[1],
    artScale: options.artScale ?? 1,
  });
}

const definitions = [
  enemy('cultist', '引魂祭师', 'Cultist', [48, 54], '先举行引魂仪式，随后每回合攻击；仪式使它逐轮获得力量。'),
  enemy('jaw', '噬梦兽', 'Jaw Worm', [40, 44], '会猛咬，也会一边攻击一边防御，或咆哮蓄力。'),
  enemy('louse_red', '赤纸蛛', 'Red Louse', [10, 15], '攻击或增加力量。首次被攻击伤及生命后蜷缩，获得一次格挡。'),
  enemy('louse_green', '青纸蛛', 'Green Louse', [11, 17], '攻击或施加虚弱。首次被攻击伤及生命后蜷缩，获得一次格挡。'),
  enemy('acid_s', '小腐泥灵', 'Acid Slime S', [8, 12], '用酸蚀攻击或虚弱阻碍清场；不会分裂。', { art: 'enemy-acid', artScale: .62 }),
  enemy('acid_m', '腐泥灵', 'Acid Slime M', [28, 32], '酸蚀攻击会塞入黏液，也会重击或施加虚弱；不会分裂。', { art: 'enemy-acid', artScale: .82 }),
  enemy('acid_l', '腐泥巨灵', 'Acid Slime L', [65, 69], '酸蚀攻击、重击或虚弱；半血时改为分裂，子体继承执行分裂时的剩余生命。', { art: 'enemy-acid' }),
  enemy('spike_s', '小刺泥灵', 'Spike Slime S', [10, 14], '每轮进行稳定攻击；不会分裂。', { art: 'enemy-spike', artScale: .62 }),
  enemy('spike_m', '刺泥灵', 'Spike Slime M', [28, 32], '攻击并塞入黏液，或使玩家脆弱；不会分裂。', { art: 'enemy-spike', artScale: .82 }),
  enemy('spike_l', '刺泥巨灵', 'Spike Slime L', [64, 70], '重击并塞入黏液，或施加脆弱；半血时改为分裂。', { art: 'enemy-spike' }),
  enemy('slaver_blue', '缚魂差役', 'Blue Slaver', [46, 50], '重击，或攻击并施加虚弱，削弱玩家下一轮的清怪效率。', { art: 'collector' }),
  enemy('slaver_red', '赤绳狱卒', 'Red Slaver', [46, 50], '攻击并施加易伤；一场一次的缠绕会使玩家暂时不能使用攻击牌。'),
  enemy('looter', '窃财鬼', 'Looter', [44, 48], '攻击时盗走冥钱，随后准备逃走；及时击败它可追回失物。'),
  enemy('fungi', '孽菌童', 'Fungi Beast', [22, 28], '攻击或增加力量；死亡时给玩家施加易伤，使同伴的攻击更危险。'),
  enemy('gremlin_fat', '迟钝纸童', 'Fat Gremlin', [13, 17], '攻击并施加虚弱，为同伴争取时间。', { art: 'paper' }),
  enemy('gremlin_mad', '怒面小鬼', 'Mad Gremlin', [20, 24], '每次被攻击伤及生命都会获得力量；零碎攻击可能喂大它。'),
  enemy('gremlin_shield', '护符小鬼', 'Shield Gremlin', [12, 15], '为同伴提供格挡。独自一只时改为攻击；已预告的保护行动不会临时变成攻击。'),
  enemy('gremlin_sneaky', '匿刃小鬼', 'Sneaky Gremlin', [10, 14], '生命不高，但每轮攻击都很危险，适合优先处理。'),
  enemy('gremlin_wizard', '咒灯小鬼', 'Gremlin Wizard', [21, 25], '先蓄力两轮再爆发；之后需再蓄力三轮。'),
  enemy('nob', '怒魇力士', 'Gremlin Nob', [82, 86], '先咆哮激怒；激怒后玩家每使用一张术法牌，它就获得力量。', { kind: 'elite' }),
  enemy('lagavulin', '沉棺守夜者', 'Lagavulin', [109, 111], '在格挡中沉睡，最多给三轮准备。醒后重击、重击，再削减玩家力量和敏捷。', { kind: 'elite' }),
  enemy('sentry', '镇魂碑', 'Sentry', [38, 42], '三碑并列，各有一次人工制品。中碑与两侧交替攻击、塞入眩晕。', { kind: 'elite' }),
  enemy('slime_boss', '腐河鬼王', 'Slime Boss', [140, 140], '黏液、蓄势、重砸。半血后改为分裂，继续压低生命可削弱所有子体。', { kind: 'boss' }),
  enemy('guardian', '铁面判官', 'The Guardian', [240, 240], '受到一定生命伤害便转换形态并获得格挡；防御形态会反击攻击牌。', { kind: 'boss', art: 'judge' }),
  enemy('hexaghost', '六灯冥魂', 'Hexaghost', [250, 250], '第二轮按玩家当前生命分割六连击，之后循环攻击与灼伤，炼狱会升级灼伤。', { kind: 'boss' }),
];

export const ACT1_ENEMY_DEFS = Object.freeze(Object.fromEntries(definitions.map(definition => [definition.id, definition])));

function encounter(id, label, enemies, weight = 1, extra = {}) {
  return Object.freeze({ id, label, enemies: Object.freeze(enemies), weight, ...extra });
}

export const ACT1_WEAK_ENCOUNTERS = Object.freeze([
  encounter('weak_cultist', '引魂仪式', ['cultist']),
  encounter('weak_jaw', '噬梦兽', ['jaw']),
  encounter('weak_louses', '双蛛拦路', [], 1, { recipe: 'louses', count: 2 }),
  encounter('weak_slimes', '大小泥灵', [], 1, { recipe: 'mixed_slimes' }),
]);

export const ACT1_STRONG_ENCOUNTERS = Object.freeze([
  encounter('strong_gremlins', '小鬼团伙', [], 1, { recipe: 'gremlins' }),
  encounter('strong_large_slime', '泥灵巨影', [], 2, { recipe: 'large_slime' }),
  encounter('strong_slime_swarm', '泥灵潮', ['spike_s', 'spike_s', 'spike_s', 'acid_s', 'acid_s'], 1),
  encounter('strong_blue_slaver', '缚魂差役', ['slaver_blue'], 2),
  encounter('strong_red_slaver', '赤绳狱卒', ['slaver_red'], 1),
  encounter('strong_louses', '三蛛结网', [], 2, { recipe: 'louses', count: 3 }),
  encounter('strong_fungi', '孽菌双生', ['fungi', 'fungi'], 2),
  encounter('strong_thugs', '阴路恶徒', [], 1.5, { recipe: 'thugs' }),
  encounter('strong_beasts', '阴路异兽', [], 1.5, { recipe: 'beasts' }),
  encounter('strong_looter', '窃财鬼', ['looter'], 2),
]);

export const ACT1_ELITES = Object.freeze([
  encounter('nob', '怒魇力士', ['nob']),
  encounter('lagavulin', '沉棺守夜者', ['lagavulin']),
  encounter('sentry', '三座镇魂碑', ['sentry', 'sentry', 'sentry']),
]);

export const ACT1_BOSSES = Object.freeze([
  encounter('slime_boss', '腐河鬼王', ['slime_boss']),
  encounter('guardian', '铁面判官', ['guardian']),
  encounter('hexaghost', '六灯冥魂', ['hexaghost']),
]);

const ENCOUNTERS = [...ACT1_WEAK_ENCOUNTERS, ...ACT1_STRONG_ENCOUNTERS, ...ACT1_ELITES, ...ACT1_BOSSES];
const POOLS = Object.freeze({ weak: ACT1_WEAK_ENCOUNTERS, strong: ACT1_STRONG_ENCOUNTERS, elite: ACT1_ELITES, boss: ACT1_BOSSES });

function roll(random) {
  const number = random();
  if (!Number.isFinite(number)) throw new RangeError('遭遇随机源必须返回有限数。');
  return Math.min(1 - Number.EPSILON, Math.max(0, number));
}
function pick(list, random) { return list[Math.floor(roll(random) * list.length)]; }

export function getAct1Encounter(id) {
  return ENCOUNTERS.find(candidate => candidate.id === id) ?? null;
}

export function sampleAct1Encounter(pool, random = Math.random, excludeIds = []) {
  if (typeof random !== 'function') throw new TypeError('遭遇随机源必须是函数。');
  const source = typeof pool === 'string' ? POOLS[pool] ?? [getAct1Encounter(pool)].filter(Boolean) : pool;
  if (!Array.isArray(source) || source.length === 0) throw new RangeError(`未知或空的第一幕遭遇池：${String(pool)}`);
  const filtered = source.filter(candidate => !excludeIds.includes(candidate.id));
  const candidates = filtered.length ? filtered : source;
  const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  let threshold = roll(random) * totalWeight;
  let selected = candidates.at(-1);
  for (const candidate of candidates) {
    threshold -= candidate.weight;
    if (threshold < 0) { selected = candidate; break; }
  }
  let enemies = [...selected.enemies];
  if (selected.recipe === 'louses') enemies = Array.from({ length: selected.count }, () => pick(['louse_red', 'louse_green'], random));
  else if (selected.recipe === 'mixed_slimes') enemies = pick([['spike_m', 'acid_s'], ['acid_m', 'spike_s']], random).slice();
  else if (selected.recipe === 'large_slime') enemies = [pick(['acid_l', 'spike_l'], random)];
  else if (selected.recipe === 'thugs') enemies = [pick(['louse_red', 'louse_green', 'acid_m', 'spike_m'], random), pick(['slaver_blue', 'slaver_red', 'cultist', 'looter'], random)];
  else if (selected.recipe === 'beasts') enemies = [pick(['fungi', 'jaw'], random), pick(['louse_red', 'louse_green', 'acid_m', 'spike_m'], random)];
  else if (selected.recipe === 'gremlins') {
    const bag = ['gremlin_mad', 'gremlin_mad', 'gremlin_sneaky', 'gremlin_sneaky', 'gremlin_fat', 'gremlin_fat', 'gremlin_wizard', 'gremlin_shield'];
    enemies = Array.from({ length: 4 }, () => bag.splice(Math.floor(roll(random) * bag.length), 1)[0]);
  }
  if (enemies.length < 1 || enemies.length > 5 || enemies.some(id => !Object.hasOwn(ACT1_ENEMY_DEFS, id))) throw new Error('第一幕遭遇包含无效敌人。');
  return { id: selected.id, label: selected.label, enemies };
}
