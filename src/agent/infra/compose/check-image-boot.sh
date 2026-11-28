#!/usr/bin/env bash
# Builds the Agent image of this checkout (infra/compose/Dockerfile, never pushed) and proves the
# services start from it the way Nucleus and Compose run them: the migration CLI applies the
# schema to a disposable PostgreSQL, the API answers /health, the worker reports healthy and vite
# preview serves the web build. It also runs check-image.sh and prints the layer sizes, next to
# the published image of the base commit when the registry has one.
#
# CI runs it when the image's inputs change (scripts/ci-proportional.mjs). It needs Docker, git,
# python3 and openssl, and talks to no service besides the registries it pulls from.
#
# Usage: check-image-boot.sh
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "${root}"
dockerfile=src/agent/infra/compose/Dockerfile
revision="$(git rev-parse HEAD)"
image="mycellios-agent-check:${revision}"
suffix="agent-image-check-$$"
network="${suffix}"
postgres_image="postgres:18@sha256:edb0c08dc33befd0262ab3b5cf1c4f3f8cfd8b09e88c05b45adee29d6761ddb6"
containers=()

cleanup() {
  local status=$?
  for container in "${containers[@]}"; do
    if ((status != 0)); then
      echo "::group::${container} logs"
      docker logs --tail 200 "${container}" 2>&1 || true
      echo "::endgroup::"
    fi
    docker rm --force "${container}" >/dev/null 2>&1 || true
  done
  docker network rm "${network}" >/dev/null 2>&1 || true
  docker image rm --force "${image}" >/dev/null 2>&1 || true
  # Later checks on a hosted runner need the disk back.
  [[ "${GITHUB_ACTIONS:-}" != true ]] || docker builder prune --all --force >/dev/null 2>&1 || true
  exit "${status}"
}
trap cleanup EXIT

if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
  # The hosted runner's preinstalled SDKs leave too little disk for both workspaces' installs.
  sudo rm -rf /usr/local/lib/android /usr/share/dotnet /opt/ghc /usr/local/.ghcup /usr/share/swift /opt/hostedtoolcache/CodeQL
  df -h /
fi

started=${SECONDS}
docker build --file "${dockerfile}" --build-arg "GIT_SHA=${revision}" --build-arg APP_BASE_PATH=/agent/ \
  --tag "${image}" .
echo "Built ${image} in $((SECONDS - started)) s."

# Compressed (gzip, as the registry stores them) and unpacked size of each layer. A commit that
# changes only code replaces the layers from the source copy onwards.
layer_report() {
  local archive
  archive="$(mktemp -d)"
  docker image save "${image}" -o "${archive}/image.tar"
  python3 - "${archive}/image.tar" <<'PY'
import json, sys, tarfile, zlib

with tarfile.open(sys.argv[1]) as saved:
    manifest = json.load(saved.extractfile("manifest.json"))[0]
    config = json.load(saved.extractfile(manifest["Config"]))
    history = [entry for entry in config["history"] if not entry.get("empty_layer")]
    rows, total, per_commit, code = [], [0, 0], [0, 0], False
    for layer, entry in zip(manifest["Layers"], history):
        # The containerd image store saves layers gzipped as pushed; the classic store saves tars.
        stream, packed, unpacked = saved.extractfile(layer), 0, 0
        head = stream.read(2)
        stored = head == b"\x1f\x8b"
        codec = zlib.decompressobj(31) if stored else zlib.compressobj(6, zlib.DEFLATED, 31)
        chunk = head
        while chunk:
            if stored:
                packed += len(chunk)
                unpacked += len(codec.decompress(chunk))
            else:
                unpacked += len(chunk)
                packed += len(codec.compress(chunk))
            chunk = stream.read(1 << 20)
        packed += 0 if stored else len(codec.flush())
        step = entry.get("created_by", "").replace(" # buildkit", "")
        code = code or step.startswith("COPY --chmod=755 . /repo/")
        for bucket in [total] + ([per_commit] if code else []):
            bucket[0] += packed
            bucket[1] += unpacked
        rows.append(f"{packed / 2**20:10.1f} {unpacked / 2**20:10.1f}  {step[:110]}")
print(f"{'gzip MB':>10} {'unpacked MB':>11}  step")
print("\n".join(rows))
print(f"Image: {total[0] / 2**20:.1f} MB compressed, {total[1] / 2**20:.1f} MB unpacked, {len(rows)} layers.")
print(f"Replaced by a code-only commit: {per_commit[0] / 2**20:.1f} MB compressed, {per_commit[1] / 2**20:.1f} MB unpacked.")
PY
  rm -rf "${archive}"
}

