# 幕、遭遇与怪物配置指南

2026-10-25，v0.5。本文对应 `game/content/acts.json`、`encounters.json`、`enemies.json`、`events.json` 和 `game/src/runtime/world.js`。这些源表都是以唯一 `id` 标识记录的 JSON 数组，经过内容编译器校验后交给游戏使用。改表可以新增同类内容；引入全新的规则操作时才需要扩展通用解释器。

## 一幕的组成

`acts.json` 记录初始牌组、生命、冥钱、香火、局内遗物、遭遇池、事件池、奖励牌池及地图规则。例如：

```json
{
  "id": "act1",
  "number": 1,
  "starting": {
    "maxHp": 80,
    "gold": 99,
    "energy": 3,
    "deck": [
      { "cardId": "ic_strike", "count": 5 },
      { "cardId": "ic_defend", "count": 4 },
      { "cardId": "ic_bash", "count": 1 }
    ],
    "relics": ["blood_ember", "lamp"]
  },
  "weakBattleCount": 3,
  "encounterPools": {
    "weak": "act1_weak",
    "strong": "act1_strong",
    "elite": "act1_elite",
    "boss": "act1_boss"
  },
  "eventPool": ["shrine", "market", "mushrooms", "gold", "debt_archive"],
  "cardPools": ["ironclad", "debt"],
  "specialCards": ["debt_loan", "debt_delay", "debt_register"]
}
```

实际源表 `specialCards` 列出完整 12 张阴债牌；示例省略其他九张。`cardPools` 决定通用卡池来源，`specialCards` 可声明这一幕额外允许的卡牌。奖励概率与选牌逻辑由 `game.js` 使用本幕 `rewards` 配置。

第一幕按一代 A0 节奏使用前 3 场普通战弱池，后续普通战强池；这是战斗次数，不是楼层。精英与事件战不占普通战弱池次数。全幕 16 层，第 1 层普通战，第 9 层宝箱，第 15 层休息，第 16 层首领。固定的是关键节奏，其他楼层的节点类型、数量、横向位置和连接都会随种子变化。

地图配置：

`difficultyModifiers` 也属于幕表，每项为 `{ "id": 1, "hpMultiplier": 1.15, "attackBonus": 2 }`。一重修行的普通生成生命乘 1.15 向上取整，每段攻击基础值加 2；分裂继承生命不再重复乘系数。增加难度档位仍只改表，预告与执行共用实例的 `attackBonus`。

```json
{
  "floors": 16,
  "columns": 3,
  "nodeCount": [2, 3],
  "fixedFloors": {
    "1": { "type": "battle", "count": 3 },
    "9": { "type": "treasure", "count": 1 },
    "15": { "type": "rest", "count": 1 },
    "16": { "type": "boss", "count": 1 }
  },
  "typeWeights": { "battle": 47, "event": 22, "elite": 11, "rest": 12, "shop": 8 },
  "branchChance": 0.46,
  "maxLinks": 2,
  "constraints": {
    "minFloor": { "elite": 6, "rest": 3, "shop": 2 },
    "maxFloor": { "elite": 13, "shop": 14, "event": 14, "battle": 14 },
    "noConsecutive": ["rest", "shop", "elite"]
  }
}
```

生成器会保留随机楼层的一条普通战分支，避免休息/商店限制把整排堵死。所有非首层节点有入口，所有非末层节点有出口。连边先取相邻列，在保持全图可达需要时补边；单节点分流到三列时允许三条出口。末层必须为首领。相同种子和相同内容生成相同地图。

新局保存内容快照，因此以后调整表格不会悄悄改变正在进行的夜巡。路线校验检查存下来的节点、边、完成路径与对应快照，不以“用今天的表重生成”替代验证。旧版存档是否继续使用由产品主线决定，世界模块没有旧引擎依赖。

## 遭遇表

