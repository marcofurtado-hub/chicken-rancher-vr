// =============================================================================
// CHICKEN RANCHER MOBILE — versão curta, pensada primeiro para o celular.
// Reaproveita o jogo inteiro de `src/` (mundo, naves, chefes, armas, som) e troca
// só o que muda no celular:
//   · a partida (3 waves, 3 chefes, 3 armas: ver setup.js);
//   · o controle (dois polegares: o esquerdo olha, o direito atira com um gesto por arma);
//   · a interface (HUD grande, melhorias e fim de partida em HTML, setas de aviso na borda).
// Nenhum arquivo de `src/` é editado.
// =============================================================================
import './setup.js';   // PRIMEIRO: troca as tabelas de config antes do resto carregar
import { THREE, renderer, scene, camera, camPos, camDir } from '../src/render.js';
import { G, clamp, fmt, saveSettings, MAX_CHICKENS, comboMult } from '../src/core.js';
import { initAudio, setVolumes, sfx } from '../src/audio.js';
import { boot, gameLoop, startGame, resetGame, setPaused } from '../src/game.js';
import { playerInput as P, applyPcView, pausable } from '../src/player.js';
import { LB } from '../src/ranking.js';
import { tr } from '../src/i18n.js';
import { WAVES, WEAPONS, WEAPON_TIPS, BOSSES, POWERS, RARITY } from '../src/config.js';
import { showBanner, hideBanner } from '../src/fx.js';
import { forEachAimable, castSegment } from '../src/combat.js';
import { cards } from '../src/skills.js';
import { fireUltimate, desktopShoot, weaponState, projs, BAL, THROW } from '../src/weapons.js';
import { chickens, chickensAlive } from '../src/chickens.js';
import { ufos, isAlive } from '../src/ufos.js';

const $ = id => document.getElementById(id);
const S = G.settings;

// Ovos mais "espertos" que no jogo principal: no celular a mira é o polegar, não o mouse.
// Também voam mais rápido e reto: menos tempo no ar = a nave não sai do lugar antes do ovo chegar.
THROW.hands.magnet = 3; THROW.hands.vmax = 18;
Object.assign(THROW.slingshot, { magnet: 3, vmin: 19, k: 1.5 });
BAL.gatling.magnet = 1.2;

// =============================================================================
// CONTROLE DE DOIS POLEGARES (o rancheiro fica parado na varanda)
//   metade ESQUERDA da tela → direcional de OLHAR (aparece onde o polegar encosta)
//   metade DIREITA da tela  → ATIRAR, com um gesto para cada arma:
//       🥚 ovos na mão  → DESLIZAR o dedo na direção da nave (arremesso)
//       🎯 estilingue   → PUXAR para trás e SOLTAR (um alvo amarelo mostra onde o ovo vai)
//       🔥 gatling      → SEGURAR (arrastar ajusta a mira)
// Todo gesto tem ajuda de mira: polegar não é mouse.
// =============================================================================
const YAW0 = Math.PI, YAW_MAX = 1.3, PITCH_MIN = -0.6, PITCH_MAX = 1.25;
const STICK_R = 54, STICK_DEAD = 0.12, YAW_RATE = 2.3, PITCH_RATE = 1.6;   // direcional de olhar (px · rad/s)
const TAP_MOVE = 14;                                  // menos que isso é toque, não gesto
const FLICK_CONE = 0.25, CENTER_CONE = 0.3;            // arremesso: quanto o deslize pode errar a direção da nave (rad)
const PULL_MAX = 130, PULL_REF = 55, PULL_GX = 2.2, PULL_GY = 3.6, PULL_CONE = 0.1;   // estilingue
const ASSIST_CONE = 0.13, ASSIST_RATE = 0.9;          // gatling: a mira gruda um pouco (rad · rad/s)
const LOOK = { id: null, x0: 0, y0: 0, x: 0, y: 0 };
const FIRE = { id: null, x0: 0, y0: 0, x: 0, y: 0, t0: 0, g: '', pulled: false };
const IN = { key: false, snap: null, dragAng: 0, friction: 1, locked: false, pending: null, uses: 0 };
const SA = { sx: 0, sy: 0, locked: false, charge: 0, fx: 0, fy: 0, aim: new THREE.Vector3(), vel: new THREE.Vector3() };   // mira do estilingue

const combatOn = () => (G.state === 'playing' || G.state === 'wave_intro') && !G.paused;
const lookOn = () => G.state !== 'idle' && !G.paused;
const gesture = () => G.weapon === 'hands' ? 'flick' : G.weapon === 'slingshot' ? 'pull' : 'hold';
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
function setView(yaw, pitch) {
  P.yaw = YAW0 + clamp(wrap(yaw - YAW0), -YAW_MAX, YAW_MAX);
  P.pitch = clamp(pitch, PITCH_MIN, PITCH_MAX);
  applyPcView();
}
/** radianos por pixel com a mira andando o mesmo que o dedo (vale em pé e deitado) */
const radPerPx = () => Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / (innerHeight / 2) * (S.mouse || 1.3) / 1.3;

