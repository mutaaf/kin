// The shape of the surroundings the KIN can stand on and bump into, beyond its own diorama.
// The AR track fills this from ARKit (detected planes; LiDAR scene-reconstruction meshes) and
// hands it to Physics.setEnvironment(); locomotion then plants feet on real tables and floors
// through the same groundAt() query it uses on the diorama lawn. All values are in WORLD units
// (the diorama's metres-ish scale: a KIN is about 0.9 units tall), already transformed by the
// AR track from ARKit's metres into this space.

export type SurfaceClass = 'floor' | 'table' | 'seat' | 'wall' | 'ceiling' | 'door' | 'window' | 'none' | (string & {});

export interface EnvPlane {
  id: string;
  /** Centre of the plane. */
  position: { x: number; y: number; z: number };
  /** Orientation as a quaternion [x, y, z, w]; the plane's normal is its local +Y. */
  rotation: [number, number, number, number];
  /** Full width (local X) and depth (local Z). */
  extent: [number, number];
  classification?: SurfaceClass;
}

export interface EnvMesh {
  id: string;
  /** Flat xyz triples in world units. */
  positions: Float32Array | number[];
  /** Triangle indices into `positions` (3 per face). */
  indices: Uint32Array | number[];
  /** Optional per-face class (one per triangle), e.g. from ARMeshClassification. */
  faceClass?: SurfaceClass[];
}

export interface ArEnvironment {
  planes: EnvPlane[];
  meshes: EnvMesh[];
  /**
   * 'augment' adds the surroundings next to the diorama; 'replace' removes the diorama's lawn,
   * garden walls and scenery colliders so only the real world holds things up (AR mode).
   */
  mode?: 'augment' | 'replace';
}

/** The fallback when physics hasn't loaded yet: the diorama lawn at y = 0. */
export const FLAT_GROUND = (_x: number, _z: number) => 0;
