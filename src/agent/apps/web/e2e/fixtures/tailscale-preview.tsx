import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import type { TailnetConnection } from "@rakazo/contracts";
import type { RpcClient } from "../../src/lib/rpc";
import { SpaceRpcProvider } from "../../src/lib/space-rpc";
import { TailscaleConnections } from "../../src/pages/TailscaleConnections";
import { McpServersOverlay } from "../../src/pages/McpServersOverlay";
import "../../src/styles.css";

const i18n = setupI18n({ locale: "en", messages: { en: {} } });
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
let rows: TailnetConnection[] = [];
const saved: unknown[] = [];
const policies: { id: string; dnsSuffix: string; enabled: boolean }[] = [];
const mock = {
  bots: { list: async () => [{ id: "mico-a", name: "Research" }, { id: "mico-b", name: "Support" }] },
  tailscale: {
    list: async () => ({ available: true, admin: true, companyNetworks: policies, connections: rows }),
    create: async (input: TailnetConnection) => {
      const row = { ...input, id: crypto.randomUUID(), status: "disconnected" as const, enabled: false, authUrl: null, deviceName: null };
      rows = [...rows, row]; return row;
    },
    connect: async ({ id }: { id: string }) => {
      rows = rows.map(row => row.id === id ? { ...row, enabled: true, status: "needs_auth", authUrl: "https://login.tailscale.com/a/synthetic-test" } : row);
      return rows.find(row => row.id === id)!;
    },
    disconnect: async ({ id }: { id: string }) => {
      rows = rows.map(row => row.id === id ? { ...row, enabled: false, status: "disconnected", authUrl: null } : row); return { ok: true };
    },
    grant: async ({ id, allowedBotIds }: { id: string; allowedBotIds: string[] }) => {
      rows = rows.map(row => row.id === id ? { ...row, allowedBotIds } : row); return { ok: true };
    },
    company: async (input: { dnsSuffix: string; enabled: boolean }) => {
      const policy = policies.find(row => row.dnsSuffix === input.dnsSuffix);
      if (policy) policy.enabled = input.enabled; else policies.push({ id: crypto.randomUUID(), ...input });
      return { ok: true };
    },
  },
  mcp: {
    servers: { list: async () => [], create: async (input: unknown) => { saved.push(input); return { id: "mcp-created" }; } },
    assignments: { all: async () => [], replace: async () => [] },
  },
} as unknown as RpcClient;
Object.assign(window, { tailscaleFixture: { rows: () => rows, saved: () => saved } });
function Preview() {
  const [mcp, setMcp] = useState(false);
  return <I18nProvider i18n={i18n}><QueryClientProvider client={queryClient}>
    <SpaceRpcProvider spaceId="synthetic-space" client={mock}>
      <main className="min-h-dvh bg-background text-foreground p-4 sm:p-8"><div className="mx-auto max-w-4xl space-y-5">
        <h1 className="text-xl font-medium">Connections</h1>
        <TailscaleConnections onOpenMcp={() => setMcp(true)} />
        {mcp ? <McpServersOverlay embedded onClose={() => setMcp(false)} /> : null}
      </div></main>
    </SpaceRpcProvider>
  </QueryClientProvider></I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
