#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_URL = "https://www.mycellios.com/agent/";
const DEFAULT_WAIT_MS = 30 * 60_000;
const REQUEST_MS = 15_000;
const POLL_MS = 1_000;
const USAGE = [
  "Usage: mycellios-cli run <mico> <text|-> [--wait] [--timeout 30m] [--id <key>] [--json]",
  "       mycellios-cli status <mico> <delivery> [--json]",
  "       mycellios-cli pending <mico> [--json]",
  "       mycellios-cli answer <mico> <question> <text|-> [--json]",
  "       mycellios-cli list <mico> [--json]",
].join("\n");
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const COMMANDS = { run: 1, status: 1, pending: 0, answer: 2, list: 0 };

function parseDuration(value) {
  const match = /^(\d+)(ms|s|m|h)$/.exec(value ?? "");
  if (!match) throw new Error("Use a duration like 15s, 30m or 2h.");
  const ms = Number(match[1]) * { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[match[2]];
  if (!Number.isSafeInteger(ms) || ms <= 0) throw new Error("Invalid duration.");
  return ms;
}

function parseArgs(argv) {
  const [command, mico, ...args] = argv;
  if (!Object.hasOwn(COMMANDS, command) || !ID.test(mico ?? "")) throw new Error(USAGE);
  const [first, second] = args.splice(0, COMMANDS[command]);
  if ((command === "run" && (!first || first.startsWith("--"))) ||
      (command === "status" && !ID.test(first ?? "")) ||
      (command === "answer" && (!ID.test(first ?? "") || !second || second.startsWith("--")))) {
    throw new Error(USAGE);
  }
  const options = { wait: false, json: false, waitMs: DEFAULT_WAIT_MS, key: undefined };
  while (args.length) {
    const arg = args.shift();
    if (arg === "--json") options.json = true;
    else if (command === "run" && arg === "--wait") options.wait = true;
    else if (command === "run" && arg === "--timeout") options.waitMs = parseDuration(args.shift());
    else if (command === "run" && arg === "--id") {
      options.key = args.shift();
      if (!/^[\x21-\x7e]{1,200}$/.test(options.key ?? "")) throw new Error("Invalid retry key.");
    } else throw new Error(USAGE);
  }
  return { command, mico, first, second, ...options };
}

async function readText(value, input) {
  if (value !== "-") return value;
  const decoder = new StringDecoder("utf8");
  let text = "";
  for await (const chunk of input) {
    text += typeof chunk === "string" ? chunk : decoder.write(chunk);
    if (Buffer.byteLength(text) > 64 * 1024) throw new Error("Input is too large.");
  }
  text += decoder.end();
  if (!text.trim()) throw new Error("Input is empty.");
  return text;
}

function requestBase(env) {
  const base = new URL(env.MYCELLIOS_URL || DEFAULT_URL);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
    throw new Error("MYCELLIOS_URL must be an HTTPS URL without credentials, query or fragment.");
  }
  base.pathname = base.pathname.replace(/\/?$/, "/");
  return base;
}

function outcome(delivery) {
  if (delivery?.status === "completed") return 0;
  if (delivery?.status === "failed" || delivery?.status === "cancelled") return 1;
  if (delivery?.status === "waiting") return 3;
  if (delivery?.status === "queued" || delivery?.status === "running") return null;
  throw new Error("Unexpected delivery status");
}

function display(body, json, stdout) {
  if (json || !body?.status) stdout.write(JSON.stringify(body) + "\n");
  else stdout.write((body.answer || body.error || `${body.id}: ${body.status}`) + "\n");
}

export async function runCli(argv, {
  env = process.env, input = process.stdin, stdout = process.stdout, stderr = process.stderr,
  fetcher = fetch, sleep = delay, now = Date.now,
} = {}) {
  if (argv.length === 1 && argv[0] === "--help") {
    stdout.write(USAGE + "\n");
    return 0;
  }
  let options;
  let base;
  let text;
  try {
    options = parseArgs(argv);
    base = requestBase(env);
    if (options.command === "run") text = await readText(options.first, input);
    if (options.command === "answer") text = await readText(options.second, input);
  } catch (error) {
    stderr.write(error.message + "\n");
    return 2;
  }

  let deadline;
  try {
    const token = (env.MYCELLIOS_TOKEN ||
      (env.MYCELLIOS_TOKEN_FILE ? await readFile(env.MYCELLIOS_TOKEN_FILE, "utf8") : "")).trim();
    if (!/^mycs_[A-Za-z0-9_-]+$/.test(token)) {
      stderr.write("Set MYCELLIOS_TOKEN or MYCELLIOS_TOKEN_FILE with a valid Mico Scripts token.\n");
      return 5;
    }
    const request = async (path, data, timeout = REQUEST_MS) => {
      const url = new URL(`api/v1/micos/${options.mico}${path}`, base);
      const response = await fetcher(url, {
        method: data === undefined ? "GET" : "POST",
        redirect: "error",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: data === undefined ? undefined : JSON.stringify(data),
        signal: AbortSignal.timeout(Math.min(timeout, REQUEST_MS)),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("The Mico request failed");
      }
      return response.json();
    };

    let body;
    if (options.command === "status") body = await request(`/deliveries/${options.first}`);
    if (options.command === "pending") body = await request("/pending");
    if (options.command === "answer") body = await request(`/questions/${options.first}/answer`, { answer: text });
    if (options.command === "list") body = await request("");
    if (options.command === "run") {
      body = await request("/messages", { text, clientMessageId: options.key });
      if (options.wait) {
        const deliveryId = body?.id;
        if (!ID.test(deliveryId ?? "")) throw new Error("Missing delivery id");
        deadline = now() + options.waitMs;
        while (outcome(body) === null) {
          await sleep(Math.min(POLL_MS, Math.max(0, deadline - now())));
          const remaining = deadline - now();
          if (remaining <= 0) break;
          body = await request(`/deliveries/${deliveryId}`, undefined, remaining);
          if (body?.id !== deliveryId) throw new Error("Unexpected delivery");
        }
        if (outcome(body) === null) {
          display(body, options.json, stdout);
          stderr.write("Wait timed out. The Mico is still working.\n");
          return 4;
        }
      }
    }
    display(body, options.json, stdout);
    return options.command === "run" || options.command === "status" ? outcome(body) ?? 0 : 0;
  } catch {
    if (deadline !== undefined && now() >= deadline) {
      stderr.write("Wait timed out. The Mico is still working.\n");
      return 4;
    }
    stderr.write("Could not reach the Mico. Check its URL, token and Scripts setting.\n");
    return 5;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await runCli(process.argv.slice(2));
}
