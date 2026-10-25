// Shared by the compiler and browser save validation. No Node dependencies.
import { evaluate } from './expressions.js';
import { createConfiguredRoute, isValidConfiguredRoute } from './world.js';
import { RELIC_DEFS } from './items.js';

const own = (object, key) => Object.hasOwn(object, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const safeId = value => typeof value === 'string' && /^[a-z][a-zA-Z0-9_-]*$/.test(value) && !forbidden.has(value);
const safeKey = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_]*$/.test(value) && !forbidden.has(value);
const safeAsset = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]*$/.test(value);
const types = ['attack', 'skill', 'power', 'status', 'curse'];
const rarities = ['basic', 'common', 'uncommon', 'rare', 'special'];
const keywords = ['exhaust', 'ethereal', 'innate', 'unplayable'];
const targets = ['self', 'source', 'enemy', 'target', 'allEnemies', 'randomEnemy', 'player', 'ally', 'attacker'];
const statuses = ['strength', 'dexterity', 'weak', 'exposed', 'frail', 'entangled', 'artifact', 'burn', 'curlUp', 'enrage', 'angry', 'ritual', 'sharpHide', 'stolen'];
const zones = ['hand', 'drawPile', 'discard', 'exhaust', 'powerZone', 'limbo'];
const nodeTypes = ['battle', 'elite', 'boss', 'event', 'rest', 'shop', 'treasure'];
const boundaries = ['turnEnd', 'handEnd', 'roundEnd'];
const triggerEvents = ['turnStart', 'turnEnd', 'cardPlayed', 'cardExhausted', 'cardDrawn', 'hpLost', 'attacked', 'blockGained', 'debtRepaid', 'enemyDeath', 'enemyActionStart', 'enemyActionEnd'];
const unary = ['floor', 'ceil', 'abs', 'not'];
const binary = ['sub', 'div', 'pow', 'mod', 'eq', 'ne', 'lt', 'lte', 'gt', 'gte'];
const variadic = ['add', 'mul', 'min', 'max', 'and', 'or'];
const effectFields = {
  damage: ['amount', 'hits', 'strengthScale', 'target', 'attack', 'ignoreBlock', 'healFromDamage', 'fatalMaxHp', 'cause', 'impact'],
  block: ['amount', 'target', 'modified', 'impact'], energy: ['amount'], loseHp: ['amount', 'cause'], heal: ['amount'],
  status: ['key', 'amount', 'target', 'debuff'], power: ['id', 'amount', 'target', 'duration', 'impact'], draw: ['amount'],
  addCard: ['cardId', 'amount', 'zone', 'position', 'upgradeLevel'], exhaust: ['selection', 'amount', 'prompt', 'onEach'],
  moveCard: ['from', 'to', 'position', 'selection', 'excludeIds', 'types', 'prompt'],
  copyCard: ['selection', 'types', 'amount', 'zone', 'temporaryCost', 'prompt'], upgrade: ['selection', 'prompt'],
  modifyCard: ['key', 'amount', 'operation'], playTop: ['exhaust'], generateCard: ['pool', 'temporaryCost'], repeatNext: ['amount'],
  if: ['condition', 'then', 'else'], debt: ['amount', 'delay'], repay: ['amount'], delayDebt: ['amount'], set: ['target', 'path', 'value'],
  summon: ['ids', 'inheritHp', 'replaceSource'], steal: ['amount'], escape: [], changeIntent: ['move'],
  transformCards: ['from', 'to', 'zones'], gold: ['amount', 'reason'], permanentCard: ['cardId'], relic: ['id'],
};

export function isAllowedStatePath(path) {
  return typeof path === 'string' && /^(ai\.[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)*|strength|dexterity|block|weak|exposed|frail|entangled|artifact|burn|curlUp|enrage|angry|ritual|sharpHide|stolen|repeatNext|noDraw)$/.test(path) && !/(__proto__|prototype|constructor)/.test(path);
}

