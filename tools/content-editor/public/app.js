import { renderRecordEditor } from './forms.js';
import { renderRecordPreview } from './previews.js';

const TABLES = {
  cards: { label: '卡牌', singular: '卡牌', eyebrow: 'CARDS', icon: '▤', description: '费用、规则、升级与卡面表现', file: 'cards.json', filterKey: 'type', filterLabels: { attack: '攻击', skill: '术法', power: '能力', status: '状态', curse: '诅咒' } },
  enemies: { label: '怪物', singular: '怪物', eyebrow: 'ENEMIES', icon: '◈', description: '生命、行动与 AI 决策', file: 'enemies.json', filterKey: 'kind', filterLabels: { normal: '普通', elite: '精英', boss: '首领' } },
  acts: { label: '关卡', singular: '幕', eyebrow: 'WORLD', icon: '⌘', description: '冒险起点、路线与内容池', file: 'acts.json' },
  encounters: { label: '遭遇', singular: '遭遇', eyebrow: 'ENCOUNTERS', icon: '⋈', description: '怪物组合与遭遇抽选', file: 'encounters.json' },
  events: { label: '事件', singular: '事件', eyebrow: 'EVENTS', icon: '◇', description: '叙事选择与事件效果', file: 'events.json' },
  relics: { label: '法器', singular: '法器', eyebrow: 'RELICS', icon: '◉', description: '触发效果、开场修正与出门行装', file: 'relics.json' },
  potions: { label: '药物', singular: '药物', eyebrow: 'POTIONS', icon: '♧', description: '使用目标、场景、售价与效果', file: 'potions.json', filterKey: 'target', filterLabels: { self: '自身', enemy: '指定敌人', all: '敌方战场' } },
  powers: { label: '能力', singular: '能力', eyebrow: 'POWERS', icon: '✧', description: '卡牌与怪物共用的持续能力', file: 'powers.json' },
  visuals: { label: '特效', singular: '特效', eyebrow: 'VISUALS', icon: '↗', description: '已有位图的动画参数', file: 'visual-effects.json' },
};
const TABLE_KEYS = Object.keys(TABLES);
const clone = value => structuredClone(value);
const serial = value => JSON.stringify(value);
const titleOf = row => [row?.name, row?.label, row?.title, row?.id].find(value => typeof value === 'string' && value.trim()) || '未命名配置';
const displayText = value => value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
const app = document.querySelector('#editor-app');
const state = { tables: {}, baseline: {}, assets: [], revision: '', writeToken: '', table: 'cards', index: 0, search: '', filter: '', mode: 'form', history: [], future: [], lastHistoryKey: '', lastHistoryAt: 0, errors: [], checked: null, busy: false, jsonDirty: false, formPending: false, conflict: false, loaded: false, previewTimer: null, toastTimer: null };
const $ = selector => app.querySelector(selector);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = displayText(text);
  return node;
}
function button(label, className, handler) {
  const node = el('button', className, label); node.type = 'button';
  if (handler) node.addEventListener('click', handler);
  return node;
}
function selected() { return state.tables[state.table]?.[state.index] || null; }
function isDirty() { return serial(state.tables) !== serial(state.baseline); }
function hasPending() { return state.jsonDirty || state.formPending || Boolean($('#form-host')?.querySelector('[data-editor-pending="true"], [aria-invalid="true"]')); }
function canNavigate() {
  if (state.busy) return false;
  if (hasPending()) { notify('请先应用或还原尚未提交的 JSON，再继续操作。', 'warning'); return false; }
  return true;
}
function notify(message, tone = 'info') {
  const node = $('#notice'); if (!node) return;
  node.textContent = message; node.dataset.tone = tone; node.hidden = false;
  clearTimeout(state.toastTimer);
  if (tone === 'info') state.toastTimer = setTimeout(() => { node.hidden = true; }, 6500);
}
async function request(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Editor-Token': state.writeToken }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let data;
  try { data = await response.json(); } catch { throw new Error(`服务返回了无法读取的响应（HTTP ${response.status}）。`); }
  if (!response.ok) { const error = new Error(data.message || data.error || `请求失败（HTTP ${response.status}）。`); error.status = response.status; error.errors = data.errors || []; throw error; }
  return data;
}

