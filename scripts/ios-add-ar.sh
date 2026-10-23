#!/bin/sh
# Add (or re-verify) KIN's AR sources in the Xcode project. Idempotent.
set -e
cd "$(dirname "$0")/.."
GEMS=$(ls -d /opt/homebrew/Cellar/cocoapods/*/libexec 2>/dev/null | tail -1)
[ -n "$GEMS" ] || { echo "Needs Homebrew CocoaPods (brew install cocoapods) for the xcodeproj gem"; exit 1; }
GEM_HOME="$GEMS" ruby scripts/ios-add-ar.rb
