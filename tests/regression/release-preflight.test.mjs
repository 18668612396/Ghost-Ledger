import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, link, rename, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { LOCAL_ROOT } from '../../tools/paths.mjs';
import { releasePreflight, safeReleasePath, RELEASE_BUDGETS } from '../../tools/release-preflight.mjs';
import { retainPreviousRelease, renameRetainedDirectory } from '../../tools/retain-release.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function files(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(resolve(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await files(root, path));
    else if (path !== 'release-manifest.json') {
      const bytes = await readFile(resolve(root, path));
      result.push({ path, bytes: bytes.length, sha256: digest(bytes) });
    }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
async function temporary() {
  await mkdir(resolve(LOCAL_ROOT, 'temp'), { recursive: true });
  return mkdtemp(resolve(LOCAL_ROOT, 'temp/release-preflight-test-'));
}
async function fixture(number = 1, sourceRoot = null) {
  const root = await temporary(); sourceRoot ||= await temporary();
  const source = Buffer.from('original source art'), output = Buffer.from(`encoded image ${number}`);
  const content = { cards: {}, enemies: {}, relics: {}, potions: {}, visuals: {} };
  const info = { schemaVersion: 1, releaseId: `v0.5.0-web-${number.toString(16).padStart(20, '0')}`, version: '0.5.0', target: 'web', contentRevision: digest(JSON.stringify(content)).slice(0, 20) };
  const asset = { id: 'card-art-fixture', source: 'game/public/assets/card-art-fixture.png', sourceSha256: digest(source), sourceBytes: source.length, sourceWidth: 10, sourceHeight: 10, filename: `card-art-fixture.${digest(output).slice(0, 16)}.webp`, sha256: digest(output), bytes: output.length, width: 10, height: 10, hasAlpha: true, format: 'webp', attribution: 'fixture' };
  const report = { ...info, assetCount: 1, sourceBytes: source.length, outputBytes: output.length, savedBytes: source.length - output.length, records: [asset] };
  const prefix = `releases/${info.releaseId}`, assets = { [asset.id]: asset.filename };
  const sources = {
    'index.html': `<link rel="stylesheet" href="./${prefix}/src/style.css"><script type="module" src="./${prefix}/src/main.js"></script>`,
    '.nojekyll': '',
    'release.json': JSON.stringify({ ...info, entry: './index.html', manifest: './release-manifest.json' }),
    'asset-report.json': JSON.stringify(report),
    [`${prefix}/src/main.js`]: 'import { BUILD_INFO } from "./build-info.js"; export const version = BUILD_INFO.releaseId;',
    [`${prefix}/src/style.css`]: `.card {background:url("../public/assets/${asset.filename}")}`,
    [`${prefix}/src/build-info.js`]: `export const BUILD_INFO = Object.freeze({ ...${JSON.stringify(info)}, assets: Object.freeze(${JSON.stringify(assets)}) });`,
    [`${prefix}/src/generated/content-data.js`]: `export const CONTENT_REVISION = "${info.contentRevision}";\nexport const CONTENT = ${JSON.stringify(content)};\n`,
    [`${prefix}/public/assets/${asset.filename}`]: output,
  };
  for (const [path, bytes] of Object.entries(sources)) { await mkdir(resolve(root, path, '..'), { recursive: true }); await writeFile(resolve(root, path), bytes); }
  await mkdir(resolve(sourceRoot, 'game/public/assets'), { recursive: true });
  await writeFile(resolve(sourceRoot, asset.source), source);
  const manifest = { ...info, status: 'built', renderer: 'web', entry: 'index.html', assetReport: 'asset-report.json', assetCount: 1, sourceAssetBytes: source.length, optimizedAssetBytes: output.length, manifestFileExcludedFromFileHashes: true };
  const refresh = async () => {
    manifest.files = await files(root); manifest.payloadBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0); manifest.outputBytes = manifest.payloadBytes;
    for (let i = 0; i < 5; i++) manifest.outputBytes = manifest.payloadBytes + Buffer.byteLength(JSON.stringify(manifest, null, 2) + '\n');
    await writeFile(resolve(root, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  };
  await refresh();
  return { root, sourceRoot, prefix, info, report, asset, manifest, refresh };
}

test('release preflight verifies source/output hashes and serves all files under a repository subpath', async () => {
  const f = await fixture();
  const result = await releasePreflight(f.root, { sourceRoot: f.sourceRoot });
  assert.equal(result.status, 'passed'); assert.equal(result.sourceHashesVerified, true);
  assert.equal(result.subpath.basePath, '/Ghost-Ledger/'); assert.equal(result.subpath.requests, result.files);
  assert.equal(result.subpath.browserAcceptance, false); assert.equal(result.previousReleaseId, null);
});

test('tampered output or source art fails instead of trusting a manifest alone', async () => {
  const f = await fixture();
  await writeFile(resolve(f.root, f.prefix, 'public/assets', f.asset.filename), 'corrupted');
  await assert.rejects(releasePreflight(f.root, { sourceRoot: f.sourceRoot, serve: false }), /大小|SHA256/);
  const clean = await fixture();
  await writeFile(resolve(clean.sourceRoot, clean.asset.source), 'source changed');
  await assert.rejects(releasePreflight(clean.root, { sourceRoot: clean.sourceRoot, serve: false }), /来源/);
});

test('missing imports and root absolute asset URLs fail even when file hashes have been refreshed', async () => {
  for (const source of ['import "./missing.js";', 'import "/releases/fixture.js";']) {
    const f = await fixture();
    await writeFile(resolve(f.root, f.prefix, 'src/main.js'), source); await f.refresh();
    await assert.rejects(releasePreflight(f.root, { sourceRoot: f.sourceRoot, serve: false }), /引用文件缺失|根路径/);
  }
});

test('tools, tests, raw provenance and unregistered extra releases cannot enter a package', async () => {
  for (const path of ['tools/secret.js', 'tests/regression.test.js', '.local/evidence.json', 'public/assets/art-manifest.json', 'releases/v0.5.0-web-ffffffffffffffffffff/src/main.js']) {
    const f = await fixture();
    await mkdir(resolve(f.root, path, '..'), { recursive: true }); await writeFile(resolve(f.root, path), 'private fixture'); await f.refresh();
    await assert.rejects(releasePreflight(f.root, { sourceRoot: f.sourceRoot, serve: false }), /非运行文件/);
  }
});

test('manifest traversal, path aliases and duplicate entries are rejected', async () => {
  for (const path of ['../outside', '/absolute', 'a\\b', 'a//b', 'a/./b', 'a/%2e%2e/b', 'C:/outside']) assert.throws(() => safeReleasePath(path), /不安全/);
  const f = await fixture();
  f.manifest.files.push({ ...f.manifest.files[0] });
  await writeFile(resolve(f.root, 'release-manifest.json'), JSON.stringify(f.manifest));
  await assert.rejects(releasePreflight(f.root, { sourceRoot: f.sourceRoot, serve: false }), /重复/);
});

test('dynamic asset names and compiled configuration are checked beyond static URL references', async () => {
  const f = await fixture();
  await writeFile(resolve(f.root, f.prefix, 'src/main.js'), 'const icon = resolveAssetUrl("card-art-missing");'); await f.refresh();
  await assert.rejects(releasePreflight(f.root, { sourceRoot: f.sourceRoot, serve: false }), /未打包的素材/);
  const altered = await fixture();
  await writeFile(resolve(altered.root, altered.prefix, 'src/generated/content-data.js'), `export const CONTENT_REVISION = "${altered.info.contentRevision}";\nexport const CONTENT = {"cards":{"injected":{}}};\n`); await altered.refresh();
  await assert.rejects(releasePreflight(altered.root, { sourceRoot: altered.sourceRoot, serve: false }), /运行配置内容摘要/);
});

test('version metadata and explicit file budgets fail with actionable errors', async () => {
  const f = await fixture();
  await assert.rejects(releasePreflight(f.root, { sourceRoot: f.sourceRoot, serve: false, budgets: { ...RELEASE_BUDGETS, currentBytes: 1 } }), /预算/);
  await writeFile(resolve(f.root, f.prefix, 'src/build-info.js'), `export const BUILD_INFO = Object.freeze({ ...${JSON.stringify({ ...f.info, contentRevision: 'f'.repeat(20) })}, assets: Object.freeze(${JSON.stringify({ [f.asset.id]: f.asset.filename })}) });`);
  await f.refresh();
  await assert.rejects(releasePreflight(f.root, { sourceRoot: f.sourceRoot, serve: false }), /BUILD_INFO.contentRevision/);
});

test('retention keeps exactly the immediately previous release and never overwrites the new entry', async () => {
  const oldest = await fixture(1), previous = await fixture(2, oldest.sourceRoot), current = await fixture(3, oldest.sourceRoot);
  await retainPreviousRelease(previous.root, oldest.root, { sourceRoot: oldest.sourceRoot });
  const before = await readFile(resolve(current.root, 'index.html'));
  const result = await retainPreviousRelease(current.root, previous.root, { sourceRoot: oldest.sourceRoot });
  assert.equal(result.previousReleaseId, previous.info.releaseId);
  assert.deepEqual(await readFile(resolve(current.root, 'index.html')), before);
  assert.deepEqual((await readdir(resolve(current.root, 'releases'))).sort(), [current.info.releaseId, previous.info.releaseId].sort());
  const checked = await releasePreflight(current.root, { sourceRoot: oldest.sourceRoot });
  assert.equal(checked.previousReleaseId, previous.info.releaseId);
  await assert.rejects(retainPreviousRelease(current.root, previous.root, { sourceRoot: oldest.sourceRoot }), /已保留上一版/);
});

test('re-deploying the same build preserves the last distinct predecessor', async () => {
  const old = await fixture(1), first = await fixture(2, old.sourceRoot), same = await fixture(2, old.sourceRoot);
  await retainPreviousRelease(first.root, old.root, { sourceRoot: old.sourceRoot });
  const result = await retainPreviousRelease(same.root, first.root, { sourceRoot: old.sourceRoot });
  assert.equal(result.previousReleaseId, old.info.releaseId);
});

test('corrupt prior release fails before copying any previous directory', async () => {
  const old = await fixture(1), current = await fixture(2, old.sourceRoot);
  await writeFile(resolve(old.root, old.prefix, 'src/main.js'), 'altered archived module');
  await assert.rejects(retainPreviousRelease(current.root, old.root, { sourceRoot: old.sourceRoot }), /大小|SHA256/);
  assert.deepEqual(await readdir(resolve(current.root, 'releases')), [current.info.releaseId]);
});

test('linked files cannot bypass the release inventory', async t => {
  const f = await fixture();
  try { await link(resolve(f.root, f.prefix, 'src/main.js'), resolve(f.root, f.prefix, 'src/alias.js')); }
  catch (error) { if (['EPERM', 'ENOTSUP'].includes(error.code)) { t.skip(`硬链接不可用：${error.code}`); return; } throw error; }
  await assert.rejects(releasePreflight(f.root, { sourceRoot: f.sourceRoot, serve: false }), /不允许链接/);
});

test('a symlink cannot pull local files into the release', async t => {
  const f = await fixture();
  try { await symlink(resolve(f.sourceRoot, f.asset.source), resolve(f.root, f.prefix, 'src/linked.js')); }
  catch (error) { if (['EPERM', 'ENOTSUP'].includes(error.code)) { t.skip(`符号链接不可用：${error.code}`); return; } throw error; }
  await assert.rejects(releasePreflight(f.root, { sourceRoot: f.sourceRoot, serve: false }), /不允许链接/);
});

async function renameFixture() {
  const root = await temporary(), parent = resolve(root, 'releases'), source = resolve(parent, `.retaining-${randomUUID()}`), destination = resolve(parent, 'v0.5.0-web-aaaaaaaaaaaaaaaaaaaa');
  await mkdir(source, { recursive: true }); await writeFile(resolve(source, 'sentinel.txt'), 'keep these bytes');
  return { root, source, destination };
}
const renameError = code => Object.assign(new Error(`simulated ${code}`), { code });

test('Windows transient rename locks retry with bounded backoff and preserve all bytes', async t => {
  const f = await renameFixture(), delays = []; let attempts = 0;
  const operation = t.mock.fn(async (source, destination) => { if (++attempts <= 2) throw renameError('EPERM'); await rename(source, destination); });
  const result = await renameRetainedDirectory(f.source, f.destination, { platform: 'win32', renameDirectory: operation, wait: async delay => delays.push(delay) });
  assert.equal(result.attempts, 3); assert.deepEqual(delays, [50, 150]);
  assert.equal(await readFile(resolve(f.destination, 'sentinel.txt'), 'utf8'), 'keep these bytes'); await assert.rejects(lstat(f.source), { code: 'ENOENT' });
});

test('persistent Windows permission errors stop after five attempts and keep the staging directory', async t => {
  const f = await renameFixture(), delays = [], original = renameError('EACCES'), operation = t.mock.fn(async () => { throw original; });
  await assert.rejects(renameRetainedDirectory(f.source, f.destination, { platform: 'win32', renameDirectory: operation, wait: async delay => delays.push(delay) }), error => error.code === 'EACCES' && error.renameAttempts === 5 && error.cause === original);
  assert.equal(operation.mock.callCount(), 5); assert.deepEqual(delays, [50, 150, 350, 750]);
  assert.equal(await readFile(resolve(f.source, 'sentinel.txt'), 'utf8'), 'keep these bytes'); await assert.rejects(lstat(f.destination), { code: 'ENOENT' });
});

test('known destinations and destinations appearing during a retry are never replaced', async t => {
  for (const alreadyExists of [true, false]) {
    const f = await renameFixture(), wait = t.mock.fn(async () => {});
    if (alreadyExists) { await mkdir(f.destination); await writeFile(resolve(f.destination, 'owner.txt'), 'existing release'); }
    const operation = t.mock.fn(async () => { await mkdir(f.destination); await writeFile(resolve(f.destination, 'owner.txt'), 'existing release'); throw renameError('EPERM'); });
    await assert.rejects(renameRetainedDirectory(f.source, f.destination, { platform: 'win32', renameDirectory: operation, wait }), { code: 'EEXIST' });
    assert.equal(operation.mock.callCount(), alreadyExists ? 0 : 1); assert.equal(wait.mock.callCount(), 0);
    assert.equal(await readFile(resolve(f.destination, 'owner.txt'), 'utf8'), 'existing release'); assert.equal(await readFile(resolve(f.source, 'sentinel.txt'), 'utf8'), 'keep these bytes');
  }
});

test('non-transient errors and non-Windows permission failures do not retry', async t => {
  for (const [platform, code] of [['win32', 'ENOSPC'], ['linux', 'EPERM']]) {
    const f = await renameFixture(), original = renameError(code), wait = t.mock.fn(async () => {}), operation = t.mock.fn(async () => { throw original; });
    await assert.rejects(renameRetainedDirectory(f.source, f.destination, { platform, renameDirectory: operation, wait }), error => error === original);
    assert.equal(operation.mock.callCount(), 1); assert.equal(wait.mock.callCount(), 0); assert.equal(await readFile(resolve(f.source, 'sentinel.txt'), 'utf8'), 'keep these bytes');
  }
});

test('rename scope checks reject an escaped destination before any move', async t => {
  const f = await renameFixture(), operation = t.mock.fn(async () => {});
  await assert.rejects(renameRetainedDirectory(f.source, resolve(f.root, 'outside'), { renameDirectory: operation }), /同一个 releases/);
  assert.equal(operation.mock.callCount(), 0); assert.equal(await readFile(resolve(f.source, 'sentinel.txt'), 'utf8'), 'keep these bytes');
});
