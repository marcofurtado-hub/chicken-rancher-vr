// =============================================================================
// AUDIO — Chicken Rancher VR 3.0
// Procedural Web Audio engine: SFX one-shots, spatial loops, music, stingers.
// No audio files: every sound is synthesized live, or baked ONCE into a buffer at init.
//
// Signal flow
//   one-shot voice:  sources → v.out ─┬→ [air lowpass if far] → [panner if pos] → sfxBus ─┐
//                                     └→ reverb send (more wet when far) ───────→ revIn   │
//   loop voice:      same, long-lived; "virtualized" (only the N most audible per name    │
//                    are real nodes, the rest are silent bookkeeping)                      │
//   music.js layers → musicIn (duck) → EQ dip 2.5 kHz → lowpass (muffle) → musicBus ─┬────┤
//                                                                               revIn ←┘   │
//   revIn → Convolver (generated 1.2 s porch IR) → revOut ─────────────────────────────────┤
//   master ← sfxBus + musicBus + revOut → DynamicsCompressor → soft-clip (≤ 0.95) → out    ┘
//
// CPU notes (Quest): ≤ 28 one-shot voices (oldest/lowest-priority stolen), per-sound rate
// limit + per-sound voice cap, typical sound = 6–14 nodes, noise buffers cached once,
// 'equalpower' panning everywhere by default (HRTF = 2 FFT convolutions per source; in VR
// head-tracking already resolves front/back, so it isn't worth it on Quest). Desktop can
// opt in with setSpatialQuality('hrtf'), which applies to the few long-lived loops only.
// Every node is disconnected when its voice ends (janitor every 200 ms), see __audioDebug().
// =============================================================================

import { createMusic, getInstruments, pickSample, mtof, MUSIC_MODES, STINGER_NAMES } from './music.js';

export { MUSIC_MODES, STINGER_NAMES };

// ---------- tunables ----------
const MAX_VOICES = 28;            // global one-shot polyphony
const REF_DIST = 3;               // PannerNode refDistance (m) default
const ROLLOFF = 0.7;              // inverse model: 25 m → ~-16 dB, 50 m → ~-21 dB
const SFX_LEVEL = 2.2;            // global one-shot level (per-sound `vol` is loudness-normalized against it)
const LOOP_LEVEL = 1;
const DEF_VOL = { master: 0.9, music: 0.45, sfx: 1 };
const IS_MOBILE_VR = typeof navigator !== 'undefined' && /OculusBrowser|Quest|Pico|Android|iPhone|iPad/i.test(navigator.userAgent || '');

// ---------- module state ----------
let LIVE = null;                  // engine bound to the real AudioContext
let E = null;                     // engine currently targeted (LIVE, or an offline engine during __renderOffline)
const vols = { ...DEF_VOL };
let musicOn = true;
let hrtfLoops = false;
const warned = new Set();
const loopReg = new Map();        // name -> Set<LoopHandle> (live loops only, incl. pre-init virtual ones)
const musicWant = { mode: 'off', intensity: 0, tempo: null };
let janitorTimer = null;
let heartVoice = null;
let heartWant = false;

const DBG = {
  nodes: 0, musicNodes: 0, peakNodes: 0, voicesStarted: 0, stolen: 0, dropped: 0, rateLimited: 0,
  loopsReal: 0, cpuMs: 0, calls: 0,
};

// ---------- small utils ----------
const R = (a, b) => a + Math.random() * (b - a);
const RI = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const distGain = (d, ref) => ref / (ref + ROLLOFF * Math.max(0, d - ref));
const sorted = (n, a, b) => Array.from({ length: n }, () => R(a, b)).sort((x, y) => x - y);

// =============================================================================
// ENGINE (one per AudioContext; offline renders build their own)
// =============================================================================
const bufCache = new Map();
function getNoise(sr) {
  const key = 'noise' + sr;
  if (bufCache.has(key)) return bufCache.get(key);
  const len = sr * 2, mk = () => new AudioBuffer({ length: len, sampleRate: sr, numberOfChannels: 1 });
  const w = mk(), p = mk(), b = mk();
  const wd = w.getChannelData(0), pd = p.getChannelData(0), bd = b.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  for (let i = 0; i < len; i++) {
    const x = Math.random() * 2 - 1;
    wd[i] = x;
    // Paul Kellet's pink filter
    b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856; b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
    pd[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362; b6 = x * 0.115926;
    br = (br + 0.02 * x) / 1.02; bd[i] = br;
  }
  // normalize each colour to the same RMS (0.3) so `vol` means the same thing for all
  for (const d of [wd, pd, bd]) { let s = 0; for (let i = 0; i < len; i++) s += d[i] * d[i]; const k = 0.3 / Math.sqrt(s / len); for (let i = 0; i < len; i++) d[i] *= k; }
  const out = { white: w, pink: p, brown: b };
  bufCache.set(key, out);
  return out;
}
/** Outdoor porch impulse: 8 ms predelay, a few early reflections (floor, wall, roof), short darkening diffuse tail. */
function getIR(sr, dur = 1.2) {
  const key = 'ir' + sr;
  if (bufCache.has(key)) return bufCache.get(key);
  const len = Math.floor(sr * dur), buf = new AudioBuffer({ length: len, sampleRate: sr, numberOfChannels: 2 });
  const er = [[0.011, 0.7, 0.4], [0.017, 0.35, 0.6], [0.023, 0.45, 0.25], [0.031, 0.2, 0.35], [0.043, 0.25, 0.2]];
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c); let lp = 0;
    for (let i = Math.floor(0.008 * sr); i < len; i++) {
      const t = i / sr - 0.008, k = 0.15 + 0.75 * Math.min(1, t / dur);
      lp += (1 - k) * (Math.random() * 2 - 1 - lp);
      const comp = Math.sqrt((1 + k) / (1 - k));                // keep RMS as the filter darkens
      const sparse = t < 0.06 ? (Math.random() < 0.25 ? 1.6 : 0.15) : 1;
      d[i] = lp * comp * Math.exp((-6.9 * t) / (dur - 0.008)) * sparse * 0.5;
    }
    for (const [t, a, b] of er) { const i = Math.floor(t * sr * (c ? 1.07 : 1)); for (let j = 0; j < 24; j++) d[i + j] += (c ? b : a) * Math.exp(-j / 5) * (j % 2 ? -1 : 1); }
  }
  bufCache.set(key, buf);
  return buf;
}
let clipCurve = null;
function getClipCurve() {
  // Input is pre-scaled by 0.5, so the curve covers ±2.0. Transparent below 0.8, tanh knee to a 0.95 ceiling.
  if (clipCurve) return clipCurve;
  const n = 4096; clipCurve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = ((i / (n - 1)) * 2 - 1) * 2, a = Math.abs(x); clipCurve[i] = Math.sign(x) * (a < 0.8 ? a : 0.8 + 0.15 * Math.tanh((a - 0.8) / 0.15)); }
  return clipCurve;
}

function buildEngine(ctx, offline) {
  const sr = ctx.sampleRate;
  const e = { ctx, offline, voices: [], last: new Map(), lis: { pos: { x: 0, y: 1.2, z: 0 } } };
  e.noise = getNoise(sr);
  e.inst = getInstruments(sr, offline);             // live: baked in small async slices
  const G = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };

  // master: compressor (glue + peak control) then a soft clipper as the final safety net
  e.master = G(vols.master);
  e.comp = ctx.createDynamicsCompressor();
  e.comp.threshold.value = -10; e.comp.knee.value = 8; e.comp.ratio.value = 6; e.comp.attack.value = 0.002; e.comp.release.value = 0.2;
  e.trim = G(0.82);                                  // undo part of the compressor's automatic makeup gain
  e.pre = G(0.5);
  e.clip = ctx.createWaveShaper(); e.clip.curve = getClipCurve(); e.clip.oversample = 'none';
  e.master.connect(e.comp); e.comp.connect(e.trim); e.trim.connect(e.pre); e.pre.connect(e.clip); e.clip.connect(ctx.destination);

  e.sfxBus = G(vols.sfx); e.sfxBus.connect(e.master);
  // music chain: duck → mid dip (so SFX cut through) → lowpass (heartbeat muffle) → bus
  e.musicIn = G(1);
  e.musicEQ = ctx.createBiquadFilter(); e.musicEQ.type = 'peaking'; e.musicEQ.frequency.value = 2500; e.musicEQ.Q.value = 0.8; e.musicEQ.gain.value = -3;
  e.musicLP = ctx.createBiquadFilter(); e.musicLP.type = 'lowpass'; e.musicLP.frequency.value = 20000; e.musicLP.Q.value = 0.5;
  e.musicBus = G(musicOn ? vols.music : 0);
  e.musicIn.connect(e.musicEQ); e.musicEQ.connect(e.musicLP); e.musicLP.connect(e.musicBus); e.musicBus.connect(e.master);
  // reverb send bus
  e.revIn = G(1); e.conv = ctx.createConvolver(); e.conv.buffer = getIR(sr); e.revOut = G(0.55);
  e.revIn.connect(e.conv); e.conv.connect(e.revOut); e.revOut.connect(e.master);
  const musRev = G(0.12); e.musicBus.connect(musRev); musRev.connect(e.revIn);
  // stingers: musical one-shots on the SFX side (they stay audible with music toggled off)
  e.stingerOut = G(0.5); e.stingerOut.connect(e.sfxBus);
  const stRev = G(0.2); e.stingerOut.connect(stRev); stRev.connect(e.revIn);

  e.music = createMusic({
    ctx, inst: e.inst, dbg: offline ? { musicNodes: 0 } : DBG, offline, musicIn: e.musicIn, stingerOut: e.stingerOut,
    duck: (depth, hold) => duck(e, depth, hold),
  });
  return e;
}

/** Dip the music (side-chain style) under loud SFX / stingers. */
function duck(e, depth, hold) {
  const P = e.musicIn.gain, t = e.ctx.currentTime;
  if (P.cancelAndHoldAtTime) P.cancelAndHoldAtTime(t); else P.cancelScheduledValues(t);
  P.setTargetAtTime(1 - depth, t, 0.02);
  P.setTargetAtTime(1, t + hold, 0.3);
}

// =============================================================================
// VOICES + node helpers (each helper registers nodes on the voice for cleanup)
// =============================================================================
function reg(v, n) { v.nodes.push(n); if (!v.e.offline) { DBG.nodes++; if (DBG.nodes > DBG.peakNodes) DBG.peakNodes = DBG.nodes; } return n; }
function run(v, s, t0, t1, offset) { v.srcs.push(s); if (offset !== undefined) s.start(t0, offset); else s.start(t0); if (t1 !== undefined) { s.stop(t1); if (t1 > v.end) v.end = t1; } return s; }
function G(v, val = 1) { const g = reg(v, v.ctx.createGain()); g.gain.value = val; return g; }
function F(v, type, f, q = 0.8) { const b = reg(v, v.ctx.createBiquadFilter()); b.type = type; b.frequency.value = Math.min(f, 20000); b.Q.value = q; return b; }
function OSC(v, type) { const o = reg(v, v.ctx.createOscillator()); o.type = type; return o; }
function NSRC(v, color, rate = 1) { const s = reg(v, v.ctx.createBufferSource()); s.buffer = v.e.noise[color]; s.loop = true; s.playbackRate.value = rate; return s; }

