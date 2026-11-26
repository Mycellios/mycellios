import { describe, expect, it } from "vitest";
import { buildApprovalAskBlock } from "./approval-ask.js";
import { parsePrivateApprovalTarget, requiresPrivateApproval } from "./private-required-approval.js";

const actor = { userId: "owner", spaceId: "personal", botId: "sender" };
const route = { connectorId: "mcp", resourceId: "managed-mcp", toolName: "mail_confirm_send" };
const target = { ...actor, resourceId: route.resourceId, toolName: route.toolName };

describe("private required MCP approval", () => {
  it("matches only the configured owner, space, bot, connector and action", () => {
    const parsed = parsePrivateApprovalTarget(JSON.stringify(target));
    expect(requiresPrivateApproval(parsed, actor, route)).toBe(true);
    for (const key of Object.keys(actor)) {
      expect(requiresPrivateApproval(parsed, { ...actor, [key]: "other" }, route)).toBe(false);
    }
    for (const key of Object.keys(route)) {
      expect(requiresPrivateApproval(parsed, actor, { ...route, [key]: "other" })).toBe(false);
    }
    expect(requiresPrivateApproval(parsed, actor, undefined)).toBe(false);
    expect(requiresPrivateApproval(parsed, actor, { ...route, toolName: "mail_save_draft" })).toBe(false);
  });

  it("does not apply an unset, invalid or wildcard configuration", () => {
    for (const value of [undefined, "{", "null", JSON.stringify({ ...target, userId: "*" })]) {
      expect(parsePrivateApprovalTarget(value)).toBeUndefined();
      expect(requiresPrivateApproval(parsePrivateApprovalTarget(value), actor, route)).toBe(false);
    }
  });

  it("shows the exact effect and email in a card with only one-time approval", () => {
    const args = { to: "recipient@example.test", subject: "Subject", body: "Exact body" };
    const card = buildApprovalAskBlock("effect-1", target.toolName, args, [], { requireOnce: true });
    expect(card).toMatchObject({
      kind: "ask",
      approvalEffectId: "effect-1",
      detail: "to: recipient@example.test\nsubject: Subject\nbody: Exact body",
      actions: [{ id: "allow", label: "Allow once" }, { id: "deny", label: "Deny" }],
    });
  });
});
