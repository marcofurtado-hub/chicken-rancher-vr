// =============================================================================
// COMBATE — colisão (swept segment contra elipsoides), dano, efeitos de impacto,
// morte das naves, pontos/combo, power-ups e a vida do jogador.
// =============================================================================
import { THREE, camPos, xrActive } from './render.js';
import { G, clamp, rand, pick, tmpV, comboMult, comboWindow, playing, MAX_CHICKENS } from './core.js';
import { tr } from './i18n.js';
import { UFO_TYPES, POWERS, CHICKEN_KINDS } from './config.js';
import { sparks, fireball, blast, popup, popupStack, popupAhead, eggBurst, feathers, bolt, flashScreen, ov, debrisBurst, showBanner, confetti, twinkle } from './fx.js';
import { sfx, stinger } from './audio.js';
import { ufos, eproj, crates, isAlive, removeUfo, removeCrate, destroyEproj, spawnRegular, stopBeam, exposeCore, drawHpBar, spawnCrate, EP_DEF, CRATE_RX, CRATE_RY } from './ufos.js';
import { chickens, chickensAlive, removeChicken, respawnChicken, scareChicken, INITIAL_FLOCK } from './chickens.js';
import { pulseAll } from './player.js';
import { enterGameOver, clearQueue } from './game.js';

const [t0, t1, t2, t3, t4, t5, t6] = tmpV(7);

// Alvos de interface atingíveis por tiro (cards de habilidade, botões do menu 3D)
// Cada um: { c: Vector3, r, active: bool, onHit(pos) }
export const uiTargets = [];

// ---------- Colisão ----------
export function rayEllipsoidT(o, d, c, ax, ay, az, maxT) {
  const ox = (o.x - c.x) / ax, oy = (o.y - c.y) / ay, oz = (o.z - c.z) / az;
  const dx = d.x / ax, dy = d.y / ay, dz = d.z / az;
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (ox * dx + oy * dy + oz * dz);
  const cc = ox * ox + oy * oy + oz * oz - 1;
  if (cc <= 0) return 0;
  if (a < 1e-12) return -1;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return (t >= 0 && t <= maxT) ? t : -1;
}
/** Primeiro acerto ao longo de o + d·t, t ∈ [0, maxT]. */
export function castSegment(o, d, maxT, extraR = 0, skip = null) {
  let best = null, bt = Infinity, subHit = null;
  for (const u of ufos) {
    if (!isAlive(u) || (skip && skip.has(u))) continue;
    for (const p of u.parts) {
      if (!p.active) continue;
      const t = p.ellip
        ? rayEllipsoidT(o, d, p.c, p.ellip[0] + extraR, p.ellip[1] + extraR, p.ellip[2] + extraR, maxT)
        : rayEllipsoidT(o, d, p.c, p.r + extraR, p.r + extraR, p.r + extraR, maxT);
      if (t >= 0 && t < bt) { bt = t; best = { kind: 'ufo', u, part: p, t }; }
      if (t >= 0 && p.kind === 'sub' && (!subHit || t < subHit.t)) subHit = { kind: 'ufo', u, part: p, t };
    }
  }
  // chefe protegido: se o raio passa por uma placa/drone dele, ela tem prioridade sobre o corpo blindado
  if (best && best.kind === 'ufo' && best.u.invuln && subHit && subHit.u === best.u) { best = subHit; bt = subHit.t; }
  for (const g of eproj) {
    if (g.dead) continue;
    const r = EP_DEF[g.type].r + extraR, t = rayEllipsoidT(o, d, g.pos, r, r, r, maxT);
    if (t >= 0 && t < bt) { bt = t; best = { kind: 'eproj', g, t }; }
  }
  for (const cr of crates) {
    const rx = CRATE_RX + extraR, ry = CRATE_RY + extraR, t = rayEllipsoidT(o, d, cr.c, rx, ry, rx, maxT);
    if (t >= 0 && t < bt) { bt = t; best = { kind: 'crate', cr, t }; }
  }
  for (const ut of uiTargets) {
    if (!ut.active) continue;
    const r = ut.r + extraR, t = rayEllipsoidT(o, d, ut.c, r, r, r, maxT);
    if (t >= 0 && t < bt) { bt = t; best = { kind: 'ui', ut, t }; }
  }
  return best;
}
export function applyHit(hit, dmg, pos) {
  if (hit.kind === 'ufo') hitPart(hit.u, hit.part, dmg, pos);
  else if (hit.kind === 'eproj') destroyEproj(hit.g, true);
  else if (hit.kind === 'crate') collectCrate(hit.cr);
  else if (hit.kind === 'ui') hit.ut.onHit(pos);
}
export function collectCrate(cr) { const p = cr.c.clone(); removeCrate(cr); activatePower(cr.type, p); }

