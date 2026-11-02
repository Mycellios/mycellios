import { defineConfig, mergeConfig } from "vitest/config";
import { workspaceViteAliases } from "../apps/desktop/scripts/workspace-aliases.mjs";
import base from "../vitest.config.ts";
export default mergeConfig(base, defineConfig({resolve:{alias:await workspaceViteAliases(import.meta.dirname + "/..")}}));
