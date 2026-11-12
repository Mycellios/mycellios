import { readBoundedJsonResponse,readBoundedResponseBytes } from "@rakazo/core";
import { createModelPlanLimits } from "../model-plan-limits.js";
import { discoverLocalModels } from "../local-model-discovery.js";
import { nativeHostAccess } from "@rakazo/adapters";
import { ORPCError } from "@orpc/server";
import { contributionAccount } from "../contribution-account.js";
import { SecretStoreUnavailableError } from "@rakazo/adapter-kit";
import {
  listPiCatalog,
  modelCredentialDto,
  oauthCredentialEmail,
  prepareStoredModelAuth,
  probeCatalogProviderModels,
  probeOpenAiCompatibleModels,
  providerCatalogCache,
  readMycelliosAccount,
  resolveMemberMainModel,
  selectDefaultCredentialId,
  serializeModelSecret,
  storedOpenAiCompatibleProbeHeaders,
  storedOpenAiCompatibleProbeKey,
  UNAVAILABLE_MODEL_FOR_AUTH_MESSAGE,
} from "@rakazo/adapters";
import type { Actor, ThinkingLevel } from "@rakazo/contracts";
import {
  ANTSEED_PROVIDER_ID,
  backupChoiceKey,
  canonicalPiProviderId,
  isMycelliosBaseUrl,
  isOllamaCloudBaseUrl,
  OPENAI_COMPATIBLE_PROVIDER_ID,
  productBrand,
  usableModelId,
} from "@rakazo/contracts";
import { clampCatalogThinkingLevel } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import {
  appliedModelRole,
  comparePreferenceOrder,
  defaultModelCredentialCandidates,
  deleteUnreferencedCredentialSecret,
  findModelCredential,
  getModelRole,
  modelCredentialProviderFilter,
  modelRoleTarget,
  newestModelCredentialOrder,
  Prisma,
  runAsSystemInTransaction,
  saveModelPreference,
  updateModelRole,
  writeModelRole,
} from "@rakazo/db";
import { mayUsePrivateEndpoint } from "../mcp-servers.js";
import {
  modelConnectionTarget,
  persistModelCredential,
  prepareAllowedThinkingLevels,
  throwIfAborted,
} from "../model-credentials.js";
import { assertCompatibleDefaultChange } from "../model-pins.js";
import {
  MycelliosConnectionUnavailable,
  provisionMycelliosConnection,
} from "../mycellios-sso-connection.js";
import { withSerializableRetry } from "../serializable-retry.js";
import type { RouterContext } from "./context.js";
import { readMycelliosChatModels } from "../mycellios-model-catalog.js";
import { ownedMycelliosConnection } from "../mycellios-owned-connection.js";