/** Frequency automation: either f→f2 (exp) over `dur`, or fx = [[fraction, freq], ...] exp segments. */
function sweep(P, t, dur, f, f2, fx, p) {
  if (fx) { P.setValueAtTime(Math.min(20000, fx[0][1] * p), t + fx[0][0] * dur); for (let i = 1; i < fx.length; i++) P.exponentialRampToValueAtTime(clamp(fx[i][1] * p, 1, 20000), t + fx[i][0] * dur); }
  else { P.setValueAtTime(Math.min(20000, f * p), t); if (f2) P.exponentialRampToValueAtTime(clamp(f2 * p, 1, 20000), t + dur); }
}
/** Amplitude envelope. kind: 'exp' (default percussive) | 'lin' | 'swell' (grows to the end). */
function envl(P, t, dur, vol, a = 0.003, hold = 0, kind) {
  vol = Math.max(vol, 1e-4);
  if (kind === 'swell') { P.setValueAtTime(1e-4, t); P.exponentialRampToValueAtTime(vol, t + dur * 0.9); P.linearRampToValueAtTime(0, t + dur); return; }
  if (a + hold > dur - 0.005) dur = a + hold + 0.01;
  P.setValueAtTime(0, t); P.linearRampToValueAtTime(vol, t + a);
  if (hold > 0) P.setValueAtTime(vol, t + a + hold);
  if (kind === 'lin') P.linearRampToValueAtTime(0, t + dur);
  else { P.exponentialRampToValueAtTime(vol * 1e-3, t + dur); P.linearRampToValueAtTime(0, t + dur + 0.005); }
}
/**
 * Oscillator voice. o: { f2, fx, at, vol, a, hold, env, lp, q, det, vib:[rateHz, depthHz], trem:[rateHz, depth 0..1], dt, dest }
 * All frequencies are multiplied by the voice pitch v.p.
 */
function tone(v, type, t, dur, f, o = {}) {
  t += o.dt || 0;
  const os = OSC(v, type);
  sweep(os.frequency, t, o.at || dur, f, o.f2, o.fx, v.p);
  if (o.det) os.detune.value = o.det;
  let head = os;
  if (o.lp) { const lp = F(v, 'lowpass', o.lp, o.q ?? 0.7); os.connect(lp); head = lp; }
  const g = G(v, 0); envl(g.gain, t, dur, o.vol ?? 0.3, o.a ?? 0.003, o.hold || 0, o.env);
  head.connect(g);
  let out = g;
  if (o.trem) { const am = G(v, 1 - o.trem[1]), l = OSC(v, 'sine'), lg = G(v, o.trem[1]); l.frequency.value = o.trem[0]; l.connect(lg); lg.connect(am.gain); g.connect(am); out = am; run(v, l, t, t + dur + 0.02); }
  if (o.vib) { const l = OSC(v, 'sine'), lg = G(v, o.vib[1] * v.p); l.frequency.value = o.vib[0]; l.connect(lg); lg.connect(os.frequency); run(v, l, t, t + dur + 0.02); }
  out.connect(o.dest || v.out);
  run(v, os, t, t + dur + 0.02);
  return os;
}
/** Filtered noise burst. o: { type, f, f2, fx, at, q, vol, a, hold, env, rate, dt, dest } (filter freqs follow pitch). */
function noise(v, color, t, dur, o = {}) {
  t += o.dt || 0;
  const s = NSRC(v, color, o.rate || 1);
  let head = s;
  if (o.type) { const f = F(v, o.type, o.f || 1000, o.q ?? 0.8); sweep(f.frequency, t, o.at || dur, o.f || 1000, o.f2, o.fx, Math.min(v.p, 2.5)); s.connect(f); head = f; }
  const g = G(v, 0); envl(g.gain, t, dur, o.vol ?? 0.3, o.a ?? 0.002, o.hold || 0, o.env);
  head.connect(g); g.connect(o.dest || v.out);
  run(v, s, t, t + dur + 0.02, Math.random() * 1.5);
}
/**
 * Many tiny clicks from ONE noise source: crackles, shell cracks, wing flutter, ratchets.
 * times are offsets (s, ascending), amps 0..1. o: { color, type, f, q, dec, vol, fjit, dest }
 */
function pops(v, t, times, amps, o = {}) {
  const s = NSRC(v, o.color || 'white'), fq = o.f || 3000, f = F(v, o.type || 'bandpass', fq * Math.min(v.p, 2), o.q ?? 1);
  const g = G(v, 0), dec = o.dec || 0.015, vol = o.vol ?? 0.5;
  s.connect(f); f.connect(g); g.connect(o.dest || v.out);
  for (let i = 0; i < times.length; i++) {
    const T = t + times[i], nxt = i + 1 < times.length ? t + times[i + 1] : Infinity;
    const d = Math.max(0.003, Math.min(dec, nxt - T - 0.001)), A = Math.max(1e-4, vol * (amps[i] ?? 1));
    if (o.fjit) f.frequency.setValueAtTime(Math.min(20000, fq * R(1 - o.fjit, 1 + o.fjit) * Math.min(v.p, 2)), T);
    g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(A, T + 0.0012); g.gain.exponentialRampToValueAtTime(A * 0.003, T + d); g.gain.linearRampToValueAtTime(0, T + d + 0.0005);
  }
  run(v, s, t, t + times[times.length - 1] + dec + 0.02, Math.random() * 1.5);
}
/** Inharmonic struck-metal partials (bar modes 1, 2.76, 5.4, 8.9). Higher partials decay faster. */
function metal(v, t, f, dur, vol, ratios = [1, 2.76, 5.4], o = {}) {
  ratios.forEach((r, i) => tone(v, 'sine', t, dur / (1 + i * 0.7), f * r, { vol: vol / (1 + i * 0.6), a: 0.001, dt: o.dt, dest: o.dest }));
}
/** Several oscillators into one shared lowpass (fx-able) + one envelope. Cheap "chord"/BRAAM. */
function chordOsc(v, t, dur, freqs, o = {}) {
  t += o.dt || 0;
  const lp = F(v, 'lowpass', o.lp || 1000, o.q ?? 1);
  if (o.lpfx) sweep(lp.frequency, t, dur, 0, 0, o.lpfx, 1);
  const g = G(v, 0); envl(g.gain, t, dur, o.vol ?? 0.3, o.a ?? 0.01, o.hold || 0, o.env);
  lp.connect(g); g.connect(o.dest || v.out);
  for (const f of freqs) {
    const os = OSC(v, o.type || 'sawtooth');
    os.frequency.setValueAtTime(f * v.p, t);
    if (o.f2mul) os.frequency.exponentialRampToValueAtTime(f * o.f2mul * v.p, t + dur);
    os.detune.value = (Math.random() * 2 - 1) * (o.det ?? 8);
    os.connect(lp); run(v, os, t, t + dur + 0.02);
  }
}
/**
 * Formant "voice box" for the chickens: one sawtooth with a pitch contour per syllable,
 * through two band-pass formants, gated per syllable. Optional rasp noise.
 * syl: [{ at, d, f:[f0, f1, ...], a }], o: { F1, F2, q1, q2, F2g, vol, rasp, type }
 */
function vocal(v, t, syl, o = {}) {
  const p = v.p, os = OSC(v, o.type || 'sawtooth');
  const f1 = F(v, 'bandpass', (o.F1 || 900) * Math.sqrt(p), o.q1 ?? 5), f2 = F(v, 'bandpass', (o.F2 || 2000) * Math.sqrt(p), o.q2 ?? 6);
  const g2 = G(v, o.F2g ?? 0.7), amp = G(v, 0), vol = o.vol ?? 0.5;
  os.connect(f1); f1.connect(amp); os.connect(f2); f2.connect(g2); g2.connect(amp); amp.connect(o.dest || v.out);
  let rg = null, rs = null;
  if (o.rasp) { rs = NSRC(v, 'white'); const rf = F(v, 'bandpass', (o.F2 || 2000) * p, 1.2); rg = G(v, 0); rs.connect(rf); rf.connect(rg); rg.connect(o.dest || v.out); }
  let end = t;
  for (const s of syl) {
    const T = t + s.at, D = s.d, A = vol * (s.a ?? 1);
    os.frequency.setValueAtTime(s.f[0] * p, T);
    for (let k = 1; k < s.f.length; k++) os.frequency.linearRampToValueAtTime(s.f[k] * p, T + (D * k) / (s.f.length - 1));
    for (const [P, a] of rg ? [[amp.gain, A], [rg.gain, A * o.rasp]] : [[amp.gain, A]]) {
      P.setValueAtTime(0, T); P.linearRampToValueAtTime(a, T + Math.min(0.012, D * 0.2)); P.linearRampToValueAtTime(a * 0.7, T + D * 0.75); P.linearRampToValueAtTime(0, T + D);
    }
    end = T + D;
  }
  run(v, os, t, end + 0.03);
  if (rs) run(v, rs, t, end + 0.03, Math.random());
}
/** Play a baked instrument note (banjo/guitar/bell/brass...) inside an SFX voice. */
function samp(v, set, t, midi, vol, o = {}) {
  if (!set) return;                                        // instruments still baking (first ~0.1 s after init)
  t += o.dt || 0;
  const s = pickSample(set, mtof(midi) * v.p), b = reg(v, v.ctx.createBufferSource());
  b.buffer = s.buf; b.playbackRate.value = s.rate;
  const g = G(v, vol);
  if (o.dur) { g.gain.setValueAtTime(vol, t + o.dur); g.gain.linearRampToValueAtTime(0, t + o.dur + 0.08); }
  b.connect(g); g.connect(o.dest || v.out);
  const len = s.buf.duration / s.rate;
  run(v, b, t, t + (o.dur ? Math.min(len, o.dur + 0.1) : len));
}
function drum(v, name, t, vol, rate = 1) {
  if (!v.e.inst[name]) return;
  const b = reg(v, v.ctx.createBufferSource()); b.buffer = v.e.inst[name].buf; b.playbackRate.value = rate * v.p;
  const g = G(v, vol); b.connect(g); g.connect(v.out); run(v, b, t, t + b.buffer.duration / (rate * v.p));
}
const bells = (v, t, midis, step, vol, o = {}) => midis.forEach((m, i) => samp(v, v.e.inst.bell, t + i * step, m, vol, o));

function makePanner(ctx, ref, hrtf) {
  const p = ctx.createPanner();
  p.panningModel = hrtf ? 'HRTF' : 'equalpower';
  p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = ROLLOFF; p.maxDistance = 10000;
  return p;
}
function setPannerPos(p, v) {
  if (p.positionX) { p.positionX.value = v.x; p.positionY.value = v.y; p.positionZ.value = v.z; } else p.setPosition(v.x, v.y, v.z);
}
const airCutoff = (d) => (d <= 12 ? 20000 : clamp(16000 * Math.pow(12 / d, 1.15), 2500, 20000));

/**
 * Create the output stage of a voice: v.out → [air LP] → [panner] → sfxBus, + reverb send.
 * Distant sounds get less direct level (panner), duller top (air) and relatively more reverb.
 */
function newVoice(e, name, def, opts, t, isLoop) {
  const ctx = e.ctx;
  const v = { e, ctx, name, def, t0: t, end: t + 0.05, nodes: [], srcs: [], pri: def.pri ?? 1, dead: false, p: 1, out: null, pn: null, air: null };
  let p = opts.pitch || 1;
  if (opts.detune) p *= Math.pow(2, opts.detune / 1200);
  const jit = def.jit ?? 0.03; if (jit && !isLoop) p *= 1 + (Math.random() * 2 - 1) * jit;
  v.p = p;
  v.out = G(v, 0);
  let tail = v.out, wet = 1;
  const pos = def.pos === false ? null : opts.pos;
  if (pos || (isLoop && def.spatial)) {
    const ref = def.ref || REF_DIST, P = pos || e.lis.pos, d = dist(P, e.lis.pos);
    if (d > 12 || isLoop) { v.air = F(v, 'lowpass', airCutoff(d), 0.5); tail.connect(v.air); tail = v.air; }
    v.pn = reg(v, makePanner(ctx, ref, isLoop && hrtfLoops)); setPannerPos(v.pn, P);
    tail.connect(v.pn); tail = v.pn;
    wet = Math.sqrt(distGain(d, ref)) * (1 + Math.min(1, d / 25) * 0.6);
  }
  tail.connect(e.sfxBus);
  const rev = (opts.rev ?? def.rev ?? 0.15) * wet;
  if (rev > 0.005) { const s = G(v, rev); v.out.connect(s); s.connect(e.revIn); }
  return v;
}
function releaseVoice(v) {
  for (const s of v.srcs) { try { s.stop(); } catch (_) { /* already stopped */ } }
  for (const n of v.nodes) { try { n.disconnect(); } catch (_) { /* ignore */ } }
  if (!v.e.offline) DBG.nodes -= v.nodes.length;
  v.nodes.length = 0; v.srcs.length = 0; v.released = true;
}
/** Fast fade + early stop; actual disconnect happens in the janitor once v.end passes. */
function killVoice(v, fade = 0.03) {
  if (v.dead) return;
  v.dead = true;
  const t = v.ctx.currentTime, P = v.out.gain;
  if (P.cancelAndHoldAtTime) P.cancelAndHoldAtTime(t); else { P.cancelScheduledValues(t); P.setValueAtTime(P.value, t); }
  P.linearRampToValueAtTime(0, t + fade);
  for (const s of v.srcs) { try { s.stop(t + fade + 0.01); } catch (_) { /* ignore */ } }
  v.end = t + fade + 0.03;
}

