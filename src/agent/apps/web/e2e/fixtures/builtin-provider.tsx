import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { Bot, Me, ModelCatalogEntry, ModelCredential } from "@mycellios/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { QueryUserProvider, spaceQueries } from "../../src/lib/query";
import { SpaceRpcProvider } from "../../src/lib/space-rpc";
import { ChatHeaderModel } from "../../src/pages/shell/chat-header-model";
import "../../src/styles.css";

// Actual picker components with read-only synthetic data. No real identity/key/model request.
i18n.load("en", {}); i18n.activate("en");
const connected = new URLSearchParams(location.search).has("connected");
const personal = new URLSearchParams(location.search).has("personal");
const userId = "fixture-user", spaceId = "fixture-space";
const me = { userId, spaceId, needsModel: !connected, defaultProvider: connected ? "openai-compatible" : null, defaultModel: connected ? "fixture-credit-model" : null } as Me;
const credentials: ModelCredential[] = connected ? [{
  id: "fixture-owned", provider: "openai-compatible", label: "Mycellios", hasKey: true, isDefault: true,
  modelId: "fixture-credit-model", enabledModelIds: ["fixture-credit-model"], baseUrl: "https://www.mycellios.com/v1",
  headerNames: ["x-mycellios-funding"],
}] : [];
const models = connected ? [{ provider: "openai-compatible", providerName: "Mycellios", id: "fixture-credit-model", label: "Fixture credit model" } as ModelCatalogEntry] : [];
if (personal) {
  Object.assign(me, { needsModel: false, defaultProvider: "opencode-go", defaultModel: "fixture-personal-model" });
  credentials.push({ id: "fixture-personal", provider: "opencode-go", label: "OpenCode Go", hasKey: true, modelId: "fixture-personal-model" } as ModelCredential);
  models.push({ provider: "opencode-go", providerName: "OpenCode Go", id: "fixture-personal-model", label: "Fixture personal model" } as ModelCatalogEntry);
}
const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, refetchOnMount: false, retry: false } } });
const queries = spaceQueries(userId, spaceId);
client.setQueryData(queries.me.queryKey(), me);
client.setQueryData(queries.models.credentials.queryKey(), credentials);
client.setQueryData(queries.models.list.queryKey(), models);
client.setQueryData(["mycellios-chat-catalog", userId, spaceId, connected ? "fixture-owned" : undefined], models.filter(model => model.providerName === "Mycellios"));
client.setQueryData(queries.engines.list.queryKey(), [{ id: "codex", name: "Codex", available: true }]);
client.setQueryData(queries.engines.codexModels.queryKey(), []);
const bot = { id: "fixture-bot", agentEngine: "codex", modelProvider: null, modelId: null, thinkingLevel: null } as Bot;
if (personal) bot.agentEngine = "pi";
let modelSaves = 0;
Object.defineProperty(window, "fixtureModelSaves", { get: () => modelSaves });
createRoot(document.getElementById("root")!).render(<I18nProvider i18n={i18n}><QueryClientProvider client={client}>
  <QueryUserProvider value={userId}><SpaceRpcProvider spaceId={spaceId}>
    <main className="min-h-dvh bg-background p-6 text-foreground">
      <p className="mb-8 text-xs text-muted-foreground">Read-only preview · synthetic account · no inference</p>
      <div className="flex justify-end"><ChatHeaderModel bot={bot} me={me} onConnections={() => {}} onSave={async () => { modelSaves++; throw Error("Read-only fixture"); }} /></div>
    </main>
  </SpaceRpcProvider></QueryUserProvider>
</QueryClientProvider></I18nProvider>);
