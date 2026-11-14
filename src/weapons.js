// =============================================================================
// ARMAS — 11 armas (tudo atira ovo), projéteis instanciados, laser, tesla, rojão
// e a CHUVA DE OVOS (especial carregado pelos abates).
// =============================================================================
import { THREE, scene, camera, camPos, rig, xrActive, isTouch, toon, outlineMat, outlineGeo, bake, bakeWith, add, box, cyl, sph, cone, torus, lathe, UP, placeSegment } from './render.js';
import { G, clamp, rand, pick, tmpV, playing } from './core.js';
import { tr } from './i18n.js';
import { WEAPONS, WEAPON_ORDER } from './config.js';
import { fxAdd, fxAlpha, sparks, smoke, fireball, muzzle, eggBurst, friedEgg, trailPuff, blast, bolt, seg, glow, popup, popupAhead, randDir, flashScreen, SHAPE, confetti } from './fx.js';
import { sfx, loop, stinger } from './audio.js';
import { ufos, eproj, crates, isAlive, destroyEproj } from './ufos.js';
import { castSegment, applyHit, hitPart, explodeAt, aoeDamage, forEachAimable, uiTargets, hitStop } from './combat.js';
import { chickens, scareChicken } from './chickens.js';
import { CTRL, pulseCtrl, pulseAll, pcAim, pcAimVel } from './player.js';
import { groundHeightAt } from './world.js';

const [t0, t1, t2, t3, t4, t5, t6, t7, t8] = tmpV(9);
const _c = new THREE.Color(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m4 = new THREE.Matrix4(), _s = new THREE.Vector3(), X_AX = new THREE.Vector3(1, 0, 0);
const Z_NEG = new THREE.Vector3(0, 0, -1), Y_POS = new THREE.Vector3(0, 1, 0);
export const MAX_PROJECTILES = 260;
const SHOT_SPEED_FACTOR = 38, MAX_SHOT_SPEED = 24, SLINGSHOT_MIN_PULL = 0.025, CROSSBOW_SPEED = 38, POUCH_GRAB_DIST = 0.32;

// =============================================================================
// MODELOS DAS ARMAS (toon + contorno)
// =============================================================================
const W_MAT = toon({ ramp: 4, emissive: 0x262626 });  // leve brilho próprio: a arma não some à noite
const W_OUT = outlineMat(0.004, 0x140c10);
function weaponMesh(build) {
  const geo = bakeWith(build);
  const m = new THREE.Mesh(geo, W_MAT);
  m.add(new THREE.Mesh(outlineGeo(geo), W_OUT));
  return m;
}
function weaponGroup(build) {
  const g = new THREE.Group();
  g.add(weaponMesh(build));
  g.visible = false; g.userData.kick = 0;
  scene.add(g);
  return g;
}
const EGG_PTS = [[0.001, -0.05], [0.022, -0.046], [0.036, -0.032], [0.044, -0.01], [0.044, 0.01], [0.038, 0.032], [0.026, 0.05], [0.012, 0.062], [0.001, 0.066]];
function eggShape(g, hex, x, y, z, s = 1) { const e = lathe(g, EGG_PTS, 14, hex, x, y, z); e.scale.setScalar(s); return e; }

const slingshot = weaponGroup(g => {
  cyl(g, 0.018, 0.022, 0.12, 10, 0x8a5a30, 0, -0.02, 0);
  cyl(g, 0.025, 0.025, 0.08, 10, 0x3a2414, 0, -0.02, 0);
  const a1 = cyl(g, 0.014, 0.018, 0.13, 8, 0x8a5a30, -0.035, 0.1, 0); a1.rotation.z = 0.3;
  const a2 = cyl(g, 0.014, 0.018, 0.13, 8, 0x8a5a30, 0.035, 0.1, 0); a2.rotation.z = -0.3;
  sph(g, 0.019, 0x5a3418, -0.058, 0.165, 0, 8, 6); sph(g, 0.019, 0x5a3418, 0.058, 0.165, 0, 8, 6);
  for (let k = 0; k < 3; k++) { const r = torus(g, 0.026, 0.004, 4, 10, 0xd84030, 0, -0.06 + k * 0.025, 0); r.rotation.x = Math.PI / 2; }
});
const SL_TIP_L = new THREE.Vector3(-0.058, 0.165, 0), SL_TIP_R = new THREE.Vector3(0.058, 0.165, 0);
const crossbow = weaponGroup(g => {
  box(g, 0.05, 0.06, 0.22, 0x8a5a30, 0, 0, 0.04);
  const gr = box(g, 0.045, 0.13, 0.05, 0x3a2414, 0, -0.08, 0.1); gr.rotation.x = 0.18;
  box(g, 0.026, 0.04, 0.3, 0x50505a, 0, 0.02, -0.1);
  box(g, 0.1, 0.06, 0.06, 0x5a3a1c, 0, 0.01, -0.2);
  const l1 = cyl(g, 0.012, 0.018, 0.22, 8, 0x5a3a1c, -0.13, 0.02, -0.2); l1.rotation.z = Math.PI / 2;
  const l2 = cyl(g, 0.012, 0.018, 0.22, 8, 0x5a3a1c, 0.13, 0.02, -0.2); l2.rotation.z = Math.PI / 2;
  sph(g, 0.019, 0x3a2414, -0.235, 0.02, -0.2, 8, 6); sph(g, 0.019, 0x3a2414, 0.235, 0.02, -0.2, 8, 6);
  box(g, 0.015, 0.03, 0.02, 0x9898a0, 0, -0.04, 0.07);
  sph(g, 0.012, 0xff4040, 0, 0.05, -0.05, 6, 4);
});
const CB_TIP_L = new THREE.Vector3(-0.235, 0.02, -0.2), CB_TIP_R = new THREE.Vector3(0.235, 0.02, -0.2);
function pistolParts(g) {
  const gr = box(g, 0.035, 0.11, 0.045, 0x2a2a34, 0, -0.06, 0.03); gr.rotation.x = 0.25;
  box(g, 0.044, 0.056, 0.17, 0xf5a820, 0, 0, -0.04);
  box(g, 0.046, 0.016, 0.17, 0xffd060, 0, 0.034, -0.04);
  const br = cyl(g, 0.015, 0.015, 0.08, 10, 0x30303a, 0, 0.005, -0.15); br.rotation.x = Math.PI / 2;
  eggShape(g, 0xfffaf0, 0, 0.055, -0.02, 0.6);
  box(g, 0.01, 0.025, 0.015, 0x9090a0, 0, -0.035, 0);
  box(g, 0.008, 0.02, 0.012, 0xff4040, 0, 0.045, -0.11);
}
const pistols = weaponGroup(pistolParts);
const pistolL = weaponGroup(pistolParts);
const shotgun = weaponGroup(g => {
  const gr = box(g, 0.04, 0.13, 0.06, 0x7a5434, 0, -0.06, 0.05); gr.rotation.x = 0.3;
  box(g, 0.06, 0.09, 0.2, 0x7a5434, 0, -0.01, 0.2);
  box(g, 0.076, 0.07, 0.18, 0x34343e, 0, 0.015, 0.04);
  for (const sx of [-1, 1]) { const b = cyl(g, 0.021, 0.021, 0.34, 12, 0x24242c, sx * 0.024, 0.018, -0.18); b.rotation.x = Math.PI / 2; }
  box(g, 0.076, 0.018, 0.04, 0x44444e, 0, 0.018, -0.34);
  box(g, 0.07, 0.04, 0.14, 0x6a4420, 0, -0.012, -0.1);
  for (let k = 0; k < 4; k++) eggShape(g, 0xfffaf0, 0.046, 0.0, 0.0 + k * 0.035, 0.32);
});
const launcher = weaponGroup(g => {
  const t = cyl(g, 0.056, 0.056, 0.42, 14, 0x4a7a3c, 0, 0.02, -0.12); t.rotation.x = Math.PI / 2;
  const r = torus(g, 0.06, 0.013, 6, 16, 0x202020, 0, 0.02, -0.33);
  const dr = cyl(g, 0.066, 0.066, 0.1, 12, 0x8a5a30, 0, -0.035, 0.06); dr.rotation.z = Math.PI / 2;
  const gr = box(g, 0.04, 0.12, 0.05, 0x202020, 0, -0.08, 0.06); gr.rotation.x = 0.2;
  box(g, 0.05, 0.07, 0.16, 0x34482a, 0, 0, 0.17);
  box(g, 0.012, 0.04, 0.02, 0xff4040, 0, 0.09, -0.2);
  const eg = eggShape(g, 0xff8050, 0, 0.02, -0.31, 1); eg.rotation.x = Math.PI / 2;
});
const homing = weaponGroup(g => {
  box(g, 0.12, 0.1, 0.28, 0x5a6478, 0, 0, -0.08);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) { const tb = cyl(g, 0.023, 0.023, 0.06, 10, 0xd84848, sx * 0.03, sy * 0.028, -0.235); tb.rotation.x = Math.PI / 2; }
  const gr = box(g, 0.04, 0.12, 0.05, 0x202020, 0, -0.1, 0.03); gr.rotation.x = 0.2;
  const dish = cone(g, 0.036, 0.03, 12, 0xd0d8e0, 0, 0.08, -0.02); dish.rotation.x = Math.PI;
  cyl(g, 0.006, 0.006, 0.04, 4, 0x808080, 0, 0.065, -0.02);
});
const gatling = new THREE.Group();
const gatlingBarrels = new THREE.Group();
gatling.add(weaponMesh(g => {
  const gr = box(g, 0.045, 0.14, 0.06, 0x14141c, 0, -0.08, 0.04); gr.rotation.x = 0.2;
  box(g, 0.1, 0.1, 0.18, 0x34343e, 0, 0, -0.05);
  const dr = cyl(g, 0.075, 0.075, 0.09, 14, 0xffd040, 0, -0.04, 0.06); dr.rotation.z = Math.PI / 2;
  for (let k = 0; k < 5; k++) eggShape(g, 0xfffaf0, -0.05 + k * 0.025, 0.02, 0.06, 0.35);
  box(g, 0.05, 0.07, 0.18, 0x24242c, 0, 0, 0.16);
}));
gatlingBarrels.add(weaponMesh(br => {
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const b = cyl(br, 0.015, 0.015, 0.36, 8, i === 0 ? 0xc0c0c8 : 0x24242c, Math.cos(a) * 0.045, Math.sin(a) * 0.045, -0.3); b.rotation.x = Math.PI / 2; }
  const c1 = cyl(br, 0.076, 0.076, 0.04, 14, 0xd84030, 0, 0, -0.46); c1.rotation.x = Math.PI / 2;
  const c2 = cyl(br, 0.076, 0.076, 0.04, 14, 0x44444e, 0, 0, -0.13); c2.rotation.x = Math.PI / 2;
}));
gatling.add(gatlingBarrels);
gatling.visible = false; gatling.userData = { spin: 0, kick: 0 };
scene.add(gatling);
const laser = new THREE.Group();
laser.add(weaponMesh(raw => {
  const gr = box(raw, 0.045, 0.14, 0.06, 0x24242c, 0, -0.08, 0.05); gr.rotation.x = 0.18;
  box(raw, 0.06, 0.07, 0.34, 0x283038, 0, 0, -0.05);
  for (let i = 0; i < 4; i++) box(raw, 0.076, 0.02, 0.04, 0x44444e, 0, 0.04, -0.08 - i * 0.05);
  box(raw, 0.05, 0.08, 0.16, 0x34343e, 0, 0, 0.17);
  const e = cyl(raw, 0.035, 0.025, 0.1, 12, 0xffc030, 0, 0, -0.27); e.rotation.x = Math.PI / 2;
}));
const laserCore = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffe060 }));
laserCore.position.z = -0.02; laser.add(laserCore);
const laserRing = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 6, 16), new THREE.MeshBasicMaterial({ color: 0xffeb80 }));
laserRing.position.z = -0.32; laser.add(laserRing);
laser.visible = false; laser.userData = { kick: 0 };
scene.add(laser);
const tesla = new THREE.Group();
tesla.add(weaponMesh(raw => {
  const gr = box(raw, 0.045, 0.13, 0.055, 0x24242c, 0, -0.08, 0.05); gr.rotation.x = 0.2;
  const b = cyl(raw, 0.03, 0.042, 0.24, 12, 0x485468, 0, 0, -0.03); b.rotation.x = Math.PI / 2;
  for (let i = 0; i < 3; i++) torus(raw, 0.048, 0.012, 6, 14, 0xd88a38, 0, 0, -0.07 - i * 0.05);
  for (const sx of [-1, 1]) { const pr = cyl(raw, 0.006, 0.006, 0.12, 4, 0xa0a0a0, sx * 0.03, 0, -0.22); pr.rotation.x = Math.PI / 2; }
  box(raw, 0.05, 0.07, 0.14, 0x34343e, 0, 0, 0.15);
}));
const teslaTip = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 10), new THREE.MeshBasicMaterial({ color: 0x90e8ff }));
teslaTip.position.z = -0.27; tesla.add(teslaTip);
tesla.visible = false; tesla.userData = { kick: 0 };
scene.add(tesla);
const fireworks = weaponGroup(g => {
  const t = cyl(g, 0.05, 0.055, 0.44, 14, 0xe02838, 0, 0.03, -0.14); t.rotation.x = Math.PI / 2;
  for (let k = 0; k < 3; k++) torus(g, 0.056, 0.01, 6, 16, 0xffffff, 0, 0.03, -0.02 - k * 0.12);
  for (let k = 0; k < 8; k++) sph(g, 0.008, pick([0xffd040, 0x40e0ff, 0x8dff4a]), Math.cos(k) * 0.052, 0.03 + Math.sin(k) * 0.052, -0.08 - k * 0.03, 4, 3);
  const tip = cone(g, 0.046, 0.1, 12, 0xffd040, 0, 0.03, -0.41); tip.rotation.x = -Math.PI / 2;
  const gr = box(g, 0.04, 0.12, 0.05, 0x202020, 0, -0.07, 0.04); gr.rotation.x = 0.2;
  box(g, 0.05, 0.07, 0.16, 0x8a5a30, 0, 0, 0.17);
});
const handsGrp = new THREE.Group(); handsGrp.visible = false; scene.add(handsGrp);
const GROUPS = { hands: handsGrp, slingshot, crossbow, pistols, shotgun, launcher, gatling, homing, laser, tesla, fireworks };
const MUZZLE = {
  hands: new THREE.Vector3(0, 0, 0), slingshot: new THREE.Vector3(0, 0.165, 0), crossbow: new THREE.Vector3(0, 0.02, -0.36),
  pistols: new THREE.Vector3(0, 0.005, -0.19), shotgun: new THREE.Vector3(0, 0.018, -0.36), launcher: new THREE.Vector3(0, 0.02, -0.36),
  gatling: new THREE.Vector3(0, 0, -0.48), homing: new THREE.Vector3(0, 0, -0.27), laser: new THREE.Vector3(0, 0, -0.34), tesla: new THREE.Vector3(0, 0, -0.3), fireworks: new THREE.Vector3(0, 0.03, -0.46),
};

