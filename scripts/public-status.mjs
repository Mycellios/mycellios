// The public status page (specs/trusted-distribution/spec.md, phase 2), built every five minutes
// by .github/workflows/public-status.yml on a GitHub-hosted runner and deployed to GitHub Pages,
// outside the servers it reports on.
//
// Each run probes public endpoints only, with no credentials, account, model call or user content:
// the site, the Agent app, Agent's content-free readiness read, the sessionless sign-in read, the
// status field of the coordinator's /health and the stable download routes, with the release
// verifier's ranged check (installer-public-probe.mjs). The published status.json is the previous
// state, so a run writes no commits. Two failed probes in a row mark a service degraded, four mark
// it down, and 90 days of hourly summaries are kept. Incidents and maintenance are issues with the
// `status` label (plus `maintenance` for planned work) that maintainers open and close. The page
// shows states, response times and incident text, never traffic, account or usage figures.
//
//   node scripts/public-status.mjs pages         whether Pages publishes from GitHub Actions
//   node scripts/public-status.mjs build <dir>   probe, then write index.html, status.json, feed.atom
//
// Environment: GITHUB_REPOSITORY, GITHUB_API_URL and GH_TOKEN for the Pages and issue reads,
// GITHUB_OUTPUT, STATUS_PAGES_URL (the published site; empty before Pages is enabled) and
// STATUS_RESET=true to start a new history. STATUS_ORIGIN probes another origin for a dry run.
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopLatestDownloadPath, isDesktopDownloadCatalog } from '../src/contracts/desktop-downloads.ts';
import { verifyPublicInstallerRange } from './installer-public-probe.mjs';

export const ORIGIN = 'https://www.mycellios.com';
export const LIVE_NETWORK_URL = `${ORIGIN}/network`;
export const SCHEMA = 'mycellios-status/1';
export const STATUS_LABEL = 'status';
export const MAINTENANCE_LABEL = 'maintenance';
export const DEGRADED_AFTER = 2;
export const DOWN_AFTER = 4;
export const HISTORY_DAYS = 90;
export const PROBE_TIMEOUT_MS = 10_000;
export const STATES = Object.freeze(['operational', 'degraded', 'down']);
export const USER_AGENT = 'MycelliosStatus/1 (+https://github.com/Mycellios/mycellios)';
const SOURCE_URL = 'https://github.com/Mycellios/mycellios';
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const HISTORY_HOURS = HISTORY_DAYS * 24;
const MAX_EVENTS = 200;
const MAX_INCIDENTS = 20;
const MAX_UPDATES = 10;
const JSON_LIMIT = 256 * 1024;
const STATE_LIMIT = 8 * 1024 * 1024;
// Only issues and comments by people who can label issues reach the page.
const MAINTAINERS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

export const SERVICES = Object.freeze([
  { id: 'site', name: 'Website', description: 'The Mycellios site.', probe: { kind: 'page', path: '/' } },
  { id: 'agent', name: 'Agent app', description: 'The Mycellios Agent web app.', probe: { kind: 'page', path: '/agent/' } },
  { id: 'agent-api', name: 'Agent API', description: "Agent's readiness, including its database.", probe: { kind: 'readiness', path: '/agent/api/v1/status' } },
  { id: 'sign-in', name: 'Sign-in', description: 'The Agent sign-in session read, made without a session.', probe: { kind: 'session', path: '/agent/api/auth/get-session' } },
  { id: 'coordinator', name: 'Network coordinator', description: "The network coordinator's health check.", probe: { kind: 'health', path: '/health' } },
  { id: 'downloads', name: 'Downloads', description: 'Desktop installers through their stable links, and the Android app.', probe: { kind: 'downloads' } },
]);

class ProbeFailure extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}
const fail = reason => { throw new ProbeFailure(reason); };

/** A short content-free code: the page shows it, so it never carries a response body. */
export function failureReason(error) {
  if (error instanceof ProbeFailure) return error.reason;
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'timeout';
  const message = String(error?.message ?? '');
  // The release verifier's own errors (installer-public-probe.mjs).
  const status = /failed \((\d{3})\)/.exec(message);
  if (status) return status[1] === '206' ? 'range_mismatch' : `http_${status[1]}`;
  if (/ignored Range/.test(message)) return 'range_ignored';
  if (/truncated|exceeded/.test(message)) return 'range_mismatch';
  if (error instanceof TypeError) return 'network';
  return 'failed';
}