function changesFor(table) {
  const current = state.tables[table] || [], before = state.baseline[table] || [];
  const oldById = new Map(before.map(row => [row.id, row]));
  const newIds = new Set(current.map(row => row.id));
  const result = [];
  current.forEach((row, index) => {
    if (!oldById.has(row.id)) result.push({ table, row, index, kind: '新增' });
    else if (serial(row) !== serial(oldById.get(row.id))) result.push({ table, row, index, kind: '修改', before: oldById.get(row.id) });
  });
  before.filter(row => !newIds.has(row.id)).forEach(row => result.push({ table, row, index: -1, kind: '删除' }));
  if (!result.length && serial(current) !== serial(before)) result.push({ table, row: { id: '顺序', name: '记录顺序' }, index: -1, kind: '调整' });
  return result;
}
function allChanges() { return TABLE_KEYS.flatMap(changesFor); }
function changedFields(before, after, prefix = '', result = [], depth = 0) {
  if (serial(before) === serial(after) || result.length >= 36) return result;
  if (depth >= 5 || before === null || after === null || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) !== Array.isArray(after)) { result.push(prefix || '整条配置'); return result; }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) changedFields(before[key], after[key], prefix ? `${prefix}.${key}` : key, result, depth + 1);
  return result;
}
function snapshot() { return { tables: clone(state.tables), table: state.table, index: state.index }; }
function pushHistory(key = '') {
  const now = performance.now();
  if (!key || key !== state.lastHistoryKey || now - state.lastHistoryAt > 700) {
    state.history.push(snapshot()); if (state.history.length > 60) state.history.shift();
  }
  state.lastHistoryKey = key; state.lastHistoryAt = now; state.future = [];
}
function markChanged() {
  state.checked = null; state.errors = [];
  refreshChrome(); renderList(); renderValidation(); renderChangeSummary();
  clearTimeout(state.previewTimer); state.previewTimer = setTimeout(renderPreview, 90);
}
function updateRecord(record) {
  if (!selected() || state.busy) return;
  pushHistory(`record-${state.table}-${state.index}`);
  state.tables[state.table][state.index] = clone(record);
  markChanged();
}
function undo(redo = false) {
  if (!canNavigate()) return;
  const from = redo ? state.future : state.history, to = redo ? state.history : state.future;
  if (!from.length) return;
  to.push(snapshot()); const item = from.pop();
  state.tables = item.tables; state.table = item.table; state.index = item.index;
  state.lastHistoryKey = ''; state.jsonDirty = false; state.formPending = false;
  markChanged(); renderSelection();
}

function shell() {
  app.innerHTML = `<div class="workbench">
    <aside class="sidebar" aria-label="配置分类与记录">
      <a class="brand" href="/" aria-label="配置工坊首页"><span class="brand-mark">录</span><span><strong>配置工坊</strong><small>夜渡 · 阴债录</small></span><span class="local-pill">本地</span></a>
      <p class="nav-eyebrow">内容工作区</p><nav id="main-nav" class="main-nav" aria-label="内容分类"></nav>
      <div id="world-tabs" class="world-tabs" aria-label="关卡配置类型" hidden></div>
      <details class="auxiliary-nav"><summary>关联配置</summary><div id="aux-nav"></div></details>
      <div class="catalog-heading"><span id="catalog-label">卡牌目录</span><span id="record-count" class="catalog-count"></span></div>
      <div class="catalog-search"><span aria-hidden="true">⌕</span><input id="search" type="search" placeholder="搜索名称或 ID" aria-label="搜索配置记录" autocomplete="off"/><kbd>/</kbd></div>
      <select id="filter" class="catalog-filter" aria-label="筛选记录类型" hidden></select>
      <div id="record-list" class="record-list" aria-label="配置记录列表"></div>
      <div class="sidebar-bottom"><span class="connection-dot"></span><span>直接编辑本地源表</span><code>game/content/</code></div>
    </aside>
    <section class="main-workspace">
      <header class="topbar"><div class="workspace-breadcrumb">内容工作区 <span>/</span> <strong id="breadcrumb-table">卡牌</strong></div><div class="topbar-status"><span id="save-indicator" class="save-indicator">未修改</span><span class="version-badge">v0.5</span></div></header>
      <div class="workspace-heading"><div><p id="page-eyebrow" class="eyebrow">CARDS</p><h1 id="page-title">卡牌配置</h1><p id="page-description" class="page-description"></p></div><div class="primary-actions"><button type="button" id="validate-button" class="action-button secondary">检查全部</button><button type="button" id="save-button" class="action-button primary">保存全部 <kbd>Ctrl S</kbd></button></div></div>
      <div id="notice" class="notice" role="status" aria-live="polite" hidden></div>
      <div class="workspace-toolbar"><div class="toolbar-group"><button type="button" id="new-button" class="tool-button">＋ 新增</button><button type="button" id="duplicate-button" class="tool-button">复制</button><button type="button" id="delete-button" class="tool-button danger-text">删除</button><span class="toolbar-divider"></span><button type="button" id="undo-button" class="tool-button" title="撤销">↶ 撤销</button><button type="button" id="redo-button" class="tool-button" title="重做">↷ 重做</button></div><div class="toolbar-group"><button type="button" id="import-button" class="tool-button">导入</button><button type="button" id="export-button" class="tool-button">导出</button><button type="button" id="reload-button" class="tool-button">重载源表</button></div></div>
      <section id="validation-panel" class="validation-panel" aria-label="配置校验结果" hidden></section>
      <div id="selection-empty" class="selection-empty" hidden></div>
      <div id="editor-layout" class="editor-layout">
        <section class="record-panel" aria-label="编辑配置"><header class="record-heading"><div><h2 id="record-title"></h2><code id="record-id"></code></div><span id="record-state" class="badge"></span></header>
          <div class="editor-tabs" role="tablist" aria-label="编辑方式"><button type="button" id="form-tab" role="tab" aria-selected="true">可视化编辑</button><button type="button" id="json-tab" role="tab" aria-selected="false">高级 JSON</button><span id="pending-badge" class="pending-badge" hidden>有 JSON 尚未应用</span></div>
          <fieldset id="editor-fieldset" class="editor-fieldset"><div id="form-host" class="form-host"></div><section id="raw-editor" class="raw-editor" hidden><label for="record-json">完整记录 JSON</label><p>可编辑所有高级字段。应用后加入草稿，点击「保存全部」才会写入源表。</p><textarea id="record-json" spellcheck="false" aria-describedby="json-error"></textarea><div id="json-error" class="field-error" role="alert"></div><div class="json-actions"><button type="button" id="apply-json" class="action-button primary">应用到草稿</button><button type="button" id="format-json" class="action-button secondary">格式化</button><button type="button" id="reset-json" class="tool-button">还原此 JSON</button></div></section></fieldset>
        </section>
        <aside class="preview-column" aria-label="草稿预览与变更摘要"><section class="preview-panel"><header class="preview-heading"><div><span class="eyebrow">PREVIEW</span><h2>实时预览</h2></div><span class="preview-live">草稿</span></header><div id="preview-host" class="preview-host"></div><p class="preview-disclaimer">预览当前草稿；通过检查并保存后才会更新源表。</p></section><section class="changes-panel"><div class="changes-heading"><h2>待保存变更</h2><button type="button" id="review-button" class="text-button">查看全部</button></div><div id="change-summary"></div></section><div class="workflow-note"><strong>修改 → 检查 → 保存</strong><p>保存会校验全部引用并保留原文件备份。已有夜巡仍使用创建时的配置快照。</p></div></aside>
      </div>
      <footer class="workspace-footer"><span id="file-path"></span><span id="revision-label"></span></footer>
    </section>
  </div><input id="import-file" type="file" accept="application/json,.json" hidden/><dialog id="editor-dialog" class="editor-dialog" aria-labelledby="dialog-title"><div id="dialog-content"></div></dialog>`;
  bindShell();
}

