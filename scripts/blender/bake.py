"""Texture baking for garments / props.

Every piece gets: albedo (RGB) + dye mask (A) and a tangent-space normal map, baked in Cycles from a
procedural material built on photo-scanned (CC0, Poly Haven) fabric, leather and metal.
Dye mask: 1 where the cloth takes the unit's colour (tinted in-game), 0 for fixed colours (zari, metal...).
"""
import bpy, bmesh, math, os, heapq
import numpy as np
from mathutils import Vector
from common import select_only

TEX = os.path.expanduser('~/thrones-tools/src/tex')


def setup_cycles(samples=24):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = 'GPU'
    except Exception as e:  # noqa
        print('GPU setup failed, CPU bake', e)
    sc.cycles.samples = samples
    sc.render.bake.margin = 6


def img(path, non_color=False):
    i = bpy.data.images.load(path, check_existing=True)
    if non_color:
        i.colorspace_settings.name = 'Non-Color'
    return i


# ---------------------------------------------------------------------------------------------
# per-vertex attributes used by the bake material
# ---------------------------------------------------------------------------------------------
def edge_distance(o, keep_boundary=lambda co: True, max_d=0.2):
    """geodesic distance (along edges) from each vertex to the mesh's boundary loops"""
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    dist = [math.inf] * len(bm.verts)
    pq = []
    for e in bm.edges:
        if e.is_boundary:
            for v in e.verts:
                if keep_boundary(v.co) and dist[v.index] > 0:
                    dist[v.index] = 0
                    heapq.heappush(pq, (0.0, v.index))
    while pq:
        d, i = heapq.heappop(pq)
        if d > dist[i] or d > max_d:
            continue
        v = bm.verts[i]
        for e in v.link_edges:
            w = e.other_vert(v)
            nd = d + e.calc_length()
            if nd < dist[w.index]:
                dist[w.index] = nd
                heapq.heappush(pq, (nd, w.index))
    bm.free()
    return [min(d, max_d) for d in dist]


def set_attr(o, name, values):
    me = o.data
    a = me.attributes.get(name) or me.attributes.new(name, 'FLOAT', 'POINT')
    a.data.foreach_set('value', [float(v) for v in values])


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


