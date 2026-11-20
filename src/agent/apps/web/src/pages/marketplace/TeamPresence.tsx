import type { HostedWebPresence, HostedWebTeamMember } from "@rakazo/contracts";
import { BotAvatar, parseBotAvatar } from "@rakazo/ui-web";
import type { CSSProperties, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import type { createSpaceRpc } from "../../lib/rpc";

type WebsClient = ReturnType<typeof createSpaceRpc>["webs"];

/** A cursor fades 8 s after its run's last real app_read/app_write. */
export const PRESENCE_FADE_MS = 8_000;
const TEAM_POLL_MS = 3_000;
const RETRY_MS = 5_000;
const LOCATE_MS = 1_500;

export type PresenceCursor = {
  runId: string;
  botId: string;
  path: string | null;
  phase: "reading" | "writing";
  target?: HostedWebPresence["target"];
  at: number;
};

/** Live cursors from presence signals, kept only for Micos whose runs are still running. */
export function liveCursors(
  cursors: ReadonlyMap<string, PresenceCursor>,
  members: readonly HostedWebTeamMember[],
  now: number,
): PresenceCursor[] {
  const running = new Set(members.filter((m) => m.state === "running").map((m) => m.botId));
  return [...cursors.values()].filter(
    (cursor) => running.has(cursor.botId) && now - cursor.at < PRESENCE_FADE_MS,
  );
}

/**
 * The app's team (from real run states) and its live presence signals. Both stop when the
 * editor closes or the page is hidden; an older server without them leaves the editor as is.
 */
export function useTeamPresence(client: WebsClient, siteId: string, enabled: boolean) {
  const [members, setMembers] = useState<HostedWebTeamMember[]>([]);
  const [cursors, setCursors] = useState<Map<string, PresenceCursor>>(new Map());
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef(client);
  latest.current = client;

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (document.visibilityState === "visible") {
          const team = await latest.current.team({ id: siteId });
          if (live) setMembers(team.members);
        }
      } catch {
        if (live) setMembers([]);
      } finally {
        if (live) timer = setTimeout(poll, TEAM_POLL_MS);
      }
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
      setMembers([]);
    };
  }, [siteId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let controller: AbortController | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const follow = async () => {
      while (live) {
        controller = new AbortController();
        try {
          const stream = await latest.current.presence(
            { id: siteId },
            { signal: controller.signal },
          );
          for await (const event of stream) {
            if (!live) return;
            if (!event.botId || !event.runId || !event.phase) continue;
            const cursor: PresenceCursor = {
              runId: event.runId,
              botId: event.botId,
              path: event.path ?? null,
              phase: event.phase,
              target: event.target,
              at: Date.now(),
            };
            setCursors((previous) => new Map(previous).set(cursor.runId, cursor));
          }
        } catch {
          // Reconnect below; presence is decoration, never a reason to show an error.
        } finally {
          controller.abort();
        }
        if (!live) return;
        await new Promise<void>((resolve) => {
          retry = setTimeout(resolve, RETRY_MS);
        });
      }
    };
    void follow();
    return () => {
      live = false;
      controller?.abort();
      clearTimeout(retry);
      setCursors(new Map());
    };
  }, [siteId, enabled]);

  // Re-render once a second while cursors exist so they fade on time.
  const hasCursors = cursors.size > 0;
  useEffect(() => {
    if (!hasCursors) return;
    const timer = setInterval(() => {
      const at = Date.now();
      setNow(at);
      setCursors((previous) => {
        const kept = [...previous].filter(([, cursor]) => at - cursor.at < PRESENCE_FADE_MS);
        return kept.length === previous.size ? previous : new Map(kept);
      });
    }, 1_000);
    return () => clearInterval(timer);
  }, [hasCursors]);

  return { members, cursors: liveCursors(cursors, members, now) };
}

/** An editable request for the lead; nothing is sent until the owner presses Send. */
export function teamBuildRequest(names: readonly string[]): string {
  const list =
    names.length > 1 ? `${names.slice(0, -1).join(", ")} y ${names.at(-1)}` : (names[0] ?? "");
  return `Construye esta app en equipo con ${list}. Reparte una parte a cada uno, revisa lo que hagan y cuéntame el resultado.`;
}

type Rect = { x: number; y: number; width: number; height: number };

function cursorColor(color: string | null): string | undefined {
  const parsed = parseBotAvatar(color ?? "");
  return parsed.isImage || !/^#[0-9a-f]{6}$/i.test(parsed.color) ? undefined : parsed.color;
}

function fileName(path: string | null) {
  return path ? (path.split("/").pop() ?? path) : "";
}

/**
 * Named cursors over the preview: at the element a Mico is editing when the preview can
 * locate it, otherwise parked as a chip with the file name. Never takes pointer events.
 */
