#!/usr/bin/env bash

set -Eeuo pipefail

# This repository's Compose files and images (specs/trusted-distribution, phase 1). The files come
# from src/agent/infra/compose at the tag being installed: edge from main, v<version> from that
# release tag, sha-<commit> from that commit. An explicit download base, for a mirror, is used as given.
readonly REPOSITORY_FILES="https://raw.githubusercontent.com/Mycellios/mycellios"
readonly REPOSITORY_COMPOSE_PATH="src/agent/infra/compose"
readonly APP_IMAGE="ghcr.io/mycellios/mycellios/app"
readonly COMPUTER_IMAGE="ghcr.io/mycellios/mycellios/computer"
# Installs created before this repository published its images name images of the project
# Mycellios Agent was imported from. They keep them until their owner moves (--move-images).
readonly UPSTREAM_IMAGES="ghcr.io/elie222/"
# Before a move, the target app image lists the migrations the database records that it does not
# ship, and exits 3 when there are any (MIGRATION_HISTORY_COMMAND in the shared contracts).
readonly MIGRATION_CHECK="/app/apps/api/dist/cli/check-migration-history.js"
readonly MIGRATIONS_UNKNOWN=3
# The owner's answer to the move offer, so it is asked once.
readonly MOVE_KEY="MYCELLIOS_IMAGE_MOVE"
# Compose still reads the image settings under the legacy prefix until specs/legacy-name-migration
# phase 2 renames them. As in packages/core/src/legacy-env.ts, the prefix is built from its
# character codes, so new code does not spell it out again.
legacy_prefix="$(printf '\122\101\113\101\132\117_')"
readonly IMAGE_VAR="${legacy_prefix}IMAGE"
readonly IMAGE_TAG_VAR="${legacy_prefix}IMAGE_TAG"
readonly COMPUTER_IMAGE_VAR="${legacy_prefix}COMPUTER_IMAGE"
readonly COMPUTER_IMAGE_TAG_VAR="${legacy_prefix}COMPUTER_IMAGE_TAG"

explicit_base="${MYCELLIOS_DOWNLOAD_BASE:-${RAKAZO_DOWNLOAD_BASE:-}}"
while [[ "$explicit_base" == */ ]]; do
  explicit_base="${explicit_base%/}"
done
case "$explicit_base" in
  "" | https://*) ;;
  *)
    echo "Mycellios setup failed: the download base must use https." >&2
    exit 1
    ;;
esac
readonly explicit_base

readonly COMPOSE_FILE="docker-compose.images.yml"
# Optional operator overlay, layered after the base file the way Compose itself does by default.
readonly OVERRIDE_FILE="docker-compose.override.yml"
readonly ENV_EXAMPLE=".env.images.example"
readonly ENV_FILE=".env"
readonly EGRESS_SCRIPT="restrict-computer-egress.sh"

usage() {
  echo "Usage: bash install-images.sh [--prepare-only] [--local] [--pull-never] [--offline] [--release v<version>] [--move-images | --keep-images]" >&2
  exit 2
}

prepare_only=false
skip_existing=false
pull_never=false
offline=false
release=""
# move or keep: the answer to the move offer given on the command line.
move_answer=""
if [[ "${RAKAZO_DOWNLOAD_SKIP_EXISTING:-}" == "1" ]]; then
  skip_existing=true
fi
if [[ "${RAKAZO_PULL_NEVER:-}" == "1" ]]; then
  pull_never=true
fi

while (($# > 0)); do
  case "$1" in
    --prepare-only)
      prepare_only=true
      ;;
    --local)
      skip_existing=true
      ;;
    --pull-never)
      pull_never=true
      ;;
    --offline)
      # Air-gap bootstrap: keep local Compose/env files and do not pull images.
      skip_existing=true
      pull_never=true
      offline=true
      ;;
    --release)
      (($# > 1)) || usage
      shift
      release="$1"
      ;;
    --release=*)
      release="${1#--release=}"
      ;;
    --move-images)
      move_answer=move
      ;;
    --keep-images)
      move_answer=keep
      ;;
    *)
      usage
      ;;
  esac
  shift
