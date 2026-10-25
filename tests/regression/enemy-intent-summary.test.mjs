import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getConfiguredIntentView, createConfiguredEnemy, getConfiguredMoveIntent } from '../../game/src/runtime/world.js';
import { newFrame, queueEffects, drainEffects } from '../../game/src/runtime/effects.js';

const content = { cards: {}, enemies: {}, powers: {} };
for (const table of ['cards', 'enemies']) content[table] = Object.fromEntries(JSON.parse(await readFile(new URL(`../../game/content/${table}.json`, import.meta.url))).map(item => [item.id, item]));

function scenario(effects, changes = {}) {
  const enemy = { id: 'jaw', uid: 'intent-source', hp: 40, maxHp: 40, block: 0, strength: 0, attackBonus: 0, dexterity: 0, weak: 0, exposed: 0, frail: 0, artifact: 0, stolen: 0, turns: 0, powers: {}, ai: {}, intent: { move: 'custom', label: '招式名称', effects }, ...changes };
  const state = { phase: 'combat', hp: 1000, maxHp: 1000, block: 0, gold: 99, strength: 0, dexterity: 0, weak: 0, exposed: 0, frail: 0, artifact: 0, turn: 1, turnStage: 'player', freshStatuses: {}, rngState: 1234, nextUid: 1, hand: [], drawPile: [], discard: [], exhaust: [], enemies: [enemy], powers: {}, debts: [], stats: { battlesStarted: 1 }, combatCounters: { hpLossEvents: 0 } };
  return { state, enemy, view: () => getConfiguredIntentView(state, enemy, content) };
}

test('意图摘要：当前力量、难度、虚弱、易伤与多段合计和实际结算一致', () => {
  const { state, enemy, view } = scenario([{ op: 'damage', target: 'player', amount: 5, hits: 4 }], { strength: 2, attackBonus: 1, weak: 1 });
  state.exposed = 1;
  state.block = 300;
  const intent = view();
  assert.deepEqual(intent.actions, [{ kind: 'attack', text: '攻击 9×4' }, { kind: 'attack', text: '合计 36伤害' }]);
  assert.equal(intent.amount, 9);
  assert.equal(intent.hits, 4);
  assert.equal(intent.total, 36);
  assert.ok(intent.detail.endsWith('伤害按当前状态计算，未扣除你的护甲。'));
  const resolved = structuredClone(state);
  resolved.block = 0;
  queueEffects(resolved, enemy.intent.effects, newFrame(resolved, { sourceUid: enemy.uid, targetUid: 'player' }));
  drainEffects(resolved, content);
  assert.equal(state.hp - resolved.hp, intent.total);
  enemy.strength = 0;
  enemy.weak = 0;
  state.exposed = 0;
  assert.equal(view().total, 24);
});

test('意图摘要：多条伤害效果均可见且只生成一次总计', () => {
  const { state, view } = scenario([{ op: 'damage', target: 'player', amount: 5, hits: 4 }, { op: 'damage', target: 'player', amount: 8, hits: 2 }], { strength: 2, attackBonus: 1, weak: 1 });
  state.exposed = 1;
  const intent = view();
  assert.deepEqual(intent.actions, [{ kind: 'attack', text: '攻击 9×4' }, { kind: 'attack', text: '攻击 12×2' }, { kind: 'attack', text: '合计 60伤害' }]);
  assert.deepEqual([intent.amount, intent.hits, intent.total], [9, 4, 60]);
  assert.match(intent.detail, /9×4.*12×2.*60/);
});

test('意图摘要：攻击附带护甲、状态、加牌去向和盗款全部展示', () => {
  const { view } = scenario([{ op: 'damage', target: 'player', amount: 8 }, { op: 'block', target: 'source', amount: 5 }, { op: 'status', target: 'player', key: 'weak', amount: 1 }, { op: 'addCard', cardId: 'status_slimed', amount: 2, zone: 'discard' }, { op: 'steal', amount: 15 }]);
  assert.deepEqual(view().actions, [
    { kind: 'attack', text: '攻击 8' },
    { kind: 'defend', text: '护甲 +5' },
    { kind: 'debuff', text: '你虚弱 1回合' },
    { kind: 'debuff', text: '弃牌 +2 黏液' },
    { kind: 'debuff', text: '盗走 ≤15冥钱' },
  ]);
});

