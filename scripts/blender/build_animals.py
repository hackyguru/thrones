"""Thrones mounts: a Marwari-type war horse and an Indian war elephant, with tack and animations.

  python3 scripts/blender/shape_horse.py horse.obj && python3 scripts/blender/shape_elephant.py elephant.obj
  blender -b -P scripts/blender/build_animals.py -- <out_dir> <horse.obj> <elephant.obj>

Writes <out_dir>/horse.glb and <out_dir>/elephant.glb (meshes + rig + clips: Idle, Walk, Run, Attack, Death).
"""
import bpy, bmesh, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix
from common import reset, select_only, smoothstep, link
import animals as A
from animals import V
import bake as BK
import weapons as W

argv = sys.argv[sys.argv.index('--') + 1:]
OUT, HORSE_OBJ, ELE_OBJ = [os.path.abspath(a) for a in argv[:3]]
ONLY = argv[3] if len(argv) > 3 else None
TEXDIR = os.path.expanduser('~/thrones-tools/work/bake_animals')
os.makedirs(TEXDIR, exist_ok=True)
os.makedirs(OUT, exist_ok=True)
F = lambda co: -co.y  # forward coordinate


def import_obj(path, name):
    bpy.ops.wm.obj_import(filepath=path, forward_axis='Y', up_axis='Z')
    o = bpy.context.selected_objects[0]
    o.name = o.data.name = name
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def trim_attr(o, width, keep=lambda co: True):
    d = BK.edge_distance(o, keep, max_d=width * 2)
    BK.set_attr(o, 'trim', [max(0.0, 1 - x / width) for x in d])
    BK.set_attr(o, 'dirt', [0.0] * len(o.data.vertices))


def seat(rig, name, bone, at):
    e = bpy.data.objects.new(name, None)
    link(e)
    e.parent = rig
    e.parent_type = 'BONE'
    e.parent_bone = bone
    bpy.context.view_layer.update()
    e.matrix_world = Matrix.Translation(at)
    return e


def export(path, rig):
    objs = [rig] + [o for o in bpy.data.objects if o.parent == rig]
    select_only(*objs)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_skins=True, export_animations=True, export_animation_mode='ACTIONS',
                              export_force_sampling=True, export_optimize_animation_size=True, export_anim_slide_to_zero=True,
                              export_reset_pose_bones=True, export_image_format='WEBP', export_image_quality=82,
                              export_texcoords=True, export_normals=True, export_morph=False, export_extras=False)
    print('EXPORTED', path)


CLOTH = dict(fabric='cotton_jersey', scale=3, rough=0.85, trim=(0.32, 0.05, 0.05))


