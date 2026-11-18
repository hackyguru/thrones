import './style.css';
import { App } from './app';

import { preloadAssets } from './render/assets';
import { loadCharacters } from './render/characters';
import { loadMounts } from './render/mounts';

const params = new URLSearchParams(location.search);
const boot = document.createElement('div');
boot.className = 'boot';
boot.innerHTML = '<div class="boot-title">Thrones</div><div class="boot-bar"><i></i></div><div class="boot-note">Gathering the treasures of the empire…</div>';
document.body.appendChild(boot);
const bar = boot.querySelector('i') as HTMLElement;
await Promise.all([
  preloadAssets((p) => (bar.style.width = `${Math.round(p * 100)}%`)),
  loadCharacters().catch((e) => console.warn('characters unavailable, using procedural figures', e)),
  loadMounts().catch((e) => console.warn('mounts unavailable, using procedural animals', e)),
]);
boot.classList.add('fade');
setTimeout(() => boot.remove(), 700);

if (import.meta.env.DEV && params.has('gallery')) {
  void import('./dev/gallery').then((m) => m.startGallery(document.getElementById('stage')!, (params.get('gallery') || 'mughal') as never, params.get('view') ?? ''));
} else {
  new App(document.getElementById('stage')!, document.getElementById('ui')!).start();
}