function bindShell() {
  $('#search').addEventListener('input', event => { state.search = event.target.value; renderList(); });
  $('#filter').addEventListener('change', event => { state.filter = event.target.value; renderList(); });
  $('#validate-button').addEventListener('click', validateAll);
  $('#save-button').addEventListener('click', saveAll);
  $('#new-button').addEventListener('click', () => createRecord(false));
  $('#duplicate-button').addEventListener('click', () => createRecord(true));
  $('#delete-button').addEventListener('click', deleteRecord);
  $('#undo-button').addEventListener('click', () => undo());
  $('#redo-button').addEventListener('click', () => undo(true));
  $('#form-tab').addEventListener('click', () => setMode('form'));
  $('#json-tab').addEventListener('click', () => setMode('json'));
  $('#record-json').addEventListener('input', () => { state.jsonDirty = $('#record-json').value !== JSON.stringify(selected(), null, 2); $('#json-error').textContent = ''; refreshChrome(); });
  $('#apply-json').addEventListener('click', applyJson);
  $('#format-json').addEventListener('click', () => { try { $('#record-json').value = JSON.stringify(JSON.parse($('#record-json').value), null, 2); state.jsonDirty = $('#record-json').value !== JSON.stringify(selected(), null, 2); $('#json-error').textContent = ''; refreshChrome(); } catch (error) { $('#json-error').textContent = `JSON 语法错误：${error.message}`; } });
  $('#reset-json').addEventListener('click', () => { state.jsonDirty = false; $('#record-json').value = JSON.stringify(selected(), null, 2); $('#json-error').textContent = ''; refreshChrome(); });
  $('#form-host').addEventListener('editor-pending', event => { state.formPending = Boolean(event.detail?.pending); refreshChrome(); });
  $('#reload-button').addEventListener('click', reloadWorkspace);
  $('#review-button').addEventListener('click', reviewChanges);
  $('#export-button').addEventListener('click', exportDialog);
  $('#import-button').addEventListener('click', () => { if (canNavigate()) $('#import-file').click(); });
  $('#import-file').addEventListener('change', importFile);
}

