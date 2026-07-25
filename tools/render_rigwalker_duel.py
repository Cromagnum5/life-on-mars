"""Render a deterministic imported-GLB Rigwalker duel for animation review."""

import bpy, math
from pathlib import Path
from mathutils import Vector, Euler

ROOT=Path(__file__).resolve().parents[1]
GLB=str(ROOT / 'public' / 'models' / 'rigwalker.glb')
OUTPUT=Path('/tmp/life-on-mars-animation-review')
OUTPUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)

def import_actor(label, accent, z, yaw):
    before=set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=GLB)
    objects=list(set(bpy.data.objects)-before)
    rig=next(o for o in objects if o.type=='ARMATURE')
    roots=[o for o in objects if o.parent is None]
    root=roots[0] if len(roots)==1 else rig
    for o in objects:
        o.name=f'{label}_{o.name}'
        if o.type=='MESH' and any(k in o.name for k in ('Accent','Stripe','Shoulder','Knee','Toe')):
            for slot in o.material_slots:
                if slot.material:
                    slot.material=slot.material.copy(); slot.material.diffuse_color=(*accent,1)
    root.location=(0,z,0); root.rotation_euler[2]=yaw
    return root,rig,objects

rootA,rigA,objsA=import_actor('A',(.95,.22,.06),-4.4,math.pi)
rootB,rigB,objsB=import_actor('B',(.12,.48,.95),4.4,0)
rests={}
for rig in (rigA,rigB):
    rests[rig]={b.name:b.rotation_quaternion.copy() for b in rig.pose.bones}
    for b in rig.pose.bones: b.rotation_mode='QUATERNION'

scene=bpy.context.scene; scene.frame_start=1; scene.frame_end=168; scene.render.fps=24

def offset(rig,name,xyz):
    b=rig.pose.bones.get(name)
    if not b:return
    q=Euler(xyz,'XYZ').to_quaternion()
    b.rotation_quaternion=rests[rig][name] @ q

def pose_combat(rig, phase, side=1, guarding=0, hit=0):
    winding=max(0,min(1,phase/.28))*(1-max(0,min(1,(phase-.28)/.30))) if phase>=0 else 0
    cutting=max(0,min(1,(phase-.28)/.28))*(1-max(0,min(1,(phase-.68)/.32))) if phase>=0 else 0
    impact=max(0,min(1,(phase-.38)/.16))*(1-max(0,min(1,(phase-.62)/.20))) if phase>=0 else 0
    follow=max(0,min(1,(phase-.54)/.16))*(1-max(0,min(1,(phase-.82)/.18))) if phase>=0 else 0
    shock=math.sin(min(1,hit)*math.pi) if hit>=0 else 0
    twist=side*(winding*-.58+impact*.76+follow*.28)
    offset(rig,'root',(0,twist*.28,0)); offset(rig,'spine',(.04+cutting*.1-shock*.12,twist*.52,side*(winding-cutting)*.08)); offset(rig,'chest',(.03+cutting*.12-shock*.14,twist*.72,side*(winding-cutting)*.13))
    offset(rig,'neck',(.08+cutting*.08-shock*.12,-twist*.46,0)); offset(rig,'head',(-.03+shock*.1,-twist*.34,0))
    # Enlarged runtime-like weapon arc for readable RTS silhouettes.
    offset(rig,'upper_arm.R',(-.3-winding*.72-impact*.2+follow*.16-guarding*.22,side*(.1+winding*.22-impact*.38-follow*.22),side*(-.05-winding*.18+impact*.26+follow*.14)))
    offset(rig,'lower_arm.R',(-.5-winding*.68+impact*.3+follow*.16-guarding*.24,side*(winding*.18-impact*.28-follow*.14),side*(.04+winding*.08-impact*.1+guarding*.08)))
    offset(rig,'hand.R',(-.1-winding*.22+impact*.98+follow*.38,side*(-.12-winding*.26-impact*.72-follow*.3),side*(.12+winding*.18+impact*.28+follow*.12)))
    offset(rig,'upper_arm.L',(-.24-guarding*.28,-side*(.08+winding*.1-impact*.08),-side*(.04+winding*.06)))
    offset(rig,'lower_arm.L',(-.38-guarding*.26,-side*(.06+winding*.08-impact*.06),-side*(.03+guarding*.05)))
    offset(rig,'hand.L',(-.06+guarding*.12,-side*.06,-side*.06))
    lead=side*(impact*.24+follow*.08-winding*.16+guarding*.08-shock*.04); stance=.11; knee=.22
    ul=stance-lead; ll=knee+lead; ur=-stance+lead; lr=knee-lead
    offset(rig,'upper_leg.L',(ul,0,guarding*.025)); offset(rig,'lower_leg.L',(ll,0,0)); offset(rig,'foot.L',(-(ul+ll),0,-guarding*.025))
    offset(rig,'upper_leg.R',(ur,0,-guarding*.025)); offset(rig,'lower_leg.R',(lr,0,0)); offset(rig,'foot.R',(-(ur+lr),0,guarding*.025))

