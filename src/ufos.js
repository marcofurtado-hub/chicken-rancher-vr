// =============================================================================
// NAVES — modelos, comportamentos (11 tipos + chefão + nave-mãe), projéteis inimigos
// e caixas de power-up de paraquedas.
// Cada nave = 3 draw calls (casco fundido + contorno + alienígena).
// =============================================================================
import { THREE, scene, camPos, rig, toon, toonUnique, outlineMat, outlineGeo, bakeWith, bake, sph, cyl, box, cone, torus, lathe, ico, canvasTex, TEX, FONT } from './render.js';
import { G, clamp, lerp, rand, pick, tmpV, playing } from './core.js';
import { tr } from './i18n.js';
import { UFO_TYPES, POWERS, CHICKEN_KINDS } from './config.js';
import { fxAdd, fxAlpha, sparks, smoke, fireball, feathers, blast, debrisBurst, popup, showBanner, glow, blob, seg, SHAPE, twinkle } from './fx.js';
import { sfx, loop } from './audio.js';
import { chickens, setChickenShield, scareChicken, chickenCenter } from './chickens.js';
import { groundHeightAt, nightAmount } from './world.js';
import { killUfo, hitPart, damagePlayer, gooHitPlayer, kamikazeHit, abductChicken, addScore } from './combat.js';
import { pulseAll } from './player.js';

const [t0, t1, t2, t3, t4, t5, t6] = tmpV(7);
const _c = new THREE.Color();

export const ufos = [];
export const eproj = [];   // projéteis inimigos (gosma, plasma, bomba)
export const crates = [];  // caixas de power-up

export const isAlive = u => u && !u.removed && u.state !== 'dead' && u.state !== 'dying';
export const aliveRegulars = () => { let n = 0; for (const u of ufos) if (u.kind === 'ufo' && isAlive(u)) n++; return n; };

// =============================================================================
// MODELOS
// =============================================================================
const LIGHT_COLS = [0xff4848, 0xffe040, 0x48ff70, 0x48d8ff];
const N_LIGHTS = 10;
function shade(hex, k) { return _c.setHex(hex).multiplyScalar(k).getHex(); }
function ring(g, r, t, hex, y) { const m = torus(g, r, t, 5, 22, hex, 0, y, 0); m.rotation.x = Math.PI / 2; return m; }
function spoke(g, a, build) { const sg = new THREE.Group(); sg.rotation.y = -a; build(sg); g.add(sg); }

function hullParts(g, T, boss = false) {
  const top = T.color, bottom = shade(T.color, 0.55);
  lathe(g, [[0.001, -0.2], [0.13, -0.19], [0.3, -0.13], [0.48, -0.04], [0.56, 0]], 28, bottom);
  lathe(g, [[0.56, 0], [0.55, 0.035], [0.42, 0.085], [0.27, 0.12], [0.2, 0.13]], 28, top);
  ring(g, 0.555, 0.022, shade(T.glow, 0.8), 0.0);          // faixa da borda
  ring(g, 0.2, 0.026, 0xc8ccd8, 0.13);                       // aro da cabine
  cyl(g, 0.16, 0.16, 0.012, 20, shade(T.glow, 1), 0, -0.203, 0); // emissor da barriga
  ring(g, 0.17, 0.016, 0x30303a, -0.2);
  for (let i = 0; i < N_LIGHTS; i++) {                       // luzes da borda
    const a = i / N_LIGHTS * Math.PI * 2;
    ico(g, boss ? 0.034 : 0.038, boss ? (i % 2 ? 0xff2020 : 0xffa020) : LIGHT_COLS[i % 4], Math.cos(a) * 0.535, 0.012, Math.sin(a) * 0.535, 0);
  }
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.26; ico(g, 0.03, 0xe8ecf4, Math.cos(a) * 0.36, 0.1, Math.sin(a) * 0.36, 0); } // rebites
}
const ACCENTS = {
  zippy: g => { for (let k = 0; k < 3; k++) spoke(g, k / 3 * Math.PI * 2, sg => { const f = box(sg, 0.24, 0.1, 0.035, 0xa02a2a, 0.54, 0.03, 0); f.rotation.z = -0.15; }); ring(g, 0.47, 0.014, 0xffffff, 0.06); },
  tank: g => {
    ring(g, 0.52, 0.06, 0x8a6a18, 0);
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; sph(g, 0.035, 0x504020, Math.cos(a) * 0.34, 0.095, Math.sin(a) * 0.34, 6, 4); }
    for (let k = 0; k < 4; k++) spoke(g, k / 4 * Math.PI * 2 + 0.4, sg => box(sg, 0.16, 0.06, 0.22, 0xa88430, 0.37, 0.07, 0));
  },
  gunner: g => { const c = cyl(g, 0.05, 0.075, 0.24, 10, 0x402860, 0, -0.26, 0.07); c.rotation.x = 0.45; for (const sx of [-1, 1]) sph(g, 0.075, 0x5a3a90, sx * 0.47, -0.02, 0, 10, 8); },
  kamikaze: g => {
    const n = cone(g, 0.14, 0.32, 10, 0x302020, 0, -0.32, 0); n.rotation.x = Math.PI;
    ring(g, 0.49, 0.035, 0x202020, 0.02);
    for (let k = 0; k < 4; k++) spoke(g, k / 4 * Math.PI * 2, sg => { const f = box(sg, 0.22, 0.03, 0.1, 0xffe020, 0.52, -0.03, 0); f.rotation.z = -0.3; });
  },
  splitter: g => { box(g, 1.1, 0.06, 0.05, 0x1a6a5a, 0, 0.02, 0); box(g, 0.05, 0.06, 1.1, 0x1a6a5a, 0, 0.02, 0); },
  shielder: g => { const d = cone(g, 0.12, 0.1, 10, 0xc0c8e0, 0, 0.46, 0); d.rotation.x = Math.PI; cyl(g, 0.012, 0.012, 0.16, 4, 0x808898, 0, 0.37, 0); ring(g, 0.63, 0.022, 0x70b0ff, 0.02); },
  ghost: g => { for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; const c = cone(g, 0.09, 0.36, 6, 0xc8d0f0, Math.cos(a) * 0.36, -0.27, Math.sin(a) * 0.36); c.rotation.x = Math.PI; } },
  bomber: g => {
    for (const sx of [-1, 1]) { const w = box(g, 0.58, 0.045, 0.24, 0x3a4a2a, sx * 0.64, 0, 0); w.rotation.z = sx * -0.15; }
    box(g, 0.24, 0.15, 0.32, 0x2a2a2a, 0, -0.23, 0);
    for (const sx of [-1, 1]) sph(g, 0.05, 0xff5020, sx * 0.07, -0.31, 0.1, 6, 5);
  },
  sniper: g => {
    cyl(g, 0.025, 0.035, 0.52, 8, 0x101418, 0, -0.4, 0);
    ring(g, 0.05, 0.015, 0xff2040, -0.63); ring(g, 0.51, 0.02, 0xff2040, 0.02);
  },
  thief: g => {
    for (let k = 0; k < 3; k++) spoke(g, k / 3 * Math.PI * 2, sg => {
      const c1 = box(sg, 0.035, 0.3, 0.035, 0x404040, 0.12, -0.31, 0); c1.rotation.z = 0.35;
      const c2 = box(sg, 0.035, 0.13, 0.035, 0x404040, 0.17, -0.49, 0); c2.rotation.z = -0.6;
    });
    ring(g, 0.48, 0.03, 0xff60c0, 0.035);
  },
  boss: g => {
    for (let k = 0; k < 10; k++) spoke(g, k / 10 * Math.PI * 2, sg => { const c = cone(sg, 0.06, 0.26, 6, 0x801818, 0.64, 0.02, 0); c.rotation.z = -Math.PI / 2; });
    cyl(g, 0.015, 0.02, 0.22, 5, 0x303030, 0.12, 0.38, 0); sph(g, 0.035, 0xff2020, 0.12, 0.5, 0, 8, 6);
    ring(g, 0.5, 0.03, 0x801818, 0.05);
  },
};
const _bodyGeoCache = {};
function bodyGeo(typeKey) {
  if (_bodyGeoCache[typeKey]) return _bodyGeoCache[typeKey];
  const T = UFO_TYPES[typeKey];
  const geo = bakeWith(g => { hullParts(g, T, typeKey === 'boss'); if (ACCENTS[typeKey]) ACCENTS[typeKey](g); });
  // contorno só da silhueta do casco (barato: ~250 triângulos)
  const sil = bakeWith(g => {
    lathe(g, [[0.001, -0.2], [0.13, -0.19], [0.3, -0.13], [0.48, -0.04], [0.565, 0], [0.55, 0.035], [0.42, 0.085], [0.27, 0.12], [0.001, 0.13]], 18, 0);
  });
  return (_bodyGeoCache[typeKey] = { geo, out: outlineGeo(sil) });
}
function alienParts(g, skin, eye, boss) {
  const b = sph(g, 0.055, shade(skin, 0.8), 0, 0.0, 0, 8, 6); b.scale.set(1, 1.2, 0.9);
  const h = sph(g, 0.085, skin, 0, 0.11, 0, 12, 8); h.scale.set(1.1, 1, 0.95);
  for (const sx of [-1, 1]) {
    const e = sph(g, 0.03, eye, sx * 0.034, 0.115, 0.064, 8, 6); e.scale.set(1, 1.35, 0.55);
    ico(g, 0.008, 0xffffff, sx * 0.03, 0.13, 0.08, 0);
    const ant = cyl(g, 0.005, 0.005, 0.08, 3, shade(skin, 0.7), sx * 0.04, 0.22, -0.01); ant.rotation.z = -sx * 0.4;
    ico(g, 0.016, boss ? 0xff3030 : 0xffe040, sx * 0.058, 0.26, -0.01, 0);
  }
  if (boss) {
    cyl(g, 0.06, 0.06, 0.03, 10, 0xffc020, 0, 0.19, 0);
    for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; cone(g, 0.016, 0.045, 4, 0xffc020, Math.cos(a) * 0.055, 0.225, Math.sin(a) * 0.055); }
  }
}
const ALIEN_GEO = bakeWith(g => alienParts(g, 0x5ad860, 0x101018, false));
const BOSS_ALIEN_GEO = bakeWith(g => alienParts(g, 0x9050c0, 0xff2828, true));
const ALIEN_MAT = toon({ ramp: 4 });
const UFO_OUTLINE = outlineMat(0.016, 0x18101e);

