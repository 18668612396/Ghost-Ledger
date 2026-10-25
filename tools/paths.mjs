import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve from this module, so tools also work outside the repository cwd.
export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const GAME_ROOT = resolve(REPO_ROOT, 'game');
export const LOCAL_ROOT = resolve(REPO_ROOT, '.local');
export const TEST_ROOT = resolve(REPO_ROOT, 'tests');
export const EVIDENCE_ROOT = resolve(LOCAL_ROOT, 'evidence');
export const DIST_ROOT = resolve(LOCAL_ROOT, 'dist/web');