done
if [[ -n "$release" && ! "$release" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Mycellios setup failed: --release takes a release tag such as v1.2.3." >&2
  exit 2
fi

temporary_file=""
# Files a move downloads before it is allowed to replace anything.
move_files=()
cleanup() {
  if [[ -n "$temporary_file" ]]; then
    rm -f -- "$temporary_file"
  fi
  if ((${#move_files[@]} > 0)); then
    rm -f -- "${move_files[@]}"
  fi
}
trap cleanup EXIT

fail() {
  echo "Mycellios setup failed: $*" >&2
  exit 1
}

required_files=("$COMPOSE_FILE" "$ENV_EXAMPLE")
if [[ "$offline" == true ]]; then
  for filename in "${required_files[@]}"; do
    [[ -f "$filename" ]] || fail "--offline requires local ${filename}; copy it into the working directory first."
  done
else
  command -v curl >/dev/null 2>&1 || fail "'curl' is required."
fi

for command_name in docker openssl; do
  command -v "$command_name" >/dev/null 2>&1 || fail "'$command_name' is required."
done
docker compose version >/dev/null 2>&1 || fail "the Docker Compose plugin is required."

# Optional proxy knobs from an existing .env (operators often set them there for
# containers). Do not override values already present in the shell. Treat each
# HTTP/HTTPS/NO_PROXY pair as one family so either case in the shell wins.
# Within .env, later assignments for a family win (shell presence is snapshotted
# before the file is read). Comment stripping is quote-aware so `#` inside
# matching quotes is kept; this is not a full dotenv parser.
load_proxy_vars_from_env_file() {
  local file="$1"
  local line key value
  local i c quote out
  local shell_http=0 shell_https=0 shell_no=0
  [[ -f "$file" ]] || return 0
  [[ -n "${HTTP_PROXY+x}" || -n "${http_proxy+x}" ]] && shell_http=1
  [[ -n "${HTTPS_PROXY+x}" || -n "${https_proxy+x}" ]] && shell_https=1
  [[ -n "${NO_PROXY+x}" || -n "${no_proxy+x}" ]] && shell_no=1
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Windows/.editorconfig CRLF: drop trailing CR so quoted values still match.
    line="${line%$'\r'}"
    out=""
    quote=""
    for ((i = 0; i < ${#line}; i++)); do
      c="${line:i:1}"
      if [[ -n "$quote" ]]; then
        # Inside double quotes, treat \" and \\ as escaped so \# stays in-value.
        if [[ "$quote" == '"' && "$c" == '\' ]] && ((i + 1 < ${#line})); then
          out+="$c"
          i=$((i + 1))
          out+="${line:i:1}"
          continue
        fi
        out+="$c"
        [[ "$c" == "$quote" ]] && quote=""
      elif [[ "$c" == "'" || "$c" == '"' ]]; then
        quote="$c"
        out+="$c"
      elif [[ "$c" == "#" ]]; then
        break
      else
        out+="$c"
      fi
    done
    line="$out"
    [[ "$line" =~ ^[[:space:]]*(HTTP_PROXY|HTTPS_PROXY|NO_PROXY|http_proxy|https_proxy|no_proxy)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    if [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then
      value="${value:1:${#value}-2}"
      value="${value//\\\"/\"}"
      value="${value//\\\\/\\}"
    elif [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
      value="${value:1:${#value}-2}"
    fi
    case "$key" in
      HTTP_PROXY|http_proxy)
        if ((shell_http)); then
          continue
        fi
        unset -v HTTP_PROXY http_proxy
        ;;
      HTTPS_PROXY|https_proxy)
        if ((shell_https)); then
          continue
        fi
        unset -v HTTPS_PROXY https_proxy
        ;;
      NO_PROXY|no_proxy)
        if ((shell_no)); then
          continue
        fi
        unset -v NO_PROXY no_proxy
        ;;
    esac
    export "${key}=${value}"
  done <"$file"
}

# curl uses lowercase http_proxy for http:// URLs; many Mainland hosts only export HTTP_PROXY.
sync_curl_proxy_env() {
  if [[ -n "${HTTP_PROXY+x}" && -z "${http_proxy+x}" ]]; then
    export http_proxy="$HTTP_PROXY"
  fi
  if [[ -n "${HTTPS_PROXY+x}" && -z "${https_proxy+x}" ]]; then
    export https_proxy="$HTTPS_PROXY"
  fi
  if [[ -n "${NO_PROXY+x}" && -z "${no_proxy+x}" ]]; then
    export no_proxy="$NO_PROXY"
  fi
}

prepare_proxy_env() {
  load_proxy_vars_from_env_file "$ENV_FILE"
  sync_curl_proxy_env
}
prepare_proxy_env

curl_download() {
  local url="$1"
  local out="$2"
  local attempt
  local max_attempts=3

  if curl --help all 2>/dev/null | grep -q -- '--retry-all-errors'; then
    curl -fsSL --proto-redir =https --retry 3 --retry-delay 2 --retry-all-errors "$url" -o "$out"
    return $?
  fi

  attempt=1
  while [[ "$attempt" -le "$max_attempts" ]]; do
    if curl -fsSL --proto-redir =https "$url" -o "$out"; then
      return 0
    fi
    if [[ "$attempt" -eq "$max_attempts" ]]; then
      return 1
    fi
    sleep 2
    attempt=$((attempt + 1))
  done
  return 1
}

# Set once the tag being installed is known; empty while an install keeps the upstream images.
download_base=""
# An install that keeps the upstream images keeps the Compose files that match them.
keep_upstream=false

# download <file> [destination]: a destination other than the file itself is always fetched.
download() {
  local filename="$1"
  local destination="${2:-$1}"
  local url="${download_base}/${filename}"

  if [[ "$destination" == "$filename" && "$skip_existing" == true && -e "$filename" ]]; then
    echo "Using local ${filename}"
    return 0
  fi
  if [[ "$offline" == true ]]; then
    fail "--offline cannot download missing ${filename}; copy it into the working directory first."
  fi
  if [[ "$keep_upstream" == true ]]; then
    fail "${filename} is missing. This install keeps its upstream images, so restore the file that matches them, or move with --move-images."
  fi

  temporary_file=$(mktemp "./${filename}.tmp.XXXXXX")
  if ! curl_download "$url" "$temporary_file"; then
    fail "could not download ${filename} from ${url}. Set HTTP_PROXY/HTTPS_PROXY in the shell or .env (NO_PROXY for localhost), or pre-place the file and use --local / --offline."
  fi
  mv -- "$temporary_file" "$destination"
  temporary_file=""
}

# The value of an existing .env setting as Compose reads it: the last assignment wins, an unquoted
# value ends at " #", and one layer of matching quotes is removed. Empty when unset.
env_value() {
  local key="$1" line value="" found=false
  [[ -f "$ENV_FILE" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=(.*)$ ]] || continue
    [[ "${BASH_REMATCH[2]}" == "$key" ]] || continue
    value="${BASH_REMATCH[3]}"
    found=true
  done <"$ENV_FILE"
  [[ "$found" == true ]] || return 0
  value="${value#"${value%%[![:space:]]*}"}"
  if [[ "${value:0:1}" == '"' || "${value:0:1}" == "'" ]]; then
    local quote="${value:0:1}"
    value="${value:1}"
    value="${value%%"$quote"*}"
  else
    value="${value%% #*}"
    value="${value%"${value##*[![:space:]]}"}"
  fi
  printf '%s' "$value"
}

# set_env_values KEY=VALUE...: replaces every assignment of each key, or appends it, keeping the
# rest of .env as it is.
set_env_values() {
  local line key pair handled=" "
  umask 077
  temporary_file=$(mktemp "./${ENV_FILE}.tmp.XXXXXX")
  while IFS= read -r line || [[ -n "$line" ]]; do
    key=""
    if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*= ]]; then
      key="${BASH_REMATCH[2]}"
    fi
    for pair in "$@"; do
      if [[ -n "$key" && "${pair%%=*}" == "$key" ]]; then
        line="$pair"
        handled+="${key} "
        break
      fi
    done
    printf '%s\n' "$line"
  done <"$ENV_FILE" >"$temporary_file"
  for pair in "$@"; do
    [[ "$handled" == *" ${pair%%=*} "* ]] || printf '%s\n' "$pair" >>"$temporary_file"
  done
  chmod 600 "$temporary_file"
  mv -- "$temporary_file" "$ENV_FILE"
  temporary_file=""
}

# Image repository names are lowercase, so a prefix comparison is exact.
is_upstream_image() {
  [[ -n "$1" && "$1" == "$UPSTREAM_IMAGES"* ]]
}

# The git ref whose Compose files match an image tag of this repository, or nothing for a tag it
# does not publish.
ref_for_tag() {
  case "$1" in
    edge) printf 'main' ;;
    v*) [[ "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] && printf '%s' "$1" ;;
    sha-*) [[ "$1" =~ ^sha-([0-9a-f]{40})$ ]] && printf '%s' "${BASH_REMATCH[1]}" ;;
  esac
  return 0
}

base_for_tag() {
  local ref
  if [[ -n "$explicit_base" ]]; then
    printf '%s' "$explicit_base"
    return 0
  fi
  ref="$(ref_for_tag "$1")"
  [[ -n "$ref" ]] || fail "${IMAGE_TAG_VAR}=$1 is not a tag this repository publishes (edge, v<version> or sha-<commit>). Set one in .env, or set MYCELLIOS_DOWNLOAD_BASE to where its Compose files are."
  printf '%s/%s/%s' "$REPOSITORY_FILES" "$ref" "$REPOSITORY_COMPOSE_PATH"
}

# Whether an existing install runs the upstream images: .env names them, or names no app image
# while the Compose file it runs defaults to them.
runs_upstream_images() {
  local app
  [[ -e "$ENV_FILE" ]] || return 1
  app="$(env_value "$IMAGE_VAR")"
  is_upstream_image "$app" && return 0
  is_upstream_image "$(env_value "$COMPUTER_IMAGE_VAR")" && return 0
  [[ -z "$app" && -f "$COMPOSE_FILE" ]] && grep -qF "$UPSTREAM_IMAGES" "$COMPOSE_FILE"
}

# Moves an install off the upstream images to this repository's, at target_tag. The new Compose
# file, the image pull and the migration check all happen before anything is replaced; a database
# that records a migration the release does not ship refuses the move and changes nothing.
move_to_repository_images() {
  local compose_next env_next current_name next_name status wait_args=()
  local overrides=("${IMAGE_VAR}=${APP_IMAGE}" "${IMAGE_TAG_VAR}=${target_tag}"
    "${COMPUTER_IMAGE_VAR}=${COMPUTER_IMAGE}" "${COMPUTER_IMAGE_TAG_VAR}=${target_tag}")
  echo "Moving this install to ${APP_IMAGE}:${target_tag}."
  compose_next=$(mktemp "./${COMPOSE_FILE}.next.XXXXXX")
  env_next=$(mktemp "./${ENV_EXAMPLE}.next.XXXXXX")
  move_files=("$compose_next" "$env_next")
  download "$COMPOSE_FILE" "$compose_next"
  download "$ENV_EXAMPLE" "$env_next"
  # Another project name would start an empty database beside the current one.
  current_name="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config 2>/dev/null |
    awk '/^name: / { print $2; exit }' || true)"
  next_name="$(env "${overrides[@]}" docker compose --env-file "$ENV_FILE" -f "$compose_next" config 2>/dev/null |
    awk '/^name: / { print $2; exit }' || true)"
  if [[ -n "$current_name" && -n "$next_name" && "$current_name" != "$next_name" ]]; then
    fail "the move was refused: this install's Compose project is ${current_name}, and the new Compose file names ${next_name}. Nothing was changed."
  fi
  env "${overrides[@]}" docker compose --env-file "$ENV_FILE" -f "$compose_next" pull api ||
    fail "could not pull ${APP_IMAGE}:${target_tag}. Nothing was changed."
  if docker compose up --help 2>/dev/null | grep -q -- '--wait-timeout'; then
    wait_args=(--wait --wait-timeout 120)
  fi
  env "${overrides[@]}" docker compose --env-file "$ENV_FILE" -f "$compose_next" \
    up -d ${wait_args[@]+"${wait_args[@]}"} postgres ||
    fail "could not start the database to check it before the move. Nothing was changed."
  echo "Checking the database for migrations this release does not ship."
  status=0
  env "${overrides[@]}" docker compose --env-file "$ENV_FILE" -f "$compose_next" \
    run --rm --no-deps -T api node "$MIGRATION_CHECK" || status=$?
  if ((status == MIGRATIONS_UNKNOWN)); then
    fail "the move was refused: the database records migrations this release does not ship (listed above), so a newer or different release migrated it. This install keeps its images and files; nothing was changed."
  elif ((status != 0)); then
    fail "the move was refused: the database's migrations could not be checked. This install keeps its images and files; nothing was changed."
  fi
  mv -- "$compose_next" "$COMPOSE_FILE"
  mv -- "$env_next" "$ENV_EXAMPLE"
  move_files=()
  set_env_values "${overrides[@]}"
  echo "Moved to ${APP_IMAGE}:${target_tag}. The previous images stay in the local Docker cache."
}

create_env() {
  local generated_encryption_key=false
  umask 077
  temporary_file=$(mktemp "./${ENV_FILE}.tmp.XXXXXX")

  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      "POSTGRES_PASSWORD=")
        printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 16)"
        ;;
      "POSTGRES_APP_PASSWORD=")
        printf 'POSTGRES_APP_PASSWORD=%s\n' "$(openssl rand -hex 16)"
        ;;
      "BETTER_AUTH_SECRET=")
        printf 'BETTER_AUTH_SECRET=%s\n' "$(openssl rand -hex 32)"
        ;;
      "ENCRYPTION_KEY=")
        printf 'ENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)"
        generated_encryption_key=true
        ;;
      "SCREEN_PROXY_SECRET=")
        printf 'SCREEN_PROXY_SECRET=%s\n' "$(openssl rand -hex 32)"
        ;;
      "SANDBOX_SUPERVISOR_TOKEN=")
        printf 'SANDBOX_SUPERVISOR_TOKEN=%s\n' "$(openssl rand -hex 32)"
        ;;
      *)
        printf '%s\n' "$line"
        ;;
    esac
  done < "$ENV_EXAMPLE" > "$temporary_file"

  chmod 600 "$temporary_file"
  mv -- "$temporary_file" "$ENV_FILE"
  temporary_file=""
  echo "Created .env with random secrets."
  # Name the variable and file only: the key itself never reaches the terminal or its logs.
  if [[ "$generated_encryption_key" == true ]]; then
    echo "Back up ENCRYPTION_KEY from ${PWD}/${ENV_FILE}. Encrypted content cannot be recovered without it."
  fi
}

