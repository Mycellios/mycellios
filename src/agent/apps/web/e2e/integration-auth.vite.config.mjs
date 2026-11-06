import { fileURLToPath } from "node:url";
import { lingui } from "@lingui/vite-plugin";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { workspaceViteAliases } from "../../desktop/scripts/workspace-aliases.mjs";

const agent = fileURLToPath(new URL("../../../", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/integration-auth/", import.meta.url));

function fixtureServer() {
  let connected = false;
  let externalConnected = false;
  let readinessReads = 0;
  const catalog = ["twitter", "gmail", "googlecontacts", "tiktok"].map((slug) => ({
    connectorId: "composio",
    slug,
    name: {
      twitter: "X (Twitter)",
      gmail: "Gmail",
      googlecontacts: "Google Contacts",
      tiktok: "TikTok",
    }[slug],
    logo: null,
    connected: false,
    noAuth: false,
    availability: ["googlecontacts", "tiktok"].includes(slug) ? "coming_soon" : "available",
  }));
  const connection = {
    id: "fixture-gmail",
    connectorId: "composio",
    provider: "gmail",
    displayName: "Gmail",
    status: "connected",
    capabilities: [],
    createdAt: "2026-11-04T00:00:00Z",
  };
  const externalConnection = {
    ...connection,
    id: "fixture-twitter",
    provider: "twitter",
    displayName: "X (Twitter)",
  };
  let accountRows = [
    { ...externalConnection, id: "fixture-personal", identity: { label: "@forest_fixture" } },
    {
      ...externalConnection,
      id: "fixture-team",
      displayName: "Equipo",
      identity: { label: "@mycelium_team" },
    },
    { ...externalConnection, id: "fixture-pending", status: "pending", identity: null },
  ];
  return async (req, res, next) => {
    const path = (req.url ?? "").split("?")[0];
    if (!path.startsWith("/rpc/")) return next();
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    const input = raw ? JSON.parse(raw).json : null;
    const name = path.slice(5);
    const external = new URL(req.headers.referer ?? "http://localhost/").searchParams.has(
      "external",
    );
    const accountMode = new URL(req.headers.referer ?? "http://localhost/").searchParams.has(
      "accounts",
    );
    const params = new URL(req.headers.referer ?? "http://localhost/").searchParams;
    const readiness =
      params.has("unavailable") && name === "connections/catalog"
        ? ++readinessReads === 1
          ? "unknown"
          : "available"
        : null;
    const selectedConnection = external ? externalConnection : connection;
    const selectedConnected = external ? externalConnected : connected;
    if (name === "connections/complete" && external) externalConnected = true;
    let data = {
      "mcp/servers/list": [],
      "capabilities/list": [],
      "connections/list": selectedConnected ? [selectedConnection] : [],
      "connections/catalog": catalog.map((item) => ({
        ...item,
        ...(readiness && item.slug === "tiktok" ? { availability: readiness } : {}),
        ...(params.has("setup") && item.slug === "twitter" ? { availability: "coming_soon" } : {}),
        connected: accountMode
          ? item.slug === "twitter" && accountRows.some((row) => row.status === "connected")
          : item.slug === selectedConnection.provider && selectedConnected,
      })),
      "capabilities/catalogSearch": { enabled: false, results: [] },
      "connections/complete": selectedConnection,
      "connections/accounts": [],
      "connections/tools": [],
    }[name];
    if (accountMode) {
      if (name === "connections/list")
        data = accountRows.map(({ identity: _identity, ...row }) => row);
      if (name === "connections/accounts") data = accountRows;
      if (name === "connections/tools")
        data = [{ name: "Read profile", description: "Fixture tool" }];
      if (name === "connections/revoke") {
        accountRows = accountRows.filter((row) => row.id !== input?.connectionId);
        data = { ok: true };
      }
      if (name === "connections/rename") {
        accountRows = accountRows.map((row) =>
          row.id === input?.connectionId ? { ...row, displayName: input.displayName } : row,
        );
        data = accountRows.find((row) => row.id === input?.connectionId);
      }
    }
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    if (name === "connections/begin") {
      if (external && input?.provider === "twitter") {
        data = {
          connectionId: externalConnection.id,
          authorizationUrl: "https://connect.composio.dev/link/fixture-not-a-real-connection",
        };
      } else if (input?.provider === "gmail") {
        connected = true;
        data = { connectionId: connection.id, authorizationUrl: null };
      } else {
        const legacy = new URL(req.headers.referer ?? "http://localhost/").searchParams.has(
          "legacy",
        );
        const message = legacy
          ? '400 {"error":{"slug":"ToolRouterV2_NoManagedAuth","request_id":"private-request"}}'
          : "INTEGRATION_AUTH_SETUP_REQUIRED";
        res.statusCode = 400;
        res.end(
          JSON.stringify({ json: { defined: false, code: "BAD_REQUEST", status: 400, message } }),
        );
        return;
      }
    }
    if (data === undefined) {
      res.statusCode = 404;
      res.end("{}");
      return;
    }
    res.end(JSON.stringify({ json: data }));
  };
}

export default defineConfig({
  root: fixture,
  envDir: false,
  resolve: { alias: await workspaceViteAliases(agent) },
  plugins: [
    react(),
    babel({ plugins: ["@lingui/babel-plugin-lingui-macro"] }),
    lingui(),
    tailwindcss(),
    {
      name: "integration-auth-fixture",
      configureServer(server) {
        server.middlewares.use(fixtureServer());
      },
      configurePreviewServer(server) {
        server.middlewares.use(fixtureServer());
      },
    },
  ],
  build: {
    outDir: fileURLToPath(new URL("../.codex-tmp/integration-auth-ci/", import.meta.url)),
    emptyOutDir: true,
  },
  preview: { host: "127.0.0.1", port: 4197, strictPort: true },
});
