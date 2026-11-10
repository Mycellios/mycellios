import { Trans, useLingui } from "@lingui/react/macro";
import type { SettingsScope } from "@rakazo/contracts";
import {
  ANTSEED_PROVIDER_ID,
  compatibleConnectionName,
  connectionDisplayName,
  DEFAULT_MODEL_CONTEXT_WINDOW,
  isMycelliosBaseUrl,
  isOllamaCloudBaseUrl,
  OLLAMA_CLOUD_BASE_URL,
  OPENAI_COMPATIBLE_PROVIDER_ID,
  savedCompatibleEndpointMatches,
} from "@rakazo/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Disclosure,
  ModelThinkingOptions,
  Spinner,
} from "@rakazo/ui-web";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ModelCredential } from "../lib/model-auth";
import type { ModelRoleConnectIntent } from "./ModelRoleSettings";
import { ModelRoleSettings } from "./ModelRoleSettings";
import { CompatibleModelFields } from "./model-settings/compatible-model-fields";
import { AntSeedProvider } from "./model-settings/antseed-provider";
import { CompatibleKeyControls, ConnectionControls } from "./model-settings/connection-controls";
import { savedModelIds } from "./model-settings/enable-compatible-model";
import { isMycelliosProviderConnected, MycelliosProvider } from "./model-settings/mycellios-provider";
import { OpenCodeProvider } from "./model-settings/open-code-provider";
import type { ProviderIntegration } from "./model-settings/provider-detail";
import { ProviderDiscovery, ProviderRuntimeDetails, useProviderRuntimes } from "./model-settings/provider-runtime";
import { ConnectionNameField, ProvidersSection } from "./model-settings/providers-section";
import type { ConnectableProvider } from "./model-settings/role-model-picker";
import { SpaceBotsModelNotice } from "./model-settings/space-bots-model";
import { useModelSettings } from "./model-settings/use-model-settings";

