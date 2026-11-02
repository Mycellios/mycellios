// apps/web/vite.config.ts
import { randomUUID as randomUUID2, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path3 from "node:path";
import tls from "node:tls";
import { lingui } from "@lingui/vite-plugin";

// packages/contracts/src/client-build.ts
var BUILD_ID = /^\d{14}$/;
function buildIdAt(date) {
  return date.toISOString().replace(/\D/g, "").slice(0, 14);
}
function isBuildId(value) {
  return typeof value === "string" && BUILD_ID.test(value);
}

// packages/contracts/src/content-security-policy.ts
var HTML_VIEWER_PATH = "/html-viewer.html";
var CSP_REPORT_PATH = "/api/csp-report";
var CSP_REPORT_GROUP = "csp";
var CSP_REPORTING_ENDPOINTS = `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`;
var APP_DIRECTIVES = {
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  // Mermaid SVGs and some UI libraries inject <style> elements and style attributes as markup.
  "style-src": ["'self'", "'unsafe-inline'"],
  // Markdown images, link favicons and attachment previews (object URLs).
  "img-src": ["'self'", "data:", "blob:", "https:"],
  "font-src": ["'self'", "data:"],
  // Voice replies and video attachments play from object URLs.
  "media-src": ["'self'", "blob:"],
  "connect-src": ["'self'"],
  // The /novnc screen proxy, the HTML viewer shell and PDF object URLs.
  "frame-src": ["'self'", "blob:"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
  // Browsers with the Reporting API use report-to and ignore report-uri; the rest use report-uri.
  "report-uri": [CSP_REPORT_PATH],
  "report-to": [CSP_REPORT_GROUP]
};
function serialize(directives) {
  return Object.entries(directives).map(([name, sources]) => `${name} ${sources.join(" ")}`).join("; ");
}
var LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
var EXTRA_SOURCE = new RegExp(
  `^https://(?:\\*\\.${LABEL}(?:\\.${LABEL})+|${LABEL}(?:\\.${LABEL})*)(?::(\\d{1,5}))?$`,
  "i"
);
function validSource(source) {
  const match = EXTRA_SOURCE.exec(source);
  const port = match?.[1];
  return Boolean(match) && (port === void 0 || Number(port) >= 1 && Number(port) <= 65535);
}
function parseContentSecuritySources(setting, value) {
  const sources = (value ?? "").split(/[\s,]+/).filter(Boolean);
  const invalid = sources.filter((source) => !validSource(source));
  if (invalid.length > 0) {
    throw new Error(
      `${setting} accepts only https:// origins such as https://cdn.example.com or https://*.example.com. Invalid: ${invalid.join(" ")}`
    );
  }
  return [...new Set(sources.map((source) => source.toLowerCase()))];
}
function appContentSecurityPolicy(extensions = {}) {
  return serialize({
    ...APP_DIRECTIVES,
    "script-src": ["'self'", ...extensions.scriptSrc ?? []],
    "connect-src": ["'self'", ...extensions.connectSrc ?? []],
    "frame-src": [
      ...APP_DIRECTIVES["frame-src"],
      ...extensions.localProjectPreview ? ["http://127.0.0.1:*", "http://localhost:*"] : []
    ]
  });
}
var APP_CONTENT_SECURITY_POLICY = appContentSecurityPolicy();
var HTML_VIEWER_CONTENT_SECURITY_POLICY = serialize({ "frame-ancestors": ["'self'"] });
var PASSTHROUGH_PREFIXES = ["/api", "/rpc", "/novnc"];
function contentSecurityPolicyFor(pathname, appPolicy = APP_CONTENT_SECURITY_POLICY) {
  if (PASSTHROUGH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)))
    return null;
  if (pathname === HTML_VIEWER_PATH) return HTML_VIEWER_CONTENT_SECURITY_POLICY;
  return appPolicy;
}

// packages/core/src/node/screen-proxy-response.ts
var SENSITIVE_RESPONSE_HEADERS = /* @__PURE__ */ new Set(["clear-site-data", "set-cookie", "set-cookie2"]);
var SCREEN_SANDBOX = "sandbox allow-scripts allow-pointer-lock";
function safeScreenProxyResponseHeaders(headers) {
  const safe = {};
  const policies = [];
  for (const [key, value] of Object.entries(headers)) {
    const name = key.toLowerCase();
    if (value == null || name.startsWith(":") || SENSITIVE_RESPONSE_HEADERS.has(name)) continue;
    if (name === "content-security-policy") {
      policies.push(...Array.isArray(value) ? value : [value]);
    } else {
      safe[name] = value;
    }
  }
  safe["content-security-policy"] = [...policies, SCREEN_SANDBOX];
  safe["access-control-allow-origin"] = "*";
  const cacheControl = safe["cache-control"];
  safe["cache-control"] = [
    ...Array.isArray(cacheControl) ? cacheControl : [cacheControl],
    "no-transform"
  ].filter(Boolean).join(", ");
  return safe;
}
function stripSensitiveHandshakeHeaders(response) {
  const end = response.indexOf("\r\n\r\n");
  if (end < 0) return null;
  const lines = response.subarray(0, end).toString("latin1").split("\r\n");
  const safeLines = lines.filter((line, index) => {
    if (index === 0) return true;
    const separator = line.indexOf(":");
    const name = separator < 0 ? line : line.slice(0, separator);
    return !SENSITIVE_RESPONSE_HEADERS.has(name.trim().toLowerCase());
  });
  return Buffer.concat([
    Buffer.from(`${safeLines.join("\r\n")}\r
\r
`, "latin1"),
    response.subarray(end + 4)
  ]);
}

// apps/web/vite.config.ts
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// packages/core/src/secrets-guard.ts
var DEV_SUPERVISOR_TOKEN_PLACEHOLDER = "dev-supervisor-token-change-me-32chars";
var DEV_SCREEN_PROXY_SECRET_PLACEHOLDER = "dev-screen-proxy-secret-change-me-32chars";
var EXAMPLE_SUPERVISOR_TOKEN_PLACEHOLDER = "replace-with-32-plus-character-supervisor-token";
var EXAMPLE_SCREEN_PROXY_SECRET_PLACEHOLDER = "replace-with-32-plus-character-screen-proxy-secret";
var DEDICATED_SECRET_PLACEHOLDERS = /* @__PURE__ */ new Set([
  DEV_SUPERVISOR_TOKEN_PLACEHOLDER,
  DEV_SCREEN_PROXY_SECRET_PLACEHOLDER,
  EXAMPLE_SUPERVISOR_TOKEN_PLACEHOLDER,
  EXAMPLE_SCREEN_PROXY_SECRET_PLACEHOLDER
]);
function isDevSecretAllowed(env = process.env) {
  if (env.RAKAZO_ALLOW_DEV_SECRETS === "1") return true;
  if (env.VITEST === "true" || env.VITEST === "1") return true;
  const nodeEnv = env.NODE_ENV;
  return nodeEnv === "development" || nodeEnv === "test";
}
function resolveDedicatedSecret(env, options) {
  const value = env[options.name]?.trim();
  if (!value) {
    if (options.developmentFallback && isDevSecretAllowed(env)) {
      return options.developmentFallback;
    }
    throw new Error(options.missingMessage);
  }
  if (!isDevSecretAllowed(env) && DEDICATED_SECRET_PLACEHOLDERS.has(value)) {
    throw new Error(`Replace the ${options.name} placeholder with a dedicated random credential.`);
  }
  if (options.conflicts.some((name) => value === env[name])) {
    throw new Error(options.conflictMessage);
  }
  if (!isDevSecretAllowed(env) && value.length < 32) {
    throw new Error(`${options.name} must be at least 32 characters outside local tests.`);
  }
  return value;
}
function resolveScreenProxySecret(env = process.env) {
  return resolveDedicatedSecret(env, {
    name: "SCREEN_PROXY_SECRET",
    conflicts: ["BETTER_AUTH_SECRET", "SANDBOX_SUPERVISOR_TOKEN"],
    missingMessage: "Set SCREEN_PROXY_SECRET to a dedicated random screen proxy credential.",
    conflictMessage: "SCREEN_PROXY_SECRET must differ from BETTER_AUTH_SECRET and SANDBOX_SUPERVISOR_TOKEN.",
    developmentFallback: DEV_SCREEN_PROXY_SECRET_PLACEHOLDER
  });
}

