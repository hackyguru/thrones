"""Garment geometry for Indian soldiers / villagers, generated around the MPFB body and skinned to its rig.

All in rest pose: metres, Z up, character faces -Y.
"""
import bpy, bmesh, math, random
from mathutils import Vector, Matrix, noise
from mathutils.bvhtree import BVHTree
from common import link, select_only, smoothstep

PARTS = {
    'head': ('Head', 'neck_01'),
    'torso': ('pelvis', 'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r'),
    'upperarms': ('upperarm_l', 'upperarm_r'),
    'forearms': ('lowerarm_l', 'lowerarm_r'),
    'hands': ('hand_l', 'hand_r'),
    'thighs': ('thigh_l', 'thigh_r'),
    'shins': ('calf_l', 'calf_r'),
    'feet': ('foot_l', 'foot_r', 'ball_l', 'ball_r'),
}


class Ctx:
    """landmarks + spatial queries for one body"""

    def __init__(self, body, rig):
        self.body, self.rig = body, rig
        dg = bpy.context.evaluated_depsgraph_get()
        self.bvh = BVHTree.FromObject(body, dg)
        B = lambda n: rig.data.bones[n].head_local.copy()
        self.b = {n: B(n) for n in rig.data.bones.keys()}
        self.waist = self.b['spine_01'].z + 0.02
        self.hip = self.b['pelvis'].z
        self.knee = self.b['calf_l'].z
        self.ankle = self.b['foot_l'].z
        self.neck = self.b['neck_01'].z
        self.shoulder = self.b['upperarm_l'].z
        self.head = self.b['Head']
        self.gidx = {vg.name: vg.index for vg in body.vertex_groups}
        eyes = bpy.data.objects.get('eyes')
        self.eye_z = (sum((v.co.z for v in eyes.data.vertices)) / len(eyes.data.vertices)) if eyes else self.b['Head'].z + 0.09
        BONES.clear()
        BONES.update(rig.data.bones.keys())

    def ring(self, z, n=64, centre=None, max_r=0.5):
        """horizontal cross-section radius per angle (raycast inward); angle 0 = front (-Y)"""
        c = centre or Vector((0, 0, z))
        out = []
        for i in range(n):
            a = i / n * math.tau
            d = Vector((math.sin(a), -math.cos(a), 0))
            hit = self.bvh.ray_cast(c + d * max_r, -d, max_r)
            out.append((max_r - hit[3]) if hit[0] else 0.05)
        return out

    def nearest(self, co):
        return self.bvh.find_nearest(co)


BONES = set()


def weights_of(v, deform, inv):
    return {inv[k]: w for k, w in v[deform].items() if k in inv and inv[k] in BONES}


def dominant(ws):
    best, bw = None, 0
    for n, w in ws.items():
        if w > bw:
            best, bw = n, w
    return best


def part_of_bone(b):
    for p, bones in PARTS.items():
        if b in bones:
            return p
    if b and ('thumb' in b or 'index' in b or 'middle' in b or 'ring' in b or 'pinky' in b):
        return 'hands'
    return 'torso'


def new_skinned(name, me, rig):
    o = bpy.data.objects.new(name, me)
    link(o)
    o.parent = rig
    m = o.modifiers.new('Armature', 'ARMATURE')
    m.object = rig
    return o


def split_body(ctx):
    """split the body into per-region objects (same skin material, preserved normals) so covered
    parts can be hidden per outfit"""
    body, rig = ctx.body, ctx.rig
    me = body.data
    # freeze shading normals so the split seams stay invisible
    me.calc_loop_triangles()
    normals = [Vector(n.vector) for n in me.corner_normals] if hasattr(me, 'corner_normals') else None
    inv = {vg.index: vg.name for vg in body.vertex_groups}
    if normals:
        me.normals_split_custom_set(normals)
    bm = bmesh.new()
    bm.from_mesh(me)
    deform = bm.verts.layers.deform.active
    vpart = {}
    for v in bm.verts:
        vpart[v.index] = part_of_bone(dominant(weights_of(v, deform, inv)))
    fpart = []
    for f in bm.faces:
        votes = {}
        for v in f.verts:
            votes[vpart[v.index]] = votes.get(vpart[v.index], 0) + 1
        fpart.append(max(votes, key=votes.get))
    bm.free()
    objs = {}
    for p in PARTS:
        o = body.copy()
        o.data = me.copy()
        o.name = 'body_' + p
        link(o)
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.faces.ensure_lookup_table()
        kill = [f for i, f in enumerate(bm.faces) if fpart[i] != p]
        bmesh.ops.delete(bm, geom=kill, context='FACES')
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
        bm.to_mesh(o.data)
        bm.free()
        objs[p] = o
    bpy.data.objects.remove(body)
    return objs


