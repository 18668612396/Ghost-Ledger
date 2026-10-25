# v0.5 卡牌配置目录

日期：2026-10-25。策划源表已落地；本文件记录内容与规则接口，不替代完整游戏验收。

当前表共101种：铁甲战士功能对应75种、阴债扩展12种、状态6种（包括强化灼伤）、诅咒8种。铁甲对应牌含32攻击、29术法、14能力；稀有度为3基础、20普通、36罕见、16稀有。19个能力定义覆盖持续效果与临时状态。

## 策划入口

- `content/cards.json`：费用、目标、基础与升级效果、卡面四层引用、卡牌自身的抽到／消耗／在手触发。
- `content/powers.json`：持续能力的事件、触发条件、数值叠加、期限和规则修饰。
- `docs/ARCHITECTURE-V05.md`：完整通用效果和表达式协议。

新增已有规则组合的牌时，增加一行JSON即可，不加入按卡牌id判断的执行代码。升级只写有变化的字段；没有写的字段沿用基础。`upgrade.keywords: []`表示移除基础关键词（例如破极升级后不再消耗）。`upgrade.onExhaust`允许升级消耗触发收益。

卡名是原创地府题材名称，`source.card`保留原版英文功能索引；它仅供调研和验证，不参与规则分支。

## 四层美术

每行 `visual` 明确：`family`决定主牌及图鉴框，`background`为抽象背景PNG，`icon`为透明物件PNG，`cost`为鬼火费用PNG；`impact`选择命中特效。所有引用均复用已有、记录过来源的素材。本批没有新画87张独立图标；透明主体与15种抽象背景重新组合，并保留四套家族色。

机械类型、稀有度与家族色是不同字段。攻击通常朱砂红，护甲通常青玉绿，资源／成长通常靛蓝，阴债通常绛紫；既有莲灯渡、照骨镜与销账书等沿用原功能家族。不得仅从框色推断伤害目标或是否触发“打出术法”。

## 复杂规则的配置边界

- 斩击统计用 `tag: strike`，只统计手牌、抽牌堆、弃牌堆和正在打出的牌。消耗牌不统计。原版索引包括Strike、Perfected Strike、Pommel Strike、Twin Strike、Wild Strike五种。
- 以血偿血使用卡牌自身的`hpLost`监听，在手／抽／弃区时、且玩家实际失去生命才累计费用下降。战中后来生成的副本不追溯之前损血。
- 炼狱烙可反复升级，等级n的基础伤害为 `12 + (n² + 7n) / 2`。副本等级与原始配置分开保存。
- 弃尘护命对每张实际消耗的牌分别获得护甲；守夜傀通过 `onExhaust` 回能。持续能力牌正常离场到能力区，不触发消耗。
- 冥火反击用 `attacked` 事件，敌方攻击完全被护甲挡住时仍能反击；持续到敌方回合结束。无惧阴伤、铜身与战意护身的固定护甲不吃敏捷或脆弱。
- 入定的禁抽是可被人工制品抵挡的减益，在回合末手牌清理前解除；虚无消耗触发的抽牌另走正常事件。
- 借神力先增加力量，再获得回合末归还力量的减益；减益和实际扣力量都可被人工制品阻挡。
- 噬魂只在本次攻击击杀非仆从目标时加生命上限；渡尽黄泉治疗实际扣除的敌人生命，不含护甲与过量伤害。两张牌排除在战内随机生成攻击牌之外。
- 返魂的可选集合排除所有返魂副本；阴府赐刃的零费只在本回合有效。
- 阴债本金、到期、一次延期标记与实际偿还分开。摆渡钱要本牌实际还债才回能；司债录每回合只响应第一次实际还债；阴债到期不触发血契神力。

## 铁甲战士功能对应75种

费用按基础→升级列出；相同费用只写一次。完整效果、升级文字及通用指令以源表为准。

