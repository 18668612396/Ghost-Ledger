import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { LOCAL_ROOT } from '../../tools/paths.mjs';
import { restorePublishedRelease, trustedPagesBase } from '../../tools/restore-release.mjs';
import { RELEASE_BUDGETS } from '../../tools/release-preflight.mjs';

const BASE = 'https://18668612396.github.io/Ghost-Ledger/';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
async function target() {
  await mkdir(resolve(LOCAL_ROOT, 'temp'), { recursive: true });
  const parent = await mkdtemp(resolve(LOCAL_ROOT, 'temp/release-restore-test-'));
  return resolve(parent, 'recovered');
}
function fixture(number = 1, { main = 'throw new Error("downloaded JS must never execute");', mutateReport } = {}) {
  const content = { cards: {}, enemies: {}, relics: {}, potions: {}, visuals: {} }, bytes = Buffer.from(`encoded fixture ${number}`);
  const info = { schemaVersion: 1, releaseId: `v0.5.0-web-${number.toString(16).padStart(20, '0')}`, version: '0.5.0', target: 'web', contentRevision: hash(JSON.stringify(content)).slice(0, 20) };
  const prefix = `releases/${info.releaseId}`, filename = `card-art-fixture.${hash(bytes).slice(0, 16)}.webp`;
  const record = { id: 'card-art-fixture', source: 'game/public/assets/card-art-fixture.png', sourceSha256: 'a'.repeat(64), sourceBytes: 100, sourceWidth: 10, sourceHeight: 10, filename, sha256: hash(bytes), bytes: bytes.length, width: 10, height: 10, format: 'webp' };
  const report = { ...info, assetCount: 1, sourceBytes: 100, outputBytes: bytes.length, savedBytes: 100 - bytes.length, records: [record] }; mutateReport?.(report);
  const entries = new Map(Object.entries({
    'index.html': Buffer.from(`<link href="./${prefix}/src/style.css" rel="stylesheet"><script type="module" src="./${prefix}/src/main.js"></script>`),
    '.nojekyll': Buffer.alloc(0),
    'release.json': json({ ...info, entry: './index.html', manifest: './release-manifest.json' }),
    'asset-report.json': json(report),
    [`${prefix}/src/main.js`]: Buffer.from(main),
    [`${prefix}/src/style.css`]: Buffer.from(`.card{background:url("../public/assets/${filename}")}`),
    [`${prefix}/src/build-info.js`]: Buffer.from(`export const BUILD_INFO = Object.freeze({ ...${JSON.stringify(info)}, assets: Object.freeze(${JSON.stringify({ 'card-art-fixture': filename })}) });`),
    [`${prefix}/src/generated/content-data.js`]: Buffer.from(`export const CONTENT_REVISION = "${info.contentRevision}";\nexport const CONTENT = ${JSON.stringify(content)};\n`),
    [`${prefix}/public/assets/${filename}`]: bytes,
  }));
  const manifest = { ...info, status: 'built', renderer: 'web', entry: 'index.html', assetReport: 'asset-report.json', assetCount: 1, sourceAssetBytes: 100, optimizedAssetBytes: bytes.length, manifestFileExcludedFromFileHashes: true, files: [...entries].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: hash(bytes) })) };
  const refreshManifest = () => { manifest.payloadBytes = manifest.files.reduce((sum, row) => sum + row.bytes, 0); manifest.outputBytes = manifest.payloadBytes; for (let i = 0; i < 5; i++) manifest.outputBytes = manifest.payloadBytes + json(manifest).length; entries.set('release-manifest.json', json(manifest)); };
  refreshManifest();
  return { entries, info, prefix, report, manifest, refreshManifest };
}
function withPrevious(current, previous) {
  const rows = previous.manifest.files.filter(row => row.path.startsWith(`${previous.prefix}/`));
  const retention = { schemaVersion: 1, currentReleaseId: current.info.releaseId, previous: { ...previous.info, files: rows, assetReport: previous.report } };
  current.entries.set('retained-release.json', json(retention));
  for (const row of rows) current.entries.set(row.path, previous.entries.get(row.path));
  return current;
}
function remote(t, fixture, { base = BASE, respond } = {}) {
  return t.mock.fn(async (url, options) => {
    assert.ok(url.startsWith(base)); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store'); assert.equal(options.headers, undefined);
    const path = url.slice(base.length), overridden = await respond?.(path, url);
    if (overridden) return overridden;
    const bytes = fixture.entries.get(path), response = bytes ? new Response(bytes, { status: 200, headers: { 'Content-Length': String(bytes.length) } }) : new Response('missing', { status: 404 });
    Object.defineProperty(response, 'url', { value: url }); return response;
  });
}
async function failureEvidence(destination) {
  const evidence = JSON.parse(await readFile(resolve(destination, 'restore-error.json'), 'utf8'));
  assert.equal(evidence.status, 'failed'); assert.equal(evidence.preserved, true); return evidence;
}

