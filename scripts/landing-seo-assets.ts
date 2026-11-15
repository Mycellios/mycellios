import type { Plugin } from "vite";
import { publicSeoResources } from "../landing/src/seo-resources.js";

/** Serve generated public references in dev too; production writes identical bytes. */
export function landingSeoAssets(): Plugin {
  return {
    name: "mycellios:public-seo-references",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!["GET", "HEAD"].includes(request.method ?? "")) return next();
        const path = (request.url ?? "").split("?")[0]!;
        const resource = publicSeoResources().get(path);
        if (!resource) return next();
        response.setHeader("Content-Type", resource.type);
        if (path.endsWith(".md")) response.setHeader("X-Robots-Tag", "noindex, follow");
        response.end(request.method === "HEAD" ? undefined : resource.body);
      });
    },
  };
}
