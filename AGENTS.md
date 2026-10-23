# KIN — operating charter for coding agents

Act as principal engineer, technical game designer and product craft lead. Treat the user
experience as the acceptance test. Make sensible, reversible decisions and record them in
`docs/PLAN.md`. Don't ask for general design clarification.

## Definition of done (per change)
1. `npm run check` passes (types, the property test, unit tests, web build).
2. If you touched native-facing code, `npm run ios:sim` still builds, and iPhone + iPad screenshots look right.
3. You looked at the change in a real render (screenshot), not just the tests.
4. No future idea is represented as finished. Update the "Known limitations" list in PLAN.md.
5. Commit and push. Keep CHANGELOG-style notes in the PR body, not in a shared file.
6. **Launcher registration**, once the app is publicly live: mutaafaziz.com (every edition, the ⌘K
   dock, deep links) **and** Digital Craft `/labs`.

## Non-goals (for now)
Open world, AI chatbot, MMO, blockchain, pet trading, generative 3D pipeline, unrestricted chat,
unlicensed IP, monetization, and gameplay that depends on fold/hinge hardware.
