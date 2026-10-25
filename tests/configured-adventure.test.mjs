import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/generated/content-data.js';
import { createConfiguredAdventure, transitionConfigured as transition, getConfiguredCardView, getConfiguredEventView, getConfiguredEnemyIntent, isValidConfiguredSave, restoreConfiguredRun } from '../src/runtime/game.js';
import { getConfiguredAvailableNodes } from '../src/runtime/world.js';
import { makeCard } from '../src/runtime/effects.js';

const clone = value => structuredClone(value);
function frozen(value) { if (value && typeof value === 'object') { Object.freeze(value); for (const item of Object.values(value)) frozen(item); } return value; }
function linearContent(types, eventId = 'market') {
  const content=clone(CONTENT),act=clone(content.acts.act1);
  act.id='scenario_act';act.number=2;act.eventPool=[eventId];
  act.map={floors:types.length,columns:1,nodeCount:[1,1],fixedFloors:Object.fromEntries(types.map((type,index)=>[index+1,{type,count:1}])),typeWeights:{battle:1},constraints:{noConsecutive:[]},branchChance:0};
  content.acts[act.id]=act;return content;
}
function scenario(types, eventId='market', seed=42) { return createConfiguredAdventure(seed,{content:linearContent(types,eventId),actId:'scenario_act',runId:'test-fixed'}); }
function select(state) {
  assert.equal(state.phase,'map');const options=getConfiguredAvailableNodes(state);assert.ok(options.length);return transition(state,{type:'selectNode',nodeId:options[0].id});
}
function win(state) {
  assert.equal(state.phase,'combat');
  const fixture=clone(state);fixture.enemies.forEach(enemy=>{enemy.hp=1;enemy.block=0;});fixture.hand=[makeCard(fixture,'ic_cleave',{temporary:true})];fixture.drawPile=[];fixture.discard=[];fixture.exhaust=[];fixture.limbo=[];fixture.energy=3;fixture.weak=0;fixture.strength=0;
  const result=transition(fixture,{type:'play',uid:fixture.hand[0].uid});assert.ok(['reward','victory'].includes(result.phase),result.notice);return result;
}
function skip(state){return transition(state,{type:'reward',cardId:null});}
function choose(state,id){return transition(state,{type:'event',choiceId:id});}
function held(state,ids){const result=clone(state);result.hand=ids.map(id=>makeCard(result,id,{temporary:true}));result.drawPile=[];result.discard=[];result.exhaust=[];result.limbo=[];result.energy=10;return result;}

test('new adventure starts from config and every action leaves caller state untouched',()=>{
  const original=createConfiguredAdventure(99,{runId:'same'});assert.equal(original.version,4);assert.equal(original.ruleset,'config-v1');assert.equal(original.phase,'map');assert.equal(original.hp,80);assert.equal(original.gold,99);assert.equal(original.deck.length,10);assert.equal(original.deck.filter(id=>id==='ic_strike').length,5);assert.ok(isValidConfiguredSave(original));
  assert.deepEqual(original,createConfiguredAdventure(99,{runId:'same'}));
  const snapshot=JSON.stringify(original),input=frozen(original);
  const invalid=transition(input,{type:'play',uid:'missing'});assert.match(invalid.notice,/不在战斗/);
  const next=transition(input,{type:'selectNode',nodeId:getConfiguredAvailableNodes(input)[0].id});assert.equal(next.phase,'combat');assert.equal(JSON.stringify(input),snapshot);assert.ok(isValidConfiguredSave(next));assert.equal(next.hand.length,5);
});

test('normal battles consume exactly three weak encounters before strong pool',()=>{
  let state=scenario(['battle','battle','battle','battle','boss']);
  for(let round=0;round<4;round++){
    state=select(state);const encounter=state.contentSnapshot.encounters[state.encounterId];assert.ok(encounter.pools.includes(round<3?'act1_weak':'act1_strong'));assert.equal(state.normalBattles,round+1);
    state=win(state);assert.equal(state.rewards.length,3);assert.equal(new Set(state.rewards).size,3);state=skip(state);assert.ok(isValidConfiguredSave(state));
  }
});

