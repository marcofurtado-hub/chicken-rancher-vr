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

// ---------- Oferta ----------
function cardAvail(x) {
  if (x.id === 'cash') return false;
  if (x.instant) {
    if (x.id === 'canja') return G.hp < G.hpMax * 0.8;
    if (x.id === 'angel') return chickensAlive() < MAX_CHICKENS - 1;
    if (x.id === 'heart') return G.hpMax < 160;
    return true;
  }
  const sl = slotOf(x.id);
  if (sl) return sl.lv < 3;
  return G.slots.length < MAX_SLOTS;
}
function rollRarity() {
  const r = Math.random();
  const [c, ra] = G.wave < 3 ? [0.62, 0.30] : G.wave < 7 ? [0.50, 0.36] : [0.40, 0.40];
  return r < c ? 'comum' : r < c + ra ? 'raro' : 'epico';
}
export function buildOffer(kind) {
  let epicCat = null;
  if (kind === 'first') epicCat = 'atk';
  else if (kind === 'boss') epicCat = pick(['atk', 'def', 'atk']);
  const taken = new Set(), out = [];
  const cash = INSTANTS.find(x => x.id === 'cash');
  for (const cat of ['atk', 'egg', 'def']) {
    let pool = ALL_CARDS.filter(x => x.cat === cat && cardAvail(x) && !taken.has(x.id));
    if (!pool.length) pool = ALL_CARDS.filter(x => cardAvail(x) && !taken.has(x.id));
    if (!pool.length) { out.push(cash); continue; }
    const rar = cat === epicCat ? 'epico' : rollRarity();
    const order = rar === 'epico' ? ['epico', 'raro', 'comum'] : rar === 'raro' ? ['raro', 'comum', 'epico'] : ['comum', 'raro', 'epico'];
    let cand = [];
    for (const rr of order) { cand = pool.filter(x => x.rar === rr); if (cand.length) break; }
    const owned = cand.filter(x => slotOf(x.id));
    const choice = owned.length && Math.random() < 0.4 ? pick(owned) : pick(cand);
    taken.add(choice.id);
    out.push(choice);
  }
  if (G.waveLost >= 2) {
    const a = INSTANTS.find(x => x.id === 'angel');
    if (cardAvail(a) && !taken.has('angel')) out[2] = a;
  } else if (G.hp < G.hpMax * 0.45) {
    const c = INSTANTS.find(x => x.id === 'canja');
    if (cardAvail(c) && !taken.has('canja')) out[2] = c;
  }
  return out;
}
function applyInstant(id) {
  if (id === 'canja') healPlayer(50);
  else if (id === 'angel') { respawnChicken('hen'); respawnChicken('hen'); }
  else if (id === 'heart') { G.hpMax += 20; healPlayer(20); }
  else if (id === 'cash') G.score += 1500;
}

