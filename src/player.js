// =============================================================================
// JOGADOR — controles VR, mouse/teclado, toque, vibração, andar/girar,
// a cadeira de rodas (com as pernas) e a cadeira voadora da batalha final.
// =============================================================================
import { THREE, renderer, scene, camera, rig, camPos, xrActive, isTouch, toon, outlineMat, outlineGeo, bakeWith, box, cyl, sph, torus, add } from './render.js';
import { G, clamp, rand, tmpV, playing, saveSettings, load, save } from './core.js';
import { tr } from './i18n.js';
import { WEAPONS, WEAPON_ORDER } from './config.js';
import { fxAdd, popup, popupAhead, showBanner, ov, SHAPE, glow } from './fx.js';
import { sfx, loop, initAudio, resumeAudio, music, toggleMusic } from './audio.js';
import { castSegment } from './combat.js';
import { chickens, scareChicken } from './chickens.js';
import { groundHeightAt, blockedSeg, PORCH_Y } from './world.js';
import { equipWeapon, onTriggerStart, onTriggerEnd, desktopShoot, isTapWeapon, canShoot, fireUltimate, weaponState, targetVel, canUlt } from './weapons.js';
import { useSkill } from './skills.js';
import { handleMenuAdvance, setPaused, resetGame } from './game.js';
import { lapPanel, startLapGrab, endLapGrab } from './hud.js';

const [t0, t1, t2, t3, t4] = tmpV(5);
const _q = new THREE.Quaternion(), _c = new THREE.Color();

// =============================================================================
// CONTROLES VR
// =============================================================================
const c1 = renderer.xr.getController(0), c2 = renderer.xr.getController(1);
rig.add(c1); rig.add(c2);
const CTRL_MAT = toon({ ramp: 4 });
function ctrlVisual(color) {
  const geo = bakeWith(g => {
    const b = box(g, 0.045, 0.05, 0.12, color, 0, 0, 0.01);
    const ring = torus(g, 0.045, 0.008, 6, 16, 0xe8e8f0, 0, 0.02, -0.06); ring.rotation.x = 0.4;
    const grip = cyl(g, 0.017, 0.017, 0.07, 10, 0x24242c, 0, -0.04, 0.03); grip.rotation.x = Math.PI / 2.5;
    sph(g, 0.012, 0xffffff, 0, 0.03, 0.02, 6, 4);
  });
  const m = new THREE.Mesh(geo, CTRL_MAT);
  m.add(new THREE.Mesh(outlineGeo(geo), outlineMat(0.003, 0x140c10)));
  return m;
}
const vis1 = ctrlVisual(0x48c8ff), vis2 = ctrlVisual(0xff5088);
c1.add(vis1); c2.add(vis2);
/** Controles atuais (reatribuídos quando o Quest informa a mão de cada um). */
export const CTRL = { right: c2, left: c1, visR: vis2, visL: vis1 };
for (const c of [c1, c2]) {
  c.addEventListener('connected', e => {
    c.userData.src = e.data;
    if (e.data.handedness === 'left') { CTRL.left = c; CTRL.visL = c === c1 ? vis1 : vis2; }
    else if (e.data.handedness === 'right') { CTRL.right = c; CTRL.visR = c === c1 ? vis1 : vis2; }
  });
  c.addEventListener('disconnected', () => { c.userData.src = null; });
  c.addEventListener('selectstart', () => { c.userData.held = true; initAudio(); if (handleMenuAdvance(c)) return; onTriggerStart(c); });
  c.addEventListener('selectend', () => { c.userData.held = false; onTriggerEnd(c); });
  c.addEventListener('squeezestart', () => {
    if (lapPanel.visible && c.getWorldPosition(t0).distanceTo(lapPanel.getWorldPosition(t1)) < 0.3) { startLapGrab(c); pulseCtrl(c, 0.4, 40); return; }
    if (c === CTRL.right) useSkill(2);
    else c.userData.squeezeT = performance.now();   // esquerdo: segurar 0,3 s solta a Chuva de Ovos (se carregada)
  });
  c.addEventListener('squeezeend', () => { c.userData.squeezeT = 0; if (endLapGrab(c)) pulseCtrl(c, 0.2, 30); });
}
function triggerHeld(ctrl) {
  const s = ctrl.userData.src;
  if (s && s.gamepad && s.gamepad.buttons[0] && s.gamepad.buttons[0].pressed) return true;
  return !!ctrl.userData.held;
}
function stick(ctrl, out) {
  const s = ctrl.userData.src;
  out.set(0, 0, 0);
  if (!s || !s.gamepad) return out;
  const ax = s.gamepad.axes;
  return out.set(ax[2] !== undefined ? ax[2] : (ax[0] || 0), ax[3] !== undefined ? ax[3] : (ax[1] || 0), 0);
}

