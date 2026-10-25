# v0.5 策划配置指南

文中路径以仓库根目录为基准。游戏源表位于 `game/content/`，开发工具位于 `tools/`；正式自动回归位于随 Git 分发的 `tests/`，临时检查、证据、隔离副本与构建产物位于 Git 忽略的 `.local/`。

已有机制可以通过 JSON 组合增加内容。下文示例是教学记录，未加入正式牌池；使用时将整条记录追加到对应数组，保持 id 唯一。JSON 不能写注释、函数或尾随逗号。

## 源表与工作流程

可以运行根目录命令 `npm run editor`，使用独立的 [可视化配置工坊](../tools/content-editor/README.md)。表单、效果列表和预览编辑草稿；保存前检查全部源表、关联引用和本地素材，并备份旧文件。复杂 JSON 修改必须先应用到草稿。它复用本指南描述的同一套配置与规则，不引入另一套执行器。

| 文件 | 每行定义 | 使用入口 |
| --- | --- | --- |
| `game/content/cards.json` | 卡牌基础、升级、触发与四层表现 | 起始牌组、奖励、生成、事件 |
| `game/content/powers.json` | 持续能力、临时能力、事件监听与期限 | 卡牌或怪物的 `power` 效果 |
| `game/content/enemies.json` | 怪物形象、生命、技能、AI、特性 | 遭遇中的怪物 id |
| `game/content/encounters.json` | 1–5 怪阵容与抽选权重 | 幕的遭遇池、事件指定战斗 |
| `game/content/acts.json` | 起始资源、地图、遭遇／事件／奖励池 | 创建冒险时的 `actId` |
| `game/content/events.json` | 事件文案、条件、选项与效果 | 幕的 `eventPool` |
| `game/content/visual-effects.json` | 位图特效与动画参数 | `visual.impact`、效果 `impact`、标准表现事件 |
| `game/content/relics.json` | 法器说明、素材、通用触发、开场修正及可选出门行装 | 起始法器、事件奖励、精英／宝箱、局外行装 |
| `game/content/potions.json` | 药物说明、素材、目标、可用场景、效果与售价 | 战斗奖励、鬼市、背包使用 |

1. 从相近记录复制，换一个稳定 id，修改文字、数值、组合或素材引用。
2. 检查引用链：卡牌是否进入本幕池；怪物是否进入遭遇；遭遇是否在本幕池；事件是否加入 `eventPool`。
3. 运行 `npm run content:check`。错误会指向表、id 和字段，修正后再测试。
4. 开发服务会监听源表。看到“配置已更新”后，刷新页面并新开夜巡；继续已有夜巡仍使用原配置快照。
5. 在游戏中验证获得、使用、升级、结算与显示，不只看 JSON 能否解析。

编译输出在 `game/src/generated/content-data.js`，不要编辑它。编译失败时上一次有效结果仍保留；以终端错误或 `/__content/diagnostics` 为准，不能因为浏览器还能运行就认为新表生效了。

九表均为顶层数组，编译后按 id 索引到 `CONTENT`。当前唯一运行格式为 `version:5 / ruleset:'config-v2'`，新局独立复制全部规则表到 `contentSnapshot`。继续已有 v5 夜巡仍读取其卡牌、怪物、法器和药物快照；源表调整不会重写正在进行的规则。旧格式不迁移、不执行，原浏览器记录保留供导出。卡图按当前 ID 更新主体的显示规则不改变快照中的玩法数值。

## 新增卡牌

追加到 `cards.json` 的示例：

```json
{
  "id": "debt_guard_note",
  "name": "护灯契",
  "pool": "debt",
  "type": "skill",
  "rarity": "common",
  "cost": 1,
  "target": "self",
  "text": "获得6点护甲，偿还至多1阴债。",
  "effects": [
    { "op": "block", "amount": 6 },
    { "op": "repay", "amount": 1 }
  ],
  "upgrade": {
    "text": "获得9点护甲，偿还至多2阴债。",
    "effects": [
      { "op": "block", "amount": 9 },
      { "op": "repay", "amount": 2 }
    ]
  },
  "keywords": [],
  "tags": ["debt"],
  "visual": {
    "family": "oath",
    "icon": "card-art-talisman",
    "background": "card-pattern-color-vow",
    "cost": "card-cost-flame",
    "impact": "guard"
  }
}
```

