import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createConfiguredRoute, isValidConfiguredRoute, getConfiguredAvailableNodes, sampleConfiguredEncounter, createConfiguredEnemy, planConfiguredIntent, getConfiguredMoveIntent, getConfiguredIntentView } from '../src/runtime/world.js';
import { randomFromState } from '../src/runtime/expressions.js';
import { initializeResolution, newFrame, queueEffects, drainEffects, fireEvent, applyHpLoss } from '../src/runtime/effects.js';

const content = { cards: {}, powers: {}, visuals: {} };
for (const file of ['enemies', 'encounters', 'acts', 'events']) content[file] = Object.fromEntries(JSON.parse(await readFile(new URL(`../content/${file}.json`, import.meta.url))).map(item => [item.id, item]));
for (const id of ['status_slimed', 'status_dazed', 'status_burn', 'status_burn_plus', 'status_wound']) content.cards[id] = { id, name: id, type: 'status', cost: null, effects: [], keywords: ['unplayable'] };
const random = state => () => randomFromState(state);
const alive = enemy => enemy.hp > 0 && !enemy.escaped && !enemy.dead;

function scenario(ids, seed = 30) {
  const state = { phase: 'combat', rngState: seed, hp: 80, maxHp: 80, block: 0, energy: 3, strength: 0, dexterity: 0, weak: 0, exposed: 0, frail: 0, artifact: 0, gold: 99, turn: 1, combatTurn: 1, turnStage: 'player', debts: [], stats: { battlesStarted: 1 }, combatCounters: { hpLossEvents: 0 }, nextUid: 1, nextEnemyUid: 1, hand: [], drawPile: [], discard: [], exhaust: [], deck: [], deckCards: [], enemies: [], powers: {}, freshStatuses: {}, log: [] };
  initializeResolution(state);
  state.enemies = ids.map((id, index) => createConfiguredEnemy(id, state, index, content, random(state)));
  for (const enemy of state.enemies) enemy.intent = planConfiguredIntent(state, enemy, content, random(state));
  return state;
}
function hooks(state) {
  return {
    changeIntent: (current, source, move) => { source.intent = getConfiguredMoveIntent(current, source, move, content, random(current)); },
    summon(current, source, effect) {
      const children = effect.ids.map((id, index) => createConfiguredEnemy(id, current, index, content, random(current), effect.inheritHp ? source.hp : null));
      if (effect.replaceSource) current.enemies.splice(current.enemies.indexOf(source), 1, ...children); else current.enemies.push(...children);
      for (const enemy of children) enemy.intent = planConfiguredIntent(current, enemy, content, random(current));
    },
  };
}
function run(state, effects, details = {}) { queueEffects(state, effects, newFrame(state, details)); drainEffects(state, content, hooks(state)); }
function hurt(state, enemy, amount, attack = true) {
  applyHpLoss(state, content, enemy, amount, { sourceUid: 'player', attack, ignoreBlock: false });
  drainEffects(state, content, hooks(state));
}
function tick(state, protect = true) {
  if (protect) state.block = 100000;
  state.turnStage = 'enemies';
  for (const enemy of state.enemies.filter(alive)) enemy.block = 0;
  const actors = state.enemies.filter(alive).map(enemy => enemy.uid);
  for (const uid of actors) {
    const enemy = state.enemies.find(item => item.uid === uid && alive(item));
    if (!enemy) continue;
    const action = enemy.intent;
    run(state, action.effects, { sourceUid: uid, targetUid: action.targetUid || 'player' });
    if (!state.enemies.includes(enemy)) continue;
    enemy.turns++; enemy.ai.history.push(action.move);
    fireEvent(state, content, 'enemyActionEnd', { actorUid: uid, move: action.move });
    drainEffects(state, content, hooks(state));
  }
  state.turn++; state.combatTurn++; state.turnStage = 'player';
  for (const enemy of state.enemies.filter(alive)) enemy.intent = planConfiguredIntent(state, enemy, content, random(state));
  return state;
}

