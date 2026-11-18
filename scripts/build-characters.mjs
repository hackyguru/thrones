#!/usr/bin/env node
/**
 * Builds the game's humans with Blender (free, GPL) + the MPFB extension (MakeHuman, CC0 assets).
 *
 *   node scripts/build-characters.mjs            # needs Blender 5.x with MPFB + MakeHuman system assets
 *   BLENDER=/path/to/blender node scripts/build-characters.mjs
 *
 * One-time setup (macOS example):
 *   - Blender 5.x from https://www.blender.org/download/ (here: ~/Applications/Blender.app)
 *   - MPFB:   blender --command extension install-file -r user_default -e add-on-mpfb-v2.x.zip
 *             (https://extensions.blender.org/add-ons/mpfb/)
 *   - MakeHuman CC0 system assets unzipped into MPFB's user data dir (…/extensions/.user/user_default/mpfb/data):
 *             https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip
 *   - Poly Haven fabric/leather/metal scans (CC0) are fetched below into ~/thrones-tools/src/tex
 *
 * Output: packages/client/public/assets/characters/{soldier.glb, anims.glb, skins/*.jpg}
 * Source: scripts/blender/*.py (garments, baking, retargeting, weapons).
 */
import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'packages/client/public/assets/characters');
const TOOLS = join(homedir(), 'thrones-tools/src');
const BLENDER = process.env.BLENDER || join(homedir(), 'Applications/Blender.app/Contents/MacOS/Blender');
const UA = { 'User-Agent': 'thrones-asset-fetch' };
const UAL_URL = 'https://raw.githubusercontent.com/DyingStar-game/DyingStar/HEAD/assets/Universal%20Animation%20Library/Unreal-Godot/UAL1_Standard.glb';
const SCANS = ['cotton_jersey', 'rough_linen', 'hessian_380', 'crepe_satin', 'floral_jacquard', 'brown_leather', 'metal_plate_02'];

async function get(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

await mkdir(TOOLS, { recursive: true });
const ual = join(TOOLS, 'UAL1_Standard.glb');
if (!existsSync(ual)) await writeFile(ual, await get(UAL_URL));
for (const id of SCANS) {
  const dir = join(TOOLS, 'tex', id);
  if (existsSync(join(dir, 'diff.jpg'))) continue;
  await mkdir(dir, { recursive: true });
  const files = JSON.parse((await get(`https://api.polyhaven.com/files/${id}`)).toString());
  const pick = (k) => files[k]?.['2k']?.jpg?.url;
  for (const [k, url] of Object.entries({ diff: pick('Diffuse'), nor: pick('nor_gl'), arm: pick('arm') || pick('Rough') }))
    if (url) await writeFile(join(dir, `${k}.jpg`), await get(url));
  console.log('scan', id);
}
if (!existsSync(join(TOOLS, 'tex/chainmail/diff.jpg')))
  execFileSync('python3', [join(ROOT, 'scripts/blender/chainmail.py'), join(TOOLS, 'tex/chainmail')], { stdio: 'inherit' });

await mkdir(OUT, { recursive: true });
if (!process.argv.includes('--credits-only'))
{
  execFileSync(BLENDER, ['-b', '--python', join(ROOT, 'scripts/blender/build_soldiers.py'), '--', OUT, ual], { stdio: 'inherit' });
  // RTS-distance detail: halve the triangles (borders locked so body regions stay sealed, names kept)
  const full = join(TOOLS, 'soldier_full.glb');
  await rename(join(OUT, 'soldier.glb'), full);
  execFileSync(join(ROOT, 'node_modules/.bin/gltfpack'), ['-i', full, '-o', join(OUT, 'soldier.glb'), '-si', '0.45', '-slb', '-noq', '-kn', '-km'], { stdio: 'inherit' });
}

// mounts: SDF-sculpted horse and Indian elephant, rigged, baked and animated in Blender
if (!process.argv.includes('--credits-only')) {
  const work = join(TOOLS, 'mounts');
  await mkdir(work, { recursive: true });
  execFileSync('python3', [join(ROOT, 'scripts/blender/shape_horse.py'), join(work, 'horse.obj')], { stdio: 'inherit' });
  execFileSync('python3', [join(ROOT, 'scripts/blender/shape_elephant.py'), join(work, 'elephant.obj')], { stdio: 'inherit' });
  execFileSync(BLENDER, ['-b', '--python', join(ROOT, 'scripts/blender/build_animals.py'), '--', OUT, join(work, 'horse.obj'), join(work, 'elephant.obj')], { stdio: 'inherit' });
}

const credits = join(ROOT, 'ASSETS.md');
let txt = existsSync(credits) ? await readFile(credits, 'utf8') : '';
txt = txt.replace(/\n## Characters[\s\S]*$/, '');
txt +=
  `\n## Characters\n\nBuilt by \`node scripts/build-characters.mjs\` in [Blender](https://www.blender.org) (GPL tool; output is ours).\n\n` +
  `| In game | Source | Author | License |\n|---|---|---|---|\n` +
  `| human body, face, skin, eyes, eyebrows, hair | MakeHuman system assets via [MPFB](https://extensions.blender.org/add-ons/mpfb/) | [MakeHuman Community](http://www.makehumancommunity.org) | CC0 |\n` +
  `| animations (anims.glb, retargeted) | Universal Animation Library (Standard) | [Quaternius](https://quaternius.com/packs/universalanimationlibrary.html) | CC0 |\n` +
  `| garment fabric / leather / metal detail | ${SCANS.map((s) => `[${s}](https://polyhaven.com/a/${s})`).join(', ')} | Poly Haven | CC0 |\n` +
  `| garments, turbans, armour, weapons, facial hair, chainmail | generated by scripts/blender/*.py | Thrones | project license |\n` +
  `| horse, elephant, tack and their animations | sculpted and animated by scripts/blender/shape_*.py, build_animals.py | Thrones | project license |\n`;
await writeFile(credits, txt);
console.log('characters built →', OUT);
