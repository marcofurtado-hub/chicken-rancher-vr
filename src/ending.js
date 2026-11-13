// =============================================================================
// FINAL — depois da nave-mãe: tudo fica em câmera lenta, uma nave ENORME pousa no
// fundo do quintal, uma comporta desce em diagonal, sombras gigantes aparecem na
// fumaça… e quando a fumaça baixa são só 3 alienzinhos com bandeira branca: vieram
// em paz. Depois, créditos com desenhos 2D deles ajudando no rancho.
// Tudo em tempo real (F.t), o resto do mundo anda devagar enquanto G.finaleSlow > 0.
// =============================================================================
import { THREE, scene, camera, camPos, xrActive, fitDistance, toon, outlineMat, outlineGeo, bakeWith, sph, cyl, box, cone, torus, lathe, canvasTex, FONT, FONT_UI, roundRect } from './render.js';
import { G, clamp, rand, tmpV } from './core.js';
import { tr } from './i18n.js';
import { fxAlpha, fxAdd, SHAPE, glow, blob, showBanner, hideBanner, flashScreen, confetti, sparks, smoke } from './fx.js';
import { sfx } from './audio.js';
import { chickens, scareChicken } from './chickens.js';
import { pulseAll, playerInput, applyPcView } from './player.js';

const [t0, t1, t2] = tmpV(3);
const _c = new THREE.Color();
const F = { on: false, t: 0, ship: null, hinge: null, hatchGlow: null, shadows: [], aliens: [], panel: null, panelCtx: null, panelTex: null, slide: -1, done: null, skipOK: false };
export const finaleOn = () => F.on;

// ---------- Nave da paz (prateada, luzes quentes) ----------
const SHIP_X = 0, SHIP_Z = 25, SHIP_Y = 5.2, SHIP_R = 12;   // pousa no fundo do quintal e ocupa quase tudo
// comporta: dobradiça a ~4 m do chão; aberta, a ponta da rampa (6,6 m) encosta na grama
const HATCH_CLOSED = 1.35, HATCH_OPEN = -Math.asin((SHIP_Y - 1.15) / 6.6);
const RAMP_TOP_Z = SHIP_Z - SHIP_R * 0.62, RAMP_FOOT_Z = RAMP_TOP_Z - 6.6 * Math.cos(HATCH_OPEN);
function buildShip() {
  const g = new THREE.Group();
  const hullGeo = bakeWith(q => {
    lathe(q, [[0.001, -0.22], [0.15, -0.21], [0.32, -0.15], [0.5, -0.05], [0.56, 0]], 56, 0xc4cad6).scale.set(SHIP_R * 1.8, 7, SHIP_R * 1.8);
    lathe(q, [[0.56, 0], [0.55, 0.03], [0.44, 0.07], [0.3, 0.11], [0.2, 0.15], [0.001, 0.17]], 56, 0xeef1f6).scale.set(SHIP_R * 1.8, 7, SHIP_R * 1.8);
    torus(q, SHIP_R * 1.0, 0.18, 6, 56, 0xffc860, 0, 0.05, 0).rotation.x = Math.PI / 2;
    for (let k = 0; k < 3; k++) { const a = k * 2.094 + 0.5; cyl(q, 0.18, 0.28, 4.4, 8, 0x8a90a0, Math.cos(a) * 6, -3.2, Math.sin(a) * 6); cyl(q, 0.9, 1.0, 0.25, 12, 0x6a7080, Math.cos(a) * 6, -5.3, Math.sin(a) * 6); }
  });
  const mat = toon({ ramp: 4 });
  const hull = new THREE.Mesh(hullGeo, mat);
  hull.add(new THREE.Mesh(outlineGeo(hullGeo), outlineMat(0.05, 0x1a1420)));
  g.add(hull);
  // comporta: dobradiça na borda da frente, rampa que desce em diagonal até o chão
  const hinge = new THREE.Group();
  hinge.position.set(0, -1.15, -SHIP_R * 0.62);
  const rampGeo = bakeWith(q => {
    box(q, 3.4, 0.16, 6.6, 0xd0d4dc, 0, 0, -3.3);
    for (let k = 0; k < 7; k++) box(q, 3.0, 0.04, 0.12, 0x9aa0ac, 0, 0.1, -0.6 - k * 0.85);
    box(q, 0.14, 0.24, 6.6, 0xffc040, -1.65, 0.05, -3.3); box(q, 0.14, 0.24, 6.6, 0xffc040, 1.65, 0.05, -3.3);
  });
  const ramp = new THREE.Mesh(rampGeo, mat);
  ramp.add(new THREE.Mesh(outlineGeo(rampGeo), outlineMat(0.03, 0x1a1420)));
  hinge.add(ramp);
  hinge.rotation.x = HATCH_CLOSED;   // fechada: dobrada para cima, dentro do casco
  g.add(hinge);
  // luz de dentro (aparece quando abre)
  const hg = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.6), new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  hg.position.set(0, -0.3, -SHIP_R * 0.6);
  g.add(hg);
  g.position.set(SHIP_X, 70, SHIP_Z);
  scene.add(g);
  F.ship = g; F.hull = hull; F.hinge = hinge; F.hatchGlow = hg;
}

