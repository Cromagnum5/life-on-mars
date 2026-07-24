"""Generate the editable Rigwalker source and browser-ready animated GLB.

Run from the repository root:
    blender --background --python tools/create_rigwalker.py
"""

from pathlib import Path
import math

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATH = ROOT / "assets" / "rigwalker.blend"
EXPORT_PATH = ROOT / "public" / "models" / "rigwalker.glb"


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.armatures,
        bpy.data.actions,
    ):
        for datablock in list(datablocks):
            datablocks.remove(datablock)


def material(name, color, metallic, roughness, emission=None):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*color, 1)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if emission:
        shader.inputs["Emission Color"].default_value = (*emission, 1)
        shader.inputs["Emission Strength"].default_value = 2.2
    return result


def finish_mesh(obj, name, mat):
    obj.name = name
    obj.data.name = f"{name}Mesh"
    obj.data.materials.append(mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    return obj


def cube(name, location, scale, mat, bevel=0.04):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = finish_mesh(bpy.context.object, name, mat)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        modifier = obj.modifiers.new("Edge bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 1
    return obj


def sphere(name, location, radius, mat):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=radius, location=location)
    return finish_mesh(bpy.context.object, name, mat)


def cylinder(name, location, radius, depth, mat, vertices=10, rotation=None):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation or (0, 0, 0),
    )
    return finish_mesh(bpy.context.object, name, mat)


def create_armature():
    armature_data = bpy.data.armatures.new("RigwalkerRig")
    armature = bpy.data.objects.new("RigwalkerRig", armature_data)
    bpy.context.collection.objects.link(armature)
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    bones = {}

    def bone(name, head, tail, parent=None):
        item = armature_data.edit_bones.new(name)
        item.head = head
        item.tail = tail
        if parent:
            item.parent = bones[parent]
        bones[name] = item

    bone("root", (0, 0, 0), (0, 0, 0.3))
    bone("spine", (0, 0, 1.55), (0, 0, 2.8), "root")
    bone("head", (0, 0, 2.8), (0, 0, 3.35), "spine")

    for side, x in (("L", -0.27), ("R", 0.27)):
        bone(f"upper_leg.{side}", (x, 0, 1.55), (x, 0, 0.76), "root")
        bone(f"lower_leg.{side}", (x, 0, 0.76), (x, 0, 0.04), f"upper_leg.{side}")
        bone(f"foot.{side}", (x, 0, 0.04), (x, -0.42, 0.04), f"lower_leg.{side}")

        shoulder_x = -0.67 if side == "L" else 0.67
        bone(
            f"upper_arm.{side}",
            (shoulder_x, 0, 2.68),
            (shoulder_x, 0, 1.9),
            "spine",
        )
        bone(
            f"lower_arm.{side}",
            (shoulder_x, 0, 1.9),
            (shoulder_x, 0, 1.25),
            f"upper_arm.{side}",
        )

    bpy.ops.object.mode_set(mode="POSE")
    for pose_bone in armature.pose.bones:
        pose_bone.rotation_mode = "XYZ"
    bpy.ops.object.mode_set(mode="OBJECT")
    armature.show_in_front = True
    return armature


def parent_to_bone(obj, armature, bone_name):
    world = obj.matrix_world.copy()
    obj.parent = armature
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    obj.matrix_world = world


