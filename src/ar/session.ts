// The native AR session (iOS, ARKit): KIN lives in the real room, Pokémon GO AR+ style.
//
//   • Camera: every ARKit frame sets the stage's AR camera (exact projection + pose), so the KIN
//     stays put in world space as you walk around it and get closer.
//   • Placement: KIN's world group sits on a real horizontal surface, scaled to ~14 cm tall, facing
//     you; it auto-places on the first floor/table in view with a little hop-in, and a tap moves it.
//   • Occlusion: LiDAR mesh renders depth-only (furniture hides KIN) and a depth pass writes the
//     real depth of everything (LiDAR) or of people (camera-only devices).
//   • Room mode (ladder tier 'room'): the same mesh drawn as a softly lit miniature of your room,
//     tinted per surface kind, when the camera image is hidden or it's too dark for video.
//   • Light: ARKit's ambient intensity and colour temperature drive the stage lights.
//   • Objects: recognised real things become 'object-seen' events in KIN-local coordinates.
//   • ArEnvironment: surfaces, mesh and height queries for the physics world.

import * as THREE from 'three';
import type { Stage } from '../render/stage';
import { decodeMesh, decodePlane, isNewSighting, kelvinToRgb, lumensToIntensity, surfaceUnder } from './math';
import { nativeAR, type DepthPacket, type NativeConditions, type NativeSupport, type ObjectPacket } from './native';
import { MESH_CLASS, type ArEnvironment, type ArEvent, type ArFeatures, type ArHit, type ArMeshChunk, type ArObject, type ArSurface, type SurfaceKind } from './types';

const TRACKING = ['none', 'limited', 'normal'] as const;
const REASON_HINT = ['', 'Getting to know your room…', 'Slow down a little so KIN can keep up.', 'KIN needs a little more light or texture to see the room.', 'Finding the room again…'];

/** Room-mode tints per LiDAR face class: calm, matte, readable at a glance. */
const ROOM_TINT: Record<(typeof MESH_CLASS)[number], string> = {
  none: '#3B4250', wall: '#4A5263', floor: '#6E8F86', ceiling: '#353B47', table: '#C9A27A', seat: '#9EA8FF', window: '#7FB4C9', door: '#8C7A66',
};

export interface ArSessionOptions {
  /** KIN height scale: world-group units → metres (0.14 ≈ a 14 cm KIN). */
  scale?: number;
  features?: ArFeatures;
  objects?: boolean;
}

