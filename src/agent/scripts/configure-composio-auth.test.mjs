import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, client, planToolkit, validatePlan } from "./configure-composio-auth.mjs";

test("preserves existing and disabled configs and requires actual metadata for custom auth", () => {
  assert.equal(
    planToolkit({ slug: "twitter" }, [{ toolkit: { slug: "twitter" }, status: "DISABLED" }]).state,
    "preserve_existing",
  );
  assert.equal(
    planToolkit({ slug: "twitter" }, [], {
      auth_config_details: [
        {
          mode: "OAUTH2",
          fields: { auth_config_creation: { required: [{ name: "client_secret" }] } },
        },
      ],
    }).state,
    "operator_credentials_required",
  );
  assert.equal(planToolkit({ slug: "key-app" }, []).state, "operator_credentials_required");
  assert.equal(planToolkit({ slug: "public", no_auth: true }, []).state, "no_auth");
});

test("key templates leave credentials for each user at connect time", () => {
  const result = planToolkit({ slug: "key-app", name: "Key App" }, [], {
    auth_config_details: [{ mode: "API_KEY", fields: { auth_config_creation: { required: [] } } }],
  });
  assert.equal(result.state, "create");
  assert.deepEqual(result.auth_config.credentials, {});
  assert.equal(result.auth_config.authScheme, "API_KEY");
  assert.equal("shared_credentials" in result.auth_config, false);
});

test("does not retry uncertain creation or replace a concurrently created config", async () => {
  const calls = [];
  const results = await apply(
    async (path, query, body) => {
      calls.push({ path, query, body });
      if (!body)
        return {
          items: query.toolkit_slug === "existing" ? [{ toolkit: { slug: "existing" } }] : [],
        };
      throw new Error("timeout after remote creation");
    },
    ["existing", "new"].map((slug) => ({
      slug,
      state: "create",
      auth_config: {
        type: "use_composio_managed_auth",
        name: slug,
        is_enabled_for_tool_router: true,
      },
    })),
  );
  assert.deepEqual(results, [
    { slug: "existing", state: "preserved_existing" },
    { slug: "new", state: "creation_unconfirmed" },
  ]);
  assert.equal(calls.filter((call) => call.body).length, 1);
});

test("refuses shared keys, scope changes and foreign destinations before any request", async () => {
  const template = {
    slug: "key-app",
    state: "create",
    auth_config: {
      type: "use_custom_auth",
      authScheme: "API_KEY",
      name: "Key App",
      credentials: {},
      is_enabled_for_tool_router: true,
    },
  };
  assert.doesNotThrow(() => validatePlan([template]));
  assert.throws(
    () =>
      validatePlan([
        {
          ...template,
          auth_config: { ...template.auth_config, credentials: { api_key: "private-key" } },
        },
      ]),
    /Shared credentials/,
  );
  assert.throws(
    () =>
      validatePlan([{ ...template, auth_config: { ...template.auth_config, scopes: ["admin"] } }]),
    /Unsupported/,
  );
  let requests = 0;
  const api = client("private-key", async () => {
    requests++;
    return { ok: true, json: async () => ({}) };
  });
  await assert.rejects(api("https://other.example.test/api/v3/auth_configs"), /Unsupported/);
  await assert.rejects(api("/api/v3/toolkits", {}, {}), /Unsupported/);
  assert.equal(requests, 0);
});

test("recognizes a created template from the actual provider response envelope", async () => {
  const result = await apply(
    async (_path, _query, body) => (body ? { auth_config: { id: "auth-created" } } : { items: [] }),
    [
      {
        slug: "key-app",
        state: "create",
        auth_config: {
          type: "use_composio_managed_auth",
          name: "Key App",
          is_enabled_for_tool_router: true,
        },
      },
    ],
  );
  assert.deepEqual(result, [{ slug: "key-app", state: "created" }]);
});

test("never includes a provider error body or credential in thrown errors", async () => {
  const request = client("private-key", async () => ({
    ok: false,
    status: 403,
    json: async () => ({ secret: "private-key" }),
  }));
  await assert.rejects(request("/api/v3/auth_configs"), {
    message: "Metadata operation failed (HTTP 403)",
  });
});
