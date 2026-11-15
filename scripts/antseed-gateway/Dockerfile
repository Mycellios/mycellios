# Build from the exact inspected gateway image, with the repository as context.
ARG ANTSEED_BASE_IMAGE
FROM ${ANTSEED_BASE_IMAGE}
USER 0:0
ARG UPSTREAM_SERVER_SHA256
ARG UPSTREAM_RESERVATION_SHA256
ARG PROTECTED_KEY_IDS_JSON
ARG FEATURE_REVISION
COPY --chmod=0644 scripts/antseed-gateway/patch-gateway.mjs /opt/mycellios-bounded-text/patch-gateway.mjs
COPY --chmod=0644 scripts/antseed-gateway/text-cost-contract.mjs /opt/mycellios-bounded-text/text-cost-contract.mjs
RUN node --input-type=module -e 'import fs from "node:fs"; import crypto from "node:crypto"; import assert from "node:assert/strict"; for (const [name,variable] of [["server.js","UPSTREAM_SERVER_SHA256"],["request-reservation.js","UPSTREAM_RESERVATION_SHA256"]]) { const expected=process.env[variable]; assert.match(expected ?? "",/^[a-f0-9]{64}$/); assert.equal(crypto.createHash("sha256").update(fs.readFileSync("/opt/antseed/node_modules/@antseed/cli/dist/gateway/"+name)).digest("hex"),expected,"Upstream source changed"); }'
RUN node /opt/mycellios-bounded-text/patch-gateway.mjs /opt/antseed/node_modules/@antseed/cli/dist/gateway/server.js /tmp/server.bounded.js "$PROTECTED_KEY_IDS_JSON" \
 && cp /opt/antseed/node_modules/@antseed/cli/dist/gateway/request-reservation.js /opt/antseed/node_modules/@antseed/cli/dist/gateway/request-reservation.legacy.js \
 && cp /tmp/server.bounded.js /opt/antseed/node_modules/@antseed/cli/dist/gateway/server.js \
 && cp /tmp/server.bounded.js.reservation /opt/antseed/node_modules/@antseed/cli/dist/gateway/request-reservation.js \
 && cp /opt/mycellios-bounded-text/text-cost-contract.mjs /opt/antseed/node_modules/@antseed/cli/dist/gateway/mycellios-text-cost-contract.mjs \
 && chmod 0644 /opt/antseed/node_modules/@antseed/cli/dist/gateway/server.js /opt/antseed/node_modules/@antseed/cli/dist/gateway/request-reservation.js /opt/antseed/node_modules/@antseed/cli/dist/gateway/request-reservation.legacy.js /opt/antseed/node_modules/@antseed/cli/dist/gateway/mycellios-text-cost-contract.mjs
USER 1000:1000
# Import the actual installed server and reservation graph as the production UID.
# No data directory, external network, credentials or supplier calls are required.
RUN node --input-type=module -e 'import assert from "node:assert/strict"; const base="/opt/antseed/node_modules/@antseed/cli/dist/gateway/"; assert.equal(typeof (await import(base+"server.js")).GatewayServer,"function"); assert.equal(typeof (await import(base+"request-reservation.js")).deepSeekHoldUsdc,"function"); assert.equal((await import(base+"mycellios-text-cost-contract.mjs")).CONTRACT,"token-bounded-v2");'
LABEL io.mycellios.antseed-cost-contract="token-bounded-v2" io.mycellios.gateway-source="${FEATURE_REVISION}"