test('意图摘要：负力量敏捷和缠绕用明确文字说明', () => {
  const { view } = scenario([{ op: 'status', target: 'player', key: 'dexterity', amount: -1 }, { op: 'status', target: 'player', key: 'strength', amount: -1 }, { op: 'status', target: 'player', key: 'entangled', amount: 1 }]);
  assert.deepEqual(view().actions.map(action => action.text), ['你失去 1敏捷', '你失去 1力量', '你缠绕 1回合']);
  assert.ok(view().actions.every(action => action.kind === 'debuff'));
  assert.match(view().detail, /无法打出攻击牌/);
});

test('意图摘要：友方护甲按目标敏捷脆弱修正，失效目标回退自身', () => {
  const { state, enemy, view } = scenario([{ op: 'block', target: 'ally', targetUid: 'chosen-ally', amount: 7 }], { dexterity: 2, frail: 1 });
  const ally = { id: 'acid_m', uid: 'chosen-ally', hp: 30, dexterity: 4, frail: 1 };
  state.enemies.push(ally, { id: 'spike_m', uid: 'other-ally', hp: 30, dexterity: 30 });
  assert.equal(view().amount, 8);
  assert.deepEqual(view().actions, [{ kind: 'defend', text: '护甲 +8' }, { kind: 'defend', text: '给予 腐泥灵' }]);
  ally.hp = 0;
  assert.equal(view().amount, 6);
  assert.deepEqual(view().actions, [{ kind: 'defend', text: '护甲 +6' }]);
  const resolved = structuredClone(state);
  queueEffects(resolved, enemy.intent.effects, newFrame(resolved, { sourceUid: enemy.uid, targetUid: ally.uid }));
  drainEffects(resolved, content);
  assert.equal(resolved.enemies[0].block, view().amount);
  ally.hp = 30;
  ally.dead = true;
  assert.equal(view().amount, 6);
  delete ally.dead;
  ally.escaped = true;
  assert.equal(view().amount, 6);
});

test('意图摘要：护甲修正遵循 modified=false 且不影响固定 set 护甲', () => {
  const { enemy, view } = scenario([{ op: 'block', target: 'source', amount: 9 }], { dexterity: 2, frail: 1 });
  assert.equal(view().amount, 8);
  assert.deepEqual(view().actions, [{ kind: 'defend', text: '护甲 +8' }]);
  enemy.intent.effects[0].modified = false;
  assert.equal(view().amount, 9);
  enemy.intent.effects = [{ op: 'set', target: 'source', path: 'block', value: 8 }];
  assert.deepEqual(view().actions, [{ kind: 'defend', text: '护甲变为 8' }]);
});

test('意图摘要：空行动保留招式名和描述并明确本轮不攻击', () => {
  const { enemy, view } = scenario([]);
  enemy.intent.description = '蓄咒中，准备下一次行动。';
  assert.deepEqual(view().actions, [{ kind: 'prepare', text: '本轮不攻击' }]);
  assert.equal(view().kind, 'prepare');
  assert.equal(view().label, '招式名称');
  assert.equal(view().detail, enemy.intent.description);
  assert.deepEqual([view().amount, view().hits, view().total], [0, 1, 0]);
  assert.deepEqual(getConfiguredIntentView({}, null, content).actions, [{ kind: 'prepare', text: '本轮不攻击' }]);
});

