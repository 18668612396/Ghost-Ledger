const TYPES = [['attack', '攻击'], ['skill', '术法'], ['power', '能力'], ['status', '状态'], ['curse', '诅咒']];
const RARITIES = [['basic', '基础'], ['common', '普通'], ['uncommon', '罕见'], ['rare', '稀有'], ['special', '特殊']];
const FAMILIES = [['strike', '攻伐 · 红'], ['ward', '护身 · 绿'], ['spirit', '灵术 · 蓝'], ['oath', '阴契 · 紫']];
const TARGETS = [['enemy', '指定敌人'], ['allEnemies', '全部敌人'], ['randomEnemy', '随机敌人'], ['self', '自身'], ['source', '来源'], ['player', '玩家'], ['target', '当前目标'], ['ally', '友方'], ['attacker', '攻击者']];
const STATUS = ['strength', 'dexterity', 'weak', 'exposed', 'frail', 'entangled', 'artifact', 'burn', 'curlUp', 'enrage', 'angry', 'ritual', 'sharpHide', 'stolen'];
const STATUS_NAMES = { strength: '力量', dexterity: '敏捷', weak: '虚弱', exposed: '易伤', frail: '脆弱', entangled: '缠绕', artifact: '人工制品', burn: '灼伤', curlUp: '蜷缩', enrage: '激怒', angry: '怒火', ritual: '仪式', sharpHide: '尖刺', stolen: '偷取冥钱' };
const NODE_TYPES = [['battle', '交锋'], ['elite', '精英'], ['boss', '首领'], ['event', '事件'], ['rest', '歇脚'], ['shop', '鬼市'], ['treasure', '宝箱']];
const EFFECT_LABELS = { damage: '造成伤害', block: '获得护甲', energy: '调整香火', loseHp: '失去生命', heal: '恢复生命', status: '施加状态', power: '获得能力', draw: '抽牌', addCard: '生成指定牌', exhaust: '消耗卡牌', moveCard: '移动卡牌', copyCard: '复制卡牌', upgrade: '升级卡牌', modifyCard: '修改牌实例', playTop: '打出牌堆顶牌', generateCard: '随机生成牌', repeatNext: '重复下次出牌', if: '条件分支', debt: '增加阴债', repay: '偿还阴债', delayDebt: '延后阴债', set: '设置状态', summon: '召唤怪物', steal: '偷取冥钱', escape: '离开战场', changeIntent: '改变意图', transformCards: '转换卡牌', gold: '调整冥钱', permanentCard: '获得永久牌', relic: '获得法器' };
const NUMERIC_FIELDS = { damage: ['amount', 'hits'], block: ['amount'], energy: ['amount'], loseHp: ['amount'], heal: ['amount'], status: ['amount'], power: ['amount'], draw: ['amount'], addCard: ['amount', 'upgradeLevel'], exhaust: [], copyCard: ['amount'], modifyCard: ['amount'], repeatNext: ['amount'], debt: ['amount', 'delay'], repay: ['amount'], delayDebt: ['amount'], steal: ['amount'], gold: ['amount'] };
const FIELD_NAMES = { amount: '数值', hits: '次数', delay: '到期巡更间隔', upgradeLevel: '升级等级', temporaryCost: '临时费用' };

function el(tag, className = '', text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}
function button(text, callback, className = 'mini-button') {
  const control = el('button', className, text); control.type = 'button'; control.addEventListener('click', callback); return control;
}
function getAt(root, path) { return path.reduce((value, key) => value?.[key], root); }
function setAt(root, path, value) {
  if (path.some(key => ['__proto__', 'prototype', 'constructor'].includes(String(key)))) throw new Error('不允许修改原型字段。');
  let target = root;
  path.slice(0, -1).forEach((key, index) => { if (!target[key] || typeof target[key] !== 'object') target[key] = typeof path[index + 1] === 'number' ? [] : {}; target = target[key]; });
  if (value === undefined) delete target[path.at(-1)]; else target[path.at(-1)] = value;
}
function clone(value) { return value === undefined ? undefined : structuredClone(value); }
function optionPairs(options) { return options.map(item => Array.isArray(item) ? item : [item, item]); }

