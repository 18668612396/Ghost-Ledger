import { access, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { CARD_VISUALS } from '../game/src/card-visuals.js';
import { auditAssets } from './audit-assets.mjs';
import { GAME_ROOT } from './paths.mjs';

const defaultRoot = GAME_ROOT;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const uiAspectRatios = new Map([
  ['ref-card.png', [2, 3]], ['ref-icons.png', [1, 1]], ['ref-nav.png', [3, 2]],
  ['ref-card-art.png', [1, 1]], ['ref-avatar.png', [1, 1]], ['ref-energy.png', [1, 1]],
  ['card-frame-opaque.png', [2, 3]], ['enemy-shadow-hard.png', [3, 1]],
  ['card-frame-attack.png', [2, 3]], ['card-frame-skill.png', [2, 3]], ['card-art-cutouts.png', [1, 1]],
  ...['brush', 'talisman', 'chain', 'step', 'fire', 'bell', 'seal', 'coin', 'lotus', 'mirror', 'ledger'].map(name => [`card-art-${name}.png`, [1, 1]]),
  ...['01', '02', '03', '04', '05'].map(number => [`card-scenes-${number}.png`, [3, 1]]),
  ...['01', '02', '03', '04', '05'].map(number => [`card-patterns-${number}.png`, [9, 4]]),
  ...Object.values(CARD_VISUALS).flatMap(visual => [
    [`${visual.frame}.png`, [4, 7]], [`${visual.background}.png`, [3, 4]],
    [`${visual.icon}.png`, [1, 1]], [`${visual.cost}.png`, [1, 1]],
  ]),
]);

function transparentColor(value) {
  const normalized = value.trim().toLowerCase().replace(/\s*!important\s*$/, '');
  if (['transparent', 'none', 'inherit', 'initial', 'unset', 'revert', 'revert-layer'].includes(normalized)) return true;
  if (/^#[\da-f]{3}0$|^#[\da-f]{6}00$/.test(normalized)) return true;
  const functional = normalized.match(/^(?:rgba?|hsla?)\(([^)]+)\)$/);
  if (!functional) return false;
  const parts = functional[1].includes('/') ? functional[1].split('/') : functional[1].split(',');
  if (parts.length !== (functional[1].includes('/') ? 2 : 4)) return false;
  return /^0(?:\.0+)?%?$/.test(parts.at(-1).trim());
}

function expandVariables(value, variables) {
  let result = value;
  for (let depth = 0; depth < 5 && result.includes('var('); depth += 1) {
    result = result.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (match, name, fallback) => variables.get(name) ?? fallback ?? match);
  }
  return result;
}

