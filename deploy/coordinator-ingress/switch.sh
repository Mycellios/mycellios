#!/usr/bin/env bash
set -euo pipefail

if [[ $# == 3 && "$1" == "--observe" && -d "$3" ]]; then
    exec flock -s -w 30 "$3/.switch.lock" node "$(dirname "$0")/switch.mjs" "$@"
fi

if [[ $# != 5 || ! -d "$2" ]]; then
    echo 'usage: switch.sh GATEWAY STATE_DIRECTORY OPERATION_ID PREVIOUS_SHA CANDIDATE_SHA' >&2
    exit 2
fi

exec flock -x -w 30 "$2/.switch.lock" node "$(dirname "$0")/switch.mjs" "$@"
