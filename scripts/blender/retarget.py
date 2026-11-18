"""Retarget the Quaternius Universal Animation Library (Unreal skeleton, T-pose) onto the MPFB
game_engine rig (Unreal bone names, A-pose) by matching bone directions, then transferring
world-space rotation deltas frame by frame."""
import bpy, math
from mathutils import Vector, Matrix, Quaternion

# source name -> target name (identical Unreal naming except these)
RENAME = {'Head': 'head', 'root': 'Root'}
# preferred child used to measure each bone's direction
AIM = {
    'pelvis': 'spine_01', 'spine_01': 'spine_02', 'spine_02': 'spine_03', 'spine_03': 'neck_01', 'neck_01': 'head',
    'clavicle_l': 'upperarm_l', 'upperarm_l': 'lowerarm_l', 'lowerarm_l': 'hand_l', 'hand_l': 'middle_01_l',
    'clavicle_r': 'upperarm_r', 'upperarm_r': 'lowerarm_r', 'lowerarm_r': 'hand_r', 'hand_r': 'middle_01_r',
    'thigh_l': 'calf_l', 'calf_l': 'foot_l', 'foot_l': 'ball_l', 'thigh_r': 'calf_r', 'calf_r': 'foot_r', 'foot_r': 'ball_r',
}
for s in 'lr':
    for f in ('thumb', 'index', 'middle', 'ring', 'pinky'):
        AIM[f'{f}_01_{s}'] = f'{f}_02_{s}'
        AIM[f'{f}_02_{s}'] = f'{f}_03_{s}'


_SRC_BONES = set()


def _src_name(t):
    if t in _SRC_BONES:
        return t
    for k, v in RENAME.items():
        if v == t:
            return k
    return t


def _order(arm):
    out = []

    def walk(b):
        out.append(b.name)
        for c in b.children:
            walk(c)

    for b in arm.data.bones:
        if b.parent is None:
            walk(b)
    return out


def _dir(arm, name, aim_name):
    bones = arm.data.bones
    if aim_name and aim_name in bones:
        return (bones[aim_name].head_local - bones[name].head_local).normalized()
    return None


def reference_pose(src, tgt, order, tmap, Rtr):
    """target bones swung (hierarchically) to point like the source rest pose"""
    tb = tgt.data.bones
    Rref = {}
    for n in order:
        b = tb[n]
        if b.parent is None:
            Rinh = Rtr[n]
        else:
            p = b.parent.name
            Rinh = Rref[p] @ Rtr[p].inverted() @ Rtr[n]
        aim = AIM.get(n)
        s = tmap.get(n)
        dt = _dir(tgt, n, aim)
        ds = _dir(src, s, _src_name(aim) if aim else None) if s else None
        if dt is not None and ds is not None:
            dcur = (Rinh @ Rtr[n].inverted()) @ dt
            q = dcur.rotation_difference(ds)
            Rref[n] = q.to_matrix() @ Rinh
        else:
            Rref[n] = Rinh
    return Rref


