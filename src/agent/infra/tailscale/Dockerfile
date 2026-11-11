# Build this optional gateway from the src/agent build context.
# The reviewed Tailscale release is fixed; do not use a floating latest tag.
FROM tailscale/tailscale:v1.104.4 AS tailscale
FROM node:22.22.2-alpine
WORKDIR /app
RUN apk add --no-cache ca-certificates
COPY --from=tailscale /usr/local/bin/tailscale /usr/local/bin/tailscale
COPY --from=tailscale /usr/local/bin/tailscaled /usr/local/bin/tailscaled
# Reuse the exact proxy implementation already pinned by the Agent lockfile.
COPY package-lock.json package.json ./
COPY packages/adapters/package.json packages/adapters/package.json
COPY infra/tailscale/gateway.mjs ./gateway.mjs
# The gateway has one JS dependency; install the already reviewed exact version.
RUN npm install --no-save --package-lock=false --ignore-scripts --omit=dev --workspaces=false undici@8.12.3
RUN mkdir /state && chown node:node /state
USER node
ENV HOST=0.0.0.0 PORT=8095 TAILSCALE_STATE_DIR=/state
ENTRYPOINT ["node", "gateway.mjs"]