// =============================================================================
// SFX DEFINITIONS
//   vol  per-sound loudness trim. Calibrated offline (dev/audio.html) so the loudest 100 ms
//        window hits a per-tier target: UI -30..-36 dBFS, chickens/foley -20..-27,
//        weapons/impacts -15..-22, eggSplat -18, explosions -11..-16 (music bed ~ -20).
//   gap  min seconds between triggers (rate limit)   max  per-sound voice cap
//   pri  0 low .. 3 critical (stealing order)          jit  random pitch ± fraction
//   rev  reverb send   ref  panner refDistance   duck  music dip 0..1   pos:false = always 2D
//   rapid  retrigger window (s): shots inside it play 3 dB softer (auto-fire stays clean)
//   fn(v, t, opts)   builds the sound into voice v starting at time t
// =============================================================================
const SFX = {
  // ------------------------------------------------------------------ WEAPONS
  throw: { vol: 0.821, gap: 0.04, max: 3, jit: 0.08, rev: 0.08, fn(v, t) {
    const d = R(0.17, 0.25);
    noise(v, 'pink', t, d, { type: 'bandpass', q: 1.3, fx: [[0, R(350, 450)], [0.55, R(1400, 1900)], [1, R(600, 800)]], vol: 0.7, a: d * 0.45 });
    tone(v, 'sine', t, 0.07, 230, { f2: 120, vol: 0.12 });
  } },
  slingPull: { vol: 0.145, gap: 0.15, max: 2, jit: 0.05, rev: 0.05, fn(v, t) {
    const d = 0.32, os = tone(v, 'sawtooth', t, d, 85, { vol: 0.28, a: 0.04, hold: 0.2, lp: 1300, q: 5 });
    for (let k = 1; k < 14; k++) os.frequency.setValueAtTime((85 + k * 4.5) * R(0.93, 1.07) * v.p, t + (k * d) / 14); // creaky rubber
    noise(v, 'pink', t, d, { type: 'bandpass', f: 2400, q: 3, vol: 0.08, a: 0.1 });
  } },
  slingRelease: { vol: 1.48, gap: 0.06, max: 3, jit: 0.05, rev: 0.1, fn(v, t) {
    noise(v, 'white', t, 0.035, { type: 'highpass', f: 1800, vol: 0.75, a: 0.001 });
    tone(v, 'sine', t, 0.1, 520, { f2: 140, vol: 0.45, a: 0.001 });
    tone(v, 'triangle', t, 0.16, 190, { f2: 110, vol: 0.2 });
    noise(v, 'pink', t, 0.2, { type: 'bandpass', f: 900, f2: 2200, q: 1.2, vol: 0.3, a: 0.03 });
  } },
  crossbow: { vol: 1.36, gap: 0.08, max: 3, jit: 0.05, rev: 0.12, fn(v, t) {
    noise(v, 'white', t, 0.02, { type: 'highpass', f: 3000, vol: 0.5, a: 0.001 });
    tone(v, 'sine', t, 0.07, 300, { f2: 110, vol: 0.55, a: 0.001 });
    tone(v, 'sawtooth', t, 0.22, 240, { f2: 115, vol: 0.14, lp: 1600, q: 3 });   // string thwang
    tone(v, 'triangle', t, 0.25, 160, { f2: 96, vol: 0.25 });
    noise(v, 'white', t, 0.17, { type: 'bandpass', f: 3500, f2: 1200, q: 1.5, vol: 0.25, a: 0.01 });
  } },
  pistol: { vol: 1.22, gap: 0.04, max: 4, jit: 0.05, rev: 0.25, duck: 0.15, fn(v, t) {
    tone(v, 'square', t, 0.018, 2400, { f2: 700, vol: 0.22, a: 0.0005 });
    noise(v, 'white', t, 0.07, { type: 'bandpass', f: 2600, q: 0.8, vol: 0.9, a: 0.001 });
    tone(v, 'sine', t, 0.11, 220, { f2: 55, vol: 0.9, a: 0.001 });
    noise(v, 'pink', t, 0.28, { type: 'lowpass', f: 1400, f2: 500, vol: 0.2, a: 0.004 });
  } },
  shotgun: { vol: 0.473, gap: 0.12, max: 3, jit: 0.04, rev: 0.35, ref: 4, duck: 0.45, pri: 2, fn(v, t) {
    noise(v, 'white', t, 0.05, { type: 'highpass', f: 1200, vol: 1, a: 0.0008 });
    noise(v, 'pink', t, 0.45, { type: 'lowpass', f: 3500, f2: 400, vol: 0.95, a: 0.001 });
    tone(v, 'sine', t, 0.5, 110, { f2: 32, vol: 1.1, a: 0.001 });
    tone(v, 'sawtooth', t, 0.12, 160, { f2: 50, vol: 0.3, lp: 900 });
    pops(v, t, [0.38, 0.47], [0.7, 0.9], { type: 'bandpass', f: 2200, q: 2, dec: 0.03, vol: 0.45 });     // pump "chk-chk"
    tone(v, 'square', t, 0.02, 900, { vol: 0.05, dt: 0.38 }); tone(v, 'square', t, 0.02, 700, { vol: 0.06, dt: 0.47 });
  } },
  gatling: { vol: 1.15, rapid: 0.08, gap: 0.03, max: 5, jit: 0.06, rev: 0.1, fn(v, t) {
    noise(v, 'white', t, 0.045, { type: 'bandpass', f: 1900, q: 0.9, vol: 0.75, a: 0.0008 });
    tone(v, 'sine', t, 0.06, 150, { f2: 60, vol: 0.7, a: 0.001 });
    tone(v, 'square', t, 0.012, 1300, { f2: 500, vol: 0.1, a: 0.0005 });
  } },
  launcher: { vol: 0.668, gap: 0.08, max: 3, jit: 0.05, rev: 0.2, duck: 0.25, fn(v, t) {
    tone(v, 'sine', t, 0.22, 240, { f2: 55, vol: 1, a: 0.001 });
    noise(v, 'pink', t, 0.3, { type: 'lowpass', f: 900, f2: 200, vol: 0.6, a: 0.004 });
    noise(v, 'white', t, 0.12, { type: 'highpass', f: 3000, vol: 0.12 });
    tone(v, 'triangle', t, 0.08, 600, { f2: 180, vol: 0.15 });
  } },
  homingLaunch: { vol: 0.811, gap: 0.08, max: 3, jit: 0.04, rev: 0.2, fn(v, t) {
    tone(v, 'sine', t, 0.16, 200, { f2: 70, vol: 0.7, a: 0.001 });
    noise(v, 'white', t, 0.75, { type: 'bandpass', f: 1100, f2: 2400, q: 0.7, vol: 0.35, a: 0.03 });  // rocket hiss
    tone(v, 'square', t, 0.045, 1760, { vol: 0.07 }); tone(v, 'square', t, 0.045, 1760, { vol: 0.07, dt: 0.07 }); // lock-on beeps
    tone(v, 'sawtooth', t, 0.6, 300, { f2: 900, lp: 1500, vol: 0.08, a: 0.05 });
  } },
  laser: { vol: 2.16, rapid: 0.08, gap: 0.025, max: 5, jit: 0.05, rev: 0.12, fn(v, t) {
    tone(v, 'square', t, 0.085, 2600, { f2: 650, lp: 6000, vol: 0.2, a: 0.001 });
    tone(v, 'sine', t, 0.1, 1300, { f2: 330, vol: 0.32, a: 0.001 });
    noise(v, 'white', t, 0.03, { type: 'highpass', f: 5000, vol: 0.12 });
  } },
  tesla: { vol: 2.45, gap: 0.05, max: 3, jit: 0.06, rev: 0.2, fn(v, t) {
    const n = RI(14, 20), ts = sorted(n, 0, 0.17); ts[0] = 0;
    pops(v, t, ts, ts.map(() => R(0.3, 1)), { type: 'bandpass', f: 3500, q: 1.2, fjit: 0.5, dec: 0.012, vol: 0.75 });   // arc crackle
    noise(v, 'white', t, 0.015, { type: 'highpass', f: 2000, vol: 0.8, a: 0.0005 });                                    // snap
    tone(v, 'sawtooth', t, 0.18, 60, { f2: 55, lp: 1800, vol: 0.3, a: 0.002 });                                          // mains buzz
    tone(v, 'square', t, 0.05, 3200, { f2: 1800, vol: 0.05 });
  } },
  teslaChain: { vol: 1.5, gap: 0.03, max: 4, jit: 0.1, rev: 0.15, fn(v, t) {
    const ts = sorted(RI(6, 9), 0, 0.08); ts[0] = 0;
    pops(v, t, ts, ts.map(() => R(0.3, 1)), { type: 'bandpass', f: 4500, q: 1.2, fjit: 0.5, dec: 0.01, vol: 0.6 });
    tone(v, 'sawtooth', t, 0.08, 90, { lp: 2200, vol: 0.15 });
    noise(v, 'white', t, 0.012, { type: 'highpass', f: 3000, vol: 0.4 });
  } },
  fireworkLaunch: { vol: 0.342, gap: 0.08, max: 3, jit: 0.06, rev: 0.3, fn(v, t) {
    tone(v, 'sine', t, 0.1, 160, { f2: 70, vol: 0.5, a: 0.001 });
    tone(v, 'sine', t, 0.95, 900, { f2: 3000, vol: 0.18, a: 0.05, vib: [22, 40] });    // whistle
    noise(v, 'white', t, 1.0, { type: 'highpass', f: 3500, vol: 0.12, a: 0.05 });
  } },
  fireworkBoom: { vol: 0.432, gap: 0.06, max: 3, jit: 0.1, rev: 0.45, ref: 8, duck: 0.6, pri: 2, fn(v, t) {
    noise(v, 'white', t, 0.06, { type: 'highpass', f: 900, vol: 1, a: 0.0005 });
    tone(v, 'sine', t, 0.9, 85, { f2: 30, vol: 1.1, a: 0.002 });
    noise(v, 'brown', t, 1.0, { type: 'lowpass', f: 700, f2: 150, vol: 1, a: 0.003 });
    noise(v, 'pink', t, 0.5, { type: 'lowpass', f: 2500, f2: 500, vol: 0.5 });
    const ts = sorted(RI(20, 28), 0.25, 1.4);
    pops(v, t, ts, ts.map(() => R(0.1, 0.35)), { type: 'highpass', f: 3500, dec: 0.01, vol: 1 });     // sparkle crackle
    const ed = R(0.38, 0.5);                                                                          // distant echo off the hills
    noise(v, 'brown', t, 0.8, { type: 'lowpass', f: 400, vol: 0.35, a: 0.02, dt: ed });
    tone(v, 'sine', t, 0.7, 70, { f2: 35, vol: 0.3, a: 0.01, dt: ed });
  } },
  crackle: { vol: 1.74, gap: 0.06, max: 3, jit: 0.1, rev: 0.25, fn(v, t) {
    const ts = sorted(RI(8, 12), 0, 0.6); ts[0] = 0;
    pops(v, t, ts, ts.map(() => R(0.3, 1)), { type: 'bandpass', f: 3200, q: 0.6, dec: 0.012, vol: 0.8 });
    const tb = sorted(3, 0, 0.5);
    pops(v, t, tb, [0.8, 0.6, 0.7], { color: 'pink', type: 'lowpass', f: 600, dec: 0.04, vol: 0.5 });
  } },
  reload: { vol: 0.46, gap: 0.1, max: 2, jit: 0.04, rev: 0.06, fn(v, t) {
    pops(v, t, [0, 0.13], [0.6, 0.8], { type: 'bandpass', f: 2400, q: 2, dec: 0.035, vol: 0.6 });
    tone(v, 'square', t, 0.015, 1100, { f2: 700, vol: 0.08 }); tone(v, 'square', t, 0.02, 800, { f2: 500, vol: 0.1, dt: 0.13 });
    tone(v, 'sine', t, 0.05, 180, { f2: 90, vol: 0.3, dt: 0.13 });
    noise(v, 'pink', t, 0.08, { type: 'bandpass', f: 1500, vol: 0.1, dt: 0.04 });
  } },
  weaponSwitch: { vol: 1.72, gap: 0.08, max: 2, jit: 0.04, rev: 0.06, pos: false, fn(v, t) {
    noise(v, 'pink', t, 0.12, { type: 'bandpass', f: 800, f2: 2400, q: 1.2, vol: 0.25, a: 0.04 });
    pops(v, t, [0.1], [1], { type: 'bandpass', f: 3000, q: 2, dec: 0.025, vol: 0.5 });
    tone(v, 'triangle', t, 0.04, 1400, { vol: 0.06, dt: 0.1 });
  } },
  weaponPickup: { vol: 0.221, gap: 0.2, max: 2, jit: 0, rev: 0.15, pri: 2, pos: false, fn(v, t) {
    pops(v, t, [0, 0.09], [0.6, 0.8], { type: 'bandpass', f: 2400, q: 2, dec: 0.03, vol: 0.55 });
    samp(v, v.e.inst.banjo, t + 0.12, 67, 0.5); samp(v, v.e.inst.banjo, t + 0.18, 74, 0.5);
    bells(v, t + 0.22, [79, 86, 91], 0.06, 0.35);
    noise(v, 'white', t, 0.4, { type: 'highpass', f: 6000, vol: 0.05, a: 0.1, dt: 0.15 });
  } },
  dryFire: { vol: 3.31, gap: 0.08, max: 2, jit: 0.05, rev: 0.03, fn(v, t) {
    pops(v, t, [0], [1], { type: 'highpass', f: 2500, dec: 0.012, vol: 0.5 });
    tone(v, 'square', t, 0.006, 3000, { vol: 0.05 });
    tone(v, 'sine', t, 0.04, 1800, { f2: 1600, vol: 0.03, dt: 0.01 });
  } },

  // ------------------------------------------------------------------ IMPACTS
  // The signature sound: shell crack + wet squelch (sweeping formant) + body thump + droplets.
  eggSplat: { vol: 2.02, gap: 0.02, max: 6, jit: 0.12, rev: 0.12, fn(v, t, o) {
    const k = o.soft ? 0.6 : 1;
    pops(v, t, [0, R(0.004, 0.009), R(0.013, 0.02)], [1, R(0.4, 0.7), R(0.15, 0.4)], { type: 'bandpass', f: R(2800, 4200), q: 1.2, dec: 0.012, vol: 0.55 * k });
    const d = R(0.16, 0.22);
    noise(v, 'pink', t, d, { type: 'bandpass', q: R(3, 5), fx: [[0, R(1300, 1800)], [1, R(280, 380)]], vol: 1.1 * k, a: 0.004 });
    noise(v, 'brown', t, 0.14, { type: 'lowpass', f: 900, f2: 300, vol: 0.6 * k });
    tone(v, 'sine', t, 0.09, R(170, 210), { f2: 50, vol: 0.55 * k, a: 0.002 });
    for (let i = RI(0, 2); i > 0; i--) tone(v, 'sine', t, 0.035, R(650, 900), { f2: R(1400, 1800), vol: 0.09, a: 0.002, dt: R(0.09, 0.22) });  // "plip"
  } },
  eggHitUfo: { vol: 0.754, gap: 0.03, max: 4, jit: 0.08, rev: 0.18, fn(v, t) {
    noise(v, 'white', t, 0.015, { type: 'highpass', f: 2500, vol: 0.5, a: 0.0005 });
    metal(v, t, R(480, 560), 0.4, 0.4, [1, 2.76, 5.4]);
    noise(v, 'pink', t, 0.15, { type: 'bandpass', q: 3.5, fx: [[0, 1500], [1, 350]], vol: 0.7, a: 0.003, dt: 0.005 });
    tone(v, 'sine', t, 0.08, 190, { f2: 60, vol: 0.4 });
  } },
  crit: { vol: 1.11, gap: 0.06, max: 3, jit: 0.03, rev: 0.2, pri: 2, fn(v, t) {
    noise(v, 'white', t, 0.05, { type: 'highpass', f: 3000, vol: 0.5, a: 0.0005 });
    tone(v, 'square', t, 0.06, 1600, { f2: 3200, lp: 7000, vol: 0.1 });
    tone(v, 'sine', t, 0.35, 2093, { vol: 0.22, a: 0.001 }); tone(v, 'sine', t, 0.25, 3136, { vol: 0.12, a: 0.001 });
    tone(v, 'sine', t, 0.12, 180, { f2: 60, vol: 0.5 });
  } },
  tink: { vol: 1.15, gap: 0.04, max: 3, jit: 0.06, rev: 0.15, fn(v, t) {
    noise(v, 'white', t, 0.01, { type: 'highpass', f: 5000, vol: 0.3 });
    metal(v, t, R(2400, 2900), 0.18, 0.28, [1, 2.76]);
  } },
  shieldTink: { vol: 0.923, gap: 0.04, max: 3, jit: 0.05, rev: 0.2, fn(v, t) {
    tone(v, 'sine', t, 0.3, 1400, { vol: 0.18, a: 0.001 }); tone(v, 'sine', t, 0.3, 1437, { vol: 0.14, a: 0.001 });   // beating = energy
    tone(v, 'triangle', t, 0.12, 2800, { f2: 2100, vol: 0.08 });
    noise(v, 'white', t, 0.15, { type: 'bandpass', f: 6000, vol: 0.06 });
  } },
  explosionSmall: { vol: 0.637, gap: 0.03, max: 4, jit: 0.1, rev: 0.3, ref: 4, duck: 0.35, pri: 1, fn(v, t) {
    noise(v, 'white', t, 0.04, { type: 'highpass', f: 1200, vol: 0.7, a: 0.0005 });
    noise(v, 'pink', t, 0.4, { type: 'lowpass', f: 2500, f2: 300, vol: 0.9, a: 0.002 });
    tone(v, 'sine', t, 0.32, 95, { f2: 38, vol: 0.95, a: 0.002 });
    noise(v, 'brown', t, 0.3, { type: 'lowpass', f: 800, vol: 0.4 });
  } },
  explosionBig: { vol: 0.556, gap: 0.05, max: 3, jit: 0.08, rev: 0.5, ref: 7, duck: 0.8, pri: 3, fn(v, t) {
    noise(v, 'white', t, 0.07, { type: 'highpass', f: 900, vol: 0.9, a: 0.0005 });
    noise(v, 'pink', t, 0.9, { type: 'lowpass', f: 4000, f2: 250, vol: 1, a: 0.002 });
    noise(v, 'brown', t, 1.8, { type: 'lowpass', f: 500, f2: 120, vol: 0.9, a: 0.01 });
    tone(v, 'sine', t, 1.1, 70, { f2: 26, vol: 1.2, a: 0.002 });
    tone(v, 'triangle', t, 0.35, 140, { f2: 45, vol: 0.3 });
    const ts = sorted(6, 0.3, 1.2);
    pops(v, t, ts, ts.map(() => R(0.4, 1)), { type: 'bandpass', f: 1500, q: 0.7, dec: 0.03, vol: 0.25 });
  } },
  ufoExplode: { vol: 0.635, gap: 0.03, max: 4, jit: 0.08, rev: 0.45, ref: 6, duck: 0.6, pri: 2, fn(v, t) {
    noise(v, 'white', t, 0.05, { type: 'highpass', f: 1000, vol: 0.8, a: 0.0005 });
    noise(v, 'pink', t, 0.6, { type: 'lowpass', f: 3000, f2: 280, vol: 0.9, a: 0.002 });
    tone(v, 'sine', t, 0.7, 80, { f2: 30, vol: 1, a: 0.002 });
    tone(v, 'sawtooth', t, 0.55, 900, { f2: 60, lp: 2500, vol: 0.2 });                  // power-down
    metal(v, t, 340, 0.8, 0.12, [1, 2.76, 5.4]);
    const ts = sorted(10, 0, 0.4); ts[0] = 0;
    pops(v, t, ts, ts.map(() => R(0.3, 1)), { type: 'bandpass', f: 3000, fjit: 0.4, dec: 0.008, vol: 0.3 });
  } },
  debrisLand: { vol: 0.403, gap: 0.05, max: 4, jit: 0.12, rev: 0.15, fn(v, t) {
    [0, R(0.07, 0.15), R(0.2, 0.3)].slice(0, RI(2, 3)).forEach((d, i) => tone(v, 'sine', t, 0.12, R(110, 150), { f2: 45, vol: 0.45 / (1 + i * 0.4), dt: d }));
    const ts = sorted(RI(4, 6), 0, 0.35);
    pops(v, t, ts, ts.map(() => R(0.2, 0.5)), { type: 'bandpass', f: 2600, q: 1.5, dec: 0.02, vol: 0.6 });
    metal(v, t, 1200, 0.15, 0.06, [1, 2.76], { dt: 0.02 });
  } },
  hitMarker: { vol: 4.4, gap: 0.03, max: 2, jit: 0.02, rev: 0, pos: false, pri: 2, fn(v, t) {
    tone(v, 'sine', t, 0.02, 3200, { vol: 0.15, a: 0.0008 });
    pops(v, t, [0], [1], { type: 'highpass', f: 4000, dec: 0.006, vol: 0.3 });
  } },

  // ------------------------------------------------------------------ ENEMIES
  beamStart: { vol: 0.287, gap: 0.12, max: 3, jit: 0.04, rev: 0.3, ref: 4, fn(v, t) {
    tone(v, 'sine', t, 0.7, 180, { f2: 880, vol: 0.3, a: 0.05, vib: [8, 15] });
    noise(v, 'white', t, 0.7, { type: 'highpass', f: 1500, f2: 6000, vol: 0.1, a: 0.3 });
    tone(v, 'sawtooth', t, 0.6, 90, { f2: 180, lp: 600, vol: 0.15, a: 0.08 });
  } },
  gooCharge: { vol: 0.183, gap: 0.15, max: 3, jit: 0.06, rev: 0.15, fn(v, t) {
    tone(v, 'sine', t, 0.75, 160, { f2: 620, vol: 0.3, a: 0.1, vib: [16, 30] });
    const ts = sorted(8, 0, 0.65);
    pops(v, t, ts, ts.map(() => R(0.3, 1)), { color: 'pink', type: 'lowpass', f: 700, q: 4, fjit: 0.4, dec: 0.03, vol: 0.5 });   // bubbles
  } },
  gooFire: { vol: 0.431, gap: 0.06, max: 3, jit: 0.07, rev: 0.15, fn(v, t) {
    tone(v, 'sine', t, 0.28, 420, { f2: 85, vol: 0.7 });
    noise(v, 'brown', t, 0.25, { type: 'lowpass', f: 700, f2: 200, vol: 0.6 });
    noise(v, 'pink', t, 0.12, { type: 'bandpass', f: 900, q: 3, vol: 0.25 });
  } },
  gooSplat: { vol: 0.518, gap: 0.05, max: 3, jit: 0.08, rev: 0.15, duck: 0.3, fn(v, t) {
    noise(v, 'pink', t, 0.45, { type: 'bandpass', q: 4, fx: [[0, 1100], [1, 180]], vol: 0.9, a: 0.003 });
    tone(v, 'sine', t, 0.35, 150, { f2: 38, vol: 0.7 });
    noise(v, 'brown', t, 0.5, { type: 'lowpass', f: 500, vol: 0.6 });
    for (let i = 0; i < 3; i++) tone(v, 'sine', t, 0.05, R(240, 300), { f2: R(480, 600), vol: 0.12, dt: R(0.15, 0.45) });
  } },
  plasma: { vol: 2.51, gap: 0.05, max: 4, jit: 0.06, rev: 0.15, fn(v, t) {
    tone(v, 'square', t, 0.14, 1500, { f2: 420, lp: 4000, vol: 0.15 });
    tone(v, 'sawtooth', t, 0.16, 750, { f2: 220, lp: 2500, vol: 0.18 });
    tone(v, 'sine', t, 0.08, 3000, { f2: 1200, vol: 0.08 });
    noise(v, 'white', t, 0.1, { type: 'bandpass', f: 2500, vol: 0.15 });
  } },
  bombDrop: { vol: 0.223, gap: 0.2, max: 3, jit: 0.05, rev: 0.2, fn(v, t) {
    tone(v, 'sine', t, 1.5, 2200, { f2: 550, vol: 0.22, env: 'swell', vib: [7, 12] });
    noise(v, 'white', t, 1.5, { type: 'bandpass', f: 3000, f2: 900, q: 4, vol: 0.06, env: 'swell' });
  } },
  sniperCharge: { vol: 0.447, gap: 0.2, max: 3, jit: 0.02, rev: 0.15, fn(v, t) {
    tone(v, 'sawtooth', t, 1.9, 260, { f2: 1700, lp: 3000, vol: 0.08, env: 'swell', trem: [9, 0.4] });
    tone(v, 'sine', t, 1.9, 520, { f2: 3400, vol: 0.09, env: 'swell' });
  } },
  sniperShot: { vol: 0.995, gap: 0.08, max: 3, jit: 0.04, rev: 0.4, ref: 5, duck: 0.4, pri: 2, fn(v, t) {
    noise(v, 'white', t, 0.3, { type: 'highpass', f: 1500, vol: 0.8, a: 0.0005 });
    tone(v, 'square', t, 0.22, 2600, { f2: 180, lp: 6000, vol: 0.18 });
    tone(v, 'sine', t, 0.25, 140, { f2: 40, vol: 0.7 });
    noise(v, 'white', t, 0.1, { type: 'bandpass', f: 4000, q: 3, vol: 0.3 });
  } },
  siren: { vol: 0.178, gap: 0.3, max: 3, jit: 0.04, rev: 0.2, ref: 4, fn(v, t) {
    const fx = [[0, 650], [0.25, 1500], [0.5, 650], [0.75, 1500], [1, 650]];
    tone(v, 'square', t, 1, 0, { fx, lp: 2200, vol: 0.1, a: 0.02, hold: 0.8, env: 'lin' });
    tone(v, 'sine', t, 1, 0, { fx, vol: 0.15, a: 0.02, hold: 0.8, env: 'lin' });
  } },
  dive: { vol: 0.298, gap: 0.2, max: 3, jit: 0.05, rev: 0.2, ref: 4, fn(v, t) {
    tone(v, 'sawtooth', t, 0.8, 1100, { f2: 250, lp: 2500, vol: 0.12, a: 0.1 });
    noise(v, 'pink', t, 0.8, { type: 'bandpass', f: 2500, f2: 500, q: 1, vol: 0.45, a: 0.5 });
    tone(v, 'sine', t, 0.8, 400, { f2: 90, vol: 0.2, a: 0.3 });
  } },
  thiefGrab: { vol: 0.511, gap: 0.2, max: 2, jit: 0.04, rev: 0.15, fn(v, t, o) {
    tone(v, 'square', t, 0.25, 0, { fx: [[0, 900], [0.3, 1600], [1, 700]], lp: 3000, vol: 0.1 });
    noise(v, 'white', t, 0.12, { type: 'bandpass', f: 1500, f2: 5000, q: 2, vol: 0.3 });
    SFX.henPanic.fn(v, t + 0.08, o, 0.6);
  } },
  ghostFade: { vol: 0.324, gap: 0.25, max: 2, jit: 0.05, rev: 0.6, fn(v, t) {
    tone(v, 'sine', t, 0.9, 760, { f2: 380, vol: 0.14, a: 0.1, vib: [5, 18] });
    tone(v, 'sine', t, 0.9, 1140, { f2: 570, vol: 0.08, a: 0.15 });
    noise(v, 'white', t, 0.8, { type: 'highpass', f: 5000, f2: 2000, vol: 0.05, a: 0.3 });
  } },
  shieldUp: { vol: 0.631, gap: 0.3, max: 2, jit: 0.04, rev: 0.3, fn(v, t) {
    tone(v, 'sawtooth', t, 0.45, 180, { f2: 720, lp: 1400, vol: 0.15, a: 0.05 });
    tone(v, 'sine', t, 0.45, 360, { f2: 1440, vol: 0.15, a: 0.05 });
    tone(v, 'sine', t, 0.3, 2880, { vol: 0.04, a: 0.1, dt: 0.2, trem: [14, 0.6] });
  } },
  shieldDown: { vol: 1.05, gap: 0.2, max: 2, jit: 0.05, rev: 0.3, fn(v, t) {
    tone(v, 'sine', t, 0.4, 1300, { f2: 200, vol: 0.2 });
    noise(v, 'white', t, 0.25, { type: 'highpass', f: 3000, vol: 0.4, a: 0.001 });
    const ts = sorted(6, 0, 0.3);
    pops(v, t, ts, ts.map(() => R(0.3, 1)), { type: 'bandpass', f: 5000, q: 4, fjit: 0.3, dec: 0.03, vol: 0.5 });   // glass bits
  } },
  bossSpawn: { vol: 0.335, gap: 1, max: 1, jit: 0, rev: 0.5, ref: 10, duck: 0.7, pri: 3, fn(v, t) {
    chordOsc(v, t, 1.8, [55, 55 * 1.006, 82.5, 110], { lpfx: [[0, 150], [0.15, 1400], [1, 400]], vol: 0.35, a: 0.04, hold: 0.6, det: 10 }); // BRAAM
    tone(v, 'sine', t, 1.6, 55, { f2: 40, vol: 0.6, a: 0.01 });
    noise(v, 'brown', t, 0.6, { type: 'lowpass', f: 400, vol: 0.7 });
    noise(v, 'pink', t, 0.3, { type: 'bandpass', f: 600, vol: 0.4 });
  } },
  motherSpawn: { vol: 0.381, gap: 2, max: 1, jit: 0, rev: 0.6, ref: 15, duck: 0.9, pri: 3, fn(v, t) {
    noise(v, 'brown', t, 1.5, { type: 'lowpass', f: 300, vol: 1, a: 0.002 });
    tone(v, 'sine', t, 3, 45, { f2: 28, vol: 1.1, a: 0.01 });
    chordOsc(v, t, 3.5, [41.2, 41.2 * 1.008, 61.7, 82.4], { lpfx: [[0, 120], [0.35, 900], [1, 250]], vol: 0.4, a: 0.3, hold: 1.5, det: 12 });
    tone(v, 'sawtooth', t, 3, 110, { f2: 440, lp: 1200, vol: 0.06, env: 'swell' });
    tone(v, 'sine', t, 3, 1760, { f2: 2640, vol: 0.03, env: 'swell', vib: [5, 20] });
    noise(v, 'white', t, 2.5, { type: 'bandpass', f: 400, f2: 3000, q: 0.7, vol: 0.12, env: 'swell' });
  } },
  coreExposed: { vol: 0.542, gap: 0.5, max: 2, jit: 0, rev: 0.35, ref: 8, pri: 2, fn(v, t) {
    tone(v, 'square', t, 0.8, 0, { fx: [[0, 880], [0.25, 660], [0.5, 880], [0.75, 660], [1, 660]], lp: 2500, vol: 0.1, hold: 0.6, env: 'lin' });
    noise(v, 'white', t, 0.1, { type: 'highpass', f: 2000, vol: 0.5, a: 0.0005 });
    metal(v, t, 520, 0.6, 0.15, [1, 2.76, 5.4]);
    tone(v, 'sine', t, 0.3, 220, { f2: 110, vol: 0.3 });
  } },
  bossDeath: { vol: 0.495, gap: 2, max: 1, jit: 0, rev: 0.6, ref: 12, duck: 0.9, pri: 3, fn(v, t, o) {
    [0, 0.35, 0.6, 0.85].forEach((d) => { const p0 = v.p; v.p = p0 * R(0.85, 1.15); SFX.explosionSmall.fn(v, t + d, o); v.p = p0; });
    SFX.explosionBig.fn(v, t + 1.3, o);
    tone(v, 'sawtooth', t, 2.4, 600, { f2: 30, lp: 1500, vol: 0.22, a: 0.05 });
  } },

  // ------------------------------------------------------------------ CHICKENS
  cluck: { vol: 0.55, gap: 0.07, max: 4, jit: 0.1, rev: 0.1, fn(v, t) {
    const n = pick([1, 2, 2, 3]), base = R(380, 520), syl = [];
    let at = 0;
    for (let i = 0; i < n; i++) { const d = R(0.04, 0.06); syl.push({ at, d, f: [base * 0.95, base * 1.15, base], a: R(0.6, 0.9) }); at += d + R(0.03, 0.06); }
    if (Math.random() < 0.6) syl.push({ at: at + 0.02, d: R(0.09, 0.13), f: [base, base * 1.6, base * 1.35, base * 1.1], a: 1 });   // "...bawk"
    vocal(v, t, syl, { F1: R(800, 1000), F2: R(1700, 2200), vol: 0.55, rasp: 0.15 });
  } },
  chirp: { vol: 0.345, gap: 0.1, max: 3, jit: 0.1, rev: 0.08, fn(v, t) {
    const n = RI(2, 3), os = OSC(v, 'sine'), g = G(v, 0);
    os.connect(g); g.connect(v.out);
    for (let i = 0; i < n; i++) {
      const T = t + i * R(0.08, 0.11), d = R(0.05, 0.07), f0 = R(2800, 3300) * v.p;
      os.frequency.setValueAtTime(f0, T); os.frequency.linearRampToValueAtTime(f0 * R(1.3, 1.45), T + d * 0.4); os.frequency.linearRampToValueAtTime(f0 * 1.1, T + d);
      g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(0.25, T + 0.006); g.gain.linearRampToValueAtTime(0, T + d);
    }
    run(v, os, t, t + n * 0.12);
  } },
  crow: { vol: 0.257, gap: 1, max: 2, jit: 0.05, rev: 0.35, ref: 6, fn(v, t) {
    vocal(v, t, [
      { at: 0, d: 0.14, f: [560, 650, 700], a: 0.8 },
      { at: 0.17, d: 0.1, f: [540, 600, 580], a: 0.7 },
      { at: 0.3, d: 0.18, f: [620, 760, 740], a: 0.9 },
      { at: 0.52, d: 0.75, f: [760, 830, 820, 800, 760, 600], a: 1 },
    ], { F1: 900, F2: 1800, vol: 0.5, rasp: 0.25, q1: 4 });
  } },
  henPanic: { vol: 0.426, gap: 0.12, max: 3, jit: 0.1, rev: 0.12, fn(v, t, o, k = 1) {
    const b = R(550, 650);
    vocal(v, t, [
      { at: 0, d: 0.05, f: [b, b * 1.2], a: 0.6 },
      { at: 0.07, d: 0.16, f: [b * 1.1, b * 1.9, b * 1.5, b * 1.8, b * 1.2], a: 1 },
      { at: 0.26, d: 0.1, f: [b * 1.3, b * 1.5, b], a: 0.7 },
    ], { F1: 1400, F2: 2600, q1: 3, q2: 4, vol: 0.55 * k, rasp: 0.35 });
    if (k === 1) pops(v, t, sorted(8, 0, 0.35), new Array(8).fill(0.5), { color: 'pink', type: 'bandpass', f: 1800, q: 0.8, dec: 0.025, vol: 0.2 }); // flapping
  } },
  abducted: { vol: 0.308, gap: 0.3, max: 3, jit: 0.03, rev: 0.3, fn(v, t) {
    // sad trombone "wah wah wah waaah" (G F# F E) with a per-note wah filter
    const os = OSC(v, 'sawtooth'), lp = F(v, 'lowpass', 400, 4), g = G(v, 0);
    os.connect(lp); lp.connect(g); g.connect(v.out);
    const notes = [[0, 392, 0.2], [0.24, 370, 0.2], [0.48, 349, 0.2], [0.72, 330, 0.75]];
    for (const [at, f, d] of notes) {
      const T = t + at;
      os.frequency.setValueAtTime(f * v.p, T);
      lp.frequency.setValueAtTime(350, T); lp.frequency.linearRampToValueAtTime(1500, T + d * 0.35); lp.frequency.linearRampToValueAtTime(450, T + d);
      g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(0.22, T + 0.03); g.gain.linearRampToValueAtTime(0.16, T + d * 0.8); g.gain.linearRampToValueAtTime(0, T + d);
    }
    const vb = OSC(v, 'sine'), vg = G(v, 9 * v.p); vb.frequency.value = 6; vb.connect(vg); vg.connect(os.frequency);
    run(v, os, t, t + 1.5); run(v, vb, t, t + 1.5);
    SFX.cluck.fn(v, t, {});
  } },
  rescue: { vol: 0.308, gap: 0.2, max: 2, jit: 0.02, rev: 0.2, pri: 2, fn(v, t) {
    [67, 71, 74, 79].forEach((m, i) => samp(v, v.e.inst.banjo, t + i * 0.06, m, 0.5));
    bells(v, t + 0.26, [86, 91], 0.05, 0.25);
    const p0 = v.p; v.p *= 1.2; SFX.cluck.fn(v, t + 0.1, {}); v.p = p0;
  } },
  hatch: { vol: 0.363, gap: 0.2, max: 2, jit: 0.06, rev: 0.12, fn(v, t) {
    pops(v, t, [0, 0.012, 0.18, 0.2, 0.36], [0.7, 0.4, 0.8, 0.5, 1], { type: 'bandpass', f: 3500, q: 1.5, dec: 0.012, vol: 0.5 });
    tone(v, 'sine', t, 0.05, 300, { f2: 150, vol: 0.2, dt: 0.36 });
    SFX.chirp.fn(v, t + 0.55);
  } },
  feathers: { vol: 1.46, gap: 0.1, max: 3, jit: 0.1, rev: 0.1, fn(v, t) {
    const ts = []; for (let x = 0; x < 0.42; x += R(0.018, 0.03)) ts.push(x);
    pops(v, t, ts, ts.map((x) => 1 - x * 1.8), { color: 'pink', type: 'bandpass', f: 2000, q: 0.8, dec: 0.025, vol: 0.45 });
    noise(v, 'white', t, 0.4, { type: 'highpass', f: 5000, vol: 0.04, a: 0.05 });
  } },

  // ------------------------------------------------------------------ PLAYER / UI
  hurt: { vol: 0.871, gap: 0.15, max: 2, jit: 0.05, rev: 0.1, pos: false, duck: 0.5, pri: 3, fn(v, t) {
    noise(v, 'pink', t, 0.3, { type: 'lowpass', f: 1200, f2: 300, vol: 0.9, a: 0.001 });
    tone(v, 'sine', t, 0.3, 140, { f2: 45, vol: 0.9, a: 0.001 });
    tone(v, 'sawtooth', t, 0.2, 260, { f2: 90, lp: 900, vol: 0.3 });
    tone(v, 'sine', t, 0.45, 3100, { vol: 0.025, a: 0.03 });     // faint ear ring
  } },
  heal: { vol: 0.228, gap: 0.2, max: 2, jit: 0, rev: 0.3, pos: false, pri: 2, fn(v, t) {
    bells(v, t, [72, 76, 79, 84], 0.07, 0.3);
    tone(v, 'triangle', t, 0.6, 523, { vol: 0.06, a: 0.1 });
    noise(v, 'white', t, 0.5, { type: 'highpass', f: 6000, vol: 0.05, a: 0.15 });
  } },
  bubble: { vol: 0.93, gap: 0.2, max: 2, jit: 0.04, rev: 0.25, pos: false, fn(v, t) {
    tone(v, 'sine', t, 0.3, 260, { f2: 900, vol: 0.3, vib: [25, 40] });
    tone(v, 'sine', t, 0.25, 520, { f2: 1800, vol: 0.08 });
    tone(v, 'triangle', t, 0.5, 2600, { vol: 0.04, a: 0.1, trem: [12, 0.5] });
  } },
  land: { vol: 0.444, gap: 0.2, max: 2, jit: 0.06, rev: 0.12, pos: false, duck: 0.3, fn(v, t) {
    tone(v, 'sine', t, 0.3, 95, { f2: 38, vol: 1, a: 0.001 });
    noise(v, 'brown', t, 0.25, { type: 'lowpass', f: 400, vol: 0.7 });
    tone(v, 'sawtooth', t, 0.18, 140, { f2: 110, lp: 900, vol: 0.08, dt: 0.03 });   // wheelchair creak
    pops(v, t, [0.04, 0.09], [0.6, 0.4], { color: 'pink', type: 'bandpass', f: 900, dec: 0.04, vol: 0.4 });
  } },
  takeoff: { vol: 0.38, gap: 0.5, max: 1, jit: 0.03, rev: 0.25, pos: false, duck: 0.5, pri: 2, fn(v, t) {
    noise(v, 'pink', t, 1.4, { type: 'bandpass', f: 300, f2: 1400, q: 0.7, vol: 0.7, a: 0.3 });
    tone(v, 'sawtooth', t, 1.5, 70, { f2: 260, lp: 700, vol: 0.2, a: 0.2 });
    tone(v, 'sine', t, 0.5, 80, { f2: 35, vol: 0.8, a: 0.002 });
    noise(v, 'brown', t, 0.6, { type: 'lowpass', f: 300, vol: 0.6 });
  } },
  powerup: { vol: 0.265, gap: 0.15, max: 2, jit: 0, rev: 0.25, pos: false, pri: 2, fn(v, t) {
    tone(v, 'square', t, 0.35, 400, { f2: 1600, lp: 3000, vol: 0.08 });
    bells(v, t + 0.05, [76, 79, 83, 88], 0.05, 0.3);
    noise(v, 'white', t, 0.5, { type: 'highpass', f: 7000, vol: 0.05, a: 0.1, dt: 0.1 });
  } },
  crateSpawn: { vol: 0.276, gap: 0.2, max: 2, jit: 0.03, rev: 0.25, fn(v, t) {
    tone(v, 'sine', t, 0.08, 600, { f2: 1300, vol: 0.3 });
    bells(v, t + 0.06, [88, 95], 0.06, 0.25);
    noise(v, 'white', t, 0.3, { type: 'highpass', f: 7000, vol: 0.04, a: 0.05 });
  } },
  crateOpen: { vol: 0.262, gap: 0.2, max: 2, jit: 0.04, rev: 0.2, pri: 2, fn(v, t) {
    pops(v, t, [0, 0.02, 0.05], [1, 0.6, 0.8], { color: 'pink', type: 'bandpass', f: 900, q: 1.5, dec: 0.03, vol: 0.6 });
    tone(v, 'sawtooth', t, 0.2, 120, { f2: 170, lp: 800, vol: 0.07 });
    bells(v, t + 0.1, [84, 88, 91], 0.05, 0.28);
  } },
  combo: { vol: 0.36, gap: 0.03, max: 3, jit: 0, rev: 0.15, pos: false, fn(v, t) {
    samp(v, v.e.inst.bell, t, 84, 0.35);
    tone(v, 'square', t, 0.08, 1046, { lp: 4000, vol: 0.06 });
    tone(v, 'triangle', t, 0.15, 1568, { vol: 0.1, dt: 0.05 });
  } },
  multiKill: { vol: 0.278, gap: 0.2, max: 2, jit: 0, rev: 0.25, pos: false, pri: 2, fn(v, t) {
    [67, 71, 74].forEach((m) => samp(v, v.e.inst.brass, t, m, 0.35, { dur: 0.35 }));
    noise(v, 'white', t, 0.3, { type: 'bandpass', f: 1000, f2: 6000, vol: 0.1 });
    tone(v, 'sine', t, 0.15, 120, { f2: 50, vol: 0.5 });
  } },
  skillOn: { vol: 0.362, gap: 0.2, max: 2, jit: 0, rev: 0.3, pos: false, pri: 2, fn(v, t) {
    noise(v, 'pink', t, 0.35, { type: 'bandpass', f: 500, f2: 4000, vol: 0.3, a: 0.15 });
    tone(v, 'sawtooth', t, 0.3, 220, { f2: 880, lp: 2000, vol: 0.1 });
    bells(v, t + 0.2, [79, 86], 0.06, 0.3);
    tone(v, 'sine', t, 0.3, 110, { f2: 55, vol: 0.4 });
  } },
  skillReady: { vol: 0.277, gap: 0.3, max: 1, jit: 0, rev: 0.2, pos: false, fn(v, t) { bells(v, t, [91, 98], 0.08, 0.22); } },
  denied: { vol: 0.191, gap: 0.2, max: 1, jit: 0, rev: 0.03, pos: false, fn(v, t) {
    tone(v, 'square', t, 0.1, 155, { lp: 1200, vol: 0.18, hold: 0.06 });
    tone(v, 'square', t, 0.14, 147, { lp: 1000, vol: 0.18, hold: 0.08, dt: 0.12 });
  } },
  cardAppear: { vol: 0.275, gap: 0.08, max: 3, jit: 0.02, rev: 0.25, pos: false, fn(v, t) {
    noise(v, 'pink', t, 0.3, { type: 'bandpass', f: 600, f2: 3000, q: 1.2, vol: 0.2, a: 0.1 });
    bells(v, t + 0.05, [79, 83, 86, 91], 0.035, 0.15);
  } },
  cardPick: { vol: 0.415, gap: 0.15, max: 2, jit: 0, rev: 0.2, pos: false, pri: 2, fn(v, t) {
    pops(v, t, [0], [1], { type: 'bandpass', f: 3000, dec: 0.01, vol: 0.3 });
    samp(v, v.e.inst.banjo, t, 79, 0.5); samp(v, v.e.inst.banjo, t + 0.05, 86, 0.5);
    tone(v, 'sine', t, 0.2, 1568, { vol: 0.08, dt: 0.05 });
  } },
  uiHover: { vol: 4.89, gap: 0.04, max: 2, jit: 0.02, rev: 0, pos: false, fn(v, t) { tone(v, 'sine', t, 0.025, 2200, { vol: 0.07, a: 0.001 }); } },
  uiClick: { vol: 3.3, gap: 0.04, max: 2, jit: 0.02, rev: 0, pos: false, fn(v, t) {
    pops(v, t, [0], [1], { type: 'bandpass', f: 3000, dec: 0.01, vol: 0.35 });
    tone(v, 'sine', t, 0.04, 1400, { f2: 1000, vol: 0.14 });
  } },
  tally: { vol: 6.32, gap: 0.03, max: 3, jit: 0.02, rev: 0, pos: false, fn(v, t) {
    tone(v, 'square', t, 0.025, 1800, { lp: 5000, vol: 0.05 });
    tone(v, 'sine', t, 0.03, 3600, { vol: 0.04 });
  } },
  newRecord: { vol: 0.342, gap: 1, max: 1, jit: 0, rev: 0.3, pos: false, pri: 3, fn(v, t) {
    [[0, 67], [0.12, 72], [0.24, 76], [0.36, 79]].forEach(([d, m], i) => samp(v, v.e.inst.brass, t + d, m, 0.4, { dur: i === 3 ? 0.8 : 0.1 }));
    bells(v, t + 0.36, [84, 88, 91, 96], 0.05, 0.25);
    noise(v, 'white', t, 0.9, { type: 'highpass', f: 7000, vol: 0.05, a: 0.3, dt: 0.3 });
  } },
};

