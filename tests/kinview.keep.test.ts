import { describe, expect, it } from 'vitest';

// The protection rule from KinView.script(), as a pure function: crossing beats survive any
// later script; everything else is replaced. (KinView itself needs WebGL, so the rule is mirrored.)
type T = { id: string; keep?: boolean };
function script(cur: T | null, queue: T[], next: T[]): { cur: T | null; queue: T[] } {
  if (cur?.keep || queue.some((t) => t.keep)) return { cur, queue: [...queue.filter((t) => t.keep), ...next] };
  return { cur: null, queue: next };
}

describe('protected crossing beats', () => {
  it('a world actor cannot cancel a pending hop', () => {
    const r = script(null, [{ id: 'pre', keep: true }, { id: 'fly', keep: true }, { id: 'react' }], [{ id: 'fetch' }]);
    expect(r.queue.map((t) => t.id)).toEqual(['pre', 'fly', 'fetch']);
  });
  it('ordinary scripts still replace each other', () => {
    expect(script({ id: 'sniff' }, [{ id: 'sit' }], [{ id: 'fetch' }]).queue.map((t) => t.id)).toEqual(['fetch']);
  });
});
