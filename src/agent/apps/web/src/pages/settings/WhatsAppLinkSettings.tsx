import { Trans, useLingui } from "@lingui/react/macro";
import type { WhatsAppLink, WhatsAppSender } from "@rakazo/contracts";
import { productBrand } from "@rakazo/contracts";
import {
  Button,
  Disclosure,
  Input,
  NativeSelect,
  NativeSelectOption,
  RadioGroup,
  RadioGroupItem,
} from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { QrCode } from "../../components/ServerLinkCode";
import type { DesktopWhatsAppStatus } from "../../lib/desktop";
import { whatsappBridge } from "../../lib/desktop";
import { useSpaceQueries } from "../../lib/query";
import { rpc } from "../../lib/rpc";

const REFRESH_MS = 15_000;

type Mode = "personal" | "dedicated";
type Method = "qr" | "pairing_code";
type Bot = { id: string; name: string };

export function formatWhatsAppPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits ? `+${digits}` : phone;
}

function phoneDigits(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 15 ? digits : null;
}

function Row({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[14px] text-foreground/75">
      <span className="min-w-0 break-words">{children}</span>
      {actions ? <span className="flex shrink-0 flex-wrap gap-2">{actions}</span> : null}
    </li>
  );
}

function Meta({ children }: { children: ReactNode }) {
  return <span className="ml-2 text-[12px] text-muted-foreground">{children}</span>;
}

function Choice({
  value,
  title,
  children,
}: {
  value: string;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-3">
      <RadioGroupItem value={value} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-[14px] text-foreground">{title}</span>
        <span className="mt-0.5 block text-[12px] text-muted-foreground">{children}</span>
      </span>
    </label>
  );
}

/**
 * WhatsApp numbers linked to Mycellios Desktop as a linked device. The session
 * stays on the PC that linked it; the server keeps only which Mico answers and
 * who may write. Linking is only possible inside Desktop.
 */
