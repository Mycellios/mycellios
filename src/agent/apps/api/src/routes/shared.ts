import type { AdapterContext } from "@mycellios/adapter-kit";
import {
  defaultLocalEngine,
  deploymentModelRole,
  discoverNativeEngines,
  signedOutEngines,
  findConnectedModelCredential,
  hasHostedModelCredits,
  hostCredentialSource,
  nativeEngineModels,
  nativeHostAccess,
  resolveMemberMainModel,
} from "@mycellios/adapters";
import type { Actor, Me, NativeEngineModelInfo } from "@mycellios/contracts";
import { attachmentMaxBytes, canonicalPiProviderId, NativeEngineModelSchema, usableModelId } from "@mycellios/contracts";
import type { RouterDeps } from "../router.js";

export function computerContext(actor: Actor, botId: string, operationId: string): AdapterContext {
  return {
    operationId,
    traceId: operationId,
    spaceId: actor.spaceId,
    userId: actor.userId,
    botId,
    signal: new AbortController().signal,
  };
}

const known = (ids: unknown) => (Array.isArray(ids) ? ids : []).filter(
  (id): id is "codex" | "claude" | "opencode" => id === "codex" || id === "claude" || id === "opencode",
);

/** One bounded read of the engines on the PC that runs this Mico; undefined when it does not answer. */
async function desktopEngineState(deps: RouterDeps, actor: Actor, botId: string, signal?: AbortSignal) {
  const probe = computerContext(actor, botId, "engine-discovery");
  const combined = AbortSignal.any([signal ?? probe.signal, AbortSignal.timeout(4_000)]);
  const context = { ...probe, signal: combined };
  return deps.sandbox.nativeEngineState
    ? await deps.sandbox.nativeEngineState(context).catch(() => undefined)
    : { engines: await deps.sandbox.nativeEngines?.(context).catch(() => undefined), signedOut: [], models: undefined, signedIn: undefined };
}

/**
 * The engine a new This PC Mico starts with: the first installed one, in the owner's order, whose
 * CLI on that PC confirmed a sign-in. No answer, an older Desktop or none signed in keeps Pi.
 */
export async function localEngineForNewMico(deps: RouterDeps, actor: Actor, botId: string, signal?: AbortSignal) {
  const state = await desktopEngineState(deps, actor, botId, signal);
  const engines = known(state?.engines);
  const signedOut = known(state?.signedOut);
  return defaultLocalEngine(known(state?.signedIn).filter(id => engines.includes(id) && !signedOut.includes(id)));
}

/** Inspect the Mico's selected host. A PC without a live reply offers no server engines. */
export async function codingEnginesForComputer(
  deps: RouterDeps,
  actor: Actor,
  bot: { id: string; computer?: { kind: string; scope: string } | null },
  signal?: AbortSignal,
) {
  if (bot.computer?.kind === "desktop" && bot.computer.scope !== "isolated") {
    const state = await desktopEngineState(deps, actor, bot.id, signal);
    const engines = known(state?.engines);
    const signedOut = known(state?.signedOut).filter(id => engines.includes(id));
    return {
      computer: "desktop" as const,
      engines,
      signedOut,
      models: engineModels(state?.models, engines.filter(id => !signedOut.includes(id))),
      ...(state && "account" in state && state.account === true ? { account: true } : {}),
    };
  }
  const engines = await nativeHostAccess(deps.dataDir, actor) ? await discoverNativeEngines(deps.dataDir) : [];
  const installed = engines.flatMap(({ id, available }) =>
    available && (id === "codex" || id === "claude" || id === "opencode") ? [id] : [],
  );
  const signedOut = signedOutEngines(engines) as Array<"codex" | "claude" | "opencode">;
  return {
    computer: "server" as const,
    engines: installed,
    signedOut,
    models: engineModels(nativeEngineModels(engines), installed.filter(id => !signedOut.includes(id))),
  };
}

