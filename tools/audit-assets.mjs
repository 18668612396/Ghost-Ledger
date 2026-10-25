import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readContent } from './compile-content.mjs';
import { SKIN_DATA } from '../game/src/skin-data.js';
import { GAME_ROOT } from './paths.mjs';
import { COMMON_CARD_ART_IDS } from '../game/src/card-visuals.js';

const root = GAME_ROOT;
export async function auditAssets(projectRoot = root) {
  const root = projectRoot;
  const content = await readContent(root);
  const manifest = JSON.parse(await readFile(resolve(root, 'public/assets/art-manifest.json'), 'utf8'));
  const required = new Set(['collection-slot.png']);
  for (const id of COMMON_CARD_ART_IDS) required.add(`card-art-${id}.png`);
  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await scan(path);
      else if (/\.(js|css|html)$/.test(entry.name)) {
        const text = await readFile(path, 'utf8');
        for (const match of text.matchAll(/(?:assets\/)([\w-]+\.png)/g)) required.add(match[1]);
        for (const match of text.matchAll(/asset\(['"]([\w-]+)['"]\)/g)) required.add(`${match[1]}.png`);
      }
    }
  }
  await scan(resolve(root, 'src'));
  const html = await readFile(resolve(root, 'index.html'), 'utf8');
  for (const match of html.matchAll(/assets\/([\w-]+\.png)/g)) required.add(match[1]);
  for (const row of [...SKIN_DATA.sources, ...SKIN_DATA.assets]) required.add(row.filename);
  for (const card of Object.values(content.cards)) {
    for (const key of ['icon', 'background', 'cost']) required.add(`${card.visual[key]}.png`);
    required.add(`card-frame-vivid-${card.visual.family}.png`); required.add(`collection-frame-${card.visual.family}.png`);
  }
  for (const enemy of Object.values(content.enemies)) required.add(`${enemy.art}.png`);
  for (const visual of Object.values(content.visuals)) required.add(`${visual.asset}.png`);
  const rendering = new Set(required);
  // Original generated sheets remain provenance dependencies of active crops/grades.
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of manifest.assets) if (required.has(record.filename) && record.derivedFrom) {
      for (const source of [record.derivedFrom].flat()) if (!required.has(source)) { required.add(source); changed = true; }
    }
  }
  return { runtime: [...rendering].sort(), provenance: [...required].filter(name => !rendering.has(name)).sort(), unused: manifest.assets.filter(row => !required.has(row.filename)).map(row => row.filename).sort(), missing: [...required].filter(name => !manifest.assets.some(row => row.filename === name)), manifest };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await auditAssets(); const { manifest, ...report } = result;
  console.log(JSON.stringify(report, null, 2));
}
