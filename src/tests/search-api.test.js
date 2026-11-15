import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAppServer } from '../server/main.mjs';
import { SearchError, validateResearchInput, safeSourceUrl, buildSearchQuery, buildFocusedSearch, normalizeSearchResponse, createYuanbaoSearch } from '../server/search.mjs';

const request = (overrides = {}) => ({ roundId: 'round-1', query: '长城太空照片来自哪里？', requestId: 'test-research-request-0001', ...overrides });
const page = (url = 'https://science.nasa.gov/example', overrides = {}) => ({ title: '长城照片的实际拍摄条件', url, passage: '这是来源返回的长城照片摘要，不是游戏预置事实。', site: 'NASA', date: '2026-10-22', ...overrides });
const rawResult = () => ({ RequestId: 'provider-trace-123', Version: 'v-test', Pages: [JSON.stringify(page()), JSON.stringify(page('https://www.esa.int/example', { title: '另一份长城观测资料', site: 'ESA', passage: '第二个来源描述长城观测，需打开原文核对。' }))] });
const throwsCode = (fn, code, status) => assert.throws(fn, error => error instanceof SearchError && error.code === code && (status === undefined || error.status === status));
async function fixture(t, options = {}) {
  const server = createAppServer({ search: async input => normalizeSearchResponse(rawResult(), input), configured: true, ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body = request(), extra = {}) => fetch(`${base}/api/research`, {
    method: 'POST', ...extra,
    headers: { 'content-type': 'application/json', 'x-lie-company': 'research', origin: base, ...extra.headers },
    body: extra.body ?? JSON.stringify(body),
  });
  return { server, base, post };
}

function proxyRequest(base, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${base}${path}`, { method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test('search input enforces the query budget, case scope and a real previous clue for round two', () => {
  for (const query of ['长', '长城' + '问'.repeat(63), '长城\n出处', 123]) throwsCode(() => validateResearchInput(request({ query })), 'INVALID_QUERY', 400);
  assert.equal(validateResearchInput(request({ query: '长城' })).query, '长城');
  const maximum = '长城' + '问'.repeat(62);
  assert.equal([...validateResearchInput(request({ query: maximum })).query].length, 64);
  throwsCode(() => validateResearchInput(request({ query: '明天会不会下雨？' })), 'OFF_TOPIC', 400);
  throwsCode(() => validateResearchInput(request({ roundId: 'round-6' })), 'INVALID_REQUEST', 400);
  throwsCode(() => validateResearchInput(request({ requestId: 'short' })), 'INVALID_REQUEST', 400);
  for (const previous of [undefined, {}, { title: '线索', url: 'javascript:alert(1)' }, { title: '', url: 'https://www.nasa.gov/a' }]) {
    throwsCode(() => validateResearchInput(request({ roundId: 'round-2', previous })), 'MISSING_CLUE', 400);
  }
  const previous = { title: 'NASA 长城照片', url: 'https://www.nasa.gov/a#part', query: '长城照片出处？' };
  const valid = validateResearchInput(request({ roundId: 'round-2', previous }));
  assert.deepEqual(valid.previous, { ...previous, url: 'https://www.nasa.gov/a' });
  const followup = buildSearchQuery({ ...valid, query: '照片里的镜头条件是什么？' });
  assert.match(followup, /^照片里的镜头条件是什么？ 长城 NASA/);
  assert.equal(buildSearchQuery({ ...valid, query: maximum }), maximum, 'player input must not be silently truncated to fit context');
});

test('source URLs only permit public HTTP links without credentials', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'file:///etc/passwd', 'https://user:password@example.com/a', 'http://localhost/a', 'http://127.0.0.1/a', 'http://[::1]/a', 'http://printer.local/a', 'not a URL']) assert.equal(safeSourceUrl(url), null, url);
  assert.equal(safeSourceUrl('https://www.nasa.gov/article#top'), 'https://www.nasa.gov/article');
  assert.equal(safeSourceUrl(`https://example.org/${'a'.repeat(2100)}`), null);
  assert.equal(safeSourceUrl(`https://example.org/${'文'.repeat(300)}`), null);
});

