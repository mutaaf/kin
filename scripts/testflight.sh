#!/bin/sh
# Archive KIN for iPhone + iPad and upload it to TestFlight in one command, headless.
#
# One-time setup (see docs/TESTFLIGHT.md):
#   1. App Store Connect → Apps → "+" → New App: platform iOS, bundle id com.mutaafaziz.kin, name KIN
#   2. Users and Access → Integrations → App Store Connect API → generate a key with "App Manager" role
#   3. Put these in kin/.env.testflight (gitignored):
#        TEAM_ID=XXXXXXXXXX          # developer.apple.com → Membership
#        ASC_KEY_ID=XXXXXXXXXX
#        ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
#        ASC_KEY_PATH=$HOME/.appstoreconnect/private_keys/AuthKey_XXXXXXXXXX.p8
# Then: npm run testflight
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

npm run check
npm run build:native
npx cap sync ios

AUTH="-allowProvisioningUpdates -authenticationKeyPath $ASC_KEY_PATH -authenticationKeyID $ASC_KEY_ID -authenticationKeyIssuerID $ASC_ISSUER_ID"
ARCHIVE=ios/build/KIN-$BUILD.xcarchive

# Automatic signing: Xcode creates or fetches the distribution cert and profile through the API key.
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic \
  CURRENT_PROJECT_VERSION="$BUILD" MARKETING_VERSION="$VERSION" \
  $AUTH -quiet archive

sed "s/__TEAM_ID__/$TEAM_ID/" ios/ExportOptions.plist > ios/build/ExportOptions.plist
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist ios/build/ExportOptions.plist \
  -exportPath ios/build/export $AUTH

echo "✓ KIN $VERSION ($BUILD) uploaded. It appears in TestFlight after Apple's processing (~5–20 min)."
