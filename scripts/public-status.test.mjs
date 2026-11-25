import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DOWN_AFTER, LIVE_NETWORK_URL, SCHEMA, SERVICES, USER_AGENT, advance, dailyHistory, emptyState, fetchIncidents,
  main, pagesSite, parseState, probeAll, probeService, readPublishedState, renderFeed, renderPage, uptime,
} from './public-status.mjs';

const sha = 'a'.repeat(64);
const SIZES = { 'windows-x64': 4096, 'linux-x64': 5000, android: 3000 };
const CATALOG = {
  schema: 'mycellios-desktop-downloads/1',
  version: '0.3.50',
  runtimeVersion: '0.2.0',
  channel: 'preview',
  automaticUpdates: false,
  packages: [
    { id: 'windows-x64', format: 'EXE', fileName: 'Mycellios.exe', path: `/downloads/desktop/releases/0.3.50/Mycellios.exe?sha256=${sha}`, sha256: sha, bytes: SIZES['windows-x64'] },
    { id: 'linux-x64', format: 'DEB', fileName: 'mycellios.deb', path: '/downloads/desktop/releases/0.3.50/mycellios.deb', sha256: sha, bytes: SIZES['linux-x64'] },
  ],
  source: { path: '/downloads/desktop/releases/0.3.50/source.tar.gz', sha256: sha },
};
const ANDROID = { schema: 'mycellios-android-download/1', path: '/downloads/android/releases/1.0.0/mycellios.apk', bytes: SIZES.android };

