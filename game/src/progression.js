import { CONTENT } from './generated/content-data.js';
import { DEFAULT_STARTER_RELIC_ID } from './runtime/items.js';
import { MILESTONES } from './progression-meta.js';
export { MILESTONES } from './progression-meta.js';
export const RELICS = Object.freeze(Object.values(CONTENT.relics || {}).filter(relic => relic.starter).map(({ id, name, description, starter }) => Object.freeze({ id, name, description, ...starter })));

const VERSION = 1;
const HISTORY_LIMIT = 10;
const SETTLED_ID_LIMIT = 512;
const RANKS = Object.freeze([
  Object.freeze({ name: '见习鬼差', threshold: 0 }),
  Object.freeze({ name: '提灯鬼差', threshold: 20 }),
  Object.freeze({ name: '司簿鬼差', threshold: 60 }),
  Object.freeze({ name: '夜巡使', threshold: 120 }),
]);
const COUNTERS = ['experience', 'totalRuns', 'wins', 'totalBattles', 'totalRepaid', 'bestPath'];
const PHASES = ['map', 'combat', 'reward', 'event', 'victory', 'defeat'];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isIdentifier(value) {
  return typeof value === 'string' && value.length <= 160 && value.trim().length > 0;
}

function isUniqueList(value, isValidItem, limit) {
  return Array.isArray(value) && value.length <= limit && new Set(value).size === value.length && value.every(isValidItem);
}

function isHistoryEntry(value) {
  return isRecord(value)
    && isIdentifier(value.runId)
    && typeof value.won === 'boolean'
    && typeof value.abandoned === 'boolean'
    && !(value.won && value.abandoned)
    && ['battles', 'steps', 'repaid', 'experience', 'difficulty'].every(key => isCount(value[key]))
    && value.difficulty <= 1
    && isIdentifier(value.modeId)
    && ['seed', 'activeMs', 'startedAt', 'endedAt'].every(key => value[key] === undefined || isCount(value[key]))
    && ['contentRevision', 'cause', 'sourceUid', 'cardId'].every(key => value[key] === undefined || value[key] === null || isIdentifier(value[key]));
}

function requireProfile(profile) {
  if (!isValidProfile(profile)) throw new TypeError('局外档案无效，请先校验存档。');
}

function addCount(current, increase) {
  return Math.min(Number.MAX_SAFE_INTEGER, current + increase);
}

function getRunId(run) {
  if (isIdentifier(run?.runId)) return run.runId;
  return null;
}

function countIds(value) {
  if (!Array.isArray(value)) return null;
  return new Set(value.filter(isIdentifier)).size;
}

function getCompletedSteps(run, battles) {
  const completed = countIds(run.route?.completedIds);
  if (completed !== null) return Math.max(battles, completed + (run.phase === 'reward' ? 1 : 0));
  const pathLength = countIds(run.route?.path);
  if (pathLength !== null) return Math.max(battles, pathLength - (run.phase === 'victory' ? 0 : 1));
  const nodeIndex = isCount(run.nodeIndex) ? run.nodeIndex : 0;
  const completedCurrentNode = run.phase === 'victory' || run.phase === 'reward';
  return Math.max(battles, addCount(nodeIndex, completedCurrentNode ? 1 : 0));
}

export function createProfile() {
  return {
    version: VERSION,
    experience: 0,
    totalRuns: 0,
    wins: 0,
    totalBattles: 0,
    totalRepaid: 0,
    bestPath: 0,
    claimed: [],
    equippedRelicId: DEFAULT_STARTER_RELIC_ID,
    settledRunIds: [],
    history: [],
  };
}

export function isValidProfile(value) {
  if (!isRecord(value) || value.version !== VERSION || !COUNTERS.every(key => isCount(value[key]))) return false;
  if (value.wins > value.totalRuns) return false;
  if (!isUniqueList(value.claimed, id => MILESTONES.some(milestone => milestone.id === id), MILESTONES.length)) return false;
  if (value.claimed.some(id => {
    const milestone = MILESTONES.find(candidate => candidate.id === id);
    return value[milestone.metric] < milestone.goal;
  })) return false;
  const relic = RELICS.find(candidate => candidate.id === value.equippedRelicId);
  if (!relic || (relic.unlockId !== null && !value.claimed.includes(relic.unlockId))) return false;
  if (!isUniqueList(value.settledRunIds, isIdentifier, SETTLED_ID_LIMIT)) return false;
  if (value.settledRunIds.length > value.totalRuns) return false;
  if (!Array.isArray(value.history) || value.history.length > HISTORY_LIMIT || value.history.length > value.totalRuns) return false;
  if (!value.history.every(isHistoryEntry) || new Set(value.history.map(entry => entry.runId)).size !== value.history.length) return false;
  return value.history.every(entry => value.settledRunIds.includes(entry.runId)
    && entry.battles <= value.totalBattles
    && entry.repaid <= value.totalRepaid
    && entry.experience <= value.experience
    && entry.steps <= value.bestPath
    && (!entry.won || value.wins > 0));
}

