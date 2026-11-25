import type {
  AdapterContext,
  BrowserActKind,
  BrowserActStep,
  BrowserProvider,
  BrowserScrollDirection,
  BrowserWaitCondition,
  ComputerRef,
} from "@mycellios/adapter-kit";
import {
  MAX_BROWSER_SNAPSHOT_PARTS,
  MAX_BROWSER_UPLOAD_FILES,
  MAX_BROWSER_WAIT_SECONDS,
} from "@mycellios/adapter-kit";
import { getLogger } from "@mycellios/logging";
import type { LoginField } from "./bot-secrets.js";
import { redactConnectorPayload } from "./connector-safety.js";

const MAX_BROWSER_ACTIONS = 24;
/** The action kinds `browser_act` takes, as its tool schema lists them. */
export const BROWSER_ACT_KINDS = [
  "click",
  "fill",
  "type",
  "upload",
  "fill_secret",
  "press",
  "scroll",
  "hover",
  "wait",
  "dialog",
] as const;
/** Keys `press` takes, alone or after modifiers (Shift+Tab, Control+A); also a letter or digit. */
export const BROWSER_PRESS_KEYS = [
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
] as const;
const PRESS_MODIFIERS = new Map([
  ["alt", "Alt"],
  ["control", "Control"],
  ["ctrl", "Control"],
  ["meta", "Meta"],
  ["cmd", "Meta"],
  ["shift", "Shift"],
]);
const PRESS_KEYS = new Map(
  [...BROWSER_PRESS_KEYS, "Esc"].map((key) => [key.toLowerCase(), key === "Esc" ? "Escape" : key]),
);
const SCROLL_DIRECTIONS: readonly BrowserScrollDirection[] = ["up", "down", "left", "right"];
const WAIT_CONDITIONS: readonly BrowserWaitCondition[] = ["text", "gone", "url", "quiet"];
const MAX_WAIT_TEXT = 500;
const MAX_PROMPT_TEXT = 10_000;
/** Steps that act on one element a snapshot named; press and scroll may name one too. */
const REF_KINDS = new Set(["click", "fill", "type", "upload", "fill_secret", "hover"]);
const NAVIGATE_URL_REQUIRED = "An HTTP(S) URL without embedded credentials is required";

/** Fills a saved website login by name; the model never supplies or sees the value. */
export type SecretFillStep = {
  kind: "fill_secret";
  ref: string;
  secret: string;
  field: LoginField;
};
export type BrowserActInput = BrowserActStep | SecretFillStep;
/** desktopTools: the run also has computer_act, so a page-tool failure can fall back to it. */
export type PageToolOptions = { desktopTools?: boolean };
export type ResolveSecretFill = (
  step: SecretFillStep,
) => Promise<{ text: string; origin: string } | { error: string }>;

/**
 * A browser tool call turned down before anything ran, such as a missing argument. It is settled:
 * nothing on the page changed, so the bot fixes the call instead of turning to desktop tools.
 */
class BrowserToolInputError extends Error {}

function refusedInput(message: string) {
  return { ok: false, uncertain: false, error: message };
}

export async function browserNavigateFromTool(
  browser: BrowserProvider,
  computer: ComputerRef,
  context: AdapterContext,
  args: Record<string, unknown>,
  options: PageToolOptions = {},
) {
  const url = String(args.url ?? "").trim();
  if (!URL.canParse(url)) return refusedInput(NAVIGATE_URL_REQUIRED);
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) {
    return refusedInput(NAVIGATE_URL_REQUIRED);
  }
  try {
    const result = await browser.navigate(computer, { url, signal: context.signal }, context);
    if (result.fallback || result.error || result.dialog || typeof result.tree === "string") {
      return formatBrowserResult(result, options);
    }
    // The page's first snapshot comes with the navigation, saving the model a call. A browser that
    // did not take it with the navigation (an older computer image) is asked for it now; without
    // it, the navigation's own result stands and the model can take a snapshot itself.
    let snapshot: Awaited<ReturnType<BrowserProvider["snapshot"]>> | undefined;
    try {
      snapshot = await browser.snapshot(computer, { signal: context.signal }, context);
    } catch {
      context.signal.throwIfAborted();
    }
    return formatBrowserResult(
      snapshot && !snapshot.fallback && !snapshot.error ? { ...result, ...snapshot } : result,
      options,
    );
  } catch (error) {
    context.signal.throwIfAborted();
    return formatBrowserResult(
      { error: error instanceof Error ? error.message : String(error), fallback: "computer_act" },
      options,
    );
  }
}

