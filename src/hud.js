// =============================================================================
// HUD — painel no colo (VR), HUD em HTML (PC/celular), placa 3D do menu
// com botões de conforto (atire neles) e o resumo de fim de wave.
// =============================================================================
import { THREE, scene, camera, camPos, rig, xrActive, isTouch, canvasTex, roundRect, FONT, FONT_UI } from './render.js';
import { G, clamp, fmt, tmpV, load, save, saveSettings, comboMult, comboWindow, MAX_CHICKENS, SKILL_DUR } from './core.js';
import { tr } from './i18n.js';
import { WEAPONS, WEAPON_ORDER, WAVES, POWERS, RARITY, SKILLS } from './config.js';
import { fitText, popupAhead } from './fx.js';
import { sfx } from './audio.js';
import { chickensAlive, flockCounts } from './chickens.js';
import { uiTargets } from './combat.js';
import { skillKey, skillCooldown, SKILL_KEYS_PC, useSkill } from './skills.js';
import { wheelchair, cycleWeapon, selectWeapon } from './player.js';
import { fireUltimate, canShoot } from './weapons.js';

const [t0, t1] = tmpV(2);
const CHICK_EMOJI = { hen: '🐔', rooster: '🐓', chick: '🐥', golden: '🌟' };
export const waveLabel = () => G.wave < WAVES.length ? (G.wave + 1) + '/' + WAVES.length : '∞ ' + (G.wave - WAVES.length + 1);
function flockDetail() { const k = flockCounts(); return ['hen', 'rooster', 'chick', 'golden'].filter(t => k[t]).map(t => CHICK_EMOJI[t] + k[t]).join('  '); }
function powerList() {
  const out = [];
  for (const k of ['golden', 'boom', 'slow']) if (G.power[k] > 0) out.push([POWERS[k].icon, POWERS[k].label, Math.ceil(G.power[k]), POWERS[k].css]);
  return out;
}
const hpColor = p => p <= 0.3 ? '#ff3a4a' : p <= 0.6 ? '#ff9a40' : '#ff5a80';

