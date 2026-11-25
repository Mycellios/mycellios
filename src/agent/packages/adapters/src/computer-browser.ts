import {
  type AdapterContext,
  BROWSER_ACT_FEATURE_KINDS,
  type BrowserActKind,
  type BrowserActRequest,
  type BrowserActResult,
  type BrowserActStep,
  type BrowserNavigateRequest,
  type BrowserNavigateResult,
  type BrowserProvider,
  type BrowserSnapshotNode,
  type BrowserSnapshotRequest,
  type BrowserSnapshotResult,
  type ComputerRef,
  type PageBrowserCommand,
  type PageBrowserResult,
  type SandboxProvider,
} from "@mycellios/adapter-kit";
import { FakeBrowserProvider, type FakeBrowserProviderOptions } from "./fake-browser.js";

const DETACHED_MESSAGE = "Page browser is not attached to this computer's Chrome.";
const NEWER_IMAGE = "it needs a newer computer image";
const FEATURE_KINDS: ReadonlySet<string> = new Set(BROWSER_ACT_FEATURE_KINDS);
const UNSUPPORTED_ACTION: Record<string, string> = {
  press: "press keys",
  scroll: "scroll",
  hover: "hover over elements",
  wait: "wait for the page",
  dialog: "answer dialogs",
};

type LivePayload = Partial<PageBrowserResult>;

/** The first snapshot a navigation returned, when the computer's helper took one. */
function snapshotFields(live: LivePayload) {
  if (typeof live.tree !== "string" || !Array.isArray(live.elements)) return {};
  return {
    tree: live.tree,
    elements: live.elements,
    ...(live.loading === true ? { loading: true } : {}),
    ...(typeof live.next === "number" ? { next: live.next } : {}),
  };
}

function unsupportedStep(kind: BrowserActKind, completed: number): string {
  const ran = completed > 0 ? ` The ${completed} step(s) before it ran.` : " Nothing ran.";
  return `This computer's page browser cannot ${UNSUPPORTED_ACTION[kind] ?? kind} yet: ${NEWER_IMAGE}.${ran}`;
}

export type LivePageBrowserDriver = (
  computer: ComputerRef,
  request: PageBrowserCommand,
  context: AdapterContext,
) => Promise<LivePayload>;

/**
 * Production page-browser adapter for the bot computer.
 *
 * Fake computers (and the fake sandbox) use the in-process DOM session.
 * Real computers drive the live Chrome already on the graphical display via
 * CDP (`rakazo-page-browser`). If that path cannot operate, return
 * `fallback: "computer_act"` — never report success against a detached DOM.
 */
export class ComputerBrowserProvider implements BrowserProvider {
  private readonly fake: FakeBrowserProvider;
  private readonly sandbox?: SandboxProvider;
  private readonly liveDriver?: LivePageBrowserDriver;

  constructor(
    options: FakeBrowserProviderOptions & {
      sandbox?: SandboxProvider;
      /** Test seam for the live CDP helper. */
      liveDriver?: LivePageBrowserDriver;
    } = {},
  ) {
    const { sandbox, liveDriver, ...fakeOptions } = options;
    this.sandbox = sandbox;
    this.liveDriver = liveDriver;
    this.fake = new FakeBrowserProvider(fakeOptions);
  }

  describe() {
    return {
      id: "computer",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: {
        page: Boolean(
          this.liveDriver || this.sandbox?.pageBrowser || this.sandbox?.describe().id === "fake",
        ),
        refs: true,
        keyless: true,
      },
    };
  }

  async navigate(
    computer: ComputerRef,
    request: BrowserNavigateRequest,
    context: AdapterContext,
  ): Promise<BrowserNavigateResult> {
    if (this.canUseInProcess(computer)) {
      return this.fake.navigate(computer, request, context);
    }
    const live = await this.runLive(computer, { command: "navigate", url: request.url }, context);
    // The page opened a dialog, or did not answer: settled, without desktop tools.
    if (live?.ok === false && live.uncertain === false && live.fallback === undefined) {
      return {
        url: typeof live.url === "string" ? live.url : request.url,
        title: typeof live.title === "string" ? live.title : "",
        ...(live.dialog ? { dialog: live.dialog } : {}),
        error: live.error || DETACHED_MESSAGE,
      };
    }
    if (live?.ok !== true || live.fallback === "computer_act") {
      return {
        url: request.url,
        title: "",
        fallback: "computer_act",
        error: live?.error || DETACHED_MESSAGE,
      };
    }
    return {
      url: typeof live.url === "string" ? live.url : request.url,
      title: typeof live.title === "string" ? live.title : "",
      ...snapshotFields(live),
    };
  }

