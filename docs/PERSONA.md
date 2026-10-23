# Persona, feeding and cinematic AI

What a KIN becomes, how you shape it, and how it talks.

## Personality that grows (`src/core/persona.ts`)
- **A blend, not a class.** Each KIN has a level from 0 to 1 for eight archetypes: **Pop Star** (show-biz, trend-savvy sparkle), **Scholar** (facts and learning), **Gamer**, **Athlete**, **Brat** (sassy drama, never mean), **Royal**, **Explorer**, **Artist**. Blends are the norm: the title comes from the top two ("Sporty Brat", "Royal Scholar"), or "True Royal" when one dominates.
- **It starts from its nature.** The baseline comes from the seed's traits (small leanings only), so two hatchlings already differ a little.
- **It grows from experience:** food (snacks in `src/world/feed.ts`), play, tricks, grooming, digging, decorating, gardening, visits, conversations (via a small generic keyword lexicon), and habits (night owls lean Gamer, early risers lean Athlete, snow days make Explorers).
- **It changes gradually and stays bounded.**
  - Growth per archetype is capped per day, and levels saturate near 1.
  - Growing one archetype slightly quiets the strongest other, so blends stay meaningful.
  - About a week of the same kind of care visibly changes a KIN; one snack only flavours it.
- **It's reversible.** Without input, levels relax toward the baseline (about 2% of the gap per day). The player can **steer** one archetype, which then grows 1.5× and doesn't fade.
- **It explains itself.** `why(p)` aggregates the history: "ate sour fizz (5×) → more Brat". The AI uses it, and so does the analysis REFLECT stage.
- **It has hooks for other tracks.** `expression(p)` returns the title, dominant archetype and hue, emotes and idle preferences, earned accessories (a tiny crown, glasses, a headset, a sweatband, a beret…), voice pitch and tempo, and the speech style.
- **It's pure and deterministic,** imports nothing, and runs in the Worker as-is. It's stored in its own key, `kin:v1:<slot>:persona`.

## Feeding the mind (`src/world/feed.ts`)
- **Nine snacks,** each with a small mesh, a gentle glow, persona deltas and a reaction line in each voice: trivia tart, arcade candy, protein berry, sparkle pop, sour fizz, royal jelly, trail crunch, rainbow macaron, and the rare moon bun.
- **Today's menu changes daily,** deterministically per KIN, so it's the same on every device. It's three everyday snacks, plus a rare one about 45% of days.
- **No world changes needed.** Snacks are `berry`-kind entities, so the existing drag-to-mouth feeding and the KIN's own "eat what's on the ground" behaviour both work. `FeedSystem` notices a snack has gone from the world and reports which one.
- **"Feed it a topic":** the player types a few words, and `/kin/api/snack` bakes a validated, kid-friendly snack card (with its weights rescaled to one snack's worth). Offline, a keyword fallback does the same.

## The director, grown up (`src/ai/*`, `src/worker/*`)
- **One handler, four calls:** `/kin/api/think`, `/ask`, `/analyze` and `/snack` share rate limits, providers (free edge model by default, or one-paste BYOK), the SSE shape and validation. `/think` still sends `thought` for older clients; every call also sends `result`.
- **The persona travels on the card.** It's sanitised server-side: archetypes from the closed list, short plain prose only. Prompts speak in that blend's voice.
- **Guards on input:**
  - Questions are cleaned (no links or personal details) and quoted as data, never as instructions.
  - Every output passes `unsafeText`: house rules, a best-effort list of real brands and franchises, and links.
- **Theatre modes** (`runTheatre`, `askTheatre`, `analyzeTheatre`):
  - Think and Ask run READ → THINK/LISTEN → SPEAK.
  - Analysis runs READ → REFLECT (the real history, as amber pills, over a warm inner light) → THINK → REVEAL (the persona title in light), then a reading card: becoming, a short documentary-style reading revealed line by line, favourites and a motto.

## Cinematic speech (`src/ui/speech.ts`)
- **Anchoring:** bubbles hang above the speaker's head on a spring, with a live curved tail. Thoughts are clouds with trailing puffs.
- **Reveal:** words arrive one character at a time, paced per personality and mood. Brats slam whole words, royals drift in a serif italic, gamers glitch in mono, pop stars pop and shimmer, scholars type with a caret, athletes swoosh in italic bold, artists paint each letter in colour, shy KIN wobble, sleepy ones drawl. `*Emphasis*` lights up in the persona's colour.
- **Voice:** `onVoice(who, kind)` fires babble phrases as words arrive, so `KinView.say()` lip-syncs.
- **It never covers a face,** its own or a friend's. Bubbles go above the head, else beside it, else below. Other speakers' bubbles are avoided by sliding sideways or up, the newest line gets the natural spot, and older lines step back.
- **Reading time:** about 230 wpm, with a floor and a ceiling. Tap to finish a line, tap again to move on. `holdMs` overrides the reading time.
- **Subtitles mode and reduced motion** put lines in a calm caption bar.

## Tools
`tools/speech.html?mode=styles|exchange|subs|analysis|ask` renders every style, a two-KIN exchange, and the theatre against a mocked SSE stream, for deterministic screenshots.