# ---------------------------------------------------------------------------------------------
# shells: garments derived from the body surface, draped over its hollows, keeping its skinning
# ---------------------------------------------------------------------------------------------
def shell(ctx, src_parts, name, sel, offset, *, smooth=12, gap=0.006, folds=None, solid=0.004):
    """src_parts: list of body part objects to copy surface from. sel(co, ws) -> bool"""
    rig = ctx.rig
    bm = bmesh.new()
    for o in src_parts:
        tmp = bmesh.new()
        tmp.from_mesh(o.data)
        me = bpy.data.meshes.new('tmp')
        tmp.to_mesh(me)
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        tmp.free()
    deform = bm.verts.layers.deform.active
    inv = {vg.index: vg.name for vg in src_parts[0].vertex_groups}
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    kill = [v for v in bm.verts if not sel(v.co, weights_of(v, deform, inv))]
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    # drop tiny islands / loose verts
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * offset(v.co)
    for _ in range(smooth):
        bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.6, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        for v in bm.verts:
            loc, nor, _, dist = ctx.nearest(v.co)
            if loc is None:
                continue
            d = (v.co - loc).dot(nor)
            want = gap + offset(v.co) * 0.5
            if d < want:
                v.co += nor * (want - d)
    bm.normal_update()
    if folds:
        for v in bm.verts:
            v.co += v.normal * folds(v.co)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = new_skinned(name, me, rig)
    for vg in src_parts[0].vertex_groups:
        o.vertex_groups.new(name=vg.name)
    # vertex groups were carried in the deform layer with original indices; names must match
    for p in o.data.polygons:
        p.use_smooth = True
    if solid:
        s = o.modifiers.new('Solidify', 'SOLIDIFY')
        s.thickness = solid
        s.offset = 1
        s.use_rim = True
        s.use_quality_normals = True
        o.modifiers.move(len(o.modifiers) - 1, 0)
    return o


# ---------------------------------------------------------------------------------------------
# parametric pieces
# ---------------------------------------------------------------------------------------------
def tube(name, rig, rows, seg, point, weights, closed=True, uv=None):
    """generic lofted surface. point(r, s) -> Vector; weights(r, s, co) -> {bone: w}"""
    bm = bmesh.new()
    deform = bm.verts.layers.deform.verify()
    names = []
    grid = []
    for r in range(rows + 1):
        row = []
        for s in range(seg + (0 if closed else 1)):
            co = point(r, s)
            v = bm.verts.new(co)
            for bn, w in weights(r, s, co).items():
                if w <= 0:
                    continue
                if bn not in names:
                    names.append(bn)
                v[deform][names.index(bn)] = w
            row.append(v)
        grid.append(row)
    uvl = bm.loops.layers.uv.new('UVMap')
    n = len(grid[0])
    for r in range(rows):
        for s in range(seg if closed else n - 1):
            s2 = (s + 1) % n
            f = bm.faces.new((grid[r][s], grid[r][s2], grid[r + 1][s2], grid[r + 1][s]))
            for lp, (rr, ss) in zip(f.loops, ((r, s), (r, s + 1), (r + 1, s + 1), (r + 1, s))):
                lp[uvl].uv = uv(rr, ss) if uv else (ss / seg, rr / rows)
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    o = new_skinned(name, me, rig)
    for bn in names:
        o.vertex_groups.new(name=bn)
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def leg_weights(ctx, co, t):
    """skirt cloth: pelvis near the waist, increasingly following the near thigh / calf toward the hem"""
    lx = ctx.b['thigh_l'].x
    side = smoothstep(-0.06, 0.06, co.x * (1 if lx > 0 else -1))  # 1 = left leg side
    follow = smoothstep(0.05, 0.9, t) * 0.6
    w = {'pelvis': 1 - follow}
    knee_frac = smoothstep(ctx.knee + 0.08, ctx.knee - 0.12, co.z) * 0.6
    for leg, f in (('l', side), ('r', 1 - side)):
        w['thigh_' + leg] = follow * f * (1 - knee_frac)
        w['calf_' + leg] = follow * f * knee_frac
    return w


