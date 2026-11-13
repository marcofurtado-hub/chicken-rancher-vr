// =============================================================================
// GAME — máquina de estados, waves, loop principal e ganchos de teste (window.__cr).
// =============================================================================
import { THREE, renderer, scene, camera, rig, camPos, camDir, U, xrActive, isTouch, updateCamWorld } from './render.js';
import { G, clamp, rand, pick, shuffle, fmt, tmpV, save, playing, comboWindow, MAX_CHICKENS } from './core.js';
import { tr } from './i18n.js';
import { WEAPONS, WEAPON_ORDER, WAVES, UFO_TYPES, WEAPON_TIPS, getWave, POWERS } from './config.js';
import { updateFx, clearFx, showBanner, hideBanner, popup, popupAhead, ov, fxAdd, randDir, sparks, confetti, seg, glow, SHAPE, friedEgg, debrisBurst, blast, bolt, smoke, fireball, feathers } from './fx.js';
import { sfx, loop, music, stinger, setListener, heartbeat, initAudio } from './audio.js';
import { initWorld, updateWorld, setTOD, nightAmount } from './world.js';
import { chickens, spawnInitialFlock, clearChickens, chickensAlive, spawnChicken, removeChicken, respawnChicken, setChickenShield, updateChickens, drawChickens, INITIAL_FLOCK } from './chickens.js';
import { ufos, spawnRegular, spawnBoss, spawnMothership, updateUfos, refreshAllParts, updateEproj, updateCrates, clearUfos, isAlive, aliveRegulars, stopAllHums, spawnCrate, fireEnemy, EP_DEF, crates } from './ufos.js';
import { castSegment, resetCombo, healPlayer, hitStop, killUfo } from './combat.js';
import { updateProjectiles, clearProjectiles, equipWeapon, updateWeapons, trackHands, setLaser, desktopShoot, fireUltimate, projs, aimInfo, THROW, throwEgg, spawnEgg } from './weapons.js';
import { updateSkills, refreshUp, resetSkillsForWave, showUpgradeCards, clearCards, updateCards, cards, updateBirds, clearBirds, useSkill, buildOffer, spawnBirds, grantRandomUpgrades } from './skills.js';
import { updatePlayer, resetPlayer, flight, flightActive, startFlightEvent, clearFlightChair, CTRL, applyPcView, playerInput, lockPointer, moveRig, selectWeapon, pcAim, pcAimVel } from './player.js';
import { updateHud, drawSign, updateStartBest, waveLabel, initHud } from './hud.js';
import { groundHeightAt } from './world.js';
import { qualityFrame, Q as QUALITY } from './quality.js';

const [t0, t1, t2] = tmpV(3);
const W = { queue: [], spawnT: 0, spawned: 0, total: 0, bossSpawned: false, fwT: 0 };

// ---------- Fluxo ----------
function buildQueue(mix, intro) {
  const q = [];
  for (const [k, n] of Object.entries(mix)) for (let i = 0; i < n; i++) q.push(k);
  shuffle(q);
  const pullFront = (type, idx) => { const j = q.indexOf(type, idx); if (j > idx) { q.splice(j, 1); q.splice(idx, 0, type); } };
  pullFront('saucer', 0); pullFront('saucer', 1);
  if (intro && intro !== 'saucer') pullFront(intro, 2);
  return q;
}
export function clearQueue() { W.queue.length = 0; }