// ---------- Sombras gigantes na fumaça (silhuetas recortadas) ----------
const SHADOW_TEX = canvasTex(256, 512, (x, w, h) => {
  x.fillStyle = '#000';
  x.filter = 'blur(6px)';
  x.beginPath(); x.ellipse(w / 2, 130, 78, 88, 0, 0, Math.PI * 2); x.fill();                 // cabeçona
  x.fillRect(w / 2 - 6, 20, 8, 50); x.fillRect(w / 2 + 30, 26, 8, 46);                         // antenas
  x.beginPath(); x.arc(w / 2 - 2, 20, 14, 0, 7); x.arc(w / 2 + 34, 26, 14, 0, 7); x.fill();
  x.beginPath(); x.ellipse(w / 2, 320, 62, 120, 0, 0, Math.PI * 2); x.fill();                 // corpo
  x.fillRect(w / 2 - 40, 400, 26, 100); x.fillRect(w / 2 + 14, 400, 26, 100);                 // pernas
  x.save(); x.translate(w / 2 + 60, 250); x.rotate(-0.5); x.fillRect(0, 0, 22, 130); x.restore(); // braço erguido
});
function buildShadows() {
  for (let k = 0; k < 3; k++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 5.2), new THREE.MeshBasicMaterial({ map: SHADOW_TEX, transparent: true, opacity: 0, depthWrite: false, fog: false, color: 0x1a1426 }));
    m.position.set((k - 1) * 2.4, 2.9, RAMP_FOOT_Z + 0.6 + Math.abs(k - 1) * 0.5);
    m.rotation.y = Math.PI;
    m.renderOrder = 8;
    scene.add(m);
    F.shadows.push(m);
  }
}

// ---------- Alienzinhos com bandeira branca ----------
const ALIEN_BODY = bakeWith(q => {
  sph(q, 0.17, 0x6ee070, 0, 0.32, 0, 12, 10).scale.set(1, 1.25, 1);        // corpo
  sph(q, 0.2, 0x7af07a, 0, 0.66, 0, 14, 12).scale.set(1.15, 1, 1);         // cabeça
  sph(q, 0.055, 0x101018, -0.075, 0.68, 0.16, 8, 6); sph(q, 0.055, 0x101018, 0.075, 0.68, 0.16, 8, 6);   // olhos
  sph(q, 0.018, 0xffffff, -0.06, 0.7, 0.205, 6, 4); sph(q, 0.018, 0xffffff, 0.09, 0.7, 0.205, 6, 4);
  cyl(q, 0.012, 0.012, 0.16, 5, 0x50b050, -0.08, 0.88, 0); cyl(q, 0.012, 0.012, 0.16, 5, 0x50b050, 0.08, 0.88, 0);
  sph(q, 0.035, 0xffe060, -0.08, 0.97, 0, 8, 6); sph(q, 0.035, 0xffe060, 0.08, 0.97, 0, 8, 6);
  cyl(q, 0.04, 0.04, 0.2, 6, 0x5ac85c, -0.08, 0.08, 0); cyl(q, 0.04, 0.04, 0.2, 6, 0x5ac85c, 0.08, 0.08, 0);   // pernas
  cyl(q, 0.035, 0.035, 0.24, 6, 0x5ac85c, -0.2, 0.34, 0).rotation.z = 0.6;                                    // braço livre
});
const FLAG_POLE = bakeWith(q => { cyl(q, 0.014, 0.014, 0.9, 6, 0x9a6a3a, 0, 0.45, 0); sph(q, 0.03, 0xffd040, 0, 0.92, 0, 6, 4); });
function buildAliens() {
  const mat = toon({ ramp: 4 });
  const om = outlineMat(0.012, 0x14101c);
  const bodyOut = outlineGeo(ALIEN_BODY);
  for (let k = 0; k < 3; k++) {
    const g = new THREE.Group();
    const b = new THREE.Mesh(ALIEN_BODY, mat); b.add(new THREE.Mesh(bodyOut, om)); g.add(b);
    const arm = new THREE.Group(); arm.position.set(0.17, 0.42, 0); g.add(arm);
    const pole = new THREE.Mesh(FLAG_POLE, mat); pole.position.set(0.06, 0, 0); arm.add(pole);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.24, 6, 2), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: false }));
    cloth.position.set(0.25, 0.78, 0); pole.add(cloth);
    g.scale.setScalar(1.15);
    g.visible = false;
    scene.add(g);
    F.aliens.push({ g, arm, cloth, base: cloth.geometry.attributes.position.array.slice(), x: (k - 1) * 1.1, phase: k * 1.7 });
  }
}

