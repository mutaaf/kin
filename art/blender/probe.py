import sys
import bpy
argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])
for o in bpy.context.scene.objects:
    print("OBJ", o.name, o.type, tuple(round(x, 3) for x in o.location), tuple(round(x, 3) for x in o.rotation_euler), tuple(round(x, 3) for x in o.scale), o.parent.name if o.parent else None)
for img in bpy.data.images:
    print("IMG", img.name, img.size[:], img.colorspace_settings.name)
for m in bpy.data.materials:
    if m.use_nodes:
        for n in m.node_tree.nodes:
            print("NODE", m.name, n.type, n.name, [l.from_node.name + ">" + l.to_socket.name for i in n.inputs for l in i.links])
me = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]
import bmesh
bm = bmesh.new(); bm.from_mesh(me.data)
print("MANIFOLD_BAD_EDGES", sum(1 for e in bm.edges if not e.is_manifold), "loose_parts?")
co = [me.matrix_world @ v.co for v in me.data.vertices]
for axis, i in (("x", 0), ("y", 1), ("z", 2)):
    print("RANGE", axis, round(min(c[i] for c in co), 3), round(max(c[i] for c in co), 3))
