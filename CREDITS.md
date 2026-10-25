# 制作来源与署名

更新：2026-10-25。本文按当前 v0.5 活动资源整理；路径以仓库根目录为基准。历史截图和归档位于 Git 忽略的 `.local/`，仅在保留了本地资料的工作区中可用。

## 游戏与程序

《夜渡 · 阴债录》的设计、规则、程序和交互由 Codex 制作流程实现。当前游戏美术和 UI 来自内置 `image_gen` 生成图片、原像素矩形裁片及用户授权的离线调色派生图，没有使用素材网站的第三方美术。音效由 Web Audio 实时合成，没有外部音乐或音效文件。

代码负责文字、数值、规则、状态、交互和排版，以及已有图片的切片、图集裁剪、缩放、位移、透明度和血条纹理裁剪；不通过 CSS、SVG 或 Canvas 绘制美术。游戏和本地服务使用浏览器与 Node.js 标准能力，没有第三方运行依赖或外部 CDN。字体调用设备已有楷体及系统回退字体，项目不分发字体文件。

战斗背景顶部与底部按用户要求叠加 CSS 渐暗，仅作用于背景层，作为 UI 可读性的明暗处理；场景原图、怪物、卡牌及其他界面素材保持原样，不新增或替代美术资源。

## 当前资源清单

当前 `game/public/assets/` 有 **217 张 PNG**：按来源形式分为 **162 张生成源图、40 张原像素矩形裁片、15 张调色派生图**；按用途分为 **196 张运行资源、21 张必要来源依赖**。两种分类统计同一批文件，不能相加。

完整登记以 [art-manifest.json](game/public/assets/art-manifest.json) 为准。记录包括文件名、用途、提示词文件及派生来源；裁片另有矩形坐标。早期文档中的 148／153 张等数字属于资源归档前的历史快照，不代表当前活动目录。

| 资源组 | 当前内容与用途 | 来源记录 |
| --- | --- | --- |
| 地府场景与沿用角色 | 浅青水彩街巷；纸童、蓝面缚魂役、铁面判官等沿用立绘 | [初始来源](game/public/assets/prompts.json)、[参考风格来源](game/public/assets/reference-prompts.json) |
| 主页、路线与界面图集 | 地图背景、路线笔触、头像、图标、导航物件、按钮与卷轴源图、香火球 | [主页来源](game/public/assets/hub-prompts.json)、[界面来源](game/public/assets/ui-prompts.json)、[参考风格来源](game/public/assets/reference-prompts.json) |
| 透明卡牌物件 | 九宫格透明物件的 9 张裁片，以及独立镜子、账簿 | [生成与编辑记录](game/public/assets/card-visual-prompts.json)、[矩形裁片记录](game/public/assets/card-art-slices.json) |
| 逐牌专属主体 | 101 张独立生成的正方形透明 PNG，覆盖常规牌、状态与诅咒；按牌名及效果设计，不在不同定义之间共用 | [A 组完整提示词](game/public/assets/card-unique-a-prompts.json)、[B 组完整提示词](game/public/assets/card-unique-b-prompts.json)、[C 组完整提示词](game/public/assets/card-unique-c-prompts.json) |
| 抽象卡牌背景 | 5 张源图集、15 张原像素裁片、15 张授权调色背景 | [抽象纹样来源](game/public/assets/card-pattern-prompts.json)、[裁片记录](game/public/assets/card-pattern-slices.json)、[调色记录](game/public/assets/card-color-adjustments.json) |
| 四套主卡框 | 攻伐朱砂红、护身青玉绿、灵术靛蓝、阴契绛紫；948×1659，宽高比 4:7 | [四色卡框来源](game/public/assets/card-frame-vivid-prompts.json) |
| 图鉴与背包小卡 | 中性纸框及红、绿、蓝、紫四套派生框；1122×1402，宽高比 4:5 | [中性小框](game/public/assets/collection-prompts.json)、[四类小框](game/public/assets/collection-frame-prompts.json) |
| 鬼火费用图 | `card-cost-flame.png`，由 `ref-energy.png` 经生成工具编辑；1254×1254 RGBA | [鬼火费用来源](game/public/assets/cost-flame-prompts.json) |
| 第一幕新增怪物 | 18 张独立 1254×1254 RGBA 立绘；泥灵大小变体共用同族图像，并与沿用角色一起覆盖 25 种敌人定义 | [怪物来源](game/public/assets/act1-enemy-prompts.json) |
| 地面阴影 | `enemy-shadow-hard.png`，2172×724；位图已有椭圆透视，程序只等比缩放、位移与改变透明度 | [阴影编辑来源](game/public/assets/appearance-refinement-prompts.json) |
| 战斗表现 | 9 张位图，用于燃烧、化灰、斩击、火、雷、咒、护身、魂光及自身目标引导 | [特效提示词](game/public/assets/fx-prompts.json) |

