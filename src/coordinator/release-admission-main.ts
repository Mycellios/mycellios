import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import postgres from "postgres";
import { readNativeRuntimeBuildMetadata } from "../core/native-build-identity.js";
import { runReleaseAdmissionCommand } from "./release-admission-command.js";
import { NativeReleaseAdmission } from "./release-admission.js";

try {
  const credentialPath = process.env.MYCELLIOS_RELEASE_OWNER_URL_FILE;
  if (!credentialPath || !isAbsolute(credentialPath)) throw new Error("release_admission_owner_file_required");
  const url = (await readFile(credentialPath, "utf8")).trim();
  if (!["postgres:", "postgresql:"].includes(new URL(url).protocol)) throw new Error("release_admission_postgres_required");
  const { revision } = readNativeRuntimeBuildMetadata(resolve(import.meta.dirname, "../.."));
  const sql = postgres(url, {
    max: 1, prepare: false, connect_timeout: 5, onnotice: () => {},
    connection: { application_name: "mycellios-release-admission", statement_timeout: 8000, lock_timeout: 5000 },
  });
  try {
    const gate = new NativeReleaseAdmission(sql, process.env.MYCELLIOS_DATABASE_SCHEMA);
    console.log(JSON.stringify(await runReleaseAdmissionCommand(gate, process.argv.slice(2), revision)));
  } finally {
    await sql.end({ timeout: 3 });
  }
} catch {
  // Database client errors can contain connection parameters.
  console.error("Coordinator release admission command failed");
  process.exitCode = 1;
}
