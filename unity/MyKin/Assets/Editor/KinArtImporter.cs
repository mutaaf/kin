// Import rules for the hero creature (art/export, built by art/blender/build_kin.py):
// generic rig with root motion on `root`, one clip per FBX take (named "Armature|<Clip>" → "<Clip>"),
// loop flags from kin_manifest.json, and correct texture types (normal map, linear data maps).
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

public class KinArtImporter : AssetPostprocessor
{
    const string Root = "Assets/Kin/Art/";

    [System.Serializable] class Clip { public string name; public bool loop; public bool additive; }
    [System.Serializable] class Manifest { public Clip[] clips; }

    void OnPreprocessModel()
    {
        if (!assetPath.StartsWith(Root) || !assetPath.EndsWith(".fbx")) return;
        var mi = (ModelImporter)assetImporter;
        mi.animationType = ModelImporterAnimationType.Generic;
        mi.motionNodeName = "root";
        mi.importBlendShapes = true;
        mi.importBlendShapeNormals = ModelImporterNormals.None; // shape normals ~double the mesh; the face shapes are small
        mi.meshCompression = ModelImporterMeshCompression.Medium;
        mi.materialImportMode = ModelImporterMaterialImportMode.None; // materials are built in code
        mi.globalScale = 1f;
        mi.useFileScale = true;
        mi.optimizeGameObjects = false; // the look-at, foot IK and fur need the bones
        mi.animationCompression = ModelImporterAnimationCompression.Optimal;
        mi.resampleCurves = true;
    }

    void OnPreprocessAnimation()
    {
        if (!assetPath.StartsWith(Root) || !assetPath.EndsWith(".fbx")) return;
        var mi = (ModelImporter)assetImporter;
        var loops = new Dictionary<string, bool>();
        var path = Root + "kin_manifest.json";
        if (File.Exists(path))
            foreach (var c in JsonUtility.FromJson<Manifest>(File.ReadAllText(path)).clips) loops[c.name] = c.loop;
        var clips = new List<ModelImporterClipAnimation>();
        foreach (var c in mi.defaultClipAnimations)
        {
            var take = c.takeName;
            var name = take.Contains("|") ? take.Substring(take.LastIndexOf('|') + 1) : take;
            if (take.StartsWith("Key")) continue; // shape-key carrier takes from the exporter
            c.name = name;
            c.loopTime = loops.TryGetValue(name, out var l) && l;
            c.loopPose = false;
            c.lockRootRotation = true;
            c.lockRootHeightY = false;
            c.keepOriginalOrientation = true;
            c.keepOriginalPositionY = true;
            c.keepOriginalPositionXZ = false;
            clips.Add(c);
        }
        mi.clipAnimations = clips.ToArray();
    }

    void OnPreprocessTexture()
    {
        if (!assetPath.StartsWith(Root + "Textures/")) return;
        var ti = (TextureImporter)assetImporter;
        var file = Path.GetFileNameWithoutExtension(assetPath);
        ti.mipmapEnabled = true;
        ti.anisoLevel = 4;
        ti.maxTextureSize = 2048;
        if (file.Contains("normal")) ti.textureType = TextureImporterType.NormalMap;
        if (file.Contains("orm") || file.Contains("mask")) ti.sRGBTexture = false;
        var ios = ti.GetPlatformTextureSettings("iPhone");
        ios.overridden = true;
        ios.format = TextureImporterFormat.ASTC_6x6;
        ios.maxTextureSize = 2048;
        ti.SetPlatformTextureSettings(ios);
    }
}
