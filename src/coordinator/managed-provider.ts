import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { CoordinatorConfig } from "../core/config.js";
import type { MeshDatabase } from "../storage/database.js";
import type { ContributionCreditWallet } from "../economy/contribution-credit-wallet.js";
import { ManagedPurchases } from "../economy/managed-purchases.js";
import { ApiAccessError, type ApiAccessManager } from "./api-access.js";
import { ManagedOpenRouter, MANAGED_MODEL_PREFIX } from "./managed-openrouter.js";
import { ManagedGateway } from "./managed-gateway.js";
import { mountManagedProviderRoutes, handleManagedChat } from "./managed-provider-routes.js";
import { ManagedMedia,type MediaRequest,type MediaQuote } from "./managed-media.js";
import { mountManagedMediaRoutes } from "./managed-media-routes.js";
import { WalletTopups } from "../economy/wallet-topups.js";
import { mountWalletTopups } from "./wallet-topup-routes.js";
import {ManagedAntseedEdit,type EditQuote} from "./managed-antseed-edit.js";
import {mountManagedVideoEdit} from "./managed-video-edit-routes.js";
import type {ManagedEditRequest} from "../contracts/video-edit.js";
import {ManagedTextRouter,managedTextBackend,type RoutedTextQuote} from "./managed-text-router.js";
import type {ManagedTextRequest} from "./managed-openrouter.js";
import type {ManagedModel} from "../contracts/managed-provider.js";
import {ManagedMediaCatalog} from "./managed-media-catalog.js";
import {ManagedAntseedText} from "./managed-antseed-text.js";
import {ManagedAntseedGateway} from "./managed-antseed-gateway.js";

type Principal = { kind: "system" } | { kind: "user"; userId: string } | { kind: "api_key"; userId: string; apiKeyId: string };
const payer = (principal: Principal) => {
  if (principal.kind === "system") throw new ApiAccessError("account_required", "Managed purchases require a user account.", 403);
  return { userId: principal.userId, apiKeyId: principal.kind === "api_key" ? principal.apiKeyId : null };
};
export function isManagedModel(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const model = (body as Record<string, unknown>).model;
  return typeof model === "string" && model.startsWith(MANAGED_MODEL_PREFIX);
}
export async function initializeManagedProvider(config: CoordinatorConfig, database: MeshDatabase,
  wallet: ContributionCreditWallet | null, api: ApiAccessManager) {
  if (!config.managedProvider) return null;
  // A hand-written maximum is not a cost contract. Only opt-in metadata-derived
  // unit contracts may enter the managed media catalog; legacy offers are fixtures.
  if(config.managedProvider.mediaOffers?.length)throw new Error("managed_media_cost_contract_not_qualified");
  if (!config.apiAccessEnabled || !wallet) throw new Error("managed_provider_requires_accounts_and_credit_funding");
  const purchases = new ManagedPurchases(database, wallet, config.managedProvider.dailyLimitMicrounits);
  await purchases.initialize();
  const settings = config.managedProvider;
  const upstream = settings.upstream ?? "antseed";
  if (upstream !== "openrouter" && settings.mediaEnabled) throw new Error("managed_antseed_media_not_qualified");
  const text = upstream === "antseed"
    ? new ManagedAntseedText(settings.antseedControlSecret ?? "", settings.modelAllowlist, fetch, settings.fundingCostBasisPoints ?? null)
    : upstream === "antseed-gateway" ? new ManagedAntseedGateway(settings.antseedGatewayKey ?? "", settings.antseedGatewayBaseUrl ?? "",
      settings.modelAllowlist, settings.fundingCostBasisPoints ?? null, fetch, settings.antseedGatewayContract)
      : new ManagedOpenRouter(settings.openRouterKey ?? "", settings.modelAllowlist, fetch, settings.fundingCostBasisPoints ?? null);
  const backend = text instanceof ManagedAntseedText ? managedTextBackend("antseed",text)
    : text instanceof ManagedAntseedGateway ? managedTextBackend("antseed-gateway",text) : managedTextBackend("openrouter",text);
  const provider = new ManagedTextRouter([backend],settings.textRoutes);
  // The first account sees the full current catalog, without a second-open warmup.
  // Metadata failures are isolated by the router; native inference remains available.
  await provider.ensureFresh();
  const gateway = new ManagedGateway<ManagedTextRequest,RoutedTextQuote,ManagedModel>(database, purchases, api, provider, config.managedProvider.requestLimitMicrounits);
  const mediaCatalog=upstream === "openrouter" && settings.mediaEnabled?new ManagedMediaCatalog(settings.openRouterKey!,settings.modelAllowlist):null;
  const media=new ManagedMedia(upstream === "openrouter" ? settings.openRouterKey! : "",[],fetch,settings.fundingCostBasisPoints??null,
    mediaCatalog?()=>mediaCatalog.load():undefined);
  const mediaGateway=new ManagedGateway<MediaRequest,MediaQuote,ReturnType<ManagedMedia["catalog"]>[number]>(database,purchases,api,media,config.managedProvider.requestLimitMicrounits);
  const topups=config.managedProvider.walletTopups ? new WalletTopups(database):null;
  const edit=config.managedProvider.antseedEditControlSecret?new ManagedAntseedEdit(config.managedProvider.antseedEditControlSecret):null;
  const editGateway=edit?new ManagedGateway<ManagedEditRequest,EditQuote,ReturnType<ManagedAntseedEdit["catalog"]>[number]>(database,purchases,api,edit,config.managedProvider.requestLimitMicrounits):null;
  if(topups) {
    if(!config.stripeCheckout || !config.stripeWebhookSecrets?.length)throw new Error("wallet_checkout_configuration_required");
    await topups.initialize();
  }
  return {
    catalog: () => gateway.catalog(),
    inventory: async () => text.inventory(),
    mount: (app: FastifyInstance, principalFor: (request: FastifyRequest) => Principal) => {
      const account=(request:FastifyRequest)=>payer(principalFor(request));
      app.get("/v1/managed/catalog",async request=>{account(request);await text.ensureFresh();await media.ensureFresh();return {provider:"Mycellios",data:text.inventory(),applications:media.catalog(),unqualifiedApplications:mediaCatalog?.inventory()??[]};});
      mountManagedProviderRoutes(app, { gateway, account });
      mountManagedMediaRoutes(app,media,mediaGateway,purchases,account);
      if(edit&&editGateway)mountManagedVideoEdit(app,edit,editGateway,purchases,database,wallet,account);
      if(topups && config.stripeCheckout)mountWalletTopups(app,topups,{...config.stripeCheckout,
        webhookSecrets:config.stripeWebhookSecrets!,livemode:config.stripeWebhookLivemode??false},account);
    },
    chat: (request: FastifyRequest, reply: FastifyReply, principal: Principal) =>
      handleManagedChat(request, reply, gateway, payer(principal)),
  };
}
