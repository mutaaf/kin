"""Shared helpers for the KIN character pipeline (headless Blender 5.2)."""
import math

import bpy
import numpy as np
from mathutils import Matrix, Vector

HEIGHT_M = 0.28  # top of the ears, metres (a small cat-sized creature; Unity scales in-engine)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def select_only(*objs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or (objs[0] if objs else None)


def image_array(img):
    """Image pixels as float32 HxWx4 (row 0 = bottom, Blender convention)."""
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def write_image_array(img, arr):
    img.pixels.foreach_set(arr.astype(np.float32).ravel())
    img.update()


def face_uv_centroids(me):
    """Per-face UV centroid (N x 2) from the active UV layer."""
    uv = me.uv_layers.active.data
    n = len(me.polygons)
    out = np.zeros((n, 2), dtype=np.float32)
    for p in me.polygons:
        acc = Vector((0.0, 0.0))
        for li in p.loop_indices:
            acc += uv[li].uv
        out[p.index] = acc / len(p.loop_indices)
    return out


def sample(arr, uv):
    """Sample an HxWx4 array at UV coordinates (N x 2), nearest pixel."""
    h, w = arr.shape[:2]
    x = np.clip((uv[:, 0] % 1.0) * w, 0, w - 1).astype(int)
    y = np.clip((uv[:, 1] % 1.0) * h, 0, h - 1).astype(int)
    return arr[y, x]


def luminance(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def face_centres(me, mw=Matrix.Identity(4)):
    n = len(me.polygons)
    c = np.empty(n * 3, dtype=np.float32)
    me.polygons.foreach_get("center", c)
    c = c.reshape(n, 3)
    if mw != Matrix.Identity(4):
        m = np.array(mw)
        c = c @ m[:3, :3].T + m[:3, 3]
    return c


def face_normals(me):
    n = len(me.polygons)
    a = np.empty(n * 3, dtype=np.float32)
    me.polygons.foreach_get("normal", a)
    return a.reshape(n, 3)


def vert_coords(me):
    n = len(me.vertices)
    a = np.empty(n * 3, dtype=np.float32)
    me.vertices.foreach_get("co", a)
    return a.reshape(n, 3)


def set_vert_coords(me, arr):
    me.vertices.foreach_set("co", arr.astype(np.float32).ravel())
    me.update()


def rasterize_uv_tris(mask, tris_uv):
    """Mark pixels inside UV triangles (list of 3x2 arrays) in a boolean HxW mask."""
    h, w = mask.shape
    for t in tris_uv:
        p = t * np.array([w, h])
        x0, y0 = np.floor(p.min(0)).astype(int)
        x1, y1 = np.ceil(p.max(0)).astype(int)
        x0, y0 = max(x0 - 1, 0), max(y0 - 1, 0)
        x1, y1 = min(x1 + 1, w - 1), min(y1 + 1, h - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = p
        d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(d) < 1e-9:
            continue
        l1 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / d
        l2 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / d
        l3 = 1 - l1 - l2
        inside = (l1 >= -0.02) & (l2 >= -0.02) & (l3 >= -0.02)
        mask[y0:y1 + 1, x0:x1 + 1] |= inside


def look_rot(forward, up=Vector((0, 0, 1))):
    """Rotation matrix whose local +Z points along `forward`, local +Y roughly along `up`."""
    f = forward.normalized()
    r = up.cross(f)
    if r.length < 1e-6:
        r = Vector((1, 0, 0))
    r.normalize()
    u = f.cross(r).normalized()
    return Matrix((r, u, f)).transposed()


def ease(t):
    return t * t * (3 - 2 * t)


def deg(v):
    return math.radians(v)