test('event battles and elites award progression without consuming weak normal-battle slots',()=>{
  let state=scenario(['battle','event','elite','battle','battle','battle','boss'],'mushrooms');state=skip(win(select(state)));assert.equal(state.normalBattles,1);
  state=select(state);const turn=state.turn;state=choose(state,'fight');assert.equal(state.phase,'combat');assert.equal(state.encounterId,'event_mushrooms');assert.equal(state.enemies.length,3);assert.equal(state.normalBattles,1);assert.equal(state.turn,turn+1);
  state=skip(win(state));state=select(state);assert.equal(state.encounterKind,'elite');assert.equal(state.normalBattles,1);const relicCount=state.relics.length;state=win(state);assert.equal(state.relics.length,relicCount+1);assert.ok(state.rewardInfo.gold>=25);state=skip(state);
  for(const expected of ['act1_weak','act1_weak','act1_strong']){state=select(state);assert.ok(state.contentSnapshot.encounters[state.encounterId].pools.includes(expected));state=skip(win(state));}
});

test('ordinary reward choice is permanent, skip adds nothing and reward cannot be collected twice',()=>{
  let state=win(select(scenario(['battle','battle','boss'])));const chosen=state.rewards[0],size=state.deck.length,gold=state.gold;
  state=transition(state,{type:'reward',cardId:chosen});assert.equal(state.deck.length,size+1);assert.equal(state.deck.at(-1),chosen);assert.equal(state.deckCards.at(-1).cardId,chosen);
  const repeated=transition(state,{type:'reward',cardId:chosen});assert.equal(repeated.deck.length,state.deck.length);assert.equal(repeated.gold,gold);
  state=win(select(state));const size2=state.deck.length;state=skip(state);assert.equal(state.deck.length,size2);
});

test('shop purchase, one removal per shop and growing remove price are complete interactions',()=>{
  let state=scenario(['shop','shop','boss']);state.gold=1000;state=select(state);assert.equal(state.event.id,'shop');const first=state.shop.offers.find(item=>item.kind==='card');const gold=state.gold,turn=state.turn,size=state.deck.length;
  state=choose(state,`buy:${first.id}`);assert.equal(state.gold,gold-first.price);assert.equal(state.deck.length,size+1);assert.ok(state.shop.offers.find(item=>item.id===first.id).sold);
  const repeat=choose(state,`buy:${first.id}`);assert.equal(repeat.gold,state.gold);assert.equal(repeat.deck.length,state.deck.length);
  state=choose(state,'remove');assert.equal(state.event.id,'remove');state=choose(state,'cancel');assert.equal(state.event.id,'shop');
  state=choose(state,'remove');const removed=state.deckCards[0].uid;state=choose(state,`remove:${removed}`);assert.equal(state.event.id,'shop');assert.equal(state.deck.length,size);assert.ok(!state.deckCards.some(card=>card.uid===removed));assert.equal(state.removePrice,100);assert.ok(getConfiguredEventView(state).choices.find(item=>item.id==='remove').disabled);assert.equal(state.turn,turn);
  state=choose(state,'leave');state=select(state);assert.equal(state.shop.removalUsed,false);state=choose(state,'remove');const second=state.deckCards[0].uid;const before=state.gold;state=choose(state,`remove:${second}`);assert.equal(state.gold,before-100);assert.equal(state.removePrice,125);assert.ok(isValidConfiguredSave(state));
});

