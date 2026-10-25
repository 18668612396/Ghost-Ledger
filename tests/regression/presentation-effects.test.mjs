import test from 'node:test';
import assert from 'node:assert/strict';
import { planVisualEvents } from '../../game/src/presentation/effects.js';

test('played exhausted card burns once and retains its configured hit effect', () => {
  const plan = planVisualEvents([
    { type: 'cardCommitted', cardUid: 'c1', impact: 'thunder' },
    { type: 'attackHit', cardUid: 'c1', targetUid: 'enemy1', impact: 'thunder' },
    { type: 'cardExhausted', cardUid: 'c1' },
  ]);
  assert.deepEqual(plan.map(cue => cue.effectId), ['play', 'thunder']);
  assert.equal(plan[1].event.targetUid, 'enemy1');
  assert.ok(plan[1].delay > plan[0].delay);
});

test('unplayed cards distinguish discard ash from ethereal consumption', () => {
  const plan = planVisualEvents([
    { type: 'cardDiscarded', cardUid: 'normal' },
    { type: 'cardExhausted', cardUid: 'ethereal' },
    { type: 'cardDiscarded', cardUid: 'normal' },
  ]);
  assert.deepEqual(plan.map(cue => cue.effectId), ['discard', 'play']);
  assert.deepEqual(plan.map(cue => cue.event.cardUid), ['normal', 'ethereal']);
});

test('five monster turns stay sequential and below the total animation budget', () => {
  const events = [{ type: 'cardDiscarded', cardUid: 'end-card' }];
  for (let n = 0; n < 5; n++) {
    events.push({ type: 'enemyAction', targetUid: `e${n}` });
    for (let hit = 0; hit < 12; hit++) events.push({ type: 'attackHit', targetUid: 'player', amount: 2 });
  }
  const plan = planVisualEvents(events), hits = plan.filter(cue => cue.event.type === 'attackHit');
  assert.equal(hits.length, 15);
  assert.ok(hits[0].delay >= 180);
  assert.ok(hits.at(-1).delay + 440 <= 1500);
  for (let n = 1; n < hits.length; n++) assert.ok(hits[n].delay > hits[n - 1].delay);
  assert.equal(events.length, 66, 'presentation does not mutate or drop rule events');
});

test('simultaneous area damage remains visible on every target', () => {
  const events = ['a', 'b', 'c', 'd', 'e'].map(targetUid => ({ type: 'attackHit', targetUid, impact: 'fire' }));
  const plan = planVisualEvents(events);
  assert.equal(plan.length, 5);
  assert.ok(plan.every(cue => cue.effectId === 'fire' && cue.delay === 65));
  assert.equal(new Set(plan.map(cue => cue.event.targetUid)).size, 5);
});