/** Lista de pontos que o ímã/teleguiado podem perseguir. */
export function forEachAimable(fn) {
  for (const u of ufos) { if (!isAlive(u)) continue; for (const pt of u.parts) if (pt.active && pt.kind !== 'armor') fn(pt.c, u, pt); }
  for (const g of eproj) if (!g.dead) fn(g.pos, null, null);
  for (const cr of crates) fn(cr.c, null, null);
  for (const ut of uiTargets) if (ut.active) fn(ut.c, null, null);
}

// ---------- Explosões em área ----------
export function aoeDamage(pos, R, dmg) {
  let n = 0;
  for (const u of ufos.slice()) {
    if (!isAlive(u)) continue;
    let bestP = null, bd = Infinity;
    for (const p of u.parts.slice()) {
      if (!p.active || p.kind === 'armor') continue;
      const d = p.c.distanceTo(pos) - (p.ellip ? p.ellip[1] : p.r);
      if (d >= R) continue;
      if (p.kind === 'sub') { hitPart(u, p, dmg, p.c.clone(), false); n++; if (!isAlive(u)) break; continue; }
      if (d < bd) { bd = d; bestP = p; }
    }
    if (bestP && isAlive(u)) { hitPart(u, bestP, dmg, bestP.c.clone(), false); n++; }
  }
  for (const g of eproj) if (!g.dead && g.pos.distanceTo(pos) < R) destroyEproj(g, true);
  for (const cr of crates.slice()) if (cr.c.distanceTo(pos) < R + CRATE_RX) collectCrate(cr);
  return n;
}
export function explodeAt(posIn, o) {
  const pos = t6.copy(posIn).clone();
  const R = o.boomR || 2.8;
  const dmg = (o.boomDmg || 2) * G.up.dmg * (o.golden ? 3 : 1);
  fireball(pos, R * 0.45); blast(pos, R, 0xff8030); sfx('explosionSmall', { pos }); pulseAll(0.4, 60);
  aoeDamage(pos, R, dmg);
  for (const ck of chickens) if (Math.hypot(ck.pos.x - pos.x, ck.pos.z - pos.z) < R && pos.y < 2) scareChicken(ck, pos);
}

// ---------- Efeitos de impacto (fogo, gelo, choque) ----------
function applyStatus(u, dmg, pos) {
  const up = G.up;
  if (up.fire) { u.burnT = 3; u.burnDps = Math.max(u.burnDps || 0, dmg * 0.2 * up.fire); }
  if (up.ice && u.kind !== 'mother') { u.slowT = 2.5; u.slowMul = up.ice >= 2 ? 0.4 : 0.6; }
  if (up.shock && G.time - (u.shockT || -9) > 0.3) {
    u.shockT = G.time;
    const near = [];
    for (const o of ufos) {
      if (o === u || !isAlive(o)) continue;
      const p = o.parts.find(q => q.active && q.kind !== 'armor');
      if (p && p.c.distanceTo(pos) < 6) near.push({ o, p, d: p.c.distanceTo(pos) });
    }
    near.sort((a, b) => a.d - b.d);
    for (const x of near.slice(0, 1 + up.shock)) { const to = x.p.c.clone(); bolt(pos, to, 0.12, 0.12); hitPart(x.o, x.p, dmg * 0.35, to, false); }
    if (near.length) sfx('teslaChain', { pos });
  }
}

