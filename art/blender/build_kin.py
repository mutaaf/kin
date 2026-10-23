#!/usr/bin/env python3
"""Rebuild the KIN hero character end to end (headless Blender 5.2), and its proof renders.

    python3 art/blender/build_kin.py [--src art/model/kin_hero_raw.glb] [--no-renders]

Stages (each is its own Blender process, so a failure points at one script):
  1 stage_mesh   weld, orient, scale to 0.28 m, LOD0 30k / LOD1 10k, crystal mask + ORM, normal bake
  2 stage_face   real eyes (located, painted out, rebuilt), eyelids + facial blendshapes
  3 stage_rig    38-bone quadruped rig from mesh landmarks, automatic weights (4 influences)
  4 stage_anim   22 skeletal clips + blink recipe (clips.json)
  5 stage_export art/export/kin_hero.fbx (Unity) + kin_hero.glb (web) + textures + manifest.json
Then proofs into art/renders/td/.
"""
import argparse
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.dirname(HERE)
BUILD = os.path.join(ART, "build")
EXPORT = os.path.join(ART, "export")
RENDERS = os.path.join(ART, "renders", "td")
BLENDER = os.environ.get("BLENDER", "blender")


def run(*args, blend=None):
    cmd = [BLENDER, "-b"] + ([blend] if blend else []) + ["-P", os.path.join(HERE, args[0]), "--", *args[1:]]
    t0 = time.time()
    p = subprocess.run(cmd, capture_output=True, text=True)
    lines = [l for l in p.stdout.splitlines() if l.startswith(("KIN_", "VERIFY"))]
    print(f"── {args[0]} ({time.time() - t0:.1f}s)")
    for l in lines:
        print("   ", l[:200])
    if p.returncode != 0 or "Traceback" in p.stdout + p.stderr:
        print(p.stdout[-3000:], p.stderr[-3000:], file=sys.stderr)
        sys.exit(f"stage failed: {args[0]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.path.join(ART, "model", "kin_hero_raw.glb"))
    ap.add_argument("--no-renders", action="store_true")
    a = ap.parse_args()
    os.makedirs(BUILD, exist_ok=True)
    os.makedirs(RENDERS, exist_ok=True)
    b = lambda n: os.path.join(BUILD, n)
    run("stage_mesh.py", a.src, b("stage_mesh.blend"), "--bake")
    run("stage_face.py", b("stage_face.blend"), blend=b("stage_mesh.blend"))
    run("stage_rig.py", b("stage_rig.blend"), blend=b("stage_face.blend"))
    run("stage_anim.py", b("stage_anim.blend"), blend=b("stage_rig.blend"))
    run("stage_export.py", EXPORT, blend=b("stage_anim.blend"))
    run("verify_export.py", EXPORT)
    if not a.no_renders:
        hero = b("kin_hero.blend")
        run("render_turn.py", os.path.join(RENDERS, "turntable_final.png"), blend=hero)
        run("render_faces.py", os.path.join(RENDERS, "expressions_final.png"), blend=hero)
        run("render_poses.py", os.path.join(RENDERS, "stress_poses_final.png"), blend=hero)
        run("render_anim.py", RENDERS, "Walk", "Hop", "Eat", "Happy", "Lie_Sleep", "Sit_Enter", blend=b("stage_anim.blend"))
    for f in os.listdir(BUILD):
        if f.endswith(".blend1"):
            os.remove(os.path.join(BUILD, f))
    print("done →", EXPORT)


if __name__ == "__main__":
    main()