export function validateContent(content) {
  const errors = [];
  const fail = (path, message) => { if (errors.length < 500) errors.push(`${path}：${message}`); };
  const text = (value, path) => { if (typeof value !== 'string' || !value.trim()) fail(path, '需要非空文字'); };
  const bool = (value, path) => { if (typeof value !== 'boolean') fail(path, '需要布尔值'); };
  const integer = (value, path, min = 0, max = Number.MAX_SAFE_INTEGER) => { if (!Number.isSafeInteger(value) || value < min || value > max) fail(path, `需要 ${min} 至 ${max} 的整数`); };
  const finite = (value, path, min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(path, `需要 ${min} 至 ${max} 的有限数字`); };
  const oneOf = (value, choices, path) => { if (!choices.includes(value)) fail(path, `需要 ${choices.join(' / ')}`); };
  const object = (value, path) => { if (!record(value)) { fail(path, '需要对象'); return false; } return true; };
  const list = (value, path, min = 0) => { if (!Array.isArray(value) || value.length < min) { fail(path, `需要至少 ${min} 项的数组`); return false; } return true; };
  const unique = (values, path) => { if (new Set(values).size !== values.length) fail(path, '不允许重复项'); };
  const allowedKeys = (value, allowed, path) => { for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key}`, '不支持的字段，可能是拼写错误'); };
  const exists = (table, id, path) => { if (!safeId(id) || !own(content[table] || {}, id) || !record(content[table][id])) fail(path, `引用不存在的 ${table}.${String(id)}`); };
  const strings = (value, path, choices, min = 0) => { if (!list(value, path, min)) return; value.forEach((item, index) => choices ? oneOf(item, choices, `${path}[${index}]`) : text(item, `${path}[${index}]`)); unique(value, path); };
  const visiting = new Set();
  function scan(value, path, depth = 0) {
    if (value === null || ['string', 'boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || depth > 64) { fail(path, '需要有限的JSON数据，嵌套不能超过64层'); return; }
    if (visiting.has(value)) { fail(path, '不允许循环引用'); return; }
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) { fail(path, '需要普通JSON对象'); return; }
    visiting.add(value);
    const tables = ['cards','powers','enemies','encounters','acts','events','visuals'];
    for (const [key, item] of Object.entries(value)) { const child = Array.isArray(value) || tables.includes(path) ? `${path}[${key}]` : path === 'content' && tables.includes(key) ? key : `${path}.${key}`; if (forbidden.has(key)) fail(child, '不允许原型字段'); else scan(item, child, depth + 1); }
    visiting.delete(value);
  }
  if (!object(content, 'content')) return errors;
  scan(content, 'content');
  for (const table of ['cards', 'powers', 'enemies', 'encounters', 'acts', 'events', 'visuals']) if (object(content[table], table)) for (const [id, row] of Object.entries(content[table])) {
    if (!safeId(id)) fail(`${table}[${id}].id`, '非法id');
    if (object(row, `${table}[${id}]`) && row.id !== id) fail(`${table}[${id}].id`, '记录id必须与索引一致');
  }
  if (errors.length) return errors;

  function constant(value) { return value === null || typeof value !== 'object' || record(value) && own(value, 'op') && Array.isArray(value.args) && value.args.every(constant); }
  function expression(value, path, kind = 'number', limits = {}) {
    const before = errors.length;
    if (value === null || typeof value !== 'object') {
      if (kind === 'value') { if (value === null || !['number', 'string', 'boolean'].includes(typeof value)) fail(path, '需要数字、布尔、文字或表达式'); }
      else if (kind === 'condition') { if (!['boolean', 'number'].includes(typeof value)) fail(path, '条件需要布尔、数字或表达式'); }
      else if (typeof value !== 'number') fail(path, '需要数字或数值表达式');
    } else if (!record(value)) fail(path, '表达式不能是数组');
    else {
      const tags = ['stat', 'op', 'count', 'debt', 'random'].filter(key => own(value, key));
      if (tags.length !== 1) { fail(path, '表达式必须且只能选择stat/op/count/debt/random之一'); return; }
      const tag = tags[0]; allowedKeys(value, tag === 'op' ? ['op', 'args'] : [tag], path);
      if (tag === 'stat') {
        if (typeof value.stat !== 'string' || !/^(player|state|source|target|card|context|event|power)(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(value.stat) || value.stat.split('.').some(part => forbidden.has(part))) fail(`${path}.stat`, '非法状态路径');
      } else if (tag === 'op') {
        if (![...unary, ...binary, ...variadic].includes(value.op)) fail(`${path}.op`, `未知表达式操作 ${value.op}`);
        if (list(value.args, `${path}.args`)) {
          const count = unary.includes(value.op) ? 1 : binary.includes(value.op) ? 2 : null;
          if (count !== null ? value.args.length !== count : value.args.length < 1) fail(`${path}.args`, count ? `需要恰好${count}个参数` : '至少需要一个参数');
          const argKind = ['eq', 'ne'].includes(value.op) ? 'value' : ['and', 'or', 'not'].includes(value.op) ? 'condition' : 'number';
          value.args.forEach((arg, index) => expression(arg, `${path}.args[${index}]`, argKind));
        }
      } else if (tag === 'count' && object(value.count, `${path}.count`)) {
        allowedKeys(value.count, ['zone', 'type', 'tag', 'excludeSelf'], `${path}.count`); oneOf(value.count.zone, [...zones, 'combat'], `${path}.count.zone`);
        if (own(value.count, 'type')) oneOf(value.count.type, types, `${path}.count.type`);
        if (own(value.count, 'tag')) text(value.count.tag, `${path}.count.tag`);
        if (own(value.count, 'excludeSelf')) bool(value.count.excludeSelf, `${path}.count.excludeSelf`);
      } else if (tag === 'debt') oneOf(value.debt, ['total', 'dueNext', 'repaidCombat', 'repaidTurn', 'eligibleDelay'], `${path}.debt`);
      else if (tag === 'random' && list(value.random, `${path}.random`)) {
        if (value.random.length !== 2) fail(`${path}.random`, '需要最小值和最大值');
        value.random.forEach((item, index) => expression(item, `${path}.random[${index}]`, 'number', { ...limits, integer: true }));
        if (errors.length === before && value.random.every(constant) && evaluate(value.random[1]) < evaluate(value.random[0])) fail(`${path}.random`, '最大值不能小于最小值');
      }
    }
    if (errors.length === before && constant(value)) {
      const result = evaluate(value);
      if (kind === 'number' && typeof result !== 'number') fail(path, '表达式结果不是数字');
      if (typeof result === 'number') { finite(result, path, limits.min ?? -Number.MAX_SAFE_INTEGER, limits.max ?? Number.MAX_SAFE_INTEGER); if (limits.integer) integer(result, path, limits.min ?? -Number.MAX_SAFE_INTEGER, limits.max ?? Number.MAX_SAFE_INTEGER); }
    }
  }
  function effects(value, path, enemy) {
    if (!list(value, path)) return;
    value.forEach((effect, index) => {
      const p = `${path}[${index}]`; if (!object(effect, p)) return;
      if (!own(effectFields, effect.op)) { fail(`${p}.op`, `未知效果 ${effect.op}`); return; }
      allowedKeys(effect, ['op', ...effectFields[effect.op]], p);
      if (own(effect, 'target')) oneOf(effect.target, targets, `${p}.target`);
      for (const key of ['amount', 'hits', 'strengthScale', 'fatalMaxHp', 'delay', 'upgradeLevel', 'temporaryCost']) if (own(effect, key)) {
        const signed = key === 'amount' && ['status', 'gold', 'energy', 'modifyCard'].includes(effect.op);
        const counted = ['hits', 'upgradeLevel', 'delay', 'temporaryCost', 'fatalMaxHp'].includes(key) || key === 'amount' && ['draw', 'addCard', 'copyCard', 'exhaust', 'repeatNext', 'debt', 'repay', 'delayDebt', 'steal'].includes(effect.op);
        expression(effect[key], `${p}.${key}`, 'number', { min: signed ? -Number.MAX_SAFE_INTEGER : effect.op === 'delayDebt' ? 1 : 0, ...(counted ? { integer: true } : {}), ...(key === 'hits' || key === 'amount' && ['draw', 'addCard', 'copyCard', 'exhaust'].includes(effect.op) ? { max: 1000 } : {}) });
      }
      for (const key of ['attack', 'ignoreBlock', 'healFromDamage', 'modified', 'debuff', 'exhaust', 'inheritHp', 'replaceSource']) if (own(effect, key)) bool(effect[key], `${p}.${key}`);
      for (const key of ['prompt', 'cause', 'reason']) if (own(effect, key)) text(effect[key], `${p}.${key}`);
      if (own(effect, 'impact')) exists('visuals', effect.impact, `${p}.impact`);
      if (['damage', 'block', 'energy', 'loseHp', 'heal', 'status', 'draw', 'repay', 'debt', 'repeatNext', 'steal', 'gold', 'modifyCard'].includes(effect.op) && !own(effect, 'amount')) fail(`${p}.amount`, '缺少必填数值');
      if (effect.op === 'damage' && !own(effect, 'target')) fail(`${p}.target`, '伤害必须声明目标');
      if (effect.op === 'status') oneOf(effect.key, statuses, `${p}.key`);
      if (['addCard', 'permanentCard'].includes(effect.op)) exists('cards', effect.cardId, `${p}.cardId`);
      if (effect.op === 'power') { exists('powers', effect.id, `${p}.id`); if (own(effect, 'duration')) oneOf(effect.duration, ['turn', ...boundaries], `${p}.duration`); }
      if (effect.op === 'exhaust') { oneOf(effect.selection, ['allHand', 'nonAttacks', 'randomHand', 'chosen'], `${p}.selection`); if (own(effect, 'amount') && effect.selection !== 'randomHand' && !(effect.selection === 'chosen' && effect.amount === 1)) fail(`${p}.amount`, 'randomHand可限制数量，chosen每次只能选一张'); if (own(effect, 'onEach')) effects(effect.onEach, `${p}.onEach`, enemy); }
      if (['moveCard', 'copyCard'].includes(effect.op)) { oneOf(effect.selection, effect.op === 'moveCard' ? ['chosen'] : ['self', 'chosen'], `${p}.selection`); if (own(effect, 'types')) strings(effect.types, `${p}.types`, types, 1); }
      if (effect.op === 'moveCard') { oneOf(effect.from, ['hand', 'drawPile', 'discard', 'exhaust'], `${p}.from`); oneOf(effect.to, ['hand', 'drawPile'], `${p}.to`); if (own(effect, 'excludeIds') && list(effect.excludeIds, `${p}.excludeIds`)) { unique(effect.excludeIds, `${p}.excludeIds`); effect.excludeIds.forEach((id, i) => exists('cards', id, `${p}.excludeIds[${i}]`)); } }
      if (['addCard', 'copyCard'].includes(effect.op)) oneOf(effect.zone, ['hand', 'drawPile', 'discard'], `${p}.zone`);
      if (own(effect, 'position')) oneOf(effect.position, ['top', 'random'], `${p}.position`);
      if (effect.op === 'upgrade') oneOf(effect.selection, ['chosen', 'allHand'], `${p}.selection`);
      if (effect.op === 'modifyCard') { if (!safeKey(effect.key) || ['uid', 'cardId'].includes(effect.key)) fail(`${p}.key`, '非法卡牌实例字段'); if (own(effect, 'operation')) oneOf(effect.operation, ['add', 'set'], `${p}.operation`); }
      if (effect.op === 'generateCard') { oneOf(effect.pool, ['attack', 'skill', 'power'], `${p}.pool`); if (!Object.values(content.cards).some(card => card.pool === 'ironclad' && card.type === effect.pool && card.generation?.combat !== false)) fail(`${p}.pool`, '没有可生成的该类卡牌'); }
      if (effect.op === 'if') { expression(effect.condition, `${p}.condition`, 'condition'); effects(effect.then, `${p}.then`, enemy); if (own(effect, 'else')) effects(effect.else, `${p}.else`, enemy); }
      if (effect.op === 'set') { if (!isAllowedStatePath(effect.path)) fail(`${p}.path`, '不在运行时允许修改的状态路径内'); expression(effect.value, `${p}.value`, effect.path?.startsWith('ai.') ? 'value' : 'number'); }
      if (effect.op === 'summon' && list(effect.ids, `${p}.ids`, 1)) { if (effect.ids.length > 5) fail(`${p}.ids`, '同一战场最多5只怪物'); effect.ids.forEach((id, i) => exists('enemies', id, `${p}.ids[${i}]`)); }
      if (effect.op === 'changeIntent' && (!enemy || !own(enemy.moves || {}, effect.move))) fail(`${p}.move`, '只能切换当前怪物已经定义的行动');
      if (effect.op === 'transformCards') { exists('cards', effect.from, `${p}.from`); exists('cards', effect.to, `${p}.to`); if (own(effect, 'zones')) strings(effect.zones, `${p}.zones`, zones, 1); }
      if (effect.op === 'relic' && own(effect, 'id') && !own(RELIC_DEFS, effect.id)) fail(`${p}.id`, '引用不存在的遗物');
    });
  }
  function triggers(value, path, enemy) {
    if (!list(value, path)) return; const ids = [];
    value.forEach((trigger, index) => {
      const p = `${path}[${index}]`; if (!object(trigger, p)) return; allowedKeys(trigger, ['id', 'event', 'when', 'effects', 'limit', 'zones'], p);
      oneOf(trigger.event, triggerEvents, `${p}.event`); if (own(trigger, 'id')) { if (!safeId(trigger.id)) fail(`${p}.id`, '非法触发器id'); ids.push(trigger.id); }
      if (own(trigger, 'when')) expression(trigger.when, `${p}.when`, 'condition'); if (own(trigger, 'limit')) oneOf(trigger.limit, ['oncePerTurn', 'oncePerCombat'], `${p}.limit`);
      if (own(trigger, 'zones')) strings(trigger.zones, `${p}.zones`, zones, 1); effects(trigger.effects, `${p}.effects`, enemy);
    }); unique(ids, path);
  }
  function cost(value, path) { if (value !== null && value !== 'X') integer(value, path, 0); }
  function cardVariant(card, path, base) {
    if (!object(card, path)) return;
    if (own(card, 'text')) text(card.text, `${path}.text`); if (own(card, 'cost')) cost(card.cost, `${path}.cost`);
    for (const key of ['effects', 'onDraw', 'onExhaust', 'onHandEnd']) if (own(card, key)) effects(card[key], `${path}.${key}`);
    if (own(card, 'triggers')) triggers(card.triggers, `${path}.triggers`); if (own(card, 'costModifier')) expression(card.costModifier, `${path}.costModifier`);
    if (own(card, 'playCondition')) expression(card.playCondition, `${path}.playCondition`, 'condition'); if (own(card, 'playConditionText')) text(card.playConditionText, `${path}.playConditionText`);
    if (own(card, 'keywords')) strings(card.keywords, `${path}.keywords`, keywords); if (own(card, 'tags')) strings(card.tags, `${path}.tags`);
    if (own(card, 'textValues') && object(card.textValues, `${path}.textValues`)) for (const [key, value] of Object.entries(card.textValues)) { if (!safeKey(key)) fail(`${path}.textValues.${key}`, '非法文字占位符'); expression(value, `${path}.textValues.${key}`); }
    const values = card.textValues || base?.textValues || {};
    for (const [, placeholder] of String(card.text ?? base?.text ?? '').matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)) if (!own(values, placeholder)) fail(`${path}.textValues.${placeholder}`, '文字引用了未定义的占位符');
  }
  for (const [id, card] of Object.entries(content.cards)) {
    const p = `cards[${id}]`; text(card.name, `${p}.name`); text(card.text, `${p}.text`); text(card.pool, `${p}.pool`); oneOf(card.type, types, `${p}.type`); oneOf(card.rarity, rarities, `${p}.rarity`); oneOf(card.target, ['enemy', 'all', 'self'], `${p}.target`); cost(card.cost, `${p}.cost`);
    cardVariant(card, p); if (!own(card, 'effects')) fail(`${p}.effects`, '缺少效果列表'); if (own(card, 'upgrade')) cardVariant(card.upgrade, `${p}.upgrade`, card);
    if (own(card, 'upgradePolicy')) oneOf(card.upgradePolicy, ['once', 'repeat'], `${p}.upgradePolicy`);
    if (own(card, 'generation') && object(card.generation, `${p}.generation`)) { allowedKeys(card.generation, ['combat'], `${p}.generation`); if (own(card.generation, 'combat')) bool(card.generation.combat, `${p}.generation.combat`); }
    if (object(card.visual, `${p}.visual`)) { allowedKeys(card.visual, ['family', 'icon', 'background', 'cost', 'impact'], `${p}.visual`); oneOf(card.visual.family, ['strike', 'ward', 'spirit', 'oath'], `${p}.visual.family`); for (const key of ['icon', 'background', 'cost']) if (!safeAsset(card.visual[key])) fail(`${p}.visual.${key}`, '需要本地PNG素材名，不含路径或扩展名'); exists('visuals', card.visual.impact, `${p}.visual.impact`); }
  }
  for (const [id, power] of Object.entries(content.powers)) {
    const p = `powers[${id}]`; text(power.name, `${p}.name`); text(power.description, `${p}.description`); triggers(power.triggers, `${p}.triggers`);
    if (own(power, 'expires')) oneOf(power.expires, boundaries, `${p}.expires`); if (own(power, 'debuff')) bool(power.debuff, `${p}.debuff`);
    if (own(power, 'modifiers') && object(power.modifiers, `${p}.modifiers`)) for (const [key, value] of Object.entries(power.modifiers)) { oneOf(key, ['retainBlock', 'noDraw', 'skillCostZero', 'exhaustSkills', 'energyPerTurn'], `${p}.modifiers.${key}`); expression(value, `${p}.modifiers.${key}`, typeof value === 'boolean' ? 'condition' : 'number', { min: 0 }); }
  }
  function initialData(value, path, nested = false, limits = {}) {
    if (record(value) && ['stat', 'op', 'count', 'debt', 'random'].some(key => own(value, key))) { expression(value, path, nested ? 'value' : 'number', limits); return; }
    if (!nested) { expression(value, path, 'number', limits); return; }
    if (Array.isArray(value)) { value.forEach((item, index) => initialData(item, `${path}[${index}]`, true)); return; }
    if (record(value)) { for (const [key, item] of Object.entries(value)) { if (!safeKey(key)) fail(`${path}.${key}`, '非法AI初始状态字段'); initialData(item, `${path}.${key}`, true); } return; }
    expression(value, path, 'value');
  }
  for (const [id, enemy] of Object.entries(content.enemies)) {
    const p = `enemies[${id}]`; text(enemy.name, `${p}.name`); text(enemy.description, `${p}.description`); if (!safeAsset(enemy.art)) fail(`${p}.art`, '需要本地PNG素材名');
    if (own(enemy, 'kind')) oneOf(enemy.kind, ['normal', 'elite', 'boss'], `${p}.kind`); if (own(enemy, 'artScale')) finite(enemy.artScale, `${p}.artScale`, Number.MIN_VALUE, 10);
    if (list(enemy.hpRange, `${p}.hpRange`, 2)) { if (enemy.hpRange.length !== 2) fail(`${p}.hpRange`, '需要生命下限和上限'); enemy.hpRange.forEach((value, index) => integer(value, `${p}.hpRange[${index}]`, 1)); if (enemy.hpRange[1] < enemy.hpRange[0]) fail(`${p}.hpRange`, '生命上限不能低于下限'); }
    if (own(enemy, 'initial') && object(enemy.initial, `${p}.initial`)) for (const [key, value] of Object.entries(enemy.initial)) { if (key === 'ai') { if (object(value, `${p}.initial.ai`)) initialData(value, `${p}.initial.ai`, true); } else if (key === 'minion') bool(value, `${p}.initial.minion`); else if ([...statuses, 'block'].includes(key)) initialData(value, `${p}.initial.${key}`, false, { integer: true, min: ['strength','dexterity'].includes(key) ? -Number.MAX_SAFE_INTEGER : 0 }); else fail(`${p}.initial.${key}`, '不允许覆盖身份、生命或运行时字段'); }
    if (record(enemy.initial?.ai)) {
      if (['stat','op','count','debt','random'].some(key=>own(enemy.initial.ai,key))) fail(`${p}.initial.ai`, 'AI初始根必须是状态字典，不能整体替换为表达式');
      if (own(enemy.initial.ai,'history') && list(enemy.initial.ai.history,`${p}.initial.ai.history`)) enemy.initial.ai.history.forEach((moveId,index)=>{if(!safeId(moveId)||!own(enemy.moves||{},moveId))fail(`${p}.initial.ai.history[${index}]`,'历史必须引用已定义的行动');});
    }
    if (!object(enemy.moves, `${p}.moves`)) continue; if (!Object.keys(enemy.moves).length) fail(`${p}.moves`, '至少需要一个行动');
    for (const [moveId, move] of Object.entries(enemy.moves)) { const mp = `${p}.moves.${moveId}`; if (!safeId(moveId)) fail(mp, '非法行动id'); if (!object(move, mp)) continue; allowedKeys(move, ['label', 'description', 'effects', 'after'], mp); text(move.label, `${mp}.label`); effects(move.effects, `${mp}.effects`, enemy); if (own(move, 'after')) effects(move.after, `${mp}.after`, enemy); }
    if (object(enemy.ai, `${p}.ai`) && list(enemy.ai.rules, `${p}.ai.rules`, 1)) {
      let fallback = false;
      enemy.ai.rules.forEach((rule, index) => {
        const rp = `${p}.ai.rules[${index}]`; if (!object(rule, rp)) return; allowedKeys(rule, ['when', 'move', 'weighted', 'sequence'], rp); if (own(rule, 'when')) expression(rule.when, `${rp}.when`, 'condition');
        if (['move', 'weighted', 'sequence'].filter(key => own(rule, key)).length !== 1) fail(rp, '每条AI规则只能选择move/weighted/sequence之一');
        const moveRef = (moveId, path) => { if (!safeId(moveId) || !own(enemy.moves, moveId)) fail(path, '引用不存在的行动'); }; let guaranteed = false;
        if (own(rule, 'move')) { moveRef(rule.move, `${rp}.move`); guaranteed = true; }
        if (own(rule, 'sequence') && object(rule.sequence, `${rp}.sequence`)) { allowedKeys(rule.sequence, ['moves', 'index', 'loop'], `${rp}.sequence`); if (list(rule.sequence.moves, `${rp}.sequence.moves`, 1)) rule.sequence.moves.forEach((moveId, i) => moveRef(moveId, `${rp}.sequence.moves[${i}]`)); if (own(rule.sequence, 'index')) expression(rule.sequence.index, `${rp}.sequence.index`, 'number', { integer: true }); if (own(rule.sequence, 'loop')) bool(rule.sequence.loop, `${rp}.sequence.loop`); guaranteed = Array.isArray(rule.sequence.moves) && rule.sequence.moves.length > 0; }
        if (own(rule, 'weighted') && list(rule.weighted, `${rp}.weighted`, 1)) {
          const unconditional = []; rule.weighted.forEach((item, i) => { const wp = `${rp}.weighted[${i}]`; if (!object(item, wp)) return; allowedKeys(item, ['move', 'weight', 'maxRepeat', 'when'], wp); moveRef(item.move, `${wp}.move`); finite(item.weight, `${wp}.weight`, Number.MIN_VALUE); if (own(item, 'maxRepeat')) integer(item.maxRepeat, `${wp}.maxRepeat`, 1); if (own(item, 'when')) expression(item.when, `${wp}.when`, 'condition'); if ((!own(item, 'when') || item.when === true) && item.weight > 0) unconditional.push(item); });
          guaranteed = unconditional.some(item => !own(item, 'maxRepeat')) || new Set(unconditional.map(item => item.move)).size > 1;
        }
        if ((!own(rule, 'when') || rule.when === true) && guaranteed) fallback = true;
      }); if (!fallback) fail(`${p}.ai.rules`, '需要无条件且不会被重复限制耗尽的兜底规则');
    }
    if (own(enemy, 'triggers')) triggers(enemy.triggers, `${p}.triggers`, enemy);
    if (own(enemy, 'traits') && list(enemy.traits, `${p}.traits`)) enemy.traits.forEach((trait, i) => {
      const tp = `${p}.traits[${i}]`; if (!object(trait, tp)) return;
      text(trait.id, `${tp}.id`); text(trait.label, `${tp}.label`); text(trait.description, `${tp}.description`);
      if (own(trait, 'display') && list(trait.display, `${tp}.display`)) trait.display.forEach((line, index) => {
        const dp = `${tp}.display[${index}]`; if (!object(line, dp)) return;
        allowedKeys(line, ['when', 'text', 'textValues'], dp); text(line.text, `${dp}.text`);
        if (own(line, 'when')) expression(line.when, `${dp}.when`, 'condition');
        cardVariant(line, dp);
      });
    });
  }
  for (const [id, encounter] of Object.entries(content.encounters)) {
    const p = `encounters[${id}]`; text(encounter.label, `${p}.label`); strings(encounter.pools, `${p}.pools`, null, 1); if (own(encounter, 'weight')) finite(encounter.weight, `${p}.weight`, Number.MIN_VALUE);
    if (!object(encounter.composition, `${p}.composition`)) continue; const c = encounter.composition, cp = `${p}.composition`; allowedKeys(c, ['fixed', 'variants', 'slots', 'bag', 'count'], cp); let min = 0, max = 0;
    const enemyIds = (ids, path) => { if (!list(ids, path, 1)) return 0; ids.forEach((enemyId, index) => exists('enemies', enemyId, `${path}[${index}]`)); return ids.length; };
    if (own(c, 'fixed')) { const size = enemyIds(c.fixed, `${cp}.fixed`); min += size; max += size; }
    if (own(c, 'variants') && list(c.variants, `${cp}.variants`, 1)) { const sizes = c.variants.map((variant, i) => { const vp = `${cp}.variants[${i}]`; if (Array.isArray(variant)) return enemyIds(variant, vp); if (!object(variant, vp)) return 0; allowedKeys(variant, ['enemies', 'weight'], vp); if (own(variant, 'weight')) finite(variant.weight, `${vp}.weight`, Number.MIN_VALUE); return enemyIds(variant.enemies, `${vp}.enemies`); }); min += Math.min(...sizes); max += Math.max(...sizes); }
    if (own(c, 'slots') && list(c.slots, `${cp}.slots`, 1)) c.slots.forEach((slot, i) => { const sp = `${cp}.slots[${i}]`; if (!object(slot, sp)) return; allowedKeys(slot, ['options', 'count'], sp); const count = slot.count ?? 1; integer(count, `${sp}.count`, 1, 5); min += count; max += count; if (list(slot.options, `${sp}.options`, 1)) slot.options.forEach((option, j) => { const pp = `${sp}.options[${j}]`; if (typeof option === 'string') exists('enemies', option, pp); else if (object(option, pp)) { allowedKeys(option, ['id', 'weight'], pp); exists('enemies', option.id, `${pp}.id`); if (own(option, 'weight')) finite(option.weight, `${pp}.weight`, Number.MIN_VALUE); } }); });
    if (own(c, 'bag')) { const size = enemyIds(c.bag, `${cp}.bag`), count = c.count ?? 1; integer(count, `${cp}.count`, 1, size || 1); min += count; max += count; } else if (own(c, 'count')) fail(`${cp}.count`, '只有有限袋bag使用此count字段');
    if (!(min >= 1 && max <= 5)) fail(cp, '所有组合必须产生1至5只怪物');
  }
  for (const [id, event] of Object.entries(content.events)) {
    const p = `events[${id}]`; text(event.title, `${p}.title`); text(event.description, `${p}.description`); if (['rest', 'shop', 'treasure', 'upgrade', 'remove'].includes(id)) fail(`${p}.id`, '此id由通用节点服务保留');
    if (!list(event.choices, `${p}.choices`, 1)) continue; const ids = []; let fallback = false;
    event.choices.forEach((choice, index) => { const cp = `${p}.choices[${index}]`; if (!object(choice, cp)) return; if (!safeId(choice.id)) fail(`${cp}.id`, '非法选择id'); ids.push(choice.id); text(choice.title, `${cp}.title`); text(choice.description, `${cp}.description`); effects(choice.effects, `${cp}.effects`); if (own(choice, 'when')) expression(choice.when, `${cp}.when`, 'condition'); if (!own(choice, 'when') || choice.when === true) fallback = true; if (own(choice, 'encounterId')) exists('encounters', choice.encounterId, `${cp}.encounterId`); });
    unique(ids, `${p}.choices`); if (!fallback) fail(`${p}.choices`, '至少要有一个无条件可选出口，避免事件卡死');
  }
  const probes = [];
  for (const [id, act] of Object.entries(content.acts)) {
    const p = `acts[${id}]`, before = errors.length; text(act.name, `${p}.name`); if (own(act, 'number')) integer(act.number, `${p}.number`, 1);
    if (object(act.starting, `${p}.starting`)) { integer(act.starting.maxHp, `${p}.starting.maxHp`, 1); integer(act.starting.energy, `${p}.starting.energy`, 1); integer(act.starting.gold, `${p}.starting.gold`); if (list(act.starting.deck, `${p}.starting.deck`, 1)) act.starting.deck.forEach((entry, i) => { const dp = `${p}.starting.deck[${i}]`; if (object(entry, dp)) { exists('cards', entry.cardId, `${dp}.cardId`); integer(entry.count, `${dp}.count`, 1, 1000); } }); if (own(act.starting, 'relics') && list(act.starting.relics, `${p}.starting.relics`)) { unique(act.starting.relics, `${p}.starting.relics`); act.starting.relics.forEach((relicId, i) => { if (!own(RELIC_DEFS, relicId)) fail(`${p}.starting.relics[${i}]`, '引用不存在的遗物'); }); } }
    if (own(act, 'weakBattleCount')) integer(act.weakBattleCount, `${p}.weakBattleCount`);
    if (own(act, 'eventPool') && list(act.eventPool, `${p}.eventPool`)) { unique(act.eventPool, `${p}.eventPool`); act.eventPool.forEach((eventId, i) => exists('events', eventId, `${p}.eventPool[${i}]`)); }
    if (own(act, 'cardPools')) strings(act.cardPools, `${p}.cardPools`);
    if (own(act, 'specialCards') && list(act.specialCards, `${p}.specialCards`)) { unique(act.specialCards, `${p}.specialCards`); act.specialCards.forEach((cardId, i) => exists('cards', cardId, `${p}.specialCards[${i}]`)); }
    if (!Object.values(content.cards).some(card => ((Array.isArray(act.cardPools) ? act.cardPools : ['ironclad','debt']).includes(card.pool) || Array.isArray(act.specialCards) && act.specialCards.includes(card.id)) && ['common','uncommon','rare'].includes(card.rarity) && !['status','curse'].includes(card.type))) fail(`${p}.cardPools`, '本幕没有可提供的奖励牌');
    if (own(act, 'rewards') && object(act.rewards, `${p}.rewards`)) { if (own(act.rewards, 'rarityWeights') && object(act.rewards.rarityWeights, `${p}.rewards.rarityWeights`)) { let total=0; for (const [key,value] of Object.entries(act.rewards.rarityWeights)) { oneOf(key,['common','uncommon','rare'],`${p}.rewards.rarityWeights.${key}`); finite(value,`${p}.rewards.rarityWeights.${key}`,0); total+=value; } if (!(total>0)) fail(`${p}.rewards.rarityWeights`,'稀有度总权重必须大于零'); } if (own(act.rewards,'debtChance') && object(act.rewards.debtChance,`${p}.rewards.debtChance`)) for (const [key,value] of Object.entries(act.rewards.debtChance)) { oneOf(key,['common','uncommon','rare'],`${p}.rewards.debtChance.${key}`); finite(value,`${p}.rewards.debtChance.${key}`,0,1); } }
    if (own(act,'difficultyModifiers') && list(act.difficultyModifiers,`${p}.difficultyModifiers`,1)) { const ids=[]; act.difficultyModifiers.forEach((entry,i)=>{const dp=`${p}.difficultyModifiers[${i}]`;if(object(entry,dp)){integer(entry.id,`${dp}.id`);ids.push(entry.id);finite(entry.hpMultiplier,`${dp}.hpMultiplier`,Number.MIN_VALUE);integer(entry.attackBonus,`${dp}.attackBonus`,-Number.MAX_SAFE_INTEGER);}});unique(ids,`${p}.difficultyModifiers`); }
    if (!object(act.map, `${p}.map`)) continue; const map=act.map,mp=`${p}.map`;
    integer(map.floors,`${mp}.floors`,2,1000);integer(map.columns,`${mp}.columns`,1,100);if(map.floors*map.columns>10000)fail(mp,'地图最多支持10000个候选节点');
    if(list(map.nodeCount,`${mp}.nodeCount`,2)){if(map.nodeCount.length!==2)fail(`${mp}.nodeCount`,'需要数量下限和上限');map.nodeCount.forEach((count,i)=>integer(count,`${mp}.nodeCount[${i}]`,1,map.columns));if(map.nodeCount[1]<map.nodeCount[0])fail(`${mp}.nodeCount`,'上限不能小于下限');}
    if(own(map,'branchChance'))finite(map.branchChance,`${mp}.branchChance`,0,1);if(own(map,'maxLinks'))integer(map.maxLinks,`${mp}.maxLinks`,1,Math.max(1,map.columns));
    if(own(map,'fixedFloors')&&object(map.fixedFloors,`${mp}.fixedFloors`))for(const [floor,fixed]of Object.entries(map.fixedFloors)){const fp=`${mp}.fixedFloors[${floor}]`;if(!/^\d+$/.test(floor)||Number(floor)<1||Number(floor)>map.floors)fail(fp,'楼层编号超出地图');if(object(fixed,fp)){allowedKeys(fixed,['type','count'],fp);oneOf(fixed.type,nodeTypes,`${fp}.type`);integer(fixed.count,`${fp}.count`,1,map.columns);}}
    if(map.fixedFloors?.[map.floors]?.type!=='boss')fail(`${mp}.fixedFloors[${map.floors}]`,'最后一层必须显式设置为boss');
    if(object(map.typeWeights,`${mp}.typeWeights`))for(const[type,weight]of Object.entries(map.typeWeights)){oneOf(type,nodeTypes,`${mp}.typeWeights.${type}`);finite(weight,`${mp}.typeWeights.${type}`,0);}
    const constraints=record(map.constraints)?map.constraints:{};
    if(own(map,'constraints'))object(map.constraints,`${mp}.constraints`);
    allowedKeys(constraints,['minFloor','maxFloor','noConsecutive'],`${mp}.constraints`);
    if(own(constraints,'noConsecutive'))strings(constraints.noConsecutive,`${mp}.constraints.noConsecutive`,nodeTypes);
    for(const bound of ['minFloor','maxFloor'])if(own(constraints,bound)&&object(constraints[bound],`${mp}.constraints.${bound}`))for(const[type,floor]of Object.entries(constraints[bound])){oneOf(type,nodeTypes,`${mp}.constraints.${bound}.${type}`);integer(floor,`${mp}.constraints.${bound}.${type}`,1,map.floors);}
    for(const type of nodeTypes)if((constraints.minFloor?.[type]??1)>(constraints.maxFloor?.[type]??map.floors))fail(`${mp}.constraints.minFloor.${type}`,'最早楼层晚于最晚楼层');
    const possible=[],noConsecutive=Array.isArray(constraints.noConsecutive)?constraints.noConsecutive:[];
    if(Number.isInteger(map.floors)&&map.floors>=2&&map.floors<=1000&&record(map.typeWeights))for(let floor=1;floor<=map.floors;floor++){
      const fixed=map.fixedFloors?.[floor],nextFixed=map.fixedFloors?.[floor+1];
      const candidates=fixed?[fixed.type]:Object.entries(map.typeWeights).filter(([type,weight])=>weight>0&&floor>=(constraints.minFloor?.[type]??1)&&floor<=(constraints.maxFloor?.[type]??map.floors)&&!(noConsecutive.includes(type)&&nextFixed?.type===type)).map(([type])=>type);
      if(!candidates.length)fail(`${mp}.floor[${floor}]`,'筛选后没有可选节点类型');for(const type of candidates)if(floor<(constraints.minFloor?.[type]??1)||floor>(constraints.maxFloor?.[type]??map.floors))fail(`${mp}.fixedFloors[${floor}]`,'固定节点违反楼层限制');possible.push(candidates);
    }
    for(let row=0;row<possible.length-1;row++)for(const type of possible[row])if(!possible[row+1].some(next=>next!==type||!noConsecutive.includes(type)))fail(`${mp}.floor[${row+1}]`,`${type}节点没有符合相邻限制的出口`);
    const possibleTypes=new Set(possible.flat());
    if(object(act.encounterPools,`${p}.encounterPools`)){for(const key of ['boss',...(possibleTypes.has('battle')?['weak','strong']:[]),...(possibleTypes.has('elite')?['elite']:[])])if(!own(act.encounterPools,key))fail(`${p}.encounterPools.${key}`,'缺少此类节点的遭遇池');for(const[key,pool]of Object.entries(act.encounterPools))if(typeof pool!=='string'||!Object.values(content.encounters).some(encounter=>Array.isArray(encounter.pools)&&encounter.pools.includes(pool)))fail(`${p}.encounterPools.${key}`,`空遭遇池 ${String(pool)}`);}
    if(possibleTypes.has('event')&&!(Array.isArray(act.eventPool)&&act.eventPool.length))fail(`${p}.eventPool`,'地图含事件节点，事件池不能为空');
    if(own(act,'nodeLabels')&&object(act.nodeLabels,`${p}.nodeLabels`))for(const[type,labels]of Object.entries(act.nodeLabels)){oneOf(type,nodeTypes,`${p}.nodeLabels.${type}`);if(list(labels,`${p}.nodeLabels.${type}`,2)){if(labels.length!==2)fail(`${p}.nodeLabels.${type}`,'需要标题与描述两项');labels.forEach((label,i)=>text(label,`${p}.nodeLabels.${type}[${i}]`));}}
    if(errors.length===before)probes.push(id);
  }
  for(const[id,visual]of Object.entries(content.visuals)){
    const p=`visuals[${id}]`;if(!safeAsset(visual.asset))fail(`${p}.asset`,'需要本地PNG素材名');finite(visual.durationMs,`${p}.durationMs`,1,10000);finite(visual.size,`${p}.size`,Number.MIN_VALUE,10);oneOf(visual.anchor,['card','target','bottom'],`${p}.anchor`);
    for(const[key,length,min,max]of [['scale',3,0,10],['rotation',2,-3600,3600],['travel',2,-10,10],['opacity',3,0,1]])if(list(visual[key],`${p}.${key}`,length)){if(visual[key].length!==length)fail(`${p}.${key}`,`需要恰好${length}个关键帧值`);visual[key].forEach((value,i)=>finite(value,`${p}.${key}[${i}]`,min,max));}
  }
  // Structural checks run first; then the real pure generator probes interactions.
  if(!errors.length)for(const id of probes)for(const seed of [0,1,17,57]){try{if(!isValidConfiguredRoute(createConfiguredRoute(id,seed,content),content))fail(`acts[${id}].map`,'地图预检生成了不满足约束的路线');}catch(error){fail(`acts[${id}].map`,`地图预检失败：${error.message}`);}}
  return errors;
}
