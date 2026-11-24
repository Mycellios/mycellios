import { createHash } from "node:crypto";
import type { AdapterContext, ComputerRef } from "@mycellios/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import {
  HOST_COMPUTER_MAX_FILE_BYTES,
  HOST_COMPUTER_MAX_WORKSPACE_FILE_BYTES,
} from "./host-computer-protocol.js";
import { HostComputerSandbox } from "./host-computer-sandbox.js";
import { exportWorkspaceFrames } from "./host-computer-server.js";

const computer = { botId: "bot-1" } as ComputerRef;
const context = () =>
  ({
    userId: "user-1",
    spaceId: "space-1",
    botId: "bot-1",
    signal: new AbortController().signal,
  }) as AdapterContext;

/** A relay response that sends `frames`, then closes only after `closeAfterMs`, as the relay waits for the PC's final chunk. */
function relayResponse(frames: unknown[], closeAfterMs: number) {
  const seen = { cancelled: false, closed: false };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames)
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify(frame)}\n`));
      setTimeout(() => {
        if (seen.cancelled) return;
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ done: true })}\n`));
        controller.close();
        seen.closed = true;
      }, closeAfterMs);
    },
    cancel() {
      seen.cancelled = true;
    },
  });
  return {
    seen,
    response: new Response(body, { headers: { "content-type": "application/x-ndjson" } }),
  };
}

describe("HostComputerSandbox command streams", () => {
  it("reads a command's stream to its end when the caller stops at the exit", async () => {
    const relay = relayResponse(
      [{ value: { type: "stdout", data: "hello\n" } }, { value: { type: "exit", code: 0 } }],
      50,
    );
    const sandbox = new HostComputerSandbox("", "", async () => relay.response);
    const events: unknown[] = [];
    for await (const event of sandbox.execute(computer, { argv: ["echo", "hello"] }, context())) {
      events.push(event);
      if (event.type === "exit") break;
    }
    expect(events).toEqual([
      { type: "stdout", data: "hello\n" },
      { type: "exit", code: 0 },
    ]);
    expect(relay.seen).toEqual({ cancelled: false, closed: true });
  });

  it("still cancels a command the caller abandons before its exit", async () => {
    const relay = relayResponse([{ value: { type: "stdout", data: "hello\n" } }], 50);
    const sandbox = new HostComputerSandbox("", "", async () => relay.response);
    for await (const event of sandbox.execute(computer, { argv: ["sleep", "60"] }, context())) {
      expect(event).toEqual({ type: "stdout", data: "hello\n" });
      break;
    }
    expect(relay.seen.cancelled).toBe(true);
  });
});

describe("HostComputerSandbox workspace export", () => {
  const piece = (content: Buffer, offset: number, size: number, sha256: string) => ({
    value: { path: "video.mp4", offset, size, sha256, content: content.toString("base64") },
  });
  const collect = async (sandbox: HostComputerSandbox) => {
    const files = [];
    for await (const file of sandbox.exportWorkspace(computer, context())) files.push(file);
    return files;
  };

  it("asks for pieces, reassembles them and leaves out files beyond the limit", async () => {
    const whole = Buffer.from("0123456789");
    const sha256 = createHash("sha256").update(whole).digest("hex");
    const relay = relayResponse(
      [
        { value: { path: "notes.md", content: Buffer.from("notes").toString("base64"), executable: false } },
        piece(whole.subarray(0, 6), 0, 10, sha256),
        piece(whole.subarray(6), 6, 10, sha256),
        { value: { skipped: { size: 200 * 1024 * 1024 } } },
      ],
      0,
    );
    let request: unknown;
    const sandbox = new HostComputerSandbox("", "", async (input) => {
      request = input;
      return relay.response;
    });
    const files = await collect(sandbox);
    expect(request).toMatchObject({ method: "exportWorkspace", pieces: true });
    expect(files.map((file) => [file.path, Buffer.from(file.content).toString()])).toEqual([
      ["notes.md", "notes"],
      ["video.mp4", "0123456789"],
    ]);
  });

  it.each([
    ["a wrong checksum", [piece(Buffer.from("0123456789"), 0, 10, "0".repeat(64))], "checksum"],
    ["a missing piece", [piece(Buffer.from("01234"), 0, 10, "a".repeat(64))], "inside a large file"],
    [
      "a piece out of order",
      [
        piece(Buffer.from("01234"), 0, 10, "a".repeat(64)),
        piece(Buffer.from("01234"), 8, 10, "a".repeat(64)),
      ],
      "out of order",
    ],
  ])("refuses %s instead of saving a damaged file", async (_name, frames, message) => {
    const relay = relayResponse(frames, 0);
    const sandbox = new HostComputerSandbox("", "", async () => relay.response);
    await expect(collect(sandbox)).rejects.toThrow(message);
  });
});

describe("exportWorkspaceFrames", () => {
  it("splits a large file into checksummed pieces and never reads one beyond the limit", async () => {
    const large = new Uint8Array(HOST_COMPUTER_MAX_FILE_BYTES + 3).map((_, index) => index % 7);
    const tooLarge = vi.fn();
    async function* files() {
      yield { path: "small.txt", size: 2, executable: false, read: async () => new Uint8Array([1, 2]) };
      yield { path: "large.bin", size: large.byteLength, executable: true, read: async () => large };
      yield {
        path: "huge.bin",
        size: HOST_COMPUTER_MAX_WORKSPACE_FILE_BYTES + 1,
        executable: false,
        read: tooLarge,
      };
    }
    const frames = [];
    for await (const frame of exportWorkspaceFrames(files())) frames.push(frame);
    const sha256 = createHash("sha256").update(large).digest("hex");
    expect(frames).toEqual([
      { path: "small.txt", content: Buffer.from([1, 2]).toString("base64") },
      expect.objectContaining({ path: "large.bin", offset: 0, size: large.byteLength, sha256, executable: true }),
      expect.objectContaining({
        path: "large.bin",
        offset: HOST_COMPUTER_MAX_FILE_BYTES,
        size: large.byteLength,
        sha256,
      }),
      { skipped: { size: HOST_COMPUTER_MAX_WORKSPACE_FILE_BYTES + 1 } },
    ]);
    expect(tooLarge).not.toHaveBeenCalled();
  });
});
