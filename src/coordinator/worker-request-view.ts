import { createHmac, randomBytes } from "node:crypto";
import type { ChatCompletionRequest } from "../contracts/types.js";

/**
 * What a contributing node is allowed to see of a request
 * (specs/node-owner-privacy, D1).
 *
 * The node needs the content and the generation controls. It does not need
 * the client's session id, which is stable for a whole conversation and stored
 * against the account, nor the routing policy or participant names. The
 * session id becomes a pseudonym keyed by the worker: one node still sees the
 * same value across turns (its runtime keys cached state by it), but cannot
 * link it to the stored id or to the value another node sees.
 */
export class WorkerRequestView {
  private readonly key: Buffer;

  constructor(key: Buffer = randomBytes(32)) {
    if (key.length < 32) throw new RangeError("WorkerRequestView needs a key of at least 32 bytes");
    this.key = Buffer.from(key);
  }

  sessionPseudonym(workerId: string, sessionId: string): string {
    const digest = createHmac("sha256", this.key)
      .update(workerId)
      .update("\n")
      .update(sessionId)
      .digest("base64url");
    return `s_${digest.slice(0, 22)}`;
  }

  build(request: ChatCompletionRequest, workerId: string): ChatCompletionRequest {
    const {
      session_id: sessionId,
      privacy: _privacy,
      preferred_region: _region,
      ...rest
    } = request;
    return {
      ...rest,
      messages: request.messages.map(({ role, content }) => ({ role, content })),
      ...(sessionId === undefined ? {} : { session_id: this.sessionPseudonym(workerId, sessionId) }),
    };
  }
}