// packages/logging/src/redaction.ts
var REDACTED = "[Redacted]";
var REDACT_KEYS = /* @__PURE__ */ new Set([
  "email",
  "prompt",
  "message",
  "messages",
  "body",
  "content",
  "text",
  "blocks",
  "parts",
  "input",
  "output",
  "stdout",
  "stderr",
  "arguments",
  "transcript",
  "completion",
  "html",
  "markdown",
  "query",
  "rawheaders",
  "headers",
  "passwd",
  "api_key"
]);
var SECRET_KEY = /password|secret|token|authorization|cookie|credential|apikey/;
function redactValue(value, seen = /* @__PURE__ */ new WeakSet()) {
  if (value === null || value === void 0) return value;
  if (typeof value === "string") return redactSensitiveText(value);
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }
  if (value instanceof Error) {
    const output2 = {
      name: value.name || "Error",
      message: redactSensitiveText(value.message)
    };
    if (typeof value.stack === "string" && value.stack.length > 0) {
      output2.stack = redactSensitiveText(value.stack);
    }
    if (value.cause !== void 0) {
      output2.cause = typeof value.cause === "string" ? redactSensitiveText(value.cause) : redactValue(value.cause, seen);
    }
    return output2;
  }
  if (value instanceof Date) return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = shouldRedactKey(key) ? REDACTED : redactValue(nested, seen);
  }
  return output;
}
function redactBindings(bindings) {
  return redactValue(bindings);
}
var EMAIL_CANDIDATE = /\b[A-Z0-9._%+-]+(?:@[A-Z0-9.-]+\.[A-Z]{2,}\b)?/gi;
var BEARER = /\bBearer\s+[^\s"',;&]+/gi;
var SECRET_ASSIGNMENT = /\b([A-Za-z0-9_]*(?:password|secret|token|authorization|apikey|api_key)[A-Za-z0-9_]*)\s*[:=]\s*\S+/gi;
var JSON_SECRET_FIELD = /"(password|passwd|secret|token|authorization|apikey|api_key|accesstoken|refreshtoken|email|cookie)"\s*:\s*"(?:\\.|[^"\\])*"/gi;
var BARE_SECRET = /\b(?:sk-(?:or-v1-)?[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?:ak_|ck_)[A-Za-z0-9]+)\b/g;
function redactSensitiveText(text) {
  return text.replace(EMAIL_CANDIDATE, (candidate) => candidate.includes("@") ? REDACTED : candidate).replace(JSON_SECRET_FIELD, `"$1":"${REDACTED}"`).replace(BEARER, `Bearer ${REDACTED}`).replace(SECRET_ASSIGNMENT, (_match, key) => `${key}=${REDACTED}`).replace(BARE_SECRET, REDACTED);
}
function shouldRedactKey(key) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9_]/g, "");
  return REDACT_KEYS.has(normalized) || SECRET_KEY.test(normalized);
}

// packages/logging/src/serialize-error.ts
var MAX_CAUSE_DEPTH = 5;
function serializeError(error, seen = /* @__PURE__ */ new Set()) {
  if (!(error instanceof Error)) {
    return { name: "Error", message: stringifyUnknown(error) };
  }
  if (seen.has(error)) {
    return { name: error.name, message: "[Circular]" };
  }
  seen.add(error);
  const serialized = {
    name: error.name || "Error",
    message: redactSensitiveText(error.message)
  };
  const code = error.code;
  if (typeof code === "string" && /^[\w.-]{1,40}$/.test(code)) serialized.code = code;
  const meta = error.meta;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    serialized.meta = redactBindings(meta);
  }
  if (typeof error.stack === "string" && error.stack.length > 0) {
    serialized.stack = redactSensitiveText(error.stack);
  }
  if (error.cause !== void 0 && seen.size < MAX_CAUSE_DEPTH) {
    serialized.cause = serializeError(error.cause, seen);
  }
  return serialized;
}
var PRISMA_INVOCATION = /^Invalid `(?:\w+\.)*(\w+\.\w+)\(\)` invocation/;
function errorSummary(message, code) {
  const lines = message.split("\n").map((line) => line.trim()).filter(Boolean);
  const call = lines[0]?.match(PRISMA_INVOCATION)?.[1];
  const summary = call ? `${call}: ${lines.slice(1).join(" ")}` : message.trimStart();
  return code && !summary.includes(code) ? `${code} ${summary}` : summary;
}
function stringifyUnknown(value) {
  if (typeof value === "string") return redactSensitiveText(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value === null) return "null";
  if (value === void 0) return "undefined";
  try {
    return redactSensitiveText(JSON.stringify(value) ?? String(value));
  } catch {
    return Object.prototype.toString.call(value);
  }
}

// packages/logging/src/console-sink.ts
var SKIP_PRETTY = /* @__PURE__ */ new Set(["timestamp", "level", "message"]);
function createConsoleSink(options = {}) {
  const format = options.format ?? "json";
  return {
    write(event) {
      emit(event, format);
    }
  };
}
function emit(event, format) {
  const line = format === "pretty" ? formatPretty(event) : JSON.stringify(event);
  if (event.level === "error") console.error(line);
  else if (event.level === "warn") console.warn(line);
  else console.info(line);
}
function formatPretty(event) {
  const time = event.timestamp.slice(11, 23) || event.timestamp;
  const fields = [];
  for (const [key, value] of Object.entries(event)) {
    if (SKIP_PRETTY.has(key) || value === void 0) continue;
    fields.push(
      `${key}=${key === "error" ? formatError(value) : formatField(value)}`
    );
  }
  const suffix = fields.length > 0 ? ` ${fields.join(" ")}` : "";
  return `${time} ${event.level.toUpperCase().padEnd(5)} ${event.message}${suffix}`;
}
function formatError(error) {
  const meta = error.meta ? ` meta=${JSON.stringify(error.meta)}` : "";
  const cause = error.cause ? ` cause=${formatError(error.cause)}` : "";
  return `${error.name}: ${errorSummary(error.message, error.code)}${meta}${cause}`;
}
function formatField(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Error) return value.message;
  try {
    const json = JSON.stringify(value);
    return json && json.length > 200 ? `${json.slice(0, 197)}...` : json ?? "";
  } catch {
    return "[unserializable]";
  }
}

// packages/logging/src/context.ts
import { AsyncLocalStorage } from "node:async_hooks";
var storage = new AsyncLocalStorage();
function getLogContext() {
  return { ...storage.getStore() ?? {} };
}
function runWithLogContext(bindings, fn) {
  return storage.run({ ...storage.getStore(), ...bindings }, fn);
}
function enrichLogContext(bindings) {
  const store = storage.getStore();
  if (!store) return;
  Object.assign(store, bindings);
}

// packages/logging/src/reported-errors.ts
var reported = /* @__PURE__ */ new WeakSet();
function markReportedError(error) {
  if (error !== null && typeof error === "object") reported.add(error);
}

// packages/logging/src/sink-guard.ts
var WINDOW_MS = 3e4;
var lastReportAt = 0;
var suppressed = 0;
var failures = 0;
var lastFailureAt = null;
function reportSinkError(error) {
  const now = Date.now();
  failures += 1;
  lastFailureAt = now;
  if (now - lastReportAt < WINDOW_MS) {
    suppressed += 1;
    return;
  }
  const extra = suppressed > 0 ? ` (${suppressed} suppressed)` : "";
  suppressed = 0;
  lastReportAt = now;
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`log sink failed${extra}`, message);
}
function guardedWrite(write) {
  try {
    const result = write();
    if (result && typeof result.then === "function") {
      void result.catch(reportSinkError);
    }
  } catch (error) {
    reportSinkError(error);
  }
}
async function guardedFlush(flush) {
  if (!flush) return;
  try {
    await flush();
  } catch (error) {
    reportSinkError(error);
  }
}

// packages/logging/src/types.ts
var LOG_LEVELS = {
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  off: 100
};