const pad = $('pad');
pad.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  initAudio();
  const Z = e.clientX < innerWidth * 0.5 ? LOOK : FIRE;
  if (Z.id !== null) return;
  try { pad.setPointerCapture(e.pointerId); } catch (err) {}
  Z.id = e.pointerId; Z.x0 = Z.x = e.clientX; Z.y0 = Z.y = e.clientY;
  if (Z === FIRE) { FIRE.t0 = performance.now(); FIRE.pulled = false; FIRE.g = combatOn() ? gesture() : ''; }
});
pad.addEventListener('pointermove', e => {
  const Z = e.pointerId === LOOK.id ? LOOK : e.pointerId === FIRE.id ? FIRE : null;
  if (!Z) return;
  const dx = e.clientX - Z.x, dy = e.clientY - Z.y;
  Z.x = e.clientX; Z.y = e.clientY;
  if (Z === LOOK) {   // o direcional acompanha o polegar se ele passar da borda
    const ox = Z.x - Z.x0, oy = Z.y - Z.y0, m = Math.hypot(ox, oy);
    if (m > STICK_R) { Z.x0 += ox * (1 - STICK_R / m); Z.y0 += oy * (1 - STICK_R / m); }
  } else if (FIRE.g === 'hold' && lookOn()) {   // gatling: arrastar o polegar que atira ajusta a mira
    const s = radPerPx() * IN.friction;
    IN.snap = null; IN.dragAng += Math.hypot(dx, dy) * s;
    setView(P.yaw - dx * s, P.pitch - dy * s);
  } else if (FIRE.g === 'pull' && !FIRE.pulled && Math.hypot(Z.x - Z.x0, Z.y - Z.y0) > 22) { FIRE.pulled = true; sfx('slingPull'); vibrate(10); }
});
function endPointer(e) {
  if (e.pointerId === LOOK.id) { LOOK.id = null; return; }
  if (e.pointerId !== FIRE.id) return;
  FIRE.id = null;
  if (e.type === 'pointerup' && combatOn() && FIRE.g === gesture()) release(FIRE.g);
}
pad.addEventListener('pointerup', endPointer);
pad.addEventListener('pointercancel', endPointer);
pad.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('gesturestart', e => e.preventDefault());

// Teclado (para testar no computador): Espaço atira na mira, R chuva de ovos, Esc/P pausa.
// A captura impede que as teclas cheguem ao jogo principal (nada de andar com WASD nem trocar de arma).
addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT') return;
  e.stopImmediatePropagation();
  if (e.repeat) return;
  if (e.code === 'Space') { IN.key = true; e.preventDefault(); }
  if (e.code === 'KeyR') fireUltimate();
  if (e.code === 'Escape' || e.code === 'KeyP') { if (G.paused) setPaused(false); else if (pausable()) setPaused(true); }
}, true);
addEventListener('keyup', e => { e.stopImmediatePropagation(); if (e.code === 'Space') IN.key = false; }, true);
addEventListener('wheel', e => e.stopImmediatePropagation(), { capture: true, passive: true });