# Secrets added after a .env was created. Append them so an upgrade still starts,
# leaving every existing line untouched.
add_missing_secrets() {
  if ! grep -Eq '^POSTGRES_APP_PASSWORD=[^[:space:]]' "$ENV_FILE"; then
    [[ ! -s "$ENV_FILE" || -z "$(tail -c 1 "$ENV_FILE")" ]] || printf '\n' >> "$ENV_FILE"
    printf 'POSTGRES_APP_PASSWORD=%s\n' "$(openssl rand -hex 16)" >> "$ENV_FILE"
    echo "Added POSTGRES_APP_PASSWORD to .env."
  fi
}

validate_required_secrets() {
  if ! docker compose --env-file "$ENV_FILE" "${compose_files[@]}" -f - config --environment <<'YAML' | awk '
    BEGIN {
      required["POSTGRES_PASSWORD"] = 1
      required["POSTGRES_APP_PASSWORD"] = 1
      required["BETTER_AUTH_SECRET"] = 1
      required["ENCRYPTION_KEY"] = 1
      required["SCREEN_PROXY_SECRET"] = 1
      required["SANDBOX_SUPERVISOR_TOKEN"] = 1
    }
    {
      name = $0
      sub(/=.*/, "", name)
      if (!(name in required)) next
      seen[name]++

      value = $0
      sub(/^[^=]*=/, "", value)
      gsub(/[[:space:]]/, "", value)
      if (value != "") nonempty[name]++
    }
    END {
      for (name in required) {
        if (seen[name] != 1 || nonempty[name] != 1) exit 1
      }
    }
  '
services:
  api:
    environment:
      _RAKAZO_VALIDATE_POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
      _RAKAZO_VALIDATE_POSTGRES_APP_PASSWORD: ${POSTGRES_APP_PASSWORD:?Set POSTGRES_APP_PASSWORD in .env}
      _RAKAZO_VALIDATE_BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:?Set BETTER_AUTH_SECRET in .env}
      _RAKAZO_VALIDATE_ENCRYPTION_KEY: ${ENCRYPTION_KEY:?Set ENCRYPTION_KEY in .env}
      _RAKAZO_VALIDATE_SCREEN_PROXY_SECRET: ${SCREEN_PROXY_SECRET:?Set SCREEN_PROXY_SECRET in .env}
      _RAKAZO_VALIDATE_SANDBOX_SUPERVISOR_TOKEN: ${SANDBOX_SUPERVISOR_TOKEN:?Set SANDBOX_SUPERVISOR_TOKEN in .env}