| 配置id | 本作名称 | 原版功能索引 | 类型 | 稀有度 | 费用 | 目标 |
| --- | --- | --- | --- | --- | --- | --- |
| ic_strike | 斩魂 | Strike | 攻击 | 基础 | 1 | 指定敌人 |
| ic_bash | 破煞 | Bash | 攻击 | 基础 | 2 | 指定敌人 |
| ic_anger | 嗔火 | Anger | 攻击 | 普通 | 0 | 指定敌人 |
| ic_body_slam | 镇山印 | Body Slam | 攻击 | 普通 | 1→0 | 指定敌人 |
| ic_clash | 断魂 | Clash | 攻击 | 普通 | 0 | 指定敌人 |
| ic_cleave | 横扫阴风 | Cleave | 攻击 | 普通 | 1 | 敌方全场 |
| ic_clothesline | 锁喉索 | Clothesline | 攻击 | 普通 | 2 | 指定敌人 |
| ic_headbutt | 回魂击 | Headbutt | 攻击 | 普通 | 1 | 指定敌人 |
| ic_heavy_blade | 千钧斩 | Heavy Blade | 攻击 | 普通 | 2 | 指定敌人 |
| ic_iron_wave | 铁衣震 | Iron Wave | 攻击 | 普通 | 1 | 指定敌人 |
| ic_perfected_strike | 万刃归魂 | Perfected Strike | 攻击 | 普通 | 2 | 指定敌人 |
| ic_pommel_strike | 引魂斩 | Pommel Strike | 攻击 | 普通 | 1 | 指定敌人 |
| ic_sword_boomerang | 飞钱斩 | Sword Boomerang | 攻击 | 普通 | 1 | 敌方全场 |
| ic_thunderclap | 惊雷咒 | Thunderclap | 攻击 | 普通 | 1 | 敌方全场 |
| ic_twin_strike | 双生斩 | Twin Strike | 攻击 | 普通 | 1 | 指定敌人 |
| ic_wild_strike | 裂骨斩 | Wild Strike | 攻击 | 普通 | 1 | 指定敌人 |
| ic_blood_for_blood | 以血偿血 | Blood for Blood | 攻击 | 罕见 | 4→3 | 指定敌人 |
| ic_carnage | 屠魂 | Carnage | 攻击 | 罕见 | 2 | 指定敌人 |
| ic_dropkick | 踏煞 | Dropkick | 攻击 | 罕见 | 1 | 指定敌人 |
| ic_hemokinesis | 血书判 | Hemokinesis | 攻击 | 罕见 | 1 | 指定敌人 |
| ic_pummel | 连环索 | Pummel | 攻击 | 罕见 | 1 | 指定敌人 |
| ic_rampage | 百战煞 | Rampage | 攻击 | 罕见 | 1 | 指定敌人 |
| ic_reckless_charge | 无常突 | Reckless Charge | 攻击 | 罕见 | 0 | 指定敌人 |
| ic_searing_blow | 炼狱烙 | Searing Blow | 攻击 | 罕见 | 2 | 指定敌人 |
| ic_sever_soul | 斩断尘缘 | Sever Soul | 攻击 | 罕见 | 2 | 指定敌人 |
| ic_uppercut | 撼魂 | Uppercut | 攻击 | 罕见 | 2 | 指定敌人 |
| ic_whirlwind | 万魂风 | Whirlwind | 攻击 | 罕见 | X | 敌方全场 |
| ic_bludgeon | 断狱 | Bludgeon | 攻击 | 稀有 | 3 | 指定敌人 |
| ic_feed | 噬魂 | Feed | 攻击 | 稀有 | 1 | 指定敌人 |
| ic_fiend_fire | 万符俱焚 | Fiend Fire | 攻击 | 稀有 | 2 | 指定敌人 |
| ic_immolate | 焚纸送魂 | Immolate | 攻击 | 稀有 | 2 | 敌方全场 |
| ic_reaper | 渡尽黄泉 | Reaper | 攻击 | 稀有 | 2 | 敌方全场 |
| ic_defend | 守灯 | Defend | 术法 | 基础 | 1 | 自身 |
| ic_armaments | 敕符 | Armaments | 术法 | 普通 | 1 | 自身 |
| ic_flex | 借神力 | Flex | 术法 | 普通 | 0 | 自身 |
| ic_havoc | 听天命 | Havoc | 术法 | 普通 | 1→0 | 自身 |
| ic_shrug_it_off | 幽冥步 | Shrug It Off | 术法 | 普通 | 1 | 自身 |
| ic_true_grit | 净魂 | True Grit | 术法 | 普通 | 1 | 自身 |
| ic_warcry | 唤魂 | Warcry | 术法 | 普通 | 0 | 自身 |
| ic_battle_trance | 入定 | Battle Trance | 术法 | 罕见 | 0 | 自身 |
| ic_bloodletting | 血祭香 | Bloodletting | 术法 | 罕见 | 0 | 自身 |
| ic_burning_pact | 焚契 | Burning Pact | 术法 | 罕见 | 1 | 自身 |
| ic_disarm | 缴械符 | Disarm | 术法 | 罕见 | 1 | 指定敌人 |
| ic_dual_wield | 影双生 | Dual Wield | 术法 | 罕见 | 1 | 自身 |
| ic_entrench | 固魂阵 | Entrench | 术法 | 罕见 | 2→1 | 自身 |
| ic_flame_barrier | 冥火壁 | Flame Barrier | 术法 | 罕见 | 2 | 自身 |
| ic_ghostly_armor | 阴兵甲 | Ghostly Armor | 术法 | 罕见 | 1 | 自身 |
| ic_infernal_blade | 阴府赐刃 | Infernal Blade | 术法 | 罕见 | 1→0 | 自身 |
| ic_intimidate | 喝煞 | Intimidate | 术法 | 罕见 | 0 | 敌方全场 |
| ic_power_through | 带伤守夜 | Power Through | 术法 | 罕见 | 1 | 自身 |
| ic_rage | 战意护身 | Rage | 术法 | 罕见 | 0 | 自身 |
| ic_second_wind | 弃尘护命 | Second Wind | 术法 | 罕见 | 1 | 自身 |
| ic_seeing_red | 燃香 | Seeing Red | 术法 | 罕见 | 1→0 | 自身 |
| ic_sentinel | 守夜傀 | Sentinel | 术法 | 罕见 | 1 | 自身 |
| ic_shockwave | 荡魂钟 | Shockwave | 术法 | 罕见 | 2 | 敌方全场 |
| ic_spot_weakness | 照破虚实 | Spot Weakness | 术法 | 罕见 | 1 | 指定敌人 |
| ic_double_tap | 叠符 | Double Tap | 术法 | 稀有 | 1 | 自身 |
| ic_exhume | 返魂 | Exhume | 术法 | 稀有 | 1→0 | 自身 |
| ic_impervious | 金身护命 | Impervious | 术法 | 稀有 | 2 | 自身 |
| ic_limit_break | 破极 | Limit Break | 术法 | 稀有 | 1 | 自身 |
| ic_offering | 献灯 | Offering | 术法 | 稀有 | 0 | 自身 |
| ic_combust | 魂火不熄 | Combust | 能力 | 罕见 | 1 | 自身 |
| ic_dark_embrace | 幽冥相拥 | Dark Embrace | 能力 | 罕见 | 2→1 | 自身 |
| ic_evolve | 化厄 | Evolve | 能力 | 罕见 | 1 | 自身 |
| ic_feel_no_pain | 无惧阴伤 | Feel No Pain | 能力 | 罕见 | 1 | 自身 |
| ic_fire_breathing | 吐幽焰 | Fire Breathing | 能力 | 罕见 | 1 | 自身 |
| ic_inflame | 神威附体 | Inflame | 能力 | 罕见 | 1 | 自身 |
| ic_metallicize | 铜身 | Metallicize | 能力 | 罕见 | 1 | 自身 |
| ic_rupture | 血契神力 | Rupture | 能力 | 罕见 | 1 | 自身 |
| ic_barricade | 不破法坛 | Barricade | 能力 | 稀有 | 3→2 | 自身 |
| ic_berserk | 孤注燃命 | Berserk | 能力 | 稀有 | 0 | 自身 |
| ic_brutality | 血引灯 | Brutality | 能力 | 稀有 | 0 | 自身 |
| ic_corruption | 堕入幽冥 | Corruption | 能力 | 稀有 | 3→2 | 自身 |
| ic_demon_form | 夜叉化身 | Demon Form | 能力 | 稀有 | 3 | 自身 |
| ic_juggernaut | 镇狱威仪 | Juggernaut | 能力 | 稀有 | 2 | 自身 |

