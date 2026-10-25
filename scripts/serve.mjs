import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { watch } from 'node:fs';
import { compileContent } from './compile-content.mjs';

const argumentsList = process.argv.slice(2);
const portFlag = argumentsList.indexOf('--port');
const port = Number(portFlag >= 0 ? argumentsList[portFlag + 1] : process.env.PORT || 4210);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)), argumentsList.includes('--dist') ? 'dist' : '.');
let contentErrors = [];
if (!argumentsList.includes('--dist')) {
  await compileContent(root);
  let timer;
  watch(resolve(root, 'content'), () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try { await compileContent(root); contentErrors = []; console.log('配置已更新，刷新页面并新开夜巡即可体验。'); }
      catch (error) { contentErrors = [error.message]; console.error(error.message); }
    }, 180);
  });
}
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('请提供有效的 --port 端口。');

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replaceAll('\\', '/');
    if (pathname === '/__content/diagnostics') { response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ errors: contentErrors })); return; }
    if (pathname.split('/').some(part => part.startsWith('.'))) { response.writeHead(404).end('Not found'); return; }
    const filename = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (filename !== root && !filename.startsWith(`${root}${sep}`)) {
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
  console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请使用 npm run dev -- --port 4211。` : error.message);
  process.exitCode = 1;
});
server.listen(port, '0.0.0.0', () => console.log(`夜渡 · 阴债录\nLocal: http://127.0.0.1:${port}/\n局域网手机可使用本机IP与相同端口访问。Ctrl+C 结束预览。`));