YAML
  then
    fail "set every required secret in .env to a non-empty value."
  fi
}

# The Compose file passes each container only the settings it names. Say which .env settings it
# does not name, such as TELEGRAM_BOT_TOKEN_<NAME>, rather than let an upgrade drop them silently.
warn_unpassed_settings() {
  local key unpassed=""
  while IFS= read -r key; do
    [[ "$key" == COMPOSE_* || "$key" == "$MOVE_KEY" ]] || grep -qw -e "$key" "$COMPOSE_FILE" ${override_present:+"$OVERRIDE_FILE"} || unpassed+=" $key"
  done < <(sed -nE 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=.*/\2/p' "$ENV_FILE" | sort -u)
  [[ -n "$unpassed" ]] || return 0
  echo "Warning: no container receives these .env settings:${unpassed}." >&2
  echo "List them in an override file; see Settings with names you choose in docs/self-host.md." >&2
}

# Why this host cannot take the restricted-egress firewall rules; empty when it can.
egress_rules_unsupported() {
  local os security
  [[ "$(uname -s)" == Linux ]] || { echo "Docker runs in a VM on this OS"; return; }
  os=$(docker info --format '{{.OperatingSystem}}' 2>/dev/null) || { echo "docker info failed"; return; }
  [[ "$os" != *"Docker Desktop"* ]] || { echo "Docker Desktop keeps its networks in a VM"; return; }
  security=$(docker info --format '{{json .SecurityOptions}}' 2>/dev/null) || security=""
  [[ "$security" != *rootless* ]] || { echo "rootless Docker"; return; }
  command -v iptables >/dev/null 2>&1 || echo "iptables is not installed"
}

# Compose defaults computers to restricted egress, which only works once the host
# rules are in place. Install them where possible; otherwise record open explicitly
# so computers keep working, and say what that leaves reachable.
configure_computer_egress() {
  local reason
  # Compose takes the shell value over .env, so either one is the operator's choice.
  if [[ -n "${SANDBOX_COMPUTER_EGRESS:-}" ]] ||
    grep -Eq '^[[:space:]]*SANDBOX_COMPUTER_EGRESS=' "$ENV_FILE"; then
    return 0
  fi
  reason=$(egress_rules_unsupported)
  if [[ -z "$reason" ]] && ! (trap cleanup EXIT; download "$EGRESS_SCRIPT"); then
    reason="$EGRESS_SCRIPT could not be downloaded"
  fi
  if [[ -z "$reason" ]]; then
    echo "Restricting bot computer egress; installing host firewall rules needs root."
    if bash "./$EGRESS_SCRIPT"; then
      printf '\nSANDBOX_COMPUTER_EGRESS=restricted\n' >>"$ENV_FILE"
      return 0
    fi
    reason="the host firewall rules could not be installed"
  fi
  printf '\nSANDBOX_COMPUTER_EGRESS=open\n' >>"$ENV_FILE"
  echo "Warning: bot computers can reach this host, its LAN and cloud metadata ($reason)." >&2
  echo "See Restricted computer egress in docs/self-host.md." >&2
}

# An install that runs the upstream images keeps them, and the Compose files that match them,
# until its owner answers the move offer once (here, or with --move-images / --keep-images).
if runs_upstream_images; then
  recorded="$(env_value "$MOVE_KEY")"
  if [[ -z "$move_answer" && "$recorded" == declined ]]; then
    echo "Keeping the upstream images, as recorded in .env (${MOVE_KEY}=declined)."
  elif [[ -z "$move_answer" && "$offline" != true && -t 0 ]]; then
    echo "This install runs images of the project Mycellios Agent was imported from (${UPSTREAM_IMAGES})."
    echo "Moving to ${APP_IMAGE} checks the database first and changes nothing if it records a migration this repository does not ship."
    reply=""
    read -r -p "Move this install now? [y/N] " reply || reply=""
    case "$reply" in
      [yY] | [yY][eE][sS]) move_answer=move ;;
      *) move_answer=keep ;;
    esac
  elif [[ -z "$move_answer" ]]; then
    echo "This install keeps images of the project Mycellios Agent was imported from. Run with --move-images to move it to ${APP_IMAGE}, or --keep-images to keep them and stop this notice."
  fi
  if [[ "$move_answer" == move ]]; then
    [[ "$offline" != true ]] || fail "--offline cannot move to ${APP_IMAGE}; the move downloads it."
    add_missing_secrets
    target_tag="${release:-edge}"
    download_base="$(base_for_tag "$target_tag")"
    move_to_repository_images
    # The files the move put in place are the ones for target_tag.
    skip_existing=true
  else
    [[ -z "$release" ]] || fail "--release installs this repository's images, and this install keeps the upstream ones. Add --move-images to move it."
    if [[ "$move_answer" == keep && "$recorded" != declined ]]; then
      set_env_values "${MOVE_KEY}=declined"
      echo "Keeping the upstream images; .env records the answer so it is not asked again."
    fi
    keep_upstream=true
    skip_existing=true
  fi