  async snapshot(
    computer: ComputerRef,
    request: BrowserSnapshotRequest,
    context: AdapterContext,
  ): Promise<BrowserSnapshotResult> {
    if (this.canUseInProcess(computer)) {
      return this.fake.snapshot(computer, request, context);
    }
    const from = request.from && request.from > 0 ? request.from : undefined;
    // An older helper would answer with the first part, so a later part is never asked of it.
    if (from !== undefined && !(await this.liveFeatures(computer, context)).has("snapshot.from")) {
      return {
        url: "",
        title: "",
        tree: "",
        elements: [],
        unsupported: "snapshot.from",
        error: `This computer's page browser cannot read past the first part of a long page yet: ${NEWER_IMAGE}.`,
      };
    }
    const live = await this.runLive(
      computer,
      { command: "snapshot", ...(from !== undefined ? { from } : {}) },
      context,
    );
    // A dialog, a page that did not answer, or a part that no longer exists: settled.
    if (live?.ok === false && live.uncertain === false && live.fallback === undefined) {
      return {
        url: typeof live.url === "string" ? live.url : "",
        title: typeof live.title === "string" ? live.title : "",
        tree: "",
        elements: [],
        ...(live.dialog ? { dialog: live.dialog } : {}),
        error: live.error || DETACHED_MESSAGE,
      };
    }
    if (live?.ok !== true || live.fallback === "computer_act") {
      return {
        url: "",
        title: "",
        tree: "",
        elements: [],
        fallback: "computer_act",
        error: live?.error || DETACHED_MESSAGE,
      };
    }
    const elements = Array.isArray(live.elements) ? live.elements : [];
    return {
      url: typeof live.url === "string" ? live.url : "",
      title: typeof live.title === "string" ? live.title : "",
      tree: typeof live.tree === "string" ? live.tree : formatTree(elements),
      elements,
      ...(live.loading === true ? { loading: true } : {}),
      ...(typeof live.next === "number" ? { next: live.next } : {}),
    };
  }

  async act(
    computer: ComputerRef,
    request: BrowserActRequest,
    context: AdapterContext,
  ): Promise<BrowserActResult> {
    if (this.canUseInProcess(computer)) {
      return this.fake.act(computer, request, context);
    }
    // Steps an older computer image cannot run are never sent to it: the steps before the first
    // such step run, and the result says which kind stopped the batch.
    let actions = request.actions;
    let unsupported: BrowserActKind | undefined;
    if (actions.some((step) => FEATURE_KINDS.has(step.kind))) {
      const features = await this.liveFeatures(computer, context);
      const stop = actions.findIndex(
        (step) => FEATURE_KINDS.has(step.kind) && !features.has(`act.${step.kind}`),
      );
      if (stop >= 0) {
        unsupported = actions[stop]!.kind;
        if (stop === 0) {
          return {
            ok: false,
            completed: 0,
            uncertain: false,
            url: "",
            title: "",
            unsupported,
            error: unsupportedStep(unsupported, 0),
          };
        }
        actions = actions.slice(0, stop);
      }
    }
    const result = await this.runActions(computer, actions, context);
    if (!unsupported || !result.ok) return result;
    return {
      ...result,
      ok: false,
      uncertain: false,
      unsupported,
      error: unsupportedStep(unsupported, result.completed),
    };
  }

