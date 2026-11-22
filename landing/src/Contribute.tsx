import { PanelDisclosure } from "./ui/patterns";
import { Badge as UiBadge } from "./ui/primitives";
import { Button as UiButton, Card as UiCard, Disclosure as UiDisclosure, DisclosureSummary as UiDisclosureSummary, FieldLabel as UiFieldLabel, Heading as UiHeading, Input as UiInput, Link as UiLink, Text as UiText, Textarea as UiTextarea } from "./ui/primitives";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  Cpu,
  Download,
  MonitorSmartphone,
  Power,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NodeCommand } from "../../src/contracts/node-control";
import { desktopRuntimeBridge } from "./desktop-runtime";
import {
  getMobileWorkerSnapshot,
  initializeMobileWorker,
  setMobileWorkerLevel,
  subscribeMobileWorker,
  toggleMobileWorker,
  type MobileWorkerLevel,
  type MobileWorkerSnapshot,
} from "../../src/mobile/runtime";
import {
  acceptNodeOwnershipTransfer,
  createNodeEnrollmentBundle,
  createNodeOwnershipTransfer,
  enqueueOwnedNodeCommand,
  loadOwnedNodes,
  revokeOwnedNode,
  type OwnedNode,
} from "./api-access";
import type { AuthSession, PublicAuthConfig } from "./auth";
import { verifyTotpStepUp } from "./auth";
import { panelTranslator, usePanelI18n, type PanelLocale, type PanelTranslate } from "./i18n/panel-i18n";

const english = panelTranslator("en");

interface ContributeProps {
  accessToken: string | null;
  authConfig: PublicAuthConfig;
  authSession: AuthSession | null;
  getValidSession(forceRefresh?: boolean): Promise<AuthSession | null>;
  onSessionElevated(session: AuthSession): void;
  onSignIn(): void;
  onOpenAccount(): void;
  onNavigate(view: "overview" | "nodes"): void;
  network: {
    connectedNodes: number;
    completedJobs: number;
    traceCount: number;
  };
}

export function Contribute(props: ContributeProps) {
  const { t } = usePanelI18n();
  const [worker, setWorker] = useState<MobileWorkerSnapshot>(() =>
    getMobileWorkerSnapshot(),
  );
  const [nodes, setNodes] = useState<OwnedNode[]>([]);
  const [loadingNodes, setLoadingNodes] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const failedNodeLoadToken = useRef<string | null>(null);
  const nodeLoadInFlight = useRef(false);
  const nodeLoadBlocked = useRef(false);
  const startButtonRef = useRef<HTMLButtonElement>(null);
  const errorPresentation = error ? contributionErrorPresentation(error, t) : null;

  useEffect(() => {
    initializeMobileWorker();
    const unsubscribe = subscribeMobileWorker(setWorker);
    const location = new URL(window.location.href);
    if (location.searchParams.get("autostart") === "1") {
      location.searchParams.delete("autostart");
      window.history.replaceState(
        window.history.state,
        "",
        `${location.pathname}${location.search}${location.hash}`,
      );
      window.requestAnimationFrame(() => startButtonRef.current?.focus());
    }
    return unsubscribe;
  }, []);

  const refreshNodes = useCallback(async (manual = false) => {
    if (nodeLoadInFlight.current) return;
    if (manual) {
      nodeLoadBlocked.current = false;
      failedNodeLoadToken.current = null;
    } else if (nodeLoadBlocked.current) {
      return;
    }
    if (!props.authSession) {
      setNodes([]);
      return;
    }
    if (failedNodeLoadToken.current === props.authSession.accessToken) return;
    nodeLoadInFlight.current = true;
    setLoadingNodes(true);
    let attemptedToken: string | null = props.authSession.accessToken;
    try {
      let session = await props.getValidSession(false);
      if (!session) {
        setNodes([]);
        return;
      }
      try {
        setNodes(await loadOwnedNodes(session.accessToken));
      } catch (cause) {
        if (!isInvalidSessionError(cause)) throw cause;
        session = await props.getValidSession(true);
        if (!session) {
          setNodes([]);
          return;
        }
        attemptedToken = session.accessToken;
        setNodes(await loadOwnedNodes(session.accessToken));
      }
      failedNodeLoadToken.current = null;
      setError(null);
    } catch (cause) {
      failedNodeLoadToken.current = attemptedToken;
      nodeLoadBlocked.current = true;
      setError(errorText(cause));
    } finally {
      nodeLoadInFlight.current = false;
      setLoadingNodes(false);
    }
  }, [props.authSession, props.getValidSession]);

  useEffect(() => {
    void refreshNodes();
  }, [refreshNodes]);

  return (
    <section
      className={`contribute-page minimal-screen ${worker.running ? "is-running" : ""}`}
    >
      <div className="panel-page-title">
        <div>
          <UiHeading as="h1">{t("contribute.title")}</UiHeading>
        </div>
      </div>
      {errorPresentation && (
        <div className="contribute-error" role="alert">
          <AlertTriangle aria-hidden="true" />
          <span>
            <strong>{errorPresentation.title}</strong>
            <small>{errorPresentation.detail}</small>
          </span>
          <UiButton
            type="button"
            onClick={() => {
              setError(null);
              if (errorPresentation.requiresAuth) props.onSignIn();
              else void refreshNodes(true);
            }}
          >
            {errorPresentation.action}
          </UiButton>
        </div>
      )}
      {notice && (
        <div className="owned-nodes-feedback" role="status">
          {notice}
        </div>
      )}
      <BrowserContribution worker={worker} startButtonRef={startButtonRef} />
      <NativeNodeSetup
        {...props}
        nodes={nodes}
        loading={loadingNodes}
        onRefresh={() => refreshNodes(true)}
        onNotice={setNotice}
        onError={setError}
      />
    </section>
  );
}

