"""Expression sheet: front close-ups of the head across shape-key expressions.
    blender -b <file.blend> -P art/blender/render_faces.py -- <out.png> [yaw]
"""
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
from kin_render import aim, camera, montage, still, studio  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
out = argv[0]
yaw = float(argv[1]) if len(argv) > 1 else 12

EXPR = {
    "neutral": {},
    "blink": {"Blink": 1},
    "happy": {"HappySquint": 1, "Mouth_Smile": 1, "Cheeks_Puff": 0.6},
    "surprised": {"Wide": 1, "Mouth_O": 1},
    "sad": {"Worried": 1, "Ears_Relax": 1},
    "petted": {"HappySquint": 0.9, "Mouth_Smile": 0.7, "Cheeks_Puff": 1, "Ears_Relax": 0.5},
}


def set_keys(values):
    for o in bpy.context.scene.objects:
        sk = getattr(o.data, "shape_keys", None) if o.type == "MESH" else None
        if not sk:
            continue
        for kb in sk.key_blocks[1:]:
            kb.value = values.get(kb.name, 0.0)


studio(420)
cam = camera(lens=100)
eyes = [bpy.data.objects[n] for n in ("KIN_Eye_L", "KIN_Eye_R") if n in bpy.data.objects]
head_c = sum((e.matrix_world.translation for e in eyes), Vector()) / max(len(eyes), 1)
head_c.z += 0.012
paths = []
for name, vals in EXPR.items():
    set_keys(vals)
    aim(cam, [o for o in bpy.context.scene.objects if o.name == "KIN_LOD0"], yaw, 4, pad=1.0, target=head_c, size=0.062)
    paths.append(still(f"{out}.{name}.png"))
montage(paths, out, 3)
print("KIN_RENDERED", out)
