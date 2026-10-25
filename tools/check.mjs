import { readdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { compileContent } from './compile-content.mjs';
import { REPO_ROOT, GAME_ROOT, TEST_ROOT } from './paths.mjs';

const root = GAME_ROOT;
await compileContent(root);
for (const filename of ['index.html', 'src/main.js', 'src/engine.js', 'src/style.css', 'src/runtime/game.js', 'public/assets/ref-scene.png']) await access(resolve(root, filename));
async function checkDirectory(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory()) await checkDirectory(resolve(path, entry.name));
    else if (/\.m?js$/.test(entry.name)) execFileSync(process.execPath, ['--check', resolve(path, entry.name)], { stdio: 'inherit' });
  }
}
for (const directory of [resolve(root, 'src'), resolve(REPO_ROOT, 'tools')]) await checkDirectory(directory);
// Local tests are intentionally ignored by Git and may be absent in a new checkout.
let hasLocalTests = true;
try { await access(TEST_ROOT); } catch (error) { if (error.code !== 'ENOENT') throw error; hasLocalTests = false; }
if (hasLocalTests) await checkDirectory(TEST_ROOT);
const { checkArt } = await import('./check-art.mjs');
await checkArt(root);
console.log('入口、全部模块语法及游戏美术资源检查通过。');