test('expired-artifact recovery restores a complete validated package without executing its JavaScript', async t => {
  const f = fixture(), destination = await target(), fetcher = remote(t, f), result = await restorePublishedRelease(BASE, destination, { fetcher });
  assert.equal(result.status, 'restored'); assert.equal(result.releaseId, f.info.releaseId); assert.equal(result.previousReleaseId, null);
  assert.equal(result.sourceHashesVerified, false); assert.equal(result.browserAcceptance, false);
  for (const [path, bytes] of f.entries) assert.deepEqual(await readFile(resolve(destination, path)), bytes);
  assert.equal(result.files, f.entries.size); assert.equal(fetcher.mock.calls.length, f.entries.size + 1);
  assert.equal((await readdir(destination)).includes('restore-error.json'), false);
});

test('recovery includes the single retained predecessor but never asks for its root entry', async t => {
  const prior = fixture(1), f = withPrevious(fixture(2), prior), destination = await target(), fetcher = remote(t, f);
  const result = await restorePublishedRelease(BASE, destination, { fetcher });
  assert.equal(result.previousReleaseId, prior.info.releaseId); assert.equal(result.files, f.entries.size);
  assert.deepEqual((await readdir(resolve(destination, 'releases'))).sort(), [prior.info.releaseId, f.info.releaseId].sort());
  assert.deepEqual(await readFile(resolve(destination, 'index.html')), f.entries.get('index.html'));
});

test('only an explicit clean HTTPS base is trusted, including a Pages custom domain', async t => {
  for (const base of ['http://example.test/site/', 'https://user:pass@example.test/', 'https://example.test/?token=secret', 'https://example.test/#hash', 'https://example.test/a/../site/', 'https://example.test/%2e%2e/site/', 'https://example.test/a\\b/', 'https://example.test/a//b/']) assert.throws(() => trustedPagesBase(base), /基址/);
  const f = fixture(), custom = 'https://game.example.test/night-ledger/', destination = await target();
  assert.equal(trustedPagesBase(custom.slice(0, -1)).href, custom);
  assert.equal((await restorePublishedRelease(custom, destination, { fetcher: remote(t, f, { base: custom }) })).status, 'restored');
});

test('manifest traversal, foreign URLs, tools and foreign version paths stop before their download', async t => {
  for (const path of ['../outside.js', '/absolute.js', 'https://evil.test/x.js', 'tools/private.js', 'releases/v0.5.0-web-ffffffffffffffffffff/src/main.js']) {
    const f = fixture(); f.manifest.files.push({ path, bytes: 1, sha256: 'a'.repeat(64) }); f.refreshManifest();
    const destination = await target(), fetcher = remote(t, f);
    await assert.rejects(restorePublishedRelease(BASE, destination, { fetcher }), /不安全|非运行文件|跨版本/);
    assert.deepEqual(fetcher.mock.calls.map(call => call.arguments[0]), [`${BASE}release.json`, `${BASE}release-manifest.json`]); await failureEvidence(destination);
  }
});

test('redirects and foreign response addresses cannot leave the trusted origin or base path', async t => {
  for (const response of [new Response(null, { status: 302, headers: { Location: 'https://evil.test/release.json' } }), new Response('{}')]) {
    if (response.status === 200) Object.defineProperty(response, 'url', { value: 'https://18668612396.github.io/other/release.json' });
    const destination = await target(), f = fixture(), fetcher = remote(t, f, { respond: path => path === 'release.json' ? response : null });
    await assert.rejects(restorePublishedRelease(BASE, destination, { fetcher }), /HTTP 302|受信文件地址/); assert.equal(fetcher.mock.callCount(), 1); await failureEvidence(destination);
  }
});

test('same-sized hash corruption stops publication and preserves the failed downloaded file', async t => {
  const f = fixture(), path = `${f.prefix}/src/main.js`, corrupted = Buffer.from(f.entries.get(path)); corrupted[0] ^= 1;
  const destination = await target(), fetcher = remote(t, f, { respond: requested => requested === path ? new Response(corrupted) : null });
  await assert.rejects(restorePublishedRelease(BASE, destination, { fetcher }), /SHA256/);
  assert.deepEqual(await readFile(resolve(destination, path)), corrupted); assert.equal((await failureEvidence(destination)).requestedPath, path);
});

