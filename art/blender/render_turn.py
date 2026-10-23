"""Render a 4-angle turntable montage of the visible meshes in a .blend.
    blender -b <file.blend> -P art/blender/render_turn.py -- <out.png> [crystal_debug]
"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
from kin_render import aim, camera, montage, still, studio  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
out = argv[0]
if "crystal_debug" in argv and "KIN_Crystal" in bpy.data.materials:
    m = bpy.data.materials["KIN_Crystal"]
    b = m.node_tree.nodes["Principled BSDF"]
    for l in list(b.inputs["Base Color"].links):
        m.node_tree.links.remove(l)
    b.inputs["Base Color"].default_value = (1, 0.1, 0.4, 1)
studio(512)
cam = camera()
objs = [o for o in bpy.context.scene.objects if o.type == "MESH" and not o.hide_render]
paths = []
for i, yaw in enumerate((0, 90, 180, 270)):
    aim(cam, objs, yaw, 6)
    paths.append(still(f"{out}.{i}.png"))
montage(paths, out, 4)
print("KIN_RENDERED", out)