test('world content keeps all A0 enemy roles and encounter compositions in source tables', () => {
  assert.equal(Object.keys(content.enemies).length, 25);
  assert.equal(Object.values(content.enemies).filter(item => item.kind === 'normal').length, 19);
  for (const [pool, count] of [['act1_weak',4],['act1_strong',10],['act1_elite',3],['act1_boss',3]]) assert.equal(Object.values(content.encounters).filter(item => item.pools.includes(pool)).length, count);
  for (const enemy of Object.values(content.enemies)) {
    assert.ok(enemy.art && enemy.reference && enemy.source.game === 'Slay the Spire');
    assert.ok(Object.keys(enemy.moves).length && enemy.ai.rules.length);
  }
  assert.deepEqual(sampleConfiguredEncounter('event_mushrooms', () => .3, content).enemies, ['fungi','fungi','fungi']);
});

test('600 seeds produce reachable random topology and types while keeping act milestones', () => {
  const signatures = new Set(), types = new Set(), counts = new Set(), bosses = new Set();
  for (let seed = 0; seed < 600; seed++) {
    const route = createConfiguredRoute('act1', seed, content);
    assert.ok(isValidConfiguredRoute(route, content), `invalid route for seed ${seed}`);
    assert.deepEqual(route, createConfiguredRoute('act1', seed, content));
    signatures.add(JSON.stringify(route.nodes.map(node => [node.column,node.type,node.next])));
    counts.add(route.nodes.length); bosses.add(route.bossId);
    for (const node of route.nodes) {
      types.add(node.type);
      if (node.row < 15) assert.ok(node.next.length);
      for (const id of node.next) {
        const next = route.nodes.find(item => item.id === id);
        assert.equal(next.row, node.row + 1);
        assert.ok(node.type !== next.type || !['rest','elite','shop'].includes(node.type));
      }
    }
    for (const [floor,type] of [[1,'battle'],[9,'treasure'],[15,'rest'],[16,'boss']]) assert.ok(route.nodes.filter(node => node.floor === floor).every(node => node.type === type));
    const state = { phase: 'map', route, contentSnapshot: content };
    let visited = 0;
    while (true) {
      const available = getConfiguredAvailableNodes(state);
      if (!available.length) break;
      const chosen = available[(seed + visited) % available.length];
      route.path.push(chosen.id); route.currentId = chosen.id; route.completedIds.push(chosen.id); visited++;
    }
    assert.equal(visited, 16);
  }
  assert.equal(signatures.size, 600); assert.ok(counts.size >= 8); assert.equal(bosses.size, 3); assert.equal(types.size, 7);
});

test('saved route validation rejects disconnected, forbidden and malformed paths', () => {
  const original = createConfiguredRoute('act1', 16, content);
  const mutate = fn => { const route = structuredClone(original); fn(route); assert.equal(isValidConfiguredRoute(route,content),false); };
  mutate(route => { route.nodes[0].next = []; });
  mutate(route => { route.nodes[0].next = [route.nodes.find(node => node.row === 3).id]; });
  mutate(route => { route.nodes[1].column = route.nodes[0].column; });
  mutate(route => { route.nodes.find(node => node.floor === 9).type = 'shop'; });
  mutate(route => { route.path = [route.nodes.at(-1).id]; route.currentId = route.path[0]; });
  mutate(route => { route.bossId = 'missing'; });
  const suspended = { phase:'combat',route:original }; assert.deepEqual(getConfiguredAvailableNodes(suspended,content),[]);
});

