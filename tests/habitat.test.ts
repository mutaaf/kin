import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { island, noise2 } from '../src/habitat/kit';
import { HABITATS } from '../src/habitat';
import { SPECS } from '../src/habitat/habitats';

describe('habitats', () => {
  it('only lists habitats as visitable when they are actually built', () => {
    for (const h of HABITATS) {
      if (h.status === 'built') expect(SPECS).toHaveProperty(h.id);
      else expect(SPECS).not.toHaveProperty(h.id);
    }
    expect(HABITATS[0]!.id).toBe('sky-meadow');
    expect(HABITATS[0]!.level).toBe(1);
  });

  it('keeps the play band dead flat so physics, toys and the crossing land on y = 0', () => {
    const isl = island({ rx: 9.5, rz: 7.2, seed: 4101, top: new THREE.Color('#8fca8a'), rock: new THREE.Color('#a48a76'), flatX: 3.4, flatZ: [-1.6, 2.0] });
    for (let x = -3; x <= 3; x += 0.5) for (let z = -1.4; z <= 1.8; z += 0.4) expect(Math.abs(isl.heightAt(x, z))).toBeLessThan(1e-9);
    // …and rises gently behind it to give the garden a horizon.
    expect(isl.heightAt(0, -5)).toBeGreaterThan(0);
    expect(isl.inside(0, 0)).toBe(true);
    expect(isl.inside(20, 0)).toBe(false);
  });

  it('is deterministic: the same seed builds the same world on every device', () => {
    const a = noise2(7);
    const b = noise2(7);
    for (let i = 0; i < 20; i++) expect(a(i * 0.37, i * 0.91)).toBe(b(i * 0.37, i * 0.91));
  });
});
