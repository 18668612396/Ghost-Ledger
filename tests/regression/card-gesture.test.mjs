import test from 'node:test';
import assert from 'node:assert/strict';
import { updateCardDrag, resolveCardDrag } from '../../game/src/card-gesture.js';

const begin = () => ({ x: 80, y: 640, dragged: false });
const handTop = 520;

test('小幅点击抖动仍可查看详情', () => {
  const gesture = begin();
  updateCardDrag(gesture, 84, 635);
  assert.equal(resolveCardDrag(gesture, 84, 635, handTop), 'tap');
});

test('拖出手牌再拖回起点只归位，不视为点击', () => {
  const gesture = begin();
  updateCardDrag(gesture, 80, 100);
  updateCardDrag(gesture, 80, 640);
  assert.equal(resolveCardDrag(gesture, 80, 640, handTop), 'cancel');
});

test('拖回手牌中的其他位置也不出牌，即使离起点已超过出牌距离', () => {
  const gesture = begin();
  updateCardDrag(gesture, 80, 440);
  updateCardDrag(gesture, 110, 560);
  assert.equal(resolveCardDrag(gesture, 110, 560, handTop), 'cancel');
});

test('横向拖动不会弹详情或出牌', () => {
  const gesture = begin();
  updateCardDrag(gesture, 180, 640);
  assert.equal(resolveCardDrag(gesture, 180, 640, handTop), 'cancel');
});

test('向下拖动不会弹详情或出牌', () => {
  const gesture = begin();
  updateCardDrag(gesture, 80, 720);
  assert.equal(resolveCardDrag(gesture, 80, 720, handTop), 'cancel');
});

test('超过点击容差但仍在手牌内松开，只归位', () => {
  const gesture = begin();
  updateCardDrag(gesture, 80, 610);
  assert.equal(resolveCardDrag(gesture, 80, 610, handTop), 'cancel');
});

test('明确向上拖到手牌之外才出牌', () => {
  const gesture = begin();
  updateCardDrag(gesture, 80, 460);
  assert.equal(resolveCardDrag(gesture, 80, 460, handTop), 'play');
});

test('遗漏中间移动事件时，释放坐标仍能判定出牌', () => {
  assert.equal(resolveCardDrag(begin(), 80, 460, handTop), 'play');
});

test('向上超过原有的 200 像素位置后仍持续跟手，不停在半路', () => {
  const gesture = begin();
  const offsets = [490, 340, 190].map(y => updateCardDrag(gesture, 80, y).y);
  assert.deepEqual(offsets, [-150, -300, -450]);
  assert.equal(resolveCardDrag(gesture, 80, 190, handTop), 'play');
});

test('横向大幅拖动也按实际距离跟手，不减速或封顶', () => {
  const gesture = begin();
  assert.equal(updateCardDrag(gesture, 380, 640).x, 300);
  assert.equal(updateCardDrag(gesture, 680, 640).x, 600);
  assert.equal(resolveCardDrag(gesture, 680, 640, handTop), 'cancel');
});

test('自身牌必须向下拖入灯前区域，向上拖会取消', () => {
  assert.equal(resolveCardDrag(begin(), 80, 750, handTop, { target: 'self', selfTop: 720 }), 'play');
  assert.equal(resolveCardDrag(begin(), 80, 700, handTop, { target: 'self', selfTop: 720 }), 'cancel');
  assert.equal(resolveCardDrag(begin(), 80, 400, handTop, { target: 'self', selfTop: 720 }), 'cancel');
});

test('自身牌拖回起点仍取消，点击仍是查看详情', () => {
  const drag = begin(); updateCardDrag(drag, 80, 760);
  assert.equal(resolveCardDrag(drag, 80, 640, handTop, { target: 'self', selfTop: 720 }), 'cancel');
  assert.equal(resolveCardDrag(begin(), 81, 640, handTop, { target: 'self', selfTop: 720 }), 'tap');
});
