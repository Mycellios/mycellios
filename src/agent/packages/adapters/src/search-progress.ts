import { StringDecoder } from "node:string_decoder";

/** Only new result locations extend a search; banners, stderr and repeated hits do not. */
export class SearchProgressClock {
  private readonly decoder = new StringDecoder("utf8");
  private pending = "";
  private readonly seen = new Set<string>();
  deadline: number;
  readonly hardDeadline: number;
  constructor(readonly initialMs: number, maxMs: number, private readonly roots: readonly string[], startedAt = Date.now()) {
    this.deadline = startedAt + initialMs;
    this.hardDeadline = startedAt + Math.max(initialMs, Math.min(maxMs, 180_000));
  }
  output(chunk: Uint8Array, now = Date.now()): boolean {
    if (now >= this.deadline) return false;
    this.pending += this.decoder.write(Buffer.from(chunk));
    const lines = this.pending.split("\n"); this.pending = lines.pop()!.slice(-4096);
    let progress = false;
    for (const raw of lines) {
      const line = raw.replace(/\x1b\[[0-9;]*m/g, "").trim();
      const match = /^((?:[a-zA-Z]:)?[^:\r\n]+?)(?::(\d+)(?::|$)|:|$)/.exec(line);
      const file = match?.[1]?.replace(/\\/g, "/").replace(/^\.\//, "");
      if (!file || file.length > 4096 || !/(?:\/|\.[\w-]+$)/.test(file) || !this.roots.some(root => root === "." || file === root || file.startsWith(root + "/"))) continue;
      const key = `${file}:${match?.[2] ?? ""}`;
      if (this.seen.has(key)) continue;
      if (this.seen.size >= 2048) this.seen.delete(this.seen.values().next().value!);
      this.seen.add(key); progress = true;
    }
    if (progress) this.deadline = Math.min(this.hardDeadline, now + this.initialMs);
    return progress;
  }
}
