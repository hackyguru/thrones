"""The garment catalogue: each recipe builds one skinned piece around the T-posed body, sets its
bake attributes (trim / dirt / stripe) and returns (object, bake spec, texture size)."""
import bpy, bmesh, math, random
from mathutils import Vector, Matrix, noise
from common import smoothstep, select_only
import garments as G
import bake as BK

DYE_CLOTH = dict(fabric='cotton_jersey', scale=3, rough=0.9)


def trim_from(o, width, keep=lambda co: True, extra=None):
    d = BK.edge_distance(o, keep, max_d=width * 2)
    vals = [max(0.0, 1 - di / width) for di in d]
    if extra:
        vals = [max(v, extra(o.data.vertices[i].co)) for i, v in enumerate(vals)]
    BK.set_attr(o, 'trim', vals)


def no_trim(o):
    BK.set_attr(o, 'trim', [0.0] * len(o.data.vertices))


def dirt_from(o, lo, hi):
    BK.set_attr(o, 'dirt', [smoothstep(hi, lo, v.co.z) for v in o.data.vertices])


def no_dirt(o):
    BK.set_attr(o, 'dirt', [0.0] * len(o.data.vertices))


def decimate(o, ratio):
    """deferred: the dense mesh is kept as the bake source, the low mesh is decimated at bake time"""
    o['dec'] = ratio


def decimate_now(o, ratio):
    if ratio >= 1:
        return
    m = o.modifiers.new('Decimate', 'DECIMATE')
    m.ratio = ratio
    m.use_collapse_triangulate = False
    select_only(o)
    # decimate must run before solidify
    while o.modifiers.find('Decimate') > 0:
        bpy.ops.object.modifier_move_up(modifier='Decimate')
    bpy.ops.object.modifier_apply(modifier='Decimate')


def drop_solidify(o):
    for m in list(o.modifiers):
        if m.type == 'SOLIDIFY':
            o.modifiers.remove(m)


