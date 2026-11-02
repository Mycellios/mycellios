import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runServiceCommand,
  type ServiceCommandRunner,
} from "./service-registration.js";

const installerSha256 =
  "843068991daaa1f73ad9f6239bce4d0f6a07a51f18c37ea2a867e9beca71295c";
const installerUrl =
  "https://download.visualstudio.microsoft.com/download/pr/ebdab8e5-1d7b-4d9f-a11b-cbb1720c3b12/843068991DAAA1F73AD9F6239BCE4D0F6A07A51F18C37EA2A867E9BECA71295C/VC_redist.x64.exe";
const probe =
  "import torch; assert torch.ones(4).sum().item() == 4; print('mycellios_cpp_runtime_ready')";

/** Repair the observed missing Windows DLL prerequisite before creating a node. */
export async function ensureWindowsCppPrerequisite(input: {
  platform: string;
  installRoot: string;
  run?: ServiceCommandRunner;
}): Promise<void> {
  if (input.platform !== "win32") return;
  const run = input.run ?? runServiceCommand;
  const python = join(input.installRoot, "runtime", "python.exe");
  const before = await run(python, ["-c", probe]);
  if (
    before.code === 0 &&
    before.stdout.includes("mycellios_cpp_runtime_ready")
  )
    return;
  if (
    !before.stdout.includes(
      "Microsoft Visual C++ Redistributable is not installed",
    )
  ) {
    throw new Error("node_windows_python_prerequisite_probe_failed");
  }
  const directory = await mkdtemp(join(tmpdir(), "mycellios-cpp-"));
  try {
    const powershell = join(
      process.env.SystemRoot ?? "C:/Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const result = await run(powershell, [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(
        cppInstallerScript(join(directory, "vc_redist.x64.exe")),
        "utf16le",
      ).toString("base64"),
    ]);
    if (result.code === 3010)
      throw new Error("node_windows_cpp_prerequisite_reboot_required");
    if (result.code !== 0)
      throw new Error("node_windows_cpp_prerequisite_install_failed");
    const after = await run(python, ["-c", probe]);
    if (
      after.code !== 0 ||
      !after.stdout.includes("mycellios_cpp_runtime_ready")
    ) {
      throw new Error("node_windows_cpp_prerequisite_reprobe_failed");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function cppInstallerScript(path: string): string {
  return `
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$env:PSModulePath=Join-Path $PSHOME 'Modules'
$path='${path.replaceAll("'", "''")}'
Invoke-WebRequest -UseBasicParsing -Uri '${installerUrl}' -OutFile $path -TimeoutSec 120
$handle=[IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try {
  if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne '${installerSha256}') { throw 'node_cpp_installer_hash_mismatch' }
  $signature=Get-AuthenticodeSignature -LiteralPath $path
  if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '^CN=Microsoft Corporation,') { throw 'node_cpp_installer_signature_invalid' }
  $process=Start-Process -FilePath $path -ArgumentList @('/install','/quiet','/norestart') -PassThru -WindowStyle Hidden
  $process.WaitForExit()
  exit $process.ExitCode
} finally { $handle.Dispose() }
`;
}