function renderNavigation() {
  const nav = $('#main-nav'); nav.replaceChildren();
  for (const table of ['cards', 'enemies', 'acts', 'relics', 'potions']) {
    const active = table === 'acts' ? ['acts', 'encounters', 'events'].includes(state.table) : state.table === table;
    const item = button('', `nav-item${active ? ' active' : ''}`, () => selectTable(table));
    item.append(el('span', 'nav-icon', TABLES[table].icon), el('span', '', TABLES[table].label), el('span', 'nav-count', (state.tables[table] || []).length));
    item.setAttribute('aria-current', active ? 'page' : 'false'); nav.append(item);
  }
  const worldTabs = $('#world-tabs'); worldTabs.replaceChildren(); worldTabs.hidden = !['acts', 'encounters', 'events'].includes(state.table);
  for (const table of ['acts', 'encounters', 'events']) worldTabs.append(button(table === 'acts' ? '幕与路线' : TABLES[table].label, `world-tab${state.table === table ? ' active' : ''}`, () => selectTable(table)));
  const aux = $('#aux-nav'); aux.replaceChildren();
  for (const table of ['powers', 'visuals']) aux.append(button(`${TABLES[table].label} · ${(state.tables[table] || []).length}`, `aux-item${state.table === table ? ' active' : ''}`, () => selectTable(table)));
}
function selectTable(table) {
  if (!canNavigate()) return;
  state.table = table; state.index = 0; state.search = ''; state.filter = ''; state.mode = 'form';
  $('#search').value = ''; renderSelection();
}
function selectRecord(index) {
  if (!canNavigate()) return;
  state.index = index; state.jsonDirty = false; state.formPending = false; renderSelection();
}
function renderFilter() {
  const meta = TABLES[state.table], filter = $('#filter');
  filter.replaceChildren(); filter.hidden = !meta.filterKey;
  if (!meta.filterKey) return;
  const all = el('option', '', '全部类型'); all.value = ''; filter.append(all);
  for (const value of new Set((state.tables[state.table] || []).map(row => row[meta.filterKey]).filter(Boolean))) {
    const option = el('option', '', meta.filterLabels?.[value] || value); option.value = value; filter.append(option);
  }
  filter.value = state.filter;
}
function renderList() {
  const list = $('#record-list'); if (!list) return;
  const rows = state.tables[state.table] || [], meta = TABLES[state.table], text = state.search.trim().toLowerCase();
  const before = new Map((state.baseline[state.table] || []).map(row => [row.id, row]));
  const visible = rows.map((row, index) => ({ row, index })).filter(({ row }) => (!text || `${titleOf(row)} ${displayText(row.id)} ${displayText(row.reference)}`.toLowerCase().includes(text)) && (!state.filter || row[meta.filterKey] === state.filter));
  list.replaceChildren(); $('#record-count').textContent = `${visible.length} / ${rows.length}`;
  if (!visible.length) { list.append(el('p', 'catalog-empty', rows.length ? '没有匹配的记录，试试其他关键词。' : '还没有记录。点击「新增」开始。')); return; }
  for (const { row, index } of visible) {
    const item = button('', `record-item${state.index === index ? ' selected' : ''}`, () => selectRecord(index));
    const marker = el('span', `record-marker family-${row.visual?.family || row.kind || 'default'}`);
    marker.setAttribute('aria-hidden', 'true');
    const content = el('span', 'record-item-copy'); content.append(el('strong', '', titleOf(row)), el('small', '', row.id));
    const changed = !before.has(row.id) || serial(before.get(row.id)) !== serial(row);
    item.append(marker, content);
    if (state.table === 'cards') item.append(el('span', 'list-cost', row.cost === null ? '—' : row.cost ?? '—'));
    if (changed) { const dot = el('span', 'dirty-dot'); dot.title = '尚未保存'; item.append(dot); }
    item.setAttribute('aria-current', state.index === index ? 'true' : 'false'); list.append(item);
  }
}

