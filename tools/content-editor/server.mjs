import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContentStore, EditorError } from './store.mjs';
import { GAME_ROOT } from '../paths.mjs';

const publicRoot = fileURLToPath(new URL('./public/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json; charset=utf-8' };
const json = (response, status, body) => response.writeHead(status, { 'Content-Type': mime['.json'] }).end(JSON.stringify(body));
function sameToken(actual, expected) {
  if (typeof actual !== 'string') return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function readJson(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) throw new EditorError(415, 'json_required', '请使用 JSON 请求。');
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) throw new EditorError(413, 'payload_too_large', '配置请求超过 4 MiB，请减少导入内容。');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new EditorError(400, 'invalid_json', '请求不是有效的 JSON。'); }
}
function safePath(root, pathname) {
  const target = resolve(root, '.' + pathname), fromRoot = relative(root, target);
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) return null;
  return target;
}

export async function createEditorServer(options = {}) {
  const gameRoot = resolve(options.gameRoot || GAME_ROOT);
  const store = createContentStore(options);
  const writeToken = randomBytes(32).toString('hex');
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    try {
      // Loopback binding plus an exact Host check keeps browser requests local.
      const port = server.address()?.port;
      if (request.headers.host !== `127.0.0.1:${port}` && request.headers.host !== `localhost:${port}`) throw new EditorError(403, 'host_rejected', '请通过本机配置工具地址访问。');
      const origin = `http://${request.headers.host}`;
      const pathname = decodeURIComponent(new URL(request.url, origin).pathname).replaceAll('\\', '/');
      if (pathname.split('/').some(part => part.startsWith('.'))) throw new EditorError(404, 'not_found', '找不到此资源。');
      if (pathname === '/api/workspace' && request.method === 'GET') return json(response, 200, { ...await store.load(), writeToken });
      if (['/api/validate', '/api/save'].includes(pathname) && request.method === 'POST') {
        if (request.headers.origin !== origin || !sameToken(request.headers['x-editor-token'], writeToken)) throw new EditorError(403, 'write_rejected', '会话已失效或请求来源不匹配，请刷新配置工具后重试。');
        const payload = await readJson(request);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new EditorError(400, 'invalid_request', '需要配置请求对象。');
        if (pathname === '/api/validate') return json(response, 200, await store.validate(payload.tables));
        return json(response, 200, { ...await store.save(payload), writeToken });
      }
      if (pathname.startsWith('/api/')) throw new EditorError(404, 'not_found', '找不到此接口。');
      if (!['GET', 'HEAD'].includes(request.method)) throw new EditorError(405, 'method_not_allowed', '此资源只支持读取。');
      let filename;
      if (pathname.startsWith('/assets/')) {
        const name = pathname.slice('/assets/'.length);
        if (!/^[a-z0-9][a-z0-9_-]*\.png$/i.test(name)) throw new EditorError(404, 'not_found', '找不到此素材。');
        filename = safePath(resolve(gameRoot, 'public/assets'), '/' + name);
      } else if (pathname.startsWith('/game/src/') && pathname.endsWith('.js')) {
        filename = safePath(resolve(gameRoot, 'src'), pathname.slice('/game/src'.length));
      } else {
        filename = safePath(publicRoot, pathname === '/' ? '/index.html' : pathname);
      }
      if (!filename || !(await stat(filename)).isFile()) throw new EditorError(404, 'not_found', '找不到此资源。');
      const data = await readFile(filename);
      response.writeHead(200, { 'Content-Type': mime[extname(filename)] || 'application/octet-stream' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch (error) {
      const status = error.status || (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error instanceof URIError ? 404 : 500);
      json(response, status, { error: error.code || 'internal_error', message: error.status ? error.message : status === 404 ? '找不到此资源。' : '配置工具遇到错误，请查看终端并重试。', ...(error.errors?.length ? { errors: error.errors } : {}) });
      if (status === 500) console.error(error);
    }
  });
  return { server, store };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const portIndex = process.argv.indexOf('--port');
  const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.GHOST_LEDGER_EDITOR_PORT || 4213);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('请提供有效的 --port 端口。');
  const { server } = await createEditorServer();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请使用 npm run editor -- --port ${port < 65535 ? port + 1 : port - 1}。` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`夜渡 · 配置工坊\nLocal: http://127.0.0.1:${port}/\n卡牌、怪物与关卡配置编辑；保存前校验，备份写入 .local/temp/content-editor/。Ctrl+C 结束。`));
}