test('new act and enemy can be introduced solely as content rows', () => {
  const custom = structuredClone(content);
  custom.enemies.custom_guard = { id:'custom_guard',name:'新策划守卫',hpRange:[33,33],art:'enemy-sentry',initial:{artifact:2},moves:{pulse:{label:'两段护体',effects:[{op:'damage',target:'player',amount:5,hits:2},{op:'block',amount:4,target:'source'}]}},ai:{rules:[{move:'pulse'}]},triggers:[],traits:[] };
  custom.encounters.custom_boss = {id:'custom_boss',label:'新幕守卫',pools:['custom_boss_pool'],weight:1,composition:{fixed:['custom_guard']}};
  custom.acts.custom_act = structuredClone(custom.acts.act1);
  Object.assign(custom.acts.custom_act,{id:'custom_act',number:2});
  custom.acts.custom_act.encounterPools.boss = 'custom_boss_pool';
  custom.acts.custom_act.map = {floors:7,columns:4,nodeCount:[2,3],fixedFloors:{1:{type:'battle',count:3},4:{type:'treasure',count:1},6:{type:'rest',count:1},7:{type:'boss',count:1}},typeWeights:{battle:50,event:25,shop:25},constraints:{noConsecutive:['shop']},branchChance:.7};
  const route = createConfiguredRoute('custom_act',135,custom); assert.ok(isValidConfiguredRoute(route,custom)); assert.equal(route.floorCount,7); assert.equal(route.bossId,'custom_boss');
  const state = scenario([]); const enemy = createConfiguredEnemy('custom_guard',state,0,custom,random(state)); state.enemies=[enemy]; enemy.intent=planConfiguredIntent(state,enemy,custom,random(state));
  assert.equal(enemy.hp,33); assert.equal(enemy.artifact,2); assert.equal(getConfiguredIntentView(state,enemy,custom).total,10);
  assert.deepEqual(sampleConfiguredEncounter('custom_boss_pool',random(state),custom).enemies,['custom_guard']);
});

test('weighted encounter sampling respects finite bags, varied combinations and exclusions', () => {
  const state={rngState:9}; const counts={}; const shapes=new Set();
  for(let i=0;i<8000;i++) {
    const encounter=sampleConfiguredEncounter('act1_strong',random(state),content); counts[encounter.id]=(counts[encounter.id]||0)+1;
    assert.ok(encounter.enemies.length>=1 && encounter.enemies.length<=5);
    if(encounter.id==='strong_gremlins') {
      assert.equal(encounter.enemies.length,4);
      assert.ok(encounter.enemies.filter(id=>id==='gremlin_shield').length<=1);
      assert.ok(encounter.enemies.filter(id=>id==='gremlin_wizard').length<=1);
      for(const id of ['gremlin_mad','gremlin_sneaky','gremlin_fat']) assert.ok(encounter.enemies.filter(item=>item===id).length<=2);
      shapes.add(encounter.enemies.slice().sort().join(','));
    }
  }
  assert.equal(Object.keys(counts).length,10); assert.ok(shapes.size>20);
  assert.ok(counts.strong_looter > counts.strong_red_slaver*1.6 && counts.strong_looter < counts.strong_red_slaver*2.5);
  for(let i=0;i<50;i++) assert.notEqual(sampleConfiguredEncounter('act1_weak',random(state),content,['weak_cultist']).id,'weak_cultist');
  assert.throws(()=>sampleConfiguredEncounter('missing',random(state),content),/遭遇池/);
});

test('all 25 monster records plan and execute for 20 protected rounds without ID dispatch', () => {
  for (const id of Object.keys(content.enemies)) {
    const state=scenario([id]);
    for(let turn=0;turn<20;turn++) {
      const enemy=state.enemies.find(alive); if(!enemy) break;
      const before=state.rngState; const view=getConfiguredIntentView(state,enemy,content); assert.equal(before,state.rngState); assert.ok(view.label && view.detail); assert.ok(Number.isFinite(view.total));
      tick(state); assert.equal(state.hp,80,`${id} should be fully blocked in the harness`);
    }
  }
});

