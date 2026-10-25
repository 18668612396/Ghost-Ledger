import { mkdir, rename, access, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT, GAME_ROOT, LOCAL_ROOT, DIST_ROOT } from './paths.mjs';
import { optimizeRuntimeAssets, ASSET_PROFILE } from './optimize-assets.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = async path => { try { await access(path); return true; } catch { return false; } };
const posix = path => path.replaceAll('\\', '/');
const normalize = (bytes, path) => /\.(?:js|mjs|css|html|json|webmanifest|txt)$/.test(path) ? Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n')) : bytes;

export const RELEASE_CSP = [
  "default-src 'self'", "script-src 'self'", "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'", "img-src 'self'", "font-src 'self'",
  "media-src 'self'", "connect-src 'self'", "manifest-src 'self'",
  "base-uri 'self'", "form-action 'none'", "object-src 'none'",
  "frame-src 'none'", "worker-src 'none'",
].join('; ');

/** Apply before resource elements; never silently accept a weakened source CSP. */
export function applyReleaseCsp(html) {
  // Keep offsets while ignoring comments and inert/raw text that can contain
  // example markup without creating a real policy element in the document.
  const scan = html.replace(/<!--[\s\S]*?-->/g, match => ' '.repeat(match.length))
    .replace(/(<(script|style|title|textarea|noscript|template)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi, (_, open, tag, body, close) => open + ' '.repeat(body.length) + close);
  const head = /<head\b[^>]*>([\s\S]*?)<\/head\s*>/i.exec(scan);
  if (!head) throw new Error('发布入口缺少 head，无法添加 CSP。');
  const attribute = (tag, name) => {
    const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
    return match ? match[1] ?? match[2] ?? match[3] : null;
  };
  const metas = [...scan.matchAll(/<meta\b[^>]*>/gi)].filter(match => attribute(match[0], 'http-equiv')?.toLowerCase() === 'content-security-policy');
  if (metas.length > 1) throw new Error('发布入口只能包含一份精确的 CSP。');
  if (metas.length) {
    const meta = metas[0];
    if (attribute(meta[0], 'content') !== RELEASE_CSP) throw new Error('入口 CSP 与发布策略不一致，不能放宽脚本或资源来源。');
    const resources = /<(?:script|link|style|base|template|noscript|textarea)\b/i.exec(head[1]);
    const headStart = head.index + head[0].indexOf('>') + 1;
    if (meta.index < headStart || meta.index >= head.index + head[0].length || resources && meta.index >= headStart + resources.index) throw new Error('入口 CSP 必须放在 head 内全部资源标签之前。');
    return html;
  }
  const charset = /<meta\s+charset\s*=\s*["']?utf-8["']?\s*\/?>/i.exec(head[1]);
  if (!charset) throw new Error('发布入口缺少 UTF-8 charset，无法确定 CSP 插入位置。');
  const resources = /<(?:script|link|style|base|template|noscript|textarea)\b/i.exec(head[1]);
  if (resources && resources.index < charset.index + charset[0].length) throw new Error('入口 CSP 必须放在 head 内全部资源标签之前。');
  const insertion = head.index + head[0].indexOf('>') + 1 + charset.index + charset[0].length;
  return html.slice(0, insertion) + `\n    <meta http-equiv="Content-Security-Policy" content="${RELEASE_CSP}" />` + html.slice(insertion);
}

export function localOutputPath(path) {
  const absolute = resolve(path), within = relative(LOCAL_ROOT, absolute);
  if (!within || within.startsWith('..') || isAbsolute(within)) throw new Error('构建路径必须位于仓库 .local/ 目录内。');
  return absolute;
}

async function filesIn(root, prefix = '', exclude = []) {
  const result = [];
  for (const entry of (await readdir(resolve(root, prefix), { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (exclude.includes(path)) continue;
    if (entry.isSymbolicLink()) throw new Error(`发布源文件不允许符号链接：${path}`);
    if (entry.isDirectory()) result.push(...await filesIn(root, path, exclude));
    else if (entry.isFile()) result.push({ path, bytes: normalize(await readFile(resolve(root, path)), path) });
  }
  return result;
}

function mappedAsset(filename, assets) {
  const id = filename.replace(/\.png$/, '');
  if (!Object.hasOwn(assets, id)) throw new Error(`发布引用了未打包素材：${filename}`);
  return assets[id];
}

export function rewriteReleaseSource(source, path, assets) {
  let rewritten = source;
  if (path.endsWith('.css')) {
    rewritten = rewritten.replace(/url\(\s*(["']?)([^)"']+)\1\s*\)/gi, (match, quote, url) => {
      if (!/\/assets\/[a-z0-9_-]+\.png$/i.test(url)) return match;
      return `url("${url.slice(0, url.lastIndexOf('/') + 1)}${mappedAsset(basename(url), assets)}")`;
    });
  }
  if (path === 'src/skins.js') {
    const legacy = 'new URL(`../public/assets/${filename}`, import.meta.url).href';
    if (rewritten.includes(legacy)) {
      rewritten = rewritten.replace(legacy, 'resolveAssetUrl(filename)');
      if (!/\bimport\s*\{[^}]*\bresolveAssetUrl\b/.test(rewritten)) rewritten = `import { resolveAssetUrl } from './asset-url.js';\n${rewritten}`;
    }
  }
  if (path === 'src/presentation/effects.js') {
    const legacy = 'new URL(`../../public/assets/${name}.png`, import.meta.url).href';
    if (rewritten.includes(legacy)) {
      rewritten = rewritten.replace(legacy, 'resolveAssetUrl(name)');
      if (!/\bimport\s*\{[^}]*\bresolveAssetUrl\b/.test(rewritten)) rewritten = `import { resolveAssetUrl } from '../asset-url.js';\n${rewritten}`;
    }
  }
  if (path === 'src/main.js' && rewritten.includes('new URL(`../public/assets/${name}.png`, import.meta.url)')) throw new Error('main.js 的 asset(name) 需要接入 resolveAssetUrl(name) 后再生成发布包。');
  return rewritten;
}

export async function verifyReleaseReferences(root) {
  const files = await filesIn(root), names = new Set(files.map(file => file.path)), problems = [];
  function check(file, value) {
    if (!value || /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(value) || value.includes('${')) return;
    const clean = decodeURIComponent(value.split(/[?#]/)[0]);
    const destination = posix(relative(root, resolve(root, dirname(file), clean)));
    if (destination.startsWith('..') || !names.has(destination)) problems.push(`${file} → ${value}`);
  }
  for (const file of files) {
    const source = file.bytes.toString('utf8');
    if (file.path.endsWith('.html')) for (const match of source.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) check(file.path, match[1]);
    if (file.path.endsWith('.css')) for (const match of source.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/g)) check(file.path, match[1]);
    if (/\.m?js$/.test(file.path)) {
      for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^;]*?\s+from\s+)?["'](\.[^"']+)["']/g)) check(file.path, match[1]);
      for (const match of source.matchAll(/\bimport\(\s*["'](\.[^"']+)["']\s*\)/g)) check(file.path, match[1]);
      for (const match of source.matchAll(/new URL\(\s*["'`]([^"'`]+)["'`]\s*,\s*import\.meta\.url\s*\)/g)) check(file.path, match[1]);
    }
  }
  if (problems.length) throw new Error(`发布文件存在未解析的相对引用：\n${problems.join('\n')}`);
  return { files: files.length, referencesValid: true };
}

export async function buildWeb({ gameRoot = GAME_ROOT, outputRoot = DIST_ROOT, target = 'web', validate = true, cacheRoot, version: versionOverride } = {}) {
  if (!['web', 'windows', 'android'].includes(target)) throw new Error(`此构建只支持 WebView 目标：${target}。微信小游戏请使用 package prepare wechat。`);
  const destination = localOutputPath(outputRoot);
  if (validate) execFileSync(process.execPath, [resolve(REPO_ROOT, 'tools/check.mjs')], { cwd: REPO_ROOT, stdio: 'inherit' });
  const staging = localOutputPath(resolve(LOCAL_ROOT, `temp/web-build-${Date.now()}-${randomUUID()}`));
  await mkdir(staging, { recursive: true });
  const packageInfo = JSON.parse(await readFile(resolve(REPO_ROOT, 'package.json'), 'utf8'));
  const version = versionOverride || packageInfo.version;
  const sourceFiles = (await filesIn(gameRoot, 'src')).concat(await filesIn(gameRoot, 'public', ['public/assets']));
  const index = (await readFile(resolve(gameRoot, 'index.html'), 'utf8')).replace(/\r\n/g, '\n');
  const temporaryAssets = resolve(staging, 'encoded-assets');
  const optimized = await optimizeRuntimeAssets({ gameRoot, outputRoot: temporaryAssets, cacheRoot });
  const contentSource = sourceFiles.find(file => file.path === 'src/generated/content-data.js')?.bytes.toString('utf8');
  const revisionMatch = contentSource?.match(/export const CONTENT_REVISION = ("[^"]+");/);
  if (!revisionMatch) throw new Error('发布源文件缺少已编译的内容版本。');
  const contentRevision = JSON.parse(revisionMatch[1]);
  // Rewriting rules are part of the immutable version identity too. A builder
  // change must never emit different module bytes at an existing release URL.
  const buildTools = [];
  for (const filename of ['build.mjs', 'optimize-assets.mjs']) buildTools.push([filename, sha256(normalize(await readFile(new URL(filename, import.meta.url)), filename))]);
  const digest = sha256(JSON.stringify({ schemaVersion: 1, target, version, buildTools, profile: ASSET_PROFILE, index, sourceFiles: sourceFiles.map(file => [file.path, sha256(file.bytes)]), assets: optimized.report.records.map(asset => [asset.id, asset.sha256]) })).slice(0, 20);
  const releaseId = `v${version.replace(/[^a-zA-Z0-9._-]/g, '-')}-${target}-${digest}`;
  const releasePath = `releases/${releaseId}`, releaseRoot = resolve(staging, releasePath);
  await mkdir(resolve(releaseRoot, 'public'), { recursive: true });
  await rename(temporaryAssets, resolve(releaseRoot, 'public/assets'));
  const info = { schemaVersion: 1, releaseId, version, target, contentRevision };
  for (const file of sourceFiles) {
    const output = resolve(releaseRoot, file.path);
    await mkdir(dirname(output), { recursive: true });
    let bytes = file.bytes;
    if (file.path === 'src/build-info.js') bytes = Buffer.from(`// Generated release metadata. Source defaults remain untouched.\nexport const BUILD_INFO = Object.freeze({ ...${JSON.stringify(info)}, assets: Object.freeze(${JSON.stringify(optimized.assets)}) });\nexport const RELEASE_ID = BUILD_INFO.releaseId;\nexport const ASSET_FILES = BUILD_INFO.assets;\n`);
    else if (/\.(?:js|mjs|css)$/.test(file.path)) bytes = Buffer.from(rewriteReleaseSource(bytes.toString('utf8'), file.path, optimized.assets));
    await writeFile(output, bytes);
  }
  let html = index.replace(/\b(src|href)=(["'])(\.\/(?:src|public)\/[^"']+)\2/g, (match, attribute, quote, url) => {
    let relativePath = url.slice(2);
    if (/^public\/assets\/[a-z0-9_-]+\.png$/i.test(relativePath)) relativePath = `public/assets/${mappedAsset(basename(relativePath), optimized.assets)}`;
    return `${attribute}=${quote}./${releasePath}/${relativePath}${quote}`;
  });
  const preload = ['ref-scene', 'ui-logo', 'ref-avatar'].filter(id => optimized.assets[id]).map(id => `    <link rel="preload" as="image" href="./${releasePath}/public/assets/${optimized.assets[id]}" />`).join('\n');
  html = html.replace('</head>', `${preload}\n  </head>`);
  html = applyReleaseCsp(html);
  await writeFile(resolve(staging, 'index.html'), html);
  await writeFile(resolve(staging, '.nojekyll'), '');
  await writeFile(resolve(staging, 'asset-report.json'), JSON.stringify({ ...info, ...optimized.report }, null, 2) + '\n');
  await writeFile(resolve(staging, 'release.json'), JSON.stringify({ ...info, entry: './index.html', manifest: './release-manifest.json' }, null, 2) + '\n');
  const verified = await verifyReleaseReferences(staging);
  const releaseFiles = (await filesIn(staging)).map(file => ({ path: file.path, bytes: file.bytes.length, sha256: sha256(file.bytes) }));
  const payloadBytes = releaseFiles.reduce((sum, file) => sum + file.bytes, 0);
  const manifest = { ...info, status: 'built', renderer: 'web', entry: 'index.html', assetReport: 'asset-report.json', assetCount: optimized.report.assetCount, sourceAssetBytes: optimized.report.sourceBytes, optimizedAssetBytes: optimized.report.outputBytes, payloadBytes, outputBytes: payloadBytes, manifestFileExcludedFromFileHashes: true, files: releaseFiles, verification: verified };
  for (let attempt = 0; attempt < 4; attempt++) manifest.outputBytes = payloadBytes + Buffer.byteLength(JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(resolve(staging, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await mkdir(dirname(destination), { recursive: true });
  if (await exists(destination)) await rename(destination, localOutputPath(resolve(LOCAL_ROOT, `temp/${basename(destination)}-archive-${Date.now()}-${randomUUID()}`)));
  await rename(staging, destination);
  console.log(`Web 静态产物：${posix(relative(REPO_ROOT, destination))}/ · ${releaseId} · ${(optimized.report.outputBytes / 1048576).toFixed(2)} MiB 图片（源 ${(optimized.report.sourceBytes / 1048576).toFixed(2)} MiB）。`);
  return { destination, releaseId, manifest, assetReport: optimized.report };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--target' || !['web', 'windows', 'android'].includes(args[1]))) throw new Error('构建参数仅支持 --target web/windows/android。');
  const target = args[1] || 'web';
  await buildWeb({ target, outputRoot: target === 'web' ? DIST_ROOT : resolve(LOCAL_ROOT, `dist/${target}/web`) });
}
