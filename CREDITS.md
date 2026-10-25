# 制作来源与署名

## 游戏与程序

《夜渡 · 阴债录》的设计、规则、程序和交互由本次 Codex 制作流程实现。全部游戏美术和 UI 来自 OpenAI 内置 `image_gen` 生成的源图、矩形裁片及用户授权的调色派生图，没有使用素材网站的第三方美术。音效由 Web Audio 实时合成，没有外部音乐或音效文件。

代码负责文字、数值、规则、状态、交互和排版，以及已有图片的九切片、图集裁剪、缩放、位移、透明度和血条纹理裁剪；不通过 CSS、SVG 或 Canvas 绘制美术。

游戏和本地服务使用浏览器与 Node.js 标准能力，没有第三方运行依赖或外部 CDN。字体调用设备已有楷体及系统回退字体，项目不分发字体文件。

## 生成美术

项目共有 **153 张 PNG：79 张生成源图、55 张原像素裁片、19 张直接调色派生图**，均位于 `public/assets/`。包含历史资源、当前四个鲜明卡框、15 张增饱和抽象背景、透明物件、青蓝鬼火费用图、第一幕新增的18张怪物立绘及背包中性／四色小卡片。完整来源登记见 [art-manifest.json](public/assets/art-manifest.json)；裁片记录 `derivedFrom` 与矩形 `crop`，调色记录原文件与参数。

### 图鉴与背包小卡片（5 张）

`collection-slot.png` 为内置`image_gen`新生成的1122×1402 RGBA纸质小卡片，用于图鉴、牌组、抽弃牌堆、消耗堆和行囊网格。原图逐字节复制入项目，未用代码绘画、抠图或调色；提示词、透明背景要求和哈希见 [collection-prompts.json](public/assets/collection-prompts.json)。外围透明，纸面中心alpha253，运行时用相同PNG的两层同位组合提高纸面遮挡程度；两层均等比显示，不随文案拉伸。透明图标与鬼火费用复用已有素材。

`collection-frame-{strike,ward,spirit,oath}.png` 为分别调用内置`image_gen`编辑中性小框得到的红、绿、蓝、紫四套1122×1402源图。编辑目标为`collection-slot.png`，各自以对应`card-frame-vivid-*`主卡框作颜色参考；只改变边框与角饰色彩，保留紧凑纸面。完整提示词、输入角色、尺寸及哈希见 [collection-frame-prompts.json](public/assets/collection-frame-prompts.json)。四图均逐字节复制原生成结果，没有代码染色、拉伸或改画；百鬼与物品继续使用中性底图。

### 此前源图与历史资源（19 张）

| 分组 | 文件 | 提示词记录 |
| --- | --- | --- |
| 场景、敌人与旧卡图（5） | `background.png`、`paper.png`、`collector.png`、`judge.png`、`card-art.png` | [prompts.json](public/assets/prompts.json) |
| 早期 UI 与页签资源（9） | `ui-paper.png`、`ui-dark.png`、`ui-card.png`、`ui-buttons.png`、`ui-icons.png`、`ui-badges.png`、`ui-meters.png`、`ui-logo.png`、`ui-favicon.png` | [ui-prompts.json](public/assets/ui-prompts.json) |
| 主页与路线来源（5） | `home-background.png`、`map-background.png`、`ui-card-clean.png`、`ui-quiet-panel.png`、`map-path.png` | [hub-prompts.json](public/assets/hub-prompts.json) |

这些文件保留生成来源与版本历史；当前主卡牌插画使用下文的透明独立 PNG，旧 `card-art.png` 和带青色底块的 `ref-card-art.png` 保留为历史与编辑来源。

### 本轮参考风格源图（10 张）

以下源图的生成提示词、参数和精修记录统一见 [reference-prompts.json](public/assets/reference-prompts.json)。

| 文件 | 用途 |
| --- | --- |
| `ref-scene.png` | 浅青水彩地府街巷、石桥与牌坊场景 |
| `ref-avatar.png` | 鬼差头像与小鬼火 |
| `ref-icons.png` | 4×4 界面图标图集，显示单元为方形 |
| `ref-nav.png` | 3×2 独立导航物件图集，显示单元为方形 |
| `ref-button.png` | 蓝绿纸面按钮源图，供三切片使用 |
| `ref-scroll.png` | 羊皮纸卷轴源图，供九切片使用 |
| `ref-card.png` | 2:3 原符牌框，当前保留为卡面精修的来源与历史 |
| `ref-brushes.png` | 青、红、玉色三行手绘状态笔触 |
| `ref-energy.png` | 方形香火球图标 |
| `ref-card-art.png` | 此前带青色底块的水彩九宫格插画，保留为透明版的编辑来源 |

