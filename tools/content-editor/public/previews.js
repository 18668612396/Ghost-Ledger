import { cardView } from '/game/src/runtime/effects.js';
import { getCardArtLayout, cardArtTransform } from '/game/src/card-art-layout.js';
import { createConfiguredRoute, createConfiguredEnemy, planConfiguredIntent, getConfiguredIntentView, sampleConfiguredEncounter } from '/game/src/runtime/world.js';

const NODE_LABELS = { battle: '交锋', elite: '精英', boss: '首领', event: '事件', rest: '歇脚', shop: '鬼市', treasure: '宝箱' };
const TYPE_LABELS = { attack: '攻击', skill: '术法', power: '能力', status: '状态', curse: '诅咒' };
const FAMILIES = { strike: '攻伐', ward: '护身', spirit: '灵术', oath: '阴契' };
const preferences = new Map();
const el = (tag, className = '', text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; };
const image = (id, className = '', alt = '') => { const node = el('img', className); node.src = '/assets/' + encodeURIComponent(id) + '.png'; node.alt = alt; node.draggable = false; return node; };
const button = (text, action) => { const node = el('button', 'mini-button', text); node.type = 'button'; node.addEventListener('click', action); return node; };
const place = (node, styles) => { Object.assign(node.style, styles); return node; };
function indexTables(tables, table, record) {
  const content = Object.fromEntries(Object.entries(tables).map(([key, rows]) => [key, Object.fromEntries((Array.isArray(rows) ? rows : []).filter(row => row && typeof row.id === 'string').map(row => [row.id, row]))]));
  if (content[table] && record?.id) content[table][record.id] = record;
  return content;
}
function player(content) {
  return { hp: 80, maxHp: 80, gold: 99, energy: 3, maxEnergy: 3, block: 0, turn: 1, combatTurn: 1, strength: 0, dexterity: 0, weak: 0, exposed: 0, frail: 0, entangled: 0, artifact: 0, hand: [], drawPile: [], discard: [], exhaust: [], powerZone: [], limbo: [], enemies: [], debts: [], powers: {}, pendingChoice: null, combatCounters: { repaid: 0, hpLossEvents: 0, cardsPlayed: 0 }, stats: { battlesStarted: 1 }, actId: Object.keys(content.acts || {})[0], difficulty: 0, contentSnapshot: content };
}
function seeded(seed) { let value = Number(seed) >>> 0; return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; }; }
function note(text) { return el('p', 'field-help', text); }
function error(root, problem) { const message = el('p', 'field-error', `当前草稿无法预览：${problem.message}`); message.setAttribute('role', 'status'); root.append(message, note('请修正字段或运行「检查全部」。预览失败不会修改或保存源表。')); }
function summary(value) { return typeof value === 'number' || typeof value === 'string' ? String(value) : value === undefined ? '' : '表达式'; }
function effectsText(effects) { return (Array.isArray(effects) ? effects : []).map(effect => `${effect.op}${effect.amount !== undefined ? ' ' + summary(effect.amount) : ''}${effect.target ? ' → ' + effect.target : ''}`).join('；') || '无直接效果'; }

