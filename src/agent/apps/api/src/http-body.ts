/** Reads the exact body bytes (for a signature over them) without buffering more than maxBytes. */
export async function readBoundedBytes(request: Request, maxBytes: number): Promise<Buffer | null> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > maxBytes) {
      cancelBody(request.body);
      return null;
    }
  }
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        cancelBody(reader);
        return null;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, bytes);
  } finally {
    reader.releaseLock();
  }
}

/** Reads a request body without buffering more than maxBytes. */
export async function readBoundedBody(request: Request, maxBytes: number): Promise<string | null> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > maxBytes) {
      cancelBody(request.body);
      return null;
    }
  }

  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        cancelBody(reader);
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

/** Best-effort body/reader cancel; must not delay a rejection response. */
export function cancelBody(body: { cancel(): Promise<void> } | null): void {
  try {
    void body?.cancel().catch(() => undefined);
  } catch {
    // Ignore cancel failures.
  }
}