// =============================================================================
// LOOP DEFINITIONS — build(v, t) starts endless sources and returns the
// [AudioParam, baseValue] pairs that setPitch() scales.
//   max: how many can be REAL at once (others are virtual), spatial: always gets a panner
// =============================================================================
const LOOPS = {
  gatlingSpin: { vol: 0.5, max: 1, fn(v, t) {
    const a = OSC(v, 'sawtooth'), b = OSC(v, 'triangle'); a.frequency.value = 85; b.frequency.value = 171;
    const bp = F(v, 'bandpass', 900, 1.2), mg = G(v, 0.7); a.connect(bp); b.connect(bp); bp.connect(mg); mg.connect(v.out);
    const n = NSRC(v, 'white'), nf = F(v, 'bandpass', 2600, 1.3), ng = G(v, 0.25), l = OSC(v, 'square'), lg = G(v, 0.25);  // barrel rattle
    l.frequency.value = 24; l.connect(lg); lg.connect(ng.gain); n.connect(nf); nf.connect(ng); ng.connect(v.out);
    [a, b, l].forEach((s) => run(v, s, t)); run(v, n, t, undefined, Math.random());
    return [[a.frequency, 85], [b.frequency, 171], [l.frequency, 24], [bp.frequency, 900]];
  } },
  laserHum: { vol: 0.08, max: 2, fn(v, t) {
    const a = OSC(v, 'sawtooth'), b = OSC(v, 'sawtooth'), c = OSC(v, 'sine'); a.frequency.value = 110; b.frequency.value = 110.6; c.frequency.value = 220;
    const lp = F(v, 'lowpass', 1400, 2), l = OSC(v, 'sine'), lg = G(v, 300); l.frequency.value = 5;
    l.connect(lg); lg.connect(lp.frequency); a.connect(lp); b.connect(lp); c.connect(lp); lp.connect(v.out);
    [a, b, c, l].forEach((s) => run(v, s, t));
    return [[a.frequency, 110], [b.frequency, 110.6], [c.frequency, 220]];
  } },
  ufoHum: { vol: 0.1, max: 5, spatial: true, ref: 4, rev: 0.12, fn(v, t) {
    const r = v.h ? v.h.rnd : Math.random(), f = 92 + 36 * r;
    const a = OSC(v, 'sine'), b = OSC(v, 'triangle'), c = OSC(v, 'sine');
    a.frequency.value = f; b.frequency.value = f * 1.503; c.frequency.value = f * 8.02;
    const vib = OSC(v, 'sine'), vg = G(v, f * 0.035), vg2 = G(v, f * 0.3); vib.frequency.value = 3.2 + r * 2.2;
    vib.connect(vg); vg.connect(a.frequency); vg.connect(b.frequency); vib.connect(vg2); vg2.connect(c.frequency);   // otherworldly wobble
    const lp = F(v, 'lowpass', 700, 2), sw = OSC(v, 'sine'), swg = G(v, 350); sw.frequency.value = 0.21 + r * 0.2;
    sw.connect(swg); swg.connect(lp.frequency);
    const cg = G(v, 0.07); a.connect(lp); b.connect(lp); lp.connect(v.out); c.connect(cg); cg.connect(v.out);
    [a, b, c, vib, sw].forEach((s) => run(v, s, t));
    return [[a.frequency, f], [b.frequency, f * 1.503], [c.frequency, f * 8.02]];
  } },
  beam: { vol: 0.23, max: 4, spatial: true, ref: 4, rev: 0.2, fn(v, t) {
    const a = OSC(v, 'sawtooth'), b = OSC(v, 'sawtooth'); a.frequency.value = 55; b.frequency.value = 82.7;
    const bp = F(v, 'bandpass', 600, 2), l = OSC(v, 'sine'), lg = G(v, 400); l.frequency.value = 0.5;
    l.connect(lg); lg.connect(bp.frequency); a.connect(bp); b.connect(bp); bp.connect(v.out);
    const s = OSC(v, 'sine'), sg = G(v, 0.04), tl = OSC(v, 'sine'), tg = G(v, 0.04); s.frequency.value = 1320; tl.frequency.value = 11;
    tl.connect(tg); tg.connect(sg.gain); s.connect(sg); sg.connect(v.out);       // sparkly tremolo shimmer
    [a, b, l, s, tl].forEach((x) => run(v, x, t));
    return [[a.frequency, 55], [b.frequency, 82.7], [s.frequency, 1320]];
  } },
  motherHum: { vol: 0.16, max: 1, spatial: true, ref: 12, rev: 0.25, fn(v, t) {
    const a = OSC(v, 'sawtooth'), b = OSC(v, 'sawtooth'), c = OSC(v, 'sine'); a.frequency.value = 41.2; b.frequency.value = 41.5; c.frequency.value = 82.4;
    const lp = F(v, 'lowpass', 220, 1.5), amp = G(v, 0.7), l = OSC(v, 'sine'), lg = G(v, 0.3); l.frequency.value = 0.5;
    l.connect(lg); lg.connect(amp.gain); a.connect(lp); b.connect(lp); c.connect(lp); lp.connect(amp); amp.connect(v.out);
    const e = OSC(v, 'sine'), eg = G(v, 0.03), ev = OSC(v, 'sine'), evg = G(v, 8); e.frequency.value = 659; ev.frequency.value = 4.5;
    ev.connect(evg); evg.connect(e.frequency); e.connect(eg); eg.connect(v.out);
    [a, b, c, l, e, ev].forEach((x) => run(v, x, t));
    return [[a.frequency, 41.2], [b.frequency, 41.5], [c.frequency, 82.4]];
  } },
  flightWind: { vol: 0.48, max: 1, fn(v, t) {
    const n = NSRC(v, 'pink'), bp = F(v, 'bandpass', 700, 0.8), l = OSC(v, 'sine'), lg = G(v, 250); l.frequency.value = 0.23;
    l.connect(lg); lg.connect(bp.frequency); n.connect(bp); bp.connect(v.out);
    const w = NSRC(v, 'white'), hp = F(v, 'highpass', 3000, 0.7), hg = G(v, 0.15); w.connect(hp); hp.connect(hg); hg.connect(v.out);
    run(v, l, t); run(v, n, t, undefined, Math.random()); run(v, w, t, undefined, Math.random());
    return [[bp.frequency, 700], [hp.frequency, 3000]];
  } },
  // extras (ambience beds)
  crickets: { vol: 0.05, max: 1, fn(v, t) {
    const o = OSC(v, 'sine'), g1 = G(v, 0.5), g2 = G(v, 0.5), l1 = OSC(v, 'square'), l1g = G(v, 0.5), l2 = OSC(v, 'square'), l2g = G(v, 0.5);
    o.frequency.value = 4400; l1.frequency.value = 28; l2.frequency.value = 1.3;
    l1.connect(l1g); l1g.connect(g1.gain); l2.connect(l2g); l2g.connect(g2.gain); o.connect(g1); g1.connect(g2); g2.connect(v.out);
    [o, l1, l2].forEach((x) => run(v, x, t));
    return [[o.frequency, 4400], [l1.frequency, 28]];
  } },
  wind: { vol: 0.1, max: 1, fn(v, t) {
    const n = NSRC(v, 'brown'), lp = F(v, 'lowpass', 400, 0.7), l = OSC(v, 'sine'), lg = G(v, 200); l.frequency.value = 0.11;
    l.connect(lg); lg.connect(lp.frequency); n.connect(lp); lp.connect(v.out);
    run(v, l, t); run(v, n, t, undefined, Math.random());
    return [[lp.frequency, 400]];
  } },
};

