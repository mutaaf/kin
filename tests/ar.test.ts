import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { decodeMesh, decodePlane, depthToNdc01, heightOver, isNewSighting, kelvinToRgb, lumensToIntensity, surfaceUnder } from '../src/ar/math';
import type { ArSurface } from '../src/ar/types';

const b64 = (a: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
const translate = (x: number, y: number, z: number, yaw = 0) => new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z).toArray();

describe('AR packet decoding', () => {
  it('round-trips a LiDAR mesh chunk (vertices, 16-bit indices, per-face classes)', () => {
    const v = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]);
    const i = new Uint16Array([0, 1, 2, 1, 3, 2]);
    const c = new Uint8Array([2, 4]); // floor, table
    const m = decodeMesh({ id: 'a', t: translate(0, 0, 0), nv: 4, nf: 2, wide: false, v: b64(v), i: b64(i), c: b64(c) });
    expect([...m.positions]).toEqual([...v]);
    expect([...m.indices]).toEqual([...i]);
    expect([...m.faceClass]).toEqual([2, 4]);
  });

  it('round-trips 32-bit indices for large chunks', () => {
    const i = new Uint32Array([0, 70000, 2]);
    const m = decodeMesh({ id: 'b', t: translate(0, 0, 0), nv: 70001, nf: 1, wide: true, v: b64(new Float32Array(70001 * 3)), i: b64(i), c: b64(new Uint8Array([0])) });
    expect([...m.indices]).toEqual([0, 70000, 2]);
  });

  it('maps unknown plane classes to unknown', () => {
    expect(decodePlane({ id: 'p', cls: 'trampoline', align: 'h', t: translate(0, 0, 0), c: [0, 0, 0], ex: 1, ez: 1, rot: 0 }).kind).toBe('unknown');
  });
});

describe('real surfaces', () => {
  const floor: ArSurface = { id: 'f', kind: 'floor', align: 'h', transform: translate(0, 0, 0), center: [0, 0, 0], extentX: 4, extentZ: 4, rotation: 0 };
  const table: ArSurface = { id: 't', kind: 'table', align: 'h', transform: translate(1, 0.74, -1, Math.PI / 4), center: [0, 0, 0], extentX: 1.2, extentZ: 0.6, rotation: 0 };

  it('finds the height of a rotated plane only inside its extent', () => {
    expect(heightOver(table, 1, -1)).toBeCloseTo(0.74);
    // 0.55 m along the table's long axis (rotated 45°) is inside; the same distance across it is not.
    const along = new THREE.Vector3(0.55, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
    const across = new THREE.Vector3(0, 0, 0.55).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
    expect(heightOver(table, 1 + along.x, -1 + along.z)).toBeCloseTo(0.74);
    expect(heightOver(table, 1 + across.x, -1 + across.z)).toBeNull();
  });

  it('picks the highest reachable surface: on the table from above, the floor from below', () => {
    expect(surfaceUnder([floor, table], 1, -1)?.kind).toBe('table');
    expect(surfaceUnder([floor, table], 1, -1, 0, 0.2)?.kind).toBe('floor'); // standing on the floor: can't hop 74 cm
    expect(surfaceUnder([floor, table], 1, -1, 0.7, 0.2)?.kind).toBe('table');
    expect(surfaceUnder([floor, table], 3, 3)).toBeNull();
  });
});

describe('light and depth', () => {
  it('warm room light is warm, daylight is near-white, intensity is bounded', () => {
    const [r, , b] = kelvinToRgb(2700);
    expect(r).toBeGreaterThan(b);
    const d = kelvinToRgb(6500);
    expect(Math.min(...d)).toBeGreaterThan(0.9);
    expect(lumensToIntensity(1000)).toBeCloseTo(1);
    expect(lumensToIntensity(0)).toBeGreaterThan(0);
    expect(lumensToIntensity(1e6)).toBeLessThan(3);
  });

  it('depth → NDC matches three.js projecting a point at that depth (the occlusion shader formula)', () => {
    const cam = new THREE.PerspectiveCamera(60, 0.46, 0.01, 60);
    cam.updateProjectionMatrix();
    for (const m of [0.3, 1, 2.5]) {
      const ndc = new THREE.Vector3(0, 0, -m).applyMatrix4(cam.projectionMatrix).z * 0.5 + 0.5;
      expect(depthToNdc01(cam.projectionMatrix.toArray(), m)).toBeCloseTo(ndc, 6);
    }
  });
});

describe('real objects', () => {
  it('reports a sighting once, then again only if it moved or time passed', () => {
    const seen = [{ label: 'cup', position: [0, 0.75, -1], seenAt: 1000 }];
    expect(isNewSighting(seen, 'cup', [0.05, 0.75, -1], 2000)).toBe(false);
    expect(isNewSighting(seen, 'cup', [1.5, 0.75, -1], 2000)).toBe(true);
    expect(isNewSighting(seen, 'cup', [0, 0.75, -1], 40_000)).toBe(true);
    expect(isNewSighting(seen, 'plant', [0, 0.75, -1], 2000)).toBe(true);
  });
});

describe('KIN-local ↔ metres (the world group placed on a real surface)', () => {
  it('a KIN 1 unit tall stands ~14 cm tall on the table, and conversions invert', () => {
    const world = new THREE.Group();
    world.position.set(1, 0.74, -1);
    world.rotation.y = 0.6;
    world.scale.setScalar(0.14);
    world.updateMatrixWorld(true);
    const head = world.localToWorld(new THREE.Vector3(0, 1, 0));
    expect(head.y - 0.74).toBeCloseTo(0.14);
    const p = new THREE.Vector3(0.3, 0, -0.2);
    expect(world.worldToLocal(world.localToWorld(p.clone())).distanceTo(p)).toBeLessThan(1e-9);
  });
});
