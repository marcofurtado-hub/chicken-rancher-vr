// =============================================================================
// MAIN — liga tudo: espera as fontes, cria o botão de VR, conecta a tela inicial.
// =============================================================================
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { renderer, isTouch } from './render.js';
import { G, saveSettings } from './core.js';
import { initAudio, setVolumes } from './audio.js';
import { boot, startGame, setTestWave } from './game.js';
import { lockPointer, openWavePick } from './player.js';
import { playerName, setPlayerName, refreshHtmlRanking } from './ranking.js';

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
  el.dataset.set = key;
  el.addEventListener('input', () => {
    S[key] = el.value / 100; saveSettings(); apply();
    for (const o of document.querySelectorAll('input[data-set="' + key + '"]')) if (o !== el) o.value = el.value;   // menu e pause andam juntos
  });
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
bindRange('set-mouse', 'mouse', () => {});
// os mesmos ajustes dentro do PAUSE
bindRange('p-music', 'music', applyVol);
bindRange('p-sfx', 'sfx', applyVol);
bindRange('p-mouse', 'mouse', () => {});
{ const ps = document.getElementById('p-set'); if (ps) ps.addEventListener('click', e => e.stopPropagation()); }
bindToggle('set-vig', () => S.vignette, () => { S.vignette = !S.vignette; });
bindToggle('set-turn', () => S.turn === 'snap', () => { S.turn = S.turn === 'snap' ? 'smooth' : 'snap'; });

// Nome do jogador (vai para o ranking local e mundial)
const nameEl = document.getElementById('pname');
if (nameEl) {
  const saved = localStorage.getItem('cr_name');
  if (saved) { try { nameEl.value = JSON.parse(saved) || ''; } catch (e) {} }
  nameEl.addEventListener('input', () => setPlayerName(nameEl.value));
  for (const ev of ['click', 'keydown', 'keyup', 'mousedown', 'touchstart']) nameEl.addEventListener(ev, e => e.stopPropagation());
}

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
// Código secreto: escolher a wave inicial (PC: digite OVOS · celular: 5 toques no título · VR: B+Y no menu · ?wave=N)
for (const b of document.querySelectorAll('#wavepick button')) b.addEventListener('click', e => { e.stopPropagation(); setTestWave(+b.dataset.w); });
let titleTaps = 0, titleT = 0;
document.querySelector('#start h1').addEventListener('click', e => {
  e.stopPropagation();
  const now = performance.now();
  titleTaps = now - titleT < 900 ? titleTaps + 1 : 1; titleT = now;
  if (titleTaps >= 5) { titleTaps = 0; openWavePick(); }
});

fontsReady.then(() => {
  boot();
  const qw = new URLSearchParams(location.search).get('wave') || new URLSearchParams(location.search).get('onda');
  if (qw && +qw >= 1) { openWavePick(); setTestWave((+qw | 0) - 1); }
  applyVol();
  document.body.classList.add('ready');
  if (isTouch) document.getElementById('cta').textContent = document.getElementById('cta').dataset.touch || document.getElementById('cta').textContent;
});
