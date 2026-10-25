import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { TABLE_FILES, indexContentTables, contentProblems, compileContent } from '../compile-content.mjs';
import { GAME_ROOT, LOCAL_ROOT } from '../paths.mjs';

export class EditorError extends Error {
  constructor(status, code, message, errors = []) {
    super(message); this.status = status; this.code = code; this.errors = errors;
  }
}
const digest = value => createHash('sha256').update(value).digest('hex');
const contentRevision = tables => {
  try { return digest(JSON.stringify(indexContentTables(tables))).slice(0, 20); }
  catch { return null; }
};
function inside(root, path) {
  const target = resolve(root, path), fromRoot = relative(root, target);
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) throw new Error('配置工具路径超出指定目录。');
  return target;
}
function checkedTables(tables) {
  try { return indexContentTables(tables); }
  catch (error) { throw new EditorError(422, 'invalid_content', '配置校验未通过，源表未修改。', [error.message]); }
}

export function createContentStore({ gameRoot = GAME_ROOT, localRoot = LOCAL_ROOT } = {}) {
  gameRoot = resolve(gameRoot); localRoot = resolve(localRoot);
  let tail = Promise.resolve();
  const serial = work => {
    const next = tail.then(work, work);
    tail = next.catch(() => {});
    return next;
  };
  async function readCurrent() {
    const tables = {}, raw = {};
    for (const [table, file] of Object.entries(TABLE_FILES)) {
      try {
        raw[table] = await readFile(inside(gameRoot, `content/${file}`));
        tables[table] = JSON.parse(raw[table].toString('utf8').replace(/^\uFEFF/, ''));
      } catch (error) {
        throw new EditorError(422, 'source_unreadable', `无法读取 game/content/${file}。`, [error.message]);
      }
    }
    const revision = digest(Buffer.concat(Object.entries(TABLE_FILES).flatMap(([table, file]) => [Buffer.from(file + '\0'), raw[table], Buffer.from('\0')])));
    return { tables, raw, revision, contentRevision: contentRevision(tables) };
  }
  async function assets() {
    const manifest = JSON.parse(await readFile(inside(gameRoot, 'public/assets/art-manifest.json'), 'utf8'));
    return manifest.assets.map(asset => ({ id: asset.filename.replace(/\.png$/i, ''), filename: asset.filename, purpose: asset.purpose }));
  }
  async function publicSnapshot(snapshot) {
    const { raw, ...result } = snapshot;
    return { ...result, assets: await assets() };
  }
  async function validate(tables) {
    let content;
    try { content = checkedTables(tables); }
    catch (error) { return { valid: false, errors: error.errors, contentRevision: null, counts: {} }; }
    const errors = await contentProblems(content, gameRoot);
    return { valid: errors.length === 0, errors, contentRevision: errors.length ? null : contentRevision(tables), counts: Object.fromEntries(Object.entries(content).map(([key, rows]) => [key, Object.keys(rows).length])) };
  }
  async function save({ tables, revision } = {}) {
    return serial(async () => {
      const current = await readCurrent();
      if (typeof revision !== 'string' || revision !== current.revision) throw new EditorError(409, 'source_conflict', '源表已被其他窗口或程序修改。草稿已保留，请先导出草稿或重新载入后合并。');
      const result = await validate(tables);
      if (!result.valid) throw new EditorError(422, 'invalid_content', '配置校验未通过，源表未修改。', result.errors);
      const changedTables = Object.keys(TABLE_FILES).filter(table => JSON.stringify(tables[table]) !== JSON.stringify(current.tables[table]));
      if (!changedTables.length) return { ...await publicSnapshot(current), changedTables, backupId: null };

      const tempRoot = inside(localRoot, 'temp/content-editor');
      await mkdir(tempRoot, { recursive: true });
      const staging = await mkdtemp(resolve(tempRoot, 'save-'));
      const stagedContent = inside(staging, 'content');
      await mkdir(stagedContent);
      for (const [table, file] of Object.entries(TABLE_FILES)) await writeFile(inside(stagedContent, file), JSON.stringify(tables[table], null, 2) + '\n', 'utf8');
      // The same compiler produces the candidate module before any real source is replaced.
      const compiled = await compileContent(staging, { assets: false, quiet: true });
      const latest = await readCurrent();
      if (latest.revision !== revision) throw new EditorError(409, 'source_conflict', '校验期间源表发生了变化。草稿已保留，未覆盖磁盘内容。');

      const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
      const backupRoot = inside(tempRoot, `backups/${id}`);
      await mkdir(backupRoot, { recursive: true });
      const generated = inside(gameRoot, 'src/generated/content-data.js');
      let oldGenerated = null;
      try { oldGenerated = await readFile(generated); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      for (const table of changedTables) await writeFile(inside(backupRoot, TABLE_FILES[table]), current.raw[table]);
      if (oldGenerated !== null) await writeFile(inside(backupRoot, 'content-data.js'), oldGenerated);
      await writeFile(inside(backupRoot, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), revision, contentRevision: compiled.revision, changedTables, generatedPreviouslyExisted: oldGenerated !== null }, null, 2) + '\n');

      const committed = [];
      try {
        for (const table of changedTables) {
          const destination = inside(gameRoot, `content/${TABLE_FILES[table]}`);
          await rename(inside(stagedContent, TABLE_FILES[table]), destination);
          committed.push({ destination, previous: current.raw[table] });
        }
        await mkdir(inside(gameRoot, 'src/generated'), { recursive: true });
        await rename(inside(staging, 'src/generated/content-data.js'), generated);
        committed.push({ destination: generated, previous: oldGenerated });
      } catch (error) {
        const rollbackErrors = [];
        for (const [index, entry] of committed.reverse().entries()) {
          try {
            if (entry.previous === null) await unlink(entry.destination);
            else {
              const rollbackPath = inside(staging, `rollback-${index}`);
              await writeFile(rollbackPath, entry.previous);
              await rename(rollbackPath, entry.destination);
            }
          } catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
        }
        throw new EditorError(500, 'save_failed', rollbackErrors.length ? `保存中断且部分回滚失败，请使用备份 ${relative(localRoot, backupRoot)} 恢复。` : '保存中断，已恢复原文件。请重试。', [error.message, ...rollbackErrors]);
      }
      return { ...await publicSnapshot(await readCurrent()), changedTables, backupId: relative(localRoot, backupRoot).replaceAll('\\', '/') };
    });
  }
  return { load: () => serial(async () => publicSnapshot(await readCurrent())), validate, save };
}
