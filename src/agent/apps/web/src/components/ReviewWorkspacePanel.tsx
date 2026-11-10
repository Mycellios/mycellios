import { useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@rakazo/chat-ui/web";
import type { ProjectBrowserState } from "@rakazo/contracts";
import { Button, buttonVariants, Input, Spinner } from "@rakazo/ui-web";
import { useIsMobile } from "@rakazo/ui-web/hooks/use-mobile";
import {
  ArrowLeft,
  ArrowRight,
  CircleHelp,
  Ellipsis,
  FilePlus2,
  Globe,
  Keyboard,
  MessageSquare,
  MousePointer2,
  Plus,
  RotateCw,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { appPath } from "../lib/app-path";
import { fetchArtifactBytes } from "../lib/artifact-open";
import { desktopBridge } from "../lib/desktop";
import type { ReviewDocument, ReviewSelection } from "../lib/review-workspace";
import {
  previewUrl,
  readReviewSelection,
  reviewComment,
  trustedPreviewMessage,
  useReviewWorkspace,
} from "../lib/review-workspace";
import { ResizableSidePanel } from "../pages/ResizableSidePanel";
import { NativeProjectPreview, selectionScreenshot } from "./NativeProjectPreview";
import { ReviewPdfViewer } from "./ReviewPdfViewer";
import { SandboxedHtmlViewer } from "./SandboxedHtmlViewer";
import { ProjectRunControls, type ProjectPreparationStatus } from "./ProjectRunControls";

export function ReviewWorkspacePanel({ agentName, agentAvatar, onReturnToChat, botId, taskThreadId, prepareProject, inspectPreparation, cancelPreparation, workspaceNavigation }: { workspaceNavigation?: ReactNode; agentName?: string; agentAvatar?: ReactNode; onReturnToChat?: () => void; botId?: string; taskThreadId?: string; prepareProject?: (prompt: string, id: string) => Promise<string | undefined>; inspectPreparation?: (runId: string) => Promise<ProjectPreparationStatus>; cancelPreparation?: (runId: string) => Promise<unknown> } = {}) {
  const review = useReviewWorkspace();
  const { t } = useLingui();
  const mobile = useIsMobile();
  const [tools, setTools] = useState<"address" | "tabs" | "options" | "comment" | "help" | null>(null);
  const [nativeState, setNativeState] = useState<ProjectBrowserState | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const pick = useRef<HTMLInputElement>(null);
  const address = useRef<HTMLInputElement>(null);
  const backToChat = useRef<HTMLButtonElement>(null);
  const isOpen = Boolean(review?.open);
  const active =
    review?.documents.find((item) => item.id === review.selectedId) ?? review?.documents.at(-1);
  useEffect(() => {
    setUrl(active?.url ?? "");
    setError("");
  }, [active?.id, active?.url]);
  useEffect(() => {
    if (!isOpen) {
      setTools(null);
      setNativeState(null);
    } else if (mobile) backToChat.current?.focus({ preventScroll: true });
  }, [isOpen, mobile]);
  if (!review) return null;
  const native = desktopBridge()?.preview;
  const navigation = active?.navigation ?? (active?.url ? { urls: [active.url], index: 0 } : undefined);
  const browser = nativeState?.id === active?.id ? nativeState : null;
  const navigateHistory = (offset: -1 | 1) => {
    if (!active?.url) return;
    if (native) {
      void native.command({ id: active.id, action: offset < 0 ? "back" : "forward" })
        .catch(() => setError(t`Could not load this page. Check its URL and server.`));
      return;
    }
    if (!navigation) return;
    const index = navigation.index + offset;
    const next = navigation.urls[index];
    if (next) review.update(active.id, { url: next, name: new URL(next).host, navigation: { ...navigation, index } });
  };
  const newPage = () => {
    review.add({ id: crypto.randomUUID(), name: t`New page`, mimeType: "text/uri-list" });
    setTools(null);
  };
  const returnToChat = () => {
    review.hide();
    onReturnToChat?.();
  };
  const toggleTools = (next: NonNullable<typeof tools>) => setTools(current => current === next ? null : next);
  const hasPage = Boolean(active && (active.url || active.mimeType !== "text/uri-list"));
  const mobileButton = "size-11 shrink-0 rounded-full";
  async function openFile(file?: File) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setError(t`Choose a file smaller than 20 MB.`);
      return;
    }
    const mimeType =
      file.type ||
      (/\.md$/i.test(file.name)
        ? "text/markdown"
        : /\.html?$/i.test(file.name)
          ? "text/html"
          : "text/plain");
    if (!["application/pdf", "text/markdown", "text/html", "text/plain"].includes(mimeType)) {
      setError(t`Choose a PDF, HTML, Markdown or text file.`);
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      review?.add({ id: crypto.randomUUID(), name: file.name, mimeType, bytes });
      setError("");
    } catch {
      setError(t`Could not read this file. Try again.`);
    }
  }
  return (
    <ResizableSidePanel open={review.open} panel="review">
      {review.open && (
        <section aria-label={t`Preview workspace`} className="flex h-full min-h-0 min-w-0 flex-col"
          onKeyDown={event => {
            if (mobile && event.key === "Escape" && !event.defaultPrevented) {
              if (tools) setTools(null);
              else returnToChat();
            }
          }}>
          {workspaceNavigation}
          {mobile ? (
            <header className="flex h-14 shrink-0 items-center gap-2 px-3">
              <Button ref={backToChat} variant="floating" size="icon-lg" className={mobileButton}
                aria-label={t`Back to chat`} onClick={returnToChat}><ArrowLeft className="size-5" aria-hidden /></Button>
              <h2 className="flex min-w-0 flex-1 items-center gap-2 px-1 text-base font-semibold">
                {agentAvatar && <span aria-hidden="true" className="shrink-0">{agentAvatar}</span>}
                <span className="truncate" dir="auto">{agentName || t`Browser`}</span>
              </h2>
              <Button variant="floating" size="icon-lg" className={mobileButton}
                aria-label={t`Browser help`} aria-expanded={tools === "help"} onClick={() => toggleTools("help")}>
                <CircleHelp className="size-5" aria-hidden />
              </Button>
              <Button variant="floating" size="icon-lg" className={mobileButton}
                aria-label={t`Browser options`} aria-expanded={tools === "options"} onClick={() => toggleTools("options")}>
                <Ellipsis className="size-5" aria-hidden />
              </Button>
            </header>
          ) : null}
          {mobile && tools === "help" && <p className="shrink-0 bg-muted px-4 py-3 text-sm text-muted-foreground">
            {t`Use the keyboard button to enter an address and the tab counter to switch pages. If a page blocks previews, open it in your browser from Options.`}
          </p>}
          <header className={mobile
            ? `shrink-0 justify-end gap-2 px-3 pb-2 ${tools === "options" ? "flex" : "hidden"}`
            : `flex ${workspaceNavigation ? "h-10" : "h-14"} shrink-0 items-center gap-2 border-b border-border px-4`}>
            {!mobile && !workspaceNavigation && <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{t`Browser`}</h2>}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`New page`}
              onClick={newPage}
            >
              <Plus size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`Open file`}
              onClick={() => pick.current?.click()}
            >
              <FilePlus2 size={16} />
            </Button>
            {mobile && active?.url && !native && <a
              className={buttonVariants({ variant: "ghost", size: "sm", className: "min-h-11" })}
              href={active.url} target="_blank" rel="noopener noreferrer"
            ><Globe size={18} aria-hidden />{t`Open in browser`}</a>}
            {!mobile && !workspaceNavigation && <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`Close preview`}
              onClick={review.hide}
            >
              <X size={16} />
            </Button>}
            <input
              ref={pick}
              type="file"
              accept=".pdf,.html,.htm,.md,.txt"
              className="hidden"
              onChange={(event) => {
                void openFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </header>
          {botId && prepareProject && <div className={mobile && tools !== "options" ? "hidden" : "contents"}>
            <ProjectRunControls key={`${botId}:${taskThreadId ?? "main"}`} botId={botId} taskThreadId={taskThreadId} prepare={prepareProject} inspectPreparation={inspectPreparation} cancelPreparation={cancelPreparation} />
          </div>}
          <form
            className={`${!mobile || !hasPage || tools === "address" ? "flex" : "hidden"} shrink-0 items-center gap-2 border-b border-border p-3`}
            onSubmit={(event) => {
              event.preventDefault();
              const parsed = previewUrl(url);
              if (
                !parsed ||
                (!desktopBridge()?.preview && new URL(parsed).origin === location.origin)
              ) {
                setError(t`Enter a complete page URL from a separate preview server.`);
                return;
              }
              if (active && (active.url || active.mimeType === "text/uri-list")) {
                if (active.url !== parsed) {
                  const urls = [...(navigation?.urls.slice(0, navigation.index + 1) ?? []), parsed].slice(-32);
                  review.update(active.id, { url: parsed, name: new URL(parsed).host,
                    navigation: native ? undefined : { urls, index: urls.length - 1 } });
                }
              } else
                review.add({
                  id: crypto.randomUUID(),
                  name: new URL(parsed).host,
                  mimeType: "text/uri-list",
                  url: parsed,
                });
              setError("");
              if (mobile) setTools(null);
            }}
          >
            <Input
              ref={address}
              aria-label={t`Page URL`}
              placeholder={mobile ? "https://example.com" : "http://localhost:3000"}
              inputMode="url"
              autoCapitalize="none"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
            <Button type="submit" variant="secondary" size="icon-sm" aria-label={t`Open page`}>
              <Globe size={16} />
            </Button>
          </form>
          {error && (
            <p role="alert" className="px-4 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {(review.documents.length > 0 || (mobile && tools === "tabs")) && (
            <div
              role="tablist"
              aria-label={t`Open previews`}
              className={mobile
                ? `order-last max-h-48 shrink-0 flex-col overflow-y-auto border-t border-border px-3 ${tools === "tabs" ? "flex" : "hidden"}`
                : "flex shrink-0 overflow-x-auto border-b border-border"}
            >
              {review.documents.map((item) => (
                <div
                  key={item.id}
                  className="flex min-w-0 shrink-0 items-center border-e border-border"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active?.id === item.id}
                    onClick={() => { review.select(item.id); if (mobile) setTools(null); }}
                    className={`${mobile ? "min-h-11 min-w-0 flex-1 text-start" : "max-w-48"} truncate px-3 py-2 text-sm focus-visible:outline focus-visible:outline-ring ${active?.id === item.id ? "bg-muted text-foreground" : "text-muted-foreground"}`}
                  >
                    {item.name}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t`Close ${item.name}`}
                    onClick={() => {
                      review.remove(item.id);
                      void desktopBridge()
                        ?.preview?.close(item.id)
                        .catch(() => {});
                    }}
                  >
                    <X size={12} />
                  </Button>
                </div>
              ))}
              {mobile && <Button variant="ghost" className="min-h-11 justify-start" onClick={newPage}><Plus size={18} aria-hidden />{t`New page`}</Button>}
            </div>
          )}
          {active ? (
            <ReviewDocumentView
              key={active.id}
              mobile={mobile}
              showTools={tools === "options"}
              showComment={tools === "comment"}
              onBrowserChange={setNativeState}
              document={active}
              onComment={(text, attachment) => review.comment(text, attachment, active.id)}
              note={review.notes[active.id] ?? ""}
              setNote={(text) => review.setNote(active.id, text)}
              selection={review.selections[active.id] ?? null}
              setSelection={(value) => review.setSelection(active.id, value)}
              outcome={review.outcome}
              onNavigate={(url, name) => review.update(active.id, { url, name })}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
              {mobile ? <Globe size={28} aria-hidden /> : <FilePlus2 size={26} />}
              <p>{mobile ? t`Enter a page address to open it.` : t`Open a file or a page beside your conversation.`}</p>
              <Button
                variant="secondary"
                onClick={() => pick.current?.click()}
              >{t`Open file`}</Button>
              {!mobile && <p>{t`Local files stay in this browser until you send them. Adding a comment includes the file in your chat draft.`}</p>}
            </div>
          )}
          {mobile && (
            <nav aria-label={t`Browser controls`} className="order-last flex shrink-0 items-center justify-between gap-2 px-3 py-2">
              <Button variant="floating" className={mobileButton} aria-label={t`Back`}
                disabled={!active?.url || !(native ? browser?.canGoBack : navigation && navigation.index > 0)}
                onClick={() => navigateHistory(-1)}><ArrowLeft className="size-5" aria-hidden /></Button>
              <Button variant="floating" className={mobileButton} aria-label={t`Forward`}
                disabled={!active?.url || !(native ? browser?.canGoForward : navigation && navigation.index + 1 < navigation.urls.length)}
                onClick={() => navigateHistory(1)}><ArrowRight className="size-5" aria-hidden /></Button>
              <Button variant="floating" className={mobileButton} aria-label={t`Comment for the agent`} aria-expanded={tools === "comment"}
                disabled={!hasPage} onClick={() => toggleTools("comment")}><MessageSquare className="size-5" aria-hidden /></Button>
              <Button variant="floating" className={mobileButton} aria-label={t`Page URL`} aria-expanded={!hasPage || tools === "address"}
                onClick={() => {
                  if (hasPage) flushSync(() => toggleTools("address"));
                  if (tools !== "address" || !hasPage) address.current?.focus();
                }}><Keyboard className="size-5" aria-hidden /></Button>
              <Button variant="floating" className={mobileButton} aria-label={t`Open previews`} aria-expanded={tools === "tabs"}
                onClick={() => toggleTools("tabs")}>
                <span aria-hidden="true" className="inline-grid size-5 place-items-center rounded border border-current text-xs tabular-nums">{review.documents.length}</span>
              </Button>
            </nav>
          )}
        </section>
      )}
    </ResizableSidePanel>
  );
}