`ref-button.png` 的蓝绿内部通过 `image_gen` 精修为均匀、低对比细纸纹，以减少平铺接缝；保留初次生成提示词和精修提示词。源图未通过代码均色、模糊或重绘。

### 早期柔边阴影（1 张，历史）

[enemy-shadow.png](public/assets/enemy-shadow.png) 由内置 `image_gen` 生成，原图 2172×724，保留生成的透明通道。完整提示词与透明背景参数见 [shadow-prompts.json](public/assets/shadow-prompts.json)。圆形接触阴影的椭圆透视已在位图中完成；程序只等比缩放、移动和改变透明度，未绘制圆形、渐变或投影。

加入阴影后的 46 张 PNG 来源检查、16 张原像素裁片校验及生产构建通过；三种怪物与短屏、超高窗口的实际浏览器检查记录见 README 中的后续排布调整记录。

### 硬边阴影与卡面精修（2 张）

使用内置 `image_gen` 分别编辑原阴影与原卡框，保留两个原文件。完整提示词与编辑目标见 [appearance-refinement-prompts.json](public/assets/appearance-refinement-prompts.json)。

| 文件 | 用途 |
| --- | --- |
| [enemy-shadow-hard.png](public/assets/enemy-shadow-hard.png) | 当前硬边阴影，2172×724；外围透明，边缘过渡收紧，提高运行时不透明度 |
| [card-frame-opaque.png](public/assets/card-frame-opaque.png) | 此前通用卡框，1024×1536；保留为分类卡框的编辑来源与历史 |

生成卡框纸面 alpha 仍为 252–254；没有通过脚本改像素或画底色，渲染时仅叠放同一生成位图。三层叠放后的纸面在 8 位显示精度下为不透明。费用不足与按下状态也不再降低整张卡牌的不透明度。

### 此前卡牌类型色与透明插画（5 张源图、9 张裁片）

本轮通过内置 `image_gen` 编辑原卡框和原九宫格插画，并另行生成镜子与账簿。全部请求启用 `transparent_background: true`，保存原始生成 alpha，不通过脚本抠图、染色、模糊或绘画。完整提示词、参考图、连接失败后的同词重试及派生记录见 [card-visual-prompts.json](public/assets/card-visual-prompts.json)。

| 文件 | 用途 |
| --- | --- |
| `card-frame-attack.png` | 历史朱红攻击卡框，2:3 |
| `card-frame-skill.png` | 历史青玉术法卡框，2:3 |
| `card-art-cutouts.png` | 编辑原九宫格，移除青色方底、云烟底托和飘散装饰，保留九个独立物件 |
| `card-art-mirror.png` | 照骨镜的铜镜与骨影，替代此前误用的铃铛 |
| `card-art-ledger.png` | 销账书的勾销账簿，替代此前复用的印章 |
| `card-art-{brush,talisman,chain,step,fire,bell,seal,coin,lotus}.png` | 透明九宫格的 9 张原像素矩形裁片，供所有插画使用位置等比显示 |

裁片来源和精确矩形见 [card-art-slices.json](public/assets/card-art-slices.json)；[slice-card-art.py](scripts/slice-card-art.py) 只分割等大网格，不改 RGB、alpha 或尺寸。可在安装 Pillow 的 Python 中运行 `python scripts/slice-card-art.py --verify`，只读比较裁片每个像素并检查真实透明背景与卡纸不透明度。正常试玩、检查和构建仍只需 Node.js。

此前两种卡框的纸面检查区域最低 alpha 均为 252，检查保留历史。当前前景继续使用这些透明物件图标，框与背景改用下述竖版素材。

### 四层结构与具象背景方案（7 张源图、15 张裁片）

[card-layer-prompts.json](public/assets/card-layer-prompts.json) 记录中性框 `card-frame-wash.png`、旧费用圆章 `card-cost-spirit.png` 和五张 `card-scenes-01.png` 至 `05.png`。具象场景按原像素裁出 15 张 `card-bg-*.png`，来源矩形见 [card-scene-slices.json](public/assets/card-scene-slices.json)。中性框、具象背景及旧费用圆章均保留历史，当前费用改用下文的整团青蓝鬼火。

### 此前低饱和类型框与抽象竖背景来源（7 张源图、15 张裁片）

全部由内置 `image_gen` 生成，完整提示词和输入角色见 [card-pattern-prompts.json](public/assets/card-pattern-prompts.json)。没有通过代码染色、抠图、画纹样或拉长原 2:3 卡框。

| 文件 | 用途 |
| --- | --- |
| `card-frame-muted-attack.png` | 灰赭朱攻击框，原图 948×1659，宽:高 4:7 |
| `card-frame-muted-skill.png` | 灰青蓝术法框，原图 948×1659，宽:高 4:7 |
| `card-patterns-01.png` 至 `05.png` | 每张 1881×836、9:4 图集；每格为独立 3:4 抽象竖纹样 |
| `card-pattern-{id}.png`，15 张 | 627×836 原像素裁片，按卡牌 ID 配置；雷纹、墨痕、音波、涟漪等意象 |

