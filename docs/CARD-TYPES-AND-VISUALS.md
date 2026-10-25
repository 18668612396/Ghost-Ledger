# 卡牌类型与卡面视觉约定

资料核验日期：2026-10-24；当前v0.4第一幕接入日期：2026-10-25。参考范围为《杀戮尖塔1》原版。本文件保留原作研究及v03–v08卡面历史；当前24种定义沿用四套鲜明框、抽象背景和青蓝鬼火费用，接入单敌、全体、自身目标、临时状态与永久副本升级。

## 原作：类型、卡池颜色、稀有度是三个维度

| 类型 | 含义与战斗生命周期 |
| --- | --- |
| Attack／攻击 | 通常造成攻击伤害，也可以附带格挡、抽牌或其他效果。 |
| Skill／技能 | 提供格挡、过牌、资源、增益或减益等战略效果；本作牌面称“术法”。 |
| Power／能力 | 打出后建立本场战斗中的持续或触发效果；该张牌退出本场抽弃循环，不能把“消耗”当作能力的同义词。 |
| Status／状态 | 战斗中的临时负面牌，影响抽牌或附带惩罚，战斗结束后清除。多数不可打出，但黏液等有例外。 |
| Curse／诅咒 | 通常留在冒险牌组中的负面牌，跨战斗存在，需通过移除等办法处理；具体可打出与移除限制以牌面和相关效果为准。 |