// =============================================================================
// PAINEL NO COLO (VR) — segure o GRIP perto dele para mover
// =============================================================================
const lapCanvas = document.createElement('canvas');
lapCanvas.width = 768; lapCanvas.height = 430;
const lapCtx = lapCanvas.getContext('2d');
const lapTex = new THREE.CanvasTexture(lapCanvas); lapTex.colorSpace = THREE.SRGBColorSpace;
export const lapPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.168), new THREE.MeshBasicMaterial({ map: lapTex, transparent: true, fog: false, toneMapped: false }));
const LAP_DEFAULT = [-0.24, 0.86, 0.3];
{
  const v = load('cr3_lap', null);
  const lp = Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) ? v : LAP_DEFAULT;
  lapPanel.position.set(lp[0], lp[1], lp[2]);
}
lapPanel.visible = false;
let lapGrab = null, lapHintT = 25, lapTimer = 0;
export function startLapGrab(c) { lapGrab = c; }
export function endLapGrab(c) {
  if (lapGrab !== c) return false;
  lapGrab = null;
  const p = lapPanel.position;
  save('cr3_lap', [p.x, p.y, p.z]);
  return true;
}
// assinatura do que o painel mostra: só redesenha (e sobe 1,3 MB para a GPU) quando algo muda
let lapSig = '';
function lapSignature() {
  const ultFull = G.ult >= 1;
  let sg = chickensAlive() + '|' + flockDetail() + '|' + G.score + '|' + (G.combo >= 2 ? comboMult() + ':' + Math.floor(clamp(G.comboT / comboWindow(), 0, 1) * 26) : '') +
    '|' + G.wave + G.state + '|' + G.weapon + '|' + Math.ceil(G.hp) + '/' + G.hpMax + '|' +
    (G.ultActive > 0 ? 'A' + Math.floor(G.ultActive * 8) : ultFull ? 'F' + (Math.floor(G.time * 4) % 2) : Math.floor(G.ult * 100)) + '|' + (lapHintT > 0 ? 1 : 0);
  for (const q of powerList()) sg += q[0] + q[2];
  for (const k of upgList()) sg += k.id + G.lv[k.id];
  for (const sl of G.slots) sg += '|' + sl.lv + (sl.active > 0 ? 'a' + Math.ceil(sl.active) + ':' + Math.floor(sl.active / SKILL_DUR * 20) : sl.cd > 0 ? 'c' + Math.ceil(sl.cd) : 'r');
  return sg;
}
function drawLap() {
  const sg = lapSignature();
  if (sg === lapSig) return;
  lapSig = sg;
  const x = lapCtx, W = 768, H = 430;
  x.clearRect(0, 0, W, H);
  roundRect(x, 6, 6, W - 12, H - 12, 34);
  const bg = x.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, 'rgba(22,30,18,0.92)'); bg.addColorStop(1, 'rgba(8,14,8,0.92)');
  x.fillStyle = bg; x.fill();
  x.strokeStyle = '#8dff4a'; x.lineWidth = 5; x.stroke();
  x.textBaseline = 'middle';
  // galinhas em destaque
  const alive = chickensAlive();
  const cc = alive <= 2 ? '#ff5050' : alive <= 4 ? '#ffb040' : '#ffffff';
  x.textAlign = 'left';
  x.font = '62px sans-serif'; x.fillStyle = '#fff'; x.fillText('🐔', 26, 74);
  x.font = '86px ' + FONT; x.fillStyle = cc; x.fillText(String(alive), 106, 78);
  const nw = x.measureText(String(alive)).width;
  x.font = '800 34px ' + FONT_UI; x.fillStyle = '#90a088'; x.fillText('/' + MAX_CHICKENS, 112 + nw, 90);
  x.font = '700 28px ' + FONT_UI; x.fillStyle = '#c8d4c0'; x.fillText(flockDetail(), 30, 140);
  // pontos + combo
  x.textAlign = 'right';
  fitText(x, fmt(G.score), 738, 70, 380, 72, FONT, '#ffd040');
  if (G.combo >= 2) {
    fitText(x, 'COMBO x' + comboMult(), 738, 135, 300, 40, FONT, '#8dff4a');
    x.fillStyle = 'rgba(141,255,74,0.25)'; x.fillRect(478, 160, 260, 10);
    x.fillStyle = '#8dff4a'; x.fillRect(478, 160, 260 * clamp(G.comboT / comboWindow(), 0, 1), 10);
  }
  // wave + arma
  x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(24, 184, W - 48, 2);
  x.textAlign = 'left';
  fitText(x, tr('WAVE ', 'WAVE ', 'AALTO ') + waveLabel(), 30, 222, 300, 38, FONT, '#ffffff');
  x.textAlign = 'right';
  fitText(x, WEAPONS[G.weapon].icon + ' ' + WEAPONS[G.weapon].label, 738, 222, 420, 38, FONT, '#8dff4a');
  // vida + chuva de ovos
  x.textAlign = 'left';
  const hpPct = clamp(G.hp / G.hpMax, 0, 1);
  x.font = '30px sans-serif'; x.fillStyle = '#fff'; x.fillText('❤️', 26, 278);
  x.fillStyle = 'rgba(255,255,255,0.15)'; roundRect(x, 72, 266, 210, 24, 12); x.fill();
  x.fillStyle = hpColor(hpPct); roundRect(x, 72, 266, Math.max(24, 210 * hpPct), 24, 12); x.fill();
  x.font = '800 26px ' + FONT_UI; x.fillStyle = hpPct <= 0.3 ? '#ff6060' : '#ffffff'; x.fillText(Math.ceil(G.hp) + '/' + G.hpMax, 292, 279);
  x.font = '28px sans-serif'; x.fillStyle = '#fff'; x.fillText('🥚', 420, 278);
  x.fillStyle = 'rgba(255,255,255,0.15)'; roundRect(x, 462, 266, 180, 24, 12); x.fill();
  const ultFull = G.ult >= 1;
  x.fillStyle = ultFull ? (Math.floor(G.time * 4) % 2 ? '#fff080' : '#ffd040') : '#d8b040'; roundRect(x, 462, 266, Math.max(24, 180 * (G.ultActive > 0 ? G.ultActive / 4.5 : G.ult)), 24, 12); x.fill();
  x.font = '800 22px ' + FONT_UI; x.fillStyle = ultFull ? '#ffe060' : '#a0a090'; x.fillText(ultFull ? tr('GRIP E!', 'L GRIP!', 'V GRIP!') : Math.floor(G.ult * 100) + '%', 652, 279);
  const pl = powerList();
  if (pl.length) { x.textAlign = 'left'; fitText(x, pl.map(q => q[0] + ' ' + q[2] + 's').join('  '), 30, 318, 700, 28, FONT_UI, pl[0][3], false, '800'); }
  // habilidades
  if (upgList().length) {
    upgList().forEach((k, i) => {
      const bx = 24 + i * 146, by = 340, bw = 136, bh = 74, R = RARITY[k.rar] || RARITY.comum;
      x.fillStyle = 'rgba(255,255,255,0.08)'; roundRect(x, bx, by, bw, bh, 14); x.fill();
      x.strokeStyle = R.col; x.lineWidth = 3; x.stroke();
      x.textAlign = 'left';
      x.font = '40px sans-serif'; x.fillStyle = '#fff'; x.fillText(k.icon, bx + 8, by + 38);
      x.font = '800 26px ' + FONT_UI; x.fillStyle = '#ffd040'; x.fillText(G.lv[k.id] + '/' + (k.max || 3), bx + 64, by + 38);
    });
  } else if (lapHintT > 0) {
    x.textAlign = 'left';
    x.font = '700 22px ' + FONT_UI; x.fillStyle = '#7a8a70'; x.fillText(tr('segure o GRIP perto deste painel pra mover', 'hold GRIP near this panel to move it', 'pidä GRIP-nappia paneelin lähellä siirtääksesi sitä'), 30, 375);
  }
  lapTex.needsUpdate = true;
}

