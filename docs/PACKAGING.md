# 发布与平台打包

本文路径均以仓库根目录为基准。Web 已具备独立静态构建、发布预检和手动 GitHub Pages 工作流；Windows、Android 已有 Tauri 2 宿主准备架构；微信小游戏实际发布暂缓，仍需实现 Canvas 渲染器。

## 环境与目录

使用 Node.js 24 LTS；项目支持 `>=24 <26`。在仓库根目录运行 `npm ci`，按锁文件安装构建依赖。`sharp` 只用于离线处理图片，游戏运行时不依赖第三方包。

| 路径 | 作用 |
| --- | --- |
| `game/src/runtime/`、`game/src/engine.js` | 各平台共用的规则与状态转换 |
| `game/src/platform/contract.js` | 存储、文件、音频、生命周期、时间等平台接口 |
| `game/src/platform/web.js` | 浏览器与原生 WebView 使用的平台实现 |
| `game/src/platform/wechat.js` | 微信存储与生命周期适配；其余能力及渲染仍待接入 |
| `game/targets/manifest.json` | 平台、共享入口、宿主、输出目录与后续要求的注册表 |
| `game/hosts/native-shell/`、`game/hosts/wechat/` | 宿主源模板；通过准备命令生成目标目录 |
| `.local/dist/web/` | 可独立部署的 Web 制品 |
| `.local/dist/windows/`、`.local/dist/android/` | 各自的 `web/`、`native-shell/` 与 `preparation.json` |
| `.local/dist/wechat/` | 纯规则核心、微信平台接口与明确停止启动的占位入口 |
| `.local/temp/`、`.local/evidence/` | 构建缓存和历史归档、检查记录与截图；均不进入 Git |

平台差异通过接口与宿主处理，不能把规则结算搬到渲染回调中。微信准备包只复制纯规则依赖闭包及 `contract.js`、`wechat.js`，不复制浏览器界面或 `platform/web.js`、`platform/index.js`。

## 构建与预览 Web

在仓库根目录依次运行：

```powershell
npm ci
npm test
npm run test:playthrough
npm run test:defeat
npm run build
npm run release:check
npm run preview -- --port 4211
```

浏览器访问 `http://127.0.0.1:4211/`。`build` 已包含内容、入口、语法、美术和来源检查；`npm test` 运行随仓库分发的正式回归，两个场景命令分别检查正常数值的通关覆盖及失败、恢复路径。自动演练不能代替浏览器操作、真实手机测试或玩家体验验收。

构建从空暂存目录开始，成功后才将其安装到 `.local/dist/web/`；原输出归档到 `.local/temp/web-archive-*`。构建失败时保留原输出及暂存文件，不把半成品作为新版本。部署时上传 `.local/dist/web/` 的完整内容；游戏运行不依赖仓库中的 `tools/`、`tests/` 或原始素材目录。

### 制品、版本与资源

```text
.local/dist/web/
  index.html
  .nojekyll
  release.json
  release-manifest.json
  asset-report.json
  releases/<releaseId>/
    src/
    public/assets/
```

`releaseId` 包含包版本、目标及构建输入摘要。入口引用该版本目录的全部 JS、CSS 和图片；图片名包含其输出哈希，模块只解析自身版本的资源。源码、配置、构建规则或图片改变后会生成新版本目录，不能手改同一目录的内容。

`release.json` 指向当前版本，设置中的「检查更新」读取此指针；不会在正在运行的页面中替换模块。玩家可以导出备份后使用「保存并刷新到新版本」。进度存储在当前浏览器地址下，更换域名、端口、设备或清理浏览器前应先导出。旧版或配置不匹配的记录保留用于恢复，不做自动迁移。

构建入口还添加精确 CSP：脚本仅来自同源，禁止内联脚本和 `eval`；样式允许现有布局所需的内联属性；图片、字体、媒体和更新请求限定同源，禁止对象、子框架、Worker 与表单提交。策略在资源标签前生效，不能替代配置文字和属性的 HTML 转义。静态 meta 的 `frame-src` 不表示站点已经配置只能由哪些父页面嵌入；后者需要主机支持的响应头。