// ---------- do dedo para o mundo ----------
const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2();
const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _best = new THREE.Vector3(), _aim = new THREE.Vector3(), _vel = new THREE.Vector3();
const _s = { x: 0, y: 0 };
let _bestU = null, _bestC = null, _bestPt = null;
function snapToDir(d) { IN.snap = { yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(clamp(d.y, -1, 1)) }; }
function snapToPoint(p) { snapToDir(_d.copy(p).sub(camPos).normalize()); }
/** direção do mundo que passa por um ponto da tela */
function screenRay(sx, sy, out) {
  _ndc.set((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1);
  _ray.setFromCamera(_ndc, camera);
  return out.copy(_ray.ray.direction);
}
/** ponto da tela (px) de um ponto do mundo; false se está atrás da câmera */
function toScreen(c, out) {
  if (_p.copy(c).sub(camPos).dot(camDir) < 0.2) return false;
  _p.copy(c).project(camera);
  out.x = (_p.x + 1) / 2 * innerWidth; out.y = (1 - _p.y) / 2 * innerHeight;
  return true;
}
/** ponto do mundo numa direção: o que estiver na frente, senão o chão, senão 22 m (distância típica de combate) */
function aimAlong(dir, out) {
  const hit = castSegment(camPos, dir, 80, 0.25);
  let d = 22;
  if (hit && hit.kind !== 'ui') d = Math.max(1.5, hit.t);
  else if (dir.y < -0.03) d = clamp((0.1 - camPos.y) / dir.y, 2, 44);
  return out.copy(camPos).addScaledVector(dir, d);
}
/** Alvo (nave, tiro inimigo, caixa) mais perto de uma direção, dentro de um cone. Devolve o ângulo ou -1. */
function nearestTarget(dir, cone, out) {
  let best = cone, found = false;
  _bestU = null;
  forEachAimable((c, u, pt) => {
    _v.copy(c).sub(camPos);
    const dl = _v.length();
    if (dl < 1.2 || dl > 80) return;
    let a = Math.acos(clamp(_v.dot(dir) / dl, -1, 1));
    if (pt && pt.kind === 'crit') a *= 0.7;   // ponto fraco puxa mais
    if (a < best) { best = a; out.copy(c); _bestU = u; _bestC = c; _bestPt = pt; found = true; }
  });
  return found ? best : -1;
}
/** Alvo que está na linha do deslize (em pixels da tela): o arremesso vai nele. */
function flickTarget(x0, y0, dx, dy, out) {
  let best = FLICK_CONE, found = false;
  _bestU = null;
  forEachAimable((c, u, pt) => {
    if (!toScreen(c, _s)) return;
    const rx = _s.x - x0, ry = _s.y - y0, along = rx * dx + ry * dy;
    if (along < 12) return;
    let dev = Math.atan2(Math.abs(rx * dy - ry * dx), along);
    if (pt && pt.kind === 'crit') dev *= 0.75;
    if (dev < best) { best = dev; out.copy(c); _bestU = u; _bestC = c; _bestPt = pt; found = true; }
  });
  return found;
}
/**
 * Agenda um tiro num ponto do mundo. Se a arma ainda está recarregando, ele sai assim que der (até 0,4 s).
 * `home`: o gesto escolheu um alvo (nave na linha do deslize / alvo amarelo do estilingue) → o ovo persegue esse alvo,
 * porque a nave anda em zigue-zague enquanto o ovo voa e o polegar não tem como compensar isso.
 */
function shootAt(aim, vel, mod, home) {
  IN.pending = { aim: aim.clone(), vel: vel ? vel.clone() : new THREE.Vector3(), mod: mod || null, home: home || null, t: 0.4 };
  IN.uses++;
}
/** O último alvo achado por nearestTarget/flickTarget, no formato que o ovo teleguiado do jogo entende. */
function lockOf() {
  const c = _bestC, u = _bestU, pt = _bestPt;
  return { c, valid: () => (u ? isAlive(u) && (!pt || pt.active) : true) };
}
const velOf = u => (u && u._vel ? _vel.copy(u._vel) : _vel.set(0, 0, 0));
/** Onde o estilingue está apontando agora (puxar para baixo = mais longe/alto; para os lados = lado oposto). */
function slingAim() {
  let px = FIRE.x - FIRE.x0, py = FIRE.y - FIRE.y0;
  const len = Math.hypot(px, py);
  if (len > PULL_MAX) { px *= PULL_MAX / len; py *= PULL_MAX / len; }
  SA.fx = FIRE.x0 + px; SA.fy = FIRE.y0 + py;
  SA.charge = clamp((Math.min(len, PULL_MAX) - 18) / 32, 0, 1);   // 50 px de puxão já é força total
  SA.sx = clamp(innerWidth / 2 - px * PULL_GX, 16, innerWidth - 16);
  SA.sy = clamp(innerHeight / 2 - (py - PULL_REF) * PULL_GY, 60, innerHeight - 40);
  screenRay(SA.sx, SA.sy, _d);
  SA.locked = nearestTarget(_d, PULL_CONE, _best) >= 0;
  if (SA.locked) { SA.aim.copy(_best); SA.vel.copy(velOf(_bestU)); if (toScreen(_best, _s)) { SA.sx = _s.x; SA.sy = _s.y; } }
  else { aimAlong(_d, SA.aim); SA.vel.set(0, 0, 0); }
  return SA;
}
/** O polegar direito soltou a tela: dispara o gesto da arma. */
function release(g) {
  const dx = FIRE.x - FIRE.x0, dy = FIRE.y - FIRE.y0, len = Math.hypot(dx, dy);
  if (g === 'hold') return;
  if (len < TAP_MOVE) {   // toque simples: atira na nave mais perto do meio da tela (ou reto para a frente)
    camera.getWorldDirection(_d);
    if (nearestTarget(_d, CENTER_CONE, _best) >= 0) shootAt(_best, velOf(_bestU), null, lockOf()); else shootAt(aimAlong(_d, _aim), null);
    return;
  }
  if (g === 'flick') {
    const ux = dx / len, uy = dy / len;
    const speed = len / Math.max(0.05, (performance.now() - FIRE.t0) / 1000);   // px/s
    const k = clamp((speed - 300) / 1800, 0, 1);                               // deslize rápido = ovo mais rápido e reto
    const mod = { k: 1.3 + 0.5 * k, vmin: 11 + 4 * k };
    if (flickTarget(FIRE.x0, FIRE.y0, ux, uy, _best)) { shootAt(_best, velOf(_bestU), mod, lockOf()); return; }
    const L = clamp(len * 2.6, 200, Math.max(innerWidth, innerHeight));
    screenRay(clamp(FIRE.x0 + ux * L, 8, innerWidth - 8), clamp(FIRE.y0 + uy * L, 8, innerHeight - 8), _d);
    shootAt(aimAlong(_d, _aim), null, mod);
  } else if (g === 'pull') {
    slingAim();
    shootAt(SA.aim, SA.vel, { dmg: 0.7 + 0.8 * SA.charge, scale: 1 + 0.35 * SA.charge }, SA.locked ? lockOf() : null);   // puxão cheio: ovo maior, dano 3
    vibrate(15);
  }
}

/** Antes de cada quadro do jogo: aplica os polegares na câmera e nas armas. */
function pre(dt) {
  if (G.paused) { P.mouseDown = false; return; }
  const combat = combatOn();
  if (IN.snap) {   // seta tocada: a visão corre até lá
    const dy = wrap(IN.snap.yaw - P.yaw), dp = IN.snap.pitch - P.pitch;
    const k = 1 - Math.exp(-24 * dt);
    if (Math.hypot(dy, dp) < 0.015 || k >= 1) { setView(IN.snap.yaw, IN.snap.pitch); IN.snap = null; }
    else setView(P.yaw + dy * k, P.pitch + dp * k);
  }
  // direcional de olhar: quanto mais longe do centro, mais rápido gira
  if (LOOK.id !== null && lookOn()) {
    const vx = (LOOK.x - LOOK.x0) / STICK_R, vy = (LOOK.y - LOOK.y0) / STICK_R, m = Math.hypot(vx, vy);
    if (m > STICK_DEAD) {
      const k = Math.pow(Math.min(1, (m - STICK_DEAD) / (1 - STICK_DEAD)), 1.6) / m * (S.mouse || 1.3) / 1.3 * IN.friction * dt;
      IN.snap = null;
      setView(P.yaw - vx * k * YAW_RATE, P.pitch - vy * k * PITCH_RATE);
    }
  }
  // gatling (segurar): a mira fica mais "pesada" em cima de um alvo e é puxada devagar para ele
  const hold = (FIRE.id !== null && FIRE.g === 'hold') || IN.key;
  IN.friction = 1; IN.locked = false;
  if (combat && !IN.snap && gesture() === 'hold') {
    camera.getWorldDirection(_d);
    const hit = castSegment(camPos, _d, 80, 0.2);
    IN.locked = !!hit && hit.kind !== 'ui';
    if (hold) {
      if (IN.locked) IN.friction = 0.6;
      const a = nearestTarget(_d, ASSIST_CONE, _best);
      const fast = dt > 0 && IN.dragAng / dt > 1.4;   // arrastando rápido: o jogador quer sair daqui
      if (a > 0.004 && !fast) {
        _v.copy(_best).sub(camPos).normalize();
        const f = Math.min(1, ASSIST_RATE * (1 - a / ASSIST_CONE) * dt / a);
        setView(P.yaw + wrap(Math.atan2(-_v.x, -_v.z) - P.yaw) * f, P.pitch + (Math.asin(clamp(_v.y, -1, 1)) - P.pitch) * f);
      }
    }
  }
  IN.dragAng = 0;
  P.mouseDown = hold && combat;
  // tiro agendado por um gesto (arremesso ou estilingue)
  const q = IN.pending;
  if (q) {
    if (!combat || G.weapon === 'gatling') IN.pending = null;
    else if (weaponState.cd <= 0) {
      const T = THROW.hands, k0 = T.k, v0 = T.vmin, n0 = projs.length;
      if (q.mod && q.mod.k) { T.k = q.mod.k; T.vmin = q.mod.vmin; }
      desktopShoot(q.aim, q.vel);
      T.k = k0; T.vmin = v0;
      for (let i = n0; i < projs.length; i++) {
        if (q.mod && q.mod.dmg) { projs[i].damage *= q.mod.dmg; projs[i].scale *= q.mod.scale; }
        if (q.home) projs[i].homing = { target: q.home };
      }
      IN.pending = null;
    } else if ((q.t -= dt) <= 0) IN.pending = null;
  }
}

// ---------- desenho dos gestos (direcional, rastro do arremesso, elástico do estilingue) ----------
const NS = 'http://www.w3.org/2000/svg';
const svg = document.createElementNS(NS, 'svg');
svg.id = 'gest';
document.body.appendChild(svg);
function mk(tag, cls, attrs) { const el = document.createElementNS(NS, tag); el.setAttribute('class', cls); for (const k in attrs) el.setAttribute(k, attrs[k]); el.style.display = 'none'; svg.appendChild(el); return el; }
const gRing = mk('circle', 'g-ring', { r: STICK_R }), gKnob = mk('circle', 'g-knob', { r: 25 });
const gTrail = mk('line', 'g-trail'), gBandL = mk('line', 'g-band'), gBandR = mk('line', 'g-band');
const gForkL = mk('circle', 'g-fork', { r: 7 }), gForkR = mk('circle', 'g-fork', { r: 7 }), gHold = mk('circle', 'g-hold', { r: 42 });
const gEgg = $('g-egg'), gAim = $('g-aim'), zl = $('zl'), zr = $('zr');
const vis = (el, on) => { const d = on ? '' : 'none'; if (el.style.display !== d) el.style.display = d; };
const at = (el, a, b, x, y) => { el.setAttribute(a, x.toFixed(1)); el.setAttribute(b, y.toFixed(1)); };
function line(el, x1, y1, x2, y2) { at(el, 'x1', 'y1', x1, y1); at(el, 'x2', 'y2', x2, y2); }
function updateGest() {
  const combat = combatOn(), look = LOOK.id !== null && lookOn(), g = FIRE.id !== null && combat ? FIRE.g : '';
  vis(gRing, look); vis(gKnob, look);
  if (look) { at(gRing, 'cx', 'cy', LOOK.x0, LOOK.y0); at(gKnob, 'cx', 'cy', LOOK.x, LOOK.y); }
  const moved = Math.hypot(FIRE.x - FIRE.x0, FIRE.y - FIRE.y0);
  vis(gTrail, g === 'flick' && moved > 6);
  if (g === 'flick') line(gTrail, FIRE.x0, FIRE.y0, FIRE.x, FIRE.y);
  const pull = g === 'pull';
  vis(gBandL, pull); vis(gBandR, pull); vis(gForkL, pull); vis(gForkR, pull);
  gEgg.classList.toggle('show', pull);
  gAim.classList.toggle('show', pull && moved >= TAP_MOVE);
  if (pull) {
    slingAim();
    at(gForkL, 'cx', 'cy', FIRE.x0 - 20, FIRE.y0); at(gForkR, 'cx', 'cy', FIRE.x0 + 20, FIRE.y0);
    line(gBandL, FIRE.x0 - 20, FIRE.y0, SA.fx, SA.fy); line(gBandR, FIRE.x0 + 20, FIRE.y0, SA.fx, SA.fy);
    const col = SA.charge >= 1 ? '#ffd040' : '#ffffff';
    gBandL.style.stroke = gBandR.style.stroke = col;
    gEgg.style.transform = 'translate(' + SA.fx.toFixed(0) + 'px,' + SA.fy.toFixed(0) + 'px) scale(' + (1 + 0.3 * SA.charge).toFixed(2) + ')';
    gAim.style.transform = 'translate(' + SA.sx.toFixed(0) + 'px,' + SA.sy.toFixed(0) + 'px)';
    gAim.classList.toggle('on', SA.locked);
  }
  vis(gHold, g === 'hold');
  if (g === 'hold') at(gHold, 'cx', 'cy', FIRE.x, FIRE.y);
  // marcas dos dois polegares quando a tela está solta
  zl.classList.toggle('show', combat && LOOK.id === null);
  zr.classList.toggle('show', combat && FIRE.id === null);
}

// =============================================================================
// HUD
// =============================================================================
const mh = $('mh'), cross = $('m-cross'), ultBtn = $('mb-ult'), pauseBtn = $('mb-pause'), hintEl = $('hint'), bossEl = $('mh-boss');
const cache = {};
function put(id, html) { if (cache[id] !== html) { cache[id] = html; $(id).innerHTML = html; } }
const hpColor = p => p <= 0.3 ? '#ff3a4a' : p <= 0.6 ? '#ff9a40' : '#ff5a80';
const run = { t: 0, hp: 100, chk: 0, hintWave: -1, hintT: 0 };
// dica do gesto da arma (aparece no começo de cada wave até o gesto ser usado 3 vezes)
const HINTS = {
  flick: ['☝️', tr('DESLIZE o dedo na direção da nave', 'SWIPE toward the saucer', 'PYYHKÄISE lautasta kohti'), tr('polegar esquerdo: olhar em volta', 'left thumb: look around', 'vasen peukalo: katsele ympärille')],
  pull: ['👇', tr('PUXE pra trás e SOLTE', 'PULL back and RELEASE', 'VEDÄ taakse ja PÄÄSTÄ'), tr('o alvo amarelo mostra onde o ovo vai', 'the yellow target shows where the egg goes', 'keltainen tähtäin näyttää minne muna lentää')],
  hold: ['👉', tr('SEGURE o dedo pra atirar', 'HOLD to shoot', 'PIDÄ sormea ampuaksesi'), tr('arraste pra ajustar a mira', 'drag to adjust your aim', 'vedä hienosäätääksesi tähtäystä')],
};
const ZONE = { flick: ['🥚', tr('DESLIZE', 'SWIPE', 'PYYHKÄISE')], pull: ['🎯', tr('PUXE E SOLTE', 'PULL & RELEASE', 'VEDÄ JA PÄÄSTÄ')], hold: ['🔥', tr('SEGURE', 'HOLD', 'PIDÄ')] };
let hudT = 0;
function updateHud(dt) {
  const st = G.state, live = st !== 'idle';
  const combat = st === 'playing' || st === 'wave_intro';
  mh.classList.toggle('show', live && st !== 'victory' && st !== 'game_over');
  // a mira do meio da tela só vale para a gatling; no estilingue ela é o ponto de um puxão reto (e some enquanto você puxa)
  const gs = gesture();
  cross.classList.toggle('show', combat && (gs === 'hold' || (gs === 'pull' && FIRE.id === null)));
  cross.classList.toggle('small', gs === 'pull');
  cross.classList.toggle('on', IN.locked);
  cross.classList.toggle('hit', G.hitMarkT > 0);
  hudT -= dt;
  if (hudT > 0) return;
  hudT = 0.1;
  ultBtn.classList.toggle('show', combat);
  pauseBtn.classList.toggle('show', pausable() && st !== 'upgrade');
  if (combat && run.hintWave !== G.wave) { run.hintWave = G.wave; run.hintT = 14; IN.uses = 0; }
  if (st === 'playing') run.hintT -= 0.1;
  if (FIRE.id !== null && FIRE.g === 'hold') IN.uses += 0.2;   // segurar por 1,5 s conta como "aprendeu"
  hintEl.classList.toggle('show', combat && run.hintT > 0 && IN.uses < 3);
  put('hint', '<b>' + HINTS[gs][0] + '</b>' + HINTS[gs][1] + '<small>' + HINTS[gs][2] + '</small>');
  put('zr', '<b>' + ZONE[gs][0] + '</b>' + ZONE[gs][1]);
  if (!live) { bossEl.classList.remove('show'); return; }
  put('mh-score', fmt(G.score));
  put('mh-wave', tr('WAVE ', 'WAVE ', 'AALTO ') + Math.min(G.wave + 1, WAVES.length) + '/' + WAVES.length);
  const cm = comboMult(), ce = $('mh-combo');
  put('mh-combo', 'COMBO x' + cm);
  ce.classList.toggle('on', G.combo >= 2 && cm > 1);
  const alive = chickensAlive(), chk = $('mh-chk');
  put('mh-chk', '🐔 <b>' + alive + '</b><small>/' + MAX_CHICKENS + '</small>');
  chk.className = 'chip' + (alive <= 2 ? ' bad' : alive <= 4 ? ' warn' : '');
  const hp = clamp(G.hp / G.hpMax, 0, 1), fill = $('mh-hpfill');
  fill.style.width = (hp * 100).toFixed(1) + '%'; fill.style.background = hpColor(hp);
  put('mh-hptxt', Math.ceil(G.hp) + '');
  $('mh-hp').classList.toggle('low', hp <= 0.3);
  let pw = '';
  for (const k of ['golden', 'slow']) if (G.power[k] > 0) pw += '<div class="pw" style="--pc:' + POWERS[k].css + '">' + POWERS[k].icon + ' ' + POWERS[k].label + ' <b>' + Math.ceil(G.power[k]) + 's</b></div>';
  put('mh-pow', pw);
  // chuva de ovos
  const up = G.ultActive > 0 ? G.ultActive / 4.5 : G.ult;
  ultBtn.style.setProperty('--p', (up * 100).toFixed(0) + '%');
  ultBtn.classList.toggle('full', G.ult >= 1);
  const em = ultBtn.querySelector('em'), et = G.ult >= 1 ? tr('TOQUE!', 'TAP!', 'NAPAUTA!') : Math.floor(G.ult * 100) + '%';
  if (em.textContent !== et) em.textContent = et;
  // barra do chefe (em HTML: a barra 3D em cima dele fica pequena na tela do celular)
  const boss = ufos.find(u => u.kind === 'boss' && !u.vet && isAlive(u));
  bossEl.classList.toggle('show', !!boss && combat);
  if (boss) {
    const sp = bossEl.querySelector('span'), nm = boss.D.name;
    if (sp.textContent !== nm) sp.textContent = nm;
    bossEl.querySelector('i').style.width = (clamp(boss.hp / boss.maxHp, 0, 1) * 100).toFixed(1) + '%';
  }
}
function tapper(el, fn) {
  el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); fn(e); });
  el.addEventListener('click', e => { e.stopPropagation(); if (e.detail === 0) fn(e); });   // teclado/leitor de tela
}
tapper(ultBtn, () => fireUltimate());
tapper(pauseBtn, () => { if (pausable()) setPaused(true); });

