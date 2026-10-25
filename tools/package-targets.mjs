import { access, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, relative, dirname, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { REPO_ROOT, GAME_ROOT, LOCAL_ROOT } from './paths.mjs';
import { buildWeb, localOutputPath } from './build.mjs';

const ids = ['web', 'windows', 'android', 'wechat'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const posix = path => path.replaceAll('\\', '/');
const json = value => JSON.stringify(value, null, 2) + '\n';
const exists = async path => { try { await access(path); return true; } catch { return false; } };
const nativeFiles = ['Cargo.toml', 'package.json', 'build.rs', 'src/lib.rs', 'src/main.rs', 'tauri.conf.json', 'capabilities/main.json'];
const wechatFiles = ['game.js', 'game.json', 'project.config.json'];

function within(root, path) {
  const child = relative(root, resolve(path));
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error(`路径超出允许目录：${path}`);
  return resolve(path);
}

export async function readTargetRegistry(gameRoot = GAME_ROOT) {
  const registry = JSON.parse(await readFile(resolve(gameRoot, 'targets/manifest.json'), 'utf8'));
  if (registry.schemaVersion !== 1 || ids.some(id => !registry.targets?.[id]) || Object.keys(registry.targets).some(id => !ids.includes(id))) throw new Error('平台注册表格式不受支持。');
  for (const id of ids) {
    const target = registry.targets[id];
    if (target.output !== `.local/dist/${id}`) throw new Error(`平台输出目录不正确：${id}`);
    for (const path of [...registry.shared.coreEntries, registry.shared.platformContract, target.platform, ...(target.host ? [target.host] : [])]) {
      if (typeof path !== 'string' || !path.startsWith('game/') || /[\\]/.test(path) || path.split('/').includes('..')) throw new Error(`平台注册表包含不安全路径：${id}`);
    }
  }
  return registry;
}

export async function listTargets() {
  const registry = await readTargetRegistry();
  return ids.map(id => ({ id, ...registry.targets[id], status: id === 'web' ? 'buildable' : 'not-built', nativeBinaryBuilt: false }));
}

function commandAvailable(command, args) {
  const result = spawnSync(command, args, { windowsHide: true, timeout: 3000, encoding: 'utf8', stdio: 'pipe' });
  return !result.error && result.status === 0;
}

export async function checkTarget(id) {
  if (!ids.includes(id)) throw new Error(`未知打包平台：${id}`);
  const registry = await readTargetRegistry(), target = registry.targets[id];
  const required = [...registry.shared.coreEntries, registry.shared.platformContract, target.platform];
  const hostFiles = id === 'wechat' ? wechatFiles : id === 'web' ? [] : nativeFiles;
  for (const path of hostFiles) required.push(`${target.host}/${path}`);
  const missing = [];
  for (const path of required) if (!await exists(resolve(REPO_ROOT, path))) missing.push(path);
  const issues = [];
  if (['windows', 'android'].includes(id) && !missing.length) {
    const config = JSON.parse(await readFile(resolve(REPO_ROOT, target.host, 'tauri.conf.json'), 'utf8'));
    if (config.build.frontendDist !== '../web') issues.push('原生宿主必须引用同一准备包的 ../web。');
    if (!config.app.security.csp || config.app.security.csp.includes("'unsafe-eval'")) issues.push('原生宿主缺少受限 CSP。');
  }
  const localPrerequisites = id === 'web' ? { node: true } : id === 'wechat' ? { rendererImplemented: false, appIdConfigured: false } : {
    rustOnPath: commandAvailable('rustc', ['--version']),
    ...(id === 'android' ? { javaHomeConfigured: Boolean(process.env.JAVA_HOME), androidSdkConfigured: Boolean(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT) } : {}),
    nativeCompilationVerified: false,
  };
  return { id, configurationValid: !missing.length && !issues.length, missing, issues, implementation: target.implementation, renderer: target.renderer, localPrerequisites, readyToPublish: false, status: id === 'web' ? 'source-ready' : 'not-built', prerequisites: target.prerequisites || [], distributionRequirements: target.distributionRequirements || [] };
}

/** Resolve a pure ESM dependency closure without executing game code. */
export async function collectCoreFiles(sourceRoot, entries) {
  const root = resolve(sourceRoot), files = new Map();
  async function visit(path) {
    const absolute = within(root, resolve(root, path)), key = posix(relative(root, absolute));
    if (files.has(key)) return;
    if (!key.endsWith('.js') || /^(?:main|skins|skin-data|asset-url|build-info)\.js$/.test(key) || /^(?:presentation\/|platform\/(?:web|index)\.js$)/.test(key)) throw new Error(`共享规则不能包含浏览器渲染模块：${key}`);
    const bytes = Buffer.from((await readFile(absolute, 'utf8')).replace(/\r\n/g, '\n'));
    const source = bytes.toString('utf8');
    if (/\b(?:document|window|localStorage|sessionStorage|AudioContext|HTMLElement|navigator)\b/.test(source)) throw new Error(`共享规则含有浏览器依赖：${key}`);
    files.set(key, bytes);
    const imports = [...source.matchAll(/\b(?:import|export)\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/g), ...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)];
    for (const match of imports) {
      if (!match[1].startsWith('.')) throw new Error(`共享规则不允许外部依赖：${key} → ${match[1]}`);
      await visit(relative(root, resolve(dirname(absolute), match[1])));
    }
  }
  for (const entry of entries) await visit(entry);
  return [...files.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, bytes]) => ({ path, bytes, sha256: sha256(bytes) }));
}