## 阴债扩展12种

| 配置id | 牌名 | 类型 | 稀有度 | 费用 | 基础作用 |
| --- | --- | --- | --- | --- | --- |
| debt_chain | 勾魂索 | 攻击 | 普通 | 1 | 造成7点伤害；有阴债时额外4点。由此击杀时偿还至多2阴债。 |
| debt_vow | 还愿符 | 术法 | 普通 | 1 | 获得4点护甲，偿还至多2阴债。 |
| debt_seal | 生死签 | 攻击 | 罕见 | 2 | 造成16点伤害。若有阴债将在下次巡更到期，额外6点伤害。 |
| debt_lotus | 莲灯渡 | 术法 | 罕见 | 1 | 获得8点护甲，偿还至多2阴债。消耗。 |
| debt_blood | 借命斩 | 攻击 | 普通 | 0 | 造成10点伤害，新增2阴债，于2次巡更后到期。消耗。 |
| debt_ledger | 销账书 | 术法 | 罕见 | 1 | 偿还至多4阴债，抽2张牌。消耗。 |
| debt_mirror | 照骨镜 | 术法 | 罕见 | 1 | 获得7点护甲；若本回合已实际偿债，再获得6点护甲。 |
| debt_ferry | 摆渡钱 | 术法 | 罕见 | 0 | 偿还至多2阴债。本牌实际偿还大于0时，获得1香火。消耗。 |
| debt_verdict | 阎罗敕令 | 攻击 | 稀有 | 3 | 造成24点伤害。本场每实际偿还1阴债额外2点，额外至多16点。消耗。 |
| debt_loan | 借火契 | 术法 | 罕见 | 0 | 获得2香火，新增4阴债，于2次巡更后到期。消耗。 |
| debt_delay | 延灯符 | 术法 | 罕见 | 1→0 | 将最早到期且未延期的1笔阴债延后1次巡更。每笔债整个冒险只能延期一次。消耗。 |
| debt_register | 司债录 | 能力 | 稀有 | 1 | 本场每回合第一次实际偿还阴债时，抽1张牌。 |