export function startWave(idx) {
  const w = getWave(idx);
  G.wave = idx; G.waveDef = w;
  W.queue = buildQueue(w.mix, w.intro);
  W.total = W.queue.length; W.spawned = 0; W.spawnT = 1.0;
  W.bossSpawned = false;
  G.waveLost = 0; G.waveKills = 0; G.waveShots = 0; G.waveHits = 0; G.waveDamage = 0;
  flight.done = false;
  hideBanner();
  let newWeapon = null;
  if (w.weapon) {
    const wi = WEAPON_ORDER.indexOf(w.weapon);
    for (let k = 0; k <= wi; k++) {
      if (!G.unlocked.has(WEAPON_ORDER[k])) { G.unlocked.add(WEAPON_ORDER[k]); if (WEAPON_ORDER[k] === w.weapon) newWeapon = w.weapon; }
    }
    equipWeapon(w.weapon);
  } else for (const x of WEAPON_ORDER) G.unlocked.add(x);
  if (w.close) {
    const pos = [[-2.6, 3], [2, 3.5], [0, 4], [-1, 5.2], [1.6, 4.5], [-3, 4.6], [3, 5], [0.6, 2.6], [-1.8, 2.4], [2.6, 2.4]];
    let k = 0;
    for (const c of chickens) { const p = pos[k++ % pos.length]; c.pos.set(p[0], 0, p[1]); c.state = 'pecking'; c.statePhase = rand(1, 2.5); }
  }
  G.todTarget = w.tod;
  resetSkillsForWave();
  G.state = 'wave_intro'; G.stateT = 0;
  const title = w.endless ? tr('INFINITO ', 'ENDLESS ', 'LOPUTON ') + (w.n + 1) : tr('WAVE ', 'WAVE ', 'AALTO ') + (idx + 1) + '/' + WAVES.length;
  const sub = idx === WAVES.length - 1 ? tr('BATALHA FINAL · NAVE-MÃE', 'FINAL BATTLE · MOTHERSHIP', 'LOPPUTAISTELU · EMOALUS') : (w.boss ? tr('⚠ TEM CHEFÃO NESSA WAVE ⚠', '⚠ BOSS IN THIS WAVE ⚠', '⚠ TÄSSÄ AALLOSSA ON POMO ⚠') : (w.endless ? tr('ATÉ ONDE VOCÊ AGUENTA?', 'HOW LONG CAN YOU LAST?', 'KUINKA KAUAN KESTÄT?') : tr('PREPARE-SE', 'GET READY', 'VALMISTAUDU')));
  const l3 = newWeapon ? tr('NOVA ARMA: ', 'NEW WEAPON: ', 'UUSI ASE: ') + WEAPONS[newWeapon].icon + ' ' + WEAPONS[newWeapon].label : '';
  const T = w.intro && w.intro !== 'saucer' ? UFO_TYPES[w.intro] : null;
  let l4 = newWeapon ? WEAPON_TIPS[newWeapon][xrActive() ? 0 : 1] : '';
  if (T) l4 = (l4 ? l4 + ' · ' : '') + tr('NOVA AMEAÇA: ', 'NEW THREAT: ', 'UUSI UHKA: ') + T.name + ' (' + T.desc + ')';
  if (idx === 0) l4 = xrActive() ? tr('balance o controle pra arremessar ovos!', 'swing the controller to throw eggs!', 'heilauta ohjainta heittääksesi munia!') : (isTouch ? tr('toque pra arremessar ovos!', 'tap to throw eggs!', 'napauta heittääksesi munia!') : tr('clique pra arremessar ovos!', 'click to throw eggs!', 'klikkaa heittääksesi munia!'));
  showBanner(title, sub, l3, '#ffd040', 3.6, 0, l4);
  stinger(newWeapon ? 'newWeapon' : 'waveStart');
  if (newWeapon) sfx('weaponPickup');
  if (chickens.some(c => c.kind === 'rooster')) setTimeout(() => sfx('crow'), 700);
}
function growChick(c) {
  const p = c.pos.clone();
  removeChicken(c);
  spawnChicken('hen', p.x, p.z);
  popup(tr('O PINTINHO CRESCEU!', 'THE CHICK GREW UP!', 'TIPU KASVOI ISOKSI!'), p.setY(0.8), '#ffe060', 0.9, 1.6);
}
function waveComplete() {
  G.state = 'wave_complete'; G.stateT = 0;
  if (flight.phase === 'flying') flight.t = 0;
  else if (flight.phase === 'descending' || flight.phase === 'parked') { flight.phase = 'none'; clearFlightChair(); }
  setLaser(false);
  const alive = chickensAlive();
  const lines = [tr('GALINHAS ', 'CHICKENS ', 'KANAT ') + alive + '/' + MAX_CHICKENS + ' +' + fmt(alive * 150)];
  let bonus = alive * 150;
  if (G.waveLost === 0) { bonus += 1000; lines.push(tr('PERFEITA +1000', 'PERFECT +1000', 'TÄYDELLINEN +1000')); }
  if (chickens.some(c => c.kind === 'golden' && c.state !== 'gone')) { bonus += 500; lines.push('🌟 ' + tr('OURO +500', 'GOLD +500', 'KULTA +500')); }
  G.score += bonus;
  // nota da wave: ★ passou · ★ sem perder galinha · ★ precisão ≥ 45% e pouco dano
  const acc = G.waveShots ? Math.min(1, G.waveHits / G.waveShots) : 0;
  const stars = 1 + (G.waveLost === 0 ? 1 : 0) + (acc >= 0.45 && G.waveDamage <= 30 ? 1 : 0);
  const extra = ['⭐'.repeat(stars) + '☆'.repeat(3 - stars), tr('precisão ', 'accuracy ', 'tarkkuus ') + Math.round(acc * 100) + '%', G.waveKills + tr(' naves', ' saucers', ' lautasta')];
  for (const c of chickens.slice()) {
    if (c.kind === 'chick' && (c.state === 'wandering' || c.state === 'pecking')) { c.waves++; if (c.waves >= 2) growChick(c); }
  }
  if (G.waveLost === 0 && chickensAlive() < MAX_CHICKENS) { respawnChicken('chick'); extra.push('🐣'); sfx('hatch'); }
  const healed = healPlayer(15, true);
  if (healed > 0) extra.push('❤️ +' + healed);
  const last = G.wave === WAVES.length - 1;
  showBanner(last ? tr('VOCÊ VENCEU!', 'YOU WIN!', 'VOITIT!') : tr('WAVE COMPLETA!', 'WAVE COMPLETE!', 'AALTO SELVITETTY!'), lines.join(' · '), extra.join(' · '), '#8dff4a', 3.4);
  stinger(G.waveLost === 0 ? 'perfect' : 'waveClear');
  if (stars === 3) confetti(t0.copy(camPos).add(t1.copy(camDir).multiplyScalar(3)), 60, 4);
}
function advanceFromComplete() {
  if (G.wave === WAVES.length - 1) { enterVictory(); return; }
  G.pendingPicks = G.waveDef.boss ? 1 : 0;
  showUpgradeCards(G.wave === 0 ? 'first' : 'normal');
}
function finalizeScore() {
  G.lastScore = G.score;
  G.newRecord = !G.testWave && G.score > G.best;
  if (G.newRecord) { G.best = G.score; save('cr3_best', G.best); }
  updateStartBest();
  drawSign();
}
function enterVictory() {
  G.state = 'victory'; G.stateT = 0;
  finalizeScore();
  showBanner(tr('VITÓRIA!', 'VICTORY!', 'VOITTO!'), tr('PONTOS: ', 'SCORE: ', 'PISTEET: ') + fmt(G.score) + (G.newRecord ? tr(' · 🏆 NOVO RECORDE!', ' · 🏆 NEW RECORD!', ' · 🏆 UUSI ENNÄTYS!') : ''), tr('GATILHO = MODO INFINITO', 'TRIGGER = ENDLESS MODE', 'LIIPAISIN = LOPUTON TILA'), '#ffd040', 999, 0, tr('você salvou o galinheiro!', 'you saved the coop!', 'pelastit kanalan!'));
  stinger('victory');
  if (G.newRecord) setTimeout(() => sfx('newRecord'), 1200);
}
function startEndless() {
  hideBanner();
  while (chickensAlive() < INITIAL_FLOCK.length) respawnChicken('hen');
  showUpgradeCards('boss');
}
export function enterGameOver(reason = 'chickens') {
  if (G.state === 'game_over') return;
  G.state = 'game_over'; G.stateT = 0;
  setLaser(false);
  finalizeScore();
  const reached = G.wave < WAVES.length ? tr('chegou na wave ', 'reached wave ', 'pääsit aaltoon ') + (G.wave + 1) : tr('infinito ', 'endless ', 'loputon ') + (G.wave - WAVES.length + 1);
  const why = reason === 'player' ? tr('VOCÊ FOI DERROTADO! ❤️ 0', 'YOU WERE DEFEATED! ❤️ 0', 'HÄVISIT! ❤️ 0') : tr('LEVARAM TODAS AS GALINHAS!', 'THEY TOOK ALL THE CHICKENS!', 'KAIKKI KANAT VIETIIN!');
  const again = xrActive() ? tr('aperte o gatilho pra recomeçar', 'pull the trigger to restart', 'aloita alusta liipaisimella') : (isTouch ? tr('toque pra recomeçar', 'tap to restart', 'napauta aloittaaksesi alusta') : tr('clique pra recomeçar', 'click to restart', 'klikkaa aloittaaksesi alusta'));
  showBanner(tr('GAME OVER', 'GAME OVER', 'PELI OHI'), why, (G.newRecord ? tr('🏆 NOVO RECORDE! ', '🏆 NEW RECORD! ', '🏆 UUSI ENNÄTYS! ') : '') + tr('PONTOS: ', 'SCORE: ', 'PISTEET: ') + fmt(G.score), '#ff4040', 999, 0, reached + ' · ' + again);
  stinger('gameOver');
  heartbeat(false);
}
export function resetGame() {
  clearUfos(); stopAllHums();
  clearProjectiles();
  clearCards();
  clearFx();
  clearChickens();
  clearBirds();
  G.score = 0; resetCombo(); G.multiN = 0; G.killsSinceDrop = 0; G.waveLost = 0;
  G.power.golden = G.power.boom = G.power.slow = 0;
  G.slots.length = 0; for (const k in G.lv) delete G.lv[k]; refreshUp();
  G.pendingPicks = 0; G.ult = 0; G.ultActive = 0;
  G.unlocked.clear(); G.unlocked.add('hands');
  G.wave = 0; G.waveDef = WAVES[0]; W.queue = []; W.bossSpawned = false;
  G.todTarget = 0;
  G.state = 'idle'; G.stateT = 0;
  spawnInitialFlock();
  equipWeapon('hands');
  ov.hurt = ov.slime = ov.flash = 0;
  G.hp = G.hpMax = 100; G.invulnT = 0;
  resetPlayer();
  drawSign();
  heartbeat(false);
  // no PC/celular o menu é a tela inicial em HTML
  if (!xrActive()) { const s = document.getElementById('start'); if (s) s.style.display = ''; document.exitPointerLock && document.exitPointerLock(); }
}
export function startGame() {
  if (G.state !== 'idle') return;
  initAudio();
  const s = document.getElementById('start');
  if (s && s.style.display !== 'none') { s.style.display = 'none'; lockPointer(); }
  const w0 = Math.min(Math.max(0, G.testWave | 0), WAVES.length - 1);
  if (w0 > 0) grantRandomUpgrades(w0);
  startWave(w0);
  if (w0 > 0) popupAhead('🧪 ' + tr('MODO TESTE · WAVE ', 'TEST MODE · WAVE ', 'TESTITILA · AALTO ') + (w0 + 1), '#60e0ff', 1.1, 2.5);
}
/** Código secreto: escolhe a wave inicial (0 = normal). */
export function setTestWave(n) {
  G.testWave = ((n % WAVES.length) + WAVES.length) % WAVES.length;
  drawSign();
  const pick = document.getElementById('wavepick');
  if (pick) for (const b of pick.querySelectorAll('button')) b.classList.toggle('on', +b.dataset.w === G.testWave);
  const lab = document.getElementById('wavepick-label');
  if (lab) lab.textContent = G.testWave ? tr('🧪 MODO TESTE: começa na wave ', '🧪 TEST MODE: starts at wave ', '🧪 TESTITILA: alkaa aallosta ') + (G.testWave + 1) + tr(' (recorde não conta)', ' (best score not saved)', ' (ennätystä ei tallenneta)') : tr('🧪 escolha a wave inicial', '🧪 pick the starting wave', '🧪 valitse aloitusaalto');
}
/** Gatilho / clique / espaço fora de combate. Retorna true se consumiu o input. */
export function handleMenuAdvance(ctrl) {
  if (G.state === 'idle') {
    if (ctrl && xrActive()) {
      ctrl.getWorldPosition(t0); ctrl.getWorldQuaternion(_q); t1.set(0, 0, -1).applyQuaternion(_q);
      const hit = castSegment(t0, t1, 20, 0.05);
      if (hit && hit.kind === 'ui') { hit.ut.onHit(t0); return true; }
    }
    startGame(); return true;
  }
  if (G.state === 'game_over') { if (G.stateT > 1.5) resetGame(); return true; }
  if (G.state === 'victory') { if (G.stateT > 2) startEndless(); return true; }
  if (G.state === 'wave_complete') { if (G.stateT > 1.2 && !flightActive()) advanceFromComplete(); return true; }
  return false;
}
const _q = new THREE.Quaternion();

