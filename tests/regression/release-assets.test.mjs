import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { optimizeAssetBytes, assetEncodingProfile } from '../../tools/optimize-assets.mjs';
import { rewriteReleaseSource, verifyReleaseReferences, localOutputPath, applyReleaseCsp, RELEASE_CSP } from '../../tools/build.mjs';
import { resolveAssetUrl, hasBundledAsset } from '../../game/src/asset-url.js';
import { SKIN_DATA } from '../../game/src/skin-data.js';
import { LOCAL_ROOT } from '../../tools/paths.mjs';

async function temporary() {
  await mkdir(resolve(LOCAL_ROOT, 'temp'), { recursive: true });
  return mkdtemp(resolve(LOCAL_ROOT, 'temp/release-assets-test-'));
}

test('release illustrations retain the full square canvas, transparency and source bytes at the display pixel budget', async () => {
  const input = await sharp({ create: { width: 1254, height: 1254, channels: 4, background: { r: 80, g: 150, b: 120, alpha: .5 } } }).png().toBuffer();
  const original = Buffer.from(input), output = await optimizeAssetBytes('card-art-unique-check.png', input);
  assert.equal(output.width, 1024); assert.equal(output.height, 1024); assert.equal(output.hasAlpha, true);
  assert.deepEqual(input, original);
  const alpha = await sharp(output.bytes).ensureAlpha().extractChannel(3).raw().toBuffer();
  assert.ok(alpha.every(value => value === 128));
});

test('sprite atlases and UI crop dimensions remain exact and a lossless crop preserves alpha', async () => {
  for (const source of [...SKIN_DATA.sources, ...SKIN_DATA.assets]) {
    const profile = assetEncodingProfile(source.filename, { width: source.size[0], height: source.size[1] });
    assert.equal(profile.width, source.size[0], source.filename);
    assert.equal(profile.height, source.size[1], source.filename);
  }
  const pixels = Buffer.from(Array.from({ length: 16 * 9 }, (_, i) => [50, 110, 170, [0, 80, 170, 255][i % 4]]).flat());
  const png = await sharp(pixels, { raw: { width: 16, height: 9, channels: 4 } }).png().toBuffer();
  const optimized = await optimizeAssetBytes('ref-scroll-test.png', png);
  const raw = await sharp(optimized.bytes).ensureAlpha().raw().toBuffer();
  assert.deepEqual(raw.filter((_, index) => index % 4 === 3), pixels.filter((_, index) => index % 4 === 3));
  assert.equal(optimized.width, 16); assert.equal(optimized.height, 9);
});

test('the same source and encoder profile produce identical encoded bytes without timestamps', async () => {
  const input = await sharp({ create: { width: 80, height: 80, channels: 4, background: { r: 99, g: 50, b: 120, alpha: .7 } } }).png().toBuffer();
  const first = await optimizeAssetBytes('card-art-unique-repeat.png', input), second = await optimizeAssetBytes('card-art-unique-repeat.png', input);
  assert.deepEqual(first.bytes, second.bytes); assert.equal(first.sha256, second.sha256);
});

test('release asset lookup resolves version-local files and rejects missing art instead of sharing another card image', async () => {
  assert.match(resolveAssetUrl('card-art-unique-check'), /public\/assets\/card-art-unique-check\.png$/);
  assert.equal(hasBundledAsset('../outside'), false);
  assert.throws(() => resolveAssetUrl('../outside'), /标识无效/);
  const root = await temporary(), src = resolve(root, 'src'); await mkdir(src);
  await writeFile(resolve(src, 'asset-url.js'), await readFile(new URL('../../game/src/asset-url.js', import.meta.url)));
  await writeFile(resolve(src, 'build-info.js'), 'export const BUILD_INFO = {releaseId:"test-release",assets:{"card-art-a":"card-art-a.abcdef.webp"}};');
  const runtime = await import(`${pathToFileURL(resolve(src, 'asset-url.js')).href}?release-test`);
  assert.equal(runtime.resolveAssetUrl('card-art-a.png'), new URL('../public/assets/card-art-a.abcdef.webp', pathToFileURL(resolve(src, 'asset-url.js'))).href);
  assert.equal(runtime.hasBundledAsset('card-art-missing'), false);
  assert.throws(() => runtime.resolveAssetUrl('card-art-missing'), /不包含素材/);
});

