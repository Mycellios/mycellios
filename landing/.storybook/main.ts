import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/ui/**/*.stories.tsx"],
  staticDirs: ["../public"],
  addons: ["@storybook/addon-docs"],
  framework: { name: "@storybook/react-vite", options: {} },
  core: { disableTelemetry: true },
  async viteFinal(config) {
    // Storybook has its own root; never inherit the production API proxy.
    return { ...config, server: { ...config.server, host: "127.0.0.1" } };
  },
};
export default config;