// ---------- setas na borda: galinha sendo levada / inimigos fora da tela ----------
const arrows = [0, 1, 2].map(() => {
  const el = document.createElement('button');
  el.className = 'arrow'; el.innerHTML = '<i></i><span></span>';
  document.body.appendChild(el);
  const a = { el, p: new THREE.Vector3(), on: false };
  tapper(el, () => { if (combatOn()) { snapToPoint(a.p); } });
  return a;
});
/** Devolve true se o ponto está visível; senão grava em `out` onde a seta fica (px) e o ângulo dela. */
function offscreen(pos, out) {
  _p.copy(pos).sub(camPos);
  const front = _p.dot(camDir) > 0.01;
  _p.copy(pos).project(camera);
  if (front && Math.abs(_p.x) < 0.94 && Math.abs(_p.y) < 0.9) return false;
  let x = _p.x * innerWidth / 2, y = -_p.y * innerHeight / 2;   // px a partir do centro
  if (!front) { x = -x; y = -y; }
  const l = Math.hypot(x, y) || 1;
  x /= l; y /= l;
  const mx = innerWidth / 2 - 46, top = innerHeight / 2 - Math.min(150, innerHeight * 0.26), bot = top;
  const k = Math.min(mx / Math.max(1e-3, Math.abs(x)), (y < 0 ? top : bot) / Math.max(1e-3, Math.abs(y)));
  out.x = innerWidth / 2 + x * k; out.y = innerHeight / 2 + y * k; out.a = Math.atan2(x, -y) * 180 / Math.PI;
  return true;
}
const _o = { x: 0, y: 0, a: 0 };
function updateArrows() {
  let n = 0;
  const show = (pos, icon, urgent) => {
    if (n >= arrows.length || !offscreen(pos, _o)) return;
    const a = arrows[n++];
    a.p.copy(pos); a.on = true;
    a.el.style.transform = 'translate(' + _o.x.toFixed(0) + 'px,' + _o.y.toFixed(0) + 'px)';
    a.el.firstChild.style.setProperty('--a', _o.a.toFixed(0) + 'deg');
    if (a.el.lastChild.textContent !== icon) a.el.lastChild.textContent = icon;
    a.el.classList.toggle('urgent', urgent);
    a.el.classList.add('show');
  };
  if (combatOn()) {
    // 1) galinha sendo levada fora da tela: urgente
    for (const c of chickens) if (c.state === 'abducting') show(c.pos, '🐔', true);
    // 2) nenhuma nave na tela: aponta a mais próxima da mira
    if (n === 0) {
      let anyOn = false, best = null, bd = -2;
      for (const u of ufos) {
        if (!isAlive(u)) continue;
        if (!offscreen(u.pos, _o)) { anyOn = true; break; }
        const d = _p.copy(u.pos).sub(camPos).normalize().dot(camDir);
        if (d > bd) { bd = d; best = u; }
      }
      if (!anyOn && best) show(best.pos, best.kind === 'boss' ? '👾' : '🛸', false);
    }
  }
  for (let i = n; i < arrows.length; i++) if (arrows[i].on) { arrows[i].on = false; arrows[i].el.classList.remove('show'); }
}

