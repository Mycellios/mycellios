#!/usr/bin/env bash
# Fails when a built image carries a credential or checkout state: a .env file, a .git directory, a
# private key file, or a PEM private key in the app tree. CI runs it on the app image before any tag
# points at it. Third-party packages under node_modules are skipped; they are not ours to vet.
#
# Usage: check-image.sh IMAGE [PLATFORM]
set -euo pipefail

image="${1:?Usage: check-image.sh IMAGE [PLATFORM]}"
platform="${2:-linux/amd64}"
container=""
ref="${image}"
cleanup() {
  [[ -z "${container}" ]] || docker rm --force "${container}" >/dev/null 2>&1 || true
  [[ "${ref}" == "${image}" ]] || docker rmi "${ref}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Check the platform's own manifest rather than the multi-platform list: the Docker image store
# refuses to pull one list a second time for another platform. A single-platform image is used as is.
if raw="$(docker buildx imagetools inspect --raw "${image}" 2>/dev/null)" &&
  [[ "$(jq -r '.manifests | type' <<<"${raw}")" == array ]]; then
  digest="$(jq -r --arg os "${platform%%/*}" --arg arch "${platform#*/}" \
    'first(.manifests[] | select(.platform.os == $os and .platform.architecture == $arch) | .digest) // empty' \
    <<<"${raw}")"
  [[ -n "${digest}" ]] || { echo "${image} has no ${platform} image." >&2; exit 1; }
  repository="${image%@*}"
  [[ "${repository##*/}" != *:* ]] || repository="${repository%:*}"
  ref="${repository}@${digest}"
fi

container="$(docker create --quiet --platform "${platform}" "${ref}")"

# Inspect immutable layer archives, including deleted files, without executing the image.
# This avoids exporting the entire unpacked dependency tree twice.
selected="$(docker inspect --format '{{.Image}}' "${container}")"
inspector="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/check-image-archive.py"
docker image save "${selected}" | python3 "${inspector}"
echo "${image} (${platform}) contains no credentials or checkout state."
