"""Thrones character build (Blender 5.x + MPFB).

  blender -b -P scripts/blender/build_soldiers.py -- <out_dir> <UAL1_Standard.glb> [--preview <dir>]

Produces in <out_dir>:
  soldier.glb   rigged South-Asian man, split body parts, every garment / headgear / armour piece as a
                separate skinned mesh, plus rigid weapons (talwar, dhal, bhala, lance, kaman, tarkash, scabbard)
  anims.glb     the Universal Animation Library clips retargeted onto the rig
  skins/*.jpg   skin variants (tone + facial hair)
"""
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector
from common import reset, select_only
from human import VARIANTS, build_human, skin_variant
import garments as G
import outfits as O
import bake as BK
import weapons as W
from retarget import retarget, to_tpose

argv = sys.argv[sys.argv.index('--') + 1:]
OUT, UAL = os.path.abspath(argv[0]), os.path.abspath(argv[1])
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None
QUICK = '--quick' in argv
TEXDIR = os.path.join(os.path.expanduser('~/thrones-tools/work'), 'bake')
os.makedirs(TEXDIR, exist_ok=True)
os.makedirs(os.path.join(OUT, 'skins'), exist_ok=True)

CLIPS = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Sword_Idle', 'Sword_Attack', 'Punch_Jab', 'Punch_Cross',
         'Spell_Simple_Shoot', 'Pistol_Aim_Neutral', 'Death01', 'Hit_Chest', 'Fixing_Kneeling', 'PickUp_Table', 'Interact',
         'Sitting_Idle_Loop', 'Idle_Talking_Loop', 'Idle_Torch_Loop']

reset()
v0 = VARIANTS[0]
body, rig, parts, _ = build_human(v0)

# --- animation source ---------------------------------------------------------------------
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=UAL)
new = [o for o in bpy.data.objects if o not in before]
src = [o for o in new if o.type == 'ARMATURE'][0]
for o in new:
    if o.type != 'ARMATURE':
        bpy.data.objects.remove(o)
for a in list(bpy.data.actions):
    a.name = 'src_' + a.name
src.animation_data_create()
print('ACTS_AFTER_IMPORT', len(bpy.data.actions), sorted(a.name for a in bpy.data.actions)[:50])

# --- rest the rig in the library's T-pose, rename to the game's bone names --------------------
to_tpose(src, rig, [body] + list(parts.values()))
rig.data.bones['head'].name = 'Head'
rig.data.bones['Root'].name = 'root'
rig.name = 'rig'

skin_imgs = {}
for v in VARIANTS:
    skin_imgs[v['name']] = skin_variant(body, v, os.path.join(OUT, 'skins', f'skin_{v["name"]}.jpg'))

# lighter body for RTS use
select_only(body)
dm = body.modifiers.new('Decimate', 'DECIMATE')
dm.ratio = 0.55
while body.modifiers.find('Decimate') > 0:
    bpy.ops.object.modifier_move_up(modifier='Decimate')
bpy.ops.object.modifier_apply(modifier='Decimate')

ctx = G.Ctx(body, rig)
bp = G.split_body(ctx)
skin_mat = bp['head'].data.materials[0]
for n in skin_mat.node_tree.nodes:
    if n.type == 'TEX_IMAGE':
        n.image = skin_imgs['a']
skin_mat.name = 'skin'

# --- garments ----------------------------------------------------------------------------------
wr = O.Wardrobe(ctx, bp)
pieces = [wr.jama_top(), wr.jama_skirt(), wr.kurta_skirt(), wr.pajama(), wr.dhoti(), wr.kamarband(), wr.shoes(),
          wr.pagri(), wr.pagri('pheta', turns=5, width=0.062, scale=0.97, seed=9), wr.khud(), wr.zirah(), wr.chahar_aina(),
          wr.angavastra()]
garment_objs = [p[0] for p in pieces]

BK.setup_cycles()
for o, spec, size in ([] if QUICK else pieces):
    for g in garment_objs:
        g.hide_render = g is not o
    print('baking', o.name)
    BK.bake_piece(o, spec, size, TEXDIR)
for g in garment_objs:
    g.hide_render = False