// packages/logging/src/logger.ts
var RESERVED = /* @__PURE__ */ new Set(["timestamp", "level", "message", "error", "service.name"]);
var DEFAULT_FLUSH_MS = 2e3;
var LoggerImpl = class _LoggerImpl {
  level;
  service;
  sinks;
  localBindings;
  constructor(options) {
    this.service = options.service;
    this.level = options.level ?? "info";
    this.sinks = options.sinks;
    this.localBindings = options.bindings ?? {};
  }
  debug(message, bindings) {
    this.emit("debug", message, bindings);
  }
  info(message, bindings) {
    this.emit("info", message, bindings);
  }
  warn(message, bindings) {
    this.emit("warn", message, bindings);
  }
  error(message, errorOrBindings, bindings) {
    if (errorOrBindings === void 0) {
      this.emit("error", message);
      return;
    }
    if (isPlainBindings(errorOrBindings)) {
      this.emit("error", message, { ...errorOrBindings, ...bindings });
      return;
    }
    this.emit("error", message, bindings, errorOrBindings);
  }
  child(bindings) {
    return new _LoggerImpl({
      service: this.service,
      level: this.level,
      sinks: this.sinks,
      bindings: { ...this.localBindings, ...bindings }
    });
  }
  withContext(bindings, fn) {
    return runWithLogContext(bindings, fn);
  }
  enrich(bindings) {
    enrichLogContext(bindings);
  }
  async flush(options) {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_FLUSH_MS;
    const flushing = Promise.all(this.sinks.map((sink) => guardedFlush(sink.flush?.bind(sink))));
    await Promise.race([
      flushing,
      new Promise((resolve) => {
        setTimeout(resolve, timeoutMs).unref?.();
      })
    ]);
  }
  emit(level, message, bindings, error) {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.level]) return;
    const merged = redactBindings({
      ...this.localBindings,
      ...getLogContext(),
      ...bindings
    });
    const event = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      message: redactSensitiveText(message),
      "service.name": this.service
    };
    for (const [key, value] of Object.entries(merged)) {
      if (RESERVED.has(key) || value === void 0) continue;
      event[key] = value;
    }
    if (error !== void 0) event.error = serializeError(error);
    if (level === "error" && merged["error.report"] !== false) {
      markReportedError(error);
      enrichLogContext({ "error.reported": true });
    }
    for (const sink of this.sinks) {
      guardedWrite(() => sink.write(event));
    }
  }
};
function createLogger(options) {
  return new LoggerImpl(options);
}
function isPlainBindings(value) {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value) || value instanceof Error) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
var installed = createLogger({
  service: "rakazo",
  level: "off",
  sinks: []
});

// packages/logging/src/env.ts
function isLogLevel(value) {
  return value in LOG_LEVELS;
}
function resolveLogEnv(source = process.env) {
  const rawLevel = source.LOG_LEVEL?.trim().toLowerCase();
  const level = rawLevel && isLogLevel(rawLevel) ? rawLevel : "info";
  const rawFormat = source.LOG_FORMAT?.trim().toLowerCase();
  const format = rawFormat === "json" || rawFormat === "pretty" ? rawFormat : source.NODE_ENV === "production" ? "json" : "pretty";
  return { level, format };
}
function createServiceLogger(options) {
  const resolved = resolveLogEnv(options.env);
  return createLogger({
    service: options.service,
    level: resolved.level,
    sinks: [createConsoleSink({ format: resolved.format }), ...options.extraSinks ?? []]
  });
}

