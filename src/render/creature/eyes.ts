// Eyes are the soul. Each eye is a shallow dome whose look is painted in the fragment shader of a
// standard (lit) material, so lids and skin around the eye shade exactly like the body:
//   iris with a vertical gradient + limbal ring, a pupil that dilates (dark, excitement, love)
//   and constricts (bright sun), two catchlights computed in VIEW space (they stay put relative to
//   the camera as the head turns, like real reflections), upper and lower lids with a lash line,
//   brow tilt for worry/surprise, and "^ ^" closed happy arcs.

import * as THREE from 'three';

export interface EyeUniforms {
  uLook: { value: THREE.Vector2 };
  uPupil: { value: number };
  uLid: { value: number };
  uLower: { value: number };
  uHappy: { value: number };
  uTilt: { value: number };
  uSide: { value: number };
  uIris: { value: THREE.Color };
  uIrisDeep: { value: THREE.Color };
  uSkin: { value: THREE.Color };
  uSparkle: { value: number };
}

export function eyeUniforms(side: number, iris: THREE.Color, skin: THREE.Color): EyeUniforms {
  return {
    uLook: { value: new THREE.Vector2() },
    uPupil: { value: 0.42 },
    uLid: { value: 0 },
    uLower: { value: 0 },
    uHappy: { value: 0 },
    uTilt: { value: 0 },
    uSide: { value: side },
    uIris: { value: iris },
    uIrisDeep: { value: iris.clone().multiplyScalar(0.28) },
    uSkin: { value: skin },
    uSparkle: { value: 1 },
  };
}

const DECL = /* glsl */ `
uniform vec2 uLook; uniform float uPupil; uniform float uLid; uniform float uLower; uniform float uHappy;
uniform float uTilt; uniform float uSide; uniform vec3 uIris; uniform vec3 uIrisDeep; uniform vec3 uSkin; uniform float uSparkle;
varying vec3 vEye;
`;

const COLOR = /* glsl */ `
  vec2 e = vEye.xy;                       // -1..1 across the dome's face
  // Iris + pupil, offset toward where the eye is looking.
  vec2 c = uLook * vec2(0.32, 0.26);
  vec2 q = (e - c) * vec2(1.0, 0.9);
  float d = length(q);
  vec3 iris = mix(uIrisDeep, uIris, smoothstep(0.55, -0.75, q.y));      // deep at top, glowing below
  iris += uIris * 0.35 * smoothstep(0.25, 0.75, d) * smoothstep(-0.2, -0.7, q.y); // lower rim light
  vec3 col = mix(iris, vec3(0.03, 0.03, 0.06), smoothstep(0.86, 0.94, d));      // limbal ring
  col = mix(col, vec3(0.015, 0.015, 0.03), smoothstep(uPupil + 0.03, uPupil - 0.03, d)); // pupil
  float eyeRough = 0.12;

  // Upper lid: a curved line that drops as uLid rises; tilt raises/lowers the inner corner.
  float inner = -e.x * uSide;              // +1 toward the nose (left eye: nose is +x)
  float lidLine = 1.15 - 2.3 * uLid - 0.18 * e.x * e.x + uTilt * 0.35 * inner;
  // The lower lid rises as a gentle upward curve (a smiling squint), never a flat cut.
  float lowerLine = -1.15 + 1.6 * uLower * (1.0 - 0.55 * e.x * e.x) + 0.15 * e.x * e.x;
  float skinMask = max(smoothstep(lidLine - 0.03, lidLine + 0.03, e.y), smoothstep(lowerLine + 0.03, lowerLine - 0.03, e.y));
  float lash = (1.0 - smoothstep(0.0, 0.11, abs(e.y - lidLine))) * step(0.04, uLid) * (1.0 - smoothstep(0.85, 1.0, abs(e.x)));
  col = mix(col, uSkin, skinMask);
  col = mix(col, vec3(0.05, 0.04, 0.07), lash * 0.9);
  // Fully closed (blink, sleep, yawn): a soft closed-lid curve "‿", never a blank dome.
  float closed = smoothstep(0.72, 0.97, uLid) * (1.0 - uHappy);
  float lineY = -0.18 + 0.32 * e.x * e.x;
  float closedLine = (1.0 - smoothstep(0.06, 0.13, abs(e.y - lineY))) * (1.0 - smoothstep(0.72, 0.92, abs(e.x)));
  col = mix(col, vec3(0.06, 0.05, 0.08), closedLine * closed * 0.9);

  // Happy closed eyes: skin everywhere, one soft dark arc (an upside-down U).
  float arcY = -0.05 + 0.62 * (1.0 - e.x * e.x);
  float arc = (1.0 - smoothstep(0.08, 0.17, abs(e.y - arcY))) * (1.0 - smoothstep(0.7, 0.9, abs(e.x)));
  vec3 happy = mix(uSkin, vec3(0.06, 0.05, 0.08), arc);
  col = mix(col, happy, uHappy);
  skinMask = mix(skinMask, 1.0, uHappy);

  diffuseColor.rgb = col;
  float kinSkin = skinMask;
`;

const ROUGH = /* glsl */ `
  roughnessFactor = mix(0.1, 0.85, kinSkin);
`;

// Catchlights from the view-space normal: positions fixed relative to the camera.
const EMIT = /* glsl */ `
  vec3 nv = normalize(vNormal);
  float s1 = smoothstep(0.955, 0.972, dot(nv, normalize(vec3(-0.42, 0.5, 1.0))));
  float s2 = smoothstep(0.986, 0.992, dot(nv, normalize(vec3(0.3, -0.3, 1.0))));
  totalEmissiveRadiance += vec3(1.0) * (s1 * 1.6 + s2 * 1.1) * (1.0 - kinSkin) * uSparkle;
`;

export function eyeMaterial(u: EyeUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying vec3 vEye;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vEye = position;');
    sh.fragmentShader = DECL + sh.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + ROUGH)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + EMIT);
  };
  m.customProgramCacheKey = () => 'kin-eye';
  return m;
}

/** A shallow dome, unit radius in x/y; the front (z>0) carries the face of the eye. */
export function eyeGeometry(): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, 48, 32, 0, Math.PI * 2, 0, Math.PI);
}
