import { fileURLToPath } from "node:url";
import { lingui } from "@lingui/vite-plugin";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { workspaceViteAliases } from "../../desktop/scripts/workspace-aliases.mjs";

const agent = fileURLToPath(new URL("../../../", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/contribution/", import.meta.url));
export default defineConfig({
  root: fixture,
  envDir: false,
  resolve: { alias: [
    { find: /^\.\.\/lib\/(?:rpc|desktop)$/, replacement: `${fixture}state.ts` },
    ...await workspaceViteAliases(agent),
  ] },
  plugins: [react(), babel({ plugins: [["@lingui/babel-plugin-lingui-macro", { descriptorFields: "message" }]] }), lingui(), tailwindcss()],
  build: { outDir: fileURLToPath(new URL("../.contribution-preview/", import.meta.url)), emptyOutDir: true },
  preview: { host: "127.0.0.1", port: 4196, strictPort: true },
});
