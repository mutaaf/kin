import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The guide at /kin/guide/ is a real, readable page: text in the HTML, no script, no ads (kids app).
describe('Player guide page', () => {
  const html = readFileSync('guide/index.html', 'utf8');
  const visible = html
    .replace(/<head>[\s\S]*?<\/head>/, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ');
  const words = visible.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));

  it('has its title, description, canonical and h1', () => {
    expect(html).toMatch(/<title>KIN Guide: How to Play, Controls and Tips<\/title>/);
    const desc = html.match(/<meta name="description" content="([^"]+)"/)?.[1] ?? '';
    expect(desc.length).toBeGreaterThanOrEqual(70);
    expect(desc.length).toBeLessThanOrEqual(160);
    expect(html).toContain('<link rel="canonical" href="https://mutaafaziz.com/kin/guide/" />');
    expect(html).toContain('<h1>KIN Player Guide</h1>');
  });

  it('is readable without JavaScript and long enough to be useful', () => {
    expect(words.length).toBeGreaterThanOrEqual(900);
    expect(html).not.toMatch(/<script/i);
  });

  it('carries no ads and no em-dashes', () => {
    expect(html).not.toMatch(/ads\/v1|data-marquee|adsbygoogle/);
    expect(html).not.toMatch(/—|&mdash;/);
  });

  it('is built as a page and served without the analytics beacon', () => {
    const vite = readFileSync('vite.config.ts', 'utf8');
    expect(vite).toContain("guide: 'guide/index.html'");
    expect(vite).toContain("'/kin/guide/'");
  });

  it('is linked from the app and the about page', () => {
    expect(readFileSync('src/ui/hud.ts', 'utf8')).toContain('guide/');
    expect(readFileSync('about/index.html', 'utf8')).toContain('../guide/');
  });
});
