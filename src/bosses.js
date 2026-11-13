// =============================================================================
// CHEFES — um por wave, cada um com corpo e mecânica próprios (nada de disco recolorido).
//  1 ZEPELIM        dirigível: estoure os 3 balões
//  2 OLHÃO          olho gigante: só toma dano aberto; puxa galinha com o olhar
//  3 CENTOPEIA      cobra de gomos voando: destrua os gomos, depois a cabeça
//  4 POLVO          tentáculos agarram galinhas: atire no tentáculo pra soltar
//  5 MINHOCÃO       anda por baixo da terra e sobe pra morder
//  6 TEMPESTADE     máquina escondida numa nuvem: raios e tornado
//  7 MÁGICO         cartola com 2 ilusões; só o de verdade tem olhos brilhando
//  8 COLMEIA        abelhas em formação mantêm o escudo e carregam galinhas
//  9 COLHEITADEIRA  máquina no chão do quintal: frente blindada, tanques vermelhos
// 10 GALOZILLA      galo-robô gigante atrás da cerca (chefe final)
// Cada chefe é uma entidade de ufos.js (partes de colisão, barra de vida, morte).
// =============================================================================
import { THREE, scene, camPos, rig, toon, outlineMat, outlineGeo, bakeWith, sph, cyl, box, cone, torus, lathe, ico } from './render.js';
import { G, clamp, rand, pick, tmpV } from './core.js';
import { tr } from './i18n.js';
import { BOSSES, BOSS_ORDER } from './config.js';
import { fxAdd, fxAlpha, SHAPE, sparks, smoke, fireball, feathers, confetti, blast, debrisBurst, popup, showBanner, glow, seg, bolt, flashScreen } from './fx.js';
import { sfx } from './audio.js';
import { chickens, scareChicken, chickenCenter } from './chickens.js';
import { groundHeightAt } from './world.js';
import { ufos, isAlive, makeEntity, makeHpBar, drawHpBar, addPart, refreshParts, moveToward, stopBeam, updateAbductor, pickUfoTarget, fireEnemy, spawnRegular, aliveRegulars } from './ufos.js';
import { killUfo, rescueChicken, abductChicken, damagePlayer } from './combat.js';
import { pulseAll } from './player.js';

const [t0, t1, t2, t3, t4, t5] = tmpV(6);
const _c = new THREE.Color(), _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _col = new THREE.Color();
const QI = new THREE.Quaternion(), Z_AX = new THREE.Vector3(0, 0, 1);
const PI = Math.PI;
const ease = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
const lerp = (a, b, k) => a + (b - a) * k;

// ---------- Peças, geometria em cache e instâncias ----------
const geoCache = {};
function geo(key, fn) { if (!geoCache[key]) { const g = bakeWith(fn); geoCache[key] = { g, o: outlineGeo(g) }; } return geoCache[key]; }
const OUT = outlineMat(0.03, 0x18101e);
const INST_MAT = toon({ ramp: 4 });
const basicCache = {};
const BASIC = (hex, o) => { const k = hex + JSON.stringify(o || 0); return basicCache[k] || (basicCache[k] = new THREE.MeshBasicMaterial(Object.assign({ color: hex, fog: false }, o))); };
/** Malha do chefe (usa o material dele: pisca junto quando leva dano) + contorno. */
function piece(u, key, fn, parent) {
  const C = geo(key, fn);
  const m = new THREE.Mesh(C.g, u.bodyMat);
  m.add(new THREE.Mesh(C.o, OUT));
  (parent || u.group).add(m);
  return m;
}
function anchor(parent, x, y, z) { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); return o; }
/** Placa vermelha (ponto fraco) presa no chefe: `size` na escala do pai, `r` = raio de acerto no mundo. */
function weakPlate(u, parent, x, y, z, size, r, mult = 2, rx = 0, ry = 0) {
  const a = anchor(parent, x, y, z); a.rotation.set(rx, ry, 0); a.scale.setScalar(size);
  a.part = addPart(u, a, { r, kind: 'crit', mult });
  (u.plates || (u.plates = [])).push(a);
  return a;
}
function extra(u, obj) { scene.add(obj); (u.extras || (u.extras = [])).push(obj); return obj; }
/** Muitas cópias de uma peça (tentáculos, gomos, abelhas, nuvens) em 2 draw calls. */
function instanced(u, key, fn, n, outW = 0.03) {
  const C = geo(key, fn);
  const im = new THREE.InstancedMesh(C.g, INST_MAT, n), io = new THREE.InstancedMesh(C.o, outlineMat(outW, 0x18101e), n);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  io.instanceMatrix = im.instanceMatrix;
  im.setColorAt(0, _col.setRGB(1, 1, 1));
  im.count = io.count = 0; im.frustumCulled = io.frustumCulled = false;
  extra(u, im); extra(u, io);
  return { im, io, k: 0 };
}
const iBegin = I => { I.k = 0; };
function iPut(I, pos, q, sx, sy, sz, r = 1, g = 1, b = 1) {
  _m4.compose(pos, q, _s.set(sx, sy, sz)); I.im.setMatrixAt(I.k, _m4); I.im.setColorAt(I.k, _col.setRGB(r, g, b)); I.k++;
}
function iEnd(I) { I.im.count = I.io.count = I.k; I.im.instanceMatrix.needsUpdate = true; I.im.instanceColor.needsUpdate = true; }
function alienHead(g, x, y, z, s = 1, skin = 0x6ee070) {
  sph(g, 0.22 * s, skin, x, y, z, 12, 10).scale.set(1.15, 1, 1);
  sph(g, 0.06 * s, 0x101018, x - 0.08 * s, y + 0.02 * s, z + 0.17 * s, 8, 6); sph(g, 0.06 * s, 0x101018, x + 0.08 * s, y + 0.02 * s, z + 0.17 * s, 8, 6);
  cyl(g, 0.012 * s, 0.012 * s, 0.16 * s, 5, 0x50b050, x - 0.08 * s, y + 0.26 * s, z); cyl(g, 0.012 * s, 0.012 * s, 0.16 * s, 5, 0x50b050, x + 0.08 * s, y + 0.26 * s, z);
  sph(g, 0.035 * s, 0xffe060, x - 0.08 * s, y + 0.35 * s, z, 6, 4); sph(g, 0.035 * s, 0xffe060, x + 0.08 * s, y + 0.35 * s, z, 6, 4);
}

// ---------- Galinhas: agarrar / soltar / levar ----------
const okChicken = c => c && c.state !== 'gone' && c.state !== 'abducting' && c.state !== 'safe';
function hold(u, c) { c.state = 'abducting'; c.abductor = u; if (c.alert) c.alert.visible = false; }
const holds = (u, c) => !!c && c.state === 'abducting' && c.abductor === u;
function drop(u, c) { if (holds(u, c)) rescueChicken(c); }
function eat(u, c) { if (holds(u, c)) abductChicken(c, u); }
function nearestChicken(x, z, maxD = 99) {
  let best = null, bd = maxD;
  for (const c of chickens) { if (!okChicken(c)) continue; const d = Math.hypot(c.pos.x - x, c.pos.z - z); if (d < bd) { bd = d; best = c; } }
  return best;
}
const faceYaw = (obj, x, z) => { obj.rotation.y = Math.atan2(x - obj.position.x, z - obj.position.z); };

// ---------- Ataques compartilhados ----------
// A complexidade cresce a cada chefe: o 1º só abduz; cada um seguinte ganha mais um tipo de ataque.
// Tudo que vai no jogador é projétil (gosma, plasma, bomba) e pode ser derrubado a tiros (justo no celular).
const hpK = u => u.hp / u.maxHp;
/** n bombas com anel de aviso em volta de (cx, cz), dentro do quintal. */
function bombsNear(n, cx, cz, R, h = 11) {
  for (let k = 0; k < n; k++) fireEnemy('bomb', t5.set(clamp(cx + rand(-R, R), -8, 8), h + k * 1.2, clamp(cz + rand(-R, R), 3.2, 16)));
}
/** conta o tempo de um ataque: devolve true quando é hora (e já rearma com `every`). */
function due(u, key, edt, every, first = every) {
  if (u[key] == null) u[key] = first;
  u[key] -= edt;
  if (u[key] > 0) return false;
  u[key] = every; return true;
}

// ---------- Base ----------
function base(id, vet) {
  const D = BOSSES[id], idx = BOSS_ORDER.indexOf(id);
  const u = makeEntity('boss', 'boss', 1);
  u.body.visible = false; u.alien.visible = false; u.custom = true;
  u.bid = id; u.D = D;
  // A vida acompanha (em parte) o poder de fogo do jogador: quem pegou muita melhoria de ataque ainda
  // mata mais rápido, mas a luta não vira um piscar de olhos. O Zepelim conta balões, não vida.
  const power = G.up.dmg * G.up.rate * (1 + 0.5 * (G.up.front || 0));
  u.hp = u.maxHp = id === 'zepelim' ? D.hp : vet ? Math.round(D.hp * 0.6) : Math.round(D.hp * (1 + Math.max(0, G.wave - idx) * 0.3) * Math.pow(Math.max(1, power), 0.7));
  u.pts = vet ? 400 + idx * 100 : 1500 + idx * 500;
  u.vet = !!vet;   // veterano: chefe já vencido que volta como inimigo comum (vida base, sem faixa de chefão)
  u.hover = new THREE.Vector3();
  u.bt = 0; u.traitT = 3; u.dmgAcc = 0;
  return u;
}
function finish(u, barY, shadowR, silent) {
  u.barY = barY; u.shadowR = shadowR;
  u.hpBar = makeHpBar(2.6, 0.34);
  drawHpBar(u);
  u.prev.copy(u.pos);
  u.group.updateMatrixWorld(true);
  refreshParts(u);
  ufos.push(u);
  if (!silent) {
    sfx('bossSpawn'); pulseAll(0.6, 200);
    showBanner('⚠ ' + u.D.name + ' ⚠', u.D.hint, tr('CHEFÃO', 'BOSS', 'POMO'), '#ff4040', 4);
  }
  return u;
}
/** Morte em série de explosões (chefes de chão / gigantes). */
function boomDeath(dur, R, H) {
  return (u, dt) => {
    if (Math.random() < dt * 14) {
      t0.set(u.pos.x + rand(-R, R), u.pos.y + rand(0.3, H), u.pos.z + rand(-R, R));
      fireball(t0, rand(0.5, 1.2)); if (Math.random() < 0.4) { sfx('explosionSmall', { pos: t0 }); debrisBurst(t0, 0x808898, 4, 4); }
    }
    u.group.position.x += Math.sin(u.deadT * 60) * 0.02;
    if (u.deadT < dur) return false;
    t0.set(u.pos.x, u.pos.y + H * 0.5, u.pos.z);
    fireball(t0, R * 1.2); blast(t0, R * 2, 0xff9030); debrisBurst(t0, 0x808898, 24, 6); confetti(t0, 60, 6);
    sfx('ufoExplode', { pos: t0 }); pulseAll(1, 300);
    return true;
  };
}

// =============================================================================
// 1 · ZEPELIM
// =============================================================================
const BAG_COLS = [0x5effd0, 0xff4fd8, 0xb6ff3a], ZS = 0.8;   // ZS = tamanho do Batedor (o menor chefe)
function mkZepelim(u) {
  // casco de arraia com o piloto na cabine aberta e 3 células de energia em cima
  piece(u, 'sc_hull', g => {
    sph(g, 1, 0x9aa4c0, 0, 0.3, 0, 18, 10).scale.set(2.1, 0.42, 1.05);
    sph(g, 1, 0x5a6278, 0, 0.1, 0, 18, 8).scale.set(1.5, 0.5, 0.8);
    torus(g, 0.5, 0.09, 6, 16, 0x5effd0, 0, -0.38, 0).rotation.x = PI / 2;
    for (const sx of [-1, 1]) {
      const w = box(g, 1.5, 0.09, 0.75, 0x7a84a0, sx * 2.0, 0.34, -0.3); w.rotation.y = sx * 0.5; w.rotation.z = -sx * 0.16;
      sph(g, 0.13, 0xff4fd8, sx * 2.62, 0.47, -0.62, 8, 6);
      cone(g, 0.18, 0.5, 6, 0x5a6278, sx * 1.1, 0.3, -1.0).rotation.x = -PI / 2;
    }
    for (let k = -3; k <= 3; k++) sph(g, 0.075, 0x5effd0, k * 0.55, 0.3, 1.0 - Math.abs(k) * 0.075, 6, 4);
    sph(g, 0.46, 0x2a2f3e, 0.0, 0.6, 0.3, 12, 8).scale.y = 0.6;
    alienHead(g, 0.0, 0.95, 0.34, 1.35);
    for (let k = -1; k <= 1; k++) cyl(g, 0.34, 0.42, 0.5, 8, 0x5a6278, k * 1.35, 0.78, -0.15);   // soquetes dos cristais
  });
  u.prop = piece(u, 'sc_turbine', g => { for (let k = 0; k < 3; k++) box(g, 0.9, 0.09, 0.06, 0xd0d0d8, 0, 0, 0).rotation.z = k * PI / 3; sph(g, 0.12, 0x5effd0, 0, 0, 0, 8, 6); });
  u.prop.position.set(0, 0.34, -1.08);
  const bagHp = 4 + Math.floor(G.wave * 0.8);
  u.bags = [];
  for (let k = 0; k < 3; k++) {
    const m = piece(u, 'sc_cell' + k, g => {   // cristal de energia preso por garras
      ico(g, 0.5, BAG_COLS[k], 0, 0, 0, 0).scale.set(1, 1.7, 1);
      for (let c = 0; c < 3; c++) { const a = c * 2.094 + 0.5; const q = cone(g, 0.09, 0.7, 4, 0xd0d0d8, Math.cos(a) * 0.46, -0.45, Math.sin(a) * 0.46); q.rotation.z = Math.cos(a) * 0.35; q.rotation.x = -Math.sin(a) * 0.35; }
      torus(g, 0.4, 0.07, 5, 12, 0x8a94a8, 0, -0.72, 0).rotation.x = PI / 2;
    });
    m.position.set((k - 1) * 1.35, 1.72, -0.15);
    const part = addPart(u, m, { r: 0.8 * ZS, kind: 'sub', hp: bagHp, maxHp: bagHp, onDown: zepPop });
    u.bags.push({ m, part });
  }
  addPart(u, anchor(u.group, 0, 0.3, 0), { ellip: [2.0 * ZS, 0.45 * ZS, 1.0 * ZS], kind: 'armor' });
  u.armorMsg = tr('ESTOURE OS CRISTAIS!', 'POP THE CRYSTALS!', 'PUHKAISE KRISTALLIT!');
  u.pos.set(rand(-6, 6), 20, 26);
  u.hover.set(rand(-2, 2), 5.0, 7.5);
  u.speed = 1.3; u.beamTime = G.waveDef.beamTime * 1.1; u.descendH = 3.6; u.afterBeam = 'rising';
  u.state = 'entering'; u.idleT = 3; u.tilt = 0;
  u.group.rotation.y = PI;   // a frente (cabine) fica virada para a varanda
  u.group.scale.setScalar(ZS);
}
function zepPop(u, part) {
  confetti(part.c, 16, 3); popup('ZAP!', part.c, '#ffe080', 1.2);
  u.hp -= 1; u.tilt += (Math.random() < 0.5 ? -1 : 1) * 0.1;
  u.hover.y = Math.max(3.4, u.hover.y - 0.8); u.descendH = Math.max(2.8, u.descendH - 0.4); u.speed *= 0.85;
  if (u.state === 'beaming') { drop(u, u.target); stopBeam(u); u.state = 'rising'; }
  if (u.hp <= 0) killUfo(u, part.c); else drawHpBar(u);
}
function upZepelim(u, dt, edt) {
  const gp = u.pos;
  u.prop.rotation.z += dt * 14;
  for (const b of u.bags) if (b.part.active) { b.part.flashT = Math.max(0, (b.part.flashT || 0) - dt); b.m.scale.setScalar(1 + b.part.flashT * 1.5 + Math.sin(u.age * 2 + b.m.position.x) * 0.012); }
  u.group.rotation.z = u.tilt + Math.sin(u.age * 1.3) * 0.03;
  if (u.state === 'entering') { if (moveToward(gp, u.hover, 5 * edt)) { u.state = 'hover'; u.idleT = 2.5; } return; }
  if (u.state === 'hover') {
    gp.x += (u.hover.x + Math.sin(u.age * 0.4) * 4 - gp.x) * Math.min(1, edt * 0.8);
    gp.y += (u.hover.y + Math.sin(u.age * 1.1) * 0.25 - gp.y) * Math.min(1, edt);
    gp.z += (u.hover.z - gp.z) * Math.min(1, edt);
    u.idleT -= edt;
    if (u.idleT <= 0) { u.target = pickUfoTarget(); if (u.target) u.state = 'descending'; else u.idleT = 1; }
  } else if (u.state === 'rising') {
    t0.set(gp.x, u.hover.y, gp.z);
    if (moveToward(gp, t0, 2.5 * edt)) { u.state = 'hover'; u.idleT = 3.5; u.hover.x = clamp(gp.x, -4, 4); u.hover.z = clamp(gp.z, 5, 11); }
  } else updateAbductor(u, dt, edt);
}

