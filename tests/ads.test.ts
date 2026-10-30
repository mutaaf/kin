import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isNative } from '../src/landing/ads';

describe('Marquee ads (kids policy)', () => {
  it('detects the Capacitor native shell so it loads no ads there', () => {
    expect(isNative({ Capacitor: { isNativePlatform: () => true } })).toBe(true);
    expect(isNative({ Capacitor: { isNativePlatform: () => false } })).toBe(false);
    expect(isNative({})).toBe(false);
  });

  it('keeps ads off the creature play surface (app page and Unity preview)', () => {
    for (const page of ['index.html', 'public/play/index.html']) {
      let html = '';
      try { html = readFileSync(page, 'utf8'); } catch { continue; }
      expect(html).not.toMatch(/ads\/v1\/ads\.js|data-marquee/);
    }
    expect(readFileSync('src/main.ts', 'utf8')).not.toMatch(/landing\/ads|ads\/v1/);
  });

  it('declares only menu-context slots and links the ad privacy policy', () => {
    const ads = readFileSync('src/landing/ads.ts', 'utf8');
    expect(ads).toContain("dataset.app = 'kin'");
    expect(ads).not.toMatch(/:gameplay/);
    const about = readFileSync('about/index.html', 'utf8');
    expect(about).toContain('data-marquee-context="menu"');
    expect(about).toContain('https://mutaafaziz.com/ads/privacy/');
  });
});
