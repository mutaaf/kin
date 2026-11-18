# App Privacy: the answers for App Store Connect

App Privacy (the "nutrition label") has no API. Set it by hand in App Store Connect → KIN: A Tiny Friend → App Privacy,
then **Publish**. `node scripts/asc.mjs store-check` reminds you every time because it can't see it.

## Answer: Data Not Collected

Apple counts data as "collected" when it leaves the device and is kept longer than it takes to answer the request.
Nothing KIN sends is kept (checked 2026-11-18 against `src/worker/index.ts`, `src/env/sky.ts`, `src/ai/`):

| Request | Carries | Kept |
|---|---|---|
| Open-Meteo forecast (`src/env/sky.ts`) | the time zone city's coordinates, or a location rounded to ~11 km if Precise sky is on | nothing by us |
| Relay `wss://mutaafaziz.com/kin/api/lobby` | random device id, the visiting KIN's seed/name/colour/traits, stitch geometry | nothing (in memory while connected) |
| `POST /kin/api/think|ask|analyze|snack` | KIN context and the player's typed text | nothing; a rate-limit counter keyed by a hash of the IP and the hour, swept hourly |
| Own-key AI (Settings) | the same, sent through our Worker to the provider the player chose | by that provider, under the player's own account |

No account, no advertising identifier, no analytics SDK, no ads in the app (`src/landing/ads.ts` returns early on native).
`ios/App/App/PrivacyInfo.xcprivacy` says the same. If a build adds analytics (Box Office) or stores anything, change the
label and the manifest in the same submission, and update `privacy/index.html`.
