// =============================================================================
// RANKING — placar LOCAL (deste aparelho) e MUNDIAL (Firestore, via REST, sem SDK).
// No fim da partida (vitória ou derrota) a pontuação entra nos dois e aparece um
// painel 3D na frente do jogador (funciona no VR) com as duas colunas.
// O nome vem do campo "seu nome" da tela inicial (salvo no aparelho).
// =============================================================================
import { THREE, scene, camera, camPos, fitDistance, FONT, FONT_UI, roundRect, xrActive, isTouch } from './render.js';
import { G, load, save, fmt } from './core.js';
import { tr } from './i18n.js';
import { fitText } from './fx.js';
import { FIREBASE } from './leaderboard-config.js';

const VERSION = '3.5', LOCAL_MAX = 20;
export const LB = { local: load('cr3_scores', []), world: [], worldState: FIREBASE.projectId ? 'idle' : 'off', me: null };
export const worldOn = () => !!(FIREBASE.projectId && FIREBASE.apiKey);

// ---------- nome ----------
const cleanName = s => String(s || '').replace(/[^\p{L}\p{N} _\-.!]/gu, '').trim().slice(0, 12).toUpperCase();
export function playerName() { return cleanName(load('cr_name', '')) || tr('RANCHEIRO', 'RANCHER', 'TILALLINEN'); }
export function setPlayerName(s) { save('cr_name', cleanName(s)); }