test('意图摘要：set 护甲采用最终值，荆甲和升级状态牌均可见', () => {
  const { enemy, view } = scenario([{ op: 'set', target: 'source', path: 'block', value: 8 }, { op: 'if', condition: { op: 'gte', args: [{ stat: 'source.turns' }, 2] }, then: [{ op: 'set', target: 'source', path: 'block', value: 0 }] }, { op: 'set', target: 'source', path: 'sharpHide', value: 3 }, { op: 'transformCards', from: 'status_burn', to: 'status_burn_plus', zones: ['hand', 'drawPile', 'discard', 'exhaust'] }], { turns: 2 });
  assert.deepEqual(view().actions, [{ kind: 'defend', text: '清除护甲' }, { kind: 'buff', text: '攻击牌反伤 3' }, { kind: 'debuff', text: '全部灼伤→灼伤·烈' }]);
  assert.match(view().detail, /每打出一张攻击牌/);
  assert.match(view().detail, /手牌、抽牌堆、弃牌堆、消耗堆/);
  enemy.intent.effects = [{ op: 'set', target: 'source', path: 'sharpHide', value: 0 }];
  assert.equal(view().actions[0].text, '移除荆甲反伤');
});

test('意图摘要：分裂、普通召唤与携款逃离按效果参数展示', () => {
  const { enemy, view } = scenario([{ op: 'summon', ids: ['acid_m', 'acid_m'], inheritHp: true, replaceSource: true }]);
  assert.deepEqual(view().actions, [{ kind: 'split', text: '分裂 2只' }, { kind: 'split', text: '子体 腐泥灵×2' }, { kind: 'split', text: '继承剩余生命' }]);
  assert.match(view().detail, /当前 40/);
  enemy.intent.effects = [{ op: 'summon', ids: ['acid_m', 'spike_m'], replaceSource: false }];
  assert.equal(view().actions[0].text, '召唤 2只');
  assert.match(view().detail, /腐泥灵、刺泥灵/);
  assert.doesNotMatch(view().detail, /继承/);
  enemy.intent.effects = [{ op: 'escape' }];
  enemy.stolen = 30;
  assert.deepEqual(view().actions, [{ kind: 'escape', text: '逃离战场' }, { kind: 'escape', text: '带走 30冥钱' }]);
});

test('意图摘要：读取条件、set 表达式和附加描述不修改原状态或随机流', () => {
  const { state, enemy, view } = scenario([{ op: 'damage', target: 'player', amount: 10, attack: false }, { op: 'if', condition: { stat: 'source.ai.active' }, then: [{ op: 'set', target: 'source', path: 'block', value: { op: 'add', args: [{ stat: 'source.block' }, 8] } }] }], { block: 2, strength: 50, weak: 1, ai: { active: true } });
  state.exposed = 1;
  enemy.intent.description = '附加说明仍然可见。';
  const before = structuredClone(state);
  const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } };
  freeze(state);
  assert.deepEqual(view().actions, [{ kind: 'attack', text: '攻击 10' }, { kind: 'defend', text: '护甲变为 10' }]);
  assert.match(view().detail, /附加说明仍然可见/);
  assert.deepEqual(state, before);
});

test('意图摘要：全部 25 种敌人 70 招均产生合法可读行动', () => {
  let count = 0;
  for (const definition of Object.values(content.enemies)) {
    const { state } = scenario([]);
    const enemy = createConfiguredEnemy(definition.id, state, 0, content, () => .25);
    state.enemies = [enemy];
    for (const moveId of Object.keys(definition.moves)) {
      enemy.intent = getConfiguredMoveIntent(state, enemy, moveId, content, () => .25);
      const before = structuredClone(state);
      const intent = getConfiguredIntentView(state, enemy, content);
      assert.ok(intent.actions.length, `${definition.id}/${moveId}`);
      for (const action of intent.actions) {
        assert.ok(['attack', 'defend', 'debuff', 'buff', 'split', 'escape', 'prepare'].includes(action.kind));
        assert.ok(action.text && !/undefined|NaN/.test(action.text), `${definition.id}/${moveId}: ${action.text}`);
      }
      assert.deepEqual(state, before);
      count++;
    }
  }
  assert.equal(count, 70);
});
