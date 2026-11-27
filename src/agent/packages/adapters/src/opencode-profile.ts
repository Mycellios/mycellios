import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { NativeCodexModel } from "./native-codex-settings.js";

async function readOptionalJson(file: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error("Could not read the native OpenCode provider configuration");
  }
}

/** The provider of an OpenCode model id (`provider/model`, as its catalog lists it), if well formed. */
export function openCodeModelProvider(model: string | null | undefined) {
  const match = model && model.length <= 200 ? /^([^/\s]+)\/\S+$/.exec(model) : null;
  return match?.[1];
}

async function hostOpenCode(sourceHome: string) {
  const config = await readOptionalJson(join(sourceHome, ".config", "opencode", "opencode.json"));
  const auth = await readOptionalJson(join(sourceHome, ".local", "share", "opencode", "auth.json"));
  const providers = config.provider && typeof config.provider === "object"
    ? config.provider as Record<string, unknown> : undefined;
  const model = typeof config.model === "string" ? config.model : undefined;
  return { auth, providers, model };
}

/** Writes the private profile's credentials and an empty config, so no host config, plugin or MCP loads. */
async function writeProfile(home: string, auth: Record<string, unknown>) {
  // Must match the child's XDG_DATA_HOME, rather than HOME/.local/share.
  const data = join(home, "data", "opencode");
  await mkdir(data, { recursive: true, mode: 0o700 });
  await writeFile(join(data, "auth.json"), JSON.stringify(auth), { mode: 0o600 });
  // Override any profile left by older versions; do not load arbitrary host config.
  const directory = join(home, "config", "opencode");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, "opencode.json"), "{}", { mode: 0o600 });
}

/**
 * Import only one provider, never the CLI's plugins, MCPs or permissions: the Mico's chosen
 * model's provider, else the one of the CLI's own selected model.
 */
export async function prepareOpenCodeProfile(home: string, sourceHome = homedir(), chosenModel?: string | null) {
  const host = await hostOpenCode(sourceHome);
  const model = openCodeModelProvider(chosenModel) ? chosenModel! : host.model;
  const providerId = model?.split("/")[0] || "opencode";
  await writeProfile(home, host.auth[providerId] ? { [providerId]: host.auth[providerId] } : {});
  return {
    ...(model ? { model } : {}),
    ...(host.providers?.[providerId] ? { provider: { [providerId]: host.providers[providerId] } } : {}),
    enabled_providers: [providerId],
    snapshot: false,
    permission: { "*": "deny", "rakazo_*": "allow" },
  };
}

/**
 * The profile that lists models: every provider the CLI can reach (their definitions and
 * credentials only), still without plugins, MCPs or project config. It never runs a model.
 */
export async function prepareOpenCodeCatalogProfile(home: string, sourceHome = homedir()) {
  const host = await hostOpenCode(sourceHome);
  await writeProfile(home, host.auth);
  return {
    ...(host.model ? { model: host.model } : {}),
    ...(host.providers ? { provider: host.providers } : {}),
    snapshot: false,
    permission: { "*": "deny" },
  };
}

/** The environment that keeps an OpenCode process inside its private profile. */
export function openCodeEnvironment(home: string, config: unknown): NodeJS.ProcessEnv {
  return {
    HOME: home,
    USERPROFILE: home,
    APPDATA: home,
    LOCALAPPDATA: home,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_DATA_HOME: join(home, "data"),
    XDG_CACHE_HOME: join(home, "cache"),
    XDG_STATE_HOME: join(home, "state"),
    OPENCODE_PURE: "true",
    OPENCODE_DISABLE_PROJECT_CONFIG: "true",
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    OPENCODE_DISABLE_LSP_DOWNLOAD: "true",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "true",
    OPENCODE_DISABLE_CLAUDE_CODE: "true",
    OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
  };
}

/** OpenCode lists at most this many models; a Mico needs tool calls, so others are left out. */
export const OPENCODE_MODEL_LIMIT = 256;

/**
 * Reads `opencode models --verbose`: each model is a `provider/model` line followed by its JSON.
 * Keeps models that can call tools and are not deprecated; the CLI's own model comes first.
 */
export function nativeOpenCodeModels(output: string, defaultModel?: string): NativeCodexModel[] {
  const models: NativeCodexModel[] = [];
  const lines = output.split(/\r?\n/);
  let id: string | undefined;
  let body: string[] = [];
  const flush = () => {
    if (!id) return;
    let entry: Record<string, unknown> | undefined;
    try { entry = JSON.parse(body.join("\n")); } catch { entry = undefined; }
    const capabilities = entry?.capabilities as { toolcall?: unknown } | undefined;
    if (entry && capabilities?.toolcall !== false && entry.status !== "deprecated") {
      const name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim().slice(0, 150) : id.split("/").slice(1).join("/");
      models.push({ id, label: `${name} · ${id.split("/")[0]}`, isDefault: id === defaultModel, thinkingLevels: [], fast: false });
    }
  };
  for (const line of lines) {
    if (openCodeModelProvider(line) && !line.startsWith(" ")) {
      flush();
      id = line;
      body = [];
    } else if (id) body.push(line);
  }
  flush();
  if (!models.length && output.trim()) throw new Error("OpenCode model catalog unavailable.");
  const unique = [...new Map(models.map(model => [model.id, model])).values()];
  return [...unique.filter(model => model.isDefault), ...unique.filter(model => !model.isDefault)].slice(0, OPENCODE_MODEL_LIMIT);
}
