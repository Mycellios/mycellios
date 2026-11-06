#!/usr/bin/env bash
# Run in the locked Node 24/JDK 17 Android build environment, from the repository root.
# Signing is intentionally separate: no private key enters the source/offload archive.
set -euo pipefail
: "${MYCELLIOS_SOURCE_TREE:?Set the exact Git source tree}"
[[ "$MYCELLIOS_SOURCE_TREE" =~ ^[a-f0-9]{40}$ ]]
export NODE_OPTIONS=--max-old-space-size=2048 GOMAXPROCS=2
export ANDROID_HOME=${ANDROID_HOME:-/pnpm-store/mycellios-android-sdk}
export ANDROID_SDK_ROOT="$ANDROID_HOME" GRADLE_USER_HOME=${GRADLE_USER_HOME:-/pnpm-store/mycellios-android-gradle}
ROOT="$PWD"
OUT="${MYCELLIOS_ANDROID_OUTPUT:-/pnpm-store/mycellios-android-release/$MYCELLIOS_SOURCE_TREE}"
export MYCELLIOS_ANDROID_RECEIPT="$OUT/build-receipt.json"
mkdir -p "$OUT"
test ! -e "$OUT/Mycellios-Android-1.0.0-unsigned.apk"
tar -czf "$OUT/source.tar.gz" --exclude=node_modules --exclude='*/node_modules' --exclude=.git --exclude='*/.gradle' --exclude='*/build' --exclude='*/dist' --exclude='./outputs' .
npm ci --ignore-scripts --no-audit --no-fund --cache /pnpm-store/npm-cache
node node_modules/vitest/vitest.mjs run landing/src/android-downloads.test.tsx landing/src/desktop-downloads.test.tsx --maxWorkers 2
npm run verify:structure
npm run verify:architecture
npm run verify:component-boundaries
node scripts/build-desktop-downloads.mjs
cp -r build/desktop-downloads/web "$OUT/downloads-web"
cd src/agent
npm ci --ignore-scripts --no-audit --no-fund --cache /pnpm-store/npm-cache
npm run generate --workspace @rakazo/db
node node_modules/typescript/bin/tsc --noEmit --incremental --tsBuildInfoFile /tmp/android-web.tsbuildinfo -p apps/web/tsconfig.json
node node_modules/vitest/vitest.mjs run apps/web/src/pages/shell/use-android-shortcut.test.tsx apps/web/src/lib/android-host.test.ts apps/web/src/lib/dictation.test.ts apps/web/src/pages/shell/use-voice-shortcut.test.tsx apps/web/src/pages/shell/reviewed-voice.test.tsx apps/web/src/pages/shell/composer.test.tsx --maxWorkers 2
APP_BASE_PATH=/agent/ npm run build --workspace @rakazo/web
mkdir -p apps/android/app/src/main/assets
mkdir -p apps/android/app/src/main/res/drawable
cp apps/web/public/mycellios/app-icon-v2-512.png apps/android/app/src/main/res/drawable/ic_mycellios.png
cp -r apps/web/dist apps/android/app/src/main/assets/web
node --input-type=module -e '
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
const base="apps/android/app/src/main/assets",root=base+"/web",files=[];
function walk(dir){for(const f of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,f.name);if(f.isDirectory())walk(p);else files.push(path.relative(root,p).replaceAll("\\", "/"));}}walk(root);
fs.writeFileSync(base+"/web-files.json",JSON.stringify(files));
const hashes=Object.fromEntries(files.sort().map(f=>[f,crypto.createHash("sha256").update(fs.readFileSync(root+"/"+f)).digest("hex")]));
fs.writeFileSync(process.env.MYCELLIOS_ANDROID_RECEIPT,JSON.stringify({schema:"mycellios-android-build/1",tree:process.env.MYCELLIOS_SOURCE_TREE,version:"1.0.0",versionCode:1,applicationId:"com.mycellios.android",minSdk:26,sharedWebFiles:hashes},null,2));'
cd "$ROOT/src/agent/apps/android"
GRADLE=/pnpm-store/mycellios-gradle-8.13/gradle-8.13/bin/gradle
if [ ! -x "$GRADLE" ]; then
  curl -fL --retry 2 https://downloads.gradle.org/distributions/gradle-8.13-bin.zip -o /tmp/mycellios-gradle.zip
  echo '20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed78  /tmp/mycellios-gradle.zip' | sha256sum -c -
  mkdir -p /pnpm-store/mycellios-gradle-8.13
  unzip -q /tmp/mycellios-gradle.zip -d /pnpm-store/mycellios-gradle-8.13
fi
"$GRADLE" testDebugUnitTest assembleRelease assembleDebug --no-daemon --build-cache --max-workers=2
cp app/build/outputs/apk/release/app-release-unsigned.apk "$OUT/Mycellios-Android-1.0.0-unsigned.apk"
cp app/build/outputs/apk/debug/app-debug.apk "$OUT/private-qualification.apk"
cp -r app/build/test-results "$OUT/native-test-results"
sha256sum "$OUT/Mycellios-Android-1.0.0-unsigned.apk"
