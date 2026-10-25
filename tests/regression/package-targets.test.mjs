import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { listTargets, readTargetRegistry, checkTarget, collectCoreFiles, prepareTarget } from '../../tools/package-targets.mjs';
import { LOCAL_ROOT, GAME_ROOT } from '../../tools/paths.mjs';

async function fixture() {
  await mkdir(resolve(LOCAL_ROOT, 'temp'), { recursive: true });
  return mkdtemp(resolve(LOCAL_ROOT, 'temp/package-targets-test-'));
}

test('the registry keeps four isolated platform outputs and native/WeChat preparation honest', async () => {
  const targets = await listTargets();
  assert.deepEqual(targets.map(target => target.id), ['web', 'windows', 'android', 'wechat']);
  assert.equal(new Set(targets.map(target => target.output)).size, 4);
  assert.equal(targets.find(target => target.id === 'web').status, 'buildable');
  for (const target of targets.filter(target => target.id !== 'web')) {
    assert.equal(target.status, 'not-built'); assert.equal(target.nativeBinaryBuilt, false);
  }
  assert.equal(targets.find(target => target.id === 'wechat').renderer, 'canvas-required');
  assert.equal(targets.find(target => target.id === 'wechat').implementation, 'deferred');
  await assert.rejects(checkTarget('ios'), /未知打包平台/);
  await assert.rejects(prepareTarget('windows', { outputRoot: resolve(GAME_ROOT, 'unsafe-output'), validate: false }), /\.local/);
});

test('registry paths cannot move a prepared target outside its own distribution directory', async () => {
  const root = await fixture();
  const registry = await readTargetRegistry();
  registry.targets.windows.output = '.local/dist/web';
  await mkdir(resolve(root, 'targets'));
  await writeFile(resolve(root, 'targets/manifest.json'), JSON.stringify(registry));
  await assert.rejects(readTargetRegistry(root), /输出目录不正确/);
  registry.targets.windows.output = '.local/dist/windows';
  registry.targets.wechat.platform = 'game/src/../../outside.js';
  await writeFile(resolve(root, 'targets/manifest.json'), JSON.stringify(registry));
  await assert.rejects(readTargetRegistry(root), /不安全路径/);
});

test('native hosts embed the prepared web version with a limited capability surface', async () => {
  const config = JSON.parse(await readFile(resolve(GAME_ROOT, 'hosts/native-shell/tauri.conf.json'), 'utf8'));
  assert.equal(config.build.frontendDist, '../web');
  assert.equal(config.build.devUrl, undefined);
  assert.match(config.app.security.csp, /default-src 'self'/);
  assert.doesNotMatch(config.app.security.csp, /unsafe-eval|https?:\/\/\*/);
  const capability = JSON.parse(await readFile(resolve(GAME_ROOT, 'hosts/native-shell/capabilities/main.json'), 'utf8'));
  assert.deepEqual(capability.permissions, ['core:default']);
  assert.deepEqual(capability.windows, ['main']);
  const cli = JSON.parse(await readFile(resolve(GAME_ROOT, 'hosts/native-shell/package.json'), 'utf8'));
  assert.equal(cli.devDependencies['@tauri-apps/cli'], '2.12.4');
});

test('the shared dependency graph preserves rules and rejects DOM, Node and path escapes before packaging', async () => {
  const root = await fixture();
  await mkdir(resolve(root, 'runtime'));
  await writeFile(resolve(root, 'engine.js'), "export { transition } from './runtime/game.js';\n");
  await writeFile(resolve(root, 'runtime/game.js'), 'export const transition = state => structuredClone(state);\n');
  const graph = await collectCoreFiles(root, ['engine.js']);
  assert.deepEqual(graph.map(file => file.path), ['engine.js', 'runtime/game.js']);
  assert.ok(graph.every(file => /^[a-f0-9]{64}$/.test(file.sha256)));
  await writeFile(resolve(root, 'runtime/game.js'), 'export const transition = () => document.body;');
  await assert.rejects(collectCoreFiles(root, ['engine.js']), /浏览器依赖/);
  await writeFile(resolve(root, 'runtime/game.js'), "import { readFile } from 'node:fs';");
  await assert.rejects(collectCoreFiles(root, ['engine.js']), /外部依赖/);
  await writeFile(resolve(root, 'runtime/game.js'), "import '../../outside.js';");
  await assert.rejects(collectCoreFiles(root, ['engine.js']), /允许目录/);
});

test('the WeChat entry stops with a clear renderer error and does not bootstrap the browser app', async () => {
  const source = await readFile(resolve(GAME_ROOT, 'hosts/wechat/game.js'), 'utf8');
  assert.throws(() => vm.runInNewContext(source, {}), /Canvas 渲染器/);
  assert.doesNotMatch(source, /\b(?:document|window|require|import)\b/);
  const registry = await readTargetRegistry();
  const graph = await collectCoreFiles(resolve(GAME_ROOT, 'src'), [...registry.shared.coreEntries, registry.shared.platformContract, registry.targets.wechat.platform].map(path => path.slice('game/src/'.length)));
  assert.ok(graph.some(file => file.path === 'engine.js'));
  assert.ok(graph.some(file => file.path === 'platform/wechat.js'));
  assert.ok(graph.some(file => file.path === 'platform/contract.js'));
  assert.ok(graph.every(file => !/^(?:main\.js|presentation\/|platform\/(?:index|web)\.js)/.test(file.path)));
});
