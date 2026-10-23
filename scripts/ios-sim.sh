#!/bin/sh
# Build KIN for the iOS simulator and launch it on an iPhone and an iPad, side by side.
# Usage: npm run ios:sim [-- "iPhone 15 Pro" "iPad Pro 11-inch (M4)"]
set -e
cd "$(dirname "$0")/.."
PHONE="${1:-iPhone 15 Pro}"
PAD="${2:-iPad Pro 11-inch (M4)}"
# Xcode must be the active developer dir (CommandLineTools can't build iOS apps).
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
npm run build:native
npx cap sync ios
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/build -quiet build
APP=$(find ios/build/Build/Products/Debug-iphonesimulator -maxdepth 1 -name '*.app' | head -1)
for DEV in "$PHONE" "$PAD"; do
  xcrun simctl boot "$DEV" 2>/dev/null || true
  xcrun simctl install "$DEV" "$APP"
  xcrun simctl terminate "$DEV" com.mutaafaziz.kin 2>/dev/null || true
  xcrun simctl launch "$DEV" com.mutaafaziz.kin >/dev/null
done
open -b com.apple.iphonesimulator || true
echo "KIN running on: $PHONE, $PAD"
