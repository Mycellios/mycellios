#!/bin/sh
# Invoked through the native macOS administrator prompt after explicit pairing.
set -eu
[ "$(id -u)" -eq 0 ] || exit 77
[ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] || exit 26
[ "$#" -eq 3 ] || exit 64
pkg=$1
expected=$2
grant=$3
case "$expected" in *[!a-f0-9]*|'') exit 65;; esac
[ "${#expected}" -eq 64 ] || exit 65
[ -f "$pkg" ] && [ ! -L "$pkg" ] && [ -f "$grant" ] && [ ! -L "$grant" ] || exit 66
[ "$(wc -c < "$grant")" -le 4096 ] || exit 66
root='/Library/Application Support/Mycellios/Product'
config='/Library/Application Support/Mycellios/Configuration/node.json'
# Root-owned global lock: concurrent installers never create a second identity.
lock='/var/run/io.mycellios.desktop-install.lock'
/usr/bin/shlock -p "$$" -f "$lock" || exit 23
trap '/bin/rm -f "$lock"' EXIT HUP INT TERM
[ ! -e "$config" ] && [ ! -L "$config" ] || exit 22
actual=$(/usr/bin/shasum -a 256 "$pkg")
[ "${actual%% *}" = "$expected" ] || exit 25
# Reuse an already installed runtime. Desktop does not downgrade it.
if [ ! -x "$root/bin/node" ] || [ ! -f "$root/app/node/install-main.js" ]; then
  /usr/sbin/installer -pkg "$pkg" -target / >/dev/null
fi
[ ! -e "$config" ] && [ ! -L "$config" ] || exit 22
"$root/bin/node" "$root/app/node/install-main.js" --install-root "$root" --enrollment "$grant" >/dev/null
[ -f "$config" ] || exit 27
/bin/launchctl print system/io.mycellios.node >/dev/null
script_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
/bin/sh "$script_root/describe-runtime-macos.sh"
