// Shared static card data. Both rule versions read this module directly, so
// neither combat engine depends on the other's module-initialization order.
const LEGACY_CARD_DEFS = {
  brush: { id: 'brush', name: '判官笔', cost: 1, type: 'attack', description: '造成 7 点伤害。', flavor: '朱笔落处，生死有名。', art: 'brush' },
  talisman: { id: 'talisman', name: '镇魂符', cost: 1, type: 'skill', description: '获得 6 点护甲。', flavor: '一纸薄黄，镇住夜风。', art: 'talisman' },
  chain: { id: 'chain', name: '勾魂索', cost: 1, type: 'attack', description: '造成 7 点伤害；有阴债时额外造成 4 点。击败敌人时偿还 2 点阴债。', flavor: '锁得住游魂，也系得住归路。', art: 'chain' },
  vow: { id: 'vow', name: '还愿符', cost: 1, type: 'skill', description: '获得 4 点护甲，偿还 2 点阴债。', flavor: '许过的愿，总要还。', art: 'talisman' },
  step: { id: 'step', name: '幽冥步', cost: 1, type: 'skill', description: '获得 5 点护甲，抽 1 张牌。', flavor: '莫回头，莫踩自己的影子。', art: 'step' },
  coin: { id: 'coin', name: '透骨钱', cost: 0, type: 'attack', description: '造成 3 点伤害，抽 1 张牌。消耗。', flavor: '铜钱过眼，看得见彼岸。', art: 'coin', exhaust: true },
  fire: { id: 'fire', name: '业火符', cost: 1, type: 'attack', description: '造成 5 点伤害，施加 4 层业火。业火在回合结束时造成等量伤害，随后减少 1 层。', flavor: '凡间不肯熄的，带到阴间再烧。', art: 'fire' },
  bell: { id: 'bell', name: '摄魂铃', cost: 1, type: 'skill', description: '获得 3 点护甲，施加 2 回合易伤。易伤使攻击伤害提高 50%。', flavor: '铃响三声，魂归何处。', art: 'bell' },
  seal: { id: 'seal', name: '生死签', cost: 2, type: 'attack', description: '造成 16 点伤害；有阴债时额外造成 6 点。', flavor: '签上写的，未必是你的名字。', art: 'seal' },
  lotus: { id: 'lotus', name: '莲灯渡', cost: 1, type: 'skill', description: '获得 8 点护甲，偿还 2 点阴债。消耗。', flavor: '借一盏灯，送一程人。', art: 'lotus', exhaust: true },
  blood: { id: 'blood', name: '借命斩', cost: 0, type: 'attack', description: '造成 10 点伤害，欠下 2 点阴债，于两个回合后到期。消耗。', flavor: '把后天的命，借给今夜。', art: 'chain', exhaust: true },
  ledger: { id: 'ledger', name: '销账书', cost: 1, type: 'skill', description: '偿还 4 点阴债，抽 2 张牌。消耗。', flavor: '白纸黑字，总有一笔能划去。', art: 'ledger', exhaust: true },
  mirror: { id: 'mirror', name: '照骨镜', cost: 1, type: 'skill', description: '获得 7 点护甲；本回合已偿还过阴债时，再获得 6 点护甲。', flavor: '镜里没有脸，只有未了的愿。', art: 'mirror' },
  ferry: { id: 'ferry', name: '摆渡钱', cost: 0, type: 'skill', description: '偿还 2 点阴债，获得 1 点香火。消耗。', flavor: '船钱已付，莫问来处。', art: 'coin', exhaust: true },
  verdict: { id: 'verdict', name: '阎罗敕令', cost: 3, type: 'attack', description: '造成 24 点伤害；每点阴债额外造成 2 点，最多额外 16 点。消耗。', flavor: '阴司敕令，诸鬼伏诛。', art: 'seal', exhaust: true },
};

