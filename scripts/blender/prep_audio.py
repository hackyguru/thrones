"""Turns the CC0 OpenGameArt recordings into small, single-hit game sounds.

  blender -b -P scripts/blender/prep_audio.py -- <src_dir> <out_dir>

Uses Blender's bundled audio library (aud) — no ffmpeg needed. Multi-hit recordings are sliced at
their onsets, every clip is trimmed, faded, peak-normalised and written as mono MP3.
"""
import sys, os, glob, json
import numpy as np
import aud

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
os.makedirs(OUT, exist_ok=True)
RATE = 32000

# group -> (glob patterns relative to SRC, slice multi-hit files?, max clips, max seconds)
GROUPS = {
    'melee': (['sword_-_starninjas_1/*/sword.*.ogg', 'sword_clash_-_starninjas_0/sword_clash.*.ogg'], False, 12, 0.7),
    'swing': (['rpg_sound_pack/*/battle/swing*.wav'], False, 3, 0.6),
    'unsheathe': (['rpg_sound_pack/*/battle/sword-unsheathe*.wav'], False, 4, 0.9),
    'chop': (['workshop/workshop/workshop - wood on wood thuds.wav', 'workshop/workshop/workshop - wood clap*.wav', 'workshop/workshop/workshop - wood on concrete.wav'], True, 8, 0.45),
    'mine': (['workshop/workshop/workshop - clink thud.wav', 'workshop/workshop/workshop - metal tapping.wav', 'workshop/workshop/workshop - dull pings*.wav', 'workshop/workshop/workshop - metal hammering 2.wav'], True, 8, 0.45),
    'build': (['workshop/workshop/workshop - wood hammering.wav', 'workshop/workshop/workshop - dull hammering.wav', 'workshop/workshop/workshop - low hammering.wav'], True, 8, 0.4),
    'ui': (['rpg_sound_pack/*/interface/interface*.wav'], False, 6, 0.5),
    'coins': (['workshop/workshop/workshop - jingle*.wav', 'rpg_sound_pack/*/inventory/beads.wav'], True, 4, 0.6),
    'cloth': (['rpg_sound_pack/*/inventory/cloth*.wav'], False, 2, 0.6),
    'collapse': (['workshop/workshop/workshop - loud clatter.wav', 'workshop/workshop/workshop - wood clatter.wav'], False, 2, 2.2),
    'drop': (['rpg_sound_pack/*/inventory/wood-small.wav', 'workshop/workshop/workshop - metal drop*.wav'], False, 3, 0.7),
}


def load(path):
    s = aud.Sound(path).resample(RATE, False)
    d = s.data()
    if d.ndim == 2:
        d = d.mean(axis=1)
    return d.astype(np.float32)


def rms_env(d, hop):
    n = len(d) // hop
    if n < 2:
        return np.array([float(np.sqrt((d ** 2).mean() + 1e-12))])
    f = d[: n * hop].reshape(n, hop)
    return np.sqrt((f ** 2).mean(axis=1) + 1e-12)


def slices(d, max_s, multi):
    hop = int(RATE * 0.01)
    env = rms_env(d, hop)
    peak = env.max()
    if not multi:
        on = int(np.argmax(env > peak * 0.08))
        return [d[max(0, on * hop - hop): on * hop + int(max_s * RATE)]]
    thr = peak * 0.18
    out = []
    i = 1
    while i < len(env):
        if env[i] > thr and env[i] > env[i - 1] * 1.8:
            start = max(0, (i - 1) * hop)
            j = i + 3
            while j < len(env) and not (env[j] > thr and env[j] > env[j - 1] * 1.8):
                j += 1
            end = min(j * hop, start + int(max_s * RATE))
            if end - start > int(0.06 * RATE):
                out.append(d[start:end])
            i = j
        else:
            i += 1
    return out


def finish(c, tail=0.02):
    # trim trailing silence, short fades, normalise to -2 dBFS
    hop = int(RATE * 0.01)
    env = rms_env(c, hop)
    keep = np.where(env > env.max() * tail)[0]
    if len(keep):
        c = c[: (keep[-1] + 1) * hop]
    n = len(c)
    fi, fo = min(n, int(0.003 * RATE)), min(n, int(0.04 * RATE))
    c = c.copy()
    c[:fi] *= np.linspace(0, 1, fi)
    c[n - fo:] *= np.linspace(1, 0, fo)
    p = np.abs(c).max()
    if p > 0:
        c *= 0.79 / p
    return c


manifest = {}
for group, (pats, multi, max_n, max_s) in GROUPS.items():
    files = sorted({f for p in pats for f in glob.glob(os.path.join(SRC, p))})
    clips = []
    for f in files:
        for c in slices(load(f), max_s, multi):
            clips.append((float(np.abs(c).max() * len(c)), c))
    # prefer the strongest, most distinct hits
    clips.sort(key=lambda x: -x[0])
    names = []
    for k, (_, c) in enumerate(clips[:max_n]):
        c = finish(c, 0.004 if group in ('swing', 'collapse', 'unsheathe', 'coins') else 0.02)
        name = f'{group}_{k}.mp3'
        snd = aud.Sound.buffer(c.reshape(-1, 1), RATE)
        snd.write(os.path.join(OUT, name), rate=RATE, channels=aud.CHANNELS_MONO, format=aud.FORMAT_S16,
                  container=aud.CONTAINER_MP3, codec=aud.CODEC_MP3, bitrate=96000)
        names.append(name)
    manifest[group] = names
    print('AUDIO', group, len(files), 'files ->', len(names), 'clips')
with open(os.path.join(OUT, 'sounds.json'), 'w') as fh:
    json.dump(manifest, fh, indent=1)