test('provider pages are parsed defensively, deduplicated, and keep actual source text and trace metadata', () => {
  const raw = rawResult();
  raw.Pages.unshift('{broken json', null, 9, JSON.stringify(page('javascript:alert(1)')), JSON.stringify(page('https://other.example/unrelated', { title: '天气预报', passage: '明天有雨。' })), JSON.stringify(page('https://science.nasa.gov/example#fragment')));
  raw.Pages.push(JSON.stringify(page('https://empty.example/source', { passage: '' })));
  const input = validateResearchInput(request()), at = '2026-10-22T12:34:56.000Z';
  const result = normalizeSearchResponse({ Response: raw }, input, at);
  assert.equal(result.provider, '腾讯云元宝搜索'); assert.equal(result.requestId, raw.RequestId); assert.equal(result.version, raw.Version); assert.equal(result.fetchedAt, at);
  assert.equal(result.query, input.query); assert.equal(result.searchQuery, buildSearchQuery(input));
  assert.equal(result.materials.length, 2);
  assert.deepEqual(new Set(result.materials.map(item => item.focus)), new Set(['spread', 'persuasion']));
  const selected = result.materials.flatMap(item => item.sources);
  assert.equal(new Set(selected.map(source => source.url)).size, 2);
  assert.ok(selected.every(source => source.summary.includes('长城')));
  assert.ok(result.materials.every(item => item.finding === item.sources[0].summary && item.title === item.sources[0].title));
  assert.ok(result.materials.every(item => item.nextQuestion.includes(item.sources[0].organization)));
  assert.doesNotMatch(result.finding, /已经证实|核验通过|独立验证|原图找到了/);
});

test('article images come only from the same provider page pics and never from a favicon', () => {
  const raw = rawResult();
  raw.Pages[0] = JSON.stringify(page('https://science.nasa.gov/example', {
    pics: [null, { origin_url: 'javascript:alert(1)' }, { origin_url: 'http://127.0.0.1/private' }, { origin_url: 'https://images.nasa.gov/article.jpg#crop', caption: '<b>原文配图</b> · 观测记录' }],
    favicon: 'https://icons.example/logo.png',
  }));
  raw.Pages[1] = JSON.stringify(page('https://www.esa.int/example', { title: '另一份长城观测资料', site: 'ESA', passage: '第二个来源描述长城观测，需打开原文核对。', favicon: 'https://icons.example/esa.png' }));
  const result = normalizeSearchResponse(raw, validateResearchInput(request()));
  const illustrated = result.materials.flatMap(item => item.sources).find(source => source.url.includes('nasa.gov'));
  const textOnly = result.materials.flatMap(item => item.sources).find(source => source.url.includes('esa.int'));
  assert.equal(illustrated.imageUrl, 'https://images.nasa.gov/article.jpg');
  assert.equal(illustrated.imageCaption, '原文配图 · 观测记录');
  assert.equal(textOnly.imageUrl, undefined);
});

test('gateway copies of one article do not satisfy the two-source requirement', () => {
  const same = page('https://news.cctv.com/2026/story.shtml', { site: '央视' });
  const variants = [same, { ...same, url: 'http://news.cctv.com/2026/story.shtml/' }, { ...same, url: 'https://big5.cntv.cn/gate/big5/news.cctv.com/2026/story.shtml' }];
  throwsCode(() => normalizeSearchResponse({ Pages: variants.map(JSON.stringify) }, validateResearchInput(request())), 'INSUFFICIENT_SOURCES', 422);
  for (const raw of [{}, { Pages: 'not an array' }]) throwsCode(() => normalizeSearchResponse(raw, validateResearchInput(request())), 'INVALID_RESPONSE');
  throwsCode(() => normalizeSearchResponse({ Pages: [] }, validateResearchInput(request())), 'INSUFFICIENT_SOURCES', 422);
});

