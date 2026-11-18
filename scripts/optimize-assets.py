#!/usr/bin/env python3
"""Shrinks fetched assets for fast browser loading (run after fetch-assets.mjs).

- PBR textures: re-encoded JPEG (albedo 1024, normal 1024, ARM 512)
- foliage atlases: colour + opacity merged into one RGBA WebP
- .glb models: embedded textures resized to 512 and re-encoded, buffers repacked
Idempotent: files already optimized are skipped (tracked in .optimized).
"""
import io, json, os, struct, sys
from PIL import Image, ImageFile
ImageFile.LOAD_TRUNCATED_IMAGES = True  # a few CDN files end a handful of bytes early

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'packages/client/public/assets')
STAMP = os.path.join(OUT, '.optimized')
done = set(open(STAMP).read().split('\n')) if os.path.exists(STAMP) else set()


def jpeg(img, q):
    b = io.BytesIO()
    img.convert('RGB').save(b, 'JPEG', quality=q, optimize=True, progressive=True)
    return b.getvalue()


def textures():
    base = os.path.join(OUT, 'tex')
    for name in sorted(os.listdir(base)):
        for f, size, q in (('diff.jpg', 1024, 82), ('nor.jpg', 1024, 86), ('arm.jpg', 512, 80), ('rough.jpg', 512, 80)):
            p = os.path.join(base, name, f)
            key = f'tex/{name}/{f}'
            if not os.path.exists(p) or key in done:
                continue
            img = Image.open(p)
            if img.width > size:
                img = img.resize((size, size), Image.LANCZOS)
            buf = jpeg(img, q)
            open(p, 'wb').write(buf)
            done.add(key)


def foliage():
    base = os.path.join(OUT, 'foliage')
    for name in sorted(os.listdir(base)):
        d = os.path.join(base, name)
        out = os.path.join(d, 'atlas.webp')
        if os.path.exists(out) and f'foliage/{name}' in done:
            continue
        col = Image.open(os.path.join(d, 'color.png')).convert('RGB')
        op = Image.open(os.path.join(d, 'opacity.png')).convert('L')
        rgba = col.copy()
        rgba.putalpha(op)
        rgba.save(out, 'WEBP', quality=88, method=6)
        nrm = Image.open(os.path.join(d, 'normal.png')).convert('RGB')
        nrm.resize((512, 512), Image.LANCZOS).save(os.path.join(d, 'normal.webp'), 'WEBP', quality=85)
        for f in ('color.png', 'opacity.png', 'normal.png'):
            os.remove(os.path.join(d, f))
        done.add(f'foliage/{name}')


def glb(path):
    data = open(path, 'rb').read()
    magic, ver, _ = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67
    off = 12
    js = binc = None
    while off < len(data):
        ln, typ = struct.unpack_from('<II', data, off)
        chunk = data[off + 8: off + 8 + ln]
        if typ == 0x4E4F534A:
            js = json.loads(chunk)
        elif typ == 0x004E4942:
            binc = chunk
        off += 8 + ln
    views = js['bufferViews']
    image_views = {img['bufferView']: img for img in js.get('images', []) if 'bufferView' in img}
    new_bin = bytearray()
    for i, v in enumerate(views):
        raw = binc[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']]
        if i in image_views:
            img = Image.open(io.BytesIO(raw))
            has_alpha = img.mode in ('RGBA', 'LA')
            if max(img.size) > 512:
                img = img.resize((512, int(512 * img.height / img.width)), Image.LANCZOS)
            if has_alpha:
                b = io.BytesIO()
                img.save(b, 'PNG', optimize=True)
                raw = b.getvalue()
                image_views[i]['mimeType'] = 'image/png'
            else:
                raw = jpeg(img, 82)
                image_views[i]['mimeType'] = 'image/jpeg'
        while len(new_bin) % 4:
            new_bin.append(0)
        v['byteOffset'] = len(new_bin)
        v['byteLength'] = len(raw)
        new_bin += raw
    while len(new_bin) % 4:
        new_bin.append(0)
    js['buffers'][0]['byteLength'] = len(new_bin)
    jb = json.dumps(js, separators=(',', ':')).encode()
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(new_bin))
    out += struct.pack('<II', len(jb), 0x4E4F534A) + jb + struct.pack('<II', len(new_bin), 0x004E4942) + bytes(new_bin)
    open(path, 'wb').write(out)


def models():
    base = os.path.join(OUT, 'models')
    for f in sorted(os.listdir(base)):
        key = f'models/{f}'
        if f.endswith('.glb') and key not in done:
            glb(os.path.join(base, f))
            done.add(key)


textures()
foliage()
models()
open(STAMP, 'w').write('\n'.join(sorted(k for k in done if k)))
print('optimized')
