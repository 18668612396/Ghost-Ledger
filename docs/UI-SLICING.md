# 位图 UI 切片契约

路径以仓库根为基准。本文的 2026-10-24 检查数字是历史记录；当前产品卡面比例和分层以 [v0.5 美术规范](ART-STANDARDS-V05.md) 为准。

按钮和卷轴采用独立 PNG 切片，保留端点、四角与纸面纹理比例。依据 [Unity 官方 9-slicing 的 Tiled 模式](https://docs.unity3d.com/Manual/sprite/9-slice/9-slicing.html)：四角保持尺寸，顶底边横向重复，左右边纵向重复，中心在两个方向重复。这里使用 DOM、CSS Grid 与原 PNG 裁片实现，不使用 Canvas、SVG 或程序绘图。

## 接入

在 `game/index.html` 引入 `game/src/skins.css`；在 `main.js` 导入 `decorateSkins`，每次更新 `app.innerHTML` 后调用 `decorateSkins(app)`。函数可重复调用，不重复插入图层，移除节点后会解除尺寸观察。

只装饰 `.primary-button`、`.secondary-button`、`.borrow-button`、`.repay-button`、`.end-button`、`.event-choice`。不会给图标、导航、卡牌、怪物、地图节点等自动铺底板。

按钮追加 `.skin-host.skin-button-host`，首个子节点 `.bitmap-skin.skin-layer-button` 内有 `left`、`middle`、`right` 三片。卷轴只匹配 `.parchment-modal.paper-panel` 与 `.scroll-surface`，追加 `.skin-host.skin-scroll-host`，其图层内有 `tl/t/tr/l/c/r/bl/b/br` 九片。图层均 `aria-hidden`、`pointer-events:none`、`z-index:-1`，宿主 `position:relative; isolation:isolate`，不干扰文字、图标和事件。

主布局 CSS 负责按钮高度、文字和内边距。测量使用宿主的 `offsetWidth`、`offsetHeight`，读取未变换的布局尺寸；不使用受悬停 `scale()` 等变换影响的 `getBoundingClientRect()`，避免把变换再次计算进皮肤。按钮端点使用布局高度除以源高的统一缩放比，中间只横向平铺。卷轴默认使用布局宽度除以源宽的统一缩放比，高度变化只增加或裁去平铺面积；可设置数值 `--skin-scroll-scale` 改用固定缩放比。过窄或过矮时统一缩小所有切片以保留正数中心区域，不单独压扁四角。

宿主提供 `--skin-left/right/top/bottom` 和按钮 `--skin-cap-left/right` 像素变量。按钮可预留 `max(18px,var(--skin-cap-left))` 等横向 padding；卷轴可用 `max(18px,var(--skin-top))` 等预留四边。源图生成后需结合装饰内容检查文字留白，padding 不由装饰函数强制更改。

每片背景以 `原宽×统一缩放比`、`原高×统一缩放比` 设置尺寸，绝不使用 `background-size:100% 100%`。端点不重复；按钮中段、卷轴顶底边 `repeat-x`；卷轴左右边 `repeat-y`；纸面中心 `repeat`。

常驻界面仅使用头像、笔触状态、独立导航物件、香火球、操作按钮和扇形手牌，不给整组信息铺大底板。卷轴用于需要集中阅读的弹窗。当前完整卡牌及预览保持 4:7，图鉴小卡为 4:5，背景为 3:4；图标、导航和九宫格插画的取图容器保持 1:1。旧 2:3 卡框属于已归档素材，不通过拉高卡框容纳规则文字。

## 素材裁切与记录

`tools/slice-ui.py` 只通过 Pillow 读取、找透明边界、矩形裁切并保存 PNG，不绘制像素、不改变色彩、不重采样。先去除整体全透明空边，再按端点和边界切图；可用 `--button-caps LEFT RIGHT`、`--scroll-insets TOP RIGHT BOTTOM LEFT` 指定相对裁去空边后的像素厚度。若微弱噪点撑大透明边界，使用 `--button-trim X Y WIDTH HEIGHT` 指定经源图检查后的矩形，仍不修改其中任何 alpha 或 RGB 像素。

重复运行时，源图尺寸未变则沿用 `ref-slices.json` 已记录的端点厚度与显式按钮、路线裁切框；CLI 参数可以覆盖。本轮按钮为 `--button-trim 31 148 2112 426 --button-caps 260 260`，卷轴为 `--scroll-insets 180 120 180 120`，路线为 `--path-trim 42 334 2091 64`。路线主笔触的 alpha≥16 分析范围是 `[46,338,2083,56]`，四边各外扩 4 像素后仅做矩形裁切，没有阈值抠图或改动裁区内 alpha。

源 `ref-button.png` 输出 `ref-button-left/middle/right.png`。源 `ref-scroll.png` 输出 `ref-scroll-tl/t/tr/l/c/r/bl/b/br.png`。如存在 `ref-brushes.png`，先分三行再裁各行透明边，输出 `ref-brush-teal/red/jade.png`；旧 `map-path.png` 仅裁主笔触外围矩形得到 `ref-path.png`。全部位于 `game/public/assets/` 根目录。

本轮 `ref-button.png` 通过 `image_gen` 精修：保留两端轮廓与细边，将内部改为均匀低对比的蓝绿细纸纹，减少重复中段的明显水彩块接缝。当前原像素裁片仍为左右端各 260×426、中段 1592×426。没有用程序均色、模糊或重绘源图。完整生成、精修与派生来源见 [reference-prompts.json](../game/public/assets/reference-prompts.json)，最新坐标以 [ref-slices.json](../game/public/assets/ref-slices.json) 为准。

脚本生成 `game/public/assets/ref-slices.json` 与 `game/src/skin-data.js`。两者数据相同，运行时从后者导出 `SKIN_DATA`：

- `version:1`、`operation:'crop-only'`。
- `sources:[{filename,size:[w,h],trim:[x,y,w,h],alphaBounds:[x,y,w,h],trimMethod}]`，记录原图、实际裁切框、完整 alpha 边界与裁切方式。
- `skins.button/scroll:{source,referenceSize:[w,h],insets,parts:{片名:文件名}}`。
- `assets:[{filename,source,crop:[x,y,w,h],size:[w,h],ratio:w/h,group,part}]`。

所有 `crop`、`trim` 坐标相对原始源图，绝非重采样后的坐标。生成素材来源清单由主流程按此元数据登记，脚本不更改来源 manifest 或提示词。

```powershell
python tools/slice-ui.py
node tools/check-skins.mjs
```

切图和逐像素校验需要含 Pillow 的 Python。也可运行 `npm run check:skins`；若系统 Python 无 Pillow，可通过 `GHOST_LEDGER_PYTHON` 指向已安装的解释器，本机 Codex 随附解释器位于 `C:\Users\world\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe`。正常 Node.js 20 试玩、常规 `npm run check` 和 `npm run build` 均不依赖 Python，现成裁片会直接随项目与构建产物使用。

`check-skins` 检查 PNG 尺寸、裁切分区、source/crop/ratio 记录与多种尺寸下的统一缩放比例，再调用纯读取校验，把每张裁片像素与源图对应区域逐字节比较。`node tools/check-skins.mjs --root .local/dist` 可检查构建后的同一素材与源码。2026-10-24 当时的 16 张裁片及构建副本均通过校验；奖励按钮端点实测为 24.4131×40，与源片 260×426 同比，卷轴四角使用相同的 42.8147×64.222 比例。此前也检查了 390×844、360×740、320×568 视口，历史截图位于可选的 `.local/evidence/`。当前验证见 [开发记录](DEVELOPMENT-V05.md)，这些记录不替代真实手机触屏及用户最终视觉验收。
