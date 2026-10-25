import { BUILD_INFO } from './build-info.js';

function assetId(name) {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9_-]*(?:\.png)?$/.test(name)) throw new TypeError('素材标识无效。');
  return name.replace(/\.png$/, '');
}

/** Development serves the original PNGs; releases only resolve their own manifest. */
export function hasBundledAsset(name) {
  try { const id = assetId(name); return BUILD_INFO.releaseId === 'development' || Object.hasOwn(BUILD_INFO.assets, id); }
  catch { return false; }
}

export function resolveAssetUrl(name) {
  const id = assetId(name);
  if (BUILD_INFO.releaseId === 'development') return new URL(`../public/assets/${id}.png`, import.meta.url).href;
  const filename = BUILD_INFO.assets[id];
  if (!filename) throw new Error(`当前发布版本不包含素材：${id}。请备份记录并检查版本。`);
  return new URL(`../public/assets/${filename}`, import.meta.url).href;
}