test('full potion slots and unaffordable shop offers do not charge or replace items',()=>{
  let state=select(scenario(['shop','boss']));state.gold=0;const offer=state.shop.offers[0];const after=choose(state,`buy:${offer.id}`);assert.equal(after.gold,0);assert.equal(after.deck.length,state.deck.length);
  state.gold=1000;state.potions=[{uid:'p1',id:'healing'},{uid:'p2',id:'healing'},{uid:'p3',id:'block'}];const potion=state.shop.offers.find(item=>item.kind==='potion');const blocked=choose(state,`buy:${potion.id}`);assert.equal(blocked.potions.length,3);assert.equal(blocked.gold,1000);
  const discarded=transition(blocked,{type:'discardPotion',potionId:'p2'});assert.equal(discarded.potions.length,2);const bought=choose(discarded,`buy:${potion.id}`);assert.equal(bought.potions.length,3);assert.equal(bought.gold,970);
});

test('shop descriptions resolve every dynamic card placeholder before presenting offers',()=>{
  const state=select(scenario(['shop','boss']));
  const cases=[
    ['ic_rampage','造成8点伤害。'],
    ['ic_searing_blow','造成12点伤害。'],
    ['ic_body_slam','造成0点攻击伤害，'],
    ['ic_perfected_strike','造成6点伤害：'],
  ];
  state.shop.offers=cases.map(([cardId],index)=>({id:`dynamic-${index}`,kind:'card',cardId,price:50,sold:false}));
  const before=JSON.stringify(state);
  const choices=getConfiguredEventView(state).choices;
  for(const [index,[cardId,expectedStart]] of cases.entries()){
    const offer=choices.find(choice=>choice.id===`buy:dynamic-${index}`);
    assert.ok(offer.description.startsWith(expectedStart),`${cardId}: ${offer.description}`);
    assert.doesNotMatch(offer.description,/\{[a-zA-Z][a-zA-Z0-9_]*\}/);
  }
  assert.equal(JSON.stringify(state),before,'viewing shop descriptions must not mutate the run');
});

test('rest offers actual 30 percent healing or one permanent upgrade without advancing debt',()=>{
  let state=scenario(['rest','rest','boss']);state.hp=20;state.debts=[{id:'d1',amount:3,dueTurn:4,originalDueTurn:4,delayed:false}];state=select(state);const turn=state.turn;state=choose(state,'rest');assert.equal(state.hp,44);assert.equal(state.turn,turn);assert.equal(state.debts[0].amount,3);
  state=select(state);state=choose(state,'upgrade');assert.equal(state.event.id,'upgrade');const first=state.deckCards[0];const same=state.deckCards.filter(card=>card.cardId===first.cardId);state=choose(state,`upgrade:${first.uid}`);assert.equal(state.phase,'map');assert.equal(state.deckCards.find(card=>card.uid===first.uid).upgradeLevel,1);assert.ok(same.slice(1).every(card=>state.deckCards.find(item=>item.uid===card.uid).upgradeLevel===0));assert.equal(state.turn,turn);assert.ok(isValidConfiguredSave(state));
});

test('repeat-upgrade cards remain available at later rests and ordinary max upgrades are filtered',()=>{
  let state=scenario(['rest','rest','boss']);const card=makeCard(state,'ic_searing_blow');state.deck=['ic_searing_blow'];state.deckCards=[card];
  for(let expected=1;expected<=2;expected++){state=select(state);state=choose(state,'upgrade');assert.ok(getConfiguredEventView(state).choices.some(choice=>choice.cardUid===card.uid));state=choose(state,`upgrade:${card.uid}`);assert.equal(state.deckCards[0].upgradeLevel,expected);}
  assert.equal(getConfiguredCardView(state,state.deckCards[0]).name.endsWith('+2'),true);
});

