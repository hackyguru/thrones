"""Horse and Indian elephant: rigs, procedural gaits, baked coat / skin, hair, Indian tack.

Shapes come from shape_horse.py / shape_elephant.py (SDF sculptures). Coordinates: metres, Z up,
animals face -Y. Helper V(x, f, z) takes f = forward.
"""
import bpy, bmesh, math, os, random
import numpy as np
from mathutils import Vector, Matrix, Euler, Quaternion, noise
from mathutils.bvhtree import BVHTree
from common import link, select_only, smoothstep


def V(x, f, z):
    return Vector((x, -f, z))


# ---------------------------------------------------------------------------------------------
# armature
# ---------------------------------------------------------------------------------------------
def make_armature(name, bones):
    """bones: [(name, head V, tail V, parent or None)]"""
    arm = bpy.data.armatures.new(name)
    o = bpy.data.objects.new(name, arm)
    link(o)
    select_only(o)
    bpy.ops.object.mode_set(mode='EDIT')
    for n, h, t, p in bones:
        eb = arm.edit_bones.new(n)
        eb.head, eb.tail = h, t
        if p:
            eb.parent = arm.edit_bones[p]
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in o.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return o


def skin_to(rig, objs):
    select_only(*objs)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')


def bind_weights(rig, o, groups):
    """rigid / explicit weights: groups = {bone: weight} for all verts, or callable(co)->dict"""
    o.parent = rig
    m = o.modifiers.new('Armature', 'ARMATURE')
    m.object = rig
    names = set()
    for v in o.data.vertices:
        w = groups(v.co) if callable(groups) else groups
        for b, x in w.items():
            if x <= 0:
                continue
            g = o.vertex_groups.get(b) or o.vertex_groups.new(name=b)
            g.add([v.index], x, 'REPLACE')


def copy_weights(src, dst, rig):
    """transfer skin weights from the body to a tack / hair piece (nearest surface)"""
    dst.parent = rig
    for vg in src.vertex_groups:
        if vg.name not in dst.vertex_groups:
            dst.vertex_groups.new(name=vg.name)
    dt = dst.modifiers.new('DT', 'DATA_TRANSFER')
    dt.object = src
    dt.use_vert_data = True
    dt.data_types_verts = {'VGROUP_WEIGHTS'}
    dt.vert_mapping = 'POLYINTERP_NEAREST'
    dt.layers_vgroup_select_src = 'ALL'
    dt.layers_vgroup_select_dst = 'NAME'
    select_only(dst)
    bpy.ops.object.datalayout_transfer(modifier='DT')
    bpy.ops.object.modifier_apply(modifier='DT')
    m = dst.modifiers.new('Armature', 'ARMATURE')
    m.object = rig


# ---------------------------------------------------------------------------------------------
# animation: rotations about global axes accumulate down each chain
# ---------------------------------------------------------------------------------------------
class Animator:
    def __init__(self, rig, fps=30):
        self.rig = rig
        self.fps = fps
        self.R = {b.name: b.matrix_local.to_3x3().normalized() for b in rig.data.bones}
        rig.animation_data_create()

    def clip(self, name, seconds, fn, step=1):
        """fn(t in [0,1]) -> (rot {bone: (pitch, roll, yaw)}, loc {bone: global Vector})"""
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        self.rig.animation_data.action = act
        n = max(2, round(seconds * self.fps))
        prev = {}
        for i in range(0, n + 1, step):
            t = i / n
            rot, loc = fn(t)
            for pb in self.rig.pose.bones:
                b = pb.name
                R = self.R[b]
                a = rot.get(b, (0, 0, 0))
                G = Euler(a, 'XYZ').to_matrix()
                q = (R.inverted() @ G @ R).to_quaternion()
                if b in prev and prev[b].dot(q) < 0:
                    q.negate()
                prev[b] = q
                pb.rotation_quaternion = q
                pb.keyframe_insert('rotation_quaternion', frame=i)
                if b in loc:
                    pb.location = R.inverted() @ loc[b]
                    pb.keyframe_insert('location', frame=i)
        for pb in self.rig.pose.bones:
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.location = (0, 0, 0)
        self.rig.animation_data.action = None
        return act


