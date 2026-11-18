"""Work animations the motion library doesn't have: two-handed pickaxe (mining) and axe (chopping).

Built on the retargeted rig (T-pose rest, Unreal bone names) by layering a body lean / twist and
two-bone arm IK onto a base clip, so both hands grip the tool handle. The tool's orientation is
driven through the right hand: in the game a tool hangs off hand_r with its shaft along the model's
forward axis at bind time, which is Blender -Y here (tool 'up' = +Z).
"""
import bpy, math
from mathutils import Vector, Matrix, Quaternion
from common import smoothstep

BASE_SHAFT = Vector((0, -1, 0))
BASE_UP = Vector((0, 0, 1))


def _frame(d, u):
    d = d.normalized()
    u = (u - d * u.dot(d)).normalized()
    return Matrix((d.cross(u), d, u)).transposed()  # columns: x, y(=d), z(=u)


def _aim(rig, name, target_dir):
    """rotate a pose bone (armature space) so its Y axis points along target_dir, minimal twist"""
    pb = rig.pose.bones[name]
    M = pb.matrix.copy()
    cur = M.to_3x3().col[1].normalized()
    q = cur.rotation_difference(target_dir.normalized())
    R = q.to_matrix() @ M.to_3x3()
    pb.matrix = Matrix.Translation(M.translation) @ R.to_4x4()
    bpy.context.view_layer.update()


def _rot_global(rig, name, axis, angle):
    pb = rig.pose.bones[name]
    M = pb.matrix.copy()
    R = Matrix.Rotation(angle, 3, axis) @ M.to_3x3()
    pb.matrix = Matrix.Translation(M.translation) @ R.to_4x4()
    bpy.context.view_layer.update()


def _two_bone(rig, side, hand_target, pole):
    up, lo = rig.pose.bones[f'upperarm_{side}'], rig.pose.bones[f'lowerarm_{side}']
    a = (lo.head - up.head).length
    b = (rig.pose.bones[f'hand_{side}'].head - lo.head).length
    S = up.head.copy()
    v = hand_target - S
    d = max(1e-4, min(v.length, a + b - 1e-4))
    u = v.normalized()
    x = (a * a - b * b + d * d) / (2 * d)
    h = math.sqrt(max(0.0, a * a - x * x))
    p = (pole - u * pole.dot(u)).normalized()
    E = S + u * x + p * h
    _aim(rig, f'upperarm_{side}', E - S)
    _aim(rig, f'lowerarm_{side}', hand_target - rig.pose.bones[f'lowerarm_{side}'].head)


def _orient_hand(rig, side, shaft, up, rest_rot):
    """hand rotation so the attached tool's shaft/up follow `shaft`/`up` (armature space)"""
    pb = rig.pose.bones[f'hand_{side}']
    F1 = _frame(shaft, up)
    F0 = _frame(BASE_SHAFT, BASE_UP)
    R = F1 @ F0.inverted() @ rest_rot
    pb.matrix = Matrix.Translation(pb.matrix.translation) @ R.to_4x4()
    bpy.context.view_layer.update()


def _grip(rig, side, amount):
    for f in ('index', 'middle', 'ring', 'pinky'):
        for k in (1, 2, 3):
            n = f'{f}_0{k}_{side}'
            if n in rig.pose.bones:
                pb = rig.pose.bones[n]
                pb.rotation_quaternion = pb.rotation_quaternion @ Quaternion((1, 0, 0), amount)
    bpy.context.view_layer.update()


def build_work_clip(rig, name, base, seconds, pose_fn, fps=30):
    """pose_fn(rig, u, rest) applies the overrides for phase u in [0,1]"""
    sc = bpy.context.scene
    base_act = bpy.data.actions[base]
    n = max(2, round(seconds * fps))
    blen = base_act.frame_range[1] - base_act.frame_range[0]
    rest = {b.name: b.matrix_local.to_3x3().normalized() for b in rig.data.bones}
    frames = []
    for i in range(n + 1):
        rig.animation_data.action = base_act
        sc.frame_set(int(base_act.frame_range[0] + (i % max(1, int(blen)))))
        rig.animation_data.action = None
        pose_fn(rig, i / n, rest)
        frames.append({pb.name: (pb.rotation_quaternion.copy(), pb.location.copy()) for pb in rig.pose.bones})
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data.action = act
    prev = {}
    for i, fr in enumerate(frames):
        for pb in rig.pose.bones:
            q, loc = fr[pb.name]
            if pb.name in prev and prev[pb.name].dot(q) < 0:
                q.negate()
            prev[pb.name] = q
            pb.rotation_quaternion = q
            pb.keyframe_insert('rotation_quaternion', frame=i)
            if pb.name == 'pelvis':
                pb.location = loc
                pb.keyframe_insert('location', frame=i)
    rig.animation_data.action = None
    for pb in rig.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    return act


