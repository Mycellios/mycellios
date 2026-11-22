import { liveModelCatalogEnabled } from "./pi-live-cache.js";

/**
 * models.dev: the public catalog of every provider's models, with release dates, families,
 * limits, prices and capabilities. Pi's bundled registry is generated from the same source, so
 * reading it at run time keeps the model list current between Mycellios releases, as an
 * auto-updated Pi or OpenCode keeps the reference app's list current. Only data is read; nothing runs.
 */
export const MODELS_DEV_ENDPOINT = "https://models.dev/api.json";

const FETCH_TIMEOUT_MS = 20_000;
const MAX_BYTES = 24 * 1024 * 1024;
const MAX_SERVICES = 2_000;
const MAX_MODELS_PER_SERVICE = 5_000;
const TTL_MS = 6 * 60 * 60_000;
const FAILURE_TTL_MS = 10 * 60_000;
/** A last-good copy older than this is not trusted any more: removed models must disappear. */
const STALE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const DEFAULT_WAIT_MS = 1_500;

export type ModelsDevModel = {
  service: string;
  id: string;
  name: string;
  /** The models.dev family, such as `claude-sonnet`; empty when the catalog names none. */
  family: string;
  /** `YYYY-MM-DD`, so the text sorts as the date does. */
  releaseDate?: string;
  /** Not deprecated, writes text and calls tools: an agent can work with it. */
  agentReady: boolean;
  reasoning: boolean;
  images: boolean;
  contextWindow?: number;
  maxOutput?: number;
  /** USD per million tokens, the unit of Pi's model costs. */
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

/** A release that several services share, merged by `modelsDevName`. */
export type ModelsDevRelease = Pick<ModelsDevModel, "family" | "releaseDate" | "agentReady">;

export class ModelsDevSnapshot {
  private readonly names = new Map<string, ModelsDevRelease & { model: ModelsDevModel }>();
  constructor(private readonly services: ReadonlyMap<string, ReadonlyMap<string, ModelsDevModel>>) {
    for (const models of services.values()) {
      for (const model of models.values()) {
        const name = modelsDevName(model.id);
        const known = this.names.get(name);
        if (!known) {
          this.names.set(name, { ...model, model });
          continue;
        }
        // The first release date across services, agent-ready when any service has it so.
        const earlier =
          model.releaseDate && (!known.releaseDate || model.releaseDate < known.releaseDate)
            ? model.releaseDate
            : known.releaseDate;
        this.names.set(name, {
          ...(earlier ? { releaseDate: earlier } : {}),
          family: known.family || model.family,
          agentReady: known.agentReady || model.agentReady,
          model: known.model,
        });
      }
    }
  }

  knowsService(service: string): boolean {
    return this.services.has(service);
  }

  model(service: string, id: string): ModelsDevModel | undefined {
    return this.services.get(service)?.get(id);
  }

  serviceModels(service: string): ModelsDevModel[] {
    return [...(this.services.get(service)?.values() ?? [])];
  }

  /** The release of a model name that services share, such as `gpt-6.1-sol`. */
  releaseByName(id: string): ModelsDevRelease | undefined {
    const found = this.names.get(modelsDevName(id));
    return found
      ? {
          family: found.family,
          agentReady: found.agentReady,
          ...(found.releaseDate ? { releaseDate: found.releaseDate } : {}),
        }
      : undefined;
  }

  /** Any service's details for a model name; the first service that listed it wins. */
  modelByName(id: string): ModelsDevModel | undefined {
    return this.names.get(modelsDevName(id))?.model;
  }
}

/**
 * The last part of a model id, in lower case, with a dot read as a dash:
 * `openai/gpt-6.1-sol` and `gpt-6-1-sol` both give `gpt-6-1-sol`.
 */
export function modelsDevName(id: string): string {
  return id
    .slice(id.lastIndexOf("/") + 1)
    .toLowerCase()
    .replaceAll(".", "-");
}

const ID = /^[\x21-\x7e]{1,256}$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function boundedText(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length <= max ? value.trim() : undefined;
}

function releaseDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value.trim());
  if (!match) return undefined;
  const date = `${match[1]}-${match[2]}-${match[3] ?? "01"}`;
  return Number.isNaN(Date.parse(date)) ? undefined : date;
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 0xffffffff
    ? value
    : undefined;
}

function price(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1e6
    ? value
    : undefined;
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.length <= 32 && value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;
}

function parseModel(service: string, id: string, value: unknown): ModelsDevModel | undefined {
  const details = record(value);
  if (!details || !ID.test(id)) return undefined;
  const modalities = record(details.modalities);
  const input = strings(modalities?.input);
  const output = strings(modalities?.output);
  // A model with no modalities in the catalog counts as a text model.
  const writesText = output ? output.includes("text") : true;
  const limit = record(details.limit);
  const contextWindow = positiveInt(limit?.context);
  const maxOutput = positiveInt(limit?.output);
  const costs = record(details.cost);
  const costInput = price(costs?.input);
  const costOutput = price(costs?.output);
  const date = releaseDate(details.release_date);
  return {
    service,
    id,
    name: boundedText(details.name, 200) || id,
    family: boundedText(details.family, 100) ?? "",
    ...(date ? { releaseDate: date } : {}),
    agentReady: details.status !== "deprecated" && details.tool_call !== false && writesText,
    reasoning: details.reasoning === true,
    images: Boolean(input?.includes("image")),
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxOutput && (!contextWindow || maxOutput < contextWindow) ? { maxOutput } : {}),
    ...(costInput !== undefined && costOutput !== undefined
      ? {
          cost: {
            input: costInput,
            output: costOutput,
            cacheRead: price(costs?.cache_read) ?? 0,
            cacheWrite: price(costs?.cache_write) ?? 0,
          },
        }
      : {}),
  };
}