export function WhatsAppLinkSettings({ bots }: { bots: Bot[] }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const linksQuery = useQuery({
    ...queries.whatsapp.links.list.queryOptions(),
    refetchInterval: REFRESH_MS,
  });
  const links = linksQuery.data ?? [];
  const bridge = whatsappBridge();
  const [bridgeReady, setBridgeReady] = useState(false);
  const [statuses, setStatuses] = useState<DesktopWhatsAppStatus[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [flowOpen, setFlowOpen] = useState(false);
  const [linked, setLinked] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    let live = true;
    void bridge
      .available()
      .then((available) => {
        if (live) setBridgeReady(available);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [bridge]);

  useEffect(() => {
    if (!bridge || !bridgeReady) return;
    let live = true;
    void bridge
      .status()
      .then((next) => {
        if (live) setStatuses(next);
      })
      .catch(() => undefined);
    const stop = bridge.onStatus((next) => {
      if (!live) return;
      setStatuses(next);
      void linksQuery.refetch();
    });
    return () => {
      live = false;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, bridgeReady]);

  async function run(key: string, action: () => Promise<unknown>) {
    setError(null);
    setPending(key);
    try {
      await action();
    } catch {
      setError(t`Couldn't update WhatsApp settings`);
    } finally {
      setPending(null);
      await linksQuery.refetch().catch(() => undefined);
    }
  }

  function localStatus(link: WhatsAppLink) {
    return statuses.find((status) => status.linkId === link.id);
  }

  function disconnect(link: WhatsAppLink) {
    const held = bridgeReady && bridge && localStatus(link);
    setConfirming(null);
    void run(`disconnect:${link.id}`, async () => {
      if (held) await bridge.disconnect(link.id);
      await rpc.whatsapp.links.remove({ linkId: link.id });
    });
  }

  const shownError =
    error ?? (linksQuery.isError ? t`Couldn't load linked WhatsApp numbers` : null);

  return (
    <section
      className="mt-8"
      data-testid="whatsapp-link-settings"
      aria-labelledby="whatsapp-link-title"
    >
      <h3 id="whatsapp-link-title" className="text-[13px] font-medium text-muted-foreground">
        <Trans>WhatsApp (this PC)</Trans>
      </h3>
      {shownError ? (
        <p role="alert" className="mt-3 text-[13px] text-destructive">
          {shownError}
        </p>
      ) : null}
      {links.length ? (
        <ul className="mt-3 space-y-5">
          {links.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              bots={bots}
              local={localStatus(link)}
              heldHere={Boolean(bridgeReady && localStatus(link))}
              pending={pending}
              confirming={confirming === link.id}
              onConfirm={(open) => setConfirming(open ? link.id : null)}
              onDisconnect={() => disconnect(link)}
              run={run}
            />
          ))}
        </ul>
      ) : null}
      {linked ? (
        <p role="status" className="mt-3 text-[14px] text-foreground">
          <Trans>Linked. Open "Message yourself" in WhatsApp and send your first task.</Trans>
        </p>
      ) : null}
      {bridge && bridgeReady ? (
        flowOpen ? (
          <LinkFlow
            bots={bots}
            statuses={statuses}
            onClose={() => setFlowOpen(false)}
            onLinked={() => {
              setFlowOpen(false);
              setLinked(true);
              void linksQuery.refetch();
            }}
          />
        ) : (
          <Button
            className="mt-3"
            variant="outline"
            disabled={!bots.length}
            onClick={() => {
              setLinked(false);
              setFlowOpen(true);
            }}
          >
            <Trans>Link WhatsApp</Trans>
          </Button>
        )
      ) : (
        <p className="mt-3 text-[13px] text-muted-foreground" data-testid="whatsapp-desktop-note">
          <Trans>
            Linking WhatsApp needs Mycellios Desktop, because the WhatsApp session stays on your PC.
          </Trans>{" "}
          {!bridge ? (
            <a
              href={new URL("/downloads/desktop", productBrand.apiBaseUrl).href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4"
            >
              <Trans>Get Mycellios Desktop</Trans>
            </a>
          ) : null}
        </p>
      )}
    </section>
  );
}

function LinkRow({
  link,
  bots,
  local,
  heldHere,
  pending,
  confirming,
  onConfirm,
  onDisconnect,
  run,
}: {
  link: WhatsAppLink;
  bots: Bot[];
  local: DesktopWhatsAppStatus | undefined;
  heldHere: boolean;
  pending: string | null;
  confirming: boolean;
  onConfirm: (open: boolean) => void;
  onDisconnect: () => void;
  run: (key: string, action: () => Promise<unknown>) => Promise<void>;
}) {
  const { t } = useLingui();
  const state = local
    ? local.state === "connected"
      ? "connected"
      : local.state === "logged_out" || local.state === "error"
        ? "disconnected"
        : "connecting"
    : link.status === "logged_out"
      ? "disconnected"
      : link.status;
  const botOptions = bots.some((bot) => bot.id === link.botId)
    ? bots
    : [{ id: link.botId, name: link.botName }, ...bots];
  const busy = pending !== null;

  return (
    <li className="rounded-lg border border-border px-3 py-3 text-[14px] text-foreground/75">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="min-w-0 break-words">
          <span className="text-foreground">{formatWhatsAppPhone(link.phone)}</span>
          {link.pushName ? <Meta>{link.pushName}</Meta> : null}
          <span className="block text-[12px] text-muted-foreground">
            {link.mode === "personal" ? t`Personal number` : t`Number only for Mycellios`}
            {" · "}
            <span data-state={state}>
              {state === "connected"
                ? t`Connected`
                : state === "connecting"
                  ? t`Connecting`
                  : t`Disconnected`}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center gap-2">
          <NativeSelect
            aria-label={t`Mico for ${formatWhatsAppPhone(link.phone)}`}
            value={link.botId}
            disabled={busy}
            onChange={(event) => {
              const botId = event.target.value;
              void run(`bot:${link.id}`, () =>
                rpc.whatsapp.links.setBot({ linkId: link.id, botId }),
              );
            }}
          >
            {botOptions.map((bot) => (
              <NativeSelectOption key={bot.id} value={bot.id}>
                {bot.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {!confirming ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onConfirm(true)}>
              <Trans>Disconnect</Trans>
            </Button>
          ) : null}
        </span>
      </div>
      {state === "disconnected" ? (
        <p className="mt-2 text-[12px] text-muted-foreground">
          <Trans>
            Open Mycellios Desktop on the PC that linked it. WhatsApp removes a linked device after
            about 14 days offline.
          </Trans>
        </p>
      ) : null}
      {confirming ? (
        <div
          className="mt-3 rounded-lg bg-muted px-3 py-3"
          role="group"
          aria-label={t`Disconnect this number?`}
        >
          <p className="text-[13px] text-foreground">
            {heldHere ? (
              <Trans>This PC logs out of WhatsApp and the Mico stops answering this number.</Trans>
            ) : (
              <Trans>
                The Mico stops answering this number. The PC that linked it logs out next time it
                connects. You can also remove it in WhatsApp → Linked devices.
              </Trans>
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="destructive" disabled={busy} onClick={onDisconnect}>
              <Trans>Disconnect</Trans>
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onConfirm(false)}>
              <Trans>Cancel</Trans>
            </Button>
          </div>
        </div>
      ) : null}
      <Senders link={link} busy={busy} run={run} />
    </li>
  );
}

function Senders({
  link,
  busy,
  run,
}: {
  link: WhatsAppLink;
  busy: boolean;
  run: (key: string, action: () => Promise<unknown>) => Promise<void>;
}) {
  const { t } = useLingui();
  const [phone, setPhone] = useState("");
  const [groupJid, setGroupJid] = useState("");
  const allowed = link.senders.filter((sender) => sender.status === "allowed");
  const pendingSenders = link.senders.filter((sender) => sender.status === "pending");
  const denied = link.senders.filter((sender) => sender.status === "denied");
  const allowedGroups = new Set(allowed.filter((s) => s.kind === "group").map((s) => s.jid));
  const groups = link.groups.filter((group) => !allowedGroups.has(group.jid));
  const selectedGroup = groups.some((group) => group.jid === groupJid)
    ? groupJid
    : (groups[0]?.jid ?? "");
  const digits = phoneDigits(phone);

  const label = (sender: WhatsAppSender) =>
    sender.kind === "contact" ? formatWhatsAppPhone(sender.label) : sender.label || t`Group`;
  const remove = (sender: WhatsAppSender) => (
    <Button
      size="sm"
      variant="ghost"
      disabled={busy}
      onClick={() =>
        void run(`sender:${sender.id}`, () => rpc.whatsapp.senders.remove({ senderId: sender.id }))
      }
    >
      <Trans>Remove</Trans>
    </Button>
  );

  return (
    <div className="mt-4 space-y-4">
      {pendingSenders.length ? (
        <div>
          <h4 className="text-[12px] font-medium text-muted-foreground">
            <Trans>Requests</Trans>
          </h4>
          <ul className="mt-2 space-y-2">
            {pendingSenders.map((sender) => (
              <Row
                key={sender.id}
                actions={
                  <>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(`sender:${sender.id}`, () =>
                          rpc.whatsapp.senders.respond({ senderId: sender.id, accept: true }),
                        )
                      }
                    >
                      <Trans>Approve</Trans>
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(`sender:${sender.id}`, () =>
                          rpc.whatsapp.senders.respond({ senderId: sender.id, accept: false }),
                        )
                      }
                    >
                      <Trans>Deny</Trans>
                    </Button>
                  </>
                }
              >
                <span className="text-foreground">{label(sender)}</span>
                {sender.code ? (
                  <Meta>
                    <Trans>Code</Trans>{" "}
                    <span className="font-mono text-foreground">{sender.code}</span>
                  </Meta>
                ) : null}
              </Row>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <h4 className="text-[12px] font-medium text-muted-foreground">
          <Trans>Who can write</Trans>
        </h4>
        {allowed.length ? (
          <ul className="mt-2 space-y-2">
            {allowed.map((sender) => (
              <Row key={sender.id} actions={remove(sender)}>
                {label(sender)}
                {sender.kind === "group" ? (
                  <Meta>
                    <Trans>Group</Trans>
                  </Meta>
                ) : null}
              </Row>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[12px] text-muted-foreground">
            {link.mode === "personal" ? (
              <Trans>Only your "Message yourself" chat.</Trans>
            ) : (
              <Trans>No one yet.</Trans>
            )}
          </p>
        )}
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!digits) return;
            void run(`add:${link.id}`, async () => {
              await rpc.whatsapp.senders.add({ linkId: link.id, kind: "contact", phone: digits });
              setPhone("");
            });
          }}
        >
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="off"
            className="h-9 w-48 max-w-full"
            aria-label={t`Phone number with country code`}
            placeholder="+34 600 000 000"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
          <Button type="submit" size="sm" variant="secondary" disabled={busy || !digits}>
            <Trans>Add contact</Trans>
          </Button>
        </form>
        {groups.length ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <NativeSelect
              aria-label={t`Group`}
              value={selectedGroup}
              onChange={(event) => setGroupJid(event.target.value)}
            >
              {groups.map((group) => (
                <NativeSelectOption key={group.jid} value={group.jid}>
                  {group.name || group.jid}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !selectedGroup}
              onClick={() =>
                void run(`add:${link.id}`, () =>
                  rpc.whatsapp.senders.add({ linkId: link.id, kind: "group", jid: selectedGroup }),
                )
              }
            >
              <Trans>Add group</Trans>
            </Button>
          </div>
        ) : null}
      </div>

      {denied.length ? (
        <Disclosure
          summary={<Trans>Denied ({denied.length})</Trans>}
          summaryClassName="text-[12px] font-medium text-muted-foreground"
        >
          <ul className="mt-2 space-y-2">
            {denied.map((sender) => (
              <Row key={sender.id} actions={remove(sender)}>
                {label(sender)}
              </Row>
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </div>
  );
}

function LinkFlow({
  bots,
  statuses,
  onClose,
  onLinked,
}: {
  bots: Bot[];
  statuses: DesktopWhatsAppStatus[];
  onClose: () => void;
  onLinked: () => void;
}) {
  const { t } = useLingui();
  const bridge = whatsappBridge();
  const [mode, setMode] = useState<Mode | null>(null);
  const [botId, setBotId] = useState(bots[0]?.id ?? "");
  const [method, setMethod] = useState<Method>("qr");
  const [phone, setPhone] = useState("");
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = sessionKey
    ? statuses.find((status) => status.sessionKey === sessionKey)
    : undefined;
  const digits = phoneDigits(phone);
  const chosenBot = bots.find((bot) => bot.id === botId)?.id ?? bots[0]?.id ?? "";

  useEffect(() => {
    if (session?.state === "connected") onLinked();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.state]);

  async function start() {
    if (!bridge || !mode || !chosenBot) return;
    if (method === "pairing_code" && !digits) return;
    setError(null);
    setStarting(true);
    try {
      const started = await bridge.link({
        botId: chosenBot,
        mode,
        method,
        ...(method === "pairing_code" && digits ? { phone: digits } : {}),
      });
      setSessionKey(started.sessionKey);
    } catch {
      setError(t`Couldn't start linking. Try again.`);
    } finally {
      setStarting(false);
    }
  }

  async function cancel() {
    const key = sessionKey;
    setSessionKey(null);
    setError(null);
    if (key && bridge) await bridge.cancel(key).catch(() => undefined);
    onClose();
  }

  const sessionError =
    session?.state === "error"
      ? (session.error ?? t`Linking failed. Try again.`)
      : session?.state === "logged_out"
        ? t`WhatsApp ended the link. Try again.`
        : null;
  const shownError = error ?? sessionError;

  if (sessionKey) {
    const code = session?.pairingCode;
    return (
      <div
        className="mt-3 rounded-lg border border-border px-4 py-4"
        data-testid="whatsapp-link-session"
      >
        {shownError ? (
          <p role="alert" className="text-[13px] text-destructive">
            {shownError}
          </p>
        ) : method === "qr" ? (
          session?.qr ? (
            <div className="flex flex-col items-center gap-3">
              <QrCode
                value={session.qr}
                label={t`WhatsApp link code`}
                failedText={t`Could not show the code. Use a pairing code instead.`}
              />
              <p className="text-center text-[13px] text-foreground/75">
                <Trans>
                  On your phone open WhatsApp → Linked devices → Link a device and scan this code.
                </Trans>
              </p>
            </div>
          ) : (
            <p role="status" className="text-[13px] text-muted-foreground">
              <Trans>Preparing code…</Trans>
            </p>
          )
        ) : code ? (
          <div className="flex flex-col items-center gap-3">
            <p
              className="font-mono text-2xl tracking-widest text-foreground"
              data-testid="whatsapp-pairing-code"
            >
              {code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code}
            </p>
            <p className="text-center text-[13px] text-foreground/75">
              <Trans>
                WhatsApp → Linked devices → Link a device → Link with phone number instead, then
                type this code.
              </Trans>
            </p>
          </div>
        ) : (
          <p role="status" className="text-[13px] text-muted-foreground">
            <Trans>Preparing code…</Trans>
          </p>
        )}
        {session?.state === "connecting" ? (
          <p role="status" className="mt-3 text-center text-[13px] text-muted-foreground">
            <Trans>Connecting…</Trans>
          </p>
        ) : null}
        <div className="mt-4 flex justify-center">
          <Button size="sm" variant="secondary" onClick={() => void cancel()}>
            <Trans>Cancel</Trans>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="mt-3 space-y-5 rounded-lg border border-border px-4 py-4"
      data-testid="whatsapp-link-flow"
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <fieldset>
        <legend className="text-[13px] font-medium text-foreground">
          <Trans>1. Whose number?</Trans>
        </legend>
        <RadioGroup
          className="mt-2"
          aria-label={t`Whose number?`}
          value={mode}
          onValueChange={(value) => setMode(value as Mode)}
        >
          <Choice value="personal" title={<Trans>My personal number</Trans>}>
            <Trans>
              Only your own "Message yourself" chat and the contacts and groups you allow reach your
              Mico. Mycellios never writes to anyone else first.
            </Trans>
          </Choice>
          <Choice value="dedicated" title={<Trans>A number only for Mycellios</Trans>}>
            <Trans>
              People you didn't allow get one message with a 6-character code. You approve them
              here.
            </Trans>
          </Choice>
        </RadioGroup>
        <p className="mt-2 text-[12px] text-muted-foreground">
          <Trans>
            WhatsApp doesn't permit unofficial clients and can restrict or block a number it sees as
            automated. A number used only for Mycellios is safer than your personal one.
          </Trans>
        </p>
      </fieldset>

      {mode ? (
        <fieldset>
          <legend className="text-[13px] font-medium text-foreground">
            <Trans>2. Which Mico answers?</Trans>
          </legend>
          <NativeSelect
            className="mt-2"
            aria-label={t`Mico`}
            value={chosenBot}
            onChange={(event) => setBotId(event.target.value)}
          >
            {bots.map((bot) => (
              <NativeSelectOption key={bot.id} value={bot.id}>
                {bot.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </fieldset>
      ) : null}

      {mode ? (
        <fieldset>
          <legend className="text-[13px] font-medium text-foreground">
            <Trans>3. How to link</Trans>
          </legend>
          <RadioGroup
            className="mt-2"
            aria-label={t`How to link`}
            value={method}
            onValueChange={(value) => setMethod(value as Method)}
          >
            <Choice value="qr" title={<Trans>QR code</Trans>}>
              <Trans>Scan a code with your phone.</Trans>
            </Choice>
            <Choice value="pairing_code" title={<Trans>Pairing code</Trans>}>
              <Trans>Type a code on your phone instead.</Trans>
            </Choice>
          </RadioGroup>
          {method === "pairing_code" ? (
            <Input
              type="tel"
              inputMode="tel"
              autoComplete="off"
              className="mt-3 h-9 w-56 max-w-full"
              aria-label={t`WhatsApp phone number with country code`}
              placeholder="+34 600 000 000"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          ) : null}
        </fieldset>
      ) : null}

      {shownError ? (
        <p role="alert" className="text-[13px] text-destructive">
          {shownError}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={starting || !mode || !chosenBot || (method === "pairing_code" && !digits)}
        >
          {method === "qr" ? <Trans>Show QR code</Trans> : <Trans>Get pairing code</Trans>}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          <Trans>Cancel</Trans>
        </Button>
      </div>
    </form>
  );
}