function renderSelection() {
  const meta = TABLES[state.table];
  state.index = Math.max(0, Math.min(state.index, (state.tables[state.table] || []).length - 1));
  state.formPending = false; state.jsonDirty = false;
  renderNavigation(); renderFilter(); renderList();
  $('#breadcrumb-table').textContent = meta.label; $('#page-eyebrow').textContent = meta.eyebrow;
  $('#page-title').textContent = `${meta.label}配置`; $('#page-description').textContent = meta.description;
  $('#catalog-label').textContent = `${meta.singular}目录`; $('#file-path').textContent = `game/content/${meta.file}`;
  $('#revision-label').textContent = `源表版本 ${state.revision.slice(0, 10)}`;
  const record = selected(); $('#selection-empty').hidden = Boolean(record); $('#editor-layout').hidden = !record;
  if (!record) { const empty = $('#selection-empty'); empty.replaceChildren(el('h2', '', `还没有${meta.singular}配置`), el('p', '', '新增一条记录，或导入已有 JSON。')); refreshChrome(); return; }
  const host = $('#form-host'); host.replaceChildren();
  try { host.append(renderRecordEditor({ table: state.table, record, tables: state.tables, assets: state.assets, onChange: updateRecord })); }
  catch (error) { host.append(el('p', 'form-note', `可视化字段暂时无法展开：${error.message}。可通过高级 JSON 修正此记录。`)); }
  $('#record-json').value = JSON.stringify(record, null, 2); $('#json-error').textContent = '';
  applyMode(); refreshChrome(); renderPreview(); renderChangeSummary();
}
function applyMode() {
  const raw = state.mode === 'json'; $('#form-host').hidden = raw; $('#raw-editor').hidden = !raw;
  $('#form-tab').setAttribute('aria-selected', String(!raw)); $('#json-tab').setAttribute('aria-selected', String(raw));
}
function setMode(mode) {
  if (!canNavigate()) return;
  state.mode = mode;
  // An applied full-record JSON edit must also replace the form's captured copy.
  if (mode === 'form') { renderSelection(); return; }
  $('#record-json').value = JSON.stringify(selected(), null, 2); applyMode();
}
function applyJson() {
  if (state.busy || !selected()) return;
  try {
    const record = JSON.parse($('#record-json').value);
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('每条配置必须是 JSON 对象。');
    state.jsonDirty = false; updateRecord(record); $('#record-json').value = JSON.stringify(record, null, 2); $('#json-error').textContent = '';
    notify('JSON 已应用到草稿，尚未保存源表。'); refreshChrome();
  } catch (error) { $('#json-error').textContent = `无法应用：${error.message}`; }
}
function renderPreview() {
  const host = $('#preview-host'); if (!host || !selected()) return; host.replaceChildren();
  try { host.append(renderRecordPreview({ table: state.table, record: selected(), tables: state.tables, assets: state.assets })); }
  catch (error) { host.append(el('div', 'preview-unavailable', '当前草稿暂时无法预览'), el('p', 'field-help', error.message)); }
}
function renderChangeSummary() {
  const host = $('#change-summary'); if (!host) return; const changes = allChanges(); host.replaceChildren();
  if (!changes.length) { host.append(el('div', 'changes-empty', '没有待保存修改'), el('p', 'field-help', '编辑表单后，可在这里查看变更范围。')); return; }
  const counts = el('div', 'change-badges');
  for (const kind of ['修改', '新增', '删除', '调整']) { const count = changes.filter(item => item.kind === kind).length; if (count) counts.append(el('span', `change-chip change-${kind}`, `${kind} ${count}`)); }
  host.append(counts);
  const tables = TABLE_KEYS.filter(table => changes.some(item => item.table === table));
  host.append(el('p', 'field-help', `${tables.map(table => TABLES[table].label).join('、')} · ${tables.length} 张源表`));
  const current = changes.find(item => item.table === state.table && item.index === state.index);
  if (current?.before) {
    const keys = changedFields(current.before, selected());
    const fields = el('div', 'changed-fields'); for (const key of keys.slice(0, 7)) fields.append(el('code', '', key));
    if (keys.length > 7) fields.append(el('span', 'field-help', `另有 ${keys.length - 7} 处`)); host.append(fields);
  }
}
function refreshChrome() {
  if (!state.loaded) return;
  const dirty = isDirty(), pending = hasPending(), record = selected(), indicator = $('#save-indicator');
  indicator.textContent = state.busy ? '处理中…' : state.conflict ? '源表已变化 · 草稿已保留' : pending ? 'JSON 尚未应用' : dirty ? `${allChanges().length} 条待保存` : '所有修改已保存';
  indicator.dataset.dirty = String(dirty || pending); $('#pending-badge').hidden = !pending;
  $('#record-title').textContent = titleOf(record); $('#record-id').textContent = displayText(record?.id);
  const changed = changesFor(state.table).find(item => item.index === state.index), badge = $('#record-state');
  badge.textContent = changed?.kind || '已保存'; badge.dataset.changed = String(Boolean(changed));
  $('#save-button').disabled = state.busy || !dirty || pending;
  $('#validate-button').disabled = state.busy || pending;
  $('#undo-button').disabled = state.busy || !state.history.length || pending;
  $('#redo-button').disabled = state.busy || !state.future.length || pending;
  for (const id of ['new-button', 'duplicate-button', 'delete-button', 'import-button', 'reload-button']) $(`#${id}`).disabled = state.busy || pending || (['duplicate-button', 'delete-button'].includes(id) && !record);
  $('#editor-fieldset').disabled = state.busy;
  document.title = `${dirty || pending ? '● ' : ''}${titleOf(record)} · 配置工坊`;
}
function renderValidation() {
  const host = $('#validation-panel'); if (!host) return;
  host.replaceChildren(); host.hidden = !state.errors.length && !state.checked;
  if (state.errors.length) {
    host.dataset.valid = 'false'; host.setAttribute('role', 'alert');
    host.append(el('h2', '', `发现 ${state.errors.length} 处配置问题`), el('p', '', '未写入源表。点击问题可定位对应记录。'));
    const list = el('ul', 'validation-errors');
    for (const message of state.errors) {
      const item = el('li'), action = button(message, '', () => {
        const match = message.match(new RegExp(`^(${TABLE_KEYS.join('|')})\\[([^\\]]+)\\]`));
        if (match && canNavigate()) { const index = (state.tables[match[1]] || []).findIndex(row => row.id === match[2]); if (index >= 0) { state.table = match[1]; state.index = index; state.search = ''; state.filter = ''; $('#search').value = ''; renderSelection(); } }
      }); item.append(action); list.append(item);
    }
    host.append(list);
  } else {
    host.dataset.valid = 'true'; host.setAttribute('role', 'status'); host.append(el('strong', '', '全部配置检查通过'), el('span', '', '结构、关联引用与素材均有效。保存时仍会再次检查磁盘版本。'));
  }
}