/** Keeps only well-formed, bounded catalogs of installed, signed-in engines: a PC reports them. */
function engineModels(value: unknown, engines: string[]) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const models: { codex?: NativeEngineModelInfo[]; claude?: NativeEngineModelInfo[] } = {};
  for (const engine of ["codex", "claude"] as const) {
    const list = source[engine];
    if (!engines.includes(engine) || !Array.isArray(list)) continue;
    models[engine] = list.slice(0, 128).flatMap(entry => {
      const parsed = NativeEngineModelSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
  }
  return models;
}

function hostCredentials(active: boolean, provider: string) {
  return active
    ? { hostCredentialProvider: provider, hostCredentialSource: hostCredentialSource(provider) }
    : { hostCredentialProvider: null, hostCredentialSource: null };
}

export async function meDto(deps: RouterDeps, actor: Actor): Promise<Me> {
  const [user, setup] = await Promise.all([
    deps.prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      include: { signupSurvey: { select: { userId: true } } },
    }),
    modelSetup(deps, actor),
  ]);
  return {
    ticketBoardEnabled: deps.env.ticketBoardEnabled === true,
    phoneCallsEnabled: deps.env.phoneCallsEnabled === true,
    // Present only while on, so clients keep the Space settings they show today.
    ...(deps.env.spaceMembers ? { spaceMembersEnabled: true } : {}),
    maxUploadSizeBytes: attachmentMaxBytes(deps.env),
    userId: actor.userId,
    email: user.email,
    name: user.name,
    spaceId: actor.spaceId,
    isDeploymentOwner: false,
    needsModel: setup.needsModel,
    defaultProvider: setup.model ? canonicalPiProviderId(setup.model.provider) : null,
    defaultModel: setup.model?.modelId ?? null,
    // Set only while the active default is the deployment's own, running on host credentials.
    ...hostCredentials(
      Boolean(setup.deployment) &&
        !setup.main &&
        !setup.settings?.defaultModelProvider &&
        Boolean(deps.env.deploymentModelHostCredentials),
      deps.env.defaultProvider,
    ),
    computerHost: computerHostFor(setup.settings?.computerHost, deps.env.sandboxProvider),
    canChooseHostComputer:
      Boolean(deps.env.desktopHostChoiceEnabled) && deps.env.sandboxProvider === "docker",
    sandboxProvider: deps.env.sandboxProvider,
    avatarStyle: "organic",
    timezone: user.timezone ?? null,
    billingEnabled: Boolean(deps.billing),
    // Only billing deployments ask; self-hosted installs never see the survey.
    needsSignupSurvey: Boolean(deps.billing) && !user.signupSurvey,
  };
}

/** A direct Mico can use its own connection without an account-level model. */
export async function threadNeedsModel(
  deps: RouterDeps,
  actor: Actor,
  bot?: { modelProvider?: string | null; modelId?: string | null },
): Promise<boolean> {
  if (!(await modelSetup(deps, actor)).needsModel) return false;
  const provider = bot?.modelProvider && canonicalPiProviderId(bot.modelProvider);
  const modelId = usableModelId(bot?.modelId);
  if (!provider || !modelId) return true;
  if (
    deps.billing?.modelCreditsEnabled &&
    provider === canonicalPiProviderId(deps.env.defaultProvider) &&
    (await hasHostedModelCredits(deps.prisma, actor, provider))
  ) return false;
  return !(await findConnectedModelCredential(deps.prisma, deps.secrets, actor, provider, modelId));
}

function computerHostFor(
  stored: string | null | undefined,
  sandboxProvider: string,
): "docker" | "this-mac" | null {
  if (sandboxProvider === "desktop") return "this-mac";
  if (sandboxProvider !== "docker") return null;
  if (stored === "this-mac" || stored === "docker") return stored;
  return null;
}

/** The main model chat runs: the member's while it can run, else the deployment's. */
export async function modelSetup(deps: RouterDeps, actor: Actor) {
  const [member, settings] = await Promise.all([
    resolveMemberMainModel({ prisma: deps.prisma, secretStore: deps.secrets }, actor),
    deps.prisma.deploymentSettings.findUnique({ where: { id: "default" } }),
  ]);
  const main =
    member &&
    (member.credential ||
      (deps.billing?.modelCreditsEnabled &&
        (await hasHostedModelCredits(deps.prisma, actor, member.provider))))
      ? member
      : null;
  const funding = deps.billing ? await deps.billing.status(actor) : null;
  const hasDeployment =
    // First-party accounts use their own Credits and owned connection. A host
    // fallback must not bypass their Mycellios setup or silently fund a new user.
    !deps.env.mycelliosSso &&
    Boolean(deps.env.deploymentModelConfigured) &&
    (!funding?.creditPurchasesEnabled || funding.funding === "credits");
  const deployment =
    hasDeployment || deps.env.agentRuntime === "scripted"
      ? deploymentModelRole("main", {
          settings,
          deployment: { provider: deps.env.defaultProvider, model: deps.env.defaultModel },
        }).primary
      : null;
  return {
    main,
    deployment,
    model: main ?? deployment,
    settings,
    needsModel: deps.env.agentRuntime !== "scripted" && !main && !deployment,
  };
}

export const THREAD_MESSAGE_PAGE_SIZE = 100;

/** Silence longer than this on a thread stream is indistinguishable from a dead socket. */
export const HEARTBEAT_MS = 20_000;

/** A thread stream re-checks its session at least this often while it delivers. */
export const SESSION_RECHECK_MS = 10_000;

export function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

export function isRecordNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2025");
}
