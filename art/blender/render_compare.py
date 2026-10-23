"""Face check against the concept: [concept face crop | 3D neutral | 3/4 neutral | 3/4 happy].
    blender -b <file.blend> -P art/blender/render_compare.py -- <out.png> <front.png>
"""
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
from kin_render import aim, camera, montage, still, studio  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
out, front = argv[0], argv[1]
RES = 480
HAPPY = {"HappySquint": 1, "Mouth_Smile": 1, "Cheeks_Puff": 0.6}


def set_keys(values):
    for o in bpy.context.scene.objects:
        sk = getattr(o.data, "shape_keys", None) if o.type == "MESH" else None
        if sk:
            for kb in sk.key_blocks[1:]:
                kb.value = values.get(kb.name, 0.0)


# Concept: square crop centred between the painted eyes, spanning the face (eyes to chin).
src = bpy.data.images.load(front, check_existing=False)
w, h = src.size
a = np.empty(w * h * 4, dtype=np.float32)
src.pixels.foreach_get(a)
a = a.reshape(h, w, 4)
bpy.data.images.remove(src)
cx, cy, half = int(0.537 * w), int(0.52 * h), int(0.215 * w)  # rows bottom-up
crop = a[cy - half:cy + half, cx - half:cx + half]
idx = (np.arange(RES) * crop.shape[0] / RES).astype(int)
crop = crop[idx][:, idx]
img = bpy.data.images.new("concept_crop", RES, RES, alpha=True)
img.pixels.foreach_set(crop.ravel())
concept_path = f"{out}.concept.png"
img.filepath_raw = concept_path
img.file_format = "PNG"
img.save()

studio(RES)
cam = camera(lens=100)
eyes = [bpy.data.objects[n] for n in ("KIN_Eye_L", "KIN_Eye_R")]
target = sum((e.matrix_world.translation for e in eyes), Vector()) / 2
target.z -= 0.006
body = [bpy.data.objects["KIN_LOD0"]]
paths = [concept_path]
for name, yaw, vals in (("front", 12, {}), ("q_neutral", 35, {}), ("q_happy", 35, HAPPY)):
    set_keys(vals)
    aim(cam, body, yaw, 6, pad=1.0, target=target, size=0.075)
    paths.append(still(f"{out}.{name}.png"))
set_keys({})
montage(paths, out, 4)
print("KIN_RENDERED", out)
