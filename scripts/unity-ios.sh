#!/bin/sh
# MyKin (Unity) → iPhone in one command: Unity iOS export (with the Live Activity installed by the
# post-process), signed xcodebuild, install + launch on a paired device.
#   sh scripts/unity-ios.sh            (first paired physical device)
#   DEVICE=<udid> TEAM_ID=<team> SKIP_UNITY=1 sh scripts/unity-ios.sh
set -e
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
TEAM_ID="${TEAM_ID:-Z73865R687}"
DEVICE="${DEVICE:-$(xcrun devicectl list devices 2>/dev/null | awk '/available \(paired\)/ && /physical/ {for (i=1;i<=NF;i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/) {print $i; exit}}')}"

if [ "${SKIP_UNITY:-0}" != "1" ]; then
  sh scripts/unity-batch.sh /tmp/mykin-ios-export.log -executeMethod KinBuild.iOS
fi
PROJ=unity/MyKin/Build/iOS/Unity-iPhone.xcodeproj
[ -d "$PROJ" ] || { echo "No Xcode export at $PROJ"; exit 1; }

DEST="generic/platform=iOS"
[ -n "$DEVICE" ] && DEST="id=$DEVICE"
build() {
  xcodebuild -project "$PROJ" -scheme Unity-iPhone -configuration Release -destination "$DEST" \
    -derivedDataPath unity/MyKin/Build/iOSDerived DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic \
    -allowProvisioningUpdates -quiet "$@" build
}
# The App Group needs a one-time registration on Apple's side; until then sign without it (the
# Live Activity then uses its bundled portrait). Same fallback as scripts/ios-device.sh.
build 2>/tmp/mykin-xcode.log || { echo "App Group not registered yet: building without it."; build CODE_SIGN_ENTITLEMENTS= ; }
APP=unity/MyKin/Build/iOSDerived/Build/Products/Release-iphoneos/MyKin.app
[ -d "$APP" ] || APP=$(ls -d unity/MyKin/Build/iOSDerived/Build/Products/Release-iphoneos/*.app | head -1)
echo "Built $APP"
if [ -z "$DEVICE" ]; then echo "No paired device available: built only."; exit 0; fi
xcrun devicectl device install app --device "$DEVICE" "$APP"
xcrun devicectl device process launch --device "$DEVICE" com.mutaafaziz.kin
echo "✓ MyKin (Unity) is on your device."