// ---------- Vibração ----------
function pulseSrc(src, intensity, duration) {
  const h = src && src.gamepad && src.gamepad.hapticActuators && src.gamepad.hapticActuators[0];
  if (h && h.pulse) { try { h.pulse(Math.min(1, intensity), duration); } catch (e) {} }
}
export function pulseCtrl(ctrl, intensity, duration) { if (ctrl) pulseSrc(ctrl.userData.src, intensity, duration); }
export function pulseAll(intensity, duration) { pulseSrc(c1.userData.src, intensity, duration); pulseSrc(c2.userData.src, intensity, duration); }

// ---------- Botões: A próxima arma · X anterior · B habilidade 1 · Y habilidade 2 ----------
const btnPrev = new Map();
function pollButtons() {
  for (const c of [c1, c2]) {
    const s = c.userData.src;
    if (!s || !s.gamepad) continue;
    const b = s.gamepad.buttons;
    const right = c === CTRL.right;
    for (const idx of [3, 4, 5]) {
      const pressed = !!(b[idx] && b[idx].pressed);
      const key = c.uuid + idx;
      if (pressed && !btnPrev.get(key)) {
        if (idx === 4) cycleWeapon(right ? 1 : -1);
        else if (idx === 5) useSkill(right ? 0 : 1);
      }
      btnPrev.set(key, pressed);
    }
  }
}

// =============================================================================
// TROCA DE ARMA
// =============================================================================
export function cycleWeapon(dir) {
  if (!canShoot() && G.state !== 'wave_complete') return;
  const list = WEAPON_ORDER.filter(w => G.unlocked.has(w));
  if (list.length < 2) return;
  let i = list.indexOf(G.weapon);
  if (i < 0) i = 0;
  selectWeapon(list[(i + dir + list.length) % list.length]);
}
export function selectWeapon(name) {
  if (!name || !G.unlocked.has(name) || name === G.weapon) return;
  if (!canShoot() && G.state !== 'wave_complete') return;
  equipWeapon(name);
  sfx('weaponSwitch');
  const label = WEAPONS[name].icon + ' ' + WEAPONS[name].label;
  if (xrActive()) { CTRL.right.getWorldPosition(t0); t0.y += 0.18; popup(label, t0, '#8dff4a', 0.6, 1.0); pulseCtrl(CTRL.right, 0.3, 30); }
  else popupAhead(label, '#8dff4a', 0.7);
}

