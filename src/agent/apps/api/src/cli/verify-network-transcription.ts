/** Explicit operator qualification; never imported by API startup. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { createOpenAiCompatibleFetch, createSecretStore } from "@rakazo/adapters";
import { createDb, runAsTenant } from "@rakazo/db";
import { readBoundedJsonResponse } from "@rakazo/core";
import { MAX_TRANSCRIPTION_RESULT_BYTES } from "../../../../../contracts/transcription.js";
import { loadEnv } from "../env.js";
import { ownedMycelliosConnection } from "../mycellios-owned-connection.js";
import { renderNetworkTranscription } from "../mycellios-network-transcription.js";

const targetSchema = z.object({ userId: z.string().min(1), spaceId: z.string().min(1), botId: z.string().min(1),
  language: z.enum(["es", "en", "auto"]), expectedText: z.string().max(1000).optional() }).strict();
const normalized = (text: string) => text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
  .replace(/[^a-z0-9 ]/g, " ").replace(/\b(?:nueve|nine)\b/g, "9").trim().replace(/\s+/g, " ");

async function main() {
  const [consent, targetFile, audioFile, directory] = process.argv.slice(2);
  if (consent !== "--confirm-credit-use" || !targetFile || !audioFile || !directory) throw new Error("Explicit credit-use confirmation and private qualification files required");
  const target = targetSchema.parse(JSON.parse(await readFile(targetFile, "utf8")));
  const env = loadEnv();
  if (!env.mycelliosNetworkTranscriptionIdentityIds?.length) throw new Error("Transcription placement is not configured");
  const db = createDb(env.databaseUrl, { poolMax: 1, applicationName: "network-transcription-live-proof", encryptContent: env.contentEncryption });
  const output = resolve(directory); await mkdir(output, { recursive: true, mode: 0o700 });
  let jobId: string | undefined;
  const started = Date.now();
  try {
    const proof = await runAsTenant(target, async () => {
      if (!await db.prisma.bot.findFirst({ where: { id: target.botId, userId: target.userId, spaceId: target.spaceId, archivedAt: null }, select: { id: true } })) throw new Error("Target Mico is not owned by account and Space");
      const connection = await ownedMycelliosConnection({ prisma: db.prisma, secrets: createSecretStore(env.encryptionKey) }, target.userId);
      if (!connection?.saved.apiKey) throw new Error("Owned Mycellios key missing");
      const transport = createOpenAiCompatibleFetch();
      const capture: typeof fetch = async (url, init) => {
        const response = await transport(url, init);
        const id = response.headers.get("x-network-request-id");
        if (id && /^[A-Za-z0-9_-]{1,128}$/.test(id)) jobId = id;
        if (response.ok) {
          const body = await readBoundedJsonResponse<{ id?: unknown }>(response.clone(), MAX_TRANSCRIPTION_RESULT_BYTES + 4096, init?.signal ?? undefined);
          if (typeof body.id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(body.id)) jobId = body.id;
        }
        return response;
      };
      const audio = await readFile(audioFile);
      const result = await renderNetworkTranscription(connection.saved.apiKey, { audio, language: target.language,
        workerIdentityIds: env.mycelliosNetworkTranscriptionIdentityIds }, capture);
      if (!jobId || (target.expectedText && normalized(result.text) !== normalized(target.expectedText))) throw new Error("Transcription qualification mismatch");
      return { passed: true, jobId, language: target.language, text: result.text, elapsedMs: Date.now() - started,
        audioSha256: createHash("sha256").update(audio).digest("hex"), funding: "contribution-credits",
        ownershipChecked: true, pinnedPlacement: true, automaticRetry: false };
    });
    await writeFile(resolve(output, `${target.language}-proof.json`), JSON.stringify(proof, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(proof));
  } catch (error) {
    const proof = { passed: false, jobId, language: target.language, elapsedMs: Date.now() - started,
      code: error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z_]{1,50}$/.test(error.code) ? error.code : "TRANSCRIPTION_QUALIFICATION_FAILED" };
    await writeFile(resolve(output, `${target.language}-failure.json`), JSON.stringify(proof, null, 2), { mode: 0o600 });
    console.error(JSON.stringify(proof)); process.exitCode = 1;
  } finally { await db.prisma.$disconnect(); await db.pool.end(); }
}
main().catch(() => { console.error(JSON.stringify({ passed: false, code: "NETWORK_TRANSCRIPTION_LIVE_CHECK_FAILED" })); process.exitCode = 1; });