// ---------- Usar ----------
export function useSkill(i) {
  const sl = G.slots[i];
  if (!sl || !playing()) return;
  if (sl.active > 0) return;
  if (sl.cd > 0) { sfx('denied'); popupAhead(sl.sk.icon + tr(' recarregando ', ' recharging ', ' latautuu ') + Math.ceil(sl.cd) + 's', '#aaaaaa', 0.7); return; }
  sl.active = SKILL_DUR;
  onSkillStart(sl);
  refreshUp();
  const R = RARITY[sl.sk.rar] || RARITY.comum;
  sfx('skillOn'); flashScreen(R.hex, 0.35); pulseAll(0.5, 80);
  popupAhead(sl.sk.icon + ' ' + sl.sk.title + '! 8s', R.col, 1.0);
}
function onSkillStart(sl) {
  if (sl.sk.id === 'feather') for (const c of chickens) if (c.state !== 'gone') { setChickenShield(c, true); c.shieldHits = sl.lv >= 3 ? 2 : 1; }
  if (sl.sk.id === 'bird') spawnBirds(sl.lv >= 3 ? 2 : 1, sl.lv);
  if (sl.sk.id === 'bubble') sfx('bubble');
}
function onSkillEnd(sl) {
  if (sl.sk.id === 'feather') for (const c of chickens) setChickenShield(c, false);
  sl.cd = skillCooldown(sl);
}
export function resetSkillsForWave() {
  for (const sl of G.slots) { if (sl.active > 0) { sl.active = 0; onSkillEnd(sl); } sl.cd = 0; }
  refreshUp();
}
export function updateSkills(dt) {
  for (let i = 0; i < G.slots.length; i++) {
    const sl = G.slots[i];
    if (sl.active > 0) { sl.active -= dt; if (sl.active <= 0) { sl.active = 0; onSkillEnd(sl); } }
    else if (sl.cd > 0) {
      sl.cd -= dt;
      if (sl.cd <= 0) {
        sl.cd = 0;
        if (playing()) { sfx('skillReady'); popupAhead(sl.sk.icon + tr(' PRONTO! (', ' READY! (', ' VALMIS! (') + skillKey(i) + ')', '#8dff4a', 0.6); }
      }
    }
  }
  refreshUp();
}
// Os efeitos só existem enquanto a habilidade está ativa
export function refreshUp() {
  const up = G.up;
  Object.assign(up, UP_DEFAULTS);
  for (const sl of G.slots) {
    if (sl.active <= 0) continue;
    const L = sl.lv;
    switch (sl.sk.id) {
      case 'fan': up.diag = L >= 2 ? 2 : 1; break;
      case 'double': up.front = L >= 2 ? 2 : 1; break;
      case 'fury': up.dmg = 1.25 + 0.25 * L; break;
      case 'turbo': up.rate = 1.25 + 0.25 * L; break;
      case 'eagle': up.critChance = 0.2 + 0.15 * L; break;
      case 'fire': up.fire = L; break;
      case 'ice': up.ice = L >= 2 ? 2 : 1; break;
      case 'shock': up.shock = L; break;
      case 'bounce': up.ricochet = L + 1; break;
      case 'pierce': up.pierce = L + 1; break;
      case 'slowmo': up.slowSkill = [1, 0.4, 0.3, 0.25][L]; break;
      case 'bubble': up.bubble = 1; break;
    }
  }
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
  if (upg.instant) fitText(x, tr('EFEITO NA HORA', 'INSTANT EFFECT', 'VÄLITÖN VAIKUTUS'), w / 2, 585, w - 70, 28, FONT_UI, R.col, false, '800');
  else {
    const sl = slotOf(upg.id);
    const L = sl ? sl.lv : 0;
    fitText(x, sl ? tr('NÍVEL ', 'LEVEL ', 'TASO ') + L + ' → ' + (L + 1) + ': ' + upg.lvl[L] : tr('ATIVA · 8s · ', 'ACTIVE · 8s · ', 'AKTIIVINEN · 8 s · ') + upg.lvl[0], w / 2, 572, w - 70, 28, FONT_UI, R.col, false, '800');
    fitText(x, tr('recarga ', 'cooldown ', 'lataus ') + (26 - L * 4) + tr('s · até 3 habilidades', 's · up to 3 skills', ' s · enintään 3 kykyä'), w / 2, 608, w - 70, 24, FONT_UI, '#c0c8b8', false, '700');
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
  const keys = xrActive() ? 'B · Y · ' + tr('GRIP direito', 'right GRIP', 'oikea GRIP') : (isTouch ? tr('botões na tela', 'on-screen buttons', 'näytön napit') : 'Q · E · F');
  if (kind === 'boss') showBanner(tr('RECOMPENSA DO CHEFÃO', 'BOSS REWARD', 'POMON PALKINTO'), tr('uma habilidade ÉPICA te espera', 'an EPIC skill awaits', 'EEPPINEN kyky odottaa'), tr('atire no card', 'shoot a card', 'ammu korttia'), '#e080ff', 3.5, 1.15);
  else if (kind === 'first') showBanner(tr('PRIMEIRA HABILIDADE!', 'FIRST SKILL!', 'ENSIMMÄINEN KYKY!'), tr('habilidades duram 8s e recarregam', 'skills last 8s, then recharge', 'kyvyt kestävät 8 s ja latautuvat'), tr('você ativa com ', 'activate with ', 'aktivoi: ') + keys, '#8dff4a', 4, 1.15);
  else showBanner(tr('ESCOLHA UMA HABILIDADE', 'CHOOSE A SKILL', 'VALITSE KYKY'), tr('atire no card · ativa com ', 'shoot a card · activate with ', 'ammu korttia · aktivoi: ') + keys, tr('ATAQUE · OVO · DEFESA', 'ATTACK · EGG · DEFENSE', 'HYÖKKÄYS · MUNA · PUOLUSTUS'), '#8dff4a', 3.5, 1.15);
  sfx('cardAppear');
}
export function chooseUpgrade(card) {
  if (chosen || card.done) return;
  chosen = true;
  const sk = card.upg;
  let msg, hint = '';
  if (sk.instant) { applyInstant(sk.id); msg = sk.title + '!'; }
  else {
    let sl = slotOf(sk.id);
    if (sl) { sl.lv++; sl.cd = 0; msg = sk.title + tr(' NÍVEL ', ' LEVEL ', ' TASO ') + sl.lv + '!'; }
    else { G.slots.push({ sk, lv: 1, active: 0, cd: 0 }); sl = G.slots[G.slots.length - 1]; msg = tr('NOVA: ', 'NEW: ', 'UUSI: ') + sk.title + '!'; }
    hint = tr('aperte ', 'press ', 'paina ') + skillKey(G.slots.indexOf(sl)) + tr(' pra usar', ' to use', ' käyttääksesi');
  }
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
