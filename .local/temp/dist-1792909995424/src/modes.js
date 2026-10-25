import { createAct1Adventure } from './engine.js';

const registrations = [
  { id: 'classic', name: '阴路夜巡', description: '踏过十六层阴路，在多怪交锋、精英、鬼市与歇脚间选路，挑战三位终审首领之一。', disabled: false, tag: '第一幕 · 奈何之前', estimatedMinutes: '25–40', create: createAct1Adventure },
  { id: 'trial', name: '百鬼试炼', description: '专注卡牌组合与连战的试炼模式，尚未开放。', disabled: true, tag: '尚未开放', estimatedMinutes: null, create: null },
  { id: 'endless', name: '长夜无尽', description: '探索更深阴路的无尽模式，尚未开放。', disabled: true, tag: '尚未开放', estimatedMinutes: null, create: null },
];

export const MODES = registrations.map(({ create, ...metadata }) => Object.freeze(metadata));

export function getMode(modeId) {
  return MODES.find(mode => mode.id === modeId) ?? null;
}

export function createModeRun(modeId, seed, options = {}) {
  const registration = registrations.find(mode => mode.id === modeId);
  if (!registration) throw new Error('找不到这个闯塔模式。');
  if (registration.disabled || !registration.create) throw new Error(`${registration.name}尚未开放。`);
  return registration.create(seed, options);
}
