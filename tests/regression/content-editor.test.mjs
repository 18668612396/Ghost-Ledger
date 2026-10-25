import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { join, relative } from 'node:path';
import { createContentStore } from '../../tools/content-editor/store.mjs';
import { createEditorServer } from '../../tools/content-editor/server.mjs';
import { compileContent, readContent, TABLE_FILES } from '../../tools/compile-content.mjs';
import { GAME_ROOT, LOCAL_ROOT } from '../../tools/paths.mjs';

const clone = value => structuredClone(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const tableNames = Object.keys(TABLE_FILES);
const generatedFile = 'src/generated/content-data.js';

async function snapshot(gameRoot, includeGenerated = true) {
  const files = tableNames.map(table => `content/${TABLE_FILES[table]}`);
  if (includeGenerated) files.push(generatedFile);
  return Object.fromEntries(await Promise.all(files.map(async file => {
    const path = join(gameRoot, file), bytes = await readFile(path), info = await stat(path);
    return [file, { hash: digest(bytes), mtimeMs: info.mtimeMs }];
  })));
}
async function bytesSnapshot(gameRoot) {
  return Object.fromEntries(await Promise.all(tableNames.map(async table => [table, await readFile(join(gameRoot, 'content', TABLE_FILES[table]))])));
}
async function filesBelow(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(path));
    else result.push(path);
  }
  return result;
}
const statusOf = error => error?.status ?? error?.statusCode;
async function rejectsStatus(promise, expected) {
  await assert.rejects(promise, error => {
    assert.equal(statusOf(error), expected, error?.stack || String(error));
    return true;
  });
}