test('rest repayment clears earliest due debt and never invents payment when no debt remains',()=>{
  let state=scenario(['rest','rest','boss']);state.hp=30;state.debts=[{id:'late',amount:3,dueTurn:6,originalDueTurn:6,delayed:false},{id:'early',amount:2,dueTurn:4,originalDueTurn:4,delayed:false}];
  state=select(state);state=choose(state,'repay');assert.deepEqual(state.debts.map(item=>[item.id,item.amount]),[['late',1]]);assert.equal(state.stats.repaid,4);assert.equal(state.hp,34);assert.equal(state.turn,1);
  state=select(state);state.debts=[];assert.equal(getConfiguredEventView(state).choices.find(item=>item.id==='repay').disabled,true);const rejected=choose(state,'repay');assert.equal(rejected.stats.repaid,4);assert.equal(rejected.hp,34);
});

test('configured event costs, conditions and special-card rewards resolve through shared effects',()=>{
  let state=scenario(['event','boss'],'shrine');state=select(state);state.hp=6;const disabled=getConfiguredEventView(state).choices.find(item=>item.id==='blood');assert.equal(disabled.disabled,true);const blocked=choose(state,'blood');assert.equal(blocked.hp,6);assert.equal(blocked.deck.length,10);
  state.hp=20;state=choose(state,'blood');assert.equal(state.hp,14);assert.equal(state.deck.at(-1),'debt_seal');assert.equal(state.phase,'map');
  let loan=select(scenario(['event','boss'],'market'));loan=choose(loan,'gold');assert.equal(loan.gold,134);assert.equal(loan.debts[0].amount,2);assert.equal(loan.debts[0].dueTurn,3);assert.equal(loan.turn,1);
  let archive=select(scenario(['event','boss'],'debt_archive'));archive.debts=[{id:'x',amount:4,dueTurn:3,originalDueTurn:3,delayed:false}];archive=choose(archive,'pay');assert.equal(archive.gold,79);assert.equal(archive.debts.length,0);assert.equal(archive.stats.repaid,4);
});

test('treasure reward is local to the run and cannot be obtained repeatedly',()=>{
  let state=select(scenario(['treasure','boss']));const count=state.relics.length;state=choose(state,'open');assert.equal(state.relics.length,count+1);assert.equal(state.phase,'map');const repeated=choose(state,'open');assert.deepEqual(repeated.relics,state.relics);
});

test('choice queue can save and resume after committed card without paying or triggering twice',()=>{
  let state=held(select(scenario(['battle','boss'])),['ic_armaments','ic_defend']);const armaments=state.hand[0],defend=state.hand[1];
  state=transition(state,{type:'play',uid:armaments.uid});assert.ok(state.pendingChoice);assert.equal(state.energy,9);assert.ok(state.limbo.some(card=>card.uid===armaments.uid));assert.equal(state.stats.cardsPlayed,1);assert.ok(isValidConfiguredSave(state));
  const saved=JSON.parse(JSON.stringify(state)),resumed=restoreConfiguredRun(saved);assert.ok(resumed);const blocked=transition(resumed,{type:'endTurn'});assert.ok(blocked.pendingChoice);assert.equal(blocked.turn,resumed.turn);assert.equal(blocked.energy,9);
  const wrong=transition(resumed,{type:'chooseCard',uid:'missing'});assert.ok(wrong.pendingChoice);assert.equal(wrong.energy,9);
  const complete=transition(resumed,{type:'chooseCard',uid:defend.uid});assert.equal(complete.pendingChoice,null);assert.equal(complete.energy,9);assert.equal(complete.stats.cardsPlayed,1);assert.equal(complete.hand.find(card=>card.uid===defend.uid).upgradeLevel,1);assert.ok(complete.discard.some(card=>card.uid===armaments.uid));assert.equal(complete.limbo.length,0);assert.ok(isValidConfiguredSave(complete));
  assert.equal(saved.pendingChoice.cardUids[0],defend.uid);assert.equal(saved.hand[0].upgradeLevel,0);
});