export function renderRecordPreview({ table, record, tables }) {
  const root = el('div', 'record-preview');
  const content = indexTables(tables, table, record);
  try {
    if (table === 'cards') {
      const key = `card:${record.id}`;
      let upgraded = preferences.get(key)?.upgraded || false;
      const toolbar = el('div', 'preview-toolbar'), canvas = el('div', 'card-preview-stage');
      const baseButton = button('基础版', () => { upgraded = false; preferences.set(key, { upgraded }); paint(); });
      const upgradeButton = button('升级版', () => { upgraded = true; preferences.set(key, { upgraded }); paint(); }); upgradeButton.disabled = !record.upgrade;
      toolbar.append(baseButton, upgradeButton); root.append(toolbar, canvas);
      const paint = () => {
        canvas.replaceChildren(); baseButton.setAttribute('aria-pressed', String(!upgraded)); upgradeButton.setAttribute('aria-pressed', String(upgraded));
        try {
          const instance = { uid: 'editor-preview', cardId: record.id, upgradeLevel: upgraded && record.upgrade ? 1 : 0 };
          const view = cardView(player(content), instance, content);
          if (!view) throw new Error('卡牌标识或配置缺失。');
          const art = place(el('div', 'preview-card'), { position: 'relative', width: 'min(100%, 248px)', aspectRatio: '4 / 7', margin: '22px auto 14px', isolation: 'isolate', fontFamily: 'KaiTi, STKaiti, serif' });
          art.setAttribute('aria-label', `${view.name}，费用${view.cost ?? '不可打出'}，${view.description}`);
          const visual = view.visual || record.visual || {};
          // Match the game's card geometry in game/src/style.css, including the paper regions.
          const picture = place(el('div', 'card-preview-picture'), { position: 'absolute', left: '6%', top: '10%', width: '88%', height: '67.0476%', overflow: 'hidden' });
          const layout = getCardArtLayout(visual);
          picture.append(place(image(visual.background, 'card-preview-art'), { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover' }), place(image(visual.icon, 'card-preview-icon'), { position: 'absolute', left: `${layout.x}%`, top: `${layout.y}%`, width: '90%', height: 'auto', aspectRatio: '1', maxHeight: '94%', objectFit: 'contain', transform: cardArtTransform(layout), zIndex: '1' }));
          art.append(picture);
          for (let layer = 0; layer < 3; layer++) art.append(place(image(`card-frame-vivid-${visual.family}`, 'card-preview-frame'), { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', zIndex: '2', pointerEvents: 'none' }));
          const cost = place(el('div', 'card-preview-cost'), { position: 'absolute', zIndex: '4', left: '8%', top: '5%', width: '28%', aspectRatio: '1', transform: 'translate(-50%, -64%)', fontFamily: 'Georgia, serif', lineHeight: '1.2' });
          cost.append(place(image(visual.cost, 'card-preview-cost-art'), { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain' }), place(el('strong', 'card-preview-cost-number', view.cost === null ? '—' : view.cost), { position: 'absolute', top: '64%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '23px', color: '#24596a' }));
          art.append(cost, place(el('strong', 'card-preview-title', view.name), { position: 'absolute', left: '12%', top: '3%', width: '76%', textAlign: 'center', fontSize: '19px', lineHeight: '1.3', color: '#fff0d0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', zIndex: '3' }), place(el('span', 'card-preview-type', `${FAMILIES[visual.family] || visual.family} · ${TYPE_LABELS[view.type] || view.type}`), { position: 'absolute', left: '9%', top: '70.5%', width: '82%', textAlign: 'center', fontSize: '12px', lineHeight: '1.3', zIndex: '3' }), place(el('p', 'card-preview-text', view.description), { position: 'absolute', left: '11%', top: '77%', width: '78%', maxHeight: '19%', overflowY: 'auto', margin: '0', fontSize: '14px', lineHeight: '1.35', textAlign: 'center', zIndex: '3', whiteSpace: 'pre-wrap' }));
          canvas.append(art, note('使用当前草稿和游戏原有卡牌求值器。示例上下文：80 生命、3 香火、无阴债；动态文案会随实战状态变化。'));
          const chips = el('div', 'inline-controls'); for (const keyword of view.keywords || []) chips.append(el('span', 'badge', keyword)); canvas.append(chips);
        } catch (problem) { error(canvas, problem); canvas.append(el('p', '', record.text || '')); }
      }; paint();
    } else if (table === 'enemies') {
      root.append(place(image(record.art, 'enemy-preview-art', record.name), { width: '100%', height: '250px', objectFit: 'contain', transform: `scale(${Math.min(2, Math.max(.1, Number(record.artScale) || 1))})` }), el('h3', '', record.name), el('p', 'badge', `生命 ${record.hpRange?.[0] ?? '?'}–${record.hpRange?.[1] ?? '?'} · ${record.kind || 'normal'}`), el('p', '', record.description || ''));
      const state = player(content), random = seeded(42); const enemy = createConfiguredEnemy(record.id, state, 0, content, random); state.enemies = [enemy]; enemy.intent = planConfiguredIntent(state, enemy, content, random);
      const intent = getConfiguredIntentView(state, enemy, content); const section = el('section', 'section'); section.append(el('h4', '', '首轮意图 · 基础难度'), el('strong', '', intent.label), el('p', '', intent.detail)); root.append(section);
      const moves = el('section', 'section'); moves.append(el('h4', '', `${Object.keys(record.moves || {}).length} 种行动`)); for (const [id, move] of Object.entries(record.moves || {})) { const row = el('div', 'repeat-row'); row.append(el('strong', '', move.label || id), note(id), el('p', '', effectsText(move.effects))); moves.append(row); } root.append(moves, note('首轮意图由真实怪物 AI 规划，不执行攻击或保存游戏进度。立绘缩放在此最多展示 2 倍以保持面板可读。'));
    } else if (table === 'acts') {
      root.append(el('h3', '', record.name), el('p', '', record.description || ''));
      const key = `map:${record.id}`, toolbar = el('div', 'preview-toolbar'), seed = el('input', 'field-control'); seed.type = 'number'; seed.min = '0'; seed.max = '4294967295'; seed.value = String(preferences.get(key)?.seed ?? 42); seed.setAttribute('aria-label', '地图预览种子');
      const graph = el('div', 'map-preview-area'); place(graph, { maxHeight: '650px', overflowY: 'auto', width: '100%' });
      const paint = () => {
        graph.replaceChildren();
        try {
          const seedValue = Number(seed.value); if (!Number.isSafeInteger(seedValue) || seedValue < 0 || seedValue > 0xffffffff) throw new Error('种子需为 0–4294967295 的整数。');
          const map = record.map;
          if (!map || !Number.isInteger(map.floors) || map.floors < 2 || map.floors > 1000 || !Number.isInteger(map.columns) || map.columns < 1 || map.columns > 100 || map.floors * map.columns > 10000) throw new Error('预览需为 2–1000 层、1–100 列，且总候选节点不超过 10000。');
          if (!Array.isArray(map.nodeCount) || map.nodeCount.length !== 2 || map.nodeCount.some(value => !Number.isInteger(value) || value < 1 || value > map.columns) || map.nodeCount[1] < map.nodeCount[0]) throw new Error('每层节点数需为列数范围内的正整数区间。');
          if (Object.values(map.fixedFloors || {}).some(node => !node || !Number.isInteger(node.count) || node.count < 1 || node.count > map.columns)) throw new Error('固定楼层节点数量必须在 1 与列数之间。');
          preferences.set(key, { seed: seedValue }); const route = createConfiguredRoute(record.id, seedValue, content); const floors = Math.min(route.floorCount, 60); const nodes = route.nodes.filter(node => node.floor <= floors); const maxCols = route.columnCount;
          graph.append(note(`${route.floorCount} 层 · ${maxCols} 列 · ${route.nodes.length} 个节点 · 首领遭遇 ${route.bossId}`));
          if (route.floorCount > floors) graph.append(note(`为保持编辑流畅，图中显示前 ${floors} 层；实际配置共 ${route.floorCount} 层。`));
          if (maxCols > 8) {
            for (let floor = floors; floor >= 1; floor--) { const row = el('div', 'map-preview-row'); row.append(el('strong', '', `${floor} 层`)); for (const node of nodes.filter(item => item.floor === floor)) row.append(el('span', 'badge', `${node.column + 1}列 ${NODE_LABELS[node.type]}`)); graph.append(row); }
          } else {
            const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns, 'svg'); const width = 330, rowHeight = 46, height = floors * rowHeight + 24; svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.style.width = '100%'; svg.style.display = 'block'; svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', '由当前配置和预览种子生成的路线数据图');
            const positions = new Map(nodes.map(node => [node.id, { x: 56 + (node.column + .5) * ((width - 68) / maxCols), y: (floors - node.floor) * rowHeight + 28 }]));
            for (const node of nodes) for (const targetId of node.next || []) { const from = positions.get(node.id), to = positions.get(targetId); if (!to) continue; const line = document.createElementNS(ns, 'line'); for (const [key, value] of Object.entries({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, stroke: 'currentColor', 'stroke-width': 1, opacity: .28 })) line.setAttribute(key, value); svg.append(line); }
            for (let floor = 1; floor <= floors; floor++) { const label = document.createElementNS(ns, 'text'); label.setAttribute('x', '2'); label.setAttribute('y', String((floors - floor) * rowHeight + 33)); label.setAttribute('font-size', '10'); label.setAttribute('fill', 'currentColor'); label.textContent = `${floor} 层`; svg.append(label); }
            for (const node of nodes) { const position = positions.get(node.id), group = document.createElementNS(ns, 'g'), circle = document.createElementNS(ns, 'circle'), title = document.createElementNS(ns, 'title'), text = document.createElementNS(ns, 'text'); circle.setAttribute('cx', position.x); circle.setAttribute('cy', position.y); circle.setAttribute('r', node.type === 'boss' ? 16 : 13); circle.setAttribute('fill', 'var(--panel, #fff)'); circle.setAttribute('stroke', 'currentColor'); circle.setAttribute('stroke-width', node.type === 'boss' || node.type === 'elite' ? '2' : '1'); text.setAttribute('x', position.x); text.setAttribute('y', position.y + 4); text.setAttribute('text-anchor', 'middle'); text.setAttribute('font-size', '10'); text.setAttribute('fill', 'currentColor'); text.textContent = NODE_LABELS[node.type]?.[0] || node.type; title.textContent = `${node.floor} 层 · ${NODE_LABELS[node.type]} · ${node.label}${node.next?.length ? '，连接 ' + node.next.join(', ') : ''}`; group.append(title, circle, text); svg.append(group); }
            graph.append(svg);
          }
        } catch (problem) { error(graph, problem); }
      };
      toolbar.append(el('span', 'field-label', '路线种子'), seed, button('生成预览', paint)); root.append(toolbar, graph, note('路线由游戏的同一地图生成器计算。新增幕仍需在游戏模式入口登记，保存配置不会自动开放新模式。')); paint();
    } else if (table === 'encounters') {
      root.append(el('h3', '', record.label), note(`遭遇池：${(record.pools || []).join('、')}`)); const roster = el('div', 'encounter-preview'); let seed = 42;
      const paint = () => { roster.replaceChildren(); try {
        const composition = record.composition || {};
        if ((composition.fixed?.length || 0) > 5 || (composition.variants || []).some(variant => (Array.isArray(variant) ? variant.length : variant?.enemies?.length || 0) > 5) || (composition.slots || []).some(slot => !Number.isInteger(slot.count ?? 1) || (slot.count ?? 1) < 1 || (slot.count ?? 1) > 5) || composition.count !== undefined && (!Number.isInteger(composition.count) || composition.count < 1 || composition.count > 5)) throw new Error('每场最多 5 只怪物，请先修正阵容与抽取数量。');
        const sampled = sampleConfiguredEncounter(record.id, seeded(seed), content); for (const id of sampled.enemies) { const enemy = content.enemies[id]; const item = el('div', 'repeat-row'); item.append(place(image(enemy.art, '', enemy.name), { width: '100%', height: '120px', objectFit: 'contain' }), el('strong', '', enemy.name), note(`生命 ${enemy.hpRange?.join('–') || '?'}`)); roster.append(item); } roster.append(note(`本次采样 ${sampled.enemies.length} 只敌人 · 种子 ${seed}`));
      } catch (problem) { error(roster, problem); } };
      root.append(button('重新采样阵容', () => { seed++; paint(); }), roster); paint();
    } else if (table === 'events') {
      root.append(el('h3', '', record.title), el('p', '', record.description)); for (const choice of record.choices || []) { const item = el('section', 'section'); item.append(el('strong', '', choice.title), el('p', '', choice.description), note(effectsText(choice.effects))); if (choice.when !== undefined) item.append(el('span', 'badge', '按游戏上下文判断条件')); if (choice.encounterId) item.append(note('进入遭遇：' + choice.encounterId)); root.append(item); } root.append(note('此处展示选项内容，不执行选项效果或改写存档。'));
    } else if (table === 'powers') {
      root.append(el('h3', '', record.name), el('p', '', record.description), note(`${record.triggers?.length || 0} 个触发器${record.expires ? ' · 失效边界 ' + record.expires : ' · 本场持续'}`));
    } else if (table === 'visuals') {
      root.append(place(image(record.asset, 'effect-preview-art', record.name || record.id), { width: '100%', height: '220px', objectFit: 'contain' }), el('h3', '', record.name || record.id), note(`${record.durationMs} 毫秒 · 锚点 ${record.anchor} · 尺寸 ${record.size}`), note('显示源位图；实际锚定、移动与时序请在游戏战斗中验证。'));
    }
  } catch (problem) { error(root, problem); }
  return root;
}
