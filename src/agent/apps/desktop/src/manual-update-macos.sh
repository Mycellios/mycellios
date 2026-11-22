#!/bin/bash
# Replace this user's Mycellios.app with the verified disk image and reopen it,
# like the Windows update. Desktop has already checked the
# image's size and SHA-256 against the official catalog and stays open until
# this helper acknowledges. Never touches quarantine, Gatekeeper or the profile.
# Usage: manual-update-macos.sh <job> <old-pid> <dmg> <bundle> <version> <bundle-id>
set -u
job=$1 old_pid=$2 dmg=$3 bundle=$4 version=$5 bundle_id=$6
mount="$job/mount"
staged="$bundle.updating"
previous="$bundle.previous"
mounted=0 swapped=0

progress() { printf '{"phase":"%s"}\n' "$1" > "$job/progress.json.tmp" && mv -f "$job/progress.json.tmp" "$job/progress.json"; }
result() { printf '%s\n' "$1" > "$job/result.json.tmp" && mv -f "$job/result.json.tmp" "$job/result.json"; }
cleanup() {
  if [ "$mounted" = 1 ]; then /usr/bin/hdiutil detach "$mount" -quiet || /usr/bin/hdiutil detach "$mount" -force -quiet; fi
  rm -rf "$staged"
}
fail() {
  # Put the previous app back if it was already moved aside, then reopen it so the
  # owner is never left without Mycellios.
  if [ "$swapped" = 1 ] && [ -d "$previous" ]; then rm -rf "$bundle" && mv "$previous" "$bundle"; fi
  cleanup
  result "{\"installed\":false,\"phase\":\"$phase\",\"error\":\"$1\"}"
  [ "$phase" = "preflight" ] || /usr/bin/open "$bundle"
  exit 1
}

phase=preflight
case "$bundle" in /*.app) ;; *) fail "Invalid application path" ;; esac
case "$bundle" in */AppTranslocation/*) fail "Translocated application" ;; esac
[ -f "$dmg" ] || fail "Missing disk image"
[ -e "$staged" ] && rm -rf "$staged"
[ -e "$previous" ] && rm -rf "$previous"
progress waiting-for-app

# Desktop quits once it reads the acknowledgement above.
phase=waiting-for-app
for _ in $(seq 1 1200); do kill -0 "$old_pid" 2>/dev/null || break; sleep 0.25; done
kill -0 "$old_pid" 2>/dev/null && fail "The previous app has not finished saving"

phase=installing
progress installing
mkdir -p "$mount" || fail "Could not prepare the disk image"
/usr/bin/hdiutil attach "$dmg" -nobrowse -readonly -noautoopen -mountpoint "$mount" -quiet || fail "Could not open the disk image"
mounted=1
source_app=""
for candidate in "$mount"/*.app; do
  [ -d "$candidate" ] || continue
  [ -z "$source_app" ] || fail "The disk image contains more than one app"
  source_app=$candidate
done
[ -n "$source_app" ] || fail "The disk image contains no app"
info="$source_app/Contents/Info.plist"
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$info" 2>/dev/null)" = "$bundle_id" ] || fail "The disk image holds another app"
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$info" 2>/dev/null)" = "$version" ] || fail "The disk image holds another version"
# Ad-hoc integrity of every nested binary; this is not notarization.
/usr/bin/codesign --verify --deep --strict "$source_app" 2>/dev/null || fail "The app signature is invalid"
/usr/bin/ditto "$source_app" "$staged" || fail "Could not copy the new app"
/usr/bin/hdiutil detach "$mount" -quiet || /usr/bin/hdiutil detach "$mount" -force -quiet
mounted=0
/usr/bin/codesign --verify --deep --strict "$staged" 2>/dev/null || fail "The copied app signature is invalid"

mv "$bundle" "$previous" || fail "Could not move the previous app"
swapped=1
mv "$staged" "$bundle" || fail "Could not place the new app"

phase=reopening
progress reopening
/usr/bin/open "$bundle" || fail "Could not open the new app"
swapped=0
rm -rf "$previous"
result "{\"installed\":true,\"version\":\"$version\"}"
exit 0
