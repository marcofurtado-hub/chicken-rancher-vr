// =============================================================================
// CORE — estado global do jogo, utilidades e vetores temporários.
// Regra: nenhum módulo guarda estado de partida fora daqui (exceto listas de entidades
// nos próprios módulos). Assim resetGame() zera tudo num lugar só.
// =============================================================================
import { THREE } from './render.js';

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
export const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; };
export const fmt = n => Math.round(n).toLocaleString('pt-BR');

/** Pool de vetores temporários: cada módulo pega os seus com tmpV(n) no topo e reaproveita. */
export function tmpV(n) { return Array.from({ length: n }, () => new THREE.Vector3()); }

// Armazenamento local (protegido: pode falhar em aba anônima)
export function load(key, def) { try { const v = localStorage.getItem(key); return v === null ? def : JSON.parse(v); } catch (e) { return def; } }
export function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }

export const MAX_CHICKENS = 12;
export const BASE_COMBO_WINDOW = 2.6;
export const SKILL_DUR = 8, MAX_SLOTS = 3;

// Valores neutros dos modificadores (recalculados a cada frame pelas habilidades ativas)
export const UP_DEFAULTS = {
  dmg: 1, rate: 1, front: 0, diag: 0, ricochet: 0, pierce: 0, fire: 0, ice: 0, shock: 0,
  critChance: 0, slowSkill: 1, bubble: 0, armor: 0,
};

/** Estado da partida. */
export const G = {
  state: 'idle',          // idle | wave_intro | playing | wave_complete | upgrade | victory | game_over
  stateT: 0,
  time: 0,                // tempo real acumulado
  timeScale: 1,           // câmera lenta global (hit-stop, ultimate)
  hitStop: 0,
  wave: 0,
  waveDef: null,
  score: 0,
  best: load('cr3_best', 0),
  lastScore: 0,
  newRecord: false,
  combo: 0, comboT: 0, lastMult: 1, lastKillT: -10, multiN: 0, killsSinceDrop: 0,
  waveLost: 0, waveKills: 0, waveShots: 0, waveHits: 0, waveDamage: 0,
  hp: 100, hpMax: 100, invulnT: 0,
  ult: 0,                 // medidor da CHUVA DE OVOS (0..1)
  ultActive: 0,
  weapon: 'hands',
  unlocked: new Set(['hands']),
  power: { golden: 0, boom: 0, slow: 0 },
  up: Object.assign({}, UP_DEFAULTS),
  slots: [],              // habilidades equipadas { sk, lv, active, cd }
  pendingPicks: 0,
  tod: 0, todTarget: 0,
  paused: false,
  settings: Object.assign({ vignette: true, turn: 'smooth', turnSpeed: 1, music: 0.45, sfx: 1, hand: 'right' }, load('cr3_settings', {})),
};
export function saveSettings() { save('cr3_settings', G.settings); }

export const comboWindow = () => BASE_COMBO_WINDOW;
export const comboMult = () => Math.min(5, 1 + Math.floor(Math.max(0, G.combo - 1) / 3));
export const playing = () => G.state === 'playing' || G.state === 'wave_intro';
