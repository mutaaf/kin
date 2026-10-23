# KIN — Living Worlds, Crossing Screens
## Master Product Vision & Autonomous Coding-Agent Build Packet
**Version:** 1.0 | **Date:** October 22, 2026 | **Stage:** Build blueprint, not shipping specification

> **THE MOMENT:** Place two phones side by side. Your tiny creature notices another world, pads toward the seam, glances back at you, hops off your screen and lands on your friend's screen. Two more devices join; their creatures gather, play, compete and remember each other. The experience is delightful whether the devices are iPhone, Android, tablet, foldable or web.

**North star:** A KIN isn't a pet trapped in an app. It is a persistent, portable, autonomous digital being whose identity, memories, skills, relationships and appearance survive changes of screen, device, world and network.

**To the coding agent:** Do not build a conventional dashboard or generic AI chat app. Deliver a magical, immediately playable *two-device crossing demo* first. Use small high-quality worlds, a beautiful creature and robust deterministic state. Do not build an MMO, a token economy, or open-ended LLM simulation before the crossing is convincing. Every feature must serve **bond → express → gather → compete → remember**.

## Product principles
1. **Three seconds to delight.** A live creature visible immediately; no signup wall.
2. **One meaningful input, one expressive response.** Pet, toss, invite, cross, cheer.
3. **Crossing is ceremony, not a loading screen.** Glance → intent → invite → edge alignment → synchronized movement → arrival → social reaction.
4. **Autonomy is observable.** A KIN independently chooses actions based on needs, personality, memories, context and safety constraints.
5. **Offline is real.** Solo works with radios off; camera-only encounters are possible where geometry allows; real-time nearby play needs a working optical/local wireless/LAN transport.
6. **One universe, multiple platforms.** iOS, Android and web share protocol, simulation, assets and account-independent local identity.
7. **Make social play opt-in.** Nearby discovery, visits, camera, name exposure and invitations require clear controls and consent.
8. **Monetize expression, never advantage.** No pay-to-win stats or manipulative care/death timers.
9. **Performance is a feature.** Crisp typography, restrained color, exceptionally smooth motion, modest power use.
10. **No proprietary IP.** Original creature silhouettes, worlds, cosmetics and naming; don't reuse Pokémon/Fortnite/Minecraft game assets without actual grants.

## Experience thesis
The app answers five questions a player feels rather than reads: **Who is my KIN?** **What can it do?** **Can it visit yours?** **Will it win?** **What did it remember?**

### The emotional product loop
Hatch → name → bond → care/play → learn → dress → cross to a gathering → surprise social behavior → party/sport/battle → return home with memory/earned expression → repeat.

### Audience and positioning
Families and kids with parental controls, teens who enjoy customization/collection, adults who want a cozy companion, friends who compete casually, streamers and event attendees. All onboarding and public social features must be age-appropriate. Do not assume users are children or that the service is safe for minors without compliance work.

## The flagship: KIN CROSS
**Trigger:** two devices placed edge-to-edge, each already in a shared encounter or invitation flow.

**Ten-beat directed sequence:**
1. Each local KIN detects a nearby invitation; player can allow, decline or restrict visits.
2. The games exchange *minimal* visitor state and agree on an encounter ID.
3. Each screen presents an edge guide. Players align devices roughly; no precise device-location tracking needed in MVP.
4. KIN turns its head toward the seam, notices the other character, chirps, and takes two careful steps.
5. Destination KIN reacts independently: eager, cautious, playful, aloof, based on its temperament and memories.
6. Source sends `cross.prepare` and destination confirms compatible assets, available capacity and ready-to-spawn.
7. Both agree on an absolute/relative presentation start using measured clock-offset approximation or acknowledgement barrier; a shared animation script takes over.
8. Source character exits past the chosen edge and disappears; destination spawns same unique KIN ID at opposing edge and continues arrival movement, shadow, squash/stretch and sound.
9. Destination acknowledges `cross.commit`; ownership remains with source, visit lease is time-bound. Source shows a postcard/return portal, never a duplicated independent pet.
10. On return/disconnect, creature goes home with a durable encounter memory; reconcile any local events when possible.

**Engineering truth:** These are *two local renders coordinated by messages*, not a sprite literally transported across glass. The illusion must be impeccable. Physical alignment can be manual initially. When devices are not physically adjacent, use a portal animation instead of pretending edges align.

**Failure paths:** source walks away, destination closes app, unexpected packet loss, capacity reached, permission denied, mismatched asset version, host migration. Never lose or duplicate a KIN; show graceful `cross.cancel`/`cross.return`, use an authoritative lease or owner as source of truth.

