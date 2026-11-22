FROM node:22-bookworm@sha256:0557ac14e0d45d02ed563067b82856ca5e7aa3437fa28d98d4350ea9c3d9494a
# Agent lives in the Mycellios monorepo and imports root modules by relative path
# (src/contracts, src/core, scripts/, and the web build hashes the native source tree).
# Keep the monorepo layout so those paths resolve exactly as in CI.
# ffmpeg lets read_video merge downloaded streams and sample frames and audio.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /repo/src/agent
COPY --chmod=755 . /repo/
# Shared contracts consume the Agent workspace's own dependency graph. node_modules is a
# real directory (the native source provenance skips it but rejects a symlinked one).
RUN --mount=type=cache,id=mycellios-agent-npm,target=/root/.npm npm ci --ignore-scripts --no-audit --no-fund \
    && (cd /repo && npm ci --ignore-scripts --no-audit --no-fund) \
    && mkdir /repo/src/contracts/node_modules \
    && ln -s /repo/src/agent/node_modules/* /repo/src/agent/node_modules/.bin /repo/src/contracts/node_modules/ \
    && npm rebuild @prisma/engines \
    && npm run generate --workspace @mycellios/db \
    && npm run build --workspace @mycellios/api --workspace @mycellios/worker
ARG APP_BASE_PATH=/
RUN APP_BASE_PATH=$APP_BASE_PATH RAKAZO_ALLOW_DEV_SECRETS=1 npm run build --workspace @mycellios/web
# Existing runtime configurations and tools refer to /app.
RUN ln -s /repo/src/agent /app \
    && install -d -m 750 -o node -g node /data /repo/src/agent/apps/web/node_modules/.vite-temp /repo/src/agent/apps/web/asset-archive
ARG GIT_SHA
ENV NODE_ENV=production
ENV GIT_SHA=$GIT_SHA
EXPOSE 3100 5173 7091
USER node
CMD ["npm", "run", "start", "--workspace", "@mycellios/api"]