// =============================================================================
// MELHORIAS — o jogo cria os 3 cards 3D (atire neles); aqui eles ficam escondidos
// e viram 3 botões grandes no alcance do polegar.
// =============================================================================
const upgEl = $('upg'), upgList = $('upg-list');
let upgShown = false, upgT = 0;
function updateUpgrade() {
  if (G.state === 'upgrade' && cards.length) {
    for (const c of cards) c.mesh.visible = false;
    if (upgShown || cards.some(c => c.done)) return;
    upgShown = true; upgT = performance.now();
    hideBanner();   // o banner 3D diz "atire no card"; aqui é toque
    upgList.innerHTML = '';
    cards.forEach(c => {
      const u = c.upg, R = RARITY[u.rar] || RARITY.comum, L = G.lv[u.id] || 0;
      const b = document.createElement('button');
      b.className = 'uc';
      b.style.cssText = '--rc:' + R.col + ';--b0:' + R.bg[0] + ';--b1:' + R.bg[1];
      const lv = u.instant ? tr('NA HORA', 'INSTANT', 'HETI') : (L ? tr('NÍVEL ', 'LEVEL ', 'TASO ') + L + ' → ' + (L + 1) : tr('NOVA!', 'NEW!', 'UUSI!')) + ' · ' + (u.lvl[L] || '');
      b.innerHTML = '<span class="ic">' + u.icon + '</span><span class="tx"><span class="tt">' + u.title + '</span><div class="ds">' + u.desc + '</div><div class="lv">' + lv + '</div></span>';
      b.addEventListener('click', () => {
        if (performance.now() - upgT < 350 || cards.some(k => k.done)) return;   // evita escolher sem querer com o dedo que estava atirando
        c.target.onHit();
        for (const o of upgList.children) o.classList.add(o === b ? 'picked' : 'gone');
        vibrate(30);
      });
      upgList.appendChild(b);
    });
    upgEl.classList.add('show');
  } else if (upgShown) { upgShown = false; upgEl.classList.remove('show'); }
}

