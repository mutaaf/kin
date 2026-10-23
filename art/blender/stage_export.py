"""Stage 5: export for Unity (FBX) and the web (GLB), plus textures and a manifest.

    blender -b <stage_anim.blend> -P art/blender/stage_export.py -- <export_dir>

FBX: binary, -Z forward / Y up with transforms applied (the KIN faces Unity +Z with no extra
rotation), 1 unit = 1 m, no leaf bones, one take per action. Import in Unity as a Generic rig.
Facial blendshapes (KIN_LOD0/LOD1 mouth/cheeks/ears, KIN_Lids eyelids) are exported as
blendshapes; Unity drives them per clip from the manifest's `face` hints (and blinks procedurally).
"""
import json
import os
import shutil
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
from kin_common import HEIGHT_M, select_only  # noqa: E402

out = sys.argv[sys.argv.index("--") + 1]
tex_dir = os.path.join(out, "textures")
os.makedirs(tex_dir, exist_ok=True)
arm = bpy.data.objects["Armature"]
arm.animation_data.action = None
for pb in arm.pose.bones:
    pb.rotation_euler = (0, 0, 0)
    pb.location = (0, 0, 0)
for o in bpy.data.objects:
    if o.type == "MESH" and o.data.shape_keys:
        for kb in o.data.shape_keys.key_blocks[1:]:
            kb.value = 0.0
# Unmute nothing: each action is exported once as its own take.
for tr in arm.animation_data.nla_tracks:
    tr.mute = True

# Textures out (PNG) and point the materials at the files, so the FBX references them.
TEX = {"kin_basecolor": "kin_basecolor.png", "kin_normal": "kin_normal.png", "kin_orm": "kin_orm.png",
       "kin_crystal_mask": "kin_crystal_mask.png",
       "kin_eye_L": "kin_eye_L.png", "kin_eye_R": "kin_eye_R.png",
       "kin_eye_L_nocatch": "kin_eye_L_nocatch.png", "kin_eye_R_nocatch": "kin_eye_R_nocatch.png"}
for name, fn in TEX.items():
    img = bpy.data.images.get(name)
    if not img:
        continue
    path = os.path.join(tex_dir, fn)
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    img.filepath = path
    img.unpack(method="REMOVE") if img.packed_file else None
    img.filepath = path

parts = [bpy.data.objects[n] for n in ("Armature", "KIN_LOD0", "KIN_LOD1", "KIN_Eye_L", "KIN_Eye_R", "KIN_Lids")]
select_only(*parts, active=arm)
fbx = os.path.join(out, "kin_hero.fbx")
bpy.ops.export_scene.fbx(
    filepath=fbx, use_selection=True, object_types={"ARMATURE", "MESH"},
    apply_unit_scale=True, apply_scale_options="FBX_SCALE_UNITS", global_scale=1.0,
    axis_forward="-Z", axis_up="Y", bake_space_transform=True,
    use_mesh_modifiers=False, mesh_smooth_type="FACE", use_tspace=True,
    add_leaf_bones=False, primary_bone_axis="Y", secondary_bone_axis="X", armature_nodetype="NULL",
    bake_anim=True, bake_anim_use_all_bones=True, bake_anim_use_nla_strips=False,
    bake_anim_use_all_actions=True, bake_anim_force_startend_keying=True, bake_anim_step=1.0,
    bake_anim_simplify_factor=0.5, path_mode="RELATIVE", embed_textures=False,
)

# GLB for three.js (same character and clips; morph targets included).
select_only(*parts, active=arm)
glb = os.path.join(out, "kin_hero.glb")
bpy.ops.export_scene.gltf(
    filepath=glb, export_format="GLB", use_selection=True, export_yup=True,
    export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True,
    export_morph=True, export_morph_normal=False, export_skins=True, export_image_format="AUTO",
)

clips = json.load(open(os.path.join(os.path.dirname(bpy.data.filepath), "clips.json")))


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


manifest = {
    "character": "KIN hero (Lumi line)",
    "units": "metres; 1 Unity unit = 1 m",
    "height_m": HEIGHT_M,
    "forward": "Unity +Z (Blender -Y), Y up, transforms applied",
    "rig": {"type": "Generic (quadruped)", "root_motion_bone": "root", "bones": [b.name for b in arm.data.bones],
            "max_influences": 4},
    "lods": [{"mesh": "KIN_LOD0", "tris": tris(bpy.data.objects["KIN_LOD0"])},
             {"mesh": "KIN_LOD1", "tris": tris(bpy.data.objects["KIN_LOD1"])}],
    "parts": {"eyes": ["KIN_Eye_L", "KIN_Eye_R"], "lids": "KIN_Lids"},
    "blendshapes": {
        "KIN_LOD0": [k.name for k in bpy.data.objects["KIN_LOD0"].data.shape_keys.key_blocks[1:]],
        "KIN_LOD1": [k.name for k in bpy.data.objects["KIN_LOD1"].data.shape_keys.key_blocks[1:]],
        "KIN_Lids": [k.name for k in bpy.data.objects["KIN_Lids"].data.shape_keys.key_blocks[1:]],
    },
    "materials": {
        "KIN_Body": {"baseColor": "textures/kin_basecolor.png", "normal": "textures/kin_normal.png",
                     "orm": "textures/kin_orm.png (R=AO, G=roughness, B=metallic)",
                     "crystalMask": "textures/kin_crystal_mask.png (1 = crystal: glossy, translucent, emissive mint)",
                     "furShells": "drive density/length from (1 - crystalMask)"},
        "KIN_Eye_L": {"baseColor": "textures/kin_eye_L.png", "baseColorNoCatchlights": "textures/kin_eye_L_nocatch.png"},
        "KIN_Eye_R": {"baseColor": "textures/kin_eye_R.png", "baseColorNoCatchlights": "textures/kin_eye_R_nocatch.png"},
        "eyeNotes": ("iris art is cropped from the concept (art/source/front.png) and front-projected: UV (0.5,0.5) = "
                     "pupil centre; dilate by scaling UVs about it. The default textures keep the painted "
                     "catchlights; for live glossy highlights use the _nocatch textures plus a smooth clear-coat "
                     "or a camera-facing catchlight sprite. Each eye's pivot is its eyeball centre (deep in the "
                     "socket), so rotating KIN_Eye_L/R makes it look around; the caps are sized to stay seated."),
        "KIN_Lid": {"notes": ("lids share KIN_Body: the lid body maps a fur patch just above each eye, the edge "
                              "rows a dark lash texel. Upper lid sits flush with the socket lip; blendshapes: "
                              "Blink, HalfLid, Sleepy, HappySquint (pair with Cheeks_Puff), Wide, Worried")},
    },
    "clips": clips,
    "files": {"fbx": "kin_hero.fbx", "glb": "kin_hero.glb", "textures": sorted(TEX.values())},
}
with open(os.path.join(out, "manifest.json"), "w") as fh:
    json.dump(manifest, fh, indent=2)
for f in ("kin_hero.fbx", "kin_hero.glb"):
    print("KIN_EXPORT", f, round(os.path.getsize(os.path.join(out, f)) / 1e6, 2), "MB")
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.path.dirname(bpy.data.filepath), "kin_hero.blend"), compress=True)
print("KIN_STAGE_EXPORT_DONE")
