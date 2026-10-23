// A procedural, original KIN built from its genome: soft rounded body, oversized glossy eyes,
// dynamic ears, a tail, an optional accent (crystal / sprout / ember). No asset files, no
// licensing questions, and the same seed renders the same creature on every device.
// Chibi proportions: the head is bigger than the body, and the eyes carry most of the emotion.

import * as THREE from 'three';
import type { Genome } from '../core/genome';

export interface CreatureParts {
  root: THREE.Group;
  squash: THREE.Group;
  head: THREE.Group;
  eyes: THREE.Group[];
  lids: THREE.Mesh[];
  shine: THREE.Mesh[];
  ears: THREE.Group[];
  tail: THREE.Group;
  legs: THREE.Mesh[];
  mouth: THREE.Mesh;
  cheeks: THREE.Mesh[];
  accent: THREE.Object3D | null;
  accentMat: THREE.MeshStandardMaterial | null;
  bodyMats: THREE.MeshPhysicalMaterial[];
  dispose(): void;
}

const hsl = (h: number, s: number, l: number) => new THREE.Color().setHSL(((h % 360) + 360) % 360 / 360, s, l);

export function buildCreature(g: Genome): CreatureParts {
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const geo = <T extends THREE.BufferGeometry>(x: T) => (geos.push(x), x);
  const mat = <T extends THREE.Material>(x: T) => (mats.push(x), x);

  const furColor = hsl(g.hue, g.sat, g.light);
  // Plush: sheen for velvet, plus a soft fresnel rim so the silhouette glows against any sky
  // (the crisp edge that separates a premium character from a primitive).
  const rimColor = hsl(g.hue, 0.5, 0.92);
  const plush = (c: THREE.Color, sheen: THREE.Color) => {
    const m = mat(new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.78, sheen: 1, sheenRoughness: 0.42, sheenColor: sheen }));
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uRim = { value: rimColor };
      sh.fragmentShader = 'uniform vec3 uRim;\n' + sh.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         float rim = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 2.6);
         gl_FragColor.rgb += uRim * rim * 0.32;`,
      );
    };
    return m;
  };
  const fur = plush(furColor, hsl(g.hue, g.sat * 0.6, Math.min(0.95, g.light + 0.2)));
  const belly = plush(hsl(g.hue, g.sat * 0.5, Math.min(0.93, g.light + 0.16)), new THREE.Color('#fff7ee'));
  const inner = plush(hsl(g.accentHue, 0.55, 0.78), hsl(g.accentHue, 0.6, 0.9));
  const dark = mat(new THREE.MeshPhysicalMaterial({ color: hsl(g.hue, 0.35, 0.09), roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 }));
  const white = mat(new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  const blush = mat(new THREE.MeshBasicMaterial({ color: hsl(350, 0.8, 0.72), transparent: true, opacity: 0.45, depthWrite: false }));

  const sphere = geo(new THREE.SphereGeometry(1, 64, 48));
  const lowSphere = geo(new THREE.SphereGeometry(1, 32, 24));
  const S = g.size;

  const root = new THREE.Group();
  const squash = new THREE.Group();
  root.add(squash);

  // Body
  const body = new THREE.Mesh(sphere, fur);
  body.scale.set(0.3, 0.27 + g.round * 0.04, 0.28);
  body.position.y = 0.3;
  const tummy = new THREE.Mesh(sphere, belly);
  tummy.scale.set(0.21, 0.2, 0.12);
  tummy.position.set(0, 0.27, 0.17);
  squash.add(body, tummy);

  // Legs: stubby, paddle during hops.
  const legGeo = geo(new THREE.CapsuleGeometry(0.065, 0.07, 12, 24));
  const legs: THREE.Mesh[] = [];
  for (const [x, z] of [[-0.14, 0.11], [0.14, 0.11], [-0.13, -0.12], [0.13, -0.12]] as const) {
    const l = new THREE.Mesh(legGeo, fur);
    l.position.set(x, 0.085, z);
    legs.push(l);
    squash.add(l);
  }

  // Tail
  const tail = new THREE.Group();
  tail.position.set(0, 0.26, -0.24);
  squash.add(tail);
  if (g.tail === 'plume') {
    [0.11, 0.095, 0.08].forEach((r, i) => {
      const s = new THREE.Mesh(sphere, i === 2 ? inner : fur);
      s.scale.setScalar(r);
      s.position.set(0, 0.06 + i * 0.1, -0.06 - i * 0.05);
      tail.add(s);
    });
  } else if (g.tail === 'curl') {
    const t = new THREE.Mesh(geo(new THREE.TorusGeometry(0.1, 0.045, 24, 48, Math.PI * 1.6)), fur);
    t.rotation.set(0, Math.PI / 2, 0);
    t.position.set(0, 0.1, -0.06);
    tail.add(t);
  } else if (g.tail === 'leaf') {
    const t = new THREE.Mesh(sphere, inner);
    t.scale.set(0.11, 0.025, 0.2);
    t.rotation.x = -0.7;
    t.position.set(0, 0.1, -0.12);
    tail.add(t);
  } else {
    const t = new THREE.Mesh(sphere, fur);
    t.scale.setScalar(0.085);
    tail.add(t);
  }

  // Head
  const head = new THREE.Group();
  head.position.set(0, 0.5, 0.02);
  squash.add(head);
  const skull = new THREE.Mesh(sphere, fur);
  skull.scale.set(0.37, 0.33, 0.33);
  skull.position.y = 0.2;
  head.add(skull);
  const muzzle = new THREE.Mesh(sphere, belly);
  muzzle.scale.set(0.15, 0.09, 0.08);
  muzzle.position.set(0, 0.11, 0.27);
  head.add(muzzle);

  // Eyes: glossy, deep, with two catchlights. Lids are fur-coloured caps that drop to blink.
  const eyes: THREE.Group[] = [];
  const lids: THREE.Mesh[] = [];
  const shine: THREE.Mesh[] = [];
  const er = 0.083 * g.eyeScale;
  for (const side of [-1, 1]) {
    const e = new THREE.Group();
    e.position.set(side * 0.135, 0.205, 0.275);
    e.rotation.y = side * 0.32;
    const ball = new THREE.Mesh(sphere, dark);
    ball.scale.set(er, er * 1.12, er * 0.55);
    const s1 = new THREE.Mesh(lowSphere, white);
    s1.scale.setScalar(er * 0.32);
    s1.position.set(-side * er * 0.28 + er * 0.1, er * 0.42, er * 0.42);
    const s2 = new THREE.Mesh(lowSphere, white);
    s2.scale.setScalar(er * 0.14);
    s2.position.set(side * er * 0.25, -er * 0.35, er * 0.45);
    const lid = new THREE.Mesh(sphere, fur);
    lid.scale.set(er * 1.18, er * 1.25, er * 0.7);
    lid.position.set(0, er * 1.25, 0.01);
    e.add(ball, s1, s2, lid);
    head.add(e);
    eyes.push(e);
    lids.push(lid);
    shine.push(s1, s2);
  }

  const nose = new THREE.Mesh(lowSphere, dark);
  nose.scale.set(0.03, 0.022, 0.02);
  nose.position.set(0, 0.145, 0.345);
  head.add(nose);
  const mouth = new THREE.Mesh(geo(new THREE.TorusGeometry(0.03, 0.008, 12, 32, Math.PI)), dark);
  mouth.rotation.z = Math.PI;
  mouth.position.set(0, 0.105, 0.343);
  head.add(mouth);
  const cheeks: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const c = new THREE.Mesh(geo(new THREE.CircleGeometry(0.045, 40)), blush);
    c.position.set(side * 0.215, 0.12, 0.262);
    c.rotation.y = side * 0.62;
    head.add(c);
    cheeks.push(c);
  }

  // Ears on pivots, so springs can swing them.
  const ears: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.2, 0.43, -0.02);
    pivot.rotation.z = -side * (g.ears === 'long' ? 0.75 : 0.38);
    const outer = new THREE.Mesh();
    const innerM = new THREE.Mesh();
    if (g.ears === 'pointed' || g.ears === 'tuft') {
      const h = g.ears === 'tuft' ? 0.2 : 0.27;
      outer.geometry = geo(new THREE.ConeGeometry(0.11, h, 40));
      innerM.geometry = geo(new THREE.ConeGeometry(0.065, h * 0.75, 32));
      outer.position.y = h / 2;
      innerM.position.set(0, h * 0.42, 0.045);
      if (g.ears === 'tuft') {
        const tip = new THREE.Mesh(sphere, inner);
        tip.scale.setScalar(0.045);
        tip.position.y = h + 0.02;
        pivot.add(tip);
      }
    } else if (g.ears === 'round') {
      outer.geometry = sphere;
      outer.scale.set(0.12, 0.12, 0.05);
      outer.position.y = 0.09;
      innerM.geometry = sphere;
      innerM.scale.set(0.075, 0.075, 0.03);
      innerM.position.set(0, 0.09, 0.03);
    } else {
      outer.geometry = sphere;
      outer.scale.set(0.085, 0.24, 0.05);
      outer.position.y = 0.2;
      innerM.geometry = sphere;
      innerM.scale.set(0.05, 0.18, 0.03);
      innerM.position.set(0, 0.2, 0.03);
    }
    outer.material = fur;
    innerM.material = inner;
    pivot.add(outer, innerM);
    head.add(pivot);
    ears.push(pivot);
  }

  // Accent: the species flourish. Emissive, so it glows softly at night.
  let accent: THREE.Object3D | null = null;
  let accentMat: THREE.MeshStandardMaterial | null = null;
  if (g.accent !== 'none') {
    const grp = new THREE.Group();
    grp.position.set(0, 0.53, 0.06);
    if (g.accent === 'crystal') {
      accentMat = mat(new THREE.MeshStandardMaterial({ color: hsl(g.accentHue, 0.7, 0.75), emissive: hsl(g.accentHue, 0.9, 0.55), emissiveIntensity: 0.6, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92 }));
      const oct = geo(new THREE.OctahedronGeometry(1, 0));
      [[0, 0.04, 0, 0.065], [-0.06, 0, 0.01, 0.04], [0.06, 0, 0.01, 0.045]].forEach(([x, y, z, s]) => {
        const m = new THREE.Mesh(oct, accentMat!);
        m.scale.set(s!, s! * 1.7, s!);
        m.position.set(x!, y!, z!);
        m.rotation.z = x! * 4;
        grp.add(m);
      });
    } else if (g.accent === 'sprout') {
      accentMat = mat(new THREE.MeshStandardMaterial({ color: hsl(125, 0.5, 0.55), emissive: hsl(125, 0.7, 0.3), emissiveIntensity: 0.15, roughness: 0.6 }));
      const stem = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.008, 0.012, 0.09, 6)), accentMat);
      stem.position.y = 0.03;
      grp.add(stem);
      for (const side of [-1, 1]) {
        const leaf = new THREE.Mesh(sphere, accentMat);
        leaf.scale.set(0.055, 0.014, 0.03);
        leaf.position.set(side * 0.05, 0.08, 0);
        leaf.rotation.z = side * 0.5;
        grp.add(leaf);
      }
    } else {
      accentMat = mat(new THREE.MeshStandardMaterial({ color: hsl(28, 1, 0.6), emissive: hsl(22, 1, 0.5), emissiveIntensity: 1.2, roughness: 0.4, transparent: true, opacity: 0.9 }));
      const flame = new THREE.Mesh(geo(new THREE.ConeGeometry(0.045, 0.13, 12)), accentMat);
      flame.position.y = 0.05;
      const core = new THREE.Mesh(sphere, accentMat);
      core.scale.setScalar(0.045);
      grp.add(flame, core);
    }
    head.add(grp);
    accent = grp;
  }

  root.scale.setScalar(S);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = false;
  });

  return {
    root, squash, head, eyes, lids, shine, ears, tail, legs, mouth, cheeks, accent, accentMat,
    bodyMats: [fur, belly, inner],
    dispose() {
      geos.forEach((x) => x.dispose());
      mats.forEach((x) => x.dispose());
    },
  };
}
