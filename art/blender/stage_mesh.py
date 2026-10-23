"""Stage 1: import the raw generated model, weld seams, orient/scale, build LODs, derive the
crystal mask + ORM textures, and (optionally) bake a normal map from the high-poly source.

    blender -b -P art/blender/stage_mesh.py -- <raw.glb> <out.blend> [--bake]

Crystals vs fur: the reconstruction fuses crystal facets and fur into the same faces, so faces
can't be split reliably (tested: colour, sharpness and protrusion classifiers all mislabel the
irises, inner ears or tail fluff). Instead a per-pixel CRYSTAL MASK is derived from the base colour
(strong mint saturation) and drives gloss, emission and translucency in one body material.
Eyes are excluded from the mask later (stage_face) when their UV regions are known.
"""
import os
import sys

import bmesh
import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from kin_common import HEIGHT_M, clear_scene, image_array, mesh_objects, select_only, write_image_array  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = argv[0], argv[1]
BAKE = "--bake" in argv
LOD_TRIS = {"LOD0": 30000, "LOD1": 10000}

clear_scene()
bpy.ops.import_scene.gltf(filepath=SRC)
raw = mesh_objects()[0]
raw.name = raw.data.name = "KIN_High"

# Which image feeds which input of the generated material.
src_mat = raw.data.materials[0]
tex = {}
for n in src_mat.node_tree.nodes:
    if n.type == "TEX_IMAGE":
        for link in n.outputs["Color"].links:
            to = link.to_node
            tex[link.to_socket.name if to.type == "BSDF_PRINCIPLED" else to.type] = n.image
base_img = tex["Base Color"]
base_img.name = "kin_basecolor"
base_img.pack()

# Weld the glTF seam splits (positions only; UVs stay per-loop).
bm = bmesh.new()
bm.from_mesh(raw.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
bm.to_mesh(raw.data)
bm.free()

# Orient + scale: feet at z=0, centred in x/y, ear tips at HEIGHT_M. Forward stays -Y.
co = np.array([v.co[:] for v in raw.data.vertices])
lo, hi = co.min(0), co.max(0)
s = HEIGHT_M / (hi[2] - lo[2])
# The symmetry plane is NOT the bbox centre: the tail sticks out to one side. Centre x on the
# head + ears (top 42% of the height), which are symmetric and clear of the tail.
top = co[co[:, 2] > lo[2] + 0.58 * (hi[2] - lo[2])]
x0 = (top[:, 0].min() + top[:, 0].max()) / 2
co = (co - [x0, (lo[1] + hi[1]) / 2, lo[2]]) * s
print("KIN_SYMMETRY_PLANE x0", round(float(x0), 4), "bbox_centre", round(float((lo[0] + hi[0]) / 2), 4))
raw.data.vertices.foreach_set("co", co.astype(np.float32).ravel())
raw.data.update()
print("KIN_SCALE", round(s, 5), "bounds_m", np.round((hi - lo) * s, 4))

# Crystal mask (R) and ORM (R=AO 1, G=roughness, B=metallic 0) from the base colour.
base = image_array(base_img)
rgb = base[..., :3]
mx, mn = rgb.max(-1), rgb.min(-1)
sat = (mx - mn) / np.maximum(mx, 1e-4)
mintness = np.clip((rgb[..., 1] - rgb[..., 0] - 0.06) / 0.12, 0, 1) * np.clip((rgb[..., 2] - rgb[..., 0] - 0.02) / 0.1, 0, 1)
crystal = np.clip((sat - 0.2) / 0.2, 0, 1) * mintness
h, w = crystal.shape
mask_img = bpy.data.images.new("kin_crystal_mask", w, h, alpha=False)
mask_img.colorspace_settings.name = "Non-Color"
write_image_array(mask_img, np.dstack([crystal, crystal, crystal, np.ones_like(crystal)]))
mask_img.pack()
orm = np.dstack([np.ones_like(crystal), 0.86 - 0.72 * crystal, np.zeros_like(crystal), np.ones_like(crystal)])
orm_img = bpy.data.images.new("kin_orm", w, h, alpha=False)
orm_img.colorspace_settings.name = "Non-Color"
write_image_array(orm_img, orm)
orm_img.pack()
print("KIN_CRYSTAL_MASK coverage", round(float((crystal > 0.5).mean()), 4))

# One body material: fur where the mask is 0, glossy translucent glowing crystal where it's 1.
mat = bpy.data.materials.new("KIN_Body")
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]
tb = nt.nodes.new("ShaderNodeTexImage"); tb.image = base_img; tb.name = "base"
tm = nt.nodes.new("ShaderNodeTexImage"); tm.image = mask_img; tm.name = "mask"
to = nt.nodes.new("ShaderNodeTexImage"); to.image = orm_img; to.name = "orm"
sep = nt.nodes.new("ShaderNodeSeparateColor")
nt.links.new(tb.outputs["Color"], bsdf.inputs["Base Color"])
nt.links.new(to.outputs["Color"], sep.inputs["Color"])
nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
nt.links.new(tm.outputs["Color"], bsdf.inputs["Transmission Weight"])
nt.links.new(tm.outputs["Color"], bsdf.inputs["Coat Weight"])
nt.links.new(tb.outputs["Color"], bsdf.inputs["Emission Color"])
mul = nt.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"; mul.inputs[1].default_value = 0.9
nt.links.new(tm.outputs["Color"], mul.inputs[0])
nt.links.new(mul.outputs[0], bsdf.inputs["Emission Strength"])
bsdf.inputs["Sheen Weight"].default_value = 0.5
bsdf.inputs["Sheen Roughness"].default_value = 0.35


def lod(name, tris):
    o = raw.copy()
    o.data = raw.data.copy()
    o.name = o.data.name = name
    bpy.context.scene.collection.objects.link(o)
    cur = sum(len(p.vertices) - 2 for p in o.data.polygons)
    mod = o.modifiers.new("dec", "DECIMATE")
    mod.ratio = min(1.0, tris / cur)
    mod.use_symmetry = True
    mod.symmetry_axis = "X"
    select_only(o)
    bpy.ops.object.modifier_apply(modifier="dec")
    o.data.materials.clear()
    o.data.materials.append(mat)
    for p in o.data.polygons:
        p.use_smooth = True
    print("KIN_LOD", name, "tris", sum(len(p.vertices) - 2 for p in o.data.polygons))
    return o


lod0 = lod("KIN_LOD0", LOD_TRIS["LOD0"])
lod1 = lod("KIN_LOD1", LOD_TRIS["LOD1"])
lod1.hide_render = True
raw.hide_render = True

if BAKE:
    # Tangent-space normal map: high-poly geometric detail onto LOD0 (shared by LOD1: same UVs).
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 4
    sc.cycles.device = "CPU"
    nrm = bpy.data.images.new("kin_normal", 2048, 2048, alpha=False)
    nrm.colorspace_settings.name = "Non-Color"
    tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = nrm; tn.name = "normal"
    nt.nodes.active = tn
    raw.data.materials.clear()
    raw.data.materials.append(mat)
    raw.hide_render = False
    select_only(raw, lod0, active=lod0)
    bpy.ops.object.bake(type="NORMAL", use_selected_to_active=True, cage_extrusion=0.002, max_ray_distance=0.006, margin=8)
    nrm.pack()
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    raw.hide_render = True
    print("KIN_BAKED normal")

bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
print("KIN_STAGE_MESH_DONE")
