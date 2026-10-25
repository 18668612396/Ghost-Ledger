import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readContentTables } from '../../tools/compile-content.mjs';
import { REPO_ROOT } from '../../tools/paths.mjs';

// Item previews need element creation only. The browser owns layout and image loading;
// this small DOM surface lets the same preview module execute its actual rule samples.
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.attributes = {}; this.value = ''; this.text = ''; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent ?? String(child)).join(' '); }
  append(...children) { this.children.push(...children); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener() {}
  replaceChildren(...children) { this.text = ''; this.children = [...children]; }
}
function errors(node) { return [node, ...node.children.flatMap(child => child instanceof Element ? errors(child) : [])].filter(item => item.className === 'field-error'); }

test('all authored items render real-rule editor previews without changing drafts', async () => {
  const tables = await readContentTables(), before = structuredClone(tables);
  const source = (await readFile(join(REPO_ROOT, 'tools/content-editor/public/previews.js'), 'utf8'))
    .replace(/from (['"])(\/game\/src\/[^'"]+)\1/g, (_, quote, path) => `from ${JSON.stringify(pathToFileURL(join(REPO_ROOT, path.slice(1))).href)}`);
  const { renderRecordPreview } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag) };
  try {
    const previews = {};
    for (const table of ['relics', 'potions']) for (const record of tables[table]) {
      const preview = renderRecordPreview({ table, record, tables });
      assert.deepEqual(errors(preview).map(node => node.textContent), [], `${table}/${record.id}`);
      assert.ok(!preview.textContent.includes('undefined'), `${record.id} has an unresolved label`);
      previews[record.id] = preview.textContent;
    }
    assert.match(previews.bell, /护甲 6/);
    assert.match(previews.vajra, /力量 1/);
    assert.match(previews.bag, /手牌 7/);
    assert.match(previews.healing, /使用后：生命 70\/80/);
    assert.match(previews.block, /使用后：生命 50\/80 · 护甲 12/);
    assert.match(previews.fire, /敌人原生命：/); assert.match(previews.fire, /敌人现生命：/);
    assert.match(previews.weak, /虚弱 3/);
    const invalid = { ...tables.potions[0], usablePhases: [] };
    const broken = renderRecordPreview({ table: 'potions', record: invalid, tables });
    assert.equal(errors(broken).length, 1); assert.match(broken.textContent, /当前草稿无法预览/);
    assert.deepEqual(tables, before);
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});
