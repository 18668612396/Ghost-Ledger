# 开发与配置工具

此目录放置游戏开发工具及配置工具。游戏本体在 `game/`；工具不进入静态游戏产物。独立可视化配置工坊位于 `tools/content-editor/`，操作见 [tools/content-editor/README.md](content-editor/README.md)。Web 发布、保留上一版、回滚及多平台准备见 [docs/PACKAGING.md](../docs/PACKAGING.md)。

使用 Node.js 24 LTS（支持 `>=24 <26`），先在仓库根目录运行 `npm ci`。生产图片处理使用锁定的开发依赖 `sharp`，运行时不依赖它。以下项目命令均从仓库根目录进入：

| 命令 | 用途 | 读取／输出 |
| --- | --- | --- |
| `npm run editor` | 启动本地可视化配置工坊，默认端口 4213 | 编辑 `game/content/`；备份在 `.local/temp/content-editor/` |
| `npm run dev` | 开发服务与配置监听，默认端口 4210 | 提供 `game/`，合法表变更编译到 `game/src/generated/` |
| `npm run dev:qa` | 本地夹具服务，默认端口 4212 | 仅监听 `127.0.0.2`，额外映射 `.local/evidence/` 到 `/evidence/` |
| `npm run content:check` | 校验并编译九张源表，包含法器与药物 | `game/content/` → `game/src/generated/content-data.js` |
| `npm run art:check` | 检查 PNG 来源哈希、主体覆盖与画窗定位，编译共用定位数据 | `game/public/assets/card-art-layouts.json` → `game/src/generated/card-art-layout-data.js` |
| `npm run check` | 内容、入口、JS 语法及素材来源检查 | 扫描游戏、工具和正式测试；不执行测试 |
| `npm test` | 编译内容并运行正式回归 | `tests/**/*.test.mjs`；缺少测试时失败 |
| `npm run test:playthrough` | 正常数值的第一幕自动通关与三首领覆盖 | 场景入口在 `tests/scenarios/`，结果写 `.local/evidence/` |
| `npm run test:defeat` | 正常失败路径、途中恢复及终态恢复 | 被动结束回合的独立场景，结果写 `.local/evidence/` |
| `npm run check:skins` | 三／九切片及原像素校验 | `game/public/assets/`，需要 Python/Pillow |
| `npm run build` | 检查后生成独立 Web 制品，编码运行图片 | `.local/dist/web/`；旧产物归档 `.local/temp/` |
| `npm run release:check` | 校验制品哈希、引用、配置、预算及子路径 HTTP 请求 | 默认检查 `.local/dist/web/`；可附加其他 Web 制品目录 |
| `npm run release:retain -- .local/temp/previous-web-release` | 校验并保留上一完整制品的版本资源 | 当前制品默认 `.local/dist/web/`；只保留一个不同前版 |
| `npm run release:restore -- "$pagesBaseUrl" .local/temp/previous-web-release` | 从可信 HTTPS Pages 根地址恢复完整静态包 | 用于上一版 Actions 制品缺失／过期；变量取 Pages 设置或 API 的 `html_url`，不执行下载的 JS |
| `npm run preview -- --port 4211` | 提供已构建游戏 | 只读取 `.local/dist/web/`，不开放 QA 夹具 |
| `npm run package -- list` | 显示 Web、Windows、Android、微信小游戏注册信息 | `game/targets/manifest.json` |
| `npm run package -- check` | 检查四目标源结构及部分本机依赖 | 可追加单个目标，如 `check android`；不执行 SDK 编译 |
| `npm run package -- prepare <目标>` | 生成目标准备目录 | 目标为 `web`／`windows`／`android`／`wechat`，输出 `.local/dist/<目标>/` |

`tools/paths.mjs` 集中解析仓库、游戏和本地目录，路径基于工具文件自身的位置。不要依赖调用者的当前工作目录，也不要硬编码本机绝对路径。

内容编译器、素材审计与美术检查函数的可选根目录参数指向**游戏目录**，例如 `game/`，不是仓库根目录。`check-skins.mjs --root <目录>` 同样如此。

`tools/build.mjs` 调用 `tools/optimize-assets.mjs`，只发布运行所需资源，保留原 PNG、提示词及来源原件。制品使用不可变版本目录与带哈希的图片名，制品根目录提供 `release.json`、`release-manifest.json`、`asset-report.json`。编码缓存位于 `.local/temp/release-assets-cache/`。发布预检要求当前版不超过 80 MiB、含上一版不超过 160 MiB、单图不超过 8 MiB、整个制品不超过 1500 个文件。

构建入口加入精确 CSP，脚本仅同源且禁止内联／`eval`，布局所需的内联样式保留。恢复工具严格限制 HTTPS 同源及站点根路径、拒绝重定向，并检查文件清单、大小、SHA256 和制品预算；校验失败不会成为可发布输出。

`tools/package-targets.mjs` 统一调度目标准备。Web 输出可独立部署；Windows／Android 输出 WebView 内容和 Tauri 2 宿主；微信仅复制纯规则和微信平台接口，Canvas 渲染器尚未实现。后三者的准备成功均标记 `prepared / not-built`，不会自动安装 SDK、编译 EXE／APK、签名或发布。具体依赖、后续显式命令与限制见 `docs/PACKAGING.md`。

美术检查仅为战斗背景 `.in-combat > .world-background::before/::after` 开放中性暗色渐变，用于顶部与底部背景明暗。该例外限定在 `game/src/style.css` 的这两个选择器，不允许将渐变用于卡牌、怪物、界面底纹或其他文件；其余素材、程序绘图与阴影检查继续执行。

素材切片脚本为 `tools/slice-ui.py`、`tools/slice-card-art.py` 与 `tools/slice-card-patterns.py`，默认读取 `game/public/assets/`；使用 `--verify` 只读检查，生成切片会写入素材目录。`tools/slice-ui.py` 还同步游戏内的 `game/src/skin-data.js`，不直接绘制或重新采样美术。

两个卡牌裁片工具分别检查透明物件与抽象背景的原像素来源，不再要求已归档的旧卡框或旧费用图。当前游戏的卡框与鬼火来源、比例检查由 `npm run check` 负责。

正式回归、场景入口和夹具位于 `tests/`，随仓库分发；临时夹具仍放 `.local/`。`.local/` 全部由 Git 忽略，新克隆不带截图、验收记录、缓存及旧构建。开发服务与构建不依赖这些本地证据；缺少正式测试时 `npm test` 会失败。

开发服务提供 `game/` 的 `/src/`、`/public/` URL；构建预览提供 `.local/dist/web/`，其入口引用 `releases/<releaseId>/`。发布包不能依赖开发服务的路径或 QA 入口。自动检查、浏览器操作、真实设备与用户验收需分别记录。
