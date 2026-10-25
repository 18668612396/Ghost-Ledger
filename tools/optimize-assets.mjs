import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { auditAssets } from './audit-assets.mjs';
import { GAME_ROOT, LOCAL_ROOT } from './paths.mjs';

export const ASSET_PROFILE = Object.freeze({ version: 1, quality: 90, alphaQuality: 100, effort: 5, cardSize: 1024, enemySize: 1024, avatarSize: 384, symbolSize: 384, faviconSize: 128 });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
let encoder;
async function imageEncoder() {
  if (!encoder) {
    try { encoder = (await import('sharp')).default; }
    catch { throw new Error('生产图片构建需要开发依赖 sharp，请先在仓库根目录运行 npm ci。'); }
    encoder.simd(false);
    encoder.concurrency(1);
  }
  return encoder;
}

export function assetEncodingProfile(filename, metadata) {
  let width = metadata.width, height = metadata.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 16777216) throw new Error(`图片尺寸不受支持：${filename}`);
  let limit = null;
  if (filename === 'ui-favicon.png') limit = ASSET_PROFILE.faviconSize;
  else if (filename === 'ref-avatar.png') limit = ASSET_PROFILE.avatarSize;
  else if (['ref-energy.png', 'card-cost-flame.png'].includes(filename)) limit = ASSET_PROFILE.symbolSize;
  else if (/^card-art-/.test(filename)) limit = ASSET_PROFILE.cardSize;
  else if (/^enemy-/.test(filename) && filename !== 'enemy-shadow-hard.png') limit = ASSET_PROFILE.enemySize;
  else if (/^fx-/.test(filename)) limit = ASSET_PROFILE.enemySize;
  // Only square illustrations are reduced. The source aspect ratio and the
  // exact pixel dimensions of sprite atlases / nine-slices stay unchanged.
  if (limit && width === height && width > limit) width = height = limit;
  if (filename === 'ui-logo.png' && width % 2 === 0 && height % 2 === 0) { width /= 2; height /= 2; }
  if (filename === 'enemy-shadow-hard.png' && width % 2 === 0 && height % 2 === 0) { width /= 2; height /= 2; }
  const format = filename === 'ui-favicon.png' ? 'png' : 'webp';
  const lossless = /^(?:ref-(?!scene|avatar|energy)|card-frame-|collection-)/.test(filename);
  return { width, height, format, lossless, quality: lossless ? 100 : ASSET_PROFILE.quality, alphaQuality: ASSET_PROFILE.alphaQuality, effort: ASSET_PROFILE.effort };
}

/** No writes to the source asset. A caller may reuse the bytes for another target. */
export async function optimizeAssetBytes(filename, input) {
  const sharp = await imageEncoder();
  const metadata = await sharp(input, { limitInputPixels: 16777216 }).metadata();
  if (metadata.format !== 'png') throw new Error(`发布素材源文件必须是 PNG：${filename}`);
  const profile = assetEncodingProfile(filename, metadata);
  if (profile.width * metadata.height !== profile.height * metadata.width) throw new Error(`发布缩放改变了素材比例：${filename}`);
  const pipeline = sharp(input, { limitInputPixels: 16777216 }).resize(profile.width, profile.height, { fit: 'fill', kernel: 'lanczos3', withoutEnlargement: true });
  if (profile.format === 'png') pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
  else pipeline.webp({ lossless: profile.lossless, quality: profile.quality, alphaQuality: profile.alphaQuality, effort: profile.effort, smartSubsample: true });
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return { bytes: data, profile, width: info.width, height: info.height, hasAlpha: Boolean(metadata.hasAlpha), sourceWidth: metadata.width, sourceHeight: metadata.height, sourceSha256: sha256(input), sha256: sha256(data), encoder: { sharp: sharp.versions.sharp, vips: sharp.versions.vips, webp: sharp.versions.webp } };
}

async function encodeCached(filename, input, cacheRoot) {
  const sharp = await imageEncoder();
  const metadata = await sharp(input).metadata();
  const profile = assetEncodingProfile(filename, metadata);
  const key = sha256(JSON.stringify({ source: sha256(input), profile, version: ASSET_PROFILE.version, encoder: sharp.versions }));
  const path = resolve(cacheRoot, `${key}.${profile.format}`), metaPath = resolve(cacheRoot, `${key}.json`);
  try {
    const [bytes, json] = await Promise.all([readFile(path), readFile(metaPath, 'utf8')]);
    const cached = JSON.parse(json);
    if (cached.sha256 === sha256(bytes) && cached.sourceSha256 === sha256(input)) return { ...cached, bytes };
  } catch { /* Missing or invalid derived cache is rebuilt from the source. */ }
  const encoded = await optimizeAssetBytes(filename, input);
  const { bytes, ...record } = encoded;
  await mkdir(cacheRoot, { recursive: true });
  await writeFile(path, bytes);
  await writeFile(metaPath, JSON.stringify(record));
  return encoded;
}

export async function optimizeRuntimeAssets({ gameRoot = GAME_ROOT, outputRoot, cacheRoot = resolve(LOCAL_ROOT, 'temp/release-assets-cache') } = {}) {
  if (!outputRoot) throw new Error('发布图片缺少输出目录。');
  const audit = await auditAssets(gameRoot);
  if (audit.missing.length) throw new Error(`运行素材未登记来源：${audit.missing.join('、')}`);
  await mkdir(outputRoot, { recursive: true });
  const records = [], assets = {};
  for (const filename of audit.runtime) {
    const input = await readFile(resolve(gameRoot, 'public/assets', filename));
    const encoded = await encodeCached(filename, input, cacheRoot);
    const id = filename.replace(/\.png$/, ''), output = `${id}.${encoded.sha256.slice(0, 16)}.${encoded.profile.format}`;
    await writeFile(resolve(outputRoot, output), encoded.bytes);
    assets[id] = output;
    const provenance = audit.manifest.assets.find(record => record.filename === filename);
    records.push({ id, source: `game/public/assets/${filename}`, sourceSha256: encoded.sourceSha256, sourceBytes: input.length, sourceWidth: encoded.sourceWidth, sourceHeight: encoded.sourceHeight, filename: output, sha256: encoded.sha256, bytes: encoded.bytes.length, width: encoded.width, height: encoded.height, hasAlpha: encoded.hasAlpha, format: encoded.profile.format, profile: encoded.profile, encoder: encoded.encoder, attribution: provenance?.source || null });
  }
  const sourceBytes = records.reduce((sum, row) => sum + row.sourceBytes, 0), outputBytes = records.reduce((sum, row) => sum + row.bytes, 0);
  const excluded = [];
  for (const filename of audit.provenance) excluded.push({ filename, bytes: (await readFile(resolve(gameRoot, 'public/assets', filename))).length, reason: 'source-provenance-only' });
  return { assets, report: { schemaVersion: 1, profile: ASSET_PROFILE, sourceBytes, outputBytes, savedBytes: sourceBytes - outputBytes, assetCount: records.length, excludedProvenanceBytes: excluded.reduce((sum, row) => sum + row.bytes, 0), excluded, records } };
}
