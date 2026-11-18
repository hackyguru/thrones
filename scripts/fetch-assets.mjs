#!/usr/bin/env node
/**
 * Downloads the free, public-domain (CC0) art used by Thrones and prepares it for the game.
 *
 *   node scripts/fetch-assets.mjs          # fetch anything missing
 *   node scripts/fetch-assets.mjs --force  # re-download everything
 *
 * Sources (all CC0 1.0 — no attribution required, credited anyway in ASSETS.md):
 *   - Poly Haven  https://polyhaven.com   — PBR materials, HDRI sky, photo-scanned models
 *   - ambientCG   https://ambientcg.com   — photographed leaf / grass atlases
 * Scanned models are simplified to game-ready polygon counts with gltfpack (meshoptimizer, MIT).
 */
import { mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'packages/client/public/assets');
const FORCE = process.argv.includes('--force');
const UA = { 'User-Agent': 'thrones-asset-fetch' };

/** game material name -> Poly Haven texture id */
const TEXTURES = {
  ground_grass: 'sparse_grass',
  ground_dry: 'dry_ground_01',
  ground_dirt: 'red_laterite_soil_stones',
  ground_sand: 'coast_sand_01',
  sandstone: 'sandstone_blocks_08',
  sandstone_large: 'large_sandstone_blocks',
  red_sandstone: 'red_sandstone_wall',
  red_sandstone_floor: 'red_sandstone_pavement',
  marble: 'marble_01',
  marble_floor: 'marble_tiles',
  plaster: 'plastered_wall_04',
  clay_plaster: 'clay_plaster',
  granite: 'granite_wall',
  basalt: 'rustic_stone_wall',
  stone_floor: 'stone_tiles_02',
  roof_tiles: 'clay_roof_tiles_02',
  thatch: 'thatch_roof_angled',
  wood: 'medieval_wood',
  planks: 'wood_plank_wall',
  bark: 'bark_brown_02',
  rock: 'rock_face',
};

/** game model name -> [Poly Haven model id, simplification ratio] */
const MODELS = {
  boulder: ['boulder_01', 0.03],
  boulder_brown: ['namaqualand_boulder_02', 0.02],
  rock_small: ['rock_07', 0.12],
  stones: ['namaqualand_stones_01', 0.03],
  barrels: ['wooden_barrels_01', 0.12],
  crate: ['wooden_crate_01', 0.5],
  basket: ['wicker_basket_01', 0.15],
  brass_pot: ['brass_pot_01', 0.6],
  clay_pot: ['planter_pot_clay', 0.6],
  log: ['dead_tree_trunk', 0.03],
};

const HDRI = ['kloppenheim_06_puresky', '1k'];

/** ambientCG atlases (photographed leaves / blades with opacity) */
const ATLASES = ['LeafSet024', 'LeafSet030', 'Foliage001', 'Foliage006'];

const credits = [];

async function get(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}
async function json(url) {
  return JSON.parse((await get(url)).toString());
}
async function save(path, buf) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buf);
}
const have = (p) => !FORCE && existsSync(p);

async function textures() {
  for (const [name, id] of Object.entries(TEXTURES)) {
    const dir = join(OUT, 'tex', name);
    credits.push(`| ${name} | [${id}](https://polyhaven.com/a/${id}) | Poly Haven | CC0 |`);
    if (have(join(dir, 'diff.jpg'))) continue;
    const files = await json(`https://api.polyhaven.com/files/${id}`);
    const pick = (k) => files[k]?.['1k']?.jpg?.url;
    const maps = { diff: pick('Diffuse'), nor: pick('nor_gl'), arm: pick('arm') };
    if (!maps.arm) maps.rough = pick('Rough');
    for (const [k, url] of Object.entries(maps)) if (url) await save(join(dir, `${k}.jpg`), await get(url));
    console.log('texture', name, '<-', id);
  }
}

async function hdri() {
  const [id, res] = HDRI;
  credits.push(`| sky | [${id}](https://polyhaven.com/a/${id}) | Poly Haven | CC0 |`);
  const p = join(OUT, 'hdri', 'sky.hdr');
  if (have(p)) return;
  const files = await json(`https://api.polyhaven.com/files/${id}`);
  await save(p, await get(files.hdri[res].hdr.url));
  console.log('hdri', id);
}

async function models() {
  const gltfpack = join(ROOT, 'node_modules/.bin/gltfpack');
  for (const [name, [id, ratio]] of Object.entries(MODELS)) {
    credits.push(`| ${name} | [${id}](https://polyhaven.com/a/${id}) | Poly Haven | CC0 |`);
    const out = join(OUT, 'models', `${name}.glb`);
    if (have(out)) continue;
    const files = await json(`https://api.polyhaven.com/files/${id}`);
    const g = files.gltf['1k'].gltf;
    const tmp = join(tmpdir(), `thrones-${id}`);
    await rm(tmp, { recursive: true, force: true });
    await save(join(tmp, `${id}.gltf`), await get(g.url));
    for (const [rel, f] of Object.entries(g.include)) await save(join(tmp, rel), await get(f.url));
    await mkdir(dirname(out), { recursive: true });
    // simplify geometry, keep jpg textures embedded in a single .glb
    execFileSync(gltfpack, ['-i', join(tmp, `${id}.gltf`), '-o', out, '-si', String(ratio), '-sa', '-noq'], { stdio: 'inherit' });
    await rm(tmp, { recursive: true, force: true });
    console.log('model', name, '<-', id, `(${((await stat(out)).size / 1024).toFixed(0)} KB)`);
  }
}

async function atlases() {
  for (const id of ATLASES) {
    credits.push(`| ${id} | [${id}](https://ambientcg.com/view?id=${id}) | ambientCG | CC0 |`);
    const dir = join(OUT, 'foliage', id);
    if (have(join(dir, 'color.png'))) continue;
    const zip = await get(`https://ambientcg.com/get?file=${id}_1K-PNG.zip`);
    const tmp = join(tmpdir(), `thrones-${id}`);
    await rm(tmp, { recursive: true, force: true });
    await save(join(tmp, 'a.zip'), zip);
    execFileSync('unzip', ['-oq', join(tmp, 'a.zip'), '-d', tmp]);
    await mkdir(dir, { recursive: true });
    for (const [src, dst] of [['Color', 'color'], ['Opacity', 'opacity'], ['NormalGL', 'normal']])
      await writeFile(join(dir, `${dst}.png`), await readFile(join(tmp, `${id}_1K-PNG_${src}.png`)));
    await rm(tmp, { recursive: true, force: true });
    console.log('atlas', id);
  }
}

await textures();
await hdri();
await atlases();
await models();
await writeFile(
  join(ROOT, 'ASSETS.md'),
  `# Third-party art\n\nAll assets are **CC0 1.0 (public domain)**, fetched by \`node scripts/fetch-assets.mjs\`.\n` +
    `Scanned models were simplified with [gltfpack](https://github.com/zeux/meshoptimizer) for real-time use.\n\n` +
    `| In game | Source asset | Library | License |\n|---|---|---|---|\n${credits.join('\n')}\n`,
);
try {
  execFileSync('python3', [join(ROOT, 'scripts/optimize-assets.py')], { stdio: 'inherit' });
} catch {
  console.warn('optimize-assets.py failed (needs python3 + Pillow); assets left unoptimized');
}
console.log('done →', OUT);
