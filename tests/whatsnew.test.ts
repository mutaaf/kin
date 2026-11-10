// What's new (src/whatsnew): once per version, never on a first visit, never under test, capture
// or demo flags, and notes always present for the version that ships.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareVersions, decide, FORCE_GLOBAL, gate, ROUTES, routeTo, SKIP_PARAMS, type State } from '../src/whatsnew/decide';
import { GO_LABEL, notesFor, RELEASES, storeWhatsNew, type Destination } from '../src/whatsnew/notes';
import { APP_VERSION } from '../src/whatsnew/version';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

/** Simulates loads on one device: localStorage is `seen`; each load runs decide and records. */
function device() {
  let seen: string | null = null;
  return (current: string, returning: boolean, search = '') => {
    const d = decide({ seen, current, returning, hasNotes: true }, gate({ search }));
    if (d.record) seen = current;
    return d.show;
  };
}

describe('whatsnew: once per version', () => {
  it('first visit (fresh install) shows nothing, but records the version', () => {
    const load = device();
    expect(load('0.2.0', false)).toBe(false);
    // Hatched later, reloaded on the same version: still nothing.
    expect(load('0.2.0', true)).toBe(false);
  });

  it('an upgrade shows it exactly once', () => {
    const load = device();
    expect(load('0.2.0', false)).toBe(false);
    expect(load('0.3.0', true)).toBe(true);
    expect(load('0.3.0', true)).toBe(false);
    expect(load('0.3.0', true)).toBe(false);
    expect(load('0.4.0', true)).toBe(true);
  });

  it('same version shows nothing', () => {
    const s: State = { seen: '0.2.0', current: '0.2.0', returning: true, hasNotes: true };
    expect(decide(s)).toEqual({ show: false, record: false });
  });

  it('a returning player from before What’s new existed sees it once', () => {
    const load = device();
    expect(load('0.2.0', true)).toBe(true);
    expect(load('0.2.0', true)).toBe(false);
  });

  it('a downgrade shows nothing', () => {
    expect(decide({ seen: '0.3.0', current: '0.2.0', returning: true, hasNotes: true }).show).toBe(false);
  });

  it('no notes for the version: nothing to show, still recorded', () => {
    expect(decide({ seen: '0.1.0', current: '0.2.0', returning: true, hasNotes: false })).toEqual({ show: false, record: true });
  });

  it('compares versions numerically', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.2.0', '0.2.1')).toBeLessThan(0);
  });
});