export function setPaused(on) {
  G.paused = on;
  document.getElementById('pause').classList.toggle('show', on);
  if (on) { playerInput.mouseDown = false; playerInput.zoom = false; for (const k in playerInput.keys) playerInput.keys[k] = false; }
}

function updateWaveLogic(edt) {
  if (G.state === 'wave_intro' && G.stateT > 3.0) { G.state = 'playing'; G.stateT = 0; }
  if (G.state === 'playing') {
    const w = G.waveDef;
    W.spawnT -= edt;
    if (W.queue.length && W.spawnT <= 0 && aliveRegulars() < w.maxAlive) {
      spawnRegular(W.queue.shift());
      W.spawned++;
      W.spawnT = w.interval * rand(0.7, 1.3);
    }
    if (w.flight && !flight.done && G.stateT > 8) startFlightEvent();
    if (w.boss && !W.bossSpawned) {
      if (w.boss === 'mothership') { if (G.stateT > 2.5) { spawnMothership(); W.bossSpawned = true; } }
      else if (W.spawned >= Math.ceil(W.total * 0.45)) { spawnBoss(w.boss); W.bossSpawned = true; }
    }
    if (!W.queue.length && (!w.boss || W.bossSpawned) && !ufos.some(u => !u.removed && (u.kind !== 'ufo' || isAlive(u)) && u.state !== 'escaping')) waveComplete();
  }
  if (G.state === 'wave_complete' && G.stateT > 3.4 && !flightActive()) advanceFromComplete();   // cards só depois de pousar
}

