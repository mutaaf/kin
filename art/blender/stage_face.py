"""Stage 2: eyes that look like the concept, seated in real sockets, and a face that can emote.

    blender -b <stage_mesh.blend> -P art/blender/stage_face.py -- <out.blend> [<front.png>]

1. Find the painted eyes on LOD0 (dark + teal, front of the head), symmetrise them.
2. Iris art FROM THE CONCEPT: crop each painted eye from art/source/front.png (deep teal, layered
   catchlights, dark limbal ring) and front-project it onto the eyeball. A catchlight-free copy
   is exported too, so the engine can add live glossy highlights instead.
3. Seat the eyes: eyeballs are wide spherical caps that sit only slightly proud of the face; the
   head is carved into a socket around each, with a rounded lid lip. Per pixel, the old painted
   eye is replaced by fur, a soft dark lash line rings the socket (thicker on top), and the
   corners get a little ambient occlusion.
4. Lids: furred shells (UVs sampled from the face fur around each eye) with a thick lash rim.
   Their edges are curves across the eye, so Blink closes to a gentle curved lash line, Sleepy and
   HalfLid droop softly, HappySquint makes true upward "^ ^" arcs, Worried lifts the inner corners.
5. Facial blendshapes on both LODs: Mouth_Smile, Mouth_Open, Mouth_O, Cheeks_Puff, Ears_Relax.
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(__file__))
from kin_common import (face_centres, face_normals, face_uv_centroids, image_array, luminance,  # noqa: E402
                        sample, vert_coords, write_image_array)

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
FRONT = argv[1] if len(argv) > 1 else os.path.join(os.path.dirname(os.path.dirname(__file__)), "sourc" + "e", "front.png")
lod0 = bpy.data.objects["KIN_LOD0"]
lod1 = bpy.data.objects["KIN_LOD1"]
me = lod0.data
base_img = bpy.data.images["kin_basecolor"]
mask_img = bpy.data.images["kin_crystal_mask"]
orm_img = bpy.data.images["kin_orm"]
base = image_array(base_img)

# ── 1. Locate the painted eyes ──────────────────────────────────────────────────────────────────
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
raw = {}
for side, sgn in (("L", 1), ("R", -1)):  # Blender +X is the creature's left (it faces -Y)
    m = cand & (np.sign(cen[:, 0]) == sgn)
    pts = cen[m]
    med = np.median(pts, 0)
    d = np.linalg.norm(pts - med, axis=1)
    idx = np.where(m)[0][d < max(np.median(d) * 1.8, 1e-4)]
    c = cen[idx].mean(0)
    raw[side] = (Vector(c), float(np.percentile(np.linalg.norm(cen[idx] - c, axis=1), 90)), len(idx))
mir = Vector((-1, 1, 1))
(cl, rl, nl), (cr, rr, nr) = raw["L"], raw["R"]
cL = (cl * nl + cr * mir * nr) / (nl + nr)
r_ap = (rl * nl + rr * nr) / (nl + nr)  # eye aperture radius on the face
eyes = {}
for side, c in (("L", cL), ("R", cL * mir)):
    sgn = 1 if side == "L" else -1
    f = Vector((-sgn * 0.04, -1.0, 0.06)).normalized()  # look at the viewer, like the concept
    up = Vector((0, 0, 1))
    rgt = up.cross(f).normalized()
    up = f.cross(rgt).normalized()
    # A wide spherical cap: proud of the face by only 0.25 r, meeting the face at radius r.
    p = 0.25 * r_ap
    R = (r_ap * r_ap / p + p) / 2
    Rd = R - p
    eyes[side] = {"c": c, "f": f, "rot": Matrix((rgt, up, f)).transposed(), "R": R, "ec": c - f * Rd, "sgn": sgn}
    print(f"KIN_EYE {side} centre={np.round(c[:], 4)} aperture={r_ap:.4f} sphereR={R:.4f}")

# ── 2. Iris art from the concept ────────────────────────────────────────────────────────────────
src = bpy.data.images.load(FRONT, check_existing=False)
art = image_array(src)  # rows bottom-up
ih, iw = art.shape[:2]
a_rgb = art[..., :3]
a_lum = luminance(a_rgb)
a_teal = (a_rgb[..., 1] > a_rgb[..., 0] + 0.15) & (a_rgb[..., 2] > a_rgb[..., 0] + 0.12) & (a_lum < 0.45)  # deep iris teal, not mint crystal
a_dark = a_lum < 0.18
yy, xx = np.mgrid[0:ih, 0:iw]
region = (yy > 0.38 * ih) & (yy < 0.72 * ih) & (xx > 0.22 * iw) & (xx < 0.78 * iw)
eye_px = (a_teal | a_dark) & region


def resize(img, n):
    h, w = img.shape[:2]
    ys = (np.arange(n) + 0.5) * h / n - 0.5
    xs = (np.arange(n) + 0.5) * w / n - 0.5
    y0, x0 = np.clip(np.floor(ys).astype(int), 0, h - 2), np.clip(np.floor(xs).astype(int), 0, w - 2)
    fy, fx = (ys - y0)[:, None, None], (xs - x0)[None, :, None]
    a, b = img[y0][:, x0], img[y0][:, x0 + 1]
    c_, d_ = img[y0 + 1][:, x0], img[y0 + 1][:, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c_ * (1 - fx) + d_ * fx) * fy


def inpaint(img, hole, iters=400):
    for _ in range(4):  # take the soft halo of each highlight too
        hole = hole | np.roll(hole, 1, 0) | np.roll(hole, -1, 0) | np.roll(hole, 1, 1) | np.roll(hole, -1, 1)
    out = img.copy()
    out[hole] = np.median(img[~hole & np.roll(hole, 6, 0)], 0) if hole.any() else 0  # seed: the iris just below
    for _ in range(iters):
        blur = (np.roll(out, 1, 0) + np.roll(out, -1, 0) + np.roll(out, 1, 1) + np.roll(out, -1, 1)) / 4
        out[hole] = blur[hole]
    return out


IRIS = 0.8        # iris radius as a fraction of the visible eye aperture (big, kind concept eyes)
CROP = 1.6        # the crop spans this many iris radii (sclera sliver, lash outline, then fur)
TEX_SCALE = IRIS * CROP  # aperture radii covered by half the eye texture
crops = {}
for side, in_left_half in (("R", True), ("L", False)):  # image left = world -X = creature's right
    m = a_teal & region & ((xx < iw / 2) == in_left_half)  # the teal iris ring bounds the eye
    ys_, xs_ = np.where(m)
    # The teal ring spans the iris's full width and its lower edge (the top is dark pupil).
    x0, x1 = np.percentile(xs_, [1, 99])
    y0 = np.percentile(ys_, 1)  # rows are bottom-up
    rad = (x1 - x0) / 2
    cx, cy = (x0 + x1) / 2, y0 + rad
    half = rad * CROP
    crop = art[int(cy - half):int(cy + half), int(cx - half):int(cx + half)]
    crop = resize(crop, 512)
    crop[..., 3] = 1.0
    lumc = luminance(crop[..., :3])
    g = np.linspace(-1, 1, 512)
    rr_ = np.sqrt(g[None, :] ** 2 + g[:, None] ** 2)
    catch = (lumc > 0.62) & (rr_ < 1.04 / CROP)  # highlights inside the iris only (not sclera)
    # Beyond the eye opening the socket is in shadow: fade the crop to the lash colour there.
    edge = np.clip((rr_ - 0.95 / TEX_SCALE) / (0.1 / TEX_SCALE), 0, 1)[..., None]
    crop[..., :3] = crop[..., :3] * (1 - edge) + np.array([0.06, 0.08, 0.11]) * edge
    clean = crop.copy()
    clean[..., :3] = inpaint(crop[..., :3], catch)
    crops[side] = (crop, clean)
    print(f"KIN_EYE_ART {side} centre_px=({cx:.0f},{cy:.0f}) half={half:.0f} catchlight_px={int(catch.sum())}")
bpy.data.images.remove(src)

eye_imgs = {}
for side, (crop, clean) in crops.items():
    for suffix, arr in (("", crop), ("_nocatch", clean)):
        img = bpy.data.images.new(f"kin_eye_{side}{suffix}", 512, 512, alpha=False)
        write_image_array(img, arr)
        img.pack()
        img.use_fake_user = True  # the catchlight-free copy has no material user; keep it for export
        eye_imgs[side + suffix] = img
for old in ("kin_eye",):
    if old in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[old])


def eye_material(side):
    m = bpy.data.materials.new(f"KIN_Eye_{side}")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    t = m.node_tree.nodes.new("ShaderNodeTexImage")
    t.image = eye_imgs[side]
    m.node_tree.links.new(t.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.18  # painted catchlights carry the sparkle; keep env reflections soft
    b.inputs["Coat Weight"].default_value = 0.6
    b.inputs["Coat Roughness"].default_value = 0.05
    return m


# ── 3. Eyeball caps ─────────────────────────────────────────────────────────────────────────────
def eyeball(side):
    e = eyes[side]
    R, ec, rot = e["R"], e["ec"], e["rot"]
    a_max = math.asin(min(1.0, r_ap * 1.12 / R))  # just past the lip crest, never through the face
    RINGS, SEG = 18, 64
    verts, faces, uvs = [], [], []
    T = r_ap * TEX_SCALE
    for i in range(RINGS + 1):
        a = a_max * i / RINGS
        for j in range(SEG):
            b = 2 * math.pi * j / SEG
            lv = Vector((R * math.sin(a) * math.cos(b), R * math.sin(a) * math.sin(b), R * math.cos(a)))
            verts.append(rot @ lv)  # object origin = eyeball centre, so the engine can rotate it to look
            uvs.append((0.5 + lv.x / (2 * T), 0.5 + lv.y / (2 * T)))
    for i in range(RINGS):
        for j in range(SEG):
            a0, a1 = i * SEG + j, i * SEG + (j + 1) % SEG
            faces.append((a0, a1, a1 + SEG, a0 + SEG))
    md = bpy.data.meshes.new(f"KIN_Eye_{side}")
    md.from_pydata([v[:] for v in verts], [], faces)
    md.update()
    ul = md.uv_layers.new(name="UVMap").data
    for p in md.polygons:
        p.use_smooth = True
        for li in p.loop_indices:
            ul[li].uv = uvs[md.loops[li].vertex_index]
    bm = bmesh.new(); bm.from_mesh(md)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(md); bm.free()
    md.materials.append(eye_material(side))
    o = bpy.data.objects.new(f"KIN_Eye_{side}", md)
    o.location = ec
    o["kin_eye_anchor"] = list(e["c"] - e["f"] * 0.44 * r_ap)  # just behind the lid line: rig landmark
    bpy.context.scene.collection.objects.link(o)
    return o


for side in eyes:
    if f"KIN_Eye_{side}" in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects[f"KIN_Eye_{side}"])
    eyeball(side)


# ── 4. Sockets in the head (both LODs) ──────────────────────────────────────────────────────────
def carve(o):
    """Socket + lid lip: inside the opening the face sits just behind the eyeball; around it the face
    rises into a soft rounded lip slightly proud of the eye, so the eye reads as seated, not stuck on."""
    co = vert_coords(o.data)
    LIP = 0.13 * r_ap
    for e in eyes.values():
        ec, f, R = np.array(e["ec"][:]), np.array(e["f"][:]), e["R"]
        rel = co - ec
        along = rel @ f
        perp = rel - along[:, None] * f
        d = np.linalg.norm(perp, axis=1) / r_ap
        sel = (d < 1.6) & (along > 0) & (along < R * 1.4)
        ts = np.sqrt(np.maximum(R * R - (d * r_ap) ** 2, 0))
        k = np.clip((d - 0.88) / 0.17, 0, 1)
        k = k * k * (3 - 2 * k)
        T = ts - 0.0012 * (1 - k) + LIP * k  # socket floor → lip crest at 1.05 r
        inner = d < 1.05
        w = np.clip((1.6 - d) / 0.55, 0, 1)
        w = w * w * (3 - 2 * w)
        new = np.where(inner, T, along + np.maximum(T - along, 0) * w)
        co[sel] += ((new - along)[sel])[:, None] * f
    o.data.vertices.foreach_set("co", co.astype(np.float32).ravel())
    o.data.update()


carve(lod0)
carve(lod1)

# ── 5. Paint: fur over the old eye, lash line, corner AO (per pixel) ───────────────────────────
fur_ring = []
for e in eyes.values():
    rel = cen - np.array(e["ec"][:])
    along = rel @ np.array(e["f"][:])
    d = np.linalg.norm(rel - along[:, None] * np.array(e["f"][:]), axis=1)
    fur_ring.append((d > 1.5 * r_ap) & (d < 2.0 * r_ap) & front & (lum > 0.75))
ring = np.logical_or(*fur_ring)
fur = np.median(col[ring], 0) if ring.any() else np.array([0.93, 0.93, 0.93])
LASH = np.array([0.07, 0.09, 0.13])
print("KIN_FUR_AROUND_EYES", np.round(fur, 3))

h, w = base.shape[:2]
newb = base.copy()
mk = image_array(mask_img)
orm = image_array(orm_img)
uvl = me.uv_layers.active.data
co0 = vert_coords(me)
done = np.zeros((h, w), bool)
for p in me.polygons:
    pc = cen[p.index]
    if min(np.linalg.norm(pc - np.array(e["c"][:])) for e in eyes.values()) > 2.2 * r_ap:
        continue
    loops = list(p.loop_indices)
    for k in range(1, len(loops) - 1):
        tri = [loops[0], loops[k], loops[k + 1]]
        tuv = np.array([uvl[l].uv[:] for l in tri]) * [w, h]
        tpos = np.array([co0[me.loops[l].vertex_index] for l in tri])
        x0_, y0_ = np.floor(tuv.min(0)).astype(int) - 1
        x1_, y1_ = np.ceil(tuv.max(0)).astype(int) + 1
        x0_, y0_, x1_, y1_ = max(x0_, 0), max(y0_, 0), min(x1_, w - 1), min(y1_, h - 1)
        if x1_ < x0_ or y1_ < y0_:
            continue
        gx, gy = np.meshgrid(np.arange(x0_, x1_ + 1) + 0.5, np.arange(y0_, y1_ + 1) + 0.5)
        (ax, ay), (bx, by), (cx_, cy_) = tuv
        den = (by - cy_) * (ax - cx_) + (cx_ - bx) * (ay - cy_)
        if abs(den) < 1e-9:
            continue
        l1 = ((by - cy_) * (gx - cx_) + (cx_ - bx) * (gy - cy_)) / den
        l2 = ((cy_ - ay) * (gx - cx_) + (ax - cx_) * (gy - cy_)) / den
        l3 = 1 - l1 - l2
        inside = (l1 >= -0.03) & (l2 >= -0.03) & (l3 >= -0.03)
        if not inside.any():
            continue
        pos = l1[..., None] * tpos[0] + l2[..., None] * tpos[1] + l3[..., None] * tpos[2]
        best_d = np.full(pos.shape[:2], 9.0)
        best_up = np.zeros(pos.shape[:2])
        best_x = np.zeros(pos.shape[:2])
        for e in eyes.values():
            rel = pos - np.array(e["ec"][:])
            fv = np.array(e["f"][:])
            along = rel @ fv
            perp = rel - along[..., None] * fv
            dd = np.linalg.norm(perp, axis=-1)
            upv = np.array((e["rot"] @ Vector((0, 1, 0)))[:])
            rgv = np.array((e["rot"] @ Vector((1, 0, 0)))[:])
            closer = dd < best_d
            best_d = np.where(closer, dd, best_d)
            best_up = np.where(closer, (perp @ upv) / np.maximum(dd, 1e-6), best_up)
            best_x = np.where(closer, (perp @ rgv) / np.maximum(dd, 1e-6), best_x)
        dn = best_d / r_ap
        m = inside & (dn < 2.0)
        if not m.any():
            continue
        sl = (slice(y0_, y1_ + 1), slice(x0_, x1_ + 1))
        px = newb[sl]
        # Fur everywhere near the eye (removes every trace of the painted eye) …
        tgt = np.broadcast_to(fur, px[..., :3].shape).copy()
        # … darkened toward the socket (ambient occlusion), most in the corners.
        corner = np.abs(best_x) ** 4
        ao = np.clip((1.4 - dn) / 0.4, 0, 1) * (0.08 + 0.12 * corner)
        tgt *= (1 - ao)[..., None]
        # Lash line: a soft dark band at the socket edge, thicker on top and toward the outer corner.
        top = np.clip(best_up, 0, 1)
        outer = np.clip(best_x, -1, 1)
        rim_in, rim_out = 0.86, 0.97 + 0.14 * top ** 1.5 + 0.06 * top * np.clip(np.abs(outer), 0, 1)
        lash = np.clip((dn - rim_in) / 0.05, 0, 1) * np.clip((rim_out - dn) / 0.05, 0, 1)
        lash = np.where(dn < rim_in, 1.0, lash)  # socket interior: dark (hidden behind the eye)
        tgt = tgt * (1 - lash[..., None]) + LASH * lash[..., None]
        # Blend into the untouched fur at the outer edge of the paint region.
        fade = np.clip((2.0 - dn) / 0.3, 0, 1)[..., None]
        newpx = px.copy()
        newpx[..., :3] = px[..., :3] * (1 - fade) + tgt * fade
        px[m] = newpx[m]
        mk[sl][m] = np.where(fade[m] > 0.5, 0.0, mk[sl][m])
        orm[sl][m, 1] = np.where(lash[m] > 0.5, 0.6, 0.86)
        done[sl] |= m
write_image_array(base_img, newb)
write_image_array(mask_img, mk)
write_image_array(orm_img, orm)
for img in (base_img, mask_img, orm_img):
    img.pack()
print("KIN_EYES_PAINTED px", int(done.sum()))

# ── 6. Lids ─────────────────────────────────────────────────────────────────────────────────────
# Each lid is a furred shell over the eye, bounded to the socket (x, y within 1.25 aperture radii,
# in the eye's own plane; the rest of it tucks under the face). Its edge is a curve across the eye,
# in aperture radii (y = 1 is the top of the eye opening):
#   upper edge  y = c - k·u² + tilt·u_inner        lower edge  y = c + k·u²
# with u the across-eye position (-1..1) and u_inner = +1 at the inner (nose) corner.
POSES = {
    #                upper (c, k, tilt)     lower (c, k)
    "Basis":       ((0.9, 0.12, 0.0), (-1.12, 0.0)),     # a soft lash line just over the iris top
    "Blink":       ((-0.30, -0.26, 0.0), (-0.18, 0.26)),  # gentle downward-curved lash line  ‿
    "HalfLid":     ((0.30, 0.22, 0.0), (-1.05, 0.0)),    # soft, kind droop from the top
    "Sleepy":      ((0.02, 0.24, 0.0), (-0.78, 0.18)),   # heavier droop, lower lid lifts a touch
    "HappySquint": ((0.10, 0.62, 0.0), (0.16, -0.62)),   # cheeks push the lower lid up: ^ ^
    "Wide":        ((1.22, 0.0, 0.0), (-1.25, 0.0)),     # lids fully tucked: every bit of the eye
    "Worried":     ((0.62, 0.12, 0.30), (-1.08, 0.0)),   # inner corners up
}
EXTENT = 1.1  # lid half-size in aperture radii (tucked under the lip)
COLS, ROWS = 28, 10


def lid_points(side, upper, lower):
    e = eyes[side]
    inner = -e["sgn"]  # local x toward the nose
    pts = []
    for which, spec in (("U", upper), ("D", lower)):
        sgn_y = 1 if which == "U" else -1
        rad = e["R"] + r_ap * (0.11 if which == "U" else 0.09)  # flush with the lip; upper rides over the lower
        for j in range(COLS + 1):
            u = -EXTENT + 2 * EXTENT * j / COLS
            un = max(-1.0, min(1.0, u))
            if which == "U":
                edge = spec[0] - spec[1] * un * un + spec[2] * un * inner
            else:
                edge = spec[0] + spec[1] * un * un
            far = sgn_y * math.sqrt(max(EXTENT * EXTENT - u * u, 0.0))  # outer limit (under the face)
            edge = min(edge, far) if which == "U" else max(edge, far)
            col_pts = []
            band = sgn_y * min(0.16, abs(edge - far) * 0.35)  # dark lash band at the edge
            for i in range(ROWS):
                col_pts.append((u, far + (edge + band - far) * i / (ROWS - 1), rad))
            col_pts.append((u, edge, rad))
            col_pts.append((u, edge - sgn_y * 0.02, e["R"] * 0.996))  # thickness: rim tucks to the eye
            for (x_, y_, rr_) in col_pts:
                x, y = x_ * r_ap, y_ * r_ap
                z = math.sqrt(max(rr_ * rr_ - x * x - y * y, 0.0))
                pts.append(e["ec"] + e["rot"] @ Vector((x, y, z)))
    return pts


PER_COL = ROWS + 2


def build_lids():
    verts = lid_points("L", *POSES["Basis"]) + lid_points("R", *POSES["Basis"])
    faces = []
    for cap in range(4):
        base_i = cap * (COLS + 1) * PER_COL
        for j in range(COLS):
            for i in range(PER_COL - 1):
                a = base_i + j * PER_COL + i
                faces.append((a, a + PER_COL, a + PER_COL + 1, a + 1))
    md = bpy.data.meshes.new("KIN_Lids")
    md.from_pydata([v[:] for v in verts], [], faces)
    md.update()
    md.materials.append(bpy.data.materials["KIN_Body"])
    # UVs: the lid body samples the face fur around the eye (same direction, 1.7 r out) so it
    # matches the surrounding colour; the edge and rim rows sample the painted lash line.
    from mathutils.geometry import barycentric_transform
    bvh = BVHTree.FromObject(lod0, bpy.context.evaluated_depsgraph_get())
    uvl0 = lod0.data.uv_layers.active.data

    def uv_at(q):
        loc, _n, fi, _d = bvh.find_nearest(q)
        if fi is None:
            return (0.5, 0.5)
        ls = list(lod0.data.polygons[fi].loop_indices)[:3]
        vs = [lod0.data.vertices[lod0.data.loops[l].vertex_index].co for l in ls]
        uvs3 = [Vector((*uvl0[l].uv, 0)) for l in ls]
        u = barycentric_transform(loc, *vs, *uvs3)
        return (u.x, u.y)

    # Per-vertex sampling would straddle UV seams, so each lid maps a small planar patch of the fur
    # just above its eye (one UV island, real fur detail), and its lash rows one deep-lash texel.
    def patch(side):
        e = eyes[side]
        q = e["c"] + e["rot"] @ Vector((0, 1.8 * r_ap, 0))
        loc, _n, fi, _d = bvh.find_nearest(q)
        poly = lod0.data.polygons[fi]
        ls = list(poly.loop_indices)
        uv_area = 0.0
        for k in range(1, len(ls) - 1):
            a, b, c_ = (Vector(uvl0[ls[0]].uv), Vector(uvl0[ls[k]].uv), Vector(uvl0[ls[k + 1]].uv))
            uv_area += abs((b - a).cross(c_ - a)) / 2
        texel = math.sqrt(uv_area / max(poly.area, 1e-12))  # UV units per metre
        return Vector(uv_at(q)), texel * 0.35, Vector(uv_at(e["c"]))

    vuv = []
    for side in ("L", "R"):
        e = eyes[side]
        uv0, k_uv, lash_uv = patch(side)
        for which in ("U", "D"):
            for j in range(COLS + 1):
                for i in range(PER_COL):
                    vi = len(vuv)
                    if i >= ROWS - 1:  # lash band, leading edge, tucked rim
                        vuv.append(tuple(lash_uv))
                    else:
                        local = e["rot"].transposed() @ (Vector(verts[vi]) - e["ec"])
                        vuv.append((uv0.x + local.x * k_uv, uv0.y + local.y * k_uv))
    ul = md.uv_layers.new(name="UVMap").data
    for p in md.polygons:
        p.use_smooth = True
        for li in p.loop_indices:
            ul[li].uv = vuv[md.loops[li].vertex_index]
    o = bpy.data.objects.new("KIN_Lids", md)
    bpy.context.scene.collection.objects.link(o)
    o.shape_key_add(name="Basis")
    for name, pose in POSES.items():
        if name == "Basis":
            continue
        k = o.shape_key_add(name=name, from_mix=False)
        k.value = 0.0  # Blender 5 creates scripted keys at full strength; rest = neutral
        for i, pt in enumerate(lid_points("L", *pose) + lid_points("R", *pose)):
            k.data[i].co = pt
    # Open shells: face every quad away from its eyeball (Unity culls back faces).
    bm = bmesh.new(); bm.from_mesh(md)
    centres = [eyes["L"]["ec"], eyes["R"]["ec"]]
    flip = [f for f in bm.faces
            if f.normal.dot(f.calc_center_median() - min(centres, key=lambda c: (c - f.calc_center_median()).length)) < 0]
    bmesh.ops.reverse_faces(bm, faces=flip)
    bm.to_mesh(md); bm.free()
    return o


if "KIN_Lids" in bpy.data.objects:
    bpy.data.objects.remove(bpy.data.objects["KIN_Lids"])
lids = build_lids()

# ── 7. Facial shape keys on the body LODs ───────────────────────────────────────────────────────
eye_mid = (eyes["L"]["c"] + eyes["R"]["c"]) / 2
eye_gap = (eyes["L"]["c"] - eyes["R"]["c"]).length
dark_front = dark & front & band & (np.abs(cen[:, 0]) < 0.006)
nose = Vector(cen[dark_front].mean(0)) if dark_front.any() else eye_mid - Vector((0, 0.005, 0.02))
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
    d = np.zeros_like(co)
    for s in (1, -1):
        c = mouth + Vector((s * corner, 0, 0))
        d += falloff(co, c, 0.42 * eye_gap)[:, None] * np.array([s * 0.06, 0.08, 0.22]) * eye_gap
    keys["Mouth_Smile"] = d
    f = falloff(co, mouth - Vector((0, 0, 0.12 * eye_gap)), 0.55 * eye_gap) * (co[:, 2] < mouth.z)
    keys["Mouth_Open"] = f[:, None] * np.array([0, 0.12, -0.3]) * eye_gap
    f = falloff(co, mouth, 0.45 * eye_gap)
    toward = (np.array(mouth[:]) - co) * np.array([1, 0, 0.6])
    keys["Mouth_O"] = f[:, None] * (toward * 0.35 + np.array([0, -0.08, 0]) * eye_gap)
    # Cheeks puff: under and outside the eyes, up and out (pushes the lower lids up when happy).
    d = np.zeros_like(co)
    for s in (1, -1):
        c = eye_mid + Vector((s * 0.6 * eye_gap, 0.04 * eye_gap, -0.42 * eye_gap))
        d += falloff(co, c, 0.5 * eye_gap)[:, None] * np.array([s * 0.1, -0.05, 0.08]) * eye_gap
    keys["Cheeks_Puff"] = d
    d = np.zeros_like(co)
    top = co[:, 2].max()
    root_z = eye_mid.z + 0.55 * (top - eye_mid.z)
    for s in (1, -1):
        sel = (co[:, 2] > root_z) & (np.sign(co[:, 0]) == s) & (np.abs(co[:, 0]) > 0.25 * eye_gap)
        pivot = np.array([s * 0.9 * eye_gap, eye_mid.y + 0.1 * eye_gap, root_z])
        rot = np.array(Matrix.Rotation(math.radians(-24) * s, 3, "Y"))
        wgt = np.clip((co[sel, 2] - root_z) / max(top - root_z, 1e-4), 0, 1)[:, None]
        d[sel] += ((co[sel] - pivot) @ rot.T + pivot - co[sel]) * wgt
    keys["Ears_Relax"] = d
    for name, delta in keys.items():
        k = o.shape_key_add(name=name, from_mix=False)
        k.value = 0.0
        k.data.foreach_set("co", (co + delta).astype(np.float32).ravel())
    return list(keys)


face_keys = add_face_keys(lod0)
add_face_keys(lod1)
print("KIN_FACE_KEYS", face_keys, "lid_keys", [k for k in POSES if k != "Basis"])
bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
print("KIN_STAGE_FACE_DONE")