// apps/web/src/asset-archive.ts
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
var ASSET_ARCHIVE_DIR = "asset-archive";
var ASSET_ARCHIVE_MAX_AGE_MS = 7 * 24 * 60 * 6e4;
var ASSET_ARCHIVE_MAX_BUILDS = 20;
var ASSET_ARCHIVE_GRACE_MS = 60 * 6e4;
function planAssetPrune(builds, files, current, now) {
  const newestFirst = [...builds].sort((a, b) => b.startedAt - a.startedAt);
  const kept = /* @__PURE__ */ new Set([current]);
  for (const [index, build] of newestFirst.entries()) {
    if (kept.size >= ASSET_ARCHIVE_MAX_BUILDS) break;
    const replacedAt = newestFirst[index - 1]?.startedAt ?? now;
    if (now - replacedAt <= ASSET_ARCHIVE_MAX_AGE_MS) kept.add(build.id);
  }
  const needed = new Set(
    builds.filter((build) => kept.has(build.id)).flatMap((build) => build.files)
  );
  return {
    builds: builds.filter((build) => !kept.has(build.id)).map((build) => build.id),
    files: files.filter((file) => !needed.has(file))
  };
}
function readBuild(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(value.files) || typeof value.startedAt !== "number") return null;
    return {
      id: path.basename(file, ".json"),
      files: value.files.filter((name) => typeof name === "string"),
      startedAt: value.startedAt
    };
  } catch {
    return null;
  }
}
function recentlyTouched(file, now) {
  try {
    return now - fs.statSync(file).mtimeMs <= ASSET_ARCHIVE_GRACE_MS;
  } catch {
    return true;
  }
}
function writeAtomically(target, write) {
  const temporary = path.join(path.dirname(target), `.tmp-${randomUUID()}`);
  try {
    write(temporary);
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
function archiveAssets(options) {
  const { assetsDir, archiveDir, buildId, now } = options;
  if (!buildId || !fs.existsSync(archiveDir)) return null;
  const archivedAssets = path.join(archiveDir, "assets");
  const buildsDir = path.join(archiveDir, "builds");
  fs.mkdirSync(archivedAssets, { recursive: true });
  fs.mkdirSync(buildsDir, { recursive: true });
  const files = fs.readdirSync(assetsDir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name);
  writeAtomically(
    path.join(buildsDir, `${buildId}.json`),
    (temporary) => fs.writeFileSync(temporary, JSON.stringify({ files, startedAt: now }))
  );
  const touched = new Date(now);
  for (const file of files) {
    const target = path.join(archivedAssets, file);
    try {
      fs.utimesSync(target, touched, touched);
    } catch {
      writeAtomically(target, (temporary) => {
        fs.copyFileSync(path.join(assetsDir, file), temporary);
        fs.utimesSync(temporary, touched, touched);
      });
    }
  }
  const builds = fs.readdirSync(buildsDir).filter((name) => name.endsWith(".json")).map(
    (name) => readBuild(path.join(buildsDir, name)) ?? {
      id: path.basename(name, ".json"),
      files: [],
      startedAt: 0
    }
  );
  const archived = fs.readdirSync(archivedAssets).filter(
    (name) => !name.startsWith(".tmp-") && !recentlyTouched(path.join(archivedAssets, name), now)
  );
  const prune = planAssetPrune(builds, archived, buildId, now);
  for (const id of prune.builds) fs.rmSync(path.join(buildsDir, `${id}.json`), { force: true });
  for (const file of prune.files) fs.rmSync(path.join(archivedAssets, file), { force: true });
  return archivedAssets;
}

// apps/web/src/forwarded-for.ts
function appendForwardedFor(req) {
  const prior = [req.headers["x-forwarded-for"]].flat().filter(Boolean).join(", ");
  const peer = req.socket.remoteAddress ?? "unknown";
  return prior ? `${prior}, ${peer}` : peer;
}

// apps/web/src/missing-asset.ts
import { createReadStream, existsSync } from "node:fs";
import path2 from "node:path";
var CONTENT_TYPES = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".map": "application/json",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp"
};
function inside(root, relative) {
  try {
    const file = path2.resolve(root, decodeURIComponent(relative));
    return file.startsWith(root + path2.sep) ? file : null;
  } catch {
    return null;
  }
}
function missingAssetMiddleware(assetsDir, urlPrefix, archiveDir = null, exists = existsSync) {
  const root = path2.resolve(assetsDir);
  const archive = archiveDir && path2.resolve(archiveDir);
  return (req, res, next) => {
    const pathname = req.url?.split("?", 1)[0] ?? "/";
    if (!pathname.startsWith(urlPrefix)) {
      next();
      return;
    }
    const relative = pathname.slice(urlPrefix.length);
    const file = inside(root, relative);
    if (file && exists(file)) {
      next();
      return;
    }
    const archived = archive ? inside(archive, relative) : null;
    if (archived && (req.method === "GET" || req.method === "HEAD") && exists(archived)) {
      res.statusCode = 200;
      res.setHeader(
        "content-type",
        CONTENT_TYPES[path2.extname(archived)] ?? "application/octet-stream"
      );
      res.setHeader("cache-control", "public, max-age=31536000, immutable");
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      createReadStream(archived).on("error", () => res.destroy()).pipe(res);
      return;
    }
    res.statusCode = 404;
    res.setHeader("cache-control", "no-store");
    res.end("Not found");
  };
}

// apps/web/src/novnc-html.ts
var MAX_NOVNC_HTML_BYTES = 1024 * 1024;
var NOVNC_PAGES = /* @__PURE__ */ new Set(["vnc.html", "vnc_lite.html", "embed.html"]);
function isNovncPage(path4) {
  const { pathname } = new URL(path4, "http://upstream.invalid");
  return NOVNC_PAGES.has(pathname.slice(pathname.lastIndexOf("/") + 1));
}
function shouldInjectNovncStorageShim(headers, path4) {
  if (!isNovncPage(path4)) return false;
  const encoding = String(headers["content-encoding"] ?? "").trim().toLowerCase();
  if (encoding && encoding !== "identity") return false;
  const contentType = String(headers["content-type"] ?? "").toLowerCase();
  return contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
}
function novncPageRequestHeaders(headers) {
  const {
    "if-modified-since": _since,
    "if-none-match": _match,
    ...rest
  } = headers;
  return { ...rest, "accept-encoding": "identity" };
}
function rewrittenNovncHeaders(headers) {
  const {
    "content-length": _length,
    etag: _etag,
    "last-modified": _modified,
    expires: _expires,
    ...rest
  } = headers;
  return { ...rest, "cache-control": "no-store, no-transform" };
}
function injectNovncStorageShim(html, { viewOnly = false } = {}) {
  const chrome = `<style>#noVNC_status{display:none!important}${viewOnly ? "#noVNC_control_bar_anchor{display:none!important}" : ""}</style>`;
  const shim = `${chrome}<script>
(() => {
  const memoryStorage = () => {
    const items = new Map();
    return {
      getItem(key) { return items.has(String(key)) ? items.get(String(key)) : null; },
      setItem(key, value) { items.set(String(key), String(value)); },
      removeItem(key) { items.delete(String(key)); },
      clear() { items.clear(); },
    };
  };
  for (const name of ["localStorage", "sessionStorage"]) {
    Object.defineProperty(window, name, { configurable: true, value: memoryStorage() });
  }
  window.addEventListener("error", (event) => {
    if (/^[a-z-]+-extension:/.test(String(event.filename))) event.stopImmediatePropagation();
  }, true);
  // noVNC probes WebCodecs H.264 support while its modules evaluate. On some Android devices
  // VideoDecoder.flush() never returns, so the page never starts. Screens never use H.264.
  try { delete window.VideoDecoder; } catch {}
  // The app cannot look into this sandboxed frame, so tell it how the screen is doing.
  const report = (rakazoScreen, detail) => {
    try {
      window.parent.postMessage(detail ? { rakazoScreen, detail } : { rakazoScreen }, "*");
    } catch {}
    // The mobile app's WebView hears only the state word: no URL and none of the page's text.
    try {
      window.ReactNativeWebView?.postMessage(JSON.stringify({ rakazoScreen }));
    } catch {}
  };
  // A reconnected screen takes the keyboard back when the app asks; nothing else is accepted.
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (
      event.source !== window.parent ||
      !data ||
      typeof data !== "object" ||
      Object.keys(data).length !== 1 ||
      data.rakazoScreenFocus !== true
    )
      return;
    const canvas = document.querySelector("#screen canvas, #noVNC_container canvas, canvas");
    try {
      canvas?.focus();
    } catch {}
  });
  let last = "";
  // Pages that never set noVNC's classes (older Rakazo embed images) still build their viewer
  // canvas, which is as far as they can be followed.
  let classed = false;
  const sync = () => {
    const root = document.documentElement;
    const status = document.getElementById("noVNC_status");
    const failure = root.getAttribute("data-rakazo-screen-error");
    const statusError =
      status && status.classList.contains("noVNC_open") && status.classList.contains("noVNC_status_error");
    const connecting =
      root.classList.contains("noVNC_connecting") || root.classList.contains("noVNC_reconnecting");
    const connected = root.classList.contains("noVNC_connected");
    if (connecting || connected) classed = true;
    const state = connected
      ? "connected"
      : failure !== null || statusError
        ? "failed"
        : connecting
          ? "connecting"
          : classed
            ? last === "connected" || last === "connecting"
              ? "disconnected"
              : ""
            : document.querySelector("#screen canvas")
              ? "connecting"
              : "";
    if (!state || state === last) return;
    last = state;
    report(state, state === "failed" ? failure || String(status?.textContent || "") : undefined);
  };
  const observe = () => {
    sync();
    new MutationObserver(sync).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-rakazo-screen-error"],
      childList: true,
      subtree: true,
    });
  };
  report("loading");
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observe);
  else observe();
})();
</script>`;
  return html.includes("<head>") ? html.replace("<head>", `<head>${shim}`) : html.replace(/<script\b/i, `${shim}<script`);
}
function collectNovncHtml(incoming, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      incoming.destroy();
      reject(error);
    };
    incoming.on("data", (chunk) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > maxBytes) {
        fail(new Error(`noVNC document exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(buf);
    });
    incoming.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    incoming.on("error", (error) => {
      fail(error instanceof Error ? error : new Error("noVNC upstream failed"));
    });
    incoming.on("aborted", () => {
      fail(new Error("noVNC upstream aborted"));
    });
    incoming.on("close", () => {
      if (!settled) fail(new Error("noVNC upstream closed"));
    });
  });
}

// apps/web/src/pwa/plugin.ts
import { fileURLToPath } from "node:url";

// packages/contracts/src/product-brand.ts
var productBrand = {
  name: "Mycellios Agent",
  shortName: "Mycellios",
  companionName: "Mico",
  companionPlural: "Micos",
  tokenName: "Spore",
  creditName: "Credits",
  apiBaseUrl: "https://www.mycellios.com/v1",
  apiHosts: ["www.mycellios.com", "mycellios.com"],
  mascotPath: "/mycellios/mico.png",
  mascotAnimationPath: "/mycellios/mico-idle.webp",
  markPath: "/mycellios/mark.png"
};

// packages/ui-tokens/src/index.ts
var darkTokens = {
  background: "#142019",
  dialog: "#1E2A22",
  foreground: "#EEE9E2",
  card: "#1E2A22",
  cardForeground: "#EEE9E2",
  popover: "#1E2A22",
  popoverForeground: "#EEE9E2",
  glassFill: "#2C2C2E",
  glassStroke: "#FCFCFC26",
  primary: "#EEE9E2",
  primaryForeground: "#142019",
  secondary: "#7676803D",
  secondaryForeground: "#FFFFFF",
  chatUser: "#344438",
  chatUserForeground: "#EEE9E2",
  muted: "#1E2A22",
  mutedForeground: "#A8B3A3",
  faintForeground: "#93A18E",
  accent: "#344438",
  accentForeground: "#EEE9E2",
  destructive: "#FF9592",
  destructiveFill: "#E5484D",
  destructiveForeground: "#FFFFFF",
  border: "#EEE9E226",
  input: "#93A18E66",
  ring: "#AD7A48",
  sidebar: "#101A14",
  sidebarForeground: "#EEE9E2",
  sidebarBorder: "#EEE9E226",
  sidebarAccent: "#26362B",
  sidebarAccentForeground: "#EEE9E2",
  link: "#D4AD80",
  faviconPlate: "#FFFFFF",
  success: "#3FA266",
  warning: "#DB941E",
  statusWorking: "#459FFE",
  unread: "#005BC7",
  workingDot: "#3FA266",
  overlay: "rgba(0, 0, 0, 0.28)",
  scrollbar: "#1E2026",
  scrollbarHover: "#2E313A"
};
var lightTokens = {
  background: "#F8F5F0",
  dialog: "#F8F5F0",
  foreground: "#1E2A22",
  card: "#EDE8E1",
  cardForeground: "#1E2A22",
  popover: "#F8F5F0",
  popoverForeground: "#1E2A22",
  glassFill: "#FFFFFF",
  glassStroke: "#14141416",
  primary: "#1E2A22",
  primaryForeground: "#F8F5F0",
  secondary: "#7676801F",
  secondaryForeground: "#000000",
  chatUser: "#1E2A22",
  chatUserForeground: "#F8F5F0",
  muted: "#EEE9E2",
  mutedForeground: "#596653",
  faintForeground: "#70806D",
  accent: "#E4E9DF",
  accentForeground: "#1E2A22",
  destructive: "#C12429",
  destructiveFill: "#E5484D",
  destructiveForeground: "#FFFFFF",
  border: "#1E2A2229",
  input: "#70806D80",
  ring: "#AD7A48",
  sidebar: "#EEE9E2",
  sidebarForeground: "#1E2A22",
  sidebarBorder: "#1E2A2229",
  sidebarAccent: "#F8F5F0",
  sidebarAccentForeground: "#1E2A22",
  link: "#80552E",
  faviconPlate: "#FFFFFF",
  success: "#007041",
  warning: "#885A07",
  statusWorking: "#0C64C1",
  unread: "#005BC7",
  workingDot: "#3FA266",
  overlay: "rgba(0, 0, 0, 0.19)",
  scrollbar: "#C8C8C4",
  scrollbarHover: "#A8A8A4"
};
var webDarkOverrides = {
  primaryHover: "#D8D2C9",
  primaryDisabled: "#EEE9E221",
  destructiveFill: "#CF2B35"
};
var webLightOverrides = {
  primaryHover: "#344438",
  primaryDisabled: "#1E2A2226"
};
var webDarkTokens = { ...darkTokens, ...webDarkOverrides };
var webLightTokens = { ...lightTokens, ...webLightOverrides };
var fontWeight = { regular: "400", medium: "500", semibold: "600" };
var typeScale = {
  title: { fontSize: 22, lineHeight: 26, fontWeight: fontWeight.semibold },
  headline: { fontSize: 19, lineHeight: 23, fontWeight: fontWeight.semibold },
  cardTitle: { fontSize: 17, lineHeight: 22, fontWeight: fontWeight.medium },
  body: { fontSize: 17, lineHeight: 22 },
  secondary: { fontSize: 15, lineHeight: 19 },
  caption: { fontSize: 14, lineHeight: 18 },
  footnote: { fontSize: 12, lineHeight: 16 }
};
var MAX_FONT_SCALE = 23 / typeScale.body.fontSize;

// apps/web/src/pwa/service-worker.ts
var CACHE_PREFIX = "rakazo-shell-";

// apps/web/src/pwa/plugin.ts
var SERVICE_WORKER_FILE = "sw.js";
var MANIFEST_FILE = "site.webmanifest";
var PRECACHE_PLACEHOLDER = "__RAKAZO_SW_PRECACHE__";
var CACHE_PLACEHOLDER = "__RAKAZO_SW_CACHE__";
function webManifest(base = "/") {
  const icons = [192, 512].map((size) => ({
    src: `${base}mycellios/app-icon-v2-${size}.png`,
    sizes: `${size}x${size}`,
    type: "image/png",
    purpose: "any"
  }));
  return {
    id: base,
    name: productBrand.name,
    short_name: productBrand.shortName,
    description: "Think, create, and get things done with Mycellios Agent.",
    start_url: base,
    scope: base,
    display: "standalone",
    background_color: webDarkTokens.background,
    theme_color: webDarkTokens.background,
    icons: [
      ...icons,
      {
        src: `${base}mycellios/app-icon-v2-maskable.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}
function shellFiles(bundle) {
  const files = /* @__PURE__ */ new Set(["/"]);
  const visit = (fileName) => {
    const chunk = bundle[fileName];
    if (chunk?.type !== "chunk" || files.has(`/${fileName}`)) return;
    files.add(`/${fileName}`);
    for (const css of chunk.viteMetadata?.importedCss ?? []) files.add(`/${css}`);
    chunk.imports.forEach(visit);
  };
  for (const output of Object.values(bundle)) {
    if (output.type === "chunk" && output.isEntry && output.fileName !== SERVICE_WORKER_FILE) {
      visit(output.fileName);
    }
    if (output.type === "asset" && /\.(css|woff2)$/.test(output.fileName)) {
      files.add(`/${output.fileName}`);
    }
  }
  return [...files].sort();
}
function injectShell(code, precache, buildId) {
  if (!isBuildId(buildId)) throw new Error(`Expected a build id, got "${buildId}".`);
  const cacheName = `${CACHE_PREFIX}${buildId}`;
  let injected = code;
  for (const [placeholder, value] of [
    [PRECACHE_PLACEHOLDER, precache],
    [CACHE_PLACEHOLDER, cacheName]
  ]) {
    const parts = injected.split(placeholder);
    if (parts.length !== 2) throw new Error(`Expected one ${placeholder} in the service worker.`);
    injected = parts.join(JSON.stringify(value));
  }
  return injected;
}
function rakazoPwa(buildId, base = "/") {
  const manifest = () => JSON.stringify(webManifest(base), null, 2);
  return [
    {
      name: "rakazo-pwa-manifest",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.split("?", 1)[0] !== `/${MANIFEST_FILE}`) {
            next();
            return;
          }
          res.setHeader("content-type", "application/manifest+json; charset=utf-8");
          res.end(manifest());
        });
      }
    },
    {
      name: "rakazo-pwa-service-worker",
      apply: "build",
      enforce: "post",
      buildStart() {
        this.emitFile({
          type: "chunk",
          id: fileURLToPath(new URL("./sw.ts", "file:///C:/Users/Daniel/Documents/GPU%20Distribuida/outputs/mycellios-agent-canonical-20261029/src/agent/apps/web/src/pwa/plugin.ts")),
          fileName: SERVICE_WORKER_FILE
        });
      },
      generateBundle(_options, bundle) {
        this.emitFile({ type: "asset", fileName: MANIFEST_FILE, source: manifest() });
        const html = bundle["index.html"];
        if (html?.type !== "asset") this.error("The index.html shell was not emitted.");
        const worker = bundle[SERVICE_WORKER_FILE];
        if (worker?.type !== "chunk") this.error("The service worker chunk was not emitted.");
        if (worker.imports.length || worker.dynamicImports.length || worker.exports.length) {
          this.error("The service worker must not import or export modules.");
        }
        worker.code = injectShell(
          worker.code,
          shellFiles(bundle).map((path4) => `${base}${path4.slice(1)}`),
          buildId
        );
        if (base !== "/")
          worker.code = worker.code.replace(
            `${CACHE_PREFIX}${buildId}`,
            `${CACHE_PREFIX}${base.slice(1, -1)}-${buildId}`
          );
      }
    }
  ];
}

