import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { toPhysicsEnv } from '../src/ar/physicsEnv';
import type { ArEnvironment } from '../src/ar/types';

const room = (scale: number, offset: THREE.Vector3): ArEnvironment =>
  ({
    active: true,
    unitsPerMeter: scale,
    toLocal: (m: THREE.Vector3) => m.clone().multiplyScalar(scale).add(offset),
    toMeters: (l: THREE.Vector3) => l.clone().sub(offset).divideScalar(scale),
    surfaces: () => [
      { id: 'table', kind: 'table', align: 'h', transform: new THREE.Matrix4().makeTranslation(1, 0.75, -2).toArray(), center: [0, 0, 0], extentX: 1.2, extentZ: 0.6, rotation: 0 },
      { id: 'wall', kind: 'wall', align: 'v', transform: new THREE.Matrix4().toArray(), center: [0, 0, 0], extentX: 3, extentZ: 2, rotation: 0 },
    ],
    meshChunks: () => [{ id: 'm', transform: new THREE.Matrix4().toArray(), positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), indices: new Uint16Array([0, 1, 2]), faceClass: new Uint8Array([2]) }],
    surfaceHeightAt: () => null,
    raycast: async () => null,
    on: () => () => {},
  }) as unknown as ArEnvironment;

describe('AR room → physics environment', () => {
  it('maps a real table to a flat, correctly sized plane in world units and skips walls', () => {
    const env = toPhysicsEnv(room(2, new THREE.Vector3(0, -1.5, 0)));
    expect(env.mode).toBe('replace');
    expect(env.planes).toHaveLength(1);
    const p = env.planes[0]!;
    expect(p.position.x).toBeCloseTo(2);
    expect(p.position.y).toBeCloseTo(0); // 0.75 m × 2 − 1.5
    expect(p.position.z).toBeCloseTo(-4);
    expect(p.extent[0]).toBeCloseTo(2.4);
    expect(p.extent[1]).toBeCloseTo(1.2);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(...p.rotation));
    expect(up.y).toBeCloseTo(1); // still horizontal
    expect(p.classification).toBe('table');
  });

  it('converts LiDAR mesh chunks to 32-bit indices with class names', () => {
    const m = toPhysicsEnv(room(1, new THREE.Vector3())).meshes[0]!;
    expect(m.indices).toBeInstanceOf(Uint32Array);
    expect(m.faceClass).toEqual(['floor']);
  });
});
