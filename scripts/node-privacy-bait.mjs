#!/usr/bin/env node
// Bait traffic for privacy from node owners (specs/node-owner-privacy, D8).
//
// Sends ordinary, funded requests through the public API whose content
// carries a unique phrase, a link and an API key that only the coordinator's
// MYCELLIOS_TRIPWIRE_SECRET can produce. The request goes to a contributor
// node like any other. If the link is opened or the key is tried, the
// coordinator logs `tripwire_hit` with the tripwire id; `lookup` maps that id
// to the job, and the jobs table maps the job to the node that received it.
//
// Records stay on the operator's machine: they link bait content to jobs.
//
//   node scripts/node-privacy-bait.mjs send --coordinator https://www.mycellios.com \
//     --api-key-file key.txt --secret-file tripwire.txt --link-base https://www.mycellios.com \
//     --records bait.jsonl --model mycellios-kokoro-es --count 3 --mean-gap-seconds 900
//   node scripts/node-privacy-bait.mjs lookup --records bait.jsonl --id <tripwireId>
import { createHmac, randomBytes, randomInt } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export const KOKORO_MODEL = "mycellios-kokoro-es";
export const EMBEDDING_MODEL = "mycellios-qwen3-embedding-4b";
const LINK_PATH = "/go/";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

function mac(secret, purpose, id) {
  return createHmac("sha256", Buffer.from(secret, "utf8")).update(`${purpose}\n${id}`).digest();
}

function randomId(length, random = randomInt) {
  return Array.from({ length }, () => ALPHABET[random(ALPHABET.length)]).join("");
}

export function tripwireLink(secret, base, id = randomBytes(16).toString("base64url")) {
  const tag = mac(secret, "mycellios-tripwire-link/1", id).subarray(0, 8).toString("base64url");
  return { id, url: `${base.replace(/\/+$/, "")}${LINK_PATH}${id}${tag}` };
}

export function tripwireKey(secret, id = randomId(10)) {
  return { id, key: `myc_live_${id}_${mac(secret, "mycellios-tripwire-key/1", id).toString("base64url")}` };
}

const WORDS = {
  es: ["arce", "brisa", "cobre", "delta", "nogal", "faro", "granate", "jade", "lince", "marea", "olmo", "pardo", "roble", "sauce", "tilo", "zafiro"],
  en: ["amber", "birch", "cedar", "delta", "ember", "falcon", "garnet", "harbor", "indigo", "juniper", "kestrel", "linden", "maple", "nectar", "orchid", "quartz"],
};

const TEMPLATES = {
  es: [
    "Recordatorio para mañana: la clave nueva del panel es {key}. Las instrucciones completas están en {link}. Frase de verificación: {phrase}.",
    "Nota de la reunión: para acceder al informe usa {link} y la clave {key}. Si te piden confirmación, di {phrase}.",
    "Te paso los datos de la cuenta de pruebas. Enlace: {link}. Clave: {key}. Palabra de control: {phrase}.",
  ],
  en: [
    "Reminder for tomorrow: the new dashboard key is {key}. Full instructions are at {link}. Verification phrase: {phrase}.",
    "Meeting note: to open the report use {link} with the key {key}. If asked to confirm, say {phrase}.",
    "Here are the test account details. Link: {link}. Key: {key}. Control word: {phrase}.",
  ],
};

/** A unique marker phrase to search for if content ever surfaces publicly. */
export function markerPhrase(language, random = randomInt) {
  const words = WORDS[language];
  return `${words[random(words.length)]} ${words[random(words.length)]} ${1000 + random(9000)}`;
}

export function baitText(language, { link, key, phrase }, random = randomInt) {
  const templates = TEMPLATES[language];
  return templates[random(templates.length)].replace("{link}", link).replace("{key}", key).replace("{phrase}", phrase);
}

/** The same request shape real clients send for each model. */
export function baitRequest(model, text, { language = "es", dimensions } = {}, random = randomInt) {
  if (model === KOKORO_MODEL) {
    const voices = language === "es" ? ["ef_dora", "em_alex"] : ["af_heart", "am_michael"];
    return { model, messages: [{ role: "user", content: text }], stream: false,
      language, voice: voices[random(voices.length)], speed: 1 };
  }
  if (model === EMBEDDING_MODEL) {
    const envelope = { schema: "mycellios-embeddings/1", input: [text], ...(dimensions ? { dimensions } : {}) };
    return { model, messages: [{ role: "user", content: JSON.stringify(envelope) }], stream: false };
  }
  throw new Error(`No bait shape for ${model}`);
}

export function buildBait({ secret, linkBase, model, language, dimensions }, random = randomInt) {
  const link = tripwireLink(secret, linkBase);
  const key = tripwireKey(secret);
  const phrase = markerPhrase(language, random);
  const text = baitText(language, { link: link.url, key: key.key, phrase }, random);
  return { request: baitRequest(model, text, { language, dimensions }, random), linkId: link.id, keyId: key.id, phrase };
}

export async function sendBait(options, transport = fetch, now = () => new Date()) {
  const bait = buildBait(options);
  const response = await transport(`${options.coordinator.replace(/\/+$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json",
      "x-mycellios-funding": "contribution-credits" },
    body: JSON.stringify(bait.request),
  });
  const body = await response.json().catch(() => ({}));
  const record = { at: now().toISOString(), model: bait.request.model, status: response.status,
    jobId: typeof body.id === "string" ? body.id : null, linkId: bait.linkId, keyId: bait.keyId, phrase: bait.phrase };
  appendFileSync(options.records, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  return record;
}

export function lookup(recordsPath, id) {
  return readFileSync(recordsPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
    .filter((record) => record.linkId === id || record.keyId === id || record.phrase === id || record.jobId === id);
}

function argument(args, name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) {
    if (fallback === undefined) throw new Error(`--${name} is required`);
    return fallback;
  }
  return args[index + 1];
}

async function main(args) {
  const command = args[0];
  if (command === "lookup") {
    console.log(JSON.stringify(lookup(argument(args, "records"), argument(args, "id")), null, 2));
    return;
  }
  if (command !== "send") throw new Error("Usage: node-privacy-bait.mjs send|lookup ...");
  const options = {
    coordinator: argument(args, "coordinator"),
    apiKey: readFileSync(argument(args, "api-key-file"), "utf8").trim(),
    secret: readFileSync(argument(args, "secret-file"), "utf8").trim(),
    linkBase: argument(args, "link-base"),
    records: argument(args, "records"),
    model: argument(args, "model"),
    language: argument(args, "language", "es"),
    dimensions: Number(argument(args, "dimensions", "0")) || undefined,
  };
  const count = Number(argument(args, "count", "1"));
  const meanGapSeconds = Number(argument(args, "mean-gap-seconds", "0"));
  for (let index = 0; index < count; index += 1) {
    const record = await sendBait(options);
    console.log(JSON.stringify({ at: record.at, model: record.model, status: record.status, jobId: record.jobId }));
    // Exponential gaps (a Poisson process) keep bait timing unremarkable.
    if (index + 1 < count && meanGapSeconds > 0) await sleep(-Math.log(1 - Math.random()) * meanGapSeconds * 1_000);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
