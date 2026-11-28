# One image runs Agent web (vite preview), API and worker, and the API's migration CLI.
# Agent lives in the Mycellios monorepo and imports root modules by relative path
# (src/contracts, src/core, scripts/, and the web config hashes the native source tree when
# vite preview loads it). Keep the monorepo layout so those paths resolve exactly as in CI.
#
# The stages keep dependency installs apart from the source, so a commit that changes only
# code rebuilds and ships only the last layers (source and build outputs):
#   manifests     the npm inputs of the repository and Agent workspace (image-manifests.mjs)
#   build-deps    every dependency of both workspaces, for the builds
#   build         API, worker and web builds of this commit
#   runtime-deps  only what the API, worker and web workspaces install
#   runtime       OS packages and dependencies first, then the source and the build outputs
# build-deps and runtime-deps are cached until a lockfile or dependency list changes.
FROM node:22-bookworm@sha256:0557ac14e0d45d02ed563067b82856ca5e7aa3437fa28d98d4350ea9c3d9494a AS base

FROM base AS manifests
COPY . /context/
RUN node /context/src/agent/infra/compose/image-manifests.mjs /context /manifests

FROM base AS build-deps
COPY --from=manifests /manifests/ /repo/
WORKDIR /repo/src/agent
# Shared contracts consume the Agent workspace's own dependency graph. node_modules is a
# real directory (the native source provenance skips it but rejects a symlinked one).
RUN --mount=type=cache,id=mycellios-agent-npm,target=/root/.npm npm ci --ignore-scripts --no-audit --no-fund \
    && (cd /repo && npm ci --ignore-scripts --no-audit --no-fund) \
    && mkdir -p /repo/src/contracts/node_modules \
    && ln -s /repo/src/agent/node_modules/* /repo/src/agent/node_modules/.bin /repo/src/contracts/node_modules/ \
    && npm rebuild @prisma/engines

FROM build-deps AS build
COPY --chmod=755 . /repo/
RUN npm run generate --workspace @mycellios/db \
    && npm run build --workspace @mycellios/api --workspace @mycellios/worker
ARG APP_BASE_PATH=/
RUN APP_BASE_PATH=$APP_BASE_PATH RAKAZO_ALLOW_DEV_SECRETS=1 npm run build --workspace @mycellios/web

# The server bundles keep node_modules external, and vite preview loads apps/web/vite.config.ts
# with its plugins (the web workspace's development dependencies) and esbuild (the Agent root's).
# Desktop, mobile, testkit and the sandbox images' workspaces and the repository root's own
# dependencies (used only to build the web) stay out.
FROM base AS runtime-deps
COPY --from=manifests /manifests/src/agent/ /repo/src/agent/
WORKDIR /repo/src/agent
RUN --mount=type=cache,id=mycellios-agent-npm,target=/root/.npm npm ci --workspace @mycellios/api --workspace @mycellios/worker --workspace @mycellios/web --include-workspace-root --ignore-scripts --no-audit --no-fund \
    && npm rebuild @prisma/engines \
    && mkdir -p /repo/src/contracts/node_modules \
    && ln -s /repo/src/agent/node_modules/* /repo/src/agent/node_modules/.bin /repo/src/contracts/node_modules/ \
    && find /repo -name package.json -not -path '*/node_modules/*' -delete \
    && rm /repo/src/agent/package-lock.json /repo/src/agent/.npmrc

FROM base AS runtime
# ffmpeg lets read_video merge downloaded streams and sample frames and audio.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY --from=runtime-deps /repo/ /repo/
WORKDIR /repo/src/agent
COPY --chmod=755 . /repo/
COPY --from=build /repo/src/agent/packages/db/src/generated/ /repo/src/agent/packages/db/src/generated/
COPY --from=build /repo/src/agent/apps/api/dist/ /repo/src/agent/apps/api/dist/
COPY --from=build /repo/src/agent/apps/worker/dist/ /repo/src/agent/apps/worker/dist/
COPY --from=build /repo/src/agent/apps/web/dist/ /repo/src/agent/apps/web/dist/
# Existing runtime configurations and tools refer to /app. The web service starts
# node_modules/.bin/vite from apps/web, so link the hoisted bin there if npm did not.
RUN node infra/compose/check-runtime-externals.mjs apps/api/dist apps/worker/dist \
    && ln -s /repo/src/agent /app \
    && install -d -m 750 -o node -g node /data /repo/src/agent/apps/web/node_modules/.vite-temp /repo/src/agent/apps/web/asset-archive \
    && if [ ! -e apps/web/node_modules/.bin/vite ]; then \
         mkdir -p apps/web/node_modules/.bin && ln -s ../../../../node_modules/.bin/vite apps/web/node_modules/.bin/vite; \
       fi
ARG GIT_SHA
ENV NODE_ENV=production
ENV GIT_SHA=$GIT_SHA
EXPOSE 3100 5173 7091
USER node
CMD ["npm", "run", "start", "--workspace", "@mycellios/api"]