// =============================================================================
// CADEIRA DE RODAS (filha do rig; gira com o corpo no VR)
// =============================================================================
export const wheelchair = new THREE.Group();
rig.add(wheelchair);
const CHAIR_GEO = bakeWith(W => {
  const CH = 0x34343e, CU = 0xb83a3a, CU2 = 0x8a2424;
  box(W, 0.55, 0.06, 0.5, CH, 0, 0.5, -0.1);
  box(W, 0.5, 0.07, 0.46, CU, 0, 0.56, -0.1);
  for (let k = 0; k < 3; k++) box(W, 0.502, 0.072, 0.03, CU2, 0, 0.56, -0.28 + k * 0.18);
  box(W, 0.55, 0.55, 0.06, CH, 0, 0.78, -0.32);
  box(W, 0.46, 0.5, 0.05, CU, 0, 0.8, -0.3);
  for (const sx of [-1, 1]) {
    box(W, 0.06, 0.04, 0.4, CH, sx * 0.32, 0.7, -0.1);
    box(W, 0.07, 0.03, 0.3, 0x5a3a24, sx * 0.32, 0.725, -0.1);
    box(W, 0.04, 0.18, 0.04, CH, sx * 0.32, 0.6, -0.25);
    // rodas grandes com aro de empurrar
    const tire = torus(W, 0.3, 0.04, 10, 24, 0x18181c, sx * 0.4, 0.32, -0.1); tire.rotation.y = Math.PI / 2;
    const push = torus(W, 0.26, 0.012, 6, 24, 0xc8ccd8, sx * 0.44, 0.32, -0.1); push.rotation.y = Math.PI / 2;
    const rim = cyl(W, 0.25, 0.25, 0.03, 20, 0x8a8a96, sx * 0.4, 0.32, -0.1); rim.rotation.z = Math.PI / 2;
    const hub = cyl(W, 0.05, 0.05, 0.06, 12, 0xd84030, sx * 0.4, 0.32, -0.1); hub.rotation.z = Math.PI / 2;
    // rodinhas da frente
    const ct = torus(W, 0.09, 0.03, 6, 14, 0x18181c, sx * 0.25, 0.1, 0.18); ct.rotation.y = Math.PI / 2;
    box(W, 0.04, 0.2, 0.04, CH, sx * 0.25, 0.22, 0.18);
    box(W, 0.03, 0.4, 0.03, CH, sx * 0.2, 0.4, 0.22);
    box(W, 0.04, 0.18, 0.04, CH, sx * 0.27, 1.1, -0.32);
    sph(W, 0.03, 0x24242c, sx * 0.27, 1.2, -0.32, 8, 6);
    // pernas (jeans) e botas
    const th = cyl(W, 0.078, 0.068, 0.4, 12, 0x3a62b0, sx * 0.13, 0.6, 0.1); th.rotation.x = Math.PI / 2;
    sph(W, 0.078, 0x2e4e90, sx * 0.13, 0.56, 0.3, 10, 8);
    cyl(W, 0.064, 0.054, 0.42, 12, 0x3a62b0, sx * 0.13, 0.33, 0.32);
    cyl(W, 0.06, 0.06, 0.05, 12, 0x2e4e90, sx * 0.13, 0.13, 0.36);
    box(W, 0.12, 0.08, 0.24, 0x6a3a1c, sx * 0.13, 0.08, 0.41);
    box(W, 0.125, 0.02, 0.245, 0x24140a, sx * 0.13, 0.035, 0.41);
  }
  box(W, 0.4, 0.04, 0.18, CH, 0, 0.25, 0.22);
  box(W, 0.55, 0.04, 0.04, CH, 0, 1.18, -0.32);
});
const chairMesh = new THREE.Mesh(CHAIR_GEO, toon({ ramp: 4 }));
chairMesh.add(new THREE.Mesh(outlineGeo(CHAIR_GEO), outlineMat(0.006, 0x140c10)));
wheelchair.add(chairMesh);

// =============================================================================
// ANDAR (joystick esquerdo / WASD), GIRAR (direcional direito) e CAIR
// =============================================================================
export const PLAYER_Y = PORCH_Y;
let rigVy = 0;
const P = { moving: false, turning: 0, yaw: Math.PI, pitch: -0.08, mouseDown: false, mouseLocked: false, zoom: false, touchActive: false, keys: {} };
export const playerInput = P;
export const pcAim = new THREE.Vector3(0, 2, 10);

export function moveRig(dx, dz) {
  const rp = rig.position;
  for (const axis of [0, 1]) {
    const nx = clamp(rp.x + (axis === 0 ? dx : 0), -8.6, 8.6);
    const nz = clamp(rp.z + (axis === 1 ? dz : 0), -3.3, 17.4);
    if (blockedSeg(rp.x, rp.z, nx, nz)) continue;
    if (groundHeightAt(nx, nz) - rp.y > 0.12) continue;
    rp.x = nx; rp.z = nz;
  }
  P.moving = true;
  for (const c of chickens) if (c.state !== 'gone' && Math.hypot(c.pos.x - rp.x, c.pos.z - rp.z) < 0.55) scareChicken(c, rp);
}
function updateRigHeight(dt) {
  if (flightActive()) return;
  const rp = rig.position, g = groundHeightAt(rp.x, rp.z);
  if (rp.y > g + 0.01) {
    rigVy -= 9.8 * dt;
    rp.y = Math.max(g, rp.y + rigVy * dt);
    if (rp.y <= g) { if (rigVy < -1.2) { sfx('land'); pulseAll(0.6, 120); } rigVy = 0; }
  } else { rp.y = g; rigVy = 0; }
}
const leftStick = new THREE.Vector3(), rightStick = new THREE.Vector3();
function vrLocomotion(dt) {
  stick(CTRL.left, leftStick);
  if (flightActive() || G.state === 'idle' || Math.hypot(leftStick.x, leftStick.y) < 0.18) return;
  const fwd = camera.getWorldDirection(t0); fwd.y = 0;
  if (fwd.lengthSq() < 1e-4) return;
  fwd.normalize();
  const right = t1.crossVectors(fwd, THREE.Object3D.DEFAULT_UP);
  const sp = 2.4 * dt;
  moveRig((fwd.x * -leftStick.y + right.x * leftStick.x) * sp, (fwd.z * -leftStick.y + right.z * leftStick.x) * sp);
}
// Giro: suave (padrão, pivô na cabeça) ou em passos de 30° (opção de conforto)
const TURN_SPEED = 2.2;
let snapReady = true;
function vrTurn(dt) {
  stick(CTRL.right, rightStick);
  const a = Math.abs(rightStick.x);
  let ang = 0;
  if (G.settings.turn === 'snap') {
    if (a < 0.4) snapReady = true;
    else if (a > 0.7 && snapReady) { snapReady = false; ang = -Math.sign(rightStick.x) * Math.PI / 6; }
  } else if (a >= 0.15) {
    const k = (a - 0.15) / 0.85;
    ang = -Math.sign(rightStick.x) * k * k * TURN_SPEED * G.settings.turnSpeed * dt;
  }
  if (!ang) return;
  const head = camera.getWorldPosition(t2);
  const rp = rig.position, dx = rp.x - head.x, dz = rp.z - head.z;
  const c = Math.cos(ang), sn = Math.sin(ang);
  rp.x = head.x + dx * c + dz * sn;
  rp.z = head.z - dx * sn + dz * c;
  rig.rotation.y += ang;
  P.turning = 0.15;
}