// ---------- Música conforme o momento ----------
let musicMode = '';
function updateMusic() {
  let mode = 'menu', inten = 0.3;
  if (G.state === 'victory') mode = 'victory';
  else if (G.state === 'game_over') mode = 'gameover';
  else if (G.state !== 'idle') {
    mode = G.tod < 1.6 ? 'day' : G.tod < 3.2 ? 'dusk' : 'night';
    if (ufos.some(u => u.kind === 'mother' && isAlive(u))) mode = 'mother';
    else if (ufos.some(u => u.kind === 'boss' && isAlive(u))) mode = 'boss';
    if (flightActive()) mode = 'flight';
    inten = G.state === 'playing' ? 1 : G.state === 'wave_intro' ? 0.7 : 0.25;
  }
  const bpm = 96 + Math.min(G.wave, 14) * 3;
  if (mode !== musicMode) { musicMode = mode; music.setMode(mode); musicBpm = 0; }
  if (inten !== musicInten) { musicInten = inten; music.setIntensity(inten); }
  if (bpm !== musicBpm) { musicBpm = bpm; music.setTempo(bpm); }
  // ambiente: vento suave sempre, grilos à noite
  if (amb.wind) amb.wind.setVol(0.25);
  if (amb.crickets) amb.crickets.setVol(nightAmount() * 0.55);
}
let musicInten = -1, musicBpm = 0;
const amb = { wind: null, crickets: null };

