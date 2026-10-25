// This placeholder deliberately fails before booting. A Mini Game uses Canvas,
// and the browser DOM renderer is never included in the preparation package.
throw new Error('微信小游戏尚未启用：需要实现 Canvas 渲染器、模块打包和资源分包适配。当前目录仅为共享规则与平台接口的准备包，不能发布。');