// =============================================================================
// PC: mouse, teclado, zoom e mira exata
// =============================================================================
function updatePcControls(dt) {
  if (G.state !== 'idle' && !flightActive()) {
    const k = P.keys;
    const mx = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    const mz = (k.KeyS || k.ArrowDown ? 1 : 0) - (k.KeyW || k.ArrowUp ? 1 : 0);
    if (mx || mz) {
      const sp = 2.6 * dt / (mx && mz ? Math.SQRT2 : 1);
      const sn = Math.sin(P.yaw), cs = Math.cos(P.yaw);
      moveRig((mx * cs + mz * sn) * sp, (-mx * sn + mz * cs) * sp);
    }
  }
  const fov = P.zoom ? 42 : 78;
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 12); camera.updateProjectionMatrix(); }
  // ponto exato sob a mira: todas as armas convergem para ele
  const dir = camera.getWorldDirection(t3);
  const hit = castSegment(camPos, dir, 80, 0);
  let t = hit ? Math.max(hit.t, 1.5) : 40;
  // mirando para baixo: o alvo é o ponto do chão sob a mira (não 40 m dentro da terra)
  if (!hit && dir.y < -0.02) {
    let tg = (0 - camPos.y) / dir.y;
    for (let k = 0; k < 2; k++) tg = (groundHeightAt(camPos.x + dir.x * tg, camPos.z + dir.z * tg) - camPos.y) / dir.y;
    if (tg > 0.5) t = Math.min(t, tg);
  }
  pcAim.copy(camPos).addScaledVector(dir, t);
  // velocidade do alvo sob a mira (para o arremesso mirar onde ele VAI estar)
  targetVel(hit, pcAimVel);
}
export const pcAimVel = new THREE.Vector3();
/** Ponto do mundo sob um toque na tela (celular): nave/caixa/gosma sob o dedo, com folga de dedo; senão o chão ou 40 m à frente. */
const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2();
export const tapAim = new THREE.Vector3(), tapAimVel = new THREE.Vector3();
function aimFromTap(cx, cy) {
  const r = renderer.domElement.getBoundingClientRect();
  _ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  _ray.setFromCamera(_ndc, camera);
  const o = _ray.ray.origin, dir = _ray.ray.direction;
  let hit = castSegment(o, dir, 80, 0);
  if (!hit) hit = castSegment(o, dir, 80, 0.7);   // dedo é grosso: aceita tocar perto da nave
  let t = hit ? Math.max(hit.t, 1.5) : 40;
  if (!hit && dir.y < -0.02) {
    let tg = (0 - o.y) / dir.y;
    for (let k = 0; k < 2; k++) tg = (groundHeightAt(o.x + dir.x * tg, o.z + dir.z * tg) - o.y) / dir.y;
    if (tg > 0.5) t = Math.min(t, tg);
  }
  // com a folga, mira o centro da parte tocada (não a casca inflada)
  if (hit && hit.kind === 'ufo') tapAim.copy(hit.part.c); else tapAim.copy(o).addScaledVector(dir, t);
  targetVel(hit, tapAimVel);
}
export function applyPcView() { rig.rotation.y = P.yaw; camera.rotation.set(P.pitch, 0, 0); }

