import { readFile, mkdir, copyFile, writeFile, rename, lstat } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { releasePreflight, safeReleasePath, safeReleaseId } from './release-preflight.mjs';
import { DIST_ROOT, REPO_ROOT } from './paths.mjs';

const WINDOWS_RENAME_DELAYS = Object.freeze([50, 150, 350, 750]);
const WINDOWS_RENAME_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Windows scanners may briefly hold newly written directories. Never replace a destination. */
export async function renameRetainedDirectory(source, destination, { platform = process.platform, renameDirectory = rename, inspect = lstat, wait = pause } = {}) {
  source = resolve(source); destination = resolve(destination);
  if (dirname(source) !== dirname(destination) || basename(dirname(source)) !== 'releases' || !/^\.retaining-[a-f0-9-]{36}$/.test(basename(source))) throw new Error('保留目录移动必须位于同一个 releases 文件夹内。');
  safeReleaseId(basename(destination));
  const parent = await inspect(dirname(source)), staging = await inspect(source);
  if (parent.isSymbolicLink() || !parent.isDirectory() || staging.isSymbolicLink() || !staging.isDirectory()) throw new Error('保留目录不能通过链接移动或替换非目录文件。');
  async function refuseExisting(cause) {
    try { await inspect(destination); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    throw Object.assign(new Error(`上一版目标目录已存在，未覆盖：${destination}`, { cause }), { code: 'EEXIST', path: source, dest: destination });
  }
  for (let attempt = 0; ; attempt++) {
    await refuseExisting();
    try { await renameDirectory(source, destination); return { attempts: attempt + 1 }; }
    catch (error) {
      // EPERM can also mean a destination appeared; waiting must never turn it into an overwrite.
      await refuseExisting(error);
      if (platform !== 'win32' || !WINDOWS_RENAME_ERRORS.has(error.code) || attempt >= WINDOWS_RENAME_DELAYS.length) {
        if (attempt === 0) throw error;
        throw Object.assign(new Error(`目录重命名在 ${attempt + 1} 次尝试后仍失败，原文件已保留：${error.message}`, { cause: error }), { code: error.code, path: source, dest: destination, renameAttempts: attempt + 1 });
      }
      await wait(WINDOWS_RENAME_DELAYS[attempt]);
    }
  }
}

/** Copy only a validated previous runtime tree. Never copy its HTML or root metadata. */
export async function retainPreviousRelease(currentRoot, previousRoot, { sourceRoot = REPO_ROOT } = {}) {
  currentRoot = resolve(currentRoot); previousRoot = resolve(previousRoot);
  if (currentRoot === previousRoot) throw new Error('当前与上一版产物目录不能相同。');
  const current = await releasePreflight(currentRoot, { sourceRoot, serve: false });
  const prior = await releasePreflight(previousRoot, { verifySources: false, serve: false });
  if (current.previousReleaseId) throw new Error('当前产物已保留上一版；请从干净构建开始，避免累积历史版本。');
  const priorInfo = JSON.parse(await readFile(resolve(previousRoot, 'release.json'), 'utf8'));
  const currentInfo = JSON.parse(await readFile(resolve(currentRoot, 'release.json'), 'utf8'));
  if (priorInfo.target !== currentInfo.target) throw new Error('不能保留不同平台的发布资源。');
  let previous;
  if (prior.releaseId === current.releaseId) {
    // Re-deploying identical bytes must not drop the last distinct release.
    if (!prior.previousReleaseId) return { retained: false, reason: 'same-release-without-predecessor', releaseId: current.releaseId };
    previous = JSON.parse(await readFile(resolve(previousRoot, 'retained-release.json'), 'utf8')).previous;
  } else {
    const manifest = JSON.parse(await readFile(resolve(previousRoot, 'release-manifest.json'), 'utf8'));
    const assetReport = JSON.parse(await readFile(resolve(previousRoot, 'asset-report.json'), 'utf8'));
    previous = { ...priorInfo, files: manifest.files.filter(file => file.path.startsWith(`releases/${prior.releaseId}/`)), assetReport };
    delete previous.entry; delete previous.manifest;
  }
  safeReleaseId(previous.releaseId);
  const prefix = `releases/${previous.releaseId}/`;
  const temporary = resolve(currentRoot, 'releases', `.retaining-${randomUUID()}`);
  await mkdir(temporary, { recursive: false });
  try {
    for (const row of previous.files) {
      safeReleasePath(row.path);
      if (!row.path.startsWith(prefix)) throw new Error(`上一版文件越界：${row.path}`);
      const destination = resolve(temporary, row.path.slice(prefix.length));
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(resolve(previousRoot, row.path), destination);
    }
    await renameRetainedDirectory(temporary, resolve(currentRoot, 'releases', previous.releaseId));
    await writeFile(resolve(currentRoot, 'retained-release.json'), JSON.stringify({ schemaVersion: 1, currentReleaseId: current.releaseId, previous }, null, 2) + '\n', { flag: 'wx' });
  } catch (error) {
    throw new Error(`保留上一版失败，请重新构建后重试（未发布）：${error.message}`, { cause: error });
  }
  const checked = await releasePreflight(currentRoot, { sourceRoot, serve: false });
  return { retained: true, releaseId: checked.releaseId, previousReleaseId: checked.previousReleaseId, totalBytes: checked.totalBytes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!args.length || args.length > 2 || args.some(value => value.startsWith('--'))) throw new Error('用法：node tools/retain-release.mjs 上一版产物目录 [当前产物目录]');
  console.log(JSON.stringify(await retainPreviousRelease(args[1] || DIST_ROOT, args[0]), null, 2));
}