describe('whatsnew: flags', () => {
  const upgrade: State = { seen: '0.1.0', current: '0.2.0', returning: true, hasNotes: true };

  it('skips under every test, capture and demo param, and records nothing', () => {
    for (const p of SKIP_PARAMS) {
      expect(gate({ search: `?k=home&${p}=1` }), p).toBe('skip');
      expect(decide(upgrade, gate({ search: `?${p}=1` }))).toEqual({ show: false, record: false });
    }
  });

  it('skips the store-capture URLs and automated browsers', () => {
    expect(gate({ search: '?k=lobby&wx=clear&first' })).toBe('skip');
    expect(gate({ search: '?k=home', automated: true })).toBe('skip');
    expect(gate({ search: '?k=home', test: true })).toBe('skip');
  });

  it('shows for a plain URL', () => {
    expect(gate({ search: '?k=home' })).toBe('normal');
    expect(decide(upgrade, gate({ search: '?k=home' })).show).toBe(true);
  });

  it('?whatsnew=1 forces a preview without recording; ?whatsnew=0 suppresses; embed always wins', () => {
    expect(decide({ ...upgrade, seen: '0.2.0' }, gate({ search: '?whatsnew=1', automated: true }))).toEqual({ show: true, record: false });
    expect(gate({ search: '?whatsnew=0' })).toBe('skip');
    expect(gate({ search: '?embed=1&whatsnew=1' })).toBe('skip');
  });

  it('the app wires the gate to the automation, test and embed signals', () => {
    const app = readFileSync('src/app.ts', 'utf8');
    expect(app).toMatch(/gate\(\{ search: location\.search, automated: navigator\.webdriver === true, test: import\.meta\.env\.MODE === 'test', forced: isNative && /);
    expect(app).toMatch(/\[FORCE_GLOBAL\] === true/);
    expect(app).toMatch(/returning: !loaded\.fresh && loaded\.kin\.hatched/);
  });
});

describe('whatsnew: native force switch', () => {
  const upgrade: State = { seen: '0.1.0', current: '0.2.0', returning: true, hasNotes: true };

  it('forces a preview on a phone, even with the version already seen, and records nothing', () => {
    expect(gate({ search: '', forced: true })).toBe('force');
    expect(decide({ ...upgrade, seen: '0.2.0' }, gate({ search: '', forced: true }))).toEqual({ show: true, record: false });
    // Also under automation (a simulator driven by a script) and on a fresh install.
    expect(decide({ ...upgrade, seen: null, returning: false }, gate({ search: '', forced: true, automated: true }))).toEqual({ show: true, record: false });
  });

  it('?whatsnew=0 and embed still win over it', () => {
    expect(gate({ search: '?whatsnew=0', forced: true })).toBe('skip');
    expect(gate({ search: '?embed=1', forced: true })).toBe('skip');
  });

  it('the native shell sets it only in Debug builds, from the -KINWhatsNew launch argument', () => {
    const swift = readFileSync('ios/App/App/KINBridgeViewController.swift', 'utf8');
    expect(swift).toContain(`window.${FORCE_GLOBAL} = true;`);
    expect(swift).toMatch(/UserDefaults\.standard\.bool\(forKey: "KINWhatsNew"\)/);
    // Every line that touches the switch sits inside #if DEBUG ... #endif.
    const outside = swift.replace(/#if DEBUG[\s\S]*?#endif/g, '');
    expect(outside).not.toMatch(/KINWhatsNew|__KIN_WHATSNEW__|forceWhatsNew/);
    // And it's documented next to the notes.
    expect(readFileSync('src/whatsnew/notes.ts', 'utf8')).toContain('-KINWhatsNew YES');
  });
});

describe('whatsnew: callouts go to the feature', () => {
  const shell = readFileSync('src/ui/shell/index.ts', 'utf8');
  const handled = new Set([...shell.matchAll(/case '([a-z]+)':/g)].map((m) => m[1]));

  it('every destination routes to an action the shell really handles', () => {
    for (const d of Object.keys(ROUTES) as Destination[]) {
      expect(handled.has(routeTo(d)), `${d} -> ${routeTo(d)}`).toBe(true);
      expect(GO_LABEL[d].split(/\s+/).length, GO_LABEL[d]).toBeLessThanOrEqual(4);
    }
    expect(routeTo('explore')).toBe('explore');
    expect(routeTo('play')).toBe('play');
    expect(routeTo('kin')).toBe('identity');
    expect(routeTo('train')).toBe('train');
    expect(shell).toMatch(/go\(act: string\) \{\s*this\.run\(act\);/);
  });

  it('the current release’s cards all go somewhere (each one has a place in the app)', () => {
    const r = notesFor(pkg.version)!;
    for (const c of r.callouts) expect(c.go, c.title).toBeTruthy();
  });

  it('the modal renders a button only for cards with a destination, and the app routes it through the shell', () => {
    const modal = readFileSync('src/whatsnew/modal.ts', 'utf8');
    expect(modal).toMatch(/c\.go && o\.onGo \?/);
    expect(modal).toMatch(/close\(\(\) => o\.onGo\?\.\(d\)\)/);
    const app = readFileSync('src/app.ts', 'utf8');
    expect(app).toMatch(/shell\.go\(routeTo\(dest\)\)/);
  });
});

describe('whatsnew: notes', () => {
  it('the built-in version is package.json’s', () => {
    expect(APP_VERSION).toBe(pkg.version);
  });

  it('has notes for the current version', () => {
    const r = notesFor(pkg.version);
    expect(r, `add notes for ${pkg.version} to src/whatsnew/notes.ts`).toBeTruthy();
  });

  it('every release has a headline, 2–4 short callouts with real art, and notes', () => {
    const versions = new Set<string>();
    for (const r of RELEASES) {
      expect(versions.has(r.version), r.version).toBe(false);
      versions.add(r.version);
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.headline.length).toBeGreaterThan(0);
      expect(r.headline.length).toBeLessThanOrEqual(48);
      expect(r.callouts.length).toBeGreaterThanOrEqual(2);
      expect(r.callouts.length).toBeLessThanOrEqual(4);
      for (const c of r.callouts) {
        expect(c.title.split(/\s+/).length, c.title).toBeLessThanOrEqual(5);
        expect(c.line.length, c.line).toBeLessThanOrEqual(90);
        expect(existsSync(`src/whatsnew/art/${c.art}.webp`), c.art).toBe(true);
      }
      expect(r.notes.length).toBeGreaterThan(0);
      expect(storeWhatsNew(r).length).toBeLessThanOrEqual(4000);
    }
  });

  it('copy stays original and kind: no franchise or brand names, no politics or tragedy', () => {
    const banned = /pok[eé]mon|tamagotchi|star ?wars|star ?trek|stardate|marvel|disney|pixar|nintendo|sega|\be\.t\.|gremlin|furby|stitch!|baby yoda|grogu|spacex|nasa|elon|apple|google|election|president|\bwars?\b|disaster|death|died/i;
    for (const r of RELEASES) {
      const all = [r.kicker, r.headline, r.dek, ...r.callouts.flatMap((c) => [c.title, c.line]), ...r.notes].join('\n');
      expect(all).not.toMatch(banned);
    }
  });

  it('releases are newest first', () => {
    for (let i = 1; i < RELEASES.length; i++) expect(compareVersions(RELEASES[i - 1]!.version, RELEASES[i]!.version)).toBeGreaterThan(0);
  });
});
