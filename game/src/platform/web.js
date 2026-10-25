import { assertPlatform, platformFailure } from './contract.js';

export function createStorageAccess(backend) {
  const call = (method, ...args) => {
    if (!backend) return platformFailure('storage-unavailable', '当前环境无法保存进度。');
    try { return { ok: true, value: backend[method](...args) }; }
    catch (error) { return platformFailure(error?.name === 'QuotaExceededError' ? 'storage-full' : 'storage-unavailable', error?.name === 'QuotaExceededError' ? '存储空间不足，请导出备份后清理空间。' : '当前环境无法保存进度，请先导出备份。'); }
  };
  return { read: key => call('getItem', key), write: (key, value) => call('setItem', key, String(value)), remove: key => call('removeItem', key) };
}

export function createWebPlatform({ host = globalThis.window, target = 'web' } = {}) {
  if (!host?.document || !['web', 'windows', 'android'].includes(target)) throw new TypeError('此平台需要浏览器或原生 WebView。');
  const document = host.document;
  let backend; try { backend = host.localStorage; } catch {}
  let context = null, enabled = true;
  const AudioContext = host.AudioContext || host.webkitAudioContext;
  const audio = {
    setEnabled(value) { enabled = Boolean(value); if (!enabled) audio.pause(); },
    tone(frequency, duration = .18, volume = .035, delay = 0) {
      if (!enabled) return { ok: true, skipped: true };
      if (!AudioContext) return platformFailure('audio-unavailable', '当前设备不支持音效。');
      try {
        context ||= new AudioContext();
        if (context.state === 'suspended') context.resume().catch(() => {});
        const oscillator = context.createOscillator(), gain = context.createGain(), start = context.currentTime + delay;
        oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, start); oscillator.frequency.exponentialRampToValueAtTime(frequency * .7, start + duration);
        gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(volume, start + .01); gain.gain.exponentialRampToValueAtTime(.001, start + duration);
        oscillator.connect(gain).connect(context.destination); oscillator.start(start); oscillator.stop(start + duration + .02);
        return { ok: true };
      } catch { return platformFailure('audio-unavailable', '音效暂时无法播放。'); }
    },
    pause() { if (context?.state === 'running') context.suspend().catch(() => {}); },
    resume() { if (enabled && context?.state === 'suspended') context.resume().catch(() => {}); },
  };
  const lifecycle = {
    subscribe(listener) {
      let active = !document.hidden;
      const emit = (next, reason) => {
        if (active === next) return;
        active = next;
        if (active) audio.resume(); else audio.pause();
        listener({ type: active ? 'resume' : 'pause', reason });
      };
      const handlers = { visibilitychange: () => emit(!document.hidden, 'visibility'), pagehide: () => emit(false, 'pagehide'), pageshow: () => emit(!document.hidden, 'pageshow'), blur: () => emit(false, 'blur'), focus: () => emit(!document.hidden, 'focus') };
      document.addEventListener('visibilitychange', handlers.visibilitychange);
      for (const event of ['pagehide', 'pageshow', 'blur', 'focus']) host.addEventListener(event, handlers[event]);
      return () => { document.removeEventListener('visibilitychange', handlers.visibilitychange); for (const event of ['pagehide', 'pageshow', 'blur', 'focus']) host.removeEventListener(event, handlers[event]); };
    },
  };
  const files = {
    download(text, name, mime = 'application/json') {
      try {
        const url = host.URL.createObjectURL(new host.Blob([text], { type: mime })), anchor = document.createElement('a');
        anchor.href = url; anchor.download = String(name).replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 120);
        document.body.append(anchor); anchor.click(); anchor.remove(); host.setTimeout(() => host.URL.revokeObjectURL(url), 1000);
        return { ok: true };
      } catch { return platformFailure('download-unavailable', '当前环境不能下载文件，请使用系统浏览器打开。'); }
    },
    pickText({ maxBytes = 4 * 1024 * 1024 } = {}) {
      return new Promise(resolve => {
        const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json'; input.hidden = true;
        let settled = false;
        const onFocus = () => host.setTimeout(() => { if (!input.files?.length) finish({ ok: true, cancelled: true }); }, 350);
        const finish = result => { if (settled) return; settled = true; host.removeEventListener('focus', onFocus); input.remove(); resolve(result); };
        input.addEventListener('cancel', () => finish({ ok: true, cancelled: true }), { once: true });
        input.addEventListener('change', async () => {
          const file = input.files?.[0]; if (!file) return finish({ ok: true, cancelled: true });
          if (file.size > maxBytes) return finish(platformFailure('file-too-large', '备份文件过大，未读取。'));
          try { finish({ ok: true, text: await file.text(), name: file.name }); }
          catch { finish(platformFailure('file-unreadable', '无法读取这个文件。')); }
        }, { once: true });
        document.body.append(input);
        host.addEventListener('focus', onFocus, { once: true });
        try { input.click(); } catch { finish(platformFailure('file-picker-unavailable', '当前环境无法选择文件。')); }
      });
    },
  };
  return assertPlatform({ id: target, capabilities: Object.freeze({ renderer: 'dom', storage: Boolean(backend), tones: Boolean(AudioContext), files: true, nativeShell: Boolean(host.__TAURI_INTERNALS__) }), storage: createStorageAccess(backend), files, audio, lifecycle,
    clock: { now: () => Date.now(), monotonic: () => host.performance?.now() ?? Date.now() },
    input: { point: event => ({ x: event.clientX, y: event.clientY }), coordinateSpace: 'logical-client-pixels' },
  });
}
