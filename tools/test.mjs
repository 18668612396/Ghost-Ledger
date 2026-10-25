import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileContent } from './compile-content.mjs';
import { REPO_ROOT, TEST_ROOT } from './paths.mjs';

let files = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.name.endsWith('.test.mjs')) files.push(path);
  }
}
try {
  await collect(TEST_ROOT); files.sort();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (!files.length) {
  console.error('未找到 tests/**/*.test.mjs。正式回归必须随仓库分发，不能将缺少测试视为通过。');
  process.exitCode = 1;
} else {
  await compileContent();
  const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { cwd: REPO_ROOT, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
