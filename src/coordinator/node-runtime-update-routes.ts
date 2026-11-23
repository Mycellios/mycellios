import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { nodeAutoUpdatePreferenceInputSchema, nodeSnapshotSchema } from "../contracts/node-control.js";
import type { MeshDatabase } from "../storage/database.js";
import type { ComponentReleaseStore } from "./component-release-store.js";
import { NodeAutoUpdateScheduler, NodeAutoUpdateStore } from "./node-auto-update.js";
import type { NodeCommandStore } from "./node-command-store.js";
import type { NodeReconciliationStore } from "./node-reconciliation-store.js";

export interface NodeRuntimeUpdateRouteOptions {
  database: MeshDatabase;
  commands: NodeCommandStore;
  reconciliation: NodeReconciliationStore;
  /** Signed component feed; null keeps automatic updates unavailable. */
  releases: ComponentReleaseStore | null;
  /** Node id bound to an authenticated worker session, if any. */
  workerSessionNode(request: FastifyRequest): string | undefined;
  /** Account id of a signed-in user session, if any. */
  accountId(request: FastifyRequest): string | null;
  workerInMaintenance(nodeId: string): Promise<boolean>;
}

/**
 * Node snapshot reconciliation and owner consent for verified runtime updates
 * (specs/node-runtime-auto-update). Each accepted snapshot may queue one exact
 * signed update for the node's own opted-in owner.
 */
export async function registerNodeRuntimeUpdateRoutes(
  app: FastifyInstance,
  options: NodeRuntimeUpdateRouteOptions,
): Promise<NodeAutoUpdateScheduler | null> {
  const preferences = new NodeAutoUpdateStore(options.database);
  if (!(await preferences.initialize())) {
    // Content-free: the PostgreSQL migration owner has not applied nodeAutoUpdateSchemaSql yet.
    app.log.warn({ code: "node_auto_update_schema_missing" }, "automatic node updates are unavailable");
  }
  const releases = options.releases;
  const scheduler = releases && preferences.available
    ? new NodeAutoUpdateScheduler({
        database: options.database,
        commands: options.commands,
        preferences,
        targetManifestId: async ({ channel, platform, arch }) =>
          (await releases.readPublishedManifest(
            { channel, platform: platform as "win32" | "linux" | "darwin", arch: arch as "x64" | "arm64" },
            { verifyArtifacts: false },
          ).catch(() => null))?.manifestId ?? null,
        maintenance: options.workerInMaintenance,
      })
    : null;

  app.get("/v1/nodes/auto-update", async (request, reply) => {
    const accountId = options.accountId(request);
    if (!accountId) return reply.code(403).send({ error: { code: "account_session_required" } });
    return preferences.get(accountId, scheduler !== null);
  });

  app.put("/v1/nodes/auto-update", async (request, reply) => {
    const accountId = options.accountId(request);
    if (!accountId) return reply.code(403).send({ error: { code: "account_session_required" } });
    const body = nodeAutoUpdatePreferenceInputSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: { code: "node_auto_update_invalid" } });
    if (!preferences.available) return reply.code(503).send({ error: { code: "node_auto_update_unavailable" } });
    // Consent covers only nodes this account owns; the scheduler rechecks ownership per node.
    return preferences.set(accountId, body.data.enabled, scheduler !== null);
  });

  app.post("/internal/v1/nodes/:identityId/snapshot", async (request, reply) => {
    const { identityId } = z.object({ identityId: z.string().min(1).max(256) }).strict().parse(request.params);
    if (options.workerSessionNode(request) !== identityId) return reply.code(401).send({ error: { code: "worker_session_required" } });
    const snapshot = nodeSnapshotSchema.parse(request.body);
    if (snapshot.nodeId !== identityId) return reply.code(403).send({ error: { code: "node_snapshot_wrong_node" } });
    const ownership = (await options.database.getNodeOwnership("device", identityId));
    if (!ownership || ownership.status !== "active" || ownership.generation !== snapshot.generation) {
      return reply.code(409).send({ error: { code: "node_generation_mismatch" } });
    }
    try {
      const reconciled = await options.reconciliation.reconcile(snapshot);
      if (scheduler) {
        void scheduler.consider(snapshot).catch((error: unknown) => {
          // Content-free code only: no snapshot, command or request data in logs.
          const code = error instanceof Error ? error.message.match(/^[A-Za-z0-9_.:-]{1,120}/)?.[0] : undefined;
          request.log.warn({ code: code ?? "node_auto_update_failed" }, "node auto-update evaluation failed");
        });
      }
      return reply.code(200).send({
        ...reconciled,
        acknowledgedCommandIds: (await options.commands.acknowledgedCommandIds(identityId, snapshot.generation)),
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "node_snapshot_invalid";
      const conflict = code.includes("regression") || code.includes("mismatch") || code.includes("downgrade");
      return reply.code(conflict ? 409 : 400).send({ error: { code } });
    }
  });

  return scheduler;
}
