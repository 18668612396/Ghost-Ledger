// Development defaults. The release builder writes this module in its output only.
export const BUILD_INFO = Object.freeze({
  schemaVersion: 1,
  releaseId: 'development',
  version: '0.5.0',
  target: 'web',
  contentRevision: null,
  assets: Object.freeze({}),
});
export const RELEASE_ID = BUILD_INFO.releaseId;
export const ASSET_FILES = BUILD_INFO.assets;
