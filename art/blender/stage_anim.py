"""Stage 4: the animation library, keyed by script with real animation principles.

    blender -b <stage_rig.blend> -P art/blender/stage_anim.py -- <out.blend>

Each clip is a pose function of normalised time t ∈ [0, 1). Loops use whole-cycle periodic
functions so the last frame meets the first. Overlap (ears, tail) comes from phase delays down
each chain; anticipation/overshoot from eased envelopes. Locomotion is in place with root motion
on the `root` bone (local Y = forward). Facial shape keys aren't in the skeletal takes: Unity drives
them (blink/squint) from the controller, and clip metadata in the manifest says which to use.

Axis conventions (bone rolls set in stage_rig so local X is the side axis):
  forward-pointing (spine, hips, chest): +pitch lifts the front   yaw = local Z, roll = local Y
  up-pointing (neck, head, ears):        +pitch nods forward      yaw = local Y, roll = local Z
  down-pointing (legs):                  +pitch swings forward
  back-pointing (tail):                  +pitch lifts the tail
"""
import json
import math
import os
import sys

import bpy
from mathutils import Euler, Vector

OUT = sys.argv[sys.argv.index("--") + 1]
FPS = 30
arm = bpy.data.objects["Armature"]
bpy.context.scene.render.fps = FPS
for pb in arm.pose.bones:
    pb.rotation_mode = "XYZ"
VERT = {b.name: abs((b.tail_local - b.head_local).normalized().z) > 0.7 for b in arm.data.bones}
TAU = 2 * math.pi
S = math.sin
C = math.cos


