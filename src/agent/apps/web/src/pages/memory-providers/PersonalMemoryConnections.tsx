import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot, MemoryConnection, MicoMemoryGrant } from "@mycellios/contracts";
import { Button, Checkbox, Field, FieldLabel, Input } from "@mycellios/ui-web";
import { useCallback, useEffect, useId, useState } from "react";
import { SettingsLabel } from "../../components/SettingsRows";
import { connectMcpOauth } from "../../lib/mcp-connect";
import { useSpaceRpc } from "../../lib/space-rpc";
import { errorText } from "../../lib/user-error";

function StatusText({ connection }: { connection: MemoryConnection }) {
  switch (connection.status) {
    case "compatible":
      return (
        <span className="text-success">
          {connection.capabilities.write ? <Trans>Read and write</Trans> : <Trans>Read only</Trans>}
        </span>
      );
    case "authorization_required":
      return (
        <span className="text-warning">
          <Trans>Needs authorization</Trans>
        </span>
      );
    case "incompatible":
      return (
        <span className="text-destructive">
          <Trans>Not a memory server</Trans>
        </span>
      );
    case "unreachable":
      return (
        <span className="text-destructive">
          <Trans>Unreachable</Trans>
        </span>
      );
    default:
      return (
        <span className="text-muted-foreground">
          <Trans>Not checked</Trans>
        </span>
      );
  }
}

/**
 * Personal memory servers over the open Memory MCP profile (specs/mcp-memory): connect,
 * authorize and check them, and choose which Micos may read each one (none by default).
 */