## 状态与诅咒

这些牌不进入常规选牌奖励；诅咒可由事件加入永久牌组，状态通常由战斗生成。虚无是战内消耗，不会自动从永久牌组删除诅咒。

| 配置id | 名称 | 类型 | 作用 |
| --- | --- | --- | --- |
| status_slimed | 黏液 | 状态 | 花费1香火消耗此牌。 |
| status_dazed | 眩晕 | 状态 | 无法打出。虚无：回合结束仍在手中时消耗。 |
| status_burn | 灼伤 | 状态 | 无法打出。回合结束仍在手中时，受到2点可被护甲抵挡的伤害。 |
| status_burn_plus | 灼伤·烈 | 状态 | 无法打出。回合结束仍在手中时，受到4点可被护甲抵挡的伤害。 |
| status_wound | 伤口 | 状态 | 无法打出。 |
| status_void | 空虚 | 状态 | 无法打出。虚无。抽到此牌时失去1香火。 |
| curse_injury | 业障 | 诅咒 | 无法打出。 |
| curse_regret | 悔念 | 诅咒 | 无法打出。回合结束时，每有1张手牌失去1点生命。 |
| curse_doubt | 疑惧 | 诅咒 | 无法打出。回合结束时自身获得1回合虚弱。 |
| curse_shame | 蒙羞 | 诅咒 | 无法打出。回合结束时自身获得1回合脆弱。 |
| curse_decay | 腐咒 | 诅咒 | 无法打出。回合结束时，受到2点可被护甲抵挡的伤害。 |
| curse_clumsy | 踉跄 | 诅咒 | 无法打出。虚无。 |
| curse_writhe | 缠身 | 诅咒 | 固有。无法打出。 |
| curse_pain | 苦痛 | 诅咒 | 无法打出。在手中时，每打出其他牌失去1点生命。 |

## 验证记录

`node --test tests/cards-catalog.test.mjs`：8项通过。覆盖75英文索引与各分类数量、全部位图引用、修正值、升级规则、反复升级曲线、事件来源边界；87张可打出的牌在基础与升级两个等级共174条路径，通过相同解释器执行并完成等待选择，结算队列与临时区均正确清空。

这些是配置及通用结算冒烟验证，不能代替逐项组合时序回归、整局浏览器试玩或用户对平衡的验收。主线还需验证真实奖励／商店可获得、新界面卡面、拖拽目标与动画。

## 调研来源

- [一代铁甲战士完整牌表](https://wikiwiki.jp/slaythespire/アイアンクラッドのカード一覧)：75种费用、数值、稀有度与升级差异。
- [Perfected Strike](https://wikiwiki.jp/slaythespire/パーフェクトストライク)、[Blood for Blood](https://wikiwiki.jp/slaythespire/血には血を)：斩击计数范围、卡副本费用下降。
- [Rupture](https://wikiwiki.jp/slaythespire/破裂)、[Combust](https://wikiwiki.jp/slaythespire/燃焼)：卡牌、能力、状态及诅咒自伤来源，叠加生命成本。
- [Reaper](https://wikiwiki.jp/slaythespire/死神)、[Exhume](https://wikiwiki.jp/slaythespire/発掘)：实际治疗量及不可取回自身类别。
- [Flex](https://wikiwiki.jp/slaythespire/フレックス)、[Battle Trance](https://wikiwiki.jp/slaythespire/バトルトランス)：减益、人工制品及禁抽清理时机。
- [Flame Barrier](https://wikiwiki.jp/slaythespire/炎の障壁)、[Rage](https://wikiwiki.jp/slaythespire/激怒)、[Entrench](https://wikiwiki.jp/slaythespire/塹壕)、[Limit Break](https://wikiwiki.jp/slaythespire/リミットブレイク)：反击、固定护甲、翻倍与负力量。
- [Second Wind](https://wikiwiki.jp/slaythespire/セカンドウィンド)、[Power Through](https://wikiwiki.jp/slaythespire/やせ我慢)、[Feel No Pain](https://wikiwiki.jp/slaythespire/無痛)：消耗与污染牌组合。
