# Headless Blender stage 1: import the generated hero model, normalise it, report stats, and
# render a 4-angle turntable so we can judge it before rigging.
#   blender -b -P art/blender/inspect_model.py -- <in.glb> <out_dir>
import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]

# Bounds across all meshes, in world space.
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
size = hi - lo
print(f"KIN_STATS meshes={len(meshes)} bounds={tuple(round(v, 3) for v in size)}")
for o in meshes:
    me = o.data
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    quads = sum(1 for p in me.polygons if len(p.vertices) == 4)
    mats = [m.name for m in me.materials if m]
    print(f"KIN_MESH {o.name} verts={len(me.vertices)} faces={len(me.polygons)} tris={tris} quads={quads} uv={len(me.uv_layers)} mats={mats}")

# Normalise: feet on the ground, centred, height 1.0 (Unity units = metres; scaled in-engine).
root = bpy.data.objects.new("KIN_root", None)
bpy.context.scene.collection.objects.link(root)
for o in meshes:
    o.parent = root
centre = (lo + hi) / 2
root.location = (-centre.x, -centre.y, -lo.z)
scale = 1.0 / max(size.z, 1e-6)
root.scale = (scale, scale, scale)
bpy.context.view_layer.update()

# Studio: soft key, fill, rim; neutral grey world. EEVEE for speed.
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
scene.render.resolution_x = scene.render.resolution_y = 768
scene.world = bpy.data.worlds.new("w")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.32, 0.33, 0.36, 1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.6

def light(name, kind, energy, loc, rot, size=2.0):
    d = bpy.data.lights.new(name, kind)
    d.energy = energy
    if kind == "AREA":
        d.size = size
    o = bpy.data.objects.new(name, d)
    o.location = loc
    o.rotation_euler = [math.radians(a) for a in rot]
    scene.collection.objects.link(o)

light("key", "AREA", 400, (2.2, -2.4, 2.6), (55, 0, 40), 2.5)
light("fill", "AREA", 150, (-2.6, -1.8, 1.4), (70, 0, -55), 3)
light("rim", "AREA", 300, (0, 2.6, 2.2), (-55, 0, 180), 1.5)

cam_d = bpy.data.cameras.new("cam")
cam_d.lens = 70
cam = bpy.data.objects.new("cam", cam_d)
scene.collection.objects.link(cam)
scene.camera = cam
target = Vector((0, 0, 0.5))
for i, ang in enumerate((0, 90, 180, 270)):
    a = math.radians(ang)
    cam.location = target + Vector((math.sin(a) * -3.4, math.cos(a) * -3.4, 0.35))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = f"{out}/turn_{ang:03d}.png"
    bpy.ops.render.render(write_still=True)
print("KIN_DONE")