// =============================================================================
// 2 · OLHÃO
// =============================================================================
const EYE_S = 1.5;   // tamanho geral do olho
function mkOlhao(u) {
  piece(u, 'eye_ball', g => {
    sph(g, 1.3, 0xe6f2c0, 0, 0, 0, 24, 16);
    cyl(g, 0.66, 0.66, 0.1, 24, 0xff8a18, 0, 0, 1.19).rotation.x = PI / 2;
    cyl(g, 0.5, 0.5, 0.1, 24, 0xffd040, 0, 0, 1.22).rotation.x = PI / 2;
    const p = cyl(g, 0.34, 0.34, 0.1, 20, 0x08080c, 0, 0, 1.26); p.rotation.x = PI / 2; p.scale.x = 0.36;   // pupila em fenda
    sph(g, 0.08, 0xffffff, 0.2, 0.2, 1.28, 8, 6);
    for (let k = 0; k < 6; k++) { const a = k * 1.05 + 0.3; const v = box(g, 0.03, 0.5, 0.03, 0x58c878, Math.cos(a) * 1.05, Math.sin(a) * 1.05, 0.55); v.rotation.z = a + PI / 2; v.rotation.y = 0.5; }
    for (const [ax, ay] of [[0, 0.1], [0.55, -0.3], [-0.55, -0.3]]) for (let k = 0; k < 6; k++) sph(g, 0.32 - k * 0.04, k % 2 ? 0x3c4254 : 0x6a7288, ax * (1 + k * 0.3) + Math.sin(k * 0.9 + ax * 3) * 0.12, ay * (1 + k * 0.3) - k * 0.06, -1.3 - k * 0.42, 8, 6);   // cabos
  });
  const lid = (key, flip) => {
    const m = piece(u, key, g => {
      const h = new THREE.Mesh(new THREE.SphereGeometry(1.38, 24, 10, 0, PI * 2, 0, PI / 2)); h.userData.c = 0x7a84a0; if (flip) h.rotation.z = PI; g.add(h);
      const rim = torus(g, 1.38, 0.08, 6, 28, 0x5effd0, 0, 0, 0); rim.rotation.x = PI / 2;
      for (let k = -3; k <= 3; k++) { const c = cone(g, 0.07, 0.34, 4, 0xd0d0d8, k * 0.26, flip ? -0.02 : 0.02, 1.36 - Math.abs(k) * 0.07); c.rotation.x = flip ? PI * 0.62 : PI * 0.38; }   // dentes de metal
      for (let k = 0; k < 5; k++) { const a = (k - 2) * 0.5; sph(g, 0.07, 0x8a94a8, Math.sin(a) * 1.0, (flip ? -1 : 1) * 0.95, Math.cos(a) * 0.4, 6, 4); }   // rebites
      if (!flip) { cyl(g, 0.04, 0.04, 0.7, 5, 0x8a94a8, 0, 1.7, -0.2); sph(g, 0.13, 0xff4fd8, 0, 2.1, -0.2, 8, 6); }   // antena
    });
    return m;
  };
  u.lidU = lid('eye_lidU', false); u.lidD = lid('eye_lidD', true);
  u.pPupil = addPart(u, anchor(u.group, 0, 0, 1.12), { r: 0.5 * EYE_S, kind: 'crit', mult: 2, onHit: eyePupilHit });
  addPart(u, u.group, { r: 1.36 * EYE_S });
  u.group.scale.setScalar(EYE_S);
  u.invulnMsg = tr('OLHO FECHADO! ESPERE ABRIR', 'EYE CLOSED! WAIT FOR IT', 'SILMÄ KIINNI! ODOTA');
  u.pos.set(rand(-8, 8), 22, 30);
  u.hover.set(rand(-5, 5), 6.2, 12);
  u.state = 'entering'; u.lidK = 1; u.invuln = 'armor'; u.gazeT = 0; u.from = new THREE.Vector3();
}
function eyeNewSpot(u) { u.hover.set(rand(-7, 7), rand(5, 7.5), rand(9.5, 14)); }
function eyeClose(u, t) { u.state = 'closed'; u.bt = t; u.target = null; eyeNewSpot(u); }
function eyePupilHit(u, part, dmg, pos) {
  if (u.state === 'open' && holds(u, u.target)) {   // na pupila enquanto puxa a galinha: pisca e solta
    drop(u, u.target);
    popup(tr('NO OLHO!', 'RIGHT IN THE EYE!', 'SUORAAN SILMÄÄN!'), pos, '#ff70ff', 1.2);
    u.hp -= 4; sfx('crit', { pos });
    eyeClose(u, 1.8);
  }
  return false;
}
function upOlhao(u, dt, edt) {
  const gp = u.pos;
  const closedGoal = u.state === 'open' ? 0 : 1;
  u.lidK += (closedGoal - u.lidK) * Math.min(1, dt * 9);
  const ang = lerp(-0.62, 0.87, u.lidK);
  u.lidU.rotation.x = ang; u.lidD.rotation.x = -ang;
  u.invuln = u.lidK > 0.55 ? 'armor' : null;
  // olha para o jogador (ou para a galinha que está puxando)
  if (u.state === 'open' && u.target && u.target.state !== 'gone') chickenCenter(u.target, t0); else t0.copy(camPos);
  u.group.lookAt(t0);
  if (u.state === 'entering') { if (moveToward(gp, u.hover, 7 * edt)) eyeClose(u, 1.2); return; }
  if (u.state === 'closed') {
    moveToward(gp, u.hover, 4.5 * edt);
    gp.y += Math.sin(u.age * 2) * 0.004;
    u.bt -= edt;
    if (u.bt <= 0) {
      u.state = 'open'; u.gazeT = 0; u.bt = 3.6; u.target = pickUfoTarget(); sfx('ghostFade', { pos: gp });
      u.opens = (u.opens || 0) + 1;
      if (u.opens % 2 === 0) fireEnemy('goo', gp, 0.02);   // ataque novo: uma lágrima de gosma em você
    }
    return;
  }
  // aberto
  const tgt = u.target;
  u.pPupil.obj.getWorldPosition(t1);
  if (tgt && (okChicken(tgt) || holds(u, tgt))) {
    u.gazeT += edt;
    chickenCenter(tgt, t2);
    if (u.gazeT < 0.9) {   // mira (aviso)
      if (Math.floor(u.gazeT * 20) % 2) seg(t1, t2, 0.012, 0xff40a0);
      glow(t2.x, t2.y, t2.z, 0.6, 0xff40a0, 0.6);
    } else {
      if (!holds(u, tgt)) { hold(u, tgt); u.from.copy(tgt.pos); sfx('beamStart', { pos: gp }); }
      const k = (u.gazeT - 0.9) / 4.4;
      t3.copy(t1).setY(t1.y - 0.5);
      tgt.pos.lerpVectors(u.from, t3, ease(k));
      seg(t1, t2, 0.05 + Math.sin(u.age * 30) * 0.015, 0xff40a0);
      glow(t1.x, t1.y, t1.z, 1.2, 0xff40a0, 0.8);
      if (k >= 1) { eat(u, tgt); eyeClose(u, 2.4); }
    }
  } else {
    u.bt -= edt;
    if (u.bt <= 0) eyeClose(u, 2.4);
  }
}

// =============================================================================
// 3 · CENTOPEIA
// =============================================================================
const CEN_N = 9, CEN_STEP = 8, CEN_D = 0.13;
function mkCentopeia(u) {
  piece(u, 'cen_head', g => {
    lathe(g, [[0.001, -0.3], [0.5, -0.26], [0.95, -0.05], [1.0, 0.04], [0.6, 0.2], [0.001, 0.26]], 18, 0x4a5268);
    torus(g, 0.98, 0.05, 5, 20, 0xff9030, 0, 0, 0).rotation.x = PI / 2;
    sph(g, 0.5, 0x2a2f3e, 0, 0.26, 0.1, 12, 8).scale.y = 0.7;
    alienHead(g, 0, 0.66, 0.2, 1.6, 0xf08a3a);
    for (const sx of [-1, 1]) { const m = cone(g, 0.12, 0.8, 6, 0xd0d0d8, sx * 0.45, -0.1, 1.15); m.rotation.x = PI / 2; m.rotation.z = -sx * 0.45; sph(g, 0.12, 0xff3030, sx * 0.72, 0.08, 0.62, 8, 6); }
  });
  u.I = instanced(u, 'cen_seg', g => {   // vagão: mini disco (a cor vem por instância)
    lathe(g, [[0.001, -0.2], [0.34, -0.16], [0.62, -0.02], [0.62, 0.04], [0.36, 0.13], [0.001, 0.16]], 14, 0xffffff);
    sph(g, 0.27, 0xe8e8e8, 0, 0.15, 0, 10, 6).scale.y = 0.75;
    torus(g, 0.63, 0.035, 4, 14, 0x707070, 0, 0.01, 0).rotation.x = PI / 2;
    for (const sx of [-1, 1]) sph(g, 0.07, 0x505050, sx * 0.5, -0.12, 0, 6, 4);
  }, CEN_N, 0.03);
  const segHp = 12 + G.wave;
  u.segs = [];
  for (let i = 0; i < CEN_N; i++) {
    const a = new THREE.Object3D();
    const part = addPart(u, a, { r: 0.6, kind: 'sub', hp: segHp, maxHp: segHp, onDown: cenSegDown, keepVisible: true });
    u.segs.push({ a, part, col: i % 2 });
  }
  addPart(u, u.group, { r: 0.95 });
  weakPlate(u, u.group, 0, -0.34, 0.25, 1.4, 0.36, 2, 1.1);
  u.invuln = 'armor';
  u.invulnMsg = tr('DESTRUA OS VAGÕES PRIMEIRO!', 'DESTROY THE PODS FIRST!', 'TUHOA VAUNUT ENSIN!');
  u.pos.set(-16, 9, 28);
  u.trail = []; u.tau = rand(0, 6); u.spd = 4.4; u.speedK = 1; u.mode = 'path'; u.traitT = 6; u.carryT = 0;
  u.dir = new THREE.Vector3(1, 0, 0);
}
function cenSegDown(u, part) {
  const i = u.segs.findIndex(s => s.part === part);
  if (i >= 0) u.segs.splice(i, 1);
  debrisBurst(part.c, 0xff9030, 6, 3);
  u.speedK += 0.07;
  if (holds(u, u.target)) { drop(u, u.target); popup(tr('SOLTOU!', 'DROPPED IT!', 'PUDOTTI!'), part.c, '#60e0ff', 1); }
  u.mode = 'path'; u.traitT = Math.max(u.traitT, 4);
  if (!u.segs.length) {
    u.invuln = null; u.speedK = 1.7;
    showBanner(tr('NAVE-CHEFE EXPOSTA!', 'LEAD SHIP EXPOSED!', 'JOHTOALUS PALJAANA!'), tr('acabe com ela!', 'finish it!', 'viimeistele se!'), '', '#ffd040', 2);
  }
}
function upCentopeia(u, dt, edt) {
  const gp = u.pos;
  if (u.age > 5) {
    if (u.segs.length) {   // quanto menos vagões, mais nervosos: de 6,6 s até 3,4 s entre tiros
      if (due(u, 'atkT', edt, 3 + u.segs.length * 0.4, 5)) { const sg = pick(u.segs); fireEnemy('plasma', sg.a.position, 0.05); sg.part.flashT = 0.2; }
    } else if (gp.y > 2 && due(u, 'atkT', edt, 1.5)) fireEnemy('bomb', t5.set(clamp(gp.x, -8, 8), gp.y - 0.5, clamp(gp.z, 3.2, 16)));   // voo de bombardeio
  }
  // alvo do movimento
  u.tau += edt * 0.42 * u.speedK;
  t0.set(Math.sin(u.tau * 0.9) * 8.5, 4.8 + Math.sin(u.tau * 1.7) * 1.4, 10.5 + Math.sin(u.tau * 0.6 + 1) * 5);
  let k = 1;
  if (u.mode === 'path') {
    u.traitT -= edt;
    if (u.traitT <= 0 && u.segs.length) { u.target = pickUfoTarget(); if (u.target) { u.mode = 'dive'; sfx('dive', { pos: gp }); } else u.traitT = 2; }
  } else if (u.mode === 'dive') {
    const c = u.target;
    if (!okChicken(c)) { u.mode = 'path'; u.traitT = 3; }
    else {
      t0.set(c.pos.x, c.pos.y + 0.6, c.pos.z); k = 1.5;
      if (gp.distanceTo(t0) < 0.7) { hold(u, c); u.mode = 'carry'; u.carryT = 0; sfx('thiefGrab', { pos: gp }); popup(tr('PEGOU!', 'GOT ONE!', 'NAPPASI!'), gp, '#ff6060', 1); }
    }
  } else if (u.mode === 'carry') {
    const c = u.target;
    if (!holds(u, c)) { u.mode = 'path'; u.traitT = 5; }
    else {
      t0.y += 1.5;
      u.carryT += edt;
      c.pos.set(gp.x, Math.max(0, gp.y - 0.75), gp.z);
      if (u.carryT > 5.5) { eat(u, c); u.mode = 'path'; u.traitT = 6; }
    }
  }
  t1.copy(t0).sub(gp);
  const dist = t1.length();
  if (dist > 1e-3) { t1.divideScalar(dist); u.dir.lerp(t1, Math.min(1, dt * 4)).normalize(); gp.addScaledVector(u.dir, Math.min(dist, u.spd * u.speedK * k * edt)); }
  t2.copy(gp).add(u.dir); u.group.lookAt(t2);
  // rastro: os gomos seguem o caminho da cabeça
  const tr0 = u.trail;
  if (!tr0.length || tr0[0].distanceTo(gp) >= CEN_D) { const p = tr0.length > (CEN_N + 1) * CEN_STEP + 4 ? tr0.pop() : new THREE.Vector3(); tr0.unshift(p.copy(gp)); }
  const I = u.I; iBegin(I);
  for (let i = 0; i < u.segs.length; i++) {
    const s = u.segs[i];
    const idx = Math.min(tr0.length - 1, (i + 1) * CEN_STEP), prev = Math.min(tr0.length - 1, Math.max(0, idx - 3));
    const p = tr0[idx] || gp;
    s.a.position.copy(p);
    s.part.flashT = Math.max(0, (s.part.flashT || 0) - dt);
    t3.copy(tr0[prev] || gp).sub(p);
    if (t3.lengthSq() > 1e-6) _q.setFromUnitVectors(Z_AX, t3.normalize()); else _q.identity();
    const f = 1 + s.part.flashT * 8, sc = 1 + s.part.flashT * 1.5 + Math.sin(u.age * 6 + i) * 0.03;
    if (s.col) iPut(I, p, _q, sc, sc, sc, 0.3 * f, 0.85 * f, 0.75 * f); else iPut(I, p, _q, sc, sc, sc, 0.72 * f, 0.36 * f, 0.9 * f);
  }
  iEnd(I);
  if (!u.segs.length && Math.random() < 0.4) smoke(gp, 1, 0x602020, 0.3, 0.5, 0.2);
}

