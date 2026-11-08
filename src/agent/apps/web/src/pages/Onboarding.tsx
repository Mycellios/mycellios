import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { ModelHeaderRow, ThinkingLevel } from "@rakazo/contracts";
import {
  ANTSEED_PROVIDER_ID,
  CLOUDFLARE_AI_GATEWAY_PROVIDER_ID,
  cloudflareModelRouting,
  DEFAULT_MODEL_CONTEXT_WINDOW,
  FIRST_MICO_SPAWN_KEY,
  isCloudflareModelProvider,
  isMycelliosBaseUrl,
  isOllamaCloudBaseUrl,
  isOpenAiCompatibleProvider,
  MAX_MODEL_CONTEXT_WINDOW,
  MAX_MODEL_MAX_TOKENS,
  ModelHeaderRowsSchema,
  modelHeadersInput,
  OLLAMA_CLOUD_BASE_URL,
  OPENAI_COMPATIBLE_PROVIDER_ID,
  openAiCompatibleConnectReady,
  openAiCompatibleProbeSuccessMessage,
  parseModelContextWindow,
  parseModelMaxImagesPerPrompt,
  parseModelMaxTokens,
  productBrand,
} from "@rakazo/contracts";
import {
  COMPATIBLE_THINKING_LEVELS,
  clampCatalogThinkingLevel,
  createModelProbe,
  initialModelProbeState,
  pickCatalogModelId,
  popularModelProvidersFirst,
} from "@rakazo/core";
import {
  Button,
  Input,
  ModelThinkingOptions,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@rakazo/ui-web";
import { Check, Copy } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ModelPreflightFeedback,
  modelPreflightTestingLabel,
} from "../components/ModelConnectionPreflightNotice";
import { ModelHeadersEditor } from "../components/ModelHeadersEditor";
import { MycelliosWordmark } from "../components/MycelliosBrand";
import { PageLoading } from "../components/PageLoading";
import { SignupSurvey } from "../components/SignupSurvey";
import { appPath } from "../lib/app-path";
import { fetchAuthCapabilities } from "../lib/auth-capabilities";
import { useCopyText } from "../lib/copy-text";
import { hostedAntseedGateway } from "../lib/hosted-antseed-gateway";
import { providerDisplayName } from "../lib/localized-provider-hint";
import type { ModelCatalogEntry } from "../lib/model-auth";
import type { ModelPreflightFailure } from "../lib/model-connection-preflight";
import {
  classifyModelConnectionFailure,
  modelPreflightSuccessMessage,
  runModelConnectionPreflight,
  unavailableSelectedModel,
} from "../lib/model-connection-preflight";
import { rpc } from "../lib/rpc";
import { useModelOAuthSignIn } from "../lib/use-model-oauth-signin";
import { errorText } from "../lib/user-error";
import { CompatibleKeyField } from "./model-settings/compatible-key-field";
import { OnboardingImport } from "./onboarding-import";
import { InstalledAgentOnboarding } from "./shell/agent-engine-settings";

const CUSTOM_MODEL_OPTION = "__rakazo_custom_model__";
/** Rakazo credits sit among the providers as the one choice that needs no account of its own. */
const CREDITS_OPTION = "__rakazo_credits__";
/** A provider whose catalog entry offers both sign-in and a key appears once per way to connect. */
type ProviderAuth = "sign-in" | "key";

const MAIN_PROVIDER_OPTIONS: ReadonlyArray<{ provider: string; auth?: ProviderAuth }> = [
  { provider: "openai-codex" },
  { provider: "anthropic", auth: "sign-in" },
  { provider: "openai" },
  { provider: "anthropic", auth: "key" },
  { provider: "openrouter" },
  { provider: "google" },
];

function providerOptionValue(provider: string, auth?: ProviderAuth): string {
  return auth ? `${provider}:${auth}` : provider;
}
const FIRST_BOT_NAME = productBrand.companionName;
const FIRST_BOT_LOCK = "rakazo:onboarding-first-bot";

function findFirstBot(
  bots: Array<{ id: string; name: string; spawnKey: string | null }>,
): { id: string } | undefined {
  const bySpawnKey = bots.find((bot) => bot.spawnKey === FIRST_MICO_SPAWN_KEY);
  if (bySpawnKey) return { id: bySpawnKey.id };
  // Legacy first-run Chief created before spawnKey was set.
  const byName = bots.find((bot) => bot.name === FIRST_BOT_NAME);
  return byName ? { id: byName.id } : undefined;
}

async function withFirstBotLock<T>(run: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return run();
  return locks.request(FIRST_BOT_LOCK, run);
}

