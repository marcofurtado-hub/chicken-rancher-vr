// =============================================================================
// GALINHAS — as "vidas" do rancho.
// Desenho por instâncias: cada PARTE (corpo, cabeça, asas, pernas, detalhes) é um
// InstancedMesh compartilhado por todas as galinhas. 12 galinhas ≈ 13 draw calls.
// =============================================================================
import { THREE, scene, camPos, toon, outlineMat, outlineGeo, bakeWith, sph, cone, cyl, box, ico, canvasTex } from './render.js';
import { G, clamp, rand, pick, tmpV, MAX_CHICKENS } from './core.js';
import { CHICKEN_KINDS, HEN_SKINS } from './config.js';
import { fxAdd, feathers, blob, SHAPE, sparks, popup } from './fx.js';
import { sfx } from './audio.js';
import { YARD, obstacleAt } from './world.js';

const [t0, t1] = tmpV(2);
const _c = new THREE.Color();
const WHITE = 0xffffff;

// ---------- Geometrias (cores claras = tingidas pela instância; detalhes = cores reais) ----------
// Adulto (galinha, galo, de ouro)
const ADULT = {
  body: bakeWith(g => {
    const b = sph(g, 0.17, WHITE, 0, 0.25, 0, 16, 12); b.scale.set(1, 0.9, 1.22);
    const breast = sph(g, 0.12, WHITE, 0, 0.27, 0.1, 12, 10); breast.scale.set(1, 1, 0.9);
    const tail = cone(g, 0.09, 0.2, 8, WHITE, 0, 0.36, -0.19); tail.rotation.x = -0.75;
  }),
  head: bakeWith(g => { sph(g, 0.1, WHITE, 0, 0, 0, 14, 10); }),
  wing: bakeWith(g => { const w = sph(g, 0.1, WHITE, 0, -0.04, -0.02, 10, 8); w.scale.set(0.38, 0.95, 1.45); }),
  pivotHead: new THREE.Vector3(0, 0.43, 0.15),
  pivotWing: new THREE.Vector3(0.155, 0.3, -0.01),
  pivotLeg: new THREE.Vector3(0.06, 0.13, 0.02),
};
// Pintinho
const CHICK = {
  body: bakeWith(g => { const b = sph(g, 0.14, WHITE, 0, 0.16, 0, 14, 10); b.scale.set(1, 0.95, 1.1); }),
  head: bakeWith(g => { sph(g, 0.105, WHITE, 0, 0, 0, 14, 10); }),
  wing: ADULT.wing,
  pivotHead: new THREE.Vector3(0, 0.32, 0.05),
  pivotWing: new THREE.Vector3(0.125, 0.19, 0),
  pivotLeg: new THREE.Vector3(0.05, 0.06, 0.01),
};
function eyes(g, x, y, z, r) {
  for (const sx of [-1, 1]) {
    sph(g, r, 0xffffff, sx * x, y, z, 10, 8);
    sph(g, r * 0.62, 0x14101a, sx * (x + r * 0.15), y, z + r * 0.55, 8, 6);
    sph(g, r * 0.2, 0xffffff, sx * (x + r * 0.05), y + r * 0.3, z + r * 0.95, 6, 4);
  }
}
const DETAIL = {
  hen: bakeWith(g => {
    for (let k = -1; k <= 1; k++) sph(g, 0.032 - Math.abs(k) * 0.006, 0xe8283a, 0, 0.1 - Math.abs(k) * 0.012, k * 0.035, 8, 6);
    sph(g, 0.024, 0xd8202e, 0, -0.07, 0.07, 8, 6);
    const bk = cone(g, 0.03, 0.07, 8, 0xffaa1e, 0, -0.015, 0.11); bk.rotation.x = Math.PI / 2;
    eyes(g, 0.052, 0.025, 0.065, 0.026);
  }),
  rooster: bakeWith(g => {
    for (let k = -2; k <= 2; k++) sph(g, 0.04 - Math.abs(k) * 0.006, 0xff1a2a, 0, 0.12 - Math.abs(k) * 0.016, k * 0.034, 8, 6);
    const w = sph(g, 0.034, 0xe0182a, 0, -0.085, 0.07, 8, 6); w.scale.set(0.8, 1.4, 0.8);
    const bk = cone(g, 0.032, 0.08, 8, 0xffaa1e, 0, -0.015, 0.115); bk.rotation.x = Math.PI / 2;
    eyes(g, 0.052, 0.03, 0.065, 0.026);
  }),
  chick: bakeWith(g => {
    const bk = cone(g, 0.026, 0.055, 8, 0xff8a10, 0, -0.02, 0.11); bk.rotation.x = Math.PI / 2;
    eyes(g, 0.048, 0.025, 0.075, 0.027);
    sph(g, 0.02, 0xfff3a0, 0, 0.1, 0.01, 6, 4);
  }),
};
const ROOSTER_TAIL = bakeWith(g => {
  const cols = [0x1d5a3c, 0x2a2468, 0x1d5a3c, 0x3a2a70, 0x1d5a3c];
  for (let k = 0; k < 5; k++) {
    const f = sph(g, 0.06, cols[k], (k - 2) * 0.035, 0.46 + Math.abs(k - 2) * -0.02, -0.25, 8, 6);
    f.scale.set(0.45, 2.4, 0.8); f.rotation.x = -0.55; f.rotation.z = (k - 2) * 0.28;
  }
});
const LEG = bakeWith(g => {
  cyl(g, 0.014, 0.012, 0.12, 6, 0xf28c18, 0, -0.06, 0);
  for (const a of [-0.5, 0, 0.5]) { const t = box(g, 0.012, 0.012, 0.06, 0xf28c18, Math.sin(a) * 0.025, -0.12, 0.022 + Math.cos(a) * 0.012); t.rotation.y = a; }
});

