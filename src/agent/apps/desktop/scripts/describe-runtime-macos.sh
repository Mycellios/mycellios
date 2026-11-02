#!/bin/sh
set -eu
[ "$(id -u)" -eq 0 ] || exit 77
[ "$(uname -s)" = Darwin ] || exit 26
[ "$#" -eq 0 ] || exit 64
script_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
exec '/Library/Application Support/Mycellios/Product/bin/node' "$script_root/runtime-public-status.cjs"