const html = (_req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><title>page</title>'); };
const json = (status, body) => (_req, res) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
const redirect = location => (_req, res) => { res.writeHead(302, { location }); res.end(); };
const later = (ms, handler) => (req, res) => {
  const timer = setTimeout(() => handler(req, res), ms);
  res.on('close', () => clearTimeout(timer));
};
// An exact 1 KiB range of a file of `size` bytes, as a download edge answers.
const partial = (size, total = size) => (req, res) => {
  if (req.headers.range !== 'bytes=0-1023') { res.writeHead(200, { 'content-length': size }); res.end(Buffer.alloc(size)); return; }
  res.writeHead(206, { 'content-range': `bytes 0-1023/${total}`, 'content-length': 1024 });
  res.end(Buffer.alloc(1024));
};

/** A fake origin with the public routes the probes read; tests replace any route. */
async function serve(overrides = {}) {
  const requests = [];
  const routes = {
    '/': html,
    '/agent/': redirect('/agent/app'),
    '/agent/app': html,
    '/agent/api/v1/status': json(200, { status: 'ok' }),
    '/agent/api/auth/get-session': json(200, null),
    '/health': json(200, { status: 'ok', revision: 'f00d', workers: { registered: 9, online: 4 } }),
    '/public/v1/desktop-downloads': json(200, CATALOG),
    '/downloads/android/latest.json': json(200, ANDROID),
    '/downloads/desktop/latest/windows-x64': redirect('/files/windows-x64'),
    '/downloads/desktop/latest/linux-x64': redirect('/files/linux-x64'),
    '/files/windows-x64': partial(SIZES['windows-x64']),
    '/files/linux-x64': partial(SIZES['linux-x64']),
    [ANDROID.path]: partial(SIZES.android),
    ...overrides,
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://fake');
    requests.push({ path: url.pathname, search: url.search, headers: req.headers });
    const route = routes[url.pathname];
    if (route) return route(req, res, url);
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404 Not Found');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }),
  };
}

const noSleep = async () => {};
const byId = id => SERVICES.find(service => service.id === id);
async function probeWith(overrides, id, options = {}) {
  const fake = await serve(overrides);
  try {
    return await probeService(byId(id), { origin: fake.origin, sleep: noSleep, ...options });
  } finally {
    await fake.close();
  }
}

test('every service passes against a healthy origin, probed anonymously', async () => {
  const fake = await serve();
  try {
    const results = await probeAll({ origin: fake.origin, sleep: noSleep });
    for (const service of SERVICES) {
      assert.equal(results[service.id].ok, true, `${service.id}: ${results[service.id].reason}`);
      assert.ok(Number.isInteger(results[service.id].ms) && results[service.id].ms >= 0);
    }
    for (const request of fake.requests) {
      assert.equal(request.headers['user-agent'], USER_AGENT, request.path);
      assert.equal(request.headers.authorization, undefined, request.path);
      assert.equal(request.headers.cookie, undefined, request.path);
    }
    // Stable desktop routes and the Android pointer get the release verifier's ranged check.
    for (const target of ['/downloads/desktop/latest/windows-x64', '/downloads/desktop/latest/linux-x64', '/files/linux-x64', ANDROID.path]) {
      assert.ok(fake.requests.some(request => request.path === target && request.headers.range === 'bytes=0-1023'), target);
    }
    assert.ok(fake.requests.some(request => request.path === '/public/v1/desktop-downloads' && request.search === '?include=macos-all'));
    // The coordinator's worker counts never leave the probe.
    assert.ok(!JSON.stringify(results).includes('registered'));
  } finally {
    await fake.close();
  }
});

test('a slow answer within the deadline passes with its response time', async () => {
  const result = await probeWith({ '/': later(150, html) }, 'site', { timeoutMs: 5000 });
  assert.equal(result.ok, true);
  assert.ok(result.ms >= 140, String(result.ms));
});

test('an answer past the deadline fails as a timeout', async () => {
  assert.deepEqual(await probeWith({ '/': later(2000, html) }, 'site', { timeoutMs: 200 }), { ok: false, ms: null, reason: 'timeout' });
  assert.deepEqual(await probeWith({ '/agent/api/v1/status': later(2000, json(200, { status: 'ok' })) }, 'agent-api', { timeoutMs: 200 }),
    { ok: false, ms: null, reason: 'timeout' });
});

test('errors, degraded readiness and unexpected answers fail with a content-free reason', async () => {
  const cases = [
    ['site', { '/': json(500, { error: 'secret detail' }) }, 'http_500'],
    ['site', { '/': json(200, {}) }, 'unexpected_content'],
    ['agent', { '/agent/app': (_req, res) => { res.writeHead(502); res.end(); } }, 'http_502'],
    ['agent-api', { '/agent/api/v1/status': json(503, { status: 'degraded' }) }, 'degraded'],
    ['agent-api', { '/agent/api/v1/status': (_req, res) => { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('404 Not Found'); } }, 'http_404'],
    ['agent-api', { '/agent/api/v1/status': html }, 'unexpected_content'],
    ['sign-in', { '/agent/api/auth/get-session': html }, 'unexpected_content'],
    ['sign-in', { '/agent/api/auth/get-session': json(200, { user: { id: 'someone' } }) }, 'unexpected_content'],
    ['sign-in', { '/agent/api/auth/get-session': json(401, null) }, 'http_401'],
    ['coordinator', { '/health': json(200, { status: 'starting' }) }, 'unexpected_content'],
    ['coordinator', { '/health': (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"status":'); } }, 'unexpected_content'],
  ];
  for (const [id, overrides, reason] of cases) {
    assert.deepEqual(await probeWith(overrides, id), { ok: false, ms: null, reason }, `${id} ${reason}`);
  }
});

test('a page that redirects to another origin does not count as the app', async () => {
  const elsewhere = await serve();
  try {
    assert.equal((await probeWith({ '/agent/': redirect(`${elsewhere.origin}/agent/app`) }, 'agent')).reason, 'redirected_elsewhere');
  } finally {
    await elsewhere.close();
  }
});

test('downloads fail on a wrong size, a missing route, a bad catalog or a stalled edge', async () => {
  const cases = [
    [{ '/files/windows-x64': partial(SIZES['windows-x64'], 8192) }, 'windows-x64: range_mismatch'],
    [{ '/downloads/desktop/latest/linux-x64': (_req, res) => { res.writeHead(404); res.end(); } }, 'linux-x64: http_404'],
    [{ [ANDROID.path]: (_req, res) => { res.writeHead(200, { 'content-length': 10 }); res.end(Buffer.alloc(10)); } }, 'android: range_ignored'],
    [{ '/public/v1/desktop-downloads': json(200, { ...CATALOG, automaticUpdates: true }) }, 'catalog: invalid'],
    [{ '/public/v1/desktop-downloads': json(503, {}) }, 'catalog: http_503'],
    [{ '/downloads/android/latest.json': json(200, { ...ANDROID, path: 'https://elsewhere.invalid/app.apk' }) }, 'android: invalid'],
  ];
  for (const [overrides, reason] of cases) {
    assert.deepEqual(await probeWith(overrides, 'downloads'), { ok: false, ms: null, reason }, reason);
  }
  const stalled = await probeWith({ '/files/linux-x64': later(2000, partial(SIZES['linux-x64'])) }, 'downloads', { timeoutMs: 200 });
  assert.equal(stalled.reason, 'linux-x64: timeout');
});

test('a cold download edge that ignores Range once is retried, as the release verifier does', async () => {
  let calls = 0;
  const waits = [];
  const cold = (req, res) => (calls++ === 0 ? partial(SIZES['windows-x64'])({ headers: {} }, res) : partial(SIZES['windows-x64'])(req, res));
  const result = await probeWith({ '/files/windows-x64': cold }, 'downloads', { sleep: async ms => waits.push(ms) });
  assert.equal(result.ok, true, result.reason);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [1000]);
});

const results = (failing = {}, ms = 100) => Object.fromEntries(SERVICES.map(service => [service.id,
  failing[service.id] ? { ok: false, ms: null, reason: failing[service.id] } : { ok: true, ms, reason: null }]));
const minute = (hours, minutes = 0) => new Date(Date.UTC(2026, 10, 25, hours, minutes));

test('two failed probes in a row mark a service degraded and four mark it down', () => {
  let state = emptyState();
  const run = (failing, at) => {
    state = advance(state, results(failing ? { 'agent-api': 'http_503' } : {}), { now: at });
    return state.services.find(service => service.id === 'agent-api');
  };
  assert.equal(run(false, minute(10, 0)).state, 'operational');
  assert.equal(run(true, minute(10, 5)).state, 'operational');
  assert.equal(run(false, minute(10, 10)).state, 'operational');
  assert.equal(run(true, minute(10, 15)).state, 'operational');
  const degraded = run(true, minute(10, 20));
  assert.deepEqual([degraded.state, degraded.failures, degraded.since], ['degraded', 2, minute(10, 20).toISOString()]);
  assert.equal(state.state, 'degraded');
  assert.equal(run(true, minute(10, 25)).state, 'degraded');
  const down = run(true, minute(10, 30));
  assert.deepEqual([down.state, down.failures, down.responseMs, down.lastFailure], ['down', DOWN_AFTER, null, { at: minute(10, 30).toISOString(), reason: 'http_503' }]);
  assert.equal(state.state, 'down');
  const back = run(false, minute(10, 35));
  assert.deepEqual([back.state, back.failures, back.responseMs, back.since], ['operational', 0, 100, minute(10, 35).toISOString()]);
  assert.deepEqual(state.events.map(event => [event.service, event.from, event.to, event.reason]), [
    ['agent-api', 'operational', 'degraded', 'http_503'],
    ['agent-api', 'degraded', 'down', 'http_503'],
    ['agent-api', 'down', 'operational', null],
  ]);
  // One hour: 8 checks, 5 failed, the mean of the successful response times, worst state down.
  assert.deepEqual(state.history.services['agent-api'], [[8, 5, 100, 2]]);
  assert.deepEqual(state.history.services.site, [[8, 0, 100, 0]]);
});

test('hourly summaries average successful checks, keep gaps empty and stop at 90 days', () => {
  const base = Date.UTC(2026, 7, 1);
  const at = hours => new Date(base + hours * 3_600_000);
  let state = advance(emptyState(), results({}, 100), { now: at(0) });
  state = advance(state, results({}, 301), { now: at(0.5) });
  state = advance(state, results({ site: 'timeout' }), { now: at(0.75) });
  assert.deepEqual(state.history.services.site, [[3, 1, 201, 0]]);
  state = advance(state, results({}, 50), { now: at(3) });
  assert.deepEqual(state.history.services.site, [[3, 1, 201, 0], null, null, [1, 0, 50, 0]]);
  // The published JSON is the next run's state.
  const reread = parseState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(reread.history.services.site, state.history.services.site);
  assert.deepEqual(reread.services.map(service => service.failures), state.services.map(service => service.failures));
  state = advance(reread, results({}, 70), { now: at(90 * 24 + 2) });
  assert.equal(state.history.services.site.length, 90 * 24);
  assert.equal(state.history.start, at(3).toISOString());
  assert.deepEqual(state.history.services.site[0], [1, 0, 50, 0]);
  assert.deepEqual(state.history.services.site.at(-1), [1, 0, 70, 0]);
  const days = dailyHistory(state, 'site');
  assert.equal(days.length, 90);
  assert.deepEqual([days.at(-1).checks, days.at(-1).failures], [1, 0]);
  assert.equal(uptime(days), '100%');
  assert.equal(uptime([{ checks: 3000, failures: 1 }]), '99.96%');
  assert.equal(uptime([{ checks: 0, failures: 0 }]), null);
});

test('the published state is read past the Pages cache, and a missing one starts a history', async () => {
  const valid = advance(emptyState(), results({ 'agent-api': 'http_503' }), { now: minute(9) });
  const published = JSON.parse(JSON.stringify(valid));
  published.services.push({ id: 'unknown', state: 'down', since: minute(9).toISOString(), failures: 9 });
  published.history.services.site = [[1, 2, null, 0]];
  const fake = await serve({
    '/site/status.json': json(200, published),
    '/broken/status.json': (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('<html>'); },
    '/other/status.json': json(200, { ...published, schema: 'something-else/1' }),
    '/failing/status.json': json(503, {}),
  });
  try {
    const state = await readPublishedState(`${fake.origin}/site/`, { nonce: 42 });
    assert.equal(fake.requests.at(-1).search, '?run=42');
    assert.deepEqual(state.services.map(service => service.id), SERVICES.map(service => service.id));
    assert.equal(state.services.find(service => service.id === 'agent-api').failures, 1);
    assert.equal(state.history.services.site, undefined, 'an impossible summary is dropped');
    assert.deepEqual(state.history.services.downloads, valid.history.services.downloads);
    assert.deepEqual(await readPublishedState(`${fake.origin}/missing/`), emptyState());
    await assert.rejects(readPublishedState(`${fake.origin}/failing/`), /HTTP 503.*published page is kept/);
    await assert.rejects(readPublishedState(`${fake.origin}/broken/`), /reset_history/);
    await assert.rejects(readPublishedState(`${fake.origin}/other`), /reset_history/);
  } finally {
    await fake.close();
  }
});

const day = 86_400_000;
const issue = (number, fields) => ({
  number,
  html_url: `https://github.com/Mycellios/mycellios/issues/${number}`,
  title: `Issue ${number}`,
  body: '',
  state: 'open',
  state_reason: null,
  author_association: 'OWNER',
  labels: [{ name: 'status' }],
  comments: 0,
  created_at: '2026-11-25T08:00:00Z',
  updated_at: '2026-11-25T09:00:00Z',
  closed_at: null,
  ...fields,
});

test('incidents are status issues that maintainers open, with their maintainer updates', async () => {
  const now = new Date('2026-11-25T10:00:00Z');
  const closed = daysAgo => new Date(now.getTime() - daysAgo * day).toISOString();
  const issues = [
    issue(1, { title: 'Sign-in <script>alert(1)</script> fails', body: 'Investigating.<!-- template note -->\r\n\r\n\r\n\u0007Next update soon.', comments: 2 }),
    issue(2, { pull_request: {} }),
    issue(3, { author_association: 'NONE', title: 'Spam' }),
    issue(4, { state: 'closed', state_reason: 'completed', closed_at: closed(10), author_association: 'COLLABORATOR', labels: [{ name: 'status' }, { name: 'Maintenance' }] }),
    issue(5, { state: 'closed', state_reason: 'not_planned', closed_at: closed(1) }),
    issue(6, { state: 'closed', state_reason: 'completed', closed_at: closed(120) }),
  ];
  const comments = [
    { created_at: '2026-11-25T09:30:00Z', author_association: 'OWNER', body: 'Fixed the proxy.' },
    { created_at: '2026-11-25T09:40:00Z', author_association: 'NONE', body: 'Buy now' },
  ];
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), authorization: init.headers.Authorization });
    return Response.json(String(url).includes('/comments') ? comments : issues);
  };
  const incidents = await fetchIncidents({ repository: 'Mycellios/mycellios', apiUrl: 'https://api.github.test', token: 'token', fetchImpl, now });
  assert.deepEqual(incidents.map(incident => [incident.number, incident.kind, incident.open]), [[1, 'incident', true], [4, 'maintenance', false]]);
  assert.equal(incidents[0].title, 'Sign-in <script>alert(1)</script> fails');
  assert.equal(incidents[0].body, 'Investigating.\n\nNext update soon.');
  assert.deepEqual(incidents[0].updates, [{ at: '2026-11-25T09:30:00Z', body: 'Fixed the proxy.' }]);
  assert.equal(calls[0].url, 'https://api.github.test/repos/Mycellios/mycellios/issues?labels=status&state=all&sort=created&direction=desc&per_page=50');
  assert.deepEqual(calls.map(call => call.url).slice(1), ['https://api.github.test/repos/Mycellios/mycellios/issues/1/comments?per_page=100']);
  assert.ok(calls.every(call => call.authorization === 'Bearer token'));
  // An unchanged issue keeps the updates already read; a new comment changes its updated_at.
  calls.length = 0;
  const again = await fetchIncidents({ repository: 'Mycellios/mycellios', apiUrl: 'https://api.github.test', token: 'token', fetchImpl, now, previous: incidents });
  assert.deepEqual(again, incidents);
  assert.equal(calls.length, 1);
  issues[0].updated_at = '2026-11-25T09:45:00Z';
  await fetchIncidents({ repository: 'Mycellios/mycellios', apiUrl: 'https://api.github.test', token: 'token', fetchImpl, now, previous: incidents });
  assert.equal(calls.length, 3);
  await assert.rejects(fetchIncidents({ repository: 'Mycellios/mycellios', fetchImpl: async () => new Response('', { status: 502 }), now }), /502/);
});