构建只输出运行资源。原 PNG、提示词及来源原件继续保存在 `game/public/assets/`；发布图片使用支持透明的 WebP，页签图标保留 PNG。卡牌和怪物方形插画上限为 1024 像素，图集、三／九切片保持原像素尺寸，全部派生图保持源长宽比。`asset-report.json` 记录原始与发布大小、尺寸、来源路径、编码配置和双方 SHA256；未知素材会明确报错，不会替换成其他卡牌的图片。

### 发布预算与预检

| 检查项 | 当前上限 |
| --- | --- |
| 当前版本完整 Web 制品 | 80 MiB |
| 加上所保留上一版后的制品 | 160 MiB |
| 单张发布图片 | 8 MiB |
| 整个制品文件数，包含所保留上一版 | 1500 |

`npm run release:check` 检查已构建的实际字节：入口和版本一致性、文件清单、源图与输出哈希、配置中的素材、相对引用、尺寸比例、额外文件及大小预算。随后通过临时 HTTP 服务在 `/Ghost-Ledger/` 子路径逐一请求制品文件，检查响应内容和模块 MIME；服务随检查结束关闭。这仍不属于浏览器或真机验收。

可检查其他完整 Web 制品目录：

```powershell
npm run release:check -- .local/dist/windows/web
```

### 保留上一版

发布新入口时，同时保留最近一个不同版本的不可变资源目录，让仍打开上一版页面的玩家能继续请求素材。先把上次成功发布的**完整静态制品**放到 `.local/temp/previous-web-release/`，然后运行：

```powershell
npm run build
npm run release:retain -- .local/temp/previous-web-release
npm run release:check
```

`release:retain` 的第一个参数是上一版制品，第二个可选参数是当前制品目录，默认 `.local/dist/web/`。工具先校验两版，只复制上一版的 `releases/<releaseId>/`，写入 `retained-release.json`；当前 `index.html` 和发布元数据不被旧版覆盖。只保留一个前版，不累积全部历史。同版本重新部署时，会继续保留上次制品中记录的最近不同版本。

需要增加保留版本或预算时，应同时修改校验、发布流程和对应测试。不要只放宽大小限制来掩盖误打包的源图、测试或缓存。

若 Actions 中的上一版制品已经缺失或过期，可从仍在线的 Pages 站点恢复完整静态包。先将 PowerShell 变量 `$pagesBaseUrl` 设为仓库 Pages 设置或 GitHub Pages API 返回的 HTTPS `html_url`，选择尚未占用的本地输出目录，然后运行：

```powershell
npm run release:restore -- "$pagesBaseUrl" .local/temp/previous-web-release
npm run build
npm run release:retain -- .local/temp/previous-web-release
npm run release:check
```

恢复工具只接受无凭据的 HTTPS 站点根地址，禁止重定向及跨源、越过站点根路径的请求，按清单逐一校验大小和 SHA256，并执行 80／160 MiB 等预算与完整制品预检。它不执行下载到的 JS，也不要求旧图与当前源码哈希相同；旧制品自身的哈希和来源记录仍须有效。恢复目录可以包含其原有前版，之后 `release:retain` 会按规则只保留新入口所需的最近一个不同版本。恢复失败会停止，不能把残缺目录当作首发来跳过保留。

## 手动发布 GitHub Pages