else
  [[ "$move_answer" != move ]] || echo "This install already uses this repository's images."
  install_tag="${release:-$(env_value "$IMAGE_TAG_VAR")}"
  download_base="$(base_for_tag "${install_tag:-edge}")"
fi

for filename in "${required_files[@]}"; do
  download "$filename"
done

compose_files=(-f "$COMPOSE_FILE")
override_present=""
if [[ -f "$OVERRIDE_FILE" ]]; then
  compose_files+=(-f "$OVERRIDE_FILE")
  override_present=1
  echo "Using ${OVERRIDE_FILE}."
fi

if [[ -e "$ENV_FILE" ]]; then
  echo "Keeping existing .env."
  add_missing_secrets
else
  create_env
fi
if [[ -n "$release" ]]; then
  set_env_values "${IMAGE_TAG_VAR}=${release}" "${COMPUTER_IMAGE_TAG_VAR}=${release}"
fi

validate_required_secrets
warn_unpassed_settings

if [[ "$prepare_only" == true ]]; then
  echo "Mycellios files are ready. Edit .env, then run: bash install-images.sh"
  exit 0
fi

configure_computer_egress

prepare_proxy_env
if [[ "$pull_never" == true ]]; then
  echo "Skipping image pull (--pull-never / --offline); images must already be on this Docker host."
