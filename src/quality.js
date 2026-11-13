// =============================================================================
// QUALIDADE AUTOMÁTICA (VR, PC e celular)
// Mede o intervalo real entre os quadros. Se o jogo não está mantendo a taxa
// (72 Hz no Quest 2; ~45+ fps no PC/celular), baixa um nível: menos grama/flores/milho,
// menos partículas e — fora do VR — menos pixels (pixel ratio). Com folga por bastante
// tempo, sobe de volta. Nível 0 = tudo · 3 = mínimo.
// =============================================================================
import { renderer, isTouch } from './render.js';
import { setVegQuality } from './world.js';
import { setFxQuality } from './fx.js';

export const Q = { level: 0, ema: 0, last: 0, n: 0, slowT: 0, fastT: 0, minLevel: 0, raisedAt: -1e9, now: 0, xr: false };
const BASE_PR = Math.min(devicePixelRatio || 1, isTouch ? 1.5 : 2);
const PR_MUL = [1, 0.85, 0.72, 0.6];

function apply(level) {
  Q.level = level;
  setVegQuality(level);
  setFxQuality(level);
  if (!renderer.xr.isPresenting) renderer.setPixelRatio(BASE_PR * PR_MUL[level]);
  console.info('[qualidade] nível', level, Q.xr ? '(VR)' : '(tela)', '· quadro médio', Q.ema.toFixed(1), 'ms');
}
function restart() { Q.last = 0; Q.n = 0; Q.slowT = Q.fastT = 0; Q.ema = 0; Q.minLevel = 0; }

/** Chamado uma vez por quadro real com o tempo do quadro (ms). */
export function qualityFrame(time) {
  const xr = renderer.xr.isPresenting;
  if (xr !== Q.xr) {   // entrou/saiu do VR: recomeça a medição do zero
    Q.xr = xr; restart();
    if (Q.level !== 0) apply(0);
  }
  if (!Q.last) { Q.last = time; return; }
  const dt = time - Q.last;
  Q.last = time; Q.now += dt;
  if (dt <= 0 || dt > 250) return;                 // aba escondida, menu do sistema, headset tirado
  let target;
  if (xr) { const s = renderer.xr.getSession(); target = 1000 / ((s && s.frameRate) || 72); }
  else target = 1000 / 60;
  const slowK = xr ? 1.18 : 1.35, fastK = xr ? 1.05 : 1.08;   // fora do VR tolera até ~45 fps
  Q.n++;
  Q.ema = Q.n === 1 ? dt : Q.ema + (dt - Q.ema) * 0.06;
  if (Q.n < 120) return;                           // deixa estabilizar
  if (Q.ema > target * slowK) { Q.slowT += dt; Q.fastT = 0; }
  else if (Q.ema < target * fastK) { Q.fastT += dt; Q.slowT = 0; }
  else { Q.slowT = 0; Q.fastT = 0; }
  if (Q.slowT > (xr ? 1200 : 2000) && Q.level < 3) {
    if (Q.now - Q.raisedAt < 20000) Q.minLevel = Q.level + 1;   // caiu logo depois de subir: não tenta mais
    Q.slowT = 0; apply(Q.level + 1);
  } else if (Q.fastT > 20000 && Q.level - 1 >= Q.minLevel) {
    Q.fastT = 0; Q.raisedAt = Q.now; apply(Q.level - 1);
  }
}