本幕已启用 `debt` 池，因此普通稀有度的这条牌可进入奖励抽选；写入表不意味着下一次奖励必定出现。为某幕提供额外指定牌可使用 `specialCards`，或由事件 `permanentCard` 明确发放。

| 字段 | 规则 |
| --- | --- |
| `id` | 功能对应牌 `ic_...`、阴债 `debt_...`、状态 `status_...`、诅咒 `curse_...`；不把显示名当身份 |
| `pool` | 内容池标签；现有 `ironclad/debt/status/curse`，自定义池需要在幕中引用 |
| `type` | `attack/skill/power/status/curse`；机械触发按此字段判断 |
| `rarity` | `basic/common/uncommon/rare/special`；常规奖励只取普通、罕见、稀有，排除状态和诅咒 |
| `cost` | 非负整数、`"X"` 或 `null`；null 表示不可按正常费用打出，不是 0 |
| `target` | `enemy` 指定怪物；`all` 向敌方场地拖；`self` 向下拖到自身区域 |
| `effects` | 按顺序执行的通用效果数组 |
| `upgrade` | 仅覆盖变化字段；数组整体替换，例如 `keywords:[]` 可移除消耗 |
| `upgradePolicy` | 根层填 `repeat` 才允许反复升级；正常牌只升一次，无 upgrade 的状态不参与升级选择 |
| `keywords` | `exhaust/ethereal/innate/unplayable` |
| `visual` | 家族框、抽象背景、透明主体、费用与命中特效引用 |
| `source` | 可选调研索引或原创设计说明；不参与运行规则 |

`visual.family` 有 `strike/ward/spirit/oath` 四种，分别对应红、绿、蓝、紫框；它与机械类型、稀有度分别配置。图片引用填写 `game/public/assets/` 下的 PNG 名称，不带路径或扩展名。新增图先完成 [美术来源与分层要求](ART-STANDARDS-V05.md)。

上例的通用符箓用于演示可运行字段。正式新增卡牌还需制作与牌名及效果相符的独立透明主体，登记来源与 `card-art-layouts.json` 的定位后运行 `npm run art:check`，再替换 `visual.icon`；不要继续把同一物件分配给不同卡牌。主体定位属于素材元数据，不改变卡牌规则。

特殊入口为 `onDraw`、`onExhaust`、`onHandEnd` 与 `triggers`；它们仍执行相同效果列表。`costModifier` 调整实例费用，`playCondition` 与 `playConditionText` 定义可打出条件及原因。`generation.combat:false` 可从战内随机生成池排除牌。

## 表达式与通用效果

数值字段可以直接写数字，也可以写表达式 AST。不要写 `"hp * 2"` 这样的 JavaScript 字符串。

| 表达式 | 例子与含义 |
| --- | --- |
| 状态读取 | `{"stat":"player.block"}`，`{"stat":"target.exposed"}`，`{"stat":"card.upgradeLevel"}` |
| 计算 | `{"op":"add","args":[6,{"stat":"card.rampageDamage"}]}` |
| 条件 | `{"op":"gt","args":[{"debt":"total"},0]}` |
| 卡区计数 | `{"count":{"zone":"hand","type":"attack"}}`；可加 `tag`、`excludeSelf` |
| 阴债摘要 | `total/dueNext/repaidCombat/repaidTurn/eligibleDelay` |
| 种子随机 | `{"random":[2,4]}`；展示预览不消耗随机数 |

`stat` 根可用 `player/state/source/target/card/context/event/power`。常用上下文包括 `context.x`、`context.exhausted`、`context.lastDamage`、`context.lastKilled`、`context.lastPaid`。计数区可用 `hand/drawPile/discard/exhaust/powerZone/limbo`；`combat` 仅包含手牌、抽牌、弃牌和结算中的牌，不含消耗和能力区。

算术操作：`add/sub/mul/div/min/max/floor/ceil/abs/pow/mod`；比较与逻辑：`eq/ne/lt/lte/gt/gte/and/or/not`。一元操作一个参数，二元操作两个参数，多元操作至少一个参数。

