// @vitest-environment jsdom
import type { HostedWebTeamMember } from "@mycellios/contracts";
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@mycellios/ui-web", () => ({
  BotAvatar: () => <i data-avatar="" />,
  parseBotAvatar: (color: string) => ({ color: color.split("::")[0], isImage: false }),
}));

import type { PresenceCursor } from "./TeamPresence";
import {
  liveCursors,
  PRESENCE_FADE_MS,
  PresenceOverlay,
  TeamIndicator,
  teamBuildRequest,
} from "./TeamPresence";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement | undefined;
afterEach(() => {
  host?.remove();
  host = undefined;
});

const members: HostedWebTeamMember[] = [
  { botId: "a", name: "Nova", color: "#AA3355::shape_1", state: "running" },
  { botId: "b", name: "Echo", color: null, state: "queued" },
];
const cursor = (
  botId: string,
  at: number,
  extra: Partial<PresenceCursor> = {},
): PresenceCursor => ({
  runId: `run-${botId}`,
  botId,
  path: "index.html",
  phase: "writing",
  at,
  ...extra,
});

describe("liveCursors", () => {
  it("keeps only recent cursors of running Micos", () => {
    const cursors = new Map([
      ["run-a", cursor("a", 1_000)],
      ["run-b", cursor("b", 1_000)],
    ]);
    expect(liveCursors(cursors, members, 2_000).map((c) => c.botId)).toEqual(["a"]);
    expect(liveCursors(cursors, members, 1_000 + PRESENCE_FADE_MS)).toEqual([]);
  });
});

describe("TeamIndicator", () => {
  it("counts executing Micos from run states", async () => {
    host = document.body.appendChild(document.createElement("div"));
    await act(async () => createRoot(host!).render(<TeamIndicator members={members} />));
    expect(host.textContent).toBe("Construyendo · 1 Mico");
    host.remove();
    host = document.body.appendChild(document.createElement("div"));
    await act(async () => createRoot(host!).render(<TeamIndicator members={[members[1]!]} />));
    expect(host.textContent).toBe("1 en cola");
  });
});

describe("teamBuildRequest", () => {
  it("names every chosen teammate", () => {
    expect(teamBuildRequest(["Nova"])).toContain("con Nova.");
    expect(teamBuildRequest(["Nova", "Echo", "Forge"])).toContain("con Nova, Echo y Forge.");
  });
});

describe("PresenceOverlay", () => {
  it("places cursors only from the rendered preview frame's replies", async () => {
    host = document.body.appendChild(document.createElement("div"));
    const frame = document.createElement("iframe");
    host.appendChild(frame);
    // jsdom has no layout; give the preview a size so a located element is on screen.
    Object.defineProperty(frame, "clientWidth", { value: 800 });
    Object.defineProperty(frame, "clientHeight", { value: 600 });
    const ref = createRef<HTMLIFrameElement>();
    (ref as { current: HTMLIFrameElement | null }).current = frame;
    const posted: { id: string; selector: string }[] = [];
    vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation((message: unknown) => {
      posted.push(message as { id: string; selector: string });
    });
    const target = document.body.appendChild(document.createElement("div"));
    const cursors = [cursor("a", Date.now(), { target: { kind: "selector", value: "#hero" } })];
    await act(async () =>
      createRoot(target).render(
        <PresenceOverlay frame={ref} cursors={cursors} members={members} />,
      ),
    );
    expect(posted[0]).toMatchObject({ type: "mycellios.locate", selector: "#hero" });
    // A reply from another window is ignored: the cursor stays parked by its file.
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          data: {
            type: "mycellios.located",
            id: posted[0]!.id,
            rect: { x: 1, y: 1, width: 1, height: 1 },
          },
        }),
      );
    });
    expect(target.querySelector(".hw-cursor")).toBeNull();
    expect(target.querySelector(".hw-cursor-chip")?.textContent).toContain("Nova");
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: {
            type: "mycellios.located",
            id: posted.at(-1)!.id,
            rect: { x: 10, y: 20, width: 100, height: 40 },
          },
        }),
      );
    });
    expect(target.querySelector(".hw-cursor")?.textContent).toContain("Nova");
    target.remove();
  });
});
