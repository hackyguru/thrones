/** Single-player save slot in the browser: gzip-compressed match state in localStorage. */
const KEY = 'thrones.save';
/** uncompressed match JSON written on page unload (kept as its own item to avoid double escaping) */
const RAW = 'thrones.save.raw';

export interface SaveMeta {
  date: number;
  civ: string;
  minutes: number;
  /** camera focus when saved */
  cam?: [number, number];
  /** guided first game: the step reached */
  tut?: number;
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
  localStorage.removeItem(RAW);
}

/** Synchronous, uncompressed write for page unload, when async compression would not finish. */
export function writeSaveNow(json: string, meta: SaveMeta): void {
  // raw first: if it does not fit, the previous compressed save stays valid
  localStorage.setItem(RAW, json);
  localStorage.setItem(KEY, JSON.stringify({ meta, raw: true }));
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(RAW);
  } catch {
    /* storage unavailable */
  }
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
    if (!raw) return null;
    const d = JSON.parse(raw) as { data?: string; raw?: boolean };
    if (d.raw) return localStorage.getItem(RAW);
    return d.data ? await gunzip(d.data) : null;
  } catch {
    return null;
  }
}