动态说明使用 `text:"造成{damage}点伤害。"` 与 `textValues.damage` 表达式，读取本副本成长或升级等级；相同表达式也用于实际伤害。若升级改变公式，`upgrade.textValues` 也要更新。不能为某个 id 在渲染器补专用文字。

按负债追加伤害的效果示例，可作为某张攻击牌的一个 `effects` 元素：

```json
{
  "op": "if",
  "condition": { "op": "gt", "args": [{ "debt": "total" }, 0] },
  "then": [{ "op": "damage", "amount": 4, "target": "enemy" }],
  "else": []
}
```

主要操作如下，完整字段以 `game/src/runtime/content-schema.js` 为准：

| 操作 | 必要字段与用途 |
| --- | --- |
| `damage` | `amount,target`；`hits` 多段，`strengthScale` 力量倍率，`attack:false` 固定效果伤害，`ignoreBlock` 无视护甲 |
| `block/energy/loseHp/heal` | `amount`；固定护甲加 `modified:false`，自伤明确 `cause:"card"` |
| `status` | `key,amount,target`；力量、敏捷、虚弱、易伤等共享状态 |
| `power` | `id,amount,target`；引用能力表，可用 `duration` 覆盖期限 |
| `draw/addCard` | 抽牌 `amount`；加牌还要 `cardId,zone`，可指定 `position,upgradeLevel` |
| `exhaust` | `selection:allHand/nonAttacks/randomHand/chosen`；`onEach` 表达每张实际消耗的收益 |
| `moveCard` | `from,to,selection:"chosen"`；可加类型过滤、排除 id、置顶 |
| `copyCard` | `selection:self/chosen,amount,zone`；可限制类型、设置临时费用 |
| `upgrade/modifyCard` | 战内选择／全手升级；修改当前或触发所属副本的成长字段 |
| `playTop/generateCard` | 打出牌堆顶牌；从铁甲池生成攻击／术法／能力，可设临时费用 |
| `repeatNext` | `amount` 指本回合接下来几张攻击各重复一次，不表示同一张重复多少次 |
| `if` | `condition,then,else`；分支内仍是效果列表 |
| `debt/repay/delayDebt` | 新债 `amount,delay`；实际偿还 `amount`；延期笔数 `amount` |
| `set` | `target,path,value`；只允许共享状态或 `ai.*` 白名单路径 |
| `summon/steal/escape/changeIntent/transformCards` | 召唤、偷钱、逃走、切换本怪已有行动、状态牌转换 |
| `gold/permanentCard/relic` | 事件资源、永久加牌与法器奖励 |

效果目标支持 `self/source/enemy/target/allEnemies/randomEnemy/player/ally/attacker`。玩家牌的 self/source 为玩家，怪物行动的 source 为该实例；`attacker` 用于受到攻击后的反击。卡牌的 `target` 决定交互，效果的 `target` 决定结算，两者必须一致。

## 新增持续能力

追加到 `powers.json` 的示例：

```json
{
  "id": "debt_echo_example",
  "name": "还愿回响",
  "description": "每回合首次实际偿债时，按能力层数抽牌。",
  "triggers": [{
    "id": "first_repayment",
    "event": "debtRepaid",
    "when": { "op": "gt", "args": [{ "stat": "event.amount" }, 0] },
    "limit": "oncePerTurn",
    "effects": [{ "op": "draw", "amount": { "stat": "power.amount" } }]
  }]
}
```

牌通过 `{"op":"power","id":"debt_echo_example","amount":1,"target":"self"}` 获得它。`power.amount` 是叠加层数，触发器中的 `source` 是能力拥有者。无真实还债时不会产生偿债收益；到期扣血和首领勾销都不是还债。

事件包括 `turnStart/turnEnd/cardPlayed/cardExhausted/cardDrawn/hpLost/attacked/blockGained/debtRepaid/enemyDeath/enemyActionStart/enemyActionEnd`。常用事件数据有 `amount/hpLoss/attack/cardType/cause/cardId/cardUid/sourceUid/targetUid`。卡牌触发器可指定 `zones`，例如仅在手、抽、弃区累计费用变化。触发上限支持 `oncePerTurn/oncePerCombat`。