// ---------- Créditos (desenhos 2D feitos no canvas) ----------
const SLIDES = [
  { cap: tr('Eles vieram em paz.', 'They came in peace.', 'He tulivat rauhassa.'), draw: (x, w, h) => { sky(x, w, h, '#ffd9a8', '#9fd0ff'); ground(x, w, h); ship(x, w * 0.5, h * 0.24, 1.2); for (let k = 0; k < 3; k++) alien(x, w * (0.35 + k * 0.15), h * 0.72, 1, 'flag'); chick(x, w * 0.16, h * 0.8, 0.9); chick(x, w * 0.84, h * 0.8, 0.9, '#c07a3a'); } },
  { cap: tr('Só queriam provar ovos fresquinhos.', 'They just wanted fresh eggs.', 'He halusivat vain tuoreita munia.'), draw: (x, w, h) => { sky(x, w, h, '#fff1c8', '#a8d8ff'); ground(x, w, h); coop(x, w * 0.2, h * 0.58); alien(x, w * 0.5, h * 0.74, 1.2, 'basket'); chick(x, w * 0.7, h * 0.8, 1); eggs(x, w * 0.78, h * 0.86); } },
  { cap: tr('Aprenderam a cuidar das galinhas.', 'They learned to care for the chickens.', 'He oppivat hoitamaan kanoja.'), draw: (x, w, h) => { sky(x, w, h, '#ffe8b8', '#9fd0ff'); ground(x, w, h); alien(x, w * 0.32, h * 0.72, 1.15, 'feed'); for (let k = 0; k < 4; k++) chick(x, w * (0.5 + k * 0.11), h * (0.78 + (k % 2) * 0.05), 0.85, ['#fafafa', '#c07a3a', '#3a3a3e', '#e8c890'][k]); corn(x, w * 0.42, h * 0.84); } },
  { cap: tr('Consertaram a cerca com o raio trator.', 'They fixed the fence with a tractor beam.', 'He korjasivat aidan vetosäteellä.'), draw: (x, w, h) => { sky(x, w, h, '#ffd0a0', '#90c8ff'); ground(x, w, h); fence(x, w, h * 0.7); miniShip(x, w * 0.6, h * 0.22); beam(x, w * 0.6, h * 0.27, h * 0.66); plank(x, w * 0.6, h * 0.5); alien(x, w * 0.25, h * 0.76, 1, 'wave'); } },
  { cap: tr('A cadeira voadora virou entrega de ovos.', 'The flying wheelchair became egg delivery.', 'Lentävästä pyörätuolista tuli munakuljetus.'), draw: (x, w, h) => { sky(x, w, h, '#ffc8a0', '#88b8ff'); clouds(x, w, h); wheelchair(x, w * 0.5, h * 0.45); alien(x, w * 0.5, h * 0.42, 0.8, 'ride'); for (let k = 0; k < 3; k++) egg(x, w * (0.62 + k * 0.05), h * 0.5, 14); } },
  { cap: tr('E toda noite tem festa na varanda.', 'And every night there is a party on the porch.', 'Ja joka ilta kuistilla on juhlat.'), draw: (x, w, h) => { sky(x, w, h, '#1c2448', '#3a3070'); stars(x, w, h); porch(x, w, h); wheelchair(x, w * 0.42, h * 0.66, 0.8); for (let k = 0; k < 3; k++) alien(x, w * (0.6 + k * 0.1), h * 0.74, 0.9, k === 1 ? 'wave' : 'flag'); chick(x, w * 0.28, h * 0.8, 0.8); lantern(x, w * 0.18, h * 0.42); } },
  { cap: tr('FIM', 'THE END', 'LOPPU'), end: true, draw: (x, w, h) => { sky(x, w, h, '#2a1848', '#5a2c6a'); stars(x, w, h); x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '96px ' + FONT; x.fillStyle = '#ffe9a8'; x.lineJoin = 'round'; x.lineWidth = 14; x.strokeStyle = '#3a1a10'; x.strokeText('CHICKEN RANCHER', w / 2, h * 0.28); x.fillText('CHICKEN RANCHER', w / 2, h * 0.28); x.font = '64px ' + FONT; x.fillStyle = '#8dff4a'; x.strokeText(tr('— FIM —', '— THE END —', '— LOPPU —'), w / 2, h * 0.14); x.fillText(tr('— FIM —', '— THE END —', '— LOPPU —'), w / 2, h * 0.14); x.font = '800 40px ' + FONT_UI; x.fillStyle = '#ffffff'; x.fillText(tr('um jogo SURTADO GAMES', 'a SURTADO GAMES game', 'SURTADO GAMES -peli'), w / 2, h * 0.43); x.font = '700 30px ' + FONT_UI; x.fillStyle = '#d8c8ff'; x.fillText(tr('feito com Claude', 'made with Claude', 'tehty Clauden kanssa'), w / 2, h * 0.52); x.fillText(tr('obrigado por jogar!', 'thanks for playing!', 'kiitos pelaamisesta!'), w / 2, h * 0.6); for (let k = 0; k < 3; k++) alien(x, w * (0.38 + k * 0.12), h * 0.86, 0.75, 'wave'); chick(x, w * 0.24, h * 0.9, 0.7); chick(x, w * 0.76, h * 0.9, 0.7, '#c07a3a'); } },
];
// --- pincéis (estilo cartoon: contorno grosso escuro)
const OUT = '#2a1a22';
function stroke(x, lw = 5) { x.lineWidth = lw; x.strokeStyle = OUT; x.lineJoin = 'round'; x.stroke(); }
function sky(x, w, h, a, b) { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, b); g.addColorStop(0.7, a); x.fillStyle = g; x.fillRect(0, 0, w, h); }
function ground(x, w, h) { x.fillStyle = '#7cc24e'; x.beginPath(); x.moveTo(0, h * 0.66); x.quadraticCurveTo(w * 0.5, h * 0.6, w, h * 0.68); x.lineTo(w, h); x.lineTo(0, h); x.closePath(); x.fill(); stroke(x, 4); x.fillStyle = '#6aae40'; for (let k = 0; k < 40; k++) { const gx = (k * 97) % w, gy = h * 0.72 + ((k * 53) % (h * 0.26)); x.fillRect(gx, gy, 3, 10); } }
function stars(x, w, h) { x.fillStyle = '#fff8d0'; for (let k = 0; k < 60; k++) { x.globalAlpha = 0.4 + (k % 5) * 0.12; x.beginPath(); x.arc((k * 137) % w, (k * 71) % (h * 0.55), 1.5 + (k % 3), 0, 7); x.fill(); } x.globalAlpha = 1; x.beginPath(); x.arc(w * 0.85, h * 0.14, 34, 0, 7); x.fillStyle = '#fff4c8'; x.fill(); }
function clouds(x, w, h) { x.fillStyle = '#ffffff'; for (const [cx, cy, s] of [[0.2, 0.2, 1], [0.75, 0.14, 0.8], [0.45, 0.75, 1.2]]) { x.beginPath(); x.arc(w * cx, h * cy, 40 * s, 0, 7); x.arc(w * cx + 46 * s, h * cy + 6, 32 * s, 0, 7); x.arc(w * cx - 44 * s, h * cy + 8, 30 * s, 0, 7); x.fill(); } }
function alien(x, cx, cy, s, pose) {
  x.save(); x.translate(cx, cy); x.scale(s, s);
  // corpo e pernas
  x.fillStyle = '#5ac85c'; x.fillRect(-16, 10, 11, 34); x.fillRect(6, 10, 11, 34); x.strokeStyle = OUT; x.lineWidth = 4; x.strokeRect(-16, 10, 11, 34); x.strokeRect(6, 10, 11, 34);
  x.beginPath(); x.ellipse(0, -10, 28, 36, 0, 0, 7); x.fillStyle = '#6ee070'; x.fill(); stroke(x);
  // braços
  x.lineCap = 'round'; x.lineWidth = 9; x.strokeStyle = '#5ac85c';
  const up = pose === 'wave' || pose === 'flag';
  x.beginPath(); x.moveTo(24, -14); x.lineTo(up ? 44 : 40, up ? -50 : 10); x.stroke();
  x.beginPath(); x.moveTo(-24, -14); x.lineTo(-40, pose === 'feed' ? -24 : 10); x.stroke();
  // cabeça
  x.beginPath(); x.ellipse(0, -68, 38, 32, 0, 0, 7); x.fillStyle = '#7af07a'; x.fill(); stroke(x);
  x.fillStyle = '#101018'; x.beginPath(); x.ellipse(-13, -68, 9, 12, 0, 0, 7); x.ellipse(13, -68, 9, 12, 0, 0, 7); x.fill();
  x.fillStyle = '#fff'; x.beginPath(); x.arc(-10, -72, 3, 0, 7); x.arc(16, -72, 3, 0, 7); x.fill();
  x.beginPath(); x.arc(0, -52, 7, 0.1, Math.PI - 0.1); x.lineWidth = 3; x.strokeStyle = OUT; x.stroke();
  x.lineWidth = 3; x.beginPath(); x.moveTo(-12, -98); x.lineTo(-18, -118); x.moveTo(12, -98); x.lineTo(18, -118); x.stroke();
  x.fillStyle = '#ffe060'; x.beginPath(); x.arc(-18, -120, 6, 0, 7); x.arc(18, -120, 6, 0, 7); x.fill();
  if (pose === 'flag') { x.lineWidth = 4; x.strokeStyle = '#8a5a30'; x.beginPath(); x.moveTo(44, -50); x.lineTo(44, -120); x.stroke(); x.fillStyle = '#fff'; x.beginPath(); x.moveTo(44, -120); x.quadraticCurveTo(70, -128, 92, -116); x.lineTo(92, -86); x.quadraticCurveTo(70, -96, 44, -88); x.closePath(); x.fill(); stroke(x, 3); }
  if (pose === 'basket') { x.fillStyle = '#b07a40'; x.beginPath(); x.ellipse(40, 14, 26, 14, 0, 0, Math.PI); x.fill(); stroke(x, 3); egg(x, 32, 6, 9); egg(x, 46, 4, 9); }
  if (pose === 'feed') { x.fillStyle = '#ffd040'; for (let k = 0; k < 8; k++) { x.beginPath(); x.arc(-46 - k * 6, -16 + k * 9, 3, 0, 7); x.fill(); } }
  x.restore();
}
function chick(x, cx, cy, s, col = '#fafafa') {
  x.save(); x.translate(cx, cy); x.scale(s, s);
  x.fillStyle = '#f0a020'; x.fillRect(-8, 18, 4, 16); x.fillRect(6, 18, 4, 16);
  x.beginPath(); x.ellipse(0, 0, 34, 26, 0, 0, 7); x.fillStyle = col; x.fill(); stroke(x);
  x.beginPath(); x.moveTo(-28, -6); x.lineTo(-48, -22); x.lineTo(-40, 4); x.closePath(); x.fill(); stroke(x, 3);
  x.beginPath(); x.arc(24, -24, 16, 0, 7); x.fill(); stroke(x);
  x.fillStyle = '#e83030'; x.beginPath(); x.arc(22, -42, 6, 0, 7); x.arc(30, -40, 5, 0, 7); x.fill();
  x.fillStyle = '#f0a020'; x.beginPath(); x.moveTo(38, -26); x.lineTo(48, -22); x.lineTo(38, -18); x.closePath(); x.fill();
  x.fillStyle = '#101018'; x.beginPath(); x.arc(28, -27, 3, 0, 7); x.fill();
  x.restore();
}
function egg(x, cx, cy, r) { x.beginPath(); x.ellipse(cx, cy, r * 0.78, r, 0, 0, 7); x.fillStyle = '#fff8e8'; x.fill(); stroke(x, 2.5); }
function eggs(x, cx, cy) { for (let k = 0; k < 5; k++) egg(x, cx + (k % 3) * 18 - 18, cy - Math.floor(k / 3) * 14, 11); }
function corn(x, cx, cy) { x.fillStyle = '#ffd040'; for (let k = 0; k < 14; k++) { x.beginPath(); x.arc(cx + (k * 23) % 120 - 20, cy + (k * 11) % 24, 3, 0, 7); x.fill(); } }
function coop(x, cx, cy) { x.fillStyle = '#f2c84a'; x.fillRect(cx - 70, cy - 40, 140, 90); x.strokeStyle = OUT; x.lineWidth = 5; x.strokeRect(cx - 70, cy - 40, 140, 90); x.fillStyle = '#d83a30'; x.beginPath(); x.moveTo(cx - 86, cy - 40); x.lineTo(cx, cy - 96); x.lineTo(cx + 86, cy - 40); x.closePath(); x.fill(); stroke(x); x.fillStyle = '#3a2a1a'; x.fillRect(cx - 18, cy, 36, 50); }
function fence(x, w, y) { x.fillStyle = '#e8d8b8'; for (let k = 0; k < 14; k++) { if (k === 7) continue; const fx = k * w / 13; x.fillRect(fx - 7, y - 60, 14, 70); x.strokeStyle = OUT; x.lineWidth = 3; x.strokeRect(fx - 7, y - 60, 14, 70); } x.fillRect(0, y - 44, w, 10); x.fillRect(0, y - 16, w, 10); }
function plank(x, cx, cy) { x.save(); x.translate(cx, cy); x.rotate(-0.15); x.fillStyle = '#e8d8b8'; x.fillRect(-7, -35, 14, 70); x.strokeStyle = OUT; x.lineWidth = 3; x.strokeRect(-7, -35, 14, 70); x.restore(); }
function miniShip(x, cx, cy) { x.fillStyle = '#c4cad6'; x.beginPath(); x.ellipse(cx, cy, 90, 22, 0, 0, 7); x.fill(); stroke(x); x.fillStyle = '#9fe8ff'; x.beginPath(); x.ellipse(cx, cy - 16, 36, 24, 0, Math.PI, 0); x.fill(); stroke(x, 4); }
function ship(x, cx, cy, s) { x.save(); x.translate(cx, cy); x.scale(s, s); x.fillStyle = '#c4cad6'; x.beginPath(); x.ellipse(0, 0, 220, 46, 0, 0, 7); x.fill(); stroke(x, 6); x.fillStyle = '#eef1f6'; x.beginPath(); x.ellipse(0, -26, 110, 50, 0, Math.PI, 0); x.fill(); stroke(x, 5); x.fillStyle = '#ffc860'; for (let k = -4; k <= 4; k++) { x.beginPath(); x.arc(k * 44, 10, 7, 0, 7); x.fill(); } x.restore(); }
function beam(x, cx, top, bot) { const g = x.createLinearGradient(0, top, 0, bot); g.addColorStop(0, 'rgba(160,255,200,0.7)'); g.addColorStop(1, 'rgba(160,255,200,0.1)'); x.fillStyle = g; x.beginPath(); x.moveTo(cx - 24, top); x.lineTo(cx + 24, top); x.lineTo(cx + 70, bot); x.lineTo(cx - 70, bot); x.closePath(); x.fill(); }
function wheelchair(x, cx, cy, s = 1) { x.save(); x.translate(cx, cy); x.scale(s, s); x.strokeStyle = OUT; x.lineWidth = 6; x.fillStyle = '#5a6a8a'; x.fillRect(-60, -20, 110, 20); x.strokeRect(-60, -20, 110, 20); x.fillRect(-60, -80, 18, 60); x.strokeRect(-60, -80, 18, 60); x.beginPath(); x.arc(-30, 20, 34, 0, 7); x.stroke(); x.beginPath(); x.arc(40, 34, 16, 0, 7); x.stroke(); if (s === 1) { x.strokeStyle = 'rgba(120,220,255,0.8)'; x.lineWidth = 4; for (let k = 0; k < 3; k++) { x.beginPath(); x.moveTo(-80 - k * 18, 40 + k * 8); x.lineTo(-120 - k * 24, 50 + k * 10); x.stroke(); } } x.restore(); }
function porch(x, w, h) { x.fillStyle = '#8a5a34'; x.fillRect(0, h * 0.78, w, h * 0.22); x.fillStyle = '#5a3a22'; for (let k = 0; k < 12; k++) x.fillRect(0, h * 0.78 + k * 16, w, 2); x.fillStyle = '#f2ecdc'; x.fillRect(w * 0.06, h * 0.25, 18, h * 0.53); x.fillRect(w * 0.92, h * 0.25, 18, h * 0.53); x.fillStyle = '#6a4228'; x.fillRect(0, h * 0.2, w, 26); }
function lantern(x, cx, cy) { const g = x.createRadialGradient(cx, cy, 4, cx, cy, 90); g.addColorStop(0, 'rgba(255,210,120,0.9)'); g.addColorStop(1, 'rgba(255,210,120,0)'); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, 90, 0, 7); x.fill(); x.fillStyle = '#ffcc66'; x.fillRect(cx - 10, cy - 14, 20, 28); x.strokeStyle = OUT; x.lineWidth = 3; x.strokeRect(cx - 10, cy - 14, 20, 28); }