const startEl = document.getElementById('start');
const pausable = () => !xrActive() && !isTouch && startEl.style.display === 'none' && G.state !== 'idle' && G.state !== 'game_over' && G.state !== 'victory';
document.addEventListener('pointerlockchange', () => {
  P.mouseLocked = document.pointerLockElement === renderer.domElement;
  if (!P.mouseLocked) { P.mouseDown = false; P.zoom = false; if (pausable()) setPaused(true); }
  else if (G.paused) setPaused(false);
});
export function lockPointer() { if (!isTouch && !xrActive()) { try { const r = renderer.domElement.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {} } }
addEventListener('keyup', e => { P.keys[e.code] = false; });
addEventListener('contextmenu', e => { if (!isTouch) e.preventDefault(); });
addEventListener('keydown', e => {
  P.keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'Enter') { initAudio(); handleMenuAdvance(); }
  if (e.code === 'KeyR') fireUltimate();
  if (e.code === 'KeyM') { const on = musicToggle(); popupAhead(on ? '🎵 ON' : '🎵 OFF', '#ffffff', 0.6); }
  if (e.code === 'KeyQ') useSkill(0);
  if (e.code === 'KeyE') useSkill(1);
  if (e.code === 'KeyF') useSkill(2);
  if (e.code === 'Minus') selectWeapon(WEAPON_ORDER[10]);
  const m = e.code.match(/^Digit(\d)$/);
  if (m) { const n = parseInt(m[1], 10); selectWeapon(WEAPON_ORDER[n === 0 ? 9 : n - 1]); }
});
function musicToggle() { return toggleMusic(); }
let wheelT = 0;
addEventListener('wheel', e => {
  const n = performance.now();
  if (n - wheelT < 140) return;
  wheelT = n;
  cycleWeapon(e.deltaY > 0 ? 1 : -1);
}, { passive: true });
addEventListener('mousedown', e => {
  if (!P.mouseLocked || xrActive()) return;
  if (e.button === 0) P.mouseDown = true;
  if (e.button === 2) P.zoom = true;
});
addEventListener('mouseup', e => {
  if (e.button === 0) P.mouseDown = false;
  if (e.button === 2) P.zoom = false;
});
renderer.domElement.addEventListener('click', () => {
  if (isTouch || xrActive()) return;
  if (!P.mouseLocked) { lockPointer(); return; }
  initAudio();
  if (handleMenuAdvance()) return;
  if (canShoot() && isTapWeapon()) desktopShoot();
});
addEventListener('mousemove', e => {
  if (!P.mouseLocked || xrActive()) return;
  const sens = 0.0025 * (camera.fov / 78);
  P.yaw -= e.movementX * sens;
  P.pitch = clamp(P.pitch - e.movementY * sens, -Math.PI / 2 + 0.1, Math.PI / 2 - 0.1);
  if (!flightActive()) applyPcView(); else camera.rotation.set(P.pitch, 0, 0), rig.rotation.y = P.yaw;
});

// ---------- Toque (celular) ----------
let touchStartTime = 0, touchMoveDist = 0, lastTX = 0, lastTY = 0, touchId = null, lastTouchId = null;
function onTouchStart(e) {
  if (xrActive()) return;
  e.preventDefault();
  const t = e.changedTouches[0];
  if (touchId !== null) return;
  touchId = t.identifier;
  initAudio();
  lastTX = t.clientX; lastTY = t.clientY;
  touchStartTime = performance.now(); touchMoveDist = 0;
  if (handleMenuAdvance()) return;
  if (canShoot()) P.touchActive = true;
}
function onTouchMove(e) {
  if (xrActive()) return;
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier !== touchId) continue;
    const dx = t.clientX - lastTX, dy = t.clientY - lastTY;
    P.yaw -= dx * 0.006;
    P.pitch = clamp(P.pitch - dy * 0.006, -Math.PI / 2 + 0.1, Math.PI / 2 - 0.1);
    applyPcView();
    lastTX = t.clientX; lastTY = t.clientY;
    touchMoveDist += Math.hypot(dx, dy);
  }
}
function onTouchEnd(e) {
  if (xrActive()) return;
  e.preventDefault();
  let mine = false;
  for (const t of e.changedTouches) if (t.identifier === touchId) mine = true;
  if (!mine) return;
  lastTouchId = touchId; touchId = null;
  const was = P.touchActive;
  P.touchActive = false;
  if (!was) return;
  const tap = performance.now() - touchStartTime < 260 && touchMoveDist < 16;
  if (tap && canShoot() && isTapWeapon()) {
    const t = [...e.changedTouches].find(q => q.identifier === lastTouchId);
    if (t) { aimFromTap(t.clientX, t.clientY); desktopShoot(tapAim, tapAimVel); } else desktopShoot();
  }
}
if (isTouch) {
  const el = renderer.domElement;
  el.addEventListener('touchstart', onTouchStart, { passive: false });
  el.addEventListener('touchmove', onTouchMove, { passive: false });
  el.addEventListener('touchend', onTouchEnd, { passive: false });
  el.addEventListener('touchcancel', onTouchEnd, { passive: false });
}

