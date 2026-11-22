import type { ThreadMessage } from "@mycellios/contracts";
import type { ThreadItem } from "@mycellios/core";
import { expect, it } from "vitest";
import { peerExchanges } from "./peer-exchange-groups";

const at = new Date(0).toISOString();
const sent = (id: string, to: string): ThreadItem<ThreadMessage> => ({
  kind: "message",
  message: { id, threadId: "t", seq: 1, role: "bot", createdAt: at, blocks: [{ kind: "bot_message_sent", toBotId: to, toBotName: to, text: "x" }] },
});
const received = (id: string, from: string): ThreadItem<ThreadMessage> => ({
  kind: "message",
  message: { id, threadId: "t", seq: 1, role: "bot", createdAt: at, blocks: [{ kind: "bot_message_received", fromBotId: from, fromBotName: from, text: "x" }] },
});
const reply = (id: string): ThreadItem<ThreadMessage> => ({
  kind: "message",
  message: { id, threadId: "t", seq: 1, role: "bot", createdAt: at, blocks: [{ kind: "text", text: "Done." }] },
});

it("folds runs of two or more consecutive Mico messages and names the other Micos", () => {
  const groups = peerExchanges([sent("a", "DevOps"), sent("b", "Developer"), received("c", "DevOps"), reply("d"), sent("e", "DevOps")]);
  const exchange = groups.get("a");
  expect(exchange).toEqual({ key: "a", memberIds: ["a", "b", "c"], peers: ["DevOps", "Developer"] });
  expect(groups.get("c")).toBe(exchange);
  expect(groups.has("d")).toBe(false);
  expect(groups.has("e")).toBe(false);
});

it("leaves a single Mico message as it is", () => {
  expect(peerExchanges([reply("a"), sent("b", "DevOps"), reply("c")]).size).toBe(0);
});
