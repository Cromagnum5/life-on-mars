"""Validate and render the Rigwalker Hurler's three throws.

Poses come from the same numbers `applyThrowPose` in `src/rigwalker.ts` uses,
applied to the real imported GLB skeleton, so this checks the shipping motion
rather than a stand-in. It measures first and renders second: a throw whose
rock never gets in front of the body is broken however good the picture looks.

All three throws are overhand. What the measurements are for is that "overhand"
is a claim about the whole arc, not the release pose: the arm has to be above
the shoulder the entire way through, because the rig will happily blend between
two good poses by dropping the elbow to the hip in between, which is what makes
a throw read as sidearm.

WHAT THIS TOOL CANNOT SEE. It ports `applyThrowPose` and stops there. The game
runs `applyBalancePose` on top of it, which adds a crouch, a lean, and recovery
steps that this knows nothing about. So these numbers are the truth about the
arm and about what the throw *asks* the legs for, and they are not the truth
about where a foot ends up on screen. That gap once passed a foot-drift check
at 0.195 m while the shipped rear foot floated 0.41 m off the ground. For a
stance, measure the thing that draws it:

    EXTRA='zoom=6&on=HR1&feet=1' tools/capture_sim.sh /tmp/sheet "1h v 1" 3 1.95

Run from the repository root:
    blender --background --python tools/render_rigwalker_throw.py
"""

import bpy, math, os
from pathlib import Path
from mathutils import Vector, Euler

ROOT = Path(__file__).resolve().parents[1]
GLB = str(ROOT / 'public' / 'models' / 'rigwalker.glb')
OUTPUT = Path('/tmp/life-on-mars-throw-review')
OUTPUT.mkdir(parents=True, exist_ok=True)

# Measured off the rig, not assumed: the model faces -Y and stands up +Z.
FORWARD = Vector((0, -1, 0))
UP = Vector((0, 0, 1))
# Where the held rock sits in the wrist bone's own space, matching the runtime.
ROCK_IN_HAND = Vector((0, 0.2, 0))
# Landmarks on the skeleton, read off the imported rest pose.
SHOULDER_HEIGHT = 2.68
HEAD_HEIGHT = 3.00

# Mirrors THROW_BEATS in src/rigwalker.ts.
BEATS = {
    'hurl': {
        'draw': (0, .26, .40, .56),
        'stride': (.26, .44, .58, .76),
        'whip': (.40, .58, .58, .82),
        'follow': (.58, .74, .86, 1),
    },
    'pitch': {
        'draw': (0, .20, .30, .44),
        'stride': (.18, .32, .44, .62),
        'whip': (.28, .44, .44, .68),
        'follow': (.44, .60, .84, 1),
    },
    'toss': {
        'draw': (0, .12, .18, .30),
        'stride': (.08, .18, .30, .46),
        'whip': (.18, .32, .32, .52),
        'follow': (.32, .46, .74, .95),
    },
}
# Mirrors THROW_PROFILES in src/combat.ts.
RELEASE = {'hurl': .58, 'pitch': .44, 'toss': .32}

# Mirrors READY_THROW_ARM and THROW_ARM_KEYS in src/rigwalker.ts.
# at, upper X, upper Y, upper Z, lower X, hand X
READY_ARM = (0, -.35, 0, -.30, -.45, 0)
ARM_KEYS = {
    'hurl': [
        READY_ARM,
        (.14, -.89, .17, -.79, 1.35, .45),
        (.30, -1.25, 1.62, -1.23, 1.57, .55),
        (.48, -1.60, 1.70, -1.52, 1.05, .40),
        (.58, -1.60, 1.56, -1.50, 0, 0),
        (.70, -.98, .94, -.77, .45, .10),
        (.85, -.32, .50, -.20, 1.00, .25),
        (1, *READY_ARM[1:]),
    ],
    'pitch': [
        READY_ARM,
        (.10, -.92, -.14, -1.16, 1.30, .45),
        (.24, -1.50, 1.62, -.84, 1.65, .50),
        (.38, -1.64, 1.68, -1.67, 1.10, .30),
        (.44, -1.33, 1.56, -1.31, .30, -.30),
        (.58, -.78, 1.10, -.69, .60, .05),
        (.80, -.32, .45, -.24, 1.00, .20),
        (1, *READY_ARM[1:]),
    ],
    'toss': [
        READY_ARM,
        (.16, -1.10, .60, -1.56, 1.75, .55),
        (.26, -1.69, 1.49, -1.64, 1.35, .35),
        (.32, -1.15, 1.44, -1.26, .65, -.20),
        (.46, -.63, 1.05, -.79, .75, .05),
        (.70, -.34, .40, -.32, .95, .20),
        (1, *READY_ARM[1:]),
    ],
}


