"""Re-import the exports into an empty scene and report what an engine would see.
    blender -b -P art/blender/verify_export.py -- <export_dir>
"""
import os
import sys

import bpy

d = sys.argv[sys.argv.index("--") + 1]
for fn, imp in (("kin_hero.fbx", lambda p: bpy.ops.import_scene.fbx(filepath=p)),
                ("kin_hero.glb", lambda p: bpy.ops.import_scene.gltf(filepath=p))):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    imp(os.path.join(d, fn))
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    print("VERIFY", fn, "armatures", len(arms), "bones", len(arms[0].data.bones) if arms else 0,
          "meshes", sorted(o.name for o in meshes))
    print("VERIFY", fn, "actions", len(bpy.data.actions), sorted(a.name for a in bpy.data.actions)[:30])
    for o in meshes:
        if o.data.shape_keys:
            print("VERIFY", fn, "shapekeys", o.name, [k.name for k in o.data.shape_keys.key_blocks[1:]])
    lod = next((o for o in meshes if "LOD0" in o.name), None)
    if lod:
        # Blender re-converts to Z-up on import; what matters is the creature faces -Y again and
        # its height is ~0.28 m (round-trip of units/axes is intact).
        vs = [lod.matrix_world @ v.co for v in lod.data.vertices]
        z = [v.z for v in vs]
        eye = next((o for o in meshes if "Eye_L" in o.name), None)
        print("VERIFY", fn, "LOD0 height", round(max(z) - min(z), 4), "eye_y", round(eye.matrix_world.translation.y, 4) if eye else None,
              "body_y_mid", round(sum(v.y for v in vs) / len(vs), 4))