export function ModelSettingsOverlay({
  onClose,
  embedded = false,
  providersOnly = false,
  scope,
  onFormStateChange,
  onRequestLeave,
}: {
  onClose: () => void;
  /** Render the content only, inside the shared Settings shell's scroller. */
  embedded?: boolean;
  providersOnly?: boolean;
  /**
   * The account's models, or the bound Space's own when it overrides them. Connections are
   * account-wide, so a Space shows only its role lists.
   */
  scope: SettingsScope;
  onFormStateChange?: (state: { busy: boolean; dirty: boolean }) => void;
  onRequestLeave?: (next: () => void) => void;
}) {
  const { t } = useLingui();
  const model = useModelSettings(onClose, scope);
  const host = useProviderRuntimes(providersOnly && scope === "account");
  const {
    baseUrl,
    busy,
    catalog,
    cancelOAuthAttempt,
    confirmDisconnect,
    connectKey,
    credential,
    credentialByProvider,
    credentials,
    disconnectCredential,
    disconnectName,
    error,
    groups,
    handleClose,
    hostCredentialSource,
    intentRef,
    isOpenAiCompatible,
    loading,
    maxTokens,
    me,
    notice,
    pending,
    provider,
    refresh,
    selected,
    selectedConnectionName,
    selectedProviderName,
    setConfirmDisconnect,
    setMaxTokens,
    setNotice,
    settingsDirty,
  } = model;
  // Where the connection form opens: under a role's list, under a provider row, or at the
  // end of Providers when adding one. The rest of the page stays where it was.
  const [connectionAt, setConnectionAt] = useState<string | null>(null);
  const [integration, setIntegration] = useState<ProviderIntegration | null>(null);
  const openCodeTrigger = useRef<HTMLButtonElement>(null);
  const antseedTrigger = useRef<HTMLButtonElement>(null);
  const restoreIntegrationFocus = useRef<ProviderIntegration | null>(null);
  useEffect(() => {
    if (integration || !restoreIntegrationFocus.current) return;
    const trigger = restoreIntegrationFocus.current === "opencode" ? openCodeTrigger : antseedTrigger;
    restoreIntegrationFocus.current = null;
    trigger.current?.focus();
  }, [integration]);
  const panelRef = useRef<HTMLDivElement>(null);
  const formBusy = pending !== null || model.preflightTesting || model.probing;
  const antseedModelsDirty = connectionAt === "antseed:connection" && credential &&
    JSON.stringify([...new Set([model.modelId, ...model.enabledModelIds].filter(Boolean))].sort()) !==
    JSON.stringify(savedModelIds(credential).sort());
  const compatibleDirty = Boolean(
    connectionAt &&
      isOpenAiCompatible &&
      credential &&
      (model.baseUrl.trim() !== (credential.baseUrl ?? "") ||
        model.maxTokens.trim() !== String(credential.maxTokens ?? "") ||
        model.contextWindow.trim() !==
          String(credential.contextWindow ?? DEFAULT_MODEL_CONTEXT_WINDOW) ||
        model.modelId !== (credential.modelId ?? "") ||
        antseedModelsDirty),
  );
  const formDirty = Boolean(
    connectionAt &&
      (settingsDirty ||
        compatibleDirty ||
        model.apiKey.trim() ||
        model.oauthPending ||
        !credential),
  );
  useEffect(() => {
    onFormStateChange?.({ busy: formBusy, dirty: formDirty });
  }, [onFormStateChange, formBusy, formDirty]);
  useEffect(() => () => onFormStateChange?.({ busy: false, dirty: false }), [onFormStateChange]);
  const mycelliosCredential = credentials.find((entry) => isMycelliosBaseUrl(entry.baseUrl));
  useEffect(() => {
    panelRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [connectionAt]);

  const providers: ConnectableProvider[] = groups
    .filter((group) => !credentialByProvider.has(group.id))
    .map((group) => ({ id: group.id, name: group.name }));
  if (
    groups.some((group) => group.id === OPENAI_COMPATIBLE_PROVIDER_ID) &&
    !isOllamaCloudBaseUrl(credentialByProvider.get(OPENAI_COMPATIBLE_PROVIDER_ID)?.baseUrl)
  )
    providers.push({
      id: OPENAI_COMPATIBLE_PROVIDER_ID,
      name: t`Ollama Cloud`,
      baseUrl: OLLAMA_CLOUD_BASE_URL,
    });
  // Adding another account is open to every provider, connected or not.
  const allProviders: ConnectableProvider[] = [
    ...groups.map((group) => ({ id: group.id, name: group.name })),
    ...(groups.some((group) => group.id === OPENAI_COMPATIBLE_PROVIDER_ID)
      ? [
          {
            id: OPENAI_COMPATIBLE_PROVIDER_ID,
            name: t`Ollama Cloud`,
            baseUrl: OLLAMA_CLOUD_BASE_URL,
          },
        ]
      : []),
  ];
  const connectionName = (entry: ModelCredential) => {
    const group = groups.find((item) => item.id === entry.provider);
    return connectionDisplayName(
      entry,
      group?.name ?? entry.provider,
      group?.entries[0]?.providerName ? [group.entries[0].providerName] : [],
    );
  };
  const providerLabel = (id: string) =>
    compatibleConnectionName(
      credentialByProvider.get(id)?.baseUrl,
      groups.find((group) => group.id === id)?.name ?? id,
    );
  // The Ollama Cloud preset shares the compatible provider id with a saved local server.
  const connected = Boolean(
    credential &&
      (!isOpenAiCompatible || savedCompatibleEndpointMatches(baseUrl, credential.baseUrl)),
  );

  /** Opens a connection by id, or connects a new one for the provider. */
  function openConnection(
    next: ConnectableProvider,
    intent: ModelRoleConnectIntent | null,
    credentialId: string | null,
    at: string,
    discoveredModel?: string,
  ) {
    if (
      credentialId &&
      credentials.some((entry) => entry.id === credentialId && isMycelliosBaseUrl(entry.baseUrl))
    ) {
      closeConnection();
      document
        .querySelector('[data-testid="mycellios-provider"]')
        ?.scrollIntoView?.({ block: "nearest" });
      return;
    }
    const open = () => {
      model.chooseProvider(next.id, next.baseUrl, credentialId);
      if (discoveredModel) model.stageCompatibleModelId(discoveredModel);
      intentRef.current = {
        makeDefault: intent?.makeDefault ?? false,
        onConnected: async (choice) => {
          setConnectionAt(null);
          intentRef.current = null;
          await intent?.onConnected(choice);
        },
      };
      setConnectionAt(at);
    };
    if (connectionAt && onRequestLeave && (formDirty || formBusy)) onRequestLeave(open);
    else open();
  }

  function closeConnection() {
    if (onRequestLeave && (formDirty || formBusy)) {
      onRequestLeave(() => {
        cancelOAuthAttempt();
        model.updateApiKey("");
        intentRef.current = null;
        setConnectionAt(null);
      });
      return;
    }
    cancelOAuthAttempt();
    intentRef.current = null;
    setConnectionAt(null);
  }

  function navigateIntegration(next: ProviderIntegration | null) {
    const navigate = () => {
      cancelOAuthAttempt();
      model.updateApiKey("");
      intentRef.current = null;
      setConnectionAt(null);
      restoreIntegrationFocus.current = next ? null : integration;
      setIntegration(next);
    };
    if (connectionAt && onRequestLeave && (formDirty || formBusy)) onRequestLeave(navigate);
    else navigate();
  }

  const disconnectButton = connected ? (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="mt-6 -ml-2.5 text-muted-foreground"
      disabled={busy}
      onClick={() => setConfirmDisconnect(true)}
    >
      {pending === "disconnect" ? <Trans>Disconnecting…</Trans> : <Trans>Disconnect</Trans>}
    </Button>
  ) : null;

  const connection = selected ? (
    isOpenAiCompatible ? (
      <>
        <CompatibleModelFields {...model} connectionOnly={connectionAt !== "antseed:connection"} />
        <CompatibleKeyControls {...model} />
        {disconnectButton}
      </>
    ) : credential ? (
      <>
        <ConnectionControls {...model} />
        <ModelThinkingOptions
          showThinking={false}
          disabled={busy}
          advancedLabel={t`Advanced`}
          maxTokens={maxTokens}
          onMaxTokensChange={(value) => {
            setMaxTokens(value);
            setNotice(null);
          }}
          maxTokensLabel={t`Maximum output tokens`}
        />
        {settingsDirty ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-4"
            disabled={busy}
            onClick={() => void connectKey({ settingsOnly: true })}
          >
            {pending === "settings" ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
          </Button>
        ) : null}
        {disconnectButton}
      </>
    ) : (
      <>
        {provider === me?.hostCredentialProvider ? (
          <p className="mb-5 text-[13px] leading-[1.5] text-muted-foreground">
            <Trans>
              Uses this server's own {hostCredentialSource} credentials to access{" "}
              {selectedProviderName}.
            </Trans>
          </p>
        ) : null}
        <ConnectionControls {...model} />
      </>
    )
  ) : null;

  // Under its own Providers row the row is the heading, so the form sits there unframed.
  const panelFor = (framed: boolean) => (
    <div
      ref={panelRef}
      className={framed ? "mt-3 rounded-xl border border-border px-4 py-4" : "pt-1"}
      data-testid="model-connection"
    >
      <div className={framed ? "mb-3 flex items-center justify-between gap-3" : "sr-only"}>
        <h4
          data-testid="model-connection-title"
          className="min-w-0 truncate text-[15px] font-medium text-foreground"
        >
          {connected ? selectedConnectionName : <Trans>Connect {selectedProviderName}</Trans>}
        </h4>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="-me-1.5 shrink-0 text-muted-foreground"
          aria-label={t`Close`}
          tabIndex={framed ? undefined : -1}
          onClick={closeConnection}
        >
          <X />
        </Button>
      </div>
      {error ? (
        <p className="mb-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mb-4 text-sm text-success" role="status">
          {notice}
        </p>
      ) : null}
      {/* Edits made while a save is in flight would be replaced by what it saved. */}
      <fieldset className="contents" disabled={pending === "connect" || pending === "settings"}>
        {connected && credential ? (
          <ConnectionNameField
            key={credential.id}
            credential={credential}
            onRenamed={() => void refresh()}
          />
        ) : null}
        {connection}
        {connected && !model.apiKey.trim() && notice ? <Button className="mt-4" onClick={handleClose}>{t`Back to chat`}</Button> : null}
      </fieldset>
    </div>
  );

  const content = (
    <>
      {error && !connectionAt ? (
        <p className="mb-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {notice && !connectionAt ? (
        <p className="mb-4 text-sm text-success" role="status">
          {notice}
        </p>
      ) : null}
      {me ? (
        <>
          {integration === "opencode" ? (
            <OpenCodeProvider
              host={host}
              connections={allProviders
                .filter((entry) => entry.id === "opencode" || entry.id === "opencode-go")
                .map((entry) => ({ ...entry, credentialId: credentialByProvider.get(entry.id)?.id }))}
              disabled={busy}
              onManage={(entry) => openConnection(entry, null, entry.credentialId ?? null, "opencode:connection")}
              connectionPanel={connectionAt === "opencode:connection" ? panelFor(true) : null}
              onBack={() => navigateIntegration(null)}
            />
          ) : null}
          {integration === "antseed" ? (
            <AntSeedProvider
              credentials={credentials.filter((entry) => entry.provider === ANTSEED_PROVIDER_ID)}
              nameOf={connectionName}
              disabled={busy}
              onManage={(entry) => openConnection({ id: ANTSEED_PROVIDER_ID, name: "AntSeed" }, null, entry?.id ?? null, "antseed:connection")}
              connectionPanel={connectionAt === "antseed:connection" ? panelFor(true) : null}
              onBack={() => navigateIntegration(null)}
            />
          ) : null}
          <div hidden={integration !== null}>
          <ModelRoleSettings
            userId={me.userId}
            spaceId={me.spaceId}
            scope={scope}
            credentials={credentials}
            compactPrimary={providersOnly}
            title={providersOnly ? t`Default provider` : t`Main model`}
            defaultLabel={t`Choose a model`}
            providers={providers}
            providerLabel={providerLabel}
            onConnect={(next, intent) => openConnection(next, intent, null, "main")}
            onManage={(id, credentialId) =>
              openConnection({ id, name: id }, null, credentialId, "main")
            }
            panel={connectionAt === "main" ? panelFor(true) : null}
            thinking
            onChanged={() => void refresh()}
          />
          {providersOnly || me.needsModel ? null : (
            <SpaceBotsModelNotice
              refreshKey={`${me.spaceId}:${me.defaultProvider ?? ""}:${me.defaultModel ?? ""}`}
            />
          )}
          {scope === "space" ? null : (
            <ProvidersSection
              credentials={credentials.filter((entry) => !isMycelliosBaseUrl(entry.baseUrl))}
              primaryConnected={isMycelliosProviderConnected(mycelliosCredential)}
              primary={
                <MycelliosProvider
                  credential={mycelliosCredential}
                  directory={providersOnly}
                  onConnected={async () => {
                    await refresh();
                  }}
                />
              }
              providers={allProviders}
              showDirectory={providersOnly}
              name={connectionName}
              disabled={busy}
              runtimes={providersOnly ? host.engines.data : undefined}
              onOpenIntegration={providersOnly ? navigateIntegration : undefined}
              integrationTriggers={{ opencode: openCodeTrigger, antseed: antseedTrigger }}
              runtimeDetails={(runtime) => <ProviderRuntimeDetails runtime={runtime} />}
              onAdd={(next, directoryKey) => {
                if (providersOnly && next.id === ANTSEED_PROVIDER_ID) navigateIntegration("antseed");
                else openConnection(next, null, null, directoryKey ? `providers:new:${directoryKey}` : "providers:add");
              }}
              onClose={closeConnection}
              onOpen={(entry) =>
                connectionAt === `providers:${entry.id}`
                  ? closeConnection()
                  : openConnection(
                      { id: entry.provider, name: entry.provider },
                      null,
                      entry.id,
                      `providers:${entry.id}`,
                    )
              }
              panel={
                connectionAt?.startsWith("providers:")
                  ? panelFor(connectionAt === "providers:add" || connectionAt.startsWith("providers:new:"))
                  : null
              }
              panelAt={connectionAt?.slice("providers:".length) ?? null}
            />
          )}
          {providersOnly && scope === "account" ? (
            <Disclosure summary={t`Advanced`}>
            <ProviderDiscovery host={host} disabled={busy} onSelect={(url, id) => openConnection(
              { id: OPENAI_COMPATIBLE_PROVIDER_ID, name: t`Custom provider`, baseUrl: url }, null, null, "discovered", id,
            )} />
            </Disclosure>
          ) : null}
          {connectionAt === "discovered" ? panelFor(true) : null}
          </div>
        </>
      ) : loading ? (
        <Spinner aria-label={t`Loading model catalog…`} />
      ) : catalog.length ? null : (
        <p className="text-[13px] leading-[1.5] text-muted-foreground">
          <Trans>No model catalog is available.</Trans>
        </p>
      )}
      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Disconnect {disconnectName}?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>This removes the connection from every space.</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>Cancel</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending === "disconnect"}
              onClick={() => {
                setConfirmDisconnect(false);
                setConnectionAt(null);
                intentRef.current = null;
                void disconnectCredential();
              }}
            >
              <Trans>Disconnect</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  if (embedded) {
    return (
      <div data-testid="model-settings" className={providersOnly ? "mx-auto w-full max-w-[720px]" : "max-w-[600px]"}>
        {content}
      </div>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex h-[760px] max-h-[calc(100dvh-2rem)] w-[calc(100dvw-2rem)] max-w-[1080px] flex-col gap-0 overflow-hidden rounded-2xl bg-card p-0 sm:max-w-[1080px]"
      >
        <DialogHeader className="flex-row items-start justify-between px-6 pt-6 sm:px-8 sm:pt-7">
          <DialogTitle className="text-heading2 font-medium text-foreground">
            <Trans>Models</Trans>
          </DialogTitle>
          <DialogClose
            render={<Button variant="ghost" size="icon-sm" aria-label={t`Close model settings`} />}
          >
            <X />
          </DialogClose>
        </DialogHeader>
        <div className="rk-scroll min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-8">
          <div className="max-w-[600px]">{content}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
