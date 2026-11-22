import { useLingui } from "@lingui/react/macro";
import type { SideThreadRequest } from "@mycellios/contracts";
import { Button } from "@mycellios/ui-web";
import { Hand, KeyRound, ListChecks, MessageCircleQuestion, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { RpcClient } from "../lib/rpc";
import { AskCard, type AskBlock } from "./AskCard";

/** While requests are shown, how often the main chat checks whether one was answered elsewhere. */
const REQUESTS_POLL_MS = 5_000;

type BoundClient = Pick<RpcClient, "threads">;

/** Asks the main chat can answer in place; credentials and takeovers open their conversation. */
export const answersInMainChat = (request: SideThreadRequest) =>
  Boolean(request.block && request.messageId && (request.kind === "question" || request.kind === "approval" || request.kind === "plan"));

/**
 * Questions, approvals and takeovers of a Mico's open conversations, shown again at the end of
 * its main chat as compact cards. An answer goes through that conversation's own fenced answer
 * operation, with a client bound to it and read first; once answered anywhere the card leaves.
 */
export function MirroredRequests({ botId, enabled, revision, rpc, bind, onOpenConversation }: {
  botId: string;
  /** Some conversation waits for the person, as the roster reports. */
  enabled: boolean;
  /** Changes when the Mico's conversations move, so the cards are read again. */
  revision?: string;
  rpc: Pick<RpcClient, "development">;
  bind: (threadId: string) => BoundClient;
  onOpenConversation: (threadId: string) => void;
}) {
  const { t } = useLingui();
  const [requests, setRequests] = useState<SideThreadRequest[]>([]);
  const [reload, setReload] = useState(0);
  const clients = useRef(new Map<string, { client: BoundClient; admitted: boolean }>());
  useEffect(() => { clients.current.clear(); }, [botId]);

  useEffect(() => {
    if (!enabled) { setRequests([]); return; }
    let live = true;
    let timer: number | undefined;
    const load = async () => {
      try {
        const listed = await rpc.development.requests({ botId });
        if (!live) return;
        setRequests(listed);
        if (listed.length) timer = window.setTimeout(() => { if (document.visibilityState === "visible") void load(); }, REQUESTS_POLL_MS);
      } catch {
        // The conversation keeps its own card; the mirror tries again on the next change.
      }
    };
    void load();
    return () => { live = false; window.clearTimeout(timer); };
  }, [enabled, rpc, botId, revision, reload]);

  if (!enabled || !requests.length) return null;

  async function answer(request: SideThreadRequest, text: string, username?: string, dismiss?: boolean) {
    if (!request.messageId) return;
    let entry = clients.current.get(request.threadId);
    if (!entry) {
      entry = { client: bind(request.threadId), admitted: false };
      clients.current.set(request.threadId, entry);
    }
    // A conversation's client writes only after it read that conversation.
    if (!entry.admitted) { await entry.client.threads.head({ botId }); entry.admitted = true; }
    await entry.client.threads.answer({ botId, runId: request.runId, messageId: request.messageId,
      answer: dismiss ? "" : text, ...(username ? { username } : {}), ...(dismiss ? { dismiss: true as const } : {}) });
    setRequests(current => current.filter(item => item.runId !== request.runId || item.messageId !== request.messageId));
    setReload(value => value + 1);
  }

  const label = (request: SideThreadRequest) => {
    const title = request.title || t`New conversation`;
    switch (request.kind) {
      case "approval": return t`Approval needed in ${title}`;
      case "plan": return t`Plan to confirm in ${title}`;
      case "secret": return t`A credential is needed in ${title}`;
      case "takeover": return t`Take over needed in ${title}`;
      default: return t`Question in ${title}`;
    }
  };
  const Icon = (request: SideThreadRequest) => request.kind === "approval" ? ShieldCheck : request.kind === "plan" ? ListChecks
    : request.kind === "secret" ? KeyRound : request.kind === "takeover" ? Hand : MessageCircleQuestion;

  return <section data-testid="mirrored-requests" aria-label={t`Requests from conversations`}
    className="mx-auto mt-3 flex w-full max-w-[42rem] flex-col gap-2">
    {requests.map(request => {
      const RequestIcon = Icon(request);
      const inline = answersInMainChat(request);
      return <div key={`${request.threadId}:${request.runId}:${request.messageId ?? "takeover"}`} data-mirrored-request={request.threadId}
        data-request-kind={request.kind} className="rounded-2xl border border-border bg-muted/40 px-3 py-2.5">
        <div className="mb-1.5 flex min-w-0 items-center gap-2 text-xs font-medium text-warning">
          <RequestIcon size={14} className="shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate" dir="auto">{label(request)}</span>
          <Button size="xs" variant="ghost" className="ms-auto shrink-0 font-medium text-foreground"
            onClick={() => onOpenConversation(request.threadId)}>{t`Open conversation`}</Button>
        </div>
        {inline ? <AskCard block={request.block as AskBlock} canAnswer canDismiss={false}
          onAnswer={(text, username) => answer(request, text, username)}
          onDismiss={() => answer(request, "", undefined, true)} />
          : request.block && "text" in request.block && request.block.text
            ? <p className="text-sm text-muted-foreground" dir="auto">{request.block.text}</p>
            : request.kind === "takeover" ? <p className="text-sm text-muted-foreground">{t`Open the conversation to take over the computer.`}</p>
            : <p className="text-sm text-muted-foreground">{t`Open the conversation to answer.`}</p>}
      </div>;
    })}
  </section>;
}
