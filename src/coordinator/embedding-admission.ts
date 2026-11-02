import { MeshServiceError } from "./mesh-service.js";

/** Reuse the deployed embedding contract before accounting or job admission. */
export function assertEmbeddingAdmission<T extends { model: string }>(
  request: T,
  contract: { EMBEDDING_MODEL: string; parseEmbeddingRequest(request: T): unknown },
): void {
  if (request.model !== contract.EMBEDDING_MODEL) return;
  try {
    contract.parseEmbeddingRequest(request);
  } catch {
    // Parser errors may contain submitted text; return a stable, bounded message.
    throw new MeshServiceError(
      "invalid_embedding_request",
      "Expected one user message containing a valid mycellios-embeddings/1 JSON envelope.",
      400,
    );
  }
}