def smoothstep(value, start, end):
    if end <= start:
        return 1.0 if value >= end else 0.0
    t = max(0.0, min(1.0, (value - start) / (end - start)))
    return t * t * (3 - 2 * t)


def beat(phase, window):
    if phase < 0:
        return 0.0
    a, b, c, d = window
    return smoothstep(phase, a, b) * (1 - smoothstep(phase, c, d))


def drive(throw, phase):
    windows = BEATS[throw]
    return {name: beat(phase, windows[name]) for name in windows}


HURLER_STANCE = .20
HURLER_LOAD = .10
THIGH_LENGTH = .79
SHIN_LENGTH = .72
STANDING_KNEE = .24

# The stance a hurler waits in: throwing-side leg forward and weighted, the
# other trailing. Ports HURL_TRAIL_* / HURL_SUPPORT_* in src/rigwalker.ts.
TRAIL_HIP = .06 + HURLER_STANCE
TRAIL_KNEE = STANDING_KNEE - HURLER_LOAD
SUPPORT_HIP = -.06 - HURLER_STANCE
SUPPORT_KNEE = STANDING_KNEE + HURLER_LOAD

# The legs' own beats. See the comment on HURL_TUCK in src/rigwalker.ts: a foot
# has to be off the ground before it travels, and none of the body's four beats
# start where a foot needs to.
TUCK = (0, .12, .3, .48)
SWING = (.02, .3, .3, .48)
STEP = (.26, .46, .74, 1)
HEEL = (.34, .5, .6, .86)
DRIVE = (.4, .58, .6, .86)
HOME = (.7, .8, .9, 1)


def hurl_gather(d):
    """Port of hurlGather. The knee lift and the lean, ended by the stride."""
    return d['draw'] * (1 - d['stride'])


def hurl_root_pitch(d):
    """Port of hurlRootPitch. The root sits on the ground, so keep this small."""
    g = hurl_gather(d)
    return -.06 * g + .04 * d['stride'] + .1 * d['whip'] + .14 * d['follow']


def hurl_hips(d):
    """Port of hurlHips. The coil, and what the lead leg has to cancel."""
    g = hurl_gather(d)
    return .75 * g + .3 * d['stride'] - 1.3 * d['whip'] - .4 * d['follow']


def hurl_legs(phase, d):
    """Port of hurlLegs. Returns (upper_l, lower_l, upper_r, lower_r).

    The left leg trails and steps through; the right, under the throwing arm,
    holds the fighter up and then drives.
    """
    tuck, swing = beat(phase, TUCK), beat(phase, SWING)
    step, home = beat(phase, STEP), beat(phase, HOME)
    heel, driv = beat(phase, HEEL), beat(phase, DRIVE)
    whip, hips = d['whip'], hurl_hips(d)
    return (
        TRAIL_HIP - 1.32 * swing - .62 * step + .11 * hips - .3 * home,
        TRAIL_KNEE + .45 * tuck + 1.25 * swing + .16 * step - .06 * whip + .6 * home,
        SUPPORT_HIP + .19 * step + .24 * driv,
        SUPPORT_KNEE - .1 * step + .2 * heel,
    )


def ankle_lift(upper, knee):
    return (THIGH_LENGTH * (1 - math.cos(upper)) +
            SHIN_LENGTH * (1 - math.cos(upper + knee)))


def ankle_reach(upper, knee):
    return THIGH_LENGTH * math.sin(upper) + SHIN_LENGTH * math.sin(upper + knee)


STANDING_LIFT = ankle_lift(.06, STANDING_KNEE)


