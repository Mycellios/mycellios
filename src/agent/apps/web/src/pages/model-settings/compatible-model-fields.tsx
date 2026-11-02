import { Trans, useLingui } from "@lingui/react/macro";
import type { ThinkingLevel } from "@rakazo/contracts";
import { ANTSEED_PROVIDER_ID, isOllamaCloudBaseUrl } from "@rakazo/contracts";
import { toggleEnabledModelId } from "@rakazo/core";
import { Button, Checkbox, Input, Label, ModelThinkingOptions } from "@rakazo/ui-web";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ModelPreflightFeedback } from "../../components/ModelConnectionPreflightNotice";
import { ModelHeadersEditor } from "../../components/ModelHeadersEditor";
import { LocalModelDiscovery } from "./local-model-discovery";
import { ModelPicker } from "./model-picker";
import type { ModelSettingsState } from "./use-model-settings";

export function CompatibleModelFields({
  children,
  connectionOnly = false,
  provider,
  apiKey,
  resetOpenAiCompatibleProbe,
  headerRows,
  setHeaderRows,
  savedHeaderEndpointMatches,
  credential,
  baseUrl,
  busy,
  cancelOAuthAttempt,
  compatibleRows,
  contextWindow,
  defaultModelOptions,
  effectiveBaseUrl,
  enabledModelIds,
  invalidatePreflight,
  maxImagesPerPrompt,
  maxTokens,
  modelId,
  preflightFailure,
  preflightTarget,
  probeModels,
  probeServerModels,
  probing,
  reasoning,
  selectionRevisionRef,
  setContextWindow,
  setEnabledModelIds,
  setError,
  setMaxImagesPerPrompt,
  setMaxTokens,
  setNotice,
  setReasoning,
  setSupportsImages,
  setThinkingLevel,
  stageCompatibleModelId,
  supportsImages,
  thinkingLevel,
  updateBaseUrl,
}: Pick<
  ModelSettingsState,
  | "resetOpenAiCompatibleProbe"
  | "provider"
  | "apiKey"
  | "headerRows"
  | "setHeaderRows"
  | "savedHeaderEndpointMatches"
  | "credential"
  | "baseUrl"
  | "busy"
  | "cancelOAuthAttempt"
  | "compatibleRows"
  | "contextWindow"
  | "defaultModelOptions"
  | "effectiveBaseUrl"
  | "enabledModelIds"
  | "invalidatePreflight"
  | "maxImagesPerPrompt"
  | "maxTokens"
  | "modelId"
  | "preflightFailure"
  | "preflightTarget"
  | "probeModels"
  | "probeServerModels"
  | "probing"
  | "reasoning"
  | "selectionRevisionRef"
  | "setContextWindow"
  | "setEnabledModelIds"
  | "setError"
  | "setMaxImagesPerPrompt"
  | "setMaxTokens"
  | "setNotice"
  | "setReasoning"
  | "setSupportsImages"
  | "setThinkingLevel"
  | "stageCompatibleModelId"
  | "supportsImages"
  | "thinkingLevel"
  | "updateBaseUrl"
> & { children?: ReactNode; connectionOnly?: boolean }) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const [enabledOnly, setEnabledOnly] = useState(false);
  const antseedReady = Boolean(
    effectiveBaseUrl && (apiKey.trim() || (credential?.hasKey && savedHeaderEndpointMatches)),
  );
  const probeRef = useRef(probeServerModels);
  probeRef.current = probeServerModels;
  useEffect(() => {
    if (provider !== ANTSEED_PROVIDER_ID && !connectionOnly) return;
    // Opening an unchanged saved connection is not a request to fetch its catalog.
    // The main/approval picker discovers models independently when opened.
    if (
      connectionOnly &&
      credential?.hasKey &&
      !apiKey.trim() &&
      savedHeaderEndpointMatches &&
      headerRows === null
    )
      return;
    if (busy || !effectiveBaseUrl || (provider === ANTSEED_PROVIDER_ID && !antseedReady)) return;
    // Wait for typing to settle; changing the key invalidates the previous probe.
    const timer = setTimeout(() => void probeRef.current(), 500);
    return () => {
      clearTimeout(timer);
      resetOpenAiCompatibleProbe();
    };
  }, [
    connectionOnly,
    provider,
    antseedReady,
    effectiveBaseUrl,
    apiKey,
    credential?.id,
    credential?.hasKey,
    savedHeaderEndpointMatches,
    headerRows,
    busy,
    resetOpenAiCompatibleProbe,
  ]);
  useEffect(() => {
    setQuery("");
    setEnabledOnly(false);
  }, [provider, effectiveBaseUrl]);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visibleModels = compatibleRows.filter(
    (id) =>
      terms.every((term) => id.toLowerCase().includes(term)) &&
      (!enabledOnly || id === modelId || enabledModelIds.includes(id)),
  );
  const enabledCount = new Set([modelId, ...enabledModelIds].filter(Boolean)).size;
  const endpointField = (
    <div className="mt-5">
      <label className="block" htmlFor="model-base-url">
        {provider === ANTSEED_PROVIDER_ID ? <Trans>Gateway URL</Trans> : <Trans>Server URL</Trans>}
        <Input
          id="model-base-url"
          value={baseUrl || effectiveBaseUrl}
          onChange={(event) => updateBaseUrl(event.target.value)}
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
          className="mt-2 h-10 text-foreground"
        />
      </label>
      {!isOllamaCloudBaseUrl(baseUrl) ? (
        <p className="mt-2 text-sm">
          {provider === ANTSEED_PROVIDER_ID
            ? t`Use the gateway URL from your AntSeed console. AntSeed manages its own balance and limits.`
            : t`Paste your model server address. /v1 is added if needed.`}
        </p>
      ) : null}
    </div>
  );
  return (
    <div className="block text-[13.5px] text-muted-foreground">
      {provider !== ANTSEED_PROVIDER_ID ? (
        <LocalModelDiscovery
          disabled={busy}
          onSelect={(url, id) => {
            updateBaseUrl(url);
            if (id && !connectionOnly) stageCompatibleModelId(id);
          }}
        />
      ) : null}
      {!effectiveBaseUrl ? endpointField : null}
      {!connectionOnly && provider !== ANTSEED_PROVIDER_ID && (
        <div className="mt-3 flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={
              busy ||
              probing ||
              !effectiveBaseUrl ||
              (provider === ANTSEED_PROVIDER_ID &&
                !apiKey.trim() &&
                !(credential?.hasKey && savedHeaderEndpointMatches))
            }
            onClick={() => void probeServerModels()}
          >
            {probing ? <Trans>Finding…</Trans> : <Trans>Find models</Trans>}
          </Button>
        </div>
      )}
      {preflightTarget === "compatible" ? (
        <ModelPreflightFeedback success={null} failure={preflightFailure} />
      ) : null}
      {connectionOnly && probing ? (
        <p role="status" className="mt-3">
          <Trans>Checking connection…</Trans>
        </p>
      ) : null}
      {!connectionOnly && (
        <div className="mt-4 block">
          <span>
            <Trans>Model</Trans>
          </span>
          <ModelPicker
            disabled={busy || (provider === ANTSEED_PROVIDER_ID && !antseedReady)}
            loading={provider === ANTSEED_PROVIDER_ID && probing}
            value={modelId}
            provider={provider}
            allowCustom
            placeholder={t`Choose a model`}
            options={[...new Set([...defaultModelOptions, ...compatibleRows])]
              .filter(Boolean)
              .map((id) => ({
                id,
                provider,
                label: id,
                billing: "",
              }))}
            onChange={(value) => {
              cancelOAuthAttempt();
              selectionRevisionRef.current += 1;
              invalidatePreflight();
              stageCompatibleModelId(value);
              setError(null);
              setNotice(null);
            }}
          />
        </div>
      )}
      <ModelThinkingOptions
        reasoning={reasoning}
        onReasoningChange={(value) => {
          selectionRevisionRef.current += 1;
          setReasoning(value);
          if (!value) setThinkingLevel(null);
          setNotice(null);
        }}
        disabled={busy}
        advancedLabel={t`Advanced settings`}
        thinkingLabel={t`Supports thinking`}
        thinkingLevel={thinkingLevel}
        onThinkingLevelChange={(value) => {
          selectionRevisionRef.current += 1;
          setThinkingLevel(value as ThinkingLevel | null);
          setNotice(null);
        }}
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
        onMaxTokensChange={(value) => {
          selectionRevisionRef.current += 1;
          setMaxTokens(value);
          setNotice(null);
        }}
        maxTokensLabel={t`Maximum output tokens`}
        maxTokensPlaceholder={t`Automatic`}
        contextWindow={contextWindow}
        onContextWindowChange={(value) => {
          selectionRevisionRef.current += 1;
          setContextWindow(value);
          setNotice(null);
        }}
        contextWindowLabel={t`Context limit`}
        supportsImages={supportsImages}
        onSupportsImagesChange={(value) => {
          selectionRevisionRef.current += 1;
          setSupportsImages(value);
          setNotice(null);
        }}
        imagesLabel={t`Supports images`}
        maxImagesPerPrompt={maxImagesPerPrompt}
        onMaxImagesPerPromptChange={(value) => {
          selectionRevisionRef.current += 1;
          setMaxImagesPerPrompt(value);
          setNotice(null);
        }}
        maxImagesLabel={t`Maximum images per request`}
      >
        {effectiveBaseUrl ? endpointField : null}

        {children}
        {!connectionOnly && compatibleRows.length ? (
          <div className="mt-5">
            <p>
              <Trans>Available models · {enabledCount} enabled</Trans>
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label={t`Filter models`}
                placeholder={t`Search models`}
                className="min-w-0 flex-1 text-foreground"
              />
              <Button
                type="button"
                variant={enabledOnly ? "secondary" : "outline"}
                size="sm"
                aria-pressed={enabledOnly}
                onClick={() => setEnabledOnly((value) => !value)}
              >
                <Trans>Enabled only</Trans>
              </Button>
            </div>
            <div className="rk-scroll mt-3 grid max-h-64 gap-2 overflow-y-auto overscroll-contain pr-2">
              {visibleModels.length === 0 ? (
                <p role="status">
                  <Trans>No matching models</Trans>
                </p>
              ) : null}
              {visibleModels.map((id) => (
                <Label key={id} className="font-normal text-foreground">
                  <Checkbox
                    checked={id === modelId || enabledModelIds.includes(id)}
                    disabled={busy || id === modelId}
                    onCheckedChange={(checked) => {
                      selectionRevisionRef.current += 1;
                      setEnabledModelIds((current) => toggleEnabledModelId(current, id, checked));
                      setNotice(null);
                    }}
                  />
                  <span className="min-w-0 break-all">{id}</span>
                </Label>
              ))}
            </div>
          </div>
        ) : null}

        <ModelHeadersEditor
          rows={headerRows}
          savedNames={savedHeaderEndpointMatches ? credential?.headerNames : []}
          disabled={busy}
          onChange={(rows) => {
            setHeaderRows(rows);
            resetOpenAiCompatibleProbe();
            invalidatePreflight();
            setNotice(null);
          }}
        />
      </ModelThinkingOptions>
    </div>
  );
}
