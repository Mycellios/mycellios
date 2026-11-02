import { randomUUID } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { readBoundedJsonResponse } from "@rakazo/core";
import { ContributionEnrollmentSchema, ContributionStateSchema, ContributionOwnedNodesSchema, ContributionOwnerSchema } from "@rakazo/contracts";

const origin = "https://www.mycellios.com";

/** Uses the current linked account session, never a model key or a browser-supplied account ID. */
export function contributionAccount(token: string, transport: typeof fetch = fetch, signal?: AbortSignal) {
  async function request(route: string, body?: unknown) {
    try {
    const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
    const response = await transport(`${origin}/v1${route}`, {
      method: body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store", signal: bounded,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ORPCError(response.status === 401 ? "UNAUTHORIZED" : response.status === 404 ? "NOT_FOUND" : "SERVICE_UNAVAILABLE", {
        message: "Contribution could not be confirmed. Refresh before trying again.",
      });
    }
    if (response.status === 204) { await response.body?.cancel(); return null; }
    return await readBoundedJsonResponse<unknown>(response, 2 * 1024 * 1024, bounded);
    } catch (error) {
      if (error instanceof ORPCError) throw error;
      throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Contribution could not be confirmed. Refresh before trying again." });
    }
  }
  async function ownedNode(nodeId: string) {
    const nodes = ContributionOwnedNodesSchema.parse(await request("/nodes"));
    const node = nodes.data.find(item => item.nodeId === nodeId && item.status === "active");
    if (!node) throw new ORPCError("NOT_FOUND", { message: "This computer is not linked to your account. Manage its existing identity in Mycellios." });
    return node;
  }
  async function accountId() {
    return ContributionOwnerSchema.parse(await request("/account")).user_id;
  }
  return {
    async status(nodeId: string) {
      const node = await ownedNode(nodeId);
      const command = node.commands[0];
      return ContributionStateSchema.parse({
        nodeId, connected: node.connected, enabled: node.observed?.contributionEnabled ?? null,
        pending: command && ["queued", "delivered"].includes(command.state) && ["pause", "resume"].includes(command.type) ? command.type : null,
        rejected: command?.state === "rejected",
      });
    },
    async control(nodeId: string, action: "pause" | "resume") {
      const node = await ownedNode(nodeId);
      const latest = node.commands[0];
      // A timeout is uncertain: consult the durable command queue before issuing another effect.
      if (latest && ["queued", "delivered"].includes(latest.state))
        throw new ORPCError("CONFLICT", { message: "A contribution command is still pending. Wait for confirmation." });
      const owner = await accountId();
      const now = Date.now();
      await request(`/nodes/${encodeURIComponent(nodeId)}/commands`, {
        schema: "mycellios-node-command/1", id: randomUUID(), nodeId,
        actor: { kind: "account", id: owner, scopes: ["node:control"] }, generation: node.generation,
        issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 300_000).toISOString(),
        nonce: `nonce_${randomUUID().replaceAll("-", "")}`, type: action, payload: {},
      });
      return this.status(nodeId);
    },
    async enroll() {
      const owner = await accountId();
      const issued = ContributionEnrollmentSchema.omit({ schema: true, coordinatorUrl: true }).parse(await request("/nodes/enrollments", {
        schema: "mycellios-node-enrollment-create/1", accountId: owner,
        requestedBy: { kind: "account", id: owner, scopes: ["node:identity"] }, expiresInSeconds: 900,
      }));
      await request(`/nodes/enrollments/${encodeURIComponent(issued.enrollmentId)}/confirm`, {});
      return ContributionEnrollmentSchema.parse({ ...issued, schema: "mycellios-node-enrollment-bundle/1", coordinatorUrl: origin });
    },
  };
}
