import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const API = "https://backend.composio.dev";
const USER_SUPPLIED = new Set(["API_KEY", "BEARER_TOKEN", "BASIC", "DCR_OAUTH", "NO_AUTH"]);

export function planToolkit(toolkit, configs, details) {
  const existing = configs.filter(
    (config) => config.toolkit?.slug?.toLowerCase() === toolkit.slug.toLowerCase(),
  );
  if (existing.length) return { slug: toolkit.slug, state: "preserve_existing" };
  if (toolkit.no_auth === true) return { slug: toolkit.slug, state: "no_auth" };
  if (toolkit.composio_managed_auth_schemes?.length)
    return {
      slug: toolkit.slug,
      state: "create",
      auth_config: {
        type: "use_composio_managed_auth",
        name: toolkit.name,
        is_enabled_for_tool_router: true,
      },
    };
  const auth = details?.auth_config_details ?? [];
  const scheme = auth.find(
    (item) =>
      USER_SUPPLIED.has(item.mode) &&
      Array.isArray(item.fields?.auth_config_creation?.required) &&
      item.fields.auth_config_creation.required.every(
        (field) => field.default != null && field.default !== "",
      ),
  );
  if (scheme)
    return {
      slug: toolkit.slug,
      state: "create",
      auth_config: {
        type: "use_custom_auth",
        authScheme: scheme.mode,
        name: toolkit.name,
        credentials: {},
        is_enabled_for_tool_router: true,
      },
    };
  return {
    slug: toolkit.slug,
    state: "operator_credentials_required",
    requirements: auth.map((item) => ({
      scheme: item.mode,
      fields: (item.fields?.auth_config_creation?.required ?? [])
        .filter((field) => field.default == null || field.default === "")
        .map((field) => field.name),
    })),
  };
}