// Ovos nas mãos, saquinho e elásticos do estilingue
const HAND_EGG_GEO = bakeWith(g => eggShape(g, 0xfffaf0, 0, 0, 0, 1));
const handEggL = new THREE.Mesh(HAND_EGG_GEO, W_MAT), handEggR = new THREE.Mesh(HAND_EGG_GEO, W_MAT);
handEggL.visible = handEggR.visible = false; scene.add(handEggL); scene.add(handEggR);
const pouchMesh = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.026, 0.026), toon({ color: 0x4a2a14, vertexColors: false }));
pouchMesh.visible = false; scene.add(pouchMesh);
const pebbleMesh = new THREE.Mesh(HAND_EGG_GEO, W_MAT); pebbleMesh.visible = false; scene.add(pebbleMesh);
// contorno preto também no ovo da mão (e no ovo do estilingue/besta), igual às armas e aos ovos arremessados
const HAND_EGG_OUT = outlineGeo(HAND_EGG_GEO);
for (const m of [handEggL, handEggR, pebbleMesh]) m.add(new THREE.Mesh(HAND_EGG_OUT, W_OUT));
const elasticMat = toon({ color: 0xc83828, vertexColors: false });
const UNIT_CYL = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
const elasticL = new THREE.Mesh(UNIT_CYL, elasticMat), elasticR = new THREE.Mesh(UNIT_CYL, elasticMat);
elasticL.visible = elasticR.visible = false; scene.add(elasticL); scene.add(elasticR);
const POUCH_REST = { slingshot: new THREE.Vector3(0, 0.165, -0.005), crossbow: new THREE.Vector3(0, 0.02, -0.2) };

// Estado das armas
const W = {
  cd: 0, cdL: 0, cdR: 0, pistolAlt: 0, pouchGrabbed: false, eggReadyL: true, eggReadyR: true, eggTL: 0, eggTR: 0,
  laserOn: false, laserT: 0, laserPulse: false, laserHum: null, gatSpin: null,
};
export const weaponState = W;

export function equipWeapon(name) {
  G.weapon = name;
  W.pouchGrabbed = false;
  W.cd = W.cdL = W.cdR = 0;
  setLaser(false);
  pebbleMesh.scale.set(1, 1, name === 'crossbow' ? 1.6 : 1);
  if (name === 'hands') { W.eggReadyL = W.eggReadyR = true; }
}
export const canShoot = () => G.state === 'playing' || G.state === 'wave_intro' || G.state === 'upgrade';