function ReviewDocumentView({
  document,
  mobile,
  showTools,
  showComment,
  onBrowserChange,
  onComment,
  note,
  setNote,
  onNavigate,
  selection,
  setSelection,
  outcome,
}: {
  document: ReviewDocument;
  mobile: boolean;
  showTools: boolean;
  showComment: boolean;
  onBrowserChange: (state: ProjectBrowserState) => void;
  onComment: (text: string, attachment?: File) => number;
  note: string;
  setNote: (text: string) => void;
  onNavigate: (url: string, name: string) => void;
  selection: ReviewSelection | null;
  setSelection: (value: ReviewSelection | null) => void;
  outcome: { id: number; accepted: boolean } | null;
}) {
  const { t } = useLingui();
  const [bytes, setBytes] = useState(document.bytes);
  const [error, setError] = useState("");
  const [pendingComment, setPendingComment] = useState<number | null>(null);
  const [commentError, setCommentError] = useState(false);
  const [pdfPage, setPdfPage] = useState(1);
  const [selecting, setSelecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [box, setBox] = useState<{ x: number; y: number; width: number; height: number } | null>(
    null,
  );
  const [session] = useState(() => crypto.randomUUID());
  const native = desktopBridge()?.preview;
  const blocked = !native && Boolean(document.url && blockedUrl === document.url);
  const [browser, setBrowser] = useState<ProjectBrowserState | null>(null);
  useEffect(() => {
    setSelecting(false);
    setError("");
  }, [document.url, revision]);
  useEffect(() => {
    if (pendingComment === null || outcome?.id !== pendingComment) return;
    setPendingComment(null);
    setCommentError(!outcome.accepted);
    if (outcome.accepted) setBox(null);
  }, [outcome, pendingComment]);
  const frame = useRef<HTMLIFrameElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    let current = true;
    if (document.artifact)
      void fetchArtifactBytes(document.artifact.target, document.artifact.id)
        .then((value) => {
          if (current) {
            setBytes(value);
            setError("");
          }
        })
        .catch(() => {
          if (current) setError(t`Could not load this file. Refresh to retry.`);
        });
    return () => {
      current = false;
    };
  }, [document, revision, t]);
  useEffect(() => {
    if (!document.url || native) return;
    const origin = new URL(document.url).origin;
    const receive = (event: MessageEvent) => {
      if (!trustedPreviewMessage(event, frame.current?.contentWindow, origin, session)) return;
      if (event.data.type === "mycellios:ready") setConnected(true);
      if (event.data.type === "mycellios:selection" && selecting) {
        const value = readReviewSelection(event.data);
        if (value) {
          setSelection(value);
          setSelecting(false);
        }
      }
    };
    window.addEventListener("message", receive);
    frame.current?.contentWindow?.postMessage(
      { type: "mycellios:inspect", session, enabled: selecting },
      origin,
    );
    return () => window.removeEventListener("message", receive);
  }, [document.url, session, selecting, revision, native]);
  useEffect(() => {
    if (!mobile || !document.url || native) return;
    const url = document.url;
    const origin = new URL(url).origin;
    const receive = (event: SecurityPolicyViolationEvent) => {
      if (event.disposition === "enforce" && event.effectiveDirective === "frame-src" &&
        (event.blockedURI === url || event.blockedURI === origin)) setBlockedUrl(url);
    };
    window.addEventListener("securitypolicyviolation", receive);
    return () => window.removeEventListener("securitypolicyviolation", receive);
  }, [document.url, mobile, native]);
  const text =
    bytes && document.mimeType.startsWith("text/") ? new TextDecoder().decode(bytes) : "";
  const pdf = document.mimeType === "application/pdf";
  useEffect(() => {
    if (!selecting || document.url || document.mimeType === "text/html" || pdf) return;
    const owner = viewport.current?.ownerDocument;
    const selectedText = () => {
      const selected = window.getSelection();
      if (selected && viewport.current?.contains(selected.anchorNode))
        setSelection({ text: selected.toString().slice(0, 2000) });
    };
    owner?.addEventListener("selectionchange", selectedText);
    return () => owner?.removeEventListener("selectionchange", selectedText);
  }, [selecting, document.url, document.mimeType, pdf]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={`${!mobile || showTools || selecting ? "flex" : "hidden"} min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2`}>
        {!mobile && document.url && native && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`Back`}
              disabled={!browser?.canGoBack}
              onClick={() =>
                void native
                  .command({ id: document.id, action: "back" })
                  .catch(() => setError(t`Could not load this page. Check its URL and server.`))
              }
            >
              <ArrowLeft size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`Forward`}
              disabled={!browser?.canGoForward}
              onClick={() =>
                void native
                  .command({ id: document.id, action: "forward" })
                  .catch(() => setError(t`Could not load this page. Check its URL and server.`))
              }
            >
              <ArrowRight size={14} />
            </Button>
          </>
        )}
        <Button
          variant={selecting ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={selecting}
          disabled={!document.url && document.mimeType === "text/uri-list"}
          onClick={() => {
            if (document.url && native)
              void native
                .command({ id: document.id, action: "select", enabled: !selecting })
                .catch(() => setError(t`Could not select an element. Refresh the page and retry.`));
            else setSelecting((value) => !value);
          }}
        >
          <MousePointer2 size={14} />
          {pdf ? t`Select area` : t`Select`}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t`Refresh preview`}
          onClick={() => {
            setConnected(false);
            setBlockedUrl(null);
            setSelection(null);
            setRevision((value) => value + 1);
            setError("");
            if (document.url && native)
              void native.command({ id: document.id, action: "reload" }).catch(() => {});
          }}
        >
          <RotateCw size={14} />
        </Button>
        {selecting && (
          <span
            role="status"
            className="min-w-0 basis-full break-words text-xs text-muted-foreground"
          >{t`Click an element in the page.`}</span>
        )}
      </div>
      {document.url && !native && !connected && (!mobile || showTools) && (
        <details className="shrink-0 border-b border-border px-3 py-2 text-xs text-muted-foreground">
          <summary>{t`Enable live element selection`}</summary>
          <p className="py-2">{t`The page must allow embedding. For pages you develop, include this script; then refresh the preview. Pages that block embedding must open in a separate browser.`}</p>
          <code className="block break-all select-all">{`<script src="${location.origin}${appPath("/preview-bridge.js")}"></script>`}</code>
          <a
            className="mt-2 inline-block underline underline-offset-2"
            href={document.url}
            target="_blank"
            rel="noreferrer"
          >{t`Open in browser`}</a>
        </details>
      )}
      <div ref={viewport} className="relative min-h-0 flex-1 overflow-auto">
        {error ? (
          <p role="alert" className="p-4 text-sm text-destructive">
            {error}
          </p>
        ) : document.url && blocked ? (
          <div className="grid h-full place-content-center justify-items-center gap-3 p-5 text-center">
            <p className="text-sm text-muted-foreground">{t`This page must open in your browser.`}</p>
            <a className={buttonVariants({ variant: "secondary", className: "min-h-11" })}
              href={document.url} target="_blank" rel="noopener noreferrer">
              <Globe size={18} aria-hidden />{t`Open in browser`}
            </a>
          </div>
        ) : document.url && native ? (
          <NativeProjectPreview
            key={`${document.id}:${revision}`}
            id={document.id}
            url={document.url}
            onChanged={(state) => {
              setBrowser(state);
              onBrowserChange(state);
              setSelecting(state.selecting);
              if (state.error) setError(t`Could not load this page. Check its URL and server.`);
              if (state.selection) setSelection(state.selection);
              const next = previewUrl(state.url);
              if (
                next &&
                !state.loading &&
                (next !== document.url || (state.title && state.title !== document.name))
              )
                onNavigate(next, state.title || new URL(next).host);
            }}
          />
        ) : document.url ? (
          <iframe
            key={revision}
            ref={frame}
            src={document.url}
            title={document.name}
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="no-referrer"
            className="h-full w-full border-0"
            onLoad={() =>
              frame.current?.contentWindow?.postMessage(
                { type: "mycellios:inspect", session, enabled: selecting },
                new URL(document.url!).origin,
              )
            }
          />
        ) : document.mimeType === "text/uri-list" ? (
          <p className="p-5 text-sm text-muted-foreground">{t`Enter a URL to open a page beside this chat.`}</p>
        ) : !bytes ? (
          <div role="status" className="grid h-full place-items-center">
            <Spinner />
          </div>
        ) : pdf ? (
          <ReviewPdfViewer bytes={bytes} title={document.name} onPage={setPdfPage} />
        ) : document.mimeType === "text/html" ? (
          <SandboxedHtmlViewer
            key={revision}
            html={text}
            title={document.name}
            inspection={{
              session,
              enabled: selecting,
              onSelection: (value) => {
                setSelection(value);
                setSelecting(false);
              },
            }}
          />
        ) : (
          <div className="p-5 text-sm break-words [overflow-wrap:anywhere]">
            {document.mimeType === "text/markdown" ? (
              <ChatMarkdown>{text}</ChatMarkdown>
            ) : (
              <pre className="whitespace-pre-wrap font-sans">{text}</pre>
            )}
          </div>
        )}
        {pdf && selecting && (
          <fieldset
            aria-label={t`Select a region of the visible PDF`}
            className="absolute inset-0 m-0 min-w-0 touch-none cursor-crosshair border-0 p-0"
            onPointerDown={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              start.current = {
                x: (event.clientX - rect.left) / rect.width,
                y: (event.clientY - rect.top) / rect.height,
              };
              setBox(null);
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const from = start.current;
              if (!from) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
              const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
              setBox({
                x: Math.min(from.x, x),
                y: Math.min(from.y, y),
                width: Math.abs(from.x - x),
                height: Math.abs(from.y - y),
              });
            }}
            onPointerCancel={() => {
              start.current = null;
              setBox(null);
            }}
            onPointerUp={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const from = start.current;
              if (!from) return;
              const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
              const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
              setSelection({
                region: `PDF page ${pdfPage}, visible viewport: ${Math.round(Math.min(from.x, x) * 100)}%,${Math.round(Math.min(from.y, y) * 100)}% to ${Math.round(Math.max(from.x, x) * 100)}%,${Math.round(Math.max(from.y, y) * 100)}%`,
              });
              start.current = null;
            }}
          >
            {box && (
              <div
                className="pointer-events-none absolute border-2 border-primary"
                style={{
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.width * 100}%`,
                  height: `${box.height * 100}%`,
                }}
              />
            )}
          </fieldset>
        )}
      </div>
      <form
        className={`${!mobile || showComment ? "flex" : "hidden"} shrink-0 flex-col gap-2 border-t border-border p-3`}
        onSubmit={(event) => {
          event.preventDefault();
          if (!note.trim()) return;
          const attachment =
            selectionScreenshot(selection?.screenshot) ??
            (document.bytes && !document.artifact
              ? new File([document.bytes.slice().buffer], document.name, {
                  type: document.mimeType,
                })
              : undefined);
          setCommentError(false);
          setPendingComment(onComment(reviewComment(document, selection, note), attachment));
        }}
      >
        {commentError && (
          <p
            role="alert"
            className="text-sm text-destructive"
          >{t`Could not attach the preview. Remove an attachment from the chat draft and try again. Your comment and selection are still here.`}</p>
        )}
        {selection && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <p className="min-w-0 flex-1 break-words">
              {selection.region || selection.selector || selection.text}
            </p>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`Clear selection`}
              onClick={() => setSelection(null)}
            >
              <X size={12} />
            </Button>
          </div>
        )}
        {selection?.screenshot && (
          <img
            src={selection.screenshot}
            alt={t`Selected element`}
            className="max-h-24 max-w-full self-start rounded border border-border object-contain"
          />
        )}
        <label
          className="text-xs"
          htmlFor={`review-note-${session}`}
        >{t`Comment for the agent`}</label>
        <textarea
          id={`review-note-${session}`}
          rows={2}
          maxLength={4000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline focus-visible:outline-ring"
        />
        <Button
          type="submit"
          variant="secondary"
          className="h-auto min-h-8 whitespace-normal py-2 text-center"
          disabled={!note.trim() || pendingComment !== null}
        >{t`Add to chat draft`}</Button>
      </form>
    </div>
  );
}
