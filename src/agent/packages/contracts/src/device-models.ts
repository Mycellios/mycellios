// Models that run on the person's own PC through Mycellios Desktop (specs/local-models/spec.md).
// The server never calls them: it only records the choice and sends the turn to that PC.

/** Provider id of a model served by Desktop on the Mico's own PC. */
export const DEVICE_MODEL_PROVIDER_ID = "device";

/** Context window the light mode is sized for; Desktop loads each model with its own. */
export const DEVICE_MODEL_CONTEXT_WINDOW = 16_384;
export const DEVICE_MODEL_MAX_TOKENS = 2_048;

export function isDeviceModelProvider(provider: string | null | undefined): boolean {
  return provider === DEVICE_MODEL_PROVIDER_ID;
}

/** Ids come from Desktop's pinned catalog; the server only checks their shape. */
export function isDeviceModelId(id: string | null | undefined): id is string {
  return typeof id === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(id);
}

/**
 * Light mode: the built-in tools a local model is offered. Small models stay fast and
 * reliable with a short prompt and a handful of tools; everything else is left out.
 */
export const DEVICE_MODEL_TOOL_NAMES: ReadonlySet<string> = new Set([
  "ask_user",
  "remember",
  "read_file",
  "write_file",
  "edit_file",
  "list_files",
  "attach_file",
  "shell",
  "web_search",
  "web_fetch",
]);

/** Shown when a turn with a local model cannot reach the PC that runs it. */
export const DEVICE_MODEL_OFFLINE_ERROR =
  "This Mico uses a model that runs on your PC. Open Mycellios Desktop on that PC to continue, or choose another model.";
