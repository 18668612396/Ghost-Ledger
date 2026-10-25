import { createServer } from 'node:http';
import { access, readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { watch } from 'node:fs';
import { compileContent } from './compile-content.mjs';
import { GAME_ROOT, DIST_ROOT, EVIDENCE_ROOT } from './paths.mjs';

const argumentsList = process.argv.slice(2);
const built = argumentsList.includes('--dist'), qa = argumentsList.includes('--qa');
if (built && qa) throw new Error('构建预览不开放本地 QA 夹具；--dist 与 --qa 不能同时使用。');
const portFlag = argumentsList.indexOf('--port');
const port = Number(portFlag >= 0 ? argumentsList[portFlag + 1] : process.env.PORT || (qa ? 4212 : 4210));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('请提供有效的 --port 端口。');
const root = built ? DIST_ROOT : GAME_ROOT;
try { await access(resolve(root, 'index.html')); }
catch (error) {
  if (built && error.code === 'ENOENT') throw new Error('缺少 .local/dist/index.html，请先运行 npm run build。');
  throw error;
}
let contentErrors = [];
let contentWatcher, contentTimer;
if (!built) {
  await compileContent(root);
  contentWatcher = watch(resolve(root, 'content'), () => {
    clearTimeout(contentTimer);
    contentTimer = setTimeout(async () => {
      try { await compileContent(root); contentErrors = []; console.log('配置已更新，刷新页面并新开夜巡即可体验。'); }
      catch (error) { contentErrors = [error.message]; console.error(error.message); }
    }, 180);
  });
}
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replaceAll('\\', '/');
    if (pathname === '/__content/diagnostics') { response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ errors: contentErrors })); return; }
    if (pathname.split('/').some(part => part.startsWith('.'))) { response.writeHead(404).end('Not found'); return; }
    const evidenceRequest = qa && pathname.startsWith('/evidence/');
    const requestRoot = evidenceRequest ? EVIDENCE_ROOT : root;
    const relativePath = evidenceRequest ? pathname.slice('/evidence'.length) : pathname;
    const filename = resolve(requestRoot, `.${relativePath === '/' ? '/index.html' : relativePath}`);
    if (filename !== requestRoot && !filename.startsWith(`${requestRoot}${sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const metadata = await stat(filename);
    if (!metadata.isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    const data = await readFile(filename);
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    response.end(data);
  } catch {
    response.writeHead(404).end('Not found');
  }
});

server.on('error', error => {
  contentWatcher?.close();
  clearTimeout(contentTimer);
  const command = built ? 'preview' : qa ? 'dev:qa' : 'dev';
  const nextPort = port < 65535 ? port + 1 : port - 1;
  console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请使用 npm run ${command} -- --port ${nextPort}。` : error.message);
  process.exitCode = 1;
});
const host = qa ? '127.0.0.2' : '0.0.0.0';
server.listen(port, host, () => console.log(qa
  ? `夜渡 · 阴债录 · 本地 QA\nLocal: http://127.0.0.2:${port}/evidence/v05-scenarios.html\n仅监听隔离的回环地址，夹具来自 .local/evidence/。Ctrl+C 结束。`
  : `夜渡 · 阴债录\nLocal: http://127.0.0.1:${port}/\n局域网手机可使用本机IP与相同端口访问。Ctrl+C 结束预览。`));
