// What's new: the one source of truth for each release's notes. The in-app modal
// (src/whatsnew/modal.ts) and the store "What's New" text (`npm run whatsnew`, printed by
// `npm run testflight`) both read this table, so they can never disagree.
//
// Rules for the copy (tests/whatsnew.test.ts guards the mechanical ones):
// - Every claim is true of the build that ships it. Write from the git history, not the roadmap.
// - Headlines may nod at pop culture (creature, pet and sci-fi companion vibes) and at light,
//   evergreen news (seasons, launches, meteor showers). Original nods only: no real characters,
//   franchises, brands, logos, quotes or real people. No politics or tragedy. Family-friendly.
// - 2 to 4 callouts. Each has art from src/whatsnew/art, a title of a few words and one short line.
// - A callout whose feature has a place in the app names it in `go`; the card then gets a button
//   that closes the modal and opens that place (routed by src/whatsnew/decide.ts `routeTo`).
//   Cards about something with no destination leave `go` out and stay plain.
//
// Seeing it (records nothing, so the real once-per-version gate is untouched):
// - Web: add `?whatsnew=1` to the app URL (`?whatsnew=0` hides it).
// - iPhone/iPad, Debug builds only: launch with the argument `-KINWhatsNew YES`, e.g.
//   `xcrun simctl launch <device> com.mutaafaziz.kin -KINWhatsNew YES`, or add it under
//   Product > Scheme > Edit Scheme > Run > Arguments in Xcode. ios/App/App/KINBridgeViewController.swift
//   turns it into `window.__KIN_WHATSNEW__`; Release builds compile that out.
//
// This file is plain TypeScript with no imports, so `node` can read it directly (type stripping).

/** Card art, cropped from the app's own captures (store/lobby/raw) into src/whatsnew/art/<key>.webp. */
export type ArtKey = 'worlds' | 'toys' | 'persona' | 'tricks';

/** A place in the app a callout can open. */
export type Destination = 'explore' | 'play' | 'kin' | 'train';

/** The button on a card with a destination: a verb and the place, a few words. */
export const GO_LABEL: Record<Destination, string> = {
  explore: 'Open Explore',
  play: 'Find the ball',
  kin: 'See your KIN',
  train: 'Try a trick',
};

export interface Callout {
  art: ArtKey;
  /** Where the card's button takes you; leave out for a card with no place in the app. */
  go?: Destination;
  /** A few words. */
  title: string;
  /** One short line. */
  line: string;
}

export interface Release {
  /** Must match package.json "version" for the release that ships it. */
  version: string;
  /** Release date, YYYY-MM-DD. */
  date: string;
  /** Small label above the headline. */
  kicker: string;
  headline: string;
  /** One sentence under the headline. */
  dek: string;
  callouts: Callout[];
  /** The full notes: the accordion in the app and the body of the store text. */
  notes: string[];
}

/** Newest first. Add a new entry whenever package.json "version" changes. */
export const RELEASES: Release[] = [
  {
    version: '0.2.0',
    date: '2026-11-10',
    kicker: 'Liftoff log · Leonids peak Nov 17–18',
    headline: 'Three new worlds have landed',
    dek: 'Your KIN’s biggest update since it hatched: places to roam, toys to chase and a personality all its own.',
    callouts: [
      { art: 'worlds', go: 'explore', title: 'Three worlds to roam', line: 'Sky Meadow, Forest Grove and Crystal Cave open up as your bond grows.' },
      { art: 'toys', go: 'play', title: 'Toys with real bounce', line: 'A ball, wood blocks and a wobbly jelly toy that roll, tumble and bounce.' },
      { art: 'persona', go: 'kin', title: 'A personality that grows', line: 'Play, snacks and visits nudge your KIN toward Pop Star, Scholar, Explorer and more.' },
      { art: 'tricks', go: 'train', title: 'Bond levels and tricks', line: 'Care earns Bond XP and unlocks Spin, High five, Roll over and Dance.' },
    ],
    notes: [
      'Living habitats: Sky Meadow opens at bond level 1, Forest Grove at level 2 and Crystal Cave at level 3. Pick one in Explore.',
      'A spotlight camera frames your KIN up close when you play on your own, and switches to a shared view when another screen joins in.',
      'A garden to care in: a berry plant, a water bowl, a brush, a feather and, at night, a blanket for tucking in.',
      'Toys follow real physics, so the ball, the wood blocks and the jelly toy (from bond level 2) bounce and roll.',
      'Bond XP and bond levels, from New friends to Kindred. Sit and Fetch are ready at level 1; Spin, High five, Roll over and Dance unlock as you go.',
      'Gentle care needs: fullness, fun, clean, rest and affection drift slowly and never hit zero. No game over, no sickness, and time away counts for at most 48 hours.',
      'Personalities that grow across eight styles, including Pop Star, Scholar, Gamer, Athlete, Royal, Explorer and Artist, shaped by what your KIN does.',
      'Think and Ask: free AI by default, now with its own daily share, and a plain message when that share is used up for the day.',
      'On the web, a new player guide at mutaafaziz.com/kin/guide, linked from Settings.',
    ],
  },
];

export const notesFor = (version: string): Release | undefined => RELEASES.find((r) => r.version === version);

/** The store "What's New" text (App Store limit: 4,000 characters). */
export function storeWhatsNew(r: Release): string {
  return [r.headline + '.', r.dek, '', ...r.notes.map((n) => `• ${n}`)].join('\n');
}
