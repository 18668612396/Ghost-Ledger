export const RELICS = Object.freeze([
  Object.freeze({ id: 'lamp', name: '引魂灯', description: '每回合首次实际偿还阴债时，获得 3 点护甲。', flavor: '灯芯燃着旧愿，为肯还愿的人留一线光。', art: 'lantern', unlockId: null }),
  Object.freeze({ id: 'bell', name: '镇魂铃', description: '每场战斗首回合获得 6 点护甲；不再获得引魂灯的还债护甲。', flavor: '铃声定住初见的惊惧，也催你另寻还愿之法。', art: 'bell', unlockId: 'first-night' }),
]);

export const MILESTONES = Object.freeze([
  Object.freeze({ id: 'first-night', title: '初巡阴路', description: '从一场交锋中带回第一份夜巡见闻。', requirement: '结算时累计赢得 1 场战斗', goal: 1, metric: 'totalBattles', rewardsDescription: '解锁法器「镇魂铃」，下次出门前可与引魂灯互换。' }),
  Object.freeze({ id: 'paid-oaths', title: '有借有还', description: '学会借香火，更要学会偿还许下的阴债。', requirement: '结算时累计实际偿还 6 点阴债', goal: 6, metric: 'totalRepaid', rewardsDescription: '记录还愿修行。所有阴债符箓已在第一幕奖励池开放。' }),
  Object.freeze({ id: 'first-dawn', title: '长夜将明', description: '通过一次判官终审，见到阴路尽头的曙色。', requirement: '结算时累计通关 1 次', goal: 1, metric: 'wins', rewardsDescription: '开放进阶一重：敌人生命提高 15%，攻击提高 2 点。玩家基础属性不变。' }),
]);

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
    && isIdentifier(value.modeId);
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
    equippedRelicId: 'lamp',
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

export function settleRun(profile, run, { abandoned = false } = {}) {
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
