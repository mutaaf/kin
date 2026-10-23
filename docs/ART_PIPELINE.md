# Art pipeline: the KIN hero character

`python3 art/blender/build_kin.py` turns the generated model into a production character. Every
stage is a headless Blender 5.2 script (its own process), so the whole thing reruns when the model
is regenerated.

| Stage | Script | What it does |
|---|---|---|
| 1 | `stage_mesh.py` | Weld glTF seam splits; centre on the **symmetry plane** (head + ears, not the bbox: the tail skews it); scale to **0.28 m** at the ear tips, feet at 0, forward −Y; LOD0 **30,000** tris, LOD1 **10,000** (symmetric decimate); crystal mask + ORM from the base colour; tangent-space normal map baked from the 119k source. |
| 2 | `stage_face.py` | Locate the painted eyes (dark/teal, front of head) and symmetrise. **Iris art from the concept:** crop each painted eye from `art/source/front.png` and front-project it onto the eyeball (plus a catchlight-free copy). **Seated eyes:** wide spherical caps only 0.25 r proud of the face; the head is carved into a socket with a rounded lid lip; per pixel, the old eye becomes fur, a soft dark lash line rings the socket (thicker on top) with corner AO. **Lids:** furred shells flush with the lip, lash-dark edge band, curved edges. Facial blendshapes on both LODs. |
| 3 | `stage_rig.py` | 38-bone quadruped rig from mesh landmarks (tail = vertices with no mirror twin; legs = four low clusters; spine/head/ears from regions and the eyes); automatic weights, ≤4 influences, normalised; eyes and lids ride `head`. |
| 4 | `stage_anim.py` | 22 skeletal clips keyed from pose functions (phase-delayed overlap on ears/tail, anticipation, eased arcs, loops whole-cycle periodic so last frame = first) + a blink recipe; writes `build/clips.json`. |
| 5 | `stage_export.py` | FBX for Unity, GLB for three.js, PNG textures, `manifest.json`; `verify_export.py` re-imports both. |

## Unity import

- **Model:** `kin_hero.fbx`, Generic rig, root node `root` for root motion (locomotion clips move it forward). Scale factor 1 (1 unit = 1 m). It faces +Z. Takes are named `Armature|<Clip>`; ignore the empty `Key…|<Clip>` takes (shape-key carriers).
- **Materials:**
  - **Body:** use the `KIN_Body` textures. Base colour, normal and ORM (R = AO, G = roughness, B = metallic) map directly; `kin_crystal_mask` (1 = crystal) drives smoothness, emission (mint) and translucency, and **fur-shell density = 1 − mask**.
  - **Eyes:** `KIN_Eye_L/R` use `kin_eye_L/R.png` (concept art, painted catchlights) with a smooth clear coat. For live highlights use `kin_eye_*_nocatch.png` and add your own glossy layer. UV (0.5, 0.5) is the pupil; dilate by scaling UVs about it. Each eye's pivot is its eyeball centre, so rotating it makes the eye look around.
  - **Lids:** reuse the body material (the lid body maps the fur just above each eye; the edge maps the lash colour).
- **Blendshapes:**
  - `KIN_Lids`: Blink, HalfLid, HappySquint, Wide, Worried, Sleepy.
  - `KIN_LOD0/1`: Mouth_Smile, Mouth_Open, Mouth_O, Cheeks_Puff, Ears_Relax.

  Each clip's `face` field in the manifest says which blendshapes to drive during it. Blink is procedural (no exporter carries a standalone shape-key clip): 0→1 over 2 frames, hold 2, 1→0 over 3, every 2–6 s.

## Clips (30 fps)

- **Loops:** Idle 150, Idle_Look 120, Walk 32, Trot 20, Hop_Loop 18, Sit_Loop 90, Lie_Sleep 180, Eat 60, Happy 48, Petted 90.
- **Additive loop:** Tail_Wag 20.
- **One-shots:** Hop 24, Sit_Enter 30, Sit_Exit 24, Fall_Asleep 90, Head_Tilt 45, Shake_Off 40, Yawn 60, Sneeze 40, Look_At_Camera 30, Paw_Up 45.
- **Additive one-shot:** Ear_Twitch 12.
- **Procedural:** Blink.

## Bones (38)

- **Body:** root, hips, spine_01–03, chest, neck_01–02, head, jaw.
- **Ears:** ear_01–03.L/R.
- **Tail:** tail_01–06.
- **Legs:** leg_{front,back}_{upper,lower,foot,toe}.{L,R}.

Rolls give every bone local X = side axis. +pitch lifts the spine front, nods the neck, head and ears forward, swings legs forward, and lifts the tail.

## Known limits (honest)

- **Fur:** it's painted into the texture. The softness has to come from real-time fur shells in the engine, driven by the crystal mask.
- **Crystal mask:** it's per-pixel, from colour. The faint mint fur gradient on the tail and ears gets a little gloss.
- **Eyes and lids** (compare `renders/td/face_vs_concept.png`):
  - The iris is the concept's painted eye, so its reflections are baked for a front view. From a strong side angle the projection flattens, and the catchlights don't move with the light (use the `_nocatch` textures plus engine highlights).
  - The catchlight-free textures keep faint ghosts of the highlights.
  - Closed lids are furred but smoother than the painted face, and a faint seam shows where the lid meets the socket lip, most visible in 3/4.
  - The concept's thick upper lashes, cheek blush and soft fur halo are not modelled; the lash is painted. Fur shells and a blush decal would close most of the remaining gap.
- **Animation:** keyed procedurally, not hand-polished.
  - The walk is readable but subtle.
  - There's no foot IK and no contact locking (the realism track in the engine should plant feet).
  - The ears in Eat swing a little wide.
- **No authoring IK rigs:** clips are FK only.
- **Normal map:** carries modest detail, with a few speckles at UV seams.
- **GLB size:** 14 MB with embedded PNGs. For the web, re-encode textures to KTX2/WebP and Draco/meshopt-compress the geometry.
- **Not yet tested:** nothing has been imported into Unity or run on a device; the round-trip import in Blender is the only check.