// ---------- Dano ----------
/** fx=true → tiro direto do jogador (crítico, status, marcador). fx=false → dano secundário (sem recursão). */
export function hitPart(u, part, dmg, pos, fx = true) {
  if (!isAlive(u)) return;
  if (u.shieldedBy && isAlive(u.shieldedBy)) {
    sparks(pos, 0x70b0ff, 5, 3); sfx('shieldTink', { pos });
    if (G.time - u.lastPop > 1.4) { popup(tr('ESCUDO!', 'SHIELD!', 'SUOJA!'), pos, '#80c0ff', 0.8, 0.8); u.lastPop = G.time; }
    return;
  }
  // gancho da peça: o chefe decide o que acontece (ex.: tentáculo solta a galinha). true = já tratou
  if (part.onHit && part.onHit(u, part, dmg, pos, fx)) { if (fx) { G.waveHits++; G.hitMarkT = 0.12; } return; }
  // peças de chefe com vida própria (balões, gomos, abelhas, nuvens...)
  if (part.kind === 'sub') {
    if (fx) { G.waveHits++; G.hitMarkT = 0.12; }
    part.hp -= dmg; part.flashT = 0.1;
    sparks(pos, 0xffffff, 5, 3); sfx('eggHitUfo', { pos });
    if (part.hp <= 0) {
      part.active = false;
      if (!part.keepVisible) part.obj.visible = false;
      fireball(part.c, 0.5); sfx('explosionSmall', { pos: part.c }); pulseAll(0.5, 80);
      addScore(200, part.c, '+200', '#ffe080', 0.9);
      if (part.onDown) part.onDown(u, part);
    }
    return;
  }
  // chefe protegido (olho fechado, escudo da colmeia...): o corpo não toma dano
  if (u.invuln) {
    sparks(pos, u.invuln === 'shield' ? 0x70b0ff : 0xffe080, 5, 3); sfx(u.invuln === 'shield' ? 'shieldTink' : 'tink', { pos });
    if (G.time - u.lastPop > 1.4) { popup(u.invulnMsg || tr('PROTEGIDO!', 'PROTECTED!', 'SUOJATTU!'), pos, '#dddddd', 0.9, 1); u.lastPop = G.time; }
    return;
  }
  if (part.kind === 'armor') {
    sparks(pos, 0xffe080, 5, 3); sfx('tink', { pos });
    if (G.time - u.lastPop > 1.6) { popup(u.armorMsg || tr('BLINDADO!', 'ARMORED!', 'PANSSAROITU!'), pos, '#cccccc', 0.9, 0.8); u.lastPop = G.time; }
    return;
  }
  if (fx) {
    G.waveHits++;
    if (G.up.critChance && Math.random() < G.up.critChance) {
      dmg *= 2; sfx('crit', { pos });
      if (G.time - u.lastPop > 0.6) { popup(tr('CRÍTICO!', 'CRITICAL!', 'KRIITTINEN!'), pos, '#ff6040', 0.9, 0.8); u.lastPop = G.time; }
    }
    G.hitMarkT = 0.12;
  }
  if (part.kind === 'pod') {
    part.hp -= dmg; part.flashT = 0.08;
    if (fx && part.hp > 0) applyStatus(u, dmg, pos);
    sparks(pos, 0xff4060, 4, 3); sfx('eggHitUfo', { pos }); drawHpBar(u);
    if (part.hp <= 0) {
      part.active = false; part.obj.visible = false;
      fireball(part.c, 1.4); blast(part.c, 2.5, 0xff4060); sfx('ufoExplode', { pos: part.c }); pulseAll(0.7, 150);
      debrisBurst(part.c, 0xff3050, 10, 4);
      addScore(800, part.c, tr('MÓDULO! +800', 'POD! +800', 'MODUULI! +800'), '#ff60a0', 1.2);
      if (!u.parts.some(p => p.kind === 'pod' && p.active)) exposeCore(u);
    }
    return;
  }
  u.hp -= dmg * part.mult;
  if (u.onDamaged) u.onDamaged(u, dmg * part.mult, part);
  u.flashT = 0.09;
  u.wobble = Math.min(1, (u.wobble || 0) + 0.5);
  if (part.mult > 1) {
    sfx('crit', { pos });
    if (G.time - u.lastPop > 0.6) { popup(tr('CRÍTICO!', 'CRITICAL!', 'KRIITTINEN!'), pos, '#ff6040', 0.9, 0.8); u.lastPop = G.time; }
  }
  if (u.hp <= 0) { killUfo(u, pos); return; }
  if (fx) applyStatus(u, dmg, pos);
  sfx('eggHitUfo', { pos }); pulseAll(0.2, 30);
  sparks(pos, 0xffd040, 3, 3, 0.05, 0.4);
  if (u.hpBar) drawHpBar(u);
}