export const SFX_NAMES = Object.keys(SFX);
/** Tooling only (dev/audio.html loudness calibration). Not part of the gameplay contract. */
export const __defs = { SFX, LOOPS };
export const LOOP_NAMES = Object.keys(LOOPS);

// =============================================================================
// PUBLIC API
// =============================================================================
/** Create the AudioContext (must run inside a user gesture the first time). Idempotent. */
export function initAudio() {
  if (LIVE) { resumeAudio(); return true; }
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return false;
  let ctx;
  try { ctx = new AC({ latencyHint: 'interactive' }); } catch (_) { try { ctx = new AC(); } catch (__) { return false; } }
  LIVE = E = buildEngine(ctx, false);
  // iOS/Quest unlock: a 1-sample silent buffer inside the gesture
  try { const b = ctx.createBufferSource(); b.buffer = ctx.createBuffer(1, 1, ctx.sampleRate); b.connect(ctx.destination); b.start(0); } catch (_) { /* ignore */ }
  resumeAudio();
  janitorTimer = setInterval(janitor, 200);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!document.hidden) resumeAudio(); });
  // apply what gameplay asked for before init
  LIVE.music.setEnabled(musicOn);
  LIVE.music.setIntensity(musicWant.intensity);
  if (musicWant.mode !== 'off') LIVE.music.setMode(musicWant.mode);
  if (musicWant.tempo) LIVE.music.setTempo(musicWant.tempo);
  rebalanceLoops(LIVE);
  return true;
}
export function resumeAudio() {
  if (LIVE && LIVE.ctx.state !== 'running' && LIVE.ctx.state !== 'closed') LIVE.ctx.resume().catch(() => {});
}

