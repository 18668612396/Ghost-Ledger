import { readdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { compileContent } from './compile-content.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
await compileContent(root);
for (const filename of ['index.html', 'src/main.js', 'src/engine.js', 'src/style.css', 'src/runtime/game.js', 'public/assets/ref-scene.png']) await access(resolve(root, filename));
async function checkDirectory(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory()) await checkDirectory(resolve(path, entry.name));
    else if (/\.m?js$/.test(entry.name)) execFileSync(process.execPath, ['--check', resolve(path, entry.name)], { stdio: 'inherit' });
  }
}
for (const directory of ['src', 'scripts', 'tests']) {
  await checkDirectory(resolve(root, directory));
}
const { checkArt } = await import('./check-art.mjs');
await checkArt(root);
console.log('入口、全部模块语法及游戏美术资源检查通过。');
