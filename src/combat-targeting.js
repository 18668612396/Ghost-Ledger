// 指针捕获期间不依赖 elementFromPoint：拖动的卡牌可能覆盖敌人。
export function pickEnemyTarget(targets, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const hits = targets.filter(target => target.active !== false
    && typeof target.uid === 'string'
    && x >= target.left && x <= target.right && y >= target.top && y <= target.bottom);
  hits.sort((a, b) => Math.hypot(x - (a.left + a.right) / 2, y - (a.top + a.bottom) / 2)
    - Math.hypot(x - (b.left + b.right) / 2, y - (b.top + b.bottom) / 2));
  return hits[0]?.uid ?? null;
}
