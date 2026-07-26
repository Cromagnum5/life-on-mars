"""Render the imported GLB walk cycle with runtime balance-like overlays."""
import bpy, math
from pathlib import Path
from mathutils import Euler, Vector

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path('/tmp/life-on-mars-walk-review')
OUTPUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT / 'public/models/rigwalker.glb'))
rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
walk = next((action for action in bpy.data.actions if action.name.startswith('Walk')), None)
idle = next((action for action in bpy.data.actions if action.name.startswith('Idle')), None)
if walk is None or idle is None:
    raise RuntimeError('Imported GLB has no Walk action')
rig.animation_data_create(); rig.animation_data.action = walk
for bone in rig.pose.bones:
    bone.rotation_mode = 'QUATERNION'

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 420; scene.render.resolution_y = 420
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.look = 'AgX - Medium High Contrast'

floor_mat = bpy.data.materials.new('Mars')
floor_mat.diffuse_color = (.22, .045, .025, 1); floor_mat.roughness = .9
bpy.ops.mesh.primitive_plane_add(size=16, location=(0, 0, -.02))
bpy.context.object.data.materials.append(floor_mat)
world = bpy.data.worlds.new('World'); scene.world = world; world.color = (.025, .012, .008)
bpy.ops.object.light_add(type='AREA', location=(-4, -5, 8))
bpy.context.object.data.energy = 1200; bpy.context.object.data.size = 6
bpy.ops.object.light_add(type='AREA', location=(5, 2, 5))
bpy.context.object.data.energy = 650; bpy.context.object.data.color = (.35, .55, 1)
bpy.ops.object.camera_add(location=(6, -8, 5.2))
camera = bpy.context.object; camera.data.type = 'ORTHO'; camera.data.ortho_scale = 5.2
camera.rotation_euler = (Vector((0, 0, 1.8)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = camera

def add_offset(name, xyz):
    bone = rig.pose.bones.get(name)
    if bone is not None:
        bone.rotation_quaternion = bone.rotation_quaternion @ Euler(xyz, 'XYZ').to_quaternion()

def overlay(lean_x, lean_z, stance, crouch, step, side):
    # Walking stays on the authored clip until foot-aware balance is available.
    return

# Reproduce the Assembly Bay idle-to-exit transition and first full stride.
vx = lean = lean_v = disturbance = 0.0
sim_time = 0.0
step_time = 0.0; step_side = 0
dt = 1/60
samples = 18
for sample in range(samples):
    target_time = -.18 + sample * .88 / (samples-1)
    while sim_time < max(0,target_time):
        acceleration = (3.6-vx)/dt; vx = 3.6
        target = max(-.34, min(.34, acceleration/3.71*.12 + disturbance))
        lean_v += ((target-lean)*23-lean_v*8.2)*dt; lean += lean_v*dt
        instability = abs(lean+disturbance*.45)
        if step_time <= 0 and instability > .115:
            step_time=.62; step_side=1 if lean >= 0 else -1
        if step_time > 0:
            step_time=max(0,step_time-dt)
            if step_time == 0: lean_v*=.35; disturbance*=.22; step_side=0
        disturbance*=math.exp(-3.1*dt)
        sim_time += dt
    moving = target_time >= 0
    rig.animation_data.action = walk if moving else idle
    clip_frame = 1 + (((max(0,target_time)*1.72) if moving else ((target_time+.18)*.4)) % 1.0)*23
    scene.frame_set(int(clip_frame), subframe=clip_frame-int(clip_frame))
    rig.location.y = max(0,target_time) * 3.6
    bpy.context.view_layer.update()
    instability=min(1,abs(lean)/.24)
    stance=.035+instability*.16; crouch=instability*.13
    progress=1-step_time/.62 if step_time>0 else 0
    step=math.sin(progress*math.pi) if step_time>0 else 0
    overlay(lean, 0, stance, crouch, step, step_side)
    scene.render.filepath=str(OUTPUT / f'spawn_{sample:02d}.png')
    bpy.ops.render.render(write_still=True)
print(f'Rendered {samples} spawn-exit frames to {OUTPUT}')