# ---------------------------------------------------------------------------------------------
# bake material
# ---------------------------------------------------------------------------------------------
def build_material(o, spec):
    """spec keys: fabric, scale, dye(bool), base (rgb for non-dyed), trim (rgb or None), zari(rgb), dirt,
    metal, rough, normal_strength, stripes"""
    m = bpy.data.materials.new(o.name + '_bake')
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    N.clear()
    out = N.new('ShaderNodeOutputMaterial')
    tc = N.new('ShaderNodeTexCoord')
    mp = N.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (spec.get('scale', 8),) * 3
    L.new(tc.outputs['Object'], mp.inputs['Vector'])

    def tex(path, non_color=False, scale=None):
        t = N.new('ShaderNodeTexImage')
        t.image = img(path, non_color)
        t.projection = 'BOX'
        t.projection_blend = 0.3
        if scale is None:
            L.new(mp.outputs['Vector'], t.inputs['Vector'])
        else:
            m2 = N.new('ShaderNodeMapping')
            m2.inputs['Scale'].default_value = (scale,) * 3
            L.new(tc.outputs['Object'], m2.inputs['Vector'])
            L.new(m2.outputs['Vector'], t.inputs['Vector'])
        return t

    def attr(name):
        a = N.new('ShaderNodeAttribute')
        a.attribute_name = name
        return a.outputs['Fac']

    def mix(fac, a, b, blend='MIX'):
        n = N.new('ShaderNodeMix')
        n.data_type = 'RGBA'
        n.blend_type = blend
        if isinstance(fac, float):
            n.inputs['Factor'].default_value = fac
        else:
            L.new(fac, n.inputs['Factor'])
        for sock, val in ((n.inputs[6], a), (n.inputs[7], b)):
            if isinstance(val, tuple):
                sock.default_value = val + (1,) if len(val) == 3 else val
            else:
                L.new(val, sock)
        return n.outputs[2]

    def math_node(op, a, b=None, clamp=True):
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

    def ramp(fac, stops):
        n = N.new('ShaderNodeValToRGB')
        cr = n.color_ramp
        cr.interpolation = 'LINEAR'
        while len(cr.elements) > len(stops):
            cr.elements.remove(cr.elements[-1])
        while len(cr.elements) < len(stops):
            cr.elements.new(0.5)
        for e, (pos, val) in zip(cr.elements, stops):
            e.position = pos
            e.color = (val, val, val, 1)
        L.new(fac, n.inputs['Fac'])
        return n.outputs['Color']

    fab = spec.get('fabric', 'cotton_jersey')
    d = tex(f'{TEX}/{fab}/diff.jpg')
    nrm = tex(f'{TEX}/{fab}/nor.jpg', True)
    # neutral cloth: scan luminance around ~0.85 (dyed in-game), or a fixed base colour
    bw = N.new('ShaderNodeRGBToBW')
    L.new(d.outputs['Color'], bw.inputs['Color'])
    lum = math_node('MULTIPLY', bw.outputs['Val'], spec.get('lum_gain', 1.6), clamp=False)
    lum = math_node('ADD', lum, spec.get('lum_add', 0.0))
    lumc = N.new('ShaderNodeCombineColor')
    for k in ('Red', 'Green', 'Blue'):
        L.new(lum, lumc.inputs[k])
    cloth = lumc.outputs['Color']
    if spec.get('base'):
        if spec.get('keep_scan'):
            cloth = mix(spec.get('scan_mix', 0.5), d.outputs['Color'], spec['base'], 'MULTIPLY')
            cloth = mix(1.0, cloth, (spec.get('scan_gain', 2.0),) * 3, 'MULTIPLY')
        else:
            cloth = mix(1.0, lumc.outputs['Color'], spec['base'], 'MULTIPLY')
    dye = 0.0 if spec.get('base') else 1.0

    # woven stripes along ribbon/turban edges or skirt bands
    color = cloth
    dye_mask = None
    if spec.get('trim'):
        tr = attr('trim')  # 1 at the edge -> 0 inside the border width
        band = ramp(tr, [(0.0, 0.0), (0.04, 1.0), (1.0, 1.0)])
        jac = tex(f'{TEX}/floral_jacquard/diff.jpg')
        jbw = N.new('ShaderNodeRGBToBW')
        L.new(jac.outputs['Color'], jbw.inputs['Color'])
        motif = ramp(jbw.outputs['Val'], [(0.0, 0.0), (0.2, 0.0), (0.3, 1.0), (1.0, 1.0)])
        border_col = mix(motif, spec['trim'], spec.get('zari', (0.62, 0.43, 0.14)))
        # thin gold lines framing the border
        lines = ramp(tr, [(0.0, 0.0), (0.04, 0.0), (0.06, 1.0), (0.13, 1.0), (0.15, 0.0), (0.8, 0.0), (0.84, 1.0), (1.0, 1.0)])
        border_col = mix(lines, border_col, spec.get('zari', (0.62, 0.43, 0.14)))
        color = mix(band, color, border_col)
        dye_mask = math_node('SUBTRACT', 1.0, band)
    if spec.get('trim_flat'):
        tr = attr('trim')
        color = mix(tr, color, spec['trim_flat'])
        dm = math_node('SUBTRACT', 1.0, tr)
        dye_mask = dm if dye_mask is None else math_node('MULTIPLY', dye_mask, dm)
    if spec.get('stripes'):
        tr = attr('stripe')
        sc = spec['stripes']
        if spec.get('stripe_fabric'):
            st = tex(f"{TEX}/{spec['stripe_fabric']}/diff.jpg", scale=spec.get('stripe_scale', 12))
            sc = mix(1.0, st.outputs['Color'], spec['stripes'], 'MULTIPLY')
            sc = mix(1.0, sc, (2.2, 2.2, 2.2), 'MULTIPLY')
        color = mix(tr, color, sc)
        dm = math_node('SUBTRACT', 1.0, tr)
        dye_mask = dm if dye_mask is None else math_node('MULTIPLY', dye_mask, dm)
    # grime: every garment is worn — large soft mottling plus fine stains
    if spec.get('grime', 0.22) > 0 and not spec.get('metal'):
        g1 = N.new('ShaderNodeTexNoise')
        g1.inputs['Scale'].default_value = 2.5
        g1.inputs['Detail'].default_value = 6
        L.new(tc.outputs['Object'], g1.inputs['Vector'])
        gf = math_node('MULTIPLY', math_node('SUBTRACT', g1.outputs['Fac'], 0.35), spec.get('grime', 0.22) * 2.2)
        color = mix(gf, color, (0.42, 0.34, 0.25), 'MULTIPLY')
    # dust & wear
    if spec.get('dirt', 0) > 0:
        dirt = attr('dirt')
        nz = N.new('ShaderNodeTexNoise')
        nz.inputs['Scale'].default_value = 9
        L.new(mp.outputs['Vector'], nz.inputs['Vector'])
        f = math_node('MULTIPLY', dirt, nz.outputs['Fac'])
        f = math_node('MULTIPLY', f, spec['dirt'] * 1.6)
        color = mix(f, color, spec.get('dirt_col', (0.36, 0.27, 0.18)), 'MULTIPLY')

    emit = N.new('ShaderNodeEmission')
    L.new(color, emit.inputs['Color'])
    # dye mask output (bake pass 2)
    emit_mask = N.new('ShaderNodeEmission')
    if dye_mask is None:
        emit_mask.inputs['Color'].default_value = (dye, dye, dye, 1)
    else:
        dm = math_node('MULTIPLY', dye_mask, dye)
        L.new(dm, emit_mask.inputs['Color'])
    # normal (bake pass 3)
    bsdf = N.new('ShaderNodeBsdfPrincipled')
    nm = N.new('ShaderNodeNormalMap')
    nm.inputs['Strength'].default_value = spec.get('normal_strength', 1.0)
    L.new(nrm.outputs['Color'], nm.inputs['Color'])
    L.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    m['_emit'] = emit.name
    m['_mask'] = emit_mask.name
    m['_bsdf'] = bsdf.name
    m['_out'] = out.name
    o.data.materials.clear()
    o.data.materials.append(m)
    return m