def hurl_step(throw, phase):
    """The port of hurlStep. Keep in step with src/rigwalker.ts.

    Metres the body travels forward during a hurl, and metres the hips come
    down for it. In the game these are an offset of the model inside its group;
    here they translate the whole actor, which is the same thing.

    `reach` is measured against the root bone and so is deliberately blind to
    the forward part: what it measures is how far the arm swings through the
    body, not how far the body goes. Foot height is *not* blind to the drop,
    which is the whole reason the drop exists.
    """
    d = drive(throw, phase)
    hurling = throw == 'hurl' and phase >= 0
    forward = (.2 * beat(phase, STEP) + .1 * d['whip']) if hurling else 0.0
    engagement = 0.0 if phase < 0 else max(d.values())
    ready = 1 - engagement
    pitch = hurl_root_pitch(d) if hurling else 0.0
    if hurling:
        upper_l, lower_l, upper_r, lower_r = hurl_legs(phase, d)
    else:
        upper_l = .06 + HURLER_STANCE * ready
        lower_l = STANDING_KNEE - HURLER_LOAD * ready
        upper_r = -.06 - HURLER_STANCE * ready
        lower_r = STANDING_KNEE + HURLER_LOAD * ready

    def standing(upper, knee):
        return (ankle_lift(upper, knee) - STANDING_LIFT +
                ankle_reach(upper, knee) * math.sin(pitch))

    # Follows the lower foot: that is the one standing on the ground.
    return (forward, min(standing(upper_l, lower_l), standing(upper_r, lower_r)))


def arm_pose(throw, phase):
    """The port of throwArmPose. Keep in step with src/rigwalker.ts."""
    if phase < 0:
        return READY_ARM[1:]
    keys = ARM_KEYS[throw]
    index = 0
    while index < len(keys) - 2 and phase > keys[index + 1][0]:
        index += 1
    a, b = keys[index], keys[index + 1]
    t = smoothstep(phase, a[0], b[0])
    return tuple(x + (y - x) * t for x, y in zip(a[1:], b[1:]))


bpy.ops.wm.read_factory_settings(use_empty=True)
RESTS = {}
# rig -> (parent empty, its resting x), so a hurl's step can move the actor.
STANCES = {}