// =============================================================================
// PROJÉTEIS (instanciados por visual)
// =============================================================================
export const projs = [];
const EGG_GEO = bakeWith(g => eggShape(g, 0xffffff, 0, 0, 0, 1));
const ARROW_GEO = bakeWith(g => {
  const e = eggShape(g, 0xffffff, 0, 0, 0, 1); e.scale.set(1.05, 1.5, 1.05);
  for (let k = 0; k < 3; k++) { const f = box(g, 0.004, 0.05, 0.035, 0xff4848, Math.cos(k * 2.09) * 0.018, -0.09, Math.sin(k * 2.09) * 0.018); f.rotation.y = -k * 2.09; }
});
// ovo-foguete: ovo branco alongado com aletas vermelhas e bocal (3.4: tudo é ovo)
const ROCKET_GEO = bakeWith(g => {
  const e = eggShape(g, 0xf4f4f8, 0, 0.01, 0, 1); e.scale.set(0.85, 1.25, 0.85);
  for (let k = 0; k < 4; k++) { const f = box(g, 0.005, 0.045, 0.03, 0xff4040, Math.cos(k * 1.57) * 0.03, -0.05, Math.sin(k * 1.57) * 0.03); f.rotation.y = -k * 1.57; }
  cyl(g, 0.014, 0.018, 0.02, 8, 0x404048, 0, -0.065, 0);
});
// ovo-rojão: ovo vermelho com faixa dourada e a varetinha
const FW_GEO = bakeWith(g => {
  const e = eggShape(g, 0xe02838, 0, 0, 0, 1.15); e.scale.set(1.05, 1.3, 1.05);
  torus(g, 0.047, 0.007, 4, 14, 0xffd040, 0, 0.012, 0).rotation.x = Math.PI / 2;
  cyl(g, 0.004, 0.004, 0.22, 4, 0x8a5a30, 0.03, -0.14, 0);
});
const GIANT_GEO = bakeWith(g => eggShape(g, 0xffe070, 0, 0, 0, 5));
const P_MAT = toon({ ramp: 4 });
function pim(geo, n) {
  const m = new THREE.InstancedMesh(geo, P_MAT, n);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.frustumCulled = false;
  m.setColorAt(0, _c.setHex(0xffffff));
  scene.add(m); return m;
}
const PIM = { egg: pim(EGG_GEO, MAX_PROJECTILES), arrow: pim(ARROW_GEO, 60), rocket: pim(ROCKET_GEO, 60), fw: pim(FW_GEO, 30), giant: pim(GIANT_GEO, 30) };
// contorno dos ovos: mesma matriz das instâncias, desenhado em volta (1 draw call)
const EGG_OUT = new THREE.InstancedMesh(outlineGeo(EGG_GEO), outlineMat(0.007), MAX_PROJECTILES);
EGG_OUT.instanceMatrix = PIM.egg.instanceMatrix; EGG_OUT.count = 0; EGG_OUT.frustumCulled = false;
scene.add(EGG_OUT);
const EGG_COL = new THREE.Color(0xfffaf0), GOLD_COL = new THREE.Color(0xffd040).multiplyScalar(1.3), BOOM_COL = new THREE.Color(0xff7040), FIRE_COL = new THREE.Color(0xff9a50), ICE_COL = new THREE.Color(0xa8e8ff);

export function volleyCount() { return 1 + G.up.front + 2 * G.up.diag; }
export function volleyDirs(dir) {
  const r = new THREE.Vector3().crossVectors(dir, UP);
  if (r.lengthSq() < 1e-6) r.set(1, 0, 0);
  r.normalize();
  const upv = new THREE.Vector3().crossVectors(r, dir).normalize();
  const out = [];
  const n = 1 + G.up.front;
  for (let k = 0; k < n; k++) out.push({ d: dir.clone(), off: r.clone().multiplyScalar((k - (n - 1) / 2) * 0.16) });
  for (let k = 1; k <= G.up.diag; k++) for (const sg of [-1, 1]) out.push({ d: dir.clone().applyAxisAngle(upv, sg * k * 0.24), off: new THREE.Vector3() });
  return out;
}
/** Cria um ovo-projétil. o: damage, gravity, gScale, scale, arrow, rocket, firework, giant, magnet, homing, boom, boomR, boomDmg, pierce, maxLife, extraR, volley */
export function spawnEgg(pos, vel, o = {}) {
  if (o.volley && (G.up.front || G.up.diag)) {
    const sp = vel.length() || 1;
    const dir = vel.clone().divideScalar(sp);
    let first = null;
    for (const v of volleyDirs(dir)) {
      const m = spawnEgg(pos.clone().add(v.off), v.d.multiplyScalar(sp), Object.assign({}, o, { volley: false }));
      if (!first) first = m;
    }
    return first;
  }
  if (projs.length >= MAX_PROJECTILES) return null;
  const golden = G.power.golden > 0 || !!o.golden, boom = G.power.boom > 0 || !!o.boom;
  const p = {
    pos: new THREE.Vector3().copy(pos), prev: new THREE.Vector3().copy(pos), vel: new THREE.Vector3().copy(vel),
    life: 0, damage: (o.damage || 1) * G.up.dmg * (golden ? 2 : 1),
    gravity: !!o.gravity, gScale: o.gScale != null ? o.gScale : 1,
    vis: o.giant ? 'giant' : o.firework ? 'fw' : o.rocket ? 'rocket' : o.arrow ? 'arrow' : 'egg',
    scale: (o.scale || 1) * (1 + (G.up.dmg - 1) * 0.6), maxLife: o.maxLife || 5, magnet: (o.magnet || 0) * G.up.magnet,
    golden, boom, boomR: o.boomR || 2.8, boomDmg: o.boomDmg || 2, pierce: G.up.pierce + (o.pierce || 0), ricochet: o.noRicochet ? 0 : G.up.ricochet,
    hitSet: null, firework: !!o.firework, giant: !!o.giant, homing: o.homing ? { target: null } : null, extraR: o.extraR || 0, spin: rand(0, 6), dead: false,
    col: golden ? GOLD_COL : boom ? BOOM_COL : G.up.fire ? FIRE_COL : G.up.ice ? ICE_COL : EGG_COL,
  };
  projs.push(p);
  G.waveShots++;
  return p;
}

// Assistência de mira (ímã): curva o ovo para o alvo mais próximo à frente
function applyMagnet(p, dt) {
  const sp = p.vel.length();
  if (sp < 0.5) return;
  const dir = t4.copy(p.vel).divideScalar(sp);
  let bestD = 3.5 + p.magnet * 0.3, tgt = null;
  forEachAimable(c => {
    const to = t5.copy(c).sub(p.pos);
    const d = to.length();
    if (d < bestD && d > 0.01 && to.dot(dir) > 0.7 * d) { bestD = d; tgt = c; }
  });
  if (!tgt) return;
  const des = t6.copy(tgt).sub(p.pos).normalize().multiplyScalar(sp);
  p.vel.lerp(des, Math.min(1, p.magnet * dt / Math.max(bestD, 0.6)));
}
export function acquireTarget(origin, dir) {
  let best = null, bestScore = -Infinity;
  const consider = (c, bonus, valid) => {
    const to = t3.copy(c).sub(origin);
    const d = to.length();
    if (d < 0.01) return;
    const cosA = to.dot(dir) / d;
    if (cosA < 0.75) return;
    const s = cosA * 2 - d * 0.02 + bonus;
    if (s > bestScore) { bestScore = s; best = { c, valid }; }
  };
  for (const u of ufos) {
    if (!isAlive(u)) continue;
    for (const p of u.parts) { if (!p.active || p.kind === 'armor') continue; consider(p.c, p.kind === 'crit' || p.kind === 'pod' || p.kind === 'core' ? 0.3 : 0, () => isAlive(u) && p.active); }
  }
  for (const cr of crates) consider(cr.c, 0.25, () => crates.includes(cr));
  for (const g of eproj) consider(g.pos, 0.2, () => !g.dead);
  if (best) return best;
  let bd = Infinity;
  for (const u of ufos) {
    if (!isAlive(u)) continue;
    for (const p of u.parts) { if (!p.active || p.kind === 'armor') continue; const d = p.c.distanceTo(origin); if (d < bd) { bd = d; best = { c: p.c, valid: () => isAlive(u) && p.active }; } }
  }
  return best;
}
function steerHoming(p, dt) {
  const h = p.homing;
  if (!h.target || !h.target.valid()) h.target = acquireTarget(p.pos, t4.copy(p.vel).normalize());
  const sp = Math.min(24, p.vel.length() + dt * 30);
  if (h.target && p.life > 0.12) { const des = t5.copy(h.target.c).sub(p.pos).normalize().multiplyScalar(sp); p.vel.lerp(des, Math.min(1, dt * 5)); }
  p.vel.setLength(sp);
}

