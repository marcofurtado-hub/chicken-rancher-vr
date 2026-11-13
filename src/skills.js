// =============================================================================
// HABILIDADES ATIVAS (estilo Archero) — escolha 1 de 3 cards atirando neles.
// Cada habilidade: ativa por 8 s com um botão, depois recarrega. Até 3 equipadas.
// Também o PASSARINHO (companheiro que voa sozinho e atira).
// =============================================================================
import { THREE, scene, camera, camPos, xrActive, isTouch, fitDistance, canvasTex, roundRect, toon, outlineMat, outlineGeo, bakeWith, sph, cone, box, FONT, FONT_UI } from './render.js';
import { G, rand, pick, tmpV, playing, SKILL_DUR, MAX_SLOTS, UP_DEFAULTS, MAX_CHICKENS } from './core.js';
import { tr } from './i18n.js';
import { SKILLS, INSTANTS, RARITY, CAT_LABEL } from './config.js';
import { sparks, popupAhead, popupStack, flashScreen, fitText, showBanner, muzzle, glow, twinkle, confetti } from './fx.js';
import { sfx } from './audio.js';
import { ufos, isAlive } from './ufos.js';
import { chickens, chickensAlive, setChickenShield, respawnChicken } from './chickens.js';
import { uiTargets, healPlayer } from './combat.js';
import { spawnEgg } from './weapons.js';
import { pulseAll } from './player.js';
import { startWave } from './game.js';

const [t0, t1, t2, t3, t4, t5] = tmpV(6);
const ALL_CARDS = SKILLS.concat(INSTANTS);
export const SKILL_KEYS_VR = ['B', 'Y', tr('GRIP D', 'R GRIP', 'O GRIP')];
export const SKILL_KEYS_PC = ['Q', 'E', 'F'];
export const skillKey = i => xrActive() ? SKILL_KEYS_VR[i] : (isTouch ? tr('toque', 'tap', 'napauta') : SKILL_KEYS_PC[i]);
export const slotOf = id => G.slots.find(x => x.sk.id === id);
export const skillCooldown = sl => 26 - (sl.lv - 1) * 4;

// ---------- Oferta (3.4: melhorias PERMANENTES com níveis, em G.lv) ----------
const lvOf = id => G.lv[id] || 0;
function cardAvail(x) {
  if (x.id === 'cash') return false;
  if (x.id === 'ninhada') return chickensAlive() <= MAX_CHICKENS - 2;
  return lvOf(x.id) < (x.max || 3);
}
export function buildOffer() {
  const pool = SKILLS.filter(cardAvail);
  const out = [];
  // galinhas em perigo: a ninhada sempre aparece
  if (G.waveLost >= 2 && pool.some(x => x.id === 'ninhada')) out.push(SKILLS.find(x => x.id === 'ninhada'));
  while (out.length < 3 && pool.some(x => !out.includes(x))) {
    const rest = pool.filter(x => !out.includes(x));
    out.push(pick(rest));
  }
  const cash = INSTANTS.find(x => x.id === 'cash');
  while (out.length < 3) out.push(cash);
  return out;
}
/** Modo teste: dá n melhorias aleatórias (como se tivesse escolhido nas waves anteriores). */
export function grantRandomUpgrades(n) {
  for (let i = 0; i < n; i++) { const o = buildOffer().filter(x => !x.instant); if (o.length) applyUpgrade(pick(o).id); }
}
function applyUpgrade(id) {
  if (id === 'ninhada') { respawnChicken('hen'); respawnChicken('hen'); return; }
  if (id === 'cash') { G.score += 1500; return; }
  G.lv[id] = lvOf(id) + 1;
  if (id === 'coracao') { G.hpMax += 25; G.hp = G.hpMax; }
  refreshUp();
}

