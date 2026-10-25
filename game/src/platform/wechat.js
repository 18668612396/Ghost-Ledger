import { assertPlatform, platformFailure } from './contract.js';

// Shared services for the future Canvas renderer. This module never imports DOM.
export function createWeChatPlatform({ wxApi = globalThis.wx } = {}) {
  if (!wxApi) throw new TypeError('微信适配器需要 wx 接口。');
  const storageCall = (method, ...args) => { try { return { ok: true, value: wxApi[method](...args) }; } catch { return platformFailure('storage-unavailable', '微信存储暂时不可用。'); } };
  const unsupported = () => platformFailure('capability-not-integrated', '此微信能力尚未接入。');
  return assertPlatform({ id: 'wechat', capabilities: Object.freeze({ renderer: 'canvas-required', rendererReady: false, storage: true, tones: false, files: false, nativeShell: true }),
    storage: { read: key => { const result = storageCall('getStorageSync', key); return result.ok ? { ok: true, value: result.value === '' || result.value === undefined ? null : result.value } : result; }, write: (key, value) => storageCall('setStorageSync', key, String(value)), remove: key => storageCall('removeStorageSync', key) },
    files: { download: unsupported, pickText: async () => unsupported() },
    audio: { tone: unsupported, setEnabled() {}, pause() {}, resume() {} },
    lifecycle: { subscribe(listener) { const hide = () => listener({ type: 'pause', reason: 'wx.onHide' }), show = () => listener({ type: 'resume', reason: 'wx.onShow' }); wxApi.onHide(hide); wxApi.onShow(show); return () => { wxApi.offHide?.(hide); wxApi.offShow?.(show); }; } },
    clock: { now: () => Date.now(), monotonic: () => Date.now() }, input: { coordinateSpace: 'logical-client-pixels', point: event => { const point = event.touches?.[0] || event.changedTouches?.[0] || event; return { x: point.clientX ?? point.x, y: point.clientY ?? point.y }; } },
  });
}
