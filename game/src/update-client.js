/** Check the entry's release pointer, keeping all running modules on their own immutable version. */
export async function checkForUpdate({ currentRelease, target = 'web', entryUrl, fetcher = globalThis.fetch } = {}) {
  if (target !== 'web' || !currentRelease || currentRelease === 'development') return { ok: true, available: false, skipped: true };
  try {
    const response = await fetcher(new URL('./release.json', entryUrl).href, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('release unavailable');
    const release = await response.json();
    if (release?.schemaVersion !== 1 || release.target !== target || typeof release.releaseId !== 'string' || !/^v[\w.-]{1,120}$/.test(release.releaseId) || typeof release.version !== 'string') throw new Error('invalid release');
    return { ok: true, available: release.releaseId !== currentRelease, release };
  } catch { return { ok: false, error: { code: 'update-unavailable', message: '暂时无法检查更新，可以继续当前夜巡。' } }; }
}
