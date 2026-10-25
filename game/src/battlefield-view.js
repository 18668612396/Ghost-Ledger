import { contentFor, getEnemyMechanics } from './engine.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
/**
 * Render the production battlefield without reading DOM, clocks, or storage.
 * Inject animationTime when the caller wants the production idle-animation
 * phase; a fixed value makes controlled layout captures deterministic.
 */
export function renderBattlefield(state, {
  busy = false,
  pendingTarget = null,
  enemyTargets = null,
  asset,
  icon,
  healthMarkup,
  animationTime = 0,
} = {}) {
  if (typeof asset !== 'function' || typeof icon !== 'function' || typeof healthMarkup !== 'function') throw new TypeError('战场渲染需要 asset、icon 和 healthMarkup。');
  const enemies = state.enemies;
  const enemyKey = enemy => enemy.uid;
  const targets = new Map((enemyTargets || enemies.map(enemy => ({ uid: enemy.uid, eligible: true }))).map(target => [target.uid, target]));
  const bobDuration = 3600;
  return `<section class="arena enemy-count-${enemies.length} ${pendingTarget ? 'choosing-target' : ''}" aria-label="第一人称战场">${enemies.map((instance, index) => {
    if (instance.hp <= 0 || instance.escaped) return '<div class="enemy-vacancy" aria-hidden="true"></div>';
    const enemy = contentFor(state).enemies[instance.id], uid = enemyKey(instance);
    const eligible = !busy && Boolean(targets.get(uid)?.eligible);
    const statuses = [['sharpHide', '反伤'], ['enrage', '激怒'], ['block', '甲'], ['strength', '力'], ['burn', '业火'], ['exposed', '易伤'], ['weak', '虚弱'], ['artifact', '御符'], ['ritual', '仪式'], ['curlUp', '蜷缩']].filter(([key]) => instance[key] > 0);
    return `<div class="enemy-encounter enemy-slot ${pendingTarget ? eligible ? 'target-ready' : 'target-unavailable' : ''}" data-enemy-uid="${uid}"${pendingTarget ? ` data-card-target-eligible="${eligible}"` : ''} style="--enemy-bob-duration:${bobDuration}ms;--enemy-bob-delay:${-((animationTime + index * 430) % bobDuration)}ms;--enemy-art-scale:${enemy.artScale || 1}"><div class="enemy-stage"><div class="enemy-portrait"><div class="enemy-hud"><span class="enemy-target-arrow" aria-hidden="true">${icon('arrow')}</span><div class="enemy-head-health">${healthMarkup(instance.hp, instance.maxHp, 'enemy-health')}</div></div><button class="enemy-target" data-action="enemy" data-enemy-uid="${uid}"${pendingTarget && !eligible ? ' aria-disabled="true"' : ''} aria-label="${pendingTarget ? eligible ? '选择目标' : '当前不可作用' : '查看'}：${escapeHtml(enemy.name)}，生命 ${instance.hp}/${instance.maxHp}"><img class="enemy-shadow" src="${asset('enemy-shadow-hard')}" alt="" aria-hidden="true" draggable="false"/><span class="enemy-float"><img class="enemy-art enemy-${enemy.art}" src="${asset(enemy.art)}" alt="${escapeHtml(enemy.name)}" draggable="false"/></span></button></div></div><div class="enemy-plate"><div class="enemy-name"><strong>${escapeHtml(enemy.name)}</strong></div>${getEnemyMechanics(state, instance).map(text => `<small class="enemy-mechanic">${escapeHtml(text)}</small>`).join('')}<div class="enemy-status">${statuses.slice(0, enemies.length >= 4 ? 2 : 4).map(([key, label]) => `<span>${label}${instance[key]}</span>`).join('')}</div><span class="target-caption">可选目标</span></div></div>`;
  }).join('')}<div class="arena-effects" aria-hidden="true"></div></section>`;
}