// ---------- Habilidades ativas: removidas na 3.4 (botões B/Y/GRIP/Q/E/F não fazem mais nada) ----------
export function useSkill() {}
export function resetSkillsForWave() { refreshUp(); }
export function updateSkills() {}
// Os modificadores vêm das melhorias permanentes
export function refreshUp() {
  const up = G.up;
  Object.assign(up, UP_DEFAULTS);
  up.dmg = 1 + 0.25 * lvOf('forca');
  up.rate = 1 + 0.2 * lvOf('rapidez');
  up.front = lvOf('duplo');
  up.magnet = 1 + 0.6 * lvOf('mira');
}

// =============================================================================
// CARDS 3D (atire no card para escolher)
// =============================================================================
const CARD_GEO = new THREE.PlaneGeometry(1.15, 1.44);
const GLOW_GEO = new THREE.PlaneGeometry(1.6, 1.9);
const GLOW_TEX = canvasTex(256, 320, (x, w, h) => {
  roundRect(x, 30, 30, w - 60, h - 60, 30);
  x.shadowColor = '#fff'; x.shadowBlur = 30; x.strokeStyle = '#fff'; x.lineWidth = 14; x.stroke();
});
export const cards = [];
let chosen = false, leaveT = 0;
function drawCard(x, w, h, upg) {
  const R = RARITY[upg.rar] || RARITY.comum;
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, R.bg[0]); g.addColorStop(1, R.bg[1]);
  roundRect(x, 10, 10, w - 20, h - 20, 44);
  x.fillStyle = g; x.fill();
  if (upg.rar === 'epico') { x.shadowColor = R.col; x.shadowBlur = 34; }
  x.lineWidth = upg.rar === 'comum' ? 10 : 16; x.strokeStyle = R.col; x.stroke();
  x.shadowBlur = 0;
  // brilho diagonal
  x.save(); roundRect(x, 10, 10, w - 20, h - 20, 44); x.clip();
  const sh = x.createLinearGradient(0, 0, w, h * 0.5);
  sh.addColorStop(0, 'rgba(255,255,255,0.14)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)');
  x.fillStyle = sh; x.fillRect(0, 0, w, h);
  x.restore();
  x.textBaseline = 'middle';
  // faixa de categoria e raridade
  x.font = '800 28px ' + FONT_UI;
  x.textAlign = 'left'; x.fillStyle = '#ffffff'; x.fillText(CAT_LABEL[upg.cat] || '', 44, 60);
  x.textAlign = 'right'; x.fillStyle = R.col; x.fillText(R.label, w - 44, 60);
  // ícone num medalhão
  x.textAlign = 'center';
  const mg = x.createRadialGradient(w / 2, 210, 10, w / 2, 210, 120);
  mg.addColorStop(0, 'rgba(255,255,255,0.22)'); mg.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = mg; x.beginPath(); x.arc(w / 2, 210, 120, 0, Math.PI * 2); x.fill();
  x.font = '150px sans-serif'; x.fillText(upg.icon, w / 2, 215);
  // título e descrição
  x.lineJoin = 'round'; x.lineWidth = 10; x.strokeStyle = 'rgba(0,0,0,0.6)';
  x.font = '56px ' + FONT;
  wrapText(x, upg.title, w / 2, 372, w - 70, 60, true, '#ffd040');
  x.fillStyle = '#ffffff'; x.font = '800 32px ' + FONT_UI;
  wrapText(x, upg.desc, w / 2, 470, w - 80, 40, false, '#ffffff');
  if (upg.instant) fitText(x, tr('NA HORA', 'INSTANT', 'HETI'), w / 2, 585, w - 70, 30, FONT_UI, R.col, false, '800');
  else {
    const L = G.lv[upg.id] || 0, M = upg.max || 3;
    fitText(x, (L ? tr('NÍVEL ', 'LEVEL ', 'TASO ') + L + ' → ' + (L + 1) : tr('NOVA!', 'NEW!', 'UUSI!')) + ' · ' + upg.lvl[L], w / 2, 572, w - 70, 30, FONT_UI, R.col, false, '800');
    // bolinhas de nível: quanto falta para o máximo
    for (let k = 0; k < M; k++) {
      const cx = w / 2 + (k - (M - 1) / 2) * 34;
      x.beginPath(); x.arc(cx, 612, 11, 0, Math.PI * 2);
      x.fillStyle = k < L ? R.col : k === L ? '#ffffff' : 'rgba(255,255,255,0.18)'; x.fill();
    }
  }
}
function wrapText(ctx, text, x, y, maxW, lh, stroke, color) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  let yy = y - (lines.length - 1) * lh * 0.35;
  for (const l of lines) { if (stroke) ctx.strokeText(l, x, yy); ctx.fillStyle = color; ctx.fillText(l, x, yy); yy += lh; }
}
export function clearCards() {
  for (const c of cards) {
    scene.remove(c.mesh); c.mesh.material.map.dispose();   // material fica: descartar liberaria o shader
    const i = uiTargets.indexOf(c.target); if (i >= 0) uiTargets.splice(i, 1);
  }
  cards.length = 0;
}
export function showUpgradeCards(kind = 'normal') {
  clearCards();
  chosen = false; leaveT = 0;
  const pool = buildOffer(kind);
  const fwd = camera.getWorldDirection(new THREE.Vector3()); fwd.y = 0;
  if (fwd.lengthSq() < 1e-3) fwd.set(0, 0, 1);
  fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, THREE.Object3D.DEFAULT_UP);
  pool.forEach((upg, i) => {
    const tex = canvasTex(512, 640, (x, w, h) => drawCard(x, w, h, upg));
    tex.anisotropy = 4;
    const m = new THREE.Mesh(CARD_GEO, new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, fog: false, toneMapped: false }));
    const R = RARITY[upg.rar] || RARITY.comum;
    const halo = new THREE.Mesh(GLOW_GEO, new THREE.MeshBasicMaterial({ map: GLOW_TEX, color: R.hex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    halo.position.z = -0.01; m.add(halo);
    const base = camPos.clone().addScaledVector(fwd, fitDistance(2.25, 4.2)).addScaledVector(right, (i - 1) * 1.5);
    base.y = camPos.y + 0.1;
    m.position.copy(base); m.lookAt(camPos);
    m.scale.setScalar(0.01);
    m.renderOrder = 50;
    scene.add(m);
    const card = { mesh: m, halo, upg, base, done: false, chosen: false, phase: i * 1.3, appear: -i * 0.12, hover: 0 };
    card.target = { c: m.position, r: 0.72, active: true, onHit: () => chooseUpgrade(card) };
    uiTargets.push(card.target);
    cards.push(card);
  });
  G.state = 'upgrade'; G.stateT = 0;
  if (kind === 'boss') showBanner(tr('RECOMPENSA DO CHEFÃO', 'BOSS REWARD', 'POMON PALKINTO'), tr('mais uma melhoria', 'one more upgrade', 'yksi parannus lisää'), tr('atire no card', 'shoot a card', 'ammu korttia'), '#e080ff', 3.0, 1.15);
  else showBanner(tr('ESCOLHA UMA MELHORIA', 'CHOOSE AN UPGRADE', 'VALITSE PARANNUS'), tr('vale para o resto do jogo', 'lasts for the rest of the game', 'kestää koko pelin'), tr('atire no card', 'shoot a card', 'ammu korttia'), '#8dff4a', 3.0, 1.15);
  sfx('cardAppear');
}
export function chooseUpgrade(card) {
  if (chosen || card.done) return;
  chosen = true;
  const sk = card.upg;
  applyUpgrade(sk.id);
  const msg = sk.instant ? sk.title + '!' : sk.title + ' ' + tr('NÍVEL ', 'LEVEL ', 'TASO ') + G.lv[sk.id] + '!';
  const hint = sk.instant ? '' : sk.lvl[G.lv[sk.id] - 1] || '';
  for (const c of cards) { c.done = true; c.target.active = false; }
  card.chosen = true;
  const R = RARITY[card.upg.rar] || RARITY.comum;
  sfx('cardPick'); flashScreen(R.hex, 0.5);
  sparks(card.mesh.position, R.hex, card.upg.rar === 'epico' ? 50 : 30, 5, 0.08, 0.9); twinkle(card.mesh.position, R.hex, 10, 0.7, 0.2, 0.9); pulseAll(0.6, 150);
  if (card.upg.rar === 'epico') confetti(card.mesh.position, 40, 4);
  popupStack([[msg, R.col, 1.3, 1.8]].concat(hint ? [[hint, '#ffffff', 0.8, 1.8]] : []), t0.copy(card.mesh.position).setY(card.mesh.position.y + 0.9));
  leaveT = 1.2;
}
/** aimRay: { o, d } da mira atual, para destacar o card mirado. */
export function updateCards(dt, aimO, aimD) {
  for (const c of cards) {
    c.phase += dt;
    c.appear += dt;
    const m = c.mesh;
    if (!c.done) {
      // entra girando, depois flutua; cresce e brilha quando mirado
      const a = Math.min(1, Math.max(0, c.appear) / 0.45);
      const e = 1 - Math.pow(1 - a, 3);
      let aimed = false;
      if (aimO) { t1.copy(m.position).sub(aimO); const along = t1.dot(aimD); if (along > 0) { t2.copy(aimO).addScaledVector(aimD, along); aimed = t2.distanceTo(m.position) < 0.7; } }
      if (aimed && c.hover < 0.5) sfx('uiHover');
      c.hover += ((aimed ? 1 : 0) - c.hover) * Math.min(1, dt * 12);
      m.position.y = c.base.y + Math.sin(c.phase * 2) * 0.06;
      m.lookAt(camPos);
      m.rotateY((1 - e) * Math.PI);
      m.scale.setScalar(Math.max(0.01, e * (1 + c.hover * 0.08)));
      c.halo.material.opacity = (c.upg.rar === 'epico' ? 0.55 + Math.sin(G.time * 4) * 0.15 : 0.25) + c.hover * 0.5;
    } else if (c.chosen) {
      m.scale.multiplyScalar(1 + dt * 0.8);
      m.material.opacity = Math.max(0, m.material.opacity - dt * 0.9);
      c.halo.material.opacity = m.material.opacity;
    } else {
      m.position.y -= dt * 3;
      m.material.opacity = Math.max(0, m.material.opacity - dt * 1.5);
      c.halo.material.opacity = 0;
    }
  }
  if (chosen && G.state === 'upgrade') {
    leaveT -= dt;
    if (leaveT <= 0) {
      clearCards();
      if (G.pendingPicks > 0) { G.pendingPicks--; showUpgradeCards('boss'); }
      else startWave(G.wave + 1);
    }
  }
}

