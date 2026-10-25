import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/generated/content-data.js';
import { validateContent, isAllowedStatePath } from '../src/runtime/content-schema.js';
import { createConfiguredRoute, isValidConfiguredRoute } from '../src/runtime/world.js';

const clone = () => structuredClone(CONTENT);
function invalid(mutate, pattern) {
  const content = clone(); mutate(content); let errors;
  assert.doesNotThrow(() => { errors = validateContent(content); });
  assert.ok(errors.length, 'invalid table was accepted');
  if (pattern) assert.match(errors.join('\n'), pattern);
  return errors;
}
const card = content => content.cards.ic_strike;
const enemy = content => content.enemies.cultist;
const map = content => content.acts.act1.map;

test('all current content validates without modifying authored tables', () => {
  const content = clone(), before = JSON.stringify(content);
  assert.deepEqual(validateContent(content), []); assert.equal(JSON.stringify(content), before);
});

test('new cards, monsters, encounters, acts and effects do not require fixed content counts', () => {
  const content = clone();
  content.visuals.customPulse = { ...content.visuals.slash, id:'customPulse' };
  content.cards.custom_strike = { ...structuredClone(content.cards.ic_strike), id:'custom_strike', rarity:'common', pool:'custom_pool' };
  content.cards.custom_strike.visual.impact = 'customPulse';
  content.enemies.custom_guard = { ...structuredClone(content.enemies.cultist), id:'custom_guard', name:'自定义首领', kind:'boss' };
  content.encounters.custom_encounter = { id:'custom_encounter', label:'新遭遇', pools:['custom_boss'], weight:1, composition:{fixed:['custom_guard']} };
  const act = structuredClone(content.acts.act1); act.id='custom_act';act.encounterPools.boss='custom_boss';act.specialCards.push('custom_strike');content.acts.custom_act=act;
  assert.deepEqual(validateContent(content), []);
});

test('missing tables, malformed records and mismatched IDs return diagnostics instead of throwing', () => {
  for (const mutate of [c=>{delete c.cards;}, c=>{c.enemies=[];}, c=>{c.cards.ic_strike=null;}, c=>{c.cards.ic_strike.id='different';}]) invalid(mutate, /cards|enemies/);
  assert.ok(validateContent(null).length); assert.ok(validateContent([]).length);
});

test('expressions reject unknown operators, arity errors, mixed discriminants and unsafe paths', () => {
  const bad = [
    {op:'javascript',args:[1]}, {op:'add',args:[]}, {op:'floor',args:[1,2]}, {op:'sub',args:[1]},
    {stat:'player.hp',random:[1,3]}, {stat:'player.hp;alert(1)'}, {stat:'player..hp'}, {stat:'source.constructor.foo'},
    {stat:'player.hp',typo:true}, {count:{zone:'bogus'}}, {count:{zone:'hand',type:'magic'}}, {count:{zone:'hand',excludeSelf:'true'}}, {debt:'erase'},
  ];
  for (const value of bad) invalid(c=>{card(c).effects[0].amount=value;}, /cards\[ic_strike\]\.effects\[0\]\.amount/);
});

test('constant expressions and random ranges reject nonfinite, reversed and fractional counts', () => {
  for (const amount of [NaN,Infinity,'6',{op:'pow',args:[10,10000]},{random:[4,2]},{random:[.5,2]},{random:[1,2,3]}]) invalid(c=>{card(c).effects[0].amount=amount;}, /cards\[ic_strike\]/);
  invalid(c=>{card(c).effects=[{op:'draw',amount:{random:[-2,2]}}];},/amount/);
  invalid(c=>{card(c).effects=[{op:'draw',amount:2.5}];},/amount/);
});

