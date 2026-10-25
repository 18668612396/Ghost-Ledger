import { CARD_DEFS, ENEMY_DEFS, CONTENT, getActivePowers, transition, getEnemyIntent, getEnemies, getCardView, isCardPlayable, getEventView, RELIC_DEFS, POTION_DEFS, debtTotal, debtSchedule, getAvailableNodes, restoreRun, contentFor, getEnemyMechanics } from './engine.js';
import { MODES, getMode, createModeRun } from './modes.js';
import { decorateSkins } from './skins.js';
import { updateCardDrag, resolveCardDrag } from './card-gesture.js';
import { getCardVisual, getCardFamily, COMMON_CARD_ART_IDS } from './card-visuals.js';
import { cardArtStyle } from './card-art-layout.js';
import { pickEnemyTarget } from './combat-targeting.js';
import { getCardEnemyTargets } from './engine.js';
import { renderBattlefield } from './battlefield-view.js';
import { renderCollectionGrid, cardCollectionKey } from './collection-view.js';
import { createEffectsPresenter } from './presentation/effects.js';
import { RELICS, MILESTONES, createProfile, isValidProfile, getRank, getMilestoneProgress, claimMilestone, equipRelic, getAdventureOptions, isDifficultyUnlocked, settleRun } from './progression.js';