def ease_io(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def env(t, a, b):
    """0 → 1 between a and b (eased)."""
    return ease_io((t - a) / max(b - a, 1e-6))


def bump(t, a, peak, b):
    """0 → 1 → 0, rising a..peak, falling peak..b (eased)."""
    return env(t, a, peak) * (1 - env(t, peak, b))


class Pose(dict):
    def r(self, bone, pitch=0.0, yaw=0.0, roll=0.0):
        if bone not in VERT:
            return self
        p, y, r = self.get(bone, (0, 0, 0, None))[:3]
        self[bone] = (p + pitch, y + yaw, r + roll, self.get(bone, (0, 0, 0, None))[3])
        return self

    def loc(self, bone, x=0.0, y=0.0, z=0.0):
        p, yw, r, l = self.get(bone, (0, 0, 0, None))
        l = (Vector(l) if l else Vector()) + Vector((x, y, z))
        self[bone] = (p, yw, r, tuple(l))
        return self

    def chain(self, bones, pitch=0.0, yaw=0.0, roll=0.0, falloff=1.0):
        for i, b in enumerate(bones):
            k = falloff ** i
            self.r(b, pitch * k, yaw * k, roll * k)
        return self


TAIL = [f"tail_{i:02d}" for i in range(1, 7)]
EAR = {s: [f"ear_0{i}.{s}" for i in (1, 2, 3)] for s in "LR"}
LEGS = {(e, s): [f"leg_{e}_{p}.{s}" for p in ("upper", "lower", "foot", "toe")] for e in ("front", "back") for s in "LR"}
H = 0.28


def tail_wave(P, t, amp, cycles=1, lift=0.0, phase=0.0):
    for i, b in enumerate(TAIL):
        w = S(TAU * (cycles * t) - i * 0.55 + phase)
        P.r(b, pitch=lift * (1 - i / 8), yaw=amp * w * (0.55 + i * 0.12))


def ears(P, t, flick=0.0, droop=0.0, perk=0.0, lag=0.0):
    for s, bones in EAR.items():
        sg = 1 if s == "L" else -1
        for i, b in enumerate(bones):
            # Relaxed ears fall BACK and out (negative pitch), never forward over the face.
            P.r(b, pitch=-perk * 6 - droop * 9 * (i + 1), roll=sg * (droop * 14 + flick * 12 * (i + 1) / 3))
        if lag:
            P.r(bones[2], pitch=lag)


def breathe(P, t, cycles, depth=1.0):
    b = S(TAU * cycles * t)
    P.r("spine_02", pitch=0.8 * depth * b).r("chest", pitch=1.6 * depth * b).r("neck_01", pitch=-0.8 * depth * b)
    P.loc("chest", z=0.0006 * depth * b)


def gait(P, t, stride_deg, lift, bounce, speed_m, cycles=1, trot=False):
    """Diagonal gait: LF+RB together, RF+LB half a cycle later. In place + root motion."""
    ph = {("front", "L"): 0.0, ("back", "R"): 0.0 if trot else 0.08, ("front", "R"): 0.5, ("back", "L"): 0.5 if trot else 0.58}
    for (end, side), bones in LEGS.items():
        u = (cycles * t + ph[(end, side)]) % 1.0
        swing = u < 0.42  # swing phase: leg moves forward through the air
        if swing:
            k = u / 0.42
            fwd = -1 + 2 * ease_io(k)
            up = S(math.pi * k)
        else:
            k = (u - 0.42) / 0.58
            fwd = 1 - 2 * k  # stance: foot stays planted while the body passes over it
            up = 0.0
        sgn = 1 if end == "front" else 1
        P.r(bones[0], pitch=sgn * stride_deg * fwd)
        P.r(bones[1], pitch=-lift * up * (1.4 if end == "back" else 1.0) + (6 if end == "back" else -4))
        P.r(bones[2], pitch=lift * 0.6 * up)
    beat = cycles * 2
    P.loc("hips", z=-bounce * abs(S(TAU * beat * t / 2)))
    P.r("hips", yaw=2.5 * S(TAU * cycles * t), roll=2.0 * S(TAU * cycles * t))
    P.r("spine_02", yaw=-1.5 * S(TAU * cycles * t))
    P.r("chest", roll=-2.0 * S(TAU * cycles * t))
    P.r("neck_02", pitch=1.5 * S(TAU * beat * t / 2 + 0.6))
    P.r("head", pitch=-1.0 * S(TAU * beat * t / 2 + 0.9), roll=1.2 * S(TAU * cycles * t + 0.4))
    tail_wave(P, t, 8 if not trot else 12, cycles, lift=6)
    ears(P, t, lag=3 * S(TAU * beat * t / 2 + 1.4))
    P.loc("root", y=speed_m * t)  # root motion: forward along the root bone's local Y


CLIPS = {}


def clip(name, frames, loop, face=None, additive=False):
    def deco(fn):
        CLIPS[name] = {"fn": fn, "frames": frames, "loop": loop, "face": face, "additive": additive}
        return fn
    return deco


@clip("Idle", 150, True)
def idle(t):
    P = Pose()
    breathe(P, t, 3)
    P.r("hips", yaw=1.5 * S(TAU * t), roll=1.0 * S(TAU * t + 1))
    P.loc("hips", x=0.002 * S(TAU * t))
    P.r("head", yaw=4 * S(TAU * t + 0.5), roll=2 * S(TAU * 2 * t))
    tail_wave(P, t, 10, 2, lift=8)
    ears(P, t, flick=0.4 * bump(t, 0.62, 0.66, 0.72))
    return P


@clip("Idle_Look", 120, True)
def idle_look(t):
    P = Pose()
    breathe(P, t, 2)
    look = bump(t, 0.1, 0.3, 0.75) - 0.08 * bump(t, 0.05, 0.1, 0.16)  # tiny anticipation the other way
    P.r("neck_02", yaw=14 * look).r("head", yaw=24 * look, roll=6 * look)
    ears(P, t, flick=bump(t, 0.32, 0.36, 0.42), perk=look)
    tail_wave(P, t, 8, 2, lift=6)
    return P


@clip("Walk", 32, True)
def walk(t):
    P = Pose()
    gait(P, t, 18, 38, 0.004, 0.11)
    return P


@clip("Trot", 20, True)
def trot(t):
    P = Pose()
    gait(P, t, 26, 55, 0.008, 0.17, trot=True)
    return P


def hop_core(P, t, crouch, air, land, height, dist):
    """Anticipation crouch → launch → tucked flight → squash landing → settle."""
    c = bump(t, 0.0, crouch, air) - 0.0
    fly = env(t, air, land)
    arc = S(math.pi * fly) if air < t < land else 0.0
    squash = bump(t, land, land + 0.06, min(1.0, land + 0.22))
    P.loc("hips", z=-0.018 * c - 0.014 * squash)
    P.loc("root", z=height * arc, y=dist * fly)
    for (end, side), bones in LEGS.items():
        tuck = arc
        P.r(bones[0], pitch=(20 if end == "back" else -18) * c + (-25 if end == "back" else 30) * tuck)
        P.r(bones[1], pitch=-45 * c + (-50 if end == "back" else 40) * tuck - 30 * squash)
        P.r(bones[2], pitch=25 * c + 20 * tuck)
    P.r("hips", pitch=-8 * c + 10 * arc - 4 * squash)
    P.r("chest", pitch=6 * arc - 6 * squash)
    P.r("head", pitch=6 * c - 8 * arc + 10 * squash)
    ears(P, t, droop=0.5 * c, lag=-14 * arc + 16 * squash)
    for i, b in enumerate(TAIL):
        P.r(b, pitch=-12 * arc * (1 + i * 0.2) + 10 * squash)


@clip("Hop", 24, False, face={"Wide": 0.6})
def hop(t):
    P = Pose()
    hop_core(P, t, 0.18, 0.3, 0.72, 0.07, 0.08)
    return P


@clip("Hop_Loop", 18, True)
def hop_loop(t):
    P = Pose()
    hop_core(P, t, 0.12, 0.22, 0.84, 0.05, 0.0)
    P.loc("root", y=0.09 * t)
    return P


def sit_pose(P, k):
    P.r("hips", pitch=34 * k).r("spine_02", pitch=-6 * k).r("chest", pitch=-10 * k).r("neck_01", pitch=-14 * k).r("head", pitch=-6 * k)
    P.loc("hips", z=-0.035 * k, y=0.008 * k)
    for s in "LR":
        b = LEGS[("back", s)]
        P.r(b[0], pitch=-70 * k).r(b[1], pitch=110 * k).r(b[2], pitch=-45 * k)
        f = LEGS[("front", s)]
        P.r(f[0], pitch=-30 * k).r(f[1], pitch=8 * k)
    for i, b in enumerate(TAIL):
        P.r(b, pitch=-8 * k, yaw=(6 + i * 4) * k)


@clip("Sit_Enter", 30, False)
def sit_enter(t):
    P = Pose()
    k = env(t, 0.1, 0.85)
    sit_pose(P, k + 0.06 * bump(t, 0.75, 0.85, 1.0))  # tiny settle overshoot
    ears(P, t, lag=-8 * bump(t, 0.6, 0.8, 1.0))
    return P


@clip("Sit_Loop", 90, True)
def sit_loop(t):
    P = Pose()
    sit_pose(P, 1.0)
    breathe(P, t, 2)
    P.r("head", yaw=5 * S(TAU * t), roll=3 * S(TAU * t + 1))
    tail_wave(P, t, 5, 1)
    return P


@clip("Sit_Exit", 24, False)
def sit_exit(t):
    P = Pose()
    sit_pose(P, 1 - env(t, 0.15, 0.9))
    P.r("chest", pitch=-4 * bump(t, 0.0, 0.15, 0.4))  # anticipation lean
    return P


def lie_pose(P, k):
    P.loc("hips", z=-0.05 * k).loc("chest", z=-0.03 * k)
    P.r("neck_01", pitch=12 * k).r("neck_02", pitch=8 * k).r("head", pitch=6 * k, roll=10 * k)
    for (end, s), b in LEGS.items():
        if end == "back":
            P.r(b[0], pitch=-80 * k).r(b[1], pitch=120 * k).r(b[2], pitch=-50 * k)
        else:
            P.r(b[0], pitch=60 * k).r(b[1], pitch=-30 * k).r(b[2], pitch=-30 * k)
    for i, b in enumerate(TAIL):
        P.r(b, pitch=-14 * k, yaw=(10 + i * 6) * k)
    ears(P, 0, droop=0.9 * k)


@clip("Lie_Sleep", 180, True, face={"Blink": 1.0})
def lie_sleep(t):
    P = Pose()
    lie_pose(P, 1.0)
    breathe(P, t, 3, depth=1.6)
    P.r("head", pitch=1.2 * S(TAU * 3 * t + 0.8))
    ears(P, t, flick=0.5 * bump(t, 0.4, 0.43, 0.48))
    return P


@clip("Fall_Asleep", 90, False, face={"Sleepy": 1.0, "Blink": "ramp"})
def fall_asleep(t):
    P = Pose()
    sit_pose(P, 1 - env(t, 0.55, 0.95))
    lie_pose(P, env(t, 0.55, 0.95))
    nod = bump(t, 0.1, 0.18, 0.24) + bump(t, 0.3, 0.38, 0.45)
    P.r("head", pitch=16 * nod).r("neck_02", pitch=6 * nod)
    return P


@clip("Eat", 60, True, face={"Mouth_Open": "chew"})
def eat(t):
    P = Pose()
    down = 1.0
    # Neck + head rotations stack: ~36° total brings the mouth to the ground without folding.
    P.r("neck_01", pitch=12 * down).r("neck_02", pitch=10 * down).r("head", pitch=14 * down)
    P.r("hips", pitch=-4).r("chest", pitch=-6)
    for s in "LR":
        f = LEGS[("front", s)]
        P.r(f[0], pitch=-10).r(f[1], pitch=12)
    chew = 0.5 + 0.5 * S(TAU * 4 * t)
    P.r("jaw", pitch=-14 * chew).r("head", pitch=3 * chew)
    ears(P, t, lag=2 * S(TAU * 4 * t + 0.5))
    tail_wave(P, t, 14, 2, lift=10)
    return P


@clip("Happy", 48, True, face={"HappySquint": 1.0, "Mouth_Smile": 1.0})
def happy(t):
    P = Pose()
    w = S(TAU * 2 * t)
    P.r("hips", yaw=12 * w, roll=5 * w).r("spine_02", yaw=-6 * w).r("chest", yaw=-6 * w, pitch=4)
    P.loc("root", z=0.012 * abs(S(TAU * 2 * t)))
    P.r("head", roll=-8 * w, pitch=-4)
    tail_wave(P, t, 32, 4, lift=22)
    ears(P, t, flick=0.6 * S(TAU * 2 * t + 1), perk=1)
    return P


@clip("Petted", 90, True, face={"HappySquint": 0.9, "Cheeks_Puff": 1.0, "Mouth_Smile": 0.7})
def petted(t):
    P = Pose()
    lean = 0.7 + 0.3 * S(TAU * t)
    P.r("neck_02", pitch=-8 * lean, roll=10 * lean).r("head", pitch=-10 * lean, roll=14 * lean, yaw=6 * S(TAU * t))
    P.r("chest", roll=4 * lean).loc("hips", z=-0.006 * lean)
    ears(P, t, droop=0.7)
    tail_wave(P, t, 16, 2, lift=4)
    breathe(P, t, 2, 1.3)
    return P


@clip("Head_Tilt", 45, False, face={"Wide": 0.4})
def head_tilt(t):
    P = Pose()
    k = bump(t, 0.05, 0.3, 0.92) + 0.08 * bump(t, 0.3, 0.38, 0.5)
    P.r("head", roll=26 * k, yaw=8 * k).r("neck_02", roll=6 * k)
    ears(P, t, perk=k, flick=0.4 * bump(t, 0.3, 0.34, 0.4))
    return P


@clip("Shake_Off", 40, False, face={"Blink": 0.8})
def shake_off(t):
    P = Pose()
    amp = bump(t, 0.05, 0.2, 0.9)
    w = S(TAU * 7 * t)
    P.r("hips", roll=10 * amp * S(TAU * 7 * t - 0.6)).r("spine_02", roll=18 * amp * w).r("chest", roll=22 * amp * S(TAU * 7 * t + 0.5))
    P.r("neck_02", roll=-14 * amp * S(TAU * 7 * t + 1.0)).r("head", roll=24 * amp * S(TAU * 7 * t + 1.6))
    ears(P, t, flick=2.0 * amp * S(TAU * 7 * t + 2.2))
    tail_wave(P, t, 30 * amp, 7)
    return P


@clip("Yawn", 60, False, face={"Blink": 0.7, "Mouth_O": 0.6})
def yawn(t):
    P = Pose()
    k = bump(t, 0.1, 0.45, 0.85)
    P.r("neck_02", pitch=-14 * k).r("head", pitch=-18 * k).r("jaw", pitch=-30 * k)
    P.r("chest", pitch=6 * k)
    ears(P, t, droop=0.6 * k)
    return P


@clip("Sneeze", 40, False, face={"Blink": 1.0})
def sneeze(t):
    P = Pose()
    ante = bump(t, 0.0, 0.45, 0.52)
    snap = bump(t, 0.5, 0.56, 0.8)
    P.r("neck_02", pitch=-14 * ante + 22 * snap).r("head", pitch=-16 * ante + 26 * snap).r("jaw", pitch=-10 * ante)
    P.r("chest", pitch=-6 * snap)
    ears(P, t, flick=1.6 * snap, lag=-10 * snap)
    return P


@clip("Tail_Wag", 20, True, additive=True)
def tail_wag(t):
    P = Pose()
    tail_wave(P, t, 30, 2, lift=10)
    return P


@clip("Ear_Twitch", 12, False, additive=True)
def ear_twitch(t):
    P = Pose()
    k = bump(t, 0.0, 0.25, 1.0)
    for s in "LR":
        P.r(EAR[s][1], roll=(1 if s == "L" else -1) * 18 * k).r(EAR[s][2], roll=(1 if s == "L" else -1) * 12 * bump(t, 0.1, 0.35, 1.0))
    return P


@clip("Look_At_Camera", 30, False, face={"Wide": 0.3})
def look_cam(t):
    P = Pose()
    k = env(t, 0.1, 0.7) + 0.06 * bump(t, 0.6, 0.7, 0.9)
    P.r("neck_02", pitch=-10 * k).r("head", pitch=-14 * k)
    ears(P, t, perk=k)
    return P


@clip("Paw_Up", 45, False, face={"HappySquint": 0.6, "Mouth_Smile": 0.8})
def paw_up(t):
    P = Pose()
    up = bump(t, 0.1, 0.3, 0.92)
    wave = S(TAU * 3 * t) * env(t, 0.3, 0.4) * (1 - env(t, 0.8, 0.9))
    f = LEGS[("front", "L")]
    P.r(f[0], pitch=70 * up, roll=-10 * up).r(f[1], pitch=-50 * up + 18 * wave).r(f[2], pitch=-20 * up + 10 * wave)
    P.r("chest", roll=5 * up).r("hips", roll=-3 * up).r("head", roll=-8 * up)
    tail_wave(P, t, 20, 3, lift=12)
    return P


def bake(name, spec):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    if not arm.animation_data:
        arm.animation_data_create()
    arm.animation_data.action = act
    n = spec["frames"]
    for pb in arm.pose.bones:
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)
    keyed = set()
    # Loops: keyframe 0..n inclusive with t = f/n, so frame n == frame 0 (seamless).
    for f in range(0, n + 1, 2 if n > 20 else 1):
        t = f / n if spec["loop"] else min(f / max(n - 1, 1), 1.0)
        P = spec["fn"](t)
        for bone, (p, y, r, loc) in P.items():
            pb = arm.pose.bones.get(bone)
            if not pb:
                continue
            if VERT[bone]:
                e = Euler((math.radians(p), math.radians(y), math.radians(r)))  # yaw=Y, roll=Z
            else:
                e = Euler((math.radians(p), math.radians(r), math.radians(y)))  # yaw=Z, roll=Y
            pb.rotation_euler = e
            pb.keyframe_insert("rotation_euler", frame=f + 1)
            if loc is not None:
                pb.location = loc
                pb.keyframe_insert("location", frame=f + 1)
            keyed.add(bone)
        for bone in keyed - set(P):
            pb = arm.pose.bones[bone]
            pb.rotation_euler = (0, 0, 0)
            pb.keyframe_insert("rotation_euler", frame=f + 1)
    act.frame_range = (1, n + 1)
    return act