裁切坐标见 [card-pattern-slices.json](public/assets/card-pattern-slices.json)。[slice-card-patterns.py](scripts/slice-card-patterns.py) 只作矩形分割；`--verify` 只读比较像素、检查背景不重复且完全不透明，并检查框的透明画窗、纸面及费用章。正常运行不需要 Python。

该版框与低饱和显示效果保留历史；15 张 `card-pattern-{id}.png` 仍作为当前背景的调色来源。框、背景、透明图标与费用章的四层配置见 [card-visuals.js](src/card-visuals.js)，整卡保持 4:7、背景保持 3:4。

### 直接调色派生（19 张：4 张历史框、15 张当前背景）

用户此前要求直接调整现有 PNG，主流程用 Python 离线调色，保留 alpha、尺寸、比例和纹样；来源、参数及文件哈希见 [card-color-adjustments.json](public/assets/card-color-adjustments.json)。这些是原生成美术的有记录派生，不是程序绘制的新纹样。

| 文件 | 数量与状态 |
| --- | --- |
| `card-frame-color-{strike,ward,spirit,oath}.png` | 4 张，仅保留历史；随后被用户要求重新生成的鲜明框替换 |
| `card-pattern-color-{id}.png` | 15 张，当前背景；逐张源自 `card-pattern-{id}.png` |

### 当前鲜明四色框（4 张全新生成源图）

用户最新要求覆盖此前卡框“不再生图”的限制，四个框重新通过内置 `image_gen` 生成；完整提示词、透明参数及生成来源见 [card-frame-vivid-prompts.json](public/assets/card-frame-vivid-prompts.json)。框均为 948×1659、宽:高 4:7，保留生成的透明通道；页面继续用同位叠图保持标题和规则纸面不透明，背景、透明图标与费用章分别叠放。新框的画窗、轮廓外与纸面检查见 [alpha 记录](evidence/v06-vivid-frame-alpha.json)，四套完整效果及手机尺寸的实际浏览器检查见 README 的最新修订记录。

| 文件 | 视觉分组与颜色 |
| --- | --- |
| `card-frame-vivid-strike.png` | 攻伐，朱砂红 |
| `card-frame-vivid-ward.png` | 护身，青玉绿 |
| `card-frame-vivid-spirit.png` | 灵术，靛蓝 |
| `card-frame-vivid-oath.png` | 阴契，绛紫 |

四组分别覆盖 3／4／3／5 张牌，只控制视觉归属；战斗机制仍为 7 张攻击、8 张术法，牌面继续显示原类型。新框允许达到历史红绿版的鲜明饱和度，15 张背景继续使用增饱和调色版本，透明物件保持不变。

### 当前火焰费用图（1 张全新生成源图）

`card-cost-flame.png` 由 `ref-energy.png` 经内置 `image_gen` 编辑生成，保留透明通道；完整提示词、参考图和来源见 [cost-flame-prompts.json](public/assets/cost-flame-prompts.json)。主体是整团青蓝鬼火，浅青焰心留给数字，不含圆章、金环或符牌。旧 `card-cost-spirit.png` 和 v07 圆章布局仅作历史，四个鲜明框与 15 张抽象背景保持不变。

位图等比宽度为卡宽 28%，焰心中心锚定卡宽 8%、卡高 5%；图像平移 `-50% / -64%`，数字水平居中、位于位图高度 64%。鬼火少量外凸并与卡框衔接，牌名仍整卡居中。费用数字由代码排版：手牌 20／18／16px、详情 34px（小屏 27px）、奖励 18px。新素材为1254×1254 RGBA，逐字节保留生图结果，轮廓外透明、焰心 alpha252；见 [素材检查](evidence/v08-flame-cost-alpha.json)。

### 第一幕原创怪物立绘（18 张全新生成源图）

本轮使用内置 `image_gen`，参照既有 `paper.png`、`collector.png`、`judge.png` 的地府水彩、墨线、旧纸、朱红、青玉和暖金细节，补齐普通怪、精英与首领所需的原创角色。初次生成的三张六角色图集出现跨格肢体，因此只作造型参考，没有直接裁片或加入运行素材；最终逐只生成独立正方形 PNG。完整提示词、造型参考图集的提示词和路径、透明参数及来源见 [act1-enemy-prompts.json](public/assets/act1-enemy-prompts.json)。