else
  if ! docker compose --env-file "$ENV_FILE" "${compose_files[@]}" pull; then
    fail "could not pull images. Shell HTTP_PROXY often does not reach the Docker daemon. Configure daemon proxy/registry-mirrors, set image env vars to a reachable registry, or preload images then compose up with --pull never."
  fi
fi
# `--wait` without `--wait-timeout` can hang on one-shot services (Compose < 2.7)
# or never return if a healthcheck stays red (Compose < 2.17). Prefer both flags.
compose_up_help=$(docker compose up --help 2>/dev/null || true)
up_pull_args=()
if [[ "$pull_never" == true ]]; then
  if grep -q -- '--pull' <<<"$compose_up_help"; then
    up_pull_args=(--pull never)
  else
    echo "cannot enforce pull-never on this Compose version; startup fails if an image is missing locally" >&2
  fi
fi
# bash 3.2 + set -u: "${arr[@]}" aborts when arr is empty.
if grep -q -- '--wait-timeout' <<<"$compose_up_help"; then
  echo "Waiting for healthy services."
  docker compose --env-file "$ENV_FILE" "${compose_files[@]}" up -d ${up_pull_args[@]+"${up_pull_args[@]}"} --wait --wait-timeout 300
else
  docker compose --env-file "$ENV_FILE" "${compose_files[@]}" up -d ${up_pull_args[@]+"${up_pull_args[@]}"}
fi

echo "Mycellios is starting at http://127.0.0.1:5173"
