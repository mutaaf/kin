"""Proof renders: studio light rig, auto-framed cameras, and grid montages (headless)."""
import math
import os

import bpy
import numpy as np
from mathutils import Vector


def studio(res=640, film_transparent=False):
    sc = bpy.context.scene
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    sc.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
    sc.render.resolution_x = sc.render.resolution_y = res
    sc.render.film_transparent = film_transparent
    sc.view_settings.view_transform = "AgX" if "AgX" in [i.identifier for i in sc.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"
    if not sc.world:
        sc.world = bpy.data.worlds.new("studio")
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.36, 0.38, 0.42, 1)
    bg.inputs[1].default_value = 0.7
    for name in ("kin_key", "kin_fill", "kin_rim"):
        if name in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects[name])

    def light(name, energy, loc, size, color=(1, 1, 1)):
        d = bpy.data.lights.new(name, "AREA")
        d.energy, d.size, d.color = energy, size, color
        o = bpy.data.objects.new(name, d)
        o.location = loc
        o.rotation_euler = (Vector((0, 0, 0.12)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        sc.collection.objects.link(o)

    light("kin_key", 22, (0.45, -0.55, 0.6), 0.6, (1.0, 0.95, 0.88))
    light("kin_fill", 9, (-0.6, -0.4, 0.3), 0.8, (0.85, 0.9, 1.0))
    light("kin_rim", 18, (0.1, 0.6, 0.5), 0.4, (0.8, 1.0, 0.95))


def camera(name="kin_cam", lens=85):
    sc = bpy.context.scene
    if name in bpy.data.objects:
        return bpy.data.objects[name]
    d = bpy.data.cameras.new(name)
    d.lens = lens
    o = bpy.data.objects.new(name, d)
    sc.collection.objects.link(o)
    sc.camera = o
    return o


def bounds(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def aim(cam, objs, yaw_deg, pitch_deg=8, pad=1.25, target=None, size=None):
    lo, hi = bounds(objs)
    c = target or (lo + hi) / 2
    radius = size or max((hi - lo).length / 2, 1e-3)
    fov = 2 * math.atan(cam.data.sensor_width / (2 * cam.data.lens))
    dist = radius * pad / math.sin(fov / 2)
    y, p = math.radians(yaw_deg), math.radians(pitch_deg)
    cam.location = c + Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p))) * dist
    cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()


def still(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def montage(paths, out, cols, label_pad=0):
    imgs = []
    for p in paths:
        im = bpy.data.images.load(p, check_existing=False)
        w, h = im.size
        a = np.empty(w * h * 4, dtype=np.float32)
        im.pixels.foreach_get(a)
        imgs.append(a.reshape(h, w, 4))
        bpy.data.images.remove(im)
    h, w = imgs[0].shape[:2]
    rows = math.ceil(len(imgs) / cols)
    canvas = np.ones((rows * h, cols * w, 4), dtype=np.float32) * np.array([0.1, 0.1, 0.12, 1.0], dtype=np.float32)
    for i, a in enumerate(imgs):
        r, c = divmod(i, cols)
        r = rows - 1 - r  # image rows are bottom-up
        canvas[r * h:(r + 1) * h, c * w:(c + 1) * w] = a[:h, :w]
    img = bpy.data.images.new(os.path.basename(out), cols * w, rows * h, alpha=True)
    img.pixels.foreach_set(canvas.ravel())
    img.filepath_raw = out
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    for p in paths:
        try:
            os.remove(p)
        except OSError:
            pass
    return out
