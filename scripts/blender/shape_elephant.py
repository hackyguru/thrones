"""Indian elephant (Elephas maximus, ~2.6 m at the shoulder) as an SDF sculpture: twin-domed head,
convex back, smaller ears than the African species, long trunk with a curled tip, column legs.

  python3 scripts/blender/shape_elephant.py <out.obj>
"""
import sys
from sdf import Sculpt


def elephant(voxel=0.012):
    S = Sculpt((-1.05, -1.6, -0.01), (1.05, 2.2, 3.1), voxel)
    E, C, P = S.ellipsoid, S.cone, S.sphere
    # --- body ---
    E((0, 0.0, 1.78), (0.62, 1.02, 0.72), k=0)
    S.chain([((0, -0.75, 2.15), 0.38), ((0, 0.1, 2.38), 0.4), ((0, 0.7, 2.3), 0.33)], k=0.3)  # convex back
    E((0, 0.05, 1.32), (0.56, 0.8, 0.4), k=0.25)        # belly
    E((0, -0.85, 1.82), (0.56, 0.42, 0.62), k=0.22)     # rump
    for s in (1, -1):
        E((s * 0.36, 0.66, 1.72), (0.3, 0.36, 0.55), k=0.2)   # shoulder
        E((s * 0.36, -0.78, 1.75), (0.3, 0.4, 0.58), k=0.2)   # thigh
    # --- head ---
    E((0, 1.2, 2.32), (0.5, 0.48, 0.58), k=0.3)           # skull
    E((0, 1.52, 2.28), (0.32, 0.16, 0.34), k=0.14)        # forehead
    for s in (1, -1):
        E((s * 0.19, 1.3, 2.8), (0.22, 0.26, 0.19), k=0.16)    # twin domes
        E((s * 0.33, 1.34, 2.02), (0.2, 0.26, 0.28), k=0.16)   # cheek
        P((s * 0.43, 1.45, 2.3), 0.032, k=0.02, op='sub')       # eye
        E((s * 0.41, 1.5, 2.36), (0.07, 0.07, 0.03), k=0.05)   # brow
        # ear: a broad thin flap hanging from the side of the head
        E((s * 0.56, 1.0, 2.12), (0.04, 0.42, 0.52), k=0.05, yaw=-s * 0.3)
    E((0, 1.48, 1.74), (0.14, 0.14, 0.1), k=0.1)          # lower lip
    # --- trunk, hanging and curling forward at the tip ---
    S.chain([((0, 1.6, 2.2), 0.22), ((0, 1.76, 1.8), 0.155), ((0, 1.82, 1.3), 0.115), ((0, 1.78, 0.8), 0.085),
             ((0, 1.74, 0.38), 0.065), ((0, 1.82, 0.14), 0.055), ((0, 1.95, 0.12), 0.045)], k=0.08)
    # --- legs: columns with a heavy foot pad and toenails ---
    for s in (1, -1):
        x = s * 0.36
        S.chain([((x, 0.66, 1.4), 0.29), ((x, 0.7, 0.8), 0.235), ((x, 0.7, 0.3), 0.225), ((x, 0.72, 0.1), 0.24)], k=0.05)
        E((x, 0.73, 0.1), (0.25, 0.26, 0.11), k=0.06)
        S.chain([((x, -0.78, 1.45), 0.31), ((x, -0.74, 0.85), 0.24), ((x, -0.72, 0.3), 0.22), ((x, -0.7, 0.1), 0.235)], k=0.05)
        E((x, -0.69, 0.1), (0.24, 0.25, 0.11), k=0.06)
    # --- tail ---
    S.chain([((0, -1.24, 2.05), 0.07), ((0, -1.34, 1.45), 0.035), ((0, -1.32, 1.0), 0.025)], k=0.06)
    S.clip_below(0.0)
    return S


if __name__ == '__main__':
    print('elephant verts/faces', elephant().save_obj(sys.argv[1]))