export function modelsRoutes(ctx: RouterContext) {
  const {
    deps,
    codexCatalog,
    connectModelCredential,
    refreshExpiredCredential,
    chatCatalog,
    withDeploymentDefault,
    modelRoleCatalog,
    validateRoleChoices,
    authed,
  } = ctx;
  // Coalesce simultaneous setup clicks in this API instance; never rotate a key
  // because two views of the same member finish onboarding together.
  const planLimits = createModelPlanLimits(deps);
  const mycelliosConnections = new Map<string, ReturnType<typeof persistModelCredential>>();
  // A compatible provider can now have several independent connections.
  // Select an owned Mycellios endpoint, never the newest arbitrary gateway.
  const ownedMycellios = (actor: Actor) => ownedMycelliosConnection(deps, actor.userId);
  return {
    models: {
      planLimits: authed.models.planLimits.handler(({ context, input }) => planLimits(context.actor.userId, input?.refresh)),
      discoverLocal: authed.models.discoverLocal.handler(async ({ context }) => {
        if (!(await nativeHostAccess(deps.dataDir, context.actor)))
          throw new ORPCError("FORBIDDEN");
        return discoverLocalModels(context.signal);
      }),

      contributionStatus: authed.models.contributionStatus.handler(async ({ context, input }) => {
        if (!deps.env.mycelliosSso || !context.requestHeaders) throw new ORPCError("FORBIDDEN");
        const token = await deps.auth.oidcAccessToken(context.requestHeaders, context.actor.userId);
        if (!token) throw new ORPCError("UNAUTHORIZED");
        return contributionAccount(token, deps.modelConnectionFetch, context.signal).status(input.nodeId);
      }),
      contributionControl: authed.models.contributionControl.handler(async ({ context, input }) => {
        if (!deps.env.mycelliosSso || !context.requestHeaders) throw new ORPCError("FORBIDDEN");
        const token = await deps.auth.oidcAccessToken(context.requestHeaders, context.actor.userId);
        if (!token) throw new ORPCError("UNAUTHORIZED");
        return contributionAccount(token, deps.modelConnectionFetch, context.signal).control(input.nodeId, input.action);
      }),
      contributionEnrollment: authed.models.contributionEnrollment.handler(async ({ context }) => {
        if (!deps.env.mycelliosSso || !context.requestHeaders) throw new ORPCError("FORBIDDEN");
        const token = await deps.auth.oidcAccessToken(context.requestHeaders, context.actor.userId);
        if (!token) throw new ORPCError("UNAUTHORIZED");
        return contributionAccount(token, deps.modelConnectionFetch, context.signal).enroll();
      }),
      connectMycellios: authed.models.connectMycellios.handler(async ({ context }) => {
        if (!deps.env.mycelliosSso || !context.requestHeaders)
          throw new ORPCError("FORBIDDEN", { message: "Sign in with Mycellios to connect this account." });
        const pending = mycelliosConnections.get(context.actor.userId);
        if (pending) return pending;
        const setup = (async () => {
          if (!deps.env.mycelliosSso || !context.requestHeaders)
            throw new ORPCError("FORBIDDEN", {
              message: "Sign in with Mycellios to connect this account.",
            });
          const accessToken = await deps.auth.oidcAccessToken(
            context.requestHeaders,
            context.actor.userId,
          );
          if (!accessToken) throw new ORPCError("UNAUTHORIZED");
          const existing = await ownedMycellios(context.actor);
          const provisioned = await provisionMycelliosConnection(accessToken, {
            modelId: existing?.credential.userPreferences?.[0]?.modelId ?? deps.env.defaultModel,
            existing: existing?.saved,
            fetch: deps.modelConnectionFetch,
            signal: context.signal,
          }).catch((error: unknown) => {
            if (error instanceof MycelliosConnectionUnavailable)
              throw new ORPCError("SERVICE_UNAVAILABLE", { message: error.message });
            throw error;
          });
          try {
            return await persistModelCredential(
              deps,
              context.actor,
              {
                provider: OPENAI_COMPATIBLE_PROVIDER_ID,
                credentialId: existing?.credential.id ?? null,
                plaintext: serializeModelSecret({
                  ...provisioned.connection,
                  maxTokens: existing?.saved.maxTokens ?? deps.env.defaultModelMaxTokens,
                  contextWindow: existing?.saved.contextWindow ?? deps.env.defaultModelContextWindow,
                  enabledModelIds: [...new Set([...(existing?.saved.enabledModelIds ?? []), provisioned.modelId])],
                }),
                label: existing?.credential.label ?? "Mycellios",
                modelId: provisioned.modelId,
                keepExistingDefault: true,
                scope: "account",
                signal: context.signal,
              },
              codexCatalog,
            );
          } catch (error) {
            await provisioned.revoke();
            throw error;
          }
        })();
        mycelliosConnections.set(context.actor.userId, setup);
        try { return await setup; }
        finally { mycelliosConnections.delete(context.actor.userId); }
      }),
      mycelliosVideoEdit:authed.models.mycelliosVideoEdit.handler(async({context,input})=>{
        if(process.env.MYCELLIOS_MANAGED_APPS_ENABLED!=="true")throw new ORPCError("PRECONDITION_FAILED",{message:"El editor con monedero está en preparación. No se ha enviado ni cobrado nada."});
        const owned=await ownedMycellios(context.actor);
        const token=owned?.saved.apiKey??(deps.env.mycelliosSso&&context.requestHeaders?await deps.auth.oidcAccessToken(context.requestHeaders,context.actor.userId):null);
        if(!token)throw new ORPCError("UNAUTHORIZED");
        const signal=AbortSignal.any([AbortSignal.timeout(170000),...(context.signal?[context.signal]:[])]);
        const response=await(deps.modelConnectionFetch??fetch)(productBrand.apiBaseUrl+"/managed/video-edit/"+input.action,{
          method:input.action==="info"?"GET":"POST",redirect:"error",signal,headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},
          ...(input.action==="info"?{}:{body:input.payload}),
        });
        if(!response.ok){await response.body?.cancel();throw new ORPCError("SERVICE_UNAVAILABLE",{message:"No se pudo completar la operación del editor. Consulta el trabajo antes de volver a enviarlo."});}
        if(input.action==="content"){
          if(!response.headers.get("content-type")?.startsWith("video/mp4")){await response.body?.cancel();throw new ORPCError("SERVICE_UNAVAILABLE");}
          const bytes=await readBoundedResponseBytes(response,{maxBytes:67_108_864,tooLargeMessage:"El vídeo supera el límite permitido.",read:operation=>operation()});
          return {data:Buffer.from(bytes).toString("base64"),mediaType:"video/mp4"};
        }
        return await readBoundedJsonResponse(response,2_000_000,signal);
      }),
      mycelliosMedia: authed.models.mycelliosMedia.handler(async ({context,input})=>{
        if(process.env.MYCELLIOS_MANAGED_APPS_ENABLED!=="true")throw new ORPCError("PRECONDITION_FAILED",{message:"Estas apps están en preparación. No se ha gastado ningún crédito."});
        if(input.action!=="models"&&input.expectedUserId!==context.actor.userId)throw new ORPCError("FORBIDDEN",{message:"La cuenta ha cambiado. Vuelve a abrir la app antes de continuar."});
        const owned=await ownedMycellios(context.actor);
        const token=owned?.saved.apiKey ?? (deps.env.mycelliosSso && context.requestHeaders ? await deps.auth.oidcAccessToken(context.requestHeaders,context.actor.userId):null);
        if(!token)throw new ORPCError("UNAUTHORIZED");
        const path=input.action==="checkout"?"/wallet/checkout":"/managed/media/"+input.action;
        const signal=AbortSignal.any([AbortSignal.timeout(150000),...(context.signal?[context.signal]:[])]);
        const response=await (deps.modelConnectionFetch??fetch)(productBrand.apiBaseUrl+path,{method:input.action==="models"?"GET":"POST",redirect:"error",signal,
          headers:{authorization:`Bearer ${token}`,"content-type":"application/json",...(input.key?{"idempotency-key":input.key}:{})},
          ...(input.action==="models"?{}:{body:input.payload??"{}"})});
        if(input.action==="status"&&response.status===404){await response.body?.cancel();return {status:"not_submitted"};}
        if(!response.ok){await response.body?.cancel();throw new ORPCError("SERVICE_UNAVAILABLE",{message:"No se ha podido completar la operación. Consulta el estado antes de volver a enviarla."});}
        if(input.action==="content") {
          const bytes=await readBoundedResponseBytes(response,{maxBytes:67_108_864,tooLargeMessage:"El vídeo supera el límite de descarga.",read:operation=>operation()});
          return {data:Buffer.from(bytes).toString("base64"),mediaType:"video/mp4"};
        }
        const value=await readBoundedJsonResponse<Record<string,unknown>>(response,24_000_000,signal);
        return input.action==="models"?{...value,viewer:context.actor.userId}:value;
      }),
      mycelliosModels: authed.models.mycelliosModels.handler(async ({ context }) => {
        const owned = await ownedMycellios(context.actor);
        const token = owned?.saved.apiKey ?? (deps.env.mycelliosSso && context.requestHeaders
          ? await deps.auth.oidcAccessToken(context.requestHeaders, context.actor.userId)
          : null);
        if (!token) throw new ORPCError("UNAUTHORIZED");
        try {
          const account = await readMycelliosAccount({ baseUrl: productBrand.apiBaseUrl, apiKey: token }, {
            fetch: deps.modelConnectionFetch, signal: context.signal,
          });
          if (!account?.contributionFundingSupported) throw new Error("Credit funding is unavailable");
          return await readMycelliosChatModels(token, {
            fetch: deps.modelConnectionFetch, signal: context.signal,
            credentialId: owned?.credential.id,
          });
        } catch {
          throw new ORPCError("SERVICE_UNAVAILABLE", {
            message: "Mycellios models are temporarily unavailable. Try again.",
          });
        }
      }),
      mycelliosAccount: authed.models.mycelliosAccount.handler(async ({ context }) => {
        try {
          // Existing owned connections keep working independently of SSO refresh.
          const owned = await ownedMycellios(context.actor);
          if (owned) return await readMycelliosAccount(owned.saved, {
            signal: context.signal, fetch: deps.modelConnectionFetch,
          });
          // The signed-in account has a balance even before connecting a model.
          // Never display another provider's or another account's key balance as this user's Credits.
          if (deps.env.mycelliosSso && context.requestHeaders) {
            const token = await deps.auth.oidcAccessToken(context.requestHeaders, context.actor.userId);
            if (!token) throw new ORPCError("UNAUTHORIZED");
            return await readMycelliosAccount({ baseUrl: productBrand.apiBaseUrl, apiKey: token }, {
              signal: context.signal, fetch: deps.modelConnectionFetch,
            });
          }
          return null;
        } catch {
          throw new ORPCError("SERVICE_UNAVAILABLE", {
            message: "Mycellios credits are temporarily unavailable.",
          });
        }
      }),

      list: authed.models.list.handler(async ({ context }) => chatCatalog(context.actor)),
      credentials: authed.models.credentials.handler(async ({ context }) => {
        const [rows, main] = await Promise.all([
          deps.prisma.userModelCredential.findMany({
            where: { userId: context.actor.userId },
            include: { userPreferences: { where: { userId: context.actor.userId } } },
            orderBy: newestModelCredentialOrder,
          }),
          resolveMemberMainModel({ prisma: deps.prisma, secretStore: deps.secrets }, context.actor),
        ]);
        const secrets = rows.length
          ? await deps.prisma.secret.findMany({
              where: {
                id: { in: rows.map((row) => row.secretId) },
                userId: context.actor.userId,
                spaceId: null,
              },
              select: { id: true, ciphertext: true },
            })
          : [];
        const ciphertextById = new Map(secrets.map((secret) => [secret.id, secret.ciphertext]));
        const preferenceRanks = new Map(
          rows
            .flatMap((row) => row.userPreferences)
            .sort(comparePreferenceOrder)
            .map((preference, index) => [preference.credentialId, index]),
        );
        return Promise.all(
          rows.map(async ({ userPreferences, ...row }) => {
            const preference = userPreferences[0];
            const own = {
              ...row,
              defaultModel: preference?.modelId ?? null,
              thinkingLevel: preference?.thinkingLevel ?? null,
            };
            const runsMain = main?.credential && main.credential.id === row.id;
            const dto = (plaintext?: string) => {
              const listed = modelCredentialDto(own, plaintext);
              // The connection running the main model shows that model, as apps read it,
              // while its own model stays enabled.
              const shown = runsMain
                ? modelCredentialDto(
                    {
                      ...row,
                      isDefault: true,
                      defaultModel: main.modelId,
                      thinkingLevel: main.thinkingLevel ?? null,
                    },
                    plaintext,
                  )
                : listed;
              return {
                ...shown,
                ...(shown.enabledModelIds
                  ? {
                      enabledModelIds: [
                        ...new Set([...shown.enabledModelIds, ...(listed.enabledModelIds ?? [])]),
                      ],
                    }
                  : {}),
                ...(preference
                  ? { preferenceRank: preferenceRanks.get(preference.credentialId) }
                  : {}),
              };
            };
            const ciphertext = ciphertextById.get(row.secretId);
            if (!ciphertext) return dto();
            try {
              return dto(await deps.secrets.load(ciphertext, row.secretId));
            } catch (error) {
              if (error instanceof SecretStoreUnavailableError)
                throw new ORPCError("SERVICE_UNAVAILABLE", { cause: error });
              return dto();
            }
          }),
        );
      }),
      forRole: authed.models.forRole.handler(async ({ context, input }) =>
        modelRoleCatalog(context.actor, input.role),
      ),
      role: authed.models.role.handler(async ({ context, input }) => {
        if (input.expectedUserId && input.expectedUserId !== context.actor.userId)
          throw new ORPCError("FORBIDDEN");
        return withDeploymentDefault(
          input.role,
          await getModelRole(
            deps.prisma,
            await modelRoleTarget(deps.prisma, context.actor, input.scope),
            input.role,
          ),
          context.actor,
          input.scope,
        );
      }),
      setRole: authed.models.setRole.handler(async ({ context, input }) => {
        if (input.expectedUserId && input.expectedUserId !== context.actor.userId)
          throw new ORPCError("FORBIDDEN");
        const { role, primary, backups, scope } = input;
        await validateRoleChoices(context.actor, role, [
          ...(primary ? [primary] : []),
          ...(backups ?? []),
        ]);
        return withDeploymentDefault(
          role,
          await updateModelRole(
            deps.prisma,
            { userId: context.actor.userId, spaceId: context.actor.spaceId, scope },
            role,
            { primary, backups },
          ),
          context.actor,
          scope,
        );
      }),
      backups: authed.models.backups.handler(async ({ context }) =>
        (await appliedModelRole(deps.prisma, context.actor, "main")).backups.map(
          ({ provider, modelId }) => ({ provider, modelId }),
        ),
      ),
      setBackups: authed.models.setBackups.handler(async ({ context, input }) => {
        await validateRoleChoices(context.actor, "main", input);
        await updateModelRole(
          deps.prisma,
          { userId: context.actor.userId, spaceId: context.actor.spaceId },
          "main",
          { backups: input },
        );
        return { ok: true as const };
      }),
      connect: authed.models.connect.handler(async ({ context, input }) =>
        connectModelCredential(context.actor, input, context.signal),
      ),
      probeOpenAiCompatible: authed.models.probeOpenAiCompatible.handler(
        async ({ context, input }) => {
          const provider = input.provider ?? OPENAI_COMPATIBLE_PROVIDER_ID;
          let apiKey = input.apiKey;
          let headers = input.headers;
          if (!apiKey?.trim() || headers === undefined) {
            try {
              const preferred = await findModelCredential(deps.prisma, context.actor, provider);
              const credentials = await deps.prisma.userModelCredential.findMany({
                where: { userId: context.actor.userId, provider },
                orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
              });
              const candidates = input.credentialId
                ? credentials.filter((credential) => credential.id === input.credentialId)
                : preferred
                  ? [
                      preferred,
                      ...credentials.filter((credential) => credential.id !== preferred.id),
                    ]
                  : credentials;
              const secrets = await deps.prisma.secret.findMany({
                where: {
                  id: { in: candidates.map((credential) => credential.secretId) },
                  userId: context.actor.userId,
                  spaceId: null,
                },
                select: { id: true, ciphertext: true },
              });
              const ciphertexts = new Map(secrets.map((secret) => [secret.id, secret.ciphertext]));
              for (const credential of candidates) {
                const ciphertext = ciphertexts.get(credential.secretId);
                if (!ciphertext) continue;
                try {
                  const plaintext = await deps.secrets.load(ciphertext, credential.secretId);
                  const savedKey = storedOpenAiCompatibleProbeKey(input.baseUrl, plaintext);
                  const savedHeaders = storedOpenAiCompatibleProbeHeaders(input.baseUrl, plaintext);
                  if (!savedKey && savedHeaders === undefined) continue;
                  // A saved key and its routing headers are one credential. Explicit
                  // replacements may override either field, but never borrow from another row.
                  if (!apiKey?.trim()) apiKey = savedKey;
                  headers ??= savedHeaders;
                  break;
                } catch {
                  // An unreadable secret must not prevent trying the remaining credentials.
                }
              }
            } catch {
              // An unavailable saved key must not prevent a keyless probe.
            }
          }
          if (provider === ANTSEED_PROVIDER_ID && !apiKey?.trim()) {
            throw new ORPCError("BAD_REQUEST", {
              message: "An AntSeed gateway API key is required.",
            });
          }
          try {
            const models = await probeOpenAiCompatibleModels(
              { ...input, apiKey, headers },
              provider === ANTSEED_PROVIDER_ID ||
                isOllamaCloudBaseUrl(input.baseUrl) ||
                isMycelliosBaseUrl(input.baseUrl)
                ? deps.modelConnectionFetch
                : undefined,
              context.signal,
              { allowPrivate: mayUsePrivateEndpoint(deps) },
            );
            return { models };
          } catch (error) {
            throw new ORPCError("BAD_REQUEST", {
              message: error instanceof Error ? error.message : "Could not list models",
            });
          }
        },
      ),
      probeCatalog: authed.models.probeCatalog.handler(async ({ context, input }) => {
        try {
          const models = await probeCatalogProviderModels(
            { provider: input.provider, apiKey: input.apiKey },
            deps.modelConnectionFetch,
            context.signal,
          );
          return { models };
        } catch (error) {
          throw new ORPCError("BAD_REQUEST", {
            message: error instanceof Error ? error.message : "Could not list models",
          });
        }
      }),
      beginOAuth: authed.models.beginOAuth.handler(async ({ context, input }) => {
        // An older app's sign-in renews the provider's newest connection, bound now so a
        // disconnect of that connection retires it and it never lands on another one.
        const target = await modelConnectionTarget(
          deps,
          context.actor,
          input.provider,
          input.credentialId,
        );
        return deps.oauthLogins.begin({
          userId: context.actor.userId,
          spaceId: context.actor.spaceId,
          provider: input.provider,
          credentialId: target?.id ?? null,
          modelId: input.modelId,
          thinkingLevel: input.thinkingLevel,
          makeDefault: input.makeDefault,
          settingsScope: input.scope,
          label: input.label,
          codePage: input.codePage,
          signal: context.signal,
        });
      }),
      submitOAuthCode: authed.models.submitOAuthCode.handler(async ({ context, input }) => {
        return deps.oauthLogins.submit(input.loginId, context.actor, input.code);
      }),
      completeOAuth: authed.models.completeOAuth.handler(async ({ context, input }) => {
        const result = await deps.oauthLogins.complete(input.loginId, {
          userId: context.actor.userId,
          spaceId: context.actor.spaceId,
        });
        return result.status === "connected" ? { status: "ready" as const } : result;
      }),
      finishOAuth: authed.models.finishOAuth.handler(async ({ context, input }) => {
        throwIfAborted(context.signal);
        const result = await deps.oauthLogins.finish(
          input.loginId,
          context.actor,
          async (login) => {
            const target = await modelConnectionTarget(
              deps,
              context.actor,
              login.provider,
              login.credentialId,
            );
            return persistModelCredential(
              deps,
              context.actor,
              {
                provider: login.provider,
                credentialId: target?.id ?? null,
                plaintext: serializeModelSecret({ kind: "oauth", credential: login.credential }),
                // A second account is told apart by the email it signed in with.
                label:
                  oauthCredentialEmail(login.credential) ??
                  login.label ??
                  listPiCatalog().find((entry) => entry.provider === login.provider)?.providerName,
                modelId: login.modelId,
                thinkingLevel: login.thinkingLevel,
                makeDefault: login.makeDefault,
                scope: login.settingsScope,
                signal: login.signal,
              },
              codexCatalog,
            );
          },
        );
        if (result.status === "pending") {
          throw new ORPCError("CONFLICT", { message: "Sign-in has not finished yet." });
        }
        if (result.status === "error") {
          throw new ORPCError("NOT_FOUND", { message: result.error });
        }
        return result.value;
      }),
      cancelOAuth: authed.models.cancelOAuth.handler(async ({ context, input }) => {
        await deps.oauthLogins.cancel(input.loginId, context.actor);
        return { ok: true as const };
      }),
      setDefault: authed.models.setDefault.handler(async ({ context, input }) => {
        const modelId = usableModelId(input.modelId);
        if (!modelId) throw new ORPCError("BAD_REQUEST", { message: "Choose a model" });
        // An omitted level keeps the one this model already has in the main list: on the
        // chosen connection first, then on another, as writeModelRole does.
        const savedChoices = async (
          client: Pick<
            PrismaClient,
            "spaceModelRoleChoice" | "userModelRoleChoice" | "spaceSettingOverride"
          >,
        ) => {
          const main = await appliedModelRole(client, context.actor, "main");
          const key = backupChoiceKey({ provider: input.provider, modelId });
          return [...(main.primary ? [main.primary] : []), ...main.backups].filter(
            (choice) => backupChoiceKey(choice) === key,
          );
        };
        const loadModelState = async (
          client: Pick<PrismaClient, "userModelPreference" | "userModelCredential">,
        ) => {
          const [preferences, credentials] = await Promise.all([
            client.userModelPreference.findMany({
              where: {
                userId: context.actor.userId,
                credential: { provider: modelCredentialProviderFilter(input.provider) },
              },
              include: { credential: true },
            }),
            client.userModelCredential.findMany({
              where: {
                userId: context.actor.userId,
                provider: modelCredentialProviderFilter(input.provider),
              },
            }),
          ]);
          return {
            preferences,
            candidates: defaultModelCredentialCandidates({
              provider: input.provider,
              modelId: input.modelId,
              preferences,
              credentials,
            }),
          };
        };
        await withSerializableRetry(async () => {
          const preparedState = await loadModelState(deps.prisma);
          const preparedAuth = new Map(
            await Promise.all(
              preparedState.candidates.map(
                async (candidate) =>
                  [
                    candidate.secretId,
                    await prepareStoredModelAuth(
                      deps.prisma,
                      deps.secrets,
                      context.actor.userId,
                      candidate.secretId,
                      input.provider,
                      input.modelId,
                      codexCatalog,
                      {
                        onExpiredToken: () =>
                          refreshExpiredCredential(
                            context.actor,
                            candidate.secretId,
                            input.provider,
                          ),
                      },
                    ),
                  ] as const,
              ),
            ),
          );
          const needsThinking =
            input.thinkingLevel === undefined
              ? (await savedChoices(deps.prisma)).some((choice) => Boolean(choice.thinkingLevel))
              : Boolean(input.thinkingLevel);
          const compatible = input.provider === OPENAI_COMPATIBLE_PROVIDER_ID;
          // Compatible defaults always load the secret so the transaction rechecks it.
          const thinking =
            needsThinking || compatible
              ? await prepareAllowedThinkingLevels(
                  deps,
                  context.actor,
                  input.provider,
                  input.modelId,
                )
              : { allowed: undefined, secret: undefined };
          if (compatible) {
            await assertCompatibleDefaultChange(deps, context.actor, modelId, thinking);
          }
          return deps.prisma.$transaction(
            async (tx) => {
              const { preferences, candidates } = await loadModelState(tx);
              if (candidates.length === 0) {
                throw new ORPCError("NOT_FOUND", {
                  message: `No model credential is connected for ${input.provider}.`,
                });
              }
              if (thinking.secret) {
                const current = await tx.secret.findFirst({
                  where: { id: thinking.secret.id, userId: context.actor.userId, spaceId: null },
                  select: { ciphertext: true },
                });
                if (current?.ciphertext !== thinking.secret.ciphertext) {
                  throw new ORPCError("CONFLICT", { message: "Model credentials changed; retry." });
                }
              }
              const savedModelId = new Map(
                preferences.map((preference) => [preference.credential.id, preference.modelId]),
              );
              const readyIds: string[] = [];
              let authFailure: string | undefined;
              let sawReadable = false;
              for (const candidate of candidates) {
                const prepared = preparedAuth.get(candidate.secretId);
                const current = await tx.secret.findFirst({
                  where: { id: candidate.secretId, userId: context.actor.userId, spaceId: null },
                  select: { id: true, ciphertext: true },
                });
                if (!prepared || (current?.ciphertext ?? null) !== prepared.ref) {
                  throw new ORPCError("CONFLICT", { message: "Model credentials changed; retry." });
                }
                const auth = prepared.auth;
                if (auth.status === "unreadable") continue;
                sawReadable = true;
                if (auth.status === "rejected") {
                  authFailure ??= auth.message;
                  continue;
                }
                // The enabled-list check and execution must use the same connection.
                if (compatible && thinking.secret && candidate.secretId !== thinking.secret.id)
                  continue;
                readyIds.push(candidate.id);
              }
              const chosenId = selectDefaultCredentialId({
                provider: input.provider,
                modelId: input.modelId,
                orderedIds: candidates.map((candidate) => candidate.id),
                readyIds,
                savedModelId: (credentialId) => savedModelId.get(credentialId),
              });
              const fallbackId = !sawReadable ? candidates[0]?.id : undefined;
              const credentialId = chosenId ?? fallbackId;
              if (!credentialId) {
                throw new ORPCError("BAD_REQUEST", {
                  message: authFailure ?? UNAVAILABLE_MODEL_FOR_AUTH_MESSAGE,
                });
              }
              const saved = input.thinkingLevel === undefined ? await savedChoices(tx) : [];
              let thinkingLevel: string | null =
                input.thinkingLevel === undefined
                  ? ((saved.find((choice) => choice.credentialId === credentialId) ?? saved[0])
                      ?.thinkingLevel ?? null)
                  : input.thinkingLevel;
              if (thinkingLevel) {
                if (!needsThinking) {
                  throw new ORPCError("CONFLICT", { message: "Model preferences changed; retry." });
                }
                thinkingLevel = clampCatalogThinkingLevel(thinkingLevel, thinking.allowed);
              }
              await writeModelRole(tx, await modelRoleTarget(tx, context.actor), "main", {
                primary: {
                  provider: input.provider,
                  modelId,
                  thinkingLevel: thinkingLevel as ThinkingLevel | null,
                  credentialId,
                },
              });
              // Older apps edit one model per connection here, so it becomes the connection's own.
              await saveModelPreference(tx, context.actor, credentialId, modelId, thinkingLevel);
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          );
        }).catch((error: unknown) => {
          if (error instanceof SecretStoreUnavailableError)
            throw new ORPCError("SERVICE_UNAVAILABLE", { cause: error });
          throw error;
        });
        return { ok: true as const };
      }),
      rename: authed.models.rename.handler(async ({ context, input }) => {
        const renamed = await deps.prisma.userModelCredential.updateMany({
          where: { id: input.credentialId, userId: context.actor.userId },
          data: { label: input.label },
        });
        if (renamed.count === 0)
          throw new ORPCError("NOT_FOUND", { message: "Connection not found" });
        return { ok: true as const };
      }),
      disconnect: authed.models.disconnect.handler(async ({ context, input }) => {
        // Retire pending sign-ins in every space first — the credentials are
        // account-wide, so a finishing OAuth session anywhere could otherwise
        // re-persist a credential the delete below just removed. Removing one
        // connection leaves sign-ins that add another account running.
        await deps.oauthLogins.cancelProvider({
          userId: context.actor.userId,
          provider: input.provider,
          credentialId: input.credentialId,
        });
        await withSerializableRetry(() =>
          deps.prisma.$transaction(
            async (tx) => {
              const provider = modelCredentialProviderFilter(input.provider);
              const connections = await tx.userModelCredential.findMany({
                where: { userId: context.actor.userId, provider },
              });
              // Older apps disconnect every connection of the provider.
              const existing = input.credentialId
                ? connections.filter((row) => row.id === input.credentialId)
                : connections;
              if (input.credentialId && existing.length === 0) return;
              const ids = existing.map((row) => row.id);
              const lastConnection = existing.length === connections.length;
              const roleRows = {
                userId: context.actor.userId,
                provider,
                OR: [
                  { credentialId: { in: ids } },
                  // Rows that name no connection ran on the provider's last one.
                  ...(lastConnection ? [{ credentialId: null }] : []),
                ],
              };
              // Its models leave every purpose in the account's models and every Space's,
              // like the connection itself; the tenant scope would otherwise limit the
              // Space deletes to the active Space.
              await tx.userModelRoleChoice.deleteMany({ where: roleRows });
              await runAsSystemInTransaction(
                tx,
                "disconnect a model connection from every Space",
                async () => {
                  await tx.spaceModelRoleChoice.deleteMany({ where: roleRows });
                },
              );
              if (existing.length === 0) return;
              // Credentials belong to the account, not the space — disconnecting
              // removes them everywhere, matching voice.disconnect. Their own models
              // go with them.
              await tx.userModelCredential.deleteMany({
                where: { userId: context.actor.userId, id: { in: ids } },
              });
              for (const row of existing) {
                await deleteUnreferencedCredentialSecret(tx, {
                  credentialKind: "model",
                  credentialId: row.id,
                  secretId: row.secretId,
                });
              }
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          ),
        );
        (deps.providerCatalog ?? providerCatalogCache).invalidate(
          canonicalPiProviderId(input.provider),
        );
        return { ok: true as const };
      }),
    },
  };
}