test('cultist, wizard, nob and sentry timing retains distinct A0 encounters', () => {
  const cultist=scenario(['cultist']); const damage=[];
  for(let i=0;i<5;i++){damage.push(getConfiguredIntentView(cultist,cultist.enemies[0],content).total);tick(cultist);}
  assert.deepEqual(damage,[0,6,9,12,15]);
  const wizard=scenario(['gremlin_wizard']); const pattern=[];
  for(let i=0;i<7;i++){pattern.push(getConfiguredIntentView(wizard,wizard.enemies[0],content).total);tick(wizard);}
  assert.deepEqual(pattern,[0,0,25,0,0,0,25]);
  const sentries=scenario(['sentry','sentry','sentry']); assert.deepEqual(sentries.enemies.map(enemy=>getConfiguredIntentView(sentries,enemy,content).total),[0,9,0]); tick(sentries);
  assert.equal(sentries.discard.filter(card=>card.cardId==='status_dazed').length,4); assert.deepEqual(sentries.enemies.map(enemy=>getConfiguredIntentView(sentries,enemy,content).total),[9,0,9]);
  const nob=scenario(['nob']); fireEvent(nob,content,'cardPlayed',{cardType:'skill',sourceUid:'player'}); drainEffects(nob,content,hooks(nob)); assert.equal(nob.enemies[0].strength,0); tick(nob);
  fireEvent(nob,content,'cardPlayed',{cardType:'power',sourceUid:'player'}); drainEffects(nob,content,hooks(nob)); assert.equal(nob.enemies[0].strength,0);
  fireEvent(nob,content,'cardPlayed',{cardType:'skill',sourceUid:'player'}); drainEffects(nob,content,hooks(nob)); assert.equal(nob.enemies[0].strength,2);
  const sequence=[];for(let i=0;i<80;i++){sequence.push(nob.enemies[0].intent.move);tick(nob);} assert.ok(!sequence.join(',').includes('nob_rush,nob_rush,nob_rush'));
});

test('curl and anger require actual attack HP loss, not hits absorbed by block', () => {
  const state=scenario(['louse_red','gremlin_mad']); const [louse,mad]=state.enemies; const curl=louse.curlUp; const bite=louse.ai.biteDamage;
  louse.block=6;hurt(state,louse,6);assert.equal(louse.curlUp,curl);hurt(state,louse,1);assert.equal(louse.curlUp,0);assert.equal(louse.block,curl);
  mad.block=10;hurt(state,mad,5);assert.equal(mad.strength,0);hurt(state,mad,6);assert.equal(mad.strength,1);
  tick(state);assert.equal(louse.ai.biteDamage,bite);assert.equal(louse.curlUp,0);
});

test('sleep natural wake and interrupted wake have different preparation windows', () => {
  const natural=scenario(['lagavulin']); for(let i=0;i<3;i++)tick(natural);assert.equal(natural.enemies[0].intent.move,'lag_attack');
  const forced=scenario(['lagavulin']);const enemy=forced.enemies[0];hurt(forced,enemy,8);assert.equal(enemy.ai.awake,false);hurt(forced,enemy,1);assert.equal(enemy.ai.awake,true);assert.equal(enemy.intent.move,'stunned');
  tick(forced);assert.equal(enemy.intent.move,'lag_attack');tick(forced);tick(forced);assert.equal(enemy.intent.move,'siphon');
  forced.artifact=1;tick(forced);assert.equal(forced.dexterity,0);assert.equal(forced.strength,-1);
});

test('slime split replaces the announcement and inherits the final remaining HP at execution', () => {
  const state=scenario(['slime_boss']);const boss=state.enemies[0];hurt(state,boss,71);assert.equal(boss.hp,69);assert.equal(boss.intent.move,'split');hurt(state,boss,14);assert.equal(boss.hp,55);
  tick(state);assert.deepEqual(state.enemies.map(enemy=>[enemy.id,enemy.hp,enemy.maxHp,enemy.turns]),[['acid_l',55,55,0],['spike_l',55,55,0]]);
  const defeated=scenario(['acid_l']);hurt(defeated,defeated.enemies[0],100);assert.equal(defeated.enemies.length,1);assert.equal(defeated.enemies[0].dead,true);assert.ok(!defeated.events.some(event=>event.type==='summoned'));
});

