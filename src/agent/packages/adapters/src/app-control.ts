import { z } from "zod";

/**
 * Accessibility-tree control of applications on the user's own PC, through the pinned
 * agent-desktop CLI (specs/desktop-accessibility-control). This module is pure: request
 * validation, CLI argument construction and result shaping. The Desktop host runs it.
 */

export const APP_CONTROL_TOOL_NAMES = ["pc_windows", "pc_snapshot", "pc_act"] as const;
export const APP_CONTROL_READ_TOOL_NAMES = ["pc_windows", "pc_snapshot"] as const;

/** Largest tree returned to the model; larger windows must be narrowed with `root`. */
export const APP_CONTROL_MAX_RESULT_BYTES = 48 * 1024;
/** Largest CLI output read before parsing. */
export const APP_CONTROL_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
export const APP_CONTROL_MAX_TEXT_BYTES = 16 * 1024;
export const APP_CONTROL_TIMEOUT_MS = 20_000;

export const APP_CONTROL_ACTIONS = [
  "click",
  "set_value",
  "clear",
  "select",
  "toggle",
  "check",
  "uncheck",
  "expand",
  "collapse",
  "scroll_to",
  "focus",
] as const;
export type AppControlAction = (typeof APP_CONTROL_ACTIONS)[number];

const REF = /^@[a-z0-9]{4,64}:e\d{1,6}$/;
const WINDOW_ID = /^w-\d{1,20}$/;
const KEY_COMBO = /^(?:(?:ctrl|alt|shift|cmd|win|meta)\+){0,3}[a-z0-9]{1,12}$/;
const appName = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !value.startsWith("-") && !/[\0\r\n]/.test(value), "Invalid application name");

export const appControlRequest = z.discriminatedUnion("op", [
  z.object({ op: z.literal("windows"), app: appName.optional() }),
  z.object({
    op: z.literal("snapshot"),
    windowId: z.string().regex(WINDOW_ID),
    root: z.string().regex(REF).optional(),
    skeleton: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("act"),
    ref: z.string().regex(REF),
    action: z.enum(APP_CONTROL_ACTIONS),
    text: z.string().max(APP_CONTROL_MAX_TEXT_BYTES).optional(),
  }),
  z.object({
    op: z.literal("press"),
    windowId: z.string().regex(WINDOW_ID),
    keys: z.string().regex(KEY_COMBO),
  }),
]);
export type AppControlRequest = z.infer<typeof appControlRequest>;

export type AppControlResult =
  | { ok: true; data: unknown; confirmed?: boolean; note?: string }
  | { ok: false; code: string; error: string; retry?: "safe" | "unsafe"; newSnapshot?: boolean };

/**
 * Applications a Mico must never operate: this app itself, password managers, and system
 * security prompts. Compared case-insensitively against the reported process name.
 */
const FORBIDDEN_APPS = [
  /^mycellios( desktop)?(\.exe)?$/,
  /^electron(\.exe)?$/,
  /^1password(\.exe)?$/,
  /^bitwarden(\.exe)?$/,
  /^keepass(xc)?(\.exe)?$/,
  /^lastpass(\.exe)?$/,
  /^dashlane(\.exe)?$/,
  /^keeper(\.exe)?$/,
  /^credentialuibroker(\.exe)?$/,
  /^consent(\.exe)?$/,
  /^logonui(\.exe)?$/,
  /^lockapp(\.exe)?$/,
  /^securityagent$/,
  /^keychain access$/,
  /^coreautha?$/,
];

export function forbiddenApp(name: unknown): boolean {
  if (typeof name !== "string") return true;
  const normalized = name.trim().toLowerCase();
  return !normalized || FORBIDDEN_APPS.some((pattern) => pattern.test(normalized));
}

const CLI_ACTION: Record<AppControlAction, string> = {
  click: "click",
  set_value: "set-value",
  clear: "clear",
  select: "select",
  toggle: "toggle",
  check: "check",
  uncheck: "uncheck",
  expand: "expand",
  collapse: "collapse",
  scroll_to: "scroll-to",
  focus: "focus",
};

