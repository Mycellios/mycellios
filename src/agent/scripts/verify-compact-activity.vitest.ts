import { defineConfig, mergeConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import base from "../vitest.config.ts";
export default mergeConfig(base, defineConfig({resolve:{alias:[{find:"@rakazo/core/run-health",replacement:fileURLToPath(new URL("../packages/core/src/run-health.ts",import.meta.url))}]}}));