// =============================================================================
// 4 · POLVO ESPACIAL
// =============================================================================
const POL_T = 4, POL_B = 10, PS = 1.4;   // PS = tamanho geral do polvo
function mkPolvo(u) {
  piece(u, 'pol_head', g => {
    lathe(g, [[0.001, 0], [0.85, 0], [0.98, 0.18], [1.18, 0.5], [1.32, 1.0], [1.25, 1.55], [1.05, 1.9], [0.001, 1.95]], 20, 0x58c878);
    for (let k = 0; k < 11; k++) { const a = k * 2.4, r = k < 4 ? 0.3 : 0.72, y = k < 4 ? 2.4 : 2.05 + (k % 3) * 0.1; sph(g, 0.4 - (k % 3) * 0.04, k % 2 ? 0xf08ab0 : 0xf7a4c4, Math.cos(a) * r, y, Math.sin(a) * r, 8, 6); }   // cérebro à mostra
    torus(g, 1.07, 0.1, 6, 20, 0x8a94a8, 0, 1.88, 0).rotation.x = PI / 2;
    for (const sx of [-1, 1]) { sph(g, 0.36, 0xfff0a0, sx * 0.5, 0.95, 1.05, 12, 10); sph(g, 0.17, 0x101018, sx * 0.5, 0.95, 1.36, 10, 8).scale.x = 0.45; }
    sph(g, 0.2, 0xfff0a0, 0, 1.5, 1.1, 10, 8); sph(g, 0.09, 0x101018, 0, 1.5, 1.28, 8, 6);   // terceiro olho
    for (let k = -2; k <= 2; k++) cone(g, 0.06, 0.22, 5, 0xffffff, k * 0.14, 0.42, 1.22 - Math.abs(k) * 0.03).rotation.x = PI;
    torus(g, 0.86, 0.15, 6, 16, 0x3c4254, 0, 0.05, 0).rotation.x = PI / 2;
    for (let k = 0; k < 4; k++) { const a = k * PI / 2; cone(g, 0.2, 0.42, 6, 0xff9030, Math.cos(a) * 0.45, -0.2, Math.sin(a) * 0.45).rotation.x = PI; }
  });
  u.I = instanced(u, 'ball', g => sph(g, 1, 0xffffff, 0, 0, 0, 10, 8), POL_T * POL_B, 0.08);
  u.tents = [];
  for (let i = 0; i < POL_T; i++) {
    const T = { a: i * PI / 2 + PI / 4, state: 'idle', t: 0, tgt: null, tip: new THREE.Vector3(), from: new THREE.Vector3(), flash: 0, ph: rand(0, 6), tipA: new THREE.Object3D(), midA: new THREE.Object3D() };
    const onHit = (uu, part, dmg, pos) => tentHit(uu, T, dmg, pos);
    T.pTip = addPart(u, T.tipA, { r: 0.66, kind: 'tent', onHit });
    T.pMid = addPart(u, T.midA, { r: 0.56, kind: 'tent', onHit });
    u.tents.push(T);
  }
  addPart(u, anchor(u.group, 0, 1.25, 0), { ellip: [1.32 * PS, 1.28 * PS, 1.32 * PS] });
  for (const sx of [-1, 1]) addPart(u, anchor(u.group, sx * 0.5, 0.95, 1.12), { r: 0.42 * PS, kind: 'crit', mult: 1.6 });
  weakPlate(u, u.group, 0, -0.12, 0.55, 2.0, 0.5 * PS, 1.6, 1.25);
  u.group.scale.setScalar(PS);
  u.pos.set(rand(-6, 6), 24, 30);
  u.hover.set(0, 6.8, 10.5);
  u.state = 'entering'; u.traitT = 2.5;
  for (const T of u.tents) T.tip.copy(u.pos);
}
function tentHit(u, T, dmg, pos) {
  sparks(pos, 0xd0a0ff, 6, 3); sfx('eggHitUfo', { pos });
  if (T.state === 'stun') return true;
  const had = holds(u, T.tgt);
  if (had) { drop(u, T.tgt); popup(tr('SOLTOU!', 'LET GO!', 'PÄÄSTI IRTI!'), pos, '#60e0ff', 1.1); }
  T.state = 'stun'; T.t = 3.4; T.tgt = null; T.flash = 0.3;
  u.hp -= dmg * 0.5; u.flashT = 0.09;
  if (u.hp <= 0) killUfo(u, pos); else drawHpBar(u);
  return true;
}
function upPolvo(u, dt, edt) {
  const gp = u.pos;
  if (u.state === 'entering') { if (moveToward(gp, u.hover, 6 * edt)) u.state = 'hover'; }
  else {
    // a cabeça vai para cima de quem está sendo atacado
    let cx = 0, cz = 0, n = 0;
    for (const T of u.tents) if (T.tgt && (T.state === 'reach' || T.state === 'hold')) { cx += T.tgt.pos.x; cz += T.tgt.pos.z; n++; }
    if (n) u.hover.set(clamp(cx / n, -6, 6), 6.8, clamp(cz / n + 1, 7, 14)); else u.hover.set(Math.sin(u.age * 0.3) * 4, 6.8, 10.5);
    t0.set(u.hover.x, u.hover.y + Math.sin(u.age * 1.2) * 0.3, u.hover.z);
    moveToward(gp, t0, 2.2 * edt);
    if (due(u, 'inkT', edt, hpK(u) < 0.5 ? 6.5 : 9, 6)) { t5.set(gp.x, gp.y + 0.6 * PS, gp.z); fireEnemy('goo', t5, 0.03); if (hpK(u) < 0.3) fireEnemy('goo', t5, 0.14); }   // jato de tinta em você
    u.traitT -= edt;
    if (u.traitT <= 0) {
      const busy = u.tents.filter(T => T.state === 'reach' || T.state === 'hold').length;
      const idle = u.tents.filter(T => T.state === 'idle');
      const tgt = busy < (hpK(u) < 0.3 ? 3 : hpK(u) < 0.6 ? 2 : 1) && idle.length ? pickUfoTarget() : null;   // 1, depois 2, depois 3 tentáculos de uma vez
      if (tgt && !u.tents.some(T => T.tgt === tgt)) {
        const T = idle.sort((a, b) => a.tip.distanceTo(tgt.pos) - b.tip.distanceTo(tgt.pos))[0];
        T.state = 'reach'; T.t = 0; T.tgt = tgt; T.from.copy(T.tip);
        sfx('gooCharge', { pos: gp });
        u.traitT = busy ? 5.5 : 4.2;
      } else u.traitT = 1;
    }
  }
  faceYaw(u.group, camPos.x, camPos.z);
  u.group.scale.y = PS * (1 + Math.sin(u.age * 2.2) * 0.04);
  const I = u.I; iBegin(I);
  for (const T of u.tents) {
    const ca = Math.cos(T.a), sa = Math.sin(T.a);
    t0.set(gp.x + ca * 0.75 * PS, gp.y + 0.1, gp.z + sa * 0.75 * PS);   // base
    T.flash = Math.max(0, T.flash - dt);
    if (T.state === 'idle') {
      const w = T.a + Math.sin(u.age * 0.7 + T.ph) * 0.35;
      t1.set(gp.x + Math.cos(w) * 2.1 * PS, gp.y - 3.1 + Math.sin(u.age * 1.3 + T.ph) * 0.35, gp.z + Math.sin(w) * 2.1 * PS);
      T.tip.lerp(t1, Math.min(1, dt * 4));
    } else if (T.state === 'reach') {
      T.t += edt;
      if (!okChicken(T.tgt)) { T.state = 'idle'; T.tgt = null; }
      else {
        chickenCenter(T.tgt, t1);
        T.tip.lerpVectors(T.from, t1, ease(T.t / 1.5));
        glow(T.tip.x, T.tip.y, T.tip.z, 0.9, 0xff3050, 0.5 + Math.sin(u.age * 20) * 0.3);
        if (T.t >= 1.5) {
          if (T.tip.distanceTo(t1) < 0.9) { hold(u, T.tgt); T.state = 'hold'; T.t = 0; T.from.copy(T.tip); sfx('thiefGrab', { pos: T.tip }); }
          else { T.state = 'idle'; T.tgt = null; }
        }
      }
    } else if (T.state === 'hold') {
      if (!holds(u, T.tgt)) { T.state = 'idle'; T.tgt = null; }
      else {
        T.t += edt;
        t1.set(gp.x, gp.y - 0.5, gp.z);
        T.tip.lerpVectors(T.from, t1, ease(T.t / 6.4));
        T.tgt.pos.set(T.tip.x, Math.max(0, T.tip.y - 0.3), T.tip.z);
        if (T.t >= 6.4) { eat(u, T.tgt); T.state = 'idle'; T.tgt = null; }
      }
    } else {   // stun: encolhido e tremendo
      T.t -= edt;
      t1.set(gp.x + ca * 1.3 + Math.sin(u.age * 30) * 0.05, gp.y - 1.2, gp.z + sa * 1.3);
      T.tip.lerp(t1, Math.min(1, dt * 6));
      if (T.t <= 0) T.state = 'idle';
    }
    // corrente de bolas numa curva (base → controle → ponta)
    t2.set(gp.x + ca * 1.7 * PS, gp.y - 0.3 + Math.sin(u.age * 2 + T.ph) * 0.15, gp.z + sa * 1.7 * PS);
    const red = T.state === 'reach', fl = T.flash > 0 ? 3 : 1;
    for (let j = 0; j < POL_B; j++) {
      const s = j / (POL_B - 1), a = (1 - s) * (1 - s), b = 2 * s * (1 - s), c = s * s;
      t3.set(t0.x * a + t2.x * b + T.tip.x * c, t0.y * a + t2.y * b + T.tip.y * c, t0.z * a + t2.z * b + T.tip.z * c);
      const r = j === POL_B - 1 ? 0.42 : lerp(0.5, 0.28, s);
      if (j === POL_B - 1) iPut(I, t3, QI, r, r, r, (red ? 1.6 : 1.0) * fl, (red ? 0.3 : 0.6) * fl, 0.2 * fl);
      else iPut(I, t3, QI, r, r, r, (j % 2 ? 0.24 : 0.34) * fl, (j % 2 ? 0.6 : 0.78) * fl, (j % 2 ? 0.4 : 0.48) * fl);
      if (j === 5) T.midA.position.copy(t3);
    }
    T.tipA.position.copy(T.tip);
  }
  iEnd(I);
}

