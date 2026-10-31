#!/bin/sh
# Invoked through polkit only after an explicit contribution request.
set -eu
umask 022
[ "$(id -u)" -eq 0 ] || exit 77
[ "$#" -eq 3 ] || exit 64
payload=$1
expected=$2
grant=$3
case "$expected" in *[!a-f0-9]*|'') exit 65;; esac
[ "${#expected}" -eq 64 ] || exit 65
[ -f "$payload" ] && [ ! -L "$payload" ] && [ -f "$grant" ] && [ ! -L "$grant" ] || exit 66
[ "$(wc -c < "$grant")" -le 4096 ] || exit 66
exec 9>/run/lock/mycellios-desktop-install.lock
flock -n 9 || exit 23
[ ! -e /etc/mycellios/node.json ] && [ ! -L /etc/mycellios/node.json ] || exit 22
actual=$(sha256sum -- "$payload")
[ "${actual%% *}" = "$expected" ] || exit 25
[ "$(uname -m)" = x86_64 ] || exit 26

root=/opt/mycellios
[ ! -L "$root" ] || exit 28
# The signed-in user grants enrollment separately. Never replace an existing node.
if [ ! -x "$root/bin/node" ] || [ ! -f "$root/app/node/install-main.js" ]; then
  [ ! -e "$root" ] && [ ! -L "$root" ] || exit 28
  staging=$(mktemp -d /opt/.mycellios-desktop-runtime.XXXXXXXX)
  trap 'rm -rf -- "$staging"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' HUP TERM
  # This is the original hash-pinned runtime payload, used as a data archive.
  # Fedora does not install a DEB or modify a Debian package database.
  ar p "$payload" control.tar.gz > "$staging/control.tar.gz"
  tar -xOf "$staging/control.tar.gz" ./control > "$staging/control"
  test "$(awk '/^Package: / {print $2}' "$staging/control")" = mycellios-node || exit 26
  test "$(awk '/^Architecture: / {print $2}' "$staging/control")" = amd64 || exit 26
  member=$(ar t "$payload" | awk '/^data\.tar\.(gz|xz|zst)$/ {print}')
  case "$member" in
    data.tar.gz) compression=-z;;
    data.tar.xz) compression=-J;;
    data.tar.zst) compression=--zstd;;
    *) exit 26;;
  esac
  ar p "$payload" "$member" > "$staging/$member"
  tar -x "$compression" -f "$staging/$member" -C "$staging" \
    --no-same-owner --no-same-permissions -- ./opt/mycellios
  [ -x "$staging/opt/mycellios/bin/node" ] || exit 26
  [ -f "$staging/opt/mycellios/app/node/install-main.js" ] || exit 26
  mv -T -- "$staging/opt/mycellios" "$root"
fi
[ ! -e /etc/mycellios/node.json ] && [ ! -L /etc/mycellios/node.json ] || exit 22
"$root/bin/node" "$root/app/node/install-main.js" --install-root "$root" --enrollment "$grant"
[ -f /etc/mycellios/node.json ] || exit 27
systemctl is-active --quiet mycellios-node.service
script_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
/bin/sh "$script_root/describe-runtime.sh"