def import_hurler(label, at_x):
    """One more copy of the unit, posed independently, for the contact sheet."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=GLB)
    objects = list(set(bpy.data.objects) - before)
    rig = next(o for o in objects if o.type == 'ARMATURE')
    # The GLB carries Idle, Walk and CombatIdle. Blender re-evaluates whatever
    # action is assigned every time it renders a frame, which would quietly
    # throw the pose away: the measurements would be right and the pictures
    # would show a unit standing still.
    rig.animation_data_clear()
    for bone in rig.pose.bones:
        bone.rotation_mode = 'QUATERNION'
    RESTS[rig] = {b.name: b.rotation_quaternion.copy() for b in rig.pose.bones}
    root = bpy.data.objects.new(f'{label}_root', None)
    bpy.context.scene.collection.objects.link(root)
    for obj in objects:
        if obj.parent is None:
            obj.parent = root
        obj.name = f'{label}_{obj.name}'
        # A hurler carries no sword.
        if obj.name.endswith('Broadsword'):
            obj.hide_viewport = obj.hide_render = True
    root.location = (at_x, 0, 0)
    # Held so `pose_throw` can walk the whole actor forward for a hurl's step.
    STANCES[rig] = (root, at_x)
    rock = bpy.data.objects.new(f'{label}_Rock', ROCK_MESH)
    bpy.context.scene.collection.objects.link(rock)
    return {'rig': rig, 'objects': objects, 'root': root, 'rock': rock}


bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=.28)
ROCK_MESH = bpy.context.object.data
bpy.data.objects.remove(bpy.context.object)

MAIN = None


def named(suffix, actor=None):
    return next(o for o in (actor or MAIN)['objects'] if o.name.endswith(suffix))


def euler(x, y, z):
    """The runtime's Euler order, not Blender's.

    Three.js composes its default XYZ Euler as qx*qy*qz; Blender's 'XYZ' is the
    opposite product, and it is Blender's 'ZYX' that matches. Any bone given two
    non-zero angles at once lands somewhere else under the wrong one, so posing
    with 'XYZ' here would measure and draw a throw the game never renders.
    """
    return Euler((x, y, z), 'ZYX').to_quaternion()


def offset(rig, name, x, y, z):
    rig.pose.bones[name].rotation_quaternion = RESTS[rig][name] @ euler(x, y, z)


def add_offset(rig, name, x, y, z):
    bone = rig.pose.bones[name]
    bone.rotation_quaternion = bone.rotation_quaternion @ euler(x, y, z)


def set_legs(rig, upper_l, lower_l, upper_r, lower_r):
    """Cancels each ankle against the joints above it, so the soles stay flat."""
    offset(rig, 'upper_leg.L', upper_l, 0, .11)
    offset(rig, 'lower_leg.L', lower_l, 0, 0)
    offset(rig, 'foot.L', -(upper_l + lower_l), 0, -.09)
    offset(rig, 'upper_leg.R', upper_r, 0, -.11)
    offset(rig, 'lower_leg.R', lower_r, 0, 0)
    offset(rig, 'foot.R', -(upper_r + lower_r), 0, .09)


def pose_throw(rig, throw, phase, aim_phase=-1):
    """The port of applyThrowPose. Keep in step with src/rigwalker.ts."""
    d = drive(throw, phase)
    draw, stride, whip, follow = d['draw'], d['stride'], d['whip'], d['follow']
    aim = smoothstep(aim_phase, 0, .45) if aim_phase >= 0 else 0
    ready = 1 - max(draw, stride, whip, follow)

    upper_x, upper_y, upper_z, lower_x, hand_x = arm_pose(throw, phase)
    offset(rig, 'upper_arm.R', upper_x, upper_y, upper_z)
    offset(rig, 'lower_arm.R', lower_x, 0, 0)
    offset(rig, 'hand.R', hand_x, 0, 0)

    if throw == 'hurl':
        g = hurl_gather(d)
        hip = hurl_hips(d)
        chest = 1 * g + .7 * stride - 1.5 * whip - .5 * follow
        offset(rig, 'root', hurl_root_pitch(d), .34 * hip,
               -.1 * g - .08 * stride + .08 * whip + .12 * follow)
        offset(rig, 'spine', .04 - .3 * g + .1 * whip + .2 * follow, .3 * chest,
               .06 * g - .05 * follow)
        offset(rig, 'chest', .03 - .18 * g + .12 * whip + .16 * follow, .44 * chest,
               .05 * g - .08 * follow)
        offset(rig, 'neck', .08 - .06 * follow, -.5 * chest, 0)
        offset(rig, 'head', -.03 + .08 * aim, -.35 * chest, 0)
        sight = max(draw, stride)
        offset(rig, 'upper_arm.L',
               -.4 - .72 * sight + 1.35 * whip + .34 * follow - .34 * aim,
               0, -.14 - .5 * sight + .25 * follow)
        offset(rig, 'lower_arm.L',
               -.08 + .72 * sight - .5 * whip + .2 * follow + .35 * aim, 0, -.05)
        offset(rig, 'hand.L', -.06, 0, 0)
        set_legs(rig, *hurl_legs(phase, d))
    elif throw == 'pitch':
        coil = .95 * draw + .7 * stride - .95 * whip - .4 * follow
        offset(rig, 'root', -.1 * draw + .18 * whip + .24 * follow, .16 * coil,
               -.08 * draw + .1 * follow)
        offset(rig, 'spine', .04 + .05 * draw - .16 * follow, .17 * coil, 0)
        offset(rig, 'chest', .03 + .08 * draw - .22 * follow, .24 * coil, 0)
        offset(rig, 'neck', .08, -.32 * coil, 0)
        offset(rig, 'head', -.03 + .06 * aim, -.24 * coil, 0)
        offset(rig, 'upper_arm.L', -.32 - .3 * draw + .75 * whip + .5 * follow, 0, -.08)
        offset(rig, 'lower_arm.L', -.18 - .04 * draw + .55 * whip + .45 * follow, 0, -.05)
        offset(rig, 'hand.L', -.06, 0, 0)
        set_legs(rig, .06 + HURLER_STANCE * ready + .06 * draw - .1 * whip - .08 * follow,
                 STANDING_KNEE - HURLER_LOAD * ready + .08 * draw + .06 * whip + .09 * follow,
                 -.06 - HURLER_STANCE * ready + .1 * draw + .08 * whip + .04 * follow,
                 STANDING_KNEE + HURLER_LOAD * ready + .14 * draw + .13 * whip + .17 * follow)
    else:
        coil = .5 * draw - .45 * whip - .2 * follow
        offset(rig, 'root', .06 * draw + .12 * whip + .14 * follow, .1 * coil, 0)
        offset(rig, 'spine', .04 + .06 * draw - .08 * follow, .12 * coil, 0)
        offset(rig, 'chest', .03 + .05 * draw - .12 * follow, .16 * coil, 0)
        offset(rig, 'neck', .08, -.2 * coil, 0)
        offset(rig, 'head', -.03, -.16 * coil, 0)
        offset(rig, 'upper_arm.L', -.34 + .3 * whip + .2 * follow, 0, -.1)
        offset(rig, 'lower_arm.L', -.22 + .3 * whip + .2 * follow, 0, -.06)
        offset(rig, 'hand.L', -.06, 0, 0)
        set_legs(rig, .06 + HURLER_STANCE * ready - .08 * whip,
                 STANDING_KNEE - HURLER_LOAD * ready + .14 * draw + .1 * whip,
                 -.06 - HURLER_STANCE * ready + .08 * whip,
                 STANDING_KNEE + HURLER_LOAD * ready + .18 * draw + .14 * whip)

    if ready > .001:
        add_offset(rig, 'root', 0, ready * .16, -ready * .05)
        add_offset(rig, 'chest', 0, ready * .12, 0)
        add_offset(rig, 'neck', 0, -ready * .16, 0)
        add_offset(rig, 'upper_arm.L', -ready * (.42 + aim * .18), 0, -ready * .18)
        add_offset(rig, 'lower_arm.L', -ready * .1, 0, 0)

    # The step. Applied to the whole actor, after the pose: forward along the
    # axis the fighter faces, and down onto the stride.
    root, at_x = STANCES[rig]
    forward, drop = hurl_step(throw, phase)
    root.location = (at_x, -forward, -drop)


def rock_world(actor):
    """Where the held rock is, matching how the runtime parents it to the wrist."""
    rig = actor['rig']
    return rig.matrix_world @ (rig.pose.bones['hand.R'].matrix @ ROCK_IN_HAND)


def measure(actor, throw, phase, aim_phase=-1):
    pose_throw(actor['rig'], throw, phase, aim_phase)
    bpy.context.view_layer.update()
    rig = actor['rig']
    rock = rock_world(actor)
    elbow = rig.matrix_world @ rig.pose.bones['lower_arm.R'].matrix.translation
    root = rig.matrix_world @ rig.pose.bones['root'].matrix.translation
    from_body = rock - root
    # Feet are measured against the **spot the fighter holds**, not against its
    # root, because the step moves the root: a foot that keeps station while the
    # body travels over it is planted, and one that keeps station with the root
    # is being dragged along the ground. `at_x` is where the director put it.
    home = Vector((STANCES[rig][1], 0, 0))
    feet = {tag: named(f'Foot.{tag}', actor).matrix_world.translation
            for tag in ('L', 'R')}
    return {
        'reach': from_body.dot(FORWARD),
        'height': rock.z,
        'side': from_body.x,
        'elbow': elbow.z,
        'footL': feet['L'].z,
        'footR': feet['R'].z,
        'alongL': (feet['L'] - home).dot(FORWARD),
        'alongR': (feet['R'] - home).dot(FORWARD),
        'pose': {b.name: b.rotation_quaternion.copy() for b in rig.pose.bones},
    }


# ---------------------------------------------------------------- validation

PHASES = [0, .15, .3, .45, .58, .72, .85, 1]
SPACING = 2.9
actors = [import_hurler(f'P{index}', (index - (len(PHASES) - 1) / 2) * SPACING)
          for index in range(len(PHASES))]
MAIN = actors[0]

failures = []
print('\n=== throw geometry, in the fighter\'s own frame ===')
print('reach is toward the target, height is off the ground, side is to its right\n')

ready = measure(MAIN, 'hurl', -1)
ready_feet = (ready['footL'], ready['footR'])
# The foot the fighter is standing on, which is the one that has to stay put.
# Checking both would fail a hurl on purpose: its gather lifts the lead knee to
# balance a body leaning back, and that foot is supposed to be half a metre up.
ready_support = min(ready_feet)
ready_pose = ready['pose']

for throw in ('hurl', 'pitch', 'toss'):
    print(f'--- {throw} (releases at phase {RELEASE[throw]}) ---')
    samples = {}
    drift = 0
    for phase in PHASES:
        m = measure(MAIN, throw, phase)
        samples[phase] = m
        drift = max(drift, abs(min(m['footL'], m['footR']) - ready_support))
        print(f'  phase {phase:.2f}  reach {m["reach"]:+.2f}  height {m["height"]:.2f}  '
              f'side {m["side"]:+.2f}  elbow {m["elbow"]:.2f}  '
              f'feet L {m["alongL"]:+.2f}/h{m["footL"]:.2f} '
              f'R {m["alongR"]:+.2f}/h{m["footR"]:.2f} '
              f'split {m["alongL"] - m["alongR"]:+.2f}')
    at_release = measure(MAIN, throw, RELEASE[throw])
    drawn = min(samples.values(), key=lambda m: m['reach'])
    travel = at_release['reach'] - drawn['reach']
    print(f'  release: reach {at_release["reach"]:+.2f}  height {at_release["height"]:.2f}'
          f'   wind-up travel {travel:+.2f} m   foot drift {drift:.3f} m')

    # The rock has to end up in front of the fighter, or it is being thrown at
    # nobody and its sparks would come off the wrong unit.
    if at_release['reach'] <= 0.35:
        failures.append(f'{throw}: rock is not in front of the body at release '
                        f'({at_release["reach"]:+.2f} m)')
    # And the motion has to be a throw rather than a nudge. A hurl swings the
    # rock much further than a flick from the hip does, so each has its own bar.
    minimum_travel = {'hurl': 1.5, 'pitch': 0.9, 'toss': 0.5}[throw]
    if travel < minimum_travel:
        failures.append(f'{throw}: wind-up travels only {travel:.2f} m, '
                        f'wanted at least {minimum_travel} m')
    # A thrower lifts a foot on purpose - a heel off the drive leg, a whole
    # knee in the gather - so what is checked is the foot it is standing on.
    # That one may not leave the ground, or the fighter is skating.
    if drift > 0.32:
        failures.append(f'{throw}: the foot it stands on drifts {drift:.3f} m')

    # Overhand, checked across the motion rather than at the release pose.
    # Sampled finely: the sidearm slot the rig falls into is a dip between two
    # good keys, and eight phases step right over it.
    #
    # The wind-up is exempt, because the rock starts at the hip and the arm has
    # to come up from there. The rule starts where it arrives: from the moment
    # the rock is above the shoulder, the elbow has to be above it too, all the
    # way to the release. That is the difference between coming over the top and
    # slinging it round the side.
    fine = [(p / 100, measure(MAIN, throw, p / 100))
            for p in range(0, int(RELEASE[throw] * 100) + 1)]
    lifted = next((i for i, (_, m) in enumerate(fine) if m['height'] > SHOULDER_HEIGHT), None)
    if lifted is None:
        failures.append(f'{throw}: the rock never gets above the shoulder before release')
    else:
        dropped = [(p, m) for p, m in fine[lifted:] if m['elbow'] < SHOULDER_HEIGHT]
        if dropped:
            worst = min(dropped, key=lambda pair: pair[1]['elbow'])
            failures.append(
                f'{throw}: elbow drops below the shoulder during the throw '
                f'({worst[1]["elbow"]:.2f} m at phase {worst[0]:.2f}, shoulder is '
                f'{SHOULDER_HEIGHT}) - that is a sidearm slot')
    over_the_top = max(m['height'] for _, m in fine)
    print(f'  highest the rock gets before release: {over_the_top:.2f} m '
          f'(head is at {HEAD_HEIGHT})')
    if over_the_top <= HEAD_HEIGHT + 0.3:
        failures.append(f'{throw}: rock only reaches {over_the_top:.2f} m before release, '
                        f'so it never comes over the top of the head')
    # Released across the throwing shoulder rather than out beside it.
    if not -0.2 <= at_release['side'] <= 1.1:
        failures.append(f'{throw}: rock leaves the hand {at_release["side"]:+.2f} m to the '
                        f'side, which is not in front of the fighter')

    # Consecutive phases have to be tellable apart at RTS viewing scale, up to
    # the point the motion has settled back to the ready stance.
    for earlier, later in zip(PHASES, PHASES[1:]):
        if later > .85:
            continue
        moved = abs(samples[later]['reach'] - samples[earlier]['reach']) + \
            abs(samples[later]['height'] - samples[earlier]['height'])
        if moved < 0.04:
            failures.append(f'{throw}: phases {earlier} and {later} are '
                            f'indistinguishable ({moved:.3f} m apart)')

# A hurl is a step, and this is what makes it one rather than a knee lifted on
# the spot. The fighter waits with the throwing-side leg forward under its
# weight and the other trailing; that trailing leg comes through and plants
# ahead; and once it is down it stays down while the body travels over it.
#
# The last of those is the one that needs measuring rather than reasoning about.
# `hurlStep`'s arithmetic is planar and cannot see the coil: the root turns the
# whole skeleton about a point on the ground, and uncancelled that swept the
# planted lead foot a quarter of a metre backwards through the release — a pose
# whose numbers all looked right.
print()
stance = measure(MAIN, 'hurl', 0)
if stance['alongL'] > stance['alongR'] - 0.3:
    failures.append(
        f'a hurler does not wait with its trailing leg behind it '
        f'(L {stance["alongL"]:+.2f} vs R {stance["alongR"]:+.2f}) - there is '
        f'nowhere to step to, and the wind-up reads as a knee lift on the spot')
if stance['footR'] > stance['footL']:
    failures.append(
        f'a hurler waits with its weight on the wrong leg: the throwing-side '
        f'foot is {stance["footR"]:.2f} up and the trailing one {stance["footL"]:.2f}')
stepped = measure(MAIN, 'hurl', RELEASE['hurl'])
print(f'the step: trailing foot {stance["alongL"]:+.2f} m behind the spot at the '
      f'start, {stepped["alongL"]:+.2f} m ahead of it at release')
if stepped['alongL'] < stepped['alongR'] + 0.3:
    failures.append(
        f'the hurl does not release over a planted lead foot '
        f'(L {stepped["alongL"]:+.2f} vs R {stepped["alongR"]:+.2f})')
planted = [measure(MAIN, 'hurl', p / 100)['alongL'] for p in range(44, 73, 4)]
skate = max(planted) - min(planted)
print(f'the lead foot moves {skate:.3f} m between planting and the recovery')
if skate > 0.16:
    failures.append(f'the lead foot skates {skate:.3f} m while it is planted')

# Height ordering: all three come over the top, but the further the throw the
# taller and longer the fighter stands it up.
heights = {throw: measure(MAIN, throw, RELEASE[throw])['height'] for throw in RELEASE}
print('\nrelease heights: ' +
      '  '.join(f'{throw} {height:.2f}' for throw, height in heights.items()))
if not heights['hurl'] > heights['pitch'] > heights['toss']:
    failures.append(f'release heights do not fall off with the throw: {heights}')

# Back to a clean stance afterwards, or a hurler drifts out of shape over a fight.
after = measure(MAIN, 'hurl', 1)
recovery = max(
    ready_pose[name].rotation_difference(quaternion).angle
    for name, quaternion in after['pose'].items()
)
print(f'recovery error at the end of a hurl: {math.degrees(recovery):.1f} degrees')
if recovery > 0.7:
    failures.append(f'hurl does not settle back to the ready stance '
                    f'({math.degrees(recovery):.1f} degrees out)')

# A dense read of where the feet actually are through a hurl. The step is the
# one part of this motion the eight validation phases are too coarse for: a foot
# that skates does it between them, and the arithmetic in `hurlStep` cannot
# predict it because the body's yaw carries the feet around as well.
if os.environ.get('FEET'):
    print('\n=== a hurl, foot by foot, against the spot the fighter holds ===')
    print('   phase   fwd |     L    h |     R    h | split')
    for step_index in range(0, 51):
        phase = step_index / 50
        m = measure(MAIN, 'hurl', phase)
        forward, _ = hurl_step('hurl', phase)
        print(f'    {phase:.2f} {forward:5.2f} | {m["alongL"]:+.2f} {m["footL"]:.2f} | '
              f'{m["alongR"]:+.2f} {m["footR"]:.2f} | {m["alongL"] - m["alongR"]:+.2f}')

if failures:
    raise RuntimeError('Throw validation failed:\n  ' + '\n  '.join(failures))
print('\nThrow geometry validated.\n')

# Rendering is most of the runtime, and a stance question is answered by the
# numbers above. `MEASURE=1` stops here.
if os.environ.get('MEASURE'):
    raise SystemExit(0)


# ------------------------------------------------------------------ rendering

scene = bpy.context.scene
mars = bpy.data.materials.new('Mars')
mars.diffuse_color = (.22, .045, .025, 1)
mars.roughness = .9
rock_material = bpy.data.materials.new('Rock')
rock_material.diffuse_color = (.16, .09, .06, 1)
ROCK_MESH.materials.append(rock_material)
bpy.ops.mesh.primitive_plane_add(size=90, location=(0, 0, -.02))
bpy.context.object.data.materials.append(mars)

world = bpy.data.worlds.new('World')
scene.world = world
world.color = (.025, .012, .008)
bpy.ops.object.light_add(type='AREA', location=(-6, -14, 16))
bpy.context.object.data.energy = 9000
bpy.context.object.data.size = 14
bpy.ops.object.light_add(type='AREA', location=(10, 6, 12))
bpy.context.object.data.energy = 5000
bpy.context.object.data.color = (.35, .55, 1)
bpy.context.object.data.size = 10

bpy.ops.object.camera_add()
camera = bpy.context.object
camera.data.type = 'ORTHO'
camera.data.ortho_scale = SPACING * len(PHASES) + 1.4
scene.camera = camera
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 2400
scene.render.resolution_y = 620
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.look = 'AgX - Medium High Contrast'

# The gameplay camera angle first, then two more, so a throw that only reads
# from one side cannot pass. Offsets are directions, scaled out past the line.
ANGLES = (('game', (8, -10, 7)), ('side', (-11, -5, 5)), ('front', (0, -14, 4)))
LOOK_AT = Vector((0, 0, 2.0))
for name, direction in ANGLES:
    camera.location = LOOK_AT + Vector(direction).normalized() * 40
    camera.rotation_euler = (LOOK_AT - camera.location).to_track_quat('-Z', 'Y').to_euler()
    # Lay the row out across the camera rather than along world X, or the line
    # runs diagonally out of frame at every angle but one.
    across = (LOOK_AT - camera.location).cross(Vector((0, 0, 1)))
    across.z = 0
    across.normalize()
    for index, actor in enumerate(actors):
        actor['root'].location = across * ((index - (len(actors) - 1) / 2) * SPACING)
    for throw in ('hurl', 'pitch', 'toss'):
        for actor, phase in zip(actors, PHASES):
            pose_throw(actor['rig'], throw, phase)
        bpy.context.view_layer.update()
        for actor, phase in zip(actors, PHASES):
            actor['rock'].location = rock_world(actor)
            # Once the rock is gone the hand is empty, which is half the read.
            actor['rock'].hide_render = phase > RELEASE[throw]
        scene.render.filepath = str(OUTPUT / f'{throw}_{name}.png')
        bpy.ops.render.render(write_still=True)
        print(f'  {throw} {name}: ' + ' '.join(f'{p:.2f}' for p in PHASES))

print(f'\nRendered throw contact sheets to {OUTPUT}')