export async function browserSnapshotFromTool(
  browser: BrowserProvider,
  computer: ComputerRef,
  context: AdapterContext,
  args: Record<string, unknown>,
  options: PageToolOptions = {},
) {
  const from = args.from ?? 0;
  if (
    typeof from !== "number" ||
    !Number.isInteger(from) ||
    from < 0 ||
    from >= MAX_BROWSER_SNAPSHOT_PARTS
  ) {
    return refusedInput(
      `browser_snapshot from must be a part number from 0 to ${MAX_BROWSER_SNAPSHOT_PARTS - 1}, as next names it`,
    );
  }
  try {
    const result = await browser.snapshot(
      computer,
      { ...(from > 0 ? { from } : {}), signal: context.signal },
      context,
    );
    return formatBrowserResult(result, options);
  } catch (error) {
    context.signal.throwIfAborted();
    return formatBrowserResult(
      { error: error instanceof Error ? error.message : String(error), fallback: "computer_act" },
      options,
    );
  }
}

export async function browserActFromTool(
  browser: BrowserProvider,
  computer: ComputerRef,
  context: AdapterContext,
  args: Record<string, unknown>,
  options: PageToolOptions & {
    resolveSecretFill?: ResolveSecretFill;
    redactions?: () => string[];
    /** Maps a bot-facing workspace path to its path in the computer's home. */
    resolveUploadPath?: (path: string) => string;
    /** Trusted upload roots relative to the computer home, set by the executor. */
    uploadRoots?: string[];
  } = {},
) {
  try {
    const actions: BrowserActStep[] = [];
    // Resolve every saved login before acting, so a missing one cannot leave a half-filled form.
    for (const step of parseBrowserActions(args.actions)) {
      if (step.kind === "upload") {
        const resolve = options.resolveUploadPath ?? ((path: string) => path);
        let paths: string[];
        try {
          paths = step.paths.map(resolve);
        } catch (error) {
          // A path outside the bot's folder is the call's mistake, settled before anything runs.
          throw new BrowserToolInputError(error instanceof Error ? error.message : String(error));
        }
        actions.push({
          ...step,
          paths,
          ...(options.uploadRoots ? { roots: options.uploadRoots } : {}),
        });
        continue;
      }
      if (step.kind !== "fill_secret") {
        actions.push(step);
        continue;
      }
      let resolved: Awaited<ReturnType<ResolveSecretFill>>;
      try {
        resolved = options.resolveSecretFill
          ? await options.resolveSecretFill(step)
          : { error: "Saved logins are unavailable here." };
      } catch (error) {
        context.signal.throwIfAborted();
        // A stored login that can't be read may quote its own text in the error, so neither the
        // bot nor the log gets the message: only that it failed, and how.
        getLogger().warn("saved login could not be loaded for a fill", {
          errorName: error instanceof Error ? error.name : typeof error,
        });
        return { ...refusedInput("This saved login could not be loaded."), completed: 0 };
      }
      if ("error" in resolved) return { ...refusedInput(resolved.error), completed: 0 };
      actions.push({
        kind: "fill",
        ref: step.ref,
        text: resolved.text,
        origin: resolved.origin,
        field: step.field,
      });
    }
    const result = await browser.act(computer, { actions, signal: context.signal }, context);
    return redactConnectorPayload(
      formatBrowserResult(result, options),
      options.redactions?.() ?? [],
    );
  } catch (error) {
    context.signal.throwIfAborted();
    if (error instanceof BrowserToolInputError)
      return { ...refusedInput(error.message), completed: 0 };
    return formatBrowserResult(
      {
        ok: false,
        uncertain: true,
        error: error instanceof Error ? error.message : String(error),
        fallback: "computer_act",
      },
      options,
    );
  }
}

