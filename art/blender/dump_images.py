"""Save named packed images from a .blend to PNG (for inspection).
    blender -b <file.blend> -P art/blender/dump_images.py -- <out_dir> name1 name2 ...
"""
import os
import sys
import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
out = argv[0]
os.makedirs(out, exist_ok=True)
for name in argv[1:]:
    img = bpy.data.images.get(name)
    if not img:
        print("KIN_MISSING", name)
        continue
    img.filepath_raw = os.path.join(out, name + ".png")
    img.file_format = "PNG"
    img.save()
    print("KIN_SAVED", img.filepath_raw)