function killProj(p) { p.dead = true; }
export function clearProjectiles() { projs.length = 0; crackles.length = 0; }

export function updateProjectiles(dt) {
  for (const p of projs) {
    if (p.dead) continue;
    p.prev.copy(p.pos);
    if (p.homing) steerHoming(p, dt);
    else if (p.magnet > 0) applyMagnet(p, dt);
    if (p.gravity) p.vel.y -= 9.8 * p.gScale * dt;
    p.pos.addScaledVector(p.vel, dt);
    p.life += dt; p.spin += dt * 8;
    const pp = p.pos;
    // rastros
    if (p.golden && Math.random() < 0.6) trailPuff(pp, 0xffd040, 0.07, 0.3);
    else if (p.vis === 'rocket' && Math.random() < 0.8) { _c.setHex(0xd8d8d8); fxAlpha.spawn(pp.x, pp.y, pp.z, 0, 0.2, 0, _c, 0.1, 0.5, 0, 0, 1.5, 0.6, SHAPE.smoke); trailPuff(pp, 0xffa040, 0.08, 0.1); }
    else if (p.boom && Math.random() < 0.6) trailPuff(pp, 0xff8030, 0.06, 0.25);
    else if (G.up.fire && Math.random() < 0.4) trailPuff(pp, 0xff7020, 0.08, 0.2);
    if (p.giant) { trailPuff(pp, 0xffe060, 0.4, 0.3); if (Math.random() < 0.5) { _c.setHex(0xffffff); fxAlpha.spawn(pp.x, pp.y, pp.z, 0, 0.5, 0, _c, 0.4, 0.6, 0, 0, 1.5, 0.4, SHAPE.smoke); } }
    if (p.firework) {
      _c.setHex(pick([0xffd040, 0xff6080, 0x80e0ff, 0xffffff]));
      fxAdd.spawn(pp.x, pp.y, pp.z, rand(-0.4, 0.4), rand(-0.4, 0.4), rand(-0.4, 0.4), _c, 0.08, 0.4, 1, 0.5, 0, 1, SHAPE.star, 6);
      let near = false;
      for (const u of ufos) { if (!isAlive(u)) continue; for (const pt of u.parts) if (pt.active && pt.kind !== 'armor' && pt.c.distanceTo(pp) < 2.2) { near = true; break; } if (near) break; }
      if (near || p.life > p.maxLife || pp.y <= 0.05) { fireworkBurst(pp, p); killProj(p); continue; }
    }
    const segV = t1.copy(pp).sub(p.prev);
    const hit = castSegment(p.prev, segV, 1, p.extraR + (p.giant ? 0.5 : 0), p.hitSet);
    if (hit) {
      const hp = t2.copy(p.prev).addScaledVector(segV, hit.t).clone();
      if (p.firework) { if (hit.kind !== 'ufo') applyHit(hit, p.damage, hp); fireworkBurst(hp, p); killProj(p); continue; }
      if (p.giant) { giantImpact(hp, p); killProj(p); continue; }
      applyHit(hit, p.damage, hp);
      if (hit.kind === 'ufo') {
        eggBurst(hp, p.golden);
        if (p.boom) explodeAt(hp, p);
        if (p.ricochet > 0) {
          let best = null, bd = 9;
          for (const u of ufos) {
            if (!isAlive(u) || u === hit.u || (p.hitSet && p.hitSet.has(u))) continue;
            const pt = u.parts.find(q => q.active && q.kind !== 'armor');
            if (!pt) continue;
            const dd = pt.c.distanceTo(hp);
            if (dd < bd) { bd = dd; best = pt; }
          }
          if (best) {
            p.ricochet--;
            if (!p.hitSet) p.hitSet = new Set();
            p.hitSet.add(hit.u);
            p.damage *= 0.7; p.gravity = false; p.homing = null; p.magnet = 0;
            p.pos.copy(hp);
            p.vel.copy(best.c).sub(hp).normalize().multiplyScalar(Math.max(30, p.vel.length()));
            p.life = Math.min(p.life, p.maxLife - 1);
            sparks(hp, 0xffffff, 5, 3, 0.05, 0.3);
            continue;
          }
        }
        if (p.pierce > 0) {
          p.pierce--;
          if (!p.hitSet) p.hitSet = new Set();
          p.hitSet.add(hit.u);
          continue;
        }
      }
      killProj(p);
      continue;
    }
    const gy = groundHeightAt(pp.x, pp.z);
    if (pp.y <= gy + 0.04 && p.vel.y < 0) {
      if (p.giant) { giantImpact(t3.set(pp.x, gy + 0.2, pp.z), p); killProj(p); continue; }
      for (const ck of chickens) if (Math.hypot(ck.pos.x - pp.x, ck.pos.z - pp.z) < 1.6) scareChicken(ck, pp);
      if (p.boom) explodeAt(t3.set(pp.x, gy + 0.15, pp.z), p);
      else { friedEgg(pp, gy, p.golden); sfxSplat(pp); }
      killProj(p);
      continue;
    }
    // bateu na casa ou no teto da varanda
    const hitHouse = pp.z < -3.5 && p.prev.z >= -3.5 && Math.abs(pp.x) < 4.3 && pp.y < 4.6;
    const hitRoof = pp.y > 3.3 && p.prev.y <= 3.3 && pp.z < 0.75 && pp.z > -3.75 && Math.abs(pp.x) < 4.25;
    if (hitHouse || hitRoof) {
      if (p.boom) explodeAt(pp, p); else { eggBurst(pp, p.golden, 10); sfxSplat(pp); }
      killProj(p);
      continue;
    }
    if (p.life > p.maxLife || pp.y < -5) killProj(p);
  }
  for (let i = projs.length - 1; i >= 0; i--) if (projs[i].dead) { projs[i] = projs[projs.length - 1]; projs.pop(); }
  drawProjectiles();
}
let splatT = 0;
function sfxSplat(pos) { if (G.time - splatT > 0.04) { splatT = G.time; sfx('eggSplat', { pos }); } }