**Wow acceptance:** Two dissimilar phones on the same LAN show one visually continuous exit/entry with correct identity and skin, arrival reaction and return home. In 10 consecutive demonstrations there is no orphaned or permanently duplicated creature. Exact latency/performance targets must be measured on real devices.

## The pillars
### KIN HOME — the private, comforting space
An immediate micro-habitat (desk-sized diorama), petting response, sleep, play, idle routines, memories and decor. Initial world may be one beautiful prebuilt GLB from original/appropriately licensed assets. No infinite map. Keep personalized interactions meaningful without anxiety-inducing decay.

### KIN PARTY — gatherings and spontaneous group play
2–8 device initial target; later 10–30 or more with coordinator and interest management. Visitors arrive through individual edge/portal animations. Creatures can cluster, discover toys, dance, compete in spontaneous mini-games, share benign gestures, pose for group photos and form friendships or rivalries. Let users spectate or leave freely. Provide party roles, consent, capacity and host handoff.

### KIN ARENA / BATTLE — expressive, fair contests
Short, skill-influenced competitions: dodgeball, tug-of-orb, timing duels, obstacle navigation, capture-the-light. Avoid violence and RPG complexity as default. Owner trains abilities and picks a strategy; KIN autonomously executes bounded decisions. Server or local host owns deterministic scoring. Transparent outcomes; cosmetics do not affect power.

### KIN SPORTS — deep replayability
First sport: **KIN DASH**, a 20–45-second obstacle race; input: pre-race stance/strategy and one limited cheer/boost timing mechanic if desired. Train agility, composure, sprint and obstacle reading through simple mini-games. Future: KIN Hoops (2v2 arcade shot selection), Relay, Glider, Frisbee, Dance-Off, Parkour, trick trials. Equip jerseys, shoes, celebrations, team colors, flags and stadium themes. Add asynchronous ghosts, daily tracks and leagues. Training progression must be capped and understandable.

### KIN SOCIAL — friendships with memory
Consent-based meets, recurring recognition, friend/rival affinity, visits and photo memories. Creature-to-creature interactions aren't unrestricted AI conversations: structured intents such as `greet`, `invite`, `offer_toy`, `accept`, `decline`, `cheer`, `challenge`, `comfort`, `leave`, `trade_cosmetic_preview`. Avoid transmitting personal conversations or sensitive behavioral profiles. Shared memories require bilateral agreement or local-only storage.

### KIN STYLE / SKINS — visible individuality
Species archetype + body palette + surface material + ears/tail/horns + eye shapes + accessories + outfits + sports uniform + emote pack + walk cycle + victory celebration + habitat theme. Visible in arrival sequence and group photos. Layer cosmetics atop the same animation skeleton where possible; enforce silhouette and performance budgets. Keep acquisition and rarity claims transparent. No randomized paid loot for initial release.

### KIN AVATAR — owner's presence
Optional lightweight human-facing profile, badges, nickname, friend circle, style, stadium/team branding and accessibility preferences. Do **not** require an AI face scan or real name; support pseudonyms and private profiles. Avatar representation may start as a 2D card, progressing to stylized 3D later.

### KIN CLUB / CAMP / PARADE
Clubs coordinate private recurring events and sports teams. Camp is slower cooperative habitat play. Parade is cosmetic shows, judging, group photos and seasonal themes. These are later modes and should reuse the same encounter/session infrastructure.

## What makes the creature feel alive
Each KIN has immutable creature ID, species, genetic seed, traits, bounded drives (energy, curiosity, comfort, sociality), relationship memories, skill progression, current mood and an active goal. The behavior system observes world events, scores goals, selects a short plan and executes animation/action through a sandboxed ability vocabulary.

**Recommended decision stack:** deterministic utility AI / behavior tree (fast frequent decisions) + episodic structured memory + optional AI director for occasional surprise, novel safe micro-behaviors and reflection. No cloud inference every frame. No unrestricted agent tool calls. The brain must be testable without graphics or network.

**Example:** Lumi is curious (0.9), socially brave (0.6), low energy (0.3), and remembers Nox as a friendly competitor. At a party it may approach Nox, wave, invite a low-energy toy game, then choose to rest. Nox independently may accept or decline. Unscripted *selection* atop scripted/safe *actions* feels autonomous.

**Memory layers:** working memory (seconds), session episodic log (party actions), relationship summary (bounded), long-term stable preferences (carefully earned), player-visible scrapbook. Avoid falsely claiming the pet is conscious. Let owners reset/retrain personality influences and delete memories.