class Wardrobe:
    def __init__(self, ctx, bp):
        self.ctx, self.bp = ctx, bp
        c = ctx
        self.hands = (c.b['hand_l'], c.b['hand_r'])

    # ------------------------------------------------------------------ tops
    def jama_top(self, name='jama_top', placket=True):
        c, bp = self.ctx, self.bp

        def sel(co, ws):
            if co.z < c.waist - 0.1 or co.z > c.neck + 0.012:
                return False
            return all((co - h).length > 0.035 for h in self.hands)

        def off(co):
            return 0.012 + 0.012 * smoothstep(c.waist + 0.25, c.waist, co.z)

        def folds(co):
            f = 0.007 * math.sin(co.z * 140 + noise.noise(co * 8) * 4) * smoothstep(c.waist + 0.16, c.waist, co.z)
            for h in self.hands:
                d = (co - h).length
                f += 0.005 * math.sin(d * 220 + noise.noise(co * 12) * 3) * smoothstep(0.2, 0.05, d)
            # creases at the inner elbow and armpit
            for s in ('l', 'r'):
                e = c.b['lowerarm_' + s]
                d = (co - e).length
                f += 0.004 * math.sin(co.x * 300 + noise.noise(co * 20) * 5) * smoothstep(0.09, 0.0, d)
            return f + 0.006 * noise.noise(co * 5) + 0.003 * noise.noise(co * 14)

        o = G.shell(c, [bp['torso'], bp['upperarms'], bp['forearms'], bp['head']], name, sel, off, folds=folds, solid=0)
        decimate(o, 0.55)
        pts = [Vector((0.03, 0, c.neck - 0.035)), Vector((-0.04, 0, c.shoulder - 0.06)), Vector((-0.1, 0, c.shoulder - 0.17)), Vector((-0.16, 0, c.waist + 0.1))]

        def plk(co):
            if not placket or co.y > -0.05:
                return 0.0
            p = Vector((co.x, 0, co.z))
            d = min(BK.seg_dist(p, pts[i], pts[i + 1]) for i in range(3))
            return max(0.0, 1 - d / 0.022)

        trim_from(o, 0.03, lambda co: co.z > c.waist)
        dirt_from(o, c.waist - 0.2, c.waist + 0.2)
        return o, dict(DYE_CLOTH, trim=(0.32, 0.05, 0.05), dirt=0.55, trim_fn=plk), 2048

    def zirah(self):
        """mail shirt worn over the jama"""
        c, bp = self.ctx, self.bp

        def sel(co, ws):
            if co.z < c.hip - 0.16 or co.z > c.neck - 0.01:
                return False
            # sleeves to mid upper arm
            return abs(co.x) < abs(c.b['upperarm_l'].x) + 0.14

        def off(co):
            return 0.03 + 0.014 * smoothstep(c.waist + 0.2, c.hip - 0.1, co.z)

        def folds(co):
            return 0.004 * noise.noise(co * 9) + 0.003 * math.sin(co.z * 120) * smoothstep(c.waist + 0.1, c.hip, co.z)

        o = G.shell(c, [bp['torso'], bp['upperarms'], bp['thighs'], bp['head']], 'zirah', sel, off, folds=folds, solid=0, smooth=16)
        decimate(o, 0.5)
        trim_from(o, 0.025)
        no_dirt(o)
        return o, dict(fabric='chainmail', scale=14, base=(0.5, 0.5, 0.52), keep_scan=True, scan_mix=1.0, scan_gain=1.0,
                       trim=(0.45, 0.32, 0.1), zari=(0.8, 0.6, 0.22), rough=0.4, metal=1.0, normal_strength=1.5), 1024

    def chahar_aina(self):
        """'four mirrors': polished plates on chest, back and sides, gold-rimmed"""
        c, bp = self.ctx, self.bp
        lx = abs(c.b['upperarm_l'].x)

        def sel(co, ws):
            if co.z < c.waist + 0.04 or co.z > c.shoulder - 0.05:
                return False
            front = co.y < -0.06 and abs(co.x) < 0.11
            back = co.y > 0.05 and abs(co.x) < 0.12 and co.z > c.waist + 0.08
            side = abs(co.x) > 0.13 and abs(co.x) < lx and co.z < c.shoulder - 0.12 and abs(co.y) < 0.07
            return front or back or side

        o = G.shell(c, [bp['torso']], 'chahar_aina', sel, lambda co: 0.05, smooth=6, solid=0.006)
        decimate(o, 0.6)
        trim_from(o, 0.018)
        no_dirt(o)
        return o, dict(fabric='metal_plate_02', scale=2, base=(0.62, 0.62, 0.64), trim=(0.6, 0.45, 0.15), zari=(0.85, 0.65, 0.25),
                       rough=0.28, metal=1.0, normal_strength=0.3), 512

    def angavastra(self):
        """villager's shawl over the left shoulder, across the chest"""
        c, bp = self.ctx, self.bp
        a = Vector((abs(c.b['clavicle_l'].x) + 0.06 if c.b['clavicle_l'].x > 0 else -0.12, 0, c.shoulder + 0.04))
        b = Vector((-a.x * 1.4, 0, c.waist - 0.02))

        def sel(co, ws):
            if co.z < c.waist - 0.06 or co.z > c.neck:
                return False
            p = Vector((co.x, 0, co.z))
            return BK.seg_dist(p, a, b) < 0.075

        o = G.shell(c, [bp['torso']], 'angavastra', sel, lambda co: 0.012, smooth=10, solid=0,
                    folds=lambda co: 0.005 * math.sin((co.x + co.z) * 90 + noise.noise(co * 10) * 3))
        decimate(o, 0.6)
        no_trim(o)
        no_dirt(o)

        def edge(co):
            d = BK.seg_dist(Vector((co.x, 0, co.z)), a, b)
            return max(0.0, 1 - (0.072 - d) / 0.016) if d < 0.072 else 0.0

        return o, dict(DYE_CLOTH, fabric='rough_linen', trim=(0.55, 0.42, 0.18), trim_fn=edge), 512

    # ------------------------------------------------------------------ lower body
    def skirt(self, name, hem, **kw):
        c = self.ctx
        o = G.skirt(c, name, c.waist - 0.02, hem, **kw)
        drop_solidify(o)
        trim_from(o, 0.07, lambda co: co.z < c.knee + 0.1)
        dirt_from(o, c.ankle + 0.15, c.knee + 0.1)
        return o, dict(DYE_CLOTH, trim=(0.32, 0.05, 0.05), dirt=1.0), 1024

    def jama_skirt(self):
        return self.skirt('jama_skirt', self.ctx.ankle + 0.2, seg=96, rows=18, flare=1.28)

    def kurta_skirt(self):
        return self.skirt('kurta_skirt', self.ctx.knee + 0.04, seg=80, rows=12, flare=1.18, pleats=9, depth=0.018)

    def pajama(self):
        c, bp = self.ctx, self.bp
        o = G.shell(c, [bp['torso'], bp['thighs'], bp['shins']], 'pajama',
                    lambda co, ws: c.hip - 0.02 > co.z > c.ankle - 0.01,
                    lambda co: 0.008 + 0.01 * smoothstep(c.knee + 0.05, c.ankle, co.z),
                    folds=lambda co: 0.009 * math.sin(co.z * 160 + noise.noise(co * 10) * 3) * smoothstep(c.knee - 0.05, c.ankle + 0.05, co.z) + 0.004 * noise.noise(co * 7),
                    solid=0)
        decimate(o, 0.5)
        trim_from(o, 0.02, lambda co: co.z < c.knee)
        dirt_from(o, c.ankle, c.knee)
        return o, dict(DYE_CLOTH, fabric='rough_linen', trim=(0.25, 0.08, 0.06), dirt=1.1), 512

    def dhoti(self):
        """draped lower cloth: baggy to mid-shin, pleats tucked at the front"""
        c, bp = self.ctx, self.bp
        mid = c.ankle + (c.knee - c.ankle) * 0.35

        def off(co):
            return 0.02 + 0.035 * smoothstep(c.hip, c.knee, co.z) * smoothstep(mid - 0.05, c.knee, co.z) + 0.012

        def folds(co):
            return 0.008 * math.sin((co.z * 1.0 + abs(co.x) * 1.3) * 70 + noise.noise(co * 7) * 4) * smoothstep(c.waist, c.hip - 0.1, co.z)

        o = G.shell(c, [bp['torso'], bp['thighs'], bp['shins']], 'dhoti', lambda co, ws: c.waist + 0.01 > co.z > mid, off,
                    folds=folds, solid=0, smooth=18)
        decimate(o, 0.5)
        # front pleats (kachha) falling from the navel
        front = c.ring(c.waist - 0.02, 64)[0]
        rows, seg = 12, 16

        def point(r, s):
            t = r / rows
            u = s / seg - 0.5
            z = c.waist - 0.01 - t * (c.waist - c.knee - 0.02)
            x = u * (0.07 + 0.05 * t)
            y = -(front + 0.03 + 0.03 * t) - 0.012 * abs(math.sin(u * math.pi * 5))
            return Vector((x, y, z))

        p = G.tube('dhoti_pleats', c.rig, rows, seg, point, lambda r, s, co: {'pelvis': 1 - 0.4 * r / rows, 'thigh_l': 0.2 * r / rows, 'thigh_r': 0.2 * r / rows}, closed=False)
        select_only(o, p)
        bpy.ops.object.join()
        trim_from(o, 0.035, lambda co: co.z < c.knee)
        dirt_from(o, mid, c.knee)
        return o, dict(DYE_CLOTH, fabric='hessian_380', scale=4, trim=(0.55, 0.1, 0.06), zari=(0.6, 0.15, 0.08), dirt=0.9), 1024

    def kamarband(self):
        c = self.ctx
        kb = G.band(c, 'kamarband', c.waist - 0.01, 0.11, layers=3, src_ring_z=c.waist - 0.01)
        tails = G.sash_tails(c, 'kamarband_tails', c.waist - 0.05)
        drop_solidify(tails)
        select_only(kb, tails)
        bpy.ops.object.join()
        decimate(kb, 0.4)
        trim_from(kb, 0.012)
        no_dirt(kb)
        return kb, dict(fabric='crepe_satin', scale=3, trim=(0.55, 0.38, 0.1), rough=0.55), 512

    def shoes(self):
        """mojari: leather slippers with curled toes"""
        c, bp = self.ctx, self.bp
        o = G.shell(c, [bp['feet'], bp['shins']], 'mojari', lambda co, ws: co.z < c.ankle + 0.035, lambda co: 0.005, smooth=4, gap=0.003, solid=0)
        for v in o.data.vertices:
            # toe tip: furthest forward vertices curl up
            ball = c.b['ball_l'] if v.co.x * c.b['ball_l'].x > 0 else c.b['ball_r']
            f = smoothstep(ball.y - 0.02, ball.y - 0.09, v.co.y)
            v.co.z += 0.03 * f * f
            v.co.y -= 0.015 * f
        decimate(o, 0.6)
        trim_from(o, 0.012)
        no_dirt(o)
        return o, dict(fabric='brown_leather', scale=6, base=(0.42, 0.24, 0.13), trim=(0.45, 0.3, 0.1), rough=0.7), 256

    # ------------------------------------------------------------------ headgear
    def pagri(self, name='pagri', turns=7, width=0.068, scale=1.0, seed=5):
        c = self.ctx
        o = G.pagri(c, name, self.bp['head'], turns=turns, width=width, scale=scale, seed=seed)
        drop_solidify(o)
        decimate(o, 0.4)
        trim_from(o, 0.006)
        no_dirt(o)
        return o, dict(DYE_CLOTH, scale=4, lum_gain=1.9, trim=(0.16, 0.13, 0.1), zari=(0.16, 0.13, 0.1), grime=0.12, rough=0.9), 512

    def khud(self):
        """Indo-Persian helmet: fluted steel bowl, spike, nasal bar, mail aventail"""
        c = self.ctx
        cen, rad = G.head_frame(c, self.bp['head'])
        R = Vector((rad.x + 0.022, rad.y + 0.024, rad.z + 0.02))
        seg = 48
        rim_z = c.eye_z + 0.03

        def bowl(i, s):
            t = i / 14
            a = s / seg * math.tau
            el = -0.25 + t * (math.pi / 2 + 0.25)
            d = Vector((math.cos(el) * math.sin(a), -math.cos(el) * math.cos(a), math.sin(el)))
            r = G._on_ellipsoid(cen, R, cen, d)
            flute = 1 + 0.025 * math.sin(a * 16) * math.cos(el) * smoothstep(1.4, 0.2, el)
            p = cen + d * r * flute
            return p

        h = G.tube('khud', c.rig, 14, seg, bowl, lambda *_: {'Head': 1.0}, closed=True)
        # level the rim just above the brow
        lift = rim_z - min(v.co.z for v in h.data.vertices)
        for v in h.data.vertices:
            v.co.z += lift
        top = max(v.co.z for v in h.data.vertices)
        # spike finial
        spike = G.tube('spike', c.rig, 8, 12, lambda i, s: Vector((cen.x + math.sin(s / 12 * math.tau) * 0.012 * (1 - i / 8) ** 1.5,
                                                                    cen.y - math.cos(s / 12 * math.tau) * 0.012 * (1 - i / 8) ** 1.5,
                                                                    top - 0.005 + i / 8 * 0.11)), lambda *_: {'Head': 1.0})
        # rim band
        front_y = min(v.co.y for v in h.data.vertices)
        ring = G.tube('rim', c.rig, 2, seg, lambda i, s: Vector((cen.x + math.sin(s / seg * math.tau) * (R.x + 0.005),
                                                                 cen.y - math.cos(s / seg * math.tau) * (R.y + 0.005),
                                                                 rim_z + i * 0.012)), lambda *_: {'Head': 1.0})
        # nasal bar
        nasal = G.tube('nasal', c.rig, 1, 4, lambda i, s: Vector((cen.x + (0.006 if s in (1, 2) else -0.006),
                                                                  front_y - 0.006 - (0.004 if s in (2, 3) else 0),
                                                                  rim_z + 0.03 - i * 0.09)), lambda *_: {'Head': 1.0})
        # aventail: mail curtain from the rim over the nape and cheeks, open at the face
        rows = 6

        def mail(i, s):
            t = i / rows
            a = (s / 32) * (math.tau * 0.72) + math.tau * 0.14
            rr = 1 + 0.25 * t
            return Vector((cen.x + math.sin(a) * (R.x + 0.008) * rr, cen.y - math.cos(a) * (R.y + 0.008) * rr, rim_z + 0.002 - t * 0.15))

        av = G.tube('aventail', c.rig, rows, 32, mail, lambda i, s, co: {'Head': 1 - 0.5 * i / rows, 'neck_01': 0.5 * i / rows}, closed=False)
        select_only(h, spike, ring, nasal, av)
        bpy.ops.object.join()
        # trim: gold on rim + spike, mail on the aventail (stripe attr marks the mail)
        vals, mailv = [], []
        for v in h.data.vertices:
            gold = 1.0 if (abs(v.co.z - rim_z - 0.006) < 0.008 and v.co.z >= rim_z - 0.001) or v.co.z > top else 0.0
            vals.append(gold)
            mailv.append(1.0 if v.co.z < rim_z - 0.004 else 0.0)
        BK.set_attr(h, 'trim', vals)
        BK.set_attr(h, 'stripe', mailv)
        no_dirt(h)
        return h, dict(fabric='metal_plate_02', scale=3, base=(0.6, 0.6, 0.62), trim_flat=(0.85, 0.62, 0.22),
                       stripes=(0.55, 0.55, 0.57), stripe_fabric='chainmail', rough=0.3, metal=1.0, normal_strength=0.25), 512