test('content editor persists isolated authored tables and protects source revisions', { concurrency: false }, async t => {
  const untouchedGame = await snapshot(GAME_ROOT, false);
  const fixtureParent = join(LOCAL_ROOT, 'temp');
  await mkdir(fixtureParent, { recursive: true });
  const fixtureRoot = await mkdtemp(join(fixtureParent, 'content-editor-tests-'));
  const gameRoot = join(fixtureRoot, 'game'), localRoot = join(fixtureRoot, '.local');
  await mkdir(gameRoot, { recursive: true });
  await cp(join(GAME_ROOT, 'content'), join(gameRoot, 'content'), { recursive: true });
  await cp(join(GAME_ROOT, 'src'), join(gameRoot, 'src'), { recursive: true });
  await cp(join(GAME_ROOT, 'public/assets'), join(gameRoot, 'public/assets'), { recursive: true });
  await compileContent(gameRoot, { quiet: true });
  const store = await createContentStore({ gameRoot, localRoot });
  t.after(async () => {
    assert.deepEqual(await snapshot(GAME_ROOT, false), untouchedGame, 'Editor tests must not write the real game/content tables');
  });
  t.diagnostic(`Retained isolated fixture: ${relative(LOCAL_ROOT, fixtureRoot)}`);

  await t.test('loads all seven source tables without dropping nested configuration', async () => {
    const loaded = await store.load();
    assert.deepEqual(Object.keys(loaded.tables).sort(), [...tableNames].sort());
    assert.equal(typeof loaded.revision, 'string');
    assert.equal(typeof loaded.contentRevision, 'string');
    assert.ok(loaded.assets.some(asset => asset.id === 'card-art-brush' && asset.filename === 'card-art-brush.png'));
    for (const table of tableNames) {
      const authored = JSON.parse(await readFile(join(gameRoot, 'content', TABLE_FILES[table]), 'utf8'));
      assert.deepEqual(loaded.tables[table], authored, `${table} lost authoring fields`);
    }
    assert.ok(loaded.tables.cards[0].source.reference);
    assert.ok(loaded.tables.enemies[0].ai.rules.length);
    assert.ok(loaded.tables.acts[0].map.fixedFloors);
  });

  await t.test('validating the current workspace does not rewrite sources or generated output', async () => {
    const loaded = await store.load(), before = await snapshot(gameRoot);
    const validation = await store.validate(clone(loaded.tables));
    assert.equal(validation.valid, true, validation.errors?.join('\n'));
    assert.deepEqual(validation.errors, []);
    assert.equal(validation.contentRevision, loaded.contentRevision);
    assert.deepEqual(await snapshot(gameRoot), before);
  });

  await t.test('an unchanged save preserves exact bytes and timestamps without creating a backup', async () => {
    const loaded = await store.load(), before = await snapshot(gameRoot);
    const saved = await store.save({ tables: clone(loaded.tables), revision: loaded.revision });
    assert.deepEqual(saved.changedTables, []);
    assert.equal(saved.backupId, null);
    assert.equal(saved.revision, loaded.revision);
    assert.deepEqual(await snapshot(gameRoot), before);
  });

  await t.test('saving cards, monsters and acts changes only those tables and retains recoverable originals', async () => {
    const sentinel = new Date('2001-01-01T00:00:00Z');
    for (const table of tableNames) await utimes(join(gameRoot, 'content', TABLE_FILES[table]), sentinel, sentinel);
    const loaded = await store.load(), before = await snapshot(gameRoot), originalBytes = await bytesSnapshot(gameRoot);
    const tables = clone(loaded.tables);
    tables.cards[0].name += '·编辑验收';
    tables.enemies[0].name += '·编辑验收';
    tables.enemies[0].hpRange = tables.enemies[0].hpRange.map(amount => amount + 1);
    tables.enemies[0].minHp += 1;
    tables.enemies[0].maxHp += 1;
    tables.acts[0].starting.gold += 7;
    const saved = await store.save({ tables, revision: loaded.revision });
    assert.deepEqual([...saved.changedTables].sort(), ['acts', 'cards', 'enemies']);
    assert.equal(typeof saved.backupId, 'string');
    assert.ok(saved.backupId.length);
    assert.notEqual(saved.revision, loaded.revision);
    assert.notEqual(saved.contentRevision, loaded.contentRevision);
    assert.deepEqual(saved.tables.cards[0], tables.cards[0]);
    assert.deepEqual(saved.tables.enemies[0], tables.enemies[0]);
    assert.deepEqual(saved.tables.acts[0], tables.acts[0]);
    const after = await snapshot(gameRoot);
    for (const table of ['powers', 'encounters', 'events', 'visuals']) {
      const path = `content/${TABLE_FILES[table]}`;
      assert.deepEqual(after[path], before[path], `${table} was rewritten despite being unchanged`);
    }
    const indexed = await readContent(gameRoot);
    const expectedRevision = digest(JSON.stringify(indexed)).slice(0, 20);
    const generated = await readFile(join(gameRoot, generatedFile), 'utf8');
    assert.equal(saved.contentRevision, expectedRevision);
    assert.ok(generated.includes(`CONTENT_REVISION = "${expectedRevision}"`));
    for (const table of ['cards', 'enemies', 'acts']) {
      assert.deepEqual(JSON.parse(await readFile(join(gameRoot, 'content', TABLE_FILES[table]), 'utf8')), tables[table]);
    }
    const backupFiles = await filesBelow(join(localRoot, 'temp/content-editor'));
    for (const table of ['cards', 'enemies', 'acts']) {
      let foundOriginal = false;
      for (const path of backupFiles.filter(path => path.endsWith(TABLE_FILES[table]))) {
        if ((await readFile(path)).equals(originalBytes[table])) foundOriginal = true;
      }
      assert.equal(foundOriginal, true, `Backup does not retain the exact original bytes for ${table}`);
    }
  });

  await t.test('invalid references, duplicates, unknown fields and missing PNGs never overwrite valid source files', async () => {
    const cases = [
      ['reference', tables => { tables.acts[0].starting.deck[0].cardId = 'editor_missing_card'; }],
      ['duplicate', tables => { tables.cards.push(clone(tables.cards[0])); }],
      ['unknown field', tables => { tables.cards[0].visual.editorTypo = true; }],
      ['missing asset', tables => { tables.cards[0].visual.icon = 'editor_missing_png'; }],
    ];
    for (const [name, mutate] of cases) {
      const loaded = await store.load(), before = await snapshot(gameRoot), tables = clone(loaded.tables);
      mutate(tables);
      const validation = await store.validate(tables);
      assert.equal(validation.valid, false, name);
      assert.ok(validation.errors.length, `${name} did not return diagnostics`);
      await rejectsStatus(store.save({ tables, revision: loaded.revision }), 422);
      assert.deepEqual(await snapshot(gameRoot), before, `${name} changed source or generated bytes`);
    }
  });

  await t.test('format-only external edits invalidate the source revision without changing content identity', async () => {
    const loaded = await store.load(), path = join(gameRoot, 'content/cards.json');
    await writeFile(path, (await readFile(path, 'utf8')) + '\n', 'utf8');
    const externallyEdited = await snapshot(gameRoot), fresh = await store.load();
    assert.notEqual(fresh.revision, loaded.revision);
    assert.equal(fresh.contentRevision, loaded.contentRevision);
    const staleDraft = clone(loaded.tables); staleDraft.cards[0].name += '·过期草稿';
    await rejectsStatus(store.save({ tables: staleDraft, revision: loaded.revision }), 409);
    assert.deepEqual(await snapshot(gameRoot), externallyEdited, 'Stale draft overwrote an external formatting edit');
  });

  await t.test('two simultaneous saves using one source revision cannot overwrite each other', async () => {
    const loaded = await store.load(), first = clone(loaded.tables), second = clone(loaded.tables);
    first.cards[0].name += '·并发甲'; second.cards[0].name += '·并发乙';
    const results = await Promise.allSettled([
      store.save({ tables: first, revision: loaded.revision }),
      store.save({ tables: second, revision: loaded.revision }),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = results.find(result => result.status === 'rejected');
    assert.equal(statusOf(rejected.reason), 409);
    const current = await store.load();
    assert.ok([first.cards[0].name, second.cards[0].name].includes(current.tables.cards[0].name));
  });

  await t.test('HTTP editing requires the session token and same-origin request, then genuinely persists', async () => {
    const { server } = await createEditorServer({ gameRoot, localRoot });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    try {
      const workspaceResponse = await fetch(base + '/api/workspace');
      assert.equal(workspaceResponse.status, 200);
      const workspace = await workspaceResponse.json();
      assert.equal(typeof workspace.writeToken, 'string'); assert.ok(workspace.writeToken.length);
      const tables = clone(workspace.tables); tables.cards[0].name += '·HTTP验收';
      const payload = { tables, revision: workspace.revision }, before = await snapshot(gameRoot);
      for (const headers of [
        { Origin: base },
        { Origin: base, 'X-Editor-Token': 'wrong-session-token' },
        { Origin: 'https://foreign.example', 'X-Editor-Token': workspace.writeToken },
        { 'X-Editor-Token': workspace.writeToken },
      ]) {
        const denied = await request('/api/save', payload, headers);
        assert.equal(denied.status, 403);
        const error = await denied.json(); assert.ok(error.error || error.message);
      }
      assert.deepEqual(await snapshot(gameRoot), before);
      const headers = { Origin: base, 'X-Editor-Token': workspace.writeToken };
      const validation = await request('/api/validate', { tables }, headers);
      assert.equal(validation.status, 200);
      assert.equal((await validation.json()).valid, true);
      const savedResponse = await request('/api/save', payload, headers);
      assert.equal(savedResponse.status, 200);
      const saved = await savedResponse.json();
      assert.deepEqual(saved.changedTables, ['cards']);
      assert.equal(saved.tables.cards[0].name, tables.cards[0].name);
      assert.notEqual(saved.revision, workspace.revision);
      assert.equal(JSON.parse(await readFile(join(gameRoot, 'content/cards.json'), 'utf8'))[0].name, tables.cards[0].name);
      const stale = await request('/api/save', payload, headers);
      assert.equal(stale.status, 409);
      const malformed = await fetch(base + '/api/save', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{broken' });
      assert.equal(malformed.status, 400);
    } finally {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  await t.test('HTTP serves editor, current artwork and shared browser modules without exposing repository internals', async () => {
    const { server } = await createEditorServer({ gameRoot, localRoot });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const home = await fetch(base + '/'); assert.equal(home.status, 200); assert.match(await home.text(), /<!doctype html>/i);
      const asset = await fetch(base + '/assets/card-art-brush.png'); assert.equal(asset.status, 200);
      assert.deepEqual(Buffer.from(await asset.arrayBuffer()), await readFile(join(gameRoot, 'public/assets/card-art-brush.png')));
      const module = await fetch(base + '/game/src/runtime/content-schema.js'); assert.equal(module.status, 200); assert.match(await module.text(), /export function validateContent/);
      for (const path of ['/.git/config', '/.local/tests/content-editor.test.mjs', '/tools/paths.mjs', '/game/content/cards.json', '/assets/../.local/sources.json', '/assets/%2e%2e%2f%2e%2e%2fpackage.json', '/unknown-editor-file']) {
        const response = await fetch(base + path); assert.equal(response.status, 404, path); await response.arrayBuffer();
      }
    } finally {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