def to_tpose(src, tgt, meshes):
    """re-rest the target rig (and bake its meshes) in the source rig's T-pose"""
    sb, tb = src.data.bones, tgt.data.bones
    _SRC_BONES.clear()
    _SRC_BONES.update(sb.keys())
    order = _order(tgt)
    tmap = {n: _src_name(n) for n in order if _src_name(n) in sb}
    Rtr = {n: tb[n].matrix_local.to_3x3().normalized() for n in order}
    Mtr = {n: tb[n].matrix_local.copy() for n in order}
    Rref = reference_pose(src, tgt, order, tmap, Rtr)
    M = {}
    for n in order:
        b = tb[n]
        if b.parent is None:
            pos = Mtr[n].translation.copy()
        else:
            p = b.parent.name
            pos = (M[p] @ Mtr[p].inverted() @ Mtr[n]).translation
        M[n] = Matrix.Translation(pos) @ Rref[n].to_4x4()
    for n in order:
        b = tb[n]
        pb = tgt.pose.bones[n]
        pb.rotation_mode = 'QUATERNION'
        if b.parent is None:
            basis = Mtr[n].inverted() @ M[n]
        else:
            p = b.parent.name
            basis = (Mtr[p].inverted() @ Mtr[n]).inverted() @ M[p].inverted() @ M[n]
        loc, q, _ = basis.decompose()
        pb.location = loc
        pb.rotation_quaternion = q
    bpy.context.view_layer.update()
    for o in meshes:
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        mods = [m for m in o.modifiers if m.type == 'ARMATURE']
        for m in mods:
            bpy.ops.object.modifier_apply(modifier=m.name)
        m = o.modifiers.new('Armature', 'ARMATURE')
        m.object = tgt
    bpy.ops.object.select_all(action='DESELECT')
    tgt.select_set(True)
    bpy.context.view_layer.objects.active = tgt
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def retarget(src, tgt, clips, frame_step=1.0, src_prefix='src_'):
    """src/tgt: armature objects with identity object transforms. clips: action names on src.
    Creates one action per clip on tgt (named like the clip)."""
    sb, tb = src.data.bones, tgt.data.bones
    _SRC_BONES.clear()
    _SRC_BONES.update(sb.keys())
    order = [n for n in _order(tgt)]
    tmap = {n: _src_name(n) for n in order if _src_name(n) in sb}

    Rsr = {n: sb[n].matrix_local.to_3x3().normalized() for n in sb.keys()}
    Rtr = {n: tb[n].matrix_local.to_3x3().normalized() for n in order}
    Mtr = {n: tb[n].matrix_local.copy() for n in order}

    Rref = reference_pose(src, tgt, order, tmap, Rtr)

    hip_s = sb['pelvis'].head_local.z
    hip_t = tb['pelvis'].head_local.z
    k = hip_t / hip_s
    src_pelvis_rest = sb['pelvis'].head_local.copy()

    scene = bpy.context.scene
    tgt.animation_data_create()
    made = []
    for clip in clips:
        act_s = bpy.data.actions.get(src_prefix + clip) or bpy.data.actions.get(clip)
        if act_s is None:
            print('missing clip', clip)
            continue
        src.animation_data.action = act_s
        try:
            if act_s.slots and src.animation_data.action_slot is None:
                src.animation_data.action_slot = act_s.slots[0]
        except Exception:
            pass
        f0, f1 = act_s.frame_range
        act_t = bpy.data.actions.new(clip)
        act_t.use_fake_user = True
        tgt.animation_data.action = act_t
        for pb in tgt.pose.bones:
            pb.rotation_mode = 'QUATERNION'
        prevq = {}
        f = f0
        frames = []
        while f <= f1 + 1e-4:
            frames.append(f)
            f += frame_step
        if frames[-1] < f1 - 1e-3:
            frames.append(f1)
        for i, fr in enumerate(frames):
            fi = int(math.floor(fr))
            scene.frame_set(fi, subframe=fr - fi)
            M = {}
            for n in order:
                b = tb[n]
                s = tmap.get(n)
                if s:
                    Rs = src.pose.bones[s].matrix.to_3x3().normalized()
                    R = Rs @ Rsr[s].inverted() @ Rref[n]
                else:
                    R = None
                if b.parent is None:
                    pos = Mtr[n].translation.copy()
                    if R is None:
                        R = Rtr[n]
                else:
                    p = b.parent.name
                    pos = (M[p] @ Mtr[p].inverted() @ Mtr[n]).translation
                    if R is None:
                        R = M[p].to_3x3() @ Rtr[p].inverted() @ Rtr[n]
                if n == 'pelvis':
                    d = src.pose.bones['pelvis'].matrix.translation - src_pelvis_rest
                    pos = Mtr[n].translation + d * k
                M[n] = Matrix.Translation(pos) @ R.to_4x4()
            for n in order:
                b = tb[n]
                pb = tgt.pose.bones[n]
                if b.parent is None:
                    basis = Mtr[n].inverted() @ M[n]
                else:
                    p = b.parent.name
                    basis = (Mtr[p].inverted() @ Mtr[n]).inverted() @ M[p].inverted() @ M[n]
                loc, q, _ = basis.decompose()
                if n in prevq and prevq[n].dot(q) < 0:
                    q.negate()
                prevq[n] = q
                pb.rotation_quaternion = q
                pb.keyframe_insert('rotation_quaternion', frame=fr - f0)
                if n == 'pelvis':
                    pb.location = loc
                    pb.keyframe_insert('location', frame=fr - f0)
        # reset pose for next clip
        for pb in tgt.pose.bones:
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.location = (0, 0, 0)
        made.append(act_t)
    tgt.animation_data.action = None
    return made