/** World-space listener (call every frame with the camera). fwd/up are direction vectors. */
export function setListener(pos, fwd, up) {
  const e = LIVE;
  if (!e || !pos) return;
  const l = e.lis.pos; l.x = pos.x; l.y = pos.y; l.z = pos.z;
  const L = e.ctx.listener, f = fwd || { x: 0, y: 0, z: -1 }, u = up || { x: 0, y: 1, z: 0 };
  if (L.positionX) {
    L.positionX.value = pos.x; L.positionY.value = pos.y; L.positionZ.value = pos.z;
    L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z;
    L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z;
  } else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
}

/**
 * Fire a one-shot. opts: { pos, vol=1, pitch=1, detune (cents), delay (s), rev }
 * Returns { stop(fadeSec) } or null (unknown name, audio not ready, rate-limited, dropped).
 */
export function sfx(name, opts = {}) {
  const e = E;
  const def = SFX[name];
  if (!def) { if (!warned.has(name)) { warned.add(name); console.warn('[audio] unknown sfx', name); } return null; }
  if (!e || (!e.offline && e.ctx.state !== 'running')) return null;
  const c0 = performance.now();
  const t = e.ctx.currentTime + 0.005 + (opts.delay || 0);
  // rate limit (per name)
  const last = e.last.get(name);
  if (last !== undefined && t - last < (def.gap ?? 0.03)) { DBG.rateLimited++; return null; }
  const rapid = def.rapid && last !== undefined && t - last < def.rapid;   // sustained auto-fire: -3 dB per shot
  e.last.set(name, t);
  // per-name cap → steal oldest of the same name
  let same = 0, oldest = null;
  for (const v of e.voices) if (!v.dead && v.name === name) { same++; if (!oldest || v.t0 < oldest.t0) oldest = v; }
  if (same >= (def.max ?? 4) && oldest) { killVoice(oldest); DBG.stolen++; }
  // global cap → steal lowest priority, then oldest; drop the new one if everything is more important
  const pri = def.pri ?? 1;
  let alive = 0, victim = null;
  for (const v of e.voices) if (!v.dead) { alive++; if (!victim || v.pri < victim.pri || (v.pri === victim.pri && v.t0 < victim.t0)) victim = v; }
  if (alive >= MAX_VOICES) {
    if (victim.pri > pri) { DBG.dropped++; return null; }
    killVoice(victim); DBG.stolen++;
  }
  const v = newVoice(e, name, def, opts, t, false);
  def.fn(v, t, opts);
  const lvl = (def.vol ?? 1) * (opts.vol ?? 1) * SFX_LEVEL * (rapid ? 0.7 : 1);
  v.out.gain.setValueAtTime(lvl, t);
  e.voices.push(v);
  DBG.voicesStarted++;
  if (def.duck) duck(e, def.duck * Math.min(1, opts.vol ?? 1) * (opts.pos ? distGain(dist(opts.pos, e.lis.pos), def.ref || REF_DIST) : 1), 0.12 + def.duck * 0.3);
  DBG.cpuMs += performance.now() - c0; DBG.calls++;
  return { stop: (fade = 0.05) => killVoice(v, fade) };
}