manifest_clips = []
for name, spec in CLIPS.items():
    act = bake(name, spec)
    tr = arm.animation_data.nla_tracks.new()
    tr.name = name
    tr.strips.new(name, 1, act)
    tr.mute = True
    manifest_clips.append({"name": name, "frames": spec["frames"], "fps": FPS, "loop": spec["loop"],
                           "additive": spec["additive"], "face": spec["face"] or {}})
arm.animation_data.action = None
for pb in arm.pose.bones:
    pb.rotation_euler = (0, 0, 0)
    pb.location = (0, 0, 0)

# Blink: a shape-key clip on the lids (Unity can also drive it procedurally).
lids = bpy.data.objects["KIN_Lids"]
kb = lids.data.shape_keys.key_blocks["Blink"]
for f, v in ((1, 0.0), (3, 1.0), (5, 1.0), (8, 0.0)):
    kb.value = v
    kb.keyframe_insert("value", frame=f)
blink_act = lids.data.shape_keys.animation_data.action
blink_act.name = "Blink"
blink_act.use_fake_user = True
kb.value = 0.0
lids.data.shape_keys.animation_data.action = None
# Neither FBX nor glTF export carries a standalone shape-key action, so Blink ships as a recipe:
# the engine drives the KIN_Lids "Blink" blendshape procedurally (natural random intervals).
manifest_clips.append({"name": "Blink", "frames": 8, "fps": FPS, "loop": False, "additive": False,
                       "procedural": "KIN_Lids blendshape Blink: 0 -> 1 over 2f, hold 2f, 1 -> 0 over 3f; every 2-6 s"})

with open(os.path.join(os.path.dirname(OUT), "clips.json"), "w") as fh:
    json.dump(manifest_clips, fh, indent=2)
bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
print("KIN_CLIPS", [c["name"] for c in manifest_clips])
print("KIN_STAGE_ANIM_DONE")