def _side_x(rig, side):
    return rig.data.bones[f'upperarm_{side}'].head_local.x


def _swing(rig, u, rest, *, roll, th_end, lean_max, twist_max, r=0.5):
    """overhead two-handed swing in a plane through the right shoulder, tilted by `roll` about the
    forward axis (0 = straight down in front, + = diagonal from the upper right)"""
    if u < 0.5:
        th = 1.75 + (-0.35 - 1.75) * smoothstep(0.05, 0.5, u)        # wind up over the shoulder
    elif u < 0.64:
        th = -0.35 + (th_end + 0.35) * ((u - 0.5) / 0.14) ** 1.6      # fast strike
    elif u < 0.8:
        th = th_end - 0.08 * math.sin((u - 0.64) / 0.16 * math.pi)     # impact jolt
    else:
        th = th_end - (th_end - 1.75) * smoothstep(0.8, 1.0, u)       # recover
    k = smoothstep(-0.3, th_end, th)
    xr = _side_x(rig, 'r')
    sgn = 1 if xr > 0 else -1
    lean = 0.05 + lean_max * k
    twist = sgn * twist_max * (k - 0.35)
    for n, f in (('spine_01', 0.3), ('spine_02', 0.35), ('spine_03', 0.35)):
        _rot_global(rig, n, 'X', lean * f)
        _rot_global(rig, n, 'Z', twist * f)
    _rot_global(rig, 'neck_01', 'X', -lean * 0.45)
    fwd = Vector((0, -1, 0))
    up = Matrix.Rotation(-sgn * roll, 3, 'Y') @ Vector((0, 0, 1))  # tilt the swing plane toward the right side
    P = Vector((xr * 0.35, -0.12, rig.pose.bones['upperarm_r'].head.z - 0.05))
    radial = (fwd * math.sin(th) + up * math.cos(th)).normalized()
    tangent = (fwd * math.cos(th) - up * math.sin(th)).normalized()
    H = P + radial * r
    _two_bone(rig, 'r', H, Vector((xr * 1.0, 0.3, -0.6)))
    _two_bone(rig, 'l', H - radial * 0.17, Vector((-xr * 1.0, 0.3, -0.6)))
    _orient_hand(rig, 'r', radial, tangent, rest['hand_r'])
    _orient_hand(rig, 'l', radial, tangent, rest['hand_l'])
    _grip(rig, 'r', 1.1)
    _grip(rig, 'l', 1.1)


def mine(rig, u, rest):
    """pickaxe: raise over the right shoulder, drive down into the rock in front"""
    _swing(rig, u, rest, roll=0.15, th_end=2.3, lean_max=0.62, twist_max=0.12)


def chop(rig, u, rest):
    """axe: diagonal swing from above the right shoulder into the trunk at waist height"""
    _swing(rig, u, rest, roll=0.9, th_end=1.75, lean_max=0.25, twist_max=0.5, r=0.52)


def ride(rig, u, rest):
    """astride a horse / an elephant's neck: thighs around the barrel, lower legs hanging down its sides"""
    pel = rig.pose.bones['pelvis']
    pel.location = (0, 0, 0)
    bpy.context.view_layer.update()
    w = math.sin(u * math.tau)
    _rot_global(rig, 'spine_01', 'X', 0.06 + 0.01 * w)
    for s in ('l', 'r'):
        sx = 1 if rig.data.bones[f'thigh_{s}'].head_local.x > 0 else -1
        _aim(rig, f'thigh_{s}', Vector((sx * 0.62, -0.42, -0.66)))
        _aim(rig, f'calf_{s}', Vector((sx * 0.12, 0.22, -1.0)))
        _aim(rig, f'foot_{s}', Vector((sx * 0.1, -1.0, -0.25)))


def build_all(rig):
    return [build_work_clip(rig, 'Ride_Loop', 'Sitting_Idle_Loop', 2.0, ride),
build_work_clip(rig, 'Mine_Loop', 'Idle_Loop', 1.15, mine),
            build_work_clip(rig, 'Chop_Loop', 'Idle_Loop', 1.0, chop)]