// ---------- loops (virtualized handles) ----------
class LoopHandle {
  constructor(name, def, opts) {
    this.name = name; this.def = def; this.rnd = Math.random();
    this.pos = opts.pos ? { x: opts.pos.x, y: opts.pos.y, z: opts.pos.z } : null;
    this.vol = opts.vol ?? 1; this.pitch = opts.pitch ?? 1; this.v = null; this.alive = true;
  }
  // As três ignoram mudanças imperceptíveis: o jogo chama isso todo quadro, e cada
  // setTargetAtTime vira trabalho na thread de áudio (pesado no Quest).
  setPos(p) {
    if (!p) return;
    if (!this.pos) this.pos = { x: 0, y: 0, z: 0 };
    const q = this.pos, dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
    if (dx * dx + dy * dy + dz * dz < 1e-4 && this.posSent) return;
    q.x = p.x; q.y = p.y; q.z = p.z;
    if (this.v && this.v.pn) { setPannerPos(this.v.pn, p); this.posSent = true; }
  }
  setVol(x) { if (Math.abs(x - this.vol) < 0.004) return; this.vol = x; if (this.v) this.v.out.gain.setTargetAtTime(this.level(), this.v.ctx.currentTime, 0.05); }
  setPitch(p) { if (Math.abs(p - this.pitch) < 0.004) return; this.pitch = p; if (this.v) { const t = this.v.ctx.currentTime; for (const [P, b] of this.v.pp) P.setTargetAtTime(b * p, t, 0.05); } }
  stop(fade = 0.15) {
    if (!this.alive) return;
    this.alive = false;
    const set = loopReg.get(this.name); if (set) set.delete(this);
    if (this.v) { killVoice(this.v, Math.max(0.01, fade)); this.v.e.voices.push(this.v); DBG.loopsReal--; this.v = null; }
  }
  level() { return (this.def.vol ?? 1) * this.vol * LOOP_LEVEL; }
  priority(e) { return this.vol * (this.pos && e ? distGain(dist(this.pos, e.lis.pos), this.def.ref || REF_DIST) : 1); }
}
function realizeLoop(e, h) {
  const t = e.ctx.currentTime;
  const v = newVoice(e, h.name, h.def, { pos: h.pos, pitch: h.pitch }, t, true);
  v.h = h;
  v.pp = h.def.fn(v, t) || [];
  if (h.pitch !== 1) for (const [P, b] of v.pp) P.value = b * h.pitch;
  v.out.gain.setValueAtTime(0, t); v.out.gain.linearRampToValueAtTime(h.level(), t + 0.08);
  h.v = v; if (!e.offline) DBG.loopsReal++;
}
/** Every 200 ms: keep only the `max` most audible handles per loop name real; update air absorption. */
function rebalanceLoops(e) {
  for (const [, set] of loopReg) {
    if (!set.size) continue;
    const def = set.values().next().value.def, max = def.max ?? 4;
    const arr = [...set].sort((a, b) => b.priority(e) * (b.v ? 1.3 : 1) - a.priority(e) * (a.v ? 1.3 : 1));
    arr.forEach((h, i) => {
      if (i < max && !h.v) realizeLoop(e, h);
      else if (i >= max && h.v) { killVoice(h.v, 0.15); e.voices.push(h.v); h.v = null; DBG.loopsReal--; }
      if (h.v && h.v.air && h.pos) h.v.air.frequency.setTargetAtTime(airCutoff(dist(h.pos, e.lis.pos)), e.ctx.currentTime, 0.2);
    });
  }
}
/**
 * Start a loop. opts: { pos, vol=1, pitch=1 }. Always returns a handle
 * { setPos, setVol, setPitch, stop(fade) }. Before initAudio() (or when over the per-name
 * cap) the handle is virtual: silent, but it becomes audible automatically when possible.
 */