export function killUfo(u, hitPos) {
  if (!isAlive(u)) return;
  const wasBeaming = (u.state === 'beaming' || u.state === 'grab' || u.state === 'flee') && u.target && u.target.state === 'abducting' && u.target.abductor === u;
  const prog = wasBeaming ? (u.state === 'beaming' ? u.beamElapsed / u.beamDur : 0.8) : 0;
  if (wasBeaming) rescueChicken(u.target);
  for (const c of chickens) if (c.state === 'abducting' && c.abductor === u) rescueChicken(c);
  stopBeam(u);
  if (u.links && u.links.length) { for (const t of u.links) if (t.shieldedBy === u) t.shieldedBy = null; u.links.length = 0; }
  G.waveKills++;
  const pos = u.pos.clone();
  if (u.hpBar) { u.hpBar.parent && u.hpBar.parent.remove(u.hpBar); u.hpBar = null; }
  if (u.bubble) u.bubble.visible = false;
  registerKill(u, pos, wasBeaming, prog);
  if (u.kind === 'mother') {
    u.state = 'dying'; u.deadT = 0;
    clearQueue();
    for (const o of ufos) if (o !== u && isAlive(o)) o.chainT = rand(0.3, 2.5);
    showBanner(tr('NAVE-MÃE DESTRUÍDA!', 'MOTHERSHIP DESTROYED!', 'EMOALUS TUHOTTU!'), tr('que ovada!', 'what an egging!', 'mikä munasade!'), '', '#ff60ff', 3);
    hitStop(0.35);
    return;
  }
  u.state = 'dead'; u.deadT = 0;
  u.deadVel.set(rand(-1.5, 1.5), -1.5, rand(-1.5, 1.5));
  u.bodyMat.emissive.setHex(0x401000); u.bodyMat.color.setScalar(0.6);
  if (u.typeKey === 'ghost') { u.bodyMat.opacity = 1; u.alien.visible = true; u.outline.visible = true; }
  fireball(pos, 0.45 * u.scaleW + 0.3);
  sparks(pos, u.T.glow, 14, 5);
  eggBurst(pos, G.power.golden > 0, 8);
  debrisBurst(pos, u.T.color, u.kind === 'boss' ? 18 : 6, 3);
  sfx('ufoExplode', { pos });
  if (u.kind === 'boss' && u.vet) { blast(pos, 3, 0xff8030); pulseAll(0.6, 120); confetti(pos, 20, 4); }
  else if (u.kind === 'boss') {
    blast(pos, 4, 0xff8030); pulseAll(0.95, 250); hitStop(0.25); confetti(pos, 50, 5);
    sfx('bossDeath', { pos });
    showBanner((u.D ? u.D.name + ' ' : '') + tr('DERROTADO!', 'DEFEATED!', 'KUKISTETTU!'), '', '', '#ffd040', 2.2);
  } else pulseAll(0.45, 80);
  if (u.typeKey === 'splitter') {
    for (let k = 0; k < 2; k++) spawnRegular('mini', t0.copy(pos).add(t1.set(k ? 0.7 : -0.7, 0.2, 0)));
    popup(tr('DIVIDIU!', 'SPLIT!', 'JAKAUTUI!'), t0.copy(pos).setY(pos.y + 0.6), '#a0ffe8', 0.9);
  }
  maybeDropCrate(u, pos);
}

/** Congela o jogo por um instante: peso nos golpes grandes. */
// no VR a cabeça continua se mexendo e o mundo "trava": parece queda de quadros. Só no PC/celular.
export function hitStop(t) { if (xrActive()) return; G.hitStop = Math.max(G.hitStop, t); }

