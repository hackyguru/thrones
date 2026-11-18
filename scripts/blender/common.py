"""Shared helpers for the Blender character build (run inside Blender 5.x with the MPFB extension)."""
import bpy, bmesh, os, math, random
from mathutils import Vector, Matrix, Quaternion

MPFB = 'bl_ext.user_default.mpfb'


def mpfb():
    import importlib
    hs = importlib.import_module(MPFB + '.services.humanservice').HumanService
    ts = importlib.import_module(MPFB + '.services.targetservice').TargetService
    ls = importlib.import_module(MPFB + '.services.locationservice').LocationService
    return hs, ts, ls


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30


def link(obj, coll=None):
    (coll or bpy.context.scene.collection).objects.link(obj)
    return obj


def mesh_obj(name, bm_or_mesh, mat=None):
    if isinstance(bm_or_mesh, bmesh.types.BMesh):
        me = bpy.data.meshes.new(name)
        bm_or_mesh.to_mesh(me)
        bm_or_mesh.free()
    else:
        me = bm_or_mesh
    o = bpy.data.objects.new(name, me)
    link(o)
    if mat:
        o.data.materials.append(mat)
    return o


def select_only(*objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def apply_modifiers(o):
    select_only(o)
    for m in list(o.modifiers):
        if m.type == 'ARMATURE':
            continue
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except Exception as e:  # noqa
            print('modifier apply failed', o.name, m.name, e)
            o.modifiers.remove(m)


def shade_smooth(o, angle=None):
    for p in o.data.polygons:
        p.use_smooth = True
    if angle is not None:
        select_only(o)
        try:
            bpy.ops.object.shade_auto_smooth(angle=math.radians(angle))
        except Exception:
            pass


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def principled(name, base=None, rough=0.8, metal=0.0, color=(0.8, 0.8, 0.8, 1), normal=None, alpha=False, arm=None, normal_strength=1.0):
    """simple glTF-exportable material"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Base Color'].default_value = color
    if base:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = base if isinstance(base, bpy.types.Image) else bpy.data.images.load(base, check_existing=True)
        nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
        if alpha:
            nt.links.new(t.outputs['Alpha'], bsdf.inputs['Alpha'])
            m.blend_method = 'HASHED' if hasattr(m, 'blend_method') else None
            try:
                m.surface_render_method = 'DITHERED'
            except Exception:
                pass
    if normal:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = normal if isinstance(normal, bpy.types.Image) else bpy.data.images.load(normal, check_existing=True)
        t.image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nm.inputs['Strength'].default_value = normal_strength
        nt.links.new(t.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if arm:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = arm if isinstance(arm, bpy.types.Image) else bpy.data.images.load(arm, check_existing=True)
        t.image.colorspace_settings.name = 'Non-Color'
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(t.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
        nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    return m