export const ACT1_CARD_DEFS = {
  a_strike: { id: 'a_strike', name: '斩魂', cost: 1, type: 'attack', target: 'enemy', description: '造成 6 点伤害。', upgradeDescription: '造成 9 点伤害。', flavor: '刀锋向前，莫问归路。', art: 'brush' },
  a_defend: { id: 'a_defend', name: '守灯', cost: 1, type: 'skill', target: 'self', description: '获得 5 点护甲。', upgradeDescription: '获得 8 点护甲。', flavor: '护住灯芯，亦护住自己。', art: 'talisman' },
  a_bash: { id: 'a_bash', name: '破煞', cost: 2, type: 'attack', target: 'enemy', description: '造成 8 点伤害，施加 2 回合易伤。', upgradeDescription: '造成 10 点伤害，施加 3 回合易伤。', flavor: '先破其势，再断其魂。', art: 'seal' },
  a_cleave: { id: 'a_cleave', name: '横扫阴风', cost: 1, type: 'attack', target: 'all', description: '对所有敌人造成 8 点伤害。', upgradeDescription: '对所有敌人造成 11 点伤害。', flavor: '一阵阴风，诸鬼退散。', art: 'chain' },
  a_flame: { id: 'a_flame', name: '焚纸送魂', cost: 2, type: 'attack', target: 'all', description: '对所有敌人造成 14 点伤害。将 1 张灼伤放入弃牌堆。', upgradeDescription: '对所有敌人造成 18 点伤害。将 1 张灼伤放入弃牌堆。', flavor: '纸灰落尽，余烬留身。', art: 'fire' },
  a_slimed: { id: 'a_slimed', name: '黏液', cost: 1, type: 'status', target: 'self', description: '消耗。清理黏液会占用香火。', flavor: '黏住的，既是手，也是下一息。', art: 'lotus', exhaust: true },
  a_dazed: { id: 'a_dazed', name: '眩晕', cost: null, type: 'status', target: 'self', description: '无法打出。虚无：回合结束时仍在手中便消耗。', flavor: '钟声之后，一片空白。', art: 'bell', unplayable: true, ethereal: true },
  a_burn: { id: 'a_burn', name: '灼伤', cost: null, type: 'status', target: 'self', description: '无法打出。回合结束时仍在手中，受到 2 点伤害，可被护甲抵挡。', flavor: '火已远去，伤仍在。', art: 'fire', unplayable: true },
  a_burn_plus: { id: 'a_burn_plus', name: '灼伤+', cost: null, type: 'status', target: 'self', description: '无法打出。回合结束时仍在手中，受到 4 点伤害，可被护甲抵挡。', flavor: '六火重燃，旧伤更深。', art: 'fire', unplayable: true },
};

const UPGRADE_DESCRIPTIONS = {
  brush: '造成 10 点伤害。', talisman: '获得 9 点护甲。', chain: '造成 10 点伤害；有阴债时额外造成 6 点。击败敌人时偿还 2 点阴债。',
  vow: '获得 7 点护甲，偿还 3 点阴债。', step: '获得 8 点护甲，抽 1 张牌。', coin: '造成 5 点伤害，抽 1 张牌。消耗。',
  fire: '造成 8 点伤害，施加 6 层业火。', bell: '获得 5 点护甲，施加 3 回合易伤。', seal: '造成 21 点伤害；有阴债时额外造成 8 点。',
  lotus: '获得 11 点护甲，偿还 3 点阴债。消耗。', blood: '造成 14 点伤害，欠下 2 点阴债，于两个回合后到期。消耗。',
  ledger: '偿还 6 点阴债，抽 3 张牌。消耗。', mirror: '获得 10 点护甲；本回合已偿债时再获得 8 点。', ferry: '偿还 3 点阴债，获得 2 点香火。消耗。',
  verdict: '造成 32 点伤害；每点阴债额外造成 2 点，最多额外 24 点。消耗。',
};

export const CARD_DEFS = Object.fromEntries(Object.entries({ ...LEGACY_CARD_DEFS, ...ACT1_CARD_DEFS }).map(([id, definition]) => [id, UPGRADE_DESCRIPTIONS[id] ? { ...definition, upgradeDescription: UPGRADE_DESCRIPTIONS[id] } : definition]));
