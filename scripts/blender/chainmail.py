"""Generates the tileable chainmail texture (diff/nor/arm) used by the mail pieces. Needs numpy + Pillow.
   python3 scripts/blender/chainmail.py <out_dir>"""
import sys, os
import numpy as np
from PIL import Image

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
N, rings = 512, 8
y, x = np.mgrid[0:N, 0:N].astype(np.float32)
H = np.zeros((N, N), np.float32)
s = N / rings
R, w = s * 0.62, s * 0.13
for row in range(-1, rings * 2 + 2):
    for col in range(-1, rings + 2):
        cx, cy = col * s + (s / 2 if row % 2 else 0), row * s * 0.5 + s * 0.25
        for dx in (-N, 0, N):
            for dy in (-N, 0, N):
                d = np.sqrt((x - cx - dx) ** 2 + (y - cy - dy) ** 2)
                prof = np.clip(1 - ((d - R) / w) ** 2, 0, 1)
                H = np.maximum(H, np.sqrt(prof) * (0.6 + 0.4 * (row % 2)))
gap = H < 0.05
diff = 0.25 + 0.6 * H
diff[gap] = 0.05
gy, gx = np.gradient(H * 6)
n = np.dstack([-gx, -gy, np.ones_like(H)])
n /= np.linalg.norm(n, axis=2, keepdims=True)
Image.fromarray((np.dstack([diff] * 3) * 255).astype(np.uint8)).save(os.path.join(out, 'diff.jpg'), quality=92)
Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8)).save(os.path.join(out, 'nor.jpg'), quality=92)
arm = np.dstack([np.where(gap, 0.3, 1.0), np.full_like(H, 0.45), np.ones_like(H)])
Image.fromarray((arm * 255).astype(np.uint8)).save(os.path.join(out, 'arm.jpg'), quality=92)