// Feixe de abdução: cone com faixas subindo (shader barato, aditivo)
const BEAM_GEO = new THREE.CylinderGeometry(0.16, 0.55, 1, 24, 1, true).translate(0, -0.5, 0);
const BEAM_VS = `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const BEAM_FS = `uniform vec3 uColor; uniform float uTime; uniform float uAlpha;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){
  float bands = smoothstep(0.55, 1.0, sin((vUv.y * 9.0 - uTime * 4.0) * 3.14159)) * 0.6;
  float edge = 1.0 - abs(dot(vN, vV));
  float a = (0.18 + bands + edge * 0.45) * mix(0.55, 1.0, vUv.y) * uAlpha;
  gl_FragColor = vec4(uColor * (1.0 + bands), a);
}`;
function makeBeam(hex) {
  const m = new THREE.Mesh(BEAM_GEO, new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(hex) }, uTime: { value: 0 }, uAlpha: { value: 1 } },
    vertexShader: BEAM_VS, fragmentShader: BEAM_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  m.renderOrder = 4; m.visible = false; m.frustumCulled = false;
  return m;
}
// um feixe escondido fica sempre na cena: o shader dele é compilado no aquecimento, não na 1ª abdução
scene.add(makeBeam(0xffffff));
const GROUND_RING_GEO = new THREE.RingGeometry(0.4, 0.62, 32).rotateX(-Math.PI / 2);
const BUBBLE_GEO = new THREE.IcosahedronGeometry(1, 2);
const BUBBLE_MAT = new THREE.MeshBasicMaterial({ color: 0x70b0ff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

// Barra de vida (chefão / nave-mãe)
function makeHpBar(w, h) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 72;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, fog: false, toneMapped: false }));
  m.renderOrder = 999;
  m.userData = { ctx: c.getContext('2d'), tex, last: -1 };
  scene.add(m);
  return m;
}
export function drawHpBar(u) {
  const bar = u.hpBar;
  if (!bar) return;
  let cur = Math.max(0, u.hp), max = u.maxHp;
  if (u.kind === 'mother') { for (const p of u.parts) if (p.kind === 'pod') cur += Math.max(0, p.hp); max = u.totalMax; }
  const pct = clamp(cur / max, 0, 1);
  if (Math.abs(pct - bar.userData.last) < 0.002) return;
  bar.userData.last = pct;
  const x = bar.userData.ctx;
  x.clearRect(0, 0, 512, 72);
  x.fillStyle = 'rgba(14,8,24,0.88)'; x.beginPath(); x.roundRect(2, 2, 508, 68, 22); x.fill();
  x.strokeStyle = '#ffd040'; x.lineWidth = 4; x.stroke();
  const g = x.createLinearGradient(0, 10, 0, 62);
  g.addColorStop(0, pct > 0.5 ? '#ff7070' : '#ffb050'); g.addColorStop(1, pct > 0.5 ? '#d01830' : '#e06010');
  x.fillStyle = g; x.beginPath(); x.roundRect(10, 10, Math.max(20, 492 * pct), 52, 16); x.fill();
  x.fillStyle = '#fff'; x.font = '34px ' + FONT; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,0.7)';
  const label = (u.kind === 'mother' ? tr('NAVE-MÃE  ', 'MOTHERSHIP  ', 'EMOALUS  ') : tr('CHEFÃO  ', 'BOSS  ', 'POMO  ')) + Math.ceil(pct * 100) + '%';
  x.strokeText(label, 256, 38); x.fillText(label, 256, 38);
  bar.userData.tex.needsUpdate = true;
}

// =============================================================================
// ENTIDADES
// =============================================================================
function makeEntity(kind, typeKey, scaleW) {
  const T = UFO_TYPES[typeKey] || UFO_TYPES.saucer;
  const group = new THREE.Group();
  const bodyMat = toonUnique({ ramp: 4, transparent: typeKey === 'ghost' });
  const geos = bodyGeo(typeKey);
  const body = new THREE.Mesh(geos.geo, bodyMat);
  const outline = new THREE.Mesh(geos.out, UFO_OUTLINE);
  body.add(outline);
  group.add(body);
  const alien = new THREE.Mesh(typeKey === 'boss' ? BOSS_ALIEN_GEO : ALIEN_GEO, ALIEN_MAT);
  alien.position.y = 0.06;
  group.add(alien);
  group.scale.setScalar(scaleW);
  scene.add(group);
  const u = {
    kind, typeKey, T, group, body, bodyMat, outline, alien, pos: group.position, scaleW,
    beam: null, gring: null, bubble: null, hpBar: null,
    state: 'descending', target: null, speed: 1, beamTime: 5, beamElapsed: 0, beamDur: 5, bobPhase: rand(0, 6.28),
    hp: 1, maxHp: 1, flashT: 0, deadVel: new THREE.Vector3(), deadT: 0,
    spinAxis: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(),
    descendH: 4, zigPhase: rand(0, 6.28), zigAmp: 0, fireCD: rand(1.5, 3), charging: false, chargeK: 0,
    station: null, hover: null, idleT: 0, gooCD: 3, minionCD: 5, minionMarks: [], parts: [], pts: T.pts,
    age: 0, removed: false, shieldedBy: null, links: [], cloaked: false, cloakT: rand(1.5, 2.5), fade: 1,
    chainT: 0, afterBeam: 'escaping', lastPop: -9, windT: 0, diveDir: new THREE.Vector3(), stunT: 0,
    slowT: 0, slowMul: 1, burnT: 0, burnDps: 0, burnAcc: 0, shotCD: null, wobble: 0, spin: rand(0, 6),
    prev: new THREE.Vector3(), lean: new THREE.Vector2(), humT: rand(0, 1),
  };
  return u;
}
export function addPart(u, obj, opts) {
  const p = Object.assign({ obj, c: new THREE.Vector3(), r: 0.5, mult: 1, kind: 'body', active: true }, opts);
  u.parts.push(p);
  return p;
}
export function refreshParts(u) {
  if (u.removed) return;
  u.group.updateMatrixWorld();
  for (const p of u.parts) { if (p.obj === u.group) p.c.copy(u.pos); else p.obj.getWorldPosition(p.c); }
}
export function refreshAllParts() { for (const u of ufos) refreshParts(u); }

export function removeUfo(u) {
  if (u.removed) return;
  u.removed = true;
  scene.remove(u.group);
  if (u.gring) scene.remove(u.gring);
  if (u.beam && u.beam.parent) u.beam.parent.remove(u.beam);
  if (u.hpBar) { scene.remove(u.hpBar); u.hpBar = null; }
  if (u.bubble) { scene.remove(u.bubble); u.bubble = null; }
  dropLinks(u);
  if (u.beamLoop) { u.beamLoop.stop(0.2); u.beamLoop = null; }
  if (u.hum) { u.hum.stop(0.3); u.hum = null; }
  // (não chamar bodyMat.dispose(): liberaria o shader e a próxima nave recompilaria — engasgo no Quest)
  if (u.target && u.target.abductor === u && u.target.state === 'abducting') { u.target.state = 'safe'; u.target.abductor = null; u.target.fallVel = 0; }
}
export function clearUfos() {
  for (const u of ufos) removeUfo(u);
  ufos.length = 0;
  for (const g of eproj) killEproj(g);
  eproj.length = 0;
  for (const cr of crates.slice()) removeCrate(cr);
}

export function pickUfoTarget() {
  const cands = chickens.filter(c => c.state !== 'gone' && c.state !== 'abducting' && c.state !== 'safe');
  if (!cands.length) return null;
  const gold = cands.find(c => c.kind === 'golden');
  if (gold && Math.random() < 0.35) return gold;
  const free = cands.filter(c => !ufos.some(u => !u.removed && u.target === c && u.state !== 'dead'));
  return pick(free.length ? free : cands);
}

export function spawnRegular(typeKey, fromPos = null) {
  const w = G.waveDef, T = UFO_TYPES[typeKey];
  const sw = T.scale * w.ufoScale;
  const u = makeEntity('ufo', typeKey, sw);
  u.hp = u.maxHp = Math.max(1, Math.round(T.hp * w.hpMult));
  u.speed = w.speed * T.speed;
  u.beamTime = w.beamTime * T.beam;
  u.descendH = w.close ? 2.5 : (typeKey === 'zippy' || typeKey === 'mini' ? 3.4 : typeKey === 'tank' ? 4.6 : 4.0);
  addPart(u, u.group, { r: Math.max(0.45, 0.55 * sw + 0.1) });   // esfera da 2.1 (a elipse achatada da 3.0 tinha ~30% menos área)
  const gp = u.pos;
  if (fromPos) gp.copy(fromPos);
  else if (w.close) gp.set(rand(-4, 4), rand(12, 16), rand(5, 10));
  else if (Math.random() < 0.18) gp.set(Math.random() < 0.5 ? -34 : 34, rand(10, 18), rand(4, 22));
  else gp.set(rand(-22, 22), rand(13, 22), rand(18, 38));
  if (T.role === 'gunner') {
    u.state = 'approach';
    const a = rand(-0.9, 0.9), d = rand(9, 13);
    u.station = new THREE.Vector3(Math.sin(a) * d, rand(3.8, 6.2), Math.cos(a) * d);
    u.fireCD = rand(2, 3);
  } else if (T.role === 'support') {
    u.state = 'approach';
    u.station = new THREE.Vector3(rand(-5, 5), rand(7, 9), rand(8, 13));
    u.gooCD = 0.3;
  } else if (T.role === 'bomber') {
    u.state = 'turn'; u.idleT = rand(0.5, 1.5); u.bombCD = 0;
    if (!fromPos) gp.set(Math.random() < 0.5 ? -32 : 32, rand(9, 11), rand(4, 14));
  } else if (T.role === 'sniper') {
    u.state = 'approach';
    const a = rand(-1.0, 1.0), d = rand(18, 24);
    u.station = new THREE.Vector3(Math.sin(a) * d, rand(6, 10), Math.cos(a) * d);
    u.fireCD = rand(1.5, 3); u.lockP = new THREE.Vector3(); u.shotFlash = 0;
  } else if (T.role === 'thief') {
    u.state = 'descending'; u.target = pickUfoTarget();
    if (!fromPos) gp.set(rand(-25, 25), rand(4, 7), rand(25, 35));
  } else if (T.role === 'dive') {
    u.state = 'approach';
    u.station = new THREE.Vector3(rand(-4, 4), rand(5, 7), rand(11, 14));
    if (!fromPos) gp.set(rand(-15, 15), rand(12, 18), rand(26, 36));
    sfx('siren', { pos: gp });
  } else {
    u.state = 'descending';
    u.target = pickUfoTarget();
  }
  if (typeKey === 'zippy') u.zigAmp = 2.6;
  if (typeKey === 'mini') u.zigAmp = 1.6;
  u.prev.copy(gp);
  refreshParts(u);
  ufos.push(u);
  return u;
}

export function spawnBoss(hp) {
  const u = makeEntity('boss', 'boss', 2.4);
  const w = G.waveDef;
  u.hp = u.maxHp = hp;
  u.speed = w.speed * 0.75;
  u.beamTime = w.beamTime * 0.8;
  u.pts = 1500 + G.wave * 250;
  u.state = 'entering';
  u.pos.set(rand(-8, 8), 26, 40);
  u.hover = new THREE.Vector3(rand(-3, 3), 7.5, 10);
  u.idleT = 2.5; u.descendH = 5.6; u.afterBeam = 'rising';
  u.gooCD = 3;
  u.minionMarks = [0.66, 0.33];
  // ponto fraco: esfera vermelha embaixo
  u.orb = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
  u.orb.position.y = -0.27;
  u.group.add(u.orb);
  addPart(u, u.orb, { r: 0.16 * 2.4 + 0.12, kind: 'crit', mult: 2 });
  addPart(u, u.group, { ellip: [1.42, 0.55, 1.42] });
  u.hpBar = makeHpBar(2.0, 0.28);
  drawHpBar(u);
  u.prev.copy(u.pos);
  refreshParts(u);
  ufos.push(u);
  sfx('bossSpawn'); pulseAll(0.6, 200);
  showBanner(tr('⚠ CHEFÃO ⚠', '⚠ BOSS ⚠', '⚠ POMO ⚠'), tr('mire na luz vermelha embaixo dele', 'aim at the red light underneath', 'tähtää punaiseen valoon sen alla'), '', '#ff4040', 2.6);
  return u;
}

// ---------- Nave-mãe ----------
const MOTHER_HULL = bakeWith(g => {
  lathe(g, [[0.001, -0.2], [0.13, -0.19], [0.3, -0.13], [0.48, -0.04], [0.56, 0]], 48, 0x2e3442).scale.set(10, 6, 10);
  lathe(g, [[0.56, 0], [0.55, 0.035], [0.42, 0.085], [0.27, 0.12], [0.2, 0.13]], 48, 0x4a5468).scale.set(10, 6, 10);
  for (let i = 0; i < 12; i++) spoke(g, i / 12 * Math.PI * 2 + 0.13, sg => box(sg, 1.4, 0.25, 0.5, 0x232836, 3.6, 0.55, 0));
  ring(g, 4.0, 0.12, 0x2a3040, 0.25);
  ring(g, 5.55, 0.1, 0xb040ff, 0.0);
  for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; sph(g, 0.17, i % 2 ? 0xff40ff : 0x40ffff, Math.cos(a) * 5.4, 0.05, Math.sin(a) * 5.4, 8, 6); }
  ring(g, 1.25, 0.1, 0x8890a0, 0.75);
});
const MOTHER_OUT = outlineGeo(MOTHER_HULL);

export function spawnMothership() {
  const w = G.waveDef;
  const group = new THREE.Group();
  const spinG = new THREE.Group(); group.add(spinG);
  const bodyMat = toonUnique({ ramp: 4 });
  const body = new THREE.Mesh(MOTHER_HULL, bodyMat);
  body.add(new THREE.Mesh(MOTHER_OUT, outlineMat(0.004, 0x100818)));
  spinG.add(body);
  const alien = new THREE.Mesh(BOSS_ALIEN_GEO, ALIEN_MAT); alien.scale.setScalar(5); alien.position.y = 0.6; group.add(alien);
  const pods = [];
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * Math.PI * 2;
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.0, 6), toon({ color: 0x303848, vertexColors: false }));
    strut.position.set(Math.cos(a) * 2.9, -1.2, Math.sin(a) * 2.9); spinG.add(strut);
    const mat = toonUnique({ color: 0xff3050, vertexColors: false, emissive: 0x801020 });
    const pod = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 2), mat);
    pod.position.set(Math.cos(a) * 2.9, -1.9, Math.sin(a) * 2.9);
    spinG.add(pod);
    pods.push({ mesh: pod, mat });
  }
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xff40ff });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 3), coreMat); core.position.y = -1.35; group.add(core);
  const armor = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), toon({ color: 0x2a2e3a, vertexColors: false, side: THREE.DoubleSide }));
  armor.position.y = -1.1; group.add(armor);
  const gl = new THREE.Mesh(new THREE.RingGeometry(2.2, 3.4, 40), new THREE.MeshBasicMaterial({ color: 0xff40ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  gl.rotation.x = Math.PI / 2; gl.position.y = -1.05; group.add(gl);
  scene.add(group);
  const u = {
    kind: 'mother', typeKey: 'boss', T: UFO_TYPES.boss, group, body, bodyMat, alien, spinG, pods, core, coreMat, armor, glowRing: gl,
    pos: group.position, scaleW: 1, beam: null, gring: null, bubble: null, hpBar: null,
    hp: w.motherCore || 100, maxHp: w.motherCore || 100, pts: 6000, state: 'entering', hover: new THREE.Vector3(0, 15, 24),
    gooCD: 4, minionCD: 5, coreExposed: false, parts: [], flashT: 0, age: 0, removed: false, deadT: 0, links: [], lastPop: -9,
    slowT: 0, slowMul: 1, burnT: 0, burnDps: 0, burnAcc: 0, chainT: 0, wobble: 0, prev: new THREE.Vector3(), lean: new THREE.Vector2(), spin: 0,
    deadVel: new THREE.Vector3(), spinAxis: new THREE.Vector3(0, 0, 1),
  };
  u.pos.set(0, 70, 70);
  for (const pd of pods) addPart(u, pd.mesh, { r: 1.0, kind: 'pod', hp: w.motherPod || 30, maxHp: w.motherPod || 30, mat: pd.mat, flashT: 0 });
  u.corePart = addPart(u, core, { r: 1.25, kind: 'core', active: false });
  addPart(u, u.group, { ellip: [5.4, 1.25, 5.4], kind: 'armor' });
  u.totalMax = u.maxHp + 3 * (w.motherPod || 30);
  u.hpBar = makeHpBar(5, 0.62);
  drawHpBar(u);
  refreshParts(u);
  ufos.push(u);
  sfx('motherSpawn'); pulseAll(0.8, 600);
  u.hum = loop('motherHum', { pos: u.pos });
  showBanner(tr('NAVE-MÃE!', 'MOTHERSHIP!', 'EMOALUS!'), tr('destrua os 3 módulos vermelhos', 'destroy the 3 red pods', 'tuhoa 3 punaista moduulia'), tr('depois acerte o núcleo', 'then hit the core', 'osu sitten ytimeen'), '#ff40ff', 3.6);
  return u;
}

// =============================================================================
// COMPORTAMENTOS
// =============================================================================
function moveToward(pos, target, step) {
  t6.copy(target).sub(pos);
  const len = t6.length();
  if (len <= step || len < 1e-5) { pos.copy(target); return true; }
  pos.addScaledVector(t6, step / len);
  return false;
}
function featherBlock(u, tgt) {
  tgt.shieldHits = (tgt.shieldHits || 1) - 1;
  if (tgt.shieldHits <= 0) setChickenShield(tgt, false);
  u.stunT = 1.6; u.target = null;
  u.pos.y += 1.2;
  feathers(tgt.pos, 14); sfx('shieldDown', { pos: tgt.pos }); pulseAll(0.3, 60);
  popup(tr('ESCUDO DE PENAS!', 'FEATHER SHIELD!', 'HÖYHENSUOJA!'), t0.copy(tgt.pos).setY(1.3), '#ffffff', 0.9);
}
function startBeam(u, tgt) {
  if (tgt.shield) { featherBlock(u, tgt); return; }
  u.state = 'beaming'; u.beamElapsed = 0;
  u.beamDur = u.beamTime * CHICKEN_KINDS[tgt.kind].beamMul;
  if (!u.beam) { u.beam = makeBeam(u.T.glow); u.beam.position.y = -0.2; u.group.add(u.beam); }
  if (!u.gring) { u.gring = new THREE.Mesh(GROUND_RING_GEO, new THREE.MeshBasicMaterial({ color: u.T.glow, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide })); scene.add(u.gring); }
  u.beam.visible = true; u.gring.visible = true;
  tgt.state = 'abducting'; tgt.abductor = u; tgt.alert.visible = false;
  sfx('beamStart', { pos: u.pos });
  u.beamLoop = loop('beam', { pos: u.pos });
}
export function stopBeam(u) {
  if (u.beam) u.beam.visible = false;
  if (u.gring) u.gring.visible = false;
  if (u.beamLoop) { u.beamLoop.stop(0.2); u.beamLoop = null; }
}

function updateAbductor(u, dt, edt) {
  const gp = u.pos;
  if (u.typeKey === 'ghost') {
    if (u.state === 'descending') {
      u.cloakT -= edt;
      if (u.cloakT <= 0) { u.cloaked = !u.cloaked; u.cloakT = u.cloaked ? 1.8 : 2.4; sfx('ghostFade', { pos: gp }); }
    } else u.cloaked = false;
    u.fade += ((u.cloaked ? 0.07 : 1) - u.fade) * Math.min(1, dt * 6);
    u.bodyMat.opacity = u.fade;
    u.alien.visible = u.fade > 0.5;
    u.outline.visible = u.fade > 0.5;
    u.parts[0].active = !u.cloaked;
  }
  if (u.stunT > 0) {
    u.stunT -= edt;
    u.group.rotation.z = u.stunT > 0 ? Math.sin(u.age * 25) * 0.25 : 0;
    if (u.state === 'descending') return;
  }
  if (u.state === 'descending') {
    let tgt = u.target;
    if (!tgt || tgt.state === 'gone' || tgt.state === 'safe' || (tgt.state === 'abducting' && tgt.abductor !== u)) {
      tgt = u.target = pickUfoTarget();
      if (!tgt) { u.state = u.kind === 'boss' ? 'rising' : 'escaping'; return; }
    }
    t0.set(tgt.pos.x, u.descendH, tgt.pos.z);
    t1.copy(t0).sub(gp);
    const dist = t1.length();
    if (dist < 0.35) { gp.copy(t0); startBeam(u, tgt); return; }
    t1.divideScalar(dist);
    gp.addScaledVector(t1, Math.min(dist, u.speed * edt));
    if (u.zigAmp > 0) {
      u.zigPhase += edt * 3.2;
      t2.set(-t1.z, 0, t1.x);
      if (t2.lengthSq() > 1e-3) { t2.normalize(); gp.addScaledVector(t2, Math.cos(u.zigPhase) * u.zigAmp * 1.6 * Math.min(1, dist / 5) * edt); }
    }
  } else if (u.state === 'beaming') {
    const tgt = u.target;
    if (!tgt || tgt.state !== 'abducting' || tgt.abductor !== u) { stopBeam(u); u.state = 'descending'; return; }
    u.beamElapsed += edt;
    const prog = Math.min(1, u.beamElapsed / u.beamDur);
    gp.y = u.descendH + Math.sin(u.age * 3 + u.bobPhase) * 0.08;
    tgt.pos.x += (gp.x - tgt.pos.x) * Math.min(1, edt * 3);
    tgt.pos.z += (gp.z - tgt.pos.z) * Math.min(1, edt * 3);
    const topY = gp.y - 0.2 * u.scaleW - 0.35;
    tgt.pos.y = prog * topY;
    const L = (gp.y - 0.2 * u.scaleW) / u.scaleW;
    const bw = 1 - prog * 0.35;
    u.beam.scale.set(bw, L, bw);
    u.beam.material.uniforms.uTime.value = u.age;
    u.beam.material.uniforms.uAlpha.value = 0.8 + Math.sin(u.age * 20) * 0.1;
    u.gring.position.set(tgt.pos.x, 0.045, tgt.pos.z);
    u.gring.scale.setScalar(u.scaleW * (1 + Math.sin(u.age * 8) * 0.15));
    if (Math.random() < 0.5) { _c.setHex(u.T.glow); fxAdd.spawn(tgt.pos.x + rand(-0.3, 0.3), rand(0, topY), tgt.pos.z + rand(-0.3, 0.3), 0, 1.6, 0, _c, 0.05, 0.6, 0, 0, -0.5, 0.9, SHAPE.star, 3); }
    if (u.beamLoop) { u.beamLoop.setPos(gp); u.beamLoop.setPitch(1 + prog * 0.6); }
    if (prog >= 1) {
      abductChicken(tgt, u);
      stopBeam(u);
      u.state = u.afterBeam;
      if (u.kind === 'boss') u.idleT = 3.5;
    }
  } else if (u.state === 'escaping') {
    gp.y += edt * 7;
    gp.x += edt * 2.5 * Math.sign(gp.x || 1);
    if (gp.y > 55) removeUfo(u);
  }
}

function updateGunner(u, dt, edt) {
  const gp = u.pos;
  if (u.state === 'approach') {
    if (moveToward(gp, u.station, 3.4 * edt)) u.state = 'hover';
  } else if (u.state === 'hover') {
    const tx = u.station.x + Math.sin(u.age * 0.7 + u.bobPhase) * 1.6;
    const ty = u.station.y + Math.sin(u.age * 1.3 + u.bobPhase) * 0.35;
    gp.x += (tx - gp.x) * Math.min(1, edt * 2);
    gp.y += (ty - gp.y) * Math.min(1, edt * 2);
    u.fireCD -= edt;
    if (u.fireCD < 0.75 && !u.charging) { u.charging = true; sfx('gooCharge', { pos: gp }); }
    u.chargeK = u.charging ? 1 - Math.max(0, u.fireCD) / 0.75 : 0;
    if (u.charging && Math.random() < 0.5) { bellyPos(u, t3); _c.setHex(0x8aff50); fxAdd.spawn(t3.x + rand(-0.2, 0.2), t3.y - 0.1, t3.z + rand(-0.2, 0.2), 0, 0.6, 0, _c, 0.07, 0.3); }
    if (u.fireCD <= 0) {
      fireEnemy('goo', bellyPos(u, t3), 0.02);
      u.charging = false; u.chargeK = 0;
      u.fireCD = Math.max(1.5, 3.4 - G.wave * 0.15) / Math.max(0.6, G.waveDef.aggro || 1) * rand(0.85, 1.15);
    }
  }
}
function bellyPos(u, out) { return out.set(u.pos.x, u.pos.y - 0.22 * u.scaleW, u.pos.z); }

function updateKamikaze(u, dt, edt) {
  const gp = u.pos;
  if (u.state === 'approach') {
    if (moveToward(gp, u.station, 6 * edt)) { u.state = 'windup'; u.windT = 1.3; sfx('siren', { pos: gp }); }
  } else if (u.state === 'windup') {
    u.windT -= edt;
    u.bodyMat.emissive.setHex(Math.floor(u.windT * 10) % 2 ? 0xff2000 : 0x000000);
    gp.x += Math.sin(u.age * 60) * 0.01;
    if (u.windT <= 0) {
      u.state = 'dive';
      u.diveDir.copy(camPos).sub(gp).normalize();
      u.bodyMat.emissive.setHex(0x601000);
      sfx('dive', { pos: gp });
    }
  } else if (u.state === 'dive') {
    t4.copy(camPos).sub(gp).normalize();
    u.diveDir.lerp(t4, Math.min(1, edt * 1.2)).normalize();
    gp.addScaledVector(u.diveDir, (8 + Math.min(G.wave, 12) * 0.35) * edt);
    if (Math.random() < 0.6) smoke(gp, 1, 0x505050, 0.25, 0.6, 0.2);
    glow(gp.x, gp.y, gp.z, 0.9, 0xff4010, 0.7);
    if (gp.distanceTo(camPos) < 1.1) { kamikazeHit(u); return; }
    if (gp.y < 0.3) { fireball(gp, 1); sfx('explosionSmall', { pos: gp }); removeUfo(u); }
  }
}

function dropLinks(s) {
  if (!s.links) return;
  for (const t of s.links) if (t.shieldedBy === s) t.shieldedBy = null;
  if (s.links.length) sfx('shieldDown', { pos: s.pos });
  s.links.length = 0;
}
function updateShielder(u, dt, edt) {
  const gp = u.pos;
  if (u.state === 'approach') {
    if (moveToward(gp, u.station, 3 * edt)) u.state = 'hover';
  } else if (u.state === 'hover') {
    gp.x = lerp(gp.x, u.station.x + Math.sin(u.age * 0.4 + u.bobPhase) * 2.2, Math.min(1, edt));
    gp.y = lerp(gp.y, u.station.y + Math.sin(u.age * 0.9) * 0.3, Math.min(1, edt));
  }
  u.gooCD -= edt;
  if (u.gooCD <= 0) {
    u.gooCD = 3;
    for (const t of u.links) if (t.shieldedBy === u) t.shieldedBy = null;
    u.links = ufos.filter(o => o !== u && isAlive(o) && o.kind !== 'mother' && o.typeKey !== 'shielder' && !o.shieldedBy && o.state !== 'escaping' && o.pos.distanceTo(gp) < 11)
      .sort((a, b) => a.pos.distanceTo(gp) - b.pos.distanceTo(gp)).slice(0, 3);
    for (const t of u.links) t.shieldedBy = u;
    if (u.links.length) sfx('shieldUp', { pos: gp });
  }
  u.links = u.links.filter(t => isAlive(t) && t.shieldedBy === u);
  for (let k = 0; k < u.links.length; k++) seg(gp, u.links[k].pos, 0.03 + Math.sin(G.time * 20 + k) * 0.01, 0x60a8ff);
}

function updateBoss(u, dt, edt) {
  const gp = u.pos;
  if (u.orb) { u.orb.scale.setScalar(1 + Math.sin(G.time * 8) * 0.15); bellyPos(u, t3); glow(t3.x, t3.y - 0.1, t3.z, 1.0, 0xff2020, 0.8); }
  if (u.state === 'entering') {
    if (moveToward(gp, u.hover, 6 * edt)) { u.state = 'hover'; u.idleT = 2; }
  } else if (u.state === 'hover') {
    const tx = u.hover.x + Math.sin(u.age * 0.5) * 5, ty = u.hover.y + Math.sin(u.age * 1.1) * 0.5;
    gp.x += (tx - gp.x) * Math.min(1, edt * 1.5);
    gp.y += (ty - gp.y) * Math.min(1, edt * 1.5);
    gp.z += (u.hover.z - gp.z) * Math.min(1, edt);
    u.idleT -= edt;
    if (u.idleT <= 0) { u.target = pickUfoTarget(); if (u.target) u.state = 'descending'; else u.idleT = 1; }
  } else if (u.state === 'rising') {
    if (moveToward(gp, u.hover, 4 * edt)) { u.state = 'hover'; u.idleT = 3.5; }
  } else {
    updateAbductor(u, dt, edt);
  }
  if (G.waveDef.bossGoo && u.state !== 'entering') {
    u.gooCD -= edt;
    if (u.gooCD <= 0) {
      u.gooCD = 4.2;
      u.orb.getWorldPosition(t5);
      for (let k = 0; k < G.waveDef.bossGoo; k++) fireEnemy('goo', t5, 0.06 * k);
    }
  }
}

export function exposeCore(u) {
  u.coreExposed = true;
  u.corePart.active = true;
  u.armorVel = new THREE.Vector3(rand(-1, 1), 1, rand(-1, 1));
  blast(u.core.getWorldPosition(t5), 3, 0xff40ff);
  sfx('coreExposed', { pos: t5 });
  showBanner(tr('NÚCLEO EXPOSTO!', 'CORE EXPOSED!', 'YDIN PALJAANA!'), tr('ACERTE A ESFERA ROSA', 'HIT THE PINK ORB', 'OSU VAALEANPUNAISEEN PALLOON'), '', '#ff40ff', 2.4);
}
function updateMother(u, dt, edt) {
  const gp = u.pos;
  for (const p of u.parts) if (p.kind === 'pod' && p.active) {
    p.flashT = Math.max(0, (p.flashT || 0) - dt);
    p.mat.emissive.setHex(p.flashT > 0 ? 0xffffff : (Math.floor(G.time * 3) % 2 ? 0x801020 : 0xc02040));
    p.obj.getWorldPosition(t5); glow(t5.x, t5.y, t5.z, 2.4, 0xff2050, 0.5);
  }
  if (u.coreExposed) {
    u.core.scale.setScalar(1 + Math.sin(G.time * 7) * 0.08);
    u.coreMat.color.setHex(u.flashT > 0 ? 0xffffff : 0xff40ff);
    u.core.getWorldPosition(t5); glow(t5.x, t5.y, t5.z, 4, 0xff40ff, 0.7);
    if (u.armor.visible) {
      u.armorVel.y -= 9.8 * dt;
      u.armor.position.addScaledVector(u.armorVel, dt);
      u.armor.rotation.x += dt * 2;
      if (u.armor.position.y < -40) u.armor.visible = false;
    }
  }
  if (u.hum) u.hum.setPos(gp);
  if (u.state === 'entering') {
    if (moveToward(gp, u.hover, 7 * edt)) u.state = 'fighting';
    if (Math.random() < 0.3) pulseAll(0.2, 40);
  } else if (u.state === 'fighting') {
    gp.x = lerp(gp.x, Math.sin(u.age * 0.18) * 7, Math.min(1, edt * 0.8));
    gp.y = lerp(gp.y, 15 + Math.sin(u.age * 0.5) * 0.6, Math.min(1, edt));
    u.spinG.rotation.y += edt * 0.22;
    u.glowRing.material.opacity = 0.25 + Math.sin(G.time * 3) * 0.1;
    u.gooCD -= edt;
    if (u.gooCD <= 0) {
      const n = u.coreExposed ? 5 : 4;
      for (let k = 0; k < n; k++) { u.core.getWorldPosition(t5); t5.x += rand(-2, 2); fireEnemy('goo', t5, 0.05 + k * 0.03); }
      u.gooCD = u.coreExposed ? 2.0 : 3.0;
    }
    u.minionCD -= edt;
    if (u.minionCD <= 0) {
      u.minionCD = u.coreExposed ? 4 : 6.5;
      if (aliveRegulars() < G.waveDef.maxAlive) { u.core.getWorldPosition(t5); spawnRegular(pick(['saucer', 'zippy', 'kamikaze', 'bomber', 'thief', 'gunner']), t5); }
    }
  } else if (u.state === 'dying') {
    u.deadT += dt;
    gp.y -= dt * 1.4;
    u.group.rotation.z += dt * 0.15;
    u.boomT = (u.boomT || 0) - dt;
    if (u.boomT <= 0) {
      u.boomT = 0.12;
      t5.copy(gp).add(t6.set(rand(-5, 5), rand(-1.5, 1), rand(-5, 5)));
      fireball(t5, 1.6); sfx('explosionBig', { pos: t5 }); pulseAll(0.5, 60);
    }
    if (u.deadT > 3) {
      blast(gp, 12, 0xff60ff); fireball(gp, 5); sfx('bossDeath', { pos: gp }); pulseAll(1, 500);
      debrisBurst(gp, 0x4a5468, 30, 8);
      if (u.hum) { u.hum.stop(1); u.hum = null; }
      removeUfo(u);
    }
  }
}

// Naves que abduzem também atiram plasma em você (a partir da wave 3)
function abductorShoot(u, edt) {
  const ag = G.waveDef.aggro || 0;
  if (!ag || u.kind !== 'ufo' || u.cloaked || (u.state !== 'descending' && u.state !== 'beaming')) { u.chargeK = 0; return; }
  if (u.shotCD == null) u.shotCD = rand(3, 7) / ag;
  u.shotCD -= edt;
  u.chargeK = u.shotCD < 0.45 ? 0.6 + Math.sin(G.time * 40) * 0.4 : 0;
  if (u.shotCD <= 0) {
    fireEnemy('plasma', bellyPos(u, t3), 0.03);
    u.shotCD = rand(5, 8.5) / ag;
  }
}
function updateBomber(u, dt, edt) {
  const gp = u.pos, rp = rig.position;
  if (u.state === 'turn') {
    u.idleT -= edt;
    if (u.idleT <= 0) {
      const side = gp.x < 0 ? 1 : -1;
      u.passTo = new THREE.Vector3(side * 32, rand(9, 11), rp.z + rand(-1, 2));
      gp.z += (rp.z - gp.z) * 0.6;
      u.state = 'pass';
    }
  } else if (u.state === 'pass') {
    u.passTo.z += (rp.z - u.passTo.z) * Math.min(1, edt * 0.6);
    const arrived = moveToward(gp, u.passTo, 6.5 * Math.min(1.6, G.waveDef.aggro || 1) * edt);
    u.bombCD -= edt;
    if (u.bombCD <= 0 && Math.abs(gp.x - rp.x) < 1.6 && Math.abs(gp.z - rp.z) < 3) {
      fireEnemy('bomb', bellyPos(u, t3));
      u.bombCD = 0.7;
    }
    if (arrived) { u.state = 'turn'; u.idleT = rand(2, 3.5) / Math.max(0.6, G.waveDef.aggro || 1); }
  }
}
function updateSniper(u, dt, edt) {
  const gp = u.pos;
  if (u.state === 'approach') { if (moveToward(gp, u.station, 5 * edt)) u.state = 'hover'; return; }
  gp.x += (u.station.x + Math.sin(u.age * 0.5 + u.bobPhase) * 1.2 - gp.x) * Math.min(1, edt);
  gp.y += (u.station.y + Math.sin(u.age * 1.1) * 0.3 - gp.y) * Math.min(1, edt);
  bellyPos(u, t3); t3.y -= 0.4 * u.scaleW;
  if (u.state === 'hover') {
    if (u.shotFlash > 0) { u.shotFlash -= dt; seg(t3, u.lockP, 0.06, 0xff3050); }
    u.fireCD -= edt;
    if (u.fireCD <= 0) { u.state = 'aim'; u.aimT = 0; sfx('sniperCharge', { pos: gp }); }
  } else if (u.state === 'aim') {
    // mira 2s; trava 0.45s antes do tiro: dá tempo de sair da linha
    const AIM = 2.0, LOCK = 1.55;
    u.aimT += edt;
    if (u.aimT < LOCK) u.lockP.copy(camPos).add(t2.set(0, -0.12, 0));
    const k = Math.min(1, u.aimT / AIM);
    if (u.aimT < LOCK || Math.floor(u.aimT * 24) % 2 === 0) { seg(t3, u.lockP, 0.008 + k * 0.014, 0xff2040); glow(u.lockP.x, u.lockP.y, u.lockP.z, 0.15 + k * 0.2, 0xff2040, 0.9); }
    glow(t3.x, t3.y, t3.z, 0.3 + k * 0.5, 0xff2040, 0.9);
    if (u.aimT >= AIM) {
      u.state = 'hover';
      u.fireCD = rand(3, 4.5) / Math.max(0.6, G.waveDef.aggro || 1);
      u.shotFlash = 0.14;
      sfx('sniperShot', { pos: gp });
      sparks(u.lockP, 0xff3050, 10, 3, 0.06, 0.4);
      if (camPos.distanceTo(u.lockP) < 0.7) damagePlayer(25, tr('SNIPER!', 'SNIPER!', 'TARKKA-AMPUJA!'), '#ff3050');
    }
  }
}
function updateThief(u, dt, edt) {
  const gp = u.pos;
  if (u.stunT > 0) { u.stunT -= edt; u.group.rotation.z = u.stunT > 0 ? Math.sin(u.age * 25) * 0.25 : 0; if (u.state === 'descending') return; }
  if (u.state === 'descending') {
    let tgt = u.target;
    if (!tgt || tgt.state === 'gone' || tgt.state === 'safe' || (tgt.state === 'abducting' && tgt.abductor !== u)) {
      tgt = u.target = pickUfoTarget();
      if (!tgt) { u.state = 'escaping'; return; }
    }
    t0.set(tgt.pos.x, 1.5, tgt.pos.z);
    if (gp.distanceTo(t0) < 0.3) {
      if (tgt.shield) { featherBlock(u, tgt); return; }
      u.state = 'grab'; u.grabT = 0.5;
      tgt.state = 'abducting'; tgt.abductor = u; tgt.alert.visible = false;
      u.fleeDir = new THREE.Vector3(tgt.pos.x, 0, tgt.pos.z);
      if (u.fleeDir.lengthSq() < 0.01) u.fleeDir.set(0, 0, 1);
      u.fleeDir.normalize();
      sfx('thiefGrab', { pos: gp });
      popup(tr('LADRA!', 'THIEF!', 'VARAS!'), t1.copy(gp).setY(gp.y + 0.6), '#ff60c0', 1);
    } else moveToward(gp, t0, (3.6 + Math.min(G.wave, 12) * 0.1) * edt);
  } else if (u.state === 'grab' || u.state === 'flee') {
    const tgt = u.target;
    if (!tgt || tgt.state !== 'abducting' || tgt.abductor !== u) { u.state = 'escaping'; return; }
    if (u.state === 'grab') { u.grabT -= edt; if (u.grabT <= 0) u.state = 'flee'; }
    else { gp.addScaledVector(u.fleeDir, 3.2 * edt); gp.y = Math.min(4, gp.y + 0.4 * edt); }
    tgt.pos.set(gp.x, Math.max(0, gp.y - 0.6), gp.z);
    if (Math.hypot(gp.x, gp.z - 6) > 22) { abductChicken(tgt, u); u.state = 'escaping'; }
  } else if (u.state === 'escaping') {
    gp.y += edt * 7;
    if (gp.y > 50) removeUfo(u);
  }
}

// =============================================================================
// LOOP
// =============================================================================
let humSlots = [];  // até 4 zumbidos espaciais, nas naves mais próximas
export function updateUfos(dt, edt) {
  const night = nightAmount();
  for (const u of ufos) {
    if (u.removed) continue;
    u.age += edt;
    if (u.flashT > 0) u.flashT -= dt;
    if (u.chainT > 0) { u.chainT -= dt; if (u.chainT <= 0 && isAlive(u)) { u.chainT = 0; killUfo(u, u.pos); } }
    const gp = u.pos;
    if (u.state === 'dead') {
      u.deadT += dt;
      u.deadVel.y -= 9.8 * dt;
      gp.addScaledVector(u.deadVel, dt);
      u.group.rotation.x += u.spinAxis.x * dt * 8;
      u.group.rotation.z += u.spinAxis.z * dt * 8;
      if (Math.random() < 0.6) smoke(gp, 1, 0x404048, 0.32, 0.9, 0.3);
      if (Math.random() < 0.4) { _c.setHex(0xff8020); fxAdd.spawn(gp.x, gp.y, gp.z, rand(-0.3, 0.3), rand(0, 0.5), rand(-0.3, 0.3), _c, 0.25 * u.scaleW, 0.3, 0, 0, 0.5, 1, SHAPE.smoke); }
      if (gp.y <= 0.2 || u.deadT > 4) {
        gp.y = Math.max(gp.y, 0.2);
        fireball(gp, 0.7 * u.scaleW); blast(gp, 1.6 * u.scaleW, 0xff9030);
        debrisBurst(gp, u.T.color, 8, 3);
        sfx('debrisLand', { pos: gp });
        removeUfo(u);
      }
      continue;
    }
    let uedt = edt;
    if (u.slowT > 0) { u.slowT -= dt; uedt = edt * u.slowMul; if (Math.random() < 0.3) { _c.setHex(0xa0e0ff); fxAdd.spawn(gp.x + rand(-0.4, 0.4), gp.y, gp.z + rand(-0.4, 0.4), 0, -0.4, 0, _c, 0.07, 0.5, 0, 0, 0, 1, SHAPE.star, 2); } }
    if (u.burnT > 0) {
      u.burnT -= dt; u.burnAcc += dt;
      if (Math.random() < 0.6) { _c.setHex(Math.random() < 0.5 ? 0xff7020 : 0xffc040); fxAdd.spawn(gp.x + rand(-0.3, 0.3), gp.y + 0.1, gp.z + rand(-0.3, 0.3), 0, 1.2, 0, _c, rand(0.1, 0.18), 0.4, -1, 0, 0.5, 1, SHAPE.smoke); }
      if (u.burnAcc >= 0.5) {
        u.burnAcc = 0;
        const bp = u.parts.find(q => q.active && q.kind !== 'armor');
        if (bp) hitPart(u, bp, u.burnDps * 0.5, bp.c, false);
        if (!isAlive(u)) continue;
      }
    } else u.burnDps = 0;

    if (u.kind === 'mother') updateMother(u, dt, uedt);
    else if (u.kind === 'boss') updateBoss(u, dt, uedt);
    else {
      const role = u.T.role;
      if (role === 'gunner') updateGunner(u, dt, uedt);
      else if (role === 'dive') updateKamikaze(u, dt, uedt);
      else if (role === 'support') updateShielder(u, dt, uedt);
      else if (role === 'bomber') updateBomber(u, dt, uedt);
      else if (role === 'sniper') updateSniper(u, dt, uedt);
      else if (role === 'thief') updateThief(u, dt, uedt);
      else { updateAbductor(u, dt, uedt); if (!u.removed) abductorShoot(u, uedt); }
    }
    if (u.removed) continue;
    drawUfo(u, dt, night);
  }
  for (let i = ufos.length - 1; i >= 0; i--) if (ufos[i].removed) ufos.splice(i, 1);
  updateHums(dt);
}

// Visual por frame: giro do casco, inclinação no movimento, alien te olhando, flash de dano, luzes à noite
function drawUfo(u, dt, night) {
  const gp = u.pos;
  if (u.kind !== 'mother') {
    // inclina na direção do movimento
    const vx = (gp.x - u.prev.x) / Math.max(dt, 1e-3), vz = (gp.z - u.prev.z) / Math.max(dt, 1e-3);
    u.lean.x += (clamp(vz * 0.04, -0.3, 0.3) - u.lean.x) * Math.min(1, dt * 4);
    u.lean.y += (clamp(-vx * 0.04, -0.3, 0.3) - u.lean.y) * Math.min(1, dt * 4);
    u.wobble = Math.max(0, u.wobble - dt * 3);
    const wob = Math.sin(u.age * 40) * u.wobble * 0.3;
    if (u.state !== 'dead' && !(u.stunT > 0)) { u.group.rotation.x = u.lean.x + wob; u.group.rotation.z = u.lean.y - wob; }
    u.spin += dt * (1.2 + 3.5 * night);
    u.body.rotation.y = u.spin;
    u.alien.rotation.y = Math.atan2(camPos.x - gp.x, camPos.z - gp.z);
    u.alien.position.y = 0.06 + Math.sin(u.age * 6) * 0.008;
    // cor do casco: flash > gelo > fogo > brilho noturno
    const m = u.bodyMat;
    if (u.state !== 'windup') {
      if (u.flashT > 0) { m.color.setScalar(2.2); m.emissive.setHex(0x404040); }
      else {
        m.color.setScalar(1);
        if (u.slowT > 0) m.emissive.setHex(0x3070c0).multiplyScalar(0.6);
        else if (u.burnT > 0) m.emissive.setHex(0xff5010).multiplyScalar(0.3 + Math.random() * 0.25);
        else m.emissive.setHex(u.T.color).multiplyScalar(0.22 * night);
      }
    }
    // luzes da borda (halos só de noite) + brilho da barriga
    const s = u.scaleW, vis = u.typeKey !== 'ghost' || u.fade > 0.5;
    if (vis) {
      if (night > 0.05) {
        for (let i = 0; i < N_LIGHTS; i++) {
          const a = -(i / N_LIGHTS * Math.PI * 2) + u.spin;
          glow(gp.x + Math.cos(a) * 0.54 * s, gp.y + 0.01 * s, gp.z - Math.sin(a) * 0.54 * s, (u.kind === 'boss' ? 0.5 : 0.28) * s, u.kind === 'boss' ? (i % 2 ? 0xff2020 : 0xffa020) : LIGHT_COLS[i % 4], night * 0.95);
        }
      }
      bellyPos(u, t3);
      glow(t3.x, t3.y - 0.02, t3.z, (0.45 + u.chargeK * 0.9) * s, u.T.role === 'gunner' && u.chargeK > 0 ? 0x8aff50 : u.chargeK > 0 ? 0xff3040 : u.T.glow, 0.35 + night * 0.4 + u.chargeK * 0.5);
    }
  } else {
    const m = u.bodyMat;
    if (u.flashT > 0) m.emissive.setScalar(0.5);
    else m.emissive.setHex(0x4a5264).multiplyScalar(0.45 * night);
    if (night > 0.05) for (let i = 0; i < 24; i += 2) {
      const a = i / 24 * Math.PI * 2 + u.spinG.rotation.y;
      glow(gp.x + Math.cos(a) * 5.4, gp.y + 0.05, gp.z - Math.sin(a) * 5.4, 1.2, i % 4 ? 0xff40ff : 0x40ffff, night);
    }
  }
  u.prev.copy(gp);
  // bolha do escudo
  if (u.shieldedBy && isAlive(u.shieldedBy)) {
    if (!u.bubble) { u.bubble = new THREE.Mesh(BUBBLE_GEO, BUBBLE_MAT); scene.add(u.bubble); }
    u.bubble.visible = true;
    u.bubble.position.copy(gp);
    u.bubble.scale.setScalar((u.kind === 'boss' ? 1.6 : 0.78) * u.scaleW * (1 + Math.sin(G.time * 6) * 0.04));
  } else if (u.bubble) u.bubble.visible = false;
  // sombra
  if (!(u.typeKey === 'ghost' && u.cloaked)) blob(gp.x, groundHeightAt(gp.x, gp.z), gp.z, (u.kind === 'mother' ? 12 : 1.3 * u.scaleW) * (1 + Math.max(0, gp.y) * 0.04) * clamp(1.1 - gp.y * 0.02, 0.4, 1));
  if (u.hpBar) {
    u.hpBar.position.set(gp.x, gp.y + (u.kind === 'mother' ? 3.4 : 1.6), gp.z);
    u.hpBar.lookAt(camPos);
    const d = camPos.distanceTo(u.hpBar.position);
    u.hpBar.scale.setScalar(clamp(d / 14, 0.7, 2.2));
  }
}

// Zumbido 3D das naves: só as 4 mais próximas tocam (economia de CPU no Quest)
let humT = 0;
const _near = [];
function updateHums(dt) {
  // escolhe as 4 mais próximas só 4×/s (antes: filtrar+ordenar todo quadro) e com folga de 15%
  // para duas naves à mesma distância não ficarem trocando o som (cada troca recriava ~12 nós de áudio)
  humT -= dt;
  if (humT <= 0) {
    humT = 0.25;
    _near.length = 0;
    for (const u of ufos) if (u.kind === 'ufo' && isAlive(u)) { u._hd = u.pos.distanceToSquared(camPos); _near.push(u); }
    for (const h of humSlots) if (isAlive(h.u)) h.u._hd *= 0.72;   // quem já toca tem preferência
    _near.sort((a, b) => a._hd - b._hd);
    if (_near.length > 4) _near.length = 4;
    for (let i = humSlots.length - 1; i >= 0; i--) { const h = humSlots[i]; if (!_near.includes(h.u)) { h.l.stop(0.3); humSlots.splice(i, 1); } }
    for (const u of _near) if (!humSlots.some(q => q.u === u)) humSlots.push({ u, l: loop('ufoHum', { pos: u.pos, vol: 0.5 }) });
  }
  for (const h of humSlots) {
    const u = h.u;
    h.l.setPos(u.pos);
    h.l.setPitch(0.8 + 0.4 / Math.max(0.6, u.scaleW) + (u.state === 'dive' ? 0.6 : 0));
  }
}
export function stopAllHums() { for (const h of humSlots) h.l.stop(0.2); humSlots = []; }

// =============================================================================
// PROJÉTEIS INIMIGOS (instanciados)
// =============================================================================
const EP_DEF = {
  goo:    { geo: new THREE.IcosahedronGeometry(0.12, 1), mat: new THREE.MeshBasicMaterial({ color: 0x8aff3a }), dmg: 18, label: tr('GOSMA!', 'GOO!', 'LIMA!'), css: '#8aff3a', hex: 0x8aff3a, r: 0.36, glowHex: 0x60ff20, glowS: 0.7 },
  plasma: { geo: new THREE.IcosahedronGeometry(0.08, 1), mat: new THREE.MeshBasicMaterial({ color: 0xff8090 }), dmg: 10, label: 'PLASMA!', css: '#ff5060', hex: 0xff5060, r: 0.32, glowHex: 0xff2040, glowS: 0.55 },
  bomb:   { geo: bakeWith(g => { sph(g, 0.17, 0x2a2a30, 0, 0, 0, 12, 10); for (let k = 0; k < 4; k++) { const f = box(g, 0.02, 0.12, 0.1, 0xb02010, Math.cos(k * 1.57) * 0.08, 0.2, Math.sin(k * 1.57) * 0.08); f.rotation.y = k * 1.57; } cyl(g, 0.03, 0.03, 0.08, 6, 0x806040, 0, 0.18, 0); }), mat: toon({ ramp: 3 }), dmg: 28, label: tr('BOMBA!', 'BOMB!', 'POMMI!'), css: '#ff8030', hex: 0xff8030, r: 0.42, glowHex: 0xff6020, glowS: 0.6 },
};
export { EP_DEF };
const epMesh = {};
for (const k of Object.keys(EP_DEF)) {
  const m = new THREE.InstancedMesh(EP_DEF[k].geo, EP_DEF[k].mat, 40);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.frustumCulled = false;
  scene.add(m); epMesh[k] = m;
}
const TARGET_RING_MAT = new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
const ringPool = [];
function getRing() {
  let r = ringPool.find(q => !q.visible);
  if (!r) { r = new THREE.Mesh(GROUND_RING_GEO, TARGET_RING_MAT); scene.add(r); ringPool.push(r); }
  r.visible = true;
  return r;
}

export function fireEnemy(type, from, spread = 0) {
  const g = { type, pos: new THREE.Vector3().copy(from), vel: new THREE.Vector3(), life: 0, c: null, ring: null, groundY: 0, rot: rand(0, 6), dead: false };
  g.c = g.pos;
  if (type === 'bomb') {
    // cai reto: o anel vermelho no chão mostra onde vai explodir
    g.vel.set(0, -0.5, 0);
    g.groundY = groundHeightAt(from.x, from.z);
    g.ring = getRing();
    g.ring.position.set(from.x, g.groundY + 0.06, from.z);
    g.ring.scale.setScalar(3.2);
    sfx('bombDrop', { pos: from });
  } else {
    const dir = t4.copy(camPos).sub(from).normalize();
    if (spread) { dir.x += rand(-1, 1) * spread; dir.y += rand(-1, 1) * spread * 0.5; dir.z += rand(-1, 1) * spread; dir.normalize(); }
    const speed = type === 'goo' ? 5 + Math.min(G.wave, 12) * 0.32 : 8 + Math.min(G.wave, 12) * 0.25;
    g.vel.copy(dir).multiplyScalar(speed);
    sfx(type === 'goo' ? 'gooFire' : 'plasma', { pos: from });
  }
  eproj.push(g);
  return g;
}
function killEproj(g) { g.dead = true; if (g.ring) { g.ring.visible = false; g.ring = null; } }
export function destroyEproj(g, byPlayer) {
  if (g.dead) return;
  killEproj(g);
  const E = EP_DEF[g.type];
  sparks(g.pos, E.hex, 12, 3, 0.07, 0.5);
  if (byPlayer) { addScore(50, g.pos, '+50', E.css, 0.8); sfx('eggSplat', { pos: g.pos }); }
}
function bombExplode(g) {
  const p = g.pos;
  fireball(p, 1.1); blast(p, 2.2, 0xff6020); sfx('explosionSmall', { pos: p }); pulseAll(0.5, 120);
  const rp = rig.position;
  if (Math.hypot(rp.x - p.x, rp.z - p.z) < 2.0 && Math.abs(camPos.y - p.y) < 3) damagePlayer(EP_DEF.bomb.dmg, EP_DEF.bomb.label, EP_DEF.bomb.css);
  for (const ck of chickens) if (Math.hypot(ck.pos.x - p.x, ck.pos.z - p.z) < 2.5) scareChicken(ck, p);
}
function hitPlayerBy(type) {
  if (type === 'goo') gooHitPlayer();
  else damagePlayer(EP_DEF[type].dmg, EP_DEF[type].label, EP_DEF[type].css);
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3();
export function updateEproj(dt, edt) {
  for (const g of eproj) {
    if (g.dead) continue;
    const E = EP_DEF[g.type], mp = g.pos;
    g.life += edt; g.rot += edt * 4;
    if (g.type === 'bomb') {
      g.vel.y -= 9.8 * edt;
      mp.addScaledVector(g.vel, edt);
      if (g.ring) g.ring.scale.setScalar(3.2 * (0.85 + 0.15 * Math.sin(G.time * 14)));
      if (Math.random() < 0.6) { _c.setHex(0xff8030); fxAdd.spawn(mp.x, mp.y + 0.2, mp.z, 0, 0.5, 0, _c, 0.08, 0.3); }
      if (mp.y <= g.groundY + 0.15 || mp.distanceTo(camPos) < 0.6) { killEproj(g); bombExplode(g); }
      continue;
    }
    mp.addScaledVector(g.vel, edt);
    if (g.type === 'goo') { if (Math.random() < 0.6) { _c.setHex(0x70e030); fxAlpha.spawn(mp.x, mp.y, mp.z, 0, -0.3, 0, _c, 0.09, 0.5, 0, 0, -0.5, 0.8, SHAPE.solid); } }
    else if (Math.random() < 0.8) { _c.setHex(0xff4050); fxAdd.spawn(mp.x, mp.y, mp.z, 0, 0, 0, _c, 0.08, 0.15); }
    if (mp.distanceTo(camPos) < 0.55) { killEproj(g); hitPlayerBy(g.type); continue; }
    if (g.life > 9 || mp.y < -0.5) { killEproj(g); sparks(mp, E.hex, 6, 2); }
  }
  for (let i = eproj.length - 1; i >= 0; i--) if (eproj[i].dead) eproj.splice(i, 1);
  // desenho
  const n = { goo: 0, plasma: 0, bomb: 0 };
  for (const g of eproj) {
    const E = EP_DEF[g.type];
    const sq = g.type === 'goo' ? 1 + Math.sin(g.life * 14) * 0.12 : 1;
    _m4.compose(g.pos, _q.setFromEuler(_e.set(g.rot, g.rot * 0.7, 0)), _s.set(sq, 2 - sq, sq));
    epMesh[g.type].setMatrixAt(n[g.type]++, _m4);
    glow(g.pos.x, g.pos.y, g.pos.z, E.glowS, E.glowHex, 0.9);
  }
  for (const k of Object.keys(epMesh)) { epMesh[k].count = n[k]; epMesh[k].instanceMatrix.needsUpdate = true; }
}

// =============================================================================
// CAIXAS DE POWER-UP (paraquedas) — atire para pegar
// =============================================================================
export const CRATE_CY = 0.5, CRATE_RX = 0.8, CRATE_RY = 1.0;
const CRATE_GEO = new THREE.BoxGeometry(0.42, 0.42, 0.42);
const crateKit = {};
function kitFor(type) {
  if (crateKit[type]) return crateKit[type];
  const Pw = POWERS[type];
  const mat = toon({ vertexColors: false, color: 0xffffff, ramp: 3 });
  const crateMat = new THREE.MeshToonMaterial({
    gradientMap: mat.gradientMap,
    map: canvasTex(128, 128, (x, w, h) => {
      x.fillStyle = '#' + new THREE.Color(Pw.color).getHexString(); x.fillRect(0, 0, w, h);
      x.strokeStyle = '#3a2410'; x.lineWidth = 12; x.strokeRect(6, 6, w - 12, h - 12);
      x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 4; x.strokeRect(16, 16, w - 32, h - 32);
      x.font = '70px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(Pw.icon, 64, 70);
    }),
  });
  const canopy = bakeWith(g => {
    const c = add(g, new THREE.SphereGeometry(0.62, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2.2), Pw.color, 0, 0.78, 0);
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; const s = sph(g, 0.06, k % 2 ? 0xffffff : Pw.color, Math.cos(a) * 0.55, 0.86, Math.sin(a) * 0.55, 6, 4); s.scale.set(1.4, 0.6, 1.4); }
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const st = cyl(g, 0.006, 0.006, 0.75, 4, 0x302010, sx * 0.3, 0.52, sz * 0.3);
      st.rotation.z = -sx * 0.38; st.rotation.x = sz * 0.38;
    }
  });
  return (crateKit[type] = { crateMat, canopy, canopyMat: toon({ ramp: 3, side: THREE.DoubleSide }) });
}
function add(g, geo, hex, x, y, z) { const m = new THREE.Mesh(geo); m.userData.c = hex; m.position.set(x, y, z); g.add(m); return m; }
export function spawnCrate(type, pos) {
  const k = kitFor(type);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(CRATE_GEO, k.crateMat));
  const can = new THREE.Mesh(k.canopy, k.canopyMat); g.add(can);
  g.position.set(clamp(pos.x, -8, 8), Math.max(3.5, pos.y), clamp(pos.z, 2.5, 16));
  scene.add(g);
  crates.push({ group: g, can, type, landed: false, landT: 0, phase: rand(0, 6), c: g.position.clone().setY(g.position.y + CRATE_CY), pos: g.position });
  sfx('crateSpawn', { pos: g.position });
}
export function removeCrate(cr) {
  const i = crates.indexOf(cr);
  if (i >= 0) crates.splice(i, 1);
  scene.remove(cr.group);
}
export function updateCrates(dt, edt) {
  for (let i = crates.length - 1; i >= 0; i--) {
    const cr = crates[i], g = cr.group;
    cr.phase += dt;
    if (!cr.landed) {
      g.position.y -= 0.85 * edt;
      g.rotation.z = Math.sin(cr.phase * 1.5) * 0.15;
      g.rotation.y += dt * 0.6;
      if (g.position.y <= 0.21) { g.position.y = 0.21; cr.landed = true; g.rotation.z = 0; cr.can.visible = false; smoke(g.position, 3, 0xc8b8a0, 0.3, 0.8, 0.3); }
    } else {
      cr.landT += dt;
      g.visible = cr.landT < 3.5 || Math.floor(cr.landT * 8) % 2 === 0;
      if (cr.landT > 5.5) { smoke(g.position, 4, 0xcccccc, 0.3, 0.8); removeCrate(cr); continue; }
    }
    cr.c.copy(g.position); cr.c.y += cr.landed ? 0.2 : CRATE_CY;
    const P = POWERS[cr.type];
    glow(g.position.x, g.position.y, g.position.z, 1.1 + Math.sin(cr.phase * 5) * 0.15, P.color, 0.7);
    if (Math.random() < dt * 4) twinkle(g.position, P.color, 1, 0.4, 0.1, 0.6);
    blob(g.position.x, 0, g.position.z, 0.7 * Math.max(0.3, 1 - g.position.y / 10));
  }
}