// ---------- mundial (Firestore REST) ----------
const API = () => `https://firestore.googleapis.com/v1/projects/${FIREBASE.projectId}/databases/(default)/documents`;
let onChange = () => {};
export function onRankingChange(fn) { onChange = fn; }
export async function fetchWorld() {
  if (!worldOn()) return;
  LB.worldState = 'loading'; onChange();
  try {
    const r = await fetch(`${API()}:runQuery?key=${FIREBASE.apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'scores' }], orderBy: [{ field: { fieldPath: 'score' }, direction: 'DESCENDING' }], limit: 10 } }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const rows = await r.json();
    LB.world = rows.filter(x => x.document).map(x => { const f = x.document.fields; return { n: cleanName(f.name && f.name.stringValue) || '???', s: +(f.score && f.score.integerValue) || 0, w: +(f.wave && f.wave.integerValue) || 0, won: !!(f.won && f.won.booleanValue) }; });
    LB.worldState = 'ok';
  } catch (e) { LB.worldState = 'error'; console.warn('[ranking] mundial:', e.message || e); }
  onChange();
}
async function postWorld(e) {
  if (!worldOn()) return;
  try {
    // t = hora do servidor (a regra exige), via transformação de campo
    const doc = `projects/${FIREBASE.projectId}/databases/(default)/documents/scores/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const r = await fetch(`${API()}:commit?key=${FIREBASE.apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes: [{
        update: { name: doc, fields: { name: { stringValue: e.n }, score: { integerValue: String(e.s) }, wave: { integerValue: String(e.w) }, won: { booleanValue: !!e.won }, v: { stringValue: VERSION } } },
        updateTransforms: [{ fieldPath: 't', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { exists: false },
      }] }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
  } catch (err) { console.warn('[ranking] não enviou:', err.message || err); }
  await fetchWorld();
}

/** Registra a pontuação da partida (local + mundial). */
export function submitScore(score, wave, won) {
  const e = { n: playerName(), s: Math.max(0, Math.round(score)), w: wave, won: !!won, t: Date.now() };
  LB.me = e;
  if (e.s > 0) {
    LB.local.push(e);
    LB.local.sort((a, b) => b.s - a.s);
    LB.local.length = Math.min(LB.local.length, LOCAL_MAX);
    save('cr3_scores', LB.local);
    postWorld(e);
  }
  onChange();
  return e;
}

// ---------- painel 3D ----------
const W = 1280, H = 860;
const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
const cx = cv.getContext('2d');
const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
const panel = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 3.3 * H / W), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, fog: false, toneMapped: false }));
panel.renderOrder = 996; panel.visible = false;
scene.add(panel);
let shownKind = null;

function column(x0, w, title, color, rows, state) {
  const x = cx;
  x.fillStyle = 'rgba(255,255,255,0.07)'; roundRect(x, x0, 250, w, 500, 26); x.fill();
  x.textAlign = 'center'; x.textBaseline = 'middle';
  fitText(x, title, x0 + w / 2, 290, w - 40, 44, FONT, color);
  if (state) { x.textAlign = 'center'; fitText(x, state, x0 + w / 2, 480, w - 60, 30, FONT_UI, '#b8c0d0', false, '700'); return; }
  const me = LB.me;
  let marked = false;
  rows.slice(0, 8).forEach((r, i) => {
    const y = 350 + i * 50;
    const mine = me && !marked && r.n === me.n && r.s === me.s;
    if (mine) { marked = true; x.fillStyle = 'rgba(141,255,74,0.22)'; roundRect(x, x0 + 14, y - 23, w - 28, 46, 12); x.fill(); }
    const col = mine ? '#8dff4a' : i === 0 ? '#ffd040' : '#ffffff';
    x.textAlign = 'left'; fitText(x, (i + 1) + '.', x0 + 30, y, 60, 32, FONT, col);
    fitText(x, r.n + (r.won ? ' 🏆' : ''), x0 + 84, y, w - 300, 32, FONT, col);
    x.textAlign = 'right'; fitText(x, fmt(r.s), x0 + w - 30, y, 190, 32, FONT, col);
  });
  if (!rows.length) { x.textAlign = 'center'; fitText(x, tr('ainda vazio', 'empty so far', 'vielä tyhjä'), x0 + w / 2, 480, w - 60, 30, FONT_UI, '#b8c0d0', false, '700'); }
}
function draw() {
  const x = cx, win = shownKind === 'win';
  x.clearRect(0, 0, W, H);
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, win ? 'rgba(46,26,84,0.96)' : 'rgba(58,18,26,0.96)'); g.addColorStop(1, 'rgba(12,8,24,0.96)');
  roundRect(x, 8, 8, W - 16, H - 16, 44); x.fillStyle = g; x.fill();
  x.lineWidth = 10; x.strokeStyle = win ? '#ffd040' : '#ff5a5a'; x.stroke();
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineJoin = 'round'; x.lineWidth = 12; x.strokeStyle = 'rgba(0,0,0,0.6)';
  x.font = '92px ' + FONT; const title = win ? tr('VITÓRIA!', 'VICTORY!', 'VOITTO!') : 'GAME OVER';
  x.strokeText(title, W / 2, 84); x.fillStyle = win ? '#ffd040' : '#ff5a5a'; x.fillText(title, W / 2, 84);
  const me = LB.me;
  if (me) {
    fitText(x, me.n + ' · ' + fmt(me.s) + tr(' pontos', ' points', ' pistettä') + (G.newRecord ? '  🏆 ' + tr('NOVO RECORDE!', 'NEW RECORD!', 'UUSI ENNÄTYS!') : ''), W / 2, 168, W - 120, 46, FONT, '#ffffff');
    fitText(x, win ? tr('você salvou o galinheiro!', 'you saved the coop!', 'pelastit kanalan!') : tr('chegou na wave ', 'reached wave ', 'pääsit aaltoon ') + me.w + '/10', W / 2, 218, W - 120, 30, FONT_UI, '#d8c8ff', false, '700');
  }
  column(40, 590, '🏠 ' + tr('MELHORES DESTE APARELHO', 'BEST ON THIS DEVICE', 'TÄMÄN LAITTEEN PARHAAT'), '#8dff4a', LB.local, G.testWave ? tr('modo teste: não conta', 'test mode: not counted', 'testitila: ei lasketa') : '');
  const ws = !worldOn() ? tr('em breve', 'coming soon', 'tulossa pian') : LB.worldState === 'loading' && !LB.world.length ? tr('carregando…', 'loading…', 'ladataan…') : LB.worldState === 'error' && !LB.world.length ? tr('sem conexão', 'offline', 'ei yhteyttä') : '';
  column(650, 590, '🌍 ' + tr('MELHORES DO MUNDO', 'BEST IN THE WORLD', 'MAAILMAN PARHAAT'), '#60d0ff', LB.world, ws);
  x.textAlign = 'center';
  const again = xrActive() ? tr('aperte o gatilho pra jogar de novo', 'pull the trigger to play again', 'pelaa uudelleen liipaisimella') : isTouch ? tr('toque pra jogar de novo', 'tap to play again', 'napauta pelataksesi uudelleen') : tr('clique pra jogar de novo', 'click to play again', 'klikkaa pelataksesi uudelleen');
  fitText(x, again, W / 2, 800, W - 120, 36, FONT, '#ffe9a8');
  tex.needsUpdate = true;
}
const _f = new THREE.Vector3();
/** kind: 'win' | 'lose' */
export function showRanking(kind) {
  shownKind = kind;
  draw();
  camera.getWorldDirection(_f); _f.y = 0; if (_f.lengthSq() < 1e-4) _f.set(0, 0, 1); _f.normalize();
  panel.position.copy(camPos).addScaledVector(_f, fitDistance(1.85, 3.0));
  panel.position.y = camPos.y + 0.05;
  panel.lookAt(camPos);
  panel.visible = true;
}
/** Fora do VR o painel acompanha a câmera (no VR fica parado no mundo, na sua frente). */
export function updateRanking() {
  if (!panel.visible || xrActive()) return;
  camera.updateWorldMatrix(true, false);
  camera.getWorldDirection(_f);
  panel.position.copy(camPos).addScaledVector(_f, fitDistance(1.85, 3.0));
  panel.quaternion.copy(camera.getWorldQuaternion(_pq));
}
const _pq = new THREE.Quaternion();
export function hideRanking() { panel.visible = false; shownKind = null; }
export const rankingShown = () => panel.visible;

// ---------- tela inicial (HTML) ----------
function htmlList(rows, empty) {
  if (!rows.length) return '<li class="rk-empty">' + empty + '</li>';
  return rows.slice(0, 5).map((r, i) => '<li><b>' + (i + 1) + '.</b> <span>' + r.n.replace(/[<>&]/g, '') + (r.won ? ' 🏆' : '') + '</span> <i>' + fmt(r.s) + '</i></li>').join('');
}
export function refreshHtmlRanking() {
  const a = document.getElementById('rk-local'), b = document.getElementById('rk-world');
  if (a) a.innerHTML = htmlList(LB.local, tr('jogue para entrar aqui', 'play to get on the board', 'pelaa päästäksesi listalle'));
  if (b) b.innerHTML = !worldOn() ? '<li class="rk-empty">' + tr('em breve', 'coming soon', 'tulossa pian') + '</li>' : htmlList(LB.world, LB.worldState === 'error' ? tr('sem conexão', 'offline', 'ei yhteyttä') : tr('carregando…', 'loading…', 'ladataan…'));
}
onRankingChange(() => { refreshHtmlRanking(); if (panel.visible) draw(); });
