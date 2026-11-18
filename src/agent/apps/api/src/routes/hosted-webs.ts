import { ORPCError } from "@orpc/server";
import { ANTSEED_RADAR_HTML } from "../hosted-webs/antseed-template.js";
import { createWebPreview } from "../hosted-webs/preview.js";
import { hostedWebDataService } from "../hosted-webs/data.js";
import { hostedWebFilesConfig, hostedWebFilesService } from "../hosted-webs/files.js";
import { hostedWebService } from "../hosted-webs/service.js";
import type { RouterContext } from "./context.js";

export function hostedWebRoutes({ deps, authed }: RouterContext) {
  const filesConfig = hostedWebFilesConfig(
    process.env,
    deps.artifacts,
    deps.env?.maxUploadSizeBytes,
  );
  const files = hostedWebFilesService(deps.prisma, deps.artifacts, filesConfig);
  // Account deletion may finish after its own sweep; catch those objects later.
  setInterval(() => void files.sweep().catch(() => undefined), 30 * 60 * 1000).unref();
  const service = hostedWebService(deps.prisma, { filesAvailable: filesConfig.available });
  const data = hostedWebDataService(deps.prisma);
  return {
    webs: {
      agent: authed.webs.agent.handler(({ context, input }) =>
        service.agent(context.actor, input.id),
      ),
      assignAgent: authed.webs.assignAgent.handler(({ context, input }) =>
        service.assignAgent(context.actor, input.id, input.botId),
      ),
      revision: authed.webs.revision.handler(({ context, input }) =>
        service.revision(context.actor, input.id),
      ),
      list: authed.webs.list.handler(({ context, input }) =>
        service.list(context.actor, input.filter, input.query),
      ),
      draft: authed.webs.draft.handler(({ context, input }) =>
        service.draft(context.actor, input.id),
      ),
      save: authed.webs.save.handler(({ context, input }) =>
        service.save(context.actor, input),
      ),
      publish: authed.webs.publish.handler(({ context, input }) =>
        service.publish(context.actor, input.id, input.version),
      ),
      unpublish: authed.webs.unpublish.handler(({ context, input }) =>
        service.unpublish(context.actor, input.id),
      ),
      pin: authed.webs.pin.handler(({ context, input }) =>
        service.pin(context.actor, input.id, input.pinned),
      ),
      clone: authed.webs.clone.handler(({ context, input }) =>
        service.clone(context.actor, input.id, input.newId),
      ),
      antseed: authed.webs.antseed.handler(({ context, input }) =>
        service.save(context.actor, {
          id: input.id,
          version: 0,
          slug: `antseed-radar-${input.id.slice(0, 8)}`,
          title: "Antseed Radar",
          summary:
            "Explora modelos y precios públicos de Antseed y estima el coste de tus consultas.",
          bundle: {
            files: [
              {
                path: "index.html",
                base64: Buffer.from(ANTSEED_RADAR_HTML).toString("base64"),
              },
            ],
          },
        }),
      ),
      history: {
        list: authed.webs.history.list.handler(({ context, input }) =>
          service.history(context.actor, input.id),
        ),
        restore: authed.webs.history.restore.handler(({ context, input }) =>
          service.restore(context.actor, input.id, input.snapshotId, input.version),
        ),
      },
      files: {
        status: authed.webs.files.status.handler(() => files.status()),
        put: authed.webs.files.put.handler(({ context, input }) => files.put(context.actor, input)),
        get: authed.webs.files.get.handler(({ context, input }) => files.get(context.actor, input)),
        delete: authed.webs.files.delete.handler(({ context, input }) =>
          files.delete(context.actor, input),
        ),
        list: authed.webs.files.list.handler(({ context, input }) => files.list(context.actor, input)),
      },
      data: {
        get: authed.webs.data.get.handler(({ context, input }) => data.get(context.actor, input)),
        set: authed.webs.data.set.handler(({ context, input }) => data.set(context.actor, input)),
        delete: authed.webs.data.delete.handler(({ context, input }) =>
          data.delete(context.actor, input),
        ),
        list: authed.webs.data.list.handler(({ context, input }) => data.list(context.actor, input)),
      },
      preview: authed.webs.preview.handler(async ({ context, input }) => {
        const draft = await service.draft(context.actor, input.id);
        if (draft.version !== input.version)
          throw new ORPCError("CONFLICT", {
            message: "Reload the current draft before previewing.",
          });
        return createWebPreview(
          context.actor,
          draft.id,
          draft.version,
          draft.bundle,
        );
      }),
    },
  };
}