function uniqueId(table, base) {
  const ids = new Set((state.tables[table] || []).map(row => row.id));
  let id = base, number = 2; while (ids.has(id)) id = `${base}_${number++}`; return id;
}
function defaultRecord(table) {
  const id = uniqueId(table, { cards: 'new_card', enemies: 'new_enemy', acts: 'new_act', encounters: 'new_encounter', events: 'new_event', relics: 'new_relic', potions: 'new_potion', powers: 'new_power', visuals: 'new_visual' }[table]);
  if (table === 'cards') return { id, name: '新卡牌', pool: 'debt', type: 'attack', rarity: 'common', cost: 1, target: 'enemy', text: '造成6点伤害。', effects: [{ op: 'damage', amount: 6, target: 'enemy' }], upgrade: { text: '造成9点伤害。', effects: [{ op: 'damage', amount: 9, target: 'enemy' }] }, keywords: [], tags: [], visual: { family: 'strike', icon: 'card-art-brush', background: 'card-pattern-color-brush', cost: 'card-cost-flame', impact: state.tables.visuals?.find(row => row.id === 'slash')?.id || state.tables.visuals?.[0]?.id } };
  if (table === 'enemies') return { id, name: '新怪物', description: '每回合发动一次攻击。', kind: 'normal', art: state.tables.enemies?.[0]?.art || 'enemy-cultist', artScale: 1, hpRange: [30, 30], moves: { attack: { label: '攻击', effects: [{ op: 'damage', amount: 6, target: 'player' }] } }, ai: { rules: [{ move: 'attack' }] }, initial: {}, triggers: [], traits: [] };
  if (table === 'encounters') return { id, label: '新遭遇', pools: ['custom_pool'], weight: 1, composition: { fixed: [state.tables.enemies?.[0]?.id || 'cultist'] } };
  if (table === 'events') return { id, title: '新事件', description: '阴路上出现了一处新的际遇。', choices: [{ id: 'leave', title: '继续赶路', description: '离开此处。', effects: [] }] };
  if (table === 'relics') return { id, name: '新法器', description: '每场战斗开始获得5点护甲。', art: 'talisman', triggers: [{ event: 'combatStart', effects: [{ op: 'block', amount: 5, modified: false }] }] };
  if (table === 'potions') return { id, name: '新药物', description: '获得12点护甲。', art: 'talisman', target: 'self', usablePhases: ['combat'], price: 30, effects: [{ op: 'block', amount: 12, modified: false }] };
  if (table === 'powers') return { id, name: '新能力', description: '回合开始时获得1点护甲。', triggers: [{ id: 'turn_block', event: 'turnStart', effects: [{ op: 'block', amount: 1 }] }] };
  const first = clone(state.tables[table]?.[0] || {});
  if (table === 'acts') return { ...first, id, name: '新的一幕', number: (state.tables.acts?.length || 1) + 1 };
  return { ...first, id };
}
function createRecord(duplicate) {
  if (!canNavigate()) return;
  let record;
  if (duplicate) {
    if (!selected()) return; record = clone(selected()); record.id = uniqueId(state.table, `${record.id}_copy`);
    const labelKey = Object.hasOwn(record, 'name') ? 'name' : Object.hasOwn(record, 'label') ? 'label' : Object.hasOwn(record, 'title') ? 'title' : null;
    if (labelKey) record[labelKey] += ' · 副本';
  } else record = defaultRecord(state.table);
  pushHistory(); state.tables[state.table].push(record); state.index = state.tables[state.table].length - 1;
  state.search = ''; state.filter = ''; $('#search').value = ''; state.mode = 'form'; markChanged(); renderSelection();
  notify(duplicate ? '已复制为新草稿，请检查标识和关联配置。' : '已新增草稿。新增怪物、遭遇或幕后，还需在对应内容池与入口关联。');
}
function showDialog(title, body, actions = []) {
  const dialog = $('#editor-dialog'), content = $('#dialog-content'); content.replaceChildren();
  const returnFocus = document.activeElement;
  dialog.addEventListener('close', () => { if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); }, { once: true });
  const heading = el('h2', '', title); heading.id = 'dialog-title'; content.append(heading, body);
  const footer = el('div', 'dialog-actions');
  for (const action of actions) footer.append(button(action.label, action.primary ? 'action-button primary' : action.danger ? 'action-button danger' : 'action-button secondary', () => { dialog.close(); action.run?.(); }));
  content.append(footer); dialog.showModal();
}
function deleteRecord() {
  if (!canNavigate() || !selected()) return;
  const name = titleOf(selected()), body = el('div', 'dialog-body');
  body.append(el('p', '', `将「${name}」从当前草稿中删除？`), el('p', 'field-help', '尚未保存时可撤销。若其他配置仍引用此记录，检查会阻止保存，请先调整关联。'));
  showDialog('删除配置记录', body, [{ label: '取消' }, { label: '删除此草稿记录', danger: true, run: () => { pushHistory(); state.tables[state.table].splice(state.index, 1); state.index = Math.min(state.index, state.tables[state.table].length - 1); markChanged(); renderSelection(); } }]);
}
function reviewChanges() {
  const body = el('div', 'review-list'), changes = allChanges();
  if (!changes.length) body.append(el('p', 'field-help', '当前没有待保存修改。'));
  for (const change of changes) {
    const item = el('div', 'review-item'); item.append(el('span', 'badge', change.kind), el('strong', '', titleOf(change.row)), el('code', '', `${TABLES[change.table].label} / ${change.row.id}`));
    if (change.before) item.append(el('p', 'field-help', changedFields(change.before, change.row).join('、'))); body.append(item);
  }
  showDialog('待保存变更', body, [{ label: '返回编辑' }]);
}

