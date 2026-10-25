# 开发与配置工具

此目录放置游戏开发工具及配置工具。游戏本体在 `game/`；这里的工具不进入静态游戏产物。独立的可视化配置工具位于 [content-editor/](content-editor/README.md)，其余脚本提供编译、服务、构建及素材检查。

在仓库根目录运行：

| 命令 | 用途 | 读取／输出 |
| --- | --- | --- |
| `npm run editor` | 启动本地可视化配置工坊，默认端口 4213 | 编辑 `game/content/`；备份在 `.local/temp/content-editor/` |
| `npm run dev` | 开发服务与配置监听，默认端口 4210 | 提供 `game/`，合法表变更编译到 `game/src/generated/` |
| `npm run dev:qa` | 本地夹具服务，默认端口 4212 | 仅监听 `127.0.0.2`，额外映射 `.local/evidence/` 到 `/evidence/` |
| `npm run content:check` | 校验并编译七张源表 | `game/content/` → `game/src/generated/content-data.js` |
| `npm run art:check` | 检查 PNG 来源哈希、主体覆盖与画窗定位，编译共用定位数据 | `card-art-layouts.json` → `game/src/generated/card-art-layout-data.js` |
| `npm run check` | 内容、入口、JS 语法及素材来源检查 | 扫描游戏、工具及存在的本地测试；不执行测试 |
| `npm test` | 编译内容并运行本地测试 | `.local/tests/*.test.mjs`；缺少测试时失败 |
| `npm run check:skins` | 三／九切片及原像素校验 | `game/public/assets/`，需要 Python/Pillow |
| `npm run build` | 检查后生成独立静态产物 | `.local/dist/`；旧产物归档 `.local/temp/` |
| `npm run preview -- --port 4211` | 提供已构建游戏 | 只读取 `.local/dist/`，不开放 QA 夹具 |

`paths.mjs` 集中解析仓库、游戏和本地目录，路径基于工具文件自身的位置。不要依赖调用者的当前工作目录，也不要硬编码本机绝对路径。

内容编译器、素材审计与美术检查函数的可选根目录参数指向**游戏目录**，例如 `game/`，不是仓库根目录。`check-skins.mjs --root <目录>` 同样如此。

美术检查仅为战斗背景 `.in-combat > .world-background::before/::after` 开放中性暗色渐变，用于顶部与底部背景明暗。该例外限定在 `game/src/style.css` 的这两个选择器，不允许将渐变用于卡牌、怪物、界面底纹或其他文件；其余素材、程序绘图与阴影检查继续执行。

素材切片脚本为 `slice-ui.py`、`slice-card-art.py` 与 `slice-card-patterns.py`，默认读取 `game/public/assets/`；使用 `--verify` 只读检查，生成切片会写入素材目录。`slice-ui.py` 还同步游戏内的 `game/src/skin-data.js`，不直接绘制或重新采样美术。

两个卡牌裁片工具分别检查透明物件与抽象背景的原像素来源，不再要求已归档的旧卡框或旧费用图。当前游戏的卡框与鬼火来源、比例检查由 `npm run check` 负责。

`.local/` 全部由 Git 忽略。新克隆不带测试、截图和旧构建；`check`、`build` 和普通服务不依赖本地测试及证据，`npm test` 必须找到本机测试才会执行。开发与预览保持游戏的 `/src/`、`/public/` URL，因此移动仓库内部目录不会改变浏览器内的游戏资源路径。