// =============================================================================
// 5 · MINHOCÃO
// =============================================================================
const WORM_DOWN = -4.3;
function mkMinhocao(u) {
  u.mound = piece(u, 'worm_mound', g => {
    sph(g, 1.05, 0x7a5230, 0, 0, 0, 14, 8).scale.set(1, 0.36, 1);
    for (let k = 0; k < 7; k++) { const a = k * 0.9; ico(g, 0.12 + (k % 3) * 0.05, 0x8a8478, Math.cos(a) * 0.85, 0.12, Math.sin(a) * 0.85); }
  });
  u.worm = new THREE.Group(); u.group.add(u.worm);
  piece(u, 'worm_body', g => {   // máquina-verme: anéis de metal, janela do piloto e boca de garras
    for (let k = 0; k < 6; k++) { cyl(g, 0.74 - k * 0.03, 0.8 - k * 0.03, 0.5, 14, k % 2 ? 0x3c4254 : 0x6a7288, 0, 0.3 + k * 0.52, 0); torus(g, 0.78 - k * 0.03, 0.05, 5, 14, k % 2 ? 0xff9030 : 0x2a2f3e, 0, 0.56 + k * 0.52, 0).rotation.x = PI / 2; }
    sph(g, 0.36, 0x9fe8ff, 0, 2.2, 0.42, 10, 8); torus(g, 0.38, 0.06, 5, 12, 0x8a94a8, 0, 2.2, 0.62);
    alienHead(g, 0, 2.16, 0.7, 1.05, 0xb07af0);
    torus(g, 0.52, 0.15, 6, 14, 0x8a94a8, 0, 3.32, 0).rotation.x = PI / 2;
    cyl(g, 0.46, 0.3, 0.3, 12, 0xff3020, 0, 3.22, 0);
    for (let t = 0; t < 6; t++) { const a = t / 6 * PI * 2; const c = cone(g, 0.13, 0.62, 4, 0xd0d0d8, Math.cos(a) * 0.5, 3.6, Math.sin(a) * 0.5); c.rotation.z = Math.cos(a) * 0.45; c.rotation.x = -Math.sin(a) * 0.45; }
    for (const sx of [-1, 1]) { cyl(g, 0.03, 0.03, 0.5, 5, 0x8a94a8, sx * 0.62, 3.1, 0.45).rotation.z = -sx * 0.6; sph(g, 0.1, 0xff3030, sx * 0.78, 3.32, 0.45, 8, 6); }
  }, u.worm);
  u.wParts = [
    addPart(u, anchor(u.worm, 0, 1.0, 0), { ellip: [0.82, 1.0, 0.82] }),
    addPart(u, anchor(u.worm, 0, 2.4, 0), { ellip: [0.76, 0.8, 0.76] }),
  ];
  u.pMouth = addPart(u, anchor(u.worm, 0, 3.3, 0), { r: 0.62, kind: 'crit', mult: 2, onHit: wormMouthHit });
  u.wParts.push(u.pMouth);
  u.wParts.push(weakPlate(u, u.worm, 0, 1.15, 0.8, 1.7, 0.42, 2).part);
  u.onDamaged = (uu, d) => { uu.dmgAcc += d; if (uu.dmgAcc > uu.maxHp * 0.12) wormSpit(uu); };
  u.pos.set(rand(-5, 5), 0, 14.5);
  u.worm.position.y = WORM_DOWN;
  u.state = 'burrow'; u.bt = 0; u.target = null; u.noShadow = true;
  u.deadFn = boomDeath(0.7, 1.2, 3);
}
function wormSpit(u) {
  if (!holds(u, u.target)) return;
  u.pMouth.obj.getWorldPosition(t5);
  drop(u, u.target); u.target = null;
  popup(tr('CUSPIU!', 'SPAT IT OUT!', 'SYLKI ULOS!'), t5, '#60e0ff', 1.2);
  u.bt = Math.min(u.bt, 1.0);
}
function wormMouthHit(u) { wormSpit(u); return false; }
function upMinhocao(u, dt, edt) {
  const gp = u.pos, w = u.worm;
  const up = w.position.y > -2.2;
  for (const p of u.wParts) p.active = up;
  u.barY = up ? 4.4 : 1.3;
  if (u.state === 'burrow') {
    if (!okChicken(u.target)) u.target = pickUfoTarget();
    u.bt += edt;
    if (u.target) {
      t0.set(clamp(u.target.pos.x, -8, 8), 0, clamp(u.target.pos.z, 2, 16.5));
      const arrived = moveToward(gp, t0, 2.8 * edt);
      if (arrived || gp.distanceTo(t0) < 0.45 || u.bt > 5.5) {
        u.state = 'rumble'; u.bt = 0.9; sfx('gooCharge', { pos: gp });
        u.fake = hpK(u) < 0.5 && !u.justFaked && Math.random() < 0.6; u.justFaked = u.fake;   // finta: treme aqui, sai em outro lugar
        for (const k of chickens) if (Math.random() < 0.5 && Math.hypot(k.pos.x - gp.x, k.pos.z - gp.z) < 2.6) scareChicken(k, gp);   // o chão treme: metade percebe e corre
      }
    } else if (u.bt > 3) { u.state = 'rumble'; u.bt = 0.9; }
    u.mound.position.x = Math.sin(u.age * 30) * 0.03;
    if (Math.random() < dt * 14) { _c.setHex(0x9a7a50); fxAlpha.spawn(gp.x + rand(-0.7, 0.7), 0.15, gp.z + rand(-0.7, 0.7), rand(-0.5, 0.5), rand(0.8, 1.6), rand(-0.5, 0.5), _c, rand(0.2, 0.4), 0.7, 3, 0.5, 0.5, 0.8, SHAPE.smoke); }
  } else if (u.state === 'rumble') {
    u.bt -= edt;
    u.mound.position.x = Math.sin(u.age * 70) * 0.08; u.mound.scale.setScalar(1 + (0.9 - u.bt) * 0.35);
    glow(gp.x, 0.1, gp.z, 3.2, 0xff3020, 0.35 + Math.sin(u.age * 30) * 0.2);
    if (Math.random() < dt * 30) { _c.setHex(0x7a5230); fxAlpha.spawn(gp.x + rand(-1, 1), 0.1, gp.z + rand(-1, 1), rand(-1, 1), rand(2, 4), rand(-1, 1), _c, rand(0.1, 0.2), 0.6, 8, 0.2, 0, 1, SHAPE.solid); }
    if (u.bt <= 0 && u.fake) {
      u.fake = false; u.state = 'burrow'; u.bt = 2.5; u.target = pickUfoTarget(); u.mound.scale.setScalar(1);
      smoke(t0.set(gp.x, 0.3, gp.z), 5, 0x9a7a50, 0.6, 0.9, 0.6); popup(tr('ERA FINTA!', 'IT WAS A FAKE!', 'SE OLI HÄMÄYS!'), t0.set(gp.x, 1.6, gp.z), '#ffb060', 1.1);
    } else if (u.bt <= 0) {
      u.state = 'emerge'; u.bt = 0; u.dmgAcc = 0;
      const c = nearestChicken(gp.x, gp.z, 1.1);
      if (c) { hold(u, c); u.target = c; } else u.target = null;
      t0.set(gp.x, 0.4, gp.z); debrisBurst(t0, 0x7a5230, 14, 5); smoke(t0, 6, 0x9a7a50, 0.6, 1.0, 0.8);
      sfx('explosionSmall', { pos: gp }); pulseAll(0.6, 120);
      for (const k of chickens) if (k !== c && Math.hypot(k.pos.x - gp.x, k.pos.z - gp.z) < 3.2) scareChicken(k, gp);
      bombsNear(hpK(u) < 0.5 ? 3 : 2, gp.x, gp.z, 4, 6);   // torrões de terra voam e caem em volta
      faceYaw(u.group, camPos.x, camPos.z);
    }
  } else if (u.state === 'emerge') {
    u.bt += edt; u.mound.scale.setScalar(1.3);
    w.position.y = lerp(WORM_DOWN, 0, 1 - Math.pow(1 - clamp(u.bt / 0.32, 0, 1), 3));
    if (u.bt >= 0.32) { u.state = 'up'; u.bt = 3.8; }
  } else if (u.state === 'up') {
    u.bt -= edt;
    w.rotation.z = Math.sin(u.age * 2.4) * 0.1; w.rotation.x = 0.12 + Math.sin(u.age * 1.7) * 0.05;
    if (u.bt <= 0) { u.state = 'sink'; u.bt = 0; }
  } else if (u.state === 'sink') {
    u.bt += edt;
    w.position.y = lerp(0, WORM_DOWN, ease(u.bt / 0.5));
    if (u.bt >= 0.5) {
      if (holds(u, u.target)) eat(u, u.target);
      u.state = 'burrow'; u.bt = 0; u.target = pickUfoTarget(); u.mound.scale.setScalar(1); w.rotation.set(0, 0, 0);
    }
  }
  if (holds(u, u.target)) { u.pMouth.obj.getWorldPosition(t0); u.target.pos.set(t0.x, Math.max(0, t0.y - 0.25), t0.z); }
}

// =============================================================================
// 6 · TEMPESTADE
// =============================================================================
const CS = 1.3;   // tamanho do Cristal
const PUFFS = [[0, -0.2, -1.2, 1.3], [1.25, 0, -0.6, 1.2], [-1.25, -0.1, -0.6, 1.2], [0, 0.9, -0.3, 1.15], [0, -1.0, -0.3, 1.15], [0.9, 0.2, 0.9, 1.25], [-0.9, 0.1, 0.9, 1.25], [1.95, -0.2, 0.2, 0.95], [-1.95, 0.1, 0.1, 0.95]].map(p => p.map(v => v * CS));
const FUNNEL_GEO = new THREE.CylinderGeometry(1.5, 0.25, 1, 14, 1, true).translate(0, 0.5, 0);
function mkTempestade(u) {
  piece(u, 'storm_core', g => {
    sph(g, 0.7, 0x9aa4b8, 0, 0, 0, 14, 10);
    torus(g, 0.85, 0.08, 6, 18, 0xffd040, 0, 0, 0).rotation.x = PI / 2;
    for (let k = 0; k < 3; k++) { const a = k * 2.094; cyl(g, 0.05, 0.05, 0.9, 6, 0x606878, Math.cos(a) * 0.5, 0.7, Math.sin(a) * 0.5); sph(g, 0.14, 0x80e8ff, Math.cos(a) * 0.5, 1.2, Math.sin(a) * 0.5, 8, 6); }
    cone(g, 0.4, 0.4, 10, 0x7a8498, 0, -0.78, 0);
    alienHead(g, 0, 0.05, -0.62, 0.9);
  });
  u.I = instanced(u, 'puff', g => {   // cristal alienígena (a cor vem por instância)
    ico(g, 0.82, 0xffffff, 0, 0, 0, 0);
    for (const [x, y, z, rx, rz] of [[0, 0.75, 0, 0, 0], [0.6, 0.3, 0.2, 0, -1.0], [-0.55, 0.25, -0.3, 0.3, 1.0], [0.1, -0.7, 0.1, PI, 0], [0, 0.2, 0.7, 1.2, 0]]) { const c = cone(g, 0.3, 0.9, 5, 0xe8e8e8, x, y, z); c.rotation.x = rx; c.rotation.z = rz; }
  }, PUFFS.length, 0.07);
  const hp = 6 + Math.floor(G.wave * 0.6);
  u.puffs = PUFFS.map((o, i) => {
    const a = new THREE.Object3D();
    const part = addPart(u, a, { r: o[3] * 0.92, kind: 'sub', hp, maxHp: hp, onDown: puffDown, keepVisible: true });
    return { o, a, part, k: 1, regrow: 0, sh: 0.26 + (i % 3) * 0.05 };
  });
  addPart(u, u.group, { r: 0.85 * CS });
  weakPlate(u, u.group, 0, 0, 0.74, 1.5, 0.42 * CS, 2);
  u.group.scale.setScalar(CS);
  u.onDamaged = uu => stormWeaken(uu);
  u.funnel = extra(u, new THREE.Mesh(FUNNEL_GEO, BASIC(0x9098b0, { transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false })));
  u.funnel.visible = false;
  u.pos.set(0, 26, 34);
  u.hover.set(0, 8.6, 11.5);
  u.state = 'entering'; u.zapT = 4; u.torT = 6; u.zap = null; u.tor = null;
}
function stormWeaken(u) {
  if (!u.tor) return;
  u.tor.str -= 1;
  if (u.tor.str <= 0) { popup(tr('O TORNADO SE DESFEZ!', 'THE TORNADO BROKE UP!', 'TORNADO HAJOSI!'), t5.set(u.pos.x, 3, u.pos.z), '#60e0ff', 1.2); stormEndTornado(u); }
}
function stormEndTornado(u) { if (u.tor) { drop(u, u.tor.tgt); u.tor = null; u.funnel.visible = false; u.torT = 8; } }
function puffDown(u, part) {
  const P = u.puffs.find(p => p.part === part);
  if (P) { P.regrow = 7; P.k = 0; }
  smoke(part.c, 5, 0xc8ccd8, 0.7, 0.9, 0.5);
  if (u.zap) { u.zap = null; popup(tr('O RAIO FALHOU!', 'LIGHTNING FIZZLED!', 'SALAMA SAMMUI!'), part.c, '#60e0ff', 1.1); }
  if ((u.shardCD || 0) <= 0) { u.shardCD = 4.5; fireEnemy('plasma', part.c, 0.05); }   // o cristal quebrado devolve um estilhaço
  stormWeaken(u);
}
function upTempestade(u, dt, edt) {
  const gp = u.pos;
  if (u.state === 'entering') { if (moveToward(gp, u.hover, 7 * edt)) u.state = 'hover'; }
  else if (u.tor && okChickenOrHeld(u, u.tor.tgt) && !u.tor.held) { t0.set(u.tor.tgt.pos.x, u.hover.y, u.tor.tgt.pos.z); moveToward(gp, t0, 2.3 * edt); }
  else if (!u.tor) { t0.set(Math.sin(u.age * 0.25) * 5, u.hover.y + Math.sin(u.age) * 0.2, 11.5 + Math.sin(u.age * 0.18) * 2); moveToward(gp, t0, 1.6 * edt); }
  u.group.rotation.y += dt * 0.8;
  // nuvens
  const I = u.I; iBegin(I);
  for (const P of u.puffs) {
    if (!P.part.active) { P.regrow -= edt; if (P.regrow <= 0) { P.part.active = true; P.part.hp = P.part.maxHp; } }
    else P.k = Math.min(1, P.k + dt * 2.5);
    const br = 1 + Math.sin(u.age * 1.4 + P.o[0] * 3) * 0.04;
    P.a.position.set(gp.x + P.o[0] * br, gp.y + P.o[1] * br, gp.z + P.o[2] * br);
    P.part.flashT = Math.max(0, (P.part.flashT || 0) - dt);
    if (P.part.active) { const s = P.o[3] * P.k * (1 + P.part.flashT), f = P.sh + P.part.flashT * 4; iPut(I, P.a.position, QI, s * 1.1, s * 0.85, s, f * 1.7, f * 0.75, f * 2.5); }
  }
  iEnd(I);
  if (u.state === 'entering') return;
  // raio no jogador (com aviso no chão)
  if (!u.zap) { u.zapT -= edt; if (u.zapT <= 0) { const rp = rig.position; u.zap = { x: rp.x, z: rp.z, t: 1.5 }; u.zapT = hpK(u) < 0.5 ? 5.5 : 7.5; sfx('sniperCharge', { pos: gp }); } }
  else {
    const z = u.zap, y = groundHeightAt(z.x, z.z) + 0.08;
    z.t -= edt;
    glow(z.x, y, z.z, 2.6, 0xfff080, 0.45 + Math.sin(u.age * 40) * 0.25);
    t0.set(z.x, y, z.z);
    if (Math.floor(u.age * 16) % 2) seg(gp, t0, 0.01, 0xfff080);
    if (z.t <= 0) {
      bolt(gp, t0, 0.7, 0.2, 0xffffc0, 0.07); bolt(gp, t0, 0.5, 0.15, 0xffffff, 0.04);
      flashScreen(0xffffff, 0.15); sfx('tesla', { pos: t0 }); sparks(t0, 0xfff080, 16, 5);
      const rp = rig.position;
      if (Math.hypot(rp.x - z.x, rp.z - z.z) < 1.5) damagePlayer(12, tr('RAIO!', 'LIGHTNING!', 'SALAMA!'), '#fff080');
      for (const c of chickens) if (Math.hypot(c.pos.x - z.x, c.pos.z - z.z) < 3) scareChicken(c, t0);
      u.zap = null;
    }
  }
  u.shardCD = (u.shardCD || 0) - edt;
  if (hpK(u) < 0.6 && due(u, 'rainT', edt, 9, 3)) { bombsNear(hpK(u) < 0.3 ? 5 : 3, 0, 9.5, 7, 12); popup(tr('CHUVA DE CRISTAIS!', 'CRYSTAL RAIN!', 'KRISTALLISADE!'), t5.set(gp.x, gp.y - 3, gp.z), '#d0a0ff', 1.3); }
  // tornado: desce da nuvem, persegue uma galinha e suga
  if (!u.tor) {
    u.torT -= edt;
    if (u.torT <= 0) { const tgt = pickUfoTarget(); if (tgt) { u.tor = { tgt, held: false, t: 0, str: 3, from: new THREE.Vector3() }; sfx('takeoff', { pos: gp }); showBanner(tr('TORNADO!', 'TORNADO!', 'TORNADO!'), tr('acerte a nuvem pra desfazer', 'hit the cloud to break it', 'osu pilveen hajottaaksesi'), '', '#c0c8e0', 1.8); } else u.torT = 2; }
  } else {
    const T = u.tor, c = T.tgt;
    T.t += edt;
    u.funnel.visible = true; u.funnel.position.set(gp.x, 0, gp.z); u.funnel.scale.set(1, Math.max(0.5, gp.y - 0.6), 1); u.funnel.rotation.y -= dt * 9;
    for (let k = 0; k < 2; k++) { const a = u.age * 9 + k * 3.1, h = Math.random(); _c.setHex(0xb8bcc8); fxAlpha.spawn(gp.x + Math.cos(a) * (0.3 + h * 1.1), h * (gp.y - 1), gp.z + Math.sin(a) * (0.3 + h * 1.1), -Math.sin(a) * 2, 1.2, Math.cos(a) * 2, _c, 0.3 + h * 0.4, 0.5, 0, 0.5, 0.5, 0.45, SHAPE.smoke); }
    if (!T.held) {
      if (!okChicken(c) || T.t > 9) stormEndTornado(u);
      else if (Math.hypot(c.pos.x - gp.x, c.pos.z - gp.z) < 0.8) { hold(u, c); T.held = true; T.t = 0; T.from.copy(c.pos); }
    } else if (!holds(u, c)) stormEndTornado(u);
    else {
      const k = T.t / 4.6, r = 0.5 * (1 - k * 0.6);
      c.pos.set(gp.x + Math.cos(T.t * 7) * r, k * (gp.y - 1.2), gp.z + Math.sin(T.t * 7) * r);
      if (k >= 1) { eat(u, c); stormEndTornado(u); }
    }
  }
}
const okChickenOrHeld = (u, c) => okChicken(c) || holds(u, c);