能力可用 `expires:handEnd/turnEnd/roundEnd` 定义寿命；三者分别在在手效果后、敌方开始前、敌方结束后清除。规则修饰有 `retainBlock/noDraw/skillCostZero/exhaustSkills/energyPerTurn`。反伤与禁抽的期限不能互换；持续能力牌进入能力区，不触发“消耗一张牌”。

## 新增怪物与遭遇

怪物示例，追加到 `enemies.json`。这里复用祭师形象演示；正式新角色应补充适合的有来源美术。

```json
{
  "id": "lamp_keeper_example",
  "name": "巡灯客",
  "description": "交替蓄力与攻击。",
  "art": "enemy-cultist",
  "artScale": 1,
  "kind": "normal",
  "hpRange": [24, 28],
  "moves": {
    "charge": {
      "label": "添灯",
      "effects": [{ "op": "status", "key": "strength", "amount": 1, "target": "source" }]
    },
    "strike": {
      "label": "灯焰",
      "effects": [{ "op": "damage", "amount": 5, "target": "player", "impact": "fire" }]
    }
  },
  "ai": {
    "rules": [{
      "sequence": {
        "moves": ["charge", "strike"],
        "index": { "stat": "source.turns" },
        "loop": true
      }
    }]
  }
}
```

`kind` 可为 normal、elite、boss；实际节点奖励由遭遇节点类别决定。生命范围生成实例时采样，`initial` 可设置共享状态、`minion` 和 `ai` 记忆；不能覆盖 uid、生命或结算队列。行动的 `effects` 与 `after` 共用卡牌效果 DSL。

AI 从上向下取首条满足 `when` 的规则。每条只选 `move`、`sequence`、`weighted` 之一。带权项支持 `move/weight/maxRepeat/when`；必须有无条件、不会被重复限制耗尽的兜底。使用 `source.turns`、`source.ai.*` 和 `source.hp` 表达轮次与阶段，不在代码按怪名分支。

被动写在 `triggers`，规则仍用共享事件。`traits` 中的 `id/label/description` 用于情报；可加 `display` 数组，用 `when/text/textValues` 显示当前层数和阈值，文字本身不产生规则。

遭遇示例，追加到 `encounters.json`：

```json
{
  "id": "weak_lamp_pair_example",
  "label": "双灯拦路",
  "pools": ["act1_weak"],
  "weight": 1,
  "composition": {
    "fixed": ["lamp_keeper_example", "cultist"]
  }
}
```

`composition` 可组合 `fixed` 固定成员、`variants` 带权整组变体、`slots` 按槽位抽选、`bag/count` 从有限袋不放回抽取。所有可能组合都必须有 1–5 只怪。加入 act1_weak 后，会参与第一幕前 3 场普通战抽选；示例只演示接口，不代表已通过难度平衡。

## 新增幕与随机地图

最稳妥的做法是复制 `acts.json` 中的 act1 行，修改 id、名称、遭遇池、事件池与地图。下例展示一个完整的六层幕，可与本指南其他示例一起追加：

```json
{
  "id": "act_example",
  "number": 1,
  "name": "六灯试巡",
  "starting": {
    "maxHp": 80, "gold": 99, "energy": 3,
    "deck": [
      { "cardId": "ic_strike", "count": 5 },
      { "cardId": "ic_defend", "count": 4 },
      { "cardId": "ic_bash", "count": 1 }
    ],
    "relics": ["blood_ember", "lamp"]
  },
  "weakBattleCount": 3,
  "encounterPools": {
    "weak": "act1_weak", "strong": "act1_strong",
    "elite": "act1_elite", "boss": "act1_boss"
  },
  "eventPool": ["quiet_bridge_example", "shrine"],
  "cardPools": ["ironclad", "debt"],
  "specialCards": ["debt_guard_note"],
  "rewards": {
    "rarityWeights": { "common": 60, "uncommon": 37, "rare": 3 },
    "debtChance": { "common": 0.2, "uncommon": 0.2, "rare": 0.25 }
  },
  "map": {
    "floors": 6, "columns": 3, "nodeCount": [2, 3],
    "fixedFloors": {
      "1": { "type": "battle", "count": 3 },
      "5": { "type": "rest", "count": 1 },
      "6": { "type": "boss", "count": 1 }
    },
    "typeWeights": { "battle": 60, "event": 25, "shop": 15 },
    "branchChance": 0.46, "maxLinks": 2,
    "constraints": {
      "minFloor": { "shop": 2 },
      "noConsecutive": ["shop"]
    }
  }
}
```

