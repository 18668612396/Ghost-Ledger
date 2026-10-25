import test from 'node:test';
import assert from 'node:assert/strict';
import { ACT1_ENEMY_DEFS, ACT1_WEAK_ENCOUNTERS, ACT1_STRONG_ENCOUNTERS, ACT1_ELITES, ACT1_BOSSES, getAct1Encounter, sampleAct1Encounter } from '../src/act1-content.js';
import { createAct1Route, isValidAct1Route, getAvailableAct1Nodes, createRoute, isValidRoute, getAvailableNodes, completeCurrentNode } from '../src/journey.js';

function randomFrom(seed) {
  let value = seed;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}

test('first-act catalog separates 19 ordinary variants, three elite archetypes and three bosses', () => {
  const values = Object.values(ACT1_ENEMY_DEFS);
  assert.equal(values.filter(enemy => enemy.kind === 'normal').length, 19);
  assert.equal(values.filter(enemy => enemy.kind === 'elite').length, 3);
  assert.equal(values.filter(enemy => enemy.kind === 'boss').length, 3);
  assert.equal(ACT1_WEAK_ENCOUNTERS.length, 4);
  assert.equal(ACT1_STRONG_ENCOUNTERS.length, 10);
  assert.equal(ACT1_ELITES.length, 3);
  assert.equal(ACT1_BOSSES.length, 3);
  for (const definition of values) {
    assert.equal(definition.id, definition.archetype);
    assert.ok(definition.name && definition.reference && definition.art && definition.description);
    assert.ok(definition.minHp > 0 && definition.minHp <= definition.maxHp);
    assert.deepEqual(definition.hpRange, [definition.minHp, definition.maxHp]);
    assert.equal(Object.isFrozen(definition), true);
  }
  assert.equal(ACT1_ENEMY_DEFS.gremlin_fat.art, 'paper');
  assert.equal(ACT1_ENEMY_DEFS.slaver_blue.art, 'collector');
  assert.equal(ACT1_ENEMY_DEFS.guardian.art, 'judge');
  assert.equal(ACT1_ENEMY_DEFS.acid_s.art, ACT1_ENEMY_DEFS.acid_l.art);
  assert.equal(ACT1_ENEMY_DEFS.spike_s.art, ACT1_ENEMY_DEFS.spike_l.art);
});

test('encounter recipes produce the actual weak and strong formations instead of uniform clones', () => {
  assert.deepEqual(sampleAct1Encounter('weak_cultist', () => 0).enemies, ['cultist']);
  assert.deepEqual(sampleAct1Encounter('weak_slimes', () => 0).enemies, ['spike_m', 'acid_s']);
  assert.deepEqual(sampleAct1Encounter('weak_slimes', () => .99).enemies, ['acid_m', 'spike_s']);
  assert.deepEqual(sampleAct1Encounter('strong_slime_swarm', () => 0).enemies, ['spike_s', 'spike_s', 'spike_s', 'acid_s', 'acid_s']);
  assert.deepEqual(sampleAct1Encounter('sentry', () => 0).enemies, ['sentry', 'sentry', 'sentry']);
  assert.equal(getAct1Encounter('does-not-exist'), null);
  assert.throws(() => sampleAct1Encounter('does-not-exist'), /未知/);
  assert.throws(() => sampleAct1Encounter('weak', () => NaN), /有限数/);
  const random = randomFrom(183);
  for (let sample = 0; sample < 500; sample += 1) {
    const gang = sampleAct1Encounter('strong_gremlins', random);
    assert.equal(gang.enemies.length, 4);
    for (const id of ['gremlin_mad', 'gremlin_sneaky', 'gremlin_fat']) assert.ok(gang.enemies.filter(enemyId => enemyId === id).length <= 2);
    for (const id of ['gremlin_shield', 'gremlin_wizard']) assert.ok(gang.enemies.filter(enemyId => enemyId === id).length <= 1);
    for (const pool of ['weak', 'strong', 'elite', 'boss']) {
      const encounter = sampleAct1Encounter(pool, random);
      assert.ok(encounter.enemies.length >= 1 && encounter.enemies.length <= 5);
      assert.ok(encounter.enemies.every(id => Object.hasOwn(ACT1_ENEMY_DEFS, id)));
    }
  }
});