/** Text travels on stdin, never in process arguments. Physical input (--headed) is never used. */
export function appControlInvocation(request: AppControlRequest): { argv: string[]; stdin?: string } {
  switch (request.op) {
    case "windows":
      return { argv: ["list-windows", ...(request.app ? ["--app", request.app] : [])] };
    case "snapshot":
      return {
        argv: [
          "snapshot",
          "--window-id",
          request.windowId,
          "-i",
          "--compact",
          ...(request.root ? ["--root", request.root] : []),
          ...(request.skeleton ? ["--skeleton"] : []),
        ],
      };
    case "press":
      return { argv: ["press", request.keys, "--window-id", request.windowId] };
    case "act": {
      const needsText = request.action === "set_value" || request.action === "select";
      if (needsText && request.text === undefined) throw new AppControlInputError(`${request.action} needs text`);
      if (!needsText && request.text !== undefined) throw new AppControlInputError(`${request.action} takes no text`);
      if (request.action === "select") return { argv: ["select", request.ref, request.text!] };
      return {
        argv: [CLI_ACTION[request.action], request.ref, ...(needsText ? ["--stdin"] : [])],
        ...(needsText ? { stdin: request.text } : {}),
      };
    }
  }
}

export class AppControlInputError extends Error {}

export function snapshotIdOfRef(ref: string): string {
  return ref.slice(1, ref.indexOf(":"));
}

interface Envelope {
  ok?: unknown;
  data?: unknown;
  error?: { code?: unknown; message?: unknown; suggestion?: unknown; recovery?: { requires_fresh_snapshot?: unknown } };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function parseEnvelope(stdout: string): Envelope {
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) throw new Error("agent-desktop returned no result");
  const parsed = JSON.parse(line) as unknown;
  const envelope = record(parsed);
  if (!envelope || typeof envelope.ok !== "boolean") throw new Error("agent-desktop returned an invalid result");
  return envelope as Envelope;
}

const STALE_CODES = new Set(["STALE_REF", "AMBIGUOUS_TARGET", "SNAPSHOT_NOT_FOUND", "INVALID_ARGS"]);

export function failureResult(envelope: Envelope): AppControlResult {
  const code = typeof envelope.error?.code === "string" ? envelope.error.code.slice(0, 64) : "FAILED";
  const message = typeof envelope.error?.message === "string" ? envelope.error.message.slice(0, 600) : "The action failed.";
  const suggestion = typeof envelope.error?.suggestion === "string" ? ` ${envelope.error.suggestion.slice(0, 400)}` : "";
  const disposition = record(record(envelope.error)?.disposition);
  const retry = disposition?.retry === "safe" ? "safe" : "unsafe";
  const newSnapshot = STALE_CODES.has(code) || envelope.error?.recovery?.requires_fresh_snapshot === true;
  return { ok: false, code, error: `${message}${suggestion}`, retry, ...(newSnapshot ? { newSnapshot: true } : {}) };
}

/**
 * Only a verified delivery whose application commit was not reported unverified counts as done.
 * Anything else asks the model to read the window again before relying on it.
 */
export function actionResult(envelope: Envelope): AppControlResult {
  const data = record(envelope.data);
  const disposition = record(data?.disposition);
  const details = record(data?.details);
  const delivery = typeof disposition?.delivery === "string" ? disposition.delivery : "unknown";
  const commit = typeof details?.application_commit === "string" ? details.application_commit : undefined;
  const confirmed = delivery === "delivered_verified" && commit !== "not_verified";
  return {
    ok: true,
    confirmed,
    data: { delivery, ...(commit ? { applicationCommit: commit } : {}) },
    ...(confirmed
      ? {}
      : {
          note: "The application did not confirm this change. Take a new pc_snapshot and check the result before continuing or reporting success.",
        }),
  };
}

export function boundedTreeResult(data: unknown): AppControlResult {
  const text = JSON.stringify(data);
  if (Buffer.byteLength(text) > APP_CONTROL_MAX_RESULT_BYTES)
    return {
      ok: false,
      code: "TOO_LARGE",
      error:
        "This window has too many elements to return at once. Call pc_snapshot with skeleton:true, then pass one region's ref as root.",
    };
  return { ok: true, data };
}
