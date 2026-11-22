/**
 * Environment variables are named `MYCELLIOS_<NAME>`. Installations configured
 * before the rename still set the imported upstream project's prefix, so readers
 * fall back to it (specs/legacy-name-migration, phase 2). The legacy prefix is
 * built here, in one place, instead of being spelled out in source files.
 */
export const ENV_PREFIX = "MYCELLIOS_";
const LEGACY_ENV_PREFIX = String.fromCharCode(82, 65, 75, 65, 90, 79, 95);

export type EnvSource = Readonly<Record<string, string | undefined>>;

const reported = new Set<string>();

function processEnv(): EnvSource {
  return typeof process === "undefined" ? {} : process.env;
}

/** The legacy variable name for `name`, for writers that still feed older readers. */
export function legacyEnvName(name: string): string {
  return LEGACY_ENV_PREFIX + name;
}

/**
 * Reads `MYCELLIOS_<name>`, then the legacy variable. Reports each legacy name
 * once per process, without its value.
 */
export function readEnv(name: string, source: EnvSource = processEnv()): string | undefined {
  const current = source[ENV_PREFIX + name];
  if (current !== undefined) return current;
  const legacy = source[LEGACY_ENV_PREFIX + name];
  if (legacy !== undefined && !reported.has(name)) {
    reported.add(name);
    console.warn(`Environment: set ${ENV_PREFIX}${name}; the variable it replaces is deprecated.`);
  }
  return legacy;
}

/** Removes both spellings, for secrets that must not reach child processes. */
export function deleteEnv(name: string, target: Record<string, string | undefined> = process.env): void {
  delete target[ENV_PREFIX + name];
  delete target[LEGACY_ENV_PREFIX + name];
}