test('initial state recursively validates AST and cannot overwrite identity or runtime structure', () => {
  invalid(c=>{enemy(c).initial={ai:{nested:{roll:{random:[7,2]}}}};}, /enemies\[cultist\]\.initial\.ai\.nested\.roll/);
  invalid(c=>{enemy(c).initial={ai:{damage:{op:'eval',args:[]}}};}, /initial\.ai\.damage/);
  invalid(c=>{enemy(c).initial={block:'ten'};}, /initial\.block/);
  invalid(c=>{enemy(c).initial={block:-1};}, /initial\.block/);
  invalid(c=>{enemy(c).initial={artifact:1.5};}, /initial\.artifact/);
  invalid(c=>{enemy(c).initial={uid:'imposter'};}, /initial\.uid/);
  invalid(c=>{enemy(c).initial={ai:{history:{bad:true}}};}, /initial\.ai\.history/);
  invalid(c=>{enemy(c).initial={ai:{random:[0,3]}};}, /initial\.ai/);
  const content=clone();enemy(content).initial={strength:-2,minion:true,ai:{phase:'asleep',nested:{counter:{random:[1,3]}}}};
  assert.deepEqual(validateContent(content),[]);
});

test('prototype payloads, cycles and executable values are rejected before traversal', () => {
  invalid(c=>{card(c).visual=JSON.parse('{"__proto__":{"polluted":true}}');},/cards\[ic_strike\]\.visual\.__proto__/);
  invalid(c=>{card(c).source={constructor:{prototype:{x:1}}};},/constructor/);
  invalid(c=>{card(c).source=card(c);},/循环引用/);
  invalid(c=>{card(c).source=()=>1;},/JSON数据/);
  invalid(c=>{card(c).source=new Date();},/普通JSON/);
  assert.equal({}.polluted,undefined);
});

test('safeSet validator accepts the same bounded field surface as runtime', () => {
  for(const path of ['strength','dexterity','block','curlUp','noDraw','ai.phase','ai.nested.counter']) assert.equal(isAllowedStatePath(path),true,path);
  for(const path of ['hp','gold','uid','deck','ai','ai.','ai.__proto__.x','ai.constructor.x','ai.prototypeThing','ai.x[0]','ai.x;alert']) assert.equal(isAllowedStatePath(path),false,path);
  invalid(c=>{card(c).effects=[{op:'set',target:'self',path:'hp',value:999}];},/effects\[0\]\.path/);
  invalid(c=>{card(c).effects=[{op:'set',path:'block',value:'unlimited'}];},/effects\[0\]\.value/);
});

test('effect operations validate required data and reject ignored or internal fields', () => {
  for(const effect of [
    {op:'damage',amount:6},{op:'draw'},{op:'status',key:'hp',amount:2},{op:'addCard',cardId:'ic_strike'},
    {op:'exhaust',selection:'resolved'},{op:'moveCard',selection:'chosen',from:'powerZone',to:'hand'},
    {op:'copyCard',selection:'everything',zone:'hand'},{op:'upgrade',selection:'all'},
    {op:'modifyCard',key:'cardId',amount:1},{op:'if',condition:true},
    {op:'draw',amount:1,ammount:2},{op:'_finishCard'},{op:'damage',target:'enemy',amount:6,attack:'true'},
    {op:'power',id:'no_draw',duration:'until_next_year'}, {op:'transformCards',from:'status_burn',to:'status_burn_plus',zones:['combat']},
  ]) invalid(c=>{card(c).effects=[effect];}, /cards\[ic_strike\]\.effects\[0\]/);
});

test('all content references are checked before the game uses them', () => {
  invalid(c=>{card(c).effects=[{op:'power',id:'missing'}];},/powers\.missing/);
  invalid(c=>{card(c).effects=[{op:'addCard',cardId:'missing',zone:'hand'}];},/cards\.missing/);
  invalid(c=>{enemy(c).moves.ritual.effects=[{op:'summon',ids:['missing']}];},/enemies\.missing/);
  invalid(c=>{enemy(c).moves.ritual.effects=[{op:'changeIntent',move:'missing'}];},/行动/);
  invalid(c=>{c.events.market.choices[0].encounterId='missing';},/encounters\.missing/);
  invalid(c=>{c.acts.act1.specialCards.push('missing');},/cards\.missing/);
  invalid(c=>{c.acts.act1.encounterPools.boss='missing';},/空遭遇池/);
  invalid(c=>{card(c).visual.impact='missing';},/visuals\.missing/);
});

