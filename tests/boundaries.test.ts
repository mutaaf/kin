// Architecture guard (SYSTEM_DESIGN "Core hard boundaries"): the brain, protocol and session
// never touch rendering or the DOM, so they stay testable without graphics or network.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : [join(dir, d.name)]));

describe('module boundaries', () => {
  for (const dir of ['src/core', 'src/protocol', 'src/session']) {
    it(`${dir} does not import three, render, ui or the DOM`, () => {
      for (const f of files(dir)) {
        const src = readFileSync(f, 'utf8');
        expect(src, f).not.toMatch(/from ['"]three['"]|\/render\/|\/ui\/|document\.|window\./);
      }
    });
  }
});
