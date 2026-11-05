/** Specification contracts, not installed tools or permission grants. */
export const APP_ACTION_IDS = [
  "ai.text.generate",
  "media.voice.generate",
  "media.preview.render",
  "media.video.render",
] as const;

export type AppValueType = "text" | "number" | "boolean" | "image" | "audio" | "video" | "document";
export const APP_CAPABILITIES = ["models.invoke", "media.voice", "media.render"] as const;

export const APP_ACTION_CONTRACTS = {
  "ai.text.generate": {
    version: "1.0.0", capability: "models.invoke",
    inputs: { prompt: "text" }, outputs: { text: "text" },
  },
  "media.voice.generate": {
    version: "1.0.0", capability: "media.voice",
    inputs: { text: "text" }, outputs: { audio: "audio" },
  },
  "media.preview.render": {
    version: "1.0.0", capability: "media.render",
    inputs: { storyboard: "text" }, outputs: { image: "image" },
  },
  "media.video.render": {
    version: "1.0.0", capability: "media.render",
    inputs: { storyboard: "text", voice: "audio" }, outputs: { video: "video" },
  },
} as const satisfies Record<typeof APP_ACTION_IDS[number], {
  version: string;
  capability: typeof APP_CAPABILITIES[number];
  inputs: Record<string, AppValueType>;
  outputs: Record<string, AppValueType>;
}>;