export function getRank(profile) {
  requireProfile(profile);
  let index = RANKS.length - 1;
  while (profile.experience < RANKS[index].threshold) index -= 1;
  const rank = RANKS[index];
  const nextRank = RANKS[index + 1];
  const current = profile.experience - rank.threshold;
  const needed = nextRank ? nextRank.threshold - rank.threshold : 0;
  return { name: rank.name, level: index + 1, current, needed, progress: needed === 0 ? 1 : current / needed };
}

export function getMilestoneProgress(profile, id) {
  requireProfile(profile);
  const milestone = MILESTONES.find(candidate => candidate.id === id);
  if (!milestone) return null;
  const current = profile[milestone.metric];
  return { current, goal: milestone.goal, completed: current >= milestone.goal, claimed: profile.claimed.includes(id) };
}

export function claimMilestone(profile, id) {
  const progress = getMilestoneProgress(profile, id);
  if (!progress?.completed || progress.claimed) return profile;
  return { ...profile, claimed: [...profile.claimed, id] };
}

export function equipRelic(profile, relicId) {
  requireProfile(profile);
  const relic = RELICS.find(candidate => candidate.id === relicId);
  if (!relic || profile.equippedRelicId === relicId || (relic.unlockId && !profile.claimed.includes(relic.unlockId))) return profile;
  return { ...profile, equippedRelicId: relicId };
}

export function getAdventureOptions(profile) {
  requireProfile(profile);
  return { relicId: profile.equippedRelicId, difficulty: 0 };
}

export function isDifficultyUnlocked(profile, difficulty) {
  requireProfile(profile);
  return difficulty === 0 || (difficulty === 1 && profile.claimed.includes('first-dawn'));
}

export function settleRun(profile, run, { abandoned = false, session = null } = {}) {
  requireProfile(profile);
  const unchanged = { profile, earned: 0, alreadySettled: false };
  if (!isRecord(run)) return unchanged;
  const runId = getRunId(run);
  if (!runId) return unchanged;
  if (profile.settledRunIds.includes(runId)) return { ...unchanged, alreadySettled: true };
  if (!PHASES.includes(run.phase) || !isRecord(run.stats)) return unchanged;
  if (!isCount(run.stats.battlesWon) || !isCount(run.stats.repaid)) return unchanged;
  const terminal = run.phase === 'victory' || run.phase === 'defeat';
  if (!terminal && abandoned !== true) return unchanged;
  const won = run.phase === 'victory';
  const battles = run.stats.battlesWon;
  const repaid = run.stats.repaid;
  const steps = getCompletedSteps(run, battles);
  const earned = battles === 0 ? 0 : addCount(Math.min(Number.MAX_SAFE_INTEGER, battles * 8), Math.min(repaid, 12) + (won ? 18 : 0));
  const entry = {
    runId,
    won,
    abandoned: !terminal && abandoned === true,
    battles,
    steps,
    repaid,
    experience: earned,
    modeId: isIdentifier(run.modeId) ? run.modeId : 'classic',
    difficulty: run.difficulty === 1 ? 1 : 0,
    ...(isCount(run.seed) ? { seed: run.seed } : {}),
    ...(isIdentifier(run.contentRevision) ? { contentRevision: run.contentRevision } : {}),
    cause: won ? 'victory' : !terminal ? 'abandoned' : run.lastEvent?.cause || 'unknown',
    ...(isIdentifier(run.lastEvent?.sourceUid) ? { sourceUid: run.lastEvent.sourceUid } : {}),
    ...(isIdentifier(run.lastEvent?.cardId) ? { cardId: run.lastEvent.cardId } : {}),
    ...(session?.runId === runId ? Object.fromEntries(['activeMs', 'startedAt', 'endedAt'].filter(key => isCount(session[key])).map(key => [key, session[key]])) : {}),
  };
  return {
    profile: {
      ...profile,
      experience: addCount(profile.experience, earned),
      totalRuns: addCount(profile.totalRuns, 1),
      wins: addCount(profile.wins, won ? 1 : 0),
      totalBattles: addCount(profile.totalBattles, battles),
      totalRepaid: addCount(profile.totalRepaid, repaid),
      bestPath: Math.max(profile.bestPath, steps),
      settledRunIds: [...profile.settledRunIds, runId].slice(-SETTLED_ID_LIMIT),
      history: [entry, ...profile.history].slice(0, HISTORY_LIMIT),
    },
    earned,
    alreadySettled: false,
  };
}
