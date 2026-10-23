# KIN hero character: art pipeline

One command rebuilds the Unity/web-ready character from the generated model:

```sh
python3 art/blender/build_kin.py            # ~80 s on an M1 Max, headless Blender 5.2
python3 art/blender/build_kin.py --src path/to/new_raw.glb --no-renders
```

Inputs: `source/` (front/side/back turnaround) → `model/kin_hero_raw.glb` (multi-view reconstruction).
Outputs: `export/kin_hero.fbx` (Unity), `export/kin_hero.glb` (three.js), `export/textures/*.png`,
`export/manifest.json`. `build/kin_hero.blend` is the final scene; other `build/*.blend` are
regenerated intermediates (gitignored). Proof renders land in `renders/td/`.

Full write-up: [docs/ART_PIPELINE.md](../docs/ART_PIPELINE.md).