`nodeCount` 是每层节点数范围；`fixedFloors` 指定固定层用途和数量，最后一层必须显式为 boss。`typeWeights` 是其余节点的抽选权重，`minFloor/maxFloor` 约束出现楼层，`noConsecutive` 禁止沿连线连续出现指定类型。`branchChance/maxLinks` 控制分支与最多出口。

不要用固定节点列表冒充随机地图，也不要配置筛选后没有节点类型或没有合法出口的层。编译会使用真实生成器做种子预检；复杂改动还应运行世界回归。节点名可用 `nodeLabels` 配置，难度倍率用 `difficultyModifiers` 的 id、hpMultiplier、attackBonus 配置。

`encounterPools` 引用遭遇行的 pools 标签。`cardPools` 与 `specialCards` 形成奖励候选集合；basic、状态与诅咒即使列入 specialCards 也不会进入普通选牌奖励。`debtChance` 是在对应稀有度中尝试选择阴债牌的概率，`rarityWeights` 是相对权重。

开发侧通过 `createConfiguredAdventure(seed, { actId: "act_example" })` 运行新幕。当前主页模式仍选择 act1；若要向玩家开放新幕，需要在 `game/src/modes.js` 及相关入口登记。当前首领胜利会结束冒险，新增幕不会自动建立连续章节。

## 新增事件

追加到 `events.json`，并在幕的 `eventPool` 中引用：

```json
{
  "id": "quiet_bridge_example",
  "title": "桥边还愿",
  "description": "桥头的纸灯收下一点香资，也收下一笔旧愿。",
  "choices": [
    {
      "id": "pay",
      "title": "付10冥钱，还2阴债",
      "description": "优先偿还最早到期的债。",
      "when": {
        "op": "and",
        "args": [
          { "op": "gte", "args": [{ "stat": "state.gold" }, 10] },
          { "op": "gt", "args": [{ "debt": "total" }, 0] }
        ]
      },
      "effects": [
        { "op": "gold", "amount": -10 },
        { "op": "repay", "amount": 2 }
      ]
    },
    {
      "id": "leave",
      "title": "继续前行",
      "description": "不做停留。",
      "effects": []
    }
  ]
}
```

每个事件至少有一个无条件出口，不能让资源不足的玩家卡死。选项可加 `encounterId` 进入指定遭遇。rest、shop、treasure、upgrade、remove 是通用节点服务保留 id，不要覆盖；自定义事件可以组合相同通用资源效果。

## 新增法器与药物

`relics.json` 中的法器与卡牌、能力、怪物使用相同的 `effects` 和 `triggers`。例如新增一件“开场多抽一张、每回合首次实际偿债获得护甲”的法器：

```json
{
  "id": "oath_pouch_example",
  "name": "还愿符袋",
  "description": "每场战斗首回合额外抽1张牌；每回合首次实际偿还阴债，获得4点护甲。",
  "art": "ledger",
  "modifiers": { "openingDraw": 1 },
  "triggers": [
    {
      "event": "debtRepaid",
      "when": { "op": "eq", "args": [{ "stat": "state.phase" }, "combat"] },
      "limit": "oncePerTurn",
      "effects": [{ "op": "block", "amount": 4, "modified": false }]
    }
  ]
}
```

`combatStart` 表示战斗开场，`combatVictory` 表示敌人全部退场后的胜利结算。`debtRepaid` 只在实际偿还时触发；勾销借据不算偿还。法器的损血、受攻击和获得护甲事件只监听玩家，`enemyDeath` 可监听敌人死亡；可用 `when` 限定来源或其他状态。次数限制使用共用 `oncePerTurn / oncePerCombat`，不要依赖某个法器 id 的代码分支。开场抽牌修正只能为 0–10 的整数；额外固有牌沿用正式抽牌规则与手牌上限。

