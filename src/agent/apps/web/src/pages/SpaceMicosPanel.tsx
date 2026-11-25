import { useLingui } from "@lingui/react/macro";
import type { MicoShare, MicoShareAudience, SharedMicoTarget, SpaceMembers, ThreadMessage } from "@mycellios/contracts";
import { MicoShareInputSchema } from "@mycellios/contracts";
import { Button, Input, NativeSelect, NativeSelectOption } from "@mycellios/ui-web";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { SettingsGroup } from "../components/SettingsRows";
import { useBoundSpaceId, useSpaceRpc } from "../lib/space-rpc";
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
        {shares.data.map((share) => <ManageMicoShare key={JSON.stringify(share)} share={share} people={members.people}
          onSaved={() => void shares.refetch()} />)}
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

function MemberConversation({ queryScope, target, onClose }: {
  queryScope: Array<string | null | undefined>;
  target: SharedMicoTarget;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const rpc = useSpaceRpc();
  const snapshot = useQuery({
    queryKey: ["shared-mico-thread", ...queryScope, target],
    queryFn: () => rpc.sharedMicos.get({ ...target, history: "recent" }),
    refetchInterval: (query) => query.state.data?.run ? 1500 : false,
  });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<{ text: string; nonce: string } | null>(null);
  async function send() {
    if (!text.trim() || busy || snapshot.error) return;
    if (pending.current?.text !== text) pending.current = { text, nonce: crypto.randomUUID() };
    setBusy(true);
    setError(null);
    try {
      await rpc.sharedMicos.send({ ...target, text, clientNonce: pending.current.nonce });
      pending.current = null;
      setText("");
      await snapshot.refetch();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  const visible = (snapshot.error ? [] : snapshot.data?.messages ?? []).filter((message) => message.role !== "system");
  const textBlocks = (message: ThreadMessage) => message.blocks.flatMap((block) => block.kind === "text" ? [block.text] : []);
  return (
    <section className="space-y-2 border-t border-border pt-2">
      <Button size="sm" variant="ghost" onClick={onClose}>{t`Close conversation`}</Button>
      {snapshot.data?.run && !snapshot.error ? <Button size="sm" variant="outline" disabled={busy}
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
        {visible.map((message) => <p key={message.id} dir="auto" className="whitespace-pre-wrap break-words text-sm">
          {textBlocks(message).join("\n")}
        </p>)}
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <Input aria-label={t`Message`} value={text} onChange={(event) => setText(event.target.value)} />
        <Button size="sm" type="submit" disabled={busy || !text.trim() || Boolean(snapshot.error)}>{t`Send`}</Button>
      </form>
      {snapshot.error || error ? <p role="alert">{error ?? errorText(snapshot.error)}</p> : null}
    </section>
  );
}
