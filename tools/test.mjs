import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileContent } from './compile-content.mjs';
import { REPO_ROOT, TEST_ROOT } from './paths.mjs';

let files = [];
try {
  files = (await readdir(TEST_ROOT, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.test.mjs'))
    .map(entry => resolve(TEST_ROOT, entry.name)).sort();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (!files.length) {
  console.error('未找到 .local/tests/*.test.mjs。测试按项目约定由 Git 忽略；请先在本机恢复或添加测试文件，不能将缺少测试视为通过。');
  process.exitCode = 1;
} else {
  await compileContent();
  const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { cwd: REPO_ROOT, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
