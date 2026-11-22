import { z } from "zod";
import { MEMORY_EMBEDDING_DIGEST, MEMORY_EMBEDDING_MODEL } from "./memory-embedding.js";

/**
 * Coordinator → paired native node: which pinned native replicas the node
 * should run now. Only the node's own device session may read it, and the
 * answer depends only on demand from that node's owner account
 * (specs/memory-embedding-qwen06/spec.md, "Automatic node replicas").
 * Nodes that predate this route never call it.
 */
export const NODE_REPLICAS_SCHEMA = "mycellios-node-replicas/1" as const;
export const NODE_REPLICAS_PATH_SUFFIX = "replicas" as const;

export const nodeReplicaDesiredSchema = z.object({
  model: z.literal(MEMORY_EMBEDDING_MODEL),
  modelDigest: z.literal(MEMORY_EMBEDDING_DIGEST),
  desired: z.boolean(),
}).strict();

export const nodeReplicasResponseSchema = z.object({
  schema: z.literal(NODE_REPLICAS_SCHEMA),
  nodeId: z.string().min(1).max(256),
  replicas: z.array(nodeReplicaDesiredSchema).max(4),
}).strict();

export type NodeReplicasResponse = z.infer<typeof nodeReplicasResponseSchema>;