// =============================================================================
// PLACA 3D DO MENU (idle) + botões de conforto
// =============================================================================
const signCanvas = document.createElement('canvas');
signCanvas.width = 1024; signCanvas.height = 560;
const signCtx = signCanvas.getContext('2d');
const signTex = new THREE.CanvasTexture(signCanvas); signTex.colorSpace = THREE.SRGBColorSpace;
const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.31), new THREE.MeshBasicMaterial({ map: signTex, transparent: true, fog: false, side: THREE.DoubleSide, toneMapped: false }));
// um pouco para a esquerda do jogador (o rig olha para +Z, então a esquerda dele é +X)
const SIGN_X = 0.6;
signMesh.position.set(SIGN_X, 2.25, 3.2);
signMesh.rotation.y = Math.PI;
scene.add(signMesh);
// botões de conforto (criados no initHud: dependem de outros módulos já carregados)
const BTN_W = 0.62, BTN_H = 0.2;
let btnVig = null, btnTurn = null;
function makeButton(x, y) {
  const c = document.createElement('canvas'); c.width = 384; c.height = 128;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(BTN_W, BTN_H), new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false, side: THREE.DoubleSide, toneMapped: false }));
  m.position.set(SIGN_X + x, y, 3.19); m.rotation.y = Math.PI;
  scene.add(m);
  const b = { mesh: m, ctx: c.getContext('2d'), tex, hover: 0, flash: 0 };
  b.target = { c: m.position, r: 0.17, active: false, onHit: () => {} };
  uiTargets.push(b.target);
  return b;
}
/** Chamado no boot (depois que todos os módulos carregaram). */
export function initHud() {
  wheelchair.add(lapPanel);
  btnVig = makeButton(0.38, 1.46); btnTurn = makeButton(-0.38, 1.46);
  btnVig.target.onHit = () => { G.settings.vignette = !G.settings.vignette; saveSettings(); btnVig.flash = 1; sfx('uiClick'); drawButtons(); };
  btnTurn.target.onHit = () => { G.settings.turn = G.settings.turn === 'smooth' ? 'snap' : 'smooth'; saveSettings(); btnTurn.flash = 1; sfx('uiClick'); drawButtons(); };
}
function drawButton(b, label, on) {
  const x = b.ctx;
  x.clearRect(0, 0, 384, 128);
  roundRect(x, 6, 6, 372, 116, 30);
  x.fillStyle = on ? 'rgba(40,90,24,0.95)' : 'rgba(40,30,30,0.92)'; x.fill();
  x.lineWidth = 6; x.strokeStyle = on ? '#8dff4a' : '#a08070'; x.stroke();
  x.textAlign = 'center'; x.textBaseline = 'middle';
  fitText(x, label, 192, 66, 340, 40, FONT_UI, '#ffffff', false, '800');
  b.tex.needsUpdate = true;
}
function drawButtons() {
  if (!btnVig) return;
  drawButton(btnVig, tr('VINHETA: ', 'VIGNETTE: ', 'VINJETTI: ') + (G.settings.vignette ? 'ON' : 'OFF'), G.settings.vignette);
  drawButton(btnTurn, tr('GIRO: ', 'TURN: ', 'KÄÄNTÖ: ') + (G.settings.turn === 'smooth' ? tr('SUAVE', 'SMOOTH', 'TASAINEN') : tr('PASSOS', 'SNAP', 'PORRAS')), true);
}
export function drawSign() {
  const x = signCtx, W = 1024, H = 560;
  x.clearRect(0, 0, W, H);
  roundRect(x, 10, 10, W - 20, H - 20, 44);
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#7a4a22'); g.addColorStop(1, '#4a2a12');
  x.fillStyle = g; x.fill();
  x.strokeStyle = '#a07848'; x.lineWidth = 16; x.stroke();
  x.strokeStyle = 'rgba(40,20,8,0.35)'; x.lineWidth = 3;
  for (let i = 1; i < 11; i++) { x.beginPath(); x.moveTo(24, i * 50); x.bezierCurveTo(300, i * 50 + 8, 700, i * 50 - 8, 1000, i * 50); x.stroke(); }
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineJoin = 'round'; x.lineWidth = 16; x.strokeStyle = 'rgba(30,14,4,0.9)';
  x.font = '108px ' + FONT; x.strokeText('CHICKEN RANCHER', 512, 98);
  const tg = x.createLinearGradient(0, 50, 0, 150); tg.addColorStop(0, '#fff6c0'); tg.addColorStop(1, '#ffc020');
  x.fillStyle = tg; x.fillText('CHICKEN RANCHER', 512, 98);
  x.font = '64px ' + FONT; x.strokeText('3.0', 512, 182); x.fillStyle = '#8dff4a'; x.fillText('3.0', 512, 182);
  fitText(x, '🏆 ' + tr('RECORDE: ', 'BEST: ', 'ENNÄTYS: ') + fmt(G.best), 512, 262, 900, 54, FONT, '#ffffff');
  if (G.lastScore > 0) fitText(x, tr('última partida: ', 'last game: ', 'viime peli: ') + fmt(G.lastScore), 512, 318, 900, 34, FONT_UI, '#f0d8a8', false, '700');
  fitText(x, tr('APERTE O GATILHO PRA COMEÇAR', 'PULL THE TRIGGER TO START', 'ALOITA LIIPAISIMELLA'), 512, 394, 950, 56, FONT, '#8dff4a', true);
  if (G.testWave) fitText(x, tr('🧪 COMEÇAR NA WAVE ', '🧪 START AT WAVE ', '🧪 ALOITA AALLOSTA ') + (G.testWave + 1) + tr(' (B+Y muda)', ' (B+Y changes)', ' (B+Y vaihtaa)'), 512, 470, 950, 36, FONT, '#60e0ff');
  else fitText(x, tr('10 WAVES · 10 CHEFES · 10 ARMAS · RANKING MUNDIAL', '10 WAVES · 10 BOSSES · 10 WEAPONS · WORLD RANKING', '10 AALTOA · 10 POMOA · 10 ASETTA · MAAILMANLISTA'), 512, 470, 950, 32, FONT_UI, '#ffc890', false, '800');
  fitText(x, tr('conforto: aponte e atire nos botões abaixo', 'comfort: aim and shoot the buttons below', 'mukavuus: tähtää ja ammu alla olevia nappeja'), 512, 520, 950, 26, FONT_UI, '#d0b090', false, '700');
  signTex.needsUpdate = true;
  drawButtons();
}
function updateSign(dt) {
  const show = G.state === 'idle';
  signMesh.visible = show;
  const showBtns = show && xrActive();
  if (btnVig) for (const b of [btnVig, btnTurn]) {
    b.mesh.visible = showBtns;
    b.target.active = showBtns;
    b.flash = Math.max(0, b.flash - dt * 3);
    b.mesh.scale.setScalar(1 + b.flash * 0.15);
  }
  if (show) signMesh.position.y = 2.25 + Math.sin(G.time * 1.2) * 0.02;
}

