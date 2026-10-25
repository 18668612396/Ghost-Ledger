import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdventure, transition, getAvailableNodes, isValidSave, restoreRun } from '../../game/src/engine.js';

function combat() { const run = createAdventure(8); return transition(run, { type: 'selectNode', nodeId: getAvailableNodes(run)[0].id }); }
test('saved numeric state cannot be replaced by markup or non-finite arithmetic inputs', () => {
  for (const mutate of [run => { run.hand[0].temporaryCost = '<img src=x onerror=alert(1)>'; }, run => { run.strength = '3'; }, run => { run.enemies[0].block = '0'; }, run => { run.powers.metallicize = { amount: '<img>' }; }, run => { run.rewardInfo = { gold: '<img>' }; }]) {
    const run = combat(); mutate(run); const before = structuredClone(run); assert.equal(isValidSave(run), false); assert.equal(restoreRun(run), null); assert.deepEqual(run, before);
  }
});
test('authored text remains text data, while legitimate temporary cost and power counters restore', () => {
  const run = combat(); run.contentSnapshot.cards.ic_strike.name = '< 比较 & "引号" >'; run.hand[0].temporaryCost = 0; run.powers.metallicize = { amount: 3 };
  assert.equal(isValidSave(run), true); assert.deepEqual(restoreRun(JSON.parse(JSON.stringify(run))), run);
});