仓库提供 `.github/workflows/pages.yml`，仅接受 `main` 分支的手动运行，不因普通推送自动部署。先由维护者在仓库的 **Settings → Pages** 将发布来源设为 **GitHub Actions**；工作流中的 `enablement: false` 不会代为开启 Pages。仓库与账号需满足 [GitHub Pages 的资格及工作流要求](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

将审核通过的源码提交到 `main` 后，在 **Actions → 手动发布 GitHub Pages → Run workflow** 选择 `main`。工作流会安装锁文件依赖、执行回归和场景、构建、下载上一次成功发布的 `web-release` 制品、保留上一版、执行发布预检，再上传并部署完整静态制品。首次发布没有上一版；仅当后续的 `web-release` 缺失或过期时，才从 GitHub Pages API 的 `html_url` 恢复在线完整包，支持 Pages 自定义域。其他 API、权限、下载损坏或校验错误仍会停止。`web-release` 当前保留期为 90 天，应另外保存重要发布的完整制品和对应源码提交号。

部署完成后，以 Actions 返回的 Pages 地址进行现场检查：首次打开、继续存档、进入战斗、拖牌、查看详情、图片重试、备份与恢复、更新检查。正式发布由维护者显式操作；本文及本地检查记录不表示工作流已在线运行或站点已经部署。

首次上线后，还应从实际 HTTPS 地址执行一次 `release:restore` 到新的临时目录，核对 `.nojekyll` 等清单文件也能按原字节读取。当前恢复工具严格要求完整清单；本地夹具通过不能证明 Pages 或自定义域已经提供全部文件。

## 失败、重试与回滚

| 场景 | 操作 |
| --- | --- |
| 构建／预检失败 | 根据首个错误修复源表、引用或资源；保留日志和 `.local/temp/` 中的原文件，重新 `build` 后再预检。不要上传失败制品。 |
| 保留上一版失败 | 当前制品可能留下保留暂存目录；从干净 `build` 重新运行 `release:retain`，不要反复向半成品追加历史。Windows 短时目录占用有有限重试，持续失败会停止并保留文件。 |
| Pages 构建或部署失败 | 修复对应阶段后重新手动运行；以上一次成功发布为准，检查本次是否真正到达部署成功状态。缺失／过期制品的站点恢复也失败时，先恢复可访问且完整的上一版站点或制品，再重试。 |
| 图片加载失败 | 页面会显示「部分画面没有加载完成」，先点「重新加载」；持续失败则导出进度，再检查网络与所处版本。不能用共用占位图替换缺失卡图。 |
| 启动模块下载失败 | 若已加载启动模块，恢复页会提供「导出原始记录」和「重新加载」。HTML 或启动模块本身未收到时，需先恢复网络或服务，再刷新页面。 |

回滚按以下步骤执行：

1. 保存当前完整制品和发布提交号，先让玩家导出进度。回滚不会自动转换新版本存档。
2. 找到上次验证成功的游戏源码、策划表及包版本，在独立副本中形成回滚变更，保留可工作的发布与预检链路，再通过新的提交／PR 合入 `main`。
3. 对回滚变更执行完整构建、回归、预检与浏览器检查；从 `main` 手动运行同一个 Pages 工作流。当前工作流没有选择历史制品的一键回滚入口。
4. 核对实际 Pages 地址和 `release.json`，确认玩家能打开新入口、读取当前版本资源，并检查上一版资源仍可访问。

其他静态主机若支持切换完整发布目录，也可将发布根目录指回已验证的完整旧制品。无论哪种方式，都不能只覆盖 `index.html`、只替换配置或混合两个版本的资源。

## Windows、Android 与微信准备包

先查看注册表和源结构检查：

```powershell
npm run package -- list
npm run package -- check
npm run package -- check android
```

`check` 报告结构是否完整和部分本机依赖信息，不能证明 SDK、签名、编译或设备可用。`prepare` 成功仅表示准备目录生成。Web 的 `prepare web` 等价于可部署静态构建；其余三个目标保持 `status: prepared`、`binaryStatus: not-built`、`runnable: false`。

```powershell
npm run package -- prepare web
npm run package -- prepare windows
npm run package -- prepare android
npm run package -- prepare wechat
```

每次准备只替换对应目标目录，旧目录归档到 `.local/temp/`。`preparation.json` 记录共享入口、平台、依赖和下一步。准备过程不会安装 Tauri CLI 或 SDK、执行原生编译、生成签名或发布到平台。

### Windows

依赖 Rust MSVC 工具链、Microsoft C++ Build Tools 的 C++ 桌面开发组件及 WebView2；以 [Tauri 前置环境文档](https://v2.tauri.app/start/prerequisites/) 为准。准备包包含固定版本 `@tauri-apps/cli@2.12.4` 的宿主清单、受限 CSP 和核心权限、透明 PNG 与多层 ICO 图标；`frontendDist` 引用相邻的 `../web`。默认 Windows 打包目标是 NSIS。

**以下是后续由维护者主动执行的原生构建步骤，本轮未执行。** 确认应用标识后，从仓库根目录调用准备包的独立宿主：

```powershell
npm --prefix .local/dist/windows/native-shell install
npm --prefix .local/dist/windows/native-shell run tauri -- build
```

准备商业发布时，按 [Windows 代码签名说明](https://v2.tauri.app/distribute/sign/windows/) 配置发布证书和时间戳服务，重新构建并检查安装包签名。当前模板未配置证书，也没有已验证的 EXE／安装包；仍需在 Windows 设备上验证安装、启动、存储、音频、输入和升级行为。

### Android

依赖 JDK、Android SDK、NDK、对应 Rust Android targets，并配置 `JAVA_HOME`、`ANDROID_HOME`、`NDK_HOME`；具体安装及目标列表见 [Tauri Android 环境说明](https://v2.tauri.app/start/prerequisites/#android)。

**以下是后续显式操作，本轮未执行：**

```powershell
npm --prefix .local/dist/android/native-shell install
npm --prefix .local/dist/android/native-shell run tauri -- android init
npm --prefix .local/dist/android/native-shell run tauri -- icon icons/icon.png
npm --prefix .local/dist/android/native-shell run tauri -- android build --apk
```

初始化生成 `.local/dist/android/native-shell/gen/android/` 后，按 [Android 代码签名说明](https://v2.tauri.app/distribute/sign/android/) 配置上传密钥、`keystore.properties` 和 Gradle 的 release 签名。密钥应保存在构建目录之外的受控位置，构建时注入；不要随公开源码分发。准备包不含已签名 APK／AAB，尚未进行 Android 真机验收。

原生宿主中的手工签名配置和生成项目位于准备目录；再次 `prepare` 会将其归档并重新生成，需要重新应用配置。正式原生发布应在完成首次编译后固定原生依赖锁文件和签名流程。

### 微信小游戏

`.local/dist/wechat/` 是共享规则与微信平台接口的准备包。`game.js` 会明确停止启动，提示 Canvas 渲染器、模块打包和资源适配尚未实现。不能将该目录直接上传为可运行小游戏，也不能把 Web 的 DOM 包塞入小游戏工程。

后续需实现 Canvas 渲染与输入坐标映射、小游戏模块及运行环境适配、资源分包／CDN、音频和文件能力，填入真实 AppID，再完成开发者工具、微信真机及平台审核。实际发布继续暂缓；共用规则和分目标输出目录已预留。

## 本轮已有证据与验收边界

以下路径为仓库根相对路径，位于本机被忽略的 `.local/evidence/`，新克隆不会自带。数值属于 2026-10-26 该轮构建基线，修改源码后应重新执行验证。

| 记录 | 实际覆盖 |
| --- | --- |
| `.local/evidence/release-assets-optimization.json` | 196 张运行图从 338,544,943 压至 75,814,828 字节，原件仍保留 |
| `.local/evidence/release-assets-integrity.json` | 原 PNG 哈希不变、发布哈希与尺寸比例一致、重复编码报告相同 |
| `.local/evidence/release-assets-web-reproducibility.json` | 两次 Web 构建的版本 ID 及完整清单相同；制品 76,682,316 字节／238 文件 |
| `.local/evidence/release-assets-target-preparations.json` | 三个平台准备成功；Windows／Android 的 Web 子包预检及应用图标检查、微信无 DOM 且入口停止启动 |
| `.local/evidence/release-assets-restore-tests.log` | 在线恢复工具的 12 项本地模拟响应夹具通过，含前版、自定义 HTTPS 域、重定向、路径及损坏字节；未访问真实 Pages |

该次 Web `release:check` 还完成了 `/Ghost-Ledger/` 下 238 个文件的 HTTP 校验。加入 CSP 后，13 项资源与打包回归已在本机通过。这里不将本地自动检查写成远端 CI 成功、线上发布成功、手机真机或用户体验验收。
