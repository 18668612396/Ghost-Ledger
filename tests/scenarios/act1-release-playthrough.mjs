import { createAdventure, transition, getAvailableNodes, getCardView, getCardEnemyTargets, getEnemies, getEnemyIntent, getEventView, isValidSave, restoreRun, CONTENT_REVISION } from '../../game/src/engine.js';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// This is an acceptance driver, not a different game runtime. The only writes
// to the run come from public createAdventure/transition/restoreRun calls.
// Turn planning can inspect deterministic transitions; it does not establish
// human difficulty, fun, browser acceptance or physical-phone acceptance.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUTPUT = resolve(ROOT, '.local/evidence');
const RUNTIME_FILES = ['engine.js', 'runtime/game.js', 'runtime/world.js', 'runtime/effects.js', 'runtime/expressions.js', 'runtime/content-schema.js', 'runtime/items.js'];
const RUNTIME_REVISION = createHash('sha256').update(Buffer.concat(await Promise.all(RUNTIME_FILES.map(file => readFile(resolve(ROOT, 'game/src', file)))))).digest('hex');
const QUALITY = {
  ic_strike: 0, ic_defend: 0, ic_bash: 10,
  ic_anger: 25, ic_body_slam: 14, ic_clash: 8, ic_cleave: 27, ic_clothesline: 25, ic_headbutt: 24, ic_heavy_blade: 19, ic_iron_wave: 23, ic_perfected_strike: 26, ic_pommel_strike: 31, ic_sword_boomerang: 26, ic_thunderclap: 18, ic_twin_strike: 25, ic_wild_strike: 13,
  ic_blood_for_blood: 12, ic_carnage: 27, ic_dropkick: 20, ic_hemokinesis: 23, ic_pummel: 19, ic_rampage: 27, ic_reckless_charge: 19, ic_searing_blow: 10, ic_sever_soul: 18, ic_uppercut: 34, ic_whirlwind: 31,
  ic_bludgeon: 29, ic_feed: 37, ic_fiend_fire: 21, ic_immolate: 42, ic_reaper: 38,
  ic_armaments: 24, ic_flex: 17, ic_havoc: 12, ic_shrug_it_off: 30, ic_true_grit: 21, ic_warcry: 9, ic_battle_trance: 28, ic_bloodletting: 15, ic_burning_pact: 17, ic_disarm: 40, ic_dual_wield: 15, ic_entrench: 7, ic_flame_barrier: 37, ic_ghostly_armor: 25, ic_infernal_blade: 24, ic_intimidate: 21, ic_power_through: 21, ic_rage: 23, ic_second_wind: 15, ic_seeing_red: 17, ic_sentinel: 13, ic_shockwave: 32, ic_spot_weakness: 29, ic_double_tap: 26,
  ic_exhume: 15, ic_impervious: 27, ic_limit_break: 15, ic_offering: 27,
  ic_combust: 29, ic_dark_embrace: 12, ic_evolve: 18, ic_feel_no_pain: 15, ic_fire_breathing: 20, ic_inflame: 35, ic_metallicize: 38, ic_rupture: 10, ic_barricade: 18, ic_berserk: 29, ic_brutality: 21, ic_corruption: 22, ic_demon_form: 43, ic_juggernaut: 40,
  debt_chain: 27, debt_vow: 27, debt_seal: 24, debt_lotus: 29, debt_blood: 26, debt_ledger: 27, debt_mirror: 23, debt_ferry: 25, debt_verdict: 28, debt_loan: 17, debt_delay: 4, debt_register: 16,
};
const POWER_VALUE = { metallicize: 7, demon_form: 14, juggernaut: 6, combust_damage: 5, combust_cost: -2, dark_embrace: 3, evolve: 3, fire_breathing: 3, feel_no_pain: 4, rupture: 3, barricade: 4, berserk: 12, brutality: 5, corruption: 12, debt_register: 4, rage: .4, flame_barrier: .3, temporary_strength_loss: -7 };
const definition = (state, id) => state.contentSnapshot.cards[id];
const rank = (state, id) => {
  const def = definition(state, id);
  if (!def) return -100;
  if (['curse', 'status'].includes(def.type)) return -100;
  const base = QUALITY[id] ?? 15;
  return base + (id === 'ic_heavy_blade' || id === 'ic_sword_boomerang' || id === 'ic_pummel' ? Math.min(8, state.deck.filter(card => ['ic_inflame', 'ic_spot_weakness', 'ic_demon_form'].includes(card)).length * 4) : 0);
};
const cardByUid = (state, uid) => ['hand', 'discard', 'drawPile', 'exhaust', 'limbo', 'powerZone', 'deckCards'].flatMap(zone => state[zone] || []).find(card => card.uid === uid);
const debts = state => state.debts.reduce((sum, item) => sum + item.amount, 0);
const incoming = state => getEnemies(state).reduce((sum, enemy) => sum + (getEnemyIntent(state, enemy.uid)?.total || 0), 0);
const hash = state => createHash('sha256').update(JSON.stringify(state)).digest('hex');
function stateKey(state) {
  const { contentSnapshot, ...fields } = state;
  return JSON.stringify(fields);
}
function scoreCombat(state) {
  if (state.phase === 'defeat') return -1e7;
  if (state.phase === 'victory') return 1e7 + state.hp * 30;
  if (state.phase === 'reward') return 1e6 + state.hp * 4 - debts(state) * 4;
  const enemies = getEnemies(state), danger = incoming(state), block = state.block || 0;
  const hpValue = state.hp * 1.45 - Math.max(0, 45 - state.hp) * .45 - Math.max(0, 25 - state.hp) * .8;
  let result = hpValue + (state.maxHp - 80) * 2.5
    - enemies.reduce((sum, enemy) => sum + enemy.hp, 0) - enemies.length * 13
    + Math.min(block, danger) * 1.4 + Math.min(50, Math.max(0, block - danger)) * .03
    + state.strength * 8 + state.dexterity * 5 + state.energy * 1.1
    - debts(state) * 2.35 - state.debts.filter(debt => debt.dueTurn <= state.turn + 1).reduce((sum, debt) => sum + debt.amount, 0) * 1.25
    - Math.max(0, state.weak || 0) * 2 - Math.max(0, state.frail || 0) * 1.5 - Math.max(0, state.exposed || 0) * 2;
  for (const [id, value] of Object.entries(state.powers)) result += (POWER_VALUE[id] ?? 1) * value.amount;
  for (const enemy of enemies) result += Math.min(6, enemy.weak || 0) * 1.6 + Math.min(6, enemy.exposed || 0) * 1.3 - (enemy.strength || 0) * 3 - (enemy.ritual || 0) * 7;
  return result;
}
function choices(state) {
  const pending = state.pendingChoice;
  if (!pending) return [];
  const desirability = uid => {
    const card = cardByUid(state, uid);
    const quality = card ? rank(state, card.cardId) + (card.upgradeLevel || 0) * 3 : -100;
    return pending.effect.op === 'exhaust' || pending.effect.op === 'moveCard' && pending.effect.to === 'drawPile' ? -quality : quality;
  };
  return [...pending.cardUids].sort((a, b) => desirability(b) - desirability(a)).slice(0, 3).map(uid => ({ type: 'chooseCard', uid }));
}
function combatActions(state, { allowBorrow = true } = {}) {
  if (state.pendingChoice) return choices(state);
  const actions = [];
  for (const card of state.hand) {
    const view = getCardView(state, card);
    if (!view?.playable) continue;
    if (view.target === 'enemy') for (const target of getCardEnemyTargets(state, card).filter(target => target.eligible)) actions.push({ type: 'play', uid: card.uid, targetUid: target.uid });
    else actions.push({ type: 'play', uid: card.uid });
  }
  if (allowBorrow && !state.baseline && state.borrowedThisTurn < 2 && state.energy < 5 && debts(state) < 9 && state.hand.some(card => { const view = getCardView(state, card); return view.cost !== null && !view.keywords?.includes('unplayable'); })) actions.push({ type: 'borrow' });
  if (state.energy >= 1 && debts(state)) actions.push({ type: 'repay' });
  for (const potion of state.potions) {
    if (potion.id === 'healing') { if (state.hp <= state.maxHp - 9) actions.push({ type: 'usePotion', potionId: potion.uid }); }
    else if (potion.id === 'block') { if (incoming(state) > state.block + 2) actions.push({ type: 'usePotion', potionId: potion.uid }); }
    else for (const enemy of getEnemies(state)) actions.push({ type: 'usePotion', potionId: potion.uid, targetUid: enemy.uid });
  }
  return actions;
}
function turnPlan(state, { width = 5, depth = 8, allowBorrow = true } = {}) {
  const origin = hash(state);
  let frontier = [{ state, actions: [] }], best = null, seen = new Map();
  for (let level = 0; level <= depth && frontier.length; level++) {
    const next = [];
    for (const node of frontier) {
      if (!node.state.pendingChoice) {
        const end = transition(node.state, { type: 'endTurn' });
        const candidate = { score: scoreCombat(end) - node.actions.length * .035, actions: [...node.actions, { type: 'endTurn' }], state: end };
        if (!best || candidate.score > best.score) best = candidate;
      }
      if (level === depth) continue;
      for (const action of combatActions(node.state, { allowBorrow })) {
        const after = transition(node.state, action);
        if (after.lastEvent?.kind === 'invalid') continue;
        const actions = [...node.actions, action], score = scoreCombat(after) - actions.length * .035;
        if (['reward', 'victory', 'defeat'].includes(after.phase)) {
          if (!best || score > best.score) best = { score, actions, state: after };
          continue;
        }
        const key = stateKey(after);
        if (seen.has(key) && seen.get(key) >= score) continue;
        seen.set(key, score); next.push({ state: after, actions, score });
      }
    }
    frontier = next.sort((a, b) => b.score - a.score).slice(0, width);
    if (best?.state.phase === 'victory' || best?.state.phase === 'reward') break;
  }
  assert.equal(hash(state), origin, 'Planning mutated the live run');
  return best?.actions || choices(state).slice(0, 1);
}
function nodeChoice(state) {
  const nodes = new Map(state.route.nodes.map(node => [node.id, node]));
  function utility(node) {
    const missing = state.maxHp - state.hp;
    return node.type === 'rest' ? 8 + Math.min(24, missing) * .25
      : node.type === 'event' ? 8
      : node.type === 'shop' ? state.gold >= 80 ? 11 : 1
      : node.type === 'treasure' ? 16
      : node.type === 'elite' ? state.hp >= 60 && state.deck.length >= 13 ? -3 : -16
      : node.type === 'battle' ? state.normalBattles < 3 ? 1 : -3
      : 0;
  }
  const memo = new Map();
  function remaining(node) {
    if (memo.has(node.id)) return memo.get(node.id);
    const successors = (node.next || []).map(id => nodes.get(id)).filter(Boolean);
    const value = utility(node) + (successors.length ? .8 * Math.max(...successors.map(remaining)) : 0);
    memo.set(node.id, value); return value;
  }
  const available = [...getAvailableNodes(state)].sort((a, b) => remaining(b) - remaining(a) || a.id.localeCompare(b.id));
  assert.ok(available.length, 'No reachable map node');
  return { type: 'selectNode', nodeId: available[0].id };
}
function rewardChoice(state) {
  const cards = [...state.rewards].sort((a, b) => rank(state, b) - rank(state, a));
  const threshold = state.deck.length >= 19 ? 37 : state.deck.length >= 16 ? 27 : state.deck.length >= 13 ? 20 : 13;
  return { type: 'reward', cardId: cards[0] && rank(state, cards[0]) >= threshold ? cards[0] : null };
}
function eventChoice(state) {
  const view = getEventView(state), options = view.choices.filter(choice => !choice.disabled);
  const pick = id => options.find(choice => choice.id === id);
  let selected;
  if (view.id === 'rest') selected = state.hp <= state.maxHp - 17 ? pick('rest') : debts(state) >= 4 && state.hp <= state.maxHp - 4 ? pick('repay') : pick('upgrade') || pick('rest');
  else if (view.id === 'upgrade') selected = options.filter(choice => choice.cardUid).sort((a, b) => {
    const value = choice => { const card = state.deckCards.find(card => card.uid === choice.cardUid), basic = getCardView(state, card), upgraded = getCardView(state, { ...card, upgradeLevel: card.upgradeLevel + 1, upgraded: true }); return rank(state, card.cardId) + (typeof basic.cost === 'number' && typeof upgraded.cost === 'number' ? (basic.cost - upgraded.cost) * 18 : 0) + (card.cardId === 'ic_bash' ? 11 : 0); };
    return value(b) - value(a);
  })[0];
  else if (view.id === 'remove') selected = options.filter(choice => choice.cardUid).sort((a, b) => rank(state, a.cardId) - rank(state, b.cardId))[0];
  else if (view.id === 'treasure') selected = pick('open');
  else if (view.id === 'shop') {
    const offered = options.filter(choice => choice.id.startsWith('buy:') && choice.cardId && rank(state, choice.cardId) >= (state.deck.length >= 17 ? 34 : 23)).sort((a, b) => rank(state, b.cardId) - rank(state, a.cardId));
    selected = offered[0];
    if (!selected && state.potions.length < 3) selected = options.find(choice => choice.id.startsWith('buy:') && !choice.cardId && state.shop.offers.find(offer => `buy:${offer.id}` === choice.id)?.potionId === 'healing' && state.hp <= state.maxHp - 12);
    if (!selected && state.deck.length >= 12 && state.gold >= state.removePrice && state.deckCards.some(card => rank(state, card.cardId) <= 0)) selected = pick('remove');
    selected ||= pick('leave');
  } else if (view.id === 'shrine') selected = state.hp >= 65 && state.deck.length < 14 ? pick('blood') : pick('leave');
  else if (view.id === 'market') selected = state.hp < state.maxHp - 5 ? pick('heal') : pick('leave');
  else if (view.id === 'mushrooms') selected = pick('leave');
  else if (view.id === 'gold') selected = state.hp > state.maxHp - 3 && state.gold < 80 && debts(state) === 0 ? pick('take') : pick('leave');
  else if (view.id === 'debt_archive') selected = debts(state) >= 2 ? pick('pay') : pick('leave');
  selected ||= pick('leave') || pick('cancel') || options[0];
  assert.ok(selected, `No usable event choice for ${view.id}`);
  return { type: 'event', choiceId: selected.id };
}
function location(state) { return state.route.nodes.find(node => node.id === state.route.currentId); }
function brief(state) {
  return { phase: state.phase, floor: (location(state)?.row ?? -1) + 1, hp: state.hp, maxHp: state.maxHp, energy: state.energy, block: state.block, turn: state.turn, combatTurn: state.combatTurn, debt: debts(state), gold: state.gold, deckSize: state.deck.length, enemies: getEnemies(state).map(enemy => ({ uid: enemy.uid, id: enemy.id, hp: enemy.hp, block: enemy.block, move: enemy.intent?.move })), pendingChoice: state.pendingChoice ? { title: state.pendingChoice.title, cardUids: state.pendingChoice.cardUids } : null, eventId: state.event?.id, lastEvent: state.lastEvent };
}
function annotation(state, action) {
  if (action.type === 'play') { const card = state.hand.find(card => card.uid === action.uid), index = state.hand.indexOf(card); return { cardId: card?.cardId, name: card && getCardView(state, card)?.name, handPage: Math.floor(index / 5), handIndex: index % 5, targetIndex: getEnemies(state).findIndex(enemy => enemy.uid === action.targetUid) }; }
  if (action.type === 'selectNode') { const node = state.route.nodes.find(node => node.id === action.nodeId); return { floor: node.row + 1, type: node.type, column: node.column }; }
  if (action.type === 'event') return { eventId: state.event.id, title: getEventView(state)?.choices.find(choice => choice.id === action.choiceId)?.title };
  if (action.type === 'reward') return { cardId: action.cardId, name: action.cardId ? definition(state, action.cardId)?.name : '跳过' };
  if (action.type === 'chooseCard') { const card = cardByUid(state, action.uid); return { cardId: card?.cardId, name: card && getCardView(state, card)?.name, choiceIndex: state.pendingChoice.cardUids.indexOf(action.uid) }; }
  if (['usePotion', 'discardPotion'].includes(action.type)) { const potion = state.potions.find(potion => potion.uid === action.potionId); return { potionUid: potion?.uid, potionId: potion?.id, name: state.contentSnapshot.potions[potion?.id]?.name, targetIndex: getEnemies(state).findIndex(enemy => enemy.uid === action.targetUid) }; }
  return {};
}
export function playAdventure(seed, { width = 5, depth = 8, maxActions = 1500, passive = false, resumeEvery = 17 } = {}) {
  const started = performance.now(), runId = `act1-release-${seed}-${passive ? 'passive' : 'balanced'}`;
  let state = createAdventure(seed, { runId, difficulty: 0, relicId: 'lamp' });
  const result = { seed, runId, strategy: passive ? 'passive-end-turn' : 'beam-current-turn', planning: { width, depth, deterministicLookahead: !passive }, contentRevision: state.contentRevision, runtimeRevision: RUNTIME_REVISION, runtimeVersion: state.version, ruleset: state.ruleset, initial: brief(state), actions: [], resumes: [], bosses: [], invalid: [] };
  assert.ok(isValidSave(state), 'Fresh run is not valid');
  assert.equal(state.hp, 80); assert.equal(state.maxHp, 80); assert.equal(state.gold, 99); assert.equal(state.deck.length, 10);
  function act(action) {
    const before = brief(state), ui = annotation(state, action), inputHash = hash(state), next = transition(state, action);
    assert.equal(hash(state), inputHash, 'Committed transition mutated caller state');
    const entry = { step: result.actions.length, action, ui, before, after: brief(next), hash: hash(next) };
    result.actions.push(entry);
    if (next.lastEvent?.kind === 'invalid') { result.invalid.push(entry); throw new Error(`Invalid action at ${entry.step}: ${next.notice}`); }
    state = next;
    assert.ok(isValidSave(state), `Invalid save after ${action.type} at step ${entry.step}`);
    if (resumeEvery && (result.actions.length % resumeEvery === 0 || state.pendingChoice)) {
      const saved = JSON.parse(JSON.stringify(state)), restored = restoreRun(saved);
      assert.ok(restored, 'Public restoreRun rejected serialized run');
      assert.equal(hash(restored), hash(state), 'Save/restore changed serialized gameplay state');
      result.resumes.push({ step: entry.step, phase: state.phase, pendingChoice: Boolean(state.pendingChoice), hash: hash(restored) });
      state = restored;
    }
  }
  try { while (!['victory', 'defeat'].includes(state.phase) && result.actions.length < maxActions) {
    if (state.phase === 'map') { const action = nodeChoice(state); act(action); if (state.encounterKind === 'boss' && state.phase === 'combat') result.bosses.push({ encounterId: state.encounterId, enemies: getEnemies(state).map(enemy => enemy.id), hp: state.hp, step: result.actions.length - 1 }); }
    else if (state.phase === 'reward') act(rewardChoice(state));
    else if (state.phase === 'event') {
      const healing = state.potions.find(potion => potion.id === 'healing');
      if (healing && state.hp <= state.maxHp - 17) act({ type: 'usePotion', potionId: healing.uid });
      else act(eventChoice(state));
    } else if (state.phase === 'combat') {
      const actions = passive ? state.pendingChoice ? choices(state).slice(0, 1) : [{ type: 'endTurn' }] : turnPlan(state, { width, depth });
      assert.ok(actions.length, 'Planner returned no actions');
      for (const action of actions) { if (state.phase !== 'combat' || result.actions.length >= maxActions) break; act(action); }
    } else throw new Error(`Unhandled phase: ${state.phase}`);
  } } catch (error) {
    result.final = brief(state); result.completedFloors = state.route.completedIds.length;
    result.error = { name: error.name, message: error.message, stack: error.stack };
    Object.defineProperty(error, 'acceptanceTrace', { value: result });
    throw error;
  }
  result.final = brief(state); result.stats = state.stats; result.completedFloors = state.route.completedIds.length; result.finalDeck = state.deckCards.map(card => ({ cardId: card.cardId, upgradeLevel: card.upgradeLevel })); result.finalRelics = state.relics; result.botWallTimeMs = Math.round(performance.now() - started); result.finalHash = hash(state); result.finished = ['victory', 'defeat'].includes(state.phase);
  if (state.phase === 'victory') assert.equal(result.completedFloors, 16, 'Victory did not complete all 16 floors');
  return result;
}
export function replay(trace, { resumeEvery = 13 } = {}) {
  assert.equal(trace.contentRevision, CONTENT_REVISION, 'Replay content revision is stale');
  assert.equal(trace.runtimeRevision, RUNTIME_REVISION, 'Replay runtime source revision is stale');
  let state = createAdventure(trace.seed, { runId: trace.runId, difficulty: 0, relicId: 'lamp' });
  for (const entry of trace.actions) {
    state = transition(state, entry.action);
    assert.notEqual(state.lastEvent?.kind, 'invalid', `Replay invalid at step ${entry.step}`);
    assert.equal(hash(state), entry.hash, `Replay diverged at step ${entry.step}`);
    if (resumeEvery && (entry.step % resumeEvery === 0 || state.pendingChoice)) state = restoreRun(JSON.parse(JSON.stringify(state)));
    assert.ok(state && isValidSave(state), `Replay resume failed at step ${entry.step}`);
  }
  assert.equal(hash(state), trace.finalHash);
  const restoredFinal = restoreRun(JSON.parse(JSON.stringify(state)));
  assert.ok(restoredFinal, 'Terminal save could not restore');
  assert.equal(hash(restoredFinal), trace.finalHash, 'Terminal save restoration diverged');
  return { seed: trace.seed, phase: state.phase, actions: trace.actions.length, hash: hash(state), terminalSaveRestored: true };
}
async function main() {
  const args = process.argv.slice(2), value = (name, fallback) => { const at = args.indexOf(name); return at < 0 ? fallback : args[at + 1]; };
  if (args.includes('--replay')) { const trace = JSON.parse(await readFile(resolve(ROOT, value('--replay')), 'utf8')); console.log(JSON.stringify(replay(trace))); return; }
  const start = Number(value('--seed', value('--start', 1))), count = Number(value('--count', 1)), width = Number(value('--width', 5)), depth = Number(value('--depth', 8)), passive = args.includes('--passive'), resumeEvery = Number(value('--resume-every', 17));
  assert.ok(Number.isSafeInteger(start) && start >= 0 && Number.isSafeInteger(count) && count > 0 && count <= 1000);
  assert.ok(width >= 1 && width <= 30 && depth >= 1 && depth <= 16);
  await mkdir(OUTPUT, { recursive: true });
  const report = [], covered = new Set(), stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (let seed = start; seed < start + count; seed++) {
    let trace, replayed;
    try { trace = playAdventure(seed, { width, depth, passive, resumeEvery }); replayed = replay(trace); }
    catch (error) {
      const filename = `act1-release-error-${stamp}-seed-${seed}.json`;
      await writeFile(resolve(OUTPUT, filename), JSON.stringify({ seed, contentRevision: CONTENT_REVISION, runtimeRevision: RUNTIME_REVISION, message: error.message, trace: error.acceptanceTrace }, null, 2));
      console.error(JSON.stringify({ seed, error: error.message, evidence: `.local/evidence/${filename}` })); process.exitCode = 1; return;
    }
    const filename = `act1-release-${stamp}-${passive ? 'passive-' : ''}seed-${seed}.json`;
    await writeFile(resolve(OUTPUT, filename), JSON.stringify(trace, null, 2));
    const row = { seed, phase: trace.final.phase, completedFloors: trace.completedFloors, hp: trace.final.hp, actions: trace.actions.length, bosses: trace.bosses.map(boss => boss.enemies.join('+')), resumes: trace.resumes.length, wallTimeMs: trace.botWallTimeMs, evidence: `.local/evidence/${filename}`, replayed: replayed.phase };
    report.push(row); console.log(JSON.stringify(row));
    if (trace.final.phase === 'victory') for (const boss of row.bosses) covered.add(boss);
    await writeFile(resolve(OUTPUT, `act1-release-summary-${stamp}.json`), JSON.stringify({ scope: 'Normal configured values; public actions only; deterministic strategy search is not human/browser/device acceptance', contentRevision: trace.contentRevision, victories: [...covered], runs: report }, null, 2));
    if (args.includes('--cover-bosses') && covered.size >= 3) break;
  }
  if (args.includes('--cover-bosses')) {
    for (const boss of ['slime_boss', 'guardian', 'hexaghost']) assert.ok(covered.has(boss), `正常数值轨迹未获胜覆盖首领 ${boss}；查看 .local/evidence/ 的逐步动作。`);
  }
  if (passive) assert.ok(report.every(row => row.phase === 'defeat'), '被动失败用例未正常进入失败结局。');
  assert.ok(report.every(row => ['victory', 'defeat'].includes(row.phase)), '轨迹到达动作上限，未正常结束。');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
