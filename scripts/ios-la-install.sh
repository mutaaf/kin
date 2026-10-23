#!/bin/sh
# Install (or re-verify) KIN's Live Activity into an Xcode project. Idempotent.
# Uses the xcodeproj gem that ships with Homebrew's CocoaPods (no extra install needed).
#   sh scripts/ios-la-install.sh                       # the Capacitor app (default)
#   sh scripts/ios-la-install.sh --project <export>/Unity-iPhone.xcodeproj --app-target Unity-iPhone \
#      --native-target UnityFramework --bridge unity --copy
set -e
cd "$(dirname "$0")/.."
GEMS=$(ls -d /opt/homebrew/Cellar/cocoapods/*/libexec 2>/dev/null | tail -1)
[ -n "$GEMS" ] || { echo "Needs Homebrew CocoaPods (brew install cocoapods) for the xcodeproj gem"; exit 1; }
if [ $# -eq 0 ]; then
  set -- --project ios/App/App.xcodeproj --app-target App --bridge capacitor
fi
GEM_HOME="$GEMS" ruby scripts/ios-la-install.rb "$@"
