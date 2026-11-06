import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig } from "vitest/config";

const chatRequire = createRequire(new URL("./packages/chat-ui/package.json", import.meta.url));
const webRequire = createRequire(new URL("./apps/web/package.json", import.meta.url));
const { lingui } = await import(pathToFileURL(webRequire.resolve("@lingui/vite-plugin")).href);
const markdownSource = path.join(path.dirname(chatRequire.resolve(
  "@ronradtke/react-native-markdown-display/package.json",
)), "src/index.tsx");

export default defineConfig({
  // Offline tests receive explicit fixtures; never read a maintainer's .env.
  envDir: false,
  plugins: [
    lingui({
      configPath: fileURLToPath(new URL("./apps/web/lingui.config.ts", import.meta.url)),
      failOnCompileError: true,
    }),
  ],
  resolve: {
    alias: [
      {
        // The published dist keeps JSX inside .js files, which vite cannot parse;
        // tests load the package's shipped TypeScript source instead.
        find: /^@ronradtke\/react-native-markdown-display$/,
        replacement: markdownSource,
      },
      {
        find: /^@lingui\/core\/macro$/,
        replacement: fileURLToPath(
          new URL("./packages/testkit/src/lingui-core-macro.ts", import.meta.url),
        ),
      },
      // Native-only transitive deps of the renderer contain uncompiled Flow
      // source; stub them out in tests (they never render anyway).
      ...["react-native-fit-image", "@react-native-vector-icons/material-design-icons"].map(
        (dep) => ({
          find: new RegExp(`^${dep.replace(/[/]/g, "\\/")}$`),
          replacement: fileURLToPath(
            new URL("./packages/chat-ui/src/native-test-stubs.tsx", import.meta.url),
          ),
        }),
      ),
    ],
  },
  test: {
    // Load the markdown renderer's shipped TypeScript source through vite so
    // react-native can be mocked in node tests.
    server: { deps: { inline: [/react-native-markdown-display/] } },
    environment: "node",
    setupFiles: ["./packages/testkit/src/pin-test-env.ts"],
    include: [
      ".agents/skills/pr-watch/*.test.ts",
      "packages/*/src/**/*.test.{ts,tsx}",
      "infra/sandboxes/supervisor/src/**/*.test.ts",
      "infra/updater/src/**/*.test.ts",
      "apps/desktop/src/**/*.test.ts",
      "apps/web/src/**/*.test.{ts,tsx}",
      "apps/mobile/lib/**/*.test.{ts,tsx}",
      "apps/mobile/plugins/**/*.test.js",
      "apps/api/src/**/*.test.ts",
      "apps/worker/src/**/*.test.ts",
    ],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
