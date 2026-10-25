import { ENEMY_DEFS, getEnemies, getEnemyIntent } from './engine.js';

/**
 * Render the production battlefield without reading DOM, clocks, or storage.
 * Inject animationTime when the caller wants the production idle-animation
 * phase; a fixed value makes controlled layout captures deterministic.
 */
export function renderBattlefield(state, {
  busy = false,
  pendingTarget = null,
  asset,
  icon,
  healthMarkup,
  animationTime = 0,
} = {}) {
  if (typeof asset !== 'function' || typeof icon !== 'function' || typeof healthMarkup !== 'function') throw new TypeError('战场渲染需要 asset、icon 和 healthMarkup。');
  const act1 = state.ruleset === 'act1';
  const live = getEnemies(state).filter(enemy => enemy.hp > 0 && !enemy.escaped);
  const enemies = act1 ? state.enemies : live;
  const enemyKey = enemy => enemy.uid || `legacy-${enemy.id}`;
  const bobDuration = 3600;
  return `<section class="arena ${act1 ? 'act1-arena' : ''} enemy-count-${enemies.length} ${busy ? 'enemy-acting' : ''} ${pendingTarget ? 'choosing-target' : ''}" aria-label="第一人称战场">${enemies.map((instance, index) => {
    if (instance.hp <= 0 || instance.escaped) return '<div class="enemy-vacancy" aria-hidden="true"></div>';
    const enemy = ENEMY_DEFS[instance.id], uid = enemyKey(instance), intent = getEnemyIntent(state, instance.uid);
    const order = live.findIndex(candidate => enemyKey(candidate) === uid) + 1;
    const statuses = [['sharpHide', '反伤'], ['enrage', '激怒'], ['block', '甲'], ['strength', '力'], ['burn', '业火'], ['exposed', '易伤'], ['weak', '虚弱'], ['artifact', '御符'], ['ritual', '仪式'], ['curlUp', '蜷缩']].filter(([key]) => instance[key] > 0);
    return `<div class="enemy-encounter enemy-slot ${pendingTarget ? 'target-ready' : ''}" data-enemy-uid="${uid}" style="--enemy-bob-duration:${bobDuration}ms;--enemy-bob-delay:${-((animationTime + index * 430) % bobDuration)}ms;--enemy-art-scale:${enemy.artScale || 1}"><button class="intent" data-action="enemy-info" data-enemy-uid="${uid}" aria-label="${enemy.name}意图：${intent.label}${intent.amount ? ` ${intent.amount}${intent.hits > 1 ? `×${intent.hits}` : ''}` : ''}"><span>${icon(/attack/.test(intent.kind) ? 'skull' : 'flame')}</span><strong><span class="intent-name">${enemies.length > 1 ? `${order}·` : ''}${intent.label}</span>${intent.amount ? ` <b>${intent.amount}${intent.hits > 1 ? `×${intent.hits}` : ''}</b>` : ''}</strong></button><button class="enemy-target ${act1 ? 'act1-enemy' : `enemy-ground-${enemy.art}`}" data-action="enemy" data-enemy-uid="${uid}" aria-label="${pendingTarget ? '选择目标' : '查看'}：${enemy.name}，生命 ${instance.hp}/${instance.maxHp}"><img class="enemy-shadow" src="${asset('enemy-shadow-hard')}" alt="" aria-hidden="true" draggable="false"/><span class="enemy-float"><img class="enemy-art enemy-${enemy.art}" src="${asset(enemy.art)}" alt="${enemy.name}" draggable="false"/></span></button><div class="enemy-plate"><div class="enemy-name"><strong>${enemy.name}</strong></div>${healthMarkup(instance.hp, instance.maxHp, 'enemy-health')}${instance.id === 'guardian' ? `<small class="enemy-mechanic">${instance.ai.phase === 'offense' ? `转形还需 ${instance.ai.shiftRemaining} 伤害` : '防御形态 · 谨慎攻击'}</small>` : ''}<div class="enemy-status">${statuses.slice(0, enemies.length >= 4 ? 2 : 4).map(([key, label]) => `<span>${label}${instance[key]}</span>`).join('')}</div><span class="target-caption">选中目标</span></div></div>`;
  }).join('')}<div class="arena-effects" aria-hidden="true"></div></section>`;
}