test('guardian form thresholds and reflect trigger are data driven and repeat correctly', () => {
  const state=scenario(['guardian']);const guardian=state.enemies[0];hurt(state,guardian,30);assert.equal(guardian.ai.phase,'defense');assert.equal(guardian.block,20);assert.equal(guardian.intent.move,'defensive');
  tick(state);assert.equal(guardian.sharpHide,3);assert.equal(guardian.intent.move,'roll');
  state.block=0;fireEvent(state,content,'cardPlayed',{cardType:'attack',sourceUid:'player'});drainEffects(state,content,hooks(state));assert.equal(state.hp,77);
  fireEvent(state,content,'cardPlayed',{cardType:'skill',sourceUid:'player'});drainEffects(state,content,hooks(state));assert.equal(state.hp,77);
  tick(state);tick(state);assert.equal(guardian.sharpHide,0);assert.equal(guardian.ai.phase,'offense');assert.equal(guardian.ai.shiftRemaining,40);assert.equal(guardian.intent.move,'whirlwind');
  guardian.block=0;hurt(state,guardian,39);assert.equal(guardian.ai.phase,'offense');hurt(state,guardian,1);assert.equal(guardian.ai.phase,'defense');
});

test('announced ally guard stays a guard when the ally dies; thieves and death spores resolve', () => {
  const state=scenario(['gremlin_shield','gremlin_sneaky']);const shield=state.enemies[0];assert.equal(shield.intent.move,'shield');hurt(state,state.enemies[1],100);tick(state);assert.equal(shield.block,7);assert.equal(shield.intent.move,'shield_attack');
  const looter=scenario(['looter']);tick(looter);assert.equal(looter.gold,84);assert.equal(looter.enemies[0].stolen,15);hurt(looter,looter.enemies[0],100);assert.equal(looter.gold,99);
  const escaped=scenario(['looter']);for(let i=0;i<6 && !escaped.enemies[0].escaped;i++)tick(escaped);assert.equal(escaped.enemies[0].escaped,true);assert.ok(escaped.gold<99);
  const fungi=scenario(['fungi','fungi']);hurt(fungi,fungi.enemies[0],100);assert.equal(fungi.hp,80);assert.equal(fungi.exposed,2);
});

test('hexaghost Divider snapshots current HP and Inferno transforms old and future burn', () => {
  const state=scenario(['hexaghost']);tick(state);const enemy=state.enemies[0];assert.equal(enemy.intent.move,'divider');assert.equal(getConfiguredIntentView(state,enemy,content).amount,7);
  state.hp=12;assert.equal(getConfiguredIntentView(state,enemy,content).amount,7);
  for(let i=0;i<8;i++)tick(state);
  assert.equal(enemy.ai.infernoUsed,true);assert.equal(enemy.strength,2);assert.ok(state.discard.length>=6);assert.ok(state.discard.every(card=>card.cardId==='status_burn_plus'));
  assert.equal(enemy.intent.move,'sear');tick(state);assert.ok(state.discard.every(card=>card.cardId==='status_burn_plus'));
});

test('act difficulty modifies newly rolled life and attack without multiplying split inheritance', () => {
  const state = scenario([]); state.actId='act1'; state.difficulty=1;
  const enemy=createConfiguredEnemy('cultist',state,0,content,()=>0);
  assert.equal(enemy.hp,Math.ceil(48*1.15));assert.equal(enemy.attackBonus,2);
  state.enemies=[enemy];enemy.turns=1;enemy.intent=planConfiguredIntent(state,enemy,content,()=>0);
  assert.equal(getConfiguredIntentView(state,enemy,content).amount,8);
  const split=createConfiguredEnemy('acid_m',state,0,content,()=>0,37);assert.equal(split.hp,37);assert.equal(split.maxHp,37);assert.equal(split.attackBonus,2);
  const custom=structuredClone(content);custom.acts.act1.difficultyModifiers.push({id:2,hpMultiplier:2,attackBonus:5});state.difficulty=2;
  assert.equal(createConfiguredEnemy('cultist',state,0,custom,()=>0).hp,96);
});