// ---------- Comemoração da vitória ----------
function celebrate(dt) {
  W.fwT -= dt;
  if (W.fwT > 0) return;
  W.fwT = 0.35;
  const c = t0.set(rand(-10, 10), rand(9, 15), rand(8, 20));
  const col = pick([0xffd040, 0xff60a0, 0x40e0ff, 0xa0ff60, 0xffffff, 0xff8030]);
  const _c = new THREE.Color(col);
  for (let i = 0; i < 60; i++) { randDir(t1); const s = rand(3, 5); fxAdd.spawn(c.x, c.y, c.z, t1.x * s, t1.y * s, t1.z * s, _c, 0.2, rand(1.2, 1.8), 2, 0.9, 0, 1, i % 3 ? SHAPE.glow : SHAPE.star, rand(-4, 4)); }
  sfx('crackle', { pos: c });
}

// =============================================================================
// LOOP PRINCIPAL
// =============================================================================
const clock = new THREE.Clock();
let skipRender = false, beatOn = false;
export function gameLoop(time, xrFrame, forcedDt) {
  if (G.paused && forcedDt == null) { clock.getDelta(); renderer.render(scene, camera); return; }
  const dt = forcedDt != null ? forcedDt : Math.min(clock.getDelta(), 0.05);
  if (forcedDt == null) qualityFrame(time);
  G.time += dt; G.stateT += dt;
  U.uTime.value += dt;
  updateCamWorld();
  const xr = xrActive();
  const held = updatePlayer(dt);
  updateCamWorld();
  setListener(camPos, camDir, THREE.Object3D.DEFAULT_UP);

  G.invulnT = Math.max(0, G.invulnT - dt);
  const low = G.state === 'playing' && G.hp > 0 && G.hp <= G.hpMax * 0.3;
  if (low !== beatOn) { beatOn = low; heartbeat(low); }
  ov.low = low ? 0.25 + Math.sin(G.time * 7.4) * 0.15 : 0;
  for (const k of ['golden', 'boom', 'slow']) if (G.power[k] > 0) G.power[k] = Math.max(0, G.power[k] - dt);
  updateSkills(dt);
  ov.slow = (G.power.slow > 0 || G.up.slowSkill < 1) ? 1 : 0;
  ov.bubble = G.up.bubble ? 1 : 0;
  const targetScale = Math.min(G.power.slow > 0 ? 0.5 : 1, G.up.slowSkill);   // câmera lenta: metade da velocidade
  G.timeScale += (targetScale - G.timeScale) * Math.min(1, dt * 5);
  let edt = dt * G.timeScale;
  if (G.hitStop > 0) { G.hitStop -= dt; edt *= 0.08; }
  if (G.comboT > 0) { G.comboT -= dt; if (G.comboT <= 0) resetCombo(); }

  // ciclo do dia (devagar durante o jogo, rápido no menu)
  if (Math.abs(G.todTarget - G.tod) > 0.0005) {
    const rate = G.state === 'idle' ? 2 : 0.35;
    G.tod += clamp(G.todTarget - G.tod, -dt * rate, dt * rate);
  }
  setTOD(G.tod);
  updateWorld(dt);
  updateMusic();

  if (xr) trackHands(dt);
  updateWeapons(dt, xr, held.r, held.l);
  updateWaveLogic(edt);
  updateChickens(dt, ufos);
  updateUfos(dt, edt);
  refreshAllParts();
  updateEproj(dt, edt);
  updateCrates(dt, edt);
  updateProjectiles(dt);
  // mira (para destacar cards) + raio-guia do controle no menu e nas cartas
  let aimO = null, aimD = null;
  if (G.state === 'upgrade' || G.state === 'idle') {
    if (xr) {
      aimO = CTRL.right.getWorldPosition(t0); CTRL.right.getWorldQuaternion(_q); aimD = t1.set(0, 0, -1).applyQuaternion(_q);
      const hit = castSegment(aimO, aimD, 12, 0.05);
      t2.copy(aimO).addScaledVector(aimD, hit ? hit.t : 6);
      seg(aimO, t2, 0.004, hit && hit.kind === 'ui' ? 0x8dff4a : 0x808890);
      if (hit && hit.kind === 'ui') glow(t2.x, t2.y, t2.z, 0.08, 0x8dff4a, 1);
    } else { aimO = camPos; aimD = camDir; }
  }
  updateCards(dt, aimO, aimD);
  updateBirds(dt);
  drawChickens();
  if (G.state === 'victory') celebrate(dt);

  updateFx(dt);
  updateHud(dt);
  if (!skipRender) renderer.render(scene, camera);
}

