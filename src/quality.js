// =============================================================================
// QUALIDADE AUTOMÁTICA (só no VR)
// Mede o intervalo real entre os quadros do headset. Se o jogo não está mantendo a
// taxa do aparelho (72 Hz no Quest 2), baixa um nível: menos grama/flores/milho e
// menos partículas. Se sobra folga por bastante tempo, sobe de volta.
// Nível 0 = tudo · 3 = mínimo. Fora do VR fica sempre no 0.
// =============================================================================
import { renderer } from './render.js';
import { setVegQuality } from './world.js';
import { setFxQuality } from './fx.js';

export const Q = { level: 0, ema: 0, last: 0, n: 0, slowT: 0, fastT: 0, minLevel: 0, raisedAt: -1e9, now: 0 };

function apply(level) {
  Q.level = level;
  setVegQuality(level);
  setFxQuality(level);
  console.info('[qualidade] nível', level, '· quadro médio', Q.ema.toFixed(1), 'ms');
}

export function resetQuality() {
  Q.last = 0; Q.n = 0; Q.slowT = Q.fastT = 0; Q.ema = 0;
  if (Q.level !== 0 && !renderer.xr.isPresenting) apply(0);
}

/** Chamado uma vez por quadro real com o tempo do quadro (ms). */
export function qualityFrame(time) {
  if (!renderer.xr.isPresenting) { if (Q.n) resetQuality(); return; }
  if (!Q.last) { Q.last = time; return; }
  const dt = time - Q.last;
  Q.last = time; Q.now += dt;
  if (dt <= 0 || dt > 250) return;                 // menu do sistema, headset tirado etc.
  const s = renderer.xr.getSession();
  const hz = (s && s.frameRate) || 72;
  const target = 1000 / hz;
  Q.n++;
  Q.ema = Q.n === 1 ? dt : Q.ema + (dt - Q.ema) * 0.06;
  if (Q.n < 120) return;                           // deixa estabilizar depois de entrar no VR
  if (Q.ema > target * 1.18) { Q.slowT += dt; Q.fastT = 0; }
  else if (Q.ema < target * 1.05) { Q.fastT += dt; Q.slowT = 0; }
  else { Q.slowT = 0; Q.fastT = 0; }
  if (Q.slowT > 1200 && Q.level < 3) {
    // caiu logo depois de subir: esse nível não aguenta, não tenta mais subir até ele
    if (Q.now - Q.raisedAt < 20000) Q.minLevel = Q.level + 1;
    Q.slowT = 0; apply(Q.level + 1);
  } else if (Q.fastT > 20000 && Q.level - 1 >= Q.minLevel) {
    Q.fastT = 0; Q.raisedAt = Q.now; apply(Q.level - 1);
  }
}
