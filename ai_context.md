# 夜渡·阴债录：开发接手说明

更新：2026-10-25（Asia/Shanghai）。最新用户指令优先；本文件说明当前工程，不延续旧会话的后台任务或授权。

## 先读与定位

- 仓库：`E:\GitHub\Ghost-Ledger`，游戏为《夜渡·阴债录》v0.5.0。
- 先读根 `AGENTS.md`、`README.md`，再按任务阅读 `docs/ARCHITECTURE-V05.md`、`docs/CONTENT-AUTHORING-V05.md` 或 `docs/ART-STANDARDS-V05.md`。
- 本轮已从旧 `RandomGames` 布局迁入独立仓库结构；不要再使用旧路径或假设服务仍然在线。
- 技术为原生 JavaScript ES Modules、HTML/CSS、Node.js 20+ 静态服务，无第三方运行依赖，不需要 `npm install`。
- Git 状态必须现场检查；不能沿用旧交接中的已跟踪文件、分支或提交记录。本轮已将此前被跟踪的 `.local/` 从索引移除，保留本地文件；目录整理未由智能体提交或推送。

## 目录约定

所有文件路径以仓库根为基准：

| 目录 | 职责 |
| --- | --- |
| `game/index.html`、`game/src/` | 游戏入口、规则、视图、输入和表现 |
| `game/content/` | 七张策划 JSON 源表 |
| `game/public/assets/` | 游戏素材、来源清单与生成提示词 |
| `tools/` | 配置编译、开发服务、构建、测试入口及素材处理工具 |
| `docs/` | 正式设计、配置指南、架构和开发记录 |
| `.local/tests/` | 本地测试源码 |
| `.local/evidence/` | 记录、截图与 QA 夹具 |
| `.local/dist/` | 可独立服务的静态游戏构建 |
| `.local/temp/` | 临时文件、原工具备份、旧代码与旧构建归档 |

`.local/` 全部由 `.gitignore` 忽略。测试源码也按用户要求位于这里，新克隆不自带测试和历史证据；没有测试时不能宣称 `npm test` 通过。普通游戏与构建不依赖本地测试或证据，归档不能作为运行兜底。

## 产品与规则边界

手机竖屏、第一人称、中式地府志怪卡牌肉鸽，战场不放第三人称玩家小人。流程为府邸 → 模式与行装 → 随机分支地图 → 战斗／事件／商店／休息 → 首领 → 结算与成长。

当前有 101 条卡牌定义（75 铁甲战士功能对应牌、12 阴债牌、6 状态、8 诅咒）、19 个能力、25 种敌人、21 个遭遇、1 幕、5 个事件及 9 个特效配置。第一幕 16 层，同场最多 5 怪；只开放阴路夜巡，首领胜利结束当前冒险，没有第二幕衔接、APK 或云存档。

新局 80 生命、99 冥钱、10 张基础牌；通常每回合 3 香火、抽 5 张。借火 +1 香火、+2 阴债，每回合最多两次；巡更回合 +2 到期，每点未偿本金扣 2 生命，无视护甲。还愿花 1 香火偿还最多 2 债，联动只认实际偿还；普通／精英战后借据保留，首领胜利勾销不算偿还。

只运行一套配置驱动引擎，不兼容旧存档。运行格式 `version:4 / ruleset:config-v1`；局内键 `ghost-ledger.run.v4`，局外键 `ghost-ledger.profile.v2`。每局固定配置快照，新表只用于新局。不同域名、端口各有独立浏览器存储。

## 唯一工程链路

`game/content/*.json → tools/compile-content.mjs → game/src/generated/content-data.js → game/src/engine.js → runtime/game + world + effects → 状态与事件 → 视图与表现`

以下运行时文件均位于 `game/src/`：

- `runtime/content-schema.js`：共享严格配置校验；`expressions.js`：安全 JSON AST 与种子随机数。
- `runtime/effects.js`：通用效果、触发队列、结算帧与必选牌；`world.js`：地图、遭遇与声明式 AI；`game.js`：阶段、动作与存档校验。
- `engine.js` 是唯一公共 API。`main.js` 协调页面、输入和保存；动画只消费事件，不重新结算规则。
- 卡牌、怪物等优先通过源表组合通用机制；真正的新机制需同步扩展 schema、共享执行器、配置指南和独立语义回归。法器、药物和模式尚未完全表格化。
- `pendingChoice / effectQueue / resolutionFrames` 序列化后继续同一结算，不重复付费。能力区不等于消耗区，战内临时费用与成长不自动写回永久牌。
- `tools/paths.mjs` 集中定义仓库／游戏／本地目录；工具不应依赖调用时的工作目录。

## 美术与交互

美术必须有正规来源或使用 `image_gen`，保留完整提示词和必要原件；禁止代码直接绘制美术。现行风格是浅青水彩、旧纸墨线、暖灯笼及鲜明红／绿／蓝／紫卡框。费用使用青蓝鬼火，卡面纸张不透明，按钮三切片、卷轴九切片，游戏外纯深色。

素材总表为 `game/public/assets/art-manifest.json`，现有 116 PNG（95 活动资源 + 21 来源依赖）；87 种可用牌复用背景与透明物件，不是每牌独立新插图。历史素材归档仍需保留，活动素材的来源原件不能当垃圾删掉。

点手牌看详情；单体牌上拖到具体敌人，自身牌下拖，群体牌上拖战场；拖出收回不弹详情。已付费的必选效果不能用空白或 Esc 跳过。详情、目标展示和重绘不能改变随机数或重新抽敌方意图。

## 命令与验证

在仓库根运行 `npm run dev`（默认 4210）、`npm run content:check`、`npm run check`、`npm test`、`npm run check:skins`、`npm run build`、`npm run preview -- --port 4211`。`check:skins` 需要 Python/Pillow；其余只需 Node.js。具体职责见 `tools/README.md`。

普通服务只提供游戏，构建预览只提供 `.local/dist/`。需要本地夹具时运行 `npm run dev:qa`，仅监听 `127.0.0.2:4212`，通过 `/evidence/` 提供 `.local/evidence/`。`v05-scenarios.html` 会改写该隔离来源的测试存档；不要在正常试玩来源注入受控场景。

2026-10-25 目录迁移后，129 项现有测试、构建、116 PNG 来源及 16 张 UI 切片检查均通过；两种卡牌裁片工具也已使用含 Pillow 的 Python 验证。配置版本仍为 `b0f18351bd641c415a41`。开发、预览和 QA 各 158 个游戏文件的 HTTP 字节检查，以及无本地测试／证据的干净副本构建通过。报告为 `.local/evidence/layout-migration-20261025.json`，详细覆盖见 `docs/DEVELOPMENT-V05.md`。本轮没有新增浏览器或真机验收。

旧 `v05-*` 证据来自此前整合：有正常首战与受控场景验证，但没有真实手机测试，也没有正常数值下完整 16 层浏览器通关；难度、时长、手感及用户验收不能据此宣称通过。

后续优先结合用户反馈推进。主智能体可按 `AGENTS.md` 将独立任务交给同模型子智能体，但需亲自整合验证；未获明确要求不提交、推送或发布，获授权后的 Git 说明使用中文。