def _route(m, which):
    nt = m.node_tree
    out = nt.nodes[m['_out']]
    src = nt.nodes[m[which]]
    for l in list(out.inputs['Surface'].links):
        nt.links.remove(l)
    nt.links.new(src.outputs[0], out.inputs['Surface'])


def _target(m, image):
    nt = m.node_tree
    t = nt.nodes.get('_bake_target') or nt.nodes.new('ShaderNodeTexImage')
    t.name = '_bake_target'
    t.image = image
    for n in nt.nodes:
        n.select = False
    t.select = True
    nt.nodes.active = t


def ensure_bake_uv(o, margin=0.004, angle=66):
    me = o.data
    if 'bake' not in me.uv_layers:
        me.uv_layers.new(name='bake')
    me.uv_layers.active = me.uv_layers['bake']
    select_only(o)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def bake_piece(o, spec, size, outdir, *, ao=0.4):
    """bake albedo+dye (RGBA png), normal (png) from the dense mesh onto a decimated copy; returns the
    final export material"""
    m = spec['material_fn'](o) if spec.get('material_fn') else build_material(o, spec)
    if spec.get('material_fn'):
        o.data.materials.clear()
        o.data.materials.append(m)
    ratio = o.get('dec', 1.0)
    high = None
    if ratio < 1.0:
        high = o.copy()
        high.data = o.data.copy()
        high.name = o.name + '_high'
        bpy.context.scene.collection.objects.link(high)
        sub = high.modifiers.new('Sub', 'SUBSURF')
        sub.subdivision_type = 'SIMPLE'
        sub.levels = sub.render_levels = 0 if spec.get('no_sub') else 3 if spec.get('trim_fn') else 1
        if spec.get('trim_fn'):
            # exact borders: evaluate the border curve on the subdivided mesh
            select_only(high)
            for md in list(high.modifiers):
                if md.type == 'SOLIDIFY':
                    high.modifiers.remove(md)
            while high.modifiers.find('Sub') > 0:
                bpy.ops.object.modifier_move_up(modifier='Sub')
            bpy.ops.object.modifier_apply(modifier='Sub')
            a = high.data.attributes['trim']
            vals = [0.0] * len(high.data.vertices)
            a.data.foreach_get('value', vals)
            fn = spec['trim_fn']
            vals = [max(v, fn(high.data.vertices[i].co)) for i, v in enumerate(vals)]
            a.data.foreach_set('value', vals)
        for md in high.modifiers:
            if md.type == 'ARMATURE':
                md.show_render = False
        dm = o.modifiers.new('Decimate', 'DECIMATE')
        dm.ratio = ratio
        select_only(o)
        while o.modifiers.find('Decimate') > 0:
            bpy.ops.object.modifier_move_up(modifier='Decimate')
        bpy.ops.object.modifier_apply(modifier='Decimate')
    ensure_bake_uv(o)
    solid = [md for md in o.modifiers if md.type == 'SOLIDIFY']
    for md in solid:
        md.show_render = False
    sc = bpy.context.scene
    if high:
        select_only(high)
        high.select_set(True)
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        o.hide_render = False
        sc.render.bake.use_selected_to_active = True
        sc.render.bake.cage_extrusion = 0.015
        sc.render.bake.max_ray_distance = 0.04
    else:
        select_only(o)
        sc.render.bake.use_selected_to_active = False

    def new_img(name, non_color=False):
        i = bpy.data.images.new(name, size, size, alpha=True, float_buffer=False)
        if non_color:
            i.colorspace_settings.name = 'Non-Color'
        return i

    col = new_img(o.name + '_col')
    _route(m, '_emit')
    _target(m, col)
    sc.cycles.samples = 4
    bake = lambda **kw: bpy.ops.object.bake(use_selected_to_active=high is not None, cage_extrusion=0.015, max_ray_distance=0.04, **kw)
    bake(type='EMIT', use_clear=True, margin=6)
    msk = new_img(o.name + '_msk', True)
    _route(m, '_mask')
    _target(m, msk)
    bake(type='EMIT', use_clear=True, margin=6)
    nor = new_img(o.name + '_nor', True)
    _route(m, '_bsdf')
    _target(m, nor)
    sc.cycles.samples = 8
    bake(type='NORMAL', use_clear=True, margin=6, normal_space='TANGENT')
    aoi = None
    if ao > 0:
        aoi = new_img(o.name + '_ao', True)
        _target(m, aoi)
        sc.cycles.samples = 48
        if sc.world is None:
            sc.world = bpy.data.worlds.new('bake_world')
        sc.world.light_settings.distance = 0.06
        for md in solid:
            md.show_render = True
        bake(type='AO', use_clear=True, margin=6)
        for md in solid:
            md.show_render = False
    # compose RGBA: albedo * AO, alpha = dye mask
    c = np.array(col.pixels[:], dtype=np.float32).reshape(-1, 4)
    mk = np.array(msk.pixels[:], dtype=np.float32).reshape(-1, 4)
    if aoi is not None:
        a = np.array(aoi.pixels[:], dtype=np.float32).reshape(-1, 4)[:, :1]
        c[:, :3] *= (1 - ao) + ao * a
    # dye mask stored as alpha 0.5..1 (lossy WebP discards the colour of fully transparent pixels)
    c[:, 3] = 0.5 + 0.5 * mk[:, 0]
    final = bpy.data.images.new(o.name + '_albedo', size, size, alpha=True)
    final.pixels[:] = c.ravel()
    final.filepath_raw = os.path.join(outdir, o.name + '_albedo.png')
    final.file_format = 'PNG'
    final.save()
    nor.filepath_raw = os.path.join(outdir, o.name + '_normal.png')
    nor.file_format = 'PNG'
    nor.save()
    for md in solid:
        md.show_render = True
    if high:
        bpy.data.objects.remove(high)
        sc.render.bake.use_selected_to_active = False
    # final export material
    fm = bpy.data.materials.new(o.name)
    fm.use_nodes = True
    nt = fm.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = spec.get('rough', 0.85)
    b.inputs['Metallic'].default_value = spec.get('metal', 0.0)
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = final
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.image = nor
    nmn = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tn.outputs['Color'], nmn.inputs['Color'])
    nt.links.new(nmn.outputs['Normal'], b.inputs['Normal'])
    o.data.materials.clear()
    o.data.materials.append(fm)
    # the bake UV becomes the only UV map
    for uv in list(o.data.uv_layers):
        if uv.name != 'bake':
            o.data.uv_layers.remove(uv)
    for a in ('trim', 'dirt', 'stripe'):
        if a in o.data.attributes:
            o.data.attributes.remove(o.data.attributes[a])
    return fm