function transparentBorder(value) {
  const normalized = value.trim().replace(/\s*!important\s*$/, '');
  if (/^(?:none|hidden)(?:\s|$)|^0(?:\.0+)?(?:px|em|rem)?(?:\s|$)/i.test(normalized)) return true;
  if (transparentColor(normalized)) return true;
  const color = normalized.match(/(#[\da-f]+|[a-z]+\([^)]*\)|[a-z]+)\s*$/i)?.[1];
  return Boolean(color && transparentColor(color));
}

function rasterBackground(value) {
  if (transparentColor(value)) return true;
  let remainder = value.replace(/\s*!important\s*$/, '');
  let images = 0;
  remainder = remainder.replace(/url\((?:"[^"]*"|'[^']*'|[^)]*)\)/gi, () => { images += 1; return ''; });
  if (images === 0) return false;
  remainder = remainder.replace(/#[\da-f]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)/gi, color => transparentColor(color) ? '' : color);
  remainder = remainder.replace(/\b(?:transparent|none|left|right|top|bottom|center|cover|contain|no-repeat|repeat-x|repeat-y|repeat|space|round|scroll|fixed|local|padding-box|border-box|content-box)\b/gi, '');
  remainder = remainder.replace(/[+-]?(?:\d*\.)?\d+(?:px|%|em|rem|vh|vw|vmin|vmax)?/gi, '').replace(/[\s/,]/g, '');
  return remainder.length === 0;
}

function inspectCss(css, location) {
  const problems = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const variables = new Map([...clean.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)].map(match => [match[1], match[2].trim()]));
  const declarations = /(?:^|[;{])\s*([\w-]+)\s*:\s*([^;}]+)/gm;
  for (const match of clean.matchAll(declarations)) {
    const property = match[1].toLowerCase();
    const value = expandVariables(match[2].trim(), variables);
    const label = `${location}：${property}: ${match[2].trim()}`;
    const opening = clean.lastIndexOf('{', match.index);
    const selectorStart = Math.max(clean.lastIndexOf('}', opening), clean.lastIndexOf('{', opening - 1)) + 1;
    const selector = opening >= 0 ? clean.slice(selectorStart, opening) : '';
    if (/^(?:box|text)-shadow$/.test(property) && !/^none(?:\s*!important)?$/i.test(value)) problems.push(`${label} 使用程序阴影，请改为素材。`);
    if (/^(?:clip-path|shape-outside)$/.test(property) && !/^none(?:\s*!important)?$/i.test(value)) problems.push(`${label} 使用代码图形裁剪，请改为素材透明通道或矩形宽度裁剪。`);
    if (/^(?:mask|mask-image|-webkit-mask|-webkit-mask-image)$/.test(property) && !rasterBackground(value)) problems.push(`${label} 的遮罩必须来自图片素材。`);
    // 用户要求竖屏游戏之外只留纯色；仅豁免页面 body，游戏内美术仍须使用素材。
    const outsideGameFill = location === 'src/style.css' && selector.trim() === 'body' && property === 'background-color' && /^#[\da-f]{6}$/i.test(value);
    if (/^(?:background|background-color|background-image)$/.test(property) && !rasterBackground(value) && !outsideGameFill) problems.push(`${label} 使用有色背景或程序底纹，请改为图片素材。`);
    if (property === 'scrollbar-color' && !/^(?:auto|inherit|initial|unset|revert|transparent\s+transparent)(?:\s*!important)?$/i.test(value)) problems.push(`${label} 使用程序着色滚动条，请保留原生自动外观或透明设置。`);
    if (/^border(?:-(?:top|right|bottom|left))?(?:-color)?$/.test(property)) {
      const colors = value.match(/(?:rgba?|hsla?)\([^)]*\)|#[\da-f]+|[a-z-]+/gi) || [];
      const allowed = property.endsWith('-color') ? colors.length > 0 && colors.every(transparentColor) : transparentBorder(value);
      if (!allowed) problems.push(`${label} 使用有色边框，请使用素材边框或透明 border。`);
    }
    if (/^outline(?:-color)?$/.test(property) && !/:focus(?:-visible|-within)?\b/.test(selector) && !/\bauto\b/.test(value) && !transparentBorder(value)) problems.push(`${label} 使用装饰轮廓，请改为素材；原生焦点提示允许保留。`);
  }
  return problems;
}

export function inspectRuntimeSource(source, filename) {
  const problems = [];
  const checks = [
    [/<\s*(?:svg|path|circle|ellipse|rect|polygon|polyline|line)\b|data:image\/svg|\.svg(?:["'?#)]|$)/i, '禁止内联或程序 SVG 美术。'],
    [/<\s*canvas\b|\b(?:OffscreenCanvas|Path2D)\b|createElement\(\s*["']canvas["']|\.getContext\(\s*["'](?:2d|webgl2?)["']|\.(?:fillRect|strokeRect|drawImage|arc|bezierCurveTo)\s*\(/i, '禁止 Canvas 程序绘图。'],
    [/(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/i, '禁止 CSS 渐变绘制美术。'],
    [/drop-shadow\s*\(/i, '禁止 CSS 程序投影。'],
    [/createElementNS\([^)]*svg|http:\/\/www\.w3\.org\/2000\/svg/i, '禁止通过 SVG API 绘制美术。'],
  ];
  for (const [pattern, message] of checks) {
    const match = source.match(pattern);
    if (match) problems.push(`${filename}:${source.slice(0, match.index).split('\n').length} ${message}`);
  }
  if (filename.endsWith('.css')) problems.push(...inspectCss(source, filename));
  else {
    for (const match of source.matchAll(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/g)) problems.push(...inspectCss(match[2], `${filename} 内联样式`));
    for (const match of source.matchAll(/\.style\.(background(?:Color)?|border(?:Top|Right|Bottom|Left)?(?:Color)?|boxShadow|textShadow)\s*=\s*(["'])([\s\S]*?)\2/g)) {
      const property = match[1].replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
      problems.push(...inspectCss(`${property}:${match[3]}`, `${filename} 动态样式`));
    }
  }
  return problems;
}

export async function checkArt(root = defaultRoot) {
  const problems = [];
  const assetsRoot = resolve(root, 'public/assets');
  const manifest = JSON.parse(await readFile(resolve(assetsRoot, 'art-manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.assets)) throw new Error('美术来源清单格式错误。');
  const entries = new Map();
  const promptSets = new Map();
  for (const entry of manifest.assets) {
    if (!entry || !/^[\w-]+\.png$/i.test(entry.filename || '') || entry.source !== 'image_gen' || typeof entry.purpose !== 'string' || !entry.purpose.trim() || !/^[\w-]+\.json$/i.test(entry.promptSet || '')) {
      problems.push('美术清单存在无效记录，须提供 filename、purpose、source=image_gen、promptSet。');
      continue;
    }
    if (entries.has(entry.filename)) problems.push(`美术清单重复：${entry.filename}`);
    entries.set(entry.filename, entry);
    try {
      const bytes = await readFile(resolve(assetsRoot, entry.filename));
      if (!bytes.subarray(0, 8).equals(pngSignature)) problems.push(`${entry.filename} 的 PNG 签名不正确。`);
      const aspect = uiAspectRatios.get(entry.filename);
      if (aspect && (bytes.length < 24 || bytes.readUInt32BE(16) * aspect[1] !== bytes.readUInt32BE(20) * aspect[0])) problems.push(`${entry.filename} 的源图比例应为 ${aspect.join(':')}，请勿压扁图集或卡框。`);
    } catch {
      problems.push(`缺少 PNG 美术：${entry.filename}`);
    }
    if (!promptSets.has(entry.promptSet)) {
      try {
        const promptSet = JSON.parse(await readFile(resolve(assetsRoot, entry.promptSet), 'utf8'));
        if (!/image[_\s-]?gen/i.test(promptSet.generator || '') || !Array.isArray(promptSet.assets)) throw new Error('invalid prompt set');
        promptSets.set(entry.promptSet, promptSet);
      } catch {
        problems.push(`提示词记录缺失或格式错误：${entry.promptSet}`);
        promptSets.set(entry.promptSet, null);
      }
    }
    const recordedPrompt = promptSets.get(entry.promptSet)?.assets.find(prompt => prompt.filename === entry.filename);
    if (!recordedPrompt || typeof recordedPrompt.prompt !== 'string' || !recordedPrompt.prompt.trim()) problems.push(`${entry.filename} 没有对应的完整生成提示词。`);
    if (entry.operation === 'color-adjustment') {
      if (!recordedPrompt || recordedPrompt.operation !== 'color-adjustment' || recordedPrompt.derivedFrom !== entry.derivedFrom || !manifest.assets.some(origin => origin.filename === entry.derivedFrom)) {
        problems.push(`${entry.filename} 缺少已登记的原始位图与用户授权调色记录。`);
      } else {
        const source = await readFile(resolve(assetsRoot, entry.derivedFrom));
        const adjusted = await readFile(resolve(assetsRoot, entry.filename));
        const hash = bytes => createHash('sha256').update(bytes).digest('hex');
        if (hash(source) !== recordedPrompt.sourceSha256 || hash(adjusted) !== recordedPrompt.sha256) problems.push(`${entry.filename} 与记录的源文件或调色结果哈希不同。`);
        if (!source.subarray(16, 26).equals(adjusted.subarray(16, 26))) problems.push(`${entry.filename} 调色时改变了 PNG 尺寸或像素格式。`);
      }
    }
  }
  const audit = await auditAssets(root);
  for (const filename of audit.missing) problems.push(`美术清单缺少在用资产或来源：${filename}`);
  for (const filename of await readdir(assetsRoot)) if (/\.png$/i.test(filename) && !entries.has(filename)) problems.push(`PNG 美术没有来源记录：${filename}`);
  const runtimeSources = ['index.html'];
  async function collect(directory) {
    for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await collect(path);
      else if (/\.(?:js|css)$/.test(entry.name)) runtimeSources.push(path);
    }
  }
  await collect('src');
  for (const filename of runtimeSources) problems.push(...inspectRuntimeSource(await readFile(resolve(root, filename), 'utf8'), filename));
  try {
    await access(resolve(root, 'public/favicon.svg'));
    problems.push('请移除旧的程序绘制 public/favicon.svg，改用生成的 ui-favicon.png。');
  } catch {}
  if (problems.length) throw new Error(`美术来源检查未通过：\n${problems.map(problem => `- ${problem}`).join('\n')}`);
  console.log(`${entries.size} 张 PNG 的文件签名、来源链、生成提示词/调色记录及运行源码美术约束检查通过。`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkArt();
