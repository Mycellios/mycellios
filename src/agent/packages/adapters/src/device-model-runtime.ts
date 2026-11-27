import type { AdapterContext, AgentRunRequest, AgentRuntime, AgentRuntimeEvent } from "@mycellios/adapter-kit";
import {
  DEVICE_MODEL_MAX_TOKENS, isDeviceModelProvider, OPENAI_COMPATIBLE_PROVIDER_ID,
} from "@mycellios/contracts";

/** Desktop's loopback server for one local model (apps/desktop/src/local-models.ts). */
export type DeviceModelEndpoint = { baseUrl: string; apiKey: string; contextWindow: number };
export type DeviceModelResolver = (modelId: string) => Promise<DeviceModelEndpoint>;

/**
 * Runs Pi turns whose model is served on this PC (specs/local-models/spec.md). The
 * server sends only the model id; this resolves it to Desktop's own loopback server
 * and runs the turn in light mode, so nothing leaves the PC and nothing is billed.
 * Every other turn goes to the ordinary runtime unchanged.
 */
export class DeviceModelRuntime implements AgentRuntime {
  constructor(
    private readonly runtime: AgentRuntime,
    /** Pi sized for small local models: fewer tool schemas sent eagerly. */
    private readonly lightRuntime: AgentRuntime,
    private readonly resolve: DeviceModelResolver | undefined,
  ) {}
  describe() { return this.runtime.describe(); }
  async abort(runId: string) {
    await Promise.all([this.runtime.abort(runId), this.lightRuntime.abort(runId)]);
  }
  async *run(request: AgentRunRequest, context?: Partial<AdapterContext>): AsyncIterable<AgentRuntimeEvent> {
    if (!isDeviceModelProvider(request.model.provider)) {
      yield* this.runtime.run(request, context);
      return;
    }
    if (!this.resolve) throw new Error("This version of Mycellios Desktop cannot run models on this PC. Update it to continue.");
    const endpoint = await this.resolve(request.model.id);
    yield* this.lightRuntime.run({
      ...request,
      model: {
        provider: OPENAI_COMPATIBLE_PROVIDER_ID,
        id: request.model.id,
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey,
        // The endpoint is this PC's own loopback server, started by Desktop.
        allowPrivateEndpoint: true,
        contextWindow: endpoint.contextWindow,
        maxTokens: Math.min(request.model.maxTokens ?? DEVICE_MODEL_MAX_TOKENS, DEVICE_MODEL_MAX_TOKENS),
        thinkingLevel: null,
      },
      // A fallback would leave the PC; a local model has none.
      fallbackModels: undefined,
      resolveFallbackModel: undefined,
    }, context);
  }
}