每条遭遇有 `id`、`label`、`pools`、`weight`、`composition`。同一遭遇可加入多个池；传入遭遇 `id` 可以直接选择指定战斗。避开最近遭遇时，先过滤 `excludeIds`，只有整个候选池都被排除时才回退到完整池。

组合操作可以叠加：

| 字段 | 用途 | 示例 |
| --- | --- | --- |
| `fixed` | 固定敌人列表 | `{"fixed":["fungi","fungi"]}` |
| `variants` | 从完整组合中选择一个，可带权重 | `{"variants":[["spike_m","acid_s"],["acid_m","spike_s"]]}` |
| `slots` | 每个位置独立抽取，可重复 | `{"slots":[{"options":["louse_red","louse_green"],"count":3}]}` |
| `bag`、`count` | 从有限袋中不放回抽取 | 地精袋里胖、怒、匿刃各两只，巫师、持盾各一只，取四只 |

每场支持 1–5 只。第一幕配置为 4 弱、10 强、3 精英、3 首领，加 1 场三菌事件战。巫师和持盾不可能在普通地精组合里各出现两只，袋子里同名重复条目才允许出现重复角色。添加新的组合无需新增 recipe 分支。

## 怪物表与意图

怪物记录包含：

- `hpRange`、`art`、`artScale`、`name`、`kind` 与说明：数值和形象。
- `initial`：出生时状态，包括 `ai` 内部状态。这里的 `{ "random": [5,7] }` 只在出生时取样，例如纸蛛咬击强度。
- `moves`：动作字典，每项有 `label`、`effects`、可选 `after`。两组效果按先后执行同一解释器。
- `ai.rules`：按顺序查找第一个符合条件的规则。
- `triggers`：生命损失、出牌、敌方行动结束、死亡等事件触发器。
- `traits`：供界面展示的机制说明，不额外执行规则。

AI 规则三种选法：

```json
[
  { "when": { "op": "eq", "args": [{ "stat": "source.turns" }, 0] }, "move": "opening" },
  { "when": { "stat": "source.ai.defensive" }, "sequence": { "moves": ["guard", "counter"], "index": { "stat": "source.ai.step" } } },
  { "weighted": [{ "move": "strike", "weight": 70, "maxRepeat": 2 }, { "move": "charge", "weight": 30, "maxRepeat": 1 }] }
]
```

每次完整行动后游戏增加 `turns`，记录 `ai.history`。计划下一步时更新 `ai.lastMove`、`ai.allyCount`。`sequence.loop` 默认为 true；false 表示序列结束后停在最后一步。状态机通过通用 `set` 修改 `source.ai`，没有怪物 id 专用分支。

意图采用同一份效果列表预告与执行。伤害、段数、格挡等数值在预告时快照；力量、虚弱、易伤在显示和命中时实时修正。`set.value`、条件与分裂继承生命仍在实际结算时读取。例如六灯第二轮根据预告时的当前生命确定每段基础值，而泥灵子体继承执行分裂时母体的最终剩余生命。

护符小鬼选定盟友时把其 `uid` 存入意图和效果。盟友随后离场会让本次护盾回到小鬼自身；不会把已预告的护盾突然改成攻击。

触发器共有格式：

```json
{
  "id": "one_time_curl",
  "event": "hpLost",
  "when": {
    "op": "and",
    "args": [
      { "stat": "event.attack" },
      { "op": "gt", "args": [{ "stat": "event.hpLoss" }, 0] },
      { "op": "gt", "args": [{ "stat": "source.curlUp" }, 0] }
    ]
  },
  "effects": [
    { "op": "block", "target": "source", "amount": { "stat": "source.curlUp" } },
    { "op": "set", "target": "source", "path": "curlUp", "value": 0 }
  ]
}
```

生命事件提供 `event.targetUid`、`sourceUid`、`hpLoss`、`attack`、`cause`；出牌事件提供 `cardType`、`cardId`；`enemyActionEnd` 提供 `actorUid`、`move`。每只怪的生命/死亡事件默认限制到自身，行为事件默认限制到行动者。需要跨目标机制时应明确定义新的通用事件，而不是绕开事件所有权。

