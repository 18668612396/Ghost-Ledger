import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, symlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createContentStore } from '../../tools/content-editor/store.mjs';
import { readContent, readContentTables, TABLE_FILES } from '../../tools/compile-content.mjs';
import { GAME_ROOT, LOCAL_ROOT } from '../../tools/paths.mjs';

test('item editor validates, saves, compiles and backs up isolated source tables', async t => {
  const authoredBefore = await readContentTables();
  const tempRoot = join(LOCAL_ROOT, 'temp'); await mkdir(tempRoot, { recursive: true });
  const fixture = await mkdtemp(join(tempRoot, 'configured-items-editor-'));
  const gameRoot = join(fixture, 'game'), localRoot = join(fixture, '.local');
  await mkdir(join(gameRoot, 'public'), { recursive: true });
  await mkdir(join(gameRoot, 'src/generated'), { recursive: true });
  await cp(join(GAME_ROOT, 'content'), join(gameRoot, 'content'), { recursive: true });
  await cp(join(GAME_ROOT, 'src/generated/content-data.js'), join(gameRoot, 'src/generated/content-data.js'));
  // The editor reads art to validate it; saving only writes fixture content and generated output.
  await symlink(join(GAME_ROOT, 'public/assets'), join(gameRoot, 'public/assets'), 'junction');
  t.after(async () => assert.deepEqual(await readContentTables(), authoredBefore, 'The editor fixture must not write real authored tables'));
  t.diagnostic(`保留隔离夹具：${relative(LOCAL_ROOT, fixture)}`);
  const store = createContentStore({ gameRoot, localRoot });
  const original = await store.load(), tables = structuredClone(original.tables);
  assert.deepEqual(Object.keys(tables).sort(), Object.keys(TABLE_FILES).sort());
  assert.equal(tables.relics.length, 8); assert.equal(tables.potions.length, 4);
  const beforeRelics = await readFile(join(gameRoot, 'content/relics.json'));
  const beforePotions = await readFile(join(gameRoot, 'content/potions.json'));
  const beforeGenerated = await readFile(join(gameRoot, 'src/generated/content-data.js'));
  const lamp = tables.relics.find(row => row.id === 'lamp'); lamp.triggers[0].effects[0].amount = 9;
  lamp.description = '每回合首次实际偿还阴债，获得9点护甲。';
  const fire = tables.potions.find(row => row.id === 'fire'); fire.price = 55; fire.effects[0].amount = 17;
  fire.description = '对一名敌人造成17点伤害。';
  assert.equal((await store.validate(tables)).valid, true);
  const saved = await store.save({ tables, revision: original.revision });
  assert.deepEqual(saved.changedTables.sort(), ['potions', 'relics']);
  assert.ok(saved.backupId); assert.notEqual(saved.contentRevision, original.contentRevision);
  const backupRoot = join(localRoot, saved.backupId);
  assert.deepEqual(await readFile(join(backupRoot, 'relics.json')), beforeRelics);
  assert.deepEqual(await readFile(join(backupRoot, 'potions.json')), beforePotions);
  assert.deepEqual(await readFile(join(backupRoot, 'content-data.js')), beforeGenerated);
  const manifest = JSON.parse(await readFile(join(backupRoot, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.changedTables.sort(), ['potions', 'relics']);
  const compiled = await import(pathToFileURL(join(gameRoot, 'src/generated/content-data.js')).href);
  const content = await readContent(gameRoot);
  assert.deepEqual(compiled.CONTENT, content); assert.equal(compiled.CONTENT_REVISION, saved.contentRevision);
  assert.equal(content.relics.lamp.triggers[0].effects[0].amount, 9);
  assert.equal(content.potions.fire.price, 55); assert.equal(content.potions.fire.effects[0].amount, 17);
  const backupIds = await readdir(join(localRoot, 'temp/content-editor/backups'));

  for (const mutate of [
    draft => { draft.relics.find(row => row.id === 'bell').starter.unlockId = 'missing-achievement'; },
    draft => { draft.potions[0].effects = [{ op: 'relic', id: 'missing-relic' }]; },
    draft => { draft.potions.find(row => row.id === 'fire').usablePhases = ['map']; },
  ]) {
    const bad = structuredClone(saved.tables); mutate(bad);
    const result = await store.validate(bad); assert.equal(result.valid, false); assert.ok(result.errors.length);
    await assert.rejects(store.save({ tables: bad, revision: saved.revision }), error => error.status === 422);
    assert.deepEqual((await store.load()).tables, saved.tables);
  }
  assert.deepEqual(await readdir(join(localRoot, 'temp/content-editor/backups')), backupIds, 'Rejected drafts must not create a successful-save backup');
  await assert.rejects(store.save({ tables, revision: original.revision }), error => error.status === 409);
});