test('CSS, skin slices and effect fallback use the same hashed resource manifest', () => {
  const assets = { 'ref-icons': 'ref-icons.aa.webp' };
  assert.match(rewriteReleaseSource('.icon {background:url("../public/assets/ref-icons.png")}', 'src/style.css', assets), /ref-icons\.aa\.webp/);
  assert.throws(() => rewriteReleaseSource('.icon {background:url("../public/assets/not-bundled.png")}', 'src/style.css', assets), /未打包素材/);
  const skin = rewriteReleaseSource('const path = new URL(`../public/assets/${filename}`, import.meta.url).href;', 'src/skins.js', assets);
  assert.match(skin, /resolveAssetUrl\(filename\)/); assert.match(skin, /from '\.\/asset-url\.js'/);
  const effect = rewriteReleaseSource('const url = new URL(`../../public/assets/${name}.png`, import.meta.url).href;', 'src/presentation/effects.js', assets);
  assert.match(effect, /resolveAssetUrl\(name\)/); assert.match(effect, /from '\.\.\/asset-url\.js'/);
});

test('the release verifier checks nested module graphs and repository subpath asset references', async () => {
  const root = await temporary();
  const files = { 'index.html': '<link href="./releases/test/src/style.css" rel="stylesheet"><script src="./releases/test/src/main.js" type="module"></script>', 'releases/test/src/main.js': 'import {name} from "./shared.js";', 'releases/test/src/shared.js': 'export const name="ledger";', 'releases/test/src/style.css': '.icon{background:url("../public/assets/icon.hash.webp")}', 'releases/test/public/assets/icon.hash.webp': 'fixture' };
  for (const [file, bytes] of Object.entries(files)) { await mkdir(resolve(root, file, '..'), { recursive: true }); await writeFile(resolve(root, file), bytes); }
  assert.equal((await verifyReleaseReferences(root)).referencesValid, true);
  const remote = new URL('./releases/test/src/style.css', 'https://example.test/Ghost-Ledger/');
  assert.equal(new URL('../public/assets/icon.hash.webp', remote).pathname, '/Ghost-Ledger/releases/test/public/assets/icon.hash.webp');
  await writeFile(resolve(root, 'releases/test/src/main.js'), 'import "./missing.js";');
  await assert.rejects(verifyReleaseReferences(root), /missing\.js/);
  assert.throws(() => localOutputPath(resolve(LOCAL_ROOT, '..')), /\.local/);
});

test('the production entry gets its restrictive CSP before styles and modules while inline layout remains allowed', async () => {
  const source = await readFile(new URL('../../game/index.html', import.meta.url), 'utf8');
  const html = applyReleaseCsp(source);
  const match = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"\s*\/?>/);
  assert.ok(match); assert.equal(match[1], RELEASE_CSP);
  assert.ok(match.index < html.indexOf('<link'));
  assert.ok(match.index < html.indexOf('<script'));
  const directives = new Map(match[1].split('; ').map(value => { const [name, ...sources] = value.split(' '); return [name, sources]; }));
  for (const directive of ['default-src', 'script-src', 'img-src', 'font-src', 'media-src', 'connect-src', 'manifest-src', 'base-uri']) assert.deepEqual(directives.get(directive), ["'self'"], directive);
  for (const directive of ['script-src-attr', 'form-action', 'object-src', 'frame-src', 'worker-src']) assert.deepEqual(directives.get(directive), ["'none'"], directive);
  assert.deepEqual(directives.get('style-src'), ["'self'", "'unsafe-inline'"]);
  assert.ok(!directives.has('frame-ancestors'), 'meta cannot enforce frame-ancestors');
  assert.doesNotMatch(directives.get('script-src').join(' '), /unsafe-inline|unsafe-eval|data:|blob:|\*/);
  assert.equal(applyReleaseCsp(html), html);
  assert.equal(await readFile(new URL('../../game/index.html', import.meta.url), 'utf8'), source);
});

test('release CSP rejects duplicate, weakened and late policies rather than silently shipping them', () => {
  const canonical = `<meta http-equiv="Content-Security-Policy" content="${RELEASE_CSP}">`;
  const wrap = head => `<!doctype html><html><head><meta charset="UTF-8">${head}</head><body></body></html>`;
  assert.throws(() => applyReleaseCsp(wrap(canonical.repeat(2))), /一份/);
  assert.throws(() => applyReleaseCsp(wrap(canonical.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"))), /策略不一致/);
  assert.throws(() => applyReleaseCsp(wrap(`<script src="./entry.js"></script>${canonical}`)), /资源标签之前/);
  assert.throws(() => applyReleaseCsp('<head><link rel="stylesheet" href="./style.css"><meta charset="utf-8"></head>'), /资源标签之前/);
  const exampleOnly = wrap(`<!-- ${canonical} --><title>${canonical}</title>`);
  assert.equal((applyReleaseCsp(exampleOnly).match(/http-equiv="Content-Security-Policy"/g) || []).length, 3, 'comments and title text do not substitute for the real policy');
  assert.throws(() => applyReleaseCsp(wrap(`<template><template></template>${canonical}</template>`)), /资源标签之前/);
  assert.throws(() => applyReleaseCsp('<html><body>missing head</body></html>'), /head/);
  assert.throws(() => applyReleaseCsp('<head><script src="./entry.js"></script></head>'), /charset/);
});