def skirt(ctx, name, top, hem, *, flare=1.45, pleats=13, depth=0.042, min_r=None, seg=128, rows=26, open_front=False):
    """gathered, pleated skirt of a jama / kurta, from `top` (z) to `hem` (z)"""
    ring_top = ctx.ring(top, seg)
    rings = [ctx.ring(ctx.hip + dz, seg) for dz in (0.02, -0.04, -0.1, -0.16, -0.22)]
    ring_hip = [max(r[i] for r in rings) for i in range(seg)]
    rnd = random.Random(7)
    ph = [rnd.random() * math.tau for _ in range(4)]

    def point(r, s):
        t = r / rows
        z = top + (hem - top) * t
        a = s / seg * math.tau
        base_top = ring_top[s] + 0.03
        if min_r:
            base_top = max(base_top, min_r[s])
        base_hip = max(ring_hip[s] + 0.03, base_top)
        # ease over the hip, then A-line flare to the hem
        rr = base_top + (base_hip - base_top) * smoothstep(0, 0.22, t)
        rr *= 1 + (flare - 1) * smoothstep(0.15, 1.0, t) ** 1.2
        # fine gathers at the waist opening into a dozen meandering deep folds toward the hem
        g = 0.0035 * (1 - t) ** 2 * math.sin(a * 44)
        mean = 0.55 * noise.noise(Vector((math.cos(a) * 0.8, math.sin(a) * 0.8, t * 1.6 + ph[0])))
        x = a * pleats + mean * 4
        crest = abs(math.sin(x / 2)) ** 0.75 * 2 - 1  # rounded crests, sharp creases
        x2 = a * (pleats // 2 + 1) + ph[1] + mean * 2
        amp = depth * smoothstep(0.0, 1.0, t) ** 0.9
        rr += g + amp * (0.75 * (crest + 1) * 0.5 + 0.25 * (math.sin(x2) + 1) * 0.5) + 0.012 * t * t * math.sin(a * 2 + ph[2])
        # hem sways back slightly
        y = 0.02 * t * t
        return Vector((math.sin(a) * rr, -math.cos(a) * rr * 0.9 + y, z))

    def w(r, s, co):
        return leg_weights(ctx, co, r / rows)

    o = tube(name, ctx.rig, rows, seg, point, w, closed=True, uv=lambda r, s: (s / seg * 4, 1 - r / rows))
    so = o.modifiers.new('Solidify', 'SOLIDIFY')
    so.thickness = 0.004
    so.offset = 1
    return o


def band(ctx, name, z, height, *, layers=3, thick=0.008, base=0.03, seg=96, bulge=0.0025, src_ring_z=None, bone='pelvis', twist=0.0):
    """wrapped cloth band around the body at height z (kamarband / belt)"""
    ring = ctx.ring(src_ring_z if src_ring_z is not None else z, seg)
    rows = 6 * layers
    rnd = random.Random(3)

    def point(r, s):
        L = min(layers - 1, r // 6)
        t = (r % 6) / 5
        a = s / seg * math.tau
        zz = z - height / 2 + (L + t) * height / layers + math.sin(a + L) * twist
        rr = ring[s] + base + thick * (0.6 + 0.35 * L) + bulge * math.sin(t * math.pi) + 0.002 * math.sin(a * 11 + L * 2)
        return Vector((math.sin(a) * rr, -math.cos(a) * rr, zz))

    def w(r, s, co):
        return {bone: 0.7, 'spine_01': 0.3} if bone == 'pelvis' else {bone: 1.0}

    return tube(name, ctx.rig, rows - 1, seg, point, w, closed=True, uv=lambda r, s: (s / seg * 6, r / rows))


def sash_tails(ctx, name, z, length=0.36, width=0.075, x=0.05):
    """the two ends of the kamarband hanging at the front"""
    front = ctx.ring(z, 64)[0]
    objs = []
    rows, seg = 14, 6

    def make(xx, ang, ln):
        def point(r, s):
            t = r / rows
            u = s / seg - 0.5
            y = -(front + 0.055) - 0.02 * t - 0.012 * math.sin(u * math.pi) ** 2
            return Vector((xx + u * width + t * ang, y + 0.004 * math.sin(t * 9 + u * 3), z - t * ln))

        def w(r, s, co):
            t = r / rows
            return {'pelvis': 1 - 0.5 * t, 'thigh_l' if xx * ctx.b['thigh_l'].x > 0 else 'thigh_r': 0.5 * t}

        return tube(name, ctx.rig, rows, seg, point, w, closed=False, uv=lambda r, s: (s / seg, 1 - r / rows))

    a = make(x, 0.02, length)
    b = make(x + 0.035, 0.05, length * 0.82)
    select_only(a, b)
    bpy.ops.object.join()
    so = a.modifiers.new('Solidify', 'SOLIDIFY')
    so.thickness = 0.003
    return a


def head_frame(ctx, head_obj):
    """ellipsoid fitted to the cranium (above the eyes); returns centre, radii, eye height"""
    ez = ctx.eye_z
    vs = [head_obj.matrix_world @ v.co for v in head_obj.data.vertices if v.co.z > ez + 0.01]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    c = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2 + 0.008, ez + 0.03))
    rad = Vector(((hi.x - lo.x) / 2, (hi.y - lo.y) / 2, hi.z - c.z))
    return c, rad