export function renderRecordEditor({ table, record, tables, assets = [], onChange }) {
  let draft = clone(record);
  const root = el('div', 'editor-form');
  const pending = new Set();
  const deferredPaints = new Set();
  const jsonControls = new Map();
  let nextPending = 0;
  let pruneQueued = false;
  const notice = el('p', 'field-error'); notice.hidden = true; notice.setAttribute('role', 'alert'); root.append(notice);
  const announcePending = () => { root.dataset.editorPending = String(pending.size > 0); root.dispatchEvent(new CustomEvent('editor-pending', { bubbles: true, detail: { pending: pending.size > 0 } })); };
  const flushPaints = () => { if (!pending.size && deferredPaints.size) queueMicrotask(() => { if (pending.size) return; const paints = [...deferredPaints]; deferredPaints.clear(); for (const paint of paints) paint(); }); };
  const pruneJsonControls = () => {
    let pendingChanged = false;
    for (const [key, control] of jsonControls) if (!root.contains(control.group)) { jsonControls.delete(key); pendingChanged = pending.delete(key) || pendingChanged; }
    if (pendingChanged) { announcePending(); flushPaints(); }
  };
  const schedulePrune = () => { if (pruneQueued) return; pruneQueued = true; queueMicrotask(() => { pruneQueued = false; pruneJsonControls(); }); };
  const syncJsonMirrors = () => { pruneJsonControls(); for (const control of jsonControls.values()) control.sync(); };
  const emit = () => { syncJsonMirrors(); onChange(clone(draft)); schedulePrune(); };
  const update = (path, value) => { setAt(draft, path, value); emit(); };
  const guard = () => { pruneJsonControls(); if (!pending.size) { notice.hidden = true; return true; } notice.textContent = '请先应用或还原尚未应用的 JSON，再调整列表结构。'; notice.hidden = false; notice.scrollIntoView({ block: 'nearest' }); return false; };
  const refs = name => (tables[name] || []).map(row => [row.id, `${row.name || row.title || row.label || row.id} · ${row.id}`]);
  const currentMoves = () => Object.entries(draft.moves || {}).map(([id, move]) => [id, `${move.label || id} · ${id}`]);
  const moveSelects = new Set();
  const assetChoices = predicate => assets.filter(item => !predicate || predicate(item.id)).map(item => [item.id, `${item.id}${item.purpose ? ' · ' + item.purpose : ''}`]);
  const grid = () => el('div', 'field-grid');
  function section(title, help = '', collapsible = false) {
    const outer = el(collapsible ? 'details' : 'section', 'section');
    outer.append(el(collapsible ? 'summary' : 'h3', 'section-heading', title));
    if (help) outer.append(el('p', 'field-help', help));
    return outer;
  }
  function wrapField(label, control, help, wide = false) {
    const outer = el('label', `field${wide ? ' field-wide' : ''}`);
    outer.append(el('span', 'field-label', label), control);
    if (help) outer.append(el('span', 'field-help', help));
    return outer;
  }
  function field(label, path, options = {}) {
    const value = getAt(draft, path);
    const input = el(options.multiline ? 'textarea' : 'input', 'field-control');
    if (!options.multiline) input.type = options.number ? 'number' : 'text'; else input.rows = options.rows || 3;
    input.value = value == null ? '' : Array.isArray(value) ? value.join(', ') : String(value);
    if (options.min !== undefined) input.min = String(options.min);
    if (options.max !== undefined) input.max = String(options.max);
    if (options.step !== undefined) input.step = String(options.step);
    if (options.placeholder) input.placeholder = options.placeholder;
    if (options.readOnly) input.readOnly = true;
    input.addEventListener(options.changeOnly ? 'change' : 'input', () => {
      let next = input.value;
      if (options.number) next = input.value === '' ? (options.optional ? undefined : null) : input.valueAsNumber;
      if (options.csv) next = input.value.split(/[,，\n]/).map(item => item.trim()).filter(Boolean);
      if (options.onSet) options.onSet(next); else update(path, next);
    });
    return wrapField(label, input, options.help, options.wide || options.multiline);
  }
  function select(label, path, options, { optional = false, onSet, help } = {}) {
    const input = el('select', 'field-control');
    const populate = () => {
      input.replaceChildren(); const value = getAt(draft, path), pairs = optionPairs(typeof options === 'function' ? options() : options);
      if (optional || value === undefined || value === '') pairs.unshift(['', optional ? '继承／不设置' : '请选择']);
      if (value !== undefined && !pairs.some(([key]) => String(key) === String(value))) pairs.unshift([value, `${value}（当前值）`]);
      for (const [key, text] of pairs) { const opt = el('option', '', text); opt.value = String(key); input.append(opt); }
      input.value = value === undefined ? '' : String(value);
    }; populate(); if (typeof options === 'function') moveSelects.add({ input, populate });
    input.addEventListener('change', () => { const next = optional && input.value === '' ? undefined : input.value; if (onSet) onSet(next); else update(path, next); });
    return wrapField(label, input, help);
  }
  function check(label, path, defaultValue = false, onSet) {
    const input = el('input'); input.type = 'checkbox'; input.checked = getAt(draft, path) ?? defaultValue;
    input.addEventListener('change', () => onSet ? onSet(input.checked) : update(path, input.checked));
    const holder = el('label', 'field checkbox-field'); holder.append(input, el('span', 'field-label', label)); return holder;
  }
  function checks(label, path, choices) {
    const outer = section(label); const line = el('div', 'checkbox-list');
    for (const [id, name] of optionPairs(choices)) {
      const value = getAt(draft, path); const input = el('input'); input.type = 'checkbox'; input.checked = (Array.isArray(value) ? value : []).includes(id);
      input.addEventListener('change', () => { const current = getAt(draft, path), next = new Set(Array.isArray(current) ? current : []); input.checked ? next.add(id) : next.delete(id); update(path, [...next]); });
      const labelNode = el('label'); labelNode.append(input, document.createTextNode(name)); line.append(labelNode);
    }
    outer.append(line); return outer;
  }
  function json(label, path, fallback, { optional = false, open = false, afterApply, applyValue, readValue, help = '' } = {}) {
    const group = section(label, help || '复杂表达式或条件使用 JSON。修改后点击「应用 JSON」才写入草稿。', true); group.open = open;
    const input = el('textarea', 'json-editor'); input.rows = 6; input.spellcheck = false; input.setAttribute('aria-label', label);
    const read = readValue || (() => getAt(draft, path));
    const fingerprint = value => value === undefined ? 'undefined' : JSON.stringify(value);
    let committed, baseFingerprint, conflicted = false;
    const key = ++nextPending;
    const error = el('p', 'field-error'); error.hidden = true; error.setAttribute('role', 'alert');
    const state = el('span', 'field-help', '已应用');
    const refresh = () => {
      const current = read(); committed = JSON.stringify(current ?? fallback, null, 2); baseFingerprint = fingerprint(current); conflicted = false;
      if (input.value !== committed) input.value = committed;
      error.hidden = true; input.removeAttribute('aria-invalid'); state.textContent = '已同步当前草稿';
    };
    const showConflict = () => { error.textContent = '此 JSON 对应的草稿字段已被其他输入修改。已保留你的 JSON；请先「还原 JSON」载入当前草稿，再重新编辑。'; error.hidden = false; input.setAttribute('aria-invalid', 'true'); state.textContent = 'JSON 与当前草稿冲突'; };
    const sync = () => {
      if (!pending.has(key)) refresh();
      else { if (fingerprint(read()) !== baseFingerprint) conflicted = true; if (conflicted) showConflict(); }
    };
    refresh(); jsonControls.set(key, { group, sync }); schedulePrune();
    const clear = () => { pending.delete(key); input.removeAttribute('aria-invalid'); announcePending(); flushPaints(); };
    input.addEventListener('input', () => {
      if (!root.contains(group)) return;
      if (input.value !== committed) {
        if (!pending.has(key)) { baseFingerprint = fingerprint(read()); conflicted = false; }
        pending.add(key); state.textContent = '有未应用的 JSON'; sync();
      } else { pending.delete(key); refresh(); }
      announcePending(); flushPaints();
    });
    const actions = el('div', 'json-actions');
    actions.append(button('应用 JSON', () => {
      if (!root.contains(group)) return;
      try {
        sync();
        if (pending.has(key) && conflicted) throw new Error('该字段已在当前草稿中变化，请先还原 JSON，再基于最新值编辑。');
        const next = input.value.trim() === '' && optional ? undefined : JSON.parse(input.value);
        if (next !== undefined && Array.isArray(fallback) && !Array.isArray(next)) throw new Error('这里需要 JSON 数组。');
        if (next !== undefined && fallback && typeof fallback === 'object' && !Array.isArray(fallback) && (!next || typeof next !== 'object' || Array.isArray(next))) throw new Error('这里需要 JSON 对象。');
        if (applyValue) applyValue(next); else setAt(draft, path, next);
        refresh(); if (afterApply) deferredPaints.add(afterApply); clear(); emit();
      } catch (problem) { error.textContent = `JSON 未应用：${problem.message}`; error.hidden = false; input.setAttribute('aria-invalid', 'true'); pending.add(key); announcePending(); }
    }), button('还原 JSON', () => { if (root.contains(group)) { refresh(); clear(); } }), state);
    group.append(input, actions, error); return group;
  }
  function extras(label, path, excluded, help = '') {
    const readValue = () => Object.fromEntries(Object.entries(getAt(draft, path) || {}).filter(([key]) => !excluded.includes(key)));
    return json(label, path, {}, { readValue, help, applyValue(next) {
      if (!next || Array.isArray(next) || typeof next !== 'object') throw new Error('这里需要一个对象。');
      const current = getAt(draft, path) || {};
      const result = { ...current };
      for (const key of Object.keys(current)) if (!excluded.includes(key)) delete result[key];
      for (const [key, value] of Object.entries(next)) { if (excluded.includes(key)) throw new Error(`${key} 由上方可视化字段编辑，请勿重复设置。`); if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('不允许原型字段。'); result[key] = value; }
      if (!path.length) draft = result; else setAt(draft, path, result);
    } });
  }
  function list(label, path, renderItem, factory, help = '', { collapsible = false, addText = '添加一项' } = {}) {
    const outer = section(label, help, collapsible), content = el('div', 'repeat-list');
    const paint = () => {
      content.replaceChildren(); const value = getAt(draft, path); const items = Array.isArray(value) ? value : [];
      if (value !== undefined && !Array.isArray(value)) content.append(el('p', 'field-error', '当前字段不是数组，请通过高级 JSON 修正。'));
      if (!items.length) content.append(el('p', 'empty-state', '暂无条目'));
      items.forEach((item, index) => {
        const row = el('div', 'repeat-row'); const actions = el('div', 'inline-controls');
        actions.append(el('span', 'badge', String(index + 1)), button('上移', () => { if (index > 0 && guard()) { const current = getAt(draft, path); [current[index - 1], current[index]] = [current[index], current[index - 1]]; emit(); paint(); } }), button('下移', () => { if (index < items.length - 1 && guard()) { const current = getAt(draft, path); [current[index + 1], current[index]] = [current[index], current[index + 1]]; emit(); paint(); } }), button('删除', () => { if (guard()) { getAt(draft, path).splice(index, 1); emit(); paint(); } }));
        row.append(actions, renderItem([...path, index], item, index, paint)); content.append(row);
      });
    };
    outer.append(content, button(addText, () => { if (!guard()) return; const value = getAt(draft, path), items = Array.isArray(value) ? value : []; items.push(factory()); setAt(draft, path, items); emit(); paint(); })); paint(); return outer;
  }
  function references(label, path, options, { help = '', collapsible = false } = {}) {
    return list(label, path, itemPath => select('引用', itemPath, options), () => optionPairs(typeof options === 'function' ? options() : options)[0]?.[0] || '', help, { collapsible });
  }
  function numericExpression(label, path, fallback = 0) {
    const outer = el('div', 'field');
    const paint = () => {
      outer.replaceChildren(); const value = getAt(draft, path);
      if (value !== null && typeof value === 'object') {
        outer.append(json(label + '表达式', path, fallback, { open: true }), button('改为固定数字', () => { if (guard()) { update(path, fallback); paint(); } }));
      } else {
        outer.append(field(label, path, { number: true, placeholder: String(fallback) }), button('使用表达式', () => { if (guard()) { update(path, { stat: 'player.hp' }); paint(); } }));
      }
    }; paint(); return outer;
  }
  function cost(label, path, inherited = false) {
    const outer = el('div', 'field');
    const paint = () => {
      outer.replaceChildren(); const value = getAt(draft, path); const mode = el('select', 'field-control');
      const pairs = [...(inherited ? [['inherit', '继承基础费用']] : []), ['number', '固定香火'], ['X', 'X 费用'], ['null', '无法主动打出']];
      for (const [id, name] of pairs) { const option = el('option', '', name); option.value = id; mode.append(option); }
      mode.value = value === undefined && inherited ? 'inherit' : value === 'X' ? 'X' : value === null ? 'null' : 'number';
      mode.addEventListener('change', () => { update(path, mode.value === 'inherit' ? undefined : mode.value === 'X' ? 'X' : mode.value === 'null' ? null : 1); paint(); });
      outer.append(wrapField(label, mode));
      if (mode.value === 'number') outer.append(field('香火点数', path, { number: true, min: 0 }));
    }; paint(); return outer;
  }
  function defaultEffect(op, enemy = false) {
    const target = enemy ? 'player' : 'enemy';
    const definitions = { damage: { amount: 6, target }, block: { amount: 5 }, energy: { amount: 1 }, loseHp: { amount: 1, cause: 'effect' }, heal: { amount: 3 }, status: { key: 'weak', amount: 1, target }, power: { id: tables.powers?.[0]?.id || '', amount: 1 }, draw: { amount: 1 }, addCard: { cardId: tables.cards?.[0]?.id || '', amount: 1, zone: 'hand' }, exhaust: { selection: 'chosen' }, moveCard: { from: 'discard', to: 'hand', selection: 'chosen' }, copyCard: { selection: 'self', amount: 1, zone: 'discard' }, upgrade: { selection: 'chosen' }, modifyCard: { key: 'rampageDamage', amount: 1, operation: 'add' }, playTop: { exhaust: true }, generateCard: { pool: 'attack' }, repeatNext: { amount: 1 }, if: { condition: true, then: [] }, debt: { amount: 2, delay: 2 }, repay: { amount: 2 }, delayDebt: { amount: 1 }, set: { path: 'strength', value: 1, target: 'source' }, summon: { ids: [tables.enemies?.[0]?.id || ''], inheritHp: false, replaceSource: false }, steal: { amount: 10 }, escape: {}, changeIntent: { move: currentMoves()[0]?.[0] || '' }, transformCards: { from: tables.cards?.[0]?.id || '', to: tables.cards?.[1]?.id || '' }, gold: { amount: 10 }, permanentCard: { cardId: tables.cards?.[0]?.id || '' }, relic: {} };
    return { op, ...clone(definitions[op] || {}) };
  }
  function effects(label, path, enemy = false, depth = 0) {
    const outer = section(label), rows = el('div', 'effect-list');
    const paint = () => {
      rows.replaceChildren(); const value = getAt(draft, path), items = Array.isArray(value) ? value : [];
      if (value !== undefined && !Array.isArray(value)) rows.append(el('p', 'field-error', '效果需要数组，请用高级 JSON 修正。'));
      if (!items.length) rows.append(el('p', 'empty-state', '此处没有效果。'));
      items.forEach((rawEffect, index) => {
        const effect = rawEffect && typeof rawEffect === 'object' && !Array.isArray(rawEffect) ? rawEffect : { op: 'invalid' };
        const itemPath = [...path, index]; const block = el('div', 'effect-block'); const top = el('div', 'inline-controls');
        const opControl = el('select', 'field-control'); opControl.setAttribute('aria-label', `效果 ${index + 1} 操作`);
        const operations = { ...EFFECT_LABELS }; if (!Object.hasOwn(operations, effect.op)) operations[effect.op] = effect.op;
        for (const [op, name] of Object.entries(operations)) { const option = el('option', '', name); option.value = op; opControl.append(option); } opControl.value = effect.op;
        opControl.addEventListener('change', () => { if (!guard()) { opControl.value = effect.op; return; } setAt(draft, itemPath, defaultEffect(opControl.value, enemy)); emit(); paint(); });
        top.append(el('span', 'badge', index + 1), opControl, button('↑', () => { if (index && guard()) { const items = getAt(draft, path); [items[index - 1], items[index]] = [items[index], items[index - 1]]; emit(); paint(); } }), button('↓', () => { if (index < items.length - 1 && guard()) { const items = getAt(draft, path); [items[index + 1], items[index]] = [items[index], items[index + 1]]; emit(); paint(); } }), button('删除效果', () => { if (guard()) { getAt(draft, path).splice(index, 1); emit(); paint(); } }));
        block.append(top); const fields = grid();
        for (const key of NUMERIC_FIELDS[effect.op] || []) fields.append(numericExpression(FIELD_NAMES[key] || key, [...itemPath, key], key === 'hits' || key === 'delay' ? 1 : 0));
        if (['damage', 'block', 'status', 'power', 'set'].includes(effect.op)) fields.append(select('效果目标', [...itemPath, 'target'], TARGETS, { optional: effect.op !== 'damage' }));
        if (effect.op === 'status') fields.append(select('状态', [...itemPath, 'key'], STATUS.map(id => [id, `${STATUS_NAMES[id]} · ${id}`])));
        if (effect.op === 'power') { fields.append(select('能力', [...itemPath, 'id'], refs('powers')), select('持续时间', [...itemPath, 'duration'], [['turn', '当前回合'], ['turnEnd', '玩家回合末'], ['handEnd', '手牌结束'], ['roundEnd', '敌方回合末']], { optional: true })); }
        if (['addCard', 'permanentCard'].includes(effect.op)) fields.append(select('卡牌', [...itemPath, 'cardId'], refs('cards')));
        if (['addCard', 'copyCard'].includes(effect.op)) fields.append(select('目标牌区', [...itemPath, 'zone'], [['hand', '手牌'], ['drawPile', '抽牌堆'], ['discard', '弃牌堆']]));
        if (effect.op === 'exhaust') fields.append(select('消耗范围', [...itemPath, 'selection'], [['chosen', '选择一张'], ['allHand', '全部手牌'], ['nonAttacks', '非攻击牌'], ['randomHand', '随机手牌']]));
        if (effect.op === 'copyCard') fields.append(select('复制来源', [...itemPath, 'selection'], [['self', '自身'], ['chosen', '选择一张']]));
        if (effect.op === 'moveCard') fields.append(select('来源牌区', [...itemPath, 'from'], ['hand', 'drawPile', 'discard', 'exhaust']), select('目标牌区', [...itemPath, 'to'], ['hand', 'drawPile']));
        if (effect.op === 'upgrade') fields.append(select('升级范围', [...itemPath, 'selection'], [['chosen', '选择一张'], ['allHand', '全部手牌']]));
        if (effect.op === 'generateCard') fields.append(select('生成类型', [...itemPath, 'pool'], TYPES.slice(0, 3)));
        if (effect.op === 'modifyCard') fields.append(field('实例字段', [...itemPath, 'key']), select('修改方式', [...itemPath, 'operation'], [['add', '增加'], ['set', '设置']], { optional: true }));
        if (effect.op === 'set') fields.append(field('状态路径', [...itemPath, 'path']), json('设置的值', [...itemPath, 'value'], 0));
        if (effect.op === 'changeIntent') fields.append(select('行动', [...itemPath, 'move'], currentMoves));
        if (effect.op === 'transformCards') fields.append(select('原卡牌', [...itemPath, 'from'], refs('cards')), select('目标卡牌', [...itemPath, 'to'], refs('cards')));
        if (effect.op === 'damage') fields.append(check('无视护甲', [...itemPath, 'ignoreBlock']), check('按攻击计算修正', [...itemPath, 'attack'], true));
        if (effect.op === 'block') fields.append(check('使用敏捷等护甲修正', [...itemPath, 'modified'], true));
        block.append(fields);
        if (effect.op === 'if' && depth < 3) block.append(json('分支条件', [...itemPath, 'condition'], true), effects('条件成立', [...itemPath, 'then'], enemy, depth + 1), effects('条件不成立', [...itemPath, 'else'], enemy, depth + 1));
        if (effect.op === 'summon') block.append(references('召唤阵容', [...itemPath, 'ids'], refs('enemies')));
        block.append(json('完整效果 JSON', itemPath, effect, { afterApply: paint, help: '可编辑未在上方显示的参数。切换操作类型会使用该类型的默认参数。' })); rows.append(block);
      });
    };
    const addLine = el('div', 'inline-controls'), selector = el('select', 'field-control'); selector.setAttribute('aria-label', `新增${label}操作`);
    for (const [id, name] of Object.entries(EFFECT_LABELS)) { const option = el('option', '', name); option.value = id; selector.append(option); }
    addLine.append(selector, button('添加效果', () => { if (!guard()) return; const value = getAt(draft, path), items = Array.isArray(value) ? value : []; items.push(defaultEffect(selector.value, enemy)); setAt(draft, path, items); emit(); paint(); }));
    outer.append(rows, addLine); paint(); return outer;
  }
  function identity(nameKey = 'name') {
    const outer = section('基本信息'); const fields = grid();
    fields.append(field('显示名称', [nameKey]), field('配置标识 ID', ['id'], { help: '修改标识后需同步其他配置的引用；校验会指出失效引用。' })); outer.append(fields); return outer;
  }
  if (table === 'cards') {
    const base = identity(); const fields = grid();
    fields.append(field('卡池', ['pool']), select('机械类型', ['type'], TYPES), select('稀有度', ['rarity'], RARITIES), select('出牌目标', ['target'], [['enemy', '指定敌人'], ['all', '敌方战场'], ['self', '自身']]), cost('出牌费用', ['cost']), field('规则文字', ['text'], { multiline: true }), field('标签（逗号分隔）', ['tags'], { csv: true }));
    base.append(fields); root.append(base, checks('关键词', ['keywords'], [['exhaust', '消耗'], ['ethereal', '虚无'], ['innate', '固有'], ['unplayable', '无法打出']]), effects('基础效果', ['effects']));
    const visual = section('卡面素材', '四层使用游戏现有图片。数字与规则文字由界面排版。'); const visualFields = grid();
    visualFields.append(select('视觉家族', ['visual', 'family'], FAMILIES), select('透明主体', ['visual', 'icon'], assetChoices(id => id.startsWith('card-art-'))), select('抽象背景', ['visual', 'background'], assetChoices(id => id.startsWith('card-pattern-color-'))), select('费用图', ['visual', 'cost'], assetChoices(id => id.startsWith('card-cost-'))), select('命中特效', ['visual', 'impact'], refs('visuals'))); visual.append(visualFields); root.append(visual);
    const upgrade = section('升级配置', '只覆盖变化字段，未设置的字段继承基础版。效果数组为整体替换。'); const upgradeToggle = el('input'); upgradeToggle.type = 'checkbox'; upgradeToggle.checked = Boolean(draft.upgrade);
    const toggleLabel = el('label', 'checkbox-field'); toggleLabel.append(upgradeToggle, document.createTextNode('启用升级版本')); const upgradeBody = el('div');
    const paintUpgrade = () => {
      upgradeBody.replaceChildren(); upgradeToggle.checked = Boolean(draft.upgrade); if (!draft.upgrade) return;
      const upgradeFields = grid();
      upgradeFields.append(field('升级规则文字', ['upgrade', 'text'], { multiline: true, help: '留空时继承基础规则文字。', onSet(value) { update(['upgrade', 'text'], value === '' ? undefined : value); } }), cost('升级费用', ['upgrade', 'cost'], true), select('升级次数策略', ['upgradePolicy'], [['once', '仅一次'], ['repeat', '允许反复升级']], { optional: true }));
      upgradeBody.append(upgradeFields);
      if (Object.hasOwn(draft.upgrade, 'effects')) upgradeBody.append(effects('升级效果', ['upgrade', 'effects']), button('改为继承基础效果', () => { if (guard()) { delete draft.upgrade.effects; emit(); paintUpgrade(); } }));
      else upgradeBody.append(el('p', 'field-help', `当前继承基础版的 ${draft.effects?.length || 0} 条效果。`), button('复制基础效果并覆盖', () => { if (guard()) { draft.upgrade.effects = clone(draft.effects || []); emit(); paintUpgrade(); } }));
      upgradeBody.append(json('完整升级配置 JSON', ['upgrade'], draft.upgrade, { afterApply: paintUpgrade }));
    };
    upgradeToggle.addEventListener('change', () => { if (!guard()) { upgradeToggle.checked = Boolean(draft.upgrade); return; } if (upgradeToggle.checked) draft.upgrade = { text: draft.text, effects: clone(draft.effects || []) }; else delete draft.upgrade; emit(); paintUpgrade(); });
    upgrade.append(toggleLabel, upgradeBody); paintUpgrade(); root.append(upgrade, extras('高级卡牌字段', [], ['id', 'name', 'pool', 'type', 'rarity', 'cost', 'target', 'text', 'effects', 'keywords', 'tags', 'visual', 'upgrade', 'upgradePolicy'], '保留来源、动态文案、出牌条件和触发器等字段。可在这里调整这些结构。'));
  } else if (table === 'enemies') {
    const base = identity(), fields = grid();
    fields.append(select('怪物类别', ['kind'], [['normal', '普通'], ['elite', '精英'], ['boss', '首领']]), select('角色立绘', ['art'], assetChoices()), field('立绘缩放', ['artScale'], { number: true, min: 0.01, max: 10, step: 0.05 }), field('生命下限', ['hpRange', 0], { number: true, min: 1, onSet(value) { setAt(draft, ['hpRange', 0], value); draft.minHp = value; emit(); } }), field('生命上限', ['hpRange', 1], { number: true, min: 1, onSet(value) { setAt(draft, ['hpRange', 1], value); draft.maxHp = value; emit(); } }), field('机制描述', ['description'], { multiline: true })); base.append(fields); root.append(base);
    const moves = section('行动列表', '行动标识在 AI 中引用；删除行动后需同步 AI。行动重命名可通过整条记录 JSON 完成。'), moveBody = el('div', 'repeat-list');
    const paintMoves = () => { moveBody.replaceChildren(); for (const [id, move] of Object.entries(draft.moves || {})) { const block = el('div', 'repeat-row'); const heading = el('div', 'inline-controls'); heading.append(el('code', 'badge', id), button('删除行动', () => { if (guard()) { delete draft.moves[id]; emit(); paintMoves(); } })); block.append(heading, field('行动名称', ['moves', id, 'label']), effects('行动效果', ['moves', id, 'effects'], true), json('行动后续效果', ['moves', id, 'after'], [], { optional: true }), extras('行动附加字段', ['moves', id], ['label', 'effects', 'after'])); moveBody.append(block); } for (const entry of moveSelects) entry.populate(); };
    moves.append(moveBody, button('添加行动', () => { if (!guard()) return; let index = 1; while (draft.moves?.[`move_${index}`]) index++; draft.moves ||= {}; draft.moves[`move_${index}`] = { label: '新行动', effects: [{ op: 'damage', amount: 6, target: 'player' }] }; emit(); paintMoves(); })); paintMoves(); root.append(moves);
    const ai = list('AI 决策规则', ['ai', 'rules'], (path, rule, index, repaint) => {
      const body = el('div'), mode = el('select', 'field-control'); mode.setAttribute('aria-label', `AI规则 ${index + 1} 类型`); for (const [id, name] of [['move', '固定行动'], ['sequence', '行动序列'], ['weighted', '带权选择']]) { const opt = el('option', '', name); opt.value = id; mode.append(opt); } mode.value = rule.sequence ? 'sequence' : rule.weighted ? 'weighted' : 'move';
      mode.addEventListener('change', () => { if (!guard()) { mode.value = rule.sequence ? 'sequence' : rule.weighted ? 'weighted' : 'move'; return; } const next = { ...getAt(draft, path) }; delete next.move; delete next.sequence; delete next.weighted; if (mode.value === 'move') next.move = currentMoves()[0]?.[0] || ''; else if (mode.value === 'sequence') next.sequence = { moves: [currentMoves()[0]?.[0] || ''], loop: true }; else next.weighted = [{ move: currentMoves()[0]?.[0] || '', weight: 1 }]; setAt(draft, path, next); emit(); repaint(); });
      body.append(wrapField('规则类型', mode));
      if (mode.value === 'move') body.append(select('执行行动', [...path, 'move'], currentMoves));
      else if (mode.value === 'sequence') body.append(references('行动序列', [...path, 'sequence', 'moves'], currentMoves), check('序列循环', [...path, 'sequence', 'loop'], true), json('序列索引表达式', [...path, 'sequence', 'index'], 0, { optional: true }));
      else body.append(list('候选行动', [...path, 'weighted'], itemPath => { const fields = grid(); fields.append(select('行动', [...itemPath, 'move'], currentMoves), field('权重', [...itemPath, 'weight'], { number: true, min: 0.001, step: 0.1 }), field('连续次数上限', [...itemPath, 'maxRepeat'], { number: true, min: 1, optional: true }), json('候选条件', [...itemPath, 'when'], true, { optional: true })); return fields; }, () => ({ move: currentMoves()[0]?.[0] || '', weight: 1 })));
      body.append(json('规则条件', [...path, 'when'], true, { optional: true, help: '不设置条件即为无条件规则。至少需要一个不会耗尽的无条件兜底。' })); return body;
    }, () => ({ move: currentMoves()[0]?.[0] || '' }), '从上到下使用第一条满足条件的规则。至少保留一条无条件兜底。'); root.append(ai, json('初始状态', ['initial'], {}), json('机制触发器', ['triggers'], []), json('机制说明与动态展示', ['traits'], []), extras('怪物附加字段', [], ['id', 'name', 'kind', 'art', 'artScale', 'hpRange', 'minHp', 'maxHp', 'description', 'moves', 'ai', 'initial', 'triggers', 'traits']));
  } else if (table === 'acts') {
    const base = identity(), fields = grid(); fields.append(field('幕序号', ['number'], { number: true, min: 1 }), field('描述', ['description'], { multiline: true }), field('前几场使用弱遭遇', ['weakBattleCount'], { number: true, min: 0 })); base.append(fields); root.append(base);
    const starting = section('起始资源'), resourceFields = grid(); for (const [key, label] of [['maxHp', '生命上限'], ['gold', '冥钱'], ['energy', '每回合香火']]) resourceFields.append(field(label, ['starting', key], { number: true, min: key === 'maxHp' ? 1 : 0 })); starting.append(resourceFields, list('起始牌组', ['starting', 'deck'], path => { const row = grid(); row.append(select('卡牌', [...path, 'cardId'], refs('cards')), field('张数', [...path, 'count'], { number: true, min: 1 })); return row; }, () => ({ cardId: tables.cards?.[0]?.id || '', count: 1 })), field('初始法器（逗号分隔）', ['starting', 'relics'], { csv: true })); root.append(starting);
    const pools = section('遭遇与奖励池'), poolFields = grid(); const encounterPools = [...new Set((tables.encounters || []).flatMap(row => row.pools || []))];
    for (const [key, label] of [['weak', '弱遭遇池'], ['strong', '强遭遇池'], ['elite', '精英池'], ['boss', '首领池']]) poolFields.append(select(label, ['encounterPools', key], encounterPools));
    pools.append(poolFields, field('卡池标签（逗号分隔）', ['cardPools'], { csv: true }), references('事件池', ['eventPool'], refs('events'), { collapsible: true }), references('额外指定卡牌', ['specialCards'], refs('cards'), { collapsible: true }));
    const rewards = grid(); for (const [rarity, label] of RARITIES.filter(([id]) => ['common', 'uncommon', 'rare'].includes(id))) { rewards.append(field(`${label}奖励权重`, ['rewards', 'rarityWeights', rarity], { number: true, min: 0 }), field(`${label}阴债牌概率`, ['rewards', 'debtChance', rarity], { number: true, min: 0, max: 1, step: 0.05 })); } pools.append(section('奖励概率'), rewards); root.append(pools);
    const map = section('随机地图', '总层数在修改完成并移出输入框后提交；同步终点附近的首领、休息层及终段上限，保留其他固定节点和更早的显式限制。'), mapFields = grid();
    const floorNotice = el('p', 'field-help'); floorNotice.hidden = true; floorNotice.setAttribute('role', 'status');
    const boundaryInputs = new Map();
    let lastLinkedFloors = draft.map?.floors;
    const changeFloors = value => {
      const previous = Number.isInteger(draft.map.floors) && draft.map.floors >= 2 && draft.map.floors <= 1000 ? draft.map.floors : lastLinkedFloors;
      const changes = [], warnings = [];
      if (Number.isInteger(value) && value >= 2 && value <= 1000 && Number.isInteger(previous) && value !== previous) {
        const delta = value - previous, fixed = draft.map.fixedFloors || {};
        const planned = [];
        if (fixed[previous]?.type === 'boss') planned.push({ from: String(previous), to: String(value), label: '首领', node: fixed[previous] });
        if (fixed[previous - 1]?.type === 'rest') planned.push({ from: String(previous - 1), to: String(value - 1), label: '休息', node: fixed[previous - 1] });
        let allowed = planned;
        // A target occupied by another planned move is free only if that move
        // can also complete. Resolve blockers before deleting any source key.
        for (;;) {
          const sources = new Set(allowed.map(move => move.from));
          const next = allowed.filter(move => !Object.hasOwn(fixed, move.to) || sources.has(move.to));
          if (next.length === allowed.length) break;
          allowed = next;
        }
        for (const move of planned) if (!allowed.includes(move)) warnings.push(`${move.label}目标第${move.to}层已有固定节点，原第${move.from}层已保留，请手动调整`);
        if (allowed.length) {
          const moved = { ...fixed };
          for (const move of allowed) delete moved[move.from];
          for (const move of allowed) { moved[move.to] = move.node; changes.push(`${move.label} ${move.from}→${move.to}层`); }
          draft.map.fixedFloors = moved;
        }
        const endBounds = new Set([previous - 2, previous - 1, previous]);
        for (const [type, floor] of Object.entries(draft.map.constraints?.maxFloor || {})) if (endBounds.has(floor)) {
          const next = floor + delta; draft.map.constraints.maxFloor[type] = next;
          const input = boundaryInputs.get(type); if (input) input.value = String(next);
          changes.push(`${NODE_TYPES.find(([id]) => id === type)?.[1] || type}最晚楼层 ${floor}→${next}`);
        }
        if (Object.keys(draft.map.fixedFloors || {}).some(floor => !Number.isInteger(Number(floor)) || Number(floor) < 1 || Number(floor) > value)) warnings.push('存在超出新层数范围的固定楼层，已保留，请手动调整');
        for (const bound of ['minFloor', 'maxFloor']) if (Object.values(draft.map.constraints?.[bound] || {}).some(floor => !Number.isInteger(floor) || floor < 1 || floor > value)) warnings.push(`存在超出新层数范围的${bound === 'minFloor' ? '最早' : '最晚'}楼层限制，已保留，请手动调整`);
        lastLinkedFloors = value;
      } else if (!Number.isInteger(value) || value < 2 || value > 1000) warnings.push('总层数需为 2–1000 的整数；固定楼层和范围限制暂未联动，请修正后再检查');
      draft.map.floors = value;
      floorNotice.textContent = [...(changes.length ? ['已同步：' + changes.join('；')] : []), ...warnings].join('。');
      floorNotice.hidden = !floorNotice.textContent; floorNotice.className = warnings.length ? 'field-error' : 'field-help'; floorNotice.setAttribute('role', warnings.length ? 'alert' : 'status');
      paintFloors(); emit();
    };
    mapFields.append(field('总层数', ['map', 'floors'], { number: true, min: 2, max: 1000, changeOnly: true, onSet: changeFloors }), field('列数', ['map', 'columns'], { number: true, min: 1, max: 100 }), field('每层节点下限', ['map', 'nodeCount', 0], { number: true, min: 1 }), field('每层节点上限', ['map', 'nodeCount', 1], { number: true, min: 1 }), field('分支概率', ['map', 'branchChance'], { number: true, min: 0, max: 1, step: 0.05 }), field('最大连线数', ['map', 'maxLinks'], { number: true, min: 1 })); map.append(mapFields, floorNotice);
    const fixed = section('固定楼层'), fixedBody = el('div', 'repeat-list');
    const paintFloors = () => { fixedBody.replaceChildren(); for (const [floor, node] of Object.entries(draft.map?.fixedFloors || {}).sort(([a], [b]) => Number(a) - Number(b))) { const row = el('div', 'repeat-row'); const fields = grid(); const input = el('input', 'field-control'); input.type = 'number'; input.min = '1'; input.value = floor;
      input.addEventListener('change', () => { const nextFloor = String(input.valueAsNumber); if (!guard() || !Number.isInteger(input.valueAsNumber) || input.valueAsNumber < 1 || nextFloor !== floor && draft.map.fixedFloors[nextFloor]) { input.value = floor; notice.textContent = '楼层编号必须为未占用的正整数。'; notice.hidden = false; return; } if (nextFloor !== floor) { draft.map.fixedFloors[nextFloor] = node; delete draft.map.fixedFloors[floor]; emit(); paintFloors(); } });
      fields.append(wrapField('楼层', input), select('节点类型', ['map', 'fixedFloors', floor, 'type'], NODE_TYPES), field('节点数', ['map', 'fixedFloors', floor, 'count'], { number: true, min: 1 })); row.append(fields, button('移除固定楼层', () => { if (guard()) { delete draft.map.fixedFloors[floor]; emit(); paintFloors(); } })); fixedBody.append(row); } };
    fixed.append(fixedBody, button('添加固定楼层', () => { if (!guard()) return; draft.map.fixedFloors ||= {}; let floor = 1; while (draft.map.fixedFloors[floor]) floor++; draft.map.fixedFloors[floor] = { type: 'battle', count: 1 }; emit(); paintFloors(); })); paintFloors(); map.append(fixed);
    const weights = section('节点权重与出现范围'), weightFields = grid();
    for (const [type, label] of NODE_TYPES) {
      const maximum = field(`${label}最晚楼层`, ['map', 'constraints', 'maxFloor', type], { number: true, min: 1, optional: true });
      boundaryInputs.set(type, maximum.children[1]);
      weightFields.append(field(`${label}权重`, ['map', 'typeWeights', type], { number: true, min: 0, optional: true }), field(`${label}最早楼层`, ['map', 'constraints', 'minFloor', type], { number: true, min: 1, optional: true }), maximum);
    }
    weights.append(weightFields, checks('不能连续出现', ['map', 'constraints', 'noConsecutive'], NODE_TYPES)); map.append(weights); root.append(map, json('难度修正', ['difficultyModifiers'], []), extras('关卡附加字段', [], ['id', 'name', 'number', 'description', 'weakBattleCount', 'starting', 'encounterPools', 'eventPool', 'cardPools', 'specialCards', 'rewards', 'map', 'difficultyModifiers']));
  } else if (table === 'encounters') {
    const base = identity('label'), fields = grid(); fields.append(field('所属遭遇池（逗号分隔）', ['pools'], { csv: true }), field('抽选权重', ['weight'], { number: true, min: 0.001, step: 0.1 })); base.append(fields);
    const compositionBody = el('div', 'composition-editor');
    const paintComposition = () => {
      compositionBody.replaceChildren();
      const component = (key, label, editor) => {
        const group = el('div', 'composition-part');
        group.append(editor, button(`移除${label}组成`, () => {
          if (!guard()) return;
          if (!Object.hasOwn(draft.composition || {}, key) && !(key === 'bag' && Object.hasOwn(draft.composition || {}, 'count'))) return;
          delete draft.composition[key];
          if (key === 'bag') delete draft.composition.count;
          emit(); paintComposition();
        }));
        return group;
      };
      compositionBody.append(
        component('fixed', '固定阵容', references('固定阵容', ['composition', 'fixed'], refs('enemies'), { help: '固定阵容可与其他组成叠加，最终每场必须为 1–5 只怪物。移除此组成会删除整个 fixed 字段。' })),
        component('variants', '变体阵容', json('变体阵容', ['composition', 'variants'], [], { optional: true, help: '数组中的每个变体可为怪物 ID 数组，或 {enemies:[...],weight:1}。' })),
        component('slots', '随机槽位', json('随机槽位', ['composition', 'slots'], [], { optional: true, help: '每项为 {options:[怪物ID或{id,weight}],count:数量}。' })),
        component('bag', '有限抽袋', references('有限抽袋', ['composition', 'bag'], refs('enemies'), { help: '同一袋中每个位置只抽一次。移除此组成会同时移除抽袋数量 count，不影响其他组成。' })),
        field('抽袋数量', ['composition', 'count'], { number: true, min: 1, optional: true, help: '只有启用有限抽袋时才设置。' })
      );
    };
    paintComposition(); root.append(base, compositionBody, extras('遭遇附加字段', [], ['id', 'label', 'pools', 'weight', 'composition']));
  } else if (table === 'events') {
    const base = identity('title'); base.append(field('事件描述', ['description'], { multiline: true })); root.append(base, list('事件选项', ['choices'], path => { const body = el('div'), fields = grid(); fields.append(field('选项标识', [...path, 'id']), field('标题', [...path, 'title']), field('描述', [...path, 'description'], { multiline: true }), select('进入遭遇', [...path, 'encounterId'], refs('encounters'), { optional: true })); body.append(fields, effects('选项效果', [...path, 'effects']), json('出现条件', [...path, 'when'], true, { optional: true })); return body; }, () => { let index = 1; const ids = (draft.choices || []).map(row => row.id); while (ids.includes(`choice_${index}`)) index++; return { id: `choice_${index}`, title: '新选项', description: '描述此选项的结果。', effects: [] }; }, '至少保留一项无条件可选的退出路径。'), extras('事件附加字段', [], ['id', 'title', 'description', 'choices']));
  } else if (table === 'powers') {
    const base = identity(); base.append(field('能力说明', ['description'], { multiline: true }), select('失效边界', ['expires'], [['turnEnd', '玩家回合结束'], ['handEnd', '手牌结束'], ['roundEnd', '敌方回合结束']], { optional: true }), check('属于负面能力', ['debuff'])); root.append(base, json('事件触发器', ['triggers'], []), json('持续修正', ['modifiers'], {}), extras('能力附加字段', [], ['id', 'name', 'description', 'expires', 'debuff', 'triggers', 'modifiers']));
  } else if (table === 'visuals') {
    const base = identity(); const fields = grid(); fields.append(select('位图素材', ['asset'], assetChoices()), field('时长（毫秒）', ['durationMs'], { number: true, min: 1, max: 10000 }), field('尺寸倍率', ['size'], { number: true, min: 0.01, max: 10, step: 0.05 }), select('锚点', ['anchor'], [['card', '卡牌'], ['target', '目标'], ['bottom', '战场底部']])); base.append(fields); root.append(base); for (const [key, label, count] of [['scale', '缩放', 3], ['rotation', '旋转角度', 2], ['travel', '位移', 2], ['opacity', '透明度', 3]]) { const part = section(label), fields = grid(); for (let index = 0; index < count; index++) fields.append(field(`关键值 ${index + 1}`, [key, index], { number: true, step: 0.05 })); part.append(fields); root.append(part); } root.append(extras('特效附加字段', [], ['id', 'name', 'asset', 'durationMs', 'size', 'anchor', 'scale', 'rotation', 'travel', 'opacity']));
  }
  root.append(el('p', 'form-note', '编辑先保留为草稿。点击上方「检查全部」核对引用与规则，再保存到游戏源表。'));
  return root;
}