def leg_cycle(p, stance, amp):
    """swing angle (forward +) and lift (0..1) for a leg at cycle phase p"""
    p %= 1.0
    if p < stance:
        u = p / stance
        return amp * (1 - 2 * u), 0.0
    u = (p - stance) / (1 - stance)
    return -amp + 2 * amp * (0.5 - 0.5 * math.cos(math.pi * u)), math.sin(math.pi * u)


# ---------------------------------------------------------------------------------------------
# hair cards + strand texture
# ---------------------------------------------------------------------------------------------
def strand_image(name, w=256, h=512, seed=1, lum=0.32):
    rng = np.random.default_rng(seed)
    a = np.zeros((h, w), np.float32)
    col = np.zeros((h, w), np.float32)
    ys = np.arange(h, dtype=np.float32)
    for _ in range(260):
        x0 = rng.uniform(0, w)
        ln = rng.uniform(0.55, 1.0) * h
        wav = rng.uniform(1, 4)
        ph = rng.uniform(0, 6.28)
        width = rng.uniform(0.8, 2.2)
        shade = rng.uniform(0.6, 1.25)
        xs = x0 + np.sin(ys / h * 6.28 * 0.6 + ph) * wav
        for y in range(int(ln)):
            fade = min(1.0, (ln - y) / (0.25 * ln))
            xi = int(xs[y])
            for dx in range(-int(width) - 1, int(width) + 2):
                xx = (xi + dx) % w
                v = max(0.0, 1 - abs(xs[y] - xi - dx) / width) * fade
                if v > a[h - 1 - y, xx]:
                    a[h - 1 - y, xx] = v
                    col[h - 1 - y, xx] = shade
    img = bpy.data.images.new(name, w, h, alpha=True)
    px = np.zeros((h, w, 4), np.float32)
    c = np.clip(lum * col, 0, 1)
    px[..., 0] = c
    px[..., 1] = c * 0.92
    px[..., 2] = c * 0.85
    px[..., 3] = np.clip(a * 1.4, 0, 1)
    img.pixels[:] = px.ravel()
    img.pack()
    return img


def hair_material(name, img):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = img
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(t.outputs['Alpha'], b.inputs['Alpha'])
    b.inputs['Roughness'].default_value = 0.6
    try:
        m.surface_render_method = 'DITHERED'
    except Exception:
        pass
    return m


def cards(name, strips, width, mat):
    """strips: list of point lists (centre line of each card); width tapers to the tip"""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    for k, pts in enumerate(strips):
        n = len(pts)
        rows = []
        for i, p in enumerate(pts):
            d = (pts[min(n - 1, i + 1)] - pts[max(0, i - 1)]).normalized()
            side = d.cross(Vector((0, 0, 1)))
            if side.length < 1e-3:
                side = Vector((1, 0, 0))
            side.normalize()
            wdt = width * (1 - 0.6 * i / (n - 1))
            rows.append((bm.verts.new(p - side * wdt / 2), bm.verts.new(p + side * wdt / 2)))
        u0 = (k % 4) * 0.25
        for i in range(n - 1):
            f = bm.faces.new((rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]))
            for lp, (uu, vv) in zip(f.loops, ((u0, 1 - i / (n - 1)), (u0 + 0.25, 1 - i / (n - 1)), (u0 + 0.25, 1 - (i + 1) / (n - 1)), (u0, 1 - (i + 1) / (n - 1)))):
                lp[uv].uv = (uu, vv)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    link(o)
    o.data.materials.append(mat)
    for p in o.data.polygons:
        p.use_smooth = True
    return o