export function client(apiKey, request = fetch) {
  return async (path, params = {}, body) => {
    const url = new URL(path, API);
    if (
      url.origin !== API ||
      !(
        url.pathname === "/api/v3/auth_configs" ||
        url.pathname === "/api/v3/toolkits" ||
        url.pathname.startsWith("/api/v3/toolkits/")
      )
    ) {
      throw new Error("Unsupported metadata endpoint");
    }
    if (body && url.pathname !== "/api/v3/auth_configs")
      throw new Error("Unsupported configuration operation");
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const response = await request(url, {
      method: body ? "POST" : "GET",
      headers: {
        "x-api-key": apiKey,
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    // Provider bodies can include secrets. Never print them, even on failure.
    if (!response.ok) throw new Error(`Metadata operation failed (HTTP ${response.status})`);
    return response.json();
  };
}

export async function listAll(api, path, params) {
  const items = [];
  const seen = new Set();
  let cursor;
  for (let page = 0; page < 20; page++) {
    const result = await api(path, { ...params, ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(result.items)) throw new Error("Invalid metadata response");
    items.push(...result.items);
    if (!result.next_cursor) {
      if (result.total_items > items.length) throw new Error("Incomplete metadata response");
      return items;
    }
    if (typeof result.next_cursor !== "string" || seen.has(result.next_cursor))
      throw new Error("Invalid metadata cursor");
    cursor = result.next_cursor;
    seen.add(cursor);
  }
  throw new Error("Metadata pagination limit reached");
}

export async function prepare(api, onProgress = () => {}) {
  const [toolkits, configs] = await Promise.all([
    listAll(api, "/api/v3/toolkits", { limit: 1000, managed_by: "all" }),
    listAll(api, "/api/v3/auth_configs", { limit: 200, show_disabled: true }),
  ]);
  const plan = [];
  // Small batches keep metadata reads bounded; no sessions, accounts or tools are opened.
  for (let start = 0; start < toolkits.length; start += 4) {
    await Promise.all(
      toolkits.slice(start, start + 4).map(async (toolkit) => {
        try {
          let item = planToolkit(toolkit, configs);
          if (item.state === "operator_credentials_required") {
            item = planToolkit(
              toolkit,
              configs,
              await api(`/api/v3/toolkits/${encodeURIComponent(toolkit.slug)}`),
            );
          }
          plan.push(item);
        } catch {
          plan.push({ slug: toolkit.slug, state: "metadata_unavailable" });
        }
      }),
    );
    if (start % 100 === 0) onProgress(plan.length, toolkits.length);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return plan.sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function apply(api, plan, onProgress = () => {}) {
  validatePlan(plan);
  const results = [];
  const candidates = plan.filter((entry) => entry.state === "create");
  async function configure(entry) {
    try {
      const current = await listAll(api, "/api/v3/auth_configs", {
        toolkit_slug: entry.slug,
        limit: 200,
        show_disabled: true,
      });
      if (
        current.some((config) => config.toolkit?.slug?.toLowerCase() === entry.slug.toLowerCase())
      ) {
        results.push({ slug: entry.slug, state: "preserved_existing" });
        return;
      }
      // Never import shared credentials, change scopes, enable disabled configs or retry POSTs.
      const created = await api(
        "/api/v3/auth_configs",
        {},
        { toolkit: { slug: entry.slug }, auth_config: entry.auth_config },
      );
      results.push({
        slug: entry.slug,
        state: created.auth_config?.id ? "created" : "creation_unconfirmed",
      });
    } catch {
      results.push({ slug: entry.slug, state: "creation_unconfirmed" });
    }
  }
  for (let start = 0; start < candidates.length; start += 4) {
    await Promise.all(candidates.slice(start, start + 4).map(configure));
    onProgress(results.length);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return results;
}

export function validatePlan(plan) {
  if (!Array.isArray(plan) || plan.length > 2000) throw new Error("Invalid configuration plan");
  const slugs = new Set();
  for (const item of plan) {
    if (
      !item ||
      typeof item.slug !== "string" ||
      !/^[a-z0-9_-]+$/i.test(item.slug) ||
      slugs.has(item.slug)
    )
      throw new Error("Invalid toolkit plan");
    slugs.add(item.slug);
    if (item.state !== "create") continue;
    const config = item.auth_config;
    if (
      !config ||
      typeof config.name !== "string" ||
      config.name.length > 512 ||
      config.is_enabled_for_tool_router !== true
    )
      throw new Error("Invalid auth template");
    const custom = config.type === "use_custom_auth";
    const allowed = new Set(
      custom
        ? ["type", "name", "is_enabled_for_tool_router", "authScheme", "credentials"]
        : ["type", "name", "is_enabled_for_tool_router"],
    );
    if (
      (!custom && config.type !== "use_composio_managed_auth") ||
      Object.keys(config).some((key) => !allowed.has(key))
    )
      throw new Error("Unsupported auth template");
    if (
      custom &&
      (!USER_SUPPLIED.has(config.authScheme) ||
        !config.credentials ||
        Array.isArray(config.credentials) ||
        Object.keys(config.credentials).length)
    )
      throw new Error("Shared credentials are not allowed");
  }
}

async function main() {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: This operator CLI is outside Turbo and never cached.
  const key = process.env.COMPOSIO_API_KEY;
  const args = process.argv.slice(2);
  const output = args.find((arg) => arg.startsWith("--output="))?.slice(9);
  if (!key || !output) throw new Error("COMPOSIO_API_KEY and --output are required");
  const api = client(key);
  const planFile = args.find((arg) => arg.startsWith("--plan="))?.slice(7);
  const planHash = args.find((arg) => arg.startsWith("--plan-sha256="))?.slice(14);
  let plan;
  if (args.includes("--apply")) {
    if (!planFile || !/^[a-f0-9]{64}$/.test(planHash ?? ""))
      throw new Error("A reviewed plan and SHA256 are required");
    const bytes = await readFile(planFile);
    if (createHash("sha256").update(bytes).digest("hex") !== planHash)
      throw new Error("The reviewed plan changed");
    plan = JSON.parse(bytes.toString("utf8")).plan;
    validatePlan(plan);
  } else
    plan = await prepare(api, (done, total) =>
      console.log(JSON.stringify({ phase: "metadata", done, total })),
    );
  const counts = {};
  for (const item of plan) counts[item.state] = (counts[item.state] ?? 0) + 1;
  const results = args.includes("--apply")
    ? await apply(api, plan, (done) => {
        if (done % 100 === 0 || done === plan.filter((item) => item.state === "create").length)
          console.log(JSON.stringify({ phase: "configuration", done }));
      })
    : [];
  await writeFile(
    output,
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        applied: args.includes("--apply"),
        counts,
        plan,
        results,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      counts,
      applied: args.includes("--apply"),
      created: results.filter((item) => item.state === "created").length,
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error(
      "Integration configuration failed; no credential or provider response was logged.",
    );
    process.exitCode = 1;
  });
}