// =============================================================================
// BOOT
// =============================================================================
// -----------------------------------------------------------------------------
// AQUECIMENTO DE SHADERS: cria um exemplar de tudo que aparece no jogo (cada nave,
// chefão, nave-mãe, caixas, tiros inimigos, projéteis, cards, banner, efeitos) e
// compila/sobe tudo para a GPU AGORA, atrás da tela inicial. Sem isso o Quest
// compilava ~28 shaders no meio da partida (cada um trava a imagem por 0,1–0,5 s).
// -----------------------------------------------------------------------------
function warmupShaders() {
  const t0 = performance.now();
  const P = new THREE.Vector3(0, 6, 14);
  try {
    G.waveDef = WAVES[WAVES.length - 1];
    for (const k of Object.keys(UFO_TYPES)) if (UFO_TYPES[k].role !== 'boss') spawnRegular(k, P);
    spawnBoss(100);
    spawnMothership();
    for (const k of Object.keys(POWERS)) spawnCrate(k, P);
    for (const k of Object.keys(EP_DEF)) fireEnemy(k, P);
    for (const o of [{}, { arrow: true }, { rocket: true }, { firework: true }, { giant: true }]) spawnEgg(P, new THREE.Vector3(0, 0, 1), o);
    G.state = 'upgrade'; showUpgradeCards(); G.state = 'idle';
    showBanner('WARMUP', 'x', 'x');
    popup('100', P);
    spawnBirds(2, 1);
    sparks(P, 0xffffff, 4); smoke(P, 2); fireball(P, 1); feathers(P, 2);
    friedEgg(P); debrisBurst(P, 0xffffff, 2); blast(P, 1, 0xffffff);
    seg(P, new THREE.Vector3(0, 7, 14), 0.02, 0xffffff, 0.1); bolt(P, new THREE.Vector3(1, 7, 14));
    for (const k of Object.keys(ov)) ov[k] = 1;
    updateFx(1 / 60);
    refreshAllParts();
  } catch (e) { console.warn('[warmup]', e); }
  // tudo visível por um instante (compile() pega até o que está escondido, mas o render garante o resto)
  const hidden = [];
  scene.traverse(o => { if (!o.visible) { hidden.push(o); o.visible = true; } });
  renderer.compile(scene, camera);
  scene.traverse(o => {
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) for (const k of ['map', 'gradientMap', 'alphaMap']) if (m[k] && m[k].isTexture) renderer.initTexture(m[k]);
  });
  renderer.render(scene, camera);
  for (const o of hidden) o.visible = false;
  for (const k of Object.keys(ov)) ov[k] = 0;
  hideBanner();
  resetGame();
  console.info('[warmup] shaders prontos em', Math.round(performance.now() - t0), 'ms ·', renderer.info.programs.length, 'programas');
}

