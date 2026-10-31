import { build } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
await build({ configFile: false, root: resolve("landing"), base: "/downloads/desktop/", publicDir: false,
  plugins: [react()], build: { outDir: resolve("build/desktop-downloads/web"), emptyOutDir: true,
    rollupOptions: { input: resolve("landing/desktop-downloads.html") } } });
