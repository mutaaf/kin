import os
import sys
import bpy
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from kin_common import face_centres, face_normals, face_uv_centroids, image_array, luminance, sample

me = bpy.data.objects["KIN_LOD0"].data
col = sample(image_array(bpy.data.images["kin_basecolor"]), face_uv_centroids(me))[:, :3]
lum = luminance(col)
cen, nrm = face_centres(me), face_normals(me)
H = cen[:, 2].max()
teal = (col[:, 1] > col[:, 0] + 0.12) & (col[:, 2] > col[:, 0] + 0.1) & (lum < 0.62)
dark = lum < 0.28
print("H", H, "y-range", cen[:, 1].min(), cen[:, 1].max(), "x-range", cen[:, 0].min(), cen[:, 0].max())
for name, m in (("teal", teal), ("dark", dark)):
    for side in (1, -1):
        s = m & (np.sign(cen[:, 0]) == side)
        if s.any():
            print(name, side, int(s.sum()), "x", np.round(np.percentile(cen[s, 0], [10, 50, 90]), 4), "y", np.round(np.percentile(cen[s, 1], [10, 50, 90]), 4), "z", np.round(np.percentile(cen[s, 2], [10, 50, 90]), 4), "ny", np.round(np.median(nrm[s, 1]), 2))