export function parseBrowserActions(value: unknown): BrowserActInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BrowserToolInputError("browser_act requires at least one action");
  }
  if (value.length > MAX_BROWSER_ACTIONS) {
    throw new BrowserToolInputError(`browser_act accepts at most ${MAX_BROWSER_ACTIONS} actions`);
  }
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object") {
      throw new BrowserToolInputError(`browser_act action ${index} must be an object`);
    }
    const action = raw as Record<string, unknown>;
    const kind = String(action.kind ?? "") as BrowserActKind | "fill_secret";
    if (!(BROWSER_ACT_KINDS as readonly string[]).includes(kind)) {
      throw new BrowserToolInputError(
        `browser_act action ${index} needs kind: ${BROWSER_ACT_KINDS.join(", ")}`,
      );
    }
    const ref = String(action.ref ?? "").trim();
    if (!ref && REF_KINDS.has(kind)) {
      throw new BrowserToolInputError(`browser_act action ${index} requires ref`);
    }
    if (kind === "press") {
      return { kind, key: parsePressKey(action.key), ...(ref ? { ref } : {}) };
    }
    if (kind === "scroll") {
      const direction = action.direction;
      if (
        direction !== undefined &&
        !SCROLL_DIRECTIONS.includes(direction as BrowserScrollDirection)
      ) {
        throw new BrowserToolInputError(
          `browser_act scroll direction must be ${SCROLL_DIRECTIONS.join(", ")}`,
        );
      }
      if (!ref && direction === undefined) {
        throw new BrowserToolInputError(
          "browser_act scroll needs ref (to bring it into view), direction, or both",
        );
      }
      return {
        kind,
        ...(ref ? { ref } : {}),
        ...(direction !== undefined ? { direction: direction as BrowserScrollDirection } : {}),
      };
    }
    if (kind === "hover") return { kind, ref };
    if (kind === "wait") return parseWait(action);
    if (kind === "dialog") {
      if (typeof action.accept !== "boolean") {
        throw new BrowserToolInputError(
          "browser_act dialog needs accept: true to accept (OK), false to dismiss (Cancel)",
        );
      }
      if (action.text !== undefined && typeof action.text !== "string") {
        throw new BrowserToolInputError("browser_act dialog text must be a string");
      }
      if (typeof action.text === "string" && action.text.length > MAX_PROMPT_TEXT) {
        throw new BrowserToolInputError(
          `browser_act dialog text accepts at most ${MAX_PROMPT_TEXT} characters`,
        );
      }
      return {
        kind,
        accept: action.accept,
        ...(typeof action.text === "string" ? { text: action.text } : {}),
      };
    }
    if (kind === "upload") {
      const paths = Array.isArray(action.paths)
        ? action.paths.map((path) => (typeof path === "string" ? path.trim() : ""))
        : [];
      if (paths.length === 0 || paths.some((path) => !path)) {
        throw new BrowserToolInputError(
          "browser_act upload requires paths: one or more file paths",
        );
      }
      if (paths.length > MAX_BROWSER_UPLOAD_FILES) {
        throw new BrowserToolInputError(
          `browser_act upload accepts at most ${MAX_BROWSER_UPLOAD_FILES} files`,
        );
      }
      return { kind, ref, paths };
    }
    if (kind === "fill_secret") {
      const secret = String(action.secret ?? "").trim();
      const field = action.field;
      if (!secret)
        throw new BrowserToolInputError(
          "browser_act fill_secret needs secret: the name of a login saved with request_secret",
        );
      if (field !== "username" && field !== "password") {
        throw new BrowserToolInputError(
          'browser_act fill_secret needs field: "username" or "password"',
        );
      }
      return { kind, ref, secret, field };
    }
    if (kind === "fill" || kind === "type") {
      if (typeof action.text !== "string") {
        throw new BrowserToolInputError(
          action.secret === undefined && action.field === undefined
            ? `browser_act ${kind} requires text`
            : `browser_act ${kind} requires text; for a saved login use kind "fill_secret"`,
        );
      }
      return { kind, ref, text: String(action.text) };
    }
    return { kind: "click", ref };
  });
}