async function copyTemplate(source, target, paths) {
  for (const path of paths) {
    const from = within(source, resolve(source, path)), to = within(target, resolve(target, path));
    await mkdir(dirname(to), { recursive: true });
    await writeFile(to, (await readFile(from, 'utf8')).replace(/\r\n/g, '\n'));
  }
}

async function nativeIcons(gameRoot, shell) {
  const sharp = (await import('sharp')).default;
  const input = await readFile(resolve(gameRoot, 'public/assets/ui-favicon.png'));
  const output = resolve(shell, 'icons');
  await mkdir(output, { recursive: true });
  for (const [filename, size] of [['32x32.png', 32], ['128x128.png', 128], ['128x128@2x.png', 256], ['icon.png', 512]]) {
    await writeFile(resolve(output, filename), await sharp(input).resize(size, size).ensureAlpha().png().toBuffer());
  }
  // ICO directory + complete PNG layers. 32px is first for Windows previews.
  const layers = [];
  for (const size of [32, 16, 24, 48, 64, 256]) layers.push({ size, bytes: await sharp(input).resize(size, size).ensureAlpha().png().toBuffer() });
  const directory = Buffer.alloc(6 + layers.length * 16);
  directory.writeUInt16LE(1, 2); directory.writeUInt16LE(layers.length, 4);
  let offset = directory.length;
  for (const [index, layer] of layers.entries()) {
    const start = 6 + index * 16;
    directory[start] = layer.size % 256; directory[start + 1] = layer.size % 256;
    directory.writeUInt16LE(1, start + 4); directory.writeUInt16LE(32, start + 6);
    directory.writeUInt32LE(layer.bytes.length, start + 8); directory.writeUInt32LE(offset, start + 12);
    offset += layer.bytes.length;
  }
  await writeFile(resolve(output, 'icon.ico'), Buffer.concat([directory, ...layers.map(layer => layer.bytes)]));
  return { source: 'game/public/assets/ui-favicon.png', sourceSha256: sha256(input), sourceBytes: input.length };
}

async function installPreparation(staging, destination) {
  await mkdir(dirname(destination), { recursive: true });
  if (await exists(destination)) await rename(destination, localOutputPath(resolve(LOCAL_ROOT, `temp/${basename(destination)}-archive-${Date.now()}-${randomUUID()}`)));
  await rename(staging, destination);
}