# =============================================================================================
def build_horse():
    reset()
    body = import_obj(HORSE_OBJ, 'horse_body')
    eye_c = [V(s * 0.088, 1.13, 1.82) for s in (1, -1)]

    def shade(co):
        f, z = F(co), co.z
        s = 1.0
        s *= 1 - 0.62 * smoothstep(0.5, 0.3, z)                                       # dark points (lower legs)
        s *= 1 - 0.45 * smoothstep(1.3, 1.42, f)                                      # dark muzzle
        s *= 1 + 0.12 * smoothstep(1.0, 0.85, z) * smoothstep(0.55, 0.0, abs(f)) * smoothstep(-0.2, 0.0, -abs(co.x) + 0.15)  # lighter belly
        return s

    A.set_attr(body, 'shade', shade)
    A.set_attr(body, 'fixed', lambda co: 1.0 if co.z < 0.07 or min((co - e).length for e in eye_c) < 0.03 else 0.0)
    body['dec'] = 9000 / len(body.data.polygons)
    BK.setup_cycles()
    BK.bake_piece(body, dict(material_fn=A.coat_material, no_sub=True, rough=0.5), 1024, TEXDIR, ao=0.35)

    B = []
    for s, sx in (('l', 1), ('r', -1)):
        B += [(f'scap_{s}', V(sx * 0.15, 0.45, 1.36), V(sx * 0.15, 0.6, 1.05), 'chest'),
              (f'fu_{s}', V(sx * 0.14, 0.6, 1.05), V(sx * 0.13, 0.62, 0.53), f'scap_{s}'),
              (f'fc_{s}', V(sx * 0.13, 0.62, 0.53), V(sx * 0.13, 0.624, 0.17), f'fu_{s}'),
              (f'fp_{s}', V(sx * 0.13, 0.624, 0.17), V(sx * 0.13, 0.685, 0.01), f'fc_{s}'),
              (f'th_{s}', V(sx * 0.12, -0.55, 1.15), V(sx * 0.13, -0.42, 0.88), 'hips'),
              (f'ga_{s}', V(sx * 0.13, -0.42, 0.88), V(sx * 0.12, -0.78, 0.52), f'th_{s}'),
              (f'hc_{s}', V(sx * 0.12, -0.78, 0.52), V(sx * 0.12, -0.705, 0.17), f'ga_{s}'),
              (f'hp_{s}', V(sx * 0.12, -0.705, 0.17), V(sx * 0.12, -0.655, 0.01), f'hc_{s}')]
    rig = A.make_armature('horse_rig', [
        ('root', V(0, 0, 0), V(0, 0, 0.3), None),
        ('hips', V(0, -0.5, 1.2), V(0, 0.1, 1.22), 'root'),
        ('chest', V(0, 0.1, 1.22), V(0, 0.5, 1.28), 'hips'),
        ('neck1', V(0, 0.6, 1.35), V(0, 0.84, 1.6), 'chest'),
        ('neck2', V(0, 0.84, 1.6), V(0, 1.0, 1.84), 'neck1'),
        ('head', V(0, 1.0, 1.84), V(0, 1.36, 1.46), 'neck2'),
        ('tail1', V(0, -0.86, 1.28), V(0, -0.93, 1.1), 'hips'),
        ('tail2', V(0, -0.93, 1.1), V(0, -0.98, 0.8), 'tail1'),
        ('tail3', V(0, -0.98, 0.8), V(0, -1.0, 0.5), 'tail2'),
    ] + B)
    A.skin_to(rig, [body])

    # eyes
    eyes = W.lathe('horse_eyes', [(0.0, -0.02), (0.02, -0.012), (0.024, 0.0), (0.02, 0.012), (0.0, 0.02)], A.flat_material('horse_eye', (0.02, 0.015, 0.01), 0.08), 12, 'Y', eye_c[0])
    e2 = W.lathe('e2', [(0.0, -0.02), (0.02, -0.012), (0.024, 0.0), (0.02, 0.012), (0.0, 0.02)], eyes.data.materials[0], 12, 'Y', eye_c[1])
    select_only(eyes, e2)
    bpy.ops.object.join()
    A.bind_weights(rig, eyes, {'head': 1.0})

    # mane (cards along the crest, falling to the right) and tail
    hair = A.hair_material('horse_hair', A.strand_image('horse_hair_tex', seed=3))
    from mathutils.bvhtree import BVHTree
    tree = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())

    def on_surface(p, gap=0.012):
        loc, nor, _, _ = tree.find_nearest(p)
        if loc is None:
            return p
        inside = (p - loc).dot(nor) < gap
        return loc + nor * gap if inside else p

    strips = []
    for i in range(84):
        u = i / 83
        f = 1.0 - u * 0.52
        hit = tree.ray_cast(V(0, f, 2.6), Vector((0, 0, -1)), 2.0)
        if not hit[0]:
            continue
        top = hit[0]
        ln = 0.2 + 0.14 * math.sin(u * math.pi) + 0.03 * ((i * 7) % 3)
        pts = [top + Vector((0, 0, 0.01))]
        for k in range(1, 6):
            q = top + Vector((-0.028 * k - 0.004 * k * k, 0.006 * k, -ln * k / 5))
            pts.append(on_surface(q))
        strips.append(pts)
    poll = tree.ray_cast(V(0, 1.03, 2.6), Vector((0, 0, -1)), 2.0)[0] or V(0, 1.03, 1.95)
    forelock = [[on_surface(poll + Vector((0.012 * j, -0.035 * k, -0.03 * k)), 0.01) for k in range(5)] for j in (-1, 1)]
    mane = A.cards('mane', strips + forelock, 0.1, hair)
    A.copy_weights(body, mane, rig)
    tstrips = []
    for i in range(14):
        a = i / 14 * math.tau
        off = Vector((math.cos(a) * 0.03, math.sin(a) * 0.03, 0))
        tstrips.append([V(0, -0.88 - 0.02 * k, 1.24 - 0.11 * k) + off * (1 + 0.5 * k) + Vector((0, 0.012 * k * k, 0)) for k in range(8)])
    tail = A.cards('horse_tail', tstrips, 0.09, hair)

    def tw(co):
        z = co.z
        t1 = smoothstep(1.0, 1.2, z)
        t3 = smoothstep(0.75, 0.55, z)
        return {'tail1': t1, 'tail2': max(0.0, 1 - t1 - t3), 'tail3': t3}

    A.bind_weights(rig, tail, tw)

    # --- tack ------------------------------------------------------------------------------------
    pieces = []
    # caparison: richly bordered cloth over the back, hanging down the flanks
    cap = A.region_shell(body, 'caparison', lambda co, n: -0.48 < F(co) < 0.42 and co.z > 1.02, lambda co: 0.022,
                         extend=lambda bm: A.hang(bm, 0.24, lambda v: v.co.z < 1.1, 0.03))
    pieces.append((cap, dict(CLOTH), 1024))
    def strap(name, c, n, w, region):
        n = n.normalized()
        return A.region_shell(body, name, lambda co, nn: region(co) and abs((co - c).dot(n)) < w / 2, lambda co: 0.007, smooth=3, gap=0.005)

    face = Vector((0, -0.63, -0.78))
    neck_axis = Vector((0, -0.55, 0.83))
    straps = [strap('noseband', V(0, 1.27, 1.55), face, 0.035, lambda co: F(co) > 1.1),
              strap('headpiece', V(0, 0.99, 1.86), neck_axis, 0.03, lambda co: F(co) > 0.9),
              ]
    # reins: bit rings to the saddle pommel
    reins = []
    for s in (1, -1):
        a, b = V(s * 0.06, 1.33, 1.47), V(s * 0.1, 0.3, 1.42)
        mid = (a + b) / 2 + Vector((0, 0, -0.12))
        pts = [a.lerp(mid, t) if t < 1 else mid for t in (0, 0.5, 1)] + [mid.lerp(b, t) for t in (0.5, 1)]
        reins.append(W.loft('rein', [[p + Vector((0.006 * math.cos(k * 2.1), 0, 0.006 * math.sin(k * 2.1))) for k in range(3)] for p in pts], A.flat_material('rein', (0.12, 0.06, 0.03), 0.6), closed_ends=False))
    select_only(*straps, *reins)
    bpy.ops.object.join()
    tackm = straps[0]
    tackm.name = 'bridle'
    for p in tackm.data.polygons:
        p.use_smooth = True
    tackm.data.materials.clear()
    pieces.append((tackm, dict(fabric='brown_leather', scale=8, base=(0.32, 0.16, 0.08), lum_gain=1.4, rough=0.55, trim=(0.7, 0.5, 0.15), zari=(0.8, 0.6, 0.2)), 512))
    # barding (armoured horses): mail over neck and body, steel chanfron on the face
    bard = A.region_shell(body, 'barding', lambda co, n: F(co) > -0.62 and F(co) < 1.0 and co.z > 0.98 and not (F(co) > 0.85 and co.z > 1.75), lambda co: 0.032,
                          extend=lambda bm: A.hang(bm, 0.14, lambda v: v.co.z < 1.06, 0.02))
    pieces.append((bard, dict(fabric='chainmail', scale=14, base=(0.5, 0.5, 0.52), keep_scan=True, scan_mix=1.0, scan_gain=1.0, trim=(0.45, 0.32, 0.1), zari=(0.8, 0.6, 0.22), rough=0.4, metal=1.0, normal_strength=1.5), 1024))
    chan = A.region_shell(body, 'chanfron', lambda co, n: F(co) > 1.04 and co.z > 1.5 and abs(co.x) < 0.075 and n.z > -0.2, lambda co: 0.014, smooth=4)
    pieces.append((chan, dict(fabric='metal_plate_02', scale=2, base=(0.62, 0.62, 0.64), trim=(0.6, 0.45, 0.15), zari=(0.85, 0.65, 0.25), rough=0.28, metal=1.0, normal_strength=0.3), 256))
    for o, spec, size in pieces:
        trim_attr(o, 0.03 if o.name in ('caparison', 'barding') else 0.012)
        for g, _, _ in pieces:
            g.hide_render = g is not o
        BK.bake_piece(o, spec, size, TEXDIR, ao=0.3)
    for o, _, _ in pieces:
        o.hide_render = False
        A.copy_weights(body, o, rig)

    seat(rig, 'seat', 'hips', V(0, 0.02, 1.42))

    # --- clips ---------------------------------------------------------------------------------------
    an = A.Animator(rig)
    LEGS = [('l', 'f', 0.25), ('r', 'f', 0.75), ('l', 'h', 0.0), ('r', 'h', 0.5)]

    def legs(rot, t, offs, stance, af, ah, flex):
        for (s, kind, _), off in zip(LEGS, offs):
            if kind == 'f':
                sw, lift = A.leg_cycle(t + off, stance, af)
                rot[f'fu_{s}'] = (-sw, 0, 0)
                rot[f'fc_{s}'] = (0.95 * flex * lift, 0, 0)
                rot[f'fp_{s}'] = (0.45 * flex * lift - 0.12 * (1 - lift) * sw / af, 0, 0)
            else:
                sw, lift = A.leg_cycle(t + off, stance, ah)
                rot[f'th_{s}'] = (-0.75 * sw, 0, 0)
                rot[f'ga_{s}'] = (0.35 * flex * lift, 0, 0)
                rot[f'hc_{s}'] = (-0.85 * flex * lift, 0, 0)
                rot[f'hp_{s}'] = (0.4 * flex * lift, 0, 0)

    def walk(t):
        rot, loc = {}, {}
        legs(rot, t, [x[2] for x in LEGS], 0.62, 0.3, 0.26, 1.0)
        w = 4 * math.pi * t
        loc['hips'] = Vector((0, 0, -0.012 * math.cos(w)))
        rot['neck1'] = (0.05 * math.sin(w), 0, 0)
        rot['head'] = (0.04 * math.sin(w + 0.6), 0, 0)
        rot['tail1'] = (0, 0, 0.12 * math.sin(2 * math.pi * t))
        return rot, loc

    def run(t):
        rot, loc = {}, {}
        legs(rot, t, [0.5, 0.6, 0.0, 0.12], 0.38, 0.55, 0.48, 1.35)
        w = 2 * math.pi * t
        rot['root'] = (0.07 * math.sin(w), 0, 0)
        loc['hips'] = Vector((0, 0, 0.05 * math.sin(w + 1.2)))
        rot['neck1'] = (-0.14 * math.sin(w + 0.8), 0, 0)
        rot['head'] = (0.08 * math.sin(w + 1.6), 0, 0)
        rot['tail1'] = (-0.5, 0, 0.1 * math.sin(w))
        return rot, loc

    def idle(t):
        w = 2 * math.pi * t
        rot = {'neck1': (0.05 + 0.05 * math.sin(w), 0, 0.08 * math.sin(w * 0.5)), 'head': (0.05 * math.sin(w * 2 + 1), 0, 0),
               'tail1': (0, 0, 0.3 * math.sin(w * 2)), 'tail2': (0, 0, 0.2 * math.sin(w * 2 - 0.8)),
               'hc_r': (-0.25, 0, 0), 'hp_r': (0.35, 0, 0), 'ga_r': (0.08, 0, 0)}
        return rot, {'hips': Vector((0, 0, 0.004 * math.sin(w * 3)))}

    def attack(t):
        r = smoothstep(0.0, 0.35, t) * (1 - smoothstep(0.55, 0.9, t))
        rot = {'root': (-0.32 * r, 0, 0), 'neck1': (-0.25 * r, 0, 0), 'head': (0.3 * r, 0, 0)}
        for s in 'lr':
            rot[f'fu_{s}'] = (-0.7 * r, 0, 0)
            rot[f'fc_{s}'] = (1.4 * r, 0, 0)
            rot[f'th_{s}'] = (0.3 * r, 0, 0)
        return rot, {'hips': Vector((0, 0, 0.05 * r))}

    def death(t):
        u = smoothstep(0.1, 0.75, t)
        k = smoothstep(0.0, 0.35, t)
        rot = {'root': (0.08 * k * (1 - u), -1.45 * u, 0), 'neck1': (0.3 * u, 0, -0.4 * u), 'head': (0.4 * u, 0, 0)}
        for s in 'lr':
            rot[f'fc_{s}'] = (0.9 * k, 0, 0)
            rot[f'fu_{s}'] = (-0.3 * u, 0, 0)
            rot[f'hc_{s}'] = (-0.6 * k, 0, 0)
        return rot, {'root': Vector((0, 0, -0.25 * k * (1 - u) + 0.2 * u))}

    an.clip('Walk', 1.2, walk)
    an.clip('Run', 0.6, run)
    an.clip('Idle', 4.0, idle)
    an.clip('Attack', 1.0, attack)
    an.clip('Death', 1.6, death)
    export(os.path.join(OUT, 'horse.glb'), rig)


