// =============================================================================
// MAIN — liga tudo: espera as fontes, cria o botão de VR, conecta a tela inicial.
// =============================================================================
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { renderer, isTouch } from './render.js';
import { G, saveSettings } from './core.js';
import { initAudio, setVolumes } from './audio.js';
import { boot, startGame } from './game.js';
import { lockPointer } from './player.js';

// Botão "ENTRAR NO VR" (só aparece se o navegador suporta)
if ('xr' in navigator) {
  try {
    const vrBtn = VRButton.createButton(renderer);
    document.getElementById('vr-slot').appendChild(vrBtn);
    navigator.xr.isSessionSupported('immersive-vr')
      .then(ok => { if (!ok) document.getElementById('vr-slot').style.display = 'none'; else document.body.classList.add('has-vr'); })
      .catch(() => { document.getElementById('vr-slot').style.display = 'none'; });
  } catch (e) { if (window.__showErr) window.__showErr('VRButton: ' + (e.message || e)); }
}

// Configurações da tela inicial
const S = G.settings;
function bindRange(id, key, apply) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = Math.round(S[key] * 100);
  el.addEventListener('input', () => { S[key] = el.value / 100; saveSettings(); apply(); });
  el.addEventListener('click', e => e.stopPropagation());
}
function bindToggle(id, get, set) {
  const el = document.getElementById(id);
  if (!el) return;
  const paint = () => { el.classList.toggle('on', !!get()); el.textContent = get() ? 'ON' : 'OFF'; };
  paint();
  el.addEventListener('click', e => { e.stopPropagation(); set(); saveSettings(); paint(); });
}
const applyVol = () => setVolumes({ music: S.music, sfx: S.sfx });
bindRange('set-music', 'music', applyVol);
bindRange('set-sfx', 'sfx', applyVol);
bindToggle('set-vig', () => S.vignette, () => { S.vignette = !S.vignette; });
bindToggle('set-turn', () => S.turn === 'snap', () => { S.turn = S.turn === 'snap' ? 'smooth' : 'snap'; });

// Jogar no PC / celular
const startEl = document.getElementById('start');
document.getElementById('cta').addEventListener('click', e => {
  e.stopPropagation();
  initAudio(); applyVol();
  startEl.style.display = 'none';
  lockPointer();
  setTimeout(startGame, 150);
});
for (const el of document.querySelectorAll('#start a, #start button:not(#cta), #start input')) el.addEventListener('click', e => e.stopPropagation());
document.getElementById('pause').addEventListener('click', () => lockPointer());

// Espera as fontes (os textos 3D são desenhados em canvas) e começa
const fontsReady = document.fonts && document.fonts.load
  ? Promise.race([Promise.all([document.fonts.load('40px "Lilita One"'), document.fonts.load('800 20px "Nunito"'), document.fonts.load('700 20px "Nunito"')]), new Promise(r => setTimeout(r, 2500))])
  : Promise.resolve();
fontsReady.then(() => {
  boot();
  applyVol();
  document.body.classList.add('ready');
  if (isTouch) document.getElementById('cta').textContent = document.getElementById('cta').dataset.touch || document.getElementById('cta').textContent;
});
