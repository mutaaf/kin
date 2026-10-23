// Plush skin and shell-texture fur, sharing one vertex deformation so the fur moves with the body.
//
// Deformation (body only, from attributes written by form.ts):
//   aHead  → rotates with the head about the neck (one mesh, so the neck stays soft and seamless)
//   aBelly → jiggles with a velocity-driven spring and rises with the breath
//   aCheek → puffs (happy, chewing, pouting)
//
// Fur: N shells drawn as ONE InstancedMesh (gl_InstanceID = shell index). Each shell pushes the
// surface out along the normal, droops with gravity, leans with wind and lags behind motion; the
// fragment keeps only tapered strands from a 3D cell hash, as an opaque alpha cut (crisp, no
// transparency sorting, and nothing translucent leaks into the transparent canvas). Shell count is the quality ladder.

import * as THREE from 'three';

export interface DeformUniforms {
  uHeadEuler: { value: THREE.Vector3 };
  uNeck: { value: THREE.Vector3 };
  uBelly: { value: THREE.Vector3 };
  uBreath: { value: number };
  uCheek: { value: number };
}

export interface FurUniforms {
  uShells: { value: number };
  uFurLen: { value: number };
  uDensity: { value: number };
  /** Object-space push: gravity + wind − motion lag (per creature, set every frame). */
  uFlow: { value: THREE.Vector3 };
  uTime: { value: number };
}

export function deformUniforms(neck: THREE.Vector3): DeformUniforms {
  return {
    uHeadEuler: { value: new THREE.Vector3() },
    uNeck: { value: neck.clone() },
    uBelly: { value: new THREE.Vector3() },
    uBreath: { value: 0 },
    uCheek: { value: 0 },
  };
}

export function furUniforms(len: number, density: number): FurUniforms {
  return {
    uShells: { value: 8 },
    uFurLen: { value: len },
    uDensity: { value: density },
    uFlow: { value: new THREE.Vector3(0, -1, 0) },
    uTime: { value: 0 },
  };
}

const DEFORM_DECL = /* glsl */ `
uniform vec3 uHeadEuler; uniform vec3 uNeck; uniform vec3 uBelly; uniform float uBreath; uniform float uCheek;
attribute float aHead; attribute float aBelly; attribute float aCheek;
mat3 kinRot(vec3 e) {
  float cx = cos(e.x), sx = sin(e.x), cy = cos(e.y), sy = sin(e.y), cz = cos(e.z), sz = sin(e.z);
  // three.js Euler 'XYZ': R = Rx * Ry * Rz (column-major constructors below)
  mat3 rx = mat3(1., 0., 0., 0., cx, sx, 0., -sx, cx);
  mat3 ry = mat3(cy, 0., -sy, 0., 1., 0., sy, 0., cy);
  mat3 rz = mat3(cz, sz, 0., -sz, cz, 0., 0., 0., 1.);
  return rx * ry * rz;
}
`;

// Applied to both `objectNormal` and `transformed` (normal first, so lighting follows the head).
const DEFORM_NORMAL = /* glsl */ `
  mat3 kinR = kinRot(uHeadEuler * aHead);
  objectNormal = kinR * objectNormal;
`;
const DEFORM_POS = /* glsl */ `
  transformed += normal * (uBreath * aBelly * 0.018 + uCheek * aCheek * 0.012);
  transformed += uBelly * aBelly;
  transformed = kinR * (transformed - uNeck) + uNeck;
`;