// apps/web/src/screen-proxy.ts
import { connect } from "node:net";

// packages/core/src/node/screen-capability.ts
var SCREEN_PROXY_TTL_MS = 60 * 6e4;
var SCREEN_TARGET_ENDPOINT = "/api/internal/screen-target";
var SCREEN_RECHECK_MS = 1e3;
var SCREEN_UNCONFIRMED_MAX_MS = 6e3;
var REMOTE_SCREEN_CAPABILITY_MIN_REMAINING_MS = 10 * 6e4;
function isScreenProxyTarget(value) {
  if (!value || typeof value !== "object") return false;
  const target = value;
  return (target.protocol === "http:" || target.protocol === "https:") && typeof target.hostname === "string" && target.hostname.length > 0 && !/[\s/]/.test(target.hostname) && typeof target.port === "number" && Number.isInteger(target.port) && target.port > 0 && target.port <= 65535 && isScreenProxyHeaders(target.headers) && typeof target.path === "string" && target.path.startsWith("/") && !/[\r\n]/.test(target.path) && typeof target.interactive === "boolean";
}
function isScreenProxyHeaders(value) {
  return value === void 0 || value !== null && typeof value === "object" && !Array.isArray(value) && Object.entries(value).every(
    ([name, header]) => /^[a-zA-Z0-9!#$%&'*+.^_`|~-]+$/.test(name) && !/^(host|connection|upgrade|transfer-encoding|content-length|proxy-authorization)$/i.test(
      name
    ) && typeof header === "string" && /^[\t\x20-\x7e]*$/.test(header)
  );
}

