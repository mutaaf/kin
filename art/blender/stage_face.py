"""Stage 2: real eyes and a face that can emote.

    blender -b <stage_mesh.blend> -P art/blender/stage_face.py -- <out.blend>

1. Find the painted eyes on LOD0 (dark + teal iris colour, front of the head), one per side.
2. Paint them out of the base colour (fill with the surrounding fur) and out of the crystal mask.
3. Build glossy eyeballs (procedural iris/pupil texture, front pole = pupil) at those spots.
4. Build eyelids (a separate fur mesh) with shape keys: Blink, HalfLid, HappySquint, Wide,
   Worried, Sleepy. Lids live in their own mesh so every LOD shares them.
5. Facial shape keys on both LOD meshes: Mouth_Smile, Mouth_Open, Mouth_O, Cheeks_Puff, Ears_Relax.
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
from kin_common import (face_centres, face_normals, face_uv_centroids, image_array, luminance,  # noqa: E402
                        rasterize_uv_tris, sample, vert_coords, write_image_array)

OUT = sys.argv[sys.argv.index("--") + 1]
lod0 = bpy.data.objects["KIN_LOD0"]
lod1 = bpy.data.objects["KIN_LOD1"]
me = lod0.data
base_img = bpy.data.images["kin_basecolor"]
mask_img = bpy.data.images["kin_crystal_mask"]
orm_img = bpy.data.images["kin_orm"]
base = image_array(base_img)

# ── 1. Locate the eyes ──────────────────────────────────────────────────────────────────────────
uv = face_uv_centroids(me)
col = sample(base, uv)[:, :3]
lum = luminance(col)
cen = face_centres(me)
nrm = face_normals(me)
H = cen[:, 2].max()
teal = (col[:, 1] > col[:, 0] + 0.12) & (col[:, 2] > col[:, 0] + 0.1) & (lum < 0.62)
dark = lum < 0.28
front = nrm[:, 1] < -0.25
band = (cen[:, 2] > 0.35 * H) & (cen[:, 2] < 0.75 * H)
cand = (teal | dark) & front & band & (np.abs(cen[:, 0]) > 0.006)
eyes = {}
for side, sgn in (("L", 1), ("R", -1)):  # Blender +X is the creature's left (it faces -Y)
    m = cand & (np.sign(cen[:, 0]) == sgn)
    # Keep the dense cluster: faces within 1.6 median distances of the cluster median.
    pts = cen[m]
    med = np.median(pts, 0)
    d = np.linalg.norm(pts - med, axis=1)
    keep = d < max(np.median(d) * 1.8, 1e-4)
    idx = np.where(m)[0][keep]
    c = cen[idx].mean(0)
    n = nrm[idx].mean(0)
    n /= np.linalg.norm(n)
    # Radius from the painted eye's extent (90th percentile), so the eyeball covers all of it.
    r = float(np.percentile(np.linalg.norm(cen[idx] - c, axis=1), 90))
    eyes[side] = {"faces": idx, "centre": Vector(c), "normal": Vector(n), "radius": r, "n": len(idx)}
    print(f"KIN_EYE_RAW {side} centre={np.round(c, 4)} normal={np.round(n, 2)} radius={r:.4f} faces={len(idx)}")

# The creature is symmetric about x=0: average each eye with the mirror of the other, weighted by
# how much evidence each side had, so one noisy side can't put the eyes askew.
mir = Vector((-1, 1, 1))
wl, wr = eyes["L"]["n"], eyes["R"]["n"]
cL = (eyes["L"]["centre"] * wl + eyes["R"]["centre"] * mir * wr) / (wl + wr)
nL = (eyes["L"]["normal"] * wl + eyes["R"]["normal"] * mir * wr).normalized()
rad = (eyes["L"]["radius"] * wl + eyes["R"]["radius"] * wr) / (wl + wr)
eyes["L"].update(centre=cL, normal=nL, radius=rad)
eyes["R"].update(centre=cL * mir, normal=nL * mir, radius=rad)
for side in eyes:
    e = eyes[side]
    print(f"KIN_EYE {side} centre={np.round(e['centre'][:], 4)} normal={np.round(e['normal'][:], 2)} radius={e['radius']:.4f}")

# ── 2. Paint the old eyes out (texture) and out of the crystal mask ─────────────────────────────
h, w = base.shape[:2]
eye_mask = np.zeros((h, w), bool)
uvl = me.uv_layers.active.data
tris = []
for side in eyes:
    for fi in eyes[side]["faces"]:
        p = me.polygons[fi]
        loops = list(p.loop_indices)
        for k in range(1, len(loops) - 1):
            tris.append(np.array([uvl[loops[0]].uv[:], uvl[loops[k]].uv[:], uvl[loops[k + 1]].uv[:]]))
rasterize_uv_tris(eye_mask, tris)
# Dilate a little so the dark rim goes too.
for _ in range(7):
    eye_mask[1:, :] |= eye_mask[:-1, :]; eye_mask[:-1, :] |= eye_mask[1:, :]
    eye_mask[:, 1:] |= eye_mask[:, :-1]; eye_mask[:, :-1] |= eye_mask[:, 1:]
# Fur colour: bright, low-saturation pixels of the face (median), so lids and patch match.
face_fur = col[(~cand) & front & band & (lum > 0.8)]
fur = np.median(face_fur, 0) if len(face_fur) else np.array([0.93, 0.93, 0.94])
fill = base.copy()
fill[eye_mask, :3] = fur
# Soften the patch edge by blending a 6px feather.
edge = eye_mask.copy()
for _ in range(6):
    e2 = edge.copy()
    e2[1:, :] |= edge[:-1, :]; e2[:-1, :] |= edge[1:, :]; e2[:, 1:] |= edge[:, :-1]; e2[:, :-1] |= edge[:, 1:]
    ring = e2 & ~edge
    fill[ring, :3] = fill[ring, :3] * 0.5 + fur * 0.5
    edge = e2
write_image_array(base_img, fill)
mk = image_array(mask_img)
mk[eye_mask, :3] = 0
write_image_array(mask_img, mk)
orm = image_array(orm_img)
orm[eye_mask, 1] = 0.86
write_image_array(orm_img, orm)
for img in (base_img, mask_img, orm_img):
    img.pack()
print("KIN_EYES_PAINTED px", int(eye_mask.sum()), "fur", np.round(fur, 3))

# ── 3. Eyeballs ─────────────────────────────────────────────────────────────────────────────────
def iris_texture(size=512):
    y, x = np.mgrid[0:size, 0:size] / (size - 1) * 2 - 1
    r = np.sqrt(x * x + y * y)
    a = np.arctan2(y, x)
    teal_in = np.array([0.30, 0.86, 0.84])
    teal_out = np.array([0.03, 0.36, 0.42])
    sclera = np.array([0.97, 0.98, 0.99])
    t = np.clip(r / 0.82, 0, 1)
    fibres = 0.06 * np.sin(a * 48 + r * 9) * (t > 0.35)
    iris = (teal_in * (1 - t[..., None] ** 1.6) + teal_out * t[..., None] ** 1.6) + fibres[..., None]
    img = np.where((r < 0.82)[..., None], iris, sclera)
    ring = np.exp(-((r - 0.82) / 0.035) ** 2)  # dark limbal ring = depth and appeal
    img = img * (1 - 0.85 * ring[..., None])
    pupil = r < 0.36
    img[pupil] = [0.02, 0.03, 0.05]
    out = np.dstack([np.clip(img, 0, 1), np.ones((size, size))])
    tex = bpy.data.images.new("kin_eye", size, size, alpha=False)
    write_image_array(tex, out[::-1])
    tex.pack()
    return tex


eye_tex = iris_texture()
eye_mat = bpy.data.materials.new("KIN_Eye")
eye_mat.use_nodes = True
eb = eye_mat.node_tree.nodes["Principled BSDF"]
et = eye_mat.node_tree.nodes.new("ShaderNodeTexImage")
et.image = eye_tex
eye_mat.node_tree.links.new(et.outputs["Color"], eb.inputs["Base Color"])
eb.inputs["Roughness"].default_value = 0.08
eb.inputs["Coat Weight"].default_value = 1.0
eb.inputs["Coat Roughness"].default_value = 0.02


def frame_for(side):
    e = eyes[side]
    # Look straight ahead with a hint of convergence and lift (attentive, cute), rather than along
    # the surface normal, which tilts ~15° outward and reads as wall-eyed.
    sgn = 1 if side == "L" else -1
    f = Vector((-sgn * 0.04, -1.0, 0.06)).normalized()
    up = Vector((0, 0, 1))
    rgt = up.cross(f).normalized()
    up = f.cross(rgt).normalized()
    return Matrix((rgt, up, f)).transposed(), f


def eyeball(side):
    e = eyes[side]
    R = e["radius"] * 1.05
    rot, f = frame_for(side)
    centre = e["centre"] - f * (R * 0.42)  # bulge out by ~0.58R: glossy, 3D, catches light
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=R)
    o = bpy.context.active_object
    o.name = o.data.name = f"KIN_Eye_{side}"
    # Rotate so the sphere's +Z pole faces forward; planar UVs on the front hemisphere.
    md = o.data
    while md.uv_layers:  # the primitive ships lat-long UVs; replace them, don't add a second set
        md.uv_layers.remove(md.uv_layers[0])
    uvl_ = md.uv_layers.new(name="UVMap").data
    for p in md.polygons:
        for li in p.loop_indices:
            v = md.vertices[md.loops[li].vertex_index].co
            if v.z > 0:
                uvl_[li].uv = (0.5 + v.x / R * 0.5, 0.5 + v.y / R * 0.5)
            else:
                uvl_[li].uv = (0.02, 0.02)  # sclera corner
    o.matrix_world = Matrix.Translation(centre) @ rot.to_4x4()
    md.materials.append(eye_mat)
    for p in md.polygons:
        p.use_smooth = True
    e["R"], e["ball"], e["frame"], e["ball_centre"] = R, o, rot, centre
    return o


for side in eyes:
    eyeball(side)

# ── 4. Eyelids with shape keys ──────────────────────────────────────────────────────────────────
lid_mat = bpy.data.materials.new("KIN_Lid")
lid_mat.use_nodes = True
lb = lid_mat.node_tree.nodes["Principled BSDF"]
lb.inputs["Base Color"].default_value = (*[float(c) ** 1.0 for c in fur], 1)
lb.inputs["Roughness"].default_value = 0.9
lb.inputs["Sheen Weight"].default_value = 0.6

ROWS, COLS = 10, 28
# (upper lid closure 0..1, lower lid closure 0..1, upper tilt deg (+ = inner corner up))
POSES = {
    "Basis": (0.04, 0.0, 0),
    "Blink": (1.0, 0.33, 0),
    "HalfLid": (0.55, 0.14, 0),
    "HappySquint": (0.6, 0.62, -6),
    "Wide": (0.02, 0.0, 0),
    "Worried": (0.36, 0.1, 18),
    "Sleepy": (0.8, 0.22, -4),
}


def lid_points(side, upper_c, lower_c, tilt):
    """Shell around the eyeball: upper cap from the top down, lower cap from the bottom up."""
    e = eyes[side]
    R = e["R"] * 1.03  # hug the eyeball: a lid, not a shell
    rot, centre = e["frame"], e["ball_centre"]
    sgn = 1 if side == "L" else -1  # inner corner is toward the nose (x→0)
    pts = []
    for which, closure, tdeg in (("U", upper_c, tilt), ("D", lower_c, 0)):
        # Polar angle from the lid's pole (up or down); 90° = the eye's equator line.
        # The visible cap of a protruding eyeball reaches well below its equator, so a full blink
        # sweeps the upper lid to ~140° and lifts the lower lid to meet it.
        th_max = math.radians(8 + closure * 132) if which == "U" else math.radians(6 + closure * 100)
        for i in range(ROWS + 1):
            th = th_max * i / ROWS
            for j in range(COLS + 1):
                ph = math.radians(-78 + 156 * j / COLS)  # across the front of the eye
                # Point on a sphere with the pole along local +Y (or -Y), sweeping toward +Z.
                y = math.cos(th)
                rr = math.sin(th)
                x, z = rr * math.sin(ph), rr * math.cos(ph)
                if which == "D":
                    y = -y
                v = Vector((x, y, z)) * R
                if tdeg:
                    # Tilt about the forward axis: inner corner (toward the nose) up.
                    v = Matrix.Rotation(math.radians(tdeg) * -sgn, 3, "Z") @ v
                pts.append(centre + rot @ v)
    return pts


def build_lids():
    verts = lid_points("L", *POSES["Basis"]) + lid_points("R", *POSES["Basis"])
    faces = []
    per_cap = (ROWS + 1) * (COLS + 1)
    for cap in range(4):
        o0 = cap * per_cap
        for i in range(ROWS):
            for j in range(COLS):
                a = o0 + i * (COLS + 1) + j
                faces.append((a, a + 1, a + COLS + 2, a + COLS + 1))
    md = bpy.data.meshes.new("KIN_Lids")
    md.from_pydata([v[:] for v in verts], [], faces)
    md.update()
    md.materials.append(lid_mat)
    # Pin every lid UV to fur just above the left eye, so the lids take the body's exact fur
    # colour and shading (the lids use the body material).
    above = eyes["L"]["centre"] + Vector((0, 0, eyes["L"]["radius"] * 1.6))
    fi = int(np.argmin(np.linalg.norm(cen - np.array(above[:]), axis=1)))
    fur_uv = tuple(uv[fi])
    lu = md.uv_layers.new(name="UVMap").data
    for li in range(len(lu)):
        lu[li].uv = fur_uv
    md.materials[0] = bpy.data.materials["KIN_Body"]
    o = bpy.data.objects.new("KIN_Lids", md)
    bpy.context.scene.collection.objects.link(o)
    for p in md.polygons:
        p.use_smooth = True
    o.shape_key_add(name="Basis")
    for name, pose in POSES.items():
        if name == "Basis":
            continue
        k = o.shape_key_add(name=name, from_mix=False)
        pts = lid_points("L", *pose) + lid_points("R", *pose)
        for i, p in enumerate(pts):
            k.data[i].co = p
    # Faces point outward (normals from winding may be inverted for the lower caps).
    import bmesh
    bm = bmesh.new(); bm.from_mesh(md)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(md); bm.free()
    return o


lids = build_lids()

# ── 5. Facial shape keys on the body LODs ───────────────────────────────────────────────────────
dark_front = dark & front & band & (np.abs(cen[:, 0]) < 0.006)
nose = Vector(cen[dark_front].mean(0)) if dark_front.any() else (eyes["L"]["centre"] + eyes["R"]["centre"]) / 2 - Vector((0, 0.005, 0.02))
eye_mid = (eyes["L"]["centre"] + eyes["R"]["centre"]) / 2
eye_gap = (eyes["L"]["centre"] - eyes["R"]["centre"]).length
mouth = nose + Vector((0, 0.002, -0.22 * eye_gap))
print("KIN_FACE nose", np.round(nose[:], 4), "mouth", np.round(mouth[:], 4), "eye_gap", round(eye_gap, 4))


def falloff(co, centre, radius):
    d = np.linalg.norm(co - np.array(centre[:]), axis=1)
    return np.clip(1 - d / radius, 0, 1) ** 2


def add_face_keys(o):
    md = o.data
    if not md.shape_keys:
        o.shape_key_add(name="Basis")
    co = vert_coords(md)
    keys = {}
    corner = 0.32 * eye_gap
    # Smile: mouth corners up and back.
    d = np.zeros_like(co)
    for s in (1, -1):
        c = mouth + Vector((s * corner, 0, 0))
        f = falloff(co, c, 0.42 * eye_gap)
        d += f[:, None] * np.array([s * 0.06, 0.08, 0.22]) * eye_gap
    keys["Mouth_Smile"] = d
    # Open: chin region down and back (the jaw bone does the big moves; this shapes the lips).
    f = falloff(co, mouth - Vector((0, 0, 0.12 * eye_gap)), 0.55 * eye_gap) * (co[:, 2] < mouth.z)
    keys["Mouth_Open"] = f[:, None] * np.array([0, 0.12, -0.3]) * eye_gap
    # O: lips gather to the centre and push forward.
    f = falloff(co, mouth, 0.45 * eye_gap)
    toward = (np.array(mouth[:]) - co) * np.array([1, 0, 0.6])
    keys["Mouth_O"] = f[:, None] * (toward * 0.35 + np.array([0, -0.08, 0]) * eye_gap)
    # Cheeks puff: under and outside the eyes, out along the surface.
    d = np.zeros_like(co)
    for s in (1, -1):
        c = eye_mid + Vector((s * 0.62 * eye_gap, 0.04 * eye_gap, -0.35 * eye_gap))
        f = falloff(co, c, 0.5 * eye_gap)
        d += f[:, None] * np.array([s * 0.12, -0.04, 0.02]) * eye_gap
    keys["Cheeks_Puff"] = d
    # Ears relax: rotate everything above the ear roots outward and down about each root.
    d = np.zeros_like(co)
    top = co[:, 2].max()
    root_z = eye_mid.z + 0.55 * (top - eye_mid.z)
    for s in (1, -1):
        sel = (co[:, 2] > root_z) & (np.sign(co[:, 0]) == s) & (np.abs(co[:, 0]) > 0.25 * eye_gap)
        pivot = np.array([s * 0.9 * eye_gap, eye_mid.y + 0.1 * eye_gap, root_z])
        ang = math.radians(-24) * s  # roll outward (about Y)
        rot = np.array(Matrix.Rotation(ang, 3, "Y"))
        w = np.clip((co[sel, 2] - root_z) / max(top - root_z, 1e-4), 0, 1)[:, None]
        moved = (co[sel] - pivot) @ rot.T + pivot
        d[sel] += (moved - co[sel]) * w
    keys["Ears_Relax"] = d
    for name, delta in keys.items():
        k = o.shape_key_add(name=name, from_mix=False)
        k.data.foreach_set("co", (co + delta).astype(np.float32).ravel())
    return list(keys)


face_keys = add_face_keys(lod0)
add_face_keys(lod1)
print("KIN_FACE_KEYS", face_keys, "lid_keys", [k for k in POSES if k != "Basis"])

bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
print("KIN_STAGE_FACE_DONE")
