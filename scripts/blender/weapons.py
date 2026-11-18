"""Rigid props held in the hand / worn on the back. Built at the origin = grip point, with the blade or
shaft pointing along -Y (game forward) and +Z up (game up).
"""
import bpy, bmesh, math
from mathutils import Vector, Matrix
from common import link, select_only, smoothstep

_mats = {}


def mat(name, color, rough, metal=0.0):
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new('w_' + name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = color + (1,)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    _mats[name] = m
    return m


def STEEL():
    return mat('steel', (0.62, 0.63, 0.66), 0.25, 1.0)


def DARK_STEEL():
    return mat('darksteel', (0.18, 0.18, 0.2), 0.35, 1.0)


def GOLD():
    return mat('gold', (0.95, 0.68, 0.28), 0.3, 1.0)


def WOOD():
    return mat('wood', (0.32, 0.18, 0.09), 0.65)


def LEATHER():
    return mat('leather', (0.22, 0.12, 0.06), 0.6)


def STRING():
    return mat('string', (0.85, 0.8, 0.68), 0.8)


def loft(name, sections, material, closed_ends=True, smooth=True):
    """sections: list of lists of Vector (same count each), lofted in order; closed loops"""
    bm = bmesh.new()
    rows = []
    for sec in sections:
        rows.append([bm.verts.new(p) for p in sec])
    n = len(rows[0])
    for i in range(len(rows) - 1):
        for j in range(n):
            bm.faces.new((rows[i][j], rows[i][(j + 1) % n], rows[i + 1][(j + 1) % n], rows[i + 1][j]))
    if closed_ends and len(rows) == 1:
        bm.faces.new(rows[0])
    elif closed_ends:
        for r, flip in ((rows[0], True), (rows[-1], False)):
            if len(set(v.co.to_tuple(5) for v in r)) > 2:
                f = bm.faces.new(list(reversed(r)) if flip else r)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    link(o)
    o.data.materials.append(material)
    for p in o.data.polygons:
        p.use_smooth = smooth
    return o


def lathe(name, profile, material, seg=16, axis='Y', centre=Vector()):
    """profile: list of (r, h) along axis"""
    secs = []
    for r, h in profile:
        sec = []
        for i in range(seg):
            a = i / seg * math.tau
            if axis == 'Y':
                sec.append(centre + Vector((math.cos(a) * r, h, math.sin(a) * r)))
            else:
                sec.append(centre + Vector((math.cos(a) * r, math.sin(a) * r, h)))
        secs.append(sec)
    return loft(name, secs, material)


def join(name, objs):
    select_only(*objs)
    bpy.ops.object.join()
    o = objs[0]
    o.name = name
    o.data.name = name
    return o


def bevel_smooth(o, angle=40):
    select_only(o)
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(angle))
    except Exception:
        pass


# ---------------------------------------------------------------------------------------------
def talwar():
    L = 0.78
    secs = []
    for i in range(25):
        t = i / 24
        y = -0.02 - L * t
        z = 0.11 * t ** 2.2  # the curve rises toward the tip
        w = 0.036 * (1 - 0.28 * t)
        if t > 0.86:
            w *= max(0.02, 1 - (t - 0.86) / 0.14) ** 0.8
        th = 0.0035 * (1 - 0.5 * t) + 0.0005
        # blade plane is YZ; spine on top (+z), edge below; slight tilt to follow the curve
        ang = math.atan2(0.11 * 2.2 * t ** 1.2, L)
        up = Vector((0, math.sin(ang), math.cos(ang)))
        c = Vector((0, y, z))
        sec = [c + up * (w * 0.5) + Vector((th, 0, 0)), c + up * (w * 0.5) + Vector((-th, 0, 0)),
               c + up * (-w * 0.1) + Vector((-th * 0.7, 0, 0)), c + up * (-w * 0.5),
               c + up * (-w * 0.1) + Vector((th * 0.7, 0, 0))]
        secs.append(sec)
    blade = loft('blade', secs, STEEL())
    bevel_smooth(blade, 30)
    # hilt: guard with quillons ending in buds, langets, bulbous grip, disc pommel with a finial
    guard = loft('guard', [[Vector((x, y, z)) for x, z in ((0.012, 0.055), (-0.012, 0.055), (-0.012, -0.055), (0.012, -0.055))] for y in (0.0, -0.016)], GOLD(), smooth=False)
    buds = [lathe('bud', [(0.0, -0.012), (0.012, -0.006), (0.012, 0.004), (0.0, 0.01)], GOLD(), 10, 'Z', Vector((0, -0.008, s * 0.062))) for s in (1, -1)]
    langet = loft('langet', [[Vector((x, y, 0.0 + dz)) for x, dz in ((0.008, 0.012), (-0.008, 0.012), (-0.008, -0.012), (0.008, -0.012))] for y in (-0.016, -0.06)], GOLD(), smooth=False)
    for v in langet.data.vertices:
        if v.co.y < -0.05:
            v.co.z *= 0.2
    grip = lathe('grip', [(0.0, 0.0), (0.014, 0.004), (0.019, 0.05), (0.014, 0.095), (0.0, 0.1)], GOLD(), 14)
    disc = lathe('pommel', [(0.0, 0.098), (0.012, 0.1), (0.036, 0.11), (0.036, 0.116), (0.02, 0.122), (0.008, 0.13), (0.004, 0.145), (0.0, 0.15)], GOLD(), 20)
    o = join('talwar', [blade, guard, *buds, langet, grip, disc])
    return o