export function PresenceOverlay({
  frame,
  cursors,
  members,
}: {
  frame: RefObject<HTMLIFrameElement | null>;
  cursors: PresenceCursor[];
  members: readonly HostedWebTeamMember[];
}) {
  const [rects, setRects] = useState<Record<string, Rect | null>>({});
  const [box, setBox] = useState<Rect | null>(null);
  const pending = useRef(new Map<string, string>());
  const selectors = cursors
    .filter((cursor) => cursor.target?.kind === "selector")
    .map((cursor) => `${cursor.runId}\n${cursor.target!.value}`)
    .join("\u0000");

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Only the exact preview iframe this editor rendered may answer.
      const source = frame.current?.contentWindow;
      if (!source || event.source !== source) return;
      const data = event.data as { type?: unknown; id?: unknown; rect?: unknown };
      if (data?.type !== "mycellios.located" || typeof data.id !== "string") return;
      const runId = pending.current.get(data.id);
      if (!runId) return;
      pending.current.delete(data.id);
      const rect = data.rect as Rect | null;
      const valid =
        rect && [rect.x, rect.y, rect.width, rect.height].every((value) => Number.isFinite(value));
      setRects((previous) => ({ ...previous, [runId]: valid ? rect : null }));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frame]);

  useEffect(() => {
    const entries = selectors
      ? selectors.split("\u0000").map((entry) => entry.split("\n") as [string, string])
      : [];
    const locate = () => {
      const node = frame.current;
      const target = node?.contentWindow;
      if (!node || !target) return;
      setBox({
        x: node.offsetLeft,
        y: node.offsetTop,
        width: node.clientWidth,
        height: node.clientHeight,
      });
      pending.current.clear();
      for (const [runId, selector] of entries) {
        const id = crypto.randomUUID();
        pending.current.set(id, runId);
        target.postMessage({ type: "mycellios.locate", id, selector }, "*");
      }
    };
    locate();
    const timer = setInterval(locate, LOCATE_MS);
    const node = frame.current;
    node?.addEventListener("load", locate);
    return () => {
      clearInterval(timer);
      node?.removeEventListener("load", locate);
    };
  }, [frame, selectors]);

  if (!cursors.length) return null;
  const byBot = new Map(members.map((member) => [member.botId, member]));
  const placed: { cursor: PresenceCursor; rect: Rect }[] = [];
  const parked: PresenceCursor[] = [];
  for (const cursor of cursors) {
    const rect = cursor.target?.kind === "selector" ? rects[cursor.runId] : null;
    if (rect && box && rect.y + rect.height >= 0 && rect.y <= box.height) {
      placed.push({ cursor, rect });
    } else parked.push(cursor);
  }
  const label = (cursor: PresenceCursor) => {
    const member = byBot.get(cursor.botId);
    return (
      <span className="hw-cursor-label">
        <BotAvatar color={member?.color ?? ""} identity={cursor.botId} size={14} />
        <span>{member?.name ?? "Mico"}</span>
      </span>
    );
  };
  return (
    <div className="hw-presence" aria-hidden="true">
      {box &&
        placed.map(({ cursor, rect }) => {
          const color = cursorColor(byBot.get(cursor.botId)?.color ?? null);
          const x =
            box.x + Math.min(Math.max(rect.x + Math.min(rect.width, 40), 0), box.width - 12);
          const y =
            box.y + Math.min(Math.max(rect.y + Math.min(rect.height / 2, 24), 0), box.height - 12);
          return (
            <span
              key={cursor.runId}
              className="hw-cursor"
              data-phase={cursor.phase}
              style={
                {
                  transform: `translate(${x}px, ${y}px)`,
                  ...(color ? { "--hw-cursor": color } : {}),
                } as CSSProperties
              }
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <path d="M2 1.5 14 7.2 8.3 8.6 6 14.5Z" />
              </svg>
              {label(cursor)}
            </span>
          );
        })}
      {parked.length > 0 && (
        <div
          className="hw-presence-parked"
          style={box ? { left: box.x + 8, top: box.y + box.height - 8 } : undefined}
        >
          {parked.map((cursor) => {
            const color = cursorColor(byBot.get(cursor.botId)?.color ?? null);
            return (
              <span
                key={cursor.runId}
                className="hw-cursor-chip"
                style={color ? ({ "--hw-cursor": color } as CSSProperties) : undefined}
              >
                {label(cursor)}
                {cursor.path && <code>{fileName(cursor.path)}</code>}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** "Building · N Micos": counts Micos whose runs are executing, not presence signals. */
export function TeamIndicator({ members }: { members: readonly HostedWebTeamMember[] }) {
  const running = members.filter((member) => member.state === "running");
  const queued = members.length - running.length;
  if (!members.length) return null;
  return (
    <span className="hw-team-indicator" role="status">
      <span className="hw-team-avatars">
        {members.slice(0, 5).map((member) => (
          <BotAvatar
            key={member.botId}
            color={member.color ?? ""}
            identity={member.botId}
            size={18}
            status={member.state === "running" ? "running" : "queued"}
          />
        ))}
      </span>
      {running.length > 0
        ? `Construyendo · ${running.length} ${running.length === 1 ? "Mico" : "Micos"}`
        : `${queued} en cola`}
    </span>
  );
}