## Airplane / no-network promise
**Tier 0: radio silence, zero network.** Fully playable local creature, offline bundled maps/content, local mini-games, local saves. Optical QR-like introductions and turn-taking when one camera can see another screen; camera permission and positioning required. No invisible synchronized multiplayer without some physical channel.

**Tier 1: local network no internet.** Cross-device party via shared Wi-Fi LAN (including a travel router if allowed). Multiplatform web/native sessions with local host; discovery may require manual room code/QR and LAN-reachable server.

**Tier 2: permitted nearby radios, no internet.** Optional native peer transports on supported devices; feature-detect, never assume cross-platform universal support. Airplane policies and OS toggles apply.

**Tier 3: online.** Remote events, cloud backup, friends, clubs, matchmaking and global tournaments.

**Offline web limitations:** first installation and content pre-caching are required, HTTPS/PWA support varies, tab suspension can stop execution, camera permissions apply. Background life resumes from persisted timestamps and bounded elapsed-time simulation; not continuous execution in a suspended app.

## Design direction — Tesla restraint, creature warmth
Graphite #0B0D12; porcelain #F6F6F3; soft mint #6EE5CA; periwinkle #9EA8FF; sunset amber #E9AF6B. The world is softly tactile, 3D characters richly expressive; UI appears only when needed. Minimal HUD, thin labels, legible type, no generic neon gamer clutter. On-screen touch zones clear. The first screen is the creature itself. Cinematic but fast edge transfers, tasteful squash/stretch, eye-tracking, anticipation, overshoot and landing dust. Ambient audio subtle and instantly muteable. Haptics progressive enhancement only.

### Primary screens
1. **Home:** creature centered in miniature habitat, 0–3 contextual affordances, bottom icon rail appears after touch.
2. **Gather:** discover/scan/join + visible privacy controls, detected peers and party status.
3. **Crossing:** paired edge guides, readiness, synchronous departure/arrival animation.
4. **Party:** one scene with many creatures and emergent gestures; owner may highlight their KIN.
5. **Arena:** matchmaking lobby, lane lineup, short sport, outcome replay.
6. **Wardrobe:** 3D orbit model, materials/outfits presets and outfit saves.
7. **Memory Book:** visual encounters with date, other KIN alias (consented), pictures and notable events.
8. **Profile/Club:** avatar, badges, teams, safety/settings and friends.

### Accessibility
Reduced motion (replace hopping with fades), color-blind-safe UI, captions for chirps/sound cues, screen reader labeling of game controls, alternate touch inputs for all motion/fold mechanics, haptics/audio toggles, scalable text outside 3D, avoidance of flashing patterns.

## Product constraints and risk register
- Camera-only **two-way real-time** interactions cannot be promised for arbitrary physical arrangements; use optical introductions or single-device guest display, and native/LAN transport when present.
- Do not advertise Wi-Fi Aware as universal Android↔iPhone↔browser; platform capability and interoperability testing required.
- iPhone foldable device APIs are optional capability extensions, not the core specification; never make basic gameplay hinge-dependent.
- Never trust rendered visuals or camera-read codes for verified ownership or rare-item transfers.
- Multiplayer simulation must have one authoritative outcome per event and disconnect recovery.
- AI-generated content must not transmit user private data to other KIN or services without consent.
- Children require protective defaults, restricted discovery/communication and platform/region-specific legal review.
- Avoid clones of existing mascot characters, protected map assets, and proprietary game universes.
- GLB/world asset licenses must be inventoried and credited where required.

## Implementation map
Detailed architecture: `architecture/SYSTEM_DESIGN.md`.
Types and event protocol: `contracts/kin-protocol.schema.json`, `contracts/kin-types.ts`.
Coding-agent operating instructions: `agent/AGENTS.md`, `agent/BUILD_PROMPT.md`.
Phased backlog and acceptance: `delivery/ROADMAP.md`.
Art direction and screen walkthrough: `design/CREATIVE_DIRECTION.md`.

## Verified reference documentation
- Babylon.js engine capabilities: https://www.babylonjs.com/specifications/
- Capacitor cross-platform runtime: https://capacitorjs.com/docs
- Apple Wi-Fi Aware capabilities and device support: https://developer.apple.com/documentation/WiFiAware
- Apple iOS Wi-Fi developer note: https://developer.apple.com/documentation/technotes/tn3111-ios-wifi-api-overview
- Browser camera permissions and secure contexts: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- Kenney open game art: https://kenney.nl/assets (verify per-pack licenses)