def sample_walk(rig,t):
    # Authored 24-frame cycle, sampled at runtime's corrected 1.72x cadence.
    phase=math.sin(t*2*math.pi*1.72)
    offset(rig,'upper_leg.L',(phase*.55,0,0)); offset(rig,'upper_leg.R',(-phase*.55,0,0))
    offset(rig,'lower_leg.L',(max(0,-phase)*.75,0,0)); offset(rig,'lower_leg.R',(max(0,phase)*.75,0,0))
    offset(rig,'foot.L',(-phase*.18,0,0)); offset(rig,'foot.R',(phase*.18,0,0))
    offset(rig,'upper_arm.L',(-phase*.42,0,0)); offset(rig,'upper_arm.R',(phase*.42,0,0))

for f in range(1,169):
    t=(f-1)/24
    if f<=58:
        u=(f-1)/57; eased=u*u*(3-2*u)
        rootA.location.y=-4.4+3.25*eased; rootB.location.y=4.4-3.25*eased
        sample_walk(rigA,t); sample_walk(rigB,t+.29)
    else:
        rootA.location.y=-1.325; rootB.location.y=1.325
        cycle=(f-59)%54; attacker=((f-59)//54)%2
        phase=min(1,cycle/34) if cycle<=34 else -1
        if attacker==0:
            pose_combat(rigA,phase,1); pose_combat(rigB,-1,-1,guarding=math.sin(min(1,cycle/34)*math.pi),hit=(cycle-18)/12 if 18<=cycle<=30 else -1)
        else:
            pose_combat(rigB,phase,-1); pose_combat(rigA,-1,1,guarding=math.sin(min(1,cycle/34)*math.pi),hit=(cycle-18)/12 if 18<=cycle<=30 else -1)
    for root in (rootA,rootB): root.keyframe_insert('location',frame=f)
    for rig in (rigA,rigB):
        for b in rig.pose.bones: b.keyframe_insert('rotation_quaternion',frame=f)

# Mars floor and lighting.
mat=bpy.data.materials.new('Mars'); mat.diffuse_color=(.22,.045,.025,1); mat.roughness=.9
bpy.ops.mesh.primitive_plane_add(size=22, location=(0,0,-.02)); bpy.context.object.data.materials.append(mat)
for x,y,s in [(-3,-1,.35),(3,1,.28),(-4,3,.22),(4,-3,.3)]:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=s,location=(x,y,s*.45)); bpy.context.object.scale.z=.55; bpy.context.object.data.materials.append(mat)
world=bpy.data.worlds.new('World'); scene.world=world; world.color=(.025,.012,.008)
bpy.ops.object.light_add(type='AREA',location=(-4,-5,8)); bpy.context.object.data.energy=1200; bpy.context.object.data.size=6
bpy.ops.object.light_add(type='AREA',location=(5,2,5)); bpy.context.object.data.energy=700; bpy.context.object.data.color=(.35,.55,1); bpy.context.object.data.size=4
bpy.ops.object.camera_add(location=(8,-10,7)); cam=bpy.context.object; cam.data.type='ORTHO'; cam.data.ortho_scale=10.8
cam.rotation_euler=(Vector((0,0,1.6))-cam.location).to_track_quat('-Z','Y').to_euler(); scene.camera=cam
scene.render.engine='BLENDER_EEVEE'; scene.render.resolution_x=448; scene.render.resolution_y=252; scene.render.image_settings.color_mode='RGB'; scene.render.engine='BLENDER_EEVEE'; scene.render.image_settings.color_depth='8'; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';  scene.render.film_transparent=False
scene.view_settings.look='AgX - Medium High Contrast'
scene.render.image_settings.file_format='PNG'
scene.render.engine='BLENDER_EEVEE'
angles=((8,-10,7),(-8,-10,7),(8,8,6))
for angle_index,location in enumerate(angles):
    cam.location=location
    cam.rotation_euler=(Vector((0,0,1.6))-cam.location).to_track_quat('-Z','Y').to_euler()
    for frame in (65,77,83,95):
        scene.frame_set(frame)
        scene.render.filepath=str(OUTPUT / f'angle_{angle_index}_frame_{frame:04d}.png')
        bpy.ops.render.render(write_still=True)