export class NativeArSession implements ArEnvironment {
  active = false;
  placed = false;
  support: NativeSupport | null = null;
  tracking: (typeof TRACKING)[number] = 'none';
  trackingReason = 0;
  /** Smoothed ARKit ambient intensity (lumens). */
  lumens: number | null = null;
  conditions: NativeConditions | null = null;
  features: ArFeatures;
  private surfaceMap = new Map<string, ArSurface>();
  private chunks = new Map<string, ArMeshChunk>();
  private meshes = new Map<string, THREE.Mesh>();
  private listeners = new Set<(e: ArEvent) => void>();
  private sightings: ArObject[] = [];
  private detach: (() => void) | null = null;
  private occluderMats = MESH_CLASS.map(() => new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, side: THREE.DoubleSide }));
  private roomMats = MESH_CLASS.map((c) => new THREE.MeshStandardMaterial({ color: ROOM_TINT[c], roughness: 0.95, metalness: 0, side: THREE.DoubleSide, flatShading: false }));
  private depth: { mesh: THREE.Mesh; tex: THREE.DataTexture; mat: THREE.ShaderMaterial } | null = null;
  private frames = 0;
  private framesAt = performance.now();
  /** Frames/s actually delivered to the web layer (measured here, not claimed by native). */
  receivedFps = 0;
  private lightTick = 0;
  private placing = false;
  private lastPlaceTry = 0;
  private hintEl: HTMLElement | null = null;
  private entrance: { t0: number; at: THREE.Vector3; yaw: number } | null = null;

  constructor(private stage: Stage, private opts: ArSessionOptions = {}) {
    this.features = opts.features ?? { video: true, planes: true, mesh: true, sceneDepth: true, people: true, meshHz: 0.5, depthHz: 15 };
  }

  get unitsPerMeter() {
    return 1 / this.stage.ar.scale;
  }

  /** The room-mode look is on whenever the camera image is hidden. */
  get roomMode() {
    return !this.features.video;
  }

  async start(): Promise<boolean> {
    this.support = await nativeAR.support();
    if (!this.support?.supported) return false;
    this.detach = nativeAR.attach({
      frame: (a) => this.onFrame(a),
      conditions: (c) => {
        this.conditions = c;
        this.emit({ type: 'tracking', state: this.tracking });
      },
      plane: (p) => {
        const s = decodePlane(p);
        this.surfaceMap.set(s.id, s);
        this.emit({ type: 'surfaces' });
      },
      removed: (id) => {
        this.surfaceMap.delete(id);
        this.chunks.delete(id);
        const m = this.meshes.get(id);
        if (m) {
          this.stage.arOccluders.remove(m);
          m.geometry.dispose();
          this.meshes.delete(id);
        }
      },
      mesh: (p) => this.onMesh(decodeMesh(p)),
      depth: (p) => this.onDepth(p),
      object: (o) => this.onObject(o),
      error: (m) => {
        this.hint(`AR paused: ${m}`);
        this.emit({ type: 'error', message: m });
      },
    });
    this.conditions = await nativeAR.conditions();
    const r = await nativeAR.start({ ...this.native(this.features), objects: this.opts.objects ?? true });
    if (!r.running) {
      this.detach?.();
      return false;
    }
    this.stage.enterAR(this.opts.scale ?? 0.14);
    this.applyLook();
    this.active = true;
    this.hint('Move your phone slowly so KIN can find the floor or a table.');
    return true;
  }

  /** Switch tier features live; tracking and the KIN's place in the room are kept. */
  async configure(f: ArFeatures) {
    this.features = f;
    this.applyLook();
    await nativeAR.configure(this.native(f));
  }

  async stop() {
    this.active = false;
    this.placed = false;
    this.entrance = null;
    this.detach?.();
    this.detach = null;
    await nativeAR.stop();
    for (const m of this.meshes.values()) m.geometry.dispose();
    this.meshes.clear();
    this.stage.arOccluders.clear();
    if (this.depth) {
      this.depth.tex.dispose();
      this.depth.mat.dispose();
      this.depth.mesh.geometry.dispose();
      this.depth = null;
    }
    this.surfaceMap.clear();
    this.chunks.clear();
    this.stage.exitAR();
    document.documentElement.classList.remove('kin-ar', 'kin-room');
    this.hint('');
  }

  // ── ArEnvironment ────────────────────────────────────────────────────────────────────────

  toLocal(meters: THREE.Vector3) {
    return this.stage.world.worldToLocal(meters.clone());
  }

  toMeters(local: THREE.Vector3) {
    return this.stage.world.localToWorld(local.clone());
  }

  surfaces() {
    return [...this.surfaceMap.values()];
  }

  meshChunks() {
    return [...this.chunks.values()];
  }

  surfaceHeightAt(x: number, z: number, fromY = Infinity, step = Infinity) {
    const m = this.toMeters(new THREE.Vector3(x, Number.isFinite(fromY) ? fromY : 0, z));
    const fromM = Number.isFinite(fromY) ? m.y : Infinity;
    const stepM = Number.isFinite(step) ? step * this.stage.ar.scale : Infinity;
    const hit = surfaceUnder(this.surfaces(), m.x, m.z, fromM, stepM);
    if (!hit) return null;
    return { y: this.toLocal(new THREE.Vector3(m.x, hit.y, m.z)).y, kind: hit.kind };
  }

  async raycast(x: number, y: number): Promise<ArHit | null> {
    const r = await nativeAR.raycast(x, y);
    if (!r.hit || !r.position || !r.normal) return null;
    const position = new THREE.Vector3(...(r.position as [number, number, number]));
    return {
      position,
      normal: new THREE.Vector3(...(r.normal as [number, number, number])),
      kind: (r.classification ?? 'unknown') as SurfaceKind,
      local: this.toLocal(position),
    };
  }

  on(fn: (e: ArEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ── AR+ niceties ─────────────────────────────────────────────────────────────────────────

  /** The viewer (the phone) in KIN-local units: for "look at me" and walking toward you. */
  viewerLocal(): THREE.Vector3 {
    return this.toLocal(this.stage.arCamera.position.clone());
  }

  /** Move KIN's world to the real surface under a screen point (tap-to-place). */
  async placeAt(x: number, y: number): Promise<boolean> {
    const hit = await this.raycast(x, y);
    if (!hit || hit.normal.y < 0.7) return false; // horizontal surfaces only: floors, tables, seats
    this.placeOn(hit.position);
    return true;
  }

  /**
   * AR+ photo: render one frame, hand the canvas to native, which puts the real camera frame
   * underneath and opens the share sheet. Nothing is saved unless the player chooses to.
   */
  async snapshot(): Promise<boolean> {
    this.stage.render();
    const png = this.stage.renderer.domElement.toDataURL('image/png');
    const r = await nativeAR.snapshot(png);
    return r.shared;
  }

  async stats() {
    return { receivedFps: Math.round(this.receivedFps), ...(await nativeAR.stats()) };
  }

  // ── stream handlers ──────────────────────────────────────────────────────────────────────

  private onFrame(a: number[]) {
    if (a.length < 36) return;
    const tracking = TRACKING[a[1]! | 0] ?? 'none';
    const reason = a.length > 36 ? a[36]! | 0 : 0;
    if (tracking !== this.tracking || reason !== this.trackingReason) {
      this.tracking = tracking;
      this.trackingReason = reason;
      this.emit({ type: 'tracking', state: tracking });
      // Limited tracking: the KIN holds its last surface (the world group never moves on its own).
      if (tracking === 'limited') this.hint(REASON_HINT[reason] || 'Hold on…');
      else if (tracking === 'normal' && this.placed) this.hint('');
    }
    this.stage.setArCamera(a.slice(2, 18), a.slice(18, 34));
    if (this.depth) this.depth.mat.uniforms.uProj!.value.copy(this.stage.arCamera.projectionMatrix);
    const lm = a[34]!;
    this.lumens = this.lumens === null ? lm : this.lumens * 0.97 + lm * 0.03;
    if (++this.lightTick % 20 === 0) {
      const [r, g, b] = kelvinToRgb(a[35]!);
      // In room mode the miniature is lit for legibility, not by the (possibly dark) room.
      this.stage.setArLight(this.roomMode ? 1 : lumensToIntensity(this.lumens), new THREE.Color(r, g, b));
    }
    this.frames++;
    const now = performance.now();
    if (now - this.framesAt > 1000) {
      this.receivedFps = (this.frames * 1000) / (now - this.framesAt);
      this.frames = 0;
      this.framesAt = now;
    }
    if (this.entrance) this.stepEntrance(now);
    if (!this.placed && tracking === 'normal' && now - this.lastPlaceTry > 700) {
      this.lastPlaceTry = now;
      void this.autoPlace();
    }
  }

  /** Quick placement: the first good horizontal surface in the lower-middle of the view, 0.3–3 m away. */
  private async autoPlace() {
    if (this.placing) return;
    this.placing = true;
    try {
      const hit = await this.raycast(this.stage.w / 2, this.stage.h * 0.64);
      if (!hit || hit.normal.y < 0.8) return;
      const d = hit.position.distanceTo(this.stage.arCamera.position);
      if (d < 0.3 || d > 3) return;
      this.placeOn(hit.position);
      this.hint(hit.kind === 'table' ? 'KIN hopped onto the table. Tap anywhere to move it.' : 'Here we are. Tap a surface to move KIN.', 3200);
    } finally {
      this.placing = false;
    }
  }

  private placeOn(at: THREE.Vector3) {
    const cam = this.stage.arCamera.position;
    // Local +z (where the diorama camera sat) faces the viewer.
    const yaw = Math.atan2(cam.x - at.x, cam.z - at.z);
    this.entrance = { t0: performance.now(), at: at.clone(), yaw };
    this.placed = true;
    this.stepEntrance(performance.now());
    this.emit({ type: 'placed', at: at.clone() });
  }

  /** The hop-in: KIN's little world pops onto the surface from just above, with a soft overshoot. */
  private stepEntrance(now: number) {
    const e = this.entrance!;
    const k = Math.min(1, (now - e.t0) / 520);
    const s = this.stage.ar.scale;
    const back = 1 + 2.4 * (k - 1) ** 3 + 1.4 * (k - 1) ** 2; // easeOutBack
    const lift = (1 - k) * (1 - k) * 0.18;
    this.stage.placeWorld(new THREE.Vector3(e.at.x, e.at.y + lift, e.at.z), e.yaw, s);
    this.stage.world.scale.setScalar(s * Math.max(0.05, back));
    this.stage.world.updateMatrixWorld(true);
    if (k >= 1) {
      this.stage.placeWorld(e.at, e.yaw, s);
      this.entrance = null;
    }
  }

  private onMesh(c: ArMeshChunk) {
    this.chunks.set(c.id, c);
    // Faces grouped by class, so one mesh draws per-class materials (occluder or room tint).
    const n = c.faceClass.length;
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((a, b) => c.faceClass[a]! - c.faceClass[b]!);
    const Idx = c.indices instanceof Uint32Array ? Uint32Array : Uint16Array;
    const idx = new Idx(n * 3);
    const g = new THREE.BufferGeometry();
    let start = 0;
    for (let i = 0; i < n; i++) {
      const f = order[i]!;
      idx[i * 3] = c.indices[f * 3]!;
      idx[i * 3 + 1] = c.indices[f * 3 + 1]!;
      idx[i * 3 + 2] = c.indices[f * 3 + 2]!;
      const cls = c.faceClass[f]!;
      if (i === n - 1 || c.faceClass[order[i + 1]!] !== cls) {
        g.addGroup(start * 3, (i - start + 1) * 3, Math.min(cls, MESH_CLASS.length - 1));
        start = i + 1;
      }
    }
    g.setAttribute('position', new THREE.BufferAttribute(c.positions, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    if (this.roomMode) g.computeVertexNormals();
    let m = this.meshes.get(c.id);
    if (m) {
      m.geometry.dispose();
      m.geometry = g;
    } else {
      m = new THREE.Mesh(g, this.roomMode ? this.roomMats : this.occluderMats);
      m.matrixAutoUpdate = false;
      m.renderOrder = -10;
      m.frustumCulled = false;
      this.meshes.set(c.id, m);
      this.stage.arOccluders.add(m);
    }
    m.matrix.fromArray(c.transform);
    m.matrixWorldNeedsUpdate = true;
    this.emit({ type: 'mesh', id: c.id });
  }

  /** Swap the look for the current tier: camera image (occluders) or room miniature (tinted mesh). */
  private applyLook() {
    const room = this.roomMode;
    document.documentElement.classList.add('kin-ar');
    document.documentElement.classList.toggle('kin-room', room);
    for (const m of this.meshes.values()) {
      if (room && !m.geometry.getAttribute('normal')) m.geometry.computeVertexNormals();
      m.material = room ? this.roomMats : this.occluderMats;
      m.renderOrder = room ? 0 : -10;
    }
    if (this.depth) this.depth.mesh.visible = !room && this.features.depthHz > 0;
  }

  /**
   * Occlusion depth: a full-screen pass that writes the real depth (everything on LiDAR, people
   * otherwise) into the depth buffer with colour off, before KIN draws. Whatever is really in
   * front of KIN hides it.
   */
  private onDepth(p: DepthPacket) {
    if (this.roomMode) return;
    if (!this.depth) {
      const tex = new THREE.DataTexture(new Uint8Array(p.w * p.h), p.w, p.h, THREE.RedFormat, THREE.UnsignedByteType);
      tex.magFilter = tex.minFilter = THREE.LinearFilter;
      const mat = new THREE.ShaderMaterial({
        uniforms: { uDepth: { value: tex }, uProj: { value: new THREE.Matrix4() }, uT: { value: new Float32Array(6) }, uRes: { value: new THREE.Vector2(1, 1) } },
        vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: `
          uniform sampler2D uDepth; uniform mat4 uProj; uniform float uT[6]; uniform vec2 uRes;
          void main() {
            vec2 s = gl_FragCoord.xy / uRes; s.y = 1.0 - s.y;                 // normalised screen, top-left origin
            vec2 im = vec2(uT[0] * s.x + uT[2] * s.y + uT[4], uT[1] * s.x + uT[3] * s.y + uT[5]);
            if (im.x < 0.0 || im.y < 0.0 || im.x > 1.0 || im.y > 1.0) discard;
            float m = texture2D(uDepth, im).r * 255.0 / 50.0;                    // metres (0 = nothing)
            if (m < 0.02) discard;
            float z = -m;
            float cz = uProj[2][2] * z + uProj[3][2];
            float cw = uProj[2][3] * z + uProj[3][3];
            gl_FragDepth = (cz / cw) * 0.5 + 0.5;
            gl_FragColor = vec4(0.0);
          }`,
        depthTest: false,
        depthWrite: true,
        colorWrite: false,
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = -20;
      this.stage.arOccluders.add(mesh);
      this.depth = { mesh, tex, mat };
    }
    const { mesh, tex, mat } = this.depth;
    mesh.visible = p.any && this.features.depthHz > 0;
    if (!p.any) return;
    const bytes = Uint8Array.from(atob(p.b), (ch) => ch.charCodeAt(0));
    const data = tex.image.data as Uint8Array;
    if (bytes.length === data.length) {
      data.set(bytes);
      tex.needsUpdate = true;
    }
    (mat.uniforms.uT!.value as Float32Array).set(p.t.slice(0, 6));
    (mat.uniforms.uRes!.value as THREE.Vector2).copy(this.stage.renderer.getDrawingBufferSize(new THREE.Vector2()));
  }

  private onObject(o: ObjectPacket) {
    const now = Date.now();
    if (!isNewSighting(this.sightings, o.label, o.p, now)) return;
    const obj: ArObject = {
      label: o.label, raw: o.raw, confidence: o.conf, position: o.p, extent: o.ext,
      local: this.toLocal(new THREE.Vector3(...o.p)), seenAt: now,
    };
    this.sightings = [obj, ...this.sightings.filter((s) => now - s.seenAt < 60_000)].slice(0, 20);
    this.emit({ type: 'object-seen', object: obj });
  }

  /** Recently seen real objects, newest first (KIN-local positions refresh on read). */
  objects(): ArObject[] {
    return this.sightings.map((s) => ({ ...s, local: this.toLocal(new THREE.Vector3(...s.position)) }));
  }

  private native(f: ArFeatures) {
    return { video: f.video, mesh: f.mesh, sceneDepth: f.sceneDepth, people: f.people, meshHz: f.meshHz, depthHz: f.depthHz };
  }

  private emit(e: ArEvent) {
    for (const fn of this.listeners) fn(e);
  }

  private hintTimer = 0;
  /** A quiet, honest status line while AR finds its footing. */
  hint(text: string, ms = 0) {
    if (!this.hintEl) {
      this.hintEl = document.createElement('div');
      this.hintEl.className = 'ar-hint';
      this.hintEl.setAttribute('role', 'status');
      document.body.append(this.hintEl);
    }
    clearTimeout(this.hintTimer);
    this.hintEl.textContent = text;
    this.hintEl.classList.toggle('on', !!text);
    if (text && ms) this.hintTimer = window.setTimeout(() => this.hintEl?.classList.remove('on'), ms);
  }
}
