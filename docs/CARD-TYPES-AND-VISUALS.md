# 卡牌类型与卡面视觉约定

更新：2026-10-25，对应当前 v0.5 配置运行时。本文路径以仓库根目录为基准；`.local/` 中的历史证据是本地资料，不随 Git 分发。原作研究依据沿用此前核验记录，本次只核对项目内容，没有重新进行外部资料调研。

## 机械类型、视觉家族与稀有度

三者分别由 `game/content/cards.json` 中的 `type`、`visual.family`、`rarity` 表达。不能按框色、费用或“是否还债”猜测规则。

| 机械类型 | 当前定义数量 | 生命周期 |
| --- | --- | --- |
| `attack` 攻击 | 36 | 攻击与附带效果按顺序结算，去向由关键词和配置决定 |
| `skill` 术法 | 36 | 防御、过牌、资源、增减益等；可以有消耗或其他去向 |
| `power` 能力 | 15 | 打出后进入独立能力区，在本场建立持续或触发效果；离开手牌不算消耗 |
| `status` 状态 | 6 | 通常在战斗中生成；可打出、虚无和回合末效果分别配置 |
| `curse` 诅咒 | 8 | 可留在永久牌组；可打出及移除限制分别配置 |

合计 **101 条定义**：75 种铁甲战士功能对应牌、12 种阴债扩展牌、6 种状态和 8 种诅咒。87 种常规玩家牌有基础与升级规则；这不表示所有定义都进入普通奖励池。具体目录见 [卡牌配置目录](CARD-CATALOG-V05.md)。

本作四色表达视觉用途；原作中的职业卡池色、机械类型和稀有度也属于不同维度。此前研究来源包括 [Cards](https://slay-the-spire.fandom.com/wiki/Cards)、[Status](https://slay-the-spire.fandom.com/wiki/Status) 和 [Colorless Cards](https://slay-the-spire.fandom.com/wiki/Colorless_Cards)。这些是社区资料，不能标为开发商官方设计说明；项目当前行为以本地配置及规则检查为准。

## 四个视觉家族

| `family` | 名称与颜色 | 主卡框 | 当前定义数量 |
| --- | --- | --- | --- |
| `strike` | 攻伐，朱砂红 | `card-frame-vivid-strike` | 32 |
| `ward` | 护身，青玉绿 | `card-frame-vivid-ward` | 19 |
| `spirit` | 灵术，靛蓝 | `card-frame-vivid-spirit` | 27 |
| `oath` | 阴契，绛紫 | `card-frame-vivid-oath` | 23 |

四个家族覆盖全部 101 条定义，各自只负责视觉归属。当前已实现能力、诅咒及独立稀有度；旧文档中的“只有 24 种、尚无能力和诅咒”属于 v0.4 历史，不是当前范围。

## 四层资源与运行时接口

源表中的每张牌都有 `visual`；展示实现见 [card-visuals.js](../game/src/card-visuals.js)。`getCardFamily(cardOrId)` 和 `getCardVisual(cardOrId)` 接受当前静态表中的 ID，或接受配置快照中的完整定义对象。显示冒险快照新增的卡牌时，应传该局定义，不只从全局静态表找同名 ID。

| 层 | 配置与职责 |
| --- | --- |
| 框 | `visual.family` 选择鲜明家族框。完整卡面宽高比 4:7；标题、类型和规则纸面遮挡后方图像，插画窗口透明 |
| 抽象背景 | `visual.background` 指定 PNG 名称。原图宽高比 3:4，使用符纹、雷纹、墨痕、流光等抽象图案，按窗口等比裁切 |
| 透明物件 | `visual.icon` 指定透明 PNG，等比完整显示，不夹带白底、青底或灰色方块 |
| 鬼火费用 | `visual.cost` 通常为 `card-cost-flame`，只指定图像；数字、X 与不可打出的“—”来自运行时卡牌视图 |

`getCardVisual` 返回派生的 `frame` 以及配置中的 `family/background/icon/cost/impact` 等字段，并非只返回四个固定键。`impact` 选择位图命中表现，不是第五层纸牌。

例如，`getCardFamily('ic_strike')` 返回攻伐家族；对应背景为 `card-pattern-color-brush`，主体为 `card-art-unique-ic_strike`（判笔斩开魂缕），费用图为 `card-cost-flame`。卡名、类型、费用数字及规则文字另排版，动态费用和升级数值统一调用 `getCardView(run, instance)`，不按静态牌名拼接。

鬼火位图等比宽度为卡宽 28%，焰心锚定卡宽 8%、卡高 5%；图片平移 `-50% / -64%`，数字居中于位图高度 64%。鬼火可少量外凸，牌名仍以整张卡为水平中心。纸牌不能因费用不足整张透明，也不能为长说明单独拉长卡框。

## 图鉴、牌堆与行囊

小卡采用独立的 4:5 纸框网格。卡牌小框对应四个家族色，怪物和物品使用中性 `collection-slot`。保留原背景、透明物件、费用、名称、类型和数量，点击后查看完整规则，不把长规则塞进小格。

永久副本具有独立 uid 和升级等级；同名副本若临时费用、成长数值或升级不同，不能错误合并。图鉴显示基础定义；战斗牌堆使用当前实例视图。展示见 [collection-view.js](../game/src/collection-view.js)，完整规范见 [美术与表现规范](ART-STANDARDS-V05.md)。

## 背景复用与来源

保留 15 种抽象背景主题：笔墨、护盾涟漪、锁痕雷纹、愿力流光、回旋风痕、铜钱纹、余烬、音波、符印、莲纹、血痕、账簿墨流、镜芒、渡水波光和敕令符文。101 条定义复用这些背景，但透明主体各自独立；包括 6 种状态及 8 种诅咒。基础版与升级版仍属于同一定义，沿用同一张主体图。

来源见 [专属主体 A](../game/public/assets/card-unique-a-prompts.json)、[专属主体 B](../game/public/assets/card-unique-b-prompts.json)、[专属主体 C](../game/public/assets/card-unique-c-prompts.json)、[抽象背景提示词](../game/public/assets/card-pattern-prompts.json)、[矩形裁片](../game/public/assets/card-pattern-slices.json)、[授权调色](../game/public/assets/card-color-adjustments.json)、[鲜明主框](../game/public/assets/card-frame-vivid-prompts.json)、[鬼火费用](../game/public/assets/cost-flame-prompts.json)、[小卡框](../game/public/assets/collection-frame-prompts.json)。当前活动目录有 217 张 PNG，详见 [制作来源](../CREDITS.md)。

旧具象背景、低饱和框、旧调色框及费用圆章属于 `.local/temp/v04-20261025/` 的归档，不再作为运行兜底。现有颜色滤镜受击反馈不改变素材来源；新增美术仍按现行规范制作和登记。

## 验证边界

旧 `v06`、`v07`、`v08` 文件名前缀记录卡面迭代过程，不代表当前产品版本或本轮验证。本地历史证据位于 `.local/evidence/`。

当前 v0.5 的规则、浏览器交互和表现验证基线见 [开发记录](DEVELOPMENT-V05.md)。自动检查、已有截图和桌面浏览器视口均不能替代真实手机触控及用户最终视觉验收。