法器可选的 `starter` 为 `{ "unlockId": "first-night", "flavor": "行装说明", "art": "bell" }`。设置后会加入局外出门目录；`unlockId` 必须引用 `game/src/progression-meta.js` 中的真实修行成就，`null` 表示默认解锁。全表必须恰有一件默认行装，复制默认法器后要删除副本的 `starter` 或改为有效解锁成就。`art` 是 `card-art-<art>.png` 的短标识；`starter.art` 使用既有行装图标标识，例如 `lantern` 或 `bell`。

`potions.json` 可组合相同通用效果。例如面向敌方战场的药物：

```json
{
  "id": "mist_bottle_example",
  "name": "驱雾香",
  "description": "对所有敌人造成7点伤害。",
  "art": "fire",
  "target": "all",
  "usablePhases": ["combat"],
  "price": 35,
  "effects": [{ "op": "damage", "amount": 7, "target": "allEnemies", "attack": false }]
}
```

药物外层目标为 `self / enemy / all`，实际效果仍需配置对应的 `target`；`enemy` 可选择具体活着的敌人，`all` 应用 `allEnemies` 等不依赖单体选择的效果。使用场景只接受 `map / combat / event / reward`，敌方目标只允许 `combat`。售价为非负整数。运行时先验证场景和目标，再消费药物、执行效果；丢弃不会执行效果。检查会拒绝失效引用、未知操作、非法修正或单体目标与药物外层目标冲突。

法器与药物会加入对应运行目录，精英／宝箱与药物奖励按当前局目录抽取，鬼市药物售价读取配置。新增既有规则组合不需修改 `runtime/items.js`；该模块只导出目录视图。新增效果操作或平台能力仍需工程实现。

## 配置特效

新增行到 `visual-effects.json` 后，可被卡牌的 `visual.impact` 或某条效果的 `impact` 引用。示例复用已有斩击素材：

```json
{
  "id": "mist_strike_example",
  "asset": "fx-slash",
  "durationMs": 360,
  "scale": [0.7, 1.1, 1.2],
  "rotation": [-8, 5],
  "travel": [0.04, -0.08],
  "opacity": [0, 1, 0],
  "anchor": "target",
  "size": 1.05
}
```

`scale/opacity` 分别为起点、峰值和终点；`rotation` 为起止角度；`travel` 是相对锚点尺寸的横纵位移；`size` 为资源大小倍率。`anchor:"card"` 使用触发卡牌的捕获位置，找不到时回退到目标；`target` 使用事件目标，`bottom` 使用玩家底部区域。play/discard 的卡牌离场副本始终从该牌原位置开始。表现层对瞬时效果时长作上限约束，selfGuide 是底部引导的循环脉冲。

标准事件会使用 play、discard、guard 等表现 id；新增特殊命中只需引用新 id，新增全新事件类别则需要扩展通用表现映射。不能在表中写粒子绘制代码，也不能因视觉合并多段效果而减少实际伤害次数。

## 提交给整合前自查

- 数据能编译，引用资源实际存在且有来源，生成文件未经手改。
- 新内容能在对应入口获得或遭遇，不是只有表中有记录。
- 基础与升级文案、费用、目标、动态数值和实际效果一致。
- 条件不满足、没有可选牌、手牌满、目标死亡等分支有确定结果。
- 触发关注真实事件及正确拥有者；多个同名副本、复制后与回合末时序都正确。
- 新牌在主卡和图鉴中四层完整，比例、透明背景和颜色家族符合规范。
- 最终运行 `npm run check`、相关测试与构建，并执行实际浏览器操作。真机与用户验收另行记录。

需要的新机制若无法用这些操作表达，先提出可复用操作或事件，再同步修改 schema、解释器与回归；不要把一段卡牌专用代码藏进配置字符串。

正式语义回归提交到 `tests/`，由根命令 `npm test` 运行，干净克隆与 CI 使用同一套测试；临时脚本与历史本地原件继续留在 `.local/tests/`。验收副本、日志、截图和构建产物仍留在 `.local/`，不进入游戏运行依赖。自动检查、浏览器交互、真机和用户试玩须分别记录。
