"""Builds a rigged MPFB (MakeHuman, CC0 assets) South-Asian man with exportable materials."""
import bpy, os, math, importlib
import numpy as np
from mathutils import Vector
from common import mpfb, select_only, principled, smoothstep

# a few distinct men: face/body shape + skin tone + hair + facial hair
VARIANTS = [
    dict(name='a', age=0.5, muscle=0.75, weight=0.5, height=0.55, prop=0.6, race=(0.3, 0.45, 0.25), seed=11,
         skin='middleage_asian_male', tone=(0.42, 0.25, 0.16), hair='short02', brows='eyebrow001', beard='moustache'),
    dict(name='b', age=0.42, muscle=0.7, weight=0.42, height=0.5, prop=0.55, race=(0.25, 0.4, 0.35), seed=23,
         skin='young_african_male', tone=(0.37, 0.22, 0.14), hair='short04', brows='eyebrow009', beard='full'),
    dict(name='c', age=0.62, muscle=0.62, weight=0.58, height=0.48, prop=0.5, race=(0.2, 0.55, 0.25), seed=37,
         skin='middleage_caucasian_male', tone=(0.5, 0.31, 0.2), hair='short01', brows='eyebrow003', beard='moustache'),
    dict(name='d', age=0.38, muscle=0.8, weight=0.45, height=0.6, prop=0.65, race=(0.35, 0.35, 0.3), seed=41,
         skin='young_asian_male', tone=(0.38, 0.22, 0.14), hair='short02', brows='eyebrow006', beard='stubble'),
]


def data_dir():
    _, _, ls = mpfb()
    return ls.get_user_data()


def find_file(sub, ext):
    d = os.path.join(data_dir(), sub)
    for f in sorted(os.listdir(d)):
        if f.endswith(ext):
            return os.path.join(d, f)
    raise FileNotFoundError(d + ' ' + ext)


def recolour(img, tone, lift=0.0):
    """shift an image's average (linear) colour to `tone`, keeping its texture"""
    px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
    rgb = px[:, :3]
    lum = rgb.mean(axis=1)
    mask = lum > 0.02
    avg = rgb[mask].mean(axis=0)
    gain = np.array(tone, dtype=np.float32) / np.maximum(avg, 1e-4)
    rgb *= gain
    px[:, :3] = np.clip(rgb + lift, 0, 1)
    img.pixels[:] = px.ravel()
    img.update()


def build_human(v, with_rig=True):
    hs, ts, ls = mpfb()
    macro = ts.get_default_macro_info_dict()
    macro.update(gender=1.0, age=v['age'], muscle=v['muscle'], weight=v['weight'], height=v['height'], proportions=v['prop'])
    a, c, f = v['race']
    macro['race'] = {'asian': a, 'caucasian': c, 'african': f}
    bm = hs.create_human(macro_detail_dict=macro)
    bm.name = 'body'
    rig = None
    if with_rig:
        hs.add_builtin_rig(bm, 'game_engine')
        rig = bm.parent
    D = data_dir()
    parts = {}
    for kind, sub in [('Eyes', 'eyes/low-poly'), ('Eyebrows', 'eyebrows/' + v['brows']), ('Eyelashes', 'eyelashes/eyelashes01'), ('Hair', 'hair/' + v['hair'])]:
        before = set(bpy.data.objects)
        hs.add_mhclo_asset(find_file(sub, '.mhclo'), bm, asset_type=kind, subdiv_levels=0, set_up_rigging=with_rig)
        new = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
        parts[kind] = new[0]
        new[0].name = kind.lower()
    # bake shape keys + masks, drop helper geometry
    es = importlib.import_module('bl_ext.user_default.mpfb.services.exportservice').ExportService
    for o in [bm] + list(parts.values()):
        select_only(o)
        if o.data.shape_keys:
            bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
    select_only(bm)
    for m in list(bm.modifiers):
        if m.type == 'MASK':
            bpy.ops.object.modifier_apply(modifier=m.name)
    # MPFB body has helper geometry removed via the mask; also drop leftover helper vertex groups
    for vg in list(bm.vertex_groups):
        if vg.name.startswith(('helper', 'joint-', 'HelperGeometry')):
            bm.vertex_groups.remove(vg)

    # --- materials ---
    skin_png = find_file('skins/' + v['skin'], '.png')
    skin = bpy.data.images.load(skin_png)
    skin = skin.copy()
    skin.name = 'skin_' + v['name']
    recolour(skin, v['tone'])
    bm.data.materials.clear()
    bm.data.materials.append(principled('skin_' + v['name'], skin, rough=0.62))
    eye = bpy.data.images.load(os.path.join(D, 'eyes/materials/brown_eye.png'), check_existing=True)
    parts['Eyes'].data.materials.clear()
    parts['Eyes'].data.materials.append(principled('eyes', eye, rough=0.15))
    for k in ('Eyebrows', 'Eyelashes', 'Hair'):
        o = parts[k]
        sub = {'Eyebrows': 'eyebrows/' + v['brows'], 'Eyelashes': 'eyelashes/eyelashes01', 'Hair': 'hair/' + v['hair']}[k]
        pngs = [f for f in sorted(os.listdir(os.path.join(D, sub))) if f.endswith('.png') and 'normal' not in f]
        img = bpy.data.images.load(os.path.join(D, sub, pngs[0])).copy()
        img.name = f'{k.lower()}_{v["name"]}'
        if k == 'Hair':
            recolour(img, (0.025, 0.02, 0.018))
        o.data.materials.clear()
        o.data.materials.append(principled(f'{k.lower()}_{v["name"]}', img, rough=0.55, alpha=True))
    return bm, rig, parts, skin