# =============================================================================================
def build_elephant():
    reset()
    body = import_obj(ELE_OBJ, 'elephant_body')

    def folds(co):
        f, z = F(co), co.z
        trunk = 1.0 if f > 1.55 and z < 2.2 else 0.0
        leg = smoothstep(1.2, 0.9, z)
        return max(trunk, leg)

    A.set_attr(body, 'folds', folds)
    A.set_attr(body, 'pink', lambda co: smoothstep(1.4, 1.65, F(co)) * smoothstep(1.5, 2.0, co.z) + smoothstep(0.45, 0.55, abs(co.x)) * smoothstep(0.7, 0.9, F(co)) * smoothstep(1.8, 2.1, co.z))
    A.set_attr(body, 'dust', lambda co: smoothstep(0.6, 0.1, co.z))
    A.set_attr(body, 'nail', lambda co: 1.0 if co.z < 0.1 and co.z > 0.015 and ((F(co) > 0.85 and F(co) > 0.7) or (F(co) > -0.55 and F(co) < -0.4)) and abs((abs(co.x) - 0.36)) < 0.2 and (abs(abs(co.x) - 0.36) % 0.12) < 0.045 else 0.0)
    body['dec'] = 11000 / len(body.data.polygons)
    BK.setup_cycles()
    BK.bake_piece(body, dict(material_fn=A.elephant_material, no_sub=True, rough=0.8), 2048, TEXDIR, ao=0.4)

    B = []
    for s, sx in (('l', 1), ('r', -1)):
        x = sx * 0.36
        B += [(f'fu_{s}', V(x, 0.66, 1.55), V(x, 0.7, 0.8), 'chest'),
              (f'fl_{s}', V(x, 0.7, 0.8), V(x, 0.7, 0.2), f'fu_{s}'),
              (f'ff_{s}', V(x, 0.7, 0.2), V(x, 0.76, 0.0), f'fl_{s}'),
              (f'hu_{s}', V(x, -0.78, 1.6), V(x, -0.74, 0.85), 'hips'),
              (f'hl_{s}', V(x, -0.74, 0.85), V(x, -0.72, 0.2), f'hu_{s}'),
              (f'hf_{s}', V(x, -0.72, 0.2), V(x, -0.68, 0.0), f'hl_{s}'),
              (f'ear_{s}', V(sx * 0.45, 1.15, 2.35), V(sx * 0.62, 0.8, 2.0), 'head')]
    rig = A.make_armature('elephant_rig', [
        ('root', V(0, 0, 0), V(0, 0, 0.4), None),
        ('hips', V(0, -0.75, 1.9), V(0, 0.0, 2.0), 'root'),
        ('chest', V(0, 0.0, 2.0), V(0, 0.7, 2.1), 'hips'),
        ('head', V(0, 0.95, 2.3), V(0, 1.5, 2.3), 'chest'),
        ('trunk1', V(0, 1.6, 2.15), V(0, 1.76, 1.8), 'head'),
        ('trunk2', V(0, 1.76, 1.8), V(0, 1.82, 1.3), 'trunk1'),
        ('trunk3', V(0, 1.82, 1.3), V(0, 1.78, 0.8), 'trunk2'),
        ('trunk4', V(0, 1.78, 0.8), V(0, 1.74, 0.38), 'trunk3'),
        ('trunk5', V(0, 1.74, 0.38), V(0, 1.95, 0.12), 'trunk4'),
        ('tail1', V(0, -1.24, 2.05), V(0, -1.34, 1.45), 'hips'),
        ('tail2', V(0, -1.34, 1.45), V(0, -1.32, 1.0), 'tail1'),
    ] + B)
    A.skin_to(rig, [body])

    ivory = A.flat_material('ivory', (0.85, 0.8, 0.68), 0.35)
    tusks = []
    for s in (1, -1):
        pts = [V(s * 0.17, 1.5, 1.82), V(s * 0.19, 1.66, 1.66), V(s * 0.2, 1.84, 1.6), V(s * 0.19, 2.0, 1.66)]
        secs = []
        for i, p in enumerate(pts):
            r = 0.05 * (1 - i / len(pts)) + 0.006
            secs.append([p + Vector((math.cos(a) * r, 0, math.sin(a) * r)) for a in [k / 8 * math.tau for k in range(8)]])
        tusks.append(W.loft('tusk', secs, ivory))
    select_only(*tusks)
    bpy.ops.object.join()
    tk = tusks[0]
    tk.name = 'tusks'
    A.bind_weights(rig, tk, {'head': 1.0})

    back_z = max(v.co.z for v in body.data.vertices if abs(F(v.co)) < 0.3 and abs(v.co.x) < 0.2)
    pieces = []
    jhool = A.region_shell(body, 'jhool', lambda co, n: -0.95 < F(co) < 0.8 and co.z > 1.95, lambda co: 0.04,
                           extend=lambda bm: A.hang(bm, 0.6, lambda v: v.co.z < 2.05 and abs(v.co.x) > 0.3, 0.05))
    pieces.append((jhool, dict(CLOTH, fabric='velour_velvet' if False else 'crepe_satin', trim=(0.55, 0.38, 0.1)), 1024))
    plate = A.region_shell(body, 'mukhapatta', lambda co, n: F(co) > 1.42 and 1.95 < co.z < 2.85 and abs(co.x) < 0.32 and n.y < -0.2, lambda co: 0.03, smooth=4)
    pieces.append((plate, dict(fabric='metal_plate_02', scale=3, base=(0.9, 0.66, 0.3), trim=(0.5, 0.08, 0.06), zari=(0.95, 0.75, 0.3), rough=0.3, metal=1.0, normal_strength=0.3), 512))
    armor = A.region_shell(body, 'bakhtar', lambda co, n: -0.6 < F(co) < 0.7 and 1.45 < co.z < 2.0 and abs(co.x) > 0.3, lambda co: 0.08, smooth=4)
    pieces.append((armor, dict(fabric='metal_plate_02', scale=2, base=(0.6, 0.6, 0.62), trim=(0.6, 0.45, 0.15), zari=(0.85, 0.65, 0.25), rough=0.3, metal=1.0, normal_strength=0.3), 512))
    anklets = A.region_shell(body, 'anklets', lambda co, n: 0.3 < co.z < 0.4, lambda co: 0.02, smooth=2)
    pieces.append((anklets, dict(fabric='metal_plate_02', scale=6, base=(0.85, 0.62, 0.28), rough=0.35, metal=1.0, normal_strength=0.3), 256))
    for o, spec, size in pieces:
        trim_attr(o, 0.08 if o.name == 'jhool' else 0.025)
        for g, _, _ in pieces:
            g.hide_render = g is not o
        BK.bake_piece(o, spec, size, TEXDIR, ao=0.3)
    for o, _, _ in pieces:
        o.hide_render = False
        A.copy_weights(body, o, rig)

    # howdah: carved wooden seat box with gilded rails, four posts and a cloth canopy
    wood = A.flat_material('howdah_wood', (0.22, 0.09, 0.04), 0.55)
    gold = W.GOLD()
    team = W.mat('team', (0.8, 0.8, 0.8), 0.6)
    hz = back_z + 0.06
    cy = V(0, -0.1, 0)
    parts = []

    def box(name, c, size, m):
        bpy.ops.mesh.primitive_cube_add(size=1, location=c)
        o = bpy.context.active_object
        o.scale = size
        bpy.ops.object.transform_apply(scale=True)
        o.data.materials.append(m)
        o.name = name
        parts.append(o)
        return o

    box('h_floor', Vector((0, cy.y, hz + 0.05)), (1.0, 1.1, 0.1), wood)
    for sx in (1, -1):
        box('h_side', Vector((sx * 0.48, cy.y, hz + 0.28)), (0.05, 1.1, 0.36), wood)
        box('h_rail', Vector((sx * 0.48, cy.y, hz + 0.48)), (0.08, 1.14, 0.05), gold)
    for sy in (1, -1):
        box('h_end', Vector((0, cy.y + sy * 0.53, hz + 0.28)), (1.0, 0.05, 0.36), wood)
        box('h_rail', Vector((0, cy.y + sy * 0.53, hz + 0.48)), (1.04, 0.08, 0.05), gold)
    for sx in (1, -1):
        for sy in (1, -1):
            parts.append(W.lathe('post', [(0.0, hz), (0.03, hz), (0.025, hz + 0.6), (0.04, hz + 0.95), (0.0, hz + 1.0)], gold, 10, 'Z', Vector((sx * 0.46, cy.y + sy * 0.5, 0))))
    can = W.lathe('canopy', [(0.0, hz + 1.42), (0.12, hz + 1.38), (0.4, hz + 1.2), (0.62, hz + 0.98), (0.66, hz + 0.92), (0.6, hz + 0.92)], team, 24, 'Z', Vector((0, cy.y, 0)))
    parts.append(can)
    parts.append(W.lathe('kalash', [(0.0, hz + 1.4), (0.05, hz + 1.42), (0.07, hz + 1.5), (0.03, hz + 1.58), (0.0, hz + 1.7)], gold, 12, 'Z', Vector((0, cy.y, 0))))
    select_only(*parts)
    bpy.ops.object.join()
    how = parts[0]
    how.name = 'howdah'
    A.bind_weights(rig, how, {'hips': 0.5, 'chest': 0.5})

    seat(rig, 'seat_howdah', 'hips', Vector((0, cy.y, hz + 0.1)))
    seat(rig, 'seat_mahout', 'chest', V(0, 0.9, back_z - 0.05))

    an = A.Animator(rig)
    LEGS = [('l', 'f', 0.25), ('r', 'f', 0.75), ('l', 'h', 0.0), ('r', 'h', 0.5)]

    def legs(rot, t, stance, amp, flex):
        for s, kind, off in LEGS:
            sw, lift = A.leg_cycle(t + off, stance, amp)
            if kind == 'f':
                rot[f'fu_{s}'] = (-sw, 0, 0)
                rot[f'fl_{s}'] = (0.7 * flex * lift, 0, 0)
                rot[f'ff_{s}'] = (-0.3 * flex * lift + 0.6 * sw * (1 - lift) * 0.3, 0, 0)
            else:
                rot[f'hu_{s}'] = (-sw, 0, 0)
                rot[f'hl_{s}'] = (0.6 * flex * lift, 0, 0)
                rot[f'hf_{s}'] = (-0.3 * flex * lift, 0, 0)

    def trunk(rot, w, amp=1.0, curl=0.0):
        for i in range(1, 6):
            rot[f'trunk{i}'] = (curl * i * 0.12 + amp * 0.06 * math.sin(w - i * 0.6), 0, amp * 0.08 * math.sin(w * 0.5 - i * 0.5))

    def walk(t):
        rot, loc = {}, {}
        legs(rot, t, 0.65, 0.2, 1.0)
        w = 2 * math.pi * t
        rot['chest'] = (0, 0.02 * math.sin(w * 2), 0)
        rot['head'] = (0.03 * math.sin(w * 2), 0, 0.03 * math.sin(w))
        loc['hips'] = Vector((0, 0, -0.015 * math.cos(w * 2)))
        trunk(rot, w * 2)
        for s, sx in (('l', 1), ('r', -1)):
            rot[f'ear_{s}'] = (0, 0, sx * 0.1 * math.sin(w * 2 + 1))
        rot['tail1'] = (0, 0, 0.2 * math.sin(w))
        return rot, loc

    def run(t):
        rot, loc = {}, {}
        legs(rot, t, 0.5, 0.3, 1.3)
        w = 2 * math.pi * t
        rot['root'] = (0.03 * math.sin(w * 2), 0, 0)
        loc['hips'] = Vector((0, 0, 0.03 * math.sin(w * 2)))
        trunk(rot, w * 2, 1.4, -0.3)
        for s, sx in (('l', 1), ('r', -1)):
            rot[f'ear_{s}'] = (0, 0, sx * (0.35 + 0.1 * math.sin(w * 2)))
        rot['tail1'] = (-0.3, 0, 0.2 * math.sin(w * 2))
        return rot, loc

    def idle(t):
        w = 2 * math.pi * t
        rot = {}
        trunk(rot, w * 2, 1.2, 0.15 + 0.15 * math.sin(w))
        for s, sx in (('l', 1), ('r', -1)):
            rot[f'ear_{s}'] = (0, 0, sx * 0.22 * max(0.0, math.sin(w * 3 + (0 if s == 'l' else 1))))
        rot['head'] = (0.02 * math.sin(w), 0, 0.05 * math.sin(w * 0.5))
        rot['tail1'] = (0, 0, 0.25 * math.sin(w * 2))
        return rot, {'hips': Vector((0, 0, 0.006 * math.sin(w * 2)))}

    def attack(t):
        r = smoothstep(0.0, 0.4, t) * (1 - smoothstep(0.55, 0.85, t))
        slam = smoothstep(0.55, 0.7, t) * (1 - smoothstep(0.75, 1.0, t))
        rot = {'root': (-0.16 * r, 0, 0), 'head': (-0.25 * r + 0.2 * slam, 0, 0)}
        for i in range(1, 6):
            rot[f'trunk{i}'] = (-0.32 * r * (1 if i < 4 else 1.4) + 0.25 * slam, 0, 0)
        for s, sx in (('l', 1), ('r', -1)):
            rot[f'fu_{s}'] = (-0.5 * r, 0, 0)
            rot[f'fl_{s}'] = (0.9 * r, 0, 0)
            rot[f'ear_{s}'] = (0, 0, sx * 0.6 * r)
        return rot, {'root': Vector((0, 0, 0.1 * r))}

    def death(t):
        u = smoothstep(0.1, 0.8, t)
        k = smoothstep(0.0, 0.4, t)
        rot = {'root': (0.05 * k * (1 - u), -1.4 * u, 0), 'head': (0.25 * u, 0, 0)}
        for i in range(1, 6):
            rot[f'trunk{i}'] = (-0.1 * u, 0, 0.2 * u)
        for s in 'lr':
            rot[f'fl_{s}'] = (0.8 * k, 0, 0)
            rot[f'hl_{s}'] = (0.6 * k, 0, 0)
        return rot, {'root': Vector((0, 0, -0.4 * k * (1 - u) + 0.45 * u))}

    an.clip('Walk', 2.0, walk)
    an.clip('Run', 1.1, run)
    an.clip('Idle', 5.0, idle)
    an.clip('Attack', 1.4, attack)
    an.clip('Death', 2.2, death)
    export(os.path.join(OUT, 'elephant.glb'), rig)


if ONLY in (None, 'horse'):
    build_horse()
if ONLY in (None, 'elephant'):
    build_elephant()
