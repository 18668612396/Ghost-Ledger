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
| `tools/content-editor/` | 独立可视化配置工坊，卡牌／怪物／关卡表单、正式规则预览及源表保存 |
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

只运行一套配置驱动引擎，不兼容旧存档。运行格式 `version:4 / ruleset:config-v1`；局内键 `ghost-ledger.run.v4`，局外键 `ghost-ledger.profile.v2`。每局固定规则配置快照，新玩法配置只用于新局；游戏卡图显示按卡牌 ID 解析当前 `visual.icon`，刷新后当前夜巡也能使用新图，不修改快照或进度。不同域名、端口各有独立浏览器存储。

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

素材总表为 `game/public/assets/art-manifest.json`，现有 217 PNG（196 运行资源 + 21 来源依赖）。101 条卡牌定义各用独立 `card-art-unique-<cardId>.png`，提示词、生成路径与哈希在 `card-unique-{a,b,c}-prompts.json`；基础与升级沿用同一主体，四套框及抽象背景继续复用。弃用的意图气泡原件、裁片及提示词保留在 `.local/temp/enemy-intent-sign-20261025/withdrawn/assets/`。历史素材归档仍需保留，活动素材的来源原件不能当垃圾删掉。

`game/public/assets/card-art-layouts.json` 保存 PNG 的 alpha 主体边界、偏移及四套卡框真实画窗中心。`npm run art:check` 校验来源哈希并生成 `game/src/generated/card-art-layout-data.js`；`game/src/card-art-layout.js` 为手牌、详情、图鉴与配置工具提供定位。不要通过改卡牌规则字段来微调图像，也不要将源 PNG 的透明边裁掉。

游戏的完整卡面和藏品小卡均调用 `getCardVisual(card, { latestArtwork: true })`，仅将已知 ID 的主体图更新到当前配置；默认调用保留传入对象的视觉字段，避免覆盖配置工坊中的同 ID 草稿。不要为更新图片而重写存档快照，也不能仅以图鉴展示通过代替继续夜巡验证。

点手牌看详情；单体牌上拖到具体敌人，自身牌下拖，群体牌上拖战场；拖出收回不弹详情。已付费的必选效果不能用空白或 Esc 跳过。详情、目标展示和重绘不能改变随机数或重新抽敌方意图。

## 命令与验证

在仓库根运行 `npm run dev`（默认 4210）、`npm run content:check`、`npm run art:check`、`npm run check`、`npm test`、`npm run check:skins`、`npm run build`、`npm run preview -- --port 4211`。`check:skins` 需要 Python/Pillow；其余只需 Node.js。具体职责见 `tools/README.md`。

`npm run editor` 启动独立的可视化配置工具（默认 `127.0.0.1:4213`），说明见 `tools/content-editor/README.md`。编辑先留在草稿；保存全表校验、检查外部修改、备份源文件，再生成正式配置。备份与候选文件位于 `.local/temp/content-editor/`，工具源码不进入游戏构建。

普通服务只提供游戏，构建预览只提供 `.local/dist/`。需要本地夹具时运行 `npm run dev:qa`，仅监听 `127.0.0.2:4212`，通过 `/evidence/` 提供 `.local/evidence/`。`v05-scenarios.html` 会改写该隔离来源的测试存档；不要在正常试玩来源注入受控场景。

2026-10-25 目录迁移后，129 项现有测试、构建、116 PNG 来源及 16 张 UI 切片检查均通过；两种卡牌裁片工具也已使用含 Pillow 的 Python 验证。该次配置版本为 `b0f18351bd641c415a41`。开发、预览和 QA 各 158 个游戏文件的 HTTP 字节检查，以及无本地测试／证据的干净副本构建通过。报告为 `.local/evidence/layout-migration-20261025.json`，详细覆盖见 `docs/DEVELOPMENT-V05.md`。该次目录迁移没有新增浏览器或真机验收。

随后完成 101 张逐牌专属主体替换，配置版本为 `899fc0a58aa01a26d6a9`，只改变卡牌主体引用，玩法与升级规则不变。143 项测试、217 PNG 来源检查及构建通过；主智能体逐张复核牌义、主卡与图鉴，浏览器测量全部 101 对布局最大中心误差约 0.0191 像素。实际游戏检查 390×844、320×568 的图鉴、手牌与详情，配置工具检查四家族预览。报告在 `.local/evidence/card-art-audit-20261025.json`；没有新增真机或用户视觉验收。

旧 `v05-*` 证据来自此前整合：有正常首战与受控场景验证，但没有真实手机测试，也没有正常数值下完整 16 层浏览器通关；难度、时长、手感及用户验收不能据此宣称通过。

后续优先结合用户反馈推进。主智能体可按 `AGENTS.md` 将独立任务交给同模型子智能体，但需亲自整合验证；未获明确要求不提交、推送或发布，获授权后的 Git 说明使用中文。

怪物意图只在点击怪物打开的详情里显示，战场没有气泡或短签。头顶血条、立绘、脚下名字和状态共用 `.enemy-encounter` 的浮动动画；地面影子抵消父层位移，仅保留呼吸效果，立绘内层不再叠加浮动。选择目标时点击怪物仍执行出牌。规则、配置版本与存档不变。短签草稿及对应检查保留在 `.local/temp/enemy-intent-sign-20261025/withdrawn/`；最新验证见 `docs/DEVELOPMENT-V05.md`。

用户已确认发布目标为 Web 与正式微信小游戏，缺口、共用边界及阶段验收记录在 `docs/RELEASE-PLAN.md`；当前尚未实施小游戏界面迁移或线上部署。Web 拖牌与点击选敌已加入头顶金色箭头，不可用时变暗；界面和实际出牌共用 `getCardEnemyTargets`。拖拽悬停在有效目标上时立绘泛白，不缩放或移动目标容器；自身牌等没有敌方目标的卡使怪物变暗，同时保留自身施放引导。拖拽开始记录命中矩形，悬停与松手复用，取消后清理。群体与随机牌显示所有可能目标；当前没有新增逐怪免疫规则，后续部分禁选还须同步效果目标解析。首次目标反馈的 18 场景证据在 `.local/evidence/drag-target-browser-20261025.json`；随后修正泛白、变暗和尺寸稳定，最新验证见 `docs/DEVELOPMENT-V05.md`。真机与完整 16 层正常通关仍未验收。

战斗背景在 `.world-background` 内部用两个伪元素叠加渐暗，顶部范围 24%、底部 44%，不对怪物、卡牌或 UI 使用整体滤镜。仅 `.in-combat` 启用，主页和地图不启用。`tools/check-art.mjs` 只为这两个背景选择器开放受限的中性暗色渐变；其他程序美术检查保留。