// ---------- InstancedMesh por parte ----------
const SKIN_MAT = toon({ ramp: 4 });
const DETAIL_MAT = toon({ ramp: 3 });
const OUTLINE = outlineMat(0.011, 0x24161c);
function im(geo, mat, n, order = 0) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.count = 0; m.frustumCulled = false; m.renderOrder = order;
  m.setColorAt(0, _c.setHex(0xffffff));
  scene.add(m);
  return m;
}
const MAXC = MAX_CHICKENS + 2;
const IM = {
  adultBody: im(ADULT.body, SKIN_MAT, MAXC), adultHead: im(ADULT.head, SKIN_MAT, MAXC),
  adultBodyOut: im(outlineGeo(ADULT.body), OUTLINE, MAXC), adultHeadOut: im(outlineGeo(ADULT.head), OUTLINE, MAXC),
  chickBody: im(CHICK.body, SKIN_MAT, MAXC), chickHead: im(CHICK.head, SKIN_MAT, MAXC),
  chickBodyOut: im(outlineGeo(CHICK.body), OUTLINE, MAXC), chickHeadOut: im(outlineGeo(CHICK.head), OUTLINE, MAXC),
  wing: im(ADULT.wing, SKIN_MAT, MAXC * 2), leg: im(LEG, DETAIL_MAT, MAXC * 2),
  henDetail: im(DETAIL.hen, DETAIL_MAT, MAXC), roosterDetail: im(DETAIL.rooster, DETAIL_MAT, MAXC),
  chickDetail: im(DETAIL.chick, DETAIL_MAT, MAXC), roosterTail: im(ROOSTER_TAIL, DETAIL_MAT, MAXC),
};
const ALL_IM = Object.values(IM);

