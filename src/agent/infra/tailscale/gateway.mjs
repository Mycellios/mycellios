import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { ProxyAgent, fetch as proxyFetch } from 'undici';

const exec = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const suffixPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ts\.net$/;
const nodePattern = /^[a-z0-9]{16,64}$/;
const MAX_BODY = 2 * 1024 * 1024;
export function targetUrl(raw, suffix) {
  const url = new URL(raw);
  if (!suffixPattern.test(suffix) || !['https:', 'http:'].includes(url.protocol) ||
      url.username || url.password || url.hash || raw.endsWith('#') ||
      !url.hostname.endsWith(`.${suffix}`) ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(url.hostname.slice(0, -(suffix.length + 1)))) {
    throw new Error('Target is outside the selected tailnet');
  }
  return url;
}
export function publicStatus(status, suffix) {
  const actual = status.CurrentTailnet?.MagicDNSSuffix;
  let state = 'needs_auth';
  if (status.BackendState === 'Running') state = actual === suffix ? 'connected' : 'wrong_tailnet';
  else if (status.BackendState === 'NeedsMachineAuth') state = 'needs_approval';
  let authUrl = null;
  try {
    const url = new URL(status.AuthURL);
    if (url.protocol === 'https:' && url.hostname === 'login.tailscale.com' &&
        !url.username && !url.password && !url.hash) authUrl = url.href;
  } catch { /* No pending login. */ }
  return { status: state, authUrl, deviceName: status.Self?.DNSName ?? null };
}

/** One userspace daemon and private state directory per authenticated connection. */
export class Nodes {
  live = new Map();
  starting = new Map();
  constructor(root, maxNodes = 128) { this.root = root; this.maxNodes = maxNodes; }
  async cli(node, ...args) {
    try {
      const { stdout } = await exec('tailscale', [`--socket=${node.socket}`, ...args],
        { timeout: 10_000, maxBuffer: 256 * 1024, windowsHide: true });
      return stdout;
    } catch (error) {
      // The CLI returns nonzero before login even when its JSON status is valid.
      if (args[0] === 'status' && args.includes('--json') && typeof error.stdout === 'string') {
        try {
          const status = JSON.parse(error.stdout);
          if (['NeedsLogin', 'Stopped', 'Running', 'NeedsMachineAuth', 'Starting', 'NoState'].includes(status.BackendState)) return error.stdout;
        } catch { /* Preserve the original command failure. */ }
      }
      throw error;
    }
  }
  async node(id, suffix) {
    if (!nodePattern.test(id) || !suffixPattern.test(suffix)) throw new Error('Invalid connection');
    const current = this.live.get(id);
    if (current) {
      if (current.suffix !== suffix) throw new Error('Tailnet binding changed');
      return current;
    }
    if (this.starting.has(id)) return this.starting.get(id);
    if (this.live.size + this.starting.size >= this.maxNodes) throw new Error('Gateway capacity reached');
    const pending = this.start(id, suffix).finally(() => this.starting.delete(id));
    this.starting.set(id, pending);
    return pending;
  }
  async start(id, suffix) {
    const dir = join(this.root, id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const port = await new Promise((resolve, reject) => {
      const listener = createTcpServer();
      listener.once('error', reject);
      listener.listen(0, '127.0.0.1', () => {
        const port = listener.address().port;
        listener.close(error => error ? reject(error) : resolve(port));
      });
    });
    const socket = join(dir, 'tailscaled.sock');
    const child = spawn('tailscaled', ['--tun=userspace-networking', `--socket=${socket}`,
      `--statedir=${dir}`, '--port=0', `--outbound-http-proxy-listen=127.0.0.1:${port}`],
      { stdio: 'ignore', windowsHide: true, env: { ...process.env, TS_NO_LOGS_NO_SUPPORT: 'true' } });
    const node = { suffix, socket, child, abort: new AbortController(),
      agent: new ProxyAgent(`http://127.0.0.1:${port}`) };
    const onExit = () => {
      node.abort.abort();
      void node.agent.destroy();
      if (this.live.get(id) === node) this.live.delete(id);
    };
    child.once('error', onExit);
    child.once('exit', onExit);
    try {
      let ready = false;
      for (let attempt = 0; attempt < 25; attempt++) {
        if (node.abort.signal.aborted) throw new Error('Tailscale could not start');
        try { await this.cli(node, 'status', '--json'); ready = true; break; }
        catch { await pause(200); }
      }
      if (!ready) throw new Error('Tailscale startup timed out');
      this.live.set(id, node);
      return node;
    } catch {
      child.kill('SIGTERM');
      await node.agent.destroy();
      throw new Error('Tailscale could not start');
    }
  }
  async status(id, suffix, login = false) {
    const node = await this.node(id, suffix);
    if (login) {
      // The CLI deadline only bounds waiting for the user's browser consent.
      await this.cli(node, 'up', '--timeout=5s', '--accept-routes=false', '--accept-dns=false',
        '--shields-up', `--hostname=mycellios-${id.slice(-12)}`).catch(() => undefined);
    }
    return publicStatus(JSON.parse(await this.cli(node, 'status', '--json')), suffix);
  }
  async remove(id, suffix) {
    const pending = this.starting.get(id);
    if (pending) await pending;
    // Load persisted state after a gateway restart so Remove still logs the node out.
    const node = await this.node(id, suffix);
    node.abort.abort();
    await node.agent.destroy();
    try { await this.cli(node, 'logout'); }
    finally { node.child.kill('SIGTERM'); this.live.delete(id); }
  }
  async request(id, suffix, input, signal) {
    const node = await this.node(id, suffix);
    const status = await this.status(id, suffix);
    if (status.status !== 'connected') throw new Error('Tailnet is not connected');
    const target = targetUrl(input.url, suffix);
    if (!['GET', 'POST', 'DELETE'].includes(input.method)) throw new Error('Unsupported MCP method');
    const headers = new Headers(input.headers);
    for (const name of ['host', 'connection', 'proxy-authorization', 'proxy-connection', 'transfer-encoding', 'content-length', 'upgrade']) headers.delete(name);
    const body = input.body ? Buffer.from(input.body, 'base64') : undefined;
    if ((body?.length ?? 0) > MAX_BODY) throw new Error('MCP request is too large');
    const response = await proxyFetch(target, { method: input.method, headers, body,
      dispatcher: node.agent, redirect: 'manual',
      signal: AbortSignal.any([signal, node.abort.signal, AbortSignal.timeout(60_000)]) });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error('Tailnet redirects are not allowed');
    }
    return response;
  }
  async close() {
    for (const node of this.live.values()) {
      node.abort.abort(); void node.agent.destroy(); node.child.kill('SIGTERM');
    }
    this.live.clear();
  }
}