function drawSlide(i, fade) {
  const x = F.panelCtx, W = 1280, H = 800;
  x.clearRect(0, 0, W, H);
  x.save();
  roundRect(x, 8, 8, W - 16, H - 16, 40); x.clip();
  SLIDES[i].draw(x, W, H);
  x.restore();
  roundRect(x, 8, 8, W - 16, H - 16, 40); x.lineWidth = 12; x.strokeStyle = '#ffe9a8'; x.stroke();
  if (!SLIDES[i].end) {
    x.fillStyle = 'rgba(20,10,30,0.72)'; roundRect(x, 140, H - 140, W - 280, 96, 30); x.fill();
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '52px ' + FONT; x.fillStyle = '#ffffff';
    x.fillText(SLIDES[i].cap, W / 2, H - 92);
  }
  F.panelTex.needsUpdate = true;
}
function buildPanel() {
  const c = document.createElement('canvas'); c.width = 1280; c.height = 800;
  F.panelCtx = c.getContext('2d');
  F.panelTex = new THREE.CanvasTexture(c); F.panelTex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.0), new THREE.MeshBasicMaterial({ map: F.panelTex, transparent: true, opacity: 0, depthTest: false, fog: false, toneMapped: false }));
  m.renderOrder = 995;
  scene.add(m);
  F.panel = m;
}
function placePanel() {
  camera.getWorldDirection(t0); t0.y = 0; if (t0.lengthSq() < 1e-4) t0.set(0, 0, 1); t0.normalize();
  F.panel.position.copy(camPos).addScaledVector(t0, fitDistance(1.75, 3.2));
  F.panel.position.y = camPos.y + 0.05;
  F.panel.lookAt(camPos);
}

