import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, resolve, sep } from 'node:path';
import { createYuanbaoSearch, validateResearchInput, SearchError } from './search.mjs';
import { createInvestigationModel } from './model.mjs';
import { createInvestigationService } from './investigation.mjs';
import { createLeaderboardStore } from './leaderboard.mjs';
import { configuredPort, startLocalServer } from './startup.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = resolve(root, 'dist');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const securityHeaders = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'" };

function json(res, status, body) { res.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); }
async function readBody(req, limit = 8192) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new SearchError('TOO_LARGE', limit === 8192 ? '问题内容太长，请缩短后再试。' : '战报内容过长，暂时无法加入排行。', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new SearchError('INVALID_REQUEST', '请求格式不正确，请重试。', 400); }
}

function parsePublicOrigin(value) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!/^https?:\/\//.test(value.trim()) || !url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    return url;
  } catch {
    throw new Error('PUBLIC_ORIGIN 必须是完整的 http:// 或 https:// 游戏地址，不含路径、查询参数或账号密码。');
  }
}

export function createAppServer({ search, investigation, publicOrigin = '', configured = true, now = () => Date.now(), minuteLimit = 20, hourLimit = 120, leaderboardPath = resolve(root, 'data', 'leaderboard.json') } = {}) {
  const publicUrl = parsePublicOrigin(publicOrigin);
  const requests = new Map(), attempts = [];
  const leaderboard = createLeaderboardStore({ path: leaderboardPath, now });
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host || '';
      const publicHost = publicUrl?.host === host;
      if (!publicHost && !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) throw new SearchError('LOCAL_ONLY', '请从配置的游戏地址访问。', 403);
      // The proxy preserves Host; forwarded headers never grant access.
      const expectedOrigin = publicHost ? publicUrl.origin : `http://${host}`;
      const invalidOrigin = req.headers.origin && req.headers.origin !== expectedOrigin || req.headers['sec-fetch-site'] === 'cross-site' || req.headers['x-lie-company'] !== 'research';
      const url = new URL(req.url, `http://${host}`);
      if (url.pathname === '/api/leaderboard' || url.pathname.startsWith('/api/leaderboard/')) {
        if (invalidOrigin) throw new SearchError('ORIGIN', '请从游戏页面打开侦探排行。', 403);
        const id = url.pathname === '/api/leaderboard' ? null : url.pathname.slice('/api/leaderboard/'.length);
        if (req.method === 'GET') return json(res, 200, { ok: true, result: id === null ? await leaderboard.list(url.searchParams.get('runId')) : await leaderboard.get(id) });
        if (!(req.method === 'POST' && id === null || req.method === 'PATCH' && id !== null)) throw new SearchError('METHOD', '请通过游戏内的侦探排行操作。', 405);
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new SearchError('CONTENT_TYPE', '请求格式不正确。', 415);
        const body = await readBody(req, 256 * 1024);
        return json(res, 200, { ok: true, result: id === null ? await leaderboard.add(body) : await leaderboard.rename(id, body) });
      }
      if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, search: { configured, mode: 'live' }, ...(investigation ? { investigation: { configured: investigation.configured } } : {}) });
      if (['/api/investigation/plan', '/api/investigation/refresh', '/api/investigation/cancel', '/api/investigation/research', '/api/investigation/progress', '/api/investigation/verdict'].includes(url.pathname)) {
        if (req.method !== 'POST') throw new SearchError('METHOD', '请通过游戏内的调查入口发起请求。', 405);
        if (invalidOrigin) throw new SearchError('ORIGIN', '请从游戏页面发起调查。', 403);
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new SearchError('CONTENT_TYPE', '请求格式不正确。', 415);
        const body = await readBody(req), at = now();
        if (!body || typeof body.requestId !== 'string' || !/^[\w-]{16,80}$/.test(body.requestId)) throw new SearchError('INVALID_REQUEST', '调查请求无效，请重新发起。', 400);
        if (url.pathname.endsWith('/cancel')) {
          if (typeof body.sessionId !== 'string' || !/^[\w-]{16,80}$/.test(body.sessionId)) throw new SearchError('INVALID_REQUEST', '调查请求无效，请重新发起。', 400);
          if (!investigation?.configured || typeof investigation.cancel !== 'function') throw new SearchError('INVESTIGATION_NOT_CONFIGURED', '调查服务还没有配置好，请联系开发者。', 503);
          await investigation.cancel({ requestId: body.requestId, sessionId: body.sessionId });
          // Cleanup must remain available even after the paid-operation limit.
          return json(res, 200, { ok: true, result: { sessionId: body.sessionId, cancelled: true } });
        }
        if (url.pathname.endsWith('/progress')) {
          if (!investigation?.configured || typeof investigation.progress !== 'function') throw new SearchError('INVESTIGATION_NOT_CONFIGURED', '调查服务还没有配置好，请联系开发者。', 503);
          return json(res, 200, { ok: true, result: await investigation.progress(body) });
        }
        const key = `${url.pathname}:${body.requestId}`, fingerprint = JSON.stringify(body);
        for (const [id, entry] of requests) if (entry.expires < at) requests.delete(id);
        const prior = requests.get(key);
        if (prior && prior.fingerprint !== fingerprint) throw new SearchError('REQUEST_CONFLICT', '这次调查已提交，请不要重复修改同一请求。', 409);
        if (prior) return json(res, 200, { ok: true, result: await prior.promise });
        while (attempts.length && attempts[0] <= at - 3600000) attempts.shift();
        if (attempts.length >= hourLimit || attempts.filter(time => time > at - 60000).length >= minuteLimit) throw new SearchError('RATE_LIMIT', '调查次数较多，请稍后再试。', 429);
        if (!investigation?.configured) throw new SearchError('INVESTIGATION_NOT_CONFIGURED', '调查服务还没有配置好，请联系开发者。', 503);
        attempts.push(at);
        const method = url.pathname.split('/').at(-1);
        if (typeof investigation[method] !== 'function') throw new SearchError('INVESTIGATION_NOT_CONFIGURED', '调查服务还没有配置好，请联系开发者。', 503);
        const promise = Promise.resolve().then(() => investigation[method](body));
        requests.set(key, { fingerprint, promise, expires: at + 300000 });
        try { return json(res, 200, { ok: true, result: await promise }); }
        catch (error) { requests.delete(key); throw error; }
      }
      if (url.pathname === '/api/research') {
        if (req.method !== 'POST') throw new SearchError('METHOD', '请通过游戏内的寻找证据发起搜索。', 405);
        if (invalidOrigin) throw new SearchError('ORIGIN', '请从游戏页面发起搜索。', 403);
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new SearchError('CONTENT_TYPE', '请求格式不正确。', 415);
        const input = validateResearchInput(await readBody(req));
        const at = now(), fingerprint = JSON.stringify({ query: input.query, roundId: input.roundId, previous: input.previous });
        for (const [id, entry] of requests) if (entry.expires < at) requests.delete(id);
        const prior = requests.get(input.requestId);
        if (prior && prior.fingerprint !== fingerprint) throw new SearchError('REQUEST_CONFLICT', '这次调查已提交，请不要重复修改同一请求。', 409);
        if (prior) return json(res, 200, { ok: true, result: await prior.promise });
        while (attempts.length && attempts[0] <= at - 3600000) attempts.shift();
        if (attempts.length >= hourLimit || attempts.filter(time => time > at - 60000).length >= minuteLimit) throw new SearchError('RATE_LIMIT', '搜索次数较多，请休息片刻再查。金币不会消耗。', 429);
        if (!configured) throw new SearchError('NOT_CONFIGURED', '搜索服务还未配置，请联系开发者。', 503);
        attempts.push(at);
        const promise = Promise.resolve().then(() => search(input));
        requests.set(input.requestId, { fingerprint, promise, expires: at + 300000 });
        try { return json(res, 200, { ok: true, result: await promise }); }
        catch (error) { requests.delete(input.requestId); throw error; }
      }
      if (url.pathname.startsWith('/api/')) throw new SearchError('NOT_FOUND', '接口不存在。', 404);
      if (!['GET', 'HEAD'].includes(req.method)) throw new SearchError('METHOD', '不支持的请求方式。', 405);
      let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { throw new SearchError('NOT_FOUND', '页面不存在。', 404); }
      const path = resolve(publicRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!path.startsWith(publicRoot + sep) || pathname.split('/').some(part => part.startsWith('.')) || !mime[extname(path)]) throw new SearchError('NOT_FOUND', '页面不存在。', 404);
      let canonical; try { canonical = await realpath(path); } catch { throw new SearchError('NOT_FOUND', '页面不存在。', 404); }
      if (!canonical.startsWith(publicRoot + sep) || !(await stat(canonical)).isFile()) throw new SearchError('NOT_FOUND', '页面不存在。', 404);
      const bytes = await readFile(canonical);
      res.writeHead(200, { ...securityHeaders, 'Content-Type': mime[extname(path)], 'Content-Length': bytes.length }); res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      const safe = error instanceof SearchError ? error : new SearchError('SERVER_ERROR', '搜索暂时不可用，请稍后重试。');
      json(res, safe.status, { ok: false, error: { code: safe.code, message: safe.message } });
    }
  });
  server.once('close', () => investigation?.close?.());
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    try { process.loadEnvFile(resolve(root, '.env.local')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('无法读取 src/.env.local。'); }
    const port = configuredPort();
    const publicOrigin = process.env.PUBLIC_ORIGIN?.trim() || '';
    const provider = createYuanbaoSearch();
    const model = createInvestigationModel();
    const investigation = createInvestigationService({ model, search: provider });
    const server = createAppServer({ search: provider.search, configured: provider.configured, investigation, publicOrigin });
    await startLocalServer(server, { port, replaceExisting: !publicOrigin && process.env.NODE_ENV !== 'production' });
    console.log(`谎言公司：${publicOrigin || `http://localhost:${port}`} · 元宝搜索${provider.configured ? '已配置' : '未配置'}`);
  } catch (error) {
    console.error(error.message || '本地服务启动失败。'); process.exitCode = 1;
  }
}
