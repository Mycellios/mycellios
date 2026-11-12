import { z } from "zod";
import { browserInferenceOfferSchema } from "../contracts/browser-inference.js";
export const browserInferenceConfigSchema = z.object({
  offers: z.array(browserInferenceOfferSchema).min(1).max(32),
  dailyLimitMicrounits: z.number().int().positive().max(100_000_000),
  textModelsPath: z.string().min(1).max(1024).optional(),
}).strict();
export type BrowserInferenceConfig = z.infer<typeof browserInferenceConfigSchema>;
/** Explicit operator opt-in; importing or testing this module never enables paid admission. */
export function readBrowserInferenceConfig(env: NodeJS.ProcessEnv): BrowserInferenceConfig | undefined {
  if (env.MYCELLIOS_BROWSER_INFERENCE_ENABLED !== "true") return undefined;
  return browserInferenceConfigSchema.parse(JSON.parse(env.MYCELLIOS_BROWSER_INFERENCE_CONFIG ?? "null"));
}
