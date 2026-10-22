// Optional same-host/private-network ingress. It never grants API admission.
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const MAX_BODY = 65536;
const MAX_RESPONSE = 262144;
const DEADLINE_MS = 555000;

function privateOrigin(value) {
  const url = new URL(value);
  const parts = url.hostname.split('.').map(Number);
  const ipv4 = parts.length === 4 && parts.every((n, i) => Number.isInteger(n) && n >= 0 && n <= 255
    && String(n) === url.hostname.split('.')[i]);
  const privateAddress = ipv4 && (parts[0] === 10 || parts[0] === 127
    || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31
    || parts[0] === 192 && parts[1] === 168);
  if (url.protocol !== 'http:' || !privateAddress || url.username || url.password
    || url.search || url.hash || url.pathname !== '/') throw Error('jev_private_ingress_rejected');
  return url.origin;
}

function authorized(value, expected) {
  if (typeof value !== 'string') return false;
  const left = Buffer.from(value), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function boundedBody(body, maximum) {
  const chunks = []; let size = 0;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > maximum) throw Error('jev_bridge_body_limit');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function createJevPrivateBridge({ upstreamOrigin, apiKey, retryWindowMs = 30000, retryDelayMs = 1000 }) {
  const upstream = privateOrigin(upstreamOrigin);
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw Error('jev_bridge_key_required');
  if (!Number.isSafeInteger(retryWindowMs) || retryWindowMs < 0 || retryWindowMs > 30000
    || !Number.isSafeInteger(retryDelayMs) || retryDelayMs < 1 || retryDelayMs > 5000) throw Error('jev_bridge_retry_budget');
  const authorization = 'Bearer ' + apiKey;
  const server = createServer((req, res) => {
    const send = (status, code) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code } }));
    };
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { req.resume(); send(404, 'not_found'); return; }
    if (!authorized(req.headers.authorization, authorization)) { req.resume(); send(401, 'unauthorized'); return; }
    const controller = new AbortController();
    req.once('aborted', () => controller.abort());
    res.once('close', () => { if (!res.writableEnded) controller.abort(); });
    void (async () => {
      let body;
      try {
        body = await boundedBody(req, MAX_BODY);
        if (JSON.parse(body).model !== 'jev') { send(403, 'jev_service_required'); return; }
      } catch { send(400, 'invalid_jev_request'); return; }
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(DEADLINE_MS)]);
      const retryUntil = performance.now() + retryWindowMs;
      for (;;) {
        const result = await fetch(upstream + '/v1/chat/completions', {
          method: 'POST', headers: { 'content-type': 'application/json', authorization }, body, signal, redirect: 'error',
        });
        let admissionError;
        if (result.status === 429) {
          admissionError = await boundedBody(result.body, MAX_BODY);
          let code;
          try { code = JSON.parse(admissionError).error?.code; } catch { /* Preserve the upstream error. */ }
          if (code === 'concurrency_limit_exceeded' && performance.now() + retryDelayMs <= retryUntil) {
            await delay(retryDelayMs, undefined, { signal });
            continue;
          }
        }
        res.writeHead(result.status, { 'content-type': result.headers.get('content-type') ?? 'application/json',
          'cache-control': 'no-store', ...(result.headers.has('retry-after') ? { 'retry-after': result.headers.get('retry-after') } : {}) });
        if (admissionError) { res.end(admissionError); return; }
        let size = 0;
        if (result.body) for await (const chunk of result.body) {
          size += chunk.length;
          if (size > MAX_RESPONSE) throw Error('jev_bridge_response_limit');
          if (!res.write(chunk)) await once(res, 'drain', { signal });
        }
        res.end(); return;
      }
    })().catch(() => {
      if (res.headersSent) res.destroy();
      else send(503, 'jev_private_ingress_unavailable');
    });
  });
  server.requestTimeout = DEADLINE_MS;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject); server.unref();
      resolve({ url: 'http://127.0.0.1:' + server.address().port,
        close: () => new Promise((done, fail) => server.close(error => error ? fail(error) : done())) });
    });
  });
}