第一幕复杂规则均由数据组合表达：半血改分裂意图、实际受伤才蜷缩/愤怒、自然睡醒与受惊停顿、判官形态转换阈值递增、攻击牌级别的反击、六灯灼伤升级、金币盗窃与逃跑。

需要在怪物脚下显示动态机制提示时，可在某个 `traits` 项内增加 `display`，例如：

```json
{
  "display": [
    {
      "when": { "op": "eq", "args": [{ "stat": "source.ai.phase" }, "offense"] },
      "text": "转形还需 {remaining} 伤害",
      "textValues": { "remaining": { "stat": "source.ai.shiftRemaining" } }
    },
    {
      "when": { "op": "eq", "args": [{ "stat": "source.ai.phase" }, "defense"] },
      "text": "防御形态 · 谨慎攻击"
    }
  ]
}
```

`display` 是可选展示数据，不执行战斗效果。界面按条件筛选并代入数值，因此新的阶段提示无需再在界面中判断怪物 id。

## 事件配置

每个事件记录 `id`、`title`、`description`、`choices`。选择项有同名三字段及 `effects`，可有 `when` 控制当前是否可选择，或 `encounterId` 发起事件战。

可用通用事件操作包括恢复、失去生命、获得/花费冥钱、永久加牌、借债、还债与遗物。休息、商店和宝箱是共用节点服务，不需要每个事件重新实现。当前五类事件涵盖用生命换牌、借债换钱、恢复、三怪事件战、付费销账及购买延灯牌；安全退出选项始终可用。

## 验证记录与边界

编译器与浏览器存档检查共用 `content-schema.js`。错误会指向如 `enemies[cultist].ai.rules[1].weighted[0].weight` 的具体记录与字段。校验包含表达式操作及参数数量、引用和素材名、初始状态、效果必填字段、可修改状态白名单、AI候选与重复限制、遭遇组合数量、地图楼层范围、奖励概率、事件出口和特效关键帧。

AI需要一条不会因条件或连续使用上限而耗尽的默认规则；事件至少保留一个无条件可选出口。`set`只能写允许的数值状态或安全的 `ai.*` 路径，不能改身份、任意对象或原型。配置不接受代码、函数、循环对象或多个混在一起的表达式标记。校验不会限制内容必须恰好75张牌或25种怪物。

`node --test .local/tests/content-validation.test.mjs`：21 项通过，包含现有表的正向检查、无需改代码的扩展内容，以及一百多处错误变异。地图预检还发现并修正了保底战斗分支绕过楼层限制的问题。

`node --test .local/tests/configured-world.test.mjs`：14 项通过。覆盖 600 种子路径合法性和变化、8,000 次遭遇抽样、每种怪物 20 轮受保护的通用效果结算、全部关键行为、按幕配置难度修正，以及只新增配置的自定义怪物和七层幕。

`node --test .local/tests/configured-adventure.test.mjs`：16 项通过。直接运行游戏阶段流，覆盖前三场弱池后转强池、事件战与精英不占普通战计数、商店购买与跨店删牌涨价、休息与永久升级、事件成本和加牌、宝箱、卡牌选择队列保存恢复、胜负重开、幕专属卡池、内容快照和存档拒错。一条真实生成的 16 层路线从地图走到首领胜利；该用例将敌人生命控制为 1 来验证流程连通，不用于证明数值平衡或真实玩家可通关。

这些是规则与配置验证，未代替最终浏览器交互验收。地图仍采用三列以保证竖屏可读性；它对齐一代第一幕关键节奏和怪物机制，但不是原版完整七列地图生成算法。扩展幕的实际可玩难度仍需在对应卡池与资源预算下试玩调整。

数值来源与对齐范围沿用 [第一幕体验对齐调研](ACT1-EXPERIENCE-BASELINE.md)；原创怪物名称、美术资产及提示词来源在美术清单中维护。
