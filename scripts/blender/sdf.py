"""Tiny signed-distance-field sculpting kit (numpy + scikit-image marching cubes).

Shapes are blended with smooth unions so muscles, joints and bones flow into each other.
Coordinates: metres, x lateral, f = forward, z up. Meshes are written with y = -f (the game's
Blender convention: characters face -Y).
"""
import numpy as np


class Sculpt:
    def __init__(self, lo, hi, voxel=0.008):
        self.lo = np.array(lo, np.float32)
        self.vox = voxel
        self.n = np.ceil((np.array(hi, np.float32) - self.lo) / voxel).astype(int) + 1
        self.d = np.full(self.n, 1.0, np.float32)

    def _region(self, bmin, bmax):
        i0 = np.clip(np.floor((np.array(bmin) - self.lo) / self.vox).astype(int), 0, self.n - 1)
        i1 = np.clip(np.ceil((np.array(bmax) - self.lo) / self.vox).astype(int) + 1, 0, self.n)
        sl = tuple(slice(a, b) for a, b in zip(i0, i1))
        ax = [self.lo[k] + np.arange(i0[k], i1[k], dtype=np.float32) * self.vox for k in range(3)]
        X, F, Z = np.meshgrid(*ax, indexing='ij')
        return sl, X, F, Z

    def _apply(self, d, sl, k, op):
        cur = self.d[sl]
        if op == 'add':
            if k <= 0:
                self.d[sl] = np.minimum(cur, d)
            else:
                h = np.maximum(k - np.abs(cur - d), 0) / k
                self.d[sl] = np.minimum(cur, d) - h * h * k * 0.25
        elif op == 'sub':
            if k <= 0:
                self.d[sl] = np.maximum(cur, -d)
            else:
                h = np.maximum(k - np.abs(cur + d), 0) / k
                self.d[sl] = np.maximum(cur, -d) + h * h * k * 0.25

    # ---- primitives -------------------------------------------------------------------------
    def ellipsoid(self, c, r, k=0.05, op='add', pitch=0.0, yaw=0.0):
        c = np.array(c, np.float32)
        r = np.array(r, np.float32)
        m = max(r) + 2 * k + 0.1
        sl, X, F, Z = self._region(c - m, c + m)
        x, f, z = X - c[0], F - c[1], Z - c[2]
        if pitch:  # rotate about x (positive tips the front up)
            cp, sp = np.cos(pitch), np.sin(pitch)
            f, z = f * cp + z * sp, -f * sp + z * cp
        if yaw:
            cy, sy = np.cos(yaw), np.sin(yaw)
            x, f = x * cy - f * sy, x * sy + f * cy
        k0 = np.sqrt((x / r[0]) ** 2 + (f / r[1]) ** 2 + (z / r[2]) ** 2)
        k1 = np.sqrt((x / r[0] ** 2) ** 2 + (f / r[1] ** 2) ** 2 + (z / r[2] ** 2) ** 2)
        d = k0 * (k0 - 1) / np.maximum(k1, 1e-6)
        self._apply(d, sl, k, op)

    def sphere(self, c, r, k=0.03, op='add'):
        self.ellipsoid(c, (r, r, r), k, op)

    def cone(self, a, ra, b, rb, k=0.05, op='add'):
        """round cone (capsule with different end radii) from a to b"""
        a = np.array(a, np.float32)
        b = np.array(b, np.float32)
        m = max(ra, rb) + 2 * k + 0.08
        sl, X, F, Z = self._region(np.minimum(a, b) - m, np.maximum(a, b) + m)
        P = np.stack([X - a[0], F - a[1], Z - a[2]], -1)
        ba = b - a
        l2 = float(ba @ ba)
        rr = ra - rb
        a2 = l2 - rr * rr
        il2 = 1.0 / l2
        y = P @ ba
        z = y - l2
        xv = P * l2 - y[..., None] * ba
        x2 = (xv * xv).sum(-1)
        y2 = y * y * l2
        z2 = z * z * l2
        kk = np.sign(rr) * rr * rr * x2
        d = np.where(np.sign(z) * a2 * z2 > kk, np.sqrt(x2 + z2) * il2 - rb,
                     np.where(np.sign(y) * a2 * y2 < kk, np.sqrt(x2 + y2) * il2 - ra,
                              (np.sqrt(x2 * a2 * il2) + y * rr) * il2 - ra))
        self._apply(d, sl, k, op)

    def chain(self, pts, k=0.05):
        """pts: [(point, radius), ...] joined by round cones"""
        for (a, ra), (b, rb) in zip(pts, pts[1:]):
            self.cone(a, ra, b, rb, k)

    def mirror(self, fn, *args, **kw):
        """call a primitive for x and -x (args contain points as tuples with x first)"""
        def flip(v):
            if isinstance(v, tuple) and len(v) == 3 and all(isinstance(q, (int, float)) for q in v):
                return (-v[0], v[1], v[2])
            if isinstance(v, list):
                return [flip(q) for q in v]
            if isinstance(v, tuple):
                return tuple(flip(q) for q in v)
            return v
        fn(*args, **kw)
        fn(*flip(args), **kw)

    def clip_below(self, z0=0.0):
        zs = self.lo[2] + np.arange(self.n[2], dtype=np.float32) * self.vox
        self.d = np.maximum(self.d, (z0 - zs)[None, None, :])

    def mesh(self):
        from skimage.measure import marching_cubes
        v, f, n, _ = marching_cubes(self.d, 0.0, spacing=(self.vox,) * 3)
        v = v + self.lo
        return v, f

    def save_obj(self, path):
        v, f = self.mesh()
        with open(path, 'w') as fh:
            for x, ff, z in v:
                fh.write(f'v {x:.5f} {-ff:.5f} {z:.5f}\n')
            # marching cubes winding is outward for (x,f,z); mirroring f flips handedness
            for a, b, c in f:
                fh.write(f'f {a + 1} {c + 1} {b + 1}\n')
        return len(v), len(f)
