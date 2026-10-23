# Shipping KIN to TestFlight

Ready in the repo: iPhone + iPad target (`TARGETED_DEVICE_FAMILY = 1,2`), bundle id
`com.mutaafaziz.kin`, an app icon rendered from the real procedural creature (`npm run icons`),
a graphite launch screen, a privacy manifest (no tracking, no data collected),
`ITSAppUsesNonExemptEncryption = false` (skips the export-compliance prompt), a location usage
string (used only if Precise sky is turned on), and a one-command archive and upload.

## One-time (about 5 minutes, in a browser)
1. **App record.** App Store Connect → Apps → **+** → New App → iOS, name **KIN**, bundle ID
   `com.mutaafaziz.kin` (register it at developer.apple.com → Identifiers if it isn't listed),
   SKU `kin`.
2. **API key.** App Store Connect → Users and Access → Integrations → App Store Connect API →
   **Generate**, role **App Manager**. Download the `.p8` (you only get one chance) to
   `~/.appstoreconnect/private_keys/`.
3. **Team ID.** developer.apple.com → Account → Membership details.
4. Create `kin/.env.testflight` (gitignored):
   ```sh
   TEAM_ID=XXXXXXXXXX
   ASC_KEY_ID=XXXXXXXXXX
   ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   ASC_KEY_PATH=$HOME/.appstoreconnect/private_keys/AuthKey_XXXXXXXXXX.p8
   ```

## Every release
```sh
npm run testflight
```
This runs the checks, builds the native bundle, archives with automatic signing (Xcode creates
the distribution certificate and profile through the API key), and uploads. Build numbers are UTC
timestamps, so they always increase.

## After upload
- **Internal testers** (up to 100 people on your team) can install as soon as processing finishes.
- **External testers** need one Beta App Review. Suggested "What to test": *Hatch your KIN, pet it,
  then put two devices side by side and slide one finger from one screen onto the other to link
  them. Tap Gather → Visit to watch it cross.*
- Privacy questionnaire answer: **Data Not Collected**.

## Known gaps before App Store (not TestFlight) release
Screenshots, marketing copy and age rating. A legal/kids review is needed if KIN is ever marketed
to under-13s (COPPA).
