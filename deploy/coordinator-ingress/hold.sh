#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 4 || ! -d "$2" ]]; then
    echo 'usage: hold.sh hold|release STATE_DIRECTORY OPERATION_ID EXPECTED_SHA' >&2
    exit 2
fi

exec flock -x -w 30 "$2/.switch.lock" node "$(dirname "$0")/hold.mjs" "$@"