// =============================================================================
// PASSARINHO — voa sozinho pelo quintal caçando a nave mais urgente
// =============================================================================
export const birds = [];
const BIRD_BODY = bakeWith(g => {
  const b = sph(g, 0.09, 0x3a8ae0, 0, 0, 0, 12, 10); b.scale.set(1, 0.9, 1.3);
  sph(g, 0.066, 0xf6f6f6, 0, -0.03, 0.04, 10, 8);
  sph(g, 0.062, 0x3a8ae0, 0, 0.07, 0.09, 10, 8);
  const bk = cone(g, 0.02, 0.06, 6, 0xffa020, 0, 0.06, 0.16); bk.rotation.x = Math.PI / 2;
  for (const sx of [-1, 1]) { sph(g, 0.016, 0xffffff, sx * 0.032, 0.09, 0.135, 6, 5); sph(g, 0.01, 0x101018, sx * 0.034, 0.092, 0.145, 6, 4); }
  const t = box(g, 0.08, 0.02, 0.1, 0x2a6ac0, 0, 0.01, -0.14); t.rotation.x = 0.3;
});
const BIRD_WING = bakeWith(g => { const w = sph(g, 0.08, 0x2a6ac0, 0.08, 0, 0, 8, 6); w.scale.set(1, 0.15, 0.55); });
const BIRD_MAT = toon({ ramp: 4 }), BIRD_OUT = outlineMat(0.008, 0x101828);
export function spawnBirds(n, lv) {
  for (let i = 0; i < n; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(BIRD_BODY, BIRD_MAT); body.add(new THREE.Mesh(outlineGeo(BIRD_BODY), BIRD_OUT)); g.add(body);
    const wl = new THREE.Mesh(BIRD_WING, BIRD_MAT); wl.position.set(0.04, 0.02, 0); g.add(wl);
    const wr = new THREE.Mesh(BIRD_WING, BIRD_MAT); wr.position.set(-0.04, 0.02, 0); wr.rotation.y = Math.PI; g.add(wr);
    g.scale.setScalar(1.5);
    g.position.copy(camPos).add(t0.set(i ? 0.5 : -0.5, 0.3, 0));
    scene.add(g);
    birds.push({ g, wl, wr, life: SKILL_DUR, cd: 0.3 + i * 0.25, lv, phase: rand(0, 6), vel: new THREE.Vector3(0, 2, 0) });
  }
  sfx('chirp');
}
export function clearBirds() { for (const b of birds) scene.remove(b.g); birds.length = 0; }
export function updateBirds(dt) {
  for (let i = birds.length - 1; i >= 0; i--) {
    const b = birds[i], gp = b.g.position;
    b.life -= dt;
    const flap = Math.sin(G.time * 26 + b.phase) * 0.8;
    b.wl.rotation.z = flap; b.wr.rotation.z = -flap;
    glow(gp.x, gp.y, gp.z, 0.5, 0x80c0ff, 0.35);
    if (b.life <= 0) {
      gp.y += dt * 6;
      b.g.scale.multiplyScalar(Math.max(0, 1 - dt * 0.8));
      if (b.life < -1.5) { scene.remove(b.g); birds.splice(i, 1); }
      continue;
    }
    let tgt = null, bd = Infinity;
    for (const u of ufos) {
      if (!isAlive(u)) continue;
      const pt = u.parts.find(q => q.active && q.kind !== 'armor');
      if (!pt) continue;
      const d = pt.c.distanceTo(gp) - (u.state === 'beaming' || u.state === 'flee' ? 8 : 0);
      if (d < bd) { bd = d; tgt = pt; }
    }
    const want = t1;
    if (tgt) want.copy(tgt.c).add(t2.set(Math.cos(G.time * 1.5 + b.phase) * 3, 1.2, Math.sin(G.time * 1.5 + b.phase) * 3));
    else want.set(Math.cos(G.time * 0.8 + b.phase) * 5, 5 + Math.sin(G.time + b.phase), 8 + Math.sin(G.time * 0.8 + b.phase) * 5);
    const to = t3.copy(want).sub(gp);
    const d = to.length();
    if (d > 1e-3) b.vel.lerp(to.divideScalar(d).multiplyScalar(Math.min(9, d * 2)), Math.min(1, dt * 3));
    gp.addScaledVector(b.vel, dt);
    if (b.vel.lengthSq() > 0.01) b.g.lookAt(t4.copy(gp).add(b.vel));
    if (!tgt || !playing()) continue;
    b.cd -= dt;
    if (b.cd <= 0 && tgt.c.distanceTo(gp) < 14) {
      const dir = t5.copy(tgt.c).sub(gp).normalize();
      spawnEgg(gp, dir.multiplyScalar(32), { damage: 2 + b.lv, maxLife: 1.5, magnet: 3, scale: 0.7, noRicochet: true });
      muzzle(gp, 0x80c0ff, 0.15);
      b.cd = 0.45;
    }
  }
}