# The base commit's published amd64 image, read anonymously from the public registry.
published_report() {
  local base repository token
  base="$(git rev-parse HEAD^1)"
  repository="mycellios/mycellios/agent"
  token="$(curl -fsS --max-time 20 "https://ghcr.io/token?scope=repository:${repository}:pull" |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')" || return 0
  python3 - "${repository}" "sha-${base}" "${token}" <<'PY' || echo "No published Agent image for the base commit."
import json, sys, urllib.request

repository, tag, token = sys.argv[1:]
accept = ", ".join(["application/vnd.oci.image.index.v1+json", "application/vnd.oci.image.manifest.v1+json",
                    "application/vnd.docker.distribution.manifest.list.v2+json",
                    "application/vnd.docker.distribution.manifest.v2+json"])
def fetch(reference):
    request = urllib.request.Request(f"https://ghcr.io/v2/{repository}/manifests/{reference}",
                                     headers={"Authorization": f"Bearer {token}", "Accept": accept})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)
manifest = fetch(tag)
if "manifests" in manifest:
    manifest = fetch(next(m["digest"] for m in manifest["manifests"] if m.get("platform", {}).get("architecture") == "amd64"))
sizes = [layer["size"] for layer in manifest["layers"]]
print(f"Published {tag}: {sum(sizes) / 2**20:.1f} MB compressed in {len(sizes)} layers "
      f"({', '.join(f'{size / 2**20:.0f}' for size in sizes)} MB).")
PY
}

echo "::group::Image layers"
layer_report
published_report
echo "::endgroup::"

bash src/agent/infra/compose/check-image.sh "${image}"

secret() { openssl rand -hex 32; }
owner_password="$(secret)"
runtime_password="$(secret)"
postgres="${suffix}-postgres"
docker network create "${network}" >/dev/null
containers+=("${postgres}")
docker run --detach --name "${postgres}" --network "${network}" \
  -e POSTGRES_USER=agent_owner -e "POSTGRES_PASSWORD=${owner_password}" -e POSTGRES_DB=agent \
  "${postgres_image}" >/dev/null

# Waits until COMMAND (run inside CONTAINER) succeeds, failing after LIMIT seconds or as soon as
# the container exits.
wait_for() {
  local container=$1 limit=$2 label=$3
  shift 3
  local deadline=$((SECONDS + limit))
  until docker exec "${container}" "$@" >/dev/null 2>&1; do
    if [[ "$(docker inspect --format '{{.State.Running}}' "${container}")" != true ]]; then
      echo "${label}: ${container} exited." >&2
      return 1
    fi
    if ((SECONDS >= deadline)); then
      echo "${label}: not ready after ${limit} s." >&2
      return 1
    fi
    sleep 2
  done
  echo "${label}: ready after $((limit - deadline + SECONDS)) s."
}

wait_for "${postgres}" 90 "PostgreSQL" pg_isready -U agent_owner -d agent

# The hardening the production services run with, and settings they all read.
app=(--network "${network}" --init --cap-drop ALL --security-opt no-new-privileges:true
  -e "DATABASE_URL=postgres://agent_runtime_login:${runtime_password}@${postgres}:5432/agent"
  -e "DATABASE_MIGRATION_URL=postgres://agent_owner:${owner_password}@${postgres}:5432/agent"
  -e "BETTER_AUTH_SECRET=$(secret)" -e "ENCRYPTION_KEY=$(secret)"
  -e "SCREEN_PROXY_SECRET=$(secret)" -e "SANDBOX_SUPERVISOR_TOKEN=$(secret)"
  -e BETTER_AUTH_URL=http://localhost:5173/agent -e WEB_ORIGIN=http://localhost:5173)

# Nucleus runs this with the candidate image before it recreates the services.
echo "Migrating with the candidate image."
docker run --rm "${app[@]}" --workdir /app/apps/api "${image}" node --enable-source-maps dist/cli/migrate-database.js

api="${suffix}-api"
containers+=("${api}")
docker run --detach --name "${api}" "${app[@]}" --workdir /app/apps/api -e API_HOST=0.0.0.0 "${image}" \
  bash -lc 'npm run db:deploy && exec env -u DATABASE_MIGRATION_URL node --enable-source-maps dist/index.js' >/dev/null
wait_for "${api}" 180 "API" node -e \
  "fetch('http://127.0.0.1:3100/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

worker="${suffix}-worker"
containers+=("${worker}")
docker run --detach --name "${worker}" "${app[@]}" --workdir /app/apps/worker "${image}" \
  node --enable-source-maps dist/index.js >/dev/null
wait_for "${worker}" 180 "Worker" node dist/health-check.js

web="${suffix}-web"
containers+=("${web}")
docker run --detach --name "${web}" "${app[@]}" --workdir /app/apps/web -e "API_PROXY_TARGET=http://${api}:3100" \
  "${image}" node_modules/.bin/vite preview --host 0.0.0.0 --port 5173 >/dev/null
wait_for "${web}" 120 "Web" node -e \
  "fetch('http://127.0.0.1:5173/agent/').then(async r=>{if(!r.ok||!(await r.text()).includes('<script'))process.exit(1)}).catch(()=>process.exit(1))"

echo "The Agent image of ${revision} migrates a database and starts the API, worker and web."
