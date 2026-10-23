// The ARKit bridge (ios/App/App/ARPlugin.swift, jsName "KINAR"). Commands go through the
// Capacitor plugin; the per-frame stream comes back through `window.__kinAR`, which the plugin
// calls with evaluateJavaScript (a compact number array per frame: no JSON, no base64).

import { Capacitor, registerPlugin } from '@capacitor/core';
import type { MeshPacket, PlanePacket } from './math';

export interface NativeSupport {
  supported: boolean;
  lidar: boolean;
  sceneDepth: boolean;
  smoothedSceneDepth: boolean;
  people: boolean;
  hasCamera: boolean;
  model: string;
  /** AVAuthorizationStatus: 0 not asked, 1 restricted, 2 denied, 3 allowed. */
  camera: number;
}

export interface NativeFeatures {
  video?: boolean;
  people?: boolean;
  mesh?: boolean;
  sceneDepth?: boolean;
  objects?: boolean;
  meshHz?: number;
  depthHz?: number;
}

export interface NativeConditions {
  thermal: 'nominal' | 'fair' | 'serious' | 'critical';
  lowPower: boolean;
  battery: number | null;
  charging: boolean;
  memoryWarning?: boolean;
}

interface KinArPlugin {
  isSupported(): Promise<NativeSupport>;
  conditions(): Promise<NativeConditions>;
  configure(o: NativeFeatures): Promise<{ ok: boolean }>;
  snapshot(o: { png: string }): Promise<{ shared: boolean }>;
  start(o: NativeFeatures): Promise<{ running: boolean; reason?: string }>;
  stop(): Promise<{ running: boolean }>;
  raycast(o: { x: number; y: number }): Promise<{ hit: boolean; position?: number[]; normal?: number[]; classification?: string; target?: string }>;
  stats(): Promise<Record<string, number>>;
}

export interface DepthPacket {
  w: number;
  h: number;
  any: boolean;
  b: string;
  /** 'scene' = LiDAR depth of everything; 'people' = person pixels only. */
  src?: 'scene' | 'people';
  /** Normalised screen → normalised camera-image affine (a, b, c, d, tx, ty). */
  t: number[];
}

export interface ObjectPacket {
  label: string;
  raw: string;
  conf: number;
  p: [number, number, number];
  ext: number;
  sx: number;
  sy: number;
}

export interface NativeSink {
  /** [time, tracking(0 none,1 limited,2 normal), projection×16, view×16, lumens, kelvin,
   *   reason(0 none,1 initializing,2 excessive motion,3 insufficient features,4 relocalizing)] */
  frame(a: number[]): void;
  conditions(c: NativeConditions): void;
  plane(p: PlanePacket): void;
  removed(id: string): void;
  mesh(p: MeshPacket): void;
  depth(p: DepthPacket): void;
  object(o: ObjectPacket): void;
  error(message: string): void;
}

export const nativeAvailable = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
const plugin = nativeAvailable ? registerPlugin<KinArPlugin>('KINAR') : null;

export const nativeAR = {
  available: nativeAvailable,
  async support(): Promise<NativeSupport | null> {
    if (!plugin) return null;
    try {
      return await plugin.isSupported();
    } catch {
      return null;
    }
  },
  start: (o: NativeFeatures = {}) => plugin?.start(o) ?? Promise.resolve({ running: false }),
  configure: (o: NativeFeatures) => plugin?.configure(o) ?? Promise.resolve({ ok: false }),
  conditions: async (): Promise<NativeConditions | null> => {
    try {
      return plugin ? await plugin.conditions() : null;
    } catch {
      return null;
    }
  },
  snapshot: (png: string) => plugin?.snapshot({ png }) ?? Promise.resolve({ shared: false }),
  stop: () => plugin?.stop() ?? Promise.resolve({ running: false }),
  raycast: (x: number, y: number) => plugin?.raycast({ x, y }) ?? Promise.resolve({ hit: false }),
  stats: () => plugin?.stats() ?? Promise.resolve({}),
  /** Route the native stream to `sink`. Returns a detach function. */
  attach(sink: NativeSink): () => void {
    const w = window as unknown as { __kinAR?: unknown };
    w.__kinAR = {
      f: (a: number[]) => sink.frame(a),
      p: (p: PlanePacket) => sink.plane(p),
      r: (id: string) => sink.removed(id),
      m: (p: MeshPacket) => sink.mesh(p),
      d: (p: DepthPacket) => sink.depth(p),
      o: (o: ObjectPacket) => sink.object(o),
      e: (m: string) => sink.error(m),
      c: (c: NativeConditions) => sink.conditions(c),
    };
    return () => {
      delete w.__kinAR;
    };
  },
};
