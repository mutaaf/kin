"""Frame strips: 8 evenly spaced frames per clip (root motion kept, camera follows).
    blender -b <anim.blend> -P art/blender/render_anim.py -- <out_dir> Clip1 Clip2 ...
"""
import json
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
from kin_render import aim, camera, montage, still, studio  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
out_dir, names = argv[0], argv[1:]
os.makedirs(out_dir, exist_ok=True)
arm = bpy.data.objects["Armature"]
clips = {c["name"]: c for c in json.load(open(os.path.join(os.path.dirname(bpy.data.filepath), "clips.json")))}
studio(320)
cam = camera(lens=70)
body = bpy.data.objects["KIN_LOD0"]
lid_keys = bpy.data.objects["KIN_Lids"].data.shape_keys.key_blocks
face_keys = body.data.shape_keys.key_blocks


def set_face(face, t):
    for kb in list(lid_keys)[1:] + list(face_keys)[1:]:
        v = face.get(kb.name, 0.0)
        if v == "ramp":
            v = min(1.0, max(0.0, (t - 0.5) / 0.4))
        elif v == "chew":
            v = 0.5
        kb.value = float(v)


for name in names:
    act = bpy.data.actions[name]
    arm.animation_data.action = act
    n = clips[name]["frames"]
    side = name in ("Walk", "Trot", "Hop", "Hop_Loop")
    paths = []
    for i in range(8):
        f = 1 + round(i * n / 8)
        bpy.context.scene.frame_set(f)
        set_face(clips[name].get("face") or {}, i / 8)
        root = arm.matrix_world @ arm.pose.bones["root"].head
        target = Vector((root.x, root.y, 0.13))
        aim(cam, [body], 90 if side else 32, 8, pad=1.15, target=target + Vector((0, 0.01, 0)), size=0.19)
        paths.append(still(os.path.join(out_dir, f"{name}_{i}.png")))
    montage(paths, os.path.join(out_dir, f"strip_{name}.png"), 8)
    print("KIN_STRIP", name)
