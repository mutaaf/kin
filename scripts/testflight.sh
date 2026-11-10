#!/bin/sh
# Archive KIN for iPhone + iPad and upload it to TestFlight in one command, headless.
#
# One-time setup (see docs/TESTFLIGHT.md):
#   1. App record exists: "KIN: A Tiny Friend" (app id 6833212718, bundle id com.mutaafaziz.kin; the store
#      already had a "KIN", the in-app name stays KIN). Widgets: com.mutaafaziz.kin.widgets, App Group
#      group.com.mutaafaziz.kin (registered and assigned on developer.apple.com).
#   2. Users and Access → Integrations → App Store Connect API → a key with "App Manager" role (shared with Moon Club)
#   3. Put these in kin/.env.testflight (gitignored):
#        TEAM_ID=XXXXXXXXXX          # developer.apple.com → Membership
#        ASC_KEY_ID=XXXXXXXXXX
#        ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
#        ASC_KEY_PATH=$HOME/.appstoreconnect/private_keys/AuthKey_XXXXXXXXXX.p8
# Then: npm run testflight
# Uploads go to the internal group "KIN Crew" only (scripts/asc.mjs ship). No external testers, no Beta App Review.
set -e
cd "$(dirname "$0")/.."
[ -f .env.testflight ] && . ./.env.testflight
: "${TEAM_ID:?set TEAM_ID (see docs/TESTFLIGHT.md)}"
: "${ASC_KEY_ID:?set ASC_KEY_ID}"
: "${ASC_ISSUER_ID:?set ASC_ISSUER_ID}"
: "${ASC_KEY_PATH:?set ASC_KEY_PATH}"
[ -f "$ASC_KEY_PATH" ] || { echo "No API key at $ASC_KEY_PATH"; exit 1; }
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

# Every upload needs a unique, increasing build number; a UTC timestamp always is.
BUILD=$(date -u +%Y%m%d%H%M)
VERSION=$(node -p "require('./package.json').version")
# What's new for this version must exist (src/whatsnew/notes.ts) before anything is built.
node scripts/whats-new.mjs > /dev/null

npm run check
npm run build:native
npx cap sync ios
# The Live Activity extension (KINWidgets) must exist in the project; idempotent.
sh scripts/ios-add-widget.sh

node scripts/asc.mjs whoami
node scripts/asc.mjs capabilities
# App Manager keys can't use Xcode cloud signing, so distribution signing is ours: the shared Apple Distribution
# cert plus one App Store profile per bundle id (app + KINWidgets), both carrying the App Group.
node scripts/asc.mjs signing

AUTH="-allowProvisioningUpdates -authenticationKeyPath $ASC_KEY_PATH -authenticationKeyID $ASC_KEY_ID -authenticationKeyIssuerID $ASC_ISSUER_ID"
ARCHIVE=ios/build/KIN-$BUILD.xcarchive

# Archive with automatic (development) signing, then re-sign for the App Store on export with the profiles above.
# Command-line build settings apply to every target, so both get the same team and versions.
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic \
  CURRENT_PROJECT_VERSION="$BUILD" MARKETING_VERSION="$VERSION" \
  $AUTH -quiet archive
V=$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleShortVersionString' "$ARCHIVE/Info.plist")
[ "$V" = "$VERSION" ] || { echo "Archive is version $V, expected $VERSION"; exit 1; }

sed "s/__TEAM_ID__/$TEAM_ID/" ios/ExportOptions.plist > ios/build/ExportOptions.plist
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist ios/build/ExportOptions.plist \
  -exportPath ios/build/export $AUTH

echo "✓ KIN $VERSION ($BUILD) uploaded."
# Waits for processing, sets What to Test, and hands the build to the internal group "KIN Crew".
node scripts/asc.mjs ship "$BUILD"
echo
echo "What's New for App Store Connect (from src/whatsnew/notes.ts):"
node scripts/whats-new.mjs