// =============================================================================
// FIM DE PARTIDA (HTML, no lugar do painel 3D de ranking do jogo principal)
// =============================================================================
const endEl = $('end');
let endShown = false;
function mmss(t) { const s = Math.round(t); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function updateEnd() {
  const over = G.state === 'victory' || G.state === 'game_over';
  if (!over) { if (endShown) { endShown = false; endEl.classList.remove('show'); } return; }
  if (endShown || G.stateT < 2.4) return;
  endShown = true;
  const win = G.state === 'victory', alive = chickensAlive();
  endEl.classList.toggle('lose', !win);
  $('end-h').textContent = win ? tr('VITÓRIA!', 'VICTORY!', 'VOITTO!') : 'GAME OVER';
  $('end-sub').textContent = win ? tr('você salvou o galinheiro!', 'you saved the coop!', 'pelastit kanalan!')
    : alive === 0 ? tr('levaram todas as galinhas', 'they took all the chickens', 'kaikki kanat vietiin') : tr('os aliens venceram desta vez', 'the aliens won this time', 'alienit voittivat tällä kertaa');
  $('end-score').textContent = fmt(G.score);
  $('end-rec').classList.toggle('show', !!G.newRecord && G.score > 0);
  $('end-stats').innerHTML = '<div><b>' + Math.min(G.wave + 1, WAVES.length) + '/' + WAVES.length + '</b>' + tr('wave', 'wave', 'aalto') + '</div><div><b>🐔 ' + alive + '</b>' + tr('galinhas salvas', 'chickens saved', 'kanaa pelastettu') +
    '</div><div><b>' + mmss(run.t) + '</b>' + tr('tempo', 'time', 'aika') + '</div>';
  let marked = false;
  $('end-top').innerHTML = LB.local.slice(0, 5).map((r, i) => {
    const me = !marked && r === LB.me; if (me) marked = true;
    return '<li' + (me ? ' class="me"' : '') + '><b>' + (i + 1) + '.</b><span>' + (r.won ? '🏆 ' : '') + tr('wave ', 'wave ', 'aalto ') + r.w + '/' + WAVES.length + '</span><i>' + fmt(r.s) + '</i></li>';
  }).join('');
  endEl.classList.add('show');
  vibrate(win ? [60, 60, 60, 60, 160] : 200);
}

// =============================================================================
// FLUXO: jogar, jogar de novo, pausa
// =============================================================================
const startEl = $('start');
const applyVol = () => setVolumes({ music: S.music, sfx: S.sfx });
function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
let wake = null;
function keepAwake() { try { if (navigator.wakeLock && !wake) navigator.wakeLock.request('screen').then(w => { wake = w; w.addEventListener('release', () => { wake = null; }); }).catch(() => {}); } catch (e) {} }
function play() {
  if (G.state !== 'idle') return;
  initAudio(); applyVol(); keepAwake();
  startEl.style.display = 'none';
  G.tod = 0;   // jogar de novo logo depois da noite da wave 3: o dia volta na hora, não em 10 s
  startGame();
  // campo de visão já no valor final (em pé ele abre até 100°): o banner da wave nasce do tamanho certo
  const a = camera.aspect;
  camera.fov = a >= 1 ? 78 : clamp(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(32)) / a) * 180 / Math.PI, 78, 100);
  camera.updateProjectionMatrix();
  setView(YAW0, a >= 1 ? 0.04 : 0.16);   // em pé a visão começa um pouco para cima: as naves ficam no meio da tela, fora do HUD
  run.t = 0; run.hp = G.hp; run.chk = chickensAlive(); run.hintWave = -1;
  IN.snap = null; IN.pending = null;
  // banner da wave 1 com as palavras do celular
  showBanner(tr('WAVE ', 'WAVE ', 'AALTO ') + '1/' + WAVES.length, tr('⚠ CHEFÃO: ', '⚠ BOSS: ', '⚠ POMO: ') + BOSSES[WAVES[0].boss].name, WEAPONS.hands.icon + ' ' + WEAPONS.hands.label, '#ffd040', 3.6, 0, WEAPON_TIPS.hands[1]);
}
$('cta').addEventListener('click', play);
$('end-again').addEventListener('click', () => { resetGame(); play(); });
$('p-resume').addEventListener('click', () => setPaused(false));
$('p-quit').addEventListener('click', () => { setPaused(false); resetGame(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && G.state !== 'idle') keepAwake(); });
function bindRange(id, key, apply) {
  const el = $(id);
  el.value = Math.round(S[key] * 100);
  el.addEventListener('input', () => { S[key] = el.value / 100; saveSettings(); apply(); });
}
bindRange('p-music', 'music', applyVol);
bindRange('p-sfx', 'sfx', applyVol);
bindRange('p-mouse', 'mouse', () => {});

