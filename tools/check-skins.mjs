import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectRuntimeSource } from './check-art.mjs';
import { GAME_ROOT, REPO_ROOT } from './paths.mjs';

const projectRoot = GAME_ROOT;
const rootIndex = process.argv.indexOf('--root');
const root = rootIndex >= 0 ? resolve(process.argv[rootIndex + 1]) : projectRoot;
const assetsRoot = resolve(root, 'public/assets');
const metadata = JSON.parse(await readFile(resolve(assetsRoot, 'ref-slices.json'), 'utf8'));
const { SKIN_DATA } = await import(pathToFileURL(resolve(root, 'src/skin-data.js')).href);
const { getSkinGeometry } = await import(pathToFileURL(resolve(root, 'src/skins.js')).href);
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const records = new Map();
const sources = new Map(metadata.sources.map(source => [source.filename, source]));

async function imageSize(filename) {
  const contents = await readFile(resolve(assetsRoot, filename));
  assert.ok(contents.subarray(0, 8).equals(signature), `${filename} must have a PNG signature.`);
  return [contents.readUInt32BE(16), contents.readUInt32BE(20)];
}

assert.equal(metadata.version, 1);
assert.equal(metadata.operation, 'crop-only');
assert.deepEqual(SKIN_DATA, metadata, 'Runtime skin data must match slicing metadata.');
for (const source of sources.values()) {
  assert.deepEqual(await imageSize(source.filename), source.size, `${source.filename} source size changed.`);
  assert.ok(source.trim.every(Number.isInteger));
  assert.ok(source.trim[0] >= 0 && source.trim[1] >= 0 && source.trim[2] > 0 && source.trim[3] > 0);
  assert.ok(source.trim[0] + source.trim[2] <= source.size[0] && source.trim[1] + source.trim[3] <= source.size[1]);
}
for (const record of metadata.assets) {
  assert.match(record.filename, /^ref-[a-z-]+\.png$/);
  assert.ok(!records.has(record.filename), `Duplicate piece: ${record.filename}`);
  records.set(record.filename, record);
  const source = sources.get(record.source);
  assert.ok(source, `${record.filename} has no source record.`);
  assert.ok(record.crop.every(Number.isInteger));
  const [left, top, width, height] = record.crop;
  assert.ok(left >= 0 && top >= 0 && width > 0 && height > 0);
  assert.ok(left + width <= source.size[0] && top + height <= source.size[1]);
  assert.deepEqual(record.size, [width, height]);
  assert.deepEqual(await imageSize(record.filename), record.size, `${record.filename} dimensions do not match crop.`);
  assert.ok(Math.abs(record.ratio - width / height) < 1e-10, `${record.filename} ratio is incorrect.`);
}

for (const kind of ['button', 'scroll']) {
  const skin = metadata.skins[kind];
  assert.ok(skin && sources.has(skin.source));
  const source = sources.get(skin.source);
  assert.deepEqual(skin.referenceSize, source.trim.slice(2));
  const columns = [source.trim[0], source.trim[0] + skin.insets.left, source.trim[0] + source.trim[2] - skin.insets.right, source.trim[0] + source.trim[2]];
  const rows = kind === 'button' ? [source.trim[1], source.trim[1] + source.trim[3]] : [source.trim[1], source.trim[1] + skin.insets.top, source.trim[1] + source.trim[3] - skin.insets.bottom, source.trim[1] + source.trim[3]];
  const parts = kind === 'button' ? ['left', 'middle', 'right'] : ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br'];
  assert.deepEqual(Object.keys(skin.parts), parts);
  parts.forEach((part, index) => {
    const column = index % 3;
    const row = kind === 'button' ? 0 : Math.floor(index / 3);
    const record = records.get(skin.parts[part]);
    assert.ok(record, `Missing ${kind} ${part}.`);
    assert.equal(record.source, skin.source);
    assert.deepEqual(record.crop, [columns[column], rows[row], columns[column + 1] - columns[column], rows[row + 1] - rows[row]]);
  });
  for (const [width, height] of kind === 'button' ? [[180, 40], [300, 56], [280, 88]] : [[280, 220], [380, 560], [440, 760]]) {
    const geometry = getSkinGeometry(kind, width, height);
    assert.ok(geometry.scale > 0);
    assert.ok(geometry.left + geometry.right < width);
    assert.ok(kind === 'button' || geometry.top + geometry.bottom < height);
    for (const piece of geometry.pieces) {
      const original = records.get(piece.filename);
      assert.ok(Math.abs(piece.width / piece.height - original.ratio) < 1e-10, `${piece.filename} is distorted at ${width}x${height}.`);
      assert.ok(Math.abs(piece.width / original.size[0] - geometry.scale) < 1e-10);
      assert.ok(Math.abs(piece.height / original.size[1] - geometry.scale) < 1e-10);
    }
  }
}

for (const filename of ['src/skins.js', 'src/skins.css']) {
  const source = await readFile(resolve(root, filename), 'utf8');
  assert.deepEqual(inspectRuntimeSource(source, filename), [], `${filename} must not draw artwork.`);
  assert.ok(!/background-size\s*:\s*100%\s+100%|border-image\s*:[^;]*url\(|ui-buttons/.test(source), `${filename} must not stretch old atlas skins.`);
}
const stylesheet = await readFile(resolve(root, 'src/skins.css'), 'utf8');
for (const repeat of ['repeat-x', 'repeat-y', 'repeat']) assert.ok(stylesheet.includes(`background-repeat: ${repeat};`));

const pythonCandidates = [process.env.GHOST_LEDGER_PYTHON, 'python', resolve(process.env.USERPROFILE ?? '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe')].filter(Boolean);
let selectedPython = null;
for (const candidate of pythonCandidates) {
  try {
    execFileSync(candidate, ['-c', 'import PIL'], { stdio: 'ignore' });
    selectedPython = candidate;
    break;
  } catch {}
}
assert.ok(selectedPython, 'Pillow is required for exact crop pixel verification. Set GHOST_LEDGER_PYTHON to its Python executable.');
await access(resolve(REPO_ROOT, 'tools/slice-ui.py'));
execFileSync(selectedPython, [resolve(REPO_ROOT, 'tools/slice-ui.py'), '--assets-root', assetsRoot, '--verify'], { stdio: 'inherit' });
console.log(`${records.size} 张切片的来源、原像素裁切、比例、三/九切片分区与等比布局检查通过。`);
