FROM node:22-bookworm@sha256:0557ac14e0d45d02ed563067b82856ca5e7aa3437fa28d98d4350ea9c3d9494a
WORKDIR /app
COPY --chmod=755 src/agent/ .
COPY --chmod=755 src/contracts/ /contracts/
# Shared contracts are outside /app; they consume this same owned dependency graph.
RUN --mount=type=cache,id=mycellios-agent-npm,target=/root/.npm npm ci --ignore-scripts --no-audit --no-fund \
    && ln -s /app/node_modules /contracts/node_modules \
    && npm rebuild @prisma/engines \
    && npm run generate --workspace @rakazo/db \
    && npm run build --workspace @rakazo/api --workspace @rakazo/worker
ARG APP_BASE_PATH=/
RUN APP_BASE_PATH=$APP_BASE_PATH RAKAZO_ALLOW_DEV_SECRETS=1 npm run build --workspace @rakazo/web
RUN install -d -m 750 -o node -g node /data /app/apps/web/node_modules/.vite-temp /app/apps/web/asset-archive
ARG GIT_SHA
ENV NODE_ENV=production
ENV GIT_SHA=$GIT_SHA
EXPOSE 3100 5173 7091
USER node
CMD ["npm", "run", "start", "--workspace", "@rakazo/api"]