// vibração leve quando você leva dano ou perde uma galinha (Android; o iPhone ignora)
function feedback() {
  if (G.state === 'idle') return;
  const chk = chickensAlive();
  if (G.hp < run.hp - 0.5) vibrate(70);
  if (chk < run.chk) vibrate([50, 40, 90]);
  run.hp = G.hp; run.chk = chk;
}

// ---------- Banner (wave, chefe, wave completa) ----------
// O jogo desenha o banner num canvas e mostra numa placa 3D, que em pé fica pequena demais para ler.
// Aqui o MESMO canvas vai para a página, largo, e a placa 3D sai das camadas da câmera.
let bannerMesh = null, bannerCv = null, bannerOn = false;
function adoptBanner() {
  const m = scene.children.find(o => o.isMesh && o.renderOrder === 998);
  const cv = m && m.material.map && m.material.map.image;
  if (!(cv instanceof HTMLCanvasElement)) { console.warn('[mobile] banner 3D não encontrado'); return; }
  bannerMesh = m; bannerCv = cv;
  cv.id = 'mbanner';
  document.body.appendChild(cv);
  m.layers.disableAll();
}
function updateBannerEl() {
  if (!bannerMesh) return;
  const on = bannerMesh.visible && G.state !== 'idle';
  if (on !== bannerOn) { bannerOn = on; bannerCv.classList.toggle('show', on); }
  if (!on) return;
  bannerCv.style.opacity = bannerMesh.material.opacity.toFixed(2);
  bannerCv.style.transform = 'translateX(-50%) scale(' + bannerMesh.scale.x.toFixed(3) + ')';
}

