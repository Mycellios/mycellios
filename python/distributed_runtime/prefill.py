"""Bounded prompt ingestion shared with the engine's cancellation contract."""


class GenerationCancelledError(RuntimeError):
    pass


def consume_prefill(runner, config, request, cancelled):
    """Populate KV with leading chunks, leaving one nonempty tail to project."""
    current = request.input_ids
    chunk_tokens = config.prefill_chunk_tokens
    if chunk_tokens <= 0 or current.shape[1] <= chunk_tokens:
        return current
    forward = getattr(runner, "forward_ids", None)
    if not callable(forward):
        raise RuntimeError("single-stage runner cannot prefill token chunks")
    offset = 0
    while current.shape[1] - offset > chunk_tokens:
        if cancelled.is_set():
            raise GenerationCancelledError(f"generation {request.client_id} was cancelled")
        forward(request.client_id, current[:, offset : offset + chunk_tokens])
        offset += chunk_tokens
    return current[:, offset:]
