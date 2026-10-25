import { readFile, readdir, lstat } from 'node:fs/promises';
import { resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { DIST_ROOT, REPO_ROOT } from './paths.mjs';

export const RELEASE_BUDGETS = Object.freeze({ currentBytes: 80 * 1048576, totalBytes: 160 * 1048576, assetBytes: 8 * 1048576, files: 1500 });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(`发布预检失败：${message}`); };
const equal = (actual, expected, label) => { if (actual !== expected) fail(`${label} 不一致（${actual} / ${expected}）。`); };
const integer = value => Number.isSafeInteger(value) && value >= 0;

export function safeReleasePath(value) {
  if (typeof value !== 'string' || !value || !/^[a-zA-Z0-9._/-]+$/.test(value) || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..')) fail(`不安全的相对路径：${String(value)}`);
  return value;
}
export function safeReleaseId(value) {
  if (typeof value !== 'string' || !/^v[a-zA-Z0-9._-]+-(?:web|windows|android)-[a-f0-9]{20}$/.test(value)) fail(`无效的版本目录：${String(value)}`);
  return value;
}
async function inventory(root, prefix = '') {
  const rows = [];
  for (const entry of await readdir(resolve(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    safeReleasePath(path);
    const stat = await lstat(resolve(root, path));
    if (stat.isSymbolicLink() || stat.nlink > 1 && stat.isFile()) fail(`不允许链接：${path}`);
    if (stat.isDirectory()) rows.push(...await inventory(root, path));
    else if (stat.isFile()) rows.push({ path, bytes: stat.size });
    else fail(`不支持的文件类型：${path}`);
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}
async function json(root, path) {
  try { return JSON.parse(await readFile(resolve(root, safeReleasePath(path)), 'utf8')); }
  catch (error) { fail(`${path} 无法读取为 JSON：${error.message}`); }
}
function infoMatches(info, reference, label) {
  for (const field of ['schemaVersion', 'releaseId', 'version', 'target', 'contentRevision']) equal(info[field], reference[field], `${label}.${field}`);
}
async function validateFiles(root, rows, prefix, names) {
  if (!Array.isArray(rows) || !rows.length) fail('文件清单为空。');
  const seen = new Set();
  let total = 0;
  for (const row of rows) {
    const path = safeReleasePath(row.path);
    if (prefix && !path.startsWith(`${prefix}/`)) fail(`文件不属于指定版本：${path}`);
    if (seen.has(path)) fail(`清单重复：${path}`);
    seen.add(path);
    if (!names.has(path)) fail(`清单文件缺失：${path}`);
    if (!integer(row.bytes) || !/^[a-f0-9]{64}$/.test(row.sha256)) fail(`文件摘要无效：${path}`);
    const bytes = await readFile(resolve(root, path));
    equal(bytes.length, row.bytes, `${path} 大小`);
    equal(sha256(bytes), row.sha256, `${path} SHA256`);
    total += bytes.length;
  }
  return { seen, total };
}
function permittedRuntimePath(path, releaseId) {
  const prefix = `releases/${releaseId}/`;
  if (!path.startsWith(prefix)) return false;
  const local = path.slice(prefix.length);
  if (/(?:^|\/)(?:tools|tests?|\.local|\.git|node_modules|provenance|raw|prompts?|evidence|temp)(?:\/|[.-])/i.test(local)) return false;
  return /^src\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9._-]+\.(?:js|css)$/.test(local) || /^public\/assets\/[a-z0-9_-]+\.[a-f0-9]{16}\.(?:webp|png)$/.test(local);
}
async function validateAssets(root, info, report, files, { verifySources, sourceRoot, budgets }) {
  infoMatches(report, info, 'asset-report');
  if (!Array.isArray(report.records) || !report.records.length) fail('素材报告为空。');
  const prefix = `releases/${info.releaseId}/public/assets/`, assets = {}, seen = new Set();
  let sourceBytes = 0, outputBytes = 0;
  for (const row of report.records) {
    if (!/^[a-z0-9_-]+$/.test(row.id) || seen.has(row.id)) fail(`重复或无效的素材标识：${row.id}`);
    seen.add(row.id);
    if (!['png', 'webp'].includes(row.format) || row.filename !== `${row.id}.${row.sha256?.slice(0, 16)}.${row.format}`) fail(`素材文件名与摘要不符：${row.id}`);
    const file = files.find(file => file.path === `${prefix}${row.filename}`);
    if (!file) fail(`缺少素材文件：${row.filename}`);
    equal(file.sha256, row.sha256, `${row.id} 输出摘要`); equal(file.bytes, row.bytes, `${row.id} 输出大小`);
    if (row.bytes > budgets.assetBytes) fail(`单张素材超出预算：${row.id}`);
    if (row.source !== `game/public/assets/${row.id}.png` || !/^[a-f0-9]{64}$/.test(row.sourceSha256) || !integer(row.sourceBytes) || row.sourceBytes < 1) fail(`素材来源摘要无效：${row.id}`);
    for (const field of ['width', 'height', 'sourceWidth', 'sourceHeight']) if (!Number.isSafeInteger(row[field]) || row[field] < 1) fail(`素材尺寸无效：${row.id}.${field}`);
    if (row.width * row.sourceHeight !== row.height * row.sourceWidth) fail(`素材缩放改变比例：${row.id}`);
    if (verifySources) {
      const bytes = await readFile(resolve(sourceRoot, row.source));
      equal(bytes.length, row.sourceBytes, `${row.id} 来源大小`); equal(sha256(bytes), row.sourceSha256, `${row.id} 来源 SHA256`);
    }
    assets[row.id] = row.filename; sourceBytes += row.sourceBytes; outputBytes += row.bytes;
  }
  const emitted = files.filter(file => file.path.startsWith(prefix));
  equal(emitted.length, report.records.length, '素材文件数量');
  equal(report.assetCount, report.records.length, '报告素材数量'); equal(report.sourceBytes, sourceBytes, '报告来源大小'); equal(report.outputBytes, outputBytes, '报告输出大小');
  equal(report.savedBytes, sourceBytes - outputBytes, '报告节省大小');
  return { assets, sourceBytes, outputBytes };
}
async function validatePackagedContent(root, info, assets, files) {
  const path = `releases/${info.releaseId}/src/generated/content-data.js`;
  if (!files.some(file => file.path === path)) fail('缺少已编译的运行配置。');
  const source = await readFile(resolve(root, path), 'utf8');
  const match = source.match(/export const CONTENT = (\{[\s\S]*\});\s*$/);
  if (!match) fail('运行配置不能安全解析为 JSON。');
  const content = JSON.parse(match[1]);
  equal(sha256(JSON.stringify(content)).slice(0, 20), info.contentRevision, '运行配置内容摘要');
  equal(source.match(/export const CONTENT_REVISION = "([a-f0-9]{20})";/)?.[1], info.contentRevision, '运行配置导出版本');
  const required = new Set();
  for (const card of Object.values(content.cards || {})) {
    for (const field of ['icon', 'background', 'cost']) if (card.visual?.[field]) required.add(card.visual[field]);
    if (card.visual?.family) { required.add(`card-frame-vivid-${card.visual.family}`); required.add(`collection-frame-${card.visual.family}`); }
  }
  for (const enemy of Object.values(content.enemies || {})) if (enemy.art) required.add(enemy.art);
  for (const item of [...Object.values(content.relics || {}), ...Object.values(content.potions || {})]) if (item.art) required.add(`card-art-${item.art}`);
  for (const visual of Object.values(content.visuals || {})) if (visual.asset) required.add(visual.asset);
  for (const file of files) {
    if (!file.path.startsWith(`releases/${info.releaseId}/src/`) || !file.path.endsWith('.js')) continue;
    const code = await readFile(resolve(root, file.path), 'utf8');
    for (const match of code.matchAll(/\b(?:asset|resolveAssetUrl)\(\s*['"]([a-z0-9_-]+)(?:\.png)?['"]/g)) required.add(match[1]);
  }
  for (const id of required) if (!Object.hasOwn(assets, id)) fail(`运行配置或界面引用未打包的素材：${id}`);
}
async function references(root, names) {
  const checked = new Set();
  const check = (from, value) => {
    if (!value || value.startsWith('#') || value.includes('${') || /^data:/i.test(value)) return;
    if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(value)) fail(`运行资源不能依赖外部地址：${from} → ${value}`);
    if (value.startsWith('/')) fail(`根路径无法用于仓库子路径部署：${from} → ${value}`);
    let clean;
    try { clean = decodeURIComponent(value.split(/[?#]/)[0]); } catch { fail(`引用编码无效：${value}`); }
    const path = posix.normalize(posix.join(posix.dirname(from), clean));
    safeReleasePath(path);
    if (!names.has(path)) fail(`引用文件缺失：${from} → ${value}`);
    const release = from.match(/^releases\/([^/]+)\//)?.[1];
    if (release && !path.startsWith(`releases/${release}/`)) fail(`跨版本引用：${from} → ${value}`);
    checked.add(path);
  };
  for (const path of names) {
    if (!/\.(?:html|css|js)$/.test(path)) continue;
    const source = await readFile(resolve(root, path), 'utf8');
    if (path.endsWith('.html')) {
      if (/<base\b/i.test(source)) fail('HTML 不允许通过 base 标签改变资源根目录。');
      for (const match of source.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) check(path, match[1]);
    }
    if (path.endsWith('.css')) for (const match of source.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/g)) check(path, match[1]);
    if (path.endsWith('.js')) {
      for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/g)) check(path, match[1]);
      for (const match of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) check(path, match[1]);
      for (const match of source.matchAll(/new URL\(\s*["'`]([^"'`]+)["'`]\s*,\s*import\.meta\.url\s*\)/g)) check(path, match[1]);
    }
  }
  return checked;
}
async function probeSubpath(root, names) {
  const prefix = '/Ghost-Ledger/', mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json' };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const path = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
      if (!url.pathname.startsWith(prefix) || !names.has(path)) { response.writeHead(404); response.end(); return; }
      response.setHeader('Content-Type', `${mime[posix.extname(path)] || 'application/octet-stream'}; charset=utf-8`);
      response.end(await readFile(resolve(root, path)));
    } catch { response.writeHead(500); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const path of names) {
      const response = await fetch(`${origin}${prefix}${path}`, { signal: AbortSignal.timeout(10000) });
      if (response.status !== 200) fail(`子路径请求失败：${path} (${response.status})`);
      const body = Buffer.from(await response.arrayBuffer());
      equal(sha256(body), sha256(await readFile(resolve(root, path))), `${path} 子路径响应`);
      if (path.endsWith('.js') && !response.headers.get('content-type')?.startsWith('text/javascript')) fail(`模块 MIME 无效：${path}`);
    }
    return { basePath: prefix, requests: names.size, status: 'passed', browserAcceptance: false };
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

/** Checks packaged bytes, not a browser, human playtest or physical device. */
export async function releasePreflight(root = DIST_ROOT, { verifySources = true, sourceRoot = REPO_ROOT, serve = true, budgets = RELEASE_BUDGETS } = {}) {
  root = resolve(root);
  const actual = await inventory(root), names = new Set(actual.map(file => file.path));
  if (actual.length > budgets.files) fail('文件数量超出预算。');
  const info = await json(root, 'release.json'), manifest = await json(root, 'release-manifest.json'), report = await json(root, 'asset-report.json');
  equal(info.schemaVersion, 1, 'schemaVersion'); safeReleaseId(info.releaseId);
  if (!['web', 'windows', 'android'].includes(info.target) || !/^[a-f0-9]{20}$/.test(info.contentRevision) || typeof info.version !== 'string') fail('发布版本信息无效。');
  if (!info.releaseId.startsWith(`v${info.version.replace(/[^a-zA-Z0-9._-]/g, '-')}-${info.target}-`)) fail('releaseId 与 version/target 不一致。');
  equal(info.entry, './index.html', 'release.entry'); equal(info.manifest, './release-manifest.json', 'release.manifest');
  infoMatches(manifest, info, 'manifest'); equal(manifest.status, 'built', 'manifest.status'); equal(manifest.renderer, 'web', 'manifest.renderer');
  equal(manifest.entry, 'index.html', 'manifest.entry'); equal(manifest.assetReport, 'asset-report.json', 'manifest.assetReport'); equal(manifest.manifestFileExcludedFromFileHashes, true, 'manifest 自身摘要约定');
  const validated = await validateFiles(root, manifest.files, null, names);
  for (const path of validated.seen) if (!['index.html', '.nojekyll', 'release.json', 'asset-report.json'].includes(path) && !permittedRuntimePath(path, info.releaseId)) fail(`发布包包含非运行文件：${path}`);
  for (const path of ['index.html', '.nojekyll', 'release.json', 'asset-report.json', `releases/${info.releaseId}/src/build-info.js`]) if (!validated.seen.has(path)) fail(`发布入口不完整：${path}`);
  equal(manifest.payloadBytes, validated.total, 'manifest.payloadBytes');
  equal(manifest.outputBytes, validated.total + (await readFile(resolve(root, 'release-manifest.json'))).length, 'manifest.outputBytes');
  if (manifest.outputBytes > budgets.currentBytes) fail(`当前版本超出 ${(budgets.currentBytes / 1048576).toFixed(0)} MiB 预算。`);
  const assets = await validateAssets(root, info, report, manifest.files, { verifySources, sourceRoot, budgets });
  await validatePackagedContent(root, info, assets.assets, manifest.files);
  equal(manifest.assetCount, report.assetCount, 'manifest.assetCount'); equal(manifest.sourceAssetBytes, assets.sourceBytes, 'manifest.sourceAssetBytes'); equal(manifest.optimizedAssetBytes, assets.outputBytes, 'manifest.optimizedAssetBytes');
  const metadata = await readFile(resolve(root, `releases/${info.releaseId}/src/build-info.js`), 'utf8');
  const metadataMatch = metadata.match(/Object\.freeze\(\{\s*\.\.\.(\{[^\n]*?\}),\s*assets:\s*Object\.freeze\((\{[^\n]*?\})\)\s*\}\)/);
  if (!metadataMatch) fail('版本模块未包含可验证的发布元数据。');
  infoMatches(JSON.parse(metadataMatch[1]), info, 'BUILD_INFO');
  equal(JSON.stringify(JSON.parse(metadataMatch[2])), JSON.stringify(assets.assets), 'BUILD_INFO.assets');
  const allowed = new Set([...validated.seen, 'release-manifest.json']);
  let retained = null;
  if (names.has('retained-release.json')) {
    const retention = await json(root, 'retained-release.json');
    equal(retention.schemaVersion, 1, '保留清单版本'); equal(retention.currentReleaseId, info.releaseId, '保留清单当前版本');
    retained = retention.previous;
    safeReleaseId(retained?.releaseId);
    if (retained.releaseId === info.releaseId) fail('不能把当前版本作为上一版保留。');
    equal(retained.target, info.target, '上一版发布目标');
    const previous = await validateFiles(root, retained.files, `releases/${retained.releaseId}`, names);
    for (const path of previous.seen) { if (!permittedRuntimePath(path, retained.releaseId)) fail(`上一版包含非运行文件：${path}`); allowed.add(path); }
    const previousAssets = await validateAssets(root, retained, retained.assetReport, retained.files, { verifySources: false, sourceRoot, budgets });
    await validatePackagedContent(root, retained, previousAssets.assets, retained.files);
    allowed.add('retained-release.json');
  }
  for (const path of names) if (!allowed.has(path)) fail(`未登记文件或多余版本：${path}`);
  const totalBytes = actual.reduce((sum, file) => sum + file.bytes, 0);
  if (totalBytes > budgets.totalBytes) fail(`含上一版的发布包超出 ${(budgets.totalBytes / 1048576).toFixed(0)} MiB 预算。`);
  const html = await readFile(resolve(root, 'index.html'), 'utf8');
  if (!html.includes(`./releases/${info.releaseId}/src/`) || retained && html.includes(`releases/${retained.releaseId}/`)) fail('入口未只指向当前版本。');
  const linked = await references(root, names);
  const subpath = serve ? await probeSubpath(root, names) : { status: 'skipped', browserAcceptance: false };
  return { status: 'passed', releaseId: info.releaseId, previousReleaseId: retained?.releaseId || null, currentBytes: manifest.outputBytes, totalBytes, files: names.size, assets: report.assetCount, sourceHashesVerified: verifySources, references: linked.size, subpath, budgets };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args[0]?.startsWith('--')) throw new Error('用法：node tools/release-preflight.mjs [产物目录]');
  console.log(JSON.stringify(await releasePreflight(args[0] || DIST_ROOT), null, 2));
}