def dhal(team_mat):
    """round convex shield, face +Z, grip on the inside"""
    R, H = 0.24, 0.06
    prof = [(0.0, H + 0.004)] + [(R * t, H * (1 - t ** 2)) for t in [i / 10 for i in range(1, 11)]] + [(R + 0.008, -0.002), (R + 0.006, -0.012), (R - 0.01, -0.006)]
    face = lathe('dhal', prof, team_mat, 40, 'Z')
    rim = lathe('rim', [(R - 0.006, -0.004), (R + 0.012, 0.0), (R + 0.012, 0.008), (R - 0.008, 0.012)], GOLD(), 40, 'Z')
    parts = [face, rim]
    for i in range(4):
        a = i / 4 * math.tau + math.pi / 4
        c = Vector((math.cos(a) * 0.07, math.sin(a) * 0.07, H * (1 - (0.07 / R) ** 2)))
        parts.append(lathe('boss', [(0.0, -0.004), (0.022, 0.0), (0.02, 0.012), (0.012, 0.02), (0.0, 0.023)], GOLD(), 14, 'Z', c))
    # central crescent and star
    parts.append(lathe('umbo', [(0.0, H), (0.03, H), (0.026, H + 0.01), (0.0, H + 0.016)], GOLD(), 16, 'Z'))
    return join('dhal', parts)


def bhala(length=1.9, team_mat=None):
    butt = length * 0.28
    shaft = lathe('shaft', [(0.0, butt + 0.02), (0.016, butt), (0.015, -length * 0.7)], WOOD(), 10)
    cap = lathe('cap', [(0.0, butt + 0.04), (0.017, butt + 0.01), (0.017, butt - 0.03)], DARK_STEEL(), 10)
    tip = -length * 0.7
    sock = lathe('socket', [(0.017, tip + 0.03), (0.019, tip), (0.012, tip - 0.07)], DARK_STEEL(), 10)
    secs = []
    for i in range(13):
        t = i / 12
        y = tip - 0.07 - t * 0.28
        w = 0.045 * math.sin(min(1, t * 1.15) * math.pi) ** 0.8 * (1 - t) + 0.001
        th = 0.008 * (1 - t) + 0.001
        secs.append([Vector((0, y, w)), Vector((th, y, 0)), Vector((0, y, -w)), Vector((-th, y, 0))])
    head = loft('head', secs, STEEL())
    parts = [shaft, cap, sock, head]
    if team_mat is not None:
        flag = loft('pennant', [[Vector((0.0015, tip + 0.1 + dy, 0.02 + dz)) for dy, dz in ((0, 0), (0, 0.16))] + [Vector((-0.0015, tip + 0.1 + dy, 0.02 + dz)) for dy, dz in ((0, 0.16), (0, 0))],
                                 [Vector((0.0015, tip + 0.36, 0.04)), Vector((0.0015, tip + 0.36, 0.1)), Vector((-0.0015, tip + 0.36, 0.1)), Vector((-0.0015, tip + 0.36, 0.04))]], team_mat, smooth=False)
        parts.append(flag)
    return join('lance' if team_mat is not None else 'bhala', parts)


