"""Stress-pose sheet (and a rig debug view with joint markers).
    blender -b <rig.blend> -P art/blender/render_poses.py -- <out.png>
"""
import math
import os
import sys

import bpy
from mathutils import Euler

sys.path.insert(0, os.path.dirname(__file__))
from kin_render import aim, camera, montage, still, studio  # noqa: E402

out = sys.argv[sys.argv.index("--") + 1]
arm = bpy.data.objects["Armature"]
for pb in arm.pose.bones:
    pb.rotation_mode = "XYZ"
R = math.radians


def reset():
    for pb in arm.pose.bones:
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)


def rot(name, x=0, y=0, z=0):
    if name in arm.pose.bones:
        arm.pose.bones[name].rotation_euler = Euler((R(x), R(y), R(z)))


POSES = {
    "rest": lambda: None,
    "head_turn_40": lambda: (rot("neck_02", y=15), rot("head", y=28)),
    "sit": lambda: (rot("hips", x=-38), rot("spine_02", x=8), rot("chest", x=14), rot("neck_01", x=10),
                    rot("leg_back_upper.L", x=-60), rot("leg_back_upper.R", x=-60),
                    rot("leg_back_lower.L", x=95), rot("leg_back_lower.R", x=95),
                    rot("leg_back_foot.L", x=-30), rot("leg_back_foot.R", x=-30)),
    "ear_flop": lambda: [rot(f"ear_0{i}.{s}", x=-20, z=(-25 if s == "L" else 25)) for i in (1, 2, 3) for s in "LR"],
    "tail_curl": lambda: [rot(f"tail_0{i}", x=-22, z=12) for i in range(1, 7)],
    "leg_lift": lambda: (rot("leg_front_upper.L", x=-55), rot("leg_front_lower.L", x=70), rot("leg_front_foot.L", x=-20)),
}

studio(420)
cam = camera(lens=85)
body = [bpy.data.objects["KIN_LOD0"]]
markers = "--markers" in sys.argv
if markers:
    bpy.data.objects["KIN_LOD0"].hide_render = True
    mat = bpy.data.materials.new("marker")
    mat.diffuse_color = (1, 0.2, 0.4, 1)
    for b in arm.data.bones:
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.004, location=arm.matrix_world @ b.head_local)
        bpy.context.active_object.data.materials.append(mat)
paths = []
for name, fn in POSES.items():
    reset()
    fn()
    bpy.context.view_layer.update()
    aim(cam, body, 35, 10)
    paths.append(still(f"{out}.{name}.png"))
    if markers:
        break
montage(paths, out, 3 if not markers else 1)
print("KIN_RENDERED", out)