/** Depois de cada quadro do jogo: interface. */
function post(dt) {
  if (G.state !== 'idle' && G.state !== 'victory' && G.state !== 'game_over' && !G.paused) run.t += dt;
  updateUpgrade();
  updateEnd();
  updateBannerEl();
  if (G.paused) return;
  feedback();
  updateHud(dt);
  updateArrows();
  updateGest();
}

// =============================================================================
// BOOT
// =============================================================================
let lastT = 0;
function frame(time, xrFrame) {
  const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  pre(dt);
  gameLoop(time, xrFrame);
  post(dt);
}
const fontsReady = document.fonts && document.fonts.load
  ? Promise.race([Promise.all([document.fonts.load('40px "Lilita One"'), document.fonts.load('800 20px "Nunito"'), document.fonts.load('700 20px "Nunito"')]), new Promise(r => setTimeout(r, 2500))])
  : Promise.resolve();
fontsReady.then(() => {
  boot();
  // O painel 3D de ranking do jogo principal continua existindo (o loop dele o liga no fim da partida),
  // mas aqui o fim de partida é em HTML: o painel sai das camadas que a câmera desenha.
  const panel = scene.children.find(o => o.isMesh && o.renderOrder === 996);
  if (panel) panel.layers.disableAll(); else console.warn('[mobile] painel de ranking 3D não encontrado');
  adoptBanner();
  renderer.setAnimationLoop(frame);
  applyVol();
  $('best-score').textContent = fmt(G.best);
  $('cta').textContent = tr('JOGAR', 'PLAY', 'PELAA');
  document.body.classList.add('ready');
  // ganchos de teste (junto com window.__cr do jogo): simula partidas com o controle e a interface do celular
  window.__crm = {
    IN, LOOK, FIRE, SA, run, play, snapToPoint, pre, post, setView, toScreen, gesture, view: () => ({ yaw: P.yaw, pitch: P.pitch }),
    step: (n, dt = 1 / 30, render = false) => { for (let i = 0; i < n; i++) { pre(dt); window.__cr.step(1, dt, render); post(dt); } },
  };
});