// packages/core/src/screen-reconnect.ts
var SCREEN_PROBE_PARAM = "rakazo_probe";

// apps/web/src/screen-proxy.ts
var SENSITIVE_FORWARD_HEADERS = /* @__PURE__ */ new Set([
  "authorization",
  "cookie",
  "host",
  "proxy-authenticate",
  "proxy-authorization"
]);
function novncRequestPath(url) {
  const path4 = url?.replace(/^\/{2,}/, "/");
  return path4?.startsWith("/novnc/") ? path4 : null;
}
async function resolveNovncTarget(url, secret, api, onFailure) {
  if (!url?.startsWith("/novnc/session/")) {
    onFailure?.("invalid_path");
    return null;
  }
  try {
    const response = await fetch(new URL(SCREEN_TARGET_ENDPOINT, api), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(2e3),
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ path: url })
    });
    if (!response.ok) {
      onFailure?.(
        response.status >= 500 || response.status === 408 || response.status === 429 ? "authority_unavailable" : "authority_rejected"
      );
      return null;
    }
    let target;
    try {
      target = await response.json();
    } catch (error) {
      onFailure?.(
        error instanceof SyntaxError ? "invalid_authority_response" : "authority_unavailable"
      );
      return null;
    }
    if (isScreenProxyTarget(target)) return target;
    onFailure?.("invalid_authority_response");
    return null;
  } catch {
    onFailure?.("authority_unavailable");
    return null;
  }
}
function screenProbePath(url) {
  const queryAt = url?.indexOf("?") ?? -1;
  if (!url || queryAt < 0) return null;
  const mark = `${SCREEN_PROBE_PARAM}=1`;
  const pairs = url.slice(queryAt + 1).split("&");
  if (!pairs.includes(mark)) return null;
  const rest = pairs.filter((pair) => pair !== mark);
  return rest.length ? `${url.slice(0, queryAt)}?${rest.join("&")}` : url.slice(0, queryAt);
}
function screenUpstreamReachable(target, timeoutMs = 1e3) {
  return new Promise((resolve) => {
    const socket = connect({ host: target.hostname, port: target.port });
    const done = (reachable) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}
function screenProbeStatus(target, reason, reachable = true) {
  if (!target) return screenRefusal(reason).status;
  return reachable ? 204 : 502;
}
function screenRefusal(reason) {
  return reason === "authority_unavailable" ? { status: 503, body: "Screen unavailable" } : { status: 403, body: "Invalid or expired screen capability" };
}
function isHttp2PseudoHeader(key) {
  return key.startsWith(":");
}
function safeProxyHeaders(headers, target) {
  const forwarded = Object.fromEntries(
    Object.entries(headers).filter(([key, value]) => {
      return value != null && !isHttp2PseudoHeader(key) && !SENSITIVE_FORWARD_HEADERS.has(key.toLowerCase());
    })
  );
  if (target && forwarded.origin) forwarded.origin = screenTargetOrigin(target);
  return { ...forwarded, ...target?.headers };
}
function screenTargetOrigin(target) {
  const defaultPort = target.protocol === "https:" ? 443 : 80;
  return `${target.protocol}//${target.hostname}${target.port === defaultPort ? "" : `:${target.port}`}`;
}
async function checkScreenAuthorization(url, secret, api, opened) {
  let failure;
  const target = await resolveNovncTarget(url, secret, api, (reason) => {
    failure = reason;
  });
  if (target) return sameScreenTarget(target, opened) ? "allowed" : "denied";
  return failure === "authority_unavailable" ? "unavailable" : "denied";
}
function sameScreenTarget(a, b) {
  return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port && a.path === b.path && a.interactive === b.interactive;
}
function screenCapabilityExpiry(url) {
  const expiresAt = Number(url?.match(/^\/novnc\/session\/(?:view|control)\/(\d+)\./)?.[1]);
  return Number.isSafeInteger(expiresAt) ? expiresAt : void 0;
}
function watchScreenAuthorization(check, revoke, options = {}) {
  let stopped = false;
  let timer;
  let unconfirmed;
  let expiry;
  let unavailable = 0;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(unconfirmed);
    clearTimeout(expiry);
  };
  const end = (reason) => {
    if (stopped) return;
    stop();
    revoke(reason);
  };
  const confirm = (sentAt) => {
    clearTimeout(unconfirmed);
    unconfirmed = setTimeout(
      () => end("unconfirmed_window"),
      Math.max(0, sentAt + SCREEN_UNCONFIRMED_MAX_MS - performance.now())
    );
    unconfirmed.unref?.();
  };
  const tick = async () => {
    const sentAt = performance.now();
    let result = "denied";
    try {
      result = await check();
    } catch {
    }
    if (stopped) return;
    if (result === "denied") return end("denied");
    if (result === "allowed") {
      confirm(sentAt);
      unavailable = 0;
    } else {
      unavailable += 1;
      options.onUnavailable?.(unavailable);
    }
    timer = setTimeout(tick, SCREEN_RECHECK_MS);
    timer.unref?.();
  };
  confirm(options.confirmedAt ?? performance.now());
  if (options.expiresAt !== void 0) {
    const left = Math.min(Math.max(0, options.expiresAt - Date.now()), 2 ** 31 - 1);
    expiry = setTimeout(() => end("expired"), left);
    expiry.unref?.();
  }
  timer = setTimeout(tick, SCREEN_RECHECK_MS);
  timer.unref?.();
  return stop;
}

// apps/web/vite.config.ts
var webPort = Number(process.env.WEB_PORT ?? 5173);
var DESKTOP_STACK_PROBE_PATH = "/.well-known/rakazo-desktop-stack";
var DESKTOP_STACK_TOKEN_HEADER = "x-rakazo-desktop-stack-token";
var SCREEN_UPSTREAM_TIMEOUT_MS = 2e4;
var screenLog = createServiceLogger({ service: "rakazo-web" });
function screenPolicy(url) {
  return url?.startsWith("/novnc/session/control/") ? "control" : "view";
}
function socketErrorCode(error) {
  const code = error?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,32}$/.test(code) ? code : "UNKNOWN";
}
function equalStackToken(expected, supplied) {
  if (expected === "" || typeof supplied !== "string") return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.byteLength === suppliedBytes.byteLength && timingSafeEqual(expectedBytes, suppliedBytes);
}
function attachDesktopStackProbe(server, token, imageTag) {
  server.middlewares.use((req, res, next) => {
    if (req.url?.split("?", 1)[0] !== DESKTOP_STACK_PROBE_PATH) {
      next();
      return;
    }
    if (!equalStackToken(token, req.headers[DESKTOP_STACK_TOKEN_HEADER])) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    const body = { ok: true, imageTag };
    res.statusCode = 200;
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
  });
}
function attachNovncProxy(server, secret, api) {
  server.middlewares.use(async (req, res, next) => {
    const path4 = novncRequestPath(req.url);
    if (!path4) {
      next();
      return;
    }
    req.url = path4;
    const connectionId = randomUUID2();
    const bindings = {
      "screen.connection_id": connectionId,
      "screen.policy": screenPolicy(req.url)
    };
    const confirmedAt = performance.now();
    const probe = screenProbePath(req.url);
    let refusal;
    const target = await resolveNovncTarget(probe ?? req.url, secret, api, (reason) => {
      refusal = reason;
      screenLog.warn("screen.proxy.target_rejected", {
        ...bindings,
        "screen.transport": "http",
        reason
      });
    });
    if (res.destroyed) return;
    if (probe) {
      const reachable = target ? await screenUpstreamReachable(target) : false;
      if (res.destroyed) return;
      res.statusCode = screenProbeStatus(target, refusal, reachable);
      res.setHeader("cache-control", "no-store");
      res.end();
      return;
    }
    if (!target) {
      const { status, body } = screenRefusal(refusal);
      res.statusCode = status;
      res.end(body);
      return;
    }
    const forwarded = safeProxyHeaders(req.headers, target);
    const headers = {
      // The storage shim rewrites the page, so ask for all of it, uncompressed.
      ...isNovncPage(target.path) ? novncPageRequestHeaders(forwarded) : forwarded,
      host: `${target.hostname}:${target.port}`
    };
    const transport = target.protocol === "https:" ? https : http;
    let upstream;
    let retries = 0;
    let retryPending = false;
    let stopChecking = () => void 0;
    const retryable = req.method === "GET";
    const scheduleRetry = (incoming) => {
      if (!retryable || retryPending || retries >= 3 || res.destroyed) return false;
      retryPending = true;
      retries += 1;
      const delayMs = 50 * retries;
      const retry = () => {
        setTimeout(() => {
          retryPending = false;
          if (!res.destroyed) requestUpstream();
        }, delayMs);
      };
      if (incoming && !incoming.destroyed) {
        incoming.once("close", retry);
        incoming.destroy();
      } else {
        retry();
      }
      return true;
    };
    let downstreamFinished = false;
    const finishUnavailable = (reason, errorCode) => {
      if (downstreamFinished || res.destroyed || res.writableEnded) return;
      downstreamFinished = true;
      screenLog.warn("screen.proxy.http_failed", {
        ...bindings,
        reason,
        ...errorCode ? { "error.code": errorCode } : {}
      });
      stopChecking();
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.statusCode = 502;
      res.end(`Screen unavailable (${reason})`);
    };
    function requestUpstream() {
      if (res.destroyed) return;
      upstream = transport.request(
        {
          hostname: target.hostname,
          port: target.port,
          path: target.path,
          method: req.method,
          headers,
          ...target.protocol === "https:" ? { servername: target.hostname } : {}
        },
        (incoming) => {
          if ((incoming.statusCode ?? 502) >= 500 && scheduleRetry(incoming)) {
            return;
          }
          if ((incoming.statusCode ?? 502) >= 400) {
            screenLog.warn("screen.proxy.http_upstream_response", {
              ...bindings,
              "http.status": incoming.statusCode ?? 502,
              "screen.retries": retries
            });
          }
          const responseHeaders = safeScreenProxyResponseHeaders(incoming.headers);
          if (shouldInjectNovncStorageShim(responseHeaders, target.path)) {
            const declaredLength = Number(incoming.headers["content-length"] ?? 0);
            if (Number.isFinite(declaredLength) && declaredLength > MAX_NOVNC_HTML_BYTES) {
              finishUnavailable("html_too_large");
              incoming.destroy();
              return;
            }
            void collectNovncHtml(incoming, MAX_NOVNC_HTML_BYTES).then((html) => {
              if (downstreamFinished || res.destroyed || res.writableEnded) return;
              downstreamFinished = true;
              const body = injectNovncStorageShim(html, { viewOnly: !target.interactive });
              res.writeHead(incoming.statusCode ?? 502, rewrittenNovncHeaders(responseHeaders));
              res.end(body);
            }).catch(() => {
              finishUnavailable("html_read_failed");
            });
            return;
          }
          res.writeHead(incoming.statusCode ?? 502, responseHeaders);
          incoming.pipe(res);
        }
      );
      const request = upstream;
      const headersTimer = setTimeout(() => {
        finishUnavailable("upstream_timeout");
        request.destroy();
      }, SCREEN_UPSTREAM_TIMEOUT_MS);
      request.once("response", () => clearTimeout(headersTimer));
      request.once("close", () => clearTimeout(headersTimer));
      upstream.on("error", (error) => {
        if (retryable && !downstreamFinished && !res.headersSent && !res.destroyed && (retryPending || scheduleRetry())) {
          return;
        }
        finishUnavailable("upstream_error", socketErrorCode(error));
      });
      if (req.method === "GET" || req.readableEnded) upstream.end();
      else req.pipe(upstream);
    }
    stopChecking = watchScreenAuthorization(
      () => checkScreenAuthorization(req.url, secret, api, target),
      (reason) => {
        screenLog.warn("screen.proxy.http_revoked", {
          ...bindings,
          "screen.revoke_reason": reason
        });
        upstream?.destroy();
        res.destroy();
      },
      {
        confirmedAt,
        expiresAt: screenCapabilityExpiry(req.url),
        onUnavailable: (consecutive) => screenLog.warn("screen.proxy.recheck_unavailable", {
          ...bindings,
          "screen.transport": "http",
          "screen.consecutive": consecutive
        })
      }
    );
    res.once("close", () => {
      stopChecking();
      upstream?.destroy();
    });
    requestUpstream();
  });
  server.httpServer?.on("upgrade", async (req, socket, head) => {
    const path4 = novncRequestPath(req.url);
    if (!path4) return;
    req.url = path4;
    const connectionId = randomUUID2();
    const startedAt = Date.now();
    const bindings = {
      "screen.connection_id": connectionId,
      "screen.policy": screenPolicy(req.url)
    };
    const confirmedAt = performance.now();
    const target = await resolveNovncTarget(req.url, secret, api, (reason) => {
      screenLog.warn("screen.proxy.target_rejected", {
        ...bindings,
        "screen.transport": "websocket",
        reason
      });
    });
    if (socket.destroyed) return;
    if (!target) {
      socket.destroy();
      return;
    }
    const upstream = target.protocol === "https:" ? tls.connect({ port: target.port, host: target.hostname, servername: target.hostname }) : net.connect(target.port, target.hostname);
    let upgraded = false;
    let closed = false;
    let closeInitiator;
    const logClose = (side) => {
      if (closed) return;
      closed = true;
      const durationMs = Date.now() - startedAt;
      const details = {
        ...bindings,
        "screen.upgraded": upgraded,
        "screen.duration_ms": durationMs,
        "screen.closed_by": closeInitiator ?? side
      };
      if (!upgraded || durationMs < 5e3) screenLog.warn("screen.proxy.websocket_closed", details);
      else screenLog.info("screen.proxy.websocket_closed", details);
    };
    const stopChecking = watchScreenAuthorization(
      () => checkScreenAuthorization(req.url, secret, api, target),
      (reason) => {
        screenLog.warn("screen.proxy.websocket_revoked", {
          ...bindings,
          "screen.revoke_reason": reason
        });
        closeInitiator ??= "revoked";
        socket.destroy();
        upstream.destroy();
      },
      {
        confirmedAt,
        expiresAt: screenCapabilityExpiry(req.url),
        onUnavailable: (consecutive) => screenLog.warn("screen.proxy.recheck_unavailable", {
          ...bindings,
          "screen.transport": "websocket",
          "screen.consecutive": consecutive
        })
      }
    );
    socket.once("close", () => {
      logClose("client");
      stopChecking();
      upstream.destroy();
    });
    upstream.once("close", () => {
      logClose("upstream");
      stopChecking();
      socket.destroy();
    });
    upstream.once(target.protocol === "https:" ? "secureConnect" : "connect", () => {
      const headerLines = [
        `${req.method ?? "GET"} ${target.path} HTTP/1.1`,
        `Host: ${target.hostname}:${target.port}`
      ];
      for (const [key, value] of Object.entries(safeProxyHeaders(req.headers, target))) {
        headerLines.push(`${key}: ${Array.isArray(value) ? value.join(",") : value}`);
      }
      upstream.write(`${headerLines.join("\r\n")}\r
\r
`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
      const responseChunks = [];
      let responseSize = 0;
      let responseTail = Buffer.alloc(0);
      const forwardHandshake = (chunk) => {
        responseChunks.push(chunk);
        responseSize += chunk.length;
        if (responseSize > 64 * 1024) {
          screenLog.warn("screen.proxy.websocket_handshake_failed", {
            ...bindings,
            reason: "header_too_large"
          });
          socket.destroy();
          upstream.destroy();
          return;
        }
        const boundarySearch = Buffer.concat([responseTail, chunk]);
        if (boundarySearch.indexOf("\r\n\r\n") < 0) {
          responseTail = Buffer.from(boundarySearch.subarray(-3));
          return;
        }
        const responseHead = Buffer.concat(responseChunks, responseSize);
        const safe = stripSensitiveHandshakeHeaders(responseHead);
        if (!safe) {
          screenLog.warn("screen.proxy.websocket_handshake_failed", {
            ...bindings,
            reason: "malformed_response"
          });
          socket.destroy();
          upstream.destroy();
          return;
        }
        const status = Number(
          responseHead.toString("latin1", 0, responseHead.indexOf("\r\n")).match(/^HTTP\/1\.\d (\d{3})/)?.[1] ?? 0
        );
        if (status !== 101) {
          screenLog.warn("screen.proxy.websocket_handshake_failed", {
            ...bindings,
            reason: "upstream_status",
            "http.status": status
          });
        } else {
          upgraded = true;
          screenLog.info("screen.proxy.websocket_upgraded", {
            ...bindings,
            "screen.duration_ms": Date.now() - startedAt
          });
        }
        upstream.off("data", forwardHandshake);
        socket.write(safe);
        upstream.pipe(socket);
      };
      upstream.on("data", forwardHandshake);
    });
    upstream.on("error", (error) => {
      screenLog.warn("screen.proxy.websocket_error", {
        ...bindings,
        "screen.side": "upstream",
        "error.code": socketErrorCode(error)
      });
      closeInitiator ??= "upstream";
      socket.destroy();
    });
    socket.on("error", (error) => {
      screenLog.warn("screen.proxy.websocket_error", {
        ...bindings,
        "screen.side": "client",
        "error.code": socketErrorCode(error)
      });
      closeInitiator ??= "client";
      upstream.destroy();
    });
  });
}
var vite_config_default = defineConfig(({ command, mode }) => {
  const buildId = command === "build" ? buildIdAt(/* @__PURE__ */ new Date()) : "";
  const rootEnv = loadEnv(mode, path3.resolve(import.meta.dirname, "../.."), "");
  const api = process.env.API_PROXY_TARGET ?? rootEnv.API_PROXY_TARGET ?? "http://127.0.0.1:3100";
  const deploymentBase = process.env.APP_BASE_PATH ?? rootEnv.APP_BASE_PATH ?? "/";
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(deploymentBase))
    throw new Error("APP_BASE_PATH must be a trailing-slash path namespace");
  const deploymentPrefix = deploymentBase.replace(/\/$/, "");
  const apiProxy = Object.fromEntries(
    [
      "/api",
      "/rpc",
      // Native app domain association, served by the API from deployment settings.
      "/.well-known/apple-app-site-association",
      "/.well-known/assetlinks.json"
    ].map((path4) => [
      `${deploymentPrefix}${path4}`,
      {
        rewrite: (url) => url.slice(deploymentPrefix.length),
        target: api,
        changeOrigin: true,
        // Append the hop this proxy saw, so the API never mistakes a caller's own header for its
        // address. The API reads past this hop only when it is listed in TRUSTED_PROXIES.
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            proxyReq.setHeader("x-forwarded-for", appendForwardedFor(req));
          });
        }
      }
    ])
  );
  const previewHost = process.env.RAKAZO_HOST ?? rootEnv.RAKAZO_HOST ?? "localhost";
  const allowedHosts = [
    previewHost,
    ...(process.env.RAKAZO_ALLOWED_HOSTS ?? rootEnv.RAKAZO_ALLOWED_HOSTS ?? "").split(",").map((entry) => entry.trim()).filter(Boolean)
  ];
  const screenProxySecret = () => resolveScreenProxySecret({
    ...process.env,
    SCREEN_PROXY_SECRET: process.env.SCREEN_PROXY_SECRET ?? rootEnv.SCREEN_PROXY_SECRET,
    SANDBOX_SUPERVISOR_TOKEN: process.env.SANDBOX_SUPERVISOR_TOKEN ?? rootEnv.SANDBOX_SUPERVISOR_TOKEN,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? rootEnv.BETTER_AUTH_SECRET
  });
  const performanceAssetDelayMs = Number(process.env.RAKAZO_PERFORMANCE_ASSET_DELAY_MS ?? 0);
  const desktopStackToken = process.env.RAKAZO_DESKTOP_STACK_TOKEN ?? rootEnv.RAKAZO_DESKTOP_STACK_TOKEN ?? "";
  const imageTag = process.env.RAKAZO_IMAGE_TAG ?? rootEnv.RAKAZO_IMAGE_TAG ?? "edge";
  const appPolicy = appContentSecurityPolicy({
    localProjectPreview: Boolean(desktopStackToken),
    scriptSrc: parseContentSecuritySources(
      "RAKAZO_CSP_SCRIPT_SRC",
      process.env.RAKAZO_CSP_SCRIPT_SRC ?? rootEnv.RAKAZO_CSP_SCRIPT_SRC
    ),
    connectSrc: parseContentSecuritySources(
      "RAKAZO_CSP_CONNECT_SRC",
      process.env.RAKAZO_CSP_CONNECT_SRC ?? rootEnv.RAKAZO_CSP_CONNECT_SRC
    )
  });
  return {
    base: deploymentBase,
    build: { sourcemap: true },
    define: { "import.meta.env.RAKAZO_BUILD": JSON.stringify(buildId) },
    plugins: [
      {
        // The API reads this to name the deployed build, and a tab fetches it to confirm the
        // server already serves a newer build before it reloads.
        name: "rakazo-build-id",
        apply: "build",
        generateBundle() {
          this.emitFile({ type: "asset", fileName: "build-id", source: `${buildId}
` });
        }
      },
      react(),
      babel({ plugins: ["@lingui/babel-plugin-lingui-macro"] }),
      lingui(),
      tailwindcss(),
      rakazoPwa(buildId, deploymentBase),
      {
        // Production only: the dev server injects inline scripts for React Refresh.
        name: "rakazo-content-security-policy",
        configurePreviewServer(server) {
          server.middlewares.use((req, res, next) => {
            const pathname = req.url?.split("?", 1)[0] ?? "/";
            const localPath = deploymentPrefix && pathname.startsWith(`${deploymentPrefix}/`) ? pathname.slice(deploymentPrefix.length) : pathname;
            const policy = contentSecurityPolicyFor(localPath, appPolicy);
            if (policy) {
              res.setHeader(
                "content-security-policy",
                policy.replace("report-uri /api/", `report-uri ${deploymentPrefix}/api/`)
              );
              res.setHeader(
                "reporting-endpoints",
                CSP_REPORTING_ENDPOINTS.replace('="/api/', `="${deploymentPrefix}/api/`)
              );
            }
            next();
          });
        }
      },
      {
        name: "rakazo-missing-asset-404",
        configurePreviewServer({ config, middlewares }) {
          const outDir = path3.resolve(config.root, config.build.outDir);
          const assetsDir = path3.join(outDir, config.build.assetsDir);
          let archive = null;
          try {
            archive = archiveAssets({
              assetsDir,
              archiveDir: path3.resolve(config.root, ASSET_ARCHIVE_DIR),
              buildId: readFileSync(path3.join(outDir, "build-id"), "utf8").trim(),
              now: Date.now()
            });
          } catch (error) {
            screenLog.warn("web.asset_archive_failed", { "error.code": socketErrorCode(error) });
          }
          middlewares.use(
            missingAssetMiddleware(assetsDir, `${config.base}${config.build.assetsDir}/`, archive)
          );
        }
      },
      {
        name: "rakazo-desktop-stack-probe",
        configureServer: (server) => attachDesktopStackProbe(server, desktopStackToken, imageTag),
        configurePreviewServer: (server) => attachDesktopStackProbe(server, desktopStackToken, imageTag)
      },
      {
        name: "rakazo-performance-asset-delay",
        configurePreviewServer(server) {
          if (!Number.isFinite(performanceAssetDelayMs) || performanceAssetDelayMs <= 0) return;
          server.middlewares.use((req, _res, next) => {
            const pathname = req.url?.split("?", 1)[0] ?? "/";
            if (["/api", "/rpc", "/novnc"].some((prefix) => pathname.startsWith(prefix))) {
              next();
              return;
            }
            setTimeout(next, performanceAssetDelayMs);
          });
        }
      },
      {
        name: "rakazo-novnc-proxy",
        configureServer: (server) => attachNovncProxy(server, screenProxySecret(), api),
        configurePreviewServer: (server) => attachNovncProxy(server, screenProxySecret(), api)
      }
    ],
    server: {
      host: process.env.RAKAZO_DEV_HOST ?? rootEnv.RAKAZO_DEV_HOST ?? "127.0.0.1",
      port: webPort,
      strictPort: true,
      allowedHosts,
      proxy: apiProxy
    },
    preview: {
      host: "0.0.0.0",
      port: Number(process.env.WEB_PORT ?? 5173),
      allowedHosts,
      proxy: apiProxy
    }
  };
});
export {
  vite_config_default as default
};
