import test from 'node:test';
import assert from 'node:assert/strict';
import { pickEnemyTarget } from '../src/combat-targeting.js';

test('相同种类的多个敌人仍按实例uid选中，空白处不偷偷选择第一个', () => {
  const targets = [{ uid: 'louse-1', left: 0, right: 80, top: 10, bottom: 170 }, { uid: 'louse-2', left: 100, right: 180, top: 10, bottom: 170 }];
  assert.equal(pickEnemyTarget(targets, 140, 60), 'louse-2');
  assert.equal(pickEnemyTarget(targets, 90, 60), null);
  assert.equal(pickEnemyTarget(targets, 140, 190), null);
  assert.equal(pickEnemyTarget(targets, NaN, 60), null);
});

test('命中区域重叠时选择中心更近的存活目标', () => {
  const targets = [{ uid: 'gone', active: false, left: 0, right: 120, top: 0, bottom: 160 }, { uid: 'left', left: 0, right: 100, top: 0, bottom: 160 }, { uid: 'right', left: 80, right: 180, top: 0, bottom: 160 }];
  assert.equal(pickEnemyTarget(targets, 95, 80), 'right');
  assert.equal(pickEnemyTarget(targets, 20, 80), 'left');
  assert.equal(pickEnemyTarget([], 20, 80), null);
});