攻击、技能和能力的说明见 [Gameplay](https://slay-the-spire.fandom.com/wiki/Gameplay)。临时状态与长期诅咒的区别见 [Status](https://slay-the-spire.fandom.com/wiki/Status) 和 [Cards](https://slay-the-spire.fandom.com/wiki/Cards)。例如 [Slimed](https://slay-the-spire.fandom.com/wiki/Slimed) 是可花 1 能量打出并消耗的状态牌，不能把“状态”统一理解为不能操作。

- **卡池颜色表示归属。** 红／绿／蓝／紫分别对应铁甲战士、静默猎手、故障机器人、观者；同一职业卡池内都有攻击、技能和能力。原作紫色职业卡不等于诅咒。[按角色颜色分类的卡表](https://slay-the-spire.fandom.com/wiki/Rare_Cards)
- **无色不是第六种类型。** 无色卡可供不同角色获得，仍各自具有攻击、技能或能力类型，也有独立稀有度。[Colorless Cards](https://slay-the-spire.fandom.com/wiki/Colorless_Cards)
- **稀有度另行编码。** 普通／罕见／稀有通常以名字横幅及边饰的灰／蓝／金区别；另有基础、特殊等获取分类。它与角色卡池色、战斗类型分别表达不同信息。[Cards 的 Card Rarity](https://slay-the-spire.fandom.com/wiki/Cards#Card_Rarity)

原作还用类型文字与插画框造型辅助辨认：攻击为五边形框、技能为矩形框、能力为圆形框。这里指卡面内部框饰，不是把整张纸牌改成对应几何轮廓。[Cards 的 Card Types](https://slay-the-spire.fandom.com/wiki/Cards#Card_Types)

## 本作：四个视觉分组与鲜明卡框

《夜渡 · 阴债录》使用四套鲜明卡框：攻伐为朱砂红、护身为青玉绿、灵术为靛蓝、阴契为绛紫。用户允许达到历史红绿高饱和版的鲜明程度。四组只是视觉分类；当前战斗类型为“攻击”“术法”“状态”，由牌面标签明确显示。

旧15张牌各自保留不同的笔墨、雷纹、符纹、光流或涟漪背景；v0.4新增9种定义通过`CARD_VISUALS`复用这些既有纹样，并未生成9张独立背景。窗口不使用具象房间、风景、建筑或纯色底块。纹样与透明前景物件分离；具体来源与复用映射见下表及调色记录。

上述配色是本作选择的视觉语义，不冒充原作卡池颜色或稀有度规则。阴契同时包含攻击、术法和临时状态牌，不能只凭框色推断战斗类型。能力和诅咒本轮未加入；已有4种临时状态定义。稀有度仍需独立实现，高级奖励池解锁不自动等同稀有度。

## 当前v0.4范围：24种卡牌定义

图鉴与牌堆另外使用4:5的简洁藏品卡片。符箓的`collection-frame-{strike,ward,spirit,oath}.png`以中性小框为编辑目标，由`image_gen`分别参考主卡框生成，四个视觉组的边框和类型文字都对应红／绿／蓝／紫。中性`collection-slot.png`保留给百鬼与物品。画区复用每张牌在`CARD_VISUALS`登记的原抽象背景，透明物件叠在背景上，费用、名称、类型和数量独立排版。背景等比缩放并居中裁切，物件和色框等比完整显示，不把规则文本塞进小格；0费显示0，不可打出的状态牌显示「—」。点击后再打开完整卡面，升级与未升级副本分别堆叠，图鉴始终展示基础版。来源见 [基础小卡片](../public/assets/collection-prompts.json)、[四类色框](../public/assets/collection-frame-prompts.json)。

静态定义见 [card-defs.js](../src/card-defs.js)，通过 [engine.js](../src/engine.js)兼容导出，共24种：11种`attack`、9种`skill`、4种`status`；没有`power`、`curse`或`rarity`字段。4种状态仅在战斗中临时产生；灼伤与灼伤+分为两种定义，不是两张可永久获得的奖励牌。

| 定义分组 | 对应卡牌 |
| --- | --- |
| 原有攻击（7） | 判官笔、勾魂索、透骨钱、业火符、生死签、借命斩、阎罗敕令 |
| 原有术法（8） | 镇魂符、还愿符、幽冥步、摄魂铃、莲灯渡、销账书、照骨镜、摆渡钱 |
| 新基础（3） | 斩魂（攻击）、守灯（术法）、破煞（攻击）；第一幕以5斩魂、4守灯、1破煞出发 |
| 新群攻（2） | 横扫阴风、焚纸送魂，均为攻击牌，目标为全体存活敌人 |
| 临时状态（4） | 黏液、眩晕、灼伤、灼伤+；战斗结束清理，不永久加入牌组 |

此前v03–v08卡面修订记录保留为历史。当前第一幕已接入自身、单敌、全体目标及实际状态牌规则；永久卡用独立`uid`保存副本，升级只作用于选中的一张。同名牌可以分别未升级／升级，展示需调用`getCardView(run, instance)`读取名字、规则、可用性与费用，不能只按卡牌ID读取静态文本。

类型标记仍读取 `type`，不能按费用、插画编号或“是否还债”推断。透骨钱与摆渡钱可以继续共用铜钱前景，但使用不同背景；照骨镜、销账书分别使用独立的 `mirror`、`ledger` 前景。

| 视觉分组 | 卡框素材 | 对应卡牌 |
| --- | --- | --- |
| `strike` 攻伐（7） | `card-frame-vivid-strike`，朱砂红 | 判官笔、透骨钱、业火符、斩魂、破煞、横扫阴风、焚纸送魂 |
| `ward` 护身（5） | `card-frame-vivid-ward`，青玉绿 | 镇魂符、幽冥步、莲灯渡、照骨镜、守灯 |
| `spirit` 灵术（3） | `card-frame-vivid-spirit`，靛蓝 | 摄魂铃、销账书、摆渡钱 |
| `oath` 阴契（9） | `card-frame-vivid-oath`，绛紫 | 勾魂索、还愿符、生死签、借命斩、阎罗敕令、黏液、眩晕、灼伤、灼伤+ |

四组覆盖全部24种定义，每种只属于一组；视觉分组不改变`CARD_DEFS.type`、目标或数值。机制由卡牌定义和战斗引擎负责。

## 四层素材配置

纯展示映射位于 [src/card-visuals.js](../src/card-visuals.js)。`CARD_FAMILIES` 是包含 `id`、`label`、`frame` 的四组只读数组；`CARD_FAMILY_BY_ID` 按卡牌 ID 索引分组对象，`getCardFamily(cardId)` 返回同一对象，未知卡牌或缺少分组明确报错。

`CARD_VISUALS` 和 `getCardVisual(id)` 保留四层接口：每张牌恰好提供 `frame`、`background`、`icon`、`cost` 四个素材名，均不含 `.png`，可直接交给现有 `asset()`。插画编号仍读取 `CARD_DEFS`；未知 ID 明确报错，不静默套用其他牌的图。

| 配置项 | 作用与透明要求 |
| --- | --- |
| `frame` | 按四个视觉分组使用全新生成的 `card-frame-vivid-{familyId}`。保持整卡宽:高 4:7；插画窗口镂空透明，标题纸、类型／规则卡纸保持不透明，纸牌外轮廓之外可透明。 |
| `background` | 旧15张为各自的`card-pattern-color-{cardId}`；新9种通过别名复用既有纹样。所有背景保持宽:高3:4，即高:宽4:3；不加入具象场景、道具、卡框、文字或费用，可等比缩放、矩形裁剪，不能压扁。 |
| `icon` | 通常为`card-art-{CARD_DEFS[id].art}`；黏液复用透明怪物图`enemy-acid`。前景等比放在背景之上，主体周围透明，不夹带旧白底、青底或灰底方块。 |
| `cost` | 统一`card-cost-flame`，整团青蓝鬼火、浅青焰心。位图宽为卡宽28%，焰心锚定卡宽8%、卡高5%；图片平移`-50% / -64%`，数字居中在位图高度64%。展示读取`getCardView`，不可用状态牌的费用为`null`，显示「—」；不是0费，不烧进图片。 |

这四项是位图素材职责，名称、类型、费用数字和规则文字仍由代码排版。背景与图标只进入插画窗口，卡框边饰与文字覆盖其上，费用鬼火单独叠放。透明窗口、透明图标不能通过降低整张卡纸的不透明度来替代。

费用鬼火少量外凸并与卡框衔接，牌名仍以整张卡牌为水平中心，左右留白相同。手牌、奖励及完整预览共用焰心锚点，扇形两侧保留屏幕边距。费用字号为手牌 20／18／16px、完整详情 34px（小屏 27px）、奖励 18px。

例如 `getCardFamily('mirror')` 返回 `{id:'ward',label:'护身',frame:'card-frame-vivid-ward'}`；`getCardVisual('mirror')` 返回 `{frame:'card-frame-vivid-ward',background:'card-pattern-color-mirror',icon:'card-art-mirror',cost:'card-cost-flame'}`。这里 `cost` 是图片名，不是香火数值。旧 `card-cost-spirit` 圆章与 v07 的 30% 外凸布局仅保留历史。

## 保留的15张独立抽象背景

| 卡牌 ID／名称 | 本轮背景素材 | 保留的抽象主题 |
| --- | --- | --- |
| `brush` 判官笔 | `card-pattern-color-brush` | 朱墨飞白、细碎笔锋流线 |
| `talisman` 镇魂符 | `card-pattern-color-talisman` | 护盾涟漪、若隐若现的符纹弧线 |
| `chain` 勾魂索 | `card-pattern-color-chain` | 分叉雷纹、交错锁痕光迹 |
| `vow` 还愿符 | `card-pattern-color-vow` | 愿力流光、缓缓汇聚的细光带 |
| `step` 幽冥步 | `card-pattern-color-step` | 回旋风痕、轻薄流动的雾线 |
| `coin` 透骨钱 | `card-pattern-color-coin` | 铜钱符纹光圈、断续同心环 |
| `fire` 业火符 | `card-pattern-color-fire` | 余烬业火、向上卷动的焰纹 |
| `bell` 摄魂铃 | `card-pattern-color-bell` | 同心音波、柔和震颤的弧形光纹 |
| `seal` 生死签 | `card-pattern-color-seal` | 叠印符纹、斑驳印痕与微弱光点 |
| `lotus` 莲灯渡 | `card-pattern-color-lotus` | 莲纹月晕、向外舒展的花瓣光线 |
| `blood` 借命斩 | `card-pattern-color-blood` | 裂光血痕、斜向划开的锐利光缝 |
| `ledger` 销账书 | `card-pattern-color-ledger` | 纸墨流线、淡墨汇拢再散开的细纹 |
| `mirror` 照骨镜 | `card-pattern-color-mirror` | 交错镜芒、折返的冷光与晕环 |
| `ferry` 摆渡钱 | `card-pattern-color-ferry` | 渡水波纹、交叠散开的细波光 |
| `verdict` 阎罗敕令 | `card-pattern-color-verdict` | 敕令放射光、向外展开的符文光芒 |

以上纹样来自已有`image_gen`图片，原始提示词见 [card-pattern-prompts.json](../public/assets/card-pattern-prompts.json)，裁片记录见 [card-pattern-slices.json](../public/assets/card-pattern-slices.json)。`card-pattern-color-*`是有记录的调色版本；旧15张牌仍各用自己的背景，新定义按下表复用，不把24种定义宣称为24张独有背景。

| 新定义 | 复用背景的原卡ID |
| --- | --- |
| `a_strike` 斩魂 | `brush` |
| `a_defend` 守灯 | `talisman` |
| `a_bash` 破煞 | `coin` |
| `a_cleave` 横扫阴风 | `fire` |
| `a_flame` 焚纸送魂 | `brush` |
| `a_slimed` 黏液 | `vow` |
| `a_dazed` 眩晕 | `chain` |
| `a_burn` 灼伤 | `blood` |
| `a_burn_plus` 灼伤+ | `verdict` |

旧 `card-frame-wash`／`card-bg-*` 具象方案、`card-frame-muted-*` 两类型低饱和框，以及直接调色的四个 `card-frame-color-*` 均保留历史，不是当前卡框。原 `card-pattern-*` 仍作为背景调色来源保留。手牌、奖励和详情共用四层配置，保持整卡 4:7、背景 3:4。

## 美术来源与本期验收边界

用户此前要求“直接调整现有素材，不再生图”，随后否定直接调色的四个框，明确要求用 `image_gen` 重新生成；新要求覆盖此前对卡框“不再生图”的限制。当前四张 `card-frame-vivid-*.png` 已由 `image_gen` 重新生成，透明参数、完整提示词及来源见 [card-frame-vivid-prompts.json](../public/assets/card-frame-vivid-prompts.json)。

背景继续使用用户已授权的离线调色结果，保留原PNG的alpha、尺寸、比例与纹样。19张调色派生图见 [card-color-adjustments.json](../public/assets/card-color-adjustments.json)：4张旧框仅作历史，15张为当前背景。项目合计148张PNG：74张生成源图、55张原像素裁片、19张调色派生图。本轮新增18张独立1:1透明怪物图，记录见 [act1-enemy-prompts.json](../public/assets/act1-enemy-prompts.json)；两族泥灵按体型共图、另复用3张旧图，覆盖25种敌人原型。

新费用素材 `card-cost-flame.png` 由 `ref-energy.png` 经内置 `image_gen` 编辑生成，保留完整火焰形态与透明通道；完整提示词、参考图和来源见 [cost-flame-prompts.json](../public/assets/cost-flame-prompts.json)。四个鲜明卡框、15 张抽象背景和透明前景保持不变。

页面代码读取导出的位图，负责已授权的矩形裁切、等比缩放、布局和图层组合，不用 CSS 色块、实时染色滤镜、程序遮罩或程序绘图替代美术。透明窗口、透明前景与不透明标题／规则纸区继续分层，费用鬼火独立叠放。

手牌、奖励、完整预览保持宽:高 4:7，背景原图保持宽:高 3:4，图标与费用鬼火等比。长说明通过完整预览阅读，不为文本单独拉长卡框。本轮需检查完整火焰与卡框的衔接、费用数字位置和字号，以及手牌两侧和小屏详情的可见性。

此前 v06 已检查四套完整卡面、390×844 的奖励及实战手牌、320×568 的奖励详情，以及实战详情的背景模糊与取消。四新框均为 948×1659，透明画窗、轮廓外及纸面 alpha 记录见 [检查数据](../evidence/v06-vivid-frame-alpha.json)，实际效果见 [四色卡面](../evidence/v06-four-vivid-cards.jpg) 与 [小屏详情](../evidence/v06-vivid-preview-320.jpg)。该版 129 张 PNG 来源及固定比例检查、68 项测试通过；这些记录保留历史。

此前v08火焰费用检查覆盖四套卡面、390×844及320×568的手牌与详情、零费用牌和点击鬼火查看详情。该次素材加载完成，费用数字位于焰心锚点，五张手牌费用未被屏幕裁切，牌名整卡居中；见 [布局数据](../evidence/v08-flame-cost-dom.json)、[卡面效果](../evidence/v08-flame-cost-four-cards.jpg) 与 [素材检查](../evidence/v08-flame-cost-alpha.json)。v07圆章及这些v08记录均为历史；当次未重测原生拖拽，桌面浏览器检查也不等于真机触控或用户最终验收。

## v0.4第一幕卡面接入进度

当前24种定义均有四层配置；攻击、术法、状态和单敌／全体／自身目标由实际机制驱动。规则测试共115项已通过。浏览器已验证双怪战的右侧单体6伤、全体各8伤、取消选目标不消耗，以及获取群攻奖励；升级副本、更多状态牌画面、原生拖牌与三首领的整体检查仍在进行。此前v06／v08记录属于卡面回归历史，不能代替本轮完整多怪交互验收。

## 来源与核验边界

来源为公开社区百科，未将其标为 Mega Crit 的官方设计说明。本轮 wiki.gg 的 Cards 正文返回 403，Fandom 正文有 robots／访问限制，以上结论依据当日可读取的搜索索引全文和公开卡表交叉核对；未进行原版客户端逐项实测，未使用非官方反编译或泄露源码。

本作四个视觉分组、鲜明卡框、四层素材与比例根据用户要求制定。参考网页仅用于研究，不作为美术素材来源；游戏美术来自已登记的生图及其裁片／授权调色派生。