export function gateway(nodes, key) {
  if (!key || key.length < 32) throw new Error('A private gateway key of at least 32 characters is required');
  const expected = Buffer.from(`Bearer ${key}`);
  return createServer(async (request, response) => {
    const actual = Buffer.from(request.headers.authorization ?? '');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      response.writeHead(401).end(); return;
    }
    const abort = new AbortController();
    response.once('close', () => abort.abort());
    request.setTimeout(65_000, () => abort.abort());
    try {
      const match = /^\/nodes\/([a-z0-9]{16,64})\/(status|connect|remove|fetch)$/.exec(request.url ?? '');
      if (request.method !== 'POST' || !match) { response.writeHead(404).end(); return; }
      let size = 0; const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY * 1.5) throw new Error('Request is too large');
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const [, id, action] = match;
      if (!suffixPattern.test(input.dnsSuffix)) throw new Error('Invalid network');
      if (action === 'fetch') {
        const upstream = await nodes.request(id, input.dnsSuffix, input, abort.signal);
        response.writeHead(upstream.status, {
          'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
          ...(upstream.headers.has('mcp-session-id') ? { 'mcp-session-id': upstream.headers.get('mcp-session-id') } : {}),
          ...(upstream.headers.has('www-authenticate') ? { 'www-authenticate': upstream.headers.get('www-authenticate') } : {}),
          'cache-control': 'no-store',
        });
        let bytes = 0;
        if (upstream.body) for await (const chunk of upstream.body) {
          bytes += chunk.length;
          if (bytes > 16 * 1024 * 1024) throw new Error('MCP response is too large');
          if (!response.write(chunk)) await once(response, 'drain', { signal: abort.signal });
        }
        response.end();
      } else {
        const value = action === 'remove'
          ? (await nodes.remove(id, input.dnsSuffix), { ok: true })
          : await nodes.status(id, input.dnsSuffix, action === 'connect');
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(value));
      }
    } catch (error) {
      // Only fixed error classes/codes: never log URLs, headers, bodies or login links.
      const code = error?.cause?.code ?? error?.code;
      console.warn('tailscale.gateway.request_failed', {
        name: ['Error', 'TypeError', 'AbortError', 'TimeoutError'].includes(error?.name) ? error.name : 'Error',
        code: typeof code === 'string' && /^[A-Z_]{2,64}$/.test(code) ? code : undefined,
      });
      if (response.headersSent) response.destroy();
      else response.writeHead(502, { 'content-type': 'application/json' }).end('{"error":"Tailscale connection failed"}');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  const nodes = new Nodes(process.env.TAILSCALE_STATE_DIR ?? '/state');
  const server = gateway(nodes, process.env.TAILSCALE_GATEWAY_KEY);
  server.listen(Number(process.env.PORT ?? 8095), process.env.HOST ?? '127.0.0.1');
  const stop = () => { server.close(); void nodes.close().then(() => process.exit(0)); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
