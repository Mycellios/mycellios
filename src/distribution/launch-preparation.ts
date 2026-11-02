import type { LaunchAgent } from "./launch-supervisor.js";
import type { PythonPipelineLaunchDescription } from "./python-launcher.js";

/** Prepare only assigned nodes before any stage can allocate model parameters. */
export async function prepareLaunchAgents(
  description: PythonPipelineLaunchDescription,
  agents: ReadonlyMap<string, LaunchAgent>,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw abortError(signal);
  const snapshot = structuredClone(description);
  const nodes = [...new Set(snapshot.launchOrder.map(process => process.anchor.memberId))];
  // Resolve all assignments first: a missing required agent must not start partial work.
  const required = nodes.map(nodeId => {
    const agent = agents.get(nodeId);
    if (!agent) throw new Error(`launch_agent_not_found:${nodeId}`);
    return { nodeId, agent };
  });
  const results = await Promise.allSettled(required.map(async ({ nodeId, agent }) => {
    if (!agent.prepareRuntime) return;
    if (signal?.aborted) throw abortError(signal);
    const expected = snapshot.launchOrder.filter(process => process.anchor.memberId === nodeId);
    const prepared = await agent.prepareRuntime(structuredClone(snapshot), nodeId, undefined, signal);
    if (signal?.aborted) throw abortError(signal);
    const byId = new Map(prepared.map(process => [process.processId, process]));
    if (byId.size !== expected.length || prepared.length !== expected.length
        || expected.some(process => {
          const actual = byId.get(process.processId);
          // Worker-local command materialization is supported; ownership, roles,
          // memory and range remain the exact coordinator authorization contract.
          return !actual || JSON.stringify({ ...actual, command: process.command }) !== JSON.stringify(process);
        })) throw new Error(`launch_preparation_contract_mismatch:${nodeId}`);
  }));
  if (signal?.aborted) throw abortError(signal);
  const failed = results.find(result => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("distributed_launch_cancelled");
}