def bone_world(rig, name):
    return rig.matrix_world @ rig.data.bones[name].head_local


# ---------------------------------------------------------------------------------------------
# skin variants with painted facial hair
# ---------------------------------------------------------------------------------------------
def _raster_pos(o, size, near, radius=0.13):
    """per-texel 3D surface position (and coverage) for faces near `near`"""
    me = o.data
    me.calc_loop_triangles()
    uv = me.uv_layers.active.data
    P = np.zeros((size, size, 3), np.float32)
    C = np.zeros((size, size), np.float32)
    for tri in me.loop_triangles:
        cos = [me.vertices[i].co for i in tri.vertices]
        if min((c - near).length for c in cos) > radius:
            continue
        p = [Vector(uv[l].uv) * size for l in tri.loops]
        x0, x1 = int(max(0, min(q.x for q in p))), int(min(size - 1, max(q.x for q in p)) + 1)
        y0, y1 = int(max(0, min(q.y for q in p))), int(min(size - 1, max(q.y for q in p)) + 1)
        if x1 <= x0 or y1 <= y0:
            continue
        ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1].astype(np.float32) + 0.5
        (ax, ay), (bx, by), (cx, cy) = [(q.x, q.y) for q in p]
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-9:
            continue
        l1 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den
        l2 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den
        l3 = 1 - l1 - l2
        inside = (l1 >= -0.01) & (l2 >= -0.01) & (l3 >= -0.01)
        for k in range(3):
            v = l1 * cos[0][k] + l2 * cos[1][k] + l3 * cos[2][k]
            sub = P[y0:y1 + 1, x0:x1 + 1, k]
            sub[inside] = v[inside]
        C[y0:y1 + 1, x0:x1 + 1][inside] = 1
    return P, C


def _ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def _blur(a, r):
    if r <= 0:
        return a
    k = np.ones(2 * r + 1, np.float32) / (2 * r + 1)
    a = np.apply_along_axis(lambda m: np.convolve(m, k, mode='same'), 0, a)
    return np.apply_along_axis(lambda m: np.convolve(m, k, mode='same'), 1, a)


def paint_facial_hair(head_obj, img, style, seed=1):
    if style == 'none':
        return
    vg = head_obj.vertex_groups.get('lips')
    lips = [v.co for v in head_obj.data.vertices if vg and any(g.group == vg.index and g.weight > 0.5 for g in v.groups)]
    m = sum(lips, Vector()) / len(lips)
    size = img.size[0]
    P, C = _raster_pos(head_obj, size, m)
    dx, dz, dy = np.abs(P[..., 0] - m.x), P[..., 2] - m.z, P[..., 1] - m.y
    front = (dy < 0.03) * C
    # groomed moustache: full over the lip, tapering out, ends sweeping upward
    lo = 0.0035 + 0.004 * _ss(0.0, 0.03, dx) + 0.012 * _ss(0.03, 0.05, dx)
    hi = 0.023 - 0.007 * _ss(0.0, 0.035, dx) + 0.013 * _ss(0.032, 0.05, dx)
    must = _ss(lo - 0.0015, lo + 0.0015, dz) * _ss(hi + 0.0015, hi - 0.0015, dz) * _ss(0.056, 0.048, dx)
    must *= 1 - 0.35 * _ss(0.006, 0.0, dx) * _ss(0.012, 0.018, dz)
    must *= front
    lipzone = _ss(0.03, 0.022, dx) * _ss(-0.014, -0.004, dz) * _ss(0.012, 0.004, dz)
    beard = _ss(0.045, 0.02, dz + dx * 0.25) * _ss(-0.11, -0.07, dz) * (1 - lipzone) * (dy < 0.075) * C
    if style == 'moustache':
        w = np.maximum(must, 0.22 * beard)
    elif style == 'full':
        w = np.maximum(must, 0.95 * beard)
    else:  # stubble
        w = np.maximum(0.6 * must, 0.35 * beard)
    rng = np.random.default_rng(seed)
    n = rng.random((size, size)).astype(np.float32)
    k = np.ones(9, np.float32) / 9
    streak = np.apply_along_axis(lambda r: np.convolve(r, k, mode='same'), 1, n)
    strands = np.clip((streak - 0.5) * 3 + 0.5, 0, 1) * 0.6 + n * 0.4
    dens = np.clip(_blur(w, 1) * (0.6 + 0.6 * strands), 0, 1)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(size, size, 4)
    hair = np.array([0.03, 0.022, 0.018], np.float32)
    px[..., :3] = px[..., :3] * (1 - dens[..., None] * 0.93) + hair * dens[..., None] * 0.93
    img.pixels[:] = px.ravel()
    img.update()


def skin_variant(head_obj, v, out_path, size=2048):
    """recoloured MakeHuman skin + painted facial hair, saved as a JPG"""
    src = bpy.data.images.load(find_file('skins/' + v['skin'], '.png'), check_existing=True)
    im = src.copy()
    im.name = 'skin_' + v['name']
    if im.size[0] != size:
        im.scale(size, size)
    recolour(im, v['tone'])
    paint_facial_hair(head_obj, im, v['beard'], seed=v['seed'])
    im.filepath_raw = out_path
    im.file_format = 'JPEG'
    bpy.context.scene.render.image_settings.quality = 88
    im.save()
    return im