export function loop(name, opts = {}) {
  const def = LOOPS[name];
  if (!def) {
    if (!warned.has('loop:' + name)) { warned.add('loop:' + name); console.warn('[audio] unknown loop', name); }
    return { setPos() {}, setVol() {}, setPitch() {}, stop() {} };
  }
  const h = new LoopHandle(name, def, opts);
  if (E && E.offline) { realizeLoop(E, h); return h; }              // offline render: immediate, no registry
  if (!loopReg.has(name)) loopReg.set(name, new Set());
  loopReg.get(name).add(h);
  if (LIVE) {
    let real = 0; for (const x of loopReg.get(name)) if (x.v) real++;
    if (real < (def.max ?? 4)) realizeLoop(LIVE, h);                 // fast path; janitor rebalances the rest
  }
  return h;
}

/** Short musical one-shot: waveStart, waveClear, newWeapon, bossIn, levelUp, victory, gameOver, perfect. */
export function stinger(name) { if (E && (E.offline || E.ctx.state === 'running')) E.music.stinger(name); }

/** Music control facade (safe to call before initAudio; state is applied on init). */
export const music = {
  setMode(mode) { musicWant.mode = mode; if (LIVE) LIVE.music.setMode(mode); },
  setIntensity(x) { musicWant.intensity = x; if (LIVE) LIVE.music.setIntensity(x); },
  setTempo(bpm) { musicWant.tempo = bpm || null; if (LIVE) LIVE.music.setTempo(bpm); },
  stinger,
  get mode() { return musicWant.mode; },
  state() { return LIVE ? LIVE.music.state() : { mode: musicWant.mode, running: false }; },
};

export function setVolumes({ master, music: mus, sfx: s } = {}) {
  if (master !== undefined) vols.master = clamp(master, 0, 1);
  if (mus !== undefined) vols.music = clamp(mus, 0, 1);
  if (s !== undefined) vols.sfx = clamp(s, 0, 1);
  if (!LIVE) return;
  const t = LIVE.ctx.currentTime;
  LIVE.master.gain.setTargetAtTime(vols.master, t, 0.05);
  LIVE.sfxBus.gain.setTargetAtTime(vols.sfx, t, 0.05);
  LIVE.musicBus.gain.setTargetAtTime(musicOn ? vols.music : 0, t, 0.05);
}
export function getVolumes() { return { ...vols, musicOn }; }

export function toggleMusic() {
  musicOn = !musicOn;
  if (LIVE) { LIVE.musicBus.gain.setTargetAtTime(musicOn ? vols.music : 0, LIVE.ctx.currentTime, 0.1); LIVE.music.setEnabled(musicOn); }
  return musicOn;
}

/** Low-HP heartbeat loop (baked buffer, 2 nodes) + music muffle. */
export function heartbeat(on) {
  heartWant = !!on;
  const e = LIVE;
  if (!e) return;
  const t = e.ctx.currentTime;
  if (on && !heartVoice) {
    if (!e.inst.heart) { setTimeout(() => heartWant && heartbeat(true), 100); return; }   // still baking
    const s = e.ctx.createBufferSource(), g = e.ctx.createGain();
    s.buffer = e.inst.heart.buf; s.loop = true; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.75, t + 0.2);
    s.connect(g); g.connect(e.sfxBus); s.start(t);
    heartVoice = { s, g }; DBG.nodes += 2;
    e.musicLP.frequency.setTargetAtTime(900, t, 0.3);
  } else if (!on && heartVoice) {
    const { s, g } = heartVoice; heartVoice = null;
    g.gain.setTargetAtTime(0, t, 0.1); s.stop(t + 0.5);
    s.onended = () => { s.disconnect(); g.disconnect(); DBG.nodes -= 2; };
    e.musicLP.frequency.setTargetAtTime(20000, t, 0.4);
  }
}

/** 'equalpower' (default, cheap) or 'hrtf' (desktop headphones; applies to loops created after the call). */
export function setSpatialQuality(q) { hrtfLoops = q === 'hrtf'; return hrtfLoops ? 'hrtf' : 'equalpower'; }

// =============================================================================
// JANITOR + DEBUG
// =============================================================================
function janitor() {
  const e = LIVE;
  if (!e) return;
  const now = e.ctx.currentTime;
  for (let i = e.voices.length - 1; i >= 0; i--) {
    const v = e.voices[i];
    if (v.end < now - 0.05) { releaseVoice(v); e.voices.splice(i, 1); }
  }
  rebalanceLoops(e);
}

function debugInfo() {
  const e = LIVE;
  let loopsVirtual = 0, loopHandles = 0;
  for (const [, s] of loopReg) for (const h of s) { loopHandles++; if (!h.v) loopsVirtual++; }
  return {
    state: e ? e.ctx.state : 'none', time: e ? +e.ctx.currentTime.toFixed(3) : 0, sampleRate: e ? e.ctx.sampleRate : 0,
    baseLatency: e && e.ctx.baseLatency, voices: e ? e.voices.filter((v) => !v.dead).length : 0, dyingVoices: e ? e.voices.filter((v) => v.dead).length : 0,
    loopHandles, loopsReal: DBG.loopsReal, loopsVirtual, nodes: DBG.nodes, musicNodes: DBG.musicNodes, peakNodes: DBG.peakNodes,
    voicesStarted: DBG.voicesStarted, stolen: DBG.stolen, dropped: DBG.dropped, rateLimited: DBG.rateLimited,
    avgSfxCallMs: DBG.calls ? +(DBG.cpuMs / DBG.calls).toFixed(4) : 0, instrumentBakeMs: e ? +e.inst.bakeMs.toFixed(1) : 0, slowestBakeSliceMs: e ? +e.inst.slowestTaskMs.toFixed(1) : 0, instrumentsReady: e ? e.inst.ready : false,
    heartbeat: !!heartVoice, musicOn, volumes: { ...vols }, music: e ? e.music.state() : null,
  };
}
if (typeof window !== 'undefined') window.__audioDebug = debugInfo;

/**
 * Test helper: render `fn()` (which calls sfx/loop/stinger/music on the offline engine)
 * through the full master chain into an AudioBuffer. Music: fn receives the offline music
 * instance as `m`; call m.setMode(...), m.setIntensity(x, true), then this pumps the
 * scheduler for the whole duration.
 */
export async function __renderOffline(seconds, fn, sampleRate = 48000) {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const prev = E;
  const e = buildEngine(ctx, true);
  E = e;
  try { fn(e.music, e); e.music.pump(seconds); } finally { E = prev; }
  const buf = await ctx.startRendering();
  e.music.dispose();
  return buf;
}