/** Parse `api.json`. Bad entries are skipped; a payload with no usable service is rejected. */
export function parseModelsDev(payload: unknown): ModelsDevSnapshot | undefined {
  const root = record(payload);
  if (!root) return undefined;
  const services = new Map<string, Map<string, ModelsDevModel>>();
  for (const [service, value] of Object.entries(root).slice(0, MAX_SERVICES)) {
    const models = record(record(value)?.models);
    if (!models || !ID.test(service)) continue;
    const parsed = new Map<string, ModelsDevModel>();
    for (const [id, details] of Object.entries(models).slice(0, MAX_MODELS_PER_SERVICE)) {
      const model = parseModel(service, id, details);
      if (model) parsed.set(id, model);
    }
    if (parsed.size) services.set(service, parsed);
  }
  return services.size ? new ModelsDevSnapshot(services) : undefined;
}

async function readBounded(response: Response): Promise<string | undefined> {
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch {
    return undefined;
  }
}

/** GET models.dev without credentials; undefined on any failure. */
export async function fetchModelsDev(
  fetchImpl: typeof fetch = fetch,
): Promise<ModelsDevSnapshot | undefined> {
  let response: Response;
  try {
    response = await fetchImpl(MODELS_DEV_ENDPOINT, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return undefined;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  const text = await readBounded(response);
  if (text === undefined) return undefined;
  try {
    return parseModelsDev(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/**
 * One process-wide models.dev copy. `current()` never waits or fetches, so synchronous model
 * resolution can use it; `read()` refreshes it in the background and can wait a bounded time.
 * A failed refresh keeps the last good copy until it is `STALE_MAX_AGE_MS` old.
 */
export class ModelsDevCatalog {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly enabledOverride: boolean | undefined;
  private readonly ttlMs: number;
  private readonly failureTtlMs: number;
  private readonly staleMaxAgeMs: number;
  private copy: { snapshot: ModelsDevSnapshot; fetchedAt: number } | undefined;
  private nextRefreshAt = 0;
  private inflight: Promise<ModelsDevSnapshot | undefined> | undefined;

  constructor(
    opts: {
      enabled?: boolean;
      fetch?: typeof fetch;
      now?: () => number;
      ttlMs?: number;
      failureTtlMs?: number;
      staleMaxAgeMs?: number;
    } = {},
  ) {
    this.enabledOverride = opts.enabled;
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? TTL_MS;
    this.failureTtlMs = opts.failureTtlMs ?? FAILURE_TTL_MS;
    this.staleMaxAgeMs = opts.staleMaxAgeMs ?? STALE_MAX_AGE_MS;
  }

  private get enabled(): boolean {
    return this.enabledOverride ?? liveModelCatalogEnabled();
  }

  /** The trusted copy, if any; never fetches. With live catalogs off, only an installed copy exists. */
  current(): ModelsDevSnapshot | undefined {
    if (!this.copy) return undefined;
    return this.copy.fetchedAt + this.staleMaxAgeMs > this.now() ? this.copy.snapshot : undefined;
  }

  /** Refresh when due, waiting at most `waitMs` for a copy when none is trusted yet. */
  async read(waitMs = DEFAULT_WAIT_MS): Promise<ModelsDevSnapshot | undefined> {
    if (!this.enabled) return this.current();
    if (this.now() >= this.nextRefreshAt && !this.inflight) {
      this.inflight = fetchModelsDev(this.fetchImpl)
        .catch(() => undefined)
        .then((snapshot) => {
          const now = this.now();
          if (snapshot) this.copy = { snapshot, fetchedAt: now };
          this.nextRefreshAt = now + (snapshot ? this.ttlMs : this.failureTtlMs);
          return this.current();
        })
        .finally(() => {
          this.inflight = undefined;
        });
    }
    const trusted = this.current();
    if (trusted || !this.inflight || waitMs <= 0) return trusted;
    const pending = this.inflight;
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(this.current()), waitMs);
      void pending.then((snapshot) => {
        clearTimeout(timer);
        resolve(snapshot);
      });
    });
  }

  /** Install a parsed copy directly, for offline tests and fixtures. */
  install(snapshot: ModelsDevSnapshot | undefined): void {
    this.copy = snapshot ? { snapshot, fetchedAt: this.now() } : undefined;
    this.nextRefreshAt = snapshot ? this.now() + this.ttlMs : 0;
  }
}

export const modelsDevCatalog = new ModelsDevCatalog();
