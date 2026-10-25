const record = value => value && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const ACTION_TYPES = new Set(['selectNode', 'play', 'chooseCard', 'borrow', 'repay', 'endTurn', 'reward', 'event', 'usePotion', 'discardPotion']);
export function isValidSession(value) {
  return Boolean(record(value) && value.version === 1 && typeof value.runId === 'string' && value.runId.length <= 160 && count(value.startedAt) && count(value.activeMs) && count(value.actionCount) && typeof value.partial === 'boolean' && Array.isArray(value.actions) && value.actions.length <= 2000 && value.actions.every(item => record(item) && count(item.n) && record(item.action) && ACTION_TYPES.has(item.action.type) && Object.values(item.action).every(part => part === null || ['string', 'number', 'boolean'].includes(typeof part))));
}
export function createSessionTracker({ now = () => Date.now(), monotonic = now, initial = null } = {}) {
  let current = isValidSession(initial) ? structuredClone(initial) : null, activeAt = null;
  function flush() {
    if (activeAt !== null && current) { const at = monotonic(); current.activeMs = Math.max(0, Math.round(current.activeMs + Math.max(0, at - activeAt))); activeAt = at; }
  }
  function sync(run, active) {
    flush();
    if (run && current?.runId !== run.runId) {
      current = { version: 1, runId: run.runId, startedAt: now(), activeMs: 0, actionCount: 0, partial: run.phase !== 'map' || (run.route?.completedIds?.length || 0) > 0, actions: [] }; activeAt = null;
    }
    if (current && run?.runId === current.runId && active && !['victory', 'defeat'].includes(run.phase)) activeAt ??= monotonic();
    else activeAt = null;
    return current;
  }
  function snapshot(run) { if (run && current?.runId !== run.runId) sync(run, false); flush(); return current ? structuredClone(current) : null; }
  function recordAction(action, before, after) {
    if (!before || !ACTION_TYPES.has(action.type)) return;
    if (current?.runId !== before.runId) sync(before, false);
    flush(); current.actionCount++;
    const serialized = Object.fromEntries(Object.entries(action).filter(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value)));
    current.actions.push({ n: current.actionCount, action: serialized, phase: before.phase, turn: before.turn, result: after.lastEvent?.kind || after.phase });
    if (current.actions.length > 2000) { current.actions.shift(); current.partial = true; }
  }
  return { sync, snapshot, record: recordAction, replace(value) { current = isValidSession(value) ? structuredClone(value) : null; activeAt = null; } };
}
export function buildPlaytestReport({ run, profile, session, build = {}, platform = 'web', environment = {}, now = Date.now() } = {}) {
  const terminal = run && ['victory', 'defeat'].includes(run.phase);
  return {
    format: 'ghost-ledger.playtest', version: 1, createdAt: new Date(now).toISOString(),
    release: { id: build.releaseId || 'development', version: build.version || 'development', installedContentRevision: build.contentRevision || null, platform },
    run: run ? { runId: run.runId, seed: run.seed, contentRevision: run.contentRevision, modeId: run.modeId, difficulty: run.difficulty, actId: run.actId, phase: run.phase, turn: run.turn, hp: run.hp, maxHp: run.maxHp, completedFloors: run.route?.completedIds?.length || 0, relicId: run.relicId, cause: terminal ? run.lastEvent?.cause || (run.phase === 'victory' ? 'victory' : 'unknown') : null, sourceUid: run.lastEvent?.sourceUid || null, cardId: run.lastEvent?.cardId || null, notice: run.notice || '', stats: structuredClone(run.stats || {}), deck: (run.deckCards || []).map(card => ({ cardId: card.cardId, upgradeLevel: card.upgradeLevel || 0 })), recentLog: [...(run.log || [])] } : null,
    session: run && session?.runId === run.runId && isValidSession(session) ? structuredClone(session) : null,
    profile: profile ? { totalRuns: profile.totalRuns, wins: profile.wins, bestPath: profile.bestPath, history: structuredClone(profile.history || []) } : null,
    environment: { viewport: environment.viewport || null, pixelRatio: environment.pixelRatio || 1, language: environment.language || null },
  };
}
export function durationText(milliseconds) {
  const total = Math.floor(Math.max(0, milliseconds || 0) / 1000);
  return total < 60 ? `${total}秒` : `${Math.floor(total / 60)}分${total % 60}秒`;
}
