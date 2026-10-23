// Pure helpers for AR: packet decoding, surface queries, light and depth maths. No DOM, no
// WebGL, so they're unit-tested (tests/ar.test.ts).

import type { ArMeshChunk, ArSurface, SurfaceKind } from './types';

export function b64ToBytes(b64: string): Uint8Array {
  if (!b64) return new Uint8Array(0);
  if (typeof atob === 'function') {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** A typed view over decoded bytes, copying when the offset isn't aligned. */
function view<T extends Float32Array | Uint16Array | Uint32Array>(bytes: Uint8Array, Ctor: { new (b: ArrayBufferLike, o: number, n: number): T; new (n: number): T; BYTES_PER_ELEMENT: number }): T {
  const n = Math.floor(bytes.byteLength / Ctor.BYTES_PER_ELEMENT);
  if (bytes.byteOffset % Ctor.BYTES_PER_ELEMENT === 0) return new Ctor(bytes.buffer, bytes.byteOffset, n);
  const copy = new Uint8Array(n * Ctor.BYTES_PER_ELEMENT);
  copy.set(bytes.subarray(0, copy.length));
  return new Ctor(copy.buffer, 0, n);
}

export interface MeshPacket {
  id: string;
  t: number[];
  nv: number;
  nf: number;
  wide: boolean;
  v: string;
  i: string;
  c: string;
}

export function decodeMesh(p: MeshPacket): ArMeshChunk {
  const positions = view(b64ToBytes(p.v), Float32Array).subarray(0, p.nv * 3);
  const indices = p.wide ? view(b64ToBytes(p.i), Uint32Array) : view(b64ToBytes(p.i), Uint16Array);
  const faceClass = b64ToBytes(p.c).subarray(0, p.nf);
  return { id: p.id, transform: p.t, positions, indices: indices.subarray(0, p.nf * 3) as Uint16Array | Uint32Array, faceClass };
}

export interface PlanePacket {
  id: string;
  cls: string;
  align: 'h' | 'v';
  t: number[];
  c: [number, number, number];
  ex: number;
  ez: number;
  rot: number;
}

const KINDS: SurfaceKind[] = ['floor', 'table', 'seat', 'wall', 'ceiling', 'door', 'window'];
export function decodePlane(p: PlanePacket): ArSurface {
  return {
    id: p.id, kind: KINDS.includes(p.cls as SurfaceKind) ? (p.cls as SurfaceKind) : 'unknown', align: p.align === 'v' ? 'v' : 'h',
    transform: p.t, center: p.c, extentX: p.ex, extentZ: p.ez, rotation: p.rot || 0,
  };
}

/** Column-major 4×4 × point. */
export function transformPoint(m: number[], x: number, y: number, z: number): [number, number, number] {
  return [m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!];
}

/** Inverse of a rigid (rotation + translation) column-major transform, applied to a point. */
export function inverseRigidPoint(m: number[], x: number, y: number, z: number): [number, number, number] {
  const dx = x - m[12]!;
  const dy = y - m[13]!;
  const dz = z - m[14]!;
  // Rᵀ · d (columns of R are m[0..2], m[4..6], m[8..10])
  return [m[0]! * dx + m[1]! * dy + m[2]! * dz, m[4]! * dx + m[5]! * dy + m[6]! * dz, m[8]! * dx + m[9]! * dy + m[10]! * dz];
}

/** Is world point (metres) over horizontal surface `s` (within its rotated extent)? Returns the plane height. */
export function heightOver(s: ArSurface, wx: number, wz: number): number | null {
  if (s.align !== 'h') return null;
  // Project onto the plane: find its height at this x/z by working in anchor space at y = 0.
  const [lx, , lz] = inverseRigidPoint(s.transform, wx, s.transform[13]!, wz);
  const cx = lx - s.center[0];
  const cz = lz - s.center[2];
  const c = Math.cos(-s.rotation);
  const sn = Math.sin(-s.rotation);
  const rx = cx * c - cz * sn;
  const rz = cx * sn + cz * c;
  if (Math.abs(rx) > s.extentX / 2 || Math.abs(rz) > s.extentZ / 2) return null;
  return transformPoint(s.transform, lx, 0, lz)[1];
}

/**
 * Highest horizontal surface under (wx, wz) not more than `stepUp` metres above `fromY`
 * (a KIN can hop up a little, never through a table from below).
 */
export function surfaceUnder(surfaces: readonly ArSurface[], wx: number, wz: number, fromY = Infinity, stepUp = Infinity): { y: number; kind: SurfaceKind } | null {
  let best: { y: number; kind: SurfaceKind } | null = null;
  for (const s of surfaces) {
    const y = heightOver(s, wx, wz);
    if (y === null || y > fromY + stepUp) continue;
    if (!best || y > best.y) best = { y, kind: s.kind };
  }
  return best;
}

/** Colour temperature (K) → linear-ish RGB 0..1 (Tanner Helland's fit), for room-light tinting. */
export function kelvinToRgb(k: number): [number, number, number] {
  const t = Math.max(1000, Math.min(40000, k)) / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * (t - 60) ** -0.1332047592;
    g = 288.1221695283 * (t - 60) ** -0.0755148492;
    b = 255;
  }
  const c = (x: number) => Math.max(0, Math.min(255, x)) / 255;
  return [c(r), c(g), c(b)];
}

/** ARKit ambient intensity is ~1000 lm in a neutrally lit room: map to a light multiplier. */
export const lumensToIntensity = (lm: number) => Math.max(0.15, Math.min(2.2, lm / 1000));

/** Linear eye depth (metres) → NDC depth in [0,1] for a perspective projection (column-major). */
export function depthToNdc01(p: number[], meters: number): number {
  const z = -meters;
  const clipZ = p[10]! * z + p[14]!;
  const clipW = p[11]! * z + p[15]!;
  return (clipZ / clipW) * 0.5 + 0.5;
}

/** Recognitions repeat every second; only report an object again if it moved or time passed. */
export function isNewSighting(prev: { label: string; position: number[]; seenAt: number }[], label: string, pos: number[], now: number, radius = 0.6, quietMs = 20_000): boolean {
  return !prev.some((p) => p.label === label && Math.hypot(p.position[0]! - pos[0]!, p.position[1]! - pos[1]!, p.position[2]! - pos[2]!) < radius && now - p.seenAt < quietMs);
}
