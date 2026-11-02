import { randomBytes } from "node:crypto";
import type {
  AdapterContext,
  ComputerRef,
  GeneratedMedia,
  MediaGenerationProvider,
  SandboxProvider,
} from "@rakazo/adapter-kit";
import { MediaGenerationError } from "@rakazo/adapter-kit";
import { CODEX_IMAGE_WORKER } from "./codex-image-worker.js";
import { mediaPromptSchema } from "./media-generation-provider.js";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function nativeFailure(code: unknown): MediaGenerationError {
  const error = new MediaGenerationError(
    code === "authentication"
      ? "authentication"
      : code === "output_limit"
        ? "output_limit"
        : "provider_failure",
  );
  error.message =
    code === "authentication"
      ? "Image generation needs Codex signed in with your ChatGPT account on the connected computer."
      : code === "not_installed"
        ? "Install Codex on your connected computer and sign in with ChatGPT to generate images."
        : code === "output_limit"
          ? "The generated image exceeded the local transfer limit. Do not repeat this submission automatically."
          : "Image generation on the connected computer did not complete. Check Codex access or limits before making a new request; do not resubmit automatically.";
  return error;
}

/** The run's existing computer grant owns execution; no account credential leaves that host. */
export class NativeComputerImageProvider implements MediaGenerationProvider {
  readonly id = "native-codex";
  readonly capabilities = { images: true, video: false, offline: false };
  constructor(
    private readonly options: { sandbox: SandboxProvider; computer: () => Promise<ComputerRef> },
  ) {}

  async generateImage(input: { prompt: string }, context: AdapterContext): Promise<GeneratedMedia> {
    const parsed = mediaPromptSchema.safeParse(input);
    if (!parsed.success) throw new MediaGenerationError("invalid_input");
    context.signal.throwIfAborted();
    const computer = await this.options.computer();
    const environment = await this.options.sandbox.environment?.(computer, context);
    const nonce = randomBytes(16).toString("hex");
    const encoded = Buffer.from(JSON.stringify({ prompt: parsed.data.prompt, nonce })).toString(
      "base64",
    );
    const executionContext = {
      ...context,
      signal: AbortSignal.any([context.signal, AbortSignal.timeout(9 * 60_000)]),
    };
    let output = "",
      exit: number | undefined;
    try {
      for await (const event of this.options.sandbox.execute(
        computer,
        {
          argv: [
            environment?.runtimeExecutable ?? "node",
            "--input-type=commonjs",
            "-e",
            CODEX_IMAGE_WORKER,
            encoded,
          ],
          env: { ELECTRON_RUN_AS_NODE: "1" },
          unsetEnv: ["NODE_OPTIONS", "OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL"],
          timeoutMs: 9 * 60_000,
        },
        executionContext,
      )) {
        executionContext.signal.throwIfAborted();
        if (event.type === "stdout") {
          output += event.data;
          if (output.length > 12 * 1024 * 1024) throw nativeFailure("output_limit");
        } else if (event.type === "exit") exit = event.code;
        // CLI diagnostics and credentials are never returned to the model or chat.
      }
      context.signal.throwIfAborted();
      const result: unknown = JSON.parse(output);
      if (!result || typeof result !== "object" || !("nonce" in result) || result.nonce !== nonce)
        throw nativeFailure("generation_failed");
      if ("error" in result) throw nativeFailure(result.error);
      if (
        exit !== 0 ||
        !("mimeType" in result) ||
        result.mimeType !== "image/png" ||
        !("data" in result) ||
        typeof result.data !== "string"
      )
        throw nativeFailure("generation_failed");
      if (
        result.data.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(result.data) ||
        result.data.length % 4 === 1
      )
        throw nativeFailure("output_limit");
      const bytes = Buffer.from(result.data, "base64");
      if (
        bytes.length < 8 ||
        bytes.length > MAX_IMAGE_BYTES ||
        !bytes.subarray(0, 8).equals(PNG_HEADER)
      )
        throw nativeFailure("generation_failed");
      return { bytes, mimeType: "image/png" };
    } catch (error) {
      context.signal.throwIfAborted();
      if (error instanceof MediaGenerationError) throw error;
      throw nativeFailure("generation_failed");
    }
  }
  async generateVideo(): Promise<never> {
    throw new MediaGenerationError("unsupported");
  }
  async pollVideo(): Promise<never> {
    throw new MediaGenerationError("unsupported");
  }
}

export function selectRunMediaGeneration(
  options: {
    configured?: MediaGenerationProvider;
    computerAvailable: boolean;
    computerKind: string;
    sandbox: SandboxProvider;
    computer: () => Promise<ComputerRef>;
  },
  env: NodeJS.ProcessEnv = process.env,
): MediaGenerationProvider | undefined {
  if (options.configured) return options.configured;
  const mode = env.MEDIA_GENERATION_PROVIDER?.trim().toLowerCase();
  if (
    !options.computerAvailable ||
    options.computerKind !== "desktop" ||
    (mode && mode !== "auto" && mode !== "native")
  )
    return undefined;
  return new NativeComputerImageProvider(options);
}
