import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { lingui } from "@lingui/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { workspaceViteAliases } from "../../apps/desktop/scripts/workspace-aliases.mjs";

export default defineConfig(async () => ({
  // Library builds preserve this reference unless defined explicitly. The private
  // addon runs in a sandboxed renderer without Node's process global.
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [
    react(),
    babel({ plugins: ["@lingui/babel-plugin-lingui-macro"] }),
    lingui(),
    tailwindcss(),
  ],
  resolve: { alias: await workspaceViteAliases(path.resolve("../..")), dedupe: ["react", "react-dom"] },
  build: {
    outDir: path.resolve("../../../../outputs/apps-local/renderer"),
    emptyOutDir: true,
    lib: {
      entry: path.resolve("../../scripts/apps/local-preview-entry.tsx"),
      formats: ["es"],
      fileName: "apps-preview",
      cssFileName: "apps-preview",
    },
    rolldownOptions: { output: { inlineDynamicImports: true } },
  },
}));
