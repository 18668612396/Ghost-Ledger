import { cp, mkdir, rename, access } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
execFileSync(process.execPath, [resolve(root, 'scripts/check.mjs')], { stdio: 'inherit' });
// Build into an empty directory, then archive the previous output. Never merge
// over dist: a removed runtime or bitmap must not survive in a release.
const stamp = `${Date.now()}`;
function inside(path) {
  const resolved = resolve(root, path), fromRoot = relative(root, resolved);
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) throw new Error('构建路径必须位于本游戏目录内。');
  return resolved;
}
const staging = inside(`.local/temp/build-${stamp}`), destination = inside('dist');
await mkdir(staging, { recursive: true });
for (const entry of ['index.html', 'src', 'public']) await cp(resolve(root, entry), resolve(staging, entry), { recursive: true });
let exists = true;
try { await access(destination); } catch { exists = false; }
if (exists) await rename(destination, inside(`.local/temp/dist-${stamp}`));
await rename(staging, destination);
console.log('独立静态构建已生成至 ghost-ledger/dist/。');
