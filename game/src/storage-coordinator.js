/** Detect an external writer before overwriting its progress. No hidden last-writer merge. */
export function coordinateStorage(backend, { keys, onConflict = () => {} } = {}) {
  const baselines = new Map(); let conflicted = false, initialFailure = null, failureResult = null;
  for (const key of keys) { const value = backend.read(key); if (value.ok) baselines.set(key, value.value); else initialFailure ||= value; }
  const conflict = (error = { code: 'storage-conflict', message: '另一页面已更新进度。本页已停止写入，请先备份或重新加载。' }) => {
    if (!conflicted) { conflicted = true; failureResult = { ok: false, error }; onConflict(); }
    return failureResult;
  };
  function check() {
    if (conflicted) return conflict();
    if (initialFailure) return conflict({ code: 'storage-unverified', message: '初始化时未能读取进度。本页已停止写入，请导出记录并重新加载。' });
    for (const [key, previous] of baselines) {
      const current = backend.read(key); if (!current.ok) return current;
      if (current.value !== previous) return conflict();
    }
    return { ok: true };
  }
  const mutate = (method, key, value) => {
    const ready = check(); if (!ready.ok) return ready;
    const result = backend[method](key, value);
    if (result.ok && baselines.has(key)) baselines.set(key, method === 'remove' ? null : String(value));
    return result;
  };
  return { read: key => backend.read(key), write: (key, value) => mutate('write', key, value), remove: key => mutate('remove', key), check, get conflicted() { return conflicted; }, get reason() { return failureResult?.error; } };
}