// ---------- Pontos e combo ----------
export function addScore(pts, pos, text, color = '#ffd040', size = 1) {
  G.score += pts;
  if (text) popup(text, pos, color, size);
}
export function registerKill(u, pos, rescued, prog) {
  G.combo++; G.comboT = comboWindow();
  const mult = comboMult();
  const lines = [];
  let base = u.pts;
  if (rescued) {
    if (prog > 0.72) { base += 600; lines.push([tr('NA HORA H!', 'JUST IN TIME!', 'VIIME HETKELLÄ!'), '#ff70ff', 0.9]); }
    else { base += 300; lines.push([tr('RESGATE!', 'RESCUE!', 'PELASTUS!'), '#60e0ff', 0.9]); }
  }
  if (u.kind === 'ufo' && pos.distanceTo(camPos) > 17) { base += 100; lines.push([tr('DE LONGE!', 'LONG SHOT!', 'KAUKAA!'), '#ffffff', 0.8]); }
  if (G.time - G.lastKillT < 0.25) G.multiN++; else G.multiN = 1;
  G.lastKillT = G.time;
  if (G.multiN === 2) { base += 100; lines.push([tr('DUPLO!', 'DOUBLE!', 'TUPLA!'), '#ffa040', 0.9]); sfx('multiKill', { pitch: 1 }); }
  else if (G.multiN === 3) { base += 250; lines.push([tr('TRIPLO!', 'TRIPLE!', 'TRIPLA!'), '#ff7040', 1]); sfx('multiKill', { pitch: 1.2 }); }
  else if (G.multiN >= 4) { base += 400; lines.push([tr('MASSACRE!', 'MASSACRE!', 'JOUKKOTUHO!'), '#ff3030', 1.1]); sfx('multiKill', { pitch: 1.4 }); hitStop(0.06); }
  const pts = Math.round(base * mult);
  G.score += pts;
  lines.unshift(['+' + pts, '#ffd040', u.kind === 'ufo' ? 1 : 1.6]);
  if (mult > G.lastMult) { lines.push(['COMBO x' + mult + '!', '#8dff4a', 1.1]); sfx('combo', { pitch: 1 + (mult - 2) * 0.12 }); }
  G.lastMult = mult;
  popupStack(lines, pos);
  addUlt(u.kind === 'ufo' ? 0.045 + 0.01 * mult : 0.25);
}
export function resetCombo() { G.combo = 0; G.comboT = 0; G.lastMult = 1; }

// ---------- Medidor da CHUVA DE OVOS ----------
export function addUlt(x) {
  if (G.ultActive > 0) return;
  const before = G.ult;
  G.ult = Math.min(1, G.ult + x);
  if (before < 1 && G.ult >= 1) {
    sfx('skillReady'); stinger('levelUp');
    popupAhead(tr('🥚 CHUVA DE OVOS PRONTA!', '🥚 EGG STORM READY!', '🥚 MUNASADE VALMIS!'), '#ffe060', 1.0, 1.6);
  }
}

// ---------- Power-ups ----------
function pickPowerType() {
  // 3.4: só 3 caixas — ouro (mais comum), câmera lenta e cura (quando precisa)
  const pool = ['golden', 'golden', 'golden', 'slow', 'slow'];
  if (G.hp < G.hpMax * 0.7) pool.push('heal', 'heal');
  if (G.hp < G.hpMax * 0.4) pool.push('heal', 'heal', 'heal');
  return pick(pool);
}
function maybeDropCrate(u, pos) {
  if (!playing()) return;
  if (crates.length >= 2) return;
  G.killsSinceDrop++;
  const chance = u.kind === 'boss' ? 1 : (UFO_TYPES[u.typeKey].drop || 0);
  if (Math.random() < chance || G.killsSinceDrop >= 12) { G.killsSinceDrop = 0; spawnCrate(pickPowerType(), pos); }
}
export function activatePower(type, pos) {
  const Pw = POWERS[type];
  if (type === 'chicken') {
    if (chickensAlive() < MAX_CHICKENS) { const c = respawnChicken('hen'); popup('+1 ' + CHICKEN_KINDS.hen.label.toUpperCase(), c.pos, '#ffffff', 1.1, 1.5); }
    else G.score += 500;
  } else if (type === 'heal') healPlayer(30);
  else G.power[type] = Pw.dur;
  const lines = [[Pw.icon + ' ' + Pw.label, Pw.css, 1.4, 1.6]];
  if (Pw.sub) lines.push([Pw.sub, '#ffffff', 0.9, 1.6]);
  popupStack(lines, pos);
  sfx('powerup'); sfx('crateOpen', { pos }); flashScreen(Pw.color, 0.5);
  sparks(pos, Pw.color, 24, 5, 0.08, 0.8); twinkle(pos, Pw.color, 8, 0.6, 0.18, 0.8); pulseAll(0.6, 120);
}