async function validateAll() {
  if (!canNavigate()) return null;
  state.busy = true; refreshChrome();
  try {
    const result = await request('/api/validate', { tables: state.tables });
    state.errors = result.errors || []; state.checked = result.valid ? result : null; renderValidation();
    notify(result.valid ? '全部配置检查通过，草稿尚未写入源表。' : `发现 ${state.errors.length} 处问题，源表保持原样。`, result.valid ? 'info' : 'warning');
    return result;
  } catch (error) { handleError(error); return null; }
  finally { state.busy = false; refreshChrome(); }
}
async function saveAll() {
  if (!canNavigate() || !isDirty()) return;
  state.busy = true; refreshChrome();
  try {
    const result = await request('/api/validate', { tables: state.tables });
    state.errors = result.errors || []; state.checked = result.valid ? result : null; renderValidation();
    if (!result.valid) { notify(`发现 ${state.errors.length} 处问题，未写入源表。`, 'warning'); return; }
    const response = await request('/api/save', { tables: state.tables, revision: state.revision });
    const table = state.table, id = selected()?.id;
    installWorkspace(response); state.table = table; const index = state.tables[table]?.findIndex(row => row.id === id); state.index = index >= 0 ? index : 0;
    renderSelection(); renderValidation();
    notify(response.changedTables?.length ? `已保存 ${response.changedTables.length} 张源表，原文件备份已保留。刷新游戏并新开夜巡使用新配置。` : '磁盘配置与草稿一致，无需改写源表。');
  } catch (error) { handleError(error); }
  finally { state.busy = false; refreshChrome(); }
}
function handleError(error) {
  if (error.status === 409) { state.conflict = true; notify('源表已被其他工具修改，未覆盖。当前草稿已保留；请先导出，再重载源表并合并修改。', 'warning'); }
  else notify(error.message || '请求失败，请检查本地服务。', 'error');
  if (error.errors?.length) { state.errors = error.errors; state.checked = null; renderValidation(); }
}
function installWorkspace(data) {
  if (!data.tables || !TABLE_KEYS.every(key => Array.isArray(data.tables[key]))) throw new Error('服务返回的配置表不完整。');
  state.tables = clone(data.tables); state.baseline = clone(data.tables); state.revision = data.revision;
  state.writeToken = data.writeToken || state.writeToken; state.assets = data.assets || state.assets;
  state.history = []; state.future = []; state.lastHistoryKey = ''; state.errors = []; state.checked = null;
  state.jsonDirty = false; state.formPending = false; state.conflict = false; state.loaded = true;
}
async function loadWorkspace() {
  state.busy = true;
  try { const data = await request('/api/workspace'); installWorkspace(data); shell(); renderSelection(); }
  catch (error) {
    if (state.loaded) handleError(error);
    else { app.replaceChildren(); const panel = el('section', 'boot-state'); panel.append(el('span', 'boot-mark', '录'), el('h1', '', '无法读取配置'), el('p', '', error.message), button('重新连接本地服务', 'action-button primary', loadWorkspace)); app.append(panel); }
  } finally { state.busy = false; if (state.loaded) refreshChrome(); }
}
function reloadWorkspace() {
  if (!canNavigate()) return;
  if (!isDirty()) { loadWorkspace(); return; }
  const body = el('div', 'dialog-body'); body.append(el('p', '', '重载将放弃整个工作区尚未保存的草稿。'), el('p', 'field-help', '需要保留草稿时，先导出 JSON，再重载磁盘配置。'));
  showDialog('放弃草稿并重载源表？', body, [{ label: '继续编辑' }, { label: '放弃并重载', danger: true, run: loadWorkspace }]);
}