# ---------------------------------------------------------------------------------------------
# region shells over the animal (caparison, saddle, armour), keep the body's skinning
# ---------------------------------------------------------------------------------------------
def region_shell(body, name, sel, offset, *, smooth=8, gap=0.01, extend=None):
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.normal_update()
    kill = [v for v in bm.verts if not sel(v.co, v.normal)]
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    tree = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
    for v in bm.verts:
        v.co += v.normal * offset(v.co)
    for _ in range(smooth):
        bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        for v in bm.verts:
            loc, nor, _, _ = tree.find_nearest(v.co)
            if loc is None:
                continue
            d = (v.co - loc).dot(nor)
            want = gap + offset(v.co) * 0.6
            if d < want:
                v.co += nor * (want - d)
    if extend:
        extend(bm)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    link(o)
    for vg in body.vertex_groups:
        o.vertex_groups.new(name=vg.name)
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def hang(bm, drop, sel=lambda v: True, bulge=0.0):
    """extrude the lower boundary of a drape straight down by `drop` (a hanging cloth skirt)"""
    edges = [e for e in bm.edges if e.is_boundary and all(sel(v) for v in e.verts)]
    if not edges:
        return []
    ret = bmesh.ops.extrude_edge_only(bm, edges=edges)
    nv = [g for g in ret['geom'] if isinstance(g, bmesh.types.BMVert)]
    for v in nv:
        out = Vector((v.co.x, 0, 0)).normalized() * bulge
        v.co += Vector((0, 0, -drop)) + out
    return nv


# ---------------------------------------------------------------------------------------------
# bake materials
# ---------------------------------------------------------------------------------------------
def _nodes(o, name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    return m, nt, nt.nodes, nt.links


def _finish(m, nt, color, mask, bump_h, bump_strength=0.6):
    N, L = nt.nodes, nt.links
    out = N.new('ShaderNodeOutputMaterial')
    em = N.new('ShaderNodeEmission')
    L.new(color, em.inputs['Color'])
    emm = N.new('ShaderNodeEmission')
    if isinstance(mask, float):
        emm.inputs['Color'].default_value = (mask, mask, mask, 1)
    else:
        L.new(mask, emm.inputs['Color'])
    bsdf = N.new('ShaderNodeBsdfPrincipled')
    if bump_h is not None:
        bp = N.new('ShaderNodeBump')
        bp.inputs['Strength'].default_value = bump_strength
        bp.inputs['Distance'].default_value = 0.004
        L.new(bump_h, bp.inputs['Height'])
        L.new(bp.outputs['Normal'], bsdf.inputs['Normal'])
    m['_emit'], m['_mask'], m['_bsdf'], m['_out'] = em.name, emm.name, bsdf.name, out.name
    return m


def _mixc(N, L, fac, a, b, blend='MIX'):
    n = N.new('ShaderNodeMix')
    n.data_type = 'RGBA'
    n.blend_type = blend
    for sock, val in ((n.inputs['Factor'], fac), (n.inputs[6], a), (n.inputs[7], b)):
        if isinstance(val, (float, int)):
            sock.default_value = val
        elif isinstance(val, tuple):
            sock.default_value = val + (1,) if len(val) == 3 else val
        else:
            L.new(val, sock)
    return n.outputs[2]


def _math(N, L, op, a, b=None, clamp=True):
    n = N.new('ShaderNodeMath')
    n.operation = op
    n.use_clamp = clamp
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            L.new(v, n.inputs[i])
    return n.outputs[0]


def _attr(N, name):
    a = N.new('ShaderNodeAttribute')
    a.attribute_name = name
    return a.outputs['Fac']


def coat_material(o):
    """horse coat: dyed in-game (coat colour); darker points, muzzle and mane line; hooves/eyes fixed"""
    m, nt, N, L = _nodes(o, 'coat_bake')
    tc = N.new('ShaderNodeTexCoord')
    hair = N.new('ShaderNodeTexNoise')  # fine hair grain, stretched along the body
    hair.inputs['Scale'].default_value = 140
    hair.inputs['Detail'].default_value = 4
    mp = N.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1, 0.25, 1)
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    L.new(mp.outputs['Vector'], hair.inputs['Vector'])
    mott = N.new('ShaderNodeTexNoise')
    mott.inputs['Scale'].default_value = 6
    L.new(tc.outputs['Object'], mott.inputs['Vector'])
    base = _math(N, L, 'ADD', _math(N, L, 'MULTIPLY', hair.outputs['Fac'], 0.25), 0.68)
    base = _math(N, L, 'ADD', base, _math(N, L, 'MULTIPLY', mott.outputs['Fac'], 0.15))
    shade = _math(N, L, 'MULTIPLY', base, _attr(N, 'shade'), clamp=False)  # points / muzzle darkening
    c = N.new('ShaderNodeCombineColor')
    for k in ('Red', 'Green', 'Blue'):
        L.new(shade, c.inputs[k])
    fixed = _attr(N, 'fixed')  # 1 = hoof / eye
    color = _mixc(N, L, fixed, c.outputs['Color'], (0.07, 0.065, 0.06))
    mask = _math(N, L, 'SUBTRACT', 1.0, fixed)
    return _finish(m, nt, color, mask, hair.outputs['Fac'], 0.25)