test('ordinary pool exclusion avoids the previous two encounters without mutating frozen source data', () => {
  const previous = ['weak_cultist', 'weak_jaw'];
  const sampled = sampleAct1Encounter('weak', () => 0, previous);
  assert.equal(sampled.id, 'weak_louses');
  sampled.enemies.push('cultist');
  assert.equal(sampleAct1Encounter('weak_louses', () => 0).enemies.length, 2);
  const excludedAll = ACT1_WEAK_ENCOUNTERS.map(encounter => encounter.id);
  assert.equal(sampleAct1Encounter('weak', () => 0, excludedAll).id, 'weak_cultist');
  assert.equal(ACT1_STRONG_ENCOUNTERS.reduce((sum, encounter) => sum + encounter.weight, 0), 16);
});

test('the first-act map keeps floor 1 combat, 9 treasure, 15 rest and 16 one seeded boss', () => {
  const bosses = new Set();
  for (let seed = 0; seed < 160; seed += 1) {
    const route = createAct1Route(seed);
    assert.equal(isValidRoute(route), true);
    assert.equal(isValidAct1Route(route), true);
    assert.deepEqual(route, createAct1Route(seed));
    bosses.add(route.bossId);
    assert.equal(route.floorCount, 16);
    assert.equal(route.nodes.length, 40);
    for (const [row, type] of [[0, 'battle'], [8, 'treasure'], [14, 'rest'], [15, 'boss']]) {
      const nodes = route.nodes.filter(node => node.row === row);
      assert.equal(nodes.length, 1);
      assert.equal(nodes[0].type, type);
    }
    assert.equal(route.nodes.find(node => node.type === 'boss').encounterId, route.bossId);
    assert.ok(route.nodes.filter(node => node.row < 5).every(node => node.type !== 'elite'));
    const elites = route.nodes.filter(node => node.type === 'elite');
    assert.equal(elites.length, 3);
    assert.equal(new Set(elites.map(node => node.encounterId)).size, 3);
    for (const node of route.nodes) {
      assert.equal(node.floor, node.row + 1);
      assert.equal(node.stageIndex, node.row);
      if (node.row !== 15) assert.ok(node.next.length > 0);
      for (const nextId of node.next) {
        const next = route.nodes.find(candidate => candidate.id === nextId);
        assert.equal(next.row, node.row + 1);
        assert.ok(!(node.type === 'rest' && next.type === 'rest'));
      }
      if (node.row > 0) assert.ok(route.nodes.some(candidate => candidate.next.includes(node.id)));
    }
  }
  assert.deepEqual([...bosses].sort(), ['guardian', 'hexaghost', 'slime_boss']);
});

test('legal paths have sixteen steps, at least four ordinary combats and no dead ends', () => {
  for (let seed = 0; seed < 80; seed += 1) {
    const random = randomFrom(seed + 91), state = { phase: 'map', route: createAct1Route(seed) };
    let ordinary = 0;
    for (let floor = 1; floor <= 16; floor += 1) {
      const available = getAvailableAct1Nodes(state);
      assert.deepEqual(getAvailableNodes(state), available);
      assert.ok(available.length > 0);
      assert.ok(available.every(node => node.floor === floor));
      const selected = available[Math.floor(random() * available.length)];
      if (selected.type === 'battle') ordinary += 1;
      state.route.currentId = selected.id;
      state.route.path.push(selected.id);
      assert.equal(getAvailableAct1Nodes(state).length, 0);
      completeCurrentNode(state.route);
      assert.equal(isValidAct1Route(state.route), true);
    }
    assert.ok(ordinary >= 4);
    assert.equal(getAvailableNodes(state).length, 0);
  }
});

test('map validation rejects forged rooms, skipped floors, extra exits and inconsistent progress', () => {
  const route = createAct1Route(9);
  for (const tamper of [
    value => { value.bossId = 'not-a-boss'; },
    value => { value.nodes[0].next.push(value.nodes.at(-1).id); },
    value => { value.nodes[0].type = 'rest'; },
    value => { value.nodes[3].column = 7; },
    value => { value.nodes.find(node => node.type === 'elite').encounterId = 'weak_cultist'; },
    value => { value.currentId = value.nodes[1].id; value.path = [value.currentId]; },
    value => { value.path = [value.nodes[0].id]; value.currentId = value.nodes[0].id; value.completedIds = ['another']; },
  ]) {
    const corrupted = structuredClone(route);
    tamper(corrupted);
    assert.equal(isValidAct1Route(corrupted), false);
  }
  assert.equal(isValidRoute(createRoute(8)), true);
  assert.equal(getAvailableNodes({ phase: 'map', route: createRoute(8) })[0].id, 'paper');
  assert.deepEqual(getAvailableAct1Nodes({ phase: 'combat', route }), []);
});