// ---------- Entrar / sair do VR ----------
renderer.xr.addEventListener('sessionstart', () => {
  initAudio(); resumeAudio();
  startEl.style.display = 'none';
  setPaused(false);
  rig.position.set(0, PLAYER_Y, 0);
  rig.rotation.set(0, 0, 0);
  camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0);
  // vira o rig para a pessoa começar olhando para o quintal (+Z)
  setTimeout(() => {
    const fwd = camera.getWorldDirection(new THREE.Vector3()); fwd.y = 0;
    if (fwd.lengthSq() > 0.001) { fwd.normalize(); rig.rotation.y -= Math.atan2(fwd.x, fwd.z); }
  }, 400);
});
renderer.xr.addEventListener('sessionend', () => {
  camera.position.set(0, 1.25, 0);
  applyPcView();
});

// =============================================================================
// CADEIRA VOADORA (especial da batalha final)
// =============================================================================
const FLIGHT_DUR = 30;
export const flight = { phase: 'none', t: 0, done: false, chair: null, beacon: null, land: new THREE.Vector3(), vel: new THREE.Vector3(), parkT: 0, takeoff: 0, wind: null };
export const flightActive = () => flight.phase === 'flying' || flight.phase === 'returning';
function makeFlyKit() {
  const kit = new THREE.Group();
  const wings = [];
  const wingGeo = bakeWith(raw => { for (let k = 0; k < 5; k++) { const f = box(raw, 0.58 - k * 0.09, 0.03, 0.13, k % 2 ? 0xe8f0ff : 0xffffff, 0.28 - k * 0.03, -k * 0.06, k * 0.05); f.rotation.z = 0.15 + k * 0.16; } });
  for (const sx of [-1, 1]) {
    const wg = new THREE.Group(); wg.position.set(sx * 0.3, 0.85, -0.3);
    const m = new THREE.Mesh(wingGeo, toon({ ramp: 4 }));
    m.scale.x = sx;
    m.add(new THREE.Mesh(outlineGeo(wingGeo), outlineMat(0.006, 0x203050)));
    wg.add(m);
    kit.add(wg); wings.push(wg);
  }
  const jets = new THREE.Mesh(bakeWith(j => { for (const sx of [-1, 1]) { const c = cyl(j, 0.06, 0.085, 0.28, 12, 0x9098a8, sx * 0.22, 0.42, -0.42); c.rotation.x = Math.PI / 2; const n = cyl(j, 0.09, 0.07, 0.04, 12, 0xff6030, sx * 0.22, 0.42, -0.57); n.rotation.x = Math.PI / 2; } }), toon({ ramp: 4 }));
  kit.add(jets);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.65, 32), new THREE.MeshBasicMaterial({ color: 0x80e0ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; kit.add(ring);
  kit.userData = { wings, ring };
  return kit;
}
const flyKit = makeFlyKit();
flyKit.visible = false;
wheelchair.add(flyKit);
function animateFlyKit(kit, dt, power) {
  const f = Math.sin(G.time * (6 + power * 8)) * (0.25 + power * 0.35);
  kit.userData.wings[0].rotation.z = -f; kit.userData.wings[1].rotation.z = f;
  kit.userData.ring.material.opacity = 0.4 + Math.sin(G.time * 8) * 0.2;
}
function jetFx(origin, quat) {
  for (const sx of [-1, 1]) {
    const p = t3.set(sx * 0.22, 0.42, -0.6).applyQuaternion(quat).add(origin);
    _c.setHex(Math.random() < 0.5 ? 0x60c0ff : 0xffa040);
    fxAdd.spawn(p.x, p.y, p.z, rand(-0.3, 0.3), rand(-1.5, -0.5), rand(-0.3, 0.3), _c, rand(0.08, 0.14), 0.35, 0, 0.5, 0.6, 0.9, SHAPE.glow);
  }
}
export function startFlightEvent() {
  flight.done = true; flight.phase = 'descending'; flight.parkT = 0;
  const fwd = camera.getWorldDirection(t0); fwd.y = 0;
  if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
  fwd.normalize();
  const rp = rig.position;
  let lx = clamp(rp.x + fwd.x * 1.8, -8, 8), lz = clamp(rp.z + fwd.z * 1.8, -3, 17);
  if (blockedSeg(rp.x, rp.z, lx, lz)) { lx = rp.x; lz = rp.z + 0.9 * Math.sign(fwd.z || 1); }
  flight.land.set(lx, groundHeightAt(lx, lz), lz);
  const g = new THREE.Group();
  g.add(chairMesh.clone());
  g.add(makeFlyKit());
  g.rotation.y = Math.atan2(fwd.x, fwd.z);
  g.position.set(lx, flight.land.y + 25, lz);
  scene.add(g);
  flight.chair = g;
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 30, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x60e0ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  beacon.position.set(lx, flight.land.y + 15, lz);
  scene.add(beacon);
  flight.beacon = beacon;
  showBanner(tr('CADEIRA VOADORA!', 'FLYING WHEELCHAIR!', 'LENTÄVÄ PYÖRÄTUOLI!'), tr('chegue perto dela pra montar', 'get close to climb on', 'mene lähelle noustaksesi kyytiin'), tr('VOE ATÉ AS NAVES!', 'FLY UP TO THE SAUCERS!', 'LENNÄ LAUTASTEN LUO!'), '#60e0ff', 4.2);
  sfx('weaponPickup'); pulseAll(0.5, 300);
}
export function clearFlightChair() {
  if (flight.chair) { scene.remove(flight.chair); flight.chair = null; }
  if (flight.beacon) { scene.remove(flight.beacon); flight.beacon.geometry.dispose(); flight.beacon = null; }
}
function mountFlight() {
  clearFlightChair();
  flight.phase = 'flying'; flight.t = FLIGHT_DUR; flight.takeoff = 1.6; flight.vel.set(0, 0, 0);
  flyKit.visible = true;
  popupAhead(tr('DECOLANDO! 🚀', 'TAKING OFF! 🚀', 'NOUSU! 🚀'), '#60e0ff', 1.3);
  sfx('takeoff'); pulseAll(0.8, 400);
  music.setMode('flight');
  flight.wind = loop('flightWind', { vol: 0.6 });
}
export function endFlight() {
  flight.phase = 'none';
  flyKit.visible = false;
  clearFlightChair();
  rigVy = 0;
  if (flight.wind) { flight.wind.stop(0.5); flight.wind = null; }
}
function moveToward(pos, target, step) {
  t4.copy(target).sub(pos);
  const len = t4.length();
  if (len <= step || len < 1e-5) { pos.copy(target); return true; }
  pos.addScaledVector(t4, step / len);
  return false;
}
function updateFlight(dt, xr) {
  if (flight.phase === 'none') return;
  const rp = rig.position;
  if (flight.phase === 'descending' || flight.phase === 'parked') {
    const g = flight.chair;
    animateFlyKit(g.children[1], dt, 0.6);
    glow(g.position.x, g.position.y + 0.6, g.position.z, 1.6, 0x60e0ff, 0.5);
    if (flight.phase === 'descending') {
      g.position.y = Math.max(flight.land.y + 0.3, g.position.y - dt * 7);
      _c.setHex(0xa0f0ff); fxAdd.spawn(g.position.x + rand(-0.4, 0.4), g.position.y + 0.3, g.position.z + rand(-0.4, 0.4), 0, 1, 0, _c, 0.1, 0.6, 0, 0, 0, 1, SHAPE.star, 2);
      if (g.position.y <= flight.land.y + 0.31) { flight.phase = 'parked'; sfx('land'); }
    } else {
      flight.parkT += dt;
      g.position.y = flight.land.y + 0.3 + Math.sin(G.time * 3) * 0.06;
      if (flight.parkT > 12) {   // demorou: ela vem até você
        const to = t1.set(rp.x - g.position.x, 0, rp.z - g.position.z);
        const d = to.length();
        if (d > 0.01) g.position.addScaledVector(to, Math.min(1, dt * 2.5 / d));
        flight.land.x = g.position.x; flight.land.z = g.position.z;
      }
      if (Math.hypot(rp.x - g.position.x, rp.z - g.position.z) < 1.1) mountFlight();
    }
    return;
  }
  animateFlyKit(flyKit, dt, 1);
  wheelchair.updateMatrixWorld(true);
  wheelchair.getWorldQuaternion(_q);
  jetFx(wheelchair.getWorldPosition(t2), _q);
  if (flight.phase === 'flying') {
    flight.t -= dt;
    // voa pra onde você olha; joystick esquerdo / W-S acelera ou freia
    let speed = 4.5;
    if (xr) speed += -leftStick.y * 3.5;
    else speed += ((P.keys.KeyW || P.keys.ArrowUp) ? 3.5 : 0) - ((P.keys.KeyS || P.keys.ArrowDown) ? 3.5 : 0);
    speed = clamp(speed, 0.5, 8.5);
    const want = t3;
    if (flight.takeoff > 0) { flight.takeoff -= dt; want.set(0, 4.5, 0); }
    else want.copy(camera.getWorldDirection(t0)).multiplyScalar(speed);
    flight.vel.lerp(want, Math.min(1, dt * 2.5));
    rp.addScaledVector(flight.vel, dt);
    rp.y = clamp(rp.y, 2.5, 20);
    const hx = rp.x, hz = rp.z - 9, hd = Math.hypot(hx, hz);
    if (hd > 30) { rp.x = hx / hd * 30; rp.z = 9 + hz / hd * 30; }
    if (flight.wind) flight.wind.setVol(0.3 + flight.vel.length() * 0.08);
    if (flight.t <= 0) { flight.phase = 'returning'; showBanner(tr('VOLTANDO PRA VARANDA', 'HEADING BACK TO THE PORCH', 'PALUU KUISTILLE'), '', '', '#60e0ff', 2.2); }
  } else if (flight.phase === 'returning') {
    if (moveToward(rp, t3.set(0, PLAYER_Y, 0), 7.5 * dt)) {
      endFlight();
      popupAhead(tr('DE VOLTA À VARANDA!', 'BACK ON THE PORCH!', 'TAKAISIN KUISTILLA!'), '#8dff4a', 1.1);
      sfx('land'); pulseAll(0.6, 150);
    }
  }
}

// =============================================================================
// UPDATE POR FRAME
// =============================================================================
/** Retorna { rHeld, lHeld }. */
const held = { r: false, l: false };
export function updatePlayer(dt) {
  const xr = xrActive();
  P.moving = false;
  P.turning = Math.max(0, P.turning - dt);
  if (!xr) updatePcControls(dt);
  else {
    vrLocomotion(dt); vrTurn(dt); pollButtons();   // girar com o direcional vale também no voo (como na 2.1)
    const L = CTRL.left;
    if (L && L.userData.squeezeT && performance.now() - L.userData.squeezeT > 300) {
      L.userData.squeezeT = 0;
      if (canUlt()) fireUltimate();   // sem carga: não faz nada (nada de aviso na cara)
    }
  }
  updateRigHeight(dt);
  updateFlight(dt, xr);
  // a cadeira acompanha o corpo (no VR, para onde a cabeça aponta)
  if (xr) {
    const cw = camera.getWorldDirection(t0); cw.y = 0;
    if (cw.lengthSq() > 1e-3) { cw.normalize(); wheelchair.rotation.y = Math.atan2(-cw.x, -cw.z) - Math.PI - rig.rotation.y; }
    wheelchair.position.set(0, 0, 0);   // fixa sob o corpo (como na 2.1): inclinar para ler o painel não o empurra
  } else { wheelchair.rotation.y = Math.PI; wheelchair.position.set(0, 0, 0); }
  ov.move = xr && G.settings.vignette && (P.moving || P.turning > 0 || flightActive()) ? 1 : 0;
  held.r = xr ? triggerHeld(CTRL.right) : (P.mouseDown || P.touchActive);
  held.l = xr ? triggerHeld(CTRL.left) : false;
  return held;
}
export function resetPlayer() {
  endFlight();
  flight.done = false;
  rig.position.set(0, PLAYER_Y, 0);
  rigVy = 0;
  if (!xrActive()) { P.yaw = Math.PI; P.pitch = -0.08; applyPcView(); }
}
