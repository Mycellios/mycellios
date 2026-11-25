import { useLingui } from "@lingui/react/macro";
import type { MicoShare, MicoShareAudience, SharedMicoTarget, SpaceMembers, ThreadMessage } from "@mycellios/contracts";
import { ATTACHMENT_MAX_COUNT, MicoShareInputSchema } from "@mycellios/contracts";
import { isApprovalAskBlock, isSecretAskBlock } from "@mycellios/core";
import { Button, Input, NativeSelect, NativeSelectOption } from "@mycellios/ui-web";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { SettingsGroup } from "../components/SettingsRows";
import { AskCard } from "../components/AskCard";
import { decodeArtifactBase64, downloadArtifactBytes } from "../lib/artifact-open";
import { useBoundSpaceId, useSpaceRpc } from "../lib/space-rpc";
import { readFileAsBase64 } from "../lib/pending-attachments";
import { errorText } from "../lib/user-error";

export function SpaceMicosPanel({ members }: { members: SpaceMembers }) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const spaceId = useBoundSpaceId();
  const viewer = members.people.find((person) => person.you)?.userId;
  const scope = [spaceId, viewer];
  const manage = members.role === "owner" || members.role === "admin";
  const shared = useQuery({
    queryKey: ["shared-space-micos", ...scope],
    queryFn: () => rpc.sharedMicos.list(),
    enabled: Boolean(viewer) && members.role !== "owner",
  });
  const shares = useQuery({
    queryKey: ["managed-space-micos", ...scope],
    queryFn: () => rpc.spaces.shares.list(),
    enabled: Boolean(viewer) && manage,
  });
  const [target, setTarget] = useState<SharedMicoTarget | null>(null);
  const [opening, setOpening] = useState(false);
  const openingRequest = useRef<{ botId: string; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function open(botId: string) {
    if (opening) return;
    setOpening(true);
    setError(null);
    if (openingRequest.current?.botId !== botId)
      openingRequest.current = { botId, key: crypto.randomUUID() };
    try {
      const { threadId } = await rpc.sharedMicos.open({ botId, requestKey: openingRequest.current.key });
      openingRequest.current = null;
      setTarget({ botId, taskThreadId: threadId });
      void shared.refetch();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setOpening(false);
    }
  }
  return (
    <div className="space-y-4">
      <h3 className="font-medium">{t`Shared Micos`}</h3>
      {shares.error || shared.error ? <p role="alert">{errorText(shares.error ?? shared.error)}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {manage && shares.data?.length ? <SettingsGroup>
        {shares.data.map((share) => <div key={share.botId}>
          <ManageMicoShare key={JSON.stringify(share)} share={share} people={members.people}
            onSaved={() => void shares.refetch()} />
          {members.role === "owner" ? <OwnerConversations botId={share.botId} scope={scope} people={members.people} /> : null}
        </div>)}
      </SettingsGroup> : null}
      {shared.data && !shared.data.micos.length ? <p className="text-sm text-muted-foreground">{t`No Micos have been shared with you.`}</p> : null}
      {shared.data?.micos.map((mico) => <SettingsGroup key={mico.botId}>
        <div className="space-y-2 p-3">
          <p className="font-medium">{mico.name}</p>
          <p className="text-sm text-muted-foreground">{mico.ownerName}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={opening} onClick={() => void open(mico.botId)}>{t`New conversation`}</Button>
            {mico.conversations.map((thread) => <Button key={thread.threadId} size="sm" variant="outline"
              onClick={() => setTarget({ botId: mico.botId, taskThreadId: thread.threadId })}>
              {thread.title}
            </Button>)}
          </div>
          {target?.botId === mico.botId ? <MemberConversation key={target.taskThreadId}
            queryScope={scope} target={target} onClose={() => setTarget(null)} /> : null}
        </div>
      </SettingsGroup>)}
    </div>
  );
}

function ManageMicoShare({ share, people, onSaved }: {
  share: MicoShare;
  people: SpaceMembers["people"];
  onSaved: () => void;
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const [audience, setAudience] = useState(share.audience);
  const [picked, setPicked] = useState(share.userIds);
  const [allowance, setAllowance] = useState(String(share.dailyAllowanceMicros / 1_000_000));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const members = people.filter((person) => person.role !== "owner");
  const parsed = MicoShareInputSchema.safeParse({
    botId: share.botId,
    audience,
    userIds: audience === "people" ? picked.filter((id) => members.some((person) => person.userId === id)) : [],
    dailyAllowanceMicros: allowance.trim() ? Math.round(Number(allowance) * 1_000_000) : NaN,
  });
  async function save() {
    if (!parsed.success || busy) return;
    setBusy(true);
    setError(null);
    try {
      await rpc.spaces.shares.set(parsed.data);
      onSaved();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="space-y-2 p-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <p className="font-medium">{share.name}</p>
      <label className="grid gap-1 text-sm">
        {t`Who can chat with this Mico`}
        <NativeSelect value={audience} onChange={(event) => setAudience(event.target.value as MicoShareAudience)}>
          <NativeSelectOption value="none">{t`Nobody`}</NativeSelectOption>
          <NativeSelectOption value="everyone">{t`Everyone in this Space`}</NativeSelectOption>
          <NativeSelectOption value="people">{t`Selected people`}</NativeSelectOption>
        </NativeSelect>
      </label>
      {audience === "people" ? <div className="flex flex-wrap gap-2">
        {members.map((person) => {
          const selected = picked.includes(person.userId);
          return <Button type="button" key={person.userId} size="sm" aria-pressed={selected}
            variant={selected ? "default" : "outline"}
            onClick={() => setPicked((ids) => selected ? ids.filter((id) => id !== person.userId) : [...ids, person.userId])}>
            {person.name || person.email || t`Member`}
          </Button>;
        })}
      </div> : null}
      {audience !== "none" ? <label className="grid gap-1 text-sm">
        {t`Daily Credits per person, paid by the Mico owner`}
        <Input value={allowance} onChange={(event) => setAllowance(event.target.value)}
          type="number" min="0" max="100" step="0.000001" required />
      </label> : null}
      <Button type="submit" size="sm" disabled={busy || !parsed.success}>{t`Save sharing`}</Button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

function OwnerConversations({ botId, scope, people }: {
  botId: string;
  scope: Array<string | null | undefined>;
  people: SpaceMembers["people"];
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const conversations = useQuery({
    queryKey: ["owner-mico-conversations", ...scope, botId],
    queryFn: () => rpc.spaces.shares.conversations({ botId }),
    enabled: open,
  });
  return <div className="space-y-2 px-3 pb-3">
    <Button size="sm" variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>
      {t`Member conversations`}
    </Button>
    {open ? <>
      {conversations.error ? <p role="alert">{errorText(conversations.error)}</p> : null}
      {conversations.data?.map((thread) => {
        const member = people.find((person) => person.userId === thread.memberUserId);
        return <div key={thread.threadId}>
          <Button size="sm" variant="ghost" onClick={() => setThreadId(thread.threadId)}>
            {member?.name || t`Member`} · {thread.title || t`Conversation`}
          </Button>
          {threadId === thread.threadId ? <MemberConversation key={threadId} queryScope={scope} readOnly
            target={{ botId, taskThreadId: thread.threadId }} onClose={() => setThreadId(null)} /> : null}
        </div>;
      })}
    </> : null}
  </div>;
}

function MemberConversation({ queryScope, target, onClose, readOnly = false }: {
  queryScope: Array<string | null | undefined>;
  target: SharedMicoTarget;
  onClose: () => void;
  readOnly?: boolean;
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const snapshot = useQuery({
    queryKey: ["shared-mico-thread", ...queryScope, target, readOnly],
    queryFn: () => readOnly
      ? rpc.threads.get({ ...target, history: "recent" })
      : rpc.sharedMicos.get({ ...target, history: "recent" }),
    refetchInterval: (query) => query.state.data?.run ? 1500 : false,
  });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [older, setOlder] = useState<{ messages: ThreadMessage[]; cursor: number | null } | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [files, setFiles] = useState<Array<{ id: string; name: string }>>([]);
  const pending = useRef<{ signature: string; nonce: string } | null>(null);
  const before = older ? older.cursor : snapshot.data?.olderCursor;
  async function loadOlder() {
    if (before == null || loadingHistory) return;
    setLoadingHistory(true);
    try {
      const page = readOnly
        ? await rpc.threads.messages({ ...target, before })
        : await rpc.sharedMicos.messages({ ...target, before });
      setOlder((current) => ({ messages: [...page.messages, ...(current?.messages ?? [])], cursor: page.olderCursor }));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoadingHistory(false);
    }
  }
  async function upload(file: File) {
    if (readOnly || busy || files.length >= ATTACHMENT_MAX_COUNT) return;
    setBusy(true);
    setError(null);
    try {
      const artifact = await rpc.sharedMicos.upload({
        ...target, name: file.name, mimeType: file.type || "application/octet-stream",
        contentBase64: await readFileAsBase64(file), clientNonce: crypto.randomUUID(),
      });
      setFiles((current) => [...current, { id: artifact.id, name: file.name }]);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  async function download(artifactId: string) {
    if (busy || snapshot.error) return;
    setBusy(true);
    setError(null);
    try {
      const artifact = readOnly
        ? await rpc.artifacts.get({ botId: target.botId, artifactId })
        : await rpc.sharedMicos.file({ ...target, artifactId });
      downloadArtifactBytes(artifact.name, artifact.mimeType, decodeArtifactBase64(artifact.contentBase64));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (readOnly || (!text.trim() && !files.length) || busy || snapshot.error) return;
    const artifactIds = files.map((file) => file.id);
    const signature = JSON.stringify([text, artifactIds]);
    if (pending.current?.signature !== signature) pending.current = { signature, nonce: crypto.randomUUID() };
    setBusy(true);
    setError(null);
    try {
      await rpc.sharedMicos.send({ ...target, text, artifactIds, clientNonce: pending.current.nonce });
      pending.current = null;
      setText("");
      setFiles([]);
      await snapshot.refetch();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  const byId = new Map([...(older?.messages ?? []), ...(snapshot.data?.messages ?? [])].map((message) => [message.id, message]));
  const visible = snapshot.error ? [] : [...byId.values()]
    .filter((message) => message.role !== "system").sort((a, b) => a.seq - b.seq);
  return (
    <section className="space-y-2 border-t border-border pt-2">
      <Button size="sm" variant="ghost" onClick={onClose}>{t`Close conversation`}</Button>
      {!readOnly && snapshot.data?.run && !snapshot.error ? <Button size="sm" variant="outline" disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void rpc.sharedMicos.stop(target)
            .then(() => snapshot.refetch())
            .catch((cause) => setError(errorText(cause)))
            .finally(() => setBusy(false));
        }}>
        {t`Stop`}
      </Button> : null}
      <div className="max-h-64 space-y-2 overflow-auto" aria-live="polite">
        {before != null && !snapshot.error ? <Button size="sm" variant="ghost" disabled={loadingHistory}
          onClick={() => void loadOlder()}>{t`Load earlier messages`}</Button> : null}
        {visible.map((message) => <div key={message.id} dir="auto" className="whitespace-pre-wrap break-words text-sm">
          {message.blocks.map((block, index) => {
            if (block.kind === "text") return <p key={index}>{block.text}</p>;
            if (block.kind === "file" || block.kind === "image") {
              return <Button type="button" key={index} size="sm" variant="outline" disabled={busy}
                onClick={() => void download(block.artifactId)}>{block.name}</Button>;
            }
            const runId = message.runId;
            if (block.kind !== "ask" || message.role !== "bot" || !runId ||
                isSecretAskBlock(block) || isApprovalAskBlock(block) ||
                block.location || block.plan || block.instructionUpdate) return null;
            return <AskCard key={index} block={block} canAnswer={!readOnly && block.status !== "answered"}
              canDismiss={false} onDismiss={async () => {}}
              onAnswer={async (answer) => {
                if (readOnly) return;
                await rpc.sharedMicos.answer({
                  ...target, messageId: message.id, runId, answer, clientNonce: crypto.randomUUID(),
                });
                await snapshot.refetch();
              }} />;
          })}
        </div>)}
      </div>
      {!readOnly ? <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <Input aria-label={t`Message`} value={text} onChange={(event) => setText(event.target.value)} />
        <Input type="file" aria-label={t`Attach file`} disabled={busy || files.length >= ATTACHMENT_MAX_COUNT}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void upload(file);
          }} />
        {files.map((file) => <Button type="button" key={file.id} variant="ghost" size="sm" disabled={busy}
          onClick={() => setFiles((current) => current.filter((item) => item.id !== file.id))}>
          {t`Remove ${file.name}`}
        </Button>)}
        <Button size="sm" type="submit" disabled={busy || (!text.trim() && !files.length) || Boolean(snapshot.error)}>{t`Send`}</Button>
      </form> : null}
      {snapshot.error || error ? <p role="alert">{error ?? errorText(snapshot.error)}</p> : null}
    </section>
  );
}
