// The stage: one small diorama under the real sky. Orthographic on purpose: a fixed
// pixels-per-unit scale means a KIN is the same size in every window on a screen (and nearly the
// same physical size across phones, since CSS px are ~0.16 mm on both platforms), which keeps
// the crossing seamless. The sky lives in CSS behind a transparent canvas: cheap, smooth, and
// crisp at any DPR.

import * as THREE from 'three';
import { rng } from '../core/rng';
import type { Sky } from '../env/sky';
import type { Pt } from './choreo';

const TILT = THREE.MathUtils.degToRad(31);
export const GROUND_Z: [number, number] = [-1.25, 1.35];

export interface Palette {
  top: string;
  mid: string;
  horizon: string;
  ground: THREE.Color;
  sun: THREE.Color;
  sunI: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiI: number;
  night: number; // 0..1
  glow: number; // emissive boost at night
}

const C = (h: string) => new THREE.Color(h);
const mix = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, Math.max(0, Math.min(1, t)));
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Sky palette from sun elevation and weather, built around the brand tones. */
export function palette(s: Pick<Sky, 'sunElev' | 'cloud' | 'precipMm' | 'snow' | 'tempC'>): Palette {
  const e = s.sunElev;
  const day = smooth(-4, 14, e); // 0 night → 1 full day
  const golden = smooth(-6, 2, e) * (1 - smooth(4, 16, e)); // peaks around sunrise/sunset
  const grey = Math.min(1, s.cloud * 0.75 + (s.precipMm > 0.1 ? 0.35 : 0));

  const nightTop = C('#0B0D12');
  const nightHz = C('#1A2140');
  const dayTop = C('#8FA0F0');
  const dayHz = C('#F6F6F3');
  const goldTop = C('#3B3A6E');
  const goldHz = C('#E9AF6B');
  const greyTop = C('#7C8492');
  const greyHz = C('#C9CDD3');

  let top = mix(nightTop, dayTop, day);
  let hz = mix(nightHz, dayHz, day);
  top = mix(top, goldTop, golden * 0.85);
  hz = mix(hz, goldHz, golden);
  const greyAmt = grey * (0.25 + 0.75 * day);
  top = mix(top, mix(greyTop, nightTop, 1 - day), greyAmt);
  hz = mix(hz, mix(greyHz, nightHz, 1 - day), greyAmt);
  if (s.tempC > 31 && day > 0.5) hz = mix(hz, C('#F3D9B1'), 0.4);
  const mid = mix(top, hz, 0.55);

  const groundDay = s.snow ? C('#E8ECF2') : C('#8FC9A9');
  const groundNight = s.snow ? C('#3A4258') : C('#1F3B3A');
  const ground = mix(mix(groundNight, groundDay, day), C('#C98F5C'), golden * 0.25);

  return {
    top: '#' + top.getHexString(),
    mid: '#' + mid.getHexString(),
    horizon: '#' + hz.getHexString(),
    ground,
    sun: mix(mix(C('#9DB4FF'), C('#FFC58A'), smooth(-6, 0, e)), C('#FFF6EA'), smooth(6, 30, e)),
    sunI: 0.35 + 2.2 * day * (1 - grey * 0.65),
    hemiSky: mix(C('#3A4A7A'), C('#DCE6FF'), day),
    hemiGround: mix(C('#0E1418'), C('#6E8F7E'), day),
    hemiI: 0.55 + 0.9 * day,
    night: 1 - day,
    glow: 0.4 + 1.4 * (1 - day),
  };
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera();
  readonly world = new THREE.Group();
  /** CSS px per world unit. */
  px = 0;
  w = 1;
  h = 1;
  private sun = new THREE.DirectionalLight('#fff', 2);
  private hemi = new THREE.HemisphereLight('#fff', '#444', 1);
  private plantLight = new THREE.PointLight('#6EE5CA', 0, 3.5, 1.6);
  /** Soft key from the viewer: the creature is always readable, even at midnight. */
  private fill = new THREE.DirectionalLight('#dfe6ff', 0.5);
  private groundMat = new THREE.MeshStandardMaterial({ color: '#8FC9A9', roughness: 1 });
  private mossMat = new THREE.MeshStandardMaterial({ color: '#9fd6b6', roughness: 1 });
  private grassMat: THREE.MeshStandardMaterial;
  private grassU = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.2, 0) } };
  private plantMat = new THREE.MeshStandardMaterial({ color: '#BFF5E6', emissive: '#6EE5CA', emissiveIntensity: 0.8, roughness: 0.3 });
  private rain: THREE.LineSegments;
  private snow: THREE.Points;
  private motes: THREE.Points;
  private pal: Palette | null = null;
  private skyEl: HTMLElement;
  private sunEl: HTMLElement;
  private starsEl: HTMLElement;
  sky: Sky | null = null;
  readonly ball: THREE.Mesh;
  readonly ballVel = new THREE.Vector3();
  /** Anchor points the brain's actions use (world coords on the ground). */
  readonly anchors = {
    nest: new THREE.Vector3(1.55, 0, -0.75),
    shelter: new THREE.Vector3(-1.45, 0, -0.55),
    plant: new THREE.Vector3(-0.55, 0, -1.05),
    sunny: new THREE.Vector3(0.35, 0, 0.55),
  };

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.ratio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setClearColor(0x000000, 0);
    host.appendChild(this.renderer.domElement);

    this.skyEl = el('div', 'sky');
    this.starsEl = el('div', 'stars');
    this.sunEl = el('div', 'sun');
    host.prepend(this.skyEl);
    this.skyEl.append(this.starsEl, this.sunEl);

    this.scene.add(this.world, this.hemi, this.sun, this.sun.target, this.fill);
    this.fill.position.set(0.5, 4, 10);
    this.scene.fog = new THREE.Fog('#F6F6F3', 20, 24.6);

    // Ground: a wide band that fades into the horizon fog at the back.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 26), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = 9.5;
    this.world.add(ground);
    this.mossMat.transparent = true;
    this.mossMat.alphaMap = radialTexture();
    this.mossMat.depthWrite = false;
    const moss = new THREE.Mesh(new THREE.CircleGeometry(2.6, 96), this.mossMat);
    moss.rotation.x = -Math.PI / 2;
    moss.scale.set(1.25, 0.62, 1);
    moss.position.set(0, 0.004, -0.1);
    this.world.add(moss);

    // Grass: instanced blades with a wind-sway vertex shader driven by the real wind.
    this.grassMat = new THREE.MeshStandardMaterial({ color: '#7DBF98', roughness: 0.9, side: THREE.DoubleSide, vertexColors: true });
    this.grassMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.grassU);
      sh.vertexShader = 'uniform float uTime; uniform vec2 uWind;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float hgt = clamp(position.y / 0.16, 0.0, 1.0);
         vec4 ip = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
         float ph = ip.x * 1.7 + ip.z * 2.3;
         float gust = 0.55 + 0.45 * sin(uTime * 0.7 + ip.x * 0.15);
         float sway = (length(uWind) * gust + 0.03) * (0.7 + 0.3 * sin(uTime * (2.0 + length(uWind) * 3.0) + ph));
         transformed.x += uWind.x * sway * hgt * hgt * 1.6 + 0.01 * sin(uTime * 1.3 + ph) * hgt;
         transformed.z += uWind.y * sway * hgt * hgt * 1.6;`,
      );
    };
    // A tapered, slightly bent blade with a darker base (vertex colours).
    const blade = new THREE.BufferGeometry();
    blade.setAttribute('position', new THREE.Float32BufferAttribute([-0.011, 0, 0, 0.011, 0, 0, -0.006, 0.07, 0.008, 0.006, 0.07, 0.008, 0.0, 0.15, 0.024], 3));
    blade.setAttribute('color', new THREE.Float32BufferAttribute([0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 1.15, 1.15, 1.15], 3));
    blade.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
    blade.computeVertexNormals();
    const N = 2600;
    const grass = new THREE.InstancedMesh(blade, this.grassMat, N);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const r = rng(7);
    for (let i = 0; i < N; i++) {
      const x = (r() - 0.5) * 30;
      const z = -2.8 + r() * 9;
      // keep the creature's lawn readable: sparser near the centre
      // keep the lawn readable: sparse in the middle, tufts toward the edges and the back
      const s = Math.hypot(x / 1.3, z / 0.8) < 1.6 ? 0.4 + r() * 0.35 : 0.65 + r() * 0.6;
      q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.3, r() * Math.PI, (r() - 0.5) * 0.3));
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s * (0.8 + r() * 0.7), s));
      grass.setMatrixAt(i, m);
    }
    this.world.add(grass);

    this.buildDecor();

    // Ball toy.
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 24, 16),
      new THREE.MeshPhysicalMaterial({ color: '#E9AF6B', roughness: 0.35, clearcoat: 0.6 }),
    );
    this.ball.position.set(0.85, 0.11, 0.65);
    this.world.add(this.ball);

    // Weather particles, sized to the view in resize().
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(500 * 6), 3));
    this.rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#cfe0ff', transparent: true, opacity: 0.45 }));
    this.rain.frustumCulled = false;
    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(380 * 3), 3));
    this.snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 4, sizeAttenuation: false, transparent: true, opacity: 0.85 }));
    this.snow.frustumCulled = false;
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(60 * 3), 3));
    this.motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: '#fff3d6', size: 2.5, sizeAttenuation: false, transparent: true, opacity: 0.7 }));
    this.motes.frustumCulled = false;
    this.scene.add(this.rain, this.snow, this.motes);
    this.seedParticles();

    this.resize();
  }

  private buildDecor() {
    const porcelain = new THREE.MeshStandardMaterial({ color: '#F6F6F3', roughness: 0.55 });
    const amber = new THREE.MeshStandardMaterial({ color: '#E9AF6B', roughness: 0.6 });
    const stemMat = new THREE.MeshStandardMaterial({ color: '#5E9E83', roughness: 0.8 });

    // Mushroom shelter (the "shelter" anchor): porcelain cap with amber freckles.
    const mush = new THREE.Group();
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 0.55, 48), porcelain);
    const gills = new THREE.Mesh(new THREE.CircleGeometry(0.6, 64), new THREE.MeshStandardMaterial({ color: '#CDBFA9', roughness: 0.9, side: THREE.DoubleSide }));
    gills.rotation.x = Math.PI / 2;
    gills.position.y = 0.515;
    mush.add(gills);
    stalk.position.y = 0.27;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.62, 96, 32, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#E7DCCB', roughness: 0.5 }));
    cap.scale.set(1, 0.55, 1);
    cap.position.y = 0.52;
    mush.add(stalk, cap);
    const r = rng(3);
    for (let i = 0; i < 7; i++) {
      const a = r() * Math.PI * 2;
      const rad = 0.2 + r() * 0.3;
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.045 + r() * 0.03, 12, 8), amber);
      const y = 0.52 + Math.sqrt(Math.max(0, 1 - (rad / 0.62) ** 2)) * 0.62 * 0.55;
      d.position.set(Math.cos(a) * rad, y, Math.sin(a) * rad);
      d.scale.y = 0.4;
      mush.add(d);
    }
    mush.position.set(-1.6, 0, -0.85);
    this.world.add(mush);

    // Glowing plant: the night-light of the terrarium.
    const plant = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const h = 0.38 + i * 0.14;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, h, 6), stemMat);
      stem.position.set((i - 1) * 0.07, h / 2, (i % 2) * 0.05);
      stem.rotation.z = (i - 1) * 0.18;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055 + i * 0.012, 16, 12), this.plantMat);
      bulb.position.set((i - 1) * 0.07 + (i - 1) * h * -0.18, h, (i % 2) * 0.05);
      plant.add(stem, bulb);
    }
    plant.position.copy(this.anchors.plant);
    this.plantLight.position.set(this.anchors.plant.x, 0.6, this.anchors.plant.z + 0.2);
    this.world.add(plant, this.plantLight);

    // Nest: a soft woven ring to sleep in.
    const nest = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.11, 32, 96), new THREE.MeshStandardMaterial({ color: '#C9A27A', roughness: 0.95 }));
    nest.rotation.x = -Math.PI / 2;
    nest.scale.set(1, 0.8, 0.8);
    nest.position.set(this.anchors.nest.x, 0.07, this.anchors.nest.z);
    const cushion = new THREE.Mesh(new THREE.CircleGeometry(0.34, 32), new THREE.MeshStandardMaterial({ color: '#9EA8FF', roughness: 1 }));
    cushion.rotation.x = -Math.PI / 2;
    cushion.scale.y = 0.8;
    cushion.position.set(this.anchors.nest.x, 0.03, this.anchors.nest.z);
    this.world.add(nest, cushion);

    // A few pebbles for scale.
    const peb = new THREE.MeshStandardMaterial({ color: '#D8D4CC', roughness: 0.8 });
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.05 + r() * 0.05, 32, 16), peb);
      p.scale.y = 0.5;
      p.position.set(-2.4 + r() * 4.8, 0.02, 0.6 + r() * 0.8);
      this.world.add(p);
    }
  }

  /** Comfortable solo scale for this screen. */
  private soloPx() {
    const coarse = matchMedia('(pointer: coarse)').matches;
    // Phones: a constant scale, so the KIN is the same physical size on any phone.
    // Desktop: derived from the screen, so every window on a display agrees.
    // Tablets show more habitat AND a larger creature.
    const tablet = coarse && Math.min(this.w, this.h) >= 700;
    return coarse ? (tablet ? 165 : 118) : Math.max(100, Math.min(170, screen.height / 6.2));
  }

  /**
   * When linked to another device, ease to a shared *physical* size (~19 mm per world unit) so a
   * KIN doesn't grow or shrink as it crosses from a phone to an iPad. CSS px are ~0.157 mm on
   * iPhone, ~0.16 on Android phones, ~0.19 on iPad.
   */
  matchPhysical(on: boolean) {
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.physical = on && coarse;
    if (!this.physical) {
      this.pxTarget = this.soloPx();
      return;
    }
    const tablet = Math.min(this.w, this.h) >= 700;
    const ipadOS = /iPad|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
    const mmPerPx = tablet ? (ipadOS ? 0.19 : 0.17) : /iPhone/.test(navigator.userAgent) ? 0.157 : 0.16;
    this.pxTarget = 19 / mmPerPx;
  }
  private physical = false;
  private pxTarget = 0;

  resize() {
    const w = this.host.clientWidth || innerWidth;
    const h = this.host.clientHeight || innerHeight;
    this.w = w;
    this.h = h;
    if (!this.physical) this.pxTarget = this.soloPx();
    if (!this.px || Math.abs(this.px - this.pxTarget) > 60) this.px = this.pxTarget;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.frame();
  }

  /** Camera framing for the current scale. Cheap; runs every frame while the scale eases. */
  private frame() {
    const w = this.w;
    const h = this.h;
    const hw = w / 2 / this.px;
    const hh = h / 2 / this.px;
    Object.assign(this.camera, { left: -hw, right: hw, top: hh, bottom: -hh, near: 0.1, far: 60 });
    const target = new THREE.Vector3(0, 0.55 + Math.max(0, hh - 3.2) * 0.35, 0);
    this.camera.position.set(0, target.y + Math.sin(TILT) * 20, Math.cos(TILT) * 20);
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
    this.layoutSky();
  }

  /** Local CSS px → point on the horizontal plane at `height`. */
  toWorld(p: Pt, height = 0): THREE.Vector3 {
    const ndc = new THREE.Vector3((p.x / this.w) * 2 - 1, -(p.y / this.h) * 2 + 1, -1).unproject(this.camera);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const t = (height - ndc.y) / dir.y;
    return ndc.add(dir.multiplyScalar(t));
  }

  /** World point → local CSS px. */
  toScreen(v: THREE.Vector3): Pt {
    const p = v.clone().project(this.camera);
    return { x: (p.x + 1) * 0.5 * this.w, y: (1 - p.y) * 0.5 * this.h };
  }

  /** World x just beyond the left/right edge, at depth z (where a KIN is fully off-screen). */
  edgeX(edge: 'left' | 'right', z: number, margin = 0.6): number {
    const p = this.toWorld({ x: edge === 'left' ? 0 : this.w, y: this.toScreen(new THREE.Vector3(0, 0, z)).y });
    return p.x + (edge === 'left' ? -margin : margin);
  }

  setSky(s: Sky) {
    this.sky = s;
    const p = palette(s);
    this.pal = p;
    this.skyEl.style.background = this.skyGradient();
    this.starsEl.style.opacity = String(Math.max(0, p.night - 0.35) * (1 - s.cloud * 0.9));
    (this.scene.fog as THREE.Fog).color.set(p.horizon);
    this.groundMat.color.copy(p.ground);
    this.mossMat.color.copy(p.ground).offsetHSL(0.01, 0.02, 0.05);
    this.grassMat.color.copy(p.ground).offsetHSL(0.0, 0.08, 0.04 + p.night * 0.06);
    this.hemi.color.copy(p.hemiSky);
    this.hemi.groundColor.copy(p.hemiGround);
    this.hemi.intensity = p.hemiI;
    this.sun.color.copy(p.sun);
    this.sun.intensity = p.sunI;
    // Light from the real sun direction (az measured from north; the diorama faces south).
    const el = THREE.MathUtils.degToRad(Math.max(8, s.sunElev < 0 ? 35 : s.sunElev));
    const az = THREE.MathUtils.degToRad((s.sunElev < 0 ? 200 : s.sunAz) - 180);
    this.sun.position.set(Math.sin(az) * Math.cos(el) * 10, Math.sin(el) * 10, Math.cos(az) * Math.cos(el) * 10);
    this.plantMat.emissiveIntensity = 0.35 + p.glow * 0.6;
    this.plantLight.intensity = p.night * 2.2;
    this.fill.intensity = 0.35 + p.night * 1.1;
    const wind = Math.min(1, s.windKmh / 45);
    const dir = THREE.MathUtils.degToRad(s.windDir + 180); // blows toward
    this.grassU.uWind.value.set(Math.sin(dir) * wind * 0.5, -Math.cos(dir) * wind * 0.2);
    this.layoutSky();
  }

  get glow() {
    return this.pal?.glow ?? 0.5;
  }

  /** The horizon colour lands exactly where the meadow fades out, so there is no seam line. */
  private skyGradient() {
    const p = this.pal!;
    const hy = Math.max(40, this.toScreen(new THREE.Vector3(0, 0, -3.4)).y);
    return `linear-gradient(180deg, ${p.top} 0px, ${p.mid} ${Math.round(hy * 0.62)}px, ${p.horizon} ${Math.round(hy)}px, ${p.horizon} 100%)`;
  }

  private layoutSky() {
    if (!this.sky) return;
    if (this.pal) this.skyEl.style.background = this.skyGradient();
    const s = this.sky;
    const horizonY = this.toScreen(new THREE.Vector3(0, 0, -3.4)).y;
    const night = s.sunElev < -4;
    const az = night ? 200 : s.sunAz;
    const x = 0.5 + Math.max(-0.45, Math.min(0.45, ((az - 180) / 120) * 0.45));
    const elev = night ? 35 : Math.max(-4, s.sunElev);
    const y = horizonY - (elev / 70) * horizonY * 0.9;
    this.sunEl.style.transform = `translate(${x * this.w - 30}px, ${y - 30}px)`;
    this.sunEl.classList.toggle('moon', night);
    this.sunEl.style.opacity = String(night ? 0.85 * (1 - s.cloud * 0.8) : Math.max(0, 1 - s.cloud * 0.85) * smooth(-5, 2, s.sunElev));
  }

  private seedParticles() {
    const r = Math.random;
    const rp = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < rp.count; i += 2) {
      const x = (r() - 0.5) * 24;
      const y = r() * 9;
      const z = -2.5 + r() * 5;
      rp.setXYZ(i, x, y, z);
      rp.setXYZ(i + 1, x, y - 0.25, z);
    }
    for (const pts of [this.snow, this.motes]) {
      const a = pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < a.count; i++) a.setXYZ(i, (r() - 0.5) * 24, r() * 7, -2.5 + r() * 5);
    }
  }

  update(dt: number, t: number) {
    this.grassU.uTime.value = t;
    if (this.pxTarget && Math.abs(this.px - this.pxTarget) > 0.3) {
      this.px += (this.pxTarget - this.px) * Math.min(1, dt * 2.5);
      this.frame();
    }
    const s = this.sky;
    if (!s) return;
    const wet = s.precipMm > 0.1;
    const wind = Math.min(1.5, s.windKmh / 30);
    const dir = THREE.MathUtils.degToRad(s.windDir + 180);
    const wx = Math.sin(dir) * wind;
    const halfW = this.w / 2 / this.px + 1.5;

    this.rain.visible = wet && !s.snow;
    if (this.rain.visible) {
      const a = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
      const n = Math.min(a.count, Math.floor(80 + s.precipMm * 120)) & ~1;
      this.rain.geometry.setDrawRange(0, n);
      const fall = 11 * dt;
      for (let i = 0; i < n; i += 2) {
        let x = a.getX(i) + wx * 2.2 * dt;
        let y = a.getY(i) - fall;
        if (y < 0) {
          y += 9;
          x = (Math.random() - 0.5) * halfW * 2;
        }
        if (x > halfW) x -= halfW * 2;
        if (x < -halfW) x += halfW * 2;
        a.setXYZ(i, x, y, a.getZ(i));
        a.setXYZ(i + 1, x - wx * 0.05, y - 0.28, a.getZ(i));
      }
      a.needsUpdate = true;
    }

    this.snow.visible = wet && s.snow;
    if (this.snow.visible) {
      const a = this.snow.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < a.count; i++) {
        let x = a.getX(i) + (wx * 0.8 + Math.sin(t * 1.3 + i) * 0.15) * dt;
        let y = a.getY(i) - (0.6 + (i % 5) * 0.08) * dt;
        if (y < 0) y += 7;
        if (x > halfW) x -= halfW * 2;
        if (x < -halfW) x += halfW * 2;
        a.setXYZ(i, x, y, a.getZ(i));
      }
      a.needsUpdate = true;
    }

    // Motes: pollen by day, fireflies at night, blown by the wind.
    const m = this.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
    const night = (this.pal?.night ?? 0) > 0.6;
    (this.motes.material as THREE.PointsMaterial).color.set(night ? '#c8ffe9' : '#fff3d6');
    (this.motes.material as THREE.PointsMaterial).opacity = night ? 0.4 + 0.4 * Math.sin(t * 2) ** 2 : 0.5;
    this.motes.visible = !wet;
    for (let i = 0; i < m.count; i++) {
      let x = m.getX(i) + (wx * 0.9 + Math.sin(t * 0.5 + i * 1.7) * 0.12) * dt;
      const y = 0.3 + ((i * 0.37) % 2.4) + Math.sin(t * 0.8 + i) * 0.2;
      if (x > halfW) x -= halfW * 2;
      if (x < -halfW) x += halfW * 2;
      m.setXYZ(i, x, y, m.getZ(i));
    }
    m.needsUpdate = true;

    // Ball: rolls with friction, nudged by the wind.
    const b = this.ball;
    this.ballVel.x += wx * 0.04 * dt;
    b.position.addScaledVector(this.ballVel, dt);
    this.ballVel.multiplyScalar(Math.pow(0.35, dt));
    b.position.z = Math.max(GROUND_Z[0], Math.min(GROUND_Z[1], b.position.z));
    const lim = Math.max(1.2, this.w / 2 / this.px - 0.4);
    if (Math.abs(b.position.x) > lim) {
      b.position.x = Math.sign(b.position.x) * lim;
      this.ballVel.x *= -0.6;
    }
    b.rotation.z -= (this.ballVel.x * dt) / 0.11;
    b.rotation.x += (this.ballVel.z * dt) / 0.11;
  }

  /**
   * Resolution governor. Measure, then degrade gracefully: if frames run long, render fewer
   * pixels before dropping frames (the creature's motion matters more than its edge crispness).
   */
  private ratio = Math.min(Math.min(innerWidth, innerHeight) < 600 ? 3 : 2, devicePixelRatio || 1);
  private slow = 0;
  govern(dt: number) {
    this.slow = dt > 1 / 45 ? this.slow + dt : Math.max(0, this.slow - dt * 0.5);
    if (this.slow > 1.5 && this.ratio > 1) {
      this.ratio = Math.max(1, this.ratio - 0.5);
      this.renderer.setPixelRatio(this.ratio);
      this.resize();
      this.slow = 0;
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

/** Soft radial falloff, so the garden melts into the meadow instead of ending at a hard edge. */
function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(128, 128, 30, 128, 128, 128);
  grd.addColorStop(0, '#fff');
  grd.addColorStop(0.62, '#fff');
  grd.addColorStop(1, '#000');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

function el(tag: string, cls: string) {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