// "!" de alerta e bolha do escudo de penas: poucos, então sprites/malhas normais
const ALERT_MAT = new THREE.SpriteMaterial({
  map: canvasTex(64, 64, x => {
    x.fillStyle = '#ff3a3a'; x.beginPath(); x.arc(32, 32, 28, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#fff'; x.lineWidth = 5; x.stroke();
    x.fillStyle = '#fff'; x.font = 'bold 44px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('!', 32, 35);
  }), depthTest: false, transparent: true,
});
const SHIELD_GEO = new THREE.IcosahedronGeometry(1, 2);
const SHIELD_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

// ---------- Estado ----------
export const chickens = [];
let skinCounter = 0;

export function pickChickenTarget(out = new THREE.Vector3()) {
  if (G.waveDef && G.waveDef.close && (G.state === 'playing' || G.state === 'wave_intro')) return out.set(rand(-2.5, 2.5), 0, rand(2.5, 5.5));
  for (let k = 0; k < 8; k++) {
    out.set(rand(YARD.minX, YARD.maxX), 0, rand(YARD.minZ + 0.5, YARD.maxZ - 0.5));
    if (!obstacleAt(out.x, out.z, 0.5)) break;
  }
  return out;
}

export function spawnChicken(kind, x, z, y = 0) {
  const K = CHICKEN_KINDS[kind];
  let skin, wing;
  if (kind === 'rooster') { skin = 0xc8642c; wing = 0x7a3618; }
  else if (kind === 'chick') { skin = 0xffe46a; wing = 0xf5cc48; }
  else if (kind === 'golden') { skin = 0xffc830; wing = 0xf0a818; }
  else { const s = HEN_SKINS[skinCounter++ % HEN_SKINS.length]; skin = s[0]; wing = s[1]; }
  const alert = new THREE.Sprite(ALERT_MAT);
  alert.scale.setScalar(0.24); alert.visible = false; alert.renderOrder = 980;
  scene.add(alert);
  const c = {
    kind, K, skin: new THREE.Color(skin), wingCol: new THREE.Color(wing),
    pos: new THREE.Vector3(x, y, z), yaw: Math.random() * Math.PI * 2, tilt: 0, roll: 0,
    state: y > 0.05 ? 'safe' : 'wandering', target: pickChickenTarget(), statePhase: rand(1, 4),
    walk: rand(0, 6), headBob: 0, headPitch: 0, headYaw: 0, flap: 0, flapT: 0, legSwing: 0,
    lookT: rand(1, 3), lookYaw: 0, pecker: 0,
    fallVel: 0, scaredVel: new THREE.Vector3(), scaredT: 0, fleeT: 0, fleeCD: rand(0, 2), fleeFrom: new THREE.Vector3(),
    abductor: null, waves: 0, sparkT: 0, squash: 0, alert, shield: false, shieldHits: 0, shieldMesh: null, removed: false,
  };
  chickens.push(c);
  return c;
}
export function removeChicken(c) {
  c.removed = true;
  scene.remove(c.alert);
  if (c.shieldMesh) scene.remove(c.shieldMesh);
  const i = chickens.indexOf(c);
  if (i >= 0) chickens.splice(i, 1);
}
export function clearChickens() { for (const c of chickens.slice()) removeChicken(c); }
export const INITIAL_FLOCK = [['hen', -3.2, 5], ['hen', 2.5, 4], ['hen', -1, 8], ['hen', 4, 11], ['rooster', -4, 12], ['golden', 1.5, 9.5], ['chick', 0.5, 6]];
export function spawnInitialFlock() { for (const [k, x, z] of INITIAL_FLOCK) spawnChicken(k, x, z); }
export const chickensAlive = () => { let n = 0; for (const c of chickens) if (c.state !== 'gone') n++; return n; };
export function flockCounts() {
  const k = { hen: 0, rooster: 0, chick: 0, golden: 0 };
  for (const c of chickens) if (c.state !== 'gone') k[c.kind]++;
  return k;
}
export function cluckFor(c) { sfx(c.kind === 'chick' ? 'chirp' : c.kind === 'rooster' && Math.random() < 0.3 ? 'crow' : 'cluck', { pos: c.pos, pitch: rand(0.9, 1.15) }); }

/** Centro do corpo (alvo do feixe, ponto de agarrar). */
export function chickenCenter(c, out) { return out.set(c.pos.x, c.pos.y + 0.25 * c.K.scale, c.pos.z); }

export function scareChicken(c, fromPos) {
  if (c.state === 'gone' || c.state === 'abducting' || c.state === 'scared' || c.state === 'safe') return;
  c.state = 'scared'; c.scaredT = 0;
  const dx = c.pos.x - fromPos.x, dz = c.pos.z - fromPos.z;
  const m = Math.hypot(dx, dz) || 1;
  c.scaredVel.set(dx / m * 2.4, 3.2, dz / m * 2.4);
  feathers(t0.copy(c.pos).setY(0.2), 3, c.skin.getHex());
  sfx('henPanic', { pos: c.pos, pitch: rand(0.9, 1.2) });
}
export function setChickenShield(c, on) {
  c.shield = on;
  if (on && !c.shieldMesh) { c.shieldMesh = new THREE.Mesh(SHIELD_GEO, SHIELD_MAT); scene.add(c.shieldMesh); }
  if (c.shieldMesh) c.shieldMesh.visible = on;
}
export function respawnChicken(kind) {
  const c = spawnChicken(kind, rand(-6, 6), rand(3, 14), 12);
  c.state = 'safe'; c.fallVel = 0;
  return c;
}

function clampYard(p) {
  p.x = clamp(p.x, YARD.minX - 0.5, YARD.maxX + 0.5);
  p.z = clamp(p.z, YARD.minZ - 0.5, YARD.maxZ + 0.5);
}
function faceToward(c, dx, dz, dt, k = 10) {
  const target = Math.atan2(dx, dz);
  let d = target - c.yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  c.yaw += d * Math.min(1, dt * k);
}

// ---------- Comportamento ----------
export function updateChickens(dt, ufos) {
  for (const c of chickens) {
    if (c.state === 'gone') continue;
    const K = c.K, p = c.pos;
    c.fleeCD -= dt;
    // Fugir quando uma nave mira nela
    if ((c.state === 'wandering' || c.state === 'pecking') && !(G.waveDef && G.waveDef.close) && c.fleeCD <= 0) {
      for (const u of ufos) {
        if (u.removed || u.target !== c || u.state !== 'descending') continue;
        const dx = u.pos.x - p.x, dz = u.pos.z - p.z;
        if (dx * dx + dz * dz < 49 && u.pos.y < 10) {
          c.state = 'fleeing'; c.fleeT = 2.2; c.fleeCD = 4.5;
          c.fleeFrom.set(u.pos.x, 0, u.pos.z);
          sfx('henPanic', { pos: p, pitch: rand(0.95, 1.2) });
          break;
        }
      }
    }
    let threatened = c.state === 'fleeing';
    if (!threatened && c.state !== 'abducting') {
      for (const u of ufos) if (!u.removed && u.target === c && (u.state === 'descending' || u.state === 'swoop') && u.pos.y < 12) { threatened = true; break; }
    }
    c.alert.visible = threatened && c.state !== 'abducting';
    if (c.alert.visible) { c.alert.position.set(p.x, p.y + 0.75 * K.scale + Math.sin(G.time * 10) * 0.03, p.z); }

    // alvos de animação (amortecidos no fim)
    let flapTarget = 0, legAmp = 0, headPitch = 0;
    if (c.state === 'wandering') {
      t0.copy(c.target).sub(p); t0.y = 0;
      const dist = t0.length();
      if (dist < 0.3) { c.state = 'pecking'; c.statePhase = rand(1.5, 3.5); c.pecker = 0; }
      else {
        t0.divideScalar(dist);
        p.addScaledVector(t0, K.speed * dt);
        if (obstacleAt(p.x, p.z, 0.2)) { p.addScaledVector(t0, -K.speed * dt); pickChickenTarget(c.target); }
        faceToward(c, t0.x, t0.z, dt, 6);
        c.walk += dt * 9;
        legAmp = 0.6;
        headPitch = Math.sin(c.walk * 2) * 0.12;
        if (Math.random() < 0.0012) cluckFor(c);
      }
    } else if (c.state === 'pecking') {
      c.pecker += dt;
      const pk = (c.pecker * 3.2) % 1;
      headPitch = Math.max(0, Math.sin(pk * Math.PI * 2)) * 1.1;
      c.lookT -= dt;
      if (c.lookT <= 0) { c.lookT = rand(0.8, 2.5); c.lookYaw = rand(-0.7, 0.7); }
      c.statePhase -= dt;
      if (c.statePhase <= 0) { c.state = 'wandering'; pickChickenTarget(c.target); if (Math.random() < 0.3) cluckFor(c); }
    } else if (c.state === 'fleeing') {
      t0.set(p.x - c.fleeFrom.x, 0, p.z - c.fleeFrom.z);
      if (t0.lengthSq() < 1e-4) t0.set(rand(-1, 1), 0, rand(-1, 1));
      t0.normalize();
      p.addScaledVector(t0, K.flee * dt);
      clampYard(p);
      faceToward(c, t0.x, t0.z, dt, 14);
      c.walk += dt * 18;
      legAmp = 1; flapTarget = 0.7; headPitch = -0.3;
      c.fleeT -= dt;
      if (c.fleeT <= 0) { c.state = 'wandering'; pickChickenTarget(c.target); }
    } else if (c.state === 'abducting') {
      flapTarget = 1.2;
      c.yaw += dt * 3;
      c.walk += dt * 22; legAmp = 1.2;
      if (Math.random() < dt * 3) feathers(p, 1, c.kind === 'golden' ? 0xffd040 : c.skin.getHex());
    } else if (c.state === 'scared') {
      c.scaredT += dt;
      c.scaredVel.y -= 9.8 * dt;
      p.addScaledVector(c.scaredVel, dt);
      if (p.y <= 0) { p.y = 0; c.scaredVel.y = Math.max(0, c.scaredVel.y); c.scaredVel.x *= 0.85; c.scaredVel.z *= 0.85; }
      flapTarget = 1.1; legAmp = 0.8; c.walk += dt * 20;
      clampYard(p);
      if (c.scaredT > 1.4) { c.state = 'wandering'; pickChickenTarget(c.target); }
    } else if (c.state === 'safe') {
      // desce planando (resgatada ou caindo do céu)
      c.fallVel = Math.min(c.fallVel + 9.8 * dt, 1.8);
      p.y -= c.fallVel * dt;
      c.yaw += dt * 2;
      flapTarget = 1.3;
      if (p.y <= 0) {
        p.y = 0; c.state = 'wandering'; pickChickenTarget(c.target); c.squash = 1;
        cluckFor(c);
      }
    }
    // amortece animações
    c.flapT += dt * (flapTarget > 0 ? 24 : 0);
    c.flap += (flapTarget - c.flap) * Math.min(1, dt * 10);
    c.legSwing += (legAmp - c.legSwing) * Math.min(1, dt * 10);
    c.headPitch += (headPitch - c.headPitch) * Math.min(1, dt * 14);
    c.headYaw += ((c.state === 'pecking' ? c.lookYaw : 0) - c.headYaw) * Math.min(1, dt * 6);
    c.squash = Math.max(0, c.squash - dt * 4);

    if (c.kind === 'golden') {
      c.sparkT -= dt;
      if (c.sparkT <= 0) {
        c.sparkT = 0.16; _c.setHex(0xffe060);
        fxAdd.spawn(p.x + rand(-0.2, 0.2), p.y + rand(0.1, 0.5), p.z + rand(-0.2, 0.2), 0, 0.4, 0, _c, 0.06, 0.7, 0, 0, -0.5, 1, SHAPE.star, 2);
      }
    }
    if (c.shieldMesh && c.shield) { c.shieldMesh.position.set(p.x, p.y + 0.28 * K.scale, p.z); c.shieldMesh.scale.setScalar(0.42 * K.scale * (1 + Math.sin(G.time * 5) * 0.04)); }
    blob(p.x, 0, p.z, 0.55 * K.scale * Math.max(0.3, 1 - p.y / 7));
  }
}

// ---------- Desenho (monta as matrizes das partes) ----------
const _root = new THREE.Matrix4(), _loc = new THREE.Matrix4(), _out = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
function put(mesh, idx, m, col) { mesh.setMatrixAt(idx, m); if (col) mesh.setColorAt(idx, col); }
export function drawChickens() {
  const n = { ab: 0, cb: 0, w: 0, l: 0, hd: 0, rd: 0, cd: 0, rt: 0 };
  for (const c of chickens) {
    if (c.state === 'gone') continue;
    const adult = c.kind !== 'chick', S = adult ? ADULT : CHICK, s = c.K.scale;
    // raiz: posição, giro, achatamento ao pousar e balanço do passo
    const bob = Math.abs(Math.sin(c.walk)) * 0.025 * c.legSwing;
    const sq = 1 - c.squash * 0.25;
    _q.setFromEuler(_e.set(Math.sin(c.walk * 2) * 0.04 * c.legSwing, c.yaw, Math.sin(c.walk) * 0.06 * c.legSwing));
    _root.compose(_p.set(c.pos.x, c.pos.y + bob, c.pos.z), _q, _s.set(s * (2 - sq), s * sq, s * (2 - sq)));
    // corpo
    if (adult) { put(IM.adultBody, n.ab, _root, c.skin); put(IM.adultBodyOut, n.ab, _root); }
    else { put(IM.chickBody, n.cb, _root, c.skin); put(IM.chickBodyOut, n.cb, _root); }
    if (c.kind === 'rooster') put(IM.roosterTail, n.rt++, _root);
    // cabeça
    _loc.compose(S.pivotHead, _q.setFromEuler(_e.set(c.headPitch, c.headYaw, 0)), _s.set(1, 1, 1));
    _out.multiplyMatrices(_root, _loc);
    if (adult) { put(IM.adultHead, n.ab, _out, c.skin); put(IM.adultHeadOut, n.ab, _out); n.ab++; }
    else { put(IM.chickHead, n.cb, _out, c.skin); put(IM.chickHeadOut, n.cb, _out); n.cb++; }
    if (c.kind === 'chick') put(IM.chickDetail, n.cd++, _out);
    else if (c.kind === 'rooster') put(IM.roosterDetail, n.rd++, _out);
    else put(IM.henDetail, n.hd++, _out);
    // asas (batem com c.flap)
    const flapA = c.flap * (0.6 + Math.sin(c.flapT) * 0.6);
    for (const sx of [-1, 1]) {
      _loc.compose(_p.set(S.pivotWing.x * sx, S.pivotWing.y, S.pivotWing.z), _q.setFromEuler(_e.set(0, 0, -sx * flapA)), _s.set(adult ? 1 : 0.75, adult ? 1 : 0.75, adult ? 1 : 0.75));
      _out.multiplyMatrices(_root, _loc);
      put(IM.wing, n.w++, _out, c.wingCol);
      // pernas (alternam no passo)
      const swing = Math.sin(c.walk + (sx > 0 ? Math.PI : 0)) * 0.7 * c.legSwing;
      _loc.compose(_p.set(S.pivotLeg.x * sx, S.pivotLeg.y, S.pivotLeg.z), _q.setFromEuler(_e.set(swing, 0, 0)), _s.set(1, adult ? 1 : 0.55, 1));
      _out.multiplyMatrices(_root, _loc);
      put(IM.leg, n.l++, _out);
    }
  }
  IM.adultBody.count = IM.adultBodyOut.count = IM.adultHead.count = IM.adultHeadOut.count = n.ab;
  IM.chickBody.count = IM.chickBodyOut.count = IM.chickHead.count = IM.chickHeadOut.count = n.cb;
  IM.wing.count = n.w; IM.leg.count = n.l;
  IM.henDetail.count = n.hd; IM.roosterDetail.count = n.rd; IM.chickDetail.count = n.cd; IM.roosterTail.count = n.rt;
  for (const m of ALL_IM) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
}
