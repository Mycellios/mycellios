import type { NativeReleaseAdmission } from "./release-admission.js";

type AdmissionGate = Pick<NativeReleaseAdmission, "close" | "transfer" | "status" | "open">;

export async function runReleaseAdmissionCommand(
  gate: AdmissionGate,
  args: readonly string[],
  imageRevision: string | null,
) {
  const [command, revision, candidate] = args;
  const exactRevision = (value: string | undefined): value is string => /^[a-f0-9]{40}$/.test(value ?? "");
  if (!exactRevision(revision)) throw new Error("release_admission_command_invalid");

  if (command === "transfer" && args.length === 3 && exactRevision(candidate) && candidate !== revision) {
    if (candidate !== imageRevision) throw new Error("release_admission_image_mismatch");
    await gate.transfer(revision, candidate);
    return { revision: candidate, barrier: "active" as const };
  }
  if (args.length !== 2) throw new Error("release_admission_command_invalid");
  if (command === "status") return { revision, barrier: "active" as const, work: await gate.status(revision) };
  if (command !== "close" && command !== "open") throw new Error("release_admission_command_invalid");
  if (revision !== imageRevision) throw new Error("release_admission_image_mismatch");
  if (command === "close") {
    await gate.close(revision);
    return { revision, barrier: "active" as const };
  }
  await gate.open(revision);
  return { revision, barrier: "removed" as const };
}