function BrowserContribution({
  worker,
  startButtonRef,
}: {
  worker: MobileWorkerSnapshot;
  startButtonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const { t } = usePanelI18n();
  const connected = worker.running && worker.connection === "online";
  return (
    <UiCard className="contribute-browser-card">
      <header>
        <div className="contribute-browser-icon"><MonitorSmartphone /></div>
        <div>
          <UiHeading as="h2">{t("contribute.browser.title")}</UiHeading>
          <UiText>{translateWorkerStatus(worker.statusText, t)}</UiText>
        </div>
        <UiBadge className={`state-badge ${connected ? "online" : "paused"}`}>
          {t(connected ? "contribute.browser.connected" : worker.starting || worker.running ? "contribute.browser.connecting" : "contribute.browser.paused")}
        </UiBadge>
        <UiButton
          ref={startButtonRef}
          variant={worker.running ? "secondary" : "primary"}
          disabled={worker.starting}
          onClick={() => void toggleMobileWorker()}
        >
          {worker.starting ? <Radio className="spin" /> : <Power />}
          {t(worker.running ? "contribute.browser.pause" : "contribute.browser.start")}
        </UiButton>
      </header>


      <div className="contribute-power-row">
        <span>{t("contribute.browser.power")}</span>
        <div className="contribute-levels" role="group" aria-label={t("contribute.browser.powerGroup")}>
          {(["low", "balanced", "maximum"] as MobileWorkerLevel[]).map((level, index) => (
            <UiButton
              key={level}
              className={worker.level === level ? "active" : ""}
              disabled={worker.running || worker.starting}
              onClick={() => setMobileWorkerLevel(level)}
              aria-label={t("contribute.browser.levelLabel", { level: t(`contribute.browser.level.${level}`) })}
            >
              <span className="contribute-level-icon" aria-hidden="true">
                {Array.from({ length: index + 1 }, (_, ray) => <Zap key={ray} />)}
              </span>
              <span>{t(`contribute.browser.level.${level}`)}</span>
            </UiButton>
          ))}
        </div>
      </div>
      <PanelDisclosure icon={Cpu} title={t("contribute.browser.details")}>
        <div className="contribute-browser-facts" aria-label={t("contribute.browser.facts")}>
          <span><Cpu /><small>{t("contribute.browser.engine")}</small><strong>{worker.backend === "webgpu" ? "WebGPU" : "CPU"}</strong></span>
          <span><Activity /><small>{t("contribute.browser.work")}</small><strong>{worker.verifiedTasks > 0 ? t("contribute.browser.verified", { count: worker.verifiedTasks }) : t("contribute.browser.noTasks")}</strong></span>
        </div>
      </PanelDisclosure>
    </UiCard>
  );
}

function NativeNodeSetup(
  props: ContributeProps & {
    nodes: OwnedNode[];
    loading: boolean;
    onRefresh(): Promise<void>;
    onNotice(value: string | null): void;
    onError(value: string | null): void;
  },
) {
  const { t } = usePanelI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const installer = detectInstaller();
  const nativeRuntime = desktopRuntimeBridge();
  const createBundle = async () => {
    if (!props.accessToken || !props.authSession) {
      props.onSignIn();
      return;
    }
    setBusy("pair");
    props.onError(null);
    try {
      if (nativeRuntime && (await nativeRuntime.status()).enrolled) {
        props.onNotice(t("contribute.native.notice.existing"));
        await props.onRefresh();
        return;
      }
      const bundle = await createNodeEnrollmentBundle(
        props.accessToken,
        props.authSession.user.id,
        window.location.origin,
      );
      if (nativeRuntime) {
        await nativeRuntime.enroll(bundle);
        props.onNotice(t("contribute.native.notice.paired"));
        await props.onRefresh();
        return;
      }
      const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `mycellios-pair-${bundle.enrollmentId.slice(0, 8)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      props.onNotice(t("contribute.native.notice.bundle"));
    } catch (cause) {
      props.onError(errorText(cause));
    } finally {
      setBusy(null);
    }
  };
  const acceptTransfer = async () => {
    if (!props.accessToken || !props.authSession) {
      props.onSignIn();
      return;
    }
    const transferId = window.prompt(t("contribute.native.prompt.transferId"))?.trim();
    const transferToken = window.prompt(t("contribute.native.prompt.transferToken"))?.trim();
    const nodeId = window.prompt(t("contribute.native.prompt.acceptNodeId"))?.trim();
    const code = window.prompt(t("contribute.native.prompt.acceptCode"))?.trim();
    if (!transferId || !transferToken || !nodeId || !code) return;
    setBusy("accept-transfer");
    props.onError(null);
    try {
      const elevated = await verifyTotpStepUp(props.authConfig, props.authSession, code);
      props.onSessionElevated(elevated);
      await acceptNodeOwnershipTransfer(elevated.accessToken, {
        transferId, transferToken, nodeId, confirmation: nodeId,
      });
      props.onNotice(t("contribute.native.notice.accepted", { node: nodeId.slice(0, 12) }));
      await props.onRefresh();
    } catch (cause) {
      props.onError(errorText(cause));
    } finally {
      setBusy(null);
    }
  };
  return (
    <UiDisclosure className="contribute-native-disclosure" open={nativeRuntime ? true : undefined}>
      <UiDisclosureSummary>
        <span className="contribute-native-summary-icon"><Server /></span>
        <span><strong>{t("contribute.native.title")}</strong></span>
        <b className={props.nodes.length > 0 ? "" : "empty"} aria-label={t("contribute.native.pairedCount", { count: props.nodes.length })}>{props.nodes.length || ""}</b>
        <ChevronDown />
      </UiDisclosureSummary>
      <div className="contribute-detail-grid">
      <UiCard className="contribute-settings-card">
        <div className="contribute-card-head">
          <div>
            <UiHeading as="h2">{t("contribute.native.setup")}</UiHeading>
          </div>
          <Server />
        </div>
        <UiText>
          {t(nativeRuntime ? "contribute.native.setup.bridge" : "contribute.native.setup.install")}
        </UiText>
        <div className="page-actions">
          {!nativeRuntime && <UiLink href="/downloads" variant="primary">
            <Download />
            {t("contribute.native.download", { platform: installer.label })}
          </UiLink>}
          {props.accessToken ? <>
            <UiButton type="button" disabled={busy !== null} onClick={() => void createBundle()}>
              <ShieldCheck />
              {t(busy === "pair" ? (nativeRuntime ? "contribute.native.settingUp" : "contribute.native.creating") : (nativeRuntime ? "contribute.native.enable" : "contribute.native.createBundle"))}
            </UiButton>
            <UiButton type="button" disabled={busy !== null} onClick={() => void acceptTransfer()}>
              <ShieldCheck />
              {t("contribute.native.acceptTransfer")}
            </UiButton>
          </> : (
            <UiButton type="button" onClick={props.onSignIn}><ShieldCheck />{t("contribute.native.signIn")}</UiButton>
          )}
        </div>
      </UiCard>
      <UiCard className="contribute-activity-card">
        <div className="contribute-card-head">
          <div>
            <UiHeading as="h2">{t("contribute.native.paired")}</UiHeading>
          </div>
          <UiButton
            aria-label={t("contribute.native.refresh")}
            disabled={props.loading}
            onClick={() => void props.onRefresh()}
          >
            <RefreshCw className={props.loading ? "spin" : ""} />
          </UiButton>
        </div>
        {props.nodes.length === 0 ? (
          <UiText>
            {t(props.accessToken ? "contribute.native.empty" : "contribute.native.signedOut")}
          </UiText>
        ) : (
          props.nodes.map((node) => (
            <OwnedNodeCard
              key={node.nodeId}
              node={node}
              {...props}
              busy={busy}
              setBusy={setBusy}
            />
          ))
        )}
      </UiCard>
      </div>
    </UiDisclosure>
  );
}

function OwnedNodeCard({
  node,
  accessToken,
  authSession,
  authConfig,
  onSessionElevated,
  onNotice,
  onError,
  onRefresh,
  busy,
  setBusy,
}: ContributeProps & {
  node: OwnedNode;
  onNotice(value: string | null): void;
  onError(value: string | null): void;
  onRefresh(): Promise<void>;
  busy: string | null;
  setBusy(value: string | null): void;
}) {
  const { t, locale } = usePanelI18n();
  const [limits, setLimits] = useState(
    () =>
      node.observed?.limits ??
      node.desired?.limits ?? {
        maxConcurrency: 1,
        maxCpuPercent: 80,
        maxRamMiB: 4096,
        maxVramMiB: 0,
        maxDiskMiB: 8192,
        maxTemperatureC: 85,
      },
  );
  const [policy, setPolicy] = useState(
    () =>
      node.observed?.policy ??
      node.desired?.policy ?? {
        schedule: [
          {
            days: [0, 1, 2, 3, 4, 5, 6],
            startMinuteUtc: 0,
            endMinuteUtc: 1_440,
          },
        ],
        modelAllowlist: [],
      },
  );
  const [models, setModels] = useState(() => policy.modelAllowlist.join("\n"));
  const run = async (
    type: NodeCommand["type"],
    payload: NodeCommand["payload"],
    token = accessToken,
  ) => {
    if (!token || !authSession) return;
    setBusy(`${node.nodeId}:${type}`);
    onError(null);
    try {
      await enqueueOwnedNodeCommand(token, authSession.user.id, node, {
        type,
        payload,
      } as Pick<NodeCommand, "type" | "payload">);
      onNotice(t("contribute.node.queued", { command: type, node: node.nodeId.slice(0, 8) }));
      await onRefresh();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(null);
    }
  };
  const revoke = async () => {
    if (!authSession) return;
    const code = window.prompt(t("contribute.node.prompt.revokeCode"));
    if (!code) return;
    const confirmation = window.prompt(t("contribute.node.prompt.revokeConfirm", { node: node.nodeId }));
    if (confirmation !== node.nodeId) {
      onError(t("contribute.node.revokeMismatch"));
      return;
    }
    setBusy(`${node.nodeId}:revoke`);
    try {
      const elevated = await verifyTotpStepUp(authConfig, authSession, code);
      onSessionElevated(elevated);
      await revokeOwnedNode(
        elevated.accessToken,
        node,
        "owner_requested",
        confirmation,
      );
      onNotice(t("contribute.node.revoked"));
      await onRefresh();
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(null);
    }
  };
  const uninstall = async () => {
    if (!authSession) return;
    const retentionChoice = window.prompt(t("contribute.node.prompt.retention"));
    const retain = uninstallRetentionChoice(retentionChoice);
    if (!retain) {
      onError(t("contribute.node.retentionInvalid"));
      return;
    }
    const code = window.prompt(t("contribute.node.prompt.uninstallCode"));
    if (!code) return;
    if (
      window.prompt(t(retentionChoice === "KEEP-DATA" ? "contribute.node.prompt.uninstallKeep" : "contribute.node.prompt.uninstallDelete", { node: node.nodeId })) !== node.nodeId
    ) {
      onError(t("contribute.node.uninstallMismatch"));
      return;
    }
    try {
      const elevated = await verifyTotpStepUp(authConfig, authSession, code);
      onSessionElevated(elevated);
      await run(
        "uninstall",
        {
          version: 1,
          retain,
        },
        elevated.accessToken,
      );
    } catch (cause) {
      onError(errorText(cause));
    }
  };
  const transferOwnership = async () => {
    if (!authSession) return;
    const targetAccountId = window.prompt(t("contribute.node.prompt.transferTarget"))?.trim();
    const code = window.prompt(t("contribute.node.prompt.transferCode"))?.trim();
    const confirmation = window.prompt(t("contribute.node.prompt.transferConfirm", { node: node.nodeId }))?.trim();
    if (!targetAccountId || !code || confirmation !== node.nodeId) {
      if (confirmation && confirmation !== node.nodeId) onError(t("contribute.node.transferMismatch"));
      return;
    }
    setBusy(`${node.nodeId}:transfer`);
    onError(null);
    try {
      const elevated = await verifyTotpStepUp(authConfig, authSession, code);
      onSessionElevated(elevated);
      const transfer = await createNodeOwnershipTransfer(elevated.accessToken, node, targetAccountId, confirmation);
      const blob = new Blob([`${JSON.stringify(transfer, null, 2)}\n`], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `mycellios-transfer-${node.nodeId.slice(0, 8)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      onNotice(t("contribute.node.transferCreated"));
    } catch (cause) {
      onError(errorText(cause));
    } finally {
      setBusy(null);
    }
  };
  const pending = busy?.startsWith(node.nodeId) ?? false;
  const disabled = pending || node.status !== "active";
  const policyWindow = policy.schedule[0] ?? {
    days: [0, 1, 2, 3, 4, 5, 6],
    startMinuteUtc: 0,
    endMinuteUtc: 1_440,
  };
  const presentation = nodePresentation(node, t, locale);
  return (
    <div className="owned-node-card">
      <header>
        <div>
          <strong>{node.nodeId.slice(0, 12)}</strong>
          <small>
            {t("contribute.node.generation", { generation: node.generation, state: t(node.connected ? "contribute.node.connected" : "contribute.node.offline") })}
          </small>
        </div>
        <UiBadge className={`state-badge ${presentation.tone}`}>
          {presentation.label}
        </UiBadge>
      </header>
      <UiText>{presentation.summary}</UiText>
      <NodeDiagnostics node={node} />
      <div className="page-actions">
        <UiButton
          disabled={disabled}
          onClick={() => void run("pause", { version: 1 })}
        >
          {t("contribute.node.pause")}
        </UiButton>
        <UiButton
          disabled={disabled}
          onClick={() => void run("resume", { version: 1 })}
        >
          {t("contribute.node.resume")}
        </UiButton>
        <UiButton
          disabled={disabled}
          onClick={() => void run("drain", { version: 1, deadlineMs: 300_000 })}
        >
          {t("contribute.node.drain")}
        </UiButton>
        <UiButton
          disabled={disabled}
          onClick={() => void run("update", { version: 1, channel: "stable" })}
        >
          {t("contribute.node.update")}
        </UiButton>
        <UiButton
          disabled={disabled}
          onClick={() =>
            void run("rollback", {
              version: 1,
              componentIds: ["python-product"],
            })
          }
        >
          {t("contribute.node.rollback")}
        </UiButton>
        <UiButton disabled={disabled} onClick={() => void revoke()}>
          {t("contribute.node.revoke")}
        </UiButton>
        <UiButton disabled={disabled} onClick={() => void transferOwnership()}>
          {t("contribute.node.transfer")}
        </UiButton>
        <UiButton
          disabled={
            disabled || node.observed?.runtime.uninstallAvailable !== true
          }
          onClick={() => void uninstall()}
        >
          {t("contribute.node.uninstall")}
        </UiButton>
      </div>
      <UiDisclosure>
        <UiDisclosureSummary>
          <span>
            {t("contribute.limits.title")}
            <small>
              {t("contribute.limits.summary", { cpu: limits.maxCpuPercent, ram: limits.maxRamMiB })}
            </small>
          </span>
          <ChevronDown />
        </UiDisclosureSummary>
        <div className="node-limit-grid">
          {(
            [
              "maxConcurrency",
              "maxCpuPercent",
              "maxRamMiB",
              "maxVramMiB",
              "maxDiskMiB",
              "maxTemperatureC",
            ] as const
          ).map((key) => (
            <UiFieldLabel key={key}>
              <span>{t(`contribute.limits.${key}`)}</span>
              <UiInput
                type="number"
                min={key === "maxVramMiB" ? 0 : 1}
                value={limits[key]}
                onChange={(event) =>
                  setLimits((current) => ({
                    ...current,
                    [key]: Number(event.target.value),
                  }))
                }
              />
            </UiFieldLabel>
          ))}
        </div>
        <UiButton
          disabled={disabled}
          onClick={() => void run("set-limits", { version: 1, ...limits })}
        >
          {t("contribute.limits.apply")}
        </UiButton>
      </UiDisclosure>
      <UiDisclosure>
        <UiDisclosureSummary>
          <span>
            {t("contribute.policy.title")}
            <small>
              {t("contribute.policy.summary", { days: policyWindow.days.length, models: policy.modelAllowlist.length || t("contribute.policy.anyCertified") })}
            </small>
          </span>
          <ChevronDown />
        </UiDisclosureSummary>
        <UiText>{t("contribute.policy.note")}</UiText>
        <div
          className="node-schedule-days"
          role="group"
          aria-label={t("contribute.policy.days")}
        >
          {WEEK_DAYS.map((day) => (
            <UiFieldLabel key={day}>
              <UiInput
                type="checkbox"
                checked={policyWindow.days.includes(day)}
                onChange={(event) =>
                  setPolicy((current) => ({
                    ...current,
                    schedule: [
                      {
                        ...policyWindow,
                        days: event.target.checked
                          ? [...new Set([...policyWindow.days, day])].sort()
                          : policyWindow.days.filter((value) => value !== day),
                      },
                    ],
                  }))
                }
              />
              {t(`contribute.policy.day.${day}`)}
            </UiFieldLabel>
          ))}
        </div>
        <div className="node-limit-grid">
          <UiFieldLabel>
            <span>{t("contribute.policy.start")}</span>
            <UiInput
              type="time"
              value={minuteToTime(policyWindow.startMinuteUtc)}
              onChange={(event) =>
                setPolicy((current) => ({
                  ...current,
                  schedule: [
                    {
                      ...policyWindow,
                      startMinuteUtc: timeToMinute(event.target.value),
                    },
                  ],
                }))
              }
            />
          </UiFieldLabel>
          <UiFieldLabel>
            <span>{t("contribute.policy.end")}</span>
            <UiInput
              type="time"
              value={minuteToTime(
                policyWindow.endMinuteUtc === 1_440
                  ? 0
                  : policyWindow.endMinuteUtc,
              )}
              onChange={(event) =>
                setPolicy((current) => ({
                  ...current,
                  schedule: [
                    {
                      ...policyWindow,
                      endMinuteUtc: timeToMinute(event.target.value) || 1_440,
                    },
                  ],
                }))
              }
            />
          </UiFieldLabel>
        </div>
        <UiFieldLabel>
          <span>{t("contribute.policy.models")}</span>
          <UiTextarea
            rows={4}
            value={models}
            onChange={(event) => setModels(event.target.value)}
            placeholder="org/model-id"
          />
        </UiFieldLabel>
        <UiButton
          disabled={disabled}
          onClick={() =>
            void run("set-policy", {
              version: 1,
              policy: {
                ...policy,
                modelAllowlist: [
                  ...new Set(
                    models
                      .split(/\r?\n/)
                      .map((value) => value.trim())
                      .filter(Boolean),
                  ),
                ],
              },
            })
          }
        >
          {t("contribute.policy.apply")}
        </UiButton>
      </UiDisclosure>
      {node.commands[0] && (
        <small>
          {t("contribute.node.latest", { command: node.commands[0].type, state: node.commands[0].state })}
        </small>
      )}
    </div>
  );
}

function NodeDiagnostics({ node }: { node: OwnedNode }) {
  const { t, locale } = usePanelI18n();
  const observed = node.observed;
  const diagnostics = observed?.diagnostics;
  if (!observed)
    return (
      <div className="node-diagnostics-empty">
        <Radio className="spin" />
        <span>
          <strong>{t("contribute.diagnostics.waiting")}</strong>
          <small>{t("contribute.diagnostics.waitingDetail")}</small>
        </span>
      </div>
    );
  const accelerator = diagnostics?.capacity.primaryAccelerator;
  const resources = diagnostics?.resources;
  return (
    <UiDisclosure
      className="node-diagnostics"
      open={observed.state === "degraded" || observed.state === "failed"}
    >
      <UiDisclosureSummary>
        <span>
          <Activity />
          <span>
            <strong>{t("contribute.diagnostics.title")}</strong>
            <small>
              {t("contribute.diagnostics.summary", { version: observed.build.version, backend: observed.runtime.backend ?? t("contribute.diagnostics.runtimePending"), count: diagnostics?.capacity.acceleratorCount ?? 0 })}
            </small>
          </span>
        </span>
        <ChevronDown />
      </UiDisclosureSummary>
      <div className="node-diagnostics-grid">
        <span>
          <small>{t("contribute.diagnostics.build")}</small>
          <strong>{observed.build.version}</strong>
          <em>{observed.build.sourceRevision}</em>
        </span>
        <span>
          <small>{t("contribute.diagnostics.runtime")}</small>
          <strong>{t(observed.runtime.ready ? "contribute.diagnostics.ready" : "contribute.diagnostics.starting")}</strong>
          <em>{observed.runtime.abi}</em>
        </span>
        <span>
          <small>{t("contribute.diagnostics.accelerator")}</small>
          <strong>{accelerator?.name ?? t("contribute.diagnostics.notReported")}</strong>
          <em>
            {accelerator
              ? t("contribute.diagnostics.offered", { offered: accelerator.offeredMemoryMiB, total: accelerator.totalMemoryMiB })
              : t("contribute.diagnostics.capacityPending")}
          </em>
        </span>
        <span>
          <small>{t("contribute.diagnostics.resources")}</small>
          <strong>
            {resources
              ? t("contribute.diagnostics.resourceUse", { cpu: resources.cpuPercent.toFixed(0), ram: resources.ramMiB })
              : t("contribute.diagnostics.probePending")}
          </strong>
          <em>
            {resources
              ? `${t("contribute.diagnostics.disk", { disk: resources.diskMiB })}${resources.temperatureC === null ? "" : ` · ${resources.temperatureC.toFixed(0)} °C`}`
              : t("contribute.diagnostics.noMeasurement")}
          </em>
        </span>
      </div>
      {diagnostics?.incident && (
        <div className="node-incident" role="status">
          <AlertTriangle />
          <span>
            <strong>{diagnostics.incident.code}</strong>
            <small>
              {new Date(diagnostics.incident.occurredAt).toLocaleString(intlLocale(locale))}
            </small>
          </span>
        </div>
      )}
    </UiDisclosure>
  );
}

const intlLocale = (locale: PanelLocale) => locale === "es" ? "es-ES" : "en-US";

export function nodePresentation(
  node: Pick<OwnedNode, "connected" | "status" | "observed">,
  t: PanelTranslate = english,
  locale: PanelLocale = "en",
) {
  if (node.status === "revoked")
    return {
      label: t("contribute.state.revoked"),
      tone: "error",
      summary: t("contribute.state.revokedSummary"),
    };
  if (!node.observed)
    return {
      label: t(node.connected ? "contribute.state.pairing" : "contribute.state.waiting"),
      tone: "paused",
      summary: t("contribute.state.waitingSummary"),
    };
  if (!node.connected && node.observed.state !== "failed")
    return {
      label: t("contribute.state.reconnecting"),
      tone: "paused",
      summary: t("contribute.state.reconnectingSummary", { version: node.observed.build.version, state: t(`contribute.state.${node.observed.state}`) }),
    };
  const state = node.observed.state;
  return {
    label: t(`contribute.state.${state}`),
    tone:
      state === "ready"
        ? "online"
        : state === "failed" || state === "revoked"
          ? "error"
          : "paused",
    summary: t("contribute.state.summary", {
      version: node.observed.build.version,
      backend: node.observed.runtime.backend ?? t("contribute.diagnostics.runtimePending"),
      date: new Date(node.observed.observedAt).toLocaleString(intlLocale(locale)),
    }),
  };
}

function errorText(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

export interface ContributionErrorPresentation {
  title: string;
  detail: string;
  action: string;
  requiresAuth: boolean;
}

export function contributionErrorPresentation(message: string, t: PanelTranslate = english): ContributionErrorPresentation {
  if (isInvalidSessionError(message)) {
    return {
      title: t("contribute.error.expired.title"),
      detail: t("contribute.error.expired.detail"),
      action: t("contribute.error.signIn"),
      requiresAuth: true,
    };
  }
  return {
    title: t("contribute.error.title"),
    detail: message || t("contribute.error.detail"),
    action: t("contribute.error.retry"),
    requiresAuth: false,
  };
}

const WORKER_STATUS_KEYS = {
  "Press the button and keep this screen open.": "contribute.status.idle",
  "Updating automatically…": "contribute.status.updating",
  "Paused because mycellios is not visible.": "contribute.status.hidden",
  "Preparing this device. No work is active until the network connects.": "contribute.status.preparing",
  "Preparing the compute engine after returning to mycellios…": "contribute.status.returning",
  "Compute is ready; waiting for coordinator confirmation…": "contribute.status.awaitingCoordinator",
  "Connection lost; retrying automatically…": "contribute.status.reconnecting",
  "Device validated and waiting for real inference work.": "contribute.status.validated",
  "CPU check passed. Waiting for a compatible model layer.": "contribute.status.cpuPassed",
  "Connected. Running the one-time network admission check…": "contribute.status.admission",
  "Complete-model response verified by the coordinator.": "contribute.status.modelVerified",
  "Expert output matched the coordinator's independent reference.": "contribute.status.expertMatched",
  "Result sent; waiting for coordinator verification…": "contribute.status.resultSent",
  "Downloading and verifying a real model expert…": "contribute.status.downloadingExpert",
  "Expert activation returned; awaiting network verification…": "contribute.status.expertReturned",
} as const satisfies Record<string, Parameters<PanelTranslate>[0]>;

/**
 * The shared browser worker reports its status in English. Known messages are shown
 * in the panel's language; measured details and runtime errors stay as reported.
 */
export function translateWorkerStatus(text: string, t: PanelTranslate): string {
  if (Object.hasOwn(WORKER_STATUS_KEYS, text)) return t(WORKER_STATUS_KEYS[text as keyof typeof WORKER_STATUS_KEYS]);
  const measuring = /^Measuring the (GPU|CPU) with a real task…$/.exec(text);
  if (measuring) return t("contribute.status.measuring", { engine: measuring[1]! });
  return text;
}

function isInvalidSessionError(error: unknown): boolean {
  const normalized = errorText(error).toLowerCase();
  return normalized.includes("invalid_network_token")
    || normalized.includes("invalid network token")
    || normalized.includes("invalid_access_token")
    || normalized.includes("account session is invalid")
    || normalized.includes("session is invalid or expired");
}

const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
function timeToMinute(value: string) {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}
function minuteToTime(value: number) {
  return `${String(Math.floor(value / 60) % 24).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
export function uninstallRetentionChoice(
  choice: string | null,
): { cache: boolean; logs: boolean; configuration: boolean; identity: boolean } | null {
  if (choice === "KEEP-DATA") {
    return { cache: true, logs: true, configuration: true, identity: true };
  }
  if (choice === "DELETE-ALL") {
    return { cache: false, logs: false, configuration: false, identity: false };
  }
  return null;
}
export function detectInstallerPlatform(userAgent: string, platform: string) {
  const value = `${userAgent} ${platform}`.toLowerCase();
  if (value.includes("win"))
    return { label: "Windows", path: "/downloads/windows" };
  if (value.includes("mac"))
    return { label: "macOS", path: "/downloads/macos-arm64" };
  return { label: "Linux", path: "/downloads/linux" };
}
function detectInstaller() {
  return detectInstallerPlatform(navigator.userAgent, navigator.platform);
}
