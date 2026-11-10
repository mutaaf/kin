# Shipping KIN to TestFlight

Ready in the repo: iPhone + iPad target (`TARGETED_DEVICE_FAMILY = 1,2`), bundle id
`com.mutaafaziz.kin`, an app icon rendered from the real procedural creature (`npm run icons`),
a graphite launch screen, a privacy manifest (no tracking, no data collected),
`ITSAppUsesNonExemptEncryption = false` (skips the export-compliance prompt), a location usage
string (used only if Precise sky is turned on), and a one-command archive and upload.

## One-time (about 5 minutes, in a browser)
1. **App record.** Done: **KIN: A Tiny Friend** (app id 6833212718, bundle ID `com.mutaafaziz.kin`).
   The store already had an app called "KIN", so the store name differs; the in-app name stays KIN.
   `com.mutaafaziz.kin.widgets` is registered too, and both carry the App Group
   `group.com.mutaafaziz.kin` (registered on developer.apple.com; the API has no App Groups endpoint).
2. **API key.** App Store Connect → Users and Access → Integrations → App Store Connect API →
   **Generate**, role **App Manager** (KIN shares Moon Club's key; copy its `.env.testflight`). Download the `.p8` (you only get one chance) to
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
This runs the checks, builds the native bundle, makes App Store signing with `scripts/asc.mjs signing`
(the shared Apple Distribution cert plus the "KIN App Store" and "KIN Widgets App Store" profiles; App
Manager keys can't use Xcode cloud signing), archives, checks the archive carries package.json's version,
uploads, then `scripts/asc.mjs ship` waits for processing, sets What to Test from `src/whatsnew/notes.ts`
and hands the build to the internal group **KIN Crew** (every team member). Build numbers are UTC
timestamps, so they always increase.

## After upload
- **Internal testers** ("KIN Crew", up to 100 people on your team) can install as soon as processing finishes.
  The script never creates an external group, a public link or a Beta App Review submission.
- **External testers** need one Beta App Review. Suggested "What to test": *Hatch your KIN, pet it,
  then put two devices side by side and slide one finger from one screen onto the other to link
  them. Tap Gather → Visit to watch it cross.*
- Privacy questionnaire answer: **Data Not Collected**.

## Known gaps before App Store (not TestFlight) release
Screenshots, marketing copy and age rating. A legal/kids review is needed if KIN is ever marketed
to under-13s (COPPA).