test('normalized second-round material preserves the selected parent and leaves a follow-up', () => {
  const input = validateResearchInput(request({ roundId: 'round-2', previous: { title: 'NASA 长城照片', url: 'https://www.nasa.gov/first', query: '长城照片出处？' } }));
  const result = normalizeSearchResponse(rawResult(), input);
  assert.deepEqual(result.parent, input.previous);
  assert.deepEqual(result.materials.map(item => item.id), ['collage-spread', 'conditions-persuasion']);
  assert.ok(result.materials.every(item => item.nextQuestion));
});

test('HTTP serves only public game files and rejects cross-origin or malformed searches before provider calls', async t => {
  let called = 0;
  const { base, post } = await fixture(t, { search: async input => { called++; return normalizeSearchResponse(rawResult(), input); } });
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200); assert.deepEqual(await health.json(), { ok: true, search: { configured: true, mode: 'live' } });
  const index = await fetch(base); assert.equal(index.status, 200); assert.match(await index.text(), /谎言公司/);
  assert.match(index.headers.get('content-security-policy'), /connect-src 'self'/); assert.equal(index.headers.get('x-content-type-options'), 'nosniff');
  assert.match(index.headers.get('content-security-policy'), /img-src 'self' data: https: http:/);
  assert.match(index.headers.get('content-security-policy'), /script-src 'self';/);
  const picture = await fetch(`${base}/assets/text-article.png`, { method: 'HEAD' });
  assert.equal(picture.status, 200); assert.equal(picture.headers.get('content-type'), 'image/png');
  const music = await fetch(`${base}/assets/audio/covert-action.ogg`, { method: 'HEAD' });
  assert.equal(music.status, 200); assert.equal(music.headers.get('content-type'), 'audio/ogg');
  assert.ok(Number(music.headers.get('content-length')) > 1000000);
  const head = await fetch(`${base}/app.js`, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
  for (const path of ['/.env.local', '/package.json', '/server/main.mjs', '/server/search.mjs', '/%2eenv.local', '/assets/%2e%2e/%2eenv.local', '/%2e%2e%2fserver%2fmain.mjs']) {
    const response = await fetch(`${base}${path}`); assert.equal(response.status, 404, path);
    assert.doesNotMatch(await response.text(), /TENCENTCLOUD_SECRET|CommonClient|createAppServer/);
  }
  for (const headers of [{ origin: 'https://evil.example' }, { 'sec-fetch-site': 'cross-site' }, { 'x-lie-company': '' }]) {
    assert.equal((await post(request(), { headers })).status, 403, JSON.stringify(headers));
  }
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(`${base}/api/health`, { headers: { host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await post(request(), { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await post(request(), { body: '{not json' })).status, 400);
  assert.equal((await fetch(`${base}/api/research`)).status, 405);
  assert.equal(called, 0);
});

test('public deployment accepts only its configured host and HTTP or HTTPS origin while retaining local access', async t => {
  for (const publicOrigin of ['http://203.0.113.10:8080', 'https://game.example.com']) {
    let calls = 0;
    const { base } = await fixture(t, {
      publicOrigin,
      leaderboardPath: join(tmpdir(), randomUUID(), 'leaderboard.json'),
      investigation: { configured: true, plan: async () => { calls++; return { ready: true }; } },
      search: async () => { calls++; return { ready: true }; },
    });
    const headers = { host: new URL(publicOrigin).host, origin: publicOrigin, 'x-lie-company': 'research', 'content-type': 'application/json' };
    assert.equal((await proxyRequest(base, '/', { headers })).status, 200);
    assert.equal((await fetch(`${base}/api/health`)).status, 200, 'local health checks continue to work');
    const routes = [
      ['/api/research', 'POST', request()],
      ['/api/investigation/plan', 'POST', { requestId: 'public-investigation-0001' }],
      ['/api/leaderboard', 'GET'],
    ];
    for (const [path, method, body] of routes) {
      assert.equal((await proxyRequest(base, path, { method, headers, body })).status, 200, path);
      for (const extra of [
        { origin: publicOrigin.replace(/^https?/, publicOrigin.startsWith('https:') ? 'http' : 'https') },
        { origin: base },
        { origin: `${publicOrigin}.evil.example` },
        { 'sec-fetch-site': 'cross-site' },
        { 'x-lie-company': '' },
      ]) {
        assert.equal((await proxyRequest(base, path, { method, headers: { ...headers, ...extra }, body })).status, 403, `${path}: ${JSON.stringify(extra)}`);
      }
    }
    assert.equal(calls, 2, 'rejected origins never reach either paid provider');
    for (const host of ['evil.example', `${headers.host}.evil.example`, 'game.example.com:9999']) {
      const response = await proxyRequest(base, '/api/health', { headers: { ...headers, host, 'x-forwarded-host': headers.host, 'x-forwarded-proto': new URL(publicOrigin).protocol.slice(0, -1), forwarded: `host=${headers.host};proto=https` } });
      assert.equal(response.status, 403, 'forwarded headers cannot authorize a different Host');
    }
    const forged = await proxyRequest(base, '/api/research', { method: 'POST', headers: { ...headers, origin: 'https://evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }, body: request() });
    assert.equal(forged.status, 403, 'forwarded headers cannot override the configured origin');
  }
});

test('PUBLIC_ORIGIN fails closed for malformed URLs, credentials and addresses containing application paths', () => {
  for (const publicOrigin of ['game.example.com', 'https:game.example.com', '//game.example.com', 'ftp://game.example.com', 'https://name:secret@game.example.com', 'https://game.example.com/play', 'https://game.example.com?admin=true', 'https://game.example.com#page', 'http://game.example.com:99999']) {
    assert.throws(() => createAppServer({ publicOrigin }), /PUBLIC_ORIGIN 必须/, publicOrigin);
  }
});

test('one request ID shares an in-flight result, conflicts fail, and successful retries never re-bill the provider', async t => {
  let calls = 0, release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const didStart = new Promise(resolve => { started = resolve; });
  const { post } = await fixture(t, { search: async input => { calls++; started(); await gate; return normalizeSearchResponse(rawResult(), input); } });
  const first = post(); await didStart;
  const second = post();
  const conflict = await post(request({ query: '月球肉眼能看到长城吗？' }));
  assert.equal(conflict.status, 409); assert.equal((await conflict.json()).error.code, 'REQUEST_CONFLICT');
  assert.equal(calls, 1); release();
  const replies = await Promise.all([first, second]); assert.ok(replies.every(reply => reply.status === 200));
  const [a, b] = await Promise.all(replies.map(reply => reply.json())); assert.deepEqual(a, b); assert.equal(a.ok, true);
  assert.equal((await post()).status, 200); assert.equal(calls, 1);
});

test('failed requests can retry and raw SDK errors never escape the local API', async t => {
  let calls = 0;
  const leak = 'SecretId=fixture-only-sensitive Authorization=TC3-HMAC-SHA256';
  const { post } = await fixture(t, { search: async input => { calls++; if (calls === 1) throw Object.assign(new Error(leak), { code: 'AuthFailure.SignatureFailure', request: { Authorization: leak } }); return normalizeSearchResponse(rawResult(), input); } });
  const failed = await post(); assert.equal(failed.status, 502);
  const text = await failed.text(); assert.doesNotMatch(text, /fixture-only-sensitive|Authorization|SignatureFailure|TC3-HMAC/);
  assert.equal(JSON.parse(text).error.code, 'SERVER_ERROR');
  const retry = await post(); assert.equal(retry.status, 200); assert.equal(calls, 2);
});

test('minute and hour limits charge only new requests and reopen when their windows pass', async t => {
  let time = 1000000, calls = 0;
  const { post } = await fixture(t, { minuteLimit: 1, hourLimit: 2, now: () => time, search: async input => { calls++; return normalizeSearchResponse(rawResult(), input); } });
  assert.equal((await post()).status, 200); assert.equal((await post()).status, 200);
  assert.equal((await post(request({ requestId: 'test-research-request-0002' }))).status, 429); assert.equal(calls, 1);
  time += 60001;
  assert.equal((await post(request({ requestId: 'test-research-request-0002' }))).status, 200); assert.equal(calls, 2);
  time += 60001;
  assert.equal((await post(request({ requestId: 'test-research-request-0003' }))).status, 429); assert.equal(calls, 2);
  time += 3600001;
  assert.equal((await post(request({ requestId: 'test-research-request-0003' }))).status, 200); assert.equal(calls, 3);
});

test('unconfigured services report unavailable instead of fabricating a preset success', async t => {
  let called = false;
  const { base, post } = await fixture(t, { configured: false, search: async () => { called = true; return {}; } });
  assert.equal((await (await fetch(`${base}/api/health`)).json()).search.configured, false);
  const response = await post(); assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'NOT_CONFIGURED');
  assert.equal(called, false);
  const provider = createYuanbaoSearch({}); assert.equal(provider.configured, false);
  await assert.rejects(provider.search(validateResearchInput(request())), error => error.code === 'NOT_CONFIGURED');
});

test('UTF-8 questions remain intact when HTTP body chunks split a Chinese character', async t => {
  let received;
  const { base } = await fixture(t, { search: async input => { received = input.query; return normalizeSearchResponse(rawResult(), input); } });
  const body = request(), bytes = Buffer.from(JSON.stringify(body));
  const cut = bytes.indexOf(Buffer.from('城')) + 1;
  const reply = await new Promise((resolve, reject) => {
    const req = httpRequest(`${base}/api/research`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lie-company': 'research', origin: base } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject); req.write(bytes.subarray(0, cut));
    setImmediate(() => req.end(bytes.subarray(cut)));
  });
  assert.equal(reply.status, 200, reply.body); assert.equal(received, body.query);
});

test('an original image page yields the observation and its answer, not download metadata', () => {
  const raw = rawResult();
  raw.Pages[0] = JSON.stringify(page('https://www.esa.int/Images/wall', {
    title: 'Great Wall of China', site: 'ESA',
    passage: 'Great Wall of China 44989 views 121 likes 395751 ID Like Download HI-RES JPG [10.09 MB] Thank you for liking! ESA astronaut Gerst took this photo from the International Space Station. "Can we see the Great Wall of China from the ISS?" Next to impossible with the naked eye. But I tried with an 800 mm tele lens. Still tough to spot.'
  }));
  const result = normalizeSearchResponse(raw, validateResearchInput(request()));
  const material = result.materials.find(m => m.sources[0].url.includes('/Images/wall'));
  assert.match(material.finding, /Next to impossible with the naked eye/);
  assert.match(material.finding, /800 mm tele lens/);
  assert.doesNotMatch(material.finding, /Download|views|likes|HI-RES/);
  assert.ok(material.sources[0].summary.includes('Download'), 'the unedited returned summary is retained in the archive');
});

test('headline-only hits, download-only pages and the previous primary source cannot masquerade as a fresh pair', () => {
  const first = page();
  const titleOnly = page('https://example.com/title-only', {title:'长城与月亮', passage:'长城与月亮 关于外星人生活和基地的传闻。'});
  const metadataOnly = page('https://www.esa.int/download', {title:'Great Wall of China', passage:'Great Wall of China 1234 views 12 likes ID Like Download HI-RES JPG.'});
  throwsCode(()=>normalizeSearchResponse({Pages:[first,titleOnly,metadataOnly]},validateResearchInput(request())),'INSUFFICIENT_SOURCES');
  throwsCode(()=>normalizeSearchResponse(rawResult(),validateResearchInput(request({roundId:'round-2',previous:{title:first.title,url:first.url,query:'长城照片来自哪里？'}}))),'INSUFFICIENT_SOURCES');
});

test('excerpt extraction preserves decimal measurements from the returned source', () => {
  const raw = rawResult();
  raw.Pages[0] = JSON.stringify(page(undefined, {passage:'肉眼可辨别长城的最远距离为62.5公里，远低于通常认定的太空高度。'}));
  const result=normalizeSearchResponse(raw,validateResearchInput(request()));
  assert.ok(result.materials.some(m=>m.finding.includes('62.5公里')));
  assert.ok(result.materials.every(m=>!m.finding.includes('62. 5')));
});

test('both dynamic excerpt fields are inspected without treating the longer one as complete article text', () => {
  const target = page('https://www.esa.int/observation', { title: 'An observation of the Great Wall', site: 'ESA',
    passage: 'An observation of the Great Wall Download HI-RES JPG. No text is available here.',
    content: 'The Great Wall observation is described here. I tried with a 600 mm tele lens. The details remain difficult to distinguish.' });
  const input = validateResearchInput(request({ query: '长城照片使用什么镜头？' }));
  const result = normalizeSearchResponse({ Pages: [target, page()] }, input);
  const material = result.materials.find(m => m.sources[0].url === target.url);
  assert.equal(material.insight.kind, 'lens'); assert.match(material.insight.headline, /600 mm/);
  assert.ok(target.content.includes(material.insight.quote));
  assert.equal(material.sources[0].content, target.content);
  const reverse = { ...target, passage: target.content, content: '其他有关月球的故事。'.repeat(80) };
  const reversed = normalizeSearchResponse({ Pages: [reverse, page()] }, input).materials.find(m => m.sources[0].url === target.url);
  assert.equal(reversed.insight.kind, 'lens'); assert.ok(reverse.passage.includes(reversed.insight.quote));
});

test('queries carry the selected finding and plan a different observation record for follow-up', () => {
  const previous = { title: '照片拍自空间站', sourceTitle: 'Great Wall — NASA', url: 'https://nasa.gov/image-article/great-wall', query: '长城照片在哪里拍的？', finding: '照片记录写明拍摄地点是空间站。', kind: 'location' };
  const input = validateResearchInput(request({ roundId: 'round-2', query: '还有哪些镜头条件可以对照？', previous }));
  assert.deepEqual(input.previous, previous);
  assert.match(buildSearchQuery(input), /^还有哪些镜头条件可以对照？ 长城 NASA/);
  assert.deepEqual(buildFocusedSearch(input), { Query: 'Great Wall of China from space', Site: 'esa.int' });
  const fromEsa = { ...input, previous: { ...previous, url: 'https://esa.int/a' }, query: '相机照片能证明从月球用肉眼看见长城吗？' };
  assert.equal(buildFocusedSearch(fromEsa).Site, 'nasa.gov');
});

test('second-round lens evidence states its actual new condition without merging photographs', () => {
  const source = page('https://www.esa.int/wall-observation', { title: 'ESA observation', site: 'ESA',
    passage: 'Can we see the Great Wall of China from the ISS? Next to impossible with the naked eye. But I tried with an 800 mm tele lens.' });
  const input = validateResearchInput(request({ roundId: 'round-2', query: '其他长城照片的镜头条件是什么？',
    previous: { title: 'Great Wall', url: 'https://nasa.gov/wall', query: '长城在哪里拍的？', kind: 'location', finding: 'NASA 照片拍自空间站。' } }));
  const result = normalizeSearchResponse({ Pages: [source, page()] }, input);
  assert.equal(result.investigation.previousFinding, input.previous.finding);
  assert.match(result.investigation.delta, /另一份记录.*800 mm/);
  assert.doesNotMatch(result.investigation.delta, /同一张|NASA.*800|闭环|查清/);
  assert.ok(result.materials.every(material => material.lead && material.nextQuestion));
  for (const material of result.materials) assert.ok(material.sources.some(item => item.summary.includes(material.insight.quote) || item.content.includes(material.insight.quote)));
});

test('negated, hypothetical, question-only and corrected claims do not become positive observation facts', () => {
  const cases = [
    'The Great Wall photo was taken without an 800 mm lens.',
    'The Great Wall photo used no 800 mm lens.',
    'The Great Wall photo did not use an 800 mm lens.',
    'The Great Wall photo was not taken from the International Space Station.',
    'If the Great Wall were photographed on the International Space Station, we would need the original record.',
    'The claim “the wall is not visible from the moon” is wrong. The Great Wall remains a popular question.',
    'The Great Wall observation report asks: was this picture photographed on the International Space Station?',
    'The Great Wall was photographed on the International Space Station. This statement is wrong.',
    'The Great Wall photo was taken with an 800 mm lens. There is no evidence for this claim.',
    'Can we see the Great Wall? Next to impossible with the naked eye. This statement is wrong.',
    '有人声称长城不能从月球看见，这个说法并不成立。',
  ];
  for (const passage of cases) {
    const raw = { Pages: [page('https://other.example/claim', { title: 'Great Wall observation', passage }), page()] };
    const material = normalizeSearchResponse(raw, validateResearchInput(request({ query: '长城观测条件是什么？' }))).materials.find(m => m.sources[0].url === 'https://other.example/claim');
    assert.equal(material.insight.kind, 'context', passage);
    if (/This statement is wrong/.test(passage)) assert.match(material.insight.quote, /This statement is wrong/, 'fallback retains the adjacent correction');
    if (/There is no evidence/.test(passage)) assert.match(material.insight.quote, /There is no evidence/, 'fallback retains the evidence limitation');
  }
});

test('a personal non-sighting is not generalized and unrelated lengths do not become lens or altitude data', () => {
  const personal = page('https://news.example/astronaut', { passage: '阿波罗宇航员说，地球是一个美丽的球体。杨利伟说，长城没有看见，只是说这次没有看见，不能说明所有情况。' });
  const result = normalizeSearchResponse({ Pages: [personal, page()] }, validateResearchInput(request()));
  const material = result.materials.find(m => m.sources[0].url === personal.url);
  assert.equal(material.insight.kind, 'observation'); assert.match(material.insight.explanation, /一次观测/);
  assert.doesNotMatch(material.insight.headline, /不可能|绝不/);
  assert.match(material.insight.quote, /^杨利伟/); assert.doesNotMatch(material.insight.quote, /阿波罗/);
  const length = page('https://esa.int/wall-length', { title: 'Great Wall geography', passage: 'The Great Wall of China stretches for 3,000 km. This photo is in an educational collection.' });
  const extra = normalizeSearchResponse({ Pages: [length, page()] }, validateResearchInput(request({ query: '长城照片的高度是多少？' }))).materials.find(m => m.sources[0].url === length.url);
  assert.equal(extra.insight.kind, 'context'); assert.doesNotMatch(extra.insight.headline, /3000|3,000|高度/);
});

test('tracking variants, CCTV mirrors and same-title syndicated articles cannot count as two sources', () => {
  const first = page('https://www.cctv.com/science/2004/story.html?utm_source=test', { title: '从月球上能看到长城？这些关于月亮的谣言你信过几个' });
  const copies = [first,
    { ...first, url: 'https://big5.cctv.com/gate/big5/www.cctv.cn/science/2004/story.html' },
    { ...first, url: 'https://news.cnr.cn/2018/story.html', passage: '另一处转载的长城相关资料摘要，不能作为新的原始证据。' },
    { ...first, url: 'https://m.people.cn/2018/story.html' }];
  throwsCode(() => normalizeSearchResponse({ Pages: copies }, validateResearchInput(request())), 'INSUFFICIENT_SOURCES');
});
