import type {
  AdapterContext,
  CommandRequest,
  ComputerRef,
  ProcessEvent,
  SandboxProvider,
} from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { FakeMediaGenerationProvider } from "./media-generation-provider.js";
import {
  NativeComputerImageProvider,
  selectRunMediaGeneration,
} from "./native-image-generation.js";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII=";
const context: AdapterContext = {
  operationId: "image",
  traceId: "image",
  userId: "owner",
  spaceId: "space",
  botId: "bot",
  runId: "run",
  signal: new AbortController().signal,
};
const computer = {
  id: "pc",
  botId: "bot",
  kind: "desktop",
  providerRef: "host:owned",
} as ComputerRef;
function fixture(result: Record<string, unknown> = { mimeType: "image/png", data: png }, exit = 0) {
  const execute = vi.fn(async function* (
    _pc: ComputerRef,
    request: CommandRequest,
    received: AdapterContext,
  ): AsyncIterable<ProcessEvent> {
    expect(received.userId).toBe(context.userId);
    expect(received.spaceId).toBe(context.spaceId);
    const input = JSON.parse(Buffer.from(request.argv.at(-1)!, "base64").toString());
    const line = JSON.stringify({ nonce: input.nonce, ...result });
    yield { type: "stderr", data: "private native diagnostic" };
    yield { type: "stdout", data: line.slice(0, 20) };
    yield { type: "stdout", data: line.slice(20) };
    yield { type: "exit", code: exit };
  });
  const sandbox = {
    execute,
    environment: vi
      .fn()
      .mockResolvedValue({
        platform: "win32",
        home: "C:/fixture",
        shell: "powershell.exe",
        runtimeExecutable: "C:/fixture/Desktop.exe",
      }),
  } as unknown as SandboxProvider;
  const getComputer = vi.fn().mockResolvedValue(computer);
  return {
    execute,
    sandbox,
    getComputer,
    provider: new NativeComputerImageProvider({ sandbox, computer: getComputer }),
  };
}
describe("native computer image generation", () => {
  it("uses only the admitted owner's computer, supports streamed output and returns real image bytes", async () => {
    const f = fixture();
    const output = await f.provider.generateImage({ prompt: "Draw a mushroom" }, context);
    expect(output.mimeType).toBe("image/png");
    expect(Buffer.from(output.bytes).toString("base64")).toBe(png);
    const command = f.execute.mock.calls[0]![1];
    expect(command.argv[0]).toBe("C:/fixture/Desktop.exe");
    expect(command.argv).toContain("--input-type=commonjs");
    expect(command.unsetEnv).toContain("OPENAI_API_KEY");
    expect(JSON.parse(Buffer.from(command.argv.at(-1)!, "base64").toString()).prompt).toBe(
      "Draw a mushroom",
    );
    expect(f.getComputer).toHaveBeenCalledTimes(1);
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it("can use an older Desktop host without a runtime executable descriptor", async () => {
    const f = fixture();
    vi.mocked(f.sandbox.environment!).mockResolvedValue(undefined);
    await f.provider.generateImage({ prompt: "draw" }, context);
    expect(f.execute.mock.calls[0]![1].argv[0]).toBe("node");
  });
  it.each([
    [{ error: "authentication" }, 1, "ChatGPT"],
    [{ error: "not_installed" }, 1, "Install Codex"],
    [{ nonce: "another-call", mimeType: "image/png", data: png }, 0, "did not complete"],
    [
      { mimeType: "image/png", data: Buffer.from("not an image").toString("base64") },
      0,
      "did not complete",
    ],
    [{ mimeType: "image/png", data: png }, 1, "did not complete"],
  ] as const)(
    "does not publish or retry failed, mismatched or invalid output",
    async (result, code, message) => {
      const f = fixture(result, code);
      await expect(f.provider.generateImage({ prompt: "draw" }, context)).rejects.toThrow(message);
      expect(f.execute).toHaveBeenCalledTimes(1);
    },
  );
  it("respects cancellation before touching the computer", async () => {
    const f = fixture(),
      controller = new AbortController();
    controller.abort();
    await expect(
      f.provider.generateImage({ prompt: "draw" }, { ...context, signal: controller.signal }),
    ).rejects.toThrow();
    expect(f.getComputer).not.toHaveBeenCalled();
  });
  it("requires an admitted native computer and keeps configured payers and explicit opt-outs", () => {
    const f = fixture(),
      options = {
        computerAvailable: true,
        computerKind: "desktop",
        sandbox: f.sandbox,
        computer: f.getComputer,
      };
    expect(selectRunMediaGeneration(options, {})?.id).toBe("native-codex");
    expect(selectRunMediaGeneration(options, { MEDIA_GENERATION_PROVIDER: "auto" })?.id).toBe(
      "native-codex",
    );
    expect(
      selectRunMediaGeneration(options, { MEDIA_GENERATION_PROVIDER: "disabled" }),
    ).toBeUndefined();
    expect(selectRunMediaGeneration({ ...options, computerAvailable: false }, {})).toBeUndefined();
    expect(selectRunMediaGeneration({ ...options, computerKind: "docker" }, {})).toBeUndefined();
    const configured = new FakeMediaGenerationProvider();
    expect(selectRunMediaGeneration({ ...options, configured }, {})).toBe(configured);
    expect(f.getComputer).not.toHaveBeenCalled();
  });
  it("never advertises video generation through the image-only native route", async () => {
    const f = fixture();
    expect(f.provider.capabilities.video).toBe(false);
    await expect(f.provider.generateVideo()).rejects.toThrow("unsupported");
    await expect(f.provider.pollVideo()).rejects.toThrow("unsupported");
  });
});