def kaman():
    """Indian composite recurve bow, limbs along Z, back of the bow facing -Y (forward), string on +Y"""
    half = 0.62
    secs_up, pts = [], []
    for i in range(21):
        t = i / 20
        z = t * half
        # limbs bend back toward the archer, tips recurve forward
        y = 0.16 * t ** 1.6 - 0.12 * smoothstep(0.78, 1.0, t) ** 1.5
        pts.append((y, z))
    def limb(sign):
        secs = []
        for y, z in pts:
            t = z / half
            w = 0.022 * (1 - 0.55 * t) + 0.004
            th = 0.011 * (1 - 0.4 * t) + 0.003
            c = Vector((0, y, z * sign))
            secs.append([c + Vector((w / 2, 0, 0)), c + Vector((0, th / 2, 0)), c + Vector((-w / 2, 0, 0)), c + Vector((0, -th / 2, 0))])
        return loft('limb', secs, WOOD())
    a, b = limb(1), limb(-1)
    grip = lathe('bowgrip', [(0.0, -0.07), (0.018, -0.065), (0.02, 0.0), (0.018, 0.065), (0.0, 0.07)], LEATHER(), 10, 'Z')
    ty, tz = pts[-1]
    string = loft('string', [[Vector((dx, ty, tz * s)) for dx in (0.0015, -0.0015)] + [Vector((0, ty + 0.002, tz * s))] for s in (1, -1)], STRING(), closed_ends=False, smooth=False)
    tips = [lathe('tip', [(0.0, -0.01), (0.008, 0.0), (0.0, 0.02)], GOLD(), 8, 'Z', Vector((0, ty, tz * s))) for s in (1, -1)]
    return join('kaman', [a, b, grip, string, *tips])


def tarkash():
    """quiver with arrows, worn on the back; long axis +Z tilted"""
    body = lathe('quiver', [(0.0, -0.3), (0.045, -0.29), (0.05, 0.0), (0.055, 0.2), (0.05, 0.22)], LEATHER(), 14, 'Z')
    bands = [lathe('band', [(0.051, z - 0.012), (0.057, z - 0.01), (0.057, z + 0.01), (0.051, z + 0.012)], GOLD(), 14, 'Z') for z in (-0.2, 0.0, 0.19)]
    arrows = []
    for i in range(7):
        a = i / 7 * math.tau
        x, y = math.cos(a) * 0.025, math.sin(a) * 0.025
        shaft = lathe('arrow', [(0.0, 0.0), (0.004, 0.01), (0.004, 0.3), (0.0, 0.31)], WOOD(), 5, 'Z', Vector((x, y, 0.0)))
        fl = loft('fletch', [[Vector((x - 0.012, y, 0.24)), Vector((x + 0.012, y, 0.24)), Vector((x + 0.012, y + 0.001, 0.3)), Vector((x - 0.012, y + 0.001, 0.3))]], STRING(), closed_ends=True, smooth=False)
        arrows += [shaft, fl]
    o = join('tarkash', [body, *bands, *arrows])
    o.rotation_euler = (0, 0.35, 0)
    select_only(o)
    bpy.ops.object.transform_apply(rotation=True)
    return o


def scabbard():
    """sheathed talwar hanging at the left hip (skinned to the pelvis in the build)"""
    secs = []
    L = 0.8
    for i in range(17):
        t = i / 16
        y = -L * t
        z = 0.11 * t ** 2.2
        w = 0.05 * (1 - 0.25 * t) + 0.004
        if t > 0.92:
            w *= 0.6
        secs.append([Vector((0.012, y, z + w / 2)), Vector((-0.012, y, z + w / 2)), Vector((-0.012, y, z - w / 2)), Vector((0.012, y, z - w / 2))])
    s = loft('scabbard', secs, LEATHER())
    chape = lathe('chape', [(0.0, -L - 0.01), (0.016, -L + 0.02), (0.016, -L + 0.08)], GOLD(), 10)
    for v in chape.data.vertices:
        v.co.z += 0.11
    hilt = talwar()
    # keep only hilt parts (drop the blade by removing vertices in front of the guard)
    bm = bmesh.new()
    bm.from_mesh(hilt.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < -0.06], context='VERTS')
    bm.to_mesh(hilt.data)
    bm.free()
    return join('scabbard', [s, chape, hilt])
