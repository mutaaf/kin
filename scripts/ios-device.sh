#!/bin/sh
# Build KIN (app + Live Activity widget) and install it on a paired iPhone/iPad over USB or Wi-Fi.
# Usage: npm run ios:device            (first paired physical device)
#        DEVICE=<udid> TEAM_ID=<team> npm run ios:device
set -e
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
TEAM_ID="${TEAM_ID:-Z73865R687}"   # the paid team (Apple Development: Mutaaf Aziz)
DEVICE="${DEVICE:-$(xcrun devicectl list devices 2>/dev/null | awk '/available \(paired\)/ && /physical/ {for (i=1;i<=NF;i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/) {print $i; exit}}')}"
[ -n "$DEVICE" ] || { echo "No paired device available. Unlock the phone, connect it (or same Wi-Fi), and trust this Mac."; exit 1; }

npm run build:native
npx cap sync ios

# The App Group (shared portrait for the Live Activity) needs a one-time registration on Apple's
# side (Xcode > App target > Signing & Capabilities, or the TestFlight API key). Until then the
# build signs without it and the Live Activity shows the bundled hero portrait instead of the user's own creature; everything else works.
ENT=""
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -destination "id=$DEVICE" \
  -derivedDataPath ios/build/device DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic \
  -allowProvisioningUpdates -quiet build 2>/dev/null || {
  echo "App Group not registered yet: building without it (the Live Activity shows the bundled portrait)."
  ENT="CODE_SIGN_ENTITLEMENTS="
  xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -destination "id=$DEVICE" \
    -derivedDataPath ios/build/device DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic $ENT \
    -allowProvisioningUpdates -quiet build
}
xcrun devicectl device install app --device "$DEVICE" ios/build/device/Build/Products/Release-iphoneos/App.app
xcrun devicectl device process launch --device "$DEVICE" com.mutaafaziz.kin
echo "✓ KIN is on your device."
