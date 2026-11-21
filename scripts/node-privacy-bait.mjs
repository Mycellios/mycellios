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

// Sentences are combined at random (opener, the three markers in any order and
// up to two context lines), so bait has no fixed wording an owner could learn.
const PARTS = {
  es: {
    opener: ["Recordatorio para mañana:", "Nota rápida para el equipo:", "Lo apunto para no olvidarlo:", "Del correo de ayer:",
      "Resumen de la llamada:", "Para el informe del viernes:", "Pendiente de la reunión:", "Te reenvío lo que me pasaron:"],
    link: ["Los detalles están en {link}.", "El documento compartido es {link}.", "Revisa {link} antes de la reunión.",
      "La hoja de cálculo está en {link}.", "Aquí tienes el enlace: {link}", "Lo dejé subido en {link}."],
    key: ["La clave de acceso es {key}.", "Credencial temporal: {key}", "Usa {key} para entrar en el panel.",
      "La clave de la API es {key}, no la compartas.", "Para la integración, la clave es {key}.", "Te dejo la clave: {key}"],
    phrase: ["La palabra clave del proyecto es {phrase}.", "El código de la reserva es {phrase}.", "Contraseña del wifi de la oficina: {phrase}.",
      "Si te llaman, la frase de seguridad es {phrase}.", "Referencia del pedido: {phrase}.", "El nombre interno es {phrase}."],
    context: ["Hay que confirmar la fecha con el proveedor.", "Contabilidad necesita el resumen antes del lunes.",
      "El cliente pidió más tiempo para revisar el contrato.", "La entrega se retrasa una semana.", "Mañana hay que llamar al gestor.",
      "El presupuesto ya está aprobado.", "Falta la firma del responsable.", "La copia de seguridad se hace los domingos."],
  },
  en: {
    opener: ["Reminder for tomorrow:", "Quick note for the team:", "Writing this down so I don't forget:", "From yesterday's email:",
      "Call summary:", "For Friday's report:", "Follow-up from the meeting:", "Forwarding what they sent me:"],
    link: ["The details are at {link}.", "The shared document is {link}.", "Check {link} before the meeting.",
      "The spreadsheet is at {link}.", "Here's the link: {link}", "I uploaded it to {link}."],
    key: ["The access key is {key}.", "Temporary credential: {key}", "Use {key} to log into the dashboard.",
      "The API key is {key}, don't share it.", "For the integration, the key is {key}.", "Here's the key: {key}"],
    phrase: ["The project code word is {phrase}.", "The booking code is {phrase}.", "Office wifi password: {phrase}.",
      "If they call, the security phrase is {phrase}.", "Order reference: {phrase}.", "The internal name is {phrase}."],
    context: ["We still need to confirm the date with the supplier.", "Accounting needs the summary before Monday.",
      "The client asked for more time to review the contract.", "Delivery slips by a week.", "Tomorrow we need to call the accountant.",
      "The budget is already approved.", "We're missing the manager's signature.", "Backups run on Sundays."],
  },
};

/** A unique marker phrase to search for if content ever surfaces publicly. */
export function markerPhrase(language, random = randomInt) {
  const words = WORDS[language];
  return `${words[random(words.length)]} ${words[random(words.length)]} ${1000 + random(9000)}`;
}

function pick(list, random) {
  return list[random(list.length)];
}

function shuffle(list, random) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = random(index + 1);
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

export function baitText(language, { link, key, phrase }, random = randomInt) {
  const parts = PARTS[language];
  const markers = [
    pick(parts.link, random).replace("{link}", link),
    pick(parts.key, random).replace("{key}", key),
    pick(parts.phrase, random).replace("{phrase}", phrase),
  ];
  const context = shuffle(parts.context, random).slice(0, random(3));
  return [pick(parts.opener, random), ...shuffle([...markers, ...context], random)].join(" ");
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