export function boot() {
  initWorld();
  initHud();
  G.waveDef = WAVES[0];
  spawnInitialFlock();
  equipWeapon('hands');
  resetPlayer();
  applyPcView();
  drawSign();
  updateStartBest();
  setTOD(0);
  warmupShaders();
  amb.wind = loop('wind', { vol: 0.25 });
  amb.crickets = loop('crickets', { vol: 0 });
  renderer.setAnimationLoop(gameLoop);
  // ganchos de teste (simulação sem renderizar)
  window.__cr = {
    G, get state() { return G.state; }, startWave, startGame, resetGame, ufos, chickens, cards,
    spawnUfo: spawnRegular, killAll: () => { for (const u of ufos.slice()) if (isAlive(u)) killUfo(u, u.pos); },
    advance: () => handleMenuAdvance(), hitCard: i => cards[i] && cards[i].target.onHit(), useSkill, selectWeapon, moveRig, buildOffer,
    setHold: v => { playerInput.mouseDown = v; },
    aimAt: p => { const d = new THREE.Vector3().copy(p).sub(camPos).normalize(); playerInput.yaw = Math.atan2(-d.x, -d.z); playerInput.pitch = Math.asin(clamp(d.y, -1, 1)); applyPcView(); },
    flight, startFlightEvent, rig, shoot: desktopShoot, ult: fireUltimate,
    projs, pcAim, pcAimVel, updateProjectiles, clearProjectiles, camPos, camera, renderer, scene, aimInfo, THROW, throwEgg, quality: QUALITY, spawnCrate, crates,
    step: (n, dt = 1 / 30, render = false) => { skipRender = !render; for (let i = 0; i < n; i++) gameLoop(0, null, dt); skipRender = false; },
  };
}