export function PersonalMemoryConnections({
  onBusyChange,
}: {
  onBusyChange?: (busy: boolean) => void;
}) {
  const rpc = useSpaceRpc();
  const { t } = useLingui();
  const nameId = useId();
  const endpointId = useId();
  const tokenId = useId();
  const accessId = useId();
  const [connections, setConnections] = useState<MemoryConnection[] | null>(null);
  const [grants, setGrants] = useState<MicoMemoryGrant[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const replace = (next: MemoryConnection) =>
    setConnections((current) =>
      current ? current.map((item) => (item.id === next.id ? next : item)) : [next],
    );

  useEffect(() => {
    let live = true;
    Promise.all([rpc.memory.connections.list(), rpc.memory.grants.list(), rpc.bots.list()])
      .then(([rows, granted, micos]) => {
        if (!live) return;
        setConnections(rows);
        setGrants(granted);
        setBots(micos);
      })
      .catch((err) => {
        if (live) setError(errorText(err, t`Could not load memory connections`));
      });
    return () => {
      live = false;
    };
  }, [rpc, t]);

  const run = useCallback(
    async (key: string, action: () => Promise<void>, failure: string) => {
      setError(null);
      setPending(key);
      onBusyChange?.(true);
      try {
        await action();
      } catch (err) {
        setError(errorText(err, failure));
      } finally {
        setPending(null);
        onBusyChange?.(false);
      }
    },
    [onBusyChange],
  );

  const authorizeAndCheck = async (connection: MemoryConnection) => {
    if (connection.oauthStatus !== "connected") {
      let result: Awaited<ReturnType<typeof connectMcpOauth>> | null = null;
      try {
        result = await connectMcpOauth(connection.serverId, rpc);
      } catch {
        // Servers without OAuth (bearer token or none) cannot start it; the check below
        // reports what the server itself answers.
      }
      if (result === "cancelled") return;
    }
    replace(await rpc.memory.connections.check({ id: connection.id }));
  };

  const add = () =>
    run(
      "add",
      async () => {
        const created = await rpc.memory.connections.create({
          name: name.trim(),
          endpoint: endpoint.trim(),
          ...(token.trim() ? { token: token.trim() } : {}),
          toolMapping: {},
        });
        setConnections((current) => [...(current ?? []), created]);
        setAdding(false);
        setName("");
        setEndpoint("");
        setToken("");
        await authorizeAndCheck(created);
      },
      t`Could not connect this memory`,
    );

  const toggleGrant = (connectionId: string, botId: string) =>
    run(
      `grant:${connectionId}`,
      async () => {
        const current = grants.filter((grant) => grant.connectionId === connectionId);
        const next = current.some((grant) => grant.botId === botId)
          ? current.filter((grant) => grant.botId !== botId)
          : [...current, { botId, autoRecall: true }];
        const saved = await rpc.memory.grants.set({
          connectionId,
          grants: next.map((grant) => ({ botId: grant.botId, autoRecall: grant.autoRecall })),
        });
        setGrants((all) => [
          ...all.filter((grant) => grant.connectionId !== connectionId),
          ...saved,
        ]);
      },
      t`Could not change which Micos can read this memory`,
    );

  const busy = pending !== null;
  const canAdd = name.trim().length > 0 && endpoint.trim().length > 0;

  return (
    <section className="rounded-xl border border-border px-4 py-4" data-testid="personal-memory">
      <h3 className="text-heading3 font-medium text-foreground">
        <SettingsLabel
          name={t`Personal memory`}
          help={t`A memory server you own, connected over MCP. No Mico uses it until you give that Mico access.`}
        >
          <span>
            <Trans>Personal memory</Trans>
          </span>
        </SettingsLabel>
      </h3>
      {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}

      {connections?.map((connection) => (
        <div
          key={connection.id}
          className="mt-4 border-t border-border pt-4 first-of-type:border-0"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 break-words text-[14px] font-medium text-foreground">
              {connection.name}
            </p>
            <span className="text-[13px]">
              <StatusText connection={connection} />
            </span>
          </div>
          <p className="mt-1 break-all text-[13px] text-muted-foreground">{connection.endpoint}</p>
          {connection.message && connection.status !== "compatible" ? (
            <p className="mt-1 break-words text-[13px] text-muted-foreground">
              {connection.message}
            </p>
          ) : null}
          {connection.status === "compatible" && bots.length > 0 ? (
            <fieldset className="mt-3" data-testid="personal-memory-access">
              <legend className="text-[13px] text-muted-foreground">
                <Trans>Micos that can read it</Trans>
              </legend>
              <div className="mt-2 flex flex-col gap-2">
                {bots.map((bot) => (
                  <label
                    key={bot.id}
                    htmlFor={`${accessId}-${connection.id}-${bot.id}`}
                    className="flex min-w-0 items-center gap-2 text-[14px] text-foreground"
                  >
                    <Checkbox
                      id={`${accessId}-${connection.id}-${bot.id}`}
                      checked={grants.some(
                        (grant) => grant.connectionId === connection.id && grant.botId === bot.id,
                      )}
                      disabled={busy}
                      onCheckedChange={() => void toggleGrant(connection.id, bot.id)}
                    />
                    <span className="min-w-0 break-words" dir="auto">
                      {bot.name}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(
                  connection.id,
                  () => authorizeAndCheck(connection),
                  t`Could not check this memory`,
                )
              }
            >
              {connection.oauthStatus === "connected" || connection.status === "compatible" ? (
                <Trans>Check again</Trans>
              ) : (
                <Trans>Authorize</Trans>
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(
                  connection.id,
                  async () => {
                    await rpc.memory.connections.remove({ id: connection.id });
                    setConnections((current) =>
                      (current ?? []).filter((item) => item.id !== connection.id),
                    );
                    setGrants((all) => all.filter((grant) => grant.connectionId !== connection.id));
                  },
                  t`Could not remove this memory`,
                )
              }
            >
              <Trans>Remove</Trans>
            </Button>
          </div>
        </div>
      ))}

      {adding ? (
        <div className="mt-4">
          <Field>
            <FieldLabel htmlFor={nameId}>
              <Trans>Name</Trans>
            </FieldLabel>
            <Input
              id={nameId}
              value={name}
              disabled={busy}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field className="mt-4">
            <FieldLabel htmlFor={endpointId}>
              <Trans>MCP URL</Trans>
            </FieldLabel>
            <Input
              id={endpointId}
              value={endpoint}
              disabled={busy}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="https://"
              inputMode="url"
              autoComplete="off"
            />
          </Field>
          <Field className="mt-4">
            <FieldLabel htmlFor={tokenId}>
              <Trans>Bearer token (only without OAuth)</Trans>
            </FieldLabel>
            <Input
              id={tokenId}
              value={token}
              disabled={busy}
              onChange={(event) => setToken(event.target.value)}
              type="password"
              autoComplete="new-password"
            />
          </Field>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy || !canAdd}
              onClick={() => void add()}
            >
              {pending === "add" ? <Trans>Connecting…</Trans> : <Trans>Connect</Trans>}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setAdding(false)}>
              <Trans>Cancel</Trans>
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="mt-4 rounded-full"
          disabled={busy || connections === null}
          onClick={() => setAdding(true)}
        >
          <Trans>Connect personal memory</Trans>
        </Button>
      )}
    </section>
  );
}
