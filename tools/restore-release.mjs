import { mkdir, open, writeFile, readFile, lstat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { LOCAL_ROOT } from './paths.mjs';
import { releasePreflight, safeReleasePath, safeReleaseId, RELEASE_BUDGETS } from './release-preflight.mjs';

const METADATA_LIMITS = Object.freeze({ 'release.json': 64 * 1024, 'release-manifest.json': 2 * 1048576, 'asset-report.json': 2 * 1048576, 'retained-release.json': 2 * 1048576 });
const ROOT_FILES = new Set(['index.html', '.nojekyll', 'release.json', 'asset-report.json']);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(`线上制品恢复失败：${message}`); };
const equal = (actual, expected, label) => { if (actual !== expected) fail(`${label} 不一致。`); };
const integer = value => Number.isSafeInteger(value) && value >= 0;

// The caller supplies this trusted pointer, never a field from a downloaded manifest.
// The workflow obtains it from GitHub's authenticated Pages API (including custom domains).
export function trustedPagesBase(value) {
  if (typeof value !== 'string' || /[\\\u0000-\u0020]/.test(value) || /%(?:2e|2f|5c)/i.test(value)) fail('Pages 基址包含不安全字符。');
  let base; try { base = new URL(value); } catch { fail('Pages 基址不是有效 URL。'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !base.hostname) fail('Pages 基址必须是无凭据、查询或片段的受信 HTTPS 地址。');
  if (!/^[a-zA-Z0-9._/-]*$/.test(base.pathname) || base.pathname.split('/').some(part => part === '.' || part === '..') || /\/\//.test(base.pathname)) fail('Pages 基址路径无效。');
  // URL parsing normalizes literal dot segments, so reject them in the original input too.
  if (/\/(?:\.|\.\.)(?:\/|$)/.test(value)) fail('Pages 基址不能包含路径跳转。');
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return base;
}
function fileUrl(base, path) {
  safeReleasePath(path);
  const url = new URL(path, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.search || url.hash) fail(`下载地址越过受信 Pages 基址：${path}`);
  return url.href;
}
function runtimePath(path, releaseId) {
  const prefix = `releases/${releaseId}/`;
  if (!path.startsWith(prefix)) return false;
  const local = path.slice(prefix.length);
  if (/(?:^|\/)(?:tools|tests?|\.local|\.git|node_modules|provenance|raw|prompts?|evidence|temp)(?:\/|[.-])/i.test(local)) return false;
  return /^src\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9._-]+\.(?:js|css)$/.test(local) || /^public\/assets\/[a-z0-9_-]+\.[a-f0-9]{16}\.(?:webp|png)$/.test(local);
}
function parseJson(bytes, path) {
  try { return JSON.parse(bytes.toString('utf8'), (key, value) => { if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('非法字段'); return value; }); }
  catch { fail(`${path} 不是安全的 JSON。`); }
}
function matchingInfo(value, reference, label) {
  for (const field of ['schemaVersion', 'releaseId', 'version', 'target', 'contentRevision']) equal(value[field], reference[field], `${label}.${field}`);
}
function manifestRows(rows, releaseId, budgets, { rootFiles = false } = {}) {
  if (!Array.isArray(rows) || !rows.length || rows.length > budgets.files) fail('清单文件数量无效。');
  const paths = new Set(); let total = 0;
  for (const row of rows) {
    safeReleasePath(row.path);
    if ((!rootFiles || !ROOT_FILES.has(row.path)) && !runtimePath(row.path, releaseId)) fail(`清单包含非运行文件或跨版本路径：${row.path}`);
    if (paths.has(row.path)) fail(`清单路径重复：${row.path}`); paths.add(row.path);
    if (!integer(row.bytes) || !/^[a-f0-9]{64}$/.test(row.sha256)) fail(`清单大小或摘要无效：${row.path}`);
    if (row.bytes > budgets.currentBytes || /\/public\/assets\//.test(row.path) && row.bytes > budgets.assetBytes) fail(`清单文件超出预算：${row.path}`);
    total += row.bytes; if (!Number.isSafeInteger(total)) fail('清单大小溢出。');
  }
  return { paths, total };
}
async function newDestination(path) {
  const temp = resolve(LOCAL_ROOT, 'temp'), destination = resolve(path), within = relative(temp, destination);
  if (!within || within.startsWith('..') || isAbsolute(within)) fail('恢复目标必须是仓库 .local/temp/ 内的新文件夹。');
  await mkdir(LOCAL_ROOT, { recursive: true });
  if ((await lstat(LOCAL_ROOT)).isSymbolicLink()) fail('.local 不能是链接。');
  let parent = LOCAL_ROOT;
  for (const part of ['temp', ...relative(temp, dirname(destination)).split(/[\\/]/).filter(Boolean)]) {
    parent = resolve(parent, part);
    try { await mkdir(parent); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = await lstat(parent); if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`恢复父目录不能是链接或文件：${parent}`);
  }
  // Never overwrite a previous failed recovery or a manually supplied artifact.
  await mkdir(destination);
  return destination;
}

/** Restore bytes only: no downloaded module is imported, evaluated or rendered. */
export async function restorePublishedRelease(baseUrl, destination = resolve(LOCAL_ROOT, 'temp/previous-web-release'), { fetcher = globalThis.fetch, budgets = RELEASE_BUDGETS } = {}) {
  const base = trustedPagesBase(baseUrl);
  destination = await newDestination(destination);
  const downloaded = new Map(); let requestedPath = null, receivedBytes = 0;
  async function download(path, limit, expected = null, { optional = false } = {}) {
    requestedPath = path;
    const url = fileUrl(base, path);
    const response = await fetcher(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const cancel = () => response.body?.cancel().catch(() => {});
    if (response.url && response.url !== url || response.redirected) { await cancel(); fail(`响应离开了受信文件地址：${path}`); }
    if (optional && response.status === 404) { await cancel(); return null; }
    if (!response.ok || response.status !== 200) { await cancel(); fail(`下载 ${path} 返回 HTTP ${response.status}。`); }
    const length = response.headers?.get('content-length');
    if (length !== null && length !== undefined && (!/^\d+$/.test(length) || Number(length) > limit)) { await cancel(); fail(`下载 ${path} 的 Content-Length 超出预算或无效。`); }
    const output = resolve(destination, safeReleasePath(path)); await mkdir(dirname(output), { recursive: true });
    const handle = await open(output, 'wx'), digest = createHash('sha256'); let size = 0;
    try {
      if (!response.body) fail(`下载 ${path} 缺少响应体。`);
      for await (const chunk of response.body) {
        const bytes = Buffer.from(chunk), remaining = Math.max(0, Math.min(limit - size, budgets.totalBytes - receivedBytes));
        if (bytes.length > remaining) { if (remaining) await handle.writeFile(bytes.subarray(0, remaining)); fail(`下载 ${path} 超出大小预算，部分文件已保留。`); }
        await handle.writeFile(bytes); digest.update(bytes); size += bytes.length; receivedBytes += bytes.length;
      }
    } finally { await handle.close(); }
    const record = { bytes: size, sha256: digest.digest('hex') };
    if (expected) { equal(record.bytes, expected.bytes, `${path} 大小`); equal(record.sha256, expected.sha256, `${path} SHA256`); }
    downloaded.set(path, record);
    return await readFile(output);
  }
  try {
    const info = parseJson(await download('release.json', METADATA_LIMITS['release.json']), 'release.json');
    equal(info.schemaVersion, 1, 'release.schemaVersion'); safeReleaseId(info.releaseId); equal(info.target, 'web', 'release.target');
    equal(info.entry, './index.html', 'release.entry'); equal(info.manifest, './release-manifest.json', 'release.manifest');
    const manifestBytes = await download('release-manifest.json', METADATA_LIMITS['release-manifest.json']), manifest = parseJson(manifestBytes, 'release-manifest.json');
    matchingInfo(manifest, info, 'manifest'); equal(manifest.status, 'built', 'manifest.status'); equal(manifest.renderer, 'web', 'manifest.renderer');
    const current = manifestRows(manifest.files, info.releaseId, budgets, { rootFiles: true });
    for (const path of ROOT_FILES) if (!current.paths.has(path)) fail(`清单缺少必要文件：${path}`);
    equal(manifest.payloadBytes, current.total, 'manifest.payloadBytes'); equal(manifest.outputBytes, current.total + manifestBytes.length, 'manifest.outputBytes');
    if (manifest.outputBytes > budgets.currentBytes) fail('当前版本超出整体预算。');
    const reportBytes = await download('asset-report.json', METADATA_LIMITS['asset-report.json']), report = parseJson(reportBytes, 'asset-report.json');
    matchingInfo(report, info, 'asset-report');
    for (const path of ['release.json', 'asset-report.json']) {
      const expected = manifest.files.find(row => row.path === path), actual = downloaded.get(path);
      equal(actual.bytes, expected.bytes, `${path} 大小`); equal(actual.sha256, expected.sha256, `${path} SHA256`);
    }
    const retainedBytes = await download('retained-release.json', METADATA_LIMITS['retained-release.json'], null, { optional: true });
    let previousFiles = [];
    if (retainedBytes) {
      const retained = parseJson(retainedBytes, 'retained-release.json'); equal(retained.schemaVersion, 1, 'retained.schemaVersion'); equal(retained.currentReleaseId, info.releaseId, 'retained.currentReleaseId');
      safeReleaseId(retained.previous?.releaseId); equal(retained.previous.target, info.target, 'retained.previous.target');
      if (retained.previous.releaseId === info.releaseId) fail('上一版不能与当前版本相同。');
      const prior = manifestRows(retained.previous.files, retained.previous.releaseId, budgets);
      if (prior.total > budgets.currentBytes) fail('上一版资源超出整体预算。');
      matchingInfo(retained.previous.assetReport, retained.previous, 'retained.assetReport'); previousFiles = retained.previous.files;
    }
    const plannedBytes = manifest.outputBytes + (retainedBytes?.length || 0) + previousFiles.reduce((sum, row) => sum + row.bytes, 0);
    if (plannedBytes > budgets.totalBytes || manifest.files.length + previousFiles.length + 1 + Number(Boolean(retainedBytes)) > budgets.files) fail('含上一版的完整静态包超出预算。');
    for (const row of [...manifest.files, ...previousFiles]) {
      if (downloaded.has(row.path)) continue;
      await download(row.path, row.bytes, row);
    }
    const checked = await releasePreflight(destination, { verifySources: false, serve: false, budgets });
    return { status: 'restored', destination, baseUrl: base.href, releaseId: checked.releaseId, previousReleaseId: checked.previousReleaseId, files: checked.files, totalBytes: checked.totalBytes, sourceHashesVerified: false, browserAcceptance: false };
  } catch (error) {
    await writeFile(resolve(destination, 'restore-error.json'), JSON.stringify({ status: 'failed', baseUrl: base.href, requestedPath, receivedBytes, message: error.message, preserved: true }, null, 2) + '\n', { flag: 'wx' }).catch(() => {});
    throw new Error(`线上制品恢复失败，已停止发布并保留 ${destination}：${error.message}`, { cause: error });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!args.length || args.length > 2 || args.some(arg => arg.startsWith('--'))) throw new Error('用法：node tools/restore-release.mjs Pages受信HTTPS基址 [新的.local/temp/恢复目录]');
  console.log(JSON.stringify(await restorePublishedRelease(args[0], args[1]), null, 2));
}