test('death, victory and restart are distinct terminal paths',()=>{
  let failed=select(scenario(['battle','boss']));failed.hp=1;failed.block=0;failed.debts=[{id:'fatal',amount:2,dueTurn:failed.turn+1,originalDueTurn:failed.turn+1,delayed:false}];failed.enemies.forEach(enemy=>{enemy.intent={move:'wait',label:'静候',effects:[]};});failed=transition(failed,{type:'endTurn'});assert.equal(failed.phase,'defeat');assert.equal(failed.hp,0);assert.ok(isValidConfiguredSave(failed));
  const deadAgain=transition(failed,{type:'borrow'});assert.equal(deadAgain.energy,failed.energy);assert.equal(deadAgain.hp,0);
  let winner=select(scenario(['boss','boss']));winner=win(winner);assert.equal(winner.phase,'victory');assert.equal(winner.route.completedIds.length,1);assert.ok(isValidConfiguredSave(winner));const wonAgain=transition(winner,{type:'endTurn'});assert.equal(wonAgain.stats.battlesWon,1);
  const fresh=createConfiguredAdventure(7,{runId:'restart'});assert.equal(fresh.phase,'map');assert.equal(fresh.hp,80);assert.equal(fresh.debts.length,0);assert.equal(fresh.stats.battlesWon,0);
});

test('content snapshots preserve a run when source tables change and custom special cards enter rewards',()=>{
  const content=linearContent(['battle','boss']);const base=content.cards.ic_cleave;
  content.cards.act_special={...clone(base),id:'act_special',name:'幕专属测试符',pool:'act_only',rarity:'common'};content.acts.scenario_act.specialCards.push('act_special');
  const state=createConfiguredAdventure(8,{content,actId:'scenario_act',runId:'snapshot'});assert.ok(state.rewardPool.includes('act_special'));assert.ok(isValidConfiguredSave(state));
  content.enemies.cultist.hpRange=[1,1];content.acts.scenario_act.map.floors=22;delete content.cards.ic_strike;
  assert.equal(state.contentSnapshot.acts.scenario_act.map.floors,2);assert.ok(state.contentSnapshot.cards.ic_strike);assert.ok(isValidConfiguredSave(state));assert.equal(select(state).phase,'combat');
});

test('invalid save structures cannot load as an apparently playable run',()=>{
  const base=select(createConfiguredAdventure(1,{runId:'validity'}));assert.ok(isValidConfiguredSave(base));
  for(const mutate of [state=>{state.hand.push(clone(state.hand[0]));},state=>{state.deck[0]='missing';},state=>{state.hp=-1;},state=>{state.enemies[0].hp=state.enemies[0].maxHp+1;},state=>{state.route.nodes[0].next=[];},state=>{state.pendingChoice={cardUids:['missing'],frameId:'missing'};}]){
    const bad=clone(base);mutate(bad);assert.equal(isValidConfiguredSave(bad),false);assert.equal(restoreConfiguredRun(bad),null);
  }
});

test('real generated 16-floor route reaches rewards, event services, boss victory and valid saves',()=>{
  let state=createConfiguredAdventure(123,{runId:'full-route'});let traversed=0,combatCount=0;
  while(state.phase!=='victory' && traversed<17){
    const options=getConfiguredAvailableNodes(state);assert.ok(options.length);const node=options.find(item=>item.type==='battle')||options[0];state=transition(state,{type:'selectNode',nodeId:node.id});traversed++;
    if(state.phase==='combat'){combatCount++;state=win(state);if(state.phase==='reward')state=skip(state);}
    else if(state.phase==='event'){
      const view=getConfiguredEventView(state);const choice=view.choices.find(item=>item.id==='leave'&&!item.disabled)||view.choices.find(item=>['rest','open'].includes(item.id)&&!item.disabled)||view.choices.find(item=>!item.disabled);
      state=choose(state,choice.id);
    }
    assert.ok(isValidConfiguredSave(state),`save at floor ${traversed}`);
  }
  assert.equal(state.phase,'victory');assert.equal(traversed,16);assert.equal(state.route.path.length,16);assert.equal(state.route.completedIds.length,16);assert.ok(combatCount>=7);assert.equal(state.stats.battlesWon,combatCount);
});
