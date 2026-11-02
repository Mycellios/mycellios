#!/bin/sh
# Invoked by the native app through polkit after an explicit contribution click.
set -eu
[ "$(id -u)" -eq 0 ] || exit 77
[ "$#" -eq 3 ] || exit 64
deb=$1
expected=$2
grant=$3
case "$expected" in *[!a-f0-9]*|'') exit 65;; esac
[ "${#expected}" -eq 64 ] || exit 65
[ -f "$deb" ] && [ ! -L "$deb" ] && [ -f "$grant" ] && [ ! -L "$grant" ] || exit 66
[ "$(wc -c < "$grant")" -le 4096 ] || exit 66
exec 9>/run/lock/mycellios-desktop-install.lock
flock -n 9 || exit 23
[ ! -e /etc/mycellios/node.json ] && [ ! -L /etc/mycellios/node.json ] || exit 22
actual=$(sha256sum -- "$deb")
[ "${actual%% *}" = "$expected" ] || exit 25
[ "$(dpkg-deb -f "$deb" Package)" = mycellios-node ] || exit 26
[ "$(dpkg-deb -f "$deb" Architecture)" = amd64 ] || exit 26
[ "$(uname -m)" = x86_64 ] || exit 26
root=/opt/mycellios
# Reuse a newer unpaired runtime as well. Installing Desktop is not a downgrade.
if [ ! -x "$root/bin/node" ] || [ ! -f "$root/app/node/install-main.js" ]; then
  dpkg -i -- "$deb"
fi
[ ! -e /etc/mycellios/node.json ] && [ ! -L /etc/mycellios/node.json ] || exit 22
"$root/bin/node" "$root/app/node/install-main.js" --install-root "$root" --enrollment "$grant"
[ -f /etc/mycellios/node.json ] || exit 27
systemctl is-active --quiet mycellios-node.service
script_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
/bin/sh "$script_root/describe-runtime.sh"
