// Pure profile metadata, shared by profile progression and content validation.
// Keep this module independent from generated content to avoid compiler cycles.
export const MILESTONES = Object.freeze([
  Object.freeze({ id: 'first-night', title: '初巡阴路', description: '从一场交锋中带回第一份夜巡见闻。', requirement: '结算时累计赢得 1 场战斗', goal: 1, metric: 'totalBattles', rewardsDescription: '解锁法器「镇魂铃」，下次出门前可与引魂灯互换。' }),
  Object.freeze({ id: 'paid-oaths', title: '有借有还', description: '学会借香火，更要学会偿还许下的阴债。', requirement: '结算时累计实际偿还 6 点阴债', goal: 6, metric: 'totalRepaid', rewardsDescription: '记录还愿修行。所有阴债符箓已在第一幕奖励池开放。' }),
  Object.freeze({ id: 'first-dawn', title: '长夜将明', description: '通过一次判官终审，见到阴路尽头的曙色。', requirement: '结算时累计通关 1 次', goal: 1, metric: 'wins', rewardsDescription: '开放进阶一重：敌人生命提高 15%，攻击提高 2 点。玩家基础属性不变。' }),
]);
