import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Publish the exact UI-kit sources for editorial pages without the React application. */
export function marketingNavigationAssets(root = process.cwd()) {
  const assets = ["css", "js"].map(extension => ({
    name: `marketing-navigation.${extension}`,
    path: resolve(root, `landing/src/ui/marketing-navigation.${extension}`),
    type: extension === "css" ? "text/css" : "text/javascript",
  }));
  return {
    name: "mycellios:marketing-navigation",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const asset = assets.find(item => request.url?.split("?")[0] === `/${item.name}`);
        if (!asset) return next();
        response.setHeader("Content-Type", asset.type);
        response.setHeader("Cache-Control", "no-cache");
        response.end(readFileSync(asset.path));
      });
    },
    generateBundle() {
      for (const asset of assets) this.emitFile({ type: "asset", fileName: asset.name, source: readFileSync(asset.path, "utf8") });
    },
  };
}
