"""Stage 3: a quadruped rig built from mesh landmarks, skinned with automatic weights.

    blender -b <stage_face.blend> -P art/blender/stage_rig.py -- <out.blend>

Landmarks (metres, forward -Y, up +Z, symmetric about x=0):
  tail   = vertices with no mirror counterpart (the body is symmetric, the tail sweeps to one side)
  legs   = the four low clusters (side x front/back)
  spine  = body centroids from chest (front) to hips (back)
  head   = centred between the eyes, set back into the skull; jaw toward the chin
  ears   = the top of the mesh on each side, base to tip
Bone rolls are aligned so each bone's local X is the creature's side axis: pitch = X everywhere.
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector, kdtree

sys.path.insert(0, os.path.dirname(__file__))
from kin_common import select_only, vert_coords  # noqa: E402

OUT = sys.argv[sys.argv.index("--") + 1]
lod0 = bpy.data.objects["KIN_LOD0"]
lod1 = bpy.data.objects["KIN_LOD1"]
co = vert_coords(lod0.data)
H = co[:, 2].max()
eyeL, eyeR = (Vector(bpy.data.objects[n].get("kin_eye_anchor", bpy.data.objects[n].matrix_world.translation))
              for n in ("KIN_Eye_L", "KIN_Eye_R"))  # the eye pivot sits deep in the socket; use its anchor
eye_mid = (eyeL + eyeR) / 2
gap = (eyeL - eyeR).length

# ── Tail: vertices whose mirror image has no nearby vertex ──────────────────────────────────────
kd = kdtree.KDTree(len(co))
for i, p in enumerate(co):
    kd.insert(p, i)
kd.balance()
tol = 0.006
asym = np.array([kd.find((-p[0], p[1], p[2]))[2] > tol for p in co])
# Keep the big asymmetric blob that sits behind the body (the tail), drop stray speckle.
ys = co[:, 1]
tail_m = asym & (ys > np.percentile(ys, 35))
tail = co[tail_m]
print("KIN_TAIL verts", int(tail_m.sum()), "side_x", round(float(np.median(tail[:, 0])), 4))
body_m = ~tail_m

# ── Legs ────────────────────────────────────────────────────────────────────────────────────────
low = body_m & (co[:, 2] < 0.18 * H)
ymid = float(np.median(co[low, 1]))
legs = {}
for side, sx in (("L", 1), ("R", -1)):
    for end, front in (("F", True), ("B", False)):
        m = low & (np.sign(co[:, 0]) == sx) & ((co[:, 1] < ymid) == front)
        pts = co[m]
        foot = pts[pts[:, 2] < 0.03 * H]
        fc = foot.mean(0) if len(foot) else pts.mean(0)
        toe = foot[np.argmin(foot[:, 1])] if len(foot) else fc
        legs[side + end] = {"foot": Vector(fc), "toe": Vector(toe), "x": float(np.median(pts[:, 0]))}
print("KIN_LEGS", {k: tuple(round(c, 3) for c in v["foot"]) for k, v in legs.items()})

# ── Spine ───────────────────────────────────────────────────────────────────────────────────────
torso = body_m & (co[:, 2] > 0.16 * H) & (co[:, 2] < 0.46 * H) & (np.abs(co[:, 0]) < 0.6 * gap * 2)
tp = co[torso]
y0, y1 = np.percentile(tp[:, 1], 8), np.percentile(tp[:, 1], 92)
spine_y = np.linspace(y1, y0, 6)  # hips (back, +Y) to chest (front, -Y)
spine = []
for y in spine_y:
    sl = tp[np.abs(tp[:, 1] - y) < (y1 - y0) / 8]
    z = np.percentile(sl[:, 2], 55) if len(sl) else 0.3 * H
    spine.append(Vector((0, y, z)))
hips, chest = spine[0], spine[-1]

# ── Head, jaw, ears ─────────────────────────────────────────────────────────────────────────────
head_c = eye_mid + Vector((0, 0.9 * gap, -0.05 * gap))
head_top = head_c + Vector((0, 0.15 * gap, 1.1 * gap))
nose = Vector((0, eye_mid.y - 0.42 * gap, eye_mid.z - 0.3 * gap))
chin = Vector((0, eye_mid.y - 0.25 * gap, eye_mid.z - 0.62 * gap))
neck_base = Vector((0, chest.y + 0.15 * gap, chest.z + 0.25 * gap))
ears = {}
for side, sx in (("L", 1), ("R", -1)):
    m = body_m & (np.sign(co[:, 0]) == sx) & (co[:, 2] > head_c.z + 0.9 * gap) & (np.abs(co[:, 0]) > 0.3 * gap)
    pts = co[m]
    tip = Vector(pts[pts[:, 2] > np.percentile(pts[:, 2], 94)].mean(0))
    base = Vector(pts[pts[:, 2] < np.percentile(pts[:, 2], 12)].mean(0))
    ears[side] = (base, tip)
print("KIN_HEAD", tuple(round(c, 3) for c in head_c), "ears", {k: (tuple(round(c, 3) for c in b), tuple(round(c, 3) for c in t)) for k, (b, t) in ears.items()})

# ── Tail chain: order tail vertices by distance from the hips, bin into 6 ───────────────────────
d = np.linalg.norm(tail - np.array(hips[:]), axis=1)
order = np.argsort(d)
tail_sorted = tail[order]
cuts = np.array_split(tail_sorted, 7)
tail_pts = [Vector(hips[:])] + [Vector(c.mean(0)) for c in cuts[1:]]
tail_pts[0] = hips.lerp(Vector(cuts[0].mean(0)), 0.6)

# ── Build the armature ──────────────────────────────────────────────────────────────────────────
arm_d = bpy.data.armatures.new("Armature")
arm = bpy.data.objects.new("Armature", arm_d)
bpy.context.scene.collection.objects.link(arm)
select_only(arm)
bpy.ops.object.mode_set(mode="EDIT")
eb = arm_d.edit_bones


def bone(name, head, tail, parent=None, connect=False):
    b = eb.new(name)
    b.head, b.tail = Vector(head), Vector(tail)
    if (b.tail - b.head).length < 1e-4:
        b.tail = b.head + Vector((0, 0, 0.005))
    if parent:
        b.parent = eb[parent]
        b.use_connect = connect
    # Local X = side axis: vertical bones align Z to forward, horizontal ones align Z to up.
    v = (b.tail - b.head).normalized()
    b.align_roll(Vector((0, -1, 0)) if abs(v.z) > 0.7 else Vector((0, 0, 1)))
    return b


ground = Vector((0, hips.y * 0.5 + chest.y * 0.5, 0))
bone("root", ground, ground + Vector((0, -0.04, 0)))
bone("hips", hips, spine[1], "root")
bone("spine_01", spine[1], spine[2], "hips", True)
bone("spine_02", spine[2], spine[3], "spine_01", True)
bone("spine_03", spine[3], spine[4], "spine_02", True)
bone("chest", spine[4], spine[5], "spine_03", True)
neck_mid = neck_base.lerp(head_c, 0.5) + Vector((0, 0.05 * gap, 0))
bone("neck_01", chest, neck_mid, "chest", True)
bone("neck_02", neck_mid, head_c, "neck_01", True)
bone("head", head_c, head_top, "neck_02", True)
bone("jaw", head_c + Vector((0, -0.2 * gap, -0.25 * gap)), chin, "head")
for side, (b0, t0) in ears.items():
    b1 = b0.lerp(t0, 0.36)
    b2 = b0.lerp(t0, 0.7)
    bone(f"ear_01.{side}", b0, b1, "head")
    bone(f"ear_02.{side}", b1, b2, f"ear_01.{side}", True)
    bone(f"ear_03.{side}", b2, t0, f"ear_02.{side}", True)
prev = "hips"
for i in range(6):
    bone(f"tail_{i + 1:02d}", tail_pts[i], tail_pts[i + 1], prev, i > 0)
    prev = f"tail_{i + 1:02d}"
for key, L in legs.items():
    side, end = key[0], key[1]
    x = L["x"]
    attach = chest if end == "F" else hips
    top = Vector((x, L["foot"].y, attach.z * 0.92))
    knee = Vector((x, L["foot"].y + (0.012 if end == "F" else -0.012), top.z * 0.48))
    ankle = Vector((x, L["foot"].y, 0.035 * H))
    foot = Vector((x, L["foot"].y - 0.04 * gap, 0.006))
    toe = Vector((x, L["toe"].y, 0.004))
    parent = "chest" if end == "F" else "hips"
    n = "front" if end == "F" else "back"
    bone(f"leg_{n}_upper.{side}", top, knee, parent)
    bone(f"leg_{n}_lower.{side}", knee, ankle, f"leg_{n}_upper.{side}", True)
    bone(f"leg_{n}_foot.{side}", ankle, foot, f"leg_{n}_lower.{side}", True)
    bone(f"leg_{n}_toe.{side}", foot, toe if (toe - foot).length > 0.004 else foot + Vector((0, -0.01, 0)), f"leg_{n}_foot.{side}", True)
bpy.ops.object.mode_set(mode="OBJECT")
bone_names = [b.name for b in arm_d.bones]
print("KIN_BONES", len(bone_names), bone_names)

# ── Skin: automatic weights on both LODs; eyes and lids ride the head ───────────────────────────
for o in (lod0, lod1):
    select_only(o, arm, active=arm)
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    groups = len(o.vertex_groups)
    # Mobile: at most 4 influences per vertex, normalised.
    select_only(o)
    bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    unweighted = sum(1 for v in o.data.vertices if not v.groups)
    print("KIN_SKIN", o.name, "groups", groups, "unweighted_verts", unweighted)
for name in ("KIN_Eye_L", "KIN_Eye_R", "KIN_Lids"):
    o = bpy.data.objects[name]
    vg = o.vertex_groups.new(name="head")
    vg.add(list(range(len(o.data.vertices))), 1.0, "REPLACE")
    mw = o.matrix_world.copy()
    o.parent = arm
    o.matrix_world = mw
    mod = o.modifiers.new("Armature", "ARMATURE")
    mod.object = arm

bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
print("KIN_STAGE_RIG_DONE")