// Desenho: o ovo aponta na direção do voo e estica com a velocidade (squash & stretch)
function drawProjectiles() {
  const n = { egg: 0, arrow: 0, rocket: 0, fw: 0, giant: 0 };
  for (const p of projs) {
    const sp = p.vel.length();
    if (sp > 1e-4) _q.setFromUnitVectors(Y_POS, t7.copy(p.vel).divideScalar(sp)); else _q.identity();
    let sx = p.scale, sy = p.scale;
    if (p.vis === 'egg') {
      // O ovo dá cambalhotas mostrando sempre o PERFIL para quem olha. Antes ele apontava para onde
      // voava e, voando para longe, a gente via só a ponta (um círculo = "bola").
      t7.copy(p.pos).sub(camPos); const dl = t7.length();
      if (dl > 1e-3) {
        t7.divideScalar(dl);
        _s.set(Math.cos(p.spin), Math.sin(p.spin), Math.sin(p.spin * 0.7) * 0.4);
        _s.addScaledVector(t7, -_s.dot(t7));                       // tira a componente na direção do olhar
        if (_s.lengthSq() < 1e-4) _s.set(0, 1, 0);
        _q.setFromUnitVectors(Y_POS, _s.normalize());
      }
    }
    if (p.vis === 'giant') { _q.setFromAxisAngle(t7.set(1, 0, 0.3).normalize(), Math.PI + Math.sin(p.spin * 0.2) * 0.2); }
    _m4.compose(p.pos, _q, _s.set(sx, sy, sx));
    const im = PIM[p.vis], i = n[p.vis]++;
    im.setMatrixAt(i, _m4);
    im.setColorAt(i, p.col);
  }
  for (const k of Object.keys(PIM)) { const im = PIM[k]; im.count = n[k]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
  EGG_OUT.count = n.egg;
}

// =============================================================================
// DISPARO
// =============================================================================
function muzzleWorld(name, out, grp) { out.copy(MUZZLE[name] || MUZZLE.hands); return (grp || GROUPS[name]).localToWorld(out); }
function shotDir(origin, ctrl, out) {
  if (xrActive()) { ctrl.getWorldQuaternion(_q); return out.set(0, 0, -1).applyQuaternion(_q); }
  return out.copy(pcAim).sub(origin).normalize();
}
function spreadDir(dir, s) {
  if (s <= 0) return dir;
  dir.x += (Math.random() - 0.5) * s; dir.y += (Math.random() - 0.5) * s; dir.z += (Math.random() - 0.5) * s;
  return dir.normalize();
}
// Velocidade inicial com física: no VR sai na direção do cano; no PC/celular resolve a parábola
// até a mira (mesma velocidade, ângulo que compensa a gravidade) e mira à frente de nave andando.
const _fixed = { g: 9.8, vmin: 0, vmax: 0, k: 1 };
function launchVel(origin, ctrl, speed, gScale, out) {
  if (xrActive() || gScale <= 0) return shotDir(origin, ctrl, out).multiplyScalar(speed);
  _fixed.g = 9.8 * gScale; _fixed.vmin = _fixed.vmax = speed;
  solveThrow(origin, pcAim, pcAimVel, _fixed, out);
  return out;
}
function spreadVel(v, s) {
  if (s <= 0) return v;
  const sp = v.length(); v.divideScalar(sp);
  return spreadDir(v, s).multiplyScalar(sp);
}
/** Ovo disparado por arma: B = { speed, g (fração da gravidade), dmg, scale, spread, life, magnet } */
function fireBullet(B, flashHex, ctrl = CTRL.right, grp = null, name = G.weapon) {
  const origin = muzzleWorld(name, t0, grp);
  const v = spreadVel(launchVel(origin, ctrl, B.speed, B.g, t1), B.spread);
  spawnEgg(origin, v, { damage: B.dmg, scale: B.scale, maxLife: B.life, gravity: B.g > 0, gScale: B.g, magnet: B.magnet, volley: true });
  muzzle(origin, flashHex, 0.16 * B.scale + 0.06);
}
// 3.4: ovos mais lentos e com peso (dá pra VER o ovo voando e caindo um pouco), mira compensa
export const BAL = {
  pistols: { speed: 40, g: 0.5, dmg: 2, scale: 1.25, spread: 0.015, life: 1.8, magnet: 0.8, cd: 0.16 },
  shotgun: { speed: 30, g: 0.8, dmg: 1.4, scale: 1.05, spread: 0.18, life: 1.4, magnet: 0.4, cd: 0.45, n: 9 },
  gatling: { speed: 42, g: 0.45, dmg: 2, scale: 1.1, spread: 0.035, life: 1.6, magnet: 0.6, cd: 0.06 },
};
function firePistol(left) {
  const grp = left ? pistolL : pistols, ctrl = left ? CTRL.left : CTRL.right;
  fireBullet(BAL.pistols, 0xffb040, ctrl, grp, 'pistols');
  sfx('pistol', { pitch: rand(0.95, 1.05) }); pulseCtrl(ctrl, 0.45, 35);
  const cd = BAL.pistols.cd / G.up.rate;
  if (left) W.cdL = cd; else W.cdR = cd;
  grp.userData.kick = 1;
}
function fireShotgun() {
  const pellets = Math.round(BAL.shotgun.n / Math.sqrt(volleyCount()));
  for (let i = 0; i < pellets; i++) fireBullet(BAL.shotgun, 0xffe860);
  muzzleWorld('shotgun', t0); smoke(t0, 4, 0xb0b0b0, 0.18, 0.5, 0.3);
  sfx('shotgun'); pulseCtrl(CTRL.right, 0.95, 130);
  W.cd = BAL.shotgun.cd / G.up.rate;
  shotgun.userData.kick = 1;
}
function fireGatling() {
  fireBullet(BAL.gatling, 0xff8030, CTRL.right, null, 'gatling');
  sfx('gatling', { pitch: rand(0.95, 1.08) }); pulseCtrl(CTRL.right, 0.35, 30);
  W.cd = BAL.gatling.cd / G.up.rate;
}
function fireLauncher() {
  const origin = muzzleWorld('launcher', t0);
  // granada de ovo: arco alto; no PC a força se ajusta à distância (como o arremesso)
  if (xrActive()) shotDir(origin, CTRL.right, t1).multiplyScalar(24);
  else solveThrow(origin, pcAim, pcAimVel, LAUNCH_SPEC, t1);
  spawnEgg(origin, t1, { damage: 2, scale: 1.7, gravity: true, gScale: 0.9, boom: true, boomR: 3.0, boomDmg: 4, maxLife: 4, magnet: 1, volley: true });
  muzzle(origin, 0xff8040, 0.35); smoke(origin, 3, 0x909090, 0.2, 0.6);
  sfx('launcher'); pulseCtrl(CTRL.right, 0.8, 90);
  W.cd = 0.7 / G.up.rate;
  launcher.userData.kick = 1;
}
function fireHoming() {
  const origin = muzzleWorld('homing', t0).clone();
  const dir = shotDir(origin, CTRL.right, t1).clone();
  const tgt = acquireTarget(origin, dir);
  for (let k = 0; k < 3; k++) {
    const v = t2.copy(dir);
    v.x += rand(-0.25, 0.25); v.y += rand(0, 0.3); v.z += rand(-0.25, 0.25);
    v.normalize().multiplyScalar(13);
    const p = spawnEgg(origin, v, { damage: 3, rocket: true, homing: true, maxLife: 4, scale: 1.2, volley: k === 0 });
    if (p) p.homing.target = tgt;
  }
  sfx('homingLaunch'); pulseCtrl(CTRL.right, 0.6, 70); muzzle(origin, 0xffa040, 0.3);
  W.cd = 0.9 / G.up.rate;
  homing.userData.kick = 1;
}
const LASER_ON = 0.045, LASER_OFF = 0.06;
export function setLaser(on) {
  if (on === W.laserOn) return;
  W.laserOn = on; W.laserPulse = false; W.laserT = LASER_OFF;
  if (on && !W.laserHum) W.laserHum = loop('laserHum', { vol: 0.6 });
  if (!on && W.laserHum) { W.laserHum.stop(0.1); W.laserHum = null; }
}
const laserSegs = [];
function tickLaser(dt) {
  if (!W.laserOn) return;
  W.laserT += dt;
  if (W.laserPulse && W.laserT >= LASER_ON) { W.laserPulse = false; W.laserT = 0; }
  else if (!W.laserPulse && W.laserT >= LASER_OFF / G.up.rate) {
    W.laserPulse = true; W.laserT = 0;
    sfx('laser'); pulseCtrl(CTRL.right, 0.25, 25);
    fireLaserPulse();
  }
  // desenha o feixe enquanto o pulso está ligado
  if (W.laserPulse) for (const s of laserSegs) { seg(s.a, s.b, 0.05, 0xffb020); seg(s.a, s.b, 0.014, 0xffffe0); }
}
function fireLaserPulse() {
  const origin = muzzleWorld('laser', t0).clone();
  const fwd = shotDir(origin, CTRL.right, t1).clone();
  fwd.x += rand(-0.012, 0.012); fwd.y += rand(-0.012, 0.012); fwd.z += rand(-0.012, 0.012); fwd.normalize();
  const dmg = 5 * G.up.dmg * (G.power.golden > 0 ? 3 : 1);   // arma final: a mais forte num alvo só
  laserSegs.length = 0;
  G.waveShots++;
  volleyDirs(fwd).slice(0, 7).forEach(v => {
    const o = origin.clone().add(v.off);
    const hit = castSegment(o, v.d, 40, 0.15);
    const end = o.clone().addScaledVector(v.d, hit ? hit.t : 40);
    laserSegs.push({ a: o, b: end });
    if (!hit) return;
    applyHit(hit, dmg, end);
    sparks(end, 0xffd040, 3, 2.5, 0.05, 0.35);
    glow(end.x, end.y, end.z, 0.35, 0xffc030, 1);
    if (hit.kind === 'ufo' && G.up.ricochet) bounceChain(hit.u, end, dmg, G.up.ricochet, 0xffd040);
    if (G.power.boom > 0 && Math.random() < 0.3) explodeAt(end, { boomR: 1.8, boomDmg: 1, golden: G.power.golden > 0 });
  });
}
// Ricochete instantâneo (laser): salta pra nave mais próxima com 70% a cada pulo
function bounceChain(fromU, pos, dmg, n, hex) {
  const done = new Set([fromU]);
  let from = pos.clone(), d = dmg;
  for (let k = 0; k < n; k++) {
    let best = null, bd = 9;
    for (const u of ufos) {
      if (!isAlive(u) || done.has(u)) continue;
      const p = u.parts.find(q => q.active && q.kind !== 'armor');
      if (!p) continue;
      const dd = p.c.distanceTo(from);
      if (dd < bd) { bd = dd; best = { u, p }; }
    }
    if (!best) return;
    d *= 0.7;
    const to = best.p.c.clone();
    bolt(from, to, 0.06, 0.1, 0xffe080);
    sparks(to, hex, 4, 2.5, 0.05, 0.35);
    hitPart(best.u, best.p, d, to, false);
    done.add(best.u); from = to;
  }
}
const TESLA_R = 7;
function fireTesla() {
  const origin = muzzleWorld('tesla', t0).clone();
  const aim = shotDir(origin, CTRL.right, t1).clone();
  const base = 6 * G.up.dmg * (G.power.golden > 0 ? 3 : 1);
  const zapped = new Set();
  let total = 0, popAt = null;
  G.waveShots++;
  for (const v of volleyDirs(aim).slice(0, 5)) {
    const o = origin.clone().add(v.off);
    const hit = castSegment(o, v.d, 45, 0.5);
    if (!hit) { bolt(o, o.clone().addScaledVector(v.d, 10), 0.2); continue; }
    const hp = o.clone().addScaledVector(v.d, hit.t);
    bolt(o, hp, 0.15, 0.09, 0xb8f0ff, 0.022);
    sparks(hp, 0xa8ecff, 8, 3, 0.06, 0.4);
    glow(hp.x, hp.y, hp.z, 0.8, 0x80d8ff, 1);
    if (hit.kind === 'ufo') { if (zapped.has(hit.u)) continue; zapped.add(hit.u); }
    applyHit(hit, base, hp);
    if (!popAt) popAt = hp;
    // Cascata: cada geração salta pros vizinhos com menos força (100% → 55% → 30% → 17%)
    let frontier = [hp], dmg = base;
    const gens = 3 + G.up.ricochet;
    for (let gen = 0; gen < gens && frontier.length && total < 10 + G.up.ricochet * 3; gen++) {
      dmg *= 0.55;
      const next = [];
      for (const from of frontier) {
        const cands = [];
        for (const u of ufos) {
          if (!isAlive(u) || zapped.has(u)) continue;
          const part = u.parts.find(p => p.active && p.kind !== 'armor');
          if (!part) continue;
          const d = part.c.distanceTo(from);
          if (d < TESLA_R) cands.push({ u, part, d });
        }
        cands.sort((a, b) => a.d - b.d);
        for (const c of cands.slice(0, 3)) {
          zapped.add(c.u); total++;
          const to = c.part.c.clone();
          bolt(from, to, 0.22);
          sparks(to, 0xa8ecff, 5, 3, 0.06, 0.4);
          hitPart(c.u, c.part, dmg, to, false);
          next.push(to);
        }
        for (const g of eproj) if (!g.dead && g.pos.distanceTo(from) < TESLA_R * 0.7) { bolt(from, g.pos.clone(), 0.2); destroyEproj(g, true); }
      }
      frontier = next;
    }
    if (G.power.boom > 0) explodeAt(hp, { boomR: 2, boomDmg: 2, golden: G.power.golden > 0 });
  }
  if (popAt && total >= 2) { popup(tr('CHOQUE x', 'SHOCK x', 'SHOKKI x') + (total + 1) + '!', popAt.clone().setY(popAt.y + 0.5), '#a8ecff', 0.9, 0.9); sfx('teslaChain', { pos: popAt }); }
  sfx('tesla'); pulseCtrl(CTRL.right, 0.55, 50);
  W.cd = 0.28 / G.up.rate;
  tesla.userData.kick = 1;
}
// Rojão: sobe assobiando e explode no céu num leque colorido que machuca muito
function fireFireworks() {
  const origin = muzzleWorld('fireworks', t0);
  const v = launchVel(origin, CTRL.right, 30, 0.15, t1);
  spawnEgg(origin, v, { damage: 4, firework: true, gravity: true, gScale: 0.15, maxLife: 1.15, magnet: 1.2, volley: true, scale: 1.2 });
  muzzle(origin, 0xffd040, 0.35); smoke(origin, 3, 0xa0a0a0, 0.2, 0.6);
  sfx('fireworkLaunch'); pulseCtrl(CTRL.right, 0.7, 80);
  W.cd = 0.85 / G.up.rate;
  fireworks.userData.kick = 1;
}
const FW_PALETTES = [[0xff3060, 0xffd040], [0x40e0ff, 0xffffff], [0xa0ff60, 0xff60ff], [0xff8030, 0xfff080], [0x8060ff, 0x60ffd0]];
const crackles = [];
export function fireworkBurst(posIn, p, R = 4.5, dmgBase = 12) {
  const pos = posIn.clone();
  const pal = pick(FW_PALETTES);
  _c.setHex(0xffffff); fxAdd.spawn(pos.x, pos.y, pos.z, 0, 0, 0, _c, 3, 0.18, 0, 0, 0.5, 1, SHAPE.glow);
  for (let i = 0; i < 120; i++) {
    randDir(t8); const sp = rand(6, 9);
    _c.setHex(pal[i % 2]);
    fxAdd.spawn(pos.x, pos.y, pos.z, t8.x * sp, t8.y * sp, t8.z * sp, _c, rand(0.12, 0.2), rand(1.0, 1.7), 2.2, 1.1, 0, 1, i % 3 ? SHAPE.glow : SHAPE.star, rand(-4, 4));
  }
  blast(pos, R, pal[0]);
  sfx('fireworkBoom', { pos }); pulseAll(0.5, 100);
  const mult = G.up.dmg * (p && p.golden ? 3 : 1);
  aoeDamage(pos, R, dmgBase * mult);
  for (let k = 0; k < 4; k++) crackles.push({ t: 0.3 + k * 0.12, pos: pos.clone().add(t8.set(rand(-3, 3), rand(-2, 2), rand(-3, 3))), col: pal[k % 2], dmg: 4 * mult });
}
function updateCrackles(dt) {
  for (let i = crackles.length - 1; i >= 0; i--) {
    const c = crackles[i];
    c.t -= dt;
    if (c.t > 0) continue;
    crackles.splice(i, 1);
    _c.setHex(c.col);
    for (let k = 0; k < 30; k++) { randDir(t8); const sp = rand(3, 5); fxAdd.spawn(c.pos.x, c.pos.y, c.pos.z, t8.x * sp, t8.y * sp, t8.z * sp, _c, rand(0.08, 0.13), rand(0.6, 1.0), 2, 1.2, 0, 1, SHAPE.star, rand(-6, 6)); }
    sfx('crackle', { pos: c.pos });
    aoeDamage(c.pos, 2.5, c.dmg);
  }
}
// VR: igual à 2.1 — a força do braço manda (sem teto), ovo rápido e quase reto, ímã 4.
export function throwEgg(ctrl, vel) {
  const origin = ctrl.getWorldPosition(t0);
  const sm = vel.length();
  const factor = Math.min(3.0 + sm * 0.6, 9.5);
  spawnEgg(origin, t1.copy(vel).multiplyScalar(factor), { damage: 1, gravity: true, gScale: 0.35, magnet: 4, volley: true });
  sfx('throw', { pitch: rand(0.9, 1.1) });
  pulseCtrl(ctrl, Math.min(0.95, 0.25 + sm * 0.1), 80);
}
function pouchRestWorld(out) { out.copy(POUCH_REST[G.weapon] || POUCH_REST.slingshot); return GROUPS[G.weapon].localToWorld(out); }
function fireSlingshotPouch() {
  const rest = pouchRestWorld(t0);
  const pull = t1.copy(rest).sub(pouchMesh.position);
  const dist = pull.length();
  if (dist < SLINGSHOT_MIN_PULL) return;
  const speed = Math.min(dist * SHOT_SPEED_FACTOR, MAX_SHOT_SPEED);
  spawnEgg(pouchMesh.position, pull.normalize().multiplyScalar(speed), { damage: 2, gravity: true, magnet: 3, volley: true });
  sfx('slingRelease'); pulseCtrl(CTRL.left, 0.7, 90); pulseCtrl(CTRL.right, 0.4, 60);
}
function fireCrossbowArrow() {
  const rest = pouchRestWorld(t0);
  const pull = t1.copy(rest).sub(pouchMesh.position);
  if (pull.length() < 0.04) return;
  spawnEgg(pouchMesh.position, pull.normalize().multiplyScalar(CROSSBOW_SPEED), { damage: 2, arrow: true, magnet: 1.5, volley: true });
  sfx('crossbow'); pulseCtrl(CTRL.left, 0.85, 100); pulseCtrl(CTRL.right, 0.5, 70);
}
// -----------------------------------------------------------------------------
// ARREMESSO COM PARÁBOLA DE VERDADE (PC/celular)
// O braço tem força limitada: perto, joga mais leve; longe, joga com tudo e numa
// curva mais alta; fora do alcance, o ovo cai antes (somos rancheiros, não canhões).
// Se a mira está numa nave andando, joga onde ela VAI estar.
// -----------------------------------------------------------------------------
const LAUNCH_SPEC = { g: 9.8 * 0.9, vmin: 13, vmax: 24, k: 1.25 };
export const THROW = {
  hands: { g: 9.8 * 0.6, gScale: 0.6, vmin: 9, vmax: 15.5, k: 1.3, magnet: 1.5 },
  slingshot: { g: 9.8, gScale: 1, vmin: 14, vmax: MAX_SHOT_SPEED, k: 1.3, magnet: 1.5 },
};
const _hz = new THREE.Vector3(), _aim = new THREE.Vector3();
/** Resolve a velocidade inicial. Retorna { inRange, T } e escreve a velocidade em out. */
function solveThrow(o, target, tv, spec, out) {
  _aim.copy(target);
  let inRange = true, T = 0;
  for (let it = 0; it < 3; it++) {
    const dx = _aim.x - o.x, dz = _aim.z - o.z, y = _aim.y - o.y;
    const x = Math.max(0.05, Math.hypot(dx, dz));
    const g = spec.g, r = Math.hypot(x, y);
    const vNeed = Math.sqrt(g * (y + r));               // menor força que alcança o ponto
    const v = Math.min(spec.vmax, Math.max(spec.vmin, vNeed * spec.k));
    let ang;
    if (vNeed <= spec.vmax) {
      const v2 = v * v, disc = v2 * v2 - g * (g * x * x + 2 * y * v2);
      ang = Math.atan2(v2 - Math.sqrt(Math.max(0, disc)), g * x); // curva baixa (mais rápida)
      inRange = true;
    } else {
      ang = Math.PI / 4 + Math.atan2(y, x) / 2;          // força máxima no melhor ângulo: cai antes
      inRange = false;
    }
    _hz.set(dx / x, 0, dz / x);
    out.copy(_hz).multiplyScalar(v * Math.cos(ang)); out.y = v * Math.sin(ang);
    T = x / Math.max(0.1, v * Math.cos(ang));
    if (!inRange || !tv || tv.lengthSq() < 0.01) break;
    _aim.copy(target).addScaledVector(tv, Math.min(T, 3));  // mira à frente da nave
  }
  return { inRange, T };
}
// o ovo sai da mão direita (onde ele aparece na tela), então o arco é visto curvando
const _oq = new THREE.Quaternion();
function throwOrigin(out) {
  camera.getWorldQuaternion(_oq);
  return out.copy(camPos).add(t1.set(0.24, -0.2, -0.6).applyQuaternion(_oq));
}
/** Mede a velocidade de cada nave (para os arremessos mirarem à frente dela). */
const _dv = new THREE.Vector3();
function trackUfoVel(dt) {
  if (dt <= 0) return;
  for (const u of ufos) {
    if (!u._pv) { u._pv = u.pos.clone(); u._vel = new THREE.Vector3(); continue; }
    _dv.copy(u.pos).sub(u._pv).divideScalar(dt);
    if (_dv.lengthSq() < 900) u._vel.lerp(_dv, Math.min(1, dt * 10)); else u._vel.set(0, 0, 0);
    u._pv.copy(u.pos);
  }
}
/** Velocidade do que está sob a mira (nave ou gosma); zero para o resto. */
export function targetVel(hit, out) {
  if (hit && hit.kind === 'ufo' && hit.u._vel) return out.copy(hit.u._vel);
  if (hit && hit.kind === 'eproj') return out.copy(hit.g.vel);
  return out.set(0, 0, 0);
}
/** Para o HUD/arco de prévia: o arremesso atual alcança a mira? */
export const aimInfo = { inRange: true, active: false };
const _po = new THREE.Vector3(), _pv = new THREE.Vector3();
/** Sem nada na tela: só guarda se o arremesso atual alcança a mira (usado nos testes). */
function updateAimInfo() {
  aimInfo.active = false;
  if (xrActive() || isTouch || !canShoot()) return;
  const spec = THROW[G.weapon];
  if (!spec) return;
  const r = solveThrow(throwOrigin(_po), pcAim, pcAimVel, spec, _pv);
  aimInfo.active = true; aimInfo.inRange = r.inRange;
}
/** Tiro de clique (PC/celular) para as armas de arremesso. */
export function desktopShoot(aim = pcAim, aimVel = pcAimVel) {
  if (W.cd > 0) return;
  const o = throwOrigin(t0);
  if (G.weapon === 'hands') {
    solveThrow(o, aim, aimVel, THROW.hands, t2);
    spawnEgg(o, t2, { damage: 1, gravity: true, gScale: THROW.hands.gScale, magnet: THROW.hands.magnet, volley: true });
    sfx('throw', { pitch: rand(0.9, 1.1) }); W.cd = 0.32 / G.up.rate;
    handsGrp.userData.kick = 1;
  } else if (G.weapon === 'slingshot') {
    solveThrow(o, aim, aimVel, THROW.slingshot, t2);
    spawnEgg(o, t2, { damage: 2, gravity: true, gScale: THROW.slingshot.gScale, magnet: THROW.slingshot.magnet, volley: true });
    sfx('slingRelease'); W.cd = 0.35 / G.up.rate;
    slingshot.userData.kick = 1;
  } else if (G.weapon === 'crossbow') {
    spawnEgg(o, t2.copy(aim).sub(o).normalize().multiplyScalar(CROSSBOW_SPEED), { damage: 2, arrow: true, magnet: 1.5, volley: true });
    sfx('crossbow'); W.cd = 0.42 / G.up.rate;
    crossbow.userData.kick = 1;
  }
}
export const isTapWeapon = () => G.weapon === 'hands' || G.weapon === 'slingshot' || G.weapon === 'crossbow';

// =============================================================================
// CHUVA DE OVOS — o especial: ovos gigantes caem do céu em cima das naves
// =============================================================================
export function canUlt() { return G.ult >= 1 && G.ultActive <= 0 && G.state === 'playing'; }
export function fireUltimate() {
  if (!canUlt()) { if (G.state === 'playing') { sfx('denied'); popupAhead(tr('🥚 CHUVA DE OVOS: ', '🥚 EGG STORM: ', '🥚 MUNASADE: ') + Math.floor(G.ult * 100) + '%', '#cccccc', 0.7); } return; }
  G.ult = 0; G.ultActive = 4.5; ultT = 0;
  flashScreen(0xffe060, 0.8); pulseAll(1, 300); hitStop(0.15);
  sfx('takeoff'); stinger('levelUp');
  popupAhead(tr('🥚 CHUVA DE OVOS!', '🥚 EGG STORM!', '🥚 MUNASADE!'), '#ffe060', 1.6, 1.8);
}
let ultT = 0;
function updateUltimate(dt) {
  if (G.ultActive <= 0) return;
  G.ultActive -= dt; ultT -= dt;
  if (ultT > 0) return;
  ultT = 0.16;
  // alvo: uma nave viva (de preferência a que está abduzindo) ou um ponto do quintal
  const alive = ufos.filter(u => isAlive(u) && u.kind !== 'mother');
  let target;
  if (alive.length && Math.random() < 0.8) {
    const busy = alive.filter(u => u.state === 'beaming' || u.state === 'grab' || u.state === 'flee');
    const u = busy.length && Math.random() < 0.6 ? pick(busy) : pick(alive);
    target = t5.copy(u.pos);
  } else target = t5.set(rand(-8, 8), 0, rand(3, 16));
  const from = t6.set(target.x + rand(-2, 2), 30, target.z + rand(-2, 2));
  const v = t7.copy(target).sub(from).normalize().multiplyScalar(26);
  spawnEgg(from, v, { giant: true, damage: 10, maxLife: 3, scale: 1, gravity: false });
}
function giantImpact(pos, p) {
  fireball(pos, 1.4); blast(pos, 3.2, 0xffe060); eggBurst(pos, true, 18);
  sfx('explosionBig', { pos }); pulseAll(0.5, 80);
  aoeDamage(pos, 3.2, 8 * G.up.dmg);
  if (pos.y < 0.5) friedEgg(pos, 0, true);
}

// =============================================================================
// SINCRONIA DAS ARMAS COM AS MÃOS / CÂMERA + GATILHOS
// =============================================================================
const VEL_HISTORY = 10;
const handTrack = { L: { prev: new THREE.Vector3(), vel: new THREE.Vector3(), hist: [] }, R: { prev: new THREE.Vector3(), vel: new THREE.Vector3(), hist: [] } };
function peakVel(h) { let peak = h.hist[0] || h.vel; for (const v of h.hist) if (v.lengthSq() > peak.lengthSq()) peak = v; return peak; }
/** Velocidade da mão relativa ao corpo: andar, girar, cair ou voar não conta como arremesso. */
export function trackHands(dt) {
  if (dt <= 0) return;
  const idt = 1 / dt, rq = rig.quaternion;
  for (const [h, ctrl] of [[handTrack.L, CTRL.left], [handTrack.R, CTRL.right]]) {
    h.vel.copy(ctrl.position).sub(h.prev).multiplyScalar(idt).applyQuaternion(rq);
    h.prev.copy(ctrl.position);
    // histórico sem alocar (reaproveita os vetores que saem)
    const v = h.hist.length >= VEL_HISTORY ? h.hist.shift() : new THREE.Vector3();
    h.hist.push(v.copy(h.vel));
  }
  if (G.weapon !== 'hands' || !canShoot() || G.state === 'idle') return;
  const T = 2.0, cd = 0.38 / G.up.rate;
  W.eggTL -= dt; W.eggTR -= dt;
  if (W.eggTL <= 0 && handTrack.L.vel.length() > T) { throwEgg(CTRL.left, peakVel(handTrack.L)); handTrack.L.hist.length = 0; W.eggTL = cd; }
  if (W.eggTR <= 0 && handTrack.R.vel.length() > T) { throwEgg(CTRL.right, peakVel(handTrack.R)); handTrack.R.hist.length = 0; W.eggTR = cd; }
}
export function onTriggerStart(ctrl) {
  if (!canShoot()) return;
  if ((G.weapon === 'slingshot' || G.weapon === 'crossbow') && ctrl === CTRL.left) {
    const lh = CTRL.left.getWorldPosition(t0);
    const rest = pouchRestWorld(t1);
    if (lh.distanceTo(rest) < POUCH_GRAB_DIST) { W.pouchGrabbed = true; sfx('slingPull'); pulseCtrl(CTRL.left, 0.4, 50); }
  }
}
export function onTriggerEnd(ctrl) {
  if ((G.weapon === 'slingshot' || G.weapon === 'crossbow') && ctrl === CTRL.left && W.pouchGrabbed) {
    if (G.weapon === 'slingshot') fireSlingshotPouch(); else fireCrossbowArrow();
    W.pouchGrabbed = false;
  }
}

/** Posiciona as armas (mão no VR, canto da tela no PC) e dispara as automáticas. */
export function updateWeapons(dt, xr, rHeld, lHeld) {
  aimInfo.active = false;
  trackUfoVel(dt);
  W.cd = Math.max(0, W.cd - dt); W.cdL = Math.max(0, W.cdL - dt); W.cdR = Math.max(0, W.cdR - dt);
  const show = canShoot() || G.state === 'wave_complete';
  const name = G.weapon, grp = GROUPS[name];
  for (const k of Object.keys(GROUPS)) GROUPS[k].visible = false;
  pistolL.visible = false;
  pouchMesh.visible = pebbleMesh.visible = elasticL.visible = elasticR.visible = false;
  handEggL.visible = handEggR.visible = false;
  CTRL.visR.visible = CTRL.visL.visible = !show && xr;
  if (show) {
    grp.userData.kick = Math.max(0, (grp.userData.kick || 0) - dt * 9);
    pistolL.userData.kick = Math.max(0, pistolL.userData.kick - dt * 9);
    if (xr) {
      grp.scale.setScalar(1); pistolL.scale.setScalar(1);
      CTRL.right.getWorldPosition(grp.position);
      CTRL.right.getWorldQuaternion(grp.quaternion);
      if (grp.userData.kick) grp.rotateX(grp.userData.kick * 0.3);
      grp.visible = name !== 'hands';
      CTRL.visR.visible = name === 'hands';
      CTRL.visL.visible = name !== 'pistols';
      if (name === 'pistols') {
        CTRL.left.getWorldPosition(pistolL.position);
        CTRL.left.getWorldQuaternion(pistolL.quaternion);
        if (pistolL.userData.kick) pistolL.rotateX(pistolL.userData.kick * 0.3);
        pistolL.visible = true;
        pistolL.updateMatrixWorld();
      }
      grp.updateMatrixWorld();
      if (name === 'slingshot' || name === 'crossbow') {
        const pp = W.pouchGrabbed ? CTRL.left.getWorldPosition(t0) : pouchRestWorld(t0);
        pouchMesh.position.copy(pp); pouchMesh.lookAt(camPos); pouchMesh.visible = true;
        pebbleMesh.position.copy(pp); pebbleMesh.visible = true;
        const fd = pouchRestWorld(t1).sub(pp);
        if (name === 'crossbow' && fd.lengthSq() > 1e-6) pebbleMesh.quaternion.setFromUnitVectors(Y_POS, fd.normalize());
        else pebbleMesh.quaternion.identity();
        const tl = grp.localToWorld(t3.copy(name === 'crossbow' ? CB_TIP_L : SL_TIP_L));
        const trr = grp.localToWorld(t4.copy(name === 'crossbow' ? CB_TIP_R : SL_TIP_R));
        placeSegment(elasticL, tl, pp, 0.0055); elasticL.visible = true;
        placeSegment(elasticR, trr, pp, 0.0055); elasticR.visible = true;
      }
      if (name === 'hands') {
        if (W.eggTL <= 0) { placeHandEgg(handEggL, CTRL.left); }
        if (W.eggTR <= 0) { placeHandEgg(handEggR, CTRL.right); }
      }
    } else {
      camera.getWorldQuaternion(_q);
      const bob = Math.sin(G.time * 2) * 0.004;
      grp.position.copy(camPos).add(t0.set(0.25, -0.27 + bob, -0.58).applyQuaternion(_q));
      grp.quaternion.copy(_q);
      grp.scale.setScalar(0.66); pistolL.scale.setScalar(0.66);
      if (grp.userData.kick) { grp.rotateX(grp.userData.kick * 0.25); grp.translateZ(grp.userData.kick * 0.04); }
      grp.visible = name !== 'hands';
      if (name === 'hands') {
        handEggR.position.copy(camPos).add(t1.set(0.26, -0.26, -0.75).applyQuaternion(_q));
        handEggR.quaternion.copy(_q);
        handEggR.visible = W.cd <= 0.05;
      }
      if (name === 'pistols') {
        pistolL.position.copy(camPos).add(t1.set(-0.28, -0.3 + bob, -0.5).applyQuaternion(_q));
        pistolL.quaternion.copy(_q);
        if (pistolL.userData.kick) pistolL.rotateX(pistolL.userData.kick * 0.25);
        pistolL.visible = true;
        pistolL.updateMatrixWorld();
      }
      grp.updateMatrixWorld();
      updateAimInfo();
    }
  }
  // animações
  W.gatSpinV = W.gatSpinV || 0;
  W.gatSpinV += (((name === 'gatling' && rHeld && canShoot()) ? 30 : 0) - W.gatSpinV) * Math.min(1, dt * 6);
  gatlingBarrels.rotation.z += W.gatSpinV * dt;
  if (name === 'gatling' && W.gatSpinV > 2) { if (!W.gatSpin) W.gatSpin = loop('gatlingSpin', { vol: 0.5 }); W.gatSpin.setPitch(0.5 + W.gatSpinV / 30); }
  else if (W.gatSpin) { W.gatSpin.stop(0.2); W.gatSpin = null; }
  if (name === 'laser') { laserCore.scale.setScalar(1 + Math.sin(G.time * 12) * 0.3); laserRing.rotation.z += dt * 5; }
  if (name === 'tesla' && show) {
    teslaTip.scale.setScalar(1 + Math.sin(G.time * 20) * 0.15 + tesla.userData.kick * 0.6);
    teslaTip.getWorldPosition(t8); glow(t8.x, t8.y, t8.z, 0.16, 0x60c0ff, 0.6 + Math.random() * 0.4);
    if (Math.random() < 0.15) { _c.setHex(0xa8ecff); fxAdd.spawn(t8.x, t8.y, t8.z, rand(-0.5, 0.5), rand(-0.5, 0.5), rand(-0.5, 0.5), _c, 0.03, 0.15); }
  }
  // disparo das automáticas
  if (canShoot() && G.state !== 'idle') {
    switch (name) {
      case 'pistols':
        if (xr) { if (rHeld && W.cdR <= 0) firePistol(false); if (lHeld && W.cdL <= 0) firePistol(true); }
        else if (rHeld && W.cd <= 0) { firePistol(W.pistolAlt++ % 2 === 1); W.cd = 0.11 / G.up.rate; }
        break;
      case 'shotgun': if (rHeld && W.cd <= 0) fireShotgun(); break;
      case 'launcher': if (rHeld && W.cd <= 0) fireLauncher(); break;
      case 'gatling': if (rHeld && W.cd <= 0) fireGatling(); break;
      case 'homing': if (rHeld && W.cd <= 0) fireHoming(); break;
      case 'tesla': if (rHeld && W.cd <= 0) fireTesla(); break;
      case 'fireworks': if (rHeld && W.cd <= 0) fireFireworks(); break;
      case 'laser': setLaser(rHeld); break;
    }
  } else setLaser(false);
  tickLaser(dt);
  updateCrackles(dt);
  updateUltimate(dt);
}
function placeHandEgg(m, ctrl) {
  ctrl.getWorldPosition(m.position); ctrl.getWorldQuaternion(_q);
  m.position.add(t5.set(0, -0.04, -0.05).applyQuaternion(_q));
  m.quaternion.copy(_q);
  m.visible = true;
}