// =============================================================================
// 7 · MÁGICO
// =============================================================================
const HAT_SLOTS = [[-7, 6, 11], [-3.5, 7.6, 13], [0, 6, 10], [3.5, 7.6, 13], [7, 6, 11], [0, 8.6, 14.5]];
const hatGeo = g => {   // nave-prisma: os hologramas usam a mesma geometria
  cone(g, 1.25, 1.3, 4, 0x3aa8b8, 0, 0.72, 0).rotation.y = PI / 4;
  const bot = cone(g, 1.25, 0.75, 4, 0x2a2f3e, 0, -0.3, 0); bot.rotation.x = PI; bot.rotation.y = PI / 4;
  torus(g, 1.3, 0.07, 5, 24, 0xff4fd8, 0, 0.07, 0).rotation.x = PI / 2;
  ico(g, 0.2, 0xffd040, 0, 1.5, 0, 0);
  sph(g, 0.55, 0x9fe8ff, 0, -0.12, 0.45, 14, 10);
  for (const sx of [-1, 1]) { sph(g, 0.12, 0x08080c, sx * 0.3, -0.14, 0.88, 8, 6); ico(g, 0.22, 0xff4fd8, sx * 1.75, 0.1, 0.2, 0); torus(g, 0.3, 0.04, 4, 12, 0x8a94a8, sx * 1.75, 0.1, 0.2).rotation.x = PI / 2; }
};
const MS = 1.25;   // tamanho da Miragem
function mkMagico(u) {
  piece(u, 'hat', hatGeo);
  u.group.scale.setScalar(MS);
  addPart(u, u.group, { ellip: [1.25 * MS, 1.0 * MS, 1.25 * MS] });
  u.decoys = [];
  for (let k = 0; k < 2; k++) {
    const g = new THREE.Group();
    const C = geo('hat', hatGeo);
    const m = new THREE.Mesh(C.g, u.bodyMat); m.add(new THREE.Mesh(C.o, OUT)); g.add(m);
    extra(u, g); g.visible = false;
    const part = addPart(u, g, { ellip: [1.25 * MS, 1.0 * MS, 1.25 * MS], kind: 'sub', hp: 1, maxHp: 1, onDown: decoyDown });
    part.active = false;
    u.decoys.push({ g, part, ph: rand(0, 6), base: new THREE.Vector3() });
  }
  u.onDamaged = (uu, d) => {
    uu.dmgAcc += d;
    if (uu.state === 'beaming' && uu.dmgAcc > uu.maxHp * 0.05) { drop(uu, uu.target); stopBeam(uu); uu.state = 'rising'; popup(tr('TRUQUE ESTRAGADO!', 'TRICK SPOILED!', 'TEMPPU PILALLA!'), uu.pos, '#60e0ff', 1.1); }
    if (uu.dmgAcc > uu.maxHp * 0.13) uu.shufT = Math.min(uu.shufT, 0.5);
  };
  u.pos.set(0, 24, 30);
  u.slot = new THREE.Vector3(0, 6, 10); u.hover.copy(u.slot);
  u.state = 'entering'; u.shufT = 6; u.cardT = 3; u.trickT = 7;
  u.speed = 3.2; u.beamTime = G.waveDef.beamTime * 0.9; u.descendH = 4.2; u.afterBeam = 'rising';
}
function hatPoof(p) { smoke(p, 6, 0xe8e0f8, 0.7, 0.8, 0.4); _c.setHex(0xffd040); for (let k = 0; k < 10; k++) fxAdd.spawn(p.x, p.y + 0.4, p.z, rand(-2, 2), rand(0, 3), rand(-2, 2), _c, 0.09, 0.7, 4, 0.5, 0, 1, SHAPE.star, 6); }
function decoyDown(u, part) {
  hatPoof(part.c); confetti(part.c, 14, 3);
  popup(tr('ERA HOLOGRAMA!', 'A HOLOGRAM!', 'SE OLI HOLOGRAMMI!'), part.c, '#d0a0ff', 1.1);
}
function hatShuffle(u) {
  if (u.state === 'beaming') { drop(u, u.target); stopBeam(u); }
  hatPoof(u.pos);
  for (const d of u.decoys) if (d.g.visible) hatPoof(d.g.position);
  const idx = [0, 1, 2, 3, 4, 5].sort(() => Math.random() - 0.5);
  u.slot.fromArray(HAT_SLOTS[idx[0]]); u.pos.copy(u.slot);
  u.decoys.forEach((d, k) => { d.base.fromArray(HAT_SLOTS[idx[k + 1]]); d.g.position.copy(d.base); d.g.visible = true; d.part.active = true; d.part.hp = 1; });
  hatPoof(u.pos); for (const d of u.decoys) hatPoof(d.g.position);
  sfx('ghostFade', { pos: u.pos });
  u.shufT = 6.5; u.dmgAcc = 0; u.state = 'hover';
}
function upMagico(u, dt, edt) {
  const gp = u.pos;
  faceYaw(u.group, camPos.x, camPos.z);
  u.group.rotation.z = Math.sin(u.age * 1.8) * 0.06;
  for (const d of u.decoys) if (d.g.visible) {
    d.g.position.set(d.base.x, d.base.y + Math.sin(u.age * 1.5 + d.ph) * 0.22, d.base.z);
    faceYaw(d.g, camPos.x, camPos.z);
    d.g.rotation.z = Math.sin(u.age * 1.8 + d.ph) * 0.06;
    d.g.scale.setScalar((Math.sin(u.age * 2.6 + d.ph) > 0.985 ? 0.9 : 1) * MS);   // a ilusão "falha" de vez em quando
    if (!d.part.active) d.g.visible = false;
  }
  // só o de verdade tem os olhos brilhando
  const cy = Math.cos(u.group.rotation.y), sy = Math.sin(u.group.rotation.y);
  for (const sx of [-1, 1]) glow(gp.x + (sx * 0.3 * cy + 0.9 * sy) * MS, gp.y - 0.14 * MS, gp.z + (-sx * 0.3 * sy + 0.9 * cy) * MS, 0.5, 0xffe040, 0.95);
  if (u.state === 'entering') { if (moveToward(gp, u.hover, 8 * edt)) hatShuffle(u); return; }
  if (u.state === 'hover') {
    gp.y = u.slot.y + Math.sin(u.age * 1.5) * 0.22;
    u.shufT -= edt; u.cardT -= edt; u.trickT -= edt;
    if (u.cardT <= 0) {
      const hurt = hpK(u) < 0.5;
      for (let k = 0; k < (hurt ? 3 : 1); k++) fireEnemy('plasma', gp, hurt ? 0.12 : 0.03);
      u.cardT = hurt ? 5 : 5.5;
    }
    if (due(u, 'decT', edt, 6.5, 4)) { const d = pick(u.decoys.filter(x => x.g.visible && x.part.active)); if (d) fireEnemy('goo', d.g.position, 0.04); }
    if (u.trickT <= 0) { u.target = pickUfoTarget(); u.trickT = 9; if (u.target) { u.state = 'descending'; u.dmgAcc = 0; return; } }
    if (u.shufT <= 0) hatShuffle(u);
  } else if (u.state === 'rising') {
    if (moveToward(gp, u.slot, 5 * edt)) { u.state = 'hover'; u.shufT = Math.min(u.shufT, 1.5); }
  } else updateAbductor(u, dt, edt);
}

