// Explicit operator qualification. Never imported or run by API startup.
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { createOpenAiCompatibleFetch, createSecretStore } from "@rakazo/adapters";
import { createDb, runAsTenant } from "@rakazo/db";
import { readBoundedJsonResponse } from "@rakazo/core";
import { MAX_SPEECH_RESPONSE_BYTES } from "../../../../../contracts/speech.js";
import { loadEnv } from "../env.js";
import { ownedMycelliosConnection } from "../mycellios-owned-connection.js";
import { renderNetworkSpeech } from "../mycellios-network-speech.js";

const targetSchema = z.object({
  userId: z.string().min(1), spaceId: z.string().min(1), botId: z.string().min(1),
  language: z.enum(["es", "en"]),
}).strict();

async function main() {
  const [consent, targetPath, directory] = process.argv.slice(2);
  if (consent !== "--confirm-credit-use" || !targetPath || !directory) {
    throw new Error("Explicit credit-use confirmation, target file and private output directory required");
  }
  const target = targetSchema.parse(JSON.parse(await readFile(targetPath, "utf8")));
  const env = loadEnv();
  if (!env.mycelliosNetworkSpeechIdentityIds?.length) throw new Error("Speech placement is not configured");
  const db = createDb(env.databaseUrl, { poolMax: 1, applicationName: "network-voice-live-proof", encryptContent: env.contentEncryption });
  try {
    const proof = await runAsTenant(target, async () => {
      const bot = await db.prisma.bot.findFirst({ where: {
        id: target.botId, userId: target.userId, spaceId: target.spaceId, archivedAt: null,
      }, select: { id: true } });
      if (!bot) throw new Error("Target Mico is not owned by the requested account and Space");
      const secrets = createSecretStore(env.encryptionKey);
      const connection = await ownedMycelliosConnection({ prisma: db.prisma, secrets }, target.userId);
      if (!connection?.saved.apiKey) throw new Error("No owned Mycellios connection with an API key");
      const text = target.language === "es"
        ? `Prueba real de voz Mycellios. ${randomUUID().slice(0, 8)}.`
        : `Real Mycellios voice check. ${randomUUID().slice(0, 8)}.`;
      let jobId: string | undefined;
      const transport = createOpenAiCompatibleFetch();
      const capture: typeof fetch = async (url, init) => {
        const response = await transport(url, init);
        if (response.ok) {
          const data = await readBoundedJsonResponse<{ id?: unknown }>(response.clone(), MAX_SPEECH_RESPONSE_BYTES, init?.signal ?? undefined);
          if (typeof data.id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(data.id)) jobId = data.id;
        }
        return response;
      };
      const started = Date.now();
      const audio = await renderNetworkSpeech(connection.saved.apiKey, {
        text, language: target.language, workerIdentityIds: env.mycelliosNetworkSpeechIdentityIds,
      }, capture);
      if (!jobId) throw new Error("Missing inference identity");
      const output = resolve(directory);
      await mkdir(output, { recursive: true, mode: 0o700 });
      const file = resolve(output, `${target.language}.wav`);
      await writeFile(file, audio.bytes, { mode: 0o600 });
      return { passed: true, jobId, language: target.language, elapsedMs: Date.now() - started,
        bytes: audio.bytes.length, sha256: createHash("sha256").update(audio.bytes).digest("hex"),
        mimeType: audio.mimeType, funding: "contribution-credits", ownershipChecked: true,
        pinnedPlacement: true, automaticRetry: false, audioFile: file };
    });
    await writeFile(resolve(directory, `${target.language}-proof.json`), JSON.stringify(proof, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(proof));
  } finally {
    await db.prisma.$disconnect();
    await db.pool.end();
  }
}
main().catch(() => {
  // No upstream response, model key, database URL or decrypted secret in logs.
  console.error(JSON.stringify({ passed: false, code: "NETWORK_VOICE_LIVE_CHECK_FAILED" }));
  process.exitCode = 1;
});