test('Pages deploys only when it publishes from GitHub Actions', async () => {
  const site = (status, body) => async () => (status === 404 ? new Response('', { status }) : Response.json(body, { status }));
  const options = fetchImpl => ({ repository: 'Mycellios/mycellios', token: 'token', fetchImpl });
  assert.equal((await pagesSite(options(site(404)))).deploy, false);
  assert.deepEqual(await pagesSite(options(site(200, { build_type: 'legacy', html_url: 'https://mycellios.github.io/mycellios/' }))),
    { deploy: false, url: 'https://mycellios.github.io/mycellios/', reason: 'GitHub Pages does not publish from GitHub Actions.' });
  assert.deepEqual(await pagesSite(options(site(200, { build_type: 'workflow', html_url: 'https://status.mycellios.com' }))),
    { deploy: true, url: 'https://status.mycellios.com/', reason: null });
  await assert.rejects(pagesSite(options(site(403, {}))), /HTTP 403/);
});

/** Tags balance and every ampersand starts an entity, so the feed parses as XML. */
function assertWellFormed(text) {
  const open = [];
  for (const [tag] of text.matchAll(/<[^>]*>/g)) {
    if (tag.startsWith('<?') || tag.endsWith('/>')) continue;
    const name = /^<\/?([A-Za-z][\w:-]*)/.exec(tag)?.[1];
    assert.ok(name, tag);
    if (tag.startsWith('</')) assert.equal(open.pop(), name, tag);
    else open.push(name);
  }
  assert.deepEqual(open, []);
  assert.ok(!/&(?!(amp|lt|gt|quot|#39);)/.test(text));
}

function fixtureState() {
  const incidents = [
    { number: 7, url: 'https://github.com/Mycellios/mycellios/issues/7', kind: 'incident', title: 'Sign-in <b>fails</b> & retries', open: true,
      createdAt: '2026-11-25T09:00:00Z', updatedAt: '2026-11-25T09:50:00Z', closedAt: null, body: 'We are looking into it <img src=x onerror=alert(1)>.',
      updates: [{ at: '2026-11-25T09:50:00Z', body: 'Found the cause.' }] },
    { number: 3, url: 'https://github.com/Mycellios/mycellios/issues/3', kind: 'maintenance', title: 'Database upgrade', open: false,
      createdAt: '2026-11-20T09:00:00Z', updatedAt: '2026-11-20T11:00:00Z', closedAt: '2026-11-20T11:00:00Z', body: '', updates: [] },
  ];
  let state = emptyState();
  for (const [index, failing] of [{}, { 'agent-api': 'http_503' }, { 'agent-api': 'http_503' }, { 'agent-api': 'http_503' }, { 'agent-api': 'http_503', downloads: 'android: timeout' }].entries()) {
    state = advance(state, results(failing, 120 + index), { now: minute(10, index * 5), incidents });
  }
  return state;
}

test('the page shows state, response time and incident text as escaped text, with no figures or script', () => {
  const page = renderPage(fixtureState());
  for (const text of ['Service outage', 'Agent API', '<span class="dot"></span>Down', 'Response 124 ms', 'Live network', 'Current incidents and maintenance',
    'Sign-in &lt;b&gt;fails&lt;/b&gt; &amp; retries', 'We are looking into it &lt;img src=x onerror=alert(1)&gt;.', 'Found the cause.', 'Database upgrade',
    'The last 4 checks failed (http_503).', 'The last check failed (android: timeout).', 'feed.atom', 'status.json', '25 Nov 2026, 10:20 UTC']) {
    assert.ok(page.includes(text), text);
  }
  assert.ok(page.includes(`href="${LIVE_NETWORK_URL}"`));
  assert.ok(!/<script|<img|<b>|javascript:/i.test(page));
  assert.ok(!/gradient/i.test(page));
  for (const figure of ['registered', 'online', 'workers', 'revision']) assert.ok(!page.includes(figure), figure);
  assert.equal((page.match(/<span class="(operational|degraded|down|none)" title=/g) ?? []).length, SERVICES.length * 90);
  const quiet = renderPage(advance(emptyState(), results(), { now: minute(10), incidents: [] }));
  assert.ok(quiet.includes('All systems operational') && quiet.includes('No incidents in the last 90 days.'));
});

test('the Atom feed carries incidents and service changes as well-formed text entries', () => {
  const feed = renderFeed(fixtureState(), { pagesUrl: 'https://status.mycellios.com' });
  assertWellFormed(feed);
  assert.ok(feed.includes('<link rel="self" type="application/atom+xml" href="https://status.mycellios.com/feed.atom"/>'));
  for (const text of ['<title>Incident: Sign-in &lt;b&gt;fails&lt;/b&gt; &amp; retries</title>', '<title>Resolved maintenance: Database upgrade</title>',
    '<title>Agent API is degraded</title>', '<title>Agent API is down</title>', '<id>tag:mycellios.com,2026:status/issue/7</id>',
    '25 Nov 2026, 09:50 UTC: Found the cause.', '<updated>2026-11-25T10:20:00.000Z</updated>']) {
    assert.ok(feed.includes(text), text);
  }
  assert.equal((feed.match(/<entry>/g) ?? []).length, 4);
});

test('a dry run builds the page, JSON and feed from the published state and a fake origin', async () => {
  const previous = advance(emptyState(), results({ 'agent-api': 'http_503' }), { now: new Date(Date.now() - 300_000) });
  const fake = await serve({
    '/agent/api/v1/status': json(503, { status: 'degraded' }),
    '/site/status.json': json(200, previous),
    '/repos/Mycellios/mycellios/issues': json(200, [issue(9, { title: 'Agent API degraded' })]),
    '/repos/Mycellios/mycellios/pages': (_req, res) => { res.writeHead(404); res.end(); },
  });
  const directory = await mkdtemp(path.join(tmpdir(), 'public-status-'));
  const output = path.join(directory, 'github-output');
  const logs = [];
  try {
    const env = { GITHUB_REPOSITORY: 'Mycellios/mycellios', GITHUB_API_URL: fake.origin, GH_TOKEN: 'token', GITHUB_OUTPUT: output };
    const pages = await main(['pages'], { env, log: line => logs.push(line) });
    assert.equal(pages.deploy, false);
    assert.equal(await readFile(output, 'utf8'), 'deploy=false\nurl=\n');
    assert.match(logs[0], /^::warning title=Status page not deployed::GitHub Pages is not enabled/);
    const site = path.join(directory, 'site');
    await main(['build', site], { env: { ...env, STATUS_PAGES_URL: `${fake.origin}/site/`, STATUS_ORIGIN: fake.origin }, log: line => logs.push(line) });
    const state = JSON.parse(await readFile(path.join(site, 'status.json'), 'utf8'));
    assert.equal(state.schema, SCHEMA);
    const api = state.services.find(service => service.id === 'agent-api');
    assert.deepEqual([api.state, api.failures, api.lastFailure.reason], ['degraded', 2, 'degraded']);
    assert.equal(state.services.filter(service => service.state === 'operational').length, SERVICES.length - 1);
    assert.deepEqual(state.incidents.map(incident => incident.title), ['Agent API degraded']);
    assert.ok((await readFile(path.join(site, 'index.html'), 'utf8')).includes('Agent API degraded'));
    assertWellFormed(await readFile(path.join(site, 'feed.atom'), 'utf8'));
    assert.ok(logs.includes('Agent API: degraded (degraded)'));
    await assert.rejects(main(['build'], { env }), /Usage/);
  } finally {
    await fake.close();
    await rm(directory, { recursive: true, force: true });
  }
});
