import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

async function readOptionalJson(file: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error("Could not read the native OpenCode provider configuration");
  }
}

/** Import only the CLI's selected provider, never its plugins, MCPs or permissions. */
export async function prepareOpenCodeProfile(home: string, sourceHome = homedir()) {
  const config = await readOptionalJson(join(sourceHome, ".config", "opencode", "opencode.json"));
  const model = typeof config.model === "string" ? config.model : undefined;
  const providerId = model?.split("/")[0] || "opencode";
  const providers = config.provider as Record<string, unknown> | undefined;
  const auth = await readOptionalJson(join(sourceHome, ".local", "share", "opencode", "auth.json"));
  // Must match the child's XDG_DATA_HOME, rather than HOME/.local/share.
  const data = join(home, "data", "opencode");
  await mkdir(data, { recursive: true, mode: 0o700 });
  await writeFile(join(data, "auth.json"), JSON.stringify(
    auth[providerId] ? { [providerId]: auth[providerId] } : {},
  ), { mode: 0o600 });
  // Override any profile left by older versions; do not load arbitrary host config.
  const directory = join(home, "config", "opencode");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, "opencode.json"), "{}", { mode: 0o600 });
  return {
    ...(model ? { model } : {}),
    ...(providers?.[providerId] ? { provider: { [providerId]: providers[providerId] } } : {}),
    enabled_providers: [providerId],
    snapshot: false,
    permission: { "*": "deny", "rakazo_*": "allow" },
  };
}