// ---------- Galinhas ----------
export function rescueChicken(c) {
  c.state = 'safe'; c.fallVel = 0; c.abductor = null;
  sfx('rescue', { pos: c.pos });
  feathers(c.pos, 6, c.kind === 'golden' ? 0xffd040 : 0xffffff);
}
export function abductChicken(c, u) {
  removeChicken(c);
  c.state = 'gone'; c.abductor = null;
  G.waveLost++;
  resetCombo();
  sfx('abducted', { pos: u.pos }); ov.hurt = 0.45; pulseAll(0.6, 220);
  const left = chickensAlive();
  popupStack([[c.kind === 'golden' ? tr('LEVARAM A GALINHA DE OURO!', 'THEY TOOK THE GOLDEN HEN!', 'KULTAKANA VIETIIN!') : '-1 ' + CHICKEN_KINDS[c.kind].label.toUpperCase(), '#ff4040', 1.2, 1.6],
    [tr('restam ' + left + (left === 1 ? ' galinha' : ' galinhas'), left + (left === 1 ? ' chicken left' : ' chickens left'), left + (left === 1 ? ' kana jäljellä' : ' kanaa jäljellä')), left <= 2 ? '#ff6060' : '#ffffff', 0.9, 1.6]], u.pos);
  if (left === 0) enterGameOver('chickens');
}

// ---------- Vida do jogador ----------
export function damagePlayer(amount, label, color) {
  if (!playing()) return;
  if (G.invulnT > 0) return;
  if (G.up.bubble) { sfx('shieldTink'); G.invulnT = 0.3; popupAhead(tr('🛡 BLOQUEADO!', '🛡 BLOCKED!', '🛡 TORJUTTU!'), '#80e0ff', 0.8); return; }
  const dmg = Math.max(1, Math.round(amount * (1 - 0.2 * G.up.armor)));
  G.hp = Math.max(0, G.hp - dmg);
  G.waveDamage += dmg;
  G.invulnT = 0.6;
  ov.hurt = 0.7; sfx('hurt'); pulseAll(0.9, 200);
  popupAhead('-' + dmg + ' ❤️ ' + label, color, 1.1);
  if (G.hp <= 0) enterGameOver('player');
}
export function healPlayer(n, quiet = false) {
  const before = G.hp;
  G.hp = Math.min(G.hpMax, G.hp + n);
  const got = Math.round(G.hp - before);
  if (got > 0 && !quiet) { sfx('heal'); flashScreen(0xff6080, 0.3); popupAhead('+' + got + ' ❤️', '#ff7090', 1); }
  return got;
}
export function gooHitPlayer() {
  resetCombo();
  ov.slime = 2.6;
  sfx('gooSplat');
  damagePlayer(EP_DEF.goo.dmg, EP_DEF.goo.label, EP_DEF.goo.css);
}
export function kamikazeHit(u) {
  const pos = u.pos.clone();
  removeUfo(u);
  fireball(pos, 0.8);
  resetCombo();
  ov.slime = 3; ov.hurt = 0.4;
  sfx('gooSplat'); sfx('explosionSmall');
  damagePlayer(35, 'KAMIKAZE!', '#ff8030');
  for (const ck of chickens) scareChicken(ck, t0.set(0, 0, 0));
}