// =============================================================================
// LINHA DO TEMPO
// =============================================================================
/** Cria tudo escondido (chamado no boot, para os shaders já virem compilados). */
export function prepareFinale() {
  if (F.ship) return;
  buildShip(); buildShadows(); buildAliens(); buildPanel();
  F.ship.visible = false;
}
export function startFinale(onDone) {
  if (F.on) return;
  F.on = true; F.t = 0; F.slide = -1; F.done = onDone; F.skipOK = false;
  prepareFinale();
  F.ship.visible = true;
  F.ship.position.set(SHIP_X, 70, SHIP_Z); F.hinge.rotation.x = HATCH_CLOSED; F.hatchGlow.material.opacity = 0;
  for (const s of F.shadows) s.material.opacity = 0;
  for (const a of F.aliens) a.g.visible = false;
  F.panel.material.opacity = 0;
  G.state = 'finale'; G.stateT = 0;
  G.finaleSlow = 1; G.finaleMusic = 'mother';
  hideBanner();
  flashScreen(0xffffff, 0.5); sfx('motherSpawn'); pulseAll(0.8, 400);
  for (const c of chickens) if (c.state !== 'gone') scareChicken(c, t0.set(SHIP_X, 0, SHIP_Z));
  // no PC/celular a câmera vira para o fundo do quintal
  if (!xrActive()) { playerInput.yaw = Math.PI; playerInput.pitch = 0.12; applyPcView(); }
}
/** Gatilho/clique durante os créditos pula para o fim. */
export function finaleSkip() { if (F.on && F.skipOK) F.t = Math.max(F.t, 999); }

