import type { FastifyInstance, FastifyRequest } from "fastify";
import type { CoordinatorConfig } from "../core/config.js";
import { eventDemoBudget } from "../core/event-demo-config.js";
import type { MeshDatabase } from "../storage/database.js";
import type { SupabasePersistence } from "../storage/supabase-sync.js";
import type { ContributionCreditWallet } from "../economy/contribution-credit-wallet.js";
import type { ApiAccessManager } from "./api-access.js";
import type { WorkerAdmissionAuthority } from "./worker-admission.js";
import { MobileComputeHub, type MobileComputeHubOptions } from "./mobile-compute-hub.js";
import { initializeBrowserInference } from "./browser-inference-routes.js";
import { EventDemo, type EventDemoGateway } from "./event-demo.js";
import { mountEventDemo } from "./event-demo-routes.js";

/** Shared signed browser runtime; optional event routes never widen normal account auth. */
export async function initializeBrowserCompute(app: FastifyInstance, deps: {
  config: CoordinatorConfig; database: MeshDatabase; wallet: ContributionCreditWallet | null;
  api: ApiAccessManager; apiEnabled: boolean; workerAdmission: WorkerAdmissionAuthority;
  principal(request: FastifyRequest): { kind: string; userId?: string; apiKeyId?: string };
  trusted: MobileComputeHubOptions["isTrustedLocalRequest"];
  disconnectedRetentionMs: number | undefined; persistence: SupabasePersistence | null;
  gateway: EventDemoGateway | undefined;
}) {
  const { config, persistence } = deps;
  const mobileHub = new MobileComputeHub({
    joinToken: config.mobileJoinToken, expertArtifactsPath: config.mobileExpertArtifactsPath,
    disconnectedRetentionMs: deps.disconnectedRetentionMs, admissionAuthority: deps.workerAdmission,
    ...(deps.trusted ? { isTrustedLocalRequest: deps.trusted } : {}),
    ...(persistence ? { onArtifactStored: async (artifact: Parameters<SupabasePersistence["registerArtifactBackup"]>[0]) => {
      await persistence.registerArtifactBackup(artifact);
    } } : {}),
  });
  mobileHub.attach(app);
  const browserInference = await initializeBrowserInference(app, { database: deps.database, wallet: deps.wallet,
    api: deps.api, hub: mobileHub, config: config.browserInference, apiEnabled: deps.apiEnabled, principal: deps.principal,
    eventBudget: eventDemoBudget(config.eventDemo) });
  if (config.eventDemo) {
    if (!deps.wallet || !deps.gateway || !browserInference?.models().length)
      throw new Error("demo_requires_managed_credit_provider_and_browser_inference");
    const demo = new EventDemo(config.eventDemo, deps.database, deps.wallet, deps.api, deps.gateway, browserInference, mobileHub);
    await demo.initialize(); mountEventDemo(app, demo);
  }
  return { mobileHub, browserInference };
}