| 文件 | 对应地府造型 |
| --- | --- |
| `enemy-cultist.png` | 持烛纸袍祭师 |
| `enemy-jaw.png` | 獠牙噬梦兽 |
| `enemy-louse_red.png`、`enemy-louse_green.png` | 赤／青折纸鬼蛛，各自独立造型 |
| `enemy-acid.png`、`enemy-spike.png` | 青绿腐泥灵／紫黑刺泥灵，大小变体等比使用同族立绘 |
| `enemy-slaver_red.png` | 赤面链钩缚魂役 |
| `enemy-looter.png` | 钱袋窃钱鬼 |
| `enemy-fungi.png` | 菌伞鬼童 |
| `enemy-gremlin_mad.png`、`enemy-gremlin_shield.png`、`enemy-gremlin_sneaky.png`、`enemy-gremlin_wizard.png` | 暴躁、持盾、双刀、施符四种独立鬼怪 |
| `enemy-nob.png` | 牛首怒魇力士 |
| `enemy-lagavulin.png` | 棺内沉眠守夜鬼 |
| `enemy-sentry.png` | 单只悬浮镇魂石碑，三碑战分别放置实例 |
| `enemy-slime_boss.png` | 冥河泥王 |
| `enemy-hexaghost.png` | 鬼面与六盏魂灯组成的六灯亡魂 |

18 张最终立绘均为 **1254×1254 RGBA**，保留生成输出字节，没有代码抠图、染色、重绘或重采样；真实透明区域及边缘 alpha 按源图保留。逐张尺寸、主体边界、角落 alpha、源字节一致性和 SHA-256 见 [act1-enemy-asset-audit.json](evidence/act1-enemy-asset-audit.json)。地面阴影继续单独使用 `enemy-shadow-hard.png`，没有烘进立绘。第一幕另外沿用 `paper.png` 表现迟钝纸童、`collector.png` 表现蓝面缚魂役、`judge.png` 表现铁面判官；同种怪物的同场实例不共享战斗状态。

这些文件名只表示怪物视觉身份，第一幕机制对照与行为数据单独维护；新增怪物美术不直接复用《杀戮尖塔》的角色图像。怪物在多敌人战场中的实际大小、意图与血条排布由主流程继续验收，本节不把素材检查当成整场游戏或手机验收。

### 原像素裁片（16 张）

下表花括号表示同前缀文件名逐项展开。每片的原图、精确裁区、尺寸和比例见 [ref-slices.json](public/assets/ref-slices.json)，派生记录亦收录于 [reference-prompts.json](public/assets/reference-prompts.json)。

| 源图 | 输出裁片 | 数量 |
| --- | --- | --- |
| `ref-button.png` | `ref-button-{left,middle,right}.png`；左右端各 260×426，中段 1592×426 | 3 |
| `ref-scroll.png` | `ref-scroll-{tl,t,tr,l,c,r,bl,b,br}.png`；四角、四边和纸面中心 | 9 |
| `ref-brushes.png` | `ref-brush-{teal,red,jade}.png`；三行独立笔触 | 3 |
| `map-path.png` | `ref-path.png`；主笔触外围矩形，2091×64 | 1 |

裁片只做矩形裁切，保留裁区内原始 RGB 和 alpha，没有重采样或抠图；按钮端点与卷轴四角按统一比例使用，边与中心平铺。实现及开发校验见 [UI-SLICING.md](docs/UI-SLICING.md)。

用户最初的 `ChatGPT Image 2026年5月10日 02_34_40.png` 及本轮上传的地府参考图仅用于风格、质感、造型和配色参考。游戏未直接拷贝、裁剪或复用参考图，使用的是另行生成的源图及其裁片。

## 玩法参考与验证记录

卡牌构筑、路线选择和内容解锁参考《杀戮尖塔》系列的公开玩法资料；府邸、阴债、法器和三项修行为本原型的具体设计。两代作品的核验来源、区别与资料日期见 [PROGRESSION-DESIGN.md](docs/PROGRESSION-DESIGN.md)。

2026-10-24：58 项规则测试、45 张素材来源检查、16 张裁片逐像素与比例校验及生产构建通过。v0.3 已在浏览器实际完成通关、失败、回府与再次出门，并检查 390×844、360×740、320×568 三种视口、拖牌和卡牌预览；记录与本轮 `evidence/v03-*.jpg` 链接见 [README.md](README.md)。`evidence/v02-*.jpg` 及更早记录仅是旧版验收历史。真实手机及最终体验仍待用户试玩验收。

2026-10-25：四个鲜明框的 `evidence/v06-*` 来源、alpha 与界面检查保留记录；低饱和版 `evidence/v04-muted-*` 和旧圆章 `evidence/v07-corner-badge-*` 均为历史。火焰费用的实际浏览器检查见 `evidence/v08-*`，覆盖四套卡面、390与320宽度的手牌和详情、零费用与点击费用图查看详情；本轮未重测原生拖拽，真机与用户最终验收仍待完成。