const ease = k => k * k * (3 - 2 * k);
const seg01 = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
export function updateFinale(dt) {
  if (!F.on) return;
  F.t += dt;
  const t = F.t, ship = F.ship;
  // 0–8 s: câmera lenta + nave enorme descendo devagar
  G.finaleSlow = t < 7 ? 1 : Math.max(0, 1 - (t - 7) / 1.5);
  const d = ease(seg01(t, 0.6, 8));
  ship.position.y = 70 + (SHIP_Y - 70) * d;
  F.hull.rotation.y += dt * (0.5 - 0.45 * d);   // só o casco gira: a comporta fica virada pro jogador
  blob(SHIP_X, 0, SHIP_Z, SHIP_R * 2.4 * (0.4 + 0.6 * d));
  if (t < 8 && Math.random() < 0.3) pulseAll(0.15 + 0.3 * d, 40);
  for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2 + t * 0.2; glow(ship.position.x + Math.cos(a) * SHIP_R * 0.98, ship.position.y + 0.1, ship.position.z + Math.sin(a) * SHIP_R * 0.98, 2.2, 0xffc860, 0.8); }
  if (t > 8 && t - dt <= 8) { sfx('land'); pulseAll(0.9, 300); for (let k = 0; k < 24; k++) smoke(t0.set(SHIP_X + rand(-10, 10), 0.3, SHIP_Z - rand(5, 11)), 1, 0xd8d0c0, 1.6, 2.5, 0.4); G.finaleMusic = 'boss'; }
  if (!xrActive() && t < 12) { playerInput.yaw = Math.PI; playerInput.pitch = 0.42 - 0.34 * ease(seg01(t, 1, 10)); applyPcView(); }
  // 9–11.5 s: a comporta desce em diagonal (luz de dentro, fumaça saindo)
  const r = ease(seg01(t, 9, 11.5));
  F.hinge.rotation.x = HATCH_CLOSED + (HATCH_OPEN - HATCH_CLOSED) * r;
  F.hatchGlow.material.opacity = 0.85 * seg01(t, 9, 10.5);
  if (t > 9 && t - dt <= 9) { sfx('shieldDown'); sfx('coreExposed'); }
  // fumaça grossa na boca da rampa (10–17 s)
  if (t > 10 && t < 17.5) {
    const k = t < 15 ? 1 : 1 - (t - 15) / 2.5;
    for (let i = 0; i < 3; i++) if (Math.random() < k) { _c.setHex(Math.random() < 0.5 ? 0xf2ece4 : 0xd8d4d0); fxAlpha.spawn(rand(-3, 3), rand(0.3, 3.5), rand(RAMP_FOOT_Z - 2, RAMP_TOP_Z), rand(-0.3, 0.3), rand(0.1, 0.4), rand(-0.6, -0.1), _c, rand(1.6, 2.8), rand(3, 4.5), 0, 0.2, 0.8, 0.55, SHAPE.smoke, rand(-0.3, 0.3)); }
    glow(0, 2.6, RAMP_FOOT_Z + 1.5, 7, 0xfff0c0, 0.35 * k);
  }
  // 11–15.5 s: SOMBRAS ENORMES na fumaça… 14.5–17: somem
  const sh = seg01(t, 11, 13) * (1 - seg01(t, 14.5, 16.5));
  F.shadows.forEach((s, i) => { s.material.opacity = sh * 0.85; s.position.z = RAMP_FOOT_Z + 0.8 - seg01(t, 11, 16) * 1.0 + Math.abs(i - 1) * 0.5; s.scale.setScalar(1 + Math.sin(t * 2 + i) * 0.02); });
  if (t > 11.3 && t - dt <= 11.3) { sfx('bossSpawn'); pulseAll(0.7, 200); }
  // 14–19 s: na verdade são 3 alienzinhos, descendo a rampa com bandeira branca
  if (t > 14) for (const a of F.aliens) {
    a.g.visible = true;
    const w = seg01(t, 14, 19.5);
    // descem a rampa (do alto, z≈21,8) até a grama (z≈17) e andam até perto (z≈13)
    const z = RAMP_TOP_Z - 0.4 - w * (RAMP_TOP_Z - RAMP_FOOT_Z + 3.6), rampY = z > RAMP_FOOT_Z ? (z - RAMP_FOOT_Z) / (RAMP_TOP_Z - RAMP_FOOT_Z) * (SHIP_Y - 1.15) : 0;
    a.g.position.set(a.x, rampY + Math.abs(Math.sin(t * 7 + a.phase)) * 0.06, z);
    a.g.rotation.y = Math.PI + Math.sin(t * 3 + a.phase) * 0.12;
    a.arm.rotation.z = Math.sin(t * (t > 19 ? 8 : 3) + a.phase) * (t > 19 ? 0.5 : 0.18);
    const p = a.cloth.geometry.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) { const u = (a.base[i] + 0.18) / 0.36; p[i + 2] = Math.sin(t * 8 + u * 5 + a.phase) * 0.05 * u; }
    a.cloth.geometry.attributes.position.needsUpdate = true;
  }
  if (t > 17 && t - dt <= 17) { showBanner('🏳️ ' + tr('ELES VIERAM EM PAZ', 'THEY CAME IN PEACE', 'HE TULIVAT RAUHASSA') + ' 🏳️', tr('…e só queriam ovos', '…and they just wanted eggs', '…ja halusivat vain munia'), '', '#ffffff', 5); G.finaleMusic = 'victory'; sfx('tally'); for (const a of F.aliens) confetti(a.g.position, 12, 2); }
  if (t > 20 && t - dt <= 20) for (const c of chickens) if (c.state !== 'gone') { c.state = 'wandering'; }
  // 23 s em diante: créditos (um desenho a cada 4,5 s)
  if (t > 23) {
    F.skipOK = true;
    const ct = t - 23, idx = Math.min(SLIDES.length - 1, Math.floor(ct / 4.5));
    if (idx !== F.slide) { F.slide = idx; drawSlide(idx); if (idx === 0) placePanel(); sfx('cardAppear'); }
    const inSlide = ct - idx * 4.5;
    F.panel.material.opacity = Math.min(1, seg01(ct, 0, 0.8)) * (idx === SLIDES.length - 1 ? 1 : (inSlide > 4.0 ? 0.6 : 1));
    if (xrActive() && idx === 0 && inSlide < 0.1) placePanel();
  }
  const END = 23 + SLIDES.length * 4.5 + 2;
  if (t >= END) endFinale();
}
function endFinale() {
  F.on = false; G.finaleSlow = 0;
  for (const a of F.aliens) a.g.visible = true;   // eles ficam no quintal com você
  F.panel.material.opacity = 0;
  for (const s of F.shadows) s.material.opacity = 0;
  const cb = F.done; F.done = null;
  if (cb) cb();
}
/** Some com tudo (reiniciar o jogo no meio do final). */
export function clearFinale() {
  if (!F.ship) return;
  F.on = false; G.finaleSlow = 0;
  F.ship.position.y = 70; F.ship.visible = false; F.panel.material.opacity = 0;
  for (const s of F.shadows) s.material.opacity = 0;
  for (const a of F.aliens) a.g.visible = false;
}