// =============================================================================
// 8 · COLMEIA
// =============================================================================
const BEE_N = 12, QS = 1.25;   // QS = tamanho da Rainha
function mkColmeia(u) {
  piece(u, 'hive', g => {
    lathe(g, [[0.001, -1.3], [0.7, -1.25], [1.15, -0.9], [1.0, -0.62], [1.4, -0.3], [1.2, 0.0], [1.45, 0.32], [1.15, 0.62], [1.2, 0.9], [0.8, 1.15], [0.5, 1.3], [0.001, 1.36]], 22, 0x5a2a80);
    for (const [r, y] of [[1.42, -0.3], [1.47, 0.32], [1.22, 0.9]]) torus(g, r, 0.06, 5, 22, 0xb6ff3a, 0, y, 0).rotation.x = PI / 2;
    cyl(g, 0.46, 0.46, 0.1, 16, 0x12081c, 0, -0.45, 1.3).rotation.x = PI / 2;
    for (const sx of [-1, 1]) sph(g, 0.1, 0xffe040, sx * 0.16, -0.42, 1.37, 8, 6);
    cone(g, 0.16, 0.8, 5, 0xd0d0d8, 0, 1.7, 0);
    for (let k = 0; k < 5; k++) { const a = k / 5 * PI * 2; cone(g, 0.11, 0.5, 5, 0xd0d0d8, Math.cos(a) * 0.5, 1.45, Math.sin(a) * 0.5); }
    for (let k = 0; k < 5; k++) { const a = k * 1.3; sph(g, 0.14, 0xb6ff3a, Math.cos(a) * 1.2, -0.75 - (k % 2) * 0.2, Math.sin(a) * 1.2, 8, 6).scale.y = 1.8; }
  });
  u.I = instanced(u, 'bee', g => {   // zangão: mini caça
    sph(g, 0.3, 0x5a6278, 0, 0, 0, 10, 8).scale.set(0.75, 0.6, 1.3);
    sph(g, 0.16, 0xb6ff3a, 0, 0.1, 0.2, 8, 6);
    cone(g, 0.1, 0.3, 6, 0xd0d0d8, 0, 0, 0.5).rotation.x = PI / 2;
    for (const sx of [-1, 1]) { box(g, 0.5, 0.04, 0.26, 0x3c4254, sx * 0.38, 0, -0.1).rotation.y = -sx * 0.5; sph(g, 0.06, 0xff4fd8, sx * 0.6, 0, -0.24, 6, 4); }
    sph(g, 0.1, 0xff9030, 0, 0, -0.42, 6, 4);
  }, BEE_N, 0.035);
  const hp = 4 + Math.round(G.wave * 0.4);
  u.bees = [];
  for (let i = 0; i < BEE_N; i++) {
    const a = new THREE.Object3D();
    const part = addPart(u, a, { r: 0.44, kind: 'sub', hp, maxHp: hp, onDown: beeDown, keepVisible: true });
    u.bees.push({ i, a, part, dir: new THREE.Vector3(0, 0, 1) });
  }
  addPart(u, u.group, { ellip: [1.42 * QS, 1.32 * QS, 1.42 * QS] });
  weakPlate(u, u.group, 0, 0.3, 1.47, 1.8, 0.45 * QS, 2);
  u.group.scale.setScalar(QS);
  u.invuln = 'shield'; u.bubbleR = 2.0 * QS;
  u.invulnMsg = tr('ESCUDO! DERRUBE OS ZANGÕES', 'SHIELD! SHOOT THE DRONES', 'SUOJA! AMMU LENNOKIT');
  u.pos.set(0, 26, 36);
  u.hover.set(0, 8, 13.5);
  u.state = 'entering'; u.respT = 2.4; u.expT = 0; u.squadT = 6; u.squad = null;
  for (const b of u.bees) b.a.position.copy(u.pos);
}
function beeDown(u, part) {
  debrisBurst(part.c, 0xffd020, 4, 3);
  if (u.squad && u.squad.bees.some(b => b.part === part)) { drop(u, u.squad.tgt); u.squad = null; u.squadT = 5; popup(tr('SOLTARAM!', 'THEY DROPPED IT!', 'NE PUDOTTIVAT!'), part.c, '#60e0ff', 1); }
}
function upColmeia(u, dt, edt) {
  const gp = u.pos;
  if (u.state === 'entering') { if (moveToward(gp, u.hover, 7 * edt)) u.state = 'hover'; }
  else { t0.set(Math.sin(u.age * 0.3) * 4, u.hover.y + Math.sin(u.age * 0.9) * 0.3, u.hover.z); moveToward(gp, t0, 1.5 * edt); }
  faceYaw(u.group, camPos.x, camPos.z);
  const alive = u.bees.filter(b => b.part.active);
  if (u.state !== 'entering' && alive.length && due(u, 'volT', edt, hpK(u) < 0.4 ? 4.5 : 6.5, 5)) {   // rajada: 3 zangões atiram
    for (const b of alive.slice().sort(() => Math.random() - 0.5).slice(0, 3)) { fireEnemy('plasma', b.a.position, 0.07); b.part.flashT = 0.2; }
  }
  if (u.invuln) {
    if (alive.length < 4 && u.state !== 'entering') {
      u.invuln = null; u.expT = 7;
      for (let k = 0; k < 2; k++) if (aliveRegulars() < G.waveDef.maxAlive) spawnRegular('mini', t5.set(gp.x + (k ? 1.5 : -1.5), gp.y - 1.5, gp.z));   // sem escudo, solta mini naves
      showBanner(tr('RAINHA EXPOSTA!', 'QUEEN EXPOSED!', 'KUNINGATAR PALJAANA!'), tr('ataque agora!', 'attack now!', 'hyökkää nyt!'), '', '#ffd040', 2);
      sfx('shieldDown', { pos: gp });
    } else {
      u.respT -= edt;
      if (u.respT <= 0) { u.respT = hpK(u) < 0.4 ? 1.7 : 2.6; const d = u.bees.find(b => !b.part.active); if (d) { d.part.active = true; d.part.hp = d.part.maxHp; d.a.position.copy(gp); } }
    }
  } else {
    u.expT -= edt;
    if (u.expT <= 0) {
      for (const b of u.bees) if (!b.part.active) { b.part.active = true; b.part.hp = b.part.maxHp; b.a.position.copy(gp); }
      u.invuln = 'shield'; sfx('shieldUp', { pos: gp });
      popup(tr('OS ZANGÕES VOLTARAM!', 'THE DRONES ARE BACK!', 'LENNOKIT PALASIVAT!'), gp, '#ffd040', 1.2);
    }
  }
  // esquadrão que carrega uma galinha até a colmeia
  if (!u.squad) {
    u.squadT -= edt;
    if (u.squadT <= 0 && alive.length >= 5 && u.invuln) {
      const tgt = pickUfoTarget();
      if (tgt) { const bs = alive.slice().sort((a, b) => a.a.position.distanceTo(tgt.pos) - b.a.position.distanceTo(tgt.pos)).slice(0, 3); u.squad = { bees: bs, tgt, held: false, t: 0, from: new THREE.Vector3() }; sfx('dive', { pos: gp }); }
      else u.squadT = 2;
    }
  } else {
    const S = u.squad, c = S.tgt;
    if (S.bees.some(b => !b.part.active)) { drop(u, c); u.squad = null; u.squadT = 5; }
    else if (!S.held) {
      if (!okChicken(c)) { u.squad = null; u.squadT = 3; }
      else if (S.bees.every(b => b.a.position.distanceTo(c.pos) < 1.0)) { hold(u, c); S.held = true; S.t = 0; S.from.copy(c.pos); sfx('thiefGrab', { pos: c.pos }); }
    } else if (!holds(u, c)) { u.squad = null; u.squadT = 5; }
    else {
      S.t += edt;
      t0.set(gp.x, gp.y - 1.5, gp.z);
      c.pos.lerpVectors(S.from, t0, ease(S.t / 5.5));
      if (S.t >= 5.5) { eat(u, c); u.squad = null; u.squadT = 7; }
    }
  }
  // formação
  const f = Math.floor(u.age / 6.5) % 3;
  const I = u.I; iBegin(I);
  for (const b of u.bees) {
    if (!b.part.active) continue;
    const ang = b.i / BEE_N * PI * 2 + u.age * 0.9;
    const sq = u.squad && u.squad.bees.indexOf(b);
    if (u.squad && sq >= 0) { const c = u.squad.tgt; t1.set(c.pos.x + Math.cos(sq * 2.09) * 0.42, c.pos.y + 0.6, c.pos.z + Math.sin(sq * 2.09) * 0.42); }
    else if (f === 0) t1.set(gp.x + Math.cos(ang) * 2.9 * QS, gp.y + Math.sin(ang * 3) * 0.3, gp.z + Math.sin(ang) * 2.9 * QS);
    else if (f === 1) t1.set(gp.x + Math.cos(ang) * 2.7 * QS, gp.y + Math.sin(ang) * 2.7 * QS, gp.z - 0.6);
    else { const R = (b.i % 2 ? 3.3 : 2.1) * QS, a2 = b.i % 2 ? -ang : ang; t1.set(gp.x + Math.cos(a2) * R, gp.y + (b.i % 2 ? -0.7 : 0.9), gp.z + Math.sin(a2) * R); }
    t2.copy(t1).sub(b.a.position);
    const d = t2.length();
    if (d > 1e-3) { t2.divideScalar(d); b.dir.lerp(t2, Math.min(1, dt * 8)).normalize(); b.a.position.addScaledVector(t2, Math.min(d, 7.5 * edt)); }
    b.part.flashT = Math.max(0, (b.part.flashT || 0) - dt);
    _q.setFromUnitVectors(Z_AX, b.dir);
    const s = 1 + b.part.flashT * 2 + Math.sin(u.age * 30 + b.i) * 0.04, fl = 1 + b.part.flashT * 6;
    iPut(I, b.a.position, _q, s, s, s, fl, fl, fl);
  }
  iEnd(I);
}

// =============================================================================
// 9 · COLHEITADEIRA
// =============================================================================
const HS = 1.4;   // tamanho do Ceifador
function mkColheitadeira(u) {
  piece(u, 'harv_body', g => {   // ceifadeira flutuante: casco roxo, piloto na bolha, tanques vermelhos, gaiola atrás
    box(g, 2.6, 1.0, 3.0, 0x5a3a90, 0, 1.3, -0.2);
    box(g, 2.75, 0.14, 3.15, 0x3c2466, 0, 1.87, -0.2);
    box(g, 2.3, 0.3, 2.6, 0x2a2f3e, 0, 0.66, -0.2);
    sph(g, 0.62, 0x9fe8ff, 0, 2.02, 0.2, 14, 10);
    alienHead(g, 0, 2.3, 0.95, 2.1, 0x4ac0e8);
    cone(g, 0.5, 1.1, 4, 0x3c2466, 0, 1.3, 1.75).rotation.x = PI / 2;   // bico
    for (const sx of [-1, 1]) { for (let k = -3; k <= 3; k++) sph(g, 0.09, 0x5effd0, sx * 1.32, 1.02, k * 0.4 - 0.2, 6, 4); box(g, 0.1, 1.0, 1.0, 0x8a3ad0, sx * 1.42, 1.9, -1.55).rotation.x = -0.5; }
    box(g, 3.7, 0.5, 0.5, 0x3c4254, 0, 0.62, 2.05);
    for (const sx of [-1, 1]) {
      box(g, 0.45, 0.45, 0.9, 0x3c4254, sx * 1.3, 0.78, 1.55);
      cyl(g, 0.72, 0.55, 0.36, 14, 0x3c4254, sx * 1.45, 0.44, -0.9); cyl(g, 0.5, 0.5, 0.08, 14, 0x5effd0, sx * 1.45, 0.24, -0.9);
      cyl(g, 0.46, 0.36, 0.3, 12, 0x3c4254, sx * 1.25, 0.42, 1.0); cyl(g, 0.32, 0.32, 0.08, 12, 0x5effd0, sx * 1.25, 0.25, 1.0);
      cyl(g, 0.4, 0.4, 1.15, 12, 0xff3030, sx * 1.75, 1.45, -0.2).rotation.x = PI / 2;   // tanque (ponto fraco)
      torus(g, 0.41, 0.04, 4, 12, 0xffd040, sx * 1.75, 1.45, -0.2); torus(g, 0.41, 0.04, 4, 12, 0xffd040, sx * 1.75, 1.45, 0.15);
      sph(g, 0.1, 0xff4fd8, sx * 1.3, 1.98, 1.25, 6, 4);
    }
    cyl(g, 0.05, 0.05, 1.3, 6, 0x8a94a8, -1.05, 2.55, 0.9); sph(g, 0.16, 0xff4fd8, -1.05, 3.25, 0.9, 8, 6);
    for (const [x, z] of [[-0.8, -0.45], [0.8, -0.45], [-0.8, -1.55], [0.8, -1.55]]) box(g, 0.06, 0.9, 0.06, 0xb0b0b8, x, 2.45, z);   // gaiola
    box(g, 1.72, 0.06, 1.2, 0xb0b0b8, 0, 2.92, -1.0);
    for (let k = 0; k < 4; k++) box(g, 0.04, 0.9, 0.04, 0xb0b0b8, -0.48 + k * 0.32, 2.45, -1.58);
  });
  u.reel = piece(u, 'harv_reel', g => {
    for (let k = 0; k < 6; k++) { const a = k / 6 * PI * 2; box(g, 3.4, 0.1, 0.1, 0xff4fd8, 0, Math.cos(a) * 0.5, Math.sin(a) * 0.5); }
    for (const sx of [-1, 1]) cyl(g, 0.56, 0.56, 0.06, 12, 0xe0e0e8, sx * 1.72, 0, 0).rotation.z = PI / 2;
    cyl(g, 0.06, 0.06, 3.4, 6, 0x606068, 0, 0, 0).rotation.z = PI / 2;
  });
  u.reel.position.set(0, 0.75, 2.6);
  u.group.scale.setScalar(HS);
  weakPlate(u, u.group, 0, 1.3, -1.74, 2.4, 0.6 * HS, 2, 0, PI);
  addPart(u, anchor(u.group, 0, 0.7, 2.25), { ellip: [1.95 * HS, 0.75 * HS, 0.65 * HS], kind: 'armor' });
  addPart(u, anchor(u.group, 0, 1.55, -0.2), { ellip: [1.35 * HS, 1.05 * HS, 1.6 * HS], mult: 0.6 });
  for (const sx of [-1, 1]) addPart(u, anchor(u.group, sx * 1.75, 1.45, -0.2), { r: 0.58 * HS, kind: 'crit', mult: 2, onHit: harvTankHit });
  u.armorMsg = tr('A FRENTE É BLINDADA!', 'THE FRONT IS ARMORED!', 'ETUOSA ON PANSSAROITU!');
  u.pos.set(rand(-4, 4), 17, 13);
  u.state = 'drop'; u.h = PI; u.cage = []; u.stallT = 0; u.stallCD = 0; u.chargeT = 8; u.sub = 'drive'; u.subT = 0; u.scareT = 0;
  u.deadFn = boomDeath(0.9, 2.8, 3.5);
}
function harvTankHit(u, part, dmg, pos) {
  if (u.stallCD <= 0 && u.state === 'drive') {
    u.stallT = 2.8; u.stallCD = 7; u.sub = 'drive';
    for (const k of u.cage) drop(u, k.c);
    if (u.cage.length) popup(tr('GAIOLA ABERTA!', 'CAGE OPEN!', 'HÄKKI AUKI!'), pos, '#60e0ff', 1.2);
    u.cage.length = 0;
    popup(tr('MOTOR AFOGOU!', 'ENGINE STALLED!', 'MOOTTORI SAMMUI!'), t5.set(u.pos.x, 3.6, u.pos.z), '#ffd040', 1.1);
    sfx('explosionSmall', { pos });
  }
  return false;
}
function upColheitadeira(u, dt, edt) {
  const gp = u.pos;
  if (u.state === 'drop') {
    gp.y -= 9 * edt;
    for (const sx of [-1.2, 1.2]) glow(gp.x + sx, gp.y, gp.z, 1.4, 0x60c0ff, 0.8);
    if (gp.y <= 0) { gp.y = 0; u.state = 'drive'; t0.set(gp.x, 0.3, gp.z); smoke(t0, 10, 0xb8a888, 0.9, 1.2, 0.6); sfx('land', { pos: gp }); pulseAll(0.8, 200); for (const c of chickens) scareChicken(c, gp); }
    u.group.rotation.y = u.h;
    return;
  }
  u.stallCD -= edt;
  if (u.stallT <= 0) {
    if (due(u, 'mortT', edt, 8, 5)) { const c = nearestChicken(gp.x, gp.z); bombsNear(hpK(u) < 0.5 ? 3 : 2, c ? c.pos.x : 0, c ? c.pos.z : 9, 3); sfx('launcher', { pos: gp }); }   // morteiro: espalha as galinhas
    const stage = hpK(u) < 0.33 ? 2 : hpK(u) < 0.66 ? 1 : 0;
    if (stage > (u.stage || 0)) {   // solta naves kamikaze quando apanha
      u.stage = stage;
      spawnRegular('kamikaze', t5.set(gp.x + rand(-1, 1), 4, gp.z));
      popup(tr('KAMIKAZES!', 'KAMIKAZES!', 'KAMIKAZET!'), t5.set(gp.x, 5.5, gp.z), '#ff8030', 1.3);
    }
  }
  const sh = Math.sin(u.h), ch = Math.cos(u.h);
  let speed = 0, reelSpd = 9;
  if (u.stallT > 0) {
    u.stallT -= edt;
    u.group.position.x += Math.sin(u.age * 50) * 0.01;
    if (Math.random() < dt * 20) smoke(t0.set(gp.x - 0.9 * ch - 1.25 * sh, 3.3, gp.z + 0.9 * sh - 1.25 * ch), 1, 0x202020, 0.5, 1.0, 1.2);
    reelSpd = 1;
  } else if (u.sub === 'rev') {
    u.subT -= edt; reelSpd = 26;
    u.group.position.x += Math.sin(u.age * 70) * 0.012;
    glow(gp.x + sh * 2.6 * HS, 0.8 * HS, gp.z + ch * 2.6 * HS, 3.4 * HS, 0xff3020, 0.5);
    if (u.subT <= 0) { u.sub = 'charge'; u.subT = 1.3; sfx('dive', { pos: gp }); }
  } else if (u.sub === 'charge') {
    u.subT -= edt; speed = 8.5; reelSpd = 26;
    if (Math.random() < dt * 30) smoke(t0.set(gp.x - sh * 1.8, 0.3, gp.z - ch * 1.8), 1, 0xb8a888, 0.5, 0.6, 0.3);
    if (u.subT <= 0) { u.sub = 'drive'; u.chargeT = hpK(u) < 0.5 ? 5.5 : 9; }
  } else {
    const c = nearestChicken(gp.x, gp.z);
    const tx = c ? c.pos.x : 0, tz = c ? c.pos.z : 9;
    let d = Math.atan2(tx - gp.x, tz - gp.z) - u.h; d = Math.atan2(Math.sin(d), Math.cos(d));
    u.h += clamp(d, -1.7 * edt, 1.7 * edt);
    speed = 2.1;
    u.chargeT -= edt;
    if (u.chargeT <= 0 && c && Math.abs(d) < 0.3) { u.sub = 'rev'; u.subT = 1.0; sfx('siren', { pos: gp }); }
  }
  gp.x = clamp(gp.x + Math.sin(u.h) * speed * edt, -7.6, 7.6);
  gp.z = clamp(gp.z + Math.cos(u.h) * speed * edt, 6.4, 16.2);
  u.group.rotation.y = u.h;
  u.reel.rotation.x += edt * reelSpd;
  // colhe quem está na frente da plataforma; espanta quem está do lado
  u.scareT -= edt;
  for (const c of chickens) {
    if (!okChicken(c) || c.pos.y > 1.2) continue;
    const rx = c.pos.x - gp.x, rz = c.pos.z - gp.z;
    const lz = rx * sh + rz * ch, lx = rx * ch - rz * sh;
    if (Math.abs(lx) < 1.8 * HS && lz > 1.5 * HS && lz < 3.1 * HS && u.stallT <= 0 && u.cage.length < 3) {
      hold(u, c); u.cage.push({ c, t: 0 });
      feathers(c.pos, 10, 0xffffff); sfx('thiefGrab', { pos: gp });
      popup(tr('CEIFOU UMA GALINHA!', 'REAPED A CHICKEN!', 'NIITTI KANAN!'), t0.set(gp.x, 3.6, gp.z), '#ff6060', 1.1);
    } else if (u.scareT <= 0 && Math.abs(lx) < 2.7 * HS && lz < 1.5 * HS && lz > -2.6 * HS) scareChicken(c, gp);
  }
  if (u.scareT <= 0) u.scareT = 0.4;
  // gaiola: 7 s para afogar o motor antes de a galinha ser levada
  for (let i = u.cage.length - 1; i >= 0; i--) {
    const k = u.cage[i];
    if (!holds(u, k.c)) { u.cage.splice(i, 1); continue; }
    if (u.stallT <= 0) k.t += edt;
    const lx = (-0.5 + i * 0.5) * HS, lz = -1.0 * HS;
    k.c.pos.set(gp.x + lx * ch + lz * sh, 2.15 * HS, gp.z - lx * sh + lz * ch);
    if (k.t > 9) { eat(u, k.c); u.cage.splice(i, 1); }
  }
}

