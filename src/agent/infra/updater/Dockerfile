# The updater is the only service that gets the Docker CLI and the Docker socket, so it is built
# separately from the application image rather than adding root-equivalent tooling to api, worker,
# and web. It is also the only service the update never recreates, so its own image moves on the
# operator's schedule: `docker compose pull updater && docker compose up -d updater`.
FROM docker:27-cli@sha256:851f91d241214e7c6db86513b270d58776379aacc5eb9c4a87e5b47115e3065c AS dockercli

FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=dockercli /usr/local/libexec/docker/cli-plugins/docker-compose \
  /usr/local/libexec/docker/cli-plugins/docker-compose
COPY --from=dockercli /usr/local/libexec/docker/cli-plugins/docker-buildx \
  /usr/local/libexec/docker/cli-plugins/docker-buildx
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY src/agent/ .
COPY src/contracts/ /contracts/
RUN --mount=type=cache,id=mycellios-agent-npm,target=/root/.npm npm ci --workspace @rakazo/updater --include-workspace-root=false --omit=dev --ignore-scripts --no-audit --no-fund \
    && ln -s /app/node_modules /contracts/node_modules
ARG GIT_SHA
ENV GIT_SHA=$GIT_SHA
CMD ["npm", "run", "start", "--workspace", "@rakazo/updater"]