test('card keywords, costs, templates and upgrade overrides remain typed', () => {
  for(const cost of [-1,.5,'1',true]) invalid(c=>{card(c).cost=cost;},/cards\[ic_strike\]\.cost/);
  invalid(c=>{card(c).keywords='exhaust';},/keywords/);
  invalid(c=>{card(c).keywords=['exhaust','exhaust'];},/重复项/);
  invalid(c=>{card(c).keywords=['retain'];},/keywords/);
  invalid(c=>{card(c).text='造成{undefinedDamage}伤害';},/textValues\.undefinedDamage/);
  invalid(c=>{card(c).textValues={damage:{op:'div',args:[1]}};},/textValues\.damage/);
  invalid(c=>{card(c).upgrade.cost=-3;},/upgrade\.cost/);
  const content=clone();card(content).cost='X';card(content).text='造成{damage}伤害';card(content).textValues={damage:{stat:'player.block'}};delete card(content).upgrade.text;
  assert.deepEqual(validateContent(content),[]);
});

test('powers and triggers reject wrong boundaries, event names and duplicate limits', () => {
  invalid(c=>{c.powers.no_draw.expires='never_called';},/powers\[no_draw\]\.expires/);
  invalid(c=>{c.powers.no_draw.modifiers.unlimited=true;},/modifiers\.unlimited/);
  invalid(c=>{enemy(c).triggers[0].event='afterTick';},/triggers\[0\]\.event/);
  invalid(c=>{enemy(c).triggers[0].limit='onceForever';},/triggers\[0\]\.limit/);
  invalid(c=>{enemy(c).triggers.push(structuredClone(enemy(c).triggers[0]));},/重复项/);
});

test('AI rules reject empty sequences, illegal weights, incompatible selectors and dead ends', () => {
  for(const rule of [
    {sequence:{moves:[]}},{sequence:{moves:['ritual'],index:{op:'nope',args:[]}}},
    {weighted:[{move:'ritual',weight:0}]},{weighted:[{move:'ritual',weight:-1}]},
    {weighted:[{move:'ritual',weight:1,maxRepeat:0}]},{weighted:[{move:'ritual',weight:1,maxRepeat:1}]},
    {weighted:[{move:'ritual',weight:1,when:false}]},{move:'ritual',sequence:{moves:['ritual']}},
    {move:'ritual',when:false},{move:'missing'},
  ]) invalid(c=>{enemy(c).ai.rules=[rule];},/enemies\[cultist\]\.ai\.rules/);
  const content=clone();enemy(content).ai.rules=[{weighted:[{move:'ritual',weight:2,maxRepeat:1},{move:'cultist_attack',weight:1,maxRepeat:2}]}];
  assert.deepEqual(validateContent(content),[]);
});

test('encounters reject empty slots, oversized groups and overdrawn finite bags', () => {
  for(const composition of [
    {slots:[{options:[]}]},{slots:[{options:['cultist'],count:0}]},{fixed:['cultist'],slots:[{options:['jaw'],count:5}]},
    {bag:['cultist'],count:2},{fixed:[]},{variants:[[]]},{variants:[{enemies:['cultist'],weight:-1}]},{fixed:['cultist'],count:2},
  ]) invalid(c=>{c.encounters.weak_cultist.composition=composition;},/encounters\[weak_cultist\]\.composition/);
});

test('map dimensions, fixed floors and numeric distributions are validated before generation', () => {
  for(const mutate of [
    c=>{map(c).nodeCount=[0,3];},c=>{map(c).nodeCount=[3,2];},c=>{map(c).nodeCount=[2,4];},
    c=>{map(c).fixedFloors[17]={type:'boss',count:1};},c=>{map(c).fixedFloors[16].type='rest';},
    c=>{map(c).branchChance=1.1;},c=>{map(c).typeWeights.battle=-1;},c=>{map(c).constraints.minFloor.elite=14;},
    c=>{map(c).constraints.noConsecutive=['castle'];},c=>{map(c).typeWeights={elite:1};},
    c=>{map(c).fixedFloors[14]={type:'rest',count:1};},
  ]) invalid(mutate,/acts\[act1\]\.map/);
});

test('eligible type restrictions are respected even by the generated battle-lane fallback', () => {
  const content=clone(),m=map(content);m.fixedFloors[1]={type:'event',count:3};m.constraints.minFloor.battle=3;
  assert.deepEqual(validateContent(content),[]);
  for(const seed of [0,1,17,57]) {const route=createConfiguredRoute('act1',seed,content);assert.ok(isValidConfiguredRoute(route,content));assert.ok(route.nodes.filter(node=>node.floor===2).every(node=>node.type!=='battle'));}
});