def create_model(armature):
    armor = material("Armor", (0.31, 0.36, 0.38), 0.72, 0.42)
    dark = material("Dark metal", (0.08, 0.1, 0.11), 0.84, 0.34)
    joint = material("Joints", (0.48, 0.52, 0.53), 0.9, 0.26)
    orange = material(
        "Corporate orange",
        (0.95, 0.32, 0.055),
        0.42,
        0.3,
        (0.45, 0.08, 0.005),
    )
    cyan = material(
        "Visor",
        (0.2, 0.85, 0.95),
        0.18,
        0.15,
        (0.05, 0.65, 0.9),
    )

    parts = []

    def attach(obj, bone_name):
        parent_to_bone(obj, armature, bone_name)
        parts.append(obj)

    attach(cube("Pelvis", (0, 0, 1.58), (0.37, 0.27, 0.2), dark), "root")
    attach(cube("Torso", (0, 0, 2.25), (0.53, 0.3, 0.58), armor, 0.06), "spine")
    attach(cube("ChestStripe", (0, -0.315, 2.48), (0.45, 0.035, 0.08), orange, 0.015), "spine")
    attach(cube("Backpack", (0, 0.38, 2.2), (0.3, 0.17, 0.42), dark), "spine")
    attach(cylinder("Neck", (0, 0, 2.88), 0.13, 0.22, joint, 8), "spine")
    attach(cube("Head", (0, 0, 3.16), (0.29, 0.26, 0.26), dark, 0.035), "head")
    attach(cube("Visor", (0, -0.275, 3.2), (0.23, 0.025, 0.065), cyan, 0.01), "head")
    attach(cube("HeadAccent", (0.29, 0, 3.26), (0.055, 0.08, 0.11), orange, 0.015), "head")
    attach(cylinder("Antenna", (0.25, 0.08, 3.63), 0.025, 0.72, joint, 8), "head")
    attach(sphere("AntennaLight", (0.25, 0.08, 4.0), 0.075, cyan), "head")

    for side, x in (("L", -0.27), ("R", 0.27)):
        attach(sphere(f"Hip.{side}", (x, 0, 1.52), 0.15, joint), f"upper_leg.{side}")
        attach(cube(f"Thigh.{side}", (x, 0, 1.15), (0.12, 0.14, 0.34), armor), f"upper_leg.{side}")
        attach(
            cylinder(
                f"Knee.{side}",
                (x, 0, 0.74),
                0.14,
                0.27,
                orange,
                8,
                (0, math.pi / 2, 0),
            ),
            f"lower_leg.{side}",
        )
        attach(cube(f"Shin.{side}", (x, 0.01, 0.39), (0.105, 0.12, 0.31), dark), f"lower_leg.{side}")
        attach(cube(f"Foot.{side}", (x, -0.14, 0.08), (0.17, 0.3, 0.09), armor), f"foot.{side}")
        attach(cube(f"Toe.{side}", (x, -0.41, 0.11), (0.115, 0.08, 0.04), orange), f"foot.{side}")

        shoulder_x = -0.67 if side == "L" else 0.67
        attach(sphere(f"Shoulder.{side}", (shoulder_x, 0, 2.67), 0.19, orange), f"upper_arm.{side}")
        attach(
            cube(
                f"UpperArm.{side}",
                (shoulder_x, 0, 2.3),
                (0.12, 0.14, 0.33),
                armor,
            ),
            f"upper_arm.{side}",
        )
        attach(sphere(f"Elbow.{side}", (shoulder_x, 0, 1.89), 0.13, joint), f"lower_arm.{side}")
        attach(
            cube(
                f"Forearm.{side}",
                (shoulder_x, 0, 1.57),
                (0.105, 0.12, 0.28),
                dark,
            ),
            f"lower_arm.{side}",
        )
        attach(cube(f"Hand.{side}", (shoulder_x, -0.01, 1.24), (0.14, 0.15, 0.12), armor), f"lower_arm.{side}")

    return parts


def key_pose(armature, frame, rotations=None, root_height=0):
    rotations = rotations or {}
    for bone in armature.pose.bones:
        bone.rotation_euler = rotations.get(bone.name, (0, 0, 0))
        bone.keyframe_insert("rotation_euler", frame=frame, group=bone.name)
    root = armature.pose.bones["root"]
    root.location = (0, 0, root_height)
    root.keyframe_insert("location", frame=frame, group="root")


def create_animations(armature):
    armature.animation_data_create()

    idle = bpy.data.actions.new("Idle")
    idle.use_fake_user = True
    armature.animation_data.action = idle
    key_pose(armature, 1, root_height=0)
    key_pose(armature, 24, {"head": (0, 0, math.radians(4))}, root_height=0.025)
    key_pose(armature, 48, root_height=0)

    walk = bpy.data.actions.new("Walk")
    walk.use_fake_user = True
    armature.animation_data.action = walk
    poses = (
        (1, 0.0),
        (7, 1.0),
        (13, 0.0),
        (19, -1.0),
        (25, 0.0),
    )
    for frame, phase in poses:
        rotations = {
            "upper_leg.L": (phase * 0.55, 0, 0),
            "upper_leg.R": (-phase * 0.55, 0, 0),
            "lower_leg.L": (max(0, -phase) * 0.75, 0, 0),
            "lower_leg.R": (max(0, phase) * 0.75, 0, 0),
            "foot.L": (-phase * 0.18, 0, 0),
            "foot.R": (phase * 0.18, 0, 0),
            "upper_arm.L": (-phase * 0.42, 0, 0),
            "upper_arm.R": (phase * 0.42, 0, 0),
            "lower_arm.L": (-0.22 - max(0, phase) * 0.25, 0, 0),
            "lower_arm.R": (-0.22 - max(0, -phase) * 0.25, 0, 0),
            "spine": (0, phase * 0.025, phase * 0.02),
        }
        key_pose(armature, frame, rotations, 0.05 + abs(phase) * 0.07)

    for curve in walk.fcurves:
        for keyframe in curve.keyframe_points:
            keyframe.interpolation = "LINEAR"

    armature.animation_data.action = walk
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 48
    bpy.context.scene.render.fps = 24


def save_and_export(armature, parts):
    SOURCE_PATH.parent.mkdir(parents=True, exist_ok=True)
    EXPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE_PATH))

    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = armature

    bpy.ops.export_scene.gltf(
        filepath=str(EXPORT_PATH),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_def_bones=True,
        export_optimize_animation_size=True,
    )


reset_scene()
rig = create_armature()
model_parts = create_model(rig)
create_animations(rig)
save_and_export(rig, model_parts)
print(f"Saved {SOURCE_PATH}")
print(f"Exported {EXPORT_PATH}")