def _on_ellipsoid(c, rad, origin, d):
    """distance along d from origin (inside) to the ellipsoid surface"""
    o = Vector(((origin.x - c.x) / rad.x, (origin.y - c.y) / rad.y, (origin.z - c.z) / rad.z))
    dd = Vector((d.x / rad.x, d.y / rad.y, d.z / rad.z))
    A = dd.dot(dd)
    B = 2 * o.dot(dd)
    C = o.dot(o) - 1
    disc = max(0.0, B * B - 4 * A * C)
    return (-B + math.sqrt(disc)) / (2 * A)


def pagri(ctx, name, head_obj, *, turns=7, width=0.055, crown=True, scale=1.0, seed=5):
    """turban wound ribbon by ribbon around an ellipsoid fitted to the skull; wraps cross at the front"""
    c, rad = head_frame(ctx, head_obj)
    rnd = random.Random(seed)
    seg, across = 72, 7
    objs = []
    base = Vector((rad.x + 0.016, rad.y + 0.018, rad.z + 0.012)) * scale
    # first wrap: lower edge just above the brow at the front
    n0 = Matrix.Rotation(-0.32, 3, 'X') @ Vector((0, 0, 1))
    # front point of the plane through c + n0*h: z = c.z + (h + n0.y * base.y) / n0.z  (y = -base.y)
    h0 = (ctx.eye_z + 0.03 + width / 2 - c.z) * n0.z - n0.y * base.y
    for k in range(turns):
        u = k / max(1, turns - 1)
        # plane through the head: alternate tilts so wraps cross over the forehead
        tilt = (-1) ** k * (0.22 + 0.1 * rnd.random()) * (1 - 0.5 * u)
        roll = (rnd.random() - 0.5) * 0.12
        nrm = Matrix.Rotation(roll, 3, 'Y') @ Matrix.Rotation(tilt - 0.32, 3, 'X') @ Vector((0, 0, 1))
        h = h0 + 0.075 * u  # band height relative to the skull centre
        grow = 1 + 0.035 * k / turns  # later wraps sit on top of earlier ones
        R = Vector((base.x * grow * (1 + 0.04 * u), base.y * grow * (1 + 0.06 * u), base.z * grow))
        tu = nrm.orthogonal().normalized()
        tv = nrm.cross(tu).normalized()

        def point(r, s, nrm=nrm, tu=tu, tv=tv, R=R, h=h, k=k):
            t = r / across
            a = s / seg * math.tau
            off = (t - 0.5) * width
            o = c + nrm * (h + off)
            d = (tu * math.cos(a) + tv * math.sin(a)).normalized()
            dist = _on_ellipsoid(c, R, o, d)
            p = o + d * dist
            n = Vector(((p.x - c.x) / R.x ** 2, (p.y - c.y) / R.y ** 2, (p.z - c.z) / R.z ** 2)).normalized()
            puff = 0.006 * math.sin(t * math.pi) ** 0.5 + 0.002 * math.sin(a * 9 + k * 2.1) * math.sin(t * math.pi) + 0.0015 * math.sin(a * 23 + t * 6 + k)
            return p + n * puff

        objs.append(tube(f'{name}_{k}', ctx.rig, across, seg, point, lambda *_: {'Head': 1.0}, closed=True,
                         uv=lambda r, s, k=k: (s / seg * 6, (r / across + k) * 0.5)))
    if crown:
        cap_r = Vector((base.x * 0.98, base.y * 0.98, base.z * 1.05))

        def cpoint(i, s):
            t = i / 10
            a = s / seg * math.tau
            el = 0.15 + t * (math.pi / 2 - 0.15)
            d = Vector((math.cos(el) * math.sin(a), -math.cos(el) * math.cos(a), math.sin(el)))
            dist = _on_ellipsoid(c, cap_r, c, d)
            return c + d * dist + Vector((0, 0, 0.012))

        objs.append(tube(name + '_cap', ctx.rig, 10, seg, cpoint, lambda *_: {'Head': 1.0}, closed=True, uv=lambda r, s: (s / seg * 4, r / 10)))
    select_only(*objs)
    bpy.ops.object.join()
    o = objs[0]
    o.name = name
    # seat it: lower edge of the front wraps just above the eyebrows
    front = [v.co.z for v in o.data.vertices if v.co.y < c.y - rad.y * 0.75]
    lift = (ctx.eye_z + 0.024) - min(front)
    for v in o.data.vertices:
        v.co.z += lift
    so = o.modifiers.new('Solidify', 'SOLIDIFY')
    so.thickness = 0.002
    return o


def dome(ctx, name, c, r, h, seg=48, rows=10, bone='Head', squash=1.08):
    def point(i, s):
        t = i / rows
        a = s / seg * math.tau
        rr = r * math.cos(t * math.pi / 2)
        return Vector((c.x + math.sin(a) * rr, c.y - math.cos(a) * rr * squash, c.z + h * math.sin(t * math.pi / 2)))

    return tube(name, ctx.rig, rows, seg, point, lambda *_: {bone: 1.0}, closed=True)