主卡框、抽象背景、透明主体和鬼火费用分别叠放，名称、类型和数值由代码排版。101 条卡牌定义各有一张独立主体图；同一定义的基础版与升级版沿用其主体。四套卡框与抽象背景继续共用。旧通用物件仍用于法器、事件与既有配置快照，不再承担不同卡牌的主体。视觉家族、机械类型和稀有度分别配置，四色不能解释为只有四类战斗规则。

本轮专属主体均使用内置 `image_gen` 逐张生成，保留原始 PNG 字节与 alpha。各组记录包含完整提示词、卡牌标识、生成原路径、尺寸和 SHA-256。居中只调整显示位置：[定位清单](game/public/assets/card-art-layouts.json) 保存主体边界、偏移与卡框画窗中心，不重绘、抠图或重采样生成素材。

当前 15 张调色背景保留源图、尺寸、alpha 与纹样；离线调色是用户明确授权的既有派生处理。旧的 4 张调色卡框已被重新生成的鲜明框替代，不计入当前 15 张调色背景。

## 裁片与透明通道

40 张裁片由 9 张透明物件、15 张抽象背景和 16 张 UI 切片组成。裁片保留源矩形内的 RGB 与 alpha，不重采样、不通过程序抠图或绘画。

| UI 源图 | 输出 | 数量 |
| --- | --- | --- |
| `ref-button.png` | 左、中、右三片；端帽各 260×426，中段 1592×426 | 3 |
| `ref-scroll.png` | 四角、四边、中心九片 | 9 |
| `ref-brushes.png` | 青、红、玉色笔触 | 3 |
| `map-path.png` | 路线笔触 `ref-path.png` | 1 |

切片坐标、尺寸和比例见 [ref-slices.json](game/public/assets/ref-slices.json)；生成提示词与精修历史见 [reference-prompts.json](game/public/assets/reference-prompts.json)。工具位于 [tools/slice-ui.py](tools/slice-ui.py)、[tools/slice-card-art.py](tools/slice-card-art.py) 与 [tools/slice-card-patterns.py](tools/slice-card-patterns.py)。按钮端点、卷轴四角保持比例，边与中心按规范平铺，详见 [UI 切片说明](docs/UI-SLICING.md)。

生成卡框和小框的纸面可能保留接近不透明的原始 alpha；运行时同位叠放已有 PNG，使卡纸遮挡后方画面，不通过重绘底色或降低整张牌透明度表达费用不足。费用鬼火保持独立图层；旧圆章和旧低饱和框不作为运行兜底。

## 历史来源与归档

旧具象背景、早期通用卡框、柔边阴影、旧费用圆章及已替换代码归档在 `.local/temp/v04-20261025/`。其中 [归档说明](.local/temp/v04-20261025/README.md) 和 [素材清单](.local/temp/v04-20261025/asset-archive-audit.json) 保存替换记录；这批文件不属于当前运行或构建依赖。提示词文件可能同时保留现用与历史资产的生成过程，应按活动清单判断用途。

历史迭代截图保留在 `.local/evidence/`。文件名前缀 `v03`、`v04-muted`、`v06`、`v07-corner-badge`、`v08-flame-cost` 是当时的界面迭代标签，不能据此前缀把产品版本称为 v0.8。旧记录中的素材数量与测试数量只说明当时的检查。

用户提供的地府风格参考图仅用于风格、质感、造型和配色参考。游戏使用另行生成的图片及其裁片，没有直接拷贝、裁剪或复用参考图像素。

## 玩法参考与验证边界

卡牌构筑、路线选择和内容解锁参考《杀戮尖塔》系列公开玩法资料；府邸、阴债、出门法器与修行是本作设计。研究日期、资料口径与边界见 [成长设计](docs/PROGRESSION-DESIGN.md)、[第一幕历史调研](docs/ACT1-EXPERIENCE-BASELINE.md) 和 [卡牌功能历史设计](docs/CARD-FUNCTION-ALIGNMENT.md)。原作资料不作为本项目美术素材来源。

当前内容与验证基线统一见 [v0.5 开发记录](docs/DEVELOPMENT-V05.md)。来源、像素和自动规则检查不能替代真实手机触控、完整冒险、难度、时长或用户视觉验收。
