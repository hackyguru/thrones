/** Single-player save slot in the browser: gzip-compressed match state in localStorage. */
const KEY = 'thrones.save';

export interface SaveMeta {
  date: number;
  civ: string;
  minutes: number;
}

async function gzip(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

async function gunzip(b64: string): Promise<string> {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export async function writeSave(json: string, meta: SaveMeta): Promise<void> {
  const data = await gzip(json);
  localStorage.setItem(KEY, JSON.stringify({ meta, data }));
}

export function saveMeta(): SaveMeta | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw).meta as SaveMeta) : null;
  } catch {
    return null;
  }
}

export async function readSave(): Promise<string | null> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? await gunzip(JSON.parse(raw).data) : null;
  } catch {
    return null;
  }
}
