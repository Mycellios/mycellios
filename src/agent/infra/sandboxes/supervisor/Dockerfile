FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436
WORKDIR /app
COPY src/agent/ .
COPY src/contracts/ /contracts/
RUN --mount=type=cache,id=mycellios-agent-npm,target=/root/.npm npm ci --workspace @rakazo/sandbox-supervisor --include-workspace-root=false --omit=dev --ignore-scripts --no-audit --no-fund \
    && ln -s /app/node_modules /contracts/node_modules
CMD ["npm", "run", "start", "--workspace", "@rakazo/sandbox-supervisor"]