const app = document.querySelector('#app');
const SAVE_KEY = 'ghost-ledger.run.v4', PROFILE_KEY = 'ghost-ledger.profile.v2', SOUND_KEY = 'ghost-ledger.sound.v1';
const cardArtIds = new Set(COMMON_CARD_ART_IDS);
const cardTypeLabels = { attack: '攻击', skill: '术法', power: '能力', status: '状态', curse: '诅咒' };
function cardDisplayType(card) { return `${getCardFamily(card).label} · ${cardTypeLabels[card.type]}`; }
const iconNames = ['flame', 'heart', 'shield', 'book', 'sound', 'muted', 'gear', 'arrow', 'close', 'skull', 'lotus', 'cards', 'lantern', 'check', 'debt', 'seal'];
const typeNames = { battle: '交锋', elite: '精英', rest: '歇脚', event: '际遇', treasure: '宝箱', shop: '鬼市', boss: '首领' };
const typeIcons = { battle: 'flame', elite: 'skull', rest: 'lotus', event: 'book', treasure: 'seal', shop: 'lantern', boss: 'skull' };
const collectionRoots = new Set(['compendium', 'deck', 'draw-pile', 'discard', 'exhaust', 'inventory', 'relic']);
const collectionFamilies = [['all', '全部'], ['strike', '攻伐'], ['ward', '护身'], ['spirit', '灵术'], ['oath', '阴契']];
const pileLabels = { 'draw-pile': '抽牌堆', discard: '弃牌堆', exhaust: '消耗堆', deck: '牌组' };
const enemyCategoryLabels = { normal: '普通', elite: '精英', boss: '首领',  };
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function asset(name) { return new URL(`../public/assets/${name}.png`, import.meta.url).href; }
const effectsPresenter = createEffectsPresenter({ root: app, visuals: CONTENT.visuals, assetUrl: asset });
let pendingDragSnapshot = null;
function icon(name, extra = '') {
  const i = Math.max(0, iconNames.indexOf(name));
  return `<span class="icon ${extra}" style="--icon-x:${i % 4 * 100 / 3}%;--icon-y:${Math.floor(i / 4) * 100 / 3}%" aria-hidden="true"></span>`;
}
function art(artId, extra = '') {
  const illustration = cardArtIds.has(artId) ? artId : 'talisman';
  return `<img class="card-art ${extra}" src="${asset(`card-art-${illustration}`)}" alt="" aria-hidden="true" draggable="false"/>`;
}
function navObject(name, extra = '') {
  const position = { bag: [0, 0], shrine: [1, 0], records: [2, 0], brazier: [0, 1], bell: [1, 1], scroll: [2, 1] }[name] || [0, 0];
  return `<span class="nav-art ${extra}" style="--nav-x:${position[0] * 50}%;--nav-y:${position[1] * 100}%" aria-hidden="true"></span>`;
}
function avatarMarkup() { return `<img class="avatar-art" src="${asset('ref-avatar')}" alt="小鬼差" draggable="false"/>`; }
function brushLabel(text, color = 'teal', extra = '') {
  return `<span class="brush-label ${extra}"><img src="${asset(`ref-brush-${color}`)}" alt=""/><span>${text}</span></span>`;
}
function healthMarkup(hp, maxHp, extra = '') {
  return `<div class="brush-health ${extra}" aria-label="${extra ? '敌方' : '玩家'}生命 ${hp}/${maxHp}"><img class="hp-track" src="${asset('ref-brush-red')}" alt="" aria-hidden="true" draggable="false"/><span class="hp-clip" style="width:${Math.max(0, hp / maxHp * 100)}%"><img src="${asset('ref-brush-red')}" alt=""/></span><strong>${hp}<small>/${maxHp}</small></strong></div>`;
}
function relicSymbol(relic) { return relic.id === 'bell' ? navObject('bell', 'relic-symbol') : icon('lantern', 'relic-symbol'); }
function readStored(key) { try { return localStorage.getItem(key); } catch { return null; } }
function readJson(key) { try { return JSON.parse(readStored(key)); } catch { return null; } }
const storedProfile = readJson(PROFILE_KEY), storedRun = readJson(SAVE_KEY);
let profile = isValidProfile(storedProfile) ? storedProfile : createProfile();
let run = restoreRun(storedRun);
let screen = 'home', modal = null, mapPreview = false, selectedUid = null, pendingTarget = null;
let collectionState = { tab: 'cards', filter: 'all' }, collectionRestore = null;
let selectedModeId = MODES.find(mode => !mode.disabled).id, selectedDifficulty = 0, handPage = 0;
let busy = false, soundEnabled = readStored(SOUND_KEY) !== 'off', audioContext = null;
let toastTimer = null, dragStart = null, ignorePointerClick = false, saveWarning = false, lastEarned = 0;
let pendingSaveNotice = storedRun && !run ? '原夜巡存档无法读取，已保留原记录；新开冒险后才会替换。' : '';
function persist(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { if (!saveWarning) { saveWarning = true; pendingSaveNotice = '当前浏览器无法保存进度，请保持页面打开。'; } return false; }
}
function saveRun() { if (run) persist(SAVE_KEY, run); }
function saveProfile() { persist(PROFILE_KEY, profile); }
function settleCurrent(abandoned = false) {
  if (!run) return;
  const result = settleRun(profile, run, { abandoned });
  profile = result.profile;
  if (!result.alreadySettled) lastEarned = result.earned;
  saveProfile();
}
if (run && ['victory', 'defeat'].includes(run.phase)) settleCurrent();
function activeRun() { return run && !['victory', 'defeat'].includes(run.phase); }
function routeLength() { return run?.route?.nodes?.length ? Math.max(...run.route.nodes.map(node => node.row)) + 1 : 5; }
function liveEnemies(state = run) { return state ? getEnemies(state).filter(enemy => enemy.hp > 0 && !enemy.escaped) : []; }
function enemyKey(enemy) { return enemy.uid; }
function viewCard(card, state = run) { return getCardView(state, card); }
function targetingText() {
  if (!pendingTarget) return '';
  const card = run.hand.find(item => item.uid === pendingTarget.uid);
  const name = pendingTarget.kind === 'potion' ? POTION_DEFS[pendingTarget.potionId]?.name : card ? viewCard(card).name : '符箓';
  return `请选择「${name || '符箓'}」的目标 · 点空白取消`;
}
function activeRelic() { return RELICS.find(relic => relic.id === (run?.relicId || 'lamp')); }
function readyClaims() { return MILESTONES.filter(m => { const p = getMilestoneProgress(profile, m.id); return p.completed && !p.claimed; }).length; }
function tone(frequency, duration = .18, volume = .035, delay = 0) {
  if (!soundEnabled) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain(), start = audioContext.currentTime + delay;
    oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, start); oscillator.frequency.exponentialRampToValueAtTime(frequency * .7, start + duration);
    gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(volume, start + .01); gain.gain.exponentialRampToValueAtTime(.001, start + duration);
    oscillator.connect(gain).connect(audioContext.destination); oscillator.start(start); oscillator.stop(start + duration + .02);
  } catch { soundEnabled = false; }
}
function sound(kind) {
  if (kind === 'borrow') { tone(165, .5, .065); tone(330, .7, .03, .06); }
  else if (kind === 'repay') { tone(660, .4); tone(880, .5, .035, .07); }
  else if (['enemy', 'debt', 'defeat'].includes(kind)) { tone(78, .35, .09); tone(57, .4, .07, .05); }
  else if (['victory', 'reward', 'claim'].includes(kind)) [330, 440, 660].forEach((n, i) => tone(n, .6, .045, i * .1));
  else tone(440);
}
function iconButton(action, name, label, extra = '') {
  return `<button class="icon-button ${extra}" data-action="${action}" aria-label="${label}" title="${label}" ${busy ? 'disabled' : ''}>${icon(name)}</button>`;
}
function pageHeader(title, subtitle, backAction = 'home') {
  return `<header class="page-header">${iconButton(backAction, 'arrow', backAction === 'close-map' ? '返回当前遭遇' : '返回主页', 'back-icon')}<div><small>${subtitle}</small><h1>${title}</h1></div>${iconButton('help', 'book', '夜巡小册')}</header>`;
}
function homeMarkup() {
  const rank = getRank(profile), claims = readyClaims(), relic = RELICS.find(r => r.id === profile.equippedRelicId);
  const milestone = MILESTONES.find(m => !getMilestoneProgress(profile, m.id).claimed);
  return `<section class="home-screen" aria-label="鬼差府邸主页">
    <header class="home-header"><button class="profile-entry" data-action="training">${avatarMarkup()}<span>${brushLabel(rank.name)}<small>阅历 ${profile.experience} · ${rank.needed ? `距下阶 ${rank.needed - rank.current}` : '修行圆满'}</small></span></button><div class="home-tools">${iconButton('compendium', 'book', '阴司图鉴')}${iconButton('menu', 'gear', '设置')}</div></header>
    <div class="home-title"><p>阴 司 · 鬼 差 府</p><img src="${asset('ui-logo')}" alt="夜渡 · 阴债录"/><span>灯火可借，归处常在。</span></div>
    <div class="home-bottom"><div class="home-status"><button class="home-relic" data-action="training">${relicSymbol(relic)}<span>今夜法器 · ${relic.name}</span></button><button class="home-milestone" data-action="training">${claims ? `${claims} 项修行可领取` : milestone ? `修行 · ${milestone.title}` : '修行圆满'} ${icon('arrow')}</button></div>
      ${activeRun() ? `<button class="primary-button home-adventure" data-action="continue">${icon('lantern')}<span class="home-adventure-label"><span class="home-adventure-title">继续夜巡</span><small>${run.route.completedIds.length}/${routeLength()} 层 · ${run.hp} 命</small></span>${icon('arrow')}</button><button class="text-button home-new" data-action="modes">另选冒险模式</button>` : `<button class="primary-button home-adventure" data-action="modes">${icon('lantern')}<span class="home-adventure-label"><span class="home-adventure-title">出门闯塔</span></span>${icon('arrow')}</button><p class="home-caption">第一幕 · 奈何之前 / 约 25–40 分钟</p>`}
      <nav class="home-nav" aria-label="府邸功能"><button data-action="training">${navObject('shrine')}<span>修行</span><small>${claims ? '有新解锁' : '解锁 · 法器'}</small></button><button data-action="compendium">${navObject('bag')}<span>图鉴</span><small>符箓 · 百鬼</small></button><button data-action="records">${navObject('records')}<span>夜巡档案</span><small>战绩 · 行迹</small></button></nav><p class="home-footer">第 ${profile.totalRuns + 1} 夜，等你提灯。</p></div></section>`;
}
function modesMarkup() {
  const chosen = getMode(selectedModeId), relic = RELICS.find(r => r.id === profile.equippedRelicId);
  return `<section class="mode-screen">${pageHeader('择一条阴路', '出 门 闯 塔')}<div class="page-scroll mode-content"><p class="page-intro">当前开放阴路夜巡，沿灯火走到判官殿。</p><div class="mode-list">${MODES.map(mode => `<button class="mode-card ${selectedModeId === mode.id ? 'chosen' : ''}" data-action="mode-select" data-mode-id="${mode.id}" aria-pressed="${selectedModeId === mode.id}" ${mode.disabled ? 'disabled' : ''}><span class="mode-emblem">${navObject(mode.id === 'classic' ? 'shrine' : mode.id === 'trial' ? 'brazier' : 'scroll')}</span><span><small>${mode.tag}</small><strong>${mode.name}</strong><p>${mode.description}</p></span><span class="mode-check">${mode.disabled ? '筹备中' : selectedModeId === mode.id ? icon('check') : icon('arrow')}</span></button>`).join('')}</div><div class="departure-options"><h2>出门行装</h2><button class="loadout-line" data-action="training">${relicSymbol(relic)}<span><strong>${relic.name}</strong><small>${relic.id === 'bell' ? '每战开场 +6 护甲' : '每回合首次还债 +3 护甲'} · 点击更换</small></span>${icon('arrow')}</button><div class="difficulty-options" role="group" aria-label="夜巡难度"><button data-action="difficulty" data-level="0" class="secondary-button ${selectedDifficulty === 0 ? 'chosen' : ''}" aria-pressed="${selectedDifficulty === 0}">初巡</button><button data-action="difficulty" data-level="1" class="secondary-button ${selectedDifficulty === 1 ? 'chosen' : ''}" aria-pressed="${selectedDifficulty === 1}" ${isDifficultyUnlocked(profile, 1) ? '' : 'disabled'}>进阶一重${isDifficultyUnlocked(profile, 1) ? '' : ' · 待解锁'}</button></div><p class="small-note">${selectedDifficulty ? '敌人生命 +15%，攻击 +2。' : isDifficultyUnlocked(profile, 1) ? '初巡 · 正常敌人强度。' : '通关后，在修行中开放进阶。'}</p></div></div><footer class="page-bottom"><span>${chosen.estimatedMinutes} 分钟 · 16 层选路 · 普通 / 精英 / 首领</span><button class="primary-button" data-action="depart">${icon('lantern')} 提灯出发 ${icon('arrow')}</button></footer></section>`;
}
function mapMarkup() {
  const available = getAvailableNodes(run).map(n => n.id), width = Math.min(window.innerWidth, 480) - 36;
  const floors = routeLength();
  const height = Math.max(390, (floors - 1) * 112 + 130);
  const chapter = contentFor(run).acts[run.actId], boss = contentFor(run).encounters[run.route.bossId];
  const point = node => ({ x: ((node.column + .5) / run.route.columnCount) * width, y: height - 65 - node.row * 112 });
  const links = run.route.nodes.flatMap(node => node.next.map(id => {
    const next = run.route.nodes.find(n => n.id === id), a = point(node), b = point(next);
    const walked = run.route.path.includes(node.id) && run.route.path.includes(next.id);
    return `<span class="map-path ${walked ? 'walked' : ''}" aria-hidden="true" style="left:${a.x}px;top:${a.y - 2}px;width:${Math.hypot(b.x - a.x, b.y - a.y)}px;transform:rotate(${Math.atan2(b.y - a.y, b.x - a.x)}rad)"></span>`;
  })).join('');
  return `<section class="map-screen">${pageHeader(chapter.name || chapter.title || '阴路夜巡', mapPreview ? '夜 巡 路 线 · 预 览' : '选 择 下 一 站', mapPreview ? 'close-map' : 'home')}<div class="map-summary"><span>${icon('heart')} ${run.hp}/${run.maxHp}</span><button data-action="ledger">${icon('debt')} ${debtTotal(run)} 阴债</button><button data-action="deck">${icon('cards')} ${run.deck.length} 张</button><button data-action="inventory">${art('coin')} ${run.gold} 冥钱</button><span>${run.route.completedIds.length}/${floors} 层</span></div><p class="map-instruction">${mapPreview ? '先完成当前遭遇，再选择下一层。' : `${floors} 层 · 首领 ${boss?.label || boss?.name || '终审'}。精英有法器奖励，休息可恢复或升级。`}</p><div class="map-scroll"><div class="map-field" style="height:${height}px;width:${width}px">${links}${run.route.nodes.map(node => {
    const p = point(node), done = run.route.completedIds.includes(node.id), current = run.route.currentId === node.id;
    const canGo = !mapPreview && available.includes(node.id);
    const passed = run.route.currentId && node.row < run.route.nodes.find(n => n.id === run.route.currentId).row && !done;
    return `<button class="map-node ${canGo ? 'available' : ''} ${done ? 'completed' : ''} ${current ? 'current' : ''} ${passed ? 'bypassed' : ''}" data-action="node-info" data-node-id="${node.id}" style="left:${p.x}px;top:${p.y}px" aria-label="${node.row + 1}层${run.route.columnCount === 3 ? ['左路', '中路', '右路'][node.column] : `第${node.column + 1}路`}，${typeNames[node.type]}：${node.label}${done ? '，已完成' : canGo ? '，可以前往' : current ? '，当前地点' : '，未到达'}"><span class="map-medallion">${icon(done ? 'check' : typeIcons[node.type])}</span><strong>${node.label}</strong><small>${node.row + 1}层 · ${done ? '已走过' : canGo ? '可前往' : typeNames[node.type]}</small></button>`;
  }).join('')}</div></div><footer class="map-legend">${Object.entries(typeNames).map(([type, label]) => `<span>${icon(typeIcons[type])}${label}</span>`).join('')}</footer></section>`;
}
function combatHeader() {
  const node = run.route.nodes.find(n => n.id === run.route.currentId);
  return `<header class="combat-header"><div class="player-sheet"><button class="avatar-button" data-action="menu" aria-label="小鬼差夜巡菜单">${avatarMarkup()}</button><div class="player-strips">${brushLabel('小鬼差')}${healthMarkup(run.hp, run.maxHp)}<div class="player-substats"><span class="player-guard">${icon('shield')}护甲 <strong>${run.block}</strong></span></div></div></div><div class="combat-location"><span>${(node?.row || 0) + 1}层 · ${typeNames[node?.type] || '交锋'}</span><small>第 ${run.combatTurn} 回合</small></div><div class="combat-tools">${iconButton('map', 'book', '查看路线')}${iconButton('menu', 'gear', '夜巡菜单')}</div>${playerStatusMarkup()}</header>`;
}
function playerStatusMarkup() {
  if (!run) return '';
  const states = [['strength', '力'], ['dexterity', '敏'], ['weak', '虚弱'], ['exposed', '易伤'], ['frail', '脆弱'], ['entangled', '缠绕']].filter(([key]) => run[key]);
  return `<button class="player-status-row" data-action="inventory" aria-label="查看当前状态与行囊">${states.length ? states.map(([key, label]) => `<span>${label} ${run[key]}</span>`).join('') : `<span>冥钱 ${run.gold} · 药物 ${run.potions?.length || 0}/3</span>`}</button>`;
}
function arenaMarkup() {
  const enemyTargets = pendingTarget?.kind === 'card' ? getCardEnemyTargets(run, pendingTarget.uid) : null;
  return renderBattlefield(run, { busy, pendingTarget, enemyTargets, asset, icon, healthMarkup, animationTime: performance.now() });
}
function cardLayersMarkup(card) {
  const visual = getCardVisual(card, { latestArtwork: true });
  const frame = `<img src="${asset(visual.frame)}" alt="" draggable="false"/>`;
  return `<span class="card-picture" aria-hidden="true"><img class="card-background" data-card-layer="background" src="${asset(visual.background)}" alt="" draggable="false"/><img class="card-art" data-card-layer="icon" style="${cardArtStyle(visual)}" src="${asset(visual.icon)}" alt="" draggable="false"/></span><span class="card-frame" data-card-layer="frame" aria-hidden="true">${frame.repeat(3)}</span><span class="card-cost" data-card-layer="cost"><img class="card-cost-art" src="${asset(visual.cost)}" alt="" aria-hidden="true" draggable="false"/><span class="card-cost-number">${card.cost ?? '—'}</span></span>`;
}
function cardMarkup(cardId, options = {}) {
  const card = viewCard(options.uid ? { ...options, cardId } : cardId), selected = options.uid === selectedUid && Boolean(options.uid);
  const index = options.index || 0, count = options.count || 1, offset = index - (count - 1) / 2;
  return `<button class="card ${card.type} ${card.upgraded ? 'upgraded' : ''} ${selected ? 'selected' : ''} ${!options.reward && !card.playable ? 'unaffordable' : ''} ${options.reward ? 'reward-card' : ''}" data-action="${options.reward ? 'reward-preview' : 'select'}" data-card-id="${cardId}" data-card-family="${getCardFamily(card).id}" data-uid="${options.uid || ''}" style="--card-index:${index};--card-count:${count};--angle:${offset * 3.5}deg;--lift:${Math.abs(offset) * 7}px" aria-pressed="${selected}" aria-label="${options.reward ? '查看奖励' : '选择手牌'}：${card.name}，${cardTypeLabels[card.type]}，${card.cost === null ? '不可打出' : `${card.cost}香火`}。${escapeHtml(card.description)}">${cardLayersMarkup(card)}<strong class="card-name">${card.name}</strong><small class="card-type">${cardDisplayType(card)}</small><span class="card-description">${card.description}</span></button>`;
}
function fullCardMarkup(cardOrId, state = run) {
  const card = viewCard(cardOrId, state);
  return `<article class="full-card ${card.type}" data-card-id="${card.id}" data-card-family="${getCardFamily(card).id}" aria-label="${card.name}完整卡面，${cardTypeLabels[card.type]}">${cardLayersMarkup(card)}<h3 class="card-name">${card.name}</h3><small class="card-type">${cardDisplayType(card)}</small><p class="card-description">${card.description}</p></article>`;
}
function inspectionMarkup() {
  const selected = run.hand.find(c => c.uid === selectedUid);
  if (!selected) return '';
  const card = viewCard(selected), chooseTarget = card.target === 'enemy' && liveEnemies().length > 1;
  return `<div class="inspection-backdrop"><aside class="card-inspection" role="dialog" aria-modal="true" aria-label="${card.name}详情" tabindex="-1">${iconButton('deselect', 'close', '取消选牌')}${fullCardMarkup(selected)}<button class="secondary-button" data-action="play" ${!card.playable || busy ? 'disabled' : ''}>${!card.playable ? card.reason || '无法打出' : chooseTarget ? '选择目标' : card.target === 'all' ? '对全体打出' : '打出此牌'} ${icon('arrow')}</button><small class="inspection-hint">${chooseTarget ? '确认后点击一个敌人 · 点空白返回' : '点击空白处返回'}</small></aside></div>`;
}
function choiceMarkup() {
  if (!run?.pendingChoice) return '';
  const choice = run.pendingChoice;
  const cards = ['hand', 'drawPile', 'discard', 'exhaust', 'limbo'].flatMap(zone => run[zone]);
  const entries = choice.cardUids.map(uid => cards.find(card => card.uid === uid)).filter(Boolean).map(card => ({ ...cardCollectionEntry(card), key: card.uid, action: 'resolve-choice' }));
  return `<div class="inspection-backdrop"><section class="resolution-choice" role="dialog" aria-modal="true" aria-label="${escapeHtml(choice.title)}" tabindex="-1"><h2>${escapeHtml(choice.title)}</h2><p>点选一张符牌，继续结算</p>${renderCollectionGrid(entries, { asset })}</section></div>`;
}
function combatControls() {
  const next = debtSchedule(run)[0];
  return `<div class="combat-bottom"><div class="debt-row"><button data-action="ledger">${icon('debt')}阴债 <b>${debtTotal(run)}</b><small>${next ? `${next.turnsUntil <= 1 ? '下回合' : `${next.turnsUntil} 回合后`}索命 −${next.hpCost}` : '借火后两回合到期'}</small>${icon('arrow')}</button><button class="combat-relic" data-action="relic" aria-label="查看法器${activeRelic().name}">${relicSymbol(activeRelic())}</button>${inventoryShortcut()}</div><section class="hand" aria-label="手牌">${run.hand.slice(handPage * 5, handPage * 5 + 5).map((card, index, visible) => cardMarkup(card.cardId, { ...card, index, count: visible.length })).join('') || '<p class="empty-hand">符已尽，且待下一回合。</p>'}</section><div class="hand-hint"><span>${handInstruction()}</span>${run.hand.length > 5 ? `<span class="hand-pager"><button data-action="hand-prev" aria-label="上一页手牌" ${handPage === 0 ? 'disabled' : ''}>${icon('arrow', 'flipped')}</button>${handPage + 1}/${Math.ceil(run.hand.length / 5)}<button data-action="hand-next" aria-label="下一页手牌" ${handPage >= Math.ceil(run.hand.length / 5) - 1 ? 'disabled' : ''}>${icon('arrow')}</button></span>` : ''}</div><div class="command-bar"><div class="energy-orb" aria-label="香火 ${run.energy}/${run.maxEnergy}"><strong>${run.energy}<small>/${run.maxEnergy}</small></strong></div><button class="borrow-button" data-action="borrow" ${run.borrowedThisTurn >= 2 || busy ? 'disabled' : ''}><strong>借火 +1</strong><small>${run.borrowedThisTurn >= 2 ? '本回合已借满' : '欠 2 阴债'}</small></button><button class="repay-button" data-action="repay" ${!debtTotal(run) || run.energy < 1 || busy ? 'disabled' : ''}><strong>还愿</strong><small>1 火 · 还 2 债</small></button><button class="end-button" data-action="end-turn" ${busy ? 'disabled' : ''}>${busy ? '阴风袭来…' : '结束回合'}${icon('arrow')}</button></div><footer class="game-footer"><button data-action="draw-pile">${icon('cards')}抽牌 ${run.drawPile.length}</button><span>余火不留 · 回合末弃牌</span><button data-action="discard">${icon('cards')}弃牌 ${run.discard.length}</button></footer></div>`;
}
function rewardMarkup() {
  return `<section class="encounter-page">${pageHeader('收下一道新符', '交 锋 告 捷')}<div class="encounter-content"><p class="page-intro">轻点符箓查看完整卡面，确认后收入牌组。</p>${rewardInfoMarkup()}<div class="reward-options">${run.rewards.map(id => cardMarkup(id, { reward: true })).join('')}</div><p class="reward-debt">${icon('debt')}${debtTotal(run) ? `${debtTotal(run)} 点阴债仍将随你赶路。` : '账上清白，灯火未熄。'}</p></div><footer class="page-bottom"><button class="secondary-button" data-action="reward-skip">不取新符，返回路线 ${icon('arrow')}</button><p class="small-note">牌组并非越厚越好，留下能配合的符。</p></footer></section>`;
}
function eventMarkup() {
  const event = getEventView(run) || run.event;
  return `<section class="encounter-page">${pageHeader(event.title, '阴 路 逢 客')}<div class="encounter-content event-content"><div class="event-vignette"><div class="event-illustration">${art(['soup', 'rest', 'upgrade'].includes(event.id) ? 'lotus' : event.id === 'shrine' ? 'bell' : 'coin')}</div><div class="event-copy scroll-surface"><p>${escapeHtml(event.description)}</p><small>生命 ${run.hp}/${run.maxHp} · 阴债 ${debtTotal(run)} · 冥钱 ${run.gold} · 歇脚不推进债期</small></div></div><div class="event-choices">${event.choices.map((choice, i) => `<button class="event-choice" data-action="event" data-choice-id="${choice.id}" ${choice.disabled ? 'disabled' : ''}><span class="choice-number">${i + 1}</span><span><strong>${escapeHtml(choice.title)}</strong><small>${escapeHtml(choice.description)}</small></span>${icon('arrow')}</button>`).join('')}</div></div></section>`;
}
function endingMarkup() {
  const won = run.phase === 'victory', record = profile.history.find(item => item.runId === run.runId), earned = record?.experience ?? lastEarned;
  return `<section class="ending-page">${pageHeader('夜巡归档', won ? '长 夜 将 明' : '灯 火 暂 歇')}<div class="ending-content"><div class="ending-emblem">${icon(won ? 'lotus' : 'lantern')}</div><h2>${won ? '此夜，债清。' : '此夜，未渡。'}</h2><p>${won ? '借契已清，府中灯火等你归来。' : run.lastEvent?.cause === 'debt' ? '阴债索命，请在到期前还愿。' : '灯火暂熄，记住鬼怪的意图，再来一夜。'}</p><div class="ending-stats"><span><strong>${run.stats.battlesWon}</strong>交锋胜场</span><span><strong>${run.stats.repaid}</strong>偿还阴债</span><span><strong>+${earned}</strong>修行阅历</span></div><p class="small-note">${readyClaims() ? `${readyClaims()} 项修行已达成，回府后可以领取。` : '夜巡见闻已入档，下次出门从新的牌组开始。'}</p><button class="primary-button" data-action="home">${icon('lantern')} 回府修行 ${icon('arrow')}</button><button class="text-button" data-action="ledger">翻看这一夜的账</button></div></section>`;
}
function trainingContent() {
  const rank = getRank(profile);
  return `<p class="panel-intro">${rank.name} · 阅历 ${profile.experience}<br><small>${rank.needed ? `${rank.current}/${rank.needed}，再得 ${rank.needed - rank.current} 阅历晋阶。` : '修行圆满。'}称号记录见闻。</small></p><h3>夜巡修行</h3><p class="small-note">夜巡结束或主动放弃时结算。解锁影响下一次出门。</p>${MILESTONES.map(m => {
    const p = getMilestoneProgress(profile, m.id);
    return `<article class="milestone"><div><strong>${m.title}</strong><span>${Math.min(p.current, p.goal)}/${p.goal}</span></div><p>${m.requirement}</p><p>${m.rewardsDescription}</p><button class="secondary-button" data-action="claim" data-id="${m.id}" ${!p.completed || p.claimed ? 'disabled' : ''}>${p.claimed ? '已领取' : p.completed ? '领取解锁' : '尚在修行'}</button></article>`;
  }).join('')}<h3>出门法器 · 择一携带</h3>${RELICS.map(relic => {
    const locked = relic.unlockId && !profile.claimed.includes(relic.unlockId);
    return `<article class="relic-entry"><span class="relic-illustration">${relic.id === 'bell' ? art('bell') : icon('lantern')}</span><div><strong>${relic.name}</strong><p>${relic.description}</p><button class="secondary-button" data-action="equip" data-relic-id="${relic.id}" ${locked || profile.equippedRelicId === relic.id ? 'disabled' : ''}>${locked ? '完成初巡阴路解锁' : profile.equippedRelicId === relic.id ? '已装备' : '出门携带'}</button></div></article>`;
  }).join('')}<p class="small-note">新开第一幕以 80 生命与十张基础牌出发，胜战回 6 生命。每次新开重置牌组，本局法器与升级不会永久继承。</p>`;
}
function currentModalKind(value = modal) { return typeof value === 'string' ? value : value?.kind; }
function cardCollectionEntry(instance, { key, count, base = false } = {}) {
  const card = viewCard(instance, base ? null : run);
  const visual = getCardVisual(card, { latestArtwork: true });
  return {
    key: key ?? cardCollectionKey(card), name: card.name,
    icon: visual.icon, background: visual.background, family: getCardFamily(card).id,
    typeLabel: cardDisplayType(card), cost: card.cost, ...(count !== undefined ? { count } : {}),
    upgraded: Boolean(card.upgraded), locked: false,
    action: 'collection-card', cardId: card.id, instance, base,
  };
}
function compareCollectionNames(first, second) { return first.name.localeCompare(second.name, 'zh-CN'); }
function collectionFiltersMarkup() {
  return `<nav class="collection-filters" aria-label="符箓分组">${collectionFamilies.map(([id, label]) => `<button data-action="collection-filter" data-filter="${id}" aria-pressed="${collectionState.filter === id}">${label}</button>`).join('')}</nav>`;
}
function compendiumEntries() {
  if (collectionState.tab === 'enemies') {
    const categoryOrder = ['normal', 'elite', 'boss'];
    return Object.values(ENEMY_DEFS).map(enemy => ({
      key: `enemy:${enemy.id}`, name: enemy.name, icon: enemy.art,
      typeLabel: enemyCategoryLabels[enemy.kind], category: enemy.kind,
      action: 'collection-enemy', enemyId: enemy.id,
    })).sort((a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category) || compareCollectionNames(a, b));
  }
  return Object.keys(CARD_DEFS).map(id => cardCollectionEntry(id, { key: `card:${id}`, base: true }))
    .filter(entry => collectionState.filter === 'all' || entry.family === collectionState.filter)
    .sort((a, b) => collectionFamilies.findIndex(([id]) => id === a.family) - collectionFamilies.findIndex(([id]) => id === b.family) || compareCollectionNames(a, b));
}
function compendiumContent() {
  const entries = compendiumEntries(), enemies = collectionState.tab === 'enemies';
  const tabs = `<nav class="collection-tabs" aria-label="图鉴分类">${[['cards', '符箓'], ['enemies', '百鬼']].map(([id, label]) => `<button data-action="collection-tab" data-tab="${id}" aria-pressed="${collectionState.tab === id}">${label}</button>`).join('')}</nav>`;
  const filters = enemies ? '' : collectionFiltersMarkup();
  return `${tabs}${filters}<p class="collection-summary">${enemies ? `共${entries.length}位 · 普通／精英／首领` : `共${entries.length}种符箓 · 点选查看基础卡面`}</p>${renderCollectionGrid(entries, { asset, emptyMessage: '这一组暂时没有条目。' })}<p class="collection-footnote">${enemies ? '这里只记录百鬼资料，点选不会进入战斗。' : '图鉴供查看全部符箓；查看不会获得或打出卡牌。'}</p>`;
}
function recordsContent() {
  return `<div class="record-summary"><span><strong>${profile.totalRuns}</strong>结算夜巡</span><span><strong>${profile.wins}</strong>平安通关</span><span><strong>${profile.totalBattles}</strong>拘魂胜场</span><span><strong>${profile.totalRepaid}</strong>已还阴债</span></div><h3>最近的夜</h3>${run && ['victory', 'defeat'].includes(run.phase) ? '<button class="secondary-button" data-action="continue">回看最近一次结算</button>' : ''}${profile.history.map((item, i) => `<article class="history-entry"><strong>第 ${profile.totalRuns - i} 夜 · ${item.won ? '平安归来' : item.abandoned ? '收灯归府' : '灯火未渡'}</strong><p>${getMode(item.modeId)?.name || '阴路夜巡'} · ${item.difficulty ? '进阶一重' : '初巡'} · ${item.steps} 层</p><small>胜战 ${item.battles} · 还债 ${item.repaid} · 阅历 +${item.experience}</small></article>`).join('') || '<p>档案还是空白。出门走过一夜，带回你的故事。</p>'}<p class="small-note">最近 10 次记录保存在此浏览器。回府休息保留当前冒险，结束或主动放弃才记入档案。</p>`;
}
function helpContent() {
  return "<p class=\"panel-intro\">府中整装，出门择路，见鬼出牌。</p><h3>第一幕：十六层阴路</h3><p>新开夜巡以80生命、十张基础牌出发。第一层普通战，第九层宝箱，第十五层休息，第十六层是地图预告的终审首领。前三场普通交锋从弱遭遇池取怪，之后进入强遭遇池。精英更危险，也会奖励法器；鬼市可买牌、药物或删除一张牌。休息可回复30%最大生命，或升级一张具体的牌。胜战恢复6生命。</p><h3>多怪交锋与目标</h3><p>鬼怪各有自己的生命、护甲、状态和意图，按序号依次行动。单击手牌查看详情，点空白关闭。单体牌可从详情进入选择目标，再点一个鬼怪；也可以拖到具体鬼怪身上松手。单体攻击需松在怪物身上，空白处松手会取消。自身牌向下拖到蓝色引导区；群攻向上拖向战场。拖出又拖回只归位，不打开详情。</p><h3>回合与状态牌</h3><p>每回合3香火、抽5张牌。力量增加每段攻击，虚弱降低攻击25%，易伤使受到的攻击增加50%，脆弱降低卡牌格挡25%。护甲和余火通常不跨回合。黏液可花1香火消耗；眩晕不可使用，回合结束仍在手中便消耗；灼伤不可使用，留在手中会在敌人行动前造成2点伤害，升级灼伤4点，可以被护甲抵挡。战斗生成的状态牌不会永久加入牌组。</p><h3>借来的火，总要还</h3><p>借火立即+1香火并欠2阴债，每回合最多两次。第1回合借的债，在第3回合开始到期，每点扣2生命、无视护甲。还愿花1香火还最早的2债；引魂灯每回合首次实际还债额外+3护甲。多只怪物行动后只推进一次债期，事件不推进，进入下一战推进一次。通过终审才勾销余债。</p><h3>行囊与存档</h3><p>行囊列出本局法器、药物与玩家状态；药物不花香火，单体药物需要选目标。菜单可以回府暂歇并保存；继续夜巡恢复原局。本版本使用新的存档格式，请从新夜巡开始。</p><p class=\"small-note\">键盘：1–5看手牌，Enter确认；选择目标时1–5选择鬼怪；B借火，R还愿，E结束回合，Esc取消。拖牌不限制距离，手牌超过5张可翻页。真实手机触控与最终体验仍待试玩。</p>";
}
function ledgerContent() {
  return `<p class="panel-intro">尚欠阴债 <b>${debtTotal(run)}</b><br><small>每点到期扣 2 生命，护甲无法抵挡。</small></p>${debtSchedule(run).map(entry => `<article class="ledger-entry"><strong>${entry.turnsUntil <= 1 ? '下回合开始' : `${entry.turnsUntil} 回合后开始`} · 第 ${entry.dueTurn} 巡更回合</strong><p>${entry.amount} 点阴债 → 索命 ${entry.hpCost} 生命</p></article>`).join('') || '<p>账上清白，莫忘还愿。</p>'}<h3>这一夜的动静</h3><ol class="battle-log">${run.log.slice().reverse().map(entry => `<li>${escapeHtml(entry)}</li>`).join('')}</ol>`;
}
function pileInstances(kind) {
  return kind === 'draw-pile' ? run.drawPile : kind === 'discard' ? run.discard : kind === 'exhaust' ? run.exhaust : run.deckCards || run.deck.map(cardId => ({ cardId }));
}
function pileEntries(kind) {
  const groups = new Map();
  for (const instance of pileInstances(kind)) {
    const card = viewCard(instance), key = cardCollectionKey(card);
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, cardCollectionEntry(instance, { key, count: 1 }));
  }
  // Sort the newly created presentation groups, never the actual draw order.
  return [...groups.values()]
    .filter(entry => collectionState.filter === 'all' || entry.family === collectionState.filter)
    .sort((a, b) => compareCollectionNames(a, b) || Number(a.upgraded) - Number(b.upgraded));
}
function deckContent(kind) {
  const entries = pileEntries(kind);
  const note = kind === 'draw-pile' ? '按种类归组展示，不代表真实抽牌顺序。' : kind === 'discard' ? '抽牌堆空时，弃牌会洗回。' : kind === 'exhaust' ? '这些牌本场不再抽取；临时状态牌不会永久加入牌组。' : '今夜的永久牌组；升级版与基础版分开归组。';
  return `<nav class="collection-tabs" aria-label="查看牌堆">${Object.entries(pileLabels).map(([id, label]) => `<button data-action="collection-pile" data-tab="${id}" data-pile="${id}" aria-pressed="${kind === id}">${label}</button>`).join('')}</nav>${collectionFiltersMarkup()}<p class="collection-summary">共${pileInstances(kind).length}张 · 当前${entries.length}种</p>${renderCollectionGrid(entries, { asset, emptyMessage: `${pileLabels[kind]}的这一组暂时没有符牌。` })}<p class="collection-footnote">${note} 点击只看详情，不会出牌。</p>`;
}
function itemIcon(id, definition) {
  const artId = cardArtIds.has(definition.art) ? definition.art : id === 'lamp' ? 'lotus' : id === 'bell' ? 'bell' : 'talisman';
  return `card-art-${artId}`;
}
function inventoryEntries() {
  const potions = new Map();
  for (const potion of run.potions || []) {
    const definition = POTION_DEFS[potion.id], key = `potion:${potion.id}`, existing = potions.get(key);
    if (existing) existing.count += 1;
    else potions.set(key, { key, name: definition.name, icon: itemIcon(potion.id, definition), typeLabel: '药物', count: 1, action: 'collection-item', itemKind: 'potion', itemId: potion.id, itemUid: potion.uid });
  }
  const relics = (run.relics || [run.relicId || 'lamp']).map(id => {
    const definition = RELIC_DEFS[id] || RELICS.find(relic => relic.id === id);
    return { key: `relic:${id}`, name: definition.name, icon: itemIcon(id, definition), typeLabel: '法器', count: 1, action: 'collection-item', itemKind: 'relic', itemId: id };
  });
  return [...potions.values()].sort(compareCollectionNames).concat(relics.sort(compareCollectionNames));
}
function inventoryContent() {
  const entries = inventoryEntries();
  const statuses = [['strength', '力量'], ['dexterity', '敏捷'], ['weak', '虚弱'], ['exposed', '易伤'], ['frail', '脆弱'], ['entangled', '缠绕']].filter(([key]) => run[key]);
  const powers = getActivePowers(run);
  return `<p class="collection-summary">冥钱 ${run.gold} · 药物 ${run.potions.length}/3 · 物品共${entries.reduce((sum, entry) => sum + entry.count, 0)}件</p>${statuses.length ? `<p class="collection-footnote">当前状态：${statuses.map(([key, label]) => `${label} ${run[key]}`).join(' · ')}</p>` : ''}${powers.length ? `<div class="active-powers"><h3>已生效能力</h3>${powers.map(power => `<p><strong>${escapeHtml(power.name)} ×${power.amount}</strong><small>${escapeHtml(power.description)}</small></p>`).join('')}</div>` : ''}${renderCollectionGrid(entries, { asset, emptyMessage: '行囊还是空的。' })}<p class="collection-footnote">点击查看物品详情；药物在详情中确认使用，法器在本局持续生效。</p>`;
}
function collectionEntries(kind = currentModalKind()) {
  return kind === 'compendium' ? compendiumEntries() : Object.hasOwn(pileLabels, kind) ? pileEntries(kind) : ['inventory', 'relic'].includes(kind) && run ? inventoryEntries() : [];
}
function inventoryShortcut() { return `<button class="inventory-shortcut" data-action="inventory" aria-label="行囊与药物">${icon('cards')}行囊${run.potions?.length ? ` ${run.potions.length}` : ''}</button>`; }
function handInstruction() { return pendingTarget ? targetingText() : selectedUid ? '点击空白关闭详情' : '点牌细看 · 攻敌上拖 · 护身下拖'; }
function rewardInfoMarkup() {
  if (!run?.rewardInfo) return '';
  const info = run.rewardInfo;
  return `<p class="reward-gains">${info.gold ? `冥钱 +${info.gold}` : ''}${info.relicId ? ` · 法器：${RELIC_DEFS[info.relicId]?.name || info.relicId}` : ''}${info.potionId ? ` · 药物：${POTION_DEFS[info.potionId]?.name || info.potionId}` : ''} · 已自动收下</p>`;
}
function collectionTitle(value) {
  const kind = currentModalKind(value);
  return kind === 'compendium' ? '阴司图鉴' : kind === 'deck' ? '随身符匣' : pileLabels[kind] || '行囊';
}
function openCollectionDetail(action, key) {
  if (!collectionRoots.has(currentModalKind())) return;
  const entry = collectionEntries().find(item => item.key === key && item.action === action);
  if (!entry) return;
  const parent = { modal, collectionState: { ...collectionState }, scrollTop: app.querySelector('.modal-content')?.scrollTop || 0, focusKey: entry.key };
  modal = { kind: 'collection-detail', entry, parent };
  collectionRestore = { scrollTop: 0 };
  render();
}
function collectionDetailMarkup() {
  const { entry, parent } = modal;
  const backLabel = `返回${collectionTitle(parent.modal)}`;
  if (entry.action === 'collection-card') {
    const cardState = entry.base ? null : run, card = viewCard(entry.instance, cardState);
    const quantity = entry.count === undefined ? '图鉴基础版' : `本页共${entry.count}张${entry.upgraded ? '升级版' : '基础版'}`;
    const note = entry.locked ? '奖励池尚未解锁；完成「有借有还」后可在后续冒险中取得。' : card.type === 'status' ? '这是战斗产生的状态牌，不会永久加入冒险牌组。' : '仅查看卡面；不会打出、消耗或获得这张牌。';
    return `<div class="modal-backdrop" data-action="backdrop"><section class="card-choice-modal collection-card-detail" role="dialog" aria-modal="true" aria-label="查看${escapeHtml(card.name)}详情" tabindex="-1">${iconButton('close', 'close', `关闭详情，${backLabel}`)}${fullCardMarkup(entry.instance, cardState)}<p class="collection-summary">${quantity}${entry.locked ? ' · 待解锁' : ''}</p><p class="collection-footnote">${note}</p><button class="secondary-button" data-action="collection-back">${backLabel} ${icon('arrow')}</button></section></div>`;
  }
  let title, content;
  if (entry.action === 'collection-enemy') {
    const enemy = ENEMY_DEFS[entry.enemyId], range = enemy.hpRange;
    const hp = range ? range[0] === range[1] ? range[0] : `${range[0]}–${range[1]}` : enemy.maxHp;
    title = enemy.name;
    content = `<img class="bestiary-art collection-detail-art" src="${asset(entry.icon)}" alt="${escapeHtml(enemy.name)}"/><p class="collection-summary">${entry.typeLabel} · 基础生命 ${hp}</p><p>${escapeHtml(enemy.description)}</p><p class="collection-footnote">图鉴展示基础资料，不代表当前战场中的具体实例。</p>`;
  } else {
    const potion = entry.itemKind === 'potion';
    const definition = potion ? POTION_DEFS[entry.itemId] : RELIC_DEFS[entry.itemId] || RELICS.find(relic => relic.id === entry.itemId);
    const owned = potion && run?.potions?.some(item => item.uid === entry.itemUid && item.id === entry.itemId);
    const canUse = owned && !['victory', 'defeat'].includes(run.phase) && (run.phase === 'combat' || entry.itemId === 'healing');
    title = definition.name;
    content = `<img class="bestiary-art collection-detail-art" src="${asset(entry.icon)}" alt="${escapeHtml(title)}"/><p class="collection-summary">${entry.typeLabel} · 数量${entry.count}</p><p>${escapeHtml(definition.description)}</p>${definition.flavor ? `<p class="collection-footnote">${escapeHtml(definition.flavor)}</p>` : ''}${potion ? `<p class="collection-footnote">确认使用仅消耗其中一瓶；点击网格不会使用药物。</p><button class="secondary-button" data-action="use-potion" data-potion-id="${entry.itemId}" data-potion-uid="${entry.itemUid}" ${canUse ? '' : 'disabled'}>${definition.target === 'enemy' ? '选择敌人使用' : '使用'} ${escapeHtml(title)}</button>${!canUse ? '<p class="collection-footnote">当前不能使用这瓶药物。</p>' : ''}` : '<p class="collection-footnote">本局法器持续生效，无需点击使用。</p>'}`;
  }
  return `<div class="modal-backdrop" data-action="backdrop"><section class="parchment-modal paper-panel ${entry.action === 'collection-enemy' ? 'collection-enemy-detail' : 'collection-item-detail'}" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"><header><h2 id="modal-title">${escapeHtml(title)}</h2>${iconButton('close', 'close', `关闭详情，${backLabel}`)}</header><div class="modal-content">${content}<button class="secondary-button" data-action="collection-back">${backLabel} ${icon('arrow')}</button></div></section></div>`;
}
function modalMarkup() {
  if (!modal) return '';
  const kind = typeof modal === 'string' ? modal : modal.kind;
  if (kind === 'collection-detail') return collectionDetailMarkup();
  if (kind === 'reward-card') {
    const card = viewCard(modal.cardId);
    return `<div class="modal-backdrop" data-action="backdrop"><section class="card-choice-modal" role="dialog" aria-modal="true" aria-label="奖励卡牌${card.name}" tabindex="-1">${iconButton('close', 'close', '返回奖励选择')}${fullCardMarkup(card.id)}<button class="primary-button" data-action="reward-select" data-card-id="${card.id}">收下${card.name} ${icon('arrow')}</button><button class="text-button" data-action="close">再看看其他符箓</button></section></div>`;
  }
  let title = '', content = '';
  if (kind === 'training') { title = '灯下修行'; content = trainingContent(); }
  else if (kind === 'compendium') { title = '阴司图鉴'; content = compendiumContent(); }
  else if (kind === 'records') { title = '夜巡档案'; content = recordsContent(); }
  else if (kind === 'help') { title = '夜巡小册'; content = helpContent(); }
  else if (kind === 'ledger' && run) { title = '阴债簿'; content = ledgerContent(); }
  else if (Object.hasOwn(pileLabels, kind) && run) { title = collectionTitle(kind); content = deckContent(kind); }
  else if (kind === 'inventory' && run) { title = '行囊与药物'; content = inventoryContent(); }
  else if (kind === 'relic' && run) { title = '本局法器与药物'; content = inventoryContent(); }
  else if (kind === 'enemy' && run) { const instance = liveEnemies().find(enemy => enemyKey(enemy) === modal.enemyUid) || liveEnemies()[0]; if (!instance) return ''; const enemy = contentFor(run).enemies[instance.id], intent = getEnemyIntent(run, instance.uid); title = enemy.name; content = `<img class="bestiary-art" src="${asset(enemy.art)}" alt=""/><p>${enemy.description}</p><p>生命 ${instance.hp}/${instance.maxHp}${instance.block ? ` · 护甲 ${instance.block}` : ''}</p><h3>当前意图 · ${intent.label}</h3><p>${intent.detail}</p>${getEnemyMechanics(run, instance).map(text => `<p>${escapeHtml(text)}</p>`).join('')}${Object.entries({ strength: '力量', burn: '业火', exposed: '易伤', weak: '虚弱', artifact: '御符', curlUp: '蜷缩', enrage: '激怒', ritual: '仪式', sharpHide: '荆甲' }).filter(([key]) => instance[key]).map(([key, name]) => `<p>${name} ${instance[key]}</p>`).join('')}`; }
  else if (kind === 'node') {
    const node = run.route.nodes.find(n => n.id === modal.nodeId), available = !mapPreview && getAvailableNodes(run).some(n => n.id === node.id);
    title = node.label;
    content = `<div class="node-preview-icon">${icon(typeIcons[node.type])}</div><p class="panel-intro">${typeNames[node.type]} · 第 ${node.row + 1} 段</p><p>${node.description}</p>${available ? `<button class="primary-button" data-action="node-go" data-node-id="${node.id}">前往${node.label} ${icon('arrow')}</button>` : `<p class="small-note">${run.route.completedIds.includes(node.id) ? '你已走过这里。' : run.route.currentId === node.id ? '这里是当前遭遇，完成后继续选路。' : mapPreview ? '完成当前遭遇后，再沿路线前往。' : '沿连线从下向上前行，只能选择下一站。'}</p>`}`;
  } else if (kind === 'replace') {
    title = '放下当前这盏灯？'; content = `<p>当前夜巡将结算为主动归府。已完成的胜战、还债与阅历会保留，随后开始新的冒险。</p><p>如果只是暂歇，可继续原夜巡。</p><button class="primary-button" data-action="replace-run">结算旧夜，重新出发</button><button class="secondary-button" data-action="continue">继续原夜巡</button>`;
  } else if (kind === 'abandon') {
    title = '收灯归府'; content = `<p>主动结束当前夜巡，带回已完成的见闻。途中牌组与阴债在下一夜重置。</p><button class="primary-button" data-action="abandon-run">确认收灯并结算</button><button class="secondary-button" data-action="close">再想一想</button>`;
  } else {
    title = screen === 'home' ? '府中歇息' : '灯下歇息';
    content = `<div class="menu-options">${screen === 'adventure' ? '<button class="secondary-button" data-action="home">回府暂歇 · 保留进度</button><button class="secondary-button" data-action="map">查看路线</button><button class="secondary-button" data-action="deck">随身符匣</button><button class="secondary-button" data-action="ledger">阴债簿</button>' : ''}<button class="secondary-button" data-action="help">夜巡小册</button><button class="secondary-button" data-action="sound">${soundEnabled ? '关闭' : '开启'}音效</button>${activeRun() ? '<button class="text-button" data-action="abandon">主动结束当前夜巡</button>' : ''}</div><p class="small-note">进度自动保存在当前浏览器。<br>第一幕 · 奈何之前 · v0.5</p>`;
  }
  return `<div class="modal-backdrop" data-action="backdrop"><section class="parchment-modal paper-panel${collectionRoots.has(kind) ? ' collection-modal' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"><header><h2 id="modal-title">${title}</h2>${iconButton('close', 'close', '关闭窗口')}</header><div class="modal-content">${content}</div></section></div>`;
}
function render() {
  const collectionReturn = collectionRestore; collectionRestore = null;
  handPage = Math.max(0, Math.min(handPage, Math.ceil((run?.hand.length || 1) / 5) - 1));
  const scrollTop = app.querySelector('.modal-content')?.scrollTop || 0;
  const previousFocusData = { ...document.activeElement?.dataset }, previousAction = previousFocusData.action;
  const mapScrollTop = app.querySelector('.map-scroll')?.scrollTop;
  const modeScrollTop = app.querySelector('.mode-content')?.scrollTop;
  const mapVisible = screen === 'adventure' && (run?.phase === 'map' || mapPreview);
  let content;
  if (screen === 'home') content = homeMarkup();
  else if (screen === 'modes') content = modesMarkup();
  else if (mapVisible) content = mapMarkup();
  else if (run?.phase === 'combat') content = `${combatHeader()}${arenaMarkup()}${combatControls()}`;
  else if (run?.phase === 'reward') content = rewardMarkup();
  else if (run?.phase === 'event') content = eventMarkup();
  else content = endingMarkup();
  const inspection = screen === 'adventure' && run?.phase === 'combat' && !mapVisible && !modal ? (run.pendingChoice ? choiceMarkup() : inspectionMarkup()) : '';
  app.innerHTML = `<div ${inspection ? 'inert' : ''} class="game-shell ${screen === 'home' || screen === 'modes' ? 'at-home' : ''} ${mapVisible ? 'on-map' : ''} ${run?.phase === 'combat' && screen === 'adventure' && !mapVisible ? 'in-combat' : ''}"><div class="world-background" aria-hidden="true"></div>${content}${modalMarkup()}<div class="toast" role="status" aria-live="polite"></div></div>${inspection}`;
  decorateSkins(app);
  if (modeScrollTop !== undefined && app.querySelector('.mode-content')) app.querySelector('.mode-content').scrollTop = modeScrollTop;
  if (mapScrollTop !== undefined && app.querySelector('.map-scroll')) app.querySelector('.map-scroll').scrollTop = mapScrollTop;
  else if (mapVisible && !modal) requestAnimationFrame(() => app.querySelector('.map-node.available, .map-node.current')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  if (modal) {
    const content = app.querySelector('.modal-content'); if (content) content.scrollTop = collectionReturn?.scrollTop ?? scrollTop;
    const renderedModal = modal;
    requestAnimationFrame(() => {
      if (modal !== renderedModal) return;
      const dialog = app.querySelector('[role="dialog"]');
      const focus = collectionReturn?.focusKey ? [...(dialog?.querySelectorAll('[data-collection-key]') || [])].find(tile => tile.dataset.collectionKey === collectionReturn.focusKey)
        : collectionReturn?.focusData ? [...(dialog?.querySelectorAll('[data-action]') || [])].find(button => Object.entries(collectionReturn.focusData).every(([key, value]) => button.dataset[key] === value)) : null;
      (focus || dialog)?.focus({ preventScroll: true });
      if (content && collectionReturn) content.scrollTop = collectionReturn.scrollTop;
    });
  }
  else if (inspection) requestAnimationFrame(() => app.querySelector('.card-inspection, .resolution-choice')?.focus({ preventScroll: true }));
  else if (previousAction && !['select', 'node-info', 'event', 'reward-select', 'node-go'].includes(previousAction)) {
    [...app.querySelectorAll('[data-action]')].find(element => !element.disabled && Object.entries(previousFocusData).every(([key, value]) => element.dataset[key] === value))?.focus({ preventScroll: true });
  }
  if (pendingSaveNotice) { const notice = pendingSaveNotice; pendingSaveNotice = ''; setTimeout(() => toast(notice), 80); }
}
function toast(message) {
  clearTimeout(toastTimer); const target = app.querySelector('.toast'); if (!target) return;
  target.textContent = message; target.classList.add('visible'); toastTimer = setTimeout(() => target.classList.remove('visible'), 3400);
}
function showModal(kind) {
  if (busy) return;
  if (collectionRoots.has(currentModalKind(kind))) collectionState = { tab: 'cards', filter: 'all' };
  collectionRestore = null; modal = kind; selectedUid = null; pendingTarget = null; render(); app.querySelector('.modal-content')?.scrollTo(0, 0);
}
function closeModal() {
  if (currentModalKind() === 'collection-detail') {
    const parent = modal.parent;
    modal = parent.modal; collectionState = { ...parent.collectionState };
    collectionRestore = { scrollTop: parent.scrollTop, focusKey: parent.focusKey };
  } else { modal = null; collectionRestore = null; }
  render();
}
function closeInspection() {
  const uid = selectedUid;
  selectedUid = null; render();
  [...app.querySelectorAll('.hand .card')].find(card => card.dataset.uid === uid)?.focus({ preventScroll: true });
}
function requestPlay(uid, targetUid = null, fromDrag = false) {
  const instance = run?.hand.find(card => card.uid === uid);
  if (!instance || busy) return;
  const card = viewCard(instance), enemies = liveEnemies();
  if (!card.playable) { toast(card.reason || '这张牌现在无法打出。'); return; }
  const targets = getCardEnemyTargets(run, instance);
  if (card.target !== 'self' && !targets.some(target => target.eligible)) { toast(targets[0]?.reason || '当前没有可作用的鬼怪。'); return; }
  if (card.target === 'enemy' && targetUid && !targets.some(target => target.uid === targetUid && target.eligible)) { toast(targets.find(target => target.uid === targetUid)?.reason || '这张牌当前无法作用于该鬼怪。'); return; }
  if (card.target === 'enemy' && (enemies.length > 1 || fromDrag) && !targetUid) {
    selectedUid = null;
    if (fromDrag) { pendingTarget = null; render(); toast('请把单体牌拖到一个鬼怪身上再松手。'); return; }
    pendingTarget = { kind: 'card', uid }; render(); toast(targetingText()); return;
  }
  perform({ type: 'play', uid, ...(card.target === 'enemy' ? { targetUid: targetUid || enemies[0]?.uid } : {}) });
}
function requestPotion(uid, potionId) {
  const potion = POTION_DEFS[potionId];
  if (!potion) return;
  if (potion.target === 'enemy' && liveEnemies().length > 1) {
    pendingTarget = { kind: 'potion', potionUid: uid, potionId }; modal = null; selectedUid = null; render(); toast(targetingText()); return;
  }
  perform({ type: 'usePotion', potionId: uid, targetUid: potion.target === 'enemy' ? liveEnemies()[0]?.uid : undefined });
}
function chooseEnemy(uid) {
  if (!pendingTarget) { showModal({ kind: 'enemy', enemyUid: uid }); return; }
  const intent = pendingTarget;
  if (intent.kind === 'potion') perform({ type: 'usePotion', potionId: intent.potionUid, targetUid: uid });
  else requestPlay(intent.uid, uid);
}
function enemyTargetBounds() {
  return [...app.querySelectorAll('.enemy-slot')].map(element => {
    const rect = element.getBoundingClientRect();
    return { uid: element.dataset.enemyUid, active: element.dataset.cardTargetEligible !== 'false', left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  });
}
function enemyAtPointer(x, y) {
  const targets = dragStart?.enemyTargets;
  const bounds = dragStart?.enemyBounds || enemyTargetBounds();
  return pickEnemyTarget(bounds.map(target => ({ ...target, active: targets ? targets.some(option => option.uid === target.uid && option.eligible) : target.active })), x, y);
}
function showDragTargets(card, x, y) {
  const handTop = app.querySelector('.hand')?.getBoundingClientRect().top ?? Infinity;
  const selfTop = (app.querySelector('.command-bar')?.getBoundingClientRect().top ?? Infinity) - 18;
  const enemyCard = card.target !== 'self';
  const targets = new Map((dragStart.enemyTargets ??= getCardEnemyTargets(run, dragStart.uid)).map(target => [target.uid, target]));
  app.querySelector('.arena')?.classList.add('showing-card-targets');
  app.querySelectorAll('.enemy-slot').forEach(element => {
    const target = targets.get(element.dataset.enemyUid), eligible = Boolean(target?.eligible);
    element.classList.toggle('target-ready', eligible);
    element.classList.toggle('target-unavailable', !eligible);
    element.dataset.cardTargetEligible = String(eligible);
    const button = element.querySelector('.enemy-target');
    if (!eligible) button?.setAttribute('aria-disabled', 'true');
    else button?.removeAttribute('aria-disabled');
  });
  effectsPresenter.setSelfGuide({ visible: card.target === 'self', active: card.target === 'self' && y >= selfTop && y - dragStart.y > 36, label: y >= selfTop ? '松手 · 对自身施放' : '向下拖回灯前 · 对自身施放' });
  const hint = app.querySelector('.hand-hint > span:first-child');
  const unavailable = enemyCard && ![...targets.values()].some(target => target.eligible);
  if (hint) hint.textContent = unavailable ? targets.values().next().value?.reason || '当前没有可作用的鬼怪' : card.target === 'self' ? (y >= selfTop && y - dragStart.y > 36 ? '松手 · 对自身施放' : '向下拖回灯前 · 对自身施放') : card.target === 'all' ? '头顶箭头为可作用目标 · 拖向战场施放' : '拖到箭头下的鬼怪身上 · 松手施放';
  const targetUid = enemyCard && y < handTop ? enemyAtPointer(x, y) : null;
  app.querySelectorAll('.enemy-slot').forEach(element => element.classList.toggle('drag-aim', Boolean(targetUid) && targets.get(element.dataset.enemyUid)?.eligible && (card.target === 'all' || element.dataset.enemyUid === targetUid)));
}
function clearEnemyTargetFeedback() {
  app.querySelector('.arena')?.classList.remove('showing-card-targets', 'choosing-target');
  app.querySelectorAll('.enemy-slot').forEach(slot => {
    slot.classList.remove('target-ready', 'target-unavailable', 'drag-aim');
    delete slot.dataset.cardTargetEligible;
    const button = slot.querySelector('.enemy-target');
    button?.removeAttribute('aria-disabled');
    if (button) button.setAttribute('aria-label', button.getAttribute('aria-label').replace(/^(选择目标|当前不可作用)：/, '查看：'));
  });
}
function cancelTargetForDrag() {
  if (!pendingTarget) return;
  pendingTarget = null;
  clearEnemyTargetFeedback();
  const hint = app.querySelector('.hand-hint > span:first-child'); if (hint) hint.textContent = handInstruction();
}
function floatEffect(message, type, enemyUid) {
  const container = app.querySelector('.arena-effects'); if (!container) return;
  const element = document.createElement('span'); element.className = `float-effect ${type}`; element.textContent = message;
  const target = [...app.querySelectorAll('.enemy-slot')].find(slot => slot.dataset.enemyUid === enemyUid);
  if (target) { const box = target.getBoundingClientRect(), base = container.getBoundingClientRect(); element.style.left = `${(box.left + box.right) / 2 - base.left}px`; element.style.top = `${box.top + box.height / 3 - base.top}px`; }
  container.append(element); setTimeout(() => element.remove(), 1400);
}
async function perform(action, computed) {
  if (busy || screen !== 'adventure' || !run) return;
  const snapshot = pendingDragSnapshot || effectsPresenter.capture(); pendingDragSnapshot = null;
  const previous = run; run = computed || transition(run, action); selectedUid = null; pendingTarget = null; modal = null; mapPreview = false;
  busy = Boolean(run.events?.length); if (action.type === 'endTurn') handPage = 0;
  saveRun(); if (['victory', 'defeat'].includes(run.phase)) settleCurrent(); render();
  if (run.notice && run.phase === 'combat') toast(run.notice);
  if (run.phase === 'combat') for (const enemy of liveEnemies()) {
    const before = liveEnemies(previous).find(candidate => enemyKey(candidate) === enemyKey(enemy));
    if (before && enemy.hp < before.hp) floatEffect(`−${before.hp - enemy.hp}`, 'damage', enemyKey(enemy));
  }
  if (run.phase === 'combat' && run.hp < previous.hp) { app.querySelector('.world-background')?.classList.add('player-hit'); floatEffect(`−${previous.hp - run.hp} 命`, 'self-damage'); }
  if (action.type === 'borrow' && run.energy > previous.energy) floatEffect('+1 香火 · +2 债', 'borrow');
  if (run.phase === 'combat' && run.block > previous.block) floatEffect(`+${run.block - previous.block} 护甲`, 'guard');
  sound(['victory', 'defeat', 'reward'].includes(run.phase) ? run.phase : run.lastEvent?.kind || action.type);
  try { await effectsPresenter.play(run.events || [], snapshot); }
  finally { busy = false; render(); }
}
function endTurn() {
  if (busy || run?.phase !== 'combat' || run.pendingChoice) return;
  perform({ type: 'endTurn' });
}
function depart() {
   busy = false; selectedUid = null; pendingTarget = null; handPage = 0; mapPreview = false; modal = null; lastEarned = 0;
  const options = { ...getAdventureOptions(profile), difficulty: isDifficultyUnlocked(profile, selectedDifficulty) ? selectedDifficulty : 0 };
  run = createModeRun(selectedModeId, (Date.now() + Math.floor(Math.random() * 100000)) % 2147483647, options);
  screen = 'adventure'; saveRun(); render(); tone(440, .7);
}
function returnHome() {
  if (busy) return;
  if (run && ['victory', 'defeat'].includes(run.phase)) settleCurrent();
  saveRun(); screen = 'home'; modal = null; mapPreview = false; selectedUid = null; pendingTarget = null; render();
}
app.addEventListener('click', event => {
  if (ignorePointerClick && event.detail > 0) { ignorePointerClick = false; event.preventDefault(); return; }
  if (dragStart) return;
  if (event.target.classList.contains('inspection-backdrop')) { event.preventDefault(); if (!run?.pendingChoice) closeInspection(); return; }
  const button = event.target.closest('[data-action]');
  const slot = event.target.closest('.enemy-slot');
  if (pendingTarget && slot && !button && !busy) { chooseEnemy(slot.dataset.enemyUid); return; }
  if (pendingTarget && !button && !busy) { pendingTarget = null; render(); return; }
  if (!button || button.disabled || busy) return;
  const action = button.dataset.action;
  if (action === 'resolve-choice') { perform({ type: 'chooseCard', uid: button.dataset.collectionKey }); return; }
  if (action === 'backdrop') { if (event.target === button) closeModal(); return; }
  if (action === 'close' || action === 'collection-back') { closeModal(); return; }
  if (['collection-card', 'collection-enemy', 'collection-item'].includes(action)) { openCollectionDetail(action, button.dataset.collectionKey); return; }
  if (action === 'collection-tab') {
    if (currentModalKind() === 'compendium' && ['cards', 'enemies'].includes(button.dataset.tab)) {
      collectionState.tab = button.dataset.tab;
      collectionRestore = { scrollTop: 0, focusData: { action, tab: button.dataset.tab } }; render();
    }
    return;
  }
  if (action === 'collection-filter') {
    if ((currentModalKind() === 'compendium' || Object.hasOwn(pileLabels, currentModalKind())) && collectionFamilies.some(([id]) => id === button.dataset.filter)) {
      collectionState.filter = button.dataset.filter;
      collectionRestore = { scrollTop: 0, focusData: { action, filter: button.dataset.filter } }; render();
    }
    return;
  }
  if (action === 'collection-pile') {
    if (Object.hasOwn(pileLabels, currentModalKind()) && Object.hasOwn(pileLabels, button.dataset.pile)) {
      modal = button.dataset.pile;
      collectionRestore = { scrollTop: 0, focusData: { action, pile: button.dataset.pile } }; render();
    }
    return;
  }
  if (action === 'sound') { soundEnabled = !soundEnabled; try { localStorage.setItem(SOUND_KEY, soundEnabled ? 'on' : 'off'); } catch {} render(); if (soundEnabled) tone(660); return; }
  if (['training', 'compendium', 'records', 'help', 'ledger', 'deck', 'draw-pile', 'discard', 'exhaust', 'relic', 'inventory', 'menu', 'abandon'].includes(action)) { showModal(action); return; }
  if (action === 'use-potion') { requestPotion(button.dataset.potionUid, button.dataset.potionId); return; }
  if (action === 'home') { returnHome(); return; }
  if (action === 'modes') { screen = 'modes'; modal = null; render(); return; }
  if (action === 'continue') { if (run) { screen = 'adventure'; modal = null; mapPreview = false; render(); } return; }
  if (action === 'mode-select') { if (!getMode(button.dataset.modeId)?.disabled) { selectedModeId = button.dataset.modeId; render(); } return; }
  if (action === 'difficulty') { const level = Number(button.dataset.level); if (isDifficultyUnlocked(profile, level)) { selectedDifficulty = level; render(); } return; }
  if (action === 'depart') { if (activeRun()) showModal('replace'); else depart(); return; }
  if (action === 'replace-run') { settleCurrent(true); depart(); return; }
  if (action === 'abandon-run') { settleCurrent(true); run = null; try { localStorage.removeItem(SAVE_KEY); } catch { pendingSaveNotice = '无法清除旧记录，请保持页面打开。'; } returnHome(); toast(`夜巡已归档，带回 ${lastEarned} 阅历。`); return; }
  if (action === 'claim') { const updated = claimMilestone(profile, button.dataset.id); if (updated !== profile) { profile = updated; saveProfile(); render(); sound('claim'); toast('修行已领取，下次出门时生效。'); } return; }
  if (action === 'equip') { profile = equipRelic(profile, button.dataset.relicId); saveProfile(); render(); toast('行装已备好，下次出门携带。'); return; }
  if (action === 'map') { pendingTarget = null; modal = null; mapPreview = run.phase !== 'map'; render(); return; }
  if (action === 'close-map') { mapPreview = false; render(); return; }
  if (action === 'node-info') { showModal({ kind: 'node', nodeId: button.dataset.nodeId }); return; }
  if (action === 'node-go') { perform({ type: 'selectNode', nodeId: button.dataset.nodeId }); return; }
  if (action === 'reward-preview') { if (run.phase === 'reward' && run.rewards.includes(button.dataset.cardId)) showModal({ kind: 'reward-card', cardId: button.dataset.cardId }); return; }
  if (action === 'hand-prev' || action === 'hand-next') { handPage += action === 'hand-next' ? 1 : -1; selectedUid = null; pendingTarget = null; render(); return; }
  if (action === 'select') { pendingTarget = null; selectedUid = selectedUid === button.dataset.uid ? null : button.dataset.uid; tone(520, .08, .025); render(); }
  else if (action === 'deselect') closeInspection();
  else if (action === 'play') { if (selectedUid) requestPlay(selectedUid); }
  else if (action === 'enemy') chooseEnemy(button.dataset.enemyUid);
  else if (action === 'borrow') perform({ type: 'borrow' });
  else if (action === 'repay') perform({ type: 'repay' });
  else if (action === 'end-turn') endTurn();
  else if (action === 'reward-select') { handPage = 0; perform({ type: 'reward', cardId: button.dataset.cardId }); }
  else if (action === 'reward-skip') { handPage = 0; perform({ type: 'reward', cardId: null }); }
  else if (action === 'event') perform({ type: 'event', choiceId: button.dataset.choiceId });
});
app.addEventListener('pointerdown', event => {
  // 新的一次按下立即恢复点击，避免吞掉取消拖拽后的主动点牌。
  ignorePointerClick = false;
  const card = event.target.closest('.hand .card'); if (!card || busy || run?.pendingChoice || modal || dragStart || event.isPrimary === false || event.button !== 0) return;
  cancelTargetForDrag();
  dragStart = { uid: card.dataset.uid, x: event.clientX, y: event.clientY, pointerId: event.pointerId, card, dragged: false, enemyBounds: enemyTargetBounds() }; card.setPointerCapture(event.pointerId);
});
app.addEventListener('pointermove', event => {
  if (!dragStart || dragStart.pointerId !== event.pointerId) return;
  const offset = updateCardDrag(dragStart, event.clientX, event.clientY);
  if (dragStart.dragged) { dragStart.card.classList.add('dragging'); dragStart.card.style.setProperty('--drag-y', `${offset.y}px`); dragStart.card.style.setProperty('--drag-x', `${offset.x}px`); const instance = run.hand.find(card => card.uid === dragStart.uid); if (instance) showDragTargets(viewCard(instance), event.clientX, event.clientY); }
});
function clearCardDrag() {
  const drag = dragStart; dragStart = null;
  if (!drag) return null;
  drag.card.classList.remove('dragging'); drag.card.style.removeProperty('--drag-y'); drag.card.style.removeProperty('--drag-x');
  clearEnemyTargetFeedback();
  effectsPresenter.setSelfGuide({ visible: false });
  const hint = app.querySelector('.hand-hint > span:first-child'); if (hint) hint.textContent = handInstruction();
  if (drag.card.hasPointerCapture(drag.pointerId)) drag.card.releasePointerCapture(drag.pointerId);
  return drag;
}
function cancelCardDrag() {
  const drag = clearCardDrag();
  if (drag?.dragged) ignorePointerClick = true;
}
app.addEventListener('pointerup', event => {
  if (!dragStart || dragStart.pointerId !== event.pointerId) return;
  const handTop = app.querySelector('.hand')?.getBoundingClientRect().top ?? -Infinity;
  const card = viewCard(run.hand.find(card => card.uid === dragStart.uid));
  const selfTop = (app.querySelector('.command-bar')?.getBoundingClientRect().top ?? Infinity) - 18;
  const outcome = resolveCardDrag(dragStart, event.clientX, event.clientY, handTop, { target: card.target, selfTop });
  const targetUid = outcome === 'play' && card.target === 'enemy' ? enemyAtPointer(event.clientX, event.clientY) : null;
  if (outcome === 'play') pendingDragSnapshot = effectsPresenter.capture();
  const drag = clearCardDrag();
  if (outcome === 'tap') return;
  event.preventDefault(); ignorePointerClick = true;
  if (outcome === 'play') requestPlay(drag.uid, targetUid, true);
  if (!busy) pendingDragSnapshot = null;
});
app.addEventListener('pointercancel', event => { if (dragStart?.pointerId === event.pointerId) cancelCardDrag(); });
app.addEventListener('lostpointercapture', event => { if (dragStart?.pointerId === event.pointerId) cancelCardDrag(); });
window.addEventListener('blur', cancelCardDrag);
document.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
  if (run?.pendingChoice && screen === 'adventure' && !modal) {
    const index = Number(event.key) - 1;
    if (!busy && index >= 0 && index < run.pendingChoice.cardUids.length) { event.preventDefault(); perform({ type: 'chooseCard', uid: run.pendingChoice.cardUids[index] }); }
    if (event.key !== 'Tab') return;
    const buttons = [...app.querySelectorAll('.resolution-choice button')];
    if (event.shiftKey && [buttons[0], app.querySelector('.resolution-choice')].includes(document.activeElement)) { event.preventDefault(); buttons.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
    return;
  }
  if (dragStart) { if (event.key === 'Escape') { event.preventDefault(); cancelCardDrag(); } return; }
  if (pendingTarget) {
    if (event.key === 'Escape') { event.preventDefault(); pendingTarget = null; render(); return; }
    const index = Number(event.key) - 1;
    if (index >= 0 && index < liveEnemies().length) { event.preventDefault(); chooseEnemy(enemyKey(liveEnemies()[index])); }
    return;
  }
  const inspectionDialog = selectedUid && app.querySelector('.card-inspection');
  if (modal || inspectionDialog) {
    if (event.key === 'Escape') { event.preventDefault(); if (modal) closeModal(); else closeInspection(); return; }
    if (event.key === 'Tab') {
      const dialog = app.querySelector('[role="dialog"]');
      const buttons = [...dialog.querySelectorAll('button:not(:disabled)')], first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && [first, dialog].includes(document.activeElement)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      return;
    }
    if (modal || !['Enter', '1', '2', '3', '4', '5'].includes(event.key)) return;
    if (event.key === 'Enter' && document.activeElement?.matches('button')) return;
  }
  if (screen !== 'adventure' || mapPreview || run?.phase !== 'combat' || busy || event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
  const position = Number(event.key) - 1;
  if (position >= 0 && position < 5 && run.hand[handPage * 5 + position]) { event.preventDefault(); selectedUid = run.hand[handPage * 5 + position].uid; render(); }
  else if (event.key === 'Enter' && selectedUid) { event.preventDefault(); requestPlay(selectedUid); }
  else if (event.key.toLowerCase() === 'b') { event.preventDefault(); perform({ type: 'borrow' }); }
  else if (event.key.toLowerCase() === 'r') { event.preventDefault(); perform({ type: 'repay' }); }
  else if (event.key.toLowerCase() === 'e') { event.preventDefault(); endTurn(); }
  else if (event.key === 'Escape') { selectedUid = null; render(); }
});
let resizeTimer;
window.addEventListener('resize', () => { if (dragStart) cancelCardDrag(); clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (!dragStart) render(); }, 120); });
render();