def elephant_material(o):
    """grey-brown wrinkled skin with pink depigmentation on ears / face / trunk, dusty legs, toenails"""
    m, nt, N, L = _nodes(o, 'eskin_bake')
    tc = N.new('ShaderNodeTexCoord')
    vor = N.new('ShaderNodeTexVoronoi')
    vor.feature = 'DISTANCE_TO_EDGE'
    vor.inputs['Scale'].default_value = 26
    L.new(tc.outputs['Object'], vor.inputs['Vector'])
    crack = _math(N, L, 'POWER', _math(N, L, 'MULTIPLY', vor.outputs['Distance'], 9), 0.5)
    rings = N.new('ShaderNodeTexWave')  # horizontal folds on trunk and legs
    rings.wave_type = 'BANDS'
    rings.bands_direction = 'Z'
    rings.inputs['Scale'].default_value = 18
    rings.inputs['Distortion'].default_value = 6
    L.new(tc.outputs['Object'], rings.inputs['Vector'])
    folds = _math(N, L, 'MULTIPLY', rings.outputs['Fac'], _attr(N, 'folds'))
    height = _math(N, L, 'ADD', _math(N, L, 'MULTIPLY', crack, 0.7), _math(N, L, 'MULTIPLY', folds, 0.6))
    mott = N.new('ShaderNodeTexNoise')
    mott.inputs['Scale'].default_value = 5
    L.new(tc.outputs['Object'], mott.inputs['Vector'])
    g = _math(N, L, 'ADD', _math(N, L, 'MULTIPLY', mott.outputs['Fac'], 0.12), 0.2)
    gc = N.new('ShaderNodeCombineColor')
    L.new(g, gc.inputs['Red'])
    L.new(_math(N, L, 'MULTIPLY', g, 0.92), gc.inputs['Green'])
    L.new(_math(N, L, 'MULTIPLY', g, 0.86), gc.inputs['Blue'])
    color = _mixc(N, L, _math(N, L, 'MULTIPLY', _math(N, L, 'SUBTRACT', 1.0, crack), 0.25), gc.outputs['Color'], (0.12, 0.11, 0.1))
    spots = N.new('ShaderNodeTexNoise')
    spots.inputs['Scale'].default_value = 22
    L.new(tc.outputs['Object'], spots.inputs['Vector'])
    sp = _math(N, L, 'MULTIPLY', _math(N, L, 'GREATER_THAN', spots.outputs['Fac'], 0.6), _attr(N, 'pink'))
    color = _mixc(N, L, _math(N, L, 'MULTIPLY', sp, 0.45), color, (0.46, 0.34, 0.3))
    color = _mixc(N, L, _math(N, L, 'MULTIPLY', _attr(N, 'dust'), 0.55), color, (0.32, 0.2, 0.13), 'MIX')
    color = _mixc(N, L, _attr(N, 'nail'), color, (0.62, 0.58, 0.5))
    return _finish(m, nt, color, 0.0, height, 0.9)


def flat_material(name, color, rough=0.6, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = tuple(color) + (1,)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


def set_attr(o, name, fn):
    a = o.data.attributes.get(name) or o.data.attributes.new(name, 'FLOAT', 'POINT')
    a.data.foreach_set('value', [float(fn(v.co)) for v in o.data.vertices])