export function OnboardingPage() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const fieldId = useId();
  // The URL holds the survey and model steps, so /onboarding/survey and /onboarding/model open directly.
  const { step: routeStep } = useParams();
  const linkedStep = routeStep === "survey" || routeStep === "model" ? routeStep : undefined;
  const [surveyDone, setSurveyDone] = useState(false);
  const step = surveyDone ? "loading" : (linkedStep ?? "loading");
  const [billingEnabled, setBillingEnabled] = useState(false);
  // The step after the survey; null until me loads.
  const [afterSurvey, setAfterSurvey] = useState<"model" | "bot" | null>(null);
  const [mycelliosSignIn, setMycelliosSignIn] = useState<boolean | null>(null);
  const [connectingMycellios, setConnectingMycellios] = useState(false);
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const [provider, setProvider] = useState<string>(OPENAI_COMPATIBLE_PROVIDER_ID);
  const [providerAuth, setProviderAuth] = useState<ProviderAuth | undefined>();
  const [credits, setCredits] = useState(false);
  const [modelId, setModelId] = useState("");
  const modelIdRef = useRef(modelId);
  modelIdRef.current = modelId;
  const [apiKey, setApiKey] = useState("");
  const [advancedSetup, setAdvancedSetup] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [gatewayId, setGatewayId] = useState("");
  const [baseUrl, setBaseUrl] = useState<string>(productBrand.apiBaseUrl);
  const [headerRows, setHeaderRows] = useState<ModelHeaderRow[] | null>(null);
  const [reasoning, setReasoning] = useState(false);
  const [manualModelId, setManualModelId] = useState(false);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel | null>(null);
  const [maxTokens, setMaxTokens] = useState("");
  const [contextWindow, setContextWindow] = useState(String(DEFAULT_MODEL_CONTEXT_WINDOW));
  const [supportsImages, setSupportsImages] = useState(false);
  const [maxImagesPerPrompt, setMaxImagesPerPrompt] = useState("");
  const [{ models: probeModels, probing }, setProbe] = useState(initialModelProbeState);
  const [modelProbe] = useState(() => createModelProbe(setProbe));
  const resetOpenAiCompatibleProbe = modelProbe.reset;
  // An imported agent replaces Chief as the first bot.
  const [importing, setImporting] = useState(false);
  const importedBotRef = useRef<{ id: string } | null>(null);
  // Mirrors importedBotRef for rendering; the ref serves the async flow.
  const [importedBotId, setImportedBotId] = useState<string | null>(null);
  // Another tab or device made the first bot before the import could.
  const [notImported, setNotImported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preflightTesting, setPreflightTesting] = useState(false);
  const [preflightTarget, setPreflightTarget] = useState<"api-key" | "compatible" | null>(null);
  const [preflightSuccess, setPreflightSuccess] = useState<string | null>(null);
  const [preflightFailure, setPreflightFailure] = useState<ModelPreflightFailure | null>(null);
  const preflightRevisionRef = useRef(0);
  const [codeCopied, copyOAuthCode] = useCopyText();

  const {
    oauth,
    pasteCode,
    setPasteCode,
    oauthPending,
    popupBlocked,
    cancelOAuthAttempt,
    startSubscriptionSignIn,
    submitOAuthCode,
  } = useModelOAuthSignIn({
    onClearError: () => setError(null),
    onError: setError,
    onFinished: async () => {
      goTo("bot");
    },
  });

  useEffect(() => {
    void fetchAuthCapabilities()
      .then((caps) => setMycelliosSignIn(caps.mycelliosAccount === true))
      .catch(() => setMycelliosSignIn(false));
    void Promise.all([rpc.me(), rpc.models.list().catch(() => [])])
      .then(([me, models]) => {
        setBillingEnabled(me.billingEnabled);
        setCatalog(models);
        const next = me.needsModel ? "model" : "bot";
        setAfterSurvey(next);
        if (!linkedStep) goTo(me.needsSignupSurvey ? "survey" : next);
      })
      .catch(() => {
        setAfterSurvey("bot");
        if (!linkedStep) goTo("bot");
      });
    return () => {
      modelProbe.invalidate();
    };
  }, []);

  useEffect(() => {
    if (!surveyDone || !afterSurvey) return;
    setSurveyDone(false);
    goTo(afterSurvey);
  }, [surveyDone, afterSurvey]);

  function goTo(next: "survey" | "model" | "bot") {
    const imported = importedBotRef.current;
    navigate(next === "bot" ? (imported ? `/app/${imported.id}` : "/app") : `/onboarding/${next}`, { replace: true });
  }

  const providers = useMemo(() => {
    const seen = new Map<string, ModelCatalogEntry>();
    for (const entry of catalog) {
      if (!seen.has(entry.provider)) seen.set(entry.provider, entry);
    }
    return popularModelProvidersFirst([...seen.values()], (entry) => entry.provider);
  }, [catalog]);

  const modelsForProvider = useMemo(
    () => catalog.filter((entry) => entry.provider === provider),
    [catalog, provider],
  );

  const selected = modelsForProvider.find((entry) => entry.id === modelId) ?? modelsForProvider[0];
  const isOpenAiCompatible = isOpenAiCompatibleProvider(provider);
  const isMycellios = isOpenAiCompatible && isMycelliosBaseUrl(baseUrl);
  const accountSetup =
    isMycellios && !advancedSetup && (Boolean(hostedAntseedGateway()) || mycelliosSignIn === true);
  const simpleAntseed =
    provider === ANTSEED_PROVIDER_ID && Boolean(hostedAntseedGateway()) && !advancedSetup;
  const isCloudflareGateway = provider === CLOUDFLARE_AI_GATEWAY_PROVIDER_ID;
  const isCloudflare = isCloudflareModelProvider(provider);
  const cloudflareRoutingReady =
    !isCloudflare || cloudflareModelRouting({ provider, accountId, gatewayId }) !== undefined;
  const subscriptionSignIn = selected?.signIn !== undefined && providerAuth !== "key";
  const acceptsKey = selected?.auth !== "oauth" && providerAuth !== "sign-in";
  const signInLabel = selected?.oauthLabel ?? t`Sign in`;
  const openAiCompatibleReady = openAiCompatibleConnectReady({
    requiresKey: provider === ANTSEED_PROVIDER_ID,
    apiKey,
    baseUrl,
    modelId:
      headerRows !== null && !ModelHeaderRowsSchema.safeParse(headerRows).success ? "" : modelId,
  });
  const canSaveModel = Boolean(
    selected &&
      modelId.trim() &&
      !oauthPending &&
      !savingModel &&
      cloudflareRoutingReady &&
      (isOpenAiCompatible ? openAiCompatibleReady : acceptsKey && apiKey.trim()),
  );
  const otherModelLabel = t`Other model…`;
  // Subscriptions and the common API providers first; every other provider follows.
  const providerOptions = useMemo(() => {
    const byId = new Map(providers.map((entry) => [entry.provider, entry]));
    // Beside the subscriptions, the key-based options say API.
    const optionLabel = (id: string, auth?: ProviderAuth) => {
      if (id === "anthropic" && auth === "key") return t`Anthropic API`;
      if (id === "openai") return t`OpenAI API`;
      return providerDisplayName(id, byId.get(id)?.providerName ?? id, auth);
    };
    const main = [
      ...(billingEnabled ? [{ value: CREDITS_OPTION, label: t`Rakazo credits` }] : []),
      ...MAIN_PROVIDER_OPTIONS.filter((option) => byId.has(option.provider)).map((option) => ({
        value: providerOptionValue(option.provider, option.auth),
        label: optionLabel(option.provider, option.auth),
      })),
    ];
    if (byId.has(OPENAI_COMPATIBLE_PROVIDER_ID))
      main.unshift({ value: "mycellios-preset", label: productBrand.shortName });
    const rest = providers
      .filter(
        (entry) => !MAIN_PROVIDER_OPTIONS.some((option) => option.provider === entry.provider),
      )
      .flatMap((entry) => {
        const item = { value: entry.provider, label: entry.providerName ?? entry.provider };
        return isOpenAiCompatibleProvider(entry.provider)
          ? [item, { value: "ollama-preset", label: t`Ollama Cloud` }]
          : [item];
      });
    return { main, rest };
  }, [billingEnabled, providers, t]);
  // Base UI Select.Value only resolves labels when Root gets `items`.
  const providerItems = useMemo(
    () => [...providerOptions.main, ...providerOptions.rest],
    [providerOptions],
  );
  const modelItems = useMemo(
    () => modelsForProvider.map((entry) => ({ value: entry.id, label: entry.label })),
    [modelsForProvider],
  );
  const probeModelItems = useMemo(
    () => [
      ...probeModels.map((id) => ({ value: id, label: id })),
      { value: CUSTOM_MODEL_OPTION, label: otherModelLabel },
    ],
    [otherModelLabel, probeModels],
  );

  function invalidatePreflight() {
    preflightRevisionRef.current += 1;
    setPreflightTesting(false);
    setPreflightTarget(null);
    setPreflightSuccess(null);
    setPreflightFailure(null);
  }

  function updateBaseUrl(nextBaseUrl: string) {
    setBaseUrl(nextBaseUrl);
    setHeaderRows(null);
    // Keep Other model… mode across URL edits; only provider change clears it.
    resetOpenAiCompatibleProbe();
    invalidatePreflight();
    setError(null);
    setNotice(null);
  }

  function updateApiKey(nextApiKey: string) {
    setApiKey(nextApiKey);
    if (simpleAntseed) setModelId("");
    resetOpenAiCompatibleProbe();
    invalidatePreflight();
  }

  function selectProvider(option: string, presetBaseUrl?: string) {
    if (
      option === providerOptionValue(provider, providerAuth) &&
      !presetBaseUrl &&
      !isOllamaCloudBaseUrl(baseUrl) &&
      !isMycelliosBaseUrl(baseUrl)
    )
      return;
    const [nextProvider = option, auth] = option.split(":") as [string, ProviderAuth?];
    cancelOAuthAttempt();
    setProvider(nextProvider);
    setProviderAuth(auth);
    setApiKey("");
    setHeaderRows(null);
    setAccountId("");
    setGatewayId("");
    setModelId(
      isOpenAiCompatibleProvider(nextProvider) ? "" : pickCatalogModelId(catalog, nextProvider),
    );
    setBaseUrl(
      presetBaseUrl ?? (nextProvider === ANTSEED_PROVIDER_ID ? hostedAntseedGateway() : ""),
    );
    setReasoning(false);
    setThinkingLevel(null);
    setManualModelId(false);
    setSupportsImages(false);
    setMaxTokens("");
    setContextWindow(String(DEFAULT_MODEL_CONTEXT_WINDOW));
    setMaxImagesPerPrompt("");
    resetOpenAiCompatibleProbe();
    invalidatePreflight();
    setError(null);
    setNotice(null);
  }

  function preflightStillCurrent(revision: number): boolean {
    return revision === preflightRevisionRef.current;
  }

  async function probeServerModels() {
    if (!baseUrl.trim()) return;
    const revision = preflightRevisionRef.current;
    setError(null);
    setNotice(null);
    setPreflightSuccess(null);
    setPreflightFailure(null);
    setPreflightTarget("compatible");
    await modelProbe.probe({
      baseUrl,
      apiKey,
      request: (input) =>
        rpc.models.probeOpenAiCompatible({
          ...(provider === ANTSEED_PROVIDER_ID ? { provider } : {}),
          ...input,
          headers: modelHeadersInput(headerRows),
        }),
      onSuccess: (models) => {
        if (!preflightStillCurrent(revision)) return;
        if (simpleAntseed && models.length === 0) {
          setPreflightTarget(null);
          setError(
            t`No models are available with this key. Check your AntSeed account or try another key.`,
          );
          return;
        }
        const trimmed = modelIdRef.current.trim();
        const next = trimmed || models[0] || "";
        if (next !== trimmed) setThinkingLevel(null);
        // Stay in manual entry across re-probes so a typed id that matches a
        // discovered model cannot yank the freeform field back to the Select.
        setManualModelId(
          (wasManual) => wasManual || (Boolean(trimmed) && !models.includes(trimmed)),
        );
        setModelId(next);
        const unavailable = unavailableSelectedModel(trimmed, models);
        if (unavailable) {
          setPreflightFailure(unavailable);
          setNotice(null);
          return;
        }
        setPreflightTarget(null);
        setPreflightFailure(null);
        setNotice(openAiCompatibleProbeSuccessMessage(models.length));
      },
      onError: (err) => {
        if (!preflightStillCurrent(revision)) return;
        setPreflightFailure(classifyModelConnectionFailure(err, { modelId }));
        setNotice(null);
      },
    });
  }

  async function testApiKeyConnection() {
    if (!selected?.catalogProbe) return;
    const revision = preflightRevisionRef.current;
    setPreflightTarget("api-key");
    setPreflightTesting(true);
    setPreflightSuccess(null);
    setPreflightFailure(null);
    setError(null);
    setNotice(null);
    const result = await runModelConnectionPreflight({
      authKind: "api-key",
      provider: selected.provider,
      apiKey,
      modelId: selected.id,
      catalogProbe: true,
      probeCatalog: rpc.models.probeCatalog,
    });
    if (!preflightStillCurrent(revision)) return;
    setPreflightTesting(false);
    if (result.ok) {
      setPreflightSuccess(modelPreflightSuccessMessage(result.discoveredModels.length));
      return;
    }
    setPreflightFailure(result.failure);
  }

  function stagedThinkingLevel(): ThinkingLevel | null {
    return clampCatalogThinkingLevel(
      thinkingLevel,
      reasoning ? COMPATIBLE_THINKING_LEVELS : [],
    ) as ThinkingLevel | null;
  }

  async function saveModel() {
    if (!canSaveModel) return;
    setSavingModel(true);
    setError(null);
    try {
      if (isOpenAiCompatible) {
        const parsedMaxImagesPerPrompt = parseModelMaxImagesPerPrompt(
          maxImagesPerPrompt,
          supportsImages,
        );
        if (supportsImages && maxImagesPerPrompt.trim() && parsedMaxImagesPerPrompt === undefined) {
          setError(t`Enter a whole number from 1 to 1000 for the image limit.`);
          return;
        }
        const maxImagesPerPromptInput =
          supportsImages && !maxImagesPerPrompt.trim() ? null : parsedMaxImagesPerPrompt;

        const parsedMaxTokens = parseModelMaxTokens(maxTokens);
        if (maxTokens.trim() && parsedMaxTokens === undefined) {
          setError(
            t`Enter a whole number from 1 to ${MAX_MODEL_MAX_TOKENS} for maximum output tokens.`,
          );
          return;
        }
        const parsedContextWindow = parseModelContextWindow(contextWindow);
        if (parsedContextWindow === undefined) {
          setError(
            t`Enter a whole number from 1 to ${MAX_MODEL_CONTEXT_WINDOW} for the context limit.`,
          );
          return;
        }
        await rpc.models.connect({
          provider,
          baseUrl: baseUrl.trim(),
          headers: modelHeadersInput(headerRows),
          modelId: modelId.trim(),
          reasoning,
          thinkingLevel: stagedThinkingLevel(),
          maxTokens: parsedMaxTokens ?? null,
          contextWindow: parsedContextWindow,
          supportsImages,
          maxImagesPerPrompt: maxImagesPerPromptInput,
          apiKey: apiKey.trim() || undefined,
          label: selected?.providerName ?? provider,
        });
      } else if (apiKey) {
        await rpc.models.connect({
          provider,
          apiKey,
          ...(isCloudflare ? { accountId: accountId.trim(), gatewayId: gatewayId.trim() } : {}),
          modelId,
          label: selected?.providerName ?? provider,
        });
      }
      goTo("bot");
    } catch (err) {
      setError(errorText(err, t`Could not save model`));
    } finally {
      setSavingModel(false);
    }
  }

  async function fundWithCredits() {
    setError(null);
    try {
      await rpc.billing.selectFunding({ funding: "credits" });
      window.location.assign(appPath("/onboarding"));
    } catch {
      setError(t`Could not open billing`);
    }
  }

  function beginSelectedSubscriptionSignIn() {
    if (!selected?.id) return;
    void startSubscriptionSignIn({
      provider: selected.provider,
      modelId: selected.id,
      label: selected.providerName ?? selected.provider,
    });
  }

  const compatibleKeyField = (
    <CompatibleKeyField
      required={provider === ANTSEED_PROVIDER_ID}
      className="mt-4 block text-sm text-muted-foreground"
      baseUrl={baseUrl}
    >
      <Input
        aria-label={t`API key`}
        value={apiKey}
        onChange={(e) => updateApiKey(e.target.value)}
        required={provider === ANTSEED_PROVIDER_ID || isMycellios || isOllamaCloudBaseUrl(baseUrl)}
        placeholder={
          provider === ANTSEED_PROVIDER_ID
            ? t`AntSeed API key`
            : isMycellios
              ? t`Mycellios API key`
              : isOllamaCloudBaseUrl(baseUrl)
                ? t`Ollama API key`
                : t`Optional`
        }
        type="password"
        autoComplete="new-password"
        className="mt-2"
      />
    </CompatibleKeyField>
  );
  if (step === "loading") return <PageLoading />;

  return (
    <div className="min-h-full bg-background px-6 py-12">
      <div className="mx-auto w-full max-w-[560px]">
        <div className="mb-8">
          <MycelliosWordmark />
        </div>
        {step === "survey" && !importing ? (
          <>
            <SignupSurvey
              onDone={() => {
                setNotImported(false);
                setSurveyDone(true);
              }}
            />
            {importedBotId ? null : (
              <Button
                variant="link"
                className="mt-6 h-auto px-0 text-muted-foreground"
                onClick={() => setImporting(true)}
              >
                <Trans>Import an agent</Trans>
              </Button>
            )}
          </>
        ) : null}
        {step === "survey" && importing ? (
          <OnboardingImport
            firstBot={{
              lock: withFirstBotLock,
              existing: async () => findFirstBot(await rpc.bots.list()),
              spawnKey: FIRST_MICO_SPAWN_KEY,
            }}
            onBack={() => setImporting(false)}
            onDone={(bot, imported) => {
              if (!imported) {
                setImporting(false);
                setNotImported(true);
                return;
              }
              importedBotRef.current = bot;
              // The survey's own Continue then opens the imported bot, skipping the model
              // step when the import brought a usable connection.
              void rpc
                .me()
                .then((me) => setAfterSurvey(me.needsModel ? "model" : "bot"))
                .catch(() => undefined)
                .finally(() => {
                  setImportedBotId(bot.id);
                  setImporting(false);
                });
            }}
          />
        ) : null}
        {notImported ? (
          <div className="mb-8" data-testid="onboarding-not-imported">
            <p role="alert" className="text-sm text-destructive">
              <Trans>Your first bot already existed, so the agent was not imported.</Trans>
            </p>
          </div>
        ) : null}
        {step === "model" ? (
          <div>
            <h1 className="text-[32px] font-medium text-foreground">
              <Trans>Set up your assistant</Trans>
            </h1>
            {!isMycellios || advancedSetup ? (
              <InstalledAgentOnboarding
                onSelect={async (agentEngine) => {
                  navigate("/app", { replace: true, state: { firstMicoEngine: agentEngine } });
                }}
              />
            ) : null}
            {simpleAntseed ? (
              <form
                className="mt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (probing || savingModel) return;
                  if (probeModels.length && modelId) void saveModel();
                  else void probeServerModels();
                }}
              >
                <p className="mb-6 text-muted-foreground">
                  <Trans>Paste your AntSeed key to see the available models.</Trans>
                </p>
                <label htmlFor={`${fieldId}-simple-key`} className="block text-sm font-medium">
                  <Trans>AntSeed key</Trans>
                </label>
                <Input
                  id={`${fieldId}-simple-key`}
                  value={apiKey}
                  onChange={(event) => updateApiKey(event.target.value)}
                  type="password"
                  autoComplete="new-password"
                  placeholder={t`Paste your key`}
                  required
                  disabled={savingModel}
                  className="mt-2"
                />
                {probeModels.length ? (
                  <div className="mt-5">
                    <span className="text-sm font-medium">
                      <Trans>Choose a model</Trans>
                    </span>
                    <Select
                      value={modelId}
                      items={probeModels.map((id) => ({ value: id, label: id }))}
                      onValueChange={(value) => {
                        if (typeof value !== "string") return;
                        setModelId(value);
                        setThinkingLevel(null);
                        invalidatePreflight();
                      }}
                      disabled={savingModel}
                    >
                      <SelectTrigger aria-label={t`Choose a model`} className="mt-2 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {probeModels.map((id) => (
                            <SelectItem key={id} value={id}>
                              {id}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <ModelPreflightFeedback success={null} failure={preflightFailure} />
                {error ? (
                  <p role="alert" className="mt-3 text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
                <Button
                  type="button"
                  variant="link"
                  className="mt-3 px-0 text-muted-foreground"
                  onClick={() =>
                    selectProvider(OPENAI_COMPATIBLE_PROVIDER_ID, productBrand.apiBaseUrl)
                  }
                >
                  <Trans>Use my Mycellios credits</Trans>
                </Button>
                <Button
                  type="submit"
                  className="mt-6 w-full"
                  disabled={
                    !apiKey.trim() ||
                    probing ||
                    savingModel ||
                    (probeModels.length > 0 && !canSaveModel)
                  }
                >
                  {probing ? (
                    <Trans>Checking…</Trans>
                  ) : savingModel ? (
                    <Trans>Connecting…</Trans>
                  ) : probeModels.length ? (
                    <Trans>Start chatting</Trans>
                  ) : (
                    <Trans>Continue</Trans>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="link"
                  className="mt-3 px-0 text-muted-foreground"
                  onClick={() => setAdvancedSetup(true)}
                >
                  <Trans>Advanced setup</Trans>
                </Button>
              </form>
            ) : null}
            {accountSetup ? (
              <>
                <p className="mt-4 text-muted-foreground">
                  <Trans>Use your Mycellios credits to chat. No setup needed.</Trans>
                </p>
                <Button
                  className="mt-4 w-full"
                  disabled={connectingMycellios || mycelliosSignIn !== true}
                  onClick={async () => {
                    setConnectingMycellios(true);
                    setError(null);
                    try {
                      await rpc.models.connectMycellios();
                      goTo("bot");
                    } catch {
                      setError(
                        t`Could not connect your Mycellios credits. Try again later. No credits were spent.`,
                      );
                    } finally {
                      setConnectingMycellios(false);
                    }
                  }}
                >
                  {connectingMycellios ? <Trans>Connecting…</Trans> : <Trans>Start chatting</Trans>}
                </Button>
                {mycelliosSignIn === false ? (
                  <p role="alert" className="mt-3 text-sm text-muted-foreground">
                    <Trans>
                      Mycellios credits are temporarily unavailable. Try again later or use AntSeed.
                    </Trans>
                  </p>
                ) : null}
                <Button
                  className="mt-3"
                  variant="ghost"
                  onClick={() => selectProvider(ANTSEED_PROVIDER_ID, hostedAntseedGateway())}
                >
                  <Trans>Other options</Trans>
                </Button>
                {error ? (
                  <p role="alert" className="mt-3 text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
              </>
            ) : null}
            {simpleAntseed || accountSetup ? null : (
              <div>
                {advancedSetup && hostedAntseedGateway() ? (
                  <Button
                    type="button"
                    variant="link"
                    className="mt-4 px-0 text-muted-foreground"
                    onClick={() => {
                      if (provider !== ANTSEED_PROVIDER_ID || baseUrl !== hostedAntseedGateway())
                        selectProvider(ANTSEED_PROVIDER_ID, hostedAntseedGateway());
                      setAdvancedSetup(false);
                    }}
                  >
                    <Trans>Back to simple setup</Trans>
                  </Button>
                ) : null}
                <div className="mt-8 block text-sm font-medium text-foreground">
                  <span>
                    <Trans>Provider</Trans>
                  </span>
                  <Select
                    value={
                      isMycellios
                        ? "mycellios-preset"
                        : isOpenAiCompatible && isOllamaCloudBaseUrl(baseUrl)
                          ? "ollama-preset"
                          : provider
                            ? providerOptionValue(provider, providerAuth)
                            : null
                    }
                    onValueChange={(value) => {
                      if (typeof value !== "string" || !value) return;
                      if (value === "mycellios-preset")
                        selectProvider(OPENAI_COMPATIBLE_PROVIDER_ID, productBrand.apiBaseUrl);
                      else if (value === "ollama-preset")
                        selectProvider(OPENAI_COMPATIBLE_PROVIDER_ID, OLLAMA_CLOUD_BASE_URL);
                      else selectProvider(value);
                    }}
                    items={providerItems}
                  >
                    <SelectTrigger aria-label={t`Provider`} className="mt-2 w-full">
                      <SelectValue placeholder={t`Choose a provider`} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {providerOptions.main.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      {providerOptions.main.length && providerOptions.rest.length ? (
                        <SelectSeparator />
                      ) : null}
                      <SelectGroup>
                        {providerOptions.rest.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                {provider ? (
                  <>
                    <div className="mt-6 block text-sm text-foreground">
                      {isOpenAiCompatible ? (
                        <>
                          {isMycellios ? compatibleKeyField : null}
                          {!isMycellios ? (
                            <label htmlFor={`${fieldId}-base-url`} className="block font-medium">
                              {provider === ANTSEED_PROVIDER_ID ? (
                                <Trans>Gateway URL</Trans>
                              ) : (
                                <Trans>Server URL</Trans>
                              )}
                              <Input
                                id={`${fieldId}-base-url`}
                                value={baseUrl}
                                onChange={(e) => updateBaseUrl(e.target.value)}
                                aria-label={
                                  provider === ANTSEED_PROVIDER_ID
                                    ? t`AntSeed gateway URL`
                                    : t`OpenAI-compatible server URL`
                                }
                                placeholder={
                                  provider === ANTSEED_PROVIDER_ID
                                    ? "https://gateway.example.com/v1"
                                    : "http://127.0.0.1:8000/v1"
                                }
                                autoComplete="off"
                                className="mt-2"
                              />
                            </label>
                          ) : null}
                          <div className="mt-3">
                            <Button
                              variant="outline"
                              disabled={
                                probing ||
                                !baseUrl.trim() ||
                                ((isMycellios || provider === ANTSEED_PROVIDER_ID) &&
                                  !apiKey.trim())
                              }
                              onClick={() => void probeServerModels()}
                            >
                              {probing ? <Trans>Finding…</Trans> : <Trans>Find models</Trans>}
                            </Button>
                            {preflightTarget === "compatible" ? (
                              <ModelPreflightFeedback success={null} failure={preflightFailure} />
                            ) : null}
                          </div>
                          <div className="mt-4 block">
                            <span className="font-medium">
                              <Trans>Model</Trans>
                            </span>
                            {probeModels.length && !manualModelId ? (
                              <Select
                                value={modelId}
                                onValueChange={(value) => {
                                  if (typeof value !== "string") return;
                                  const next = value;
                                  invalidatePreflight();
                                  if (next === CUSTOM_MODEL_OPTION) {
                                    setManualModelId(true);
                                    setModelId("");
                                  } else {
                                    setManualModelId(false);
                                    setModelId(next);
                                  }
                                }}
                                items={probeModelItems}
                              >
                                <SelectTrigger
                                  aria-label={t`Models from server`}
                                  className="mt-2 w-full"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectGroup>
                                    {probeModels.map((id) => (
                                      <SelectItem key={id} value={id}>
                                        {id}
                                      </SelectItem>
                                    ))}
                                    <SelectItem value={CUSTOM_MODEL_OPTION}>
                                      <Trans>Other model…</Trans>
                                    </SelectItem>
                                  </SelectGroup>
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input
                                value={modelId}
                                onChange={(e) => {
                                  setManualModelId(true);
                                  setModelId(e.target.value);
                                  invalidatePreflight();
                                }}
                                aria-label={t`Model id`}
                                placeholder="exact-model-id"
                                className="mt-2"
                              />
                            )}
                            {probeModels.length && manualModelId ? (
                              <Button
                                variant="link"
                                size="xs"
                                className="mt-2 px-0 text-muted-foreground"
                                onClick={() => {
                                  setManualModelId(false);
                                  setModelId(probeModels[0] ?? "");
                                  invalidatePreflight();
                                }}
                              >
                                <Trans>Use a found model</Trans>
                              </Button>
                            ) : null}
                          </div>
                          <ModelThinkingOptions
                            reasoning={reasoning}
                            onReasoningChange={(value) => {
                              setReasoning(value);
                              if (!value) setThinkingLevel(null);
                            }}
                            advancedLabel={t`Advanced`}
                            thinkingLabel={t`Supports thinking`}
                            thinkingLevel={thinkingLevel}
                            onThinkingLevelChange={(value) =>
                              setThinkingLevel(value as ThinkingLevel | null)
                            }
                            thinkingLevelOptions={[
                              { value: "minimal", label: t`Minimal` },
                              { value: "low", label: t`Low` },
                              { value: "medium", label: t`Medium` },
                              { value: "high", label: t`High` },
                              { value: "xhigh", label: t`Extra high` },
                              { value: "max", label: t`Max` },
                            ]}
                            thinkingLevelLabel={t`Reasoning effort`}
                            thinkingLevelDefaultLabel={t`Default`}
                            maxTokens={maxTokens}
                            onMaxTokensChange={setMaxTokens}
                            maxTokensLabel={t`Maximum output tokens`}
                            maxTokensPlaceholder={t`Automatic`}
                            contextWindow={contextWindow}
                            onContextWindowChange={setContextWindow}
                            contextWindowLabel={t`Context limit`}
                            supportsImages={supportsImages}
                            onSupportsImagesChange={setSupportsImages}
                            imagesLabel={t`Supports images`}
                            maxImagesPerPrompt={maxImagesPerPrompt}
                            onMaxImagesPerPromptChange={setMaxImagesPerPrompt}
                            maxImagesLabel={t`Maximum images per request`}
                          >
                            <ModelHeadersEditor
                              rows={headerRows}
                              onChange={(rows) => {
                                setHeaderRows(rows);
                                resetOpenAiCompatibleProbe();
                                invalidatePreflight();
                              }}
                            />
                          </ModelThinkingOptions>
                        </>
                      ) : (
                        <>
                          <span className="font-medium">
                            <Trans>Model</Trans>
                          </span>
                          <Select
                            value={selected?.id ?? modelId}
                            onValueChange={(value) => {
                              if (typeof value !== "string" || !value) return;
                              if (value === modelId) return;
                              cancelOAuthAttempt();
                              setModelId(value);
                              setThinkingLevel(null);
                              invalidatePreflight();
                            }}
                            items={modelItems}
                          >
                            <SelectTrigger aria-label={t`Model`} className="mt-2 w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {modelsForProvider.map((entry) => (
                                  <SelectItem
                                    key={`${entry.provider}:${entry.id}`}
                                    value={entry.id}
                                  >
                                    {entry.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </>
                      )}
                    </div>
                    {subscriptionSignIn ? (
                      <div className="mt-4">
                        {oauth ? (
                          <div className="rounded-lg border border-border px-3.5 py-3">
                            {oauth.mode === "auth-url" ? (
                              <>
                                <p className="text-sm text-muted-foreground">
                                  {popupBlocked ? (
                                    <Trans>
                                      Open{" "}
                                      <a
                                        href={oauth.verificationUri}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-foreground underline"
                                      >
                                        {new URL(oauth.verificationUri).hostname}
                                      </a>{" "}
                                      to finish signing in.
                                    </Trans>
                                  ) : (
                                    <Trans>
                                      Finish signing in at{" "}
                                      <a
                                        href={oauth.verificationUri}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-foreground underline"
                                      >
                                        {new URL(oauth.verificationUri).hostname}
                                      </a>
                                      . The final page may not load; paste its URL or code here.
                                    </Trans>
                                  )}
                                </p>
                                <div className="mt-3 flex items-center gap-2">
                                  <Input
                                    value={pasteCode}
                                    onChange={(e) => setPasteCode(e.target.value)}
                                    aria-label={t`Authorization code or callback URL`}
                                    autoComplete="off"
                                    spellCheck={false}
                                    placeholder="http://localhost:53692/callback?code=…"
                                  />
                                  <Button
                                    disabled={!pasteCode.trim()}
                                    onClick={() => void submitOAuthCode()}
                                  >
                                    <Trans>Submit</Trans>
                                  </Button>
                                </div>
                                <p className="mt-2 text-sm text-muted-foreground">
                                  <Plural
                                    value={Math.ceil(oauth.expiresInSeconds / 60)}
                                    one="Waiting for sign-in — the link expires in about # minute."
                                    other="Waiting for sign-in — the link expires in about # minutes."
                                  />
                                </p>
                              </>
                            ) : (
                              <>
                                <p className="text-sm text-muted-foreground">
                                  {popupBlocked ? (
                                    <Trans>
                                      Open{" "}
                                      <a
                                        href={oauth.verificationUri}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-foreground underline"
                                      >
                                        {oauth.verificationUri.replace(/^https:\/\//, "")}
                                      </a>{" "}
                                      and enter this code:
                                    </Trans>
                                  ) : (
                                    <Trans>
                                      A sign-in tab opened at{" "}
                                      <a
                                        href={oauth.verificationUri}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-foreground underline"
                                      >
                                        {oauth.verificationUri.replace(/^https:\/\//, "")}
                                      </a>
                                      . Enter this code there — this window keeps waiting:
                                    </Trans>
                                  )}
                                </p>
                                <div className="mt-2 flex items-center gap-3">
                                  <p className="font-mono text-[22px] tracking-[0.2em] text-foreground">
                                    {oauth.userCode}
                                  </p>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => copyOAuthCode(oauth.userCode)}
                                  >
                                    {codeCopied ? (
                                      <Check size={14} strokeWidth={1.8} aria-hidden="true" />
                                    ) : (
                                      <Copy size={14} strokeWidth={1.8} aria-hidden="true" />
                                    )}
                                    {codeCopied ? <Trans>Copied</Trans> : <Trans>Copy</Trans>}
                                  </Button>
                                </div>
                                <p className="mt-2 text-sm text-muted-foreground">
                                  <Plural
                                    value={Math.ceil(oauth.expiresInSeconds / 60)}
                                    one="Waiting for sign-in — the code expires in about # minute."
                                    other="Waiting for sign-in — the code expires in about # minutes."
                                  />
                                </p>
                              </>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="mt-2 -ml-2 text-muted-foreground"
                              onClick={() => cancelOAuthAttempt()}
                            >
                              <Trans>Cancel</Trans>
                            </Button>
                          </div>
                        ) : (
                          <Button
                            disabled={oauthPending}
                            onClick={() => beginSelectedSubscriptionSignIn()}
                          >
                            {oauthPending ? <Trans>Starting…</Trans> : signInLabel}
                          </Button>
                        )}
                      </div>
                    ) : null}
                    {isCloudflare && acceptsKey ? (
                      <div className="mt-4 grid gap-4">
                        <label
                          htmlFor={`${fieldId}-account-id`}
                          className="block text-sm font-medium text-foreground"
                        >
                          <Trans>Account ID</Trans>
                          <Input
                            id={`${fieldId}-account-id`}
                            value={accountId}
                            onChange={(event) => setAccountId(event.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                            className="mt-2"
                          />
                        </label>
                        {isCloudflareGateway ? (
                          <label
                            htmlFor={`${fieldId}-gateway-id`}
                            className="block text-sm font-medium text-foreground"
                          >
                            <Trans>Gateway ID</Trans>
                            <Input
                              id={`${fieldId}-gateway-id`}
                              value={gatewayId}
                              onChange={(event) => setGatewayId(event.target.value)}
                              autoComplete="off"
                              spellCheck={false}
                              className="mt-2"
                            />
                          </label>
                        ) : null}
                      </div>
                    ) : null}
                    {acceptsKey ? (
                      isOpenAiCompatible ? (
                        isMycellios ? null : (
                          compatibleKeyField
                        )
                      ) : (
                        <label
                          htmlFor={`${fieldId}-api-key`}
                          className="mt-4 block text-sm font-medium text-foreground"
                        >
                          {subscriptionSignIn ? (
                            <Trans>Or paste an API key</Trans>
                          ) : (
                            <Trans>API key</Trans>
                          )}
                          <Input
                            id={`${fieldId}-api-key`}
                            value={apiKey}
                            onChange={(e) => updateApiKey(e.target.value)}
                            placeholder="sk-…"
                            type="password"
                            autoComplete="new-password"
                            className="mt-2"
                          />
                        </label>
                      )
                    ) : null}
                    {acceptsKey && !isOpenAiCompatible && selected?.catalogProbe ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          className="mt-3"
                          disabled={preflightTesting || apiKey.trim().length < 8}
                          onClick={() => void testApiKeyConnection()}
                        >
                          {modelPreflightTestingLabel(
                            preflightTesting && preflightTarget === "api-key",
                            "api-key",
                          )}
                        </Button>
                        {preflightTarget === "api-key" ? (
                          <ModelPreflightFeedback
                            success={preflightSuccess}
                            failure={preflightFailure}
                          />
                        ) : null}
                      </>
                    ) : null}
                  </>
                ) : null}
                {notice ? (
                  <p className="mt-3 text-sm text-success" role="status">
                    {notice}
                  </p>
                ) : null}
                {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
                <div className="mt-6 flex gap-3">
                  <Button disabled={!canSaveModel} onClick={() => void saveModel()}>
                    <Trans>Continue</Trans>
                  </Button>
                  {billingEnabled ? (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void rpc.billing
                          .selectFunding({ funding: "credits" })
                          .then(() => window.location.assign(appPath("/onboarding")))
                          .catch(() => setError(t`Could not open billing`))
                      }
                    >
                      <Trans>Use hosted credits</Trans>
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
