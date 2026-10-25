export const SAVE_KEYS = Object.freeze({ run: 'ghost-ledger.run.v5', profile: 'ghost-ledger.profile.v2', sound: 'ghost-ledger.sound.v1', guide: 'ghost-ledger.guide.v1', session: 'ghost-ledger.session.v1' });
const LEGACY_KEYS = ['ghost-ledger.run.v4'];
const MAX_BACKUP = 4 * 1024 * 1024;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message) => ({ ok: false, error: { code, message } });
function parse(text) {
  return JSON.parse(text, (key, value) => { if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('非法字段'); return value; });
}
export function collectRunAssets(run, cardVisual = card => card.visual) {
  const content = run?.contentSnapshot, names = new Set();
  if (!content) return [];
  for (const card of Object.values(content.cards || {})) {
    const visual = cardVisual(card);
    for (const key of ['icon', 'background', 'cost']) if (visual?.[key]) names.add(visual[key]);
    if (visual?.family) { names.add(`card-frame-vivid-${visual.family}`); names.add(`collection-frame-${visual.family}`); }
  }
  for (const enemy of Object.values(content.enemies || {})) names.add(enemy.art);
  for (const visual of Object.values(content.visuals || {})) names.add(visual.asset);
  for (const item of [...Object.values(content.relics || {}), ...Object.values(content.potions || {})]) if (item.art) names.add(`card-art-${item.art}`);
  return [...names].filter(Boolean);
}
export function createSaveStore(storage, { validateRun, validateProfile, validateSession, hasAsset = () => true, cardVisual, now = () => Date.now() } = {}) {
  const validators = new Map([[SAVE_KEYS.run, validateRun], [SAVE_KEYS.profile, validateProfile],
    [SAVE_KEYS.session, value => value === null || Boolean(validateSession?.(value))],
    [SAVE_KEYS.guide, value => value === null || record(value) && value.version === 1 && typeof value.completed === 'boolean'],
    [SAVE_KEYS.sound, value => typeof value === 'boolean']]);
  const validRun = run => {
    try { return validateRun(run) && collectRunAssets(run, cardVisual).every(hasAsset); } catch { return false; }
  };
  const valid = (key, value) => { try { return key === SAVE_KEYS.run ? validRun(value) : validators.get(key)?.(value) ?? true; } catch { return false; } };
  function readValue(key) {
    const response = storage.read(key);
    if (!response.ok) return response;
    if (response.value === null) return { ok: true, value: null };
    try { const value = parse(response.value); return valid(key, value) ? { ok: true, value } : failure('invalid-save', '记录格式或素材与当前版本不兼容。'); }
    catch { return failure('invalid-save', '记录无法读取。'); }
  }
  function load() {
    const notices = [], values = {};
    for (const [name, key] of [['run', SAVE_KEYS.run], ['profile', SAVE_KEYS.profile]]) {
      const current = readValue(key);
      if (current.ok) values[name] = current.value;
      else {
        const previous = readValue(`${key}.previous`);
        // The backup shares the same schema; never execute an older runtime.
        if (previous.ok && previous.value && valid(key, previous.value)) { values[name] = previous.value; notices.push(`${name === 'run' ? '夜巡' : '档案'}已恢复到上次备份，原始记录仍保留。`); }
        else { values[name] = null; notices.push(`${name === 'run' ? '夜巡' : '档案'}记录暂不可用，原始记录仍保留，可在设置中导出。`); }
      }
    }
    if (!values.run && LEGACY_KEYS.some(key => storage.read(key).value)) notices.push('检测到旧版夜巡记录，已保留。新版本需要重新开始，旧记录不会被覆盖。');
    if (values.run && !['victory', 'defeat'].includes(values.run.phase) && values.profile?.settledRunIds.includes(values.run.runId)) { values.run = null; notices.push('这份夜巡已结算，原始记录保留，不能再次续玩。'); }
    return { ...values, notices };
  }
  function saveJson(key, value) {
    if (!Object.values(SAVE_KEYS).includes(key)) return failure('unknown-save-key', '不支持的存储记录。');
    let text; try { text = JSON.stringify(value); if (!valid(key, parse(text))) return failure('invalid-save', '当前进度未通过保存检查，请导出原始记录。'); }
    catch { return failure('invalid-save', '当前进度无法序列化。'); }
    const previous = storage.read(key);
    if (!previous.ok) return previous;
    if (previous.value !== null && [SAVE_KEYS.run, SAVE_KEYS.profile].includes(key)) {
      let supported = false; try { supported = valid(key, parse(previous.value)); } catch {}
      const backup = storage.write(`${key}.${supported ? 'previous' : 'rejected'}`, previous.value);
      if (!backup.ok) return backup;
    }
    return storage.write(key, text);
  }
  function rawRecords({ includeBeforeImport = true, includeReplacement = true } = {}) {
    const records = {};
    for (const key of [...Object.values(SAVE_KEYS), ...LEGACY_KEYS, ...[SAVE_KEYS.run, SAVE_KEYS.profile].flatMap(key => [`${key}.previous`, `${key}.rejected`])]) {
      const result = storage.read(key); if (result.ok && result.value !== null) records[key] = result.value;
    }
    if (includeBeforeImport) { const previous = storage.read('ghost-ledger.before-import.v1'); if (previous.ok && previous.value !== null) records['ghost-ledger.before-import.v1'] = previous.value; }
    if (includeReplacement) { const previous = storage.read('ghost-ledger.before-replacement.v1'); if (previous.ok && previous.value !== null) records['ghost-ledger.before-replacement.v1'] = previous.value; }
    return records;
  }
  function createBackup({ run = null, profile, sound = true, guide = null, session = null } = {}) {
    if ((run && !validRun(run)) || !validateProfile(profile)) return failure('invalid-save', '当前记录未通过检查，请改为导出原始记录。');
    const text = JSON.stringify({ format: 'ghost-ledger.backup', version: 1, runtime: { version: 5, ruleset: 'config-v2' }, createdAt: new Date(now()).toISOString(), data: { run, profile, sound: Boolean(sound), guide, session } }, null, 2);
    const checked = inspectBackup(text); return checked.ok ? { ok: true, text } : checked;
  }
  function inspectBackup(text) {
    if (typeof text !== 'string' || text.length > MAX_BACKUP) return failure('backup-too-large', '备份文件过大，未导入。');
    let backup;
    try { backup = parse(text); } catch { return failure('invalid-json', '这个文件不是有效的备份。'); }
    if (!record(backup) || backup.format !== 'ghost-ledger.backup' || backup.version !== 1 || backup.runtime?.version !== 5 || backup.runtime?.ruleset !== 'config-v2' || !record(backup.data)) return failure('unsupported-backup', '备份版本不受支持，当前记录未改变。');
    const data = backup.data;
    if (data.run !== null && !validRun(data.run)) return failure('unsupported-run', '夜巡格式或所需素材与当前版本不兼容，当前记录未改变。');
    if (!validateProfile(data.profile) || typeof data.sound !== 'boolean') return failure('invalid-profile', '备份档案不完整，当前记录未改变。');
    if (data.run && !['victory', 'defeat'].includes(data.run.phase) && data.profile.settledRunIds?.includes(data.run.runId)) return failure('settled-active-run', '备份中的夜巡已经结算，不能再次续玩。');
    if (data.guide !== null && (!record(data.guide) || data.guide.version !== 1 || typeof data.guide.completed !== 'boolean')) return failure('invalid-preferences', '备份引导记录无效。');
    if (data.session !== null && (!data.run || !record(data.session) || (validateSession ? !validateSession(data.session) : data.session.version !== 1 || typeof data.session.runId !== 'string' || !Number.isFinite(data.session.activeMs) || data.session.activeMs < 0 || !Array.isArray(data.session.actions) || data.session.actions.length > 2000) || data.session.runId !== data.run.runId)) return failure('invalid-session', '备份试玩记录无效。');
    return { ok: true, backup };
  }
  function applyChanges(changes, archiveKey, code = 'import-write-failed') {
    const before = new Map();
    for (const [key] of changes) { const previous = storage.read(key); if (!previous.ok) return previous; before.set(key, previous.value); }
    const archive = storage.write(archiveKey, JSON.stringify({ savedAt: now(), records: rawRecords({ includeBeforeImport: false, includeReplacement: false }) }));
    if (!archive.ok) return archive;
    const touched = [];
    for (const [key, value] of changes) {
      const result = value === null ? storage.remove(key) : storage.write(key, value);
      if (!result.ok) {
        let rolledBack = true;
        for (const previousKey of [...touched, key].reverse()) { const previous = before.get(previousKey); const restored = previous === null ? storage.remove(previousKey) : storage.write(previousKey, previous); rolledBack &&= restored.ok; }
        return failure(code, rolledBack ? '存储写入失败，已恢复切换前记录。' : '存储不可用，请保持页面打开并导出原始记录；切换前备份已保留。');
      }
      touched.push(key);
    }
    return { ok: true };
  }
  function importBackup(text) {
    const checked = inspectBackup(text); if (!checked.ok) return checked;
    const { data } = checked.backup;
    const changes = [[SAVE_KEYS.run, data.run === null ? null : JSON.stringify(data.run)], [SAVE_KEYS.profile, JSON.stringify(data.profile)], [SAVE_KEYS.sound, data.sound ? 'on' : 'off'], [SAVE_KEYS.guide, data.guide === null ? null : JSON.stringify(data.guide)], [SAVE_KEYS.session, data.session === null ? null : JSON.stringify(data.session)]];
    const result = applyChanges(changes, 'ghost-ledger.before-import.v1');
    return result.ok ? { ok: true, data } : result;
  }
  function replaceProgress({ run = null, profile, session = null }) {
    const checked = createBackup({ run, profile, session }); if (!checked.ok) return checked;
    return applyChanges([[SAVE_KEYS.profile, JSON.stringify(profile)], [SAVE_KEYS.run, run ? JSON.stringify(run) : null], [SAVE_KEYS.session, session ? JSON.stringify(session) : null]], 'ghost-ledger.before-replacement.v1', 'replacement-write-failed');
  }
  return { load, saveJson, createBackup, inspectBackup, importBackup, replaceProgress, rawRecords };
}
