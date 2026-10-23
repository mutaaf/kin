// AR contracts shared by the AR session, the stage and the physics world.
//
// Frames: ARKit world space is metres, y up, right-handed (same as three.js). KIN's world group
// ("local" units, the diorama's units: a KIN is ~1 unit tall) is placed on a real surface and
// scaled, so every existing system keeps working in local units. `ArEnvironment` converts.

import type * as THREE from 'three';

export type SurfaceKind = 'floor' | 'table' | 'seat' | 'wall' | 'ceiling' | 'door' | 'window' | 'unknown';

/** ARMeshClassification raw values, per LiDAR mesh face. */
export const MESH_CLASS = ['none', 'wall', 'floor', 'ceiling', 'table', 'seat', 'window', 'door'] as const;
export type MeshClass = (typeof MESH_CLASS)[number];

/** A detected plane (ARPlaneAnchor), in metres. */
export interface ArSurface {
  id: string;
  kind: SurfaceKind;
  align: 'h' | 'v';
  /** Anchor transform (column-major 4×4, metres). The plane lies in its local XZ. */
  transform: number[];
  /** Plane centre in anchor space (iOS 15 extents are centred here; iOS 16+ report 0). */
  center: [number, number, number];
  extentX: number;
  extentZ: number;
  /** Rotation of the extent around the anchor's Y axis (iOS 16+). */
  rotation: number;
}

/** A LiDAR mesh chunk (ARMeshAnchor). Vertices are in anchor space; apply `transform`. */
export interface ArMeshChunk {
  id: string;
  transform: number[];
  positions: Float32Array;
  indices: Uint16Array | Uint32Array;
  /** One MESH_CLASS index per triangle. */
  faceClass: Uint8Array;
}

/** A recognised real object, placed in the room. */
export interface ArObject {
  label: string;
  /** The classifier's own identifier (Apple taxonomy), for debugging. */
  raw: string;
  confidence: number;
  /** Metres, world space. */
  position: [number, number, number];
  /** Approximate width in metres. */
  extent: number;
  /** KIN-local position (units of the world group), for the brain and actors. */
  local: THREE.Vector3;
  seenAt: number;
}

export interface ArHit {
  position: THREE.Vector3; // metres
  normal: THREE.Vector3;
  kind: SurfaceKind;
  local: THREE.Vector3; // KIN-local
}

export type ArEvent =
  | { type: 'surfaces' }
  | { type: 'mesh'; id: string }
  | { type: 'object-seen'; object: ArObject }
  | { type: 'tracking'; state: 'none' | 'limited' | 'normal' }
  | { type: 'placed'; at: THREE.Vector3 }
  | { type: 'error'; message: string };

/**
 * What the physics world consumes to make the real room solid (the Realism track implements
 * `physics.setEnvironment(env)`): surfaces and mesh as colliders, the height under a point, and
 * conversions between metres and KIN-local units.
 */
export interface ArEnvironment {
  readonly active: boolean;
  /** KIN-local units per metre (≈ 7 when a KIN is ~14 cm tall). */
  readonly unitsPerMeter: number;
  /** Metres (world) → KIN-local, and back. */
  toLocal(meters: THREE.Vector3): THREE.Vector3;
  toMeters(local: THREE.Vector3): THREE.Vector3;
  surfaces(): readonly ArSurface[];
  meshChunks(): readonly ArMeshChunk[];
  /** Height (KIN-local y) of the highest horizontal real surface under local (x, z) that a KIN
   * standing at local height `fromY` could reach (within `step` units up), or null. */
  surfaceHeightAt(x: number, z: number, fromY?: number, step?: number): { y: number; kind: SurfaceKind } | null;
  /** Screen point (CSS px) → real surface. */
  raycast(x: number, y: number): Promise<ArHit | null>;
  on(fn: (e: ArEvent) => void): () => void;
}

// ── Capability ladder ────────────────────────────────────────────────────────────────────────
// Camera image and depth are independent layers, chosen from what THIS device really has and how
// it's doing right now (heat, battery, light, tracking), never assumed. The default on any
// camera-capable device is the live camera showing the real room (like Pokémon GO's AR+).

/**
 *  full         camera + LiDAR: the real room on screen, classified mesh, scene-depth + people occlusion
 *  camera       camera-only ARKit/WebXR: the real room, planes, raycast, people occlusion where supported
 *  room         LiDAR without the camera image: a softly-lit miniature of the real room's mesh.
 *               Opt-in ("Show camera" off) or the automatic fallback when it's too dark for video.
 *  camera-view  camera without tracking ("AR+ off"): video with gyro orientation, KIN on a virtual floor
 *  diorama      no camera, permission denied, unsupported, or AR off: the habitat
 */
export type ArTier = 'full' | 'camera' | 'room' | 'camera-view' | 'diorama';

export interface ArCapabilities {
  /** Running inside the iOS app with the KINAR plugin. */
  native: boolean;
  /** ARKit world tracking (iOS) or WebXR immersive-ar with hit-test (web). */
  tracking: boolean;
  lidar: boolean;
  sceneDepth: boolean;
  people: boolean;
  /** A camera exists, and its permission state. */
  camera: 'none' | 'denied' | 'undetermined' | 'granted';
  webxr: boolean;
  /** DeviceOrientation available (for camera-view). */
  gyro: boolean;
  /** e.g. 'iPhone16,2' (iPhone 15 Pro Max): informational, never the deciding signal. */
  model?: string;
}

export interface ArConditions {
  thermal: 'nominal' | 'fair' | 'serious' | 'critical';
  lowPower: boolean;
  /** 0..1, or null if unknown. */
  battery: number | null;
  charging: boolean;
  tracking: 'normal' | 'limited' | 'none' | 'unknown';
  /** ARKit ambient intensity in lumens (≈1000 neutral room), null if unknown. */
  lumens: number | null;
  memoryWarning: boolean;
}

export interface ArPrefs {
  /** The user wants AR at all (vs the habitat). */
  ar: boolean;
  /** "Show camera": off hides the video (room mode on LiDAR devices). On by default. */
  showCamera: boolean;
}

export interface ArFeatures {
  video: boolean;
  planes: boolean;
  mesh: boolean;
  sceneDepth: boolean;
  people: boolean;
  /** LiDAR mesh update cap (Hz); 0 keeps the last mesh. */
  meshHz: number;
  /** Occlusion depth update rate (Hz); 0 = off. */
  depthHz: number;
}

export interface TierChoice {
  tier: ArTier;
  /** Plain-language reason, shown on the tier badge. */
  reason: string;
  features: ArFeatures;
}