function exportDialog() {
  if (hasPending()) { notify('请先应用 JSON，再导出完整草稿。', 'warning'); return; }
  const body = el('div', 'dialog-body'), field = el('label', 'field'), select = el('select', 'field-control');
  field.append(el('span', 'field-label', '导出范围'));
  for (const [value, label] of [['table', `当前${TABLES[state.table].label}源表`], ['record', '当前记录'], ['workspace', `全部 ${TABLE_KEYS.length} 张配置表`]]) { const option = el('option', '', label); option.value = value; select.append(option); }
  field.append(select); body.append(field, el('p', 'field-help', '导出包括已应用但尚未保存的草稿，不改变磁盘文件。'));
  showDialog('导出 JSON', body, [{ label: '取消' }, { label: '下载 JSON', primary: true, run: () => {
    const range = select.value;
    const data = range === 'workspace' ? { format: 'ghost-ledger-editor-v1', tables: state.tables } : range === 'record' ? selected() : state.tables[state.table];
    const name = range === 'workspace' ? 'ghost-ledger-workspace.json' : range === 'record' ? `${selected()?.id || 'record'}.json` : TABLES[state.table].file;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
    const link = el('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify('JSON 草稿已导出。');
  } }]);
}
async function importFile(event) {
  const file = event.target.files?.[0]; event.target.value = ''; if (!file || !canNavigate()) return;
  try {
    if (file.size > 4 * 1024 * 1024) throw new Error('导入文件不能超过 4 MiB。');
    const data = JSON.parse(await file.text()); let nextTables = clone(state.tables), description;
    if (Array.isArray(data)) { if (!data.every(row => row && typeof row === 'object' && !Array.isArray(row))) throw new Error('源表数组的每一项必须是配置对象。'); nextTables[state.table] = data; description = `替换当前「${TABLES[state.table].label}」草稿表，共 ${data.length} 条记录。`; }
    else if (data && typeof data === 'object' && data.tables) {
      if (!data.tables || typeof data.tables !== 'object' || Array.isArray(data.tables)) throw new Error('工作区 tables 必须是对象。');
      const keys = Object.keys(data.tables); if (!keys.length || keys.some(key => !TABLE_KEYS.includes(key) || !Array.isArray(data.tables[key]) || !data.tables[key].every(row => row && typeof row === 'object' && !Array.isArray(row)))) throw new Error('工作区包含不支持的表名、非数组源表或无效记录。');
      nextTables = { ...nextTables, ...data.tables }; description = `替换 ${keys.length} 张草稿表：${keys.map(key => TABLES[key].label).join('、')}。`;
    } else if (data && typeof data === 'object' && !Array.isArray(data) && typeof data.id === 'string') {
      const index = nextTables[state.table].findIndex(row => row.id === data.id); if (index >= 0) nextTables[state.table][index] = data; else nextTables[state.table].push(data);
      description = `${index >= 0 ? '替换' : '新增'}「${TABLES[state.table].label}」记录 ${data.id}。`;
    } else throw new Error('支持导入源表数组、带 tables 的工作区，或带 id 的单条配置。');
    const body = el('div', 'dialog-body'); body.append(el('p', '', description), el('p', 'field-help', '导入只修改草稿，原字段完整保留；检查通过并点击保存后才写入源表。'));
    showDialog('导入到当前工作区', body, [{ label: '取消' }, { label: '导入草稿', primary: true, run: () => { pushHistory(); state.tables = clone(nextTables); state.index = 0; state.search = ''; state.filter = ''; $('#search').value = ''; state.mode = 'form'; markChanged(); renderSelection(); notify('已导入草稿，请检查配置及关联引用。'); } }]);
  } catch (error) { notify(`导入失败：${error.message}`, 'error'); }
}

window.addEventListener('beforeunload', event => { if (state.loaded && (isDirty() || hasPending())) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('keydown', event => {
  if ($('#editor-dialog')?.open) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveAll(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.target.closest('input,textarea,[contenteditable]')) { event.preventDefault(); undo(event.shiftKey); }
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.target.closest('input,textarea,[contenteditable]')) { event.preventDefault(); $('#search')?.focus(); }
});

loadWorkspace();
