import os
import sys
import bpy
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from kin_common import face_uv_centroids, image_array, luminance, sample, face_centres

o = bpy.data.objects["KIN_LOD0"]
uv = face_uv_centroids(o.data)
col = sample(image_array(bpy.data.images["kin_basecolor"]), uv)[:, :3]
em = sample(image_array(bpy.data.images["kin_emission"]), uv)[:, :3]
orm = sample(image_array(bpy.data.images["kin_orm"]), uv)[:, :3]
mx, mn = col.max(1), col.min(1)
sat = (mx - mn) / np.maximum(mx, 1e-4)
lum = luminance(col)
el = luminance(em)
for name, a in (("sat", sat), ("lum", lum), ("emis", el), ("g-r", col[:, 1] - col[:, 0]), ("b-r", col[:, 2] - col[:, 0]), ("rough(G)", orm[:, 1]), ("metal(B)", orm[:, 2])):
    print("DIST", name, np.round(np.percentile(a, [5, 25, 50, 75, 90, 95, 99]), 3))
c = face_centres(o.data)
# Where are high-saturation faces?
for thr in (0.2, 0.3, 0.4):
    m = sat > thr
    print("SAT>", thr, int(m.sum()), "z-mean", np.round(c[m, 2].mean() if m.any() else 0, 3))
for thr in (0.1, 0.3, 0.5):
    m = el > thr
    print("EMIS>", thr, int(m.sum()))
dark = lum < 0.15
print("DARK", int(dark.sum()), "centroid", np.round(c[dark].mean(0), 3) if dark.any() else None)