// =============================================================================
// 10 · GALOZILLA
// =============================================================================
const GZ_Z = 25.5, GZ_CHICKS = 6, GS = 1.3;   // GS = tamanho geral do galo
function mkGalozilla(u) {
  piece(u, 'gz_legs', g => {   // pernas do robô + mochila a jato
    for (const sx of [-1, 1]) {
      cyl(g, 0.55, 0.42, 2.4, 10, 0x5a6278, sx * 1.3, 3.1, 0); cyl(g, 0.34, 0.42, 2.0, 10, 0x3c4254, sx * 1.3, 1.0, 0.1); sph(g, 0.55, 0xff9030, sx * 1.3, 2.0, 0.05, 10, 8);
      box(g, 1.1, 0.36, 1.9, 0x3c4254, sx * 1.3, 0.18, 0.4); box(g, 0.9, 0.2, 1.5, 0x5a6278, sx * 1.3, 0.46, 0.35);
      for (let k = -1; k <= 1; k++) cone(g, 0.14, 0.4, 5, 0xd0d0d8, sx * 1.3 + k * 0.36, 0.2, 1.5).rotation.x = PI / 2;
    }
    box(g, 2.2, 2.4, 0.9, 0x3c4254, 0, 6.0, -2.9);
    for (const sx of [-1, 1]) { cyl(g, 0.4, 0.55, 1.6, 10, 0x5a6278, sx * 0.7, 5.2, -3.1); cyl(g, 0.4, 0.4, 0.1, 10, 0xff9030, sx * 0.7, 4.38, -3.1); box(g, 0.12, 2.6, 1.2, 0x8a3ad0, sx * 1.5, 7.2, -3.0).rotation.z = -sx * 0.35; }
  });
  u.torso = new THREE.Group(); u.torso.position.set(0, 5.3, 0); u.group.add(u.torso);
  piece(u, 'gz_torso', g => {   // armadura roxa com canhões nos ombros
    sph(g, 2.4, 0x5a3a90, 0, 0, 0, 20, 14).scale.set(1, 1.05, 1.3);
    box(g, 2.5, 2.1, 0.2, 0x2a2f3e, 0, -0.1, 2.9);
    for (let k = 0; k < 10; k++) { const a = k / 10 * PI * 2; sph(g, 0.1, 0x5effd0, Math.cos(a) * 2.38, Math.sin(a) * 2.3, 0.6, 6, 4); }
    for (const sx of [-1, 1]) {
      box(g, 0.5, 2.6, 3.0, 0x3c4254, sx * 2.6, 0.1, -0.2).rotation.z = sx * 0.12;
      sph(g, 0.8, 0x6a7288, sx * 2.75, 1.5, -0.2, 12, 8); cone(g, 0.22, 0.8, 5, 0xd0d0d8, sx * 2.9, 2.4, -0.2);
      for (let k = 0; k < 3; k++) cyl(g, 0.18, 0.18, 0.9, 8, 0x202028, sx * 2.78, -0.6 + k * 0.5, 1.5).rotation.x = PI / 2;
    }
    cyl(g, 0.6, 0.8, 2.2, 12, 0x58c878, 0, 2.9, 1.1).rotation.x = 0.35;
    torus(g, 0.95, 0.2, 6, 16, 0x8a94a8, 0, 2.15, 0.85).rotation.x = PI / 2;
  }, u.torso);
  u.doors = [-1, 1].map(sx => { const d = piece(u, 'gz_door', g => { box(g, 1.05, 1.7, 0.16, 0x3c4254, 0, 0, 0); box(g, 0.8, 0.12, 0.2, 0xffd040, 0, 0.5, 0); box(g, 0.8, 0.12, 0.2, 0xffd040, 0, -0.5, 0); box(g, 0.8, 0.12, 0.2, 0xffd040, 0, 0, 0); }, u.torso); d.position.set(sx * 0.53, -0.1, 3.05); d.userData.sx = sx; return d; });
  u.core = new THREE.Mesh(new THREE.SphereGeometry(0.72, 14, 10), BASIC(0xffa020)); u.core.position.set(0, -0.1, 2.72); u.torso.add(u.core);
  u.head = new THREE.Group(); u.head.position.set(0, 9.1, 2.0); u.group.add(u.head);
  piece(u, 'gz_head', g => {   // cabeçona de alienígena com o cérebro à mostra (ponto fraco) e coroa
    sph(g, 1.25, 0x6ee070, 0, 0.1, 0, 18, 12).scale.set(1.1, 1.0, 1.0);
    sph(g, 0.8, 0x6ee070, 0, -0.75, 0.35, 12, 10).scale.set(0.8, 0.9, 0.9);
    for (const sx of [-1, 1]) { const e = sph(g, 0.42, 0x101018, sx * 0.6, 0.2, 0.86, 12, 10); e.scale.set(1, 1.35, 0.6); e.rotation.z = sx * 0.5; }
    box(g, 0.5, 0.07, 0.1, 0x1a4a22, 0, -0.85, 1.02);
    for (let k = 0; k < 9; k++) { const a = k * 2.4, r = k < 3 ? 0.25 : 0.62; sph(g, 0.42 - (k % 3) * 0.04, k % 2 ? 0xf08ab0 : 0xf7a4c4, Math.cos(a) * r, k < 3 ? 1.5 : 1.22 + (k % 2) * 0.1, Math.sin(a) * r - 0.05, 8, 6); }
    torus(g, 1.0, 0.1, 6, 20, 0xffd040, 0, 0.98, -0.02).rotation.x = PI / 2;
    for (let k = 0; k < 6; k++) { const a = k / 6 * PI * 2 + 0.52; cone(g, 0.12, 0.45, 4, 0xffd040, Math.cos(a) * 1.0, 1.22, Math.sin(a) * 1.0 - 0.02); }
    for (const sx of [-1, 1]) { cyl(g, 0.04, 0.04, 0.9, 5, 0x50b050, sx * 0.95, 1.2, -0.3).rotation.z = -sx * 0.5; sph(g, 0.12, 0xffe060, sx * 1.18, 1.6, -0.3, 6, 4); }
  }, u.head);
  u.eyes = [-1, 1].map(sx => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), BASIC(0xff2020)); e.position.set(sx * 0.6, 0.22, 1.1); u.head.add(e); return e; });
  u.pComb = addPart(u, anchor(u.head, 0, 1.15, 0), { r: 0.85 * GS, kind: 'crit', mult: 2 });
  u.onDamaged = (uu, dmg, part) => {   // acertar a crista enquanto ele mira cancela o laser
    const A = uu.act;
    if (A && A.k === 'laser' && A.t < 2.0 && part === uu.pComb) {
      uu.act = null; uu.bt = 2.4;
      popup(tr('LASER CANCELADO!', 'LASER CANCELLED!', 'LASER PERUTTU!'), part.c, '#60e0ff', 1.3); sfx('shieldDown', { pos: part.c });
    }
  };
  addPart(u, anchor(u.head, 0, 0, 0.1), { r: 1.3 * GS });
  addPart(u, anchor(u.torso, 0, 0, 0), { ellip: [2.5 * GS, 2.6 * GS, 3.0 * GS], mult: 0.7 });
  u.pCore = addPart(u, anchor(u.torso, 0, -0.1, 3.0), { r: 0.95 * GS, kind: 'crit', mult: 3 });
  u.group.scale.setScalar(GS);
  u.pCore.active = false;
  for (const sx of [-1, 1]) weakPlate(u, u.group, sx * 1.3, 2.0, 0.6, 2.4, 0.6 * GS, 1.5);
  u.I = instanced(u, 'gz_chick', g => {   // mini-alien num disco flutuante
    cyl(g, 0.34, 0.26, 0.12, 12, 0x8a94a8, 0, 0.16, 0); cyl(g, 0.2, 0.2, 0.05, 10, 0x5effd0, 0, 0.08, 0);
    sph(g, 0.2, 0x6ee070, 0, 0.42, 0, 10, 8).scale.y = 1.1; sph(g, 0.26, 0x6ee070, 0, 0.72, 0.03, 10, 8);
    for (const sx of [-1, 1]) { sph(g, 0.08, 0x101018, sx * 0.1, 0.74, 0.24, 6, 4); cyl(g, 0.015, 0.015, 0.2, 4, 0x50b050, sx * 0.1, 1.02, 0); sph(g, 0.04, 0xffe060, sx * 0.1, 1.13, 0, 6, 4); box(g, 0.05, 0.22, 0.08, 0x6ee070, sx * 0.26, 0.42, 0.05); }
  }, GZ_CHICKS, 0.02);
  u.chicks = [];
  for (let i = 0; i < GZ_CHICKS; i++) {
    const a = new THREE.Object3D();
    const part = addPart(u, a, { r: 0.5, kind: 'sub', hp: 4, maxHp: 4, onDown: gzChickDown, keepVisible: true });
    part.active = false;
    u.chicks.push({ a, part, mode: 'run', tgt: null, yaw: 0, hop: rand(0, 6) });
  }
  u.pos.set(0, 0, GZ_Z + 14);
  u.group.rotation.y = PI;
  u.state = 'entering'; u.act = null; u.bt = 2.5; u.seq = 0; u.doorK = 0; u.lockP = new THREE.Vector3(); u.headPitch = 0;
  u.noShadow = false;
  u.deadFn = gzDeath;
}
function gzChickDown(u, part) {
  const k = u.chicks.find(c => c.part === part);
  if (k) { drop(u, k.tgt); k.tgt = null; }
  debrisBurst(part.c, 0xffd020, 6, 3);
}
function gzDeath(u, dt) {
  u.group.rotation.x = -Math.min(1.25, u.deadT * 0.36);
  if (Math.random() < dt * 16) {
    t0.set(rand(-3.4, 3.4), rand(1, 13), GZ_Z + rand(-3, 3));
    fireball(t0, rand(0.8, 1.8)); if (Math.random() < 0.5) { sfx('explosionSmall', { pos: t0 }); debrisBurst(t0, 0xc8ccd6, 6, 6); }
  }
  u.group.position.x = Math.sin(u.deadT * 70) * 0.08;
  if (u.deadT < 3.6) return false;
  t0.set(0, 4, GZ_Z);
  fireball(t0, 5); blast(t0, 9, 0xffa030); blast(t0, 6, 0xffffff); debrisBurst(t0, 0xc8ccd6, 30, 9);
  for (let k = 0; k < 4; k++) confetti(t1.set(rand(-5, 5), rand(4, 9), GZ_Z - 3), 50, 7);
  flashScreen(0xffffff, 0.6); sfx('bossDeath', { pos: t0 }); sfx('ufoExplode', { pos: t0 }); pulseAll(1, 500);
  return true;
}
function upGalozilla(u, dt, edt) {
  const gp = u.pos;
  if (u.state === 'entering') {   // chega andando do fundo (passos pesados)
    gp.z -= 3.2 * edt;
    gp.y = Math.abs(Math.sin(u.age * 3.2)) * 0.25;
    if (Math.sin(u.age * 3.2) * Math.sin((u.age - dt) * 3.2) < 0) { pulseAll(0.7, 120); sfx('debrisLand', { pos: gp }); smoke(t0.set(gp.x, 0.3, gp.z - 1), 4, 0xb8a888, 0.9, 0.9, 0.4); }
    if (gp.z <= GZ_Z) { gp.z = GZ_Z; gp.y = 0; u.state = 'fight'; u.bt = 2; }
  }
  const phase = u.hp / u.maxHp > 0.6 ? 1 : u.hp / u.maxHp > 0.25 ? 2 : 3;
  // animação parada: respira, balança a cabeça
  u.torso.position.y = 5.3 + Math.sin(u.age * 1.6) * 0.12;
  u.torso.rotation.z = Math.sin(u.age * 0.8) * 0.03;
  u.head.position.y = 9.1 + Math.sin(u.age * 1.6 + 0.5) * 0.15;
  let pitchGoal = 0.12, yawGoal = Math.sin(u.age * 0.6) * 0.3;
  const A = u.act;
  // portas do peito / núcleo
  const doorGoal = A && A.k === 'eggs' && A.t > 0.2 && A.t < 4.2 ? 1 : 0;
  u.doorK += (doorGoal - u.doorK) * Math.min(1, dt * 5);
  for (const d of u.doors) d.position.x = d.userData.sx * (0.53 + u.doorK * 1.0);
  u.pCore.active = u.doorK > 0.5;
  u.core.scale.setScalar(1 + Math.sin(u.age * 9) * 0.06);
  if (u.doorK > 0.3) { u.pCore.obj.getWorldPosition(t0); glow(t0.x, t0.y, t0.z, 3.2, 0xffa020, 0.7 * u.doorK); }
  for (const e of u.eyes) { e.getWorldPosition(t0); glow(t0.x, t0.y, t0.z, phase === 3 ? 1.5 : 1.0, 0xff2020, 0.8); }
  if (u.state === 'fight') {
    if (!A) {
      u.bt -= edt * (phase === 3 ? 1.4 : 1);
      if (u.bt <= 0) {
        const pat = phase === 1 ? ['eggs', 'chicks', 'cannons'] : phase === 2 ? ['eggs', 'laser', 'chicks', 'cannons', 'crow'] : ['eggs', 'cannons', 'laser', 'chicks', 'cannons', 'crow'];
        u.act = { k: pat[u.seq++ % pat.length], t: 0, f: false };
        if (u.act.k === 'eggs') sfx('coreExposed', { pos: gp });
        if (u.act.k === 'laser') { sfx('sniperCharge', { pos: gp }); u.head.getWorldPosition(t0); t0.y += 2.4; popup(tr('ACERTE O CÉREBRO!', 'HIT THE BRAIN!', 'OSU AIVOIHIN!'), t0, '#ff8080', 1.8, 1.5); }
        if (u.act.k === 'crow') sfx('siren', { pos: gp });
      }
    } else {
      A.t += edt;
      if (A.k === 'eggs') {
        if (!A.f && A.t >= 1.0) {
          A.f = true;
          const n = phase + 1, rp = rig.position;
          u.pCore.obj.getWorldPosition(t0); fireball(t0, 1.4); smoke(t0, 6, 0xd0d0d0, 0.8, 1.0, 0.6); sfx('launcher', { pos: t0 }); pulseAll(0.5, 100);
          for (let k = 0; k < n; k++) {
            if (k === 0) {   // uma cai perto de você: no fim da luta, quase em cima (atire nela ou saia de baixo)
              const a = rand(0, 6.28), d = phase === 3 ? rand(1.0, 2.6) : rand(2.4, 3.4);
              t1.set(rp.x + Math.cos(a) * d, 13, rp.z + Math.abs(Math.sin(a)) * d);
            } else t1.set(rand(-7, 7), 10 + k, rand(4, 16));
            fireEnemy('bomb', t1);
          }
        }
        if (A.t >= 4.6) { u.act = null; u.bt = 2.4; }
      } else if (A.k === 'chicks') {
        pitchGoal = 0.7;
        if (!A.f && A.t >= 0.8) {
          A.f = true;
          let n = Math.min(2, phase);
          for (const k of u.chicks) if (n > 0 && !k.part.active) { k.part.active = true; k.part.hp = k.part.maxHp; k.mode = 'run'; k.tgt = null; k.a.position.set(rand(-1.5, 1.5), 0, GZ_Z - 2.2); n--; }
          sfx('hatch', { pos: gp }); popup(tr('MINI-ALIENS!', 'MINI-ALIENS!', 'MINIALIENIT!'), t0.set(0, 3, GZ_Z - 3), '#ffd040', 1.3);
        }
        if (A.t >= 1.5) { u.act = null; u.bt = 3; }
      } else if (A.k === 'laser') {
        const AIM = 2.0, LOCK = 1.55;
        if (A.t < LOCK) u.lockP.copy(camPos).setY(camPos.y - 0.12);
        const k = Math.min(1, A.t / AIM);
        u.head.getWorldPosition(t2);
        yawGoal = Math.atan2(-(u.lockP.x - t2.x), -(u.lockP.z - t2.z)); pitchGoal = 0.35;
        if (A.t < AIM) {
          if (A.t < LOCK || Math.floor(A.t * 24) % 2 === 0) for (const e of u.eyes) { e.getWorldPosition(t0); seg(t0, u.lockP, 0.01 + k * 0.02, 0xff2040); }
          glow(u.lockP.x, u.lockP.y, u.lockP.z, 0.2 + k * 0.3, 0xff2040, 0.9);
        } else if (!A.f) {
          A.f = true;
          for (const e of u.eyes) { e.getWorldPosition(t0); seg(t0, u.lockP, 0.12, 0xff3050, 0.16); }
          sfx('sniperShot', { pos: gp }); sparks(u.lockP, 0xff3050, 14, 4, 0.07, 0.5);
          if (camPos.distanceTo(u.lockP) < 0.75) damagePlayer(12, 'LASER!', '#ff3050');
        }
        if (A.t >= AIM + 0.6) { u.act = null; u.bt = 2.6; }
      } else if (A.k === 'cannons') {   // 2 salvas dos canhões dos ombros (3 na última fase); plasma: dá pra derrubar
        const n = Math.floor((A.t - 0.5) / 0.45);
        if (n >= 0 && n < (phase === 3 ? 3 : 2) && n !== A.n) {
          A.n = n;
          for (const sx of [-1, 1]) { u.torso.getWorldPosition(t0); t0.x += sx * 2.78 * GS; t0.y -= 0.1 * GS; t0.z -= 1.6 * GS; fireEnemy('plasma', t0, 0.09); smoke(t0, 2, 0xd0d0d0, 0.5, 0.6, 0.4); }
          sfx('launcher', { pos: gp, pitch: 1.4 });
        }
        if (A.t >= 2.4) { u.act = null; u.bt = 2.2; }
      } else if (A.k === 'crow') {
        pitchGoal = A.t < 1.0 ? -0.75 : -0.2;
        if (!A.f && A.t >= 1.0) {
          A.f = true;
          u.head.getWorldPosition(t0); t0.z -= 2;
          blast(t0, 7, 0xffe080); blast(t0, 4, 0xffffff); pulseAll(1, 350); sfx('bossSpawn', { pos: t0 });
          popup(tr('RUGIDO DO IMPERADOR!', 'THE EMPEROR ROARS!', 'KEISARI KARJUU!'), t1.set(0, 6, GZ_Z - 6), '#ffe080', 1.8, 1.6);
          for (const c of chickens) scareChicken(c, gp);
          for (let k = 0; k < 2; k++) if (aliveRegulars() < G.waveDef.maxAlive) spawnRegular('zippy', t1.set(rand(-6, 6), 11, GZ_Z - 2));
          if (phase >= 2 && (u.called || 1) < phase) { u.called = phase; spawnBoss(phase === 2 ? 'zepelim' : 'olhao', true, true); }   // uma vez por fase: chama um chefe antigo
        }
        if (A.t >= 2.0) { u.act = null; u.bt = 3.2; }
      }
    }
  }
  u.headPitch += (pitchGoal - u.headPitch) * Math.min(1, dt * 5);
  u.head.rotation.x = u.headPitch;
  u.head.rotation.y += (clamp(yawGoal, -0.7, 0.7) - u.head.rotation.y) * Math.min(1, dt * 4);
  // pintinhos-robô: correm até uma galinha e a carregam para o galo
  const I = u.I; iBegin(I);
  for (const k of u.chicks) {
    if (!k.part.active) continue;
    const p = k.a.position;
    k.hop += dt * 14;
    if (k.mode === 'run') {
      if (!okChicken(k.tgt) || u.chicks.some(o => o !== k && o.part.active && o.tgt === k.tgt)) k.tgt = pickUfoTarget();
      if (k.tgt) {
        t0.set(k.tgt.pos.x, 0, k.tgt.pos.z);
        k.yaw = Math.atan2(t0.x - p.x, t0.z - p.z);
        const d = Math.hypot(t0.x - p.x, t0.z - p.z);
        if (d < 0.5 && k.tgt.pos.y < 0.8) { hold(u, k.tgt); k.mode = 'carry'; sfx('thiefGrab', { pos: p }); }
        else { p.x += Math.sin(k.yaw) * Math.min(d, 2.4 * edt); p.z += Math.cos(k.yaw) * Math.min(d, 2.4 * edt); }
      }
    } else {
      if (!holds(u, k.tgt)) { k.mode = 'run'; k.tgt = null; }
      else {
        t0.set(clamp(p.x, -6, 6), 0, GZ_Z - 3.5);
        k.yaw = Math.atan2(t0.x - p.x, t0.z - p.z);
        p.x += Math.sin(k.yaw) * 1.6 * edt; p.z += Math.cos(k.yaw) * 1.6 * edt;
        if (p.z > 20.5) { eat(u, k.tgt); k.tgt = null; k.part.active = false; continue; }
      }
    }
    const over = clamp(1 - Math.abs(p.z - 18.6) / 1.3, 0, 1);   // pula a cerca
    p.y = Math.abs(Math.sin(k.hop)) * 0.18 + over * 1.3;
    if (k.mode === 'carry' && k.tgt) k.tgt.pos.set(p.x, p.y + 0.75, p.z);
    k.part.flashT = Math.max(0, (k.part.flashT || 0) - dt);
    _q.setFromAxisAngle(t3.set(0, 1, 0), k.yaw);
    const s = 1.15 + k.part.flashT * 2, f = 1 + k.part.flashT * 6;
    iPut(I, p, _q, s, s, s, f, f, f);
  }
  iEnd(I);
}

