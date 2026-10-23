// The far world. The stage camera is orthographic (a world unit is a fixed number of pixels, so
// crossings line up), which means "far away" can't be done with perspective. Instead the far
// world is a camera-facing layer that rides behind the camera's look target: its contents are laid
// out in screen-height units, sized to whatever the camera director is framing, with per-layer
// parallax as the camera follows the KIN. Sky gradient, sun and moon from the real sun angle,
// stars, drifting cloud banks, distant floating islands with waterfalls, mountain silhouettes.

import * as THREE from 'three';
import type { Palette } from '../render/stage';
import type { Sky } from '../env/sky';
import { rng } from '../core/rng';
import { island, puff, type Uniforms } from './kit';

export interface BackdropOpts {
  seed: number;
  /** 'open' sky (meadow, grove) or an enclosed 'cave'. */
  kind: 'open' | 'cave';
  islands?: number;
  /** Silhouette ridges (forest, mountains): colour family. */
  ridges?: { hue: number; sat: number; light: number; count: number; jag: number }[];
  u: Uniforms;
}

const DIST = 20; // camera distance from its target (camera.ts / Stage)
const BEHIND = 14; // how far behind the target the layer sits (camera far plane is 60)

const hazeMat = (base: THREE.Color, u: { uHaze: { value: THREE.Color }; uHazeAmt: { value: number } }, amt: number) => {
  const m = new THREE.MeshLambertMaterial({ color: base, fog: false, side: THREE.DoubleSide });
  m.onBeforeCompile = (s) => {
    s.uniforms.uHaze = u.uHaze;
    s.uniforms.uHazeAmt = { value: amt };
    s.fragmentShader = 'uniform vec3 uHaze; uniform float uHazeAmt;\n' + s.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, uHazeAmt);`,
    );
  };
  return m;
};

export class Backdrop {
  readonly group = new THREE.Group();
  private skyMat: THREE.ShaderMaterial;
  private sun: THREE.Sprite;
  private sunGlow: THREE.Sprite;
  private moon: THREE.Sprite;
  private stars: THREE.Points;
  private clouds: { s: THREE.Sprite; speed: number; base: THREE.Vector3; layer: number }[] = [];
  private layers: { g: THREE.Group; k: number }[] = [];
  private haze = { uHaze: { value: new THREE.Color('#ccd6f0') }, uHazeAmt: { value: 0.5 } };
  private shooting: { line: THREE.Line; t: number; from: THREE.Vector3; to: THREE.Vector3 } | null = null;
  private night = 0;
  private aspect = 1;
  private readonly horizon = new THREE.Group();
  /** Screen height of the garden's far edge, in layer units (-0.5 bottom … 0.5 top). */
  private hz = 0.15;
  private placed = false;
  private sunY = 0.2;
  private sunX = 0;
  private moonX = 0.35;

  constructor(private o: BackdropOpts) {
    const g = this.group;
    g.renderOrder = -10;
    // 1. Sky gradient (or the cave's dark vault).
    this.skyMat = new THREE.ShaderMaterial({
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: { uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHz: { value: new THREE.Color() }, uHy: { value: -0.12 }, uCave: { value: o.kind === 'cave' ? 1 : 0 }, uTime: o.u.uTime },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHz; uniform float uHy; uniform float uCave; uniform float uTime; varying vec2 vP;
        void main(){
          float t = clamp((vP.y - uHy) / (0.62 - uHy), 0.0, 1.0);
          vec3 c = mix(uHz, uMid, smoothstep(0.0, 0.45, t));
          c = mix(c, uTop, smoothstep(0.35, 1.0, t));
          if (vP.y < uHy) c = mix(uHz, uHz * 0.86, clamp((uHy - vP.y) * 2.0, 0.0, 1.0));
          if (uCave > 0.5) { float v = 1.0 - length(vP * vec2(0.8, 1.1)); c = mix(vec3(0.03,0.025,0.06), c, clamp(v, 0.0, 1.0)); }
          // gentle dither against banding
          c += (fract(sin(dot(vP, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), this.skyMat);
    sky.position.z = -0.6;
    sky.renderOrder = -20;
    g.add(sky);

    // 2. Sun, its glow, and the moon.
    const glowTex = puff('rgba(255,236,200,1)', 'rgba(255,220,170,0)');
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, transparent: true }));
    this.sunGlow.scale.setScalar(0.55);
    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff('rgba(255,252,240,1)', 'rgba(255,250,235,0)', 64), depthWrite: false, fog: false, transparent: true }));
    this.sun.scale.setScalar(0.09);
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTexture(), depthWrite: false, fog: false, transparent: true }));
    this.moon.scale.setScalar(0.11);
    for (const s of [this.sunGlow, this.sun, this.moon]) {
      s.position.z = -0.55;
      s.renderOrder = -19;
    }
    g.add(this.sunGlow, this.sun, this.moon);
    // Underground there is no sky to see.
    if (o.kind === 'cave') this.sun.visible = this.sunGlow.visible = this.moon.visible = false;

    // 3. Stars (twinkle in the shader; fade with daylight).
    const r = rng(o.seed);
    const sp: number[] = [];
    const ss: number[] = [];
    for (let i = 0; i < 420; i++) {
      sp.push((r() - 0.5) * 7, -0.1 + r() * 1.4, -0.58);
      ss.push(0.6 + r() * r() * 2.4);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.setAttribute('size', new THREE.Float32BufferAttribute(ss, 1));
    this.stars = new THREE.Points(
      sg,
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
        uniforms: { uTime: o.u.uTime, uA: { value: 0 }, uDpr: { value: Math.min(3, devicePixelRatio || 1) } },
        vertexShader: 'attribute float size; uniform float uTime; uniform float uDpr; varying float vT; void main(){ vT = sin(uTime*1.7 + position.x*13.0 + position.y*7.0)*0.35+0.65; gl_PointSize = size*uDpr; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
        fragmentShader: 'uniform float uA; varying float vT; void main(){ vec2 c = gl_PointCoord-0.5; float d = length(c); float a = smoothstep(0.5,0.0,d); gl_FragColor = vec4(vec3(1.0,0.97,0.92), a*uA*vT); }',
      }),
    );
    this.stars.renderOrder = -19;
    g.add(this.stars);
    this.stars.visible = o.kind !== 'cave';

    // Everything that sits on the horizon hangs off this group, re-placed every frame where the
    // garden's far edge actually lands on screen (it moves with each camera shot).
    g.add(this.horizon);

    // 4. Far silhouettes: ridges (mountains/forest) at increasing nearness.
    for (const [i, rd] of (o.ridges ?? []).entries()) {
      const layer = new THREE.Group();
      const base = new THREE.Color().setHSL(rd.hue / 360, rd.sat, rd.light);
      layer.add(ridge(o.seed + i * 17, rd.count, rd.jag, 0.0 - i * 0.025, hazeMat(base, this.haze, 0.65 - i * 0.18)));
      layer.position.z = -0.5 + i * 0.03;
      this.horizon.add(layer);
      this.layers.push({ g: layer, k: 0.04 + i * 0.05 });
    }

    // 5. Distant floating islands, each with a sliver of waterfall and a mist puff.
    if (o.kind === 'open') {
      const isl = new THREE.Group();
      const n = o.islands ?? 4;
      for (let i = 0; i < n; i++) {
        const s = 0.016 + r() * 0.03;
        const top = new THREE.Color().setHSL(0.33 + r() * 0.06, 0.45, 0.42);
        const rock = new THREE.Color().setHSL(0.075, 0.32, 0.5);
        const isle = island({ rx: 1.4, rz: 1, seed: o.seed + i * 31, depth: 2.2, top, rock, flatX: 0.2, flatZ: [-0.1, 0.1], rough: 0.8, backRise: 0.3 });
        const im = hazeMat(new THREE.Color('#ffffff'), this.haze, 0.18 + (1 - s / 0.046) * 0.3);
        im.vertexColors = true;
        (isle.mesh as THREE.Mesh).material = im;
        isle.mesh.scale.setScalar(s);
        const holder = new THREE.Group();
        holder.add(isle.mesh);
        // Tiny trees on top.
        for (let k = 0; k < 3; k++) {
          const t = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.9, 6), hazeMat(new THREE.Color().setHSL(0.36, 0.4, 0.3), this.haze, 0.4));
          t.scale.setScalar(s);
          t.position.set((r() - 0.5) * s * 1.6, s * 0.45, 0);
          holder.add(t);
        }
        // Waterfall: a thin bright ribbon with flowing streaks.
        if (r() < 0.75) {
          const wf = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 2.6), waterfallMat(o.u));
          wf.scale.setScalar(s);
          wf.position.set(s * (0.4 + r() * 0.5), -s * 1.35, 0.01);
          holder.add(wf);
        }
        // Spread across the width, floating a little above the horizon (never behind the garden).
        const x = (i / Math.max(1, n - 1) - 0.5) * 2.2 + (r() - 0.5) * 0.35;
        holder.position.set(x, 0.05 + s * 2.2 + r() * 0.16, -0.48 + r() * 0.02);
        holder.rotation.y = r() * 0.6;
        isl.add(holder);
      }
      this.horizon.add(isl);
      this.layers.push({ g: isl, k: 0.08 });
    }

    // 6. Clouds: banks of soft puffs, a sea of cloud below the horizon, slow drift.
    const cloudTex = puff('rgba(255,255,255,0.95)', 'rgba(255,255,255,0)');
    const bank = (cx: number, cy: number, w: number, layer: number, count: number, size: number) => {
      for (let i = 0; i < count; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0.8 }));
        s.scale.set(size * (0.7 + r() * 0.8), size * (0.45 + r() * 0.35), 1);
        const base = new THREE.Vector3(cx + (r() - 0.5) * w, cy + (r() - 0.5) * size * 0.35, -0.45 + layer * 0.01);
        s.position.copy(base);
        s.renderOrder = -18 + layer;
        this.horizon.add(s);
        this.clouds.push({ s, speed: (0.004 + r() * 0.006) * (layer + 1), base, layer });
      }
    };
    if (o.kind === 'open') {
      // High cloud banks, and a sea of cloud lapping at the horizon around the island.
      // (relative to the horizon, which sits around the upper third: keep them in frame)
      for (let i = 0; i < 6; i++) bank((r() - 0.5) * 4, 0.13 + r() * 0.2, 0.6, 0, 6, 0.2);
      for (let i = 0; i < 7; i++) bank((i / 6 - 0.5) * 5, 0.035 + r() * 0.02, 0.9, 1, 9, 0.26);
    } else {
      // A cave: glowing motes of crystal light in the dark instead of clouds.
      const glow = puff('rgba(200,170,255,1)', 'rgba(160,120,255,0)');
      for (let i = 0; i < 40; i++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, opacity: 0.35 + r() * 0.4 }));
        s.scale.setScalar(0.02 + r() * 0.06);
        const base = new THREE.Vector3((r() - 0.5) * 4, -0.1 + r() * 0.7, -0.47);
        s.position.copy(base);
        this.horizon.add(s);
        this.clouds.push({ s, speed: 0.002 + r() * 0.004, base, layer: 0 });
      }
    }
    for (const c of g.children) c.traverse((o2) => ((o2 as THREE.Mesh).frustumCulled = false));
  }

  setSky(s: Sky, p: Palette) {
    const u = this.skyMat.uniforms;
    if (this.o.kind === 'cave') {
      // Underground: the vault keeps its own dark violet whatever the hour outside.
      (u.uTop!.value as THREE.Color).set('#07060c');
      (u.uMid!.value as THREE.Color).set('#130f20');
      (u.uHz!.value as THREE.Color).set('#221a36');
      this.haze.uHaze.value.set('#1a1428');
    } else {
      (u.uTop!.value as THREE.Color).set(p.top);
      (u.uMid!.value as THREE.Color).set(p.mid);
      (u.uHz!.value as THREE.Color).set(p.horizon);
      this.haze.uHaze.value.set(p.horizon);
    }
    this.night = p.night;
    (this.stars.material as THREE.ShaderMaterial).uniforms.uA!.value = Math.max(0, p.night - 0.3) * (1 - s.cloud * 0.85) * 1.4;
    // Sun / moon across the sky from the real azimuth and elevation (the garden faces south).
    const az = s.sunAz ?? 180;
    const x = THREE.MathUtils.clamp(((az - 180) / 110) * 1.1, -1.4, 1.4);
    const elev = Math.max(-8, s.sunElev);
    // Height above the horizon (the horizon itself is placed per frame in update()).
    this.sunX = x;
    this.sunY = (elev / 60) * 0.6;
    this.moonX = -x * 0.6 + 0.35;
    const cloudy = 1 - s.cloud * 0.8;
    const sunUp = THREE.MathUtils.smoothstep(elev, -4, 3);
    (this.sun.material as THREE.SpriteMaterial).opacity = sunUp * cloudy;
    (this.sunGlow.material as THREE.SpriteMaterial).opacity = sunUp * cloudy * (0.55 + (1 - THREE.MathUtils.smoothstep(elev, 2, 20)) * 0.45);
    (this.sunGlow.material as THREE.SpriteMaterial).color.copy(p.sun);
    this.sunGlow.scale.setScalar(0.4 + (1 - THREE.MathUtils.smoothstep(elev, 0, 25)) * 0.5);
    (this.moon.material as THREE.SpriteMaterial).opacity = p.night * cloudy * 0.95;
    // Clouds take the light of the hour: white by day, peach at golden hour, slate at night.
    const day = 1 - p.night;
    const cc = new THREE.Color(p.horizon).lerp(new THREE.Color('#ffffff'), 0.55 * day + 0.1).lerp(new THREE.Color('#2b3350'), p.night * 0.55);
    const grey = Math.min(1, s.cloud * 0.6 + (s.precipMm > 0.1 ? 0.35 : 0));
    cc.lerp(new THREE.Color('#9aa3b2').multiplyScalar(0.6 + day * 0.4), grey * 0.6);
    for (const c of this.clouds) {
      const m = c.s.material as THREE.SpriteMaterial;
      if (this.o.kind === 'open') {
        m.color.copy(cc);
        m.opacity = (c.layer ? 0.85 : 0.55 + s.cloud * 0.4) * (0.75 + day * 0.25);
      }
    }
    this.haze.uHazeAmt.value = 0.45 + p.night * 0.25;
  }

  /** Follow the camera: sit behind its look target, face it, scale to the framed height. */
  update(cam: THREE.Camera, dt: number, t: number, view: { w: number; h: number; px: number }) {
    const oc = cam as THREE.OrthographicCamera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const target = cam.position.clone().addScaledVector(dir, DIST);
    const visH = oc.isOrthographicCamera ? (oc.top - oc.bottom) / oc.zoom : view.h / view.px;
    this.aspect = view.w / view.h;
    this.group.position.copy(target).addScaledVector(dir, BEHIND);
    this.group.quaternion.copy(cam.quaternion);
    this.group.scale.setScalar(visH);
    // Where does the garden's far edge land on screen? Project it, convert NDC to layer units.
    const far = new THREE.Vector3(target.x, 0.18, -6.9).project(cam);
    const hzGoal = THREE.MathUtils.clamp(far.y * 0.5, -0.45, 0.42);
    this.hz = this.placed ? this.hz + (hzGoal - this.hz) * Math.min(1, dt * 10) : hzGoal;
    this.placed = true;
    this.horizon.position.y = this.hz;
    this.skyMat.uniforms.uHy!.value = this.hz - 0.01;
    this.sun.position.set(this.sunX, this.hz + this.sunY, -0.55);
    this.sunGlow.position.set(this.sunX, this.hz + this.sunY, -0.54);
    this.moon.position.set(this.moonX, Math.min(0.42, this.hz + 0.22), -0.55);
    // Parallax: far layers barely move as the camera follows the KIN sideways.
    for (const l of this.layers) l.g.position.x = (-target.x / visH) * l.k;
    for (const c of this.clouds) {
      c.s.position.x = ((c.base.x + t * c.speed + 3) % 6) - 3 - (target.x / visH) * (0.05 + c.layer * 0.05);
    }
    // A shooting star, rarely, on clear nights.
    if (this.night > 0.7 && !this.shooting && Math.random() < dt * 0.04) this.shootStar();
    if (this.shooting) {
      const s = this.shooting;
      s.t += dt / 0.9;
      const head = s.from.clone().lerp(s.to, Math.min(1, s.t));
      const tail = s.from.clone().lerp(s.to, Math.max(0, s.t - 0.25));
      const pos = s.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, tail.x, tail.y, tail.z);
      pos.setXYZ(1, head.x, head.y, head.z);
      pos.needsUpdate = true;
      (s.line.material as THREE.LineBasicMaterial).opacity = Math.sin(Math.min(1, s.t) * Math.PI) * 0.9;
      if (s.t >= 1.25) {
        this.group.remove(s.line);
        s.line.geometry.dispose();
        this.shooting = null;
      }
    }
  }

  private shootStar() {
    const r = Math.random;
    const from = new THREE.Vector3((r() - 0.5) * 1.6 * this.aspect, 0.35 + r() * 0.2, -0.56);
    const to = from.clone().add(new THREE.Vector3((r() < 0.5 ? -1 : 1) * (0.25 + r() * 0.2), -0.14, 0));
    const geo = new THREE.BufferGeometry().setFromPoints([from, from]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#fff8e8', transparent: true, opacity: 0, fog: false }));
    line.renderOrder = -18;
    line.frustumCulled = false;
    this.group.add(line);
    this.shooting = { line, t: 0, from, to };
  }
}

function ridge(seed: number, count: number, jag: number, y0: number, mat: THREE.Material) {
  const r = rng(seed);
  const shape = new THREE.Shape();
  const w = 7;
  shape.moveTo(-w / 2, y0 - 0.6);
  let x = -w / 2;
  shape.lineTo(x, y0);
  while (x < w / 2) {
    const step = w / count * (0.5 + r());
    const peak = y0 + (0.03 + r() * jag);
    shape.quadraticCurveTo(x + step * 0.5, peak + jag * 0.4 * r(), x + step, y0 + r() * jag * 0.4);
    x += step;
  }
  shape.lineTo(w / 2, y0 - 0.6);
  shape.lineTo(-w / 2, y0 - 0.6);
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape, 8), mat);
  return m;
}

function waterfallMat(u: Uniforms) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    uniforms: { uTime: u.uTime },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
    fragmentShader: `uniform float uTime; varying vec2 vUv;
      void main(){ float streak = 0.55 + 0.45*sin(vUv.x*40.0 + (vUv.y + uTime*0.6)*30.0);
        float a = smoothstep(0.0,0.2,vUv.x)*smoothstep(1.0,0.8,vUv.x)*smoothstep(0.0,0.35,vUv.y);
        gl_FragColor = vec4(vec3(0.88,0.95,1.0)*(0.85+0.15*streak), a*0.85); }`,
  });
}

function moonTexture() {
  const s = 96;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const glow = g.createRadialGradient(s / 2, s / 2, s * 0.18, s / 2, s / 2, s / 2);
  glow.addColorStop(0, 'rgba(225,232,255,0.35)');
  glow.addColorStop(1, 'rgba(225,232,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, s, s);
  g.fillStyle = '#eef1ff';
  g.beginPath();
  g.arc(s / 2, s / 2, s * 0.2, 0, Math.PI * 2);
  g.fill();
  // A soft crescent shadow.
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.arc(s / 2 + s * 0.09, s / 2 - s * 0.05, s * 0.19, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
