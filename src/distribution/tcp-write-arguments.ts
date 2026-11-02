export interface TcpWriteOptions { tcpWriteChunkBytes?: number }

export function normalizeTcpWritePolicy(options: { tcpWriteChunkBytes?: number | undefined }): TcpWriteOptions {
  const value = options.tcpWriteChunkBytes;
  if (value === undefined) return {};
  if (!Number.isSafeInteger(value) || value < 64 || value > 1_048_576) {
    throw new Error("python_tcp_write_chunk_bytes_is_invalid");
  }
  return { tcpWriteChunkBytes: value };
}

export function tcpWriteArguments(options: TcpWriteOptions): string[] {
  const value = normalizeTcpWritePolicy(options).tcpWriteChunkBytes;
  return value === undefined ? [] : ["--tcp-write-chunk-bytes", String(value)];
}