// =============================================================================
// API
// =============================================================================
const MK = { zepelim: mkZepelim, olhao: mkOlhao, centopeia: mkCentopeia, polvo: mkPolvo, minhocao: mkMinhocao, tempestade: mkTempestade, magico: mkMagico, colmeia: mkColmeia, colheitadeira: mkColheitadeira, galozilla: mkGalozilla };
const UP = { zepelim: upZepelim, olhao: upOlhao, centopeia: upCentopeia, polvo: upPolvo, minhocao: upMinhocao, tempestade: upTempestade, magico: upMagico, colmeia: upColmeia, colheitadeira: upColheitadeira, galozilla: upGalozilla };
const BAR = { zepelim: [2.9, 3.6], olhao: [3.1, 3.6], centopeia: [1.5, 1.6], polvo: [4.6, 4.2], minhocao: [1.3, 0], tempestade: [3.5, 5.8], magico: [2.9, 3.2], colmeia: [4.5, 3.8], colheitadeira: [5.6, 6.3], galozilla: [15.0, 9] };
/** Cria o chefe da wave. id = chave de BOSSES. */
export function spawnBoss(id, silent = false, vet = false) {
  if (!MK[id]) id = 'zepelim';
  const u = base(id, vet);
  if (vet) popup(u.D.name + tr(' VOLTOU!', ' IS BACK!', ' PALASI!'), t5.set(0, 4.5, 9), '#ffb060', 1.6, 1.2);
  MK[id](u);
  return finish(u, BAR[id][0], BAR[id][1], silent);
}
export function updateBoss(u, dt, edt) {
  const f = UP[u.bid];
  if (f) f(u, dt, edt);
}