/** Normalizes a key such as "enter" or "ctrl+shift+tab" to the form the page helper takes. */
function parsePressKey(value: unknown): string {
  const help = `browser_act press needs key: ${BROWSER_PRESS_KEYS.slice(0, 6).join(", ")}, an arrow key, a letter or digit, with modifiers like Shift+Tab or Control+A`;
  if (typeof value !== "string" || !value.trim() || value.length > 40) {
    throw new BrowserToolInputError(help);
  }
  const parts = value.split("+").map((part) => part.trim());
  const name = parts.pop() ?? "";
  const modifiers: string[] = [];
  for (const part of parts) {
    const modifier = PRESS_MODIFIERS.get(part.toLowerCase());
    if (!modifier || modifiers.includes(modifier)) throw new BrowserToolInputError(help);
    modifiers.push(modifier);
  }
  const key = PRESS_KEYS.get(name.toLowerCase()) ?? (/^[A-Za-z0-9]$/.test(name) ? name : undefined);
  if (!key) throw new BrowserToolInputError(help);
  return [...modifiers, key].join("+");
}

function parseWait(action: Record<string, unknown>): BrowserActStep {
  const until = action.until as BrowserWaitCondition;
  if (!WAIT_CONDITIONS.includes(until)) {
    throw new BrowserToolInputError(`browser_act wait needs until: ${WAIT_CONDITIONS.join(", ")}`);
  }
  const text = action.text;
  if (text !== undefined && (typeof text !== "string" || !text.trim())) {
    throw new BrowserToolInputError("browser_act wait text must be non-empty");
  }
  if (typeof text === "string" && text.length > MAX_WAIT_TEXT) {
    throw new BrowserToolInputError(
      `browser_act wait text accepts at most ${MAX_WAIT_TEXT} characters`,
    );
  }
  if ((until === "text" || until === "gone") && text === undefined) {
    throw new BrowserToolInputError(`browser_act wait until ${until} needs text`);
  }
  const timeout = action.timeout;
  if (
    timeout !== undefined &&
    (typeof timeout !== "number" ||
      !Number.isFinite(timeout) ||
      timeout <= 0 ||
      timeout > MAX_BROWSER_WAIT_SECONDS)
  ) {
    throw new BrowserToolInputError(
      `browser_act wait timeout is in seconds, at most ${MAX_BROWSER_WAIT_SECONDS}`,
    );
  }
  return {
    kind: "wait",
    until,
    ...(typeof text === "string" ? { text } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
  };
}

function formatBrowserResult<
  T extends { fallback?: "computer_act"; error?: string; unsupported?: string },
>(result: T, { desktopTools = true }: PageToolOptions) {
  if (result.unsupported) {
    const another = desktopTools
      ? "computer_act or another page step"
      : "another page step, or ask for help with request_takeover";
    return {
      ...result,
      note:
        result.unsupported === "snapshot.from"
          ? desktopTools
            ? "Read the rest of the page by scrolling with computer_act and looking with computer_observe."
            : "Work with the part you have, or ask for help with request_takeover."
          : `Do that step with ${another}. Do not repeat the steps that ran.`,
    };
  }
  if (result.fallback !== "computer_act") return result;
  if (desktopTools) {
    return {
      ...result,
      note: "Page browser could not complete this step. Inspect the current state before continuing with computer_act if available, otherwise request_takeover. Do not replay completed or uncertain actions.",
    };
  }
  // Without desktop tools, pointing at computer_act leaves only request_takeover. A browser
  // that is still starting after the computer woke up usually answers a moment later.
  const { fallback: _fallback, ...rest } = result;
  return {
    ...rest,
    note: "Page browser could not complete this step. The computer or its browser may still be starting, so call browser_snapshot again to check the page. Use request_takeover only if it keeps failing. Do not replay completed or uncertain actions.",
  };
}