// =============================================================================
// HUD HTML (PC / celular)
// =============================================================================
const $ = id => document.getElementById(id);
const hudEl = $('hud'), wbarEl = $('wbar'), crossEl = $('crosshair'), skillbarEl = $('skillbar'), ultEl = $('ultbtn'), mSwitch = $('m-switch');
let lastWbar = '';
function updateWeaponBar() {
  const key = WEAPON_ORDER.map(w => (G.unlocked.has(w) ? 1 : 0) + (w === G.weapon ? 'a' : '')).join('');
  if (key === lastWbar) return;
  lastWbar = key;
  wbarEl.innerHTML = WEAPON_ORDER.map((w, i) => '<div class="slot' + (G.unlocked.has(w) ? ' unl' : '') + (w === G.weapon ? ' on' : '') + '" data-w="' + w + '">' + WEAPONS[w].icon + '<i>' + (i === 10 ? '-' : (i + 1) % 10) + '</i></div>').join('');
}
// 3.4: mostra as melhorias permanentes (ícone + nível), sem botão
const upgList = () => SKILLS.filter(k => !k.instant && G.lv[k.id]);
let lastSkb = '';
function updateSkillBar() {
  const key = upgList().map(k => k.id + G.lv[k.id]).join();
  if (key === lastSkb) return;
  lastSkb = key;
  skillbarEl.innerHTML = upgList().map(k => {
    const R = RARITY[k.rar] || RARITY.comum, L = G.lv[k.id];
    return '<div class="sk ready" style="--rc:' + R.col + ';pointer-events:none"><span class="ic">' + k.icon + '</span><u>' + L + '/' + (k.max || 3) + '</u><em>' + k.title + '</em></div>';
  }).join('');
}
export function updateHtmlHud() {
  const show = !xrActive() && G.state !== 'idle';
  hudEl.classList.toggle('show', show);
  wbarEl.classList.toggle('show', show && G.unlocked.size > 1);
  skillbarEl.classList.toggle('show', show && upgList().length > 0);
  crossEl.classList.toggle('show', show && (canShoot() || G.state === 'wave_complete'));
  crossEl.classList.toggle('hit', G.hitMarkT > 0);
  ultEl.classList.toggle('show', show && G.state !== 'upgrade');
  mSwitch.classList.toggle('show', isTouch && show && G.unlocked.size > 1);
  if (!show) return;
  $('h-score').textContent = fmt(G.score);
  $('h-best').textContent = fmt(Math.max(G.best, G.score));
  const cm = comboMult();
  $('h-combo').textContent = 'COMBO ' + G.combo + (cm > 1 ? ' · x' + cm : '');
  $('h-combo').classList.toggle('on', G.combo >= 2);
  $('h-combobar').style.width = (G.combo >= 2 ? clamp(G.comboT / comboWindow(), 0, 1) * 100 : 0) + '%';
  $('h-wave').textContent = tr('WAVE ', 'WAVE ', 'AALTO ') + waveLabel();
  $('h-weapon').textContent = WEAPONS[G.weapon].icon + ' ' + WEAPONS[G.weapon].label;
  const alive = chickensAlive();
  const ce = $('h-chk');
  ce.innerHTML = '🐔 <b>' + alive + '</b><small>/' + MAX_CHICKENS + '</small> <span>' + flockDetail() + '</span>';
  ce.className = 'pill' + (alive <= 2 ? ' bad' : alive <= 4 ? ' warn' : '');
  const hpPct = clamp(G.hp / G.hpMax, 0, 1);
  $('h-hpfill').style.width = (hpPct * 100).toFixed(1) + '%';
  $('h-hpfill').style.background = hpColor(hpPct);
  $('h-hptxt').textContent = Math.ceil(G.hp) + ' / ' + G.hpMax;
  $('h-hp').classList.toggle('low', hpPct <= 0.3);
  $('h-power').innerHTML = powerList().map(p => '<div class="pw" style="--pc:' + p[3] + '">' + p[0] + ' ' + p[1] + ' <b>' + p[2] + 's</b></div>').join('');
  const ultPct = G.ultActive > 0 ? G.ultActive / 4.5 : G.ult;
  ultEl.style.setProperty('--p', (ultPct * 100).toFixed(0) + '%');
  ultEl.classList.toggle('full', G.ult >= 1);
  ultEl.querySelector('em').textContent = G.ult >= 1 ? (isTouch ? tr('TOQUE!', 'TAP!', 'NAPAUTA!') : 'R') : Math.floor(G.ult * 100) + '%';
  updateWeaponBar();
  updateSkillBar();
}
// toques e cliques nos botões do HUD
function tapper(el, fn) {
  el.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); fn(e); }, { passive: false });
  el.addEventListener('mousedown', e => { e.stopPropagation(); });
  el.addEventListener('click', e => { e.stopPropagation(); fn(e); });
}
tapper(skillbarEl, e => { const el = e.target.closest('.sk'); if (el) useSkill(parseInt(el.dataset.i, 10)); });
tapper(mSwitch, () => cycleWeapon(1));
tapper(ultEl, () => fireUltimate());
tapper(wbarEl, e => { const el = e.target.closest('.slot'); if (el) selectWeapon(el.dataset.w); });

// =============================================================================
// UPDATE
// =============================================================================
let hudTimer = 0;
export function updateHud(dt) {
  G.hitMarkT = Math.max(0, G.hitMarkT - dt);
  hudTimer -= dt;
  if (hudTimer <= 0) { hudTimer = 0.1; updateHtmlHud(); }
  updateSign(dt);
  if (xrActive()) {
    lapPanel.visible = G.state !== 'idle';
    if (lapPanel.visible) {
      if (lapGrab) { const hp = lapGrab.getWorldPosition(t0); wheelchair.worldToLocal(hp); lapPanel.position.copy(hp); }
      lapPanel.lookAt(camPos);
      lapHintT -= dt;
    }
    lapTimer -= dt;
    if (lapTimer <= 0 && lapPanel.visible) { lapTimer = 0.125; drawLap(); }
  } else lapPanel.visible = false;
}
export function updateStartBest() { const el = $('best-score'); if (el) el.textContent = fmt(G.best); }
export { drawLap, lapCanvas };