test('act costs, reward probabilities, pools and difficulty values have finite valid ranges', () => {
  invalid(c=>{c.acts.act1.starting.deck[0].count=0;},/starting\.deck\[0\]\.count/);
  invalid(c=>{c.acts.act1.starting.energy=0;},/starting\.energy/);
  invalid(c=>{c.acts.act1.rewards.rarityWeights={common:0};},/rarityWeights/);
  invalid(c=>{c.acts.act1.rewards.debtChance.rare=1.5;},/debtChance\.rare/);
  invalid(c=>{c.acts.act1.difficultyModifiers[1].hpMultiplier=0;},/hpMultiplier/);
  invalid(c=>{c.acts.act1.difficultyModifiers.push(c.acts.act1.difficultyModifiers[0]);},/重复项/);
  invalid(c=>{c.acts.act1.eventPool=[];},/eventPool/);
  invalid(c=>{c.acts.act1.cardPools=['missing'];c.acts.act1.specialCards=[];},/没有可提供的奖励牌/);
});

test('event choices cannot all be disabled, duplicate IDs or override reserved services', () => {
  invalid(c=>{c.events.market.choices.forEach(choice=>{choice.when={op:'gt',args:[{stat:'player.hp'},100]};});},/无条件可选出口/);
  invalid(c=>{c.events.market.choices[1].id=c.events.market.choices[0].id;},/重复项/);
  invalid(c=>{c.events.rest={...structuredClone(c.events.market),id:'rest'};},/通用节点服务保留/);
});

test('bitmap visual fields reject invalid assets, timings, anchors and keyframe ranges', () => {
  for(const mutate of [
    c=>{c.visuals.slash.asset='https://bad/remote';},c=>{c.visuals.slash.durationMs=0;},c=>{c.visuals.slash.size=-1;},
    c=>{c.visuals.slash.anchor='screen';},c=>{c.visuals.slash.scale=[1,2];},c=>{c.visuals.slash.rotation=[0];},
    c=>{c.visuals.slash.travel=[0,0,0];},c=>{c.visuals.slash.opacity=[0,2,0];},c=>{delete c.visuals.slash.asset;},
  ]) invalid(mutate,/visuals\[slash\]/);
});

test('optional mechanic display conditions and placeholders are validated generically', () => {
  const content=clone();const lines=content.enemies.guardian.traits.find(trait=>trait.id==='mode_shift').display;
  assert.equal(lines.length,2);assert.equal(lines[0].textValues.remaining.stat,'source.ai.shiftRemaining');assert.deepEqual(validateContent(content),[]);
  invalid(c=>{c.enemies.guardian.traits[0].display=[{when:{op:'bad',args:[]},text:'状态'}];},/traits\[0\]\.display\[0\]\.when/);
  invalid(c=>{c.enemies.guardian.traits[0].display=[{text:'需要{remaining}伤害'}];},/display\[0\]\.textValues\.remaining/);
  invalid(c=>{c.enemies.guardian.traits[0].display=[{text:'剩余{remaining}',textValues:{remaining:{stat:'source.hp;alert'}}}];},/textValues\.remaining/);
  invalid(c=>{c.enemies.guardian.traits[0].display=[{text:'状态',effects:[]}];},/display\[0\]\.effects/);
  const extended=clone();extended.enemies.cultist.traits[0].display=[{text:'仪式 {amount}',textValues:{amount:{stat:'source.ritual'}}}];assert.deepEqual(validateContent(extended),[]);
});

test('malformed nested containers accumulate useful field diagnostics without runtime exceptions', () => {
  for(const mutate of [
    c=>{card(c).upgrade=[];},c=>{card(c).visual=[];},c=>{enemy(c).initial.ai=[];},c=>{enemy(c).moves=[];},
    c=>{enemy(c).ai.rules='bad';},c=>{c.encounters.weak_cultist.composition.slots=[null];},
    c=>{map(c).constraints.noConsecutive={bad:true};},c=>{c.acts.act1.specialCards=2;},c=>{c.events.market.choices=[null];},
  ]) invalid(mutate);
});