# --- weapons ----------------------------------------------------------------------------------
team = W.mat('team', (0.8, 0.8, 0.8), 0.55)
weapons = [W.talwar(), W.dhal(team), W.bhala(1.9), W.bhala(2.6, team), W.kaman(), W.tarkash()]
sc_ = W.scabbard()
weapons.append(sc_)
for w in weapons:
    w.location = (0, 0, 0)

# --- animations --------------------------------------------------------------------------------
print('ACTS_BEFORE_RT', sorted(a.name for a in bpy.data.actions))
acts = retarget(src, rig, CLIPS)
import work_anims
acts += work_anims.build_all(rig)
for a in acts:
    for fc in getattr(a, 'fcurves', []):
        for k in fc.keyframe_points:
            k.interpolation = 'LINEAR'
bpy.data.objects.remove(src)
for a in list(bpy.data.actions):
    if a not in acts:
        bpy.data.actions.remove(a)
rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.rotation_quaternion = (1, 0, 0, 0)
    pb.location = (0, 0, 0)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print('TRIANGLES', {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes})


def export(path, objs, anims):
    select_only(*objs)
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
              export_skins=True, export_animations=anims, export_image_format='WEBP', export_image_quality=82,
              export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
              export_morph=False, export_extras=False)
    if anims:
        kw.update(export_animation_mode='ACTIONS', export_force_sampling=True, export_optimize_animation_size=True,
                  export_anim_slide_to_zero=True, export_reset_pose_bones=True, export_materials='NONE')
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError as e:
        print('export option issue', e)
        raise


export(os.path.join(OUT, 'soldier.glb'), [rig] + meshes, False)
export(os.path.join(OUT, 'anims.glb'), [rig], True)
print('EXPORTED', OUT)

if PREVIEW:
    import math as _m
    from mathutils import Vector as _V, Matrix as _M
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = 700, 800
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.name not in ('body_head', 'body_hands', 'body_feet', 'body_torso', 'body_thighs', 'body_shins', 'body_upperarms', 'body_forearms', 'jama_top', 'kurta_skirt', 'pajama', 'pheta'):
            o.hide_render = True
    rig.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    hand = rig.matrix_world @ rig.data.bones['hand_r'].head_local
    sign = 1 if rig.data.bones['hand_r'].head_local.x > 0 else -1
    grip = hand + _V((sign * 0.08, 0, -0.015))
    bpy.ops.mesh.primitive_cylinder_add(radius=0.018, depth=0.9, location=grip + _V((0, -0.15, 0)), rotation=(_m.pi / 2, 0, 0))
    tool = bpy.context.active_object
    bpy.ops.mesh.primitive_cone_add(radius1=0.03, depth=0.4, location=grip + _V((0, -0.55, 0.12)))
    head = bpy.context.active_object
    for o in (tool, head):
        mw = o.matrix_world.copy()
        o.parent = rig
        o.parent_type = 'BONE'
        o.parent_bone = 'hand_r'
        bpy.context.view_layer.update()
        o.matrix_world = mw
    rig.data.pose_position = 'POSE'
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3
    sun.rotation_euler = (0.8, 0, 0.6)
    sc.collection.objects.link(sun)
    w = bpy.data.worlds.new('w'); w.use_nodes = True; w.node_tree.nodes['Background'].inputs[1].default_value = 0.7; sc.world = w
    for clip in ('Mine_Loop', 'Chop_Loop'):
        rig.animation_data.action = bpy.data.actions[clip]
        n = int(bpy.data.actions[clip].frame_range[1])
        for k, u in enumerate((0.0, 0.3, 0.5, 0.57, 0.65, 0.85)):
            sc.frame_set(int(u * n))
            for view, loc in (('side', (3.2, -0.4, 1.1)), ('front', (1.2, -3.0, 1.2))):
                cam.location = loc
                cam.rotation_euler = (_V((0, 0, 0.95)) - _V(loc)).to_track_quat('-Z', 'Y').to_euler()
                cam.data.lens = 40
                sc.render.filepath = os.path.join(PREVIEW, f'{clip}_{k}_{view}.png')
                bpy.ops.render.render(write_still=True)