function request(origin, target, { fetchImpl = fetch, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  // No cookie, authorization or account: the probe is an anonymous visitor.
  return fetchImpl(new URL(target, origin), {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function readBounded(response, limit) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) fail('response_too_large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function expectStatus(response, ...allowed) {
  if (allowed.includes(response.status)) return;
  await response.body?.cancel().catch(() => {});
  fail(`http_${response.status}`);
}

async function readJson(response, limit = JSON_LIMIT) {
  if (!/^application\/json\b/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel().catch(() => {});
    fail('unexpected_content');
  }
  try {
    return JSON.parse(await readBounded(response, limit));
  } catch (error) {
    if (error instanceof ProbeFailure) throw error;
    fail('unexpected_content');
  }
}

// The release verifier always names the public origin; a dry run points it at another one.
function rangeFetch(origin, { fetchImpl = fetch, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  return (url, init = {}) => {
    const target = new URL(url);
    return fetchImpl(new URL(target.pathname + target.search, origin), {
      ...init,
      headers: { ...init.headers, 'User-Agent': USER_AGENT },
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
  };
}

const CHECKS = {
  async page(origin, probe, options) {
    const response = await request(origin, probe.path, options);
    await response.body?.cancel().catch(() => {});
    if (response.status !== 200) fail(`http_${response.status}`);
    if (new URL(response.url).origin !== new URL(origin).origin) fail('redirected_elsewhere');
    if (!/^text\/html\b/i.test(response.headers.get('content-type') ?? '')) fail('unexpected_content');
  },
  async readiness(origin, probe, options) {
    const response = await request(origin, probe.path, options);
    await expectStatus(response, 200, 503);
    const body = await readJson(response);
    if (response.status === 200 && body?.status === 'ok') return;
    fail(response.status === 503 && body?.status === 'degraded' ? 'degraded' : 'unexpected_content');
  },
  async session(origin, probe, options) {
    const response = await request(origin, probe.path, options);
    await expectStatus(response, 200);
    // Without a session cookie the sign-in read answers null.
    if ((await readJson(response)) !== null) fail('unexpected_content');
  },
  async health(origin, probe, options) {
    const response = await request(origin, probe.path, options);
    await expectStatus(response, 200);
    // Only the status field is read; worker counts and versions are never kept or published.
    if ((await readJson(response))?.status !== 'ok') fail('unexpected_content');
  },
  async downloads(origin, _probe, options) {
    const read = async (label, target, valid) => {
      try {
        const response = await request(origin, target, options);
        await expectStatus(response, 200);
        const body = await readJson(response);
        if (!valid(body)) fail('invalid');
        return body;
      } catch (error) {
        fail(`${label}: ${failureReason(error)}`);
      }
    };
    const [catalog, android] = await Promise.all([
      read('catalog', '/public/v1/desktop-downloads?include=macos-all', isDesktopDownloadCatalog),
      read('android', '/downloads/android/latest.json', body => body?.schema === 'mycellios-android-download/1'
        && typeof body.path === 'string' && body.path.startsWith('/downloads/android/') && Number.isSafeInteger(body.bytes)),
    ]);
    const files = [
      ...[...catalog.packages, ...(catalog.fedora ? [catalog.fedora] : [])]
        .map(item => ({ id: item.id, path: desktopLatestDownloadPath(item.id), bytes: item.bytes })),
      { id: 'android', path: android.path, bytes: android.bytes },
    ];
    const fetchImpl = rangeFetch(origin, options);
    const results = await Promise.allSettled(files.map(file => verifyPublicInstallerRange(file, { fetchImpl, sleep: options.sleep })));
    const failed = results.flatMap((result, index) => (result.status === 'rejected' ? [`${files[index].id}: ${failureReason(result.reason)}`] : []));
    if (failed.length) fail(failed.join(', '));
  },
};

/** One probe of one service: ok and its response time in milliseconds, or a failure reason. */
export async function probeService(service, { origin = ORIGIN, ...options } = {}) {
  const started = performance.now();
  try {
    await CHECKS[service.probe.kind](origin, service.probe, options);
    return { ok: true, ms: Math.round(performance.now() - started), reason: null };
  } catch (error) {
    return { ok: false, ms: null, reason: failureReason(error) };
  }
}

export async function probeAll(options = {}) {
  return Object.fromEntries(await Promise.all(SERVICES.map(async service => [service.id, await probeService(service, options)])));
}

export const stateFor = failures => (failures >= DOWN_AFTER ? 'down' : failures >= DEGRADED_AFTER ? 'degraded' : 'operational');
const worstOf = states => STATES[Math.max(0, ...states.map(state => STATES.indexOf(state)))];

export function emptyState() {
  return { schema: SCHEMA, generatedAt: null, state: 'operational', services: [], incidents: [], events: [], history: { start: null, services: {} } };
}

const isTime = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const shortText = (value, limit) => (typeof value === 'string' ? value.slice(0, limit) : null);

/** The previous run's published state, keeping only well-formed fields it needs. */
export function parseState(value) {
  if (value?.schema !== SCHEMA) throw new Error(`The published status.json is not ${SCHEMA}; run the workflow manually with reset_history to start a new history.`);
  const known = new Set(SERVICES.map(service => service.id));
  const services = (Array.isArray(value.services) ? value.services : [])
    .filter(item => known.has(item?.id) && STATES.includes(item.state) && isCount(item.failures) && isTime(item.since))
    .map(item => ({
      id: item.id,
      state: item.state,
      since: item.since,
      failures: item.failures,
      checkedAt: isTime(item.checkedAt) ? item.checkedAt : null,
      responseMs: isCount(item.responseMs) ? item.responseMs : null,
      lastFailure: isTime(item.lastFailure?.at) && typeof item.lastFailure.reason === 'string'
        ? { at: item.lastFailure.at, reason: item.lastFailure.reason.slice(0, 300) } : null,
    }));
  const events = (Array.isArray(value.events) ? value.events : [])
    .filter(event => isTime(event?.at) && known.has(event.service) && STATES.includes(event.from) && STATES.includes(event.to))
    .map(event => ({ at: event.at, service: event.service, from: event.from, to: event.to, reason: shortText(event.reason, 300) }))
    .slice(-MAX_EVENTS);
  const slot = entry => entry === null || (Array.isArray(entry) && entry.length === 4 && isCount(entry[0]) && isCount(entry[1])
    && entry[1] <= entry[0] && (entry[2] === null || isCount(entry[2])) && [0, 1, 2].includes(entry[3]));
  const history = { start: null, services: {} };
  if (isTime(value.history?.start) && Date.parse(value.history.start) % HOUR_MS === 0) {
    history.start = new Date(Date.parse(value.history.start)).toISOString();
    for (const id of known) {
      const series = value.history.services?.[id];
      if (Array.isArray(series) && series.length <= HISTORY_HOURS && series.every(slot)) history.services[id] = series;
    }
  }
  const incidents = (Array.isArray(value.incidents) ? value.incidents : []).filter(validIncident).slice(0, MAX_INCIDENTS);
  return { ...emptyState(), generatedAt: isTime(value.generatedAt) ? value.generatedAt : null, services, events, history, incidents };
}

function validIncident(item) {
  return Number.isSafeInteger(item?.number) && typeof item.url === 'string' && /^https:\/\/github\.com\//.test(item.url)
    && ['incident', 'maintenance'].includes(item.kind) && typeof item.title === 'string' && typeof item.open === 'boolean'
    && isTime(item.createdAt) && isTime(item.updatedAt) && (item.open ? item.closedAt === null : isTime(item.closedAt))
    && typeof item.body === 'string' && Array.isArray(item.updates)
    && item.updates.every(update => isTime(update?.at) && typeof update.body === 'string');
}

/** Adds one run's probes: consecutive failures set each state, and each hour keeps a summary. */
export function advance(previous, results, { now = new Date(), incidents = previous.incidents } = {}) {
  const at = now.toISOString();
  const prior = new Map(previous.services.map(service => [service.id, service]));
  const events = [...previous.events];
  const services = SERVICES.map(service => {
    const before = prior.get(service.id);
    const result = results[service.id] ?? { ok: false, ms: null, reason: 'not_probed' };
    const failures = result.ok ? 0 : (before?.failures ?? 0) + 1;
    const state = stateFor(failures);
    const changed = Boolean(before) && before.state !== state;
    if (changed) events.push({ at, service: service.id, from: before.state, to: state, reason: result.ok ? null : result.reason });
    return {
      id: service.id,
      name: service.name,
      description: service.description,
      state,
      since: before && !changed ? before.since : at,
      failures,
      checkedAt: at,
      responseMs: result.ok ? result.ms : null,
      lastFailure: result.ok ? (before?.lastFailure ?? null) : { at, reason: result.reason },
    };
  });
  const oldest = now.getTime() - HISTORY_DAYS * DAY_MS;
  return {
    schema: SCHEMA,
    generatedAt: at,
    state: worstOf(services.map(service => service.state)),
    liveNetwork: LIVE_NETWORK_URL,
    services,
    incidents,
    events: events.filter(event => Date.parse(event.at) >= oldest).slice(-MAX_EVENTS),
    history: record(previous.history, services, results, now),
  };
}

// history.services[id][i] summarizes the hour history.start + i: [checks, failures, mean response
// time of the successful checks or null, worst state as an index of STATES], or null for no check.
function record(history, services, results, now) {
  const hour = Math.floor(now.getTime() / HOUR_MS);
  const start = history.start === null ? hour : Date.parse(history.start) / HOUR_MS;
  const first = Math.max(Math.min(start, hour), hour - HISTORY_HOURS + 1);
  const series = {};
  for (const service of services) {
    const old = history.services[service.id] ?? [];
    const kept = Array.from({ length: hour - first + 1 }, (_, index) => old[first + index - start] ?? null);
    const result = results[service.id] ?? { ok: false, ms: null };
    const [checks, failures, ms, worst] = kept.at(-1) ?? [0, 0, null, 0];
    const passed = checks - failures;
    kept[kept.length - 1] = [
      checks + 1,
      failures + (result.ok ? 0 : 1),
      result.ok ? Math.round(ms === null ? result.ms : (ms * passed + result.ms) / (passed + 1)) : ms,
      Math.max(worst, STATES.indexOf(service.state)),
    ];
    series[service.id] = kept;
  }
  return { start: new Date(first * HOUR_MS).toISOString(), fields: ['checks', 'failures', 'responseMs', 'worst'], states: STATES, services: series };
}

/** Plain text for the page and feed: no markup, comments or control characters, bounded. */
export function plainText(value, limit) {
  const text = String(value ?? '').toWellFormed()
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?(-->|$)/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFE\uFFFF]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': USER_AGENT,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function githubJson(url, { token, fetchImpl = fetch }) {
  const response = await fetchImpl(url, { headers: githubHeaders(token), signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`GitHub answered ${response.status} for ${new URL(url).pathname}.`);
  }
  return response.json();
}

/**
 * Open issues with the status label, and those closed as completed in the last 90 days, opened by
 * maintainers. Comments by maintainers are the incident's updates. A comment changes the issue's
 * updated_at, so an unchanged issue keeps the updates of `previous` without another request.
 */
export async function fetchIncidents({ repository, apiUrl = 'https://api.github.com', token, fetchImpl = fetch, now = new Date(), previous = [] }) {
  const base = `${apiUrl}/repos/${repository}`;
  const issues = await githubJson(`${base}/issues?labels=${STATUS_LABEL}&state=all&sort=created&direction=desc&per_page=50`, { token, fetchImpl });
  const oldest = now.getTime() - HISTORY_DAYS * DAY_MS;
  const selected = (Array.isArray(issues) ? issues : [])
    .filter(issue => !issue.pull_request && MAINTAINERS.has(issue.author_association)
      && (issue.state === 'open' || (issue.state_reason !== 'not_planned' && Date.parse(issue.closed_at) >= oldest)))
    .slice(0, MAX_INCIDENTS);
  const known = new Map(previous.map(incident => [incident.number, incident]));
  const incidents = await Promise.all(selected.map(async issue => {
    const before = known.get(issue.number);
    return {
      number: issue.number,
      url: issue.html_url,
      kind: issue.labels?.some(label => (label?.name ?? label)?.toLowerCase?.() === MAINTENANCE_LABEL) ? 'maintenance' : 'incident',
      title: plainText(issue.title, 200).replace(/\s+/g, ' '),
      open: issue.state === 'open',
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      closedAt: issue.state === 'open' ? null : issue.closed_at,
      body: plainText(issue.body, 4000),
      updates: before?.updatedAt === issue.updated_at ? before.updates : await issueUpdates(base, issue, { token, fetchImpl }),
    };
  }));
  return incidents.filter(validIncident);
}

async function issueUpdates(base, issue, options) {
  if (!(issue.comments > 0)) return [];
  const comments = await githubJson(`${base}/issues/${issue.number}/comments?per_page=100`, options);
  return (Array.isArray(comments) ? comments : [])
    .filter(comment => MAINTAINERS.has(comment.author_association))
    .map(comment => ({ at: comment.created_at, body: plainText(comment.body, 2000) }))
    .filter(update => update.body)
    .slice(-MAX_UPDATES);
}

/** Whether Pages publishes this repository from GitHub Actions, and the site's address. */
export async function pagesSite({ repository, apiUrl = 'https://api.github.com', token, fetchImpl = fetch }) {
  const response = await fetchImpl(`${apiUrl}/repos/${repository}/pages`, { headers: githubHeaders(token), signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  if (response.status === 404) {
    return { deploy: false, url: null, reason: 'GitHub Pages is not enabled for this repository.' };
  }
  if (!response.ok) throw new Error(`Could not read the GitHub Pages settings (HTTP ${response.status}).`);
  const site = await response.json();
  const url = typeof site.html_url === 'string' && /^https?:\/\//.test(site.html_url) ? siteUrl(site.html_url) : null;
  if (site.build_type !== 'workflow' || !url) {
    return { deploy: false, url, reason: 'GitHub Pages does not publish from GitHub Actions.' };
  }
  return { deploy: true, url, reason: null };
}

const siteUrl = value => (value.endsWith('/') ? value : `${value}/`);
export const defaultPagesUrl = repository => {
  const [owner, name] = repository.split('/');
  return `https://${owner.toLowerCase()}.github.io/${name}/`;
};

/** The previous run's state from the published site; nothing published yet starts a history. */
export async function readPublishedState(pagesUrl, { fetchImpl = fetch, nonce = Date.now() } = {}) {
  const url = new URL('status.json', siteUrl(pagesUrl));
  // Pages caches files for minutes; a query of its own reads the current deployment.
  url.searchParams.set('run', String(nonce));
  const response = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  if (response.status === 404) {
    await response.body?.cancel().catch(() => {});
    return emptyState();
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Could not read the published status.json (HTTP ${response.status}); the published page is kept.`);
  }
  let value;
  try {
    value = JSON.parse(await readBounded(response, STATE_LIMIT));
  } catch {
    throw new Error('The published status.json is not readable JSON; run the workflow manually with reset_history to start a new history.');
  }
  return parseState(value);
}

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = value => String(value).padStart(2, '0');
const day = date => `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
export const formatTime = value => {
  const date = new Date(value);
  return `${day(date)}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
};
const time = value => `<time datetime="${escape(value)}">${escape(formatTime(value))}</time>`;
const LABELS = { operational: 'Operational', degraded: 'Degraded', down: 'Down' };

/** Daily summaries of the last 90 UTC days, oldest first, from the hourly history. */
export function dailyHistory(state, id) {
  const series = state.history.services[id] ?? [];
  const start = Date.parse(state.history.start ?? state.generatedAt);
  const today = Math.floor(Date.parse(state.generatedAt) / DAY_MS);
  const days = Array.from({ length: HISTORY_DAYS }, (_, index) => ({ day: today - HISTORY_DAYS + 1 + index, checks: 0, failures: 0, worst: -1 }));
  series.forEach((slot, index) => {
    if (!slot) return;
    const entry = days[Math.floor((start + index * HOUR_MS) / DAY_MS) - days[0].day];
    if (!entry) return;
    entry.checks += slot[0];
    entry.failures += slot[1];
    entry.worst = Math.max(entry.worst, slot[3]);
  });
  return days;
}

export function uptime(days) {
  const checks = days.reduce((sum, entry) => sum + entry.checks, 0);
  const failures = days.reduce((sum, entry) => sum + entry.failures, 0);
  if (!checks) return null;
  if (!failures) return '100%';
  // Rounded down, so a failed check never shows as 100%.
  return `${(Math.floor(((checks - failures) / checks) * 10_000) / 100).toFixed(2)}%`;
}

function headline(state) {
  const open = state.incidents.filter(incident => incident.open);
  if (state.state === 'down') return 'Service outage';
  if (state.state === 'degraded') return 'Degraded service';
  if (open.some(incident => incident.kind === 'incident')) return 'Incident reported';
  if (open.length) return 'Maintenance in progress';
  return 'All systems operational';
}

function renderIncident(incident) {
  const kind = incident.kind === 'maintenance' ? 'Maintenance' : 'Incident';
  const dates = incident.open
    ? `Opened ${time(incident.createdAt)}`
    : `${time(incident.createdAt)} to ${time(incident.closedAt)}`;
  const text = value => (value ? `<p class="text">${escape(value)}</p>` : '');
  const updates = [...incident.updates].reverse()
    .map(update => `<li>${time(update.at)}${text(update.body)}</li>`).join('');
  return `<article class="incident${incident.open ? ' open' : ''}">
<h3><span class="tag">${kind}</span> ${escape(incident.title)}</h3>
<p class="muted">${dates} · <a href="${escape(incident.url)}">Issue #${incident.number}</a></p>
${text(incident.body)}${updates ? `<ol class="updates">${updates}</ol>` : ''}
</article>`;
}

function renderService(state, service) {
  const days = dailyHistory(state, service.id);
  const share = uptime(days);
  const cells = days.map(entry => {
    const label = entry.checks
      ? `${day(new Date(entry.day * DAY_MS))}: ${LABELS[STATES[entry.worst]]}, ${entry.checks - entry.failures} of ${entry.checks} checks passed`
      : `${day(new Date(entry.day * DAY_MS))}: no data`;
    return `<span class="${entry.checks ? STATES[entry.worst] : 'none'}" title="${escape(label)}"></span>`;
  }).join('');
  const response = service.responseMs === null ? 'No response time' : `Response ${service.responseMs} ms`;
  const note = service.failures > 0 && service.lastFailure
    ? `<p class="note">${service.failures === 1 ? 'The last check failed' : `The last ${service.failures} checks failed`} (${escape(service.lastFailure.reason)}).</p>`
    : '';
  return `<li class="service ${service.state}">
<div class="row"><div><h3>${escape(service.name)}</h3><p class="muted">${escape(service.description)}</p></div>
<p class="state"><span class="dot"></span>${LABELS[service.state]}</p></div>
${note}<p class="muted">${response} · ${share ? `${share} of checks passed in ${HISTORY_DAYS} days` : 'No checks yet'}</p>
<div class="bar" role="img" aria-label="${escape(`Last ${HISTORY_DAYS} days: ${share ? `${share} of checks passed` : 'no checks yet'}`)}">${cells}</div>
<p class="axis"><span class="from">${HISTORY_DAYS} days ago</span><span class="from-short">30 days ago</span><span>Today</span></p>
</li>`;
}

const STYLE = `:root{color-scheme:light dark;--bg:#f8f5f0;--card:#f1eee8;--fg:#242b26;--muted:#62665d;--line:#ded9d1;--link:#6b573f;--operational:#1e7150;--degraded:#89601c;--down:#c12429;--none:#ded9d1}
@media (prefers-color-scheme:dark){:root{--bg:#161618;--card:#1c1c1f;--fg:#f5f5f5;--muted:#aaaab2;--line:#333336;--link:#e4e4e7;--operational:#5fbf84;--degraded:#e4b65e;--down:#ff9592;--none:#333336}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 "Geist Variable","Geist",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--link)}
.wrap{max-width:760px;margin:0 auto;padding:32px 16px 48px}
header{display:flex;flex-wrap:wrap;gap:8px 20px;align-items:baseline;justify-content:space-between;margin-bottom:24px}
header .brand{color:var(--fg);font-size:18px;font-weight:600;text-decoration:none}
nav{display:flex;flex-wrap:wrap;gap:16px;font-size:14px}
h1{margin:0;font-size:22px;font-weight:600;display:flex;gap:10px;align-items:center}
h2{margin:32px 0 12px;font-size:17px;font-weight:600}
h3{margin:0;font-size:15px;font-weight:600}
p{margin:0}
.card,.service,.incident{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 20px}
.muted{color:var(--muted);font-size:14px}
.summary p{margin-top:6px}
.dot{width:10px;height:10px;border-radius:50%;flex:none;background:var(--operational)}
.degraded .dot{background:var(--degraded)}
.down .dot{background:var(--down)}
.services{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.row{display:flex;gap:12px;justify-content:space-between;align-items:flex-start;margin-bottom:8px}
.state{display:flex;gap:8px;align-items:center;font-weight:600;white-space:nowrap}
.note{font-size:14px;margin-bottom:4px}
.bar{display:grid;grid-template-columns:repeat(${HISTORY_DAYS},1fr);gap:2px;height:28px;margin-top:12px}
.bar span{border-radius:2px;background:var(--none)}
.bar .operational{background:var(--operational)}
.bar .degraded{background:var(--degraded)}
.bar .down{background:var(--down)}
.axis{display:flex;justify-content:space-between;color:var(--muted);font-size:12px;margin-top:4px}
.axis .from-short{display:none}
.incidents{display:grid;gap:12px}
.incident.open{border-color:var(--degraded)}
.tag{font-size:12px;font-weight:600;border:1px solid var(--line);border-radius:6px;padding:1px 6px;margin-right:4px;vertical-align:2px}
.text{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:8px}
.updates{list-style:none;margin:12px 0 0;padding:0 0 0 12px;border-left:2px solid var(--line);display:grid;gap:10px;font-size:14px}
.updates time{color:var(--muted)}
.updates .text{margin-top:2px}
details{margin-top:12px}
summary{cursor:pointer}
footer{margin-top:40px;color:var(--muted);font-size:13px;display:grid;gap:8px}
@media (max-width:640px){.bar{grid-template-columns:repeat(30,1fr)}.bar span:nth-child(-n+${HISTORY_DAYS - 30}){display:none}.axis .from{display:none}.axis .from-short{display:inline}.row{flex-direction:column}}`;

const ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='7' fill='%2326332a'/%3E%3C/svg%3E";

/** The static page: state, response time and incident text, with no script. */
export function renderPage(state) {
  const open = state.incidents.filter(incident => incident.open);
  const past = state.incidents.filter(incident => !incident.open);
  const operational = state.services.filter(service => service.state === 'operational').length;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<meta http-equiv="refresh" content="300">
<title>Mycellios status</title>
<meta name="description" content="Whether the Mycellios site, Agent, sign-in, network coordinator and downloads work.">
<link rel="icon" href="${ICON}">
<link rel="alternate" type="application/atom+xml" title="Mycellios status" href="feed.atom">
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
<header><a class="brand" href="${ORIGIN}/">Mycellios status</a>
<nav><a href="${LIVE_NETWORK_URL}">Live network</a><a href="feed.atom">Atom feed</a><a href="status.json">JSON</a></nav></header>
<main>
<section class="card summary ${state.state}">
<h1><span class="dot"></span>${headline(state)}</h1>
<p class="muted">${operational} of ${state.services.length} services operational. Checked ${time(state.generatedAt)}.</p>
</section>
${open.length ? `<h2>Current incidents and maintenance</h2>\n<div class="incidents">${open.map(renderIncident).join('\n')}</div>\n` : ''}<h2>Services</h2>
<ul class="services">
${state.services.map(service => renderService(state, service)).join('\n')}
</ul>
<h2>Past incidents</h2>
${past.length ? `<details><summary>${past.length} in the last ${HISTORY_DAYS} days</summary><div class="incidents">${past.map(renderIncident).join('\n')}</div></details>` : `<p class="muted">No incidents in the last ${HISTORY_DAYS} days.</p>`}
</main>
<footer>
<p>GitHub-hosted runners check public addresses every five minutes, without an account; GitHub may delay a run. Two failed checks in a row mark a service degraded, and four mark it down. This page is served by GitHub Pages, apart from the servers it reports on.</p>
<p>Network activity is on the <a href="${LIVE_NETWORK_URL}">Live network</a> page. <a href="${SOURCE_URL}/blob/main/.github/workflows/public-status.yml">How this page is built</a>.</p>
</footer>
</div>
</body>
</html>
`;
}

const xml = value => escape(plainText(value, 10_000));
const TAG = 'tag:mycellios.com,2026:status';

/** An Atom feed of incidents, maintenance and automatic service state changes, newest first. */
export function renderFeed(state, { pagesUrl }) {
  const site = siteUrl(pagesUrl);
  const names = Object.fromEntries(SERVICES.map(service => [service.id, service.name]));
  const entries = [
    ...state.incidents.map(incident => {
      const kind = incident.kind === 'maintenance' ? 'Maintenance' : 'Incident';
      const updates = incident.updates.map(update => `${formatTime(update.at)}: ${update.body}`);
      return {
        id: `${TAG}/issue/${incident.number}`,
        title: `${incident.open ? kind : `Resolved ${kind.toLowerCase()}`}: ${incident.title}`,
        updated: incident.updatedAt,
        published: incident.createdAt,
        link: incident.url,
        content: [incident.body, ...updates].filter(Boolean).join('\n\n') || incident.title,
      };
    }),
    ...state.events.map(event => ({
      id: `${TAG}/${event.service}/${event.at}`,
      title: event.to === 'operational' ? `${names[event.service]} is operational again` : `${names[event.service]} is ${event.to}`,
      updated: event.at,
      published: event.at,
      link: site,
      content: event.to === 'operational'
        ? `${names[event.service]} passes its checks again.`
        : `${event.to === 'down' ? DOWN_AFTER : DEGRADED_AFTER} or more checks in a row failed${event.reason ? ` (${event.reason})` : ''}.`,
    })),
  ].sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated)).slice(0, 50);
  const updated = entries[0]?.updated ?? state.generatedAt;
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<id>${TAG}</id>
<title>Mycellios status</title>
<subtitle>Incidents, maintenance and service changes of the Mycellios site, Agent, sign-in, network coordinator and downloads.</subtitle>
<updated>${new Date(updated).toISOString()}</updated>
<link rel="self" type="application/atom+xml" href="${escape(new URL('feed.atom', site).href)}"/>
<link rel="alternate" type="text/html" href="${escape(site)}"/>
<author><name>Mycellios</name></author>
${entries.map(entry => `<entry>
<id>${escape(entry.id)}</id>
<title>${xml(entry.title)}</title>
<updated>${new Date(entry.updated).toISOString()}</updated>
<published>${new Date(entry.published).toISOString()}</published>
<link rel="alternate" type="text/html" href="${escape(entry.link)}"/>
<content type="text">${xml(entry.content)}</content>
</entry>`).join('\n')}
</feed>
`;
}

export async function writeSite(directory, state, options) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'index.html'), renderPage(state));
  await writeFile(path.join(directory, 'status.json'), `${JSON.stringify(state)}\n`);
  await writeFile(path.join(directory, 'feed.atom'), renderFeed(state, options));
}

/** One run: the previous published state, this run's probes and incidents, then the site files. */
export async function buildSite({ directory, pagesUrl, repository, apiUrl, token, reset = false, origin = ORIGIN, fetchImpl = fetch, sleep, now = () => new Date(), log = console.log }) {
  const previous = reset || !pagesUrl ? emptyState() : await readPublishedState(pagesUrl, { fetchImpl });
  const results = await probeAll({ origin, fetchImpl, sleep });
  let incidents = previous.incidents;
  try {
    incidents = await fetchIncidents({ repository, apiUrl, token, fetchImpl, now: now(), previous: previous.incidents });
  } catch (error) {
    // GitHub's API being unavailable must not stop the page; the last published incidents stay.
    log(`::warning title=Incidents not refreshed::${error.message}`);
  }
  const state = advance(previous, results, { now: now(), incidents });
  await writeSite(directory, state, { pagesUrl: pagesUrl || defaultPagesUrl(repository) });
  for (const service of state.services) {
    log(`${service.name}: ${service.state}${service.lastFailure && service.failures ? ` (${service.lastFailure.reason})` : ''}`);
  }
  return state;
}

function environment(env) {
  const repository = env.GITHUB_REPOSITORY ?? '';
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY must be owner/name.');
  return { repository, apiUrl: env.GITHUB_API_URL || 'https://api.github.com', token: env.GH_TOKEN || undefined };
}

export async function main(argv, { env = process.env, log = console.log } = {}) {
  const [name, directory] = argv;
  if (name === 'pages') {
    const pages = await pagesSite(environment(env));
    if (!pages.deploy) {
      log(`::warning title=Status page not deployed::${pages.reason} The owner enables it in the repository settings with GitHub Actions as the source; scheduled runs stop here until then, and a manual run builds the page as an artifact.`);
    }
    if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `deploy=${pages.deploy}\nurl=${pages.url ?? ''}\n`);
    return pages;
  }
  if (name === 'build' && directory) {
    return buildSite({
      ...environment(env),
      directory,
      pagesUrl: env.STATUS_PAGES_URL || null,
      reset: env.STATUS_RESET === 'true',
      origin: env.STATUS_ORIGIN || ORIGIN,
      log,
    });
  }
  throw new Error('Usage: node scripts/public-status.mjs pages | build <directory>');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  });
}