export async function prepareTarget(id, { outputRoot, validate = true } = {}) {
  if (!ids.includes(id)) throw new Error(`未知打包平台：${id}`);
  const registry = await readTargetRegistry(), target = registry.targets[id];
  const destination = localOutputPath(outputRoot || resolve(REPO_ROOT, target.output));
  const preparationRoot = posix(relative(REPO_ROOT, destination));
  const check = await checkTarget(id);
  if (!check.configurationValid) throw new Error(`平台准备失败：${[...check.missing, ...check.issues].join('、')}`);
  if (id === 'web') {
    const built = await buildWeb({ outputRoot: destination, target: 'web', validate });
    return { id, status: 'built', runnable: true, destination: built.destination, releaseId: built.releaseId };
  }
  if (validate) execFileSync(process.execPath, [resolve(REPO_ROOT, 'tools/check.mjs')], { cwd: REPO_ROOT, stdio: 'inherit' });
  const staging = localOutputPath(resolve(LOCAL_ROOT, `temp/${id}-prepare-${Date.now()}-${randomUUID()}`));
  await mkdir(staging, { recursive: true });
  const version = JSON.parse(await readFile(resolve(REPO_ROOT, 'package.json'), 'utf8')).version;
  const preparation = { schemaVersion: 1, id, version, status: 'prepared', binaryStatus: 'not-built', runnable: false, nativeBinary: null, renderer: target.renderer, implementation: target.implementation, sharedCoreEntries: registry.shared.coreEntries, platformContract: registry.shared.platformContract, platformAdapter: target.platform, prerequisites: target.prerequisites, distributionRequirements: target.distributionRequirements };
  if (id === 'wechat') {
    await copyTemplate(resolve(REPO_ROOT, target.host), staging, wechatFiles);
    const entries = [...registry.shared.coreEntries, registry.shared.platformContract, target.platform].map(path => path.slice('game/src/'.length));
    const files = await collectCoreFiles(resolve(GAME_ROOT, 'src'), entries);
    for (const file of files) {
      const output = within(staging, resolve(staging, 'core', file.path));
      await mkdir(dirname(output), { recursive: true }); await writeFile(output, file.bytes);
    }
    Object.assign(preparation, { publicationDeferred: true, rendererImplemented: false, moduleFormat: 'esm-source-requires-minigame-bundling', resourcePolicy: 'runtime assets are intentionally not copied until subpackage/CDN integration', files: files.map(({ path, bytes, sha256 }) => ({ path: `core/${path}`, bytes: bytes.length, sha256 })), blockers: ['Canvas renderer is not implemented', 'Mini Game module/runtime adaptation is not implemented', 'AppID, runtime resource delivery and platform review are pending'] });
  } else {
    const built = await buildWeb({ outputRoot: resolve(staging, 'web'), target: id, validate: false });
    const shell = resolve(staging, 'native-shell');
    await copyTemplate(resolve(REPO_ROOT, target.host), shell, nativeFiles);
    const configPath = resolve(shell, 'tauri.conf.json'), config = JSON.parse(await readFile(configPath, 'utf8'));
    config.version = version; config.identifier = registry.applicationId;
    if (id === 'android') config.bundle.targets = 'all';
    await writeFile(configPath, json(config));
    for (const filename of ['package.json', 'Cargo.toml']) {
      const path = resolve(shell, filename), source = await readFile(path, 'utf8');
      await writeFile(path, source.replace(filename.endsWith('.json') ? /"version":\s*"[^"]+"/ : /^version\s*=\s*"[^"]+"/m, filename.endsWith('.json') ? `"version": "${version}"` : `version = "${version}"`));
    }
    Object.assign(preparation, { releaseId: built.releaseId, webEntry: 'web/index.html', hostDirectory: 'native-shell', applicationIdentifier: registry.applicationId, iconSource: await nativeIcons(GAME_ROOT, shell), nativeDependenciesInstalled: false, nativeCompilationExecuted: false, nextSteps: [
      { cwd: `${preparationRoot}/native-shell`, command: 'npm install', purpose: 'Install the pinned Tauri CLI; not executed by prepare.' },
      ...(id === 'android' ? [{ cwd: `${preparationRoot}/native-shell`, command: 'npm run tauri -- android init', purpose: 'Initialize Android Studio project after SDK/NDK setup.' }, { cwd: `${preparationRoot}/native-shell`, command: 'npm run tauri -- icon icons/icon.png', purpose: 'Apply app icons to the generated Android project.' }] : []),
      { cwd: `${preparationRoot}/native-shell`, command: id === 'android' ? 'npm run tauri -- android build --apk' : 'npm run tauri -- build', purpose: 'Compile the platform binary after installing prerequisites and configuring signing.' },
    ] });
  }
  await writeFile(resolve(staging, 'preparation.json'), json(preparation));
  await installPreparation(staging, destination);
  console.log(`${target.name} 准备目录：${posix(relative(REPO_ROOT, destination))}/ · prepared / not-built。`);
  return { ...preparation, destination };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, id, ...extra] = process.argv.slice(2);
  if (extra.length || !['list', 'check', 'prepare'].includes(command) || command === 'list' && id || command === 'prepare' && !id) throw new Error('用法：npm run package -- list | check [web|windows|android|wechat] | prepare <web|windows|android|wechat>');
  if (command === 'list') console.log(json(await listTargets()));
  else if (command === 'check') {
    const checks = [];
    for (const target of id ? [id] : ids) checks.push(await checkTarget(target));
    console.log(json(checks));
    if (checks.some(check => !check.configurationValid)) process.exitCode = 1;
  } else console.log(json(await prepareTarget(id)));
}