test('streamed files append all chunks, while an undeclared extra byte stops at the manifest size', async t => {
  for (const oversized of [false, true]) {
    const f = fixture(), path = `${f.prefix}/src/main.js`, bytes = f.entries.get(path), destination = await target();
    const fetcher = remote(t, f, { respond: requested => requested === path ? new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, 5)); controller.enqueue(bytes.subarray(5)); if (oversized) controller.enqueue(Buffer.from('!')); controller.close(); } })) : null });
    if (oversized) { await assert.rejects(restorePublishedRelease(BASE, destination, { fetcher }), /超出大小预算/); await failureEvidence(destination); }
    else assert.equal((await restorePublishedRelease(BASE, destination, { fetcher })).status, 'restored');
    assert.deepEqual(await readFile(resolve(destination, path)), bytes);
  }
});

test('network failures and unavailable retained metadata fail explicitly while an ordinary absent predecessor is allowed', async t => {
  for (const mode of ['network', 'metadata']) {
    const f = fixture(), destination = await target(), fetcher = remote(t, f, { respond: path => { if (mode === 'network' && path === 'index.html') throw new Error('network offline'); if (mode === 'metadata' && path === 'retained-release.json') return new Response('denied', { status: 403 }); return null; } });
    await assert.rejects(restorePublishedRelease(BASE, destination, { fetcher }), /network offline|HTTP 403/);
    assert.deepEqual(await readFile(resolve(destination, 'release.json')), f.entries.get('release.json')); await failureEvidence(destination);
  }
});

test('metadata length headers and streamed bodies have hard limits and leave bounded failure evidence', async t => {
  for (const withLength of [true, false]) {
    const payload = Buffer.alloc(64 * 1024 + 1, 120), destination = await target();
    const response = new Response(payload, { headers: withLength ? { 'Content-Length': String(payload.length) } : {} });
    const fetcher = t.mock.fn(async () => response);
    await assert.rejects(restorePublishedRelease(BASE, destination, { fetcher }), /预算/); assert.equal(fetcher.mock.callCount(), 1);
    if (!withLength) assert.equal((await readFile(resolve(destination, 'release.json'))).length, 64 * 1024);
    await failureEvidence(destination);
  }
});

test('declared oversized files, too many files and aggregate retained payloads are rejected before payload requests', async t => {
  for (const kind of ['asset', 'count', 'aggregate']) {
    const f = kind === 'aggregate' ? withPrevious(fixture(2), fixture(1)) : fixture();
    let budgets = { ...RELEASE_BUDGETS };
    if (kind === 'asset') budgets.assetBytes = 1;
    if (kind === 'count') budgets.files = 1;
    if (kind === 'aggregate') budgets.totalBytes = [...f.entries.values()].reduce((sum, bytes) => sum + bytes.length, 0) - 1;
    const destination = await target(), fetcher = remote(t, f);
    await assert.rejects(restorePublishedRelease(BASE, destination, { fetcher, budgets }), /预算|数量/);
    assert.equal(fetcher.mock.calls.some(call => call.arguments[0].includes('/releases/')), false); await failureEvidence(destination);
  }
});

test('a coherent remote manifest still must pass the shared runtime/provenance preflight', async t => {
  for (const f of [fixture(1, { main: 'import "https://evil.test/external.js";' }), fixture(1, { mutateReport: report => { report.records[0].sourceSha256 = 'invalid'; } })]) {
    const destination = await target(), fetcher = remote(t, f);
    await assert.rejects(restorePublishedRelease(BASE, destination, { fetcher }), /外部地址|来源摘要/); await failureEvidence(destination);
    assert.ok(fetcher.mock.calls.every(call => call.arguments[0].startsWith(BASE)));
  }
});

test('existing destinations and destinations outside temporary content are never overwritten', async t => {
  const f = fixture(), destination = await target(); await mkdir(destination); await writeFile(resolve(destination, 'owner.txt'), 'previous evidence');
  const fetcher = remote(t, f);
  await assert.rejects(restorePublishedRelease(BASE, destination, { fetcher }), { code: 'EEXIST' });
  assert.equal(await readFile(resolve(destination, 'owner.txt'), 'utf8'), 'previous evidence');
  await assert.rejects(restorePublishedRelease(BASE, resolve(LOCAL_ROOT, 'outside-temp'), { fetcher }), /新的?文件夹|内的新文件夹/);
  assert.equal(fetcher.mock.callCount(), 0);
});
