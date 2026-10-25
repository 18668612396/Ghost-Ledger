import { cp, mkdir, rename, access } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT, GAME_ROOT, LOCAL_ROOT } from './paths.mjs';

execFileSync(process.execPath, [resolve(REPO_ROOT, 'tools/check.mjs')], { stdio: 'inherit' });
// Build into an empty directory, then archive the previous output. Never merge
// over dist: a removed runtime or bitmap must not survive in a release.
const stamp = `${Date.now()}`;
function inside(path) {
  const resolved = resolve(LOCAL_ROOT, path), fromRoot = relative(LOCAL_ROOT, resolved);
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) throw new Error('构建路径必须位于仓库 .local/ 目录内。');
  return resolved;
}
const staging = inside(`temp/build-${stamp}`), destination = inside('dist');
await mkdir(staging, { recursive: true });
for (const entry of ['index.html', 'src', 'public']) await cp(resolve(GAME_ROOT, entry), resolve(staging, entry), { recursive: true });
let exists = true;
try { await access(destination); } catch { exists = false; }
if (exists) await rename(destination, inside(`temp/dist-${stamp}`));
await rename(staging, destination);
console.log('独立静态构建已生成至 .local/dist/。');