const FUR_DECL = /* glsl */ `
uniform float uShells; uniform float uFurLen; uniform vec3 uFlow;
varying float vShell; varying vec3 vBase;
`;
const FUR_POS = /* glsl */ `
  float kinShell = float(gl_InstanceID + 1) / uShells;
  vShell = kinShell;
  vBase = position;
  transformed += objectNormal * uFurLen * kinShell + uFlow * uFurLen * kinShell * kinShell;
`;
const FUR_FRAG_DECL = /* glsl */ `
uniform float uDensity; varying float vShell; varying vec3 vBase;
float kinHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
`;
// Strands: cell hash → each strand has its own length and thickness; tapered to a point.
const FUR_FRAG = /* glsl */ `
  vec3 kinCell = vBase * uDensity;
  vec3 kinId = floor(kinCell);
  // Jittered strand roots break the cell grid up, so the fur never reads as a knit or a lattice.
  vec3 kinJ = vec3(kinHash(kinId + 1.3), kinHash(kinId + 2.7), kinHash(kinId + 5.1)) - 0.5;
  vec3 kinF = fract(kinCell) - 0.5 - kinJ * 0.55;
  float kinH = kinHash(kinId);
  float kinLen = 0.5 + 0.5 * kinH;
  // Fur reads at the silhouette: strands seen end-on (facing the camera) are thinned, so faces
  // stay clean and soft while the outline gets its fuzz.
  float kinFacing = abs(dot(normalize(vNormal), normalize(vViewPosition)));
  float kinR = 0.46 * (1.0 - vShell / kinLen) * (0.7 + 0.3 * kinHash(kinId + 7.1)) * mix(1.0, 0.45, smoothstep(0.35, 0.9, kinFacing));
  float kinD = length(kinF);
  // Hard cut, opaque output. (Alpha-to-coverage leaves alpha < 1 in the canvas, which composites
  // over the CSS sky as white speckle; strands are sub-pixel at phone DPR, so a cut stays crisp.)
  if (vShell > kinLen || kinHash(kinId + 3.3) < 0.18 || kinD > kinR) discard;
  diffuseColor.a = 1.0;
  // Gentle depth: roots a touch darker. Tips are NOT brightened (end-on they read as speckle).
  diffuseColor.rgb *= mix(0.88, 1.0, vShell);
`;

/** Patch a material for body deformation (+ optional fur shells). */
export function patch(mat: THREE.Material, opts: { deform?: DeformUniforms; fur?: FurUniforms; rim?: THREE.Color }) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    if (opts.deform) Object.assign(sh.uniforms, opts.deform);
    if (opts.fur) Object.assign(sh.uniforms, opts.fur);
    let vs = sh.vertexShader;
    if (opts.deform) {
      vs = DEFORM_DECL + vs;
      vs = vs.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + DEFORM_NORMAL);
      vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + DEFORM_POS);
    }
    if (opts.fur) {
      vs = FUR_DECL + vs;
      // After deformation: shells follow the moved surface.
      vs = vs.replace('#include <morphtarget_vertex>', '#include <morphtarget_vertex>\n' + FUR_POS);
      sh.fragmentShader = FUR_FRAG_DECL + sh.fragmentShader.replace('#include <alphatest_fragment>', FUR_FRAG + '\n#include <alphatest_fragment>');
    }
    if (opts.rim) {
      sh.uniforms.uRim = { value: opts.rim };
      sh.fragmentShader = 'uniform vec3 uRim;\n' + sh.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         float kinRim = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 2.4);
         gl_FragColor.rgb += uRim * kinRim * 0.28;`,
      );
    }
    sh.vertexShader = vs;
  };
  // Distinct programs per feature set (three caches programs by this key).
  mat.customProgramCacheKey = () => `kin:${opts.deform ? 'd' : ''}${opts.fur ? 'f' : ''}${opts.rim ? 'r' : ''}`;
}

export function plush(color: THREE.Color | null, sheen: THREE.Color, opts: { vertexColors?: boolean; rim?: THREE.Color } = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color: color ?? 0xffffff,
    vertexColors: !!opts.vertexColors,
    roughness: 0.82,
    sheen: 1,
    sheenRoughness: 0.45,
    sheenColor: sheen,
  });
  return m;
}

/** Fur shells for a geometry, as one instanced draw. Shares deformation with the base. */
export function furShells(geo: THREE.BufferGeometry, mat: THREE.Material, maxShells: number): THREE.InstancedMesh {
  mat.transparent = false;
  const im = new THREE.InstancedMesh(geo, mat, maxShells);
  const I = new THREE.Matrix4();
  for (let i = 0; i < maxShells; i++) im.setMatrixAt(i, I);
  im.frustumCulled = false;
  return im;
}

/** Quality ladder: shells per tier. 0 disables fur (plush only). */
export const FUR_TIERS = [0, 4, 8, 12] as const;
