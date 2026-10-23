import { describe, expect, it } from 'vitest';
import { newCare } from '../src/core/care';
import type { Memory } from '../src/core/creature';
import { ago, todayFrom } from '../src/ui/shell';

describe('shell: living memories', () => {
  it('speaks time like a person', () => {
    const now = 1_000_000_000;
    expect(ago(now - 20_000, now)).toBe('just now');
    expect(ago(now - 120_000, now)).toBe('2m ago');
    expect(ago(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(ago(now - 30 * 3_600_000, now)).toBe('yesterday');
    expect(ago(now - 4 * 86_400_000, now)).toBe('4d ago');
  });

  it('merges moments and finds, newest first, with fitting icons and short text', () => {
    const t = Date.now();
    const memories: Memory[] = [
      { id: 'a', at: t - 5000, kind: 'visited', note: 'Visited Nox. Nox ran over to say hi; Lumi did a happy spin and then they played for a very long time together.', other: { id: 'n', name: 'Nox', hue: 280 } },
      { id: 'b', at: t - 90_000, kind: 'thought', note: 'Lumi thought: “Cozy.”' },
      { id: 'c', at: t - 9e6, kind: 'hatched', note: 'Hatched on a sunny morning.' },
    ];
    const care = { ...newCare(t), firstFound: { 'pebble-heart': t - 1000 } };
    const items = todayFrom(memories, care, 6);
    expect(items[0]!.text).toMatch(/heart-shaped pebble/i);
    expect(items[0]!.icon).toBe('collection');
    expect(items[1]!.icon).toBe('friends');
    expect(items[1]!.hue).toBe(280);
    expect(items[1]!.text.length).toBeLessThanOrEqual(64);
    expect(items.map((i) => i.at)).toEqual([...items.map((i) => i.at)].sort((a, b) => b - a));
  });
});
