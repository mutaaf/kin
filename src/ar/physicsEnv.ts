// Bridges the AR room (src/ar: metres, ARKit anchor transforms) to the physics world's
// environment colliders (src/world/env.ts: world units, plane quaternions). Points go through the
// AR session's own toLocal(), so whatever placement/scale the stage applied is respected exactly;
// plane orientation is rebuilt from mapped axes rather than assumed.
import * as THREE from 'three';
import type { ArEnvironment as WorldEnv, EnvMesh, EnvPlane } from '../world/env';
import { MESH_CLASS, type ArEnvironment as RoomEnv } from './types';

const m4 = new THREE.Matrix4();
const v = new THREE.Vector3();

export function toPhysicsEnv(room: RoomEnv): WorldEnv {
  const planes: EnvPlane[] = [];
  for (const s of room.surfaces()) {
    if (s.align !== 'h') continue; // walls don't hold the KIN up; the mesh covers them for collisions
    m4.fromArray(s.transform);
    const local = (x: number, z: number) => {
      // Extent axes, rotated by the iOS 16+ in-plane rotation, then by the anchor transform.
      const c = Math.cos(s.rotation);
      const sn = Math.sin(s.rotation);
      v.set(s.center[0] + x * c - z * sn, s.center[1], s.center[2] + x * sn + z * c).applyMatrix4(m4);
      return room.toLocal(v.clone());
    };
    const centre = local(0, 0);
    const ax = local(s.extentX / 2, 0).sub(centre);
    const az = local(0, s.extentZ / 2).sub(centre);
    const ny = new THREE.Vector3().crossVectors(az, ax).normalize();
    const nx = ax.clone().normalize();
    const nz = new THREE.Vector3().crossVectors(nx, ny).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(nx, ny, nz));
    planes.push({
      id: s.id,
      position: { x: centre.x, y: centre.y, z: centre.z },
      rotation: [q.x, q.y, q.z, q.w],
      extent: [ax.length() * 2, az.length() * 2],
      classification: s.kind === 'unknown' ? 'none' : s.kind,
    });
  }
  const meshes: EnvMesh[] = room.meshChunks().map((c) => {
    m4.fromArray(c.transform);
    const out = new Float32Array(c.positions.length);
    for (let i = 0; i < c.positions.length; i += 3) {
      const p = room.toLocal(v.set(c.positions[i]!, c.positions[i + 1]!, c.positions[i + 2]!).applyMatrix4(m4).clone());
      out[i] = p.x;
      out[i + 1] = p.y;
      out[i + 2] = p.z;
    }
    // ARKit sends 16-bit indices for small chunks; physics wants 32-bit.
    return { id: c.id, positions: out, indices: c.indices instanceof Uint32Array ? c.indices : Uint32Array.from(c.indices), faceClass: Array.from(c.faceClass, (k) => MESH_CLASS[k] ?? 'none') };
  });
  // In AR the real room replaces the diorama's lawn and scenery as what holds things up.
  return { planes, meshes, mode: 'replace' };
}