  private async runActions(
    computer: ComputerRef,
    actions: BrowserActStep[],
    context: AdapterContext,
  ): Promise<BrowserActResult> {
    const live = await this.runLive(computer, { command: "act", actions }, context);
    const elements = Array.isArray(live?.elements) ? live.elements : undefined;
    // The helper refused a step before changing the page, or a step opened a dialog: settled, and
    // fixable without desktop tools.
    if (live?.ok === false && live.uncertain === false && live.fallback === undefined) {
      // A page snapshot sent with the refusal is kept, so the bot can pick the right field.
      const tree =
        typeof live.tree === "string" ? live.tree : elements ? formatTree(elements) : undefined;
      return {
        ok: false,
        completed: typeof live.completed === "number" ? live.completed : 0,
        uncertain: false,
        url: typeof live.url === "string" ? live.url : "",
        title: typeof live.title === "string" ? live.title : "",
        ...(tree !== undefined ? { tree, elements } : {}),
        ...(live.dialog ? { dialog: live.dialog } : {}),
        error: live.error || DETACHED_MESSAGE,
      };
    }
    if (live?.ok !== true || live.fallback === "computer_act") {
      return {
        ok: false,
        completed: typeof live?.completed === "number" ? live.completed : 0,
        uncertain: live?.uncertain ?? true,
        url: typeof live?.url === "string" ? live.url : "",
        title: typeof live?.title === "string" ? live.title : "",
        fallback: "computer_act",
        error: live?.error || DETACHED_MESSAGE,
      };
    }
    return {
      ok: true,
      completed: typeof live.completed === "number" ? live.completed : actions.length,
      url: typeof live.url === "string" ? live.url : "",
      title: typeof live.title === "string" ? live.title : "",
      tree: typeof live.tree === "string" ? live.tree : elements ? formatTree(elements) : undefined,
      elements,
      ...(live.loading === true ? { loading: true } : {}),
      ...(typeof live.next === "number" ? { next: live.next } : {}),
    };
  }

  /**
   * What the computer's page helper supports beyond the first contract. An older helper or
   * supervisor fails the question, which reads as none: asking runs nothing on the page.
   */
  private async liveFeatures(
    computer: ComputerRef,
    context: AdapterContext,
  ): Promise<ReadonlySet<string>> {
    const live = await this.runLive(computer, { command: "capabilities" }, context);
    const features = live?.ok === true && Array.isArray(live.features) ? live.features : [];
    return new Set(features.filter((feature): feature is string => typeof feature === "string"));
  }

  private canUseInProcess(computer: ComputerRef): boolean {
    return computer.kind === "fake";
  }

  private async runLive(
    computer: ComputerRef,
    request: PageBrowserCommand,
    context: AdapterContext,
  ): Promise<LivePayload> {
    context.signal.throwIfAborted();
    try {
      const result = this.liveDriver
        ? await this.liveDriver(computer, request, context)
        : this.sandbox?.pageBrowser
          ? await this.sandbox.pageBrowser(computer, request, context)
          : {
              ok: false,
              error: DETACHED_MESSAGE,
              fallback: "computer_act" as const,
              uncertain: false,
            };
      if (result?.ok === true && request.command !== "capabilities") {
        if (typeof result.url !== "string" || typeof result.title !== "string") {
          throw new Error("Incomplete page browser response");
        }
        if (
          request.command === "snapshot" &&
          (typeof result.tree !== "string" || !Array.isArray(result.elements))
        ) {
          throw new Error("Incomplete page snapshot");
        }
        if (
          request.command === "act" &&
          (!Number.isInteger(result.completed) ||
            result.completed !== request.actions.length ||
            result.uncertain)
        ) {
          throw new Error("Unconfirmed page actions");
        }
      }
      return result;
    } catch (error) {
      context.signal.throwIfAborted();
      return {
        uncertain: request.command === "act",
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        fallback: "computer_act",
      };
    }
  }
}

function formatTree(elements: BrowserSnapshotNode[]): string {
  if (elements.length === 0) return "(no interactive elements)";
  return elements
    .map((el) => {
      const value =
        el.value !== undefined && el.value !== "" ? ` value=${JSON.stringify(el.value)}` : "";
      return `- ${el.role} "${el.name}" [${el.ref}]${value}`;
    })
    .join("\n");
}
