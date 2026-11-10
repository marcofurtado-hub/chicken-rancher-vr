// =============================================================================
// MUSIC — procedural score + stingers for Chicken Rancher VR 3.0
//
// Design goals (Quest CPU first):
//   * Instruments are BAKED ONCE into AudioBuffers at init (Karplus–Strong banjo /
//     guitar / upright bass, FM bell, brass, a whole drum kit, heartbeat). At runtime a
//     note is just BufferSource + Gain (2 nodes), so a full band costs almost nothing.
//   * Only the pads (3 chord notes x 2 detuned oscillators) and one persistent
//     monophonic lead synth per mode use live oscillators.
//   * Lookahead scheduler: setInterval(25 ms) schedules everything < 0.12 s ahead on the
//     AudioContext clock. Mode switches are quantized to the next bar, tempo glides,
//     intensity cross-fades 4 layer buses (base / bass+brass / drums / lead).
//   * Variation: several chord progressions per mode (picked per 8-bar section),
//     3 banjo rolls, random drum fills every 4/8 bars, generated melody motifs with an
//     A A' B A'' phrase form, and the lead only plays in some sections.
//
// This module has no import from audio.js: audio.js builds the engine and calls
// createMusic(env). getInstruments() is shared so SFX/stingers can use the same samples.
// =============================================================================

const TAU = Math.PI * 2;
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const u = clamp01((x - a) / (b - a)); return u * u * (3 - 2 * u); };

export const MUSIC_MODES = ['menu', 'day', 'dusk', 'night', 'boss', 'mother', 'flight', 'victory', 'gameover', 'off'];
export const STINGER_NAMES = ['waveStart', 'waveClear', 'newWeapon', 'bossIn', 'levelUp', 'victory', 'gameOver', 'perfect'];

// -----------------------------------------------------------------------------
// Offline DSP helpers (only used while baking instrument buffers)
// -----------------------------------------------------------------------------
function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** RBJ biquad, processed in place. type: lowpass | highpass | bandpass | peaking */
function biquad(d, sr, type, f, q = 0.707, db = 0) {
  const w = (TAU * Math.min(f, sr * 0.45)) / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q), A = Math.pow(10, db / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lowpass') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else if (type === 'highpass') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else if (type === 'bandpass') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < d.length; i++) {
    const x = d[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y;
  }
  return d;
}
function normalize(d, peak) { let m = 0; for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > m) m = a; } if (m > 0) { const k = peak / m; for (let i = 0; i < d.length; i++) d[i] *= k; } return d; }
function fadeOut(d, sr, sec = 0.03) { const n = Math.min(d.length, Math.floor(sec * sr)); for (let i = 0; i < n; i++) d[d.length - 1 - i] *= i / n; return d; }
function toBuffer(sr, d) { const b = new AudioBuffer({ length: d.length, sampleRate: sr, numberOfChannels: 1 }); b.copyToChannel(d, 0); return b; }

/**
 * Karplus–Strong plucked string. Returns { d, f } where f is the EXACT pitch produced
 * (the 2-tap loop filter adds (1-S) samples of delay), so playbackRate tuning is exact.
 *   t60   seconds to decay 60 dB (at the fundamental)
 *   S     loop filter tap weight: 0.5 = darkest/most damped, ->1 = bright & metallic
 *   pick  pluck position (comb on the excitation): small = near bridge = twangy
 *   soft  excitation smoothing 0..1 (finger vs pick)
 */
function ks(sr, f, dur, { t60 = 1.5, S = 0.5, pick = 0.2, soft = 0.3 }, rnd) {
  const N = Math.max(2, Math.round(sr / f - (1 - S)));
  const len = Math.floor(sr * dur), d = new Float32Array(len);
  const ex = new Float32Array(N); let lp = 0;
  for (let i = 0; i < N; i++) { lp += (1 - soft) * (rnd() * 2 - 1 - lp); ex[i] = lp; }
  const P = Math.max(1, Math.round(N * pick)), ex2 = new Float32Array(N); let mean = 0;
  for (let i = 0; i < N; i++) { ex2[i] = ex[i] - ex[(i - P + N) % N]; mean += ex2[i]; }
  mean /= N;
  const rho = Math.pow(0.001, 1 / (t60 * f));
  for (let i = 0; i < len; i++) {
    let y = i < N ? ex2[i] - mean : 0;
    if (i >= N) y += rho * (S * d[i - N] + (1 - S) * (i > N ? d[i - N - 1] : 0));
    d[i] = y;
  }
  return { d, f: sr / (N + 1 - S) };
}
/** PolyBLEP band-limited saw sample for phase p (0..1) and increment dt. */
function blsaw(p, dt) {
  let y = 2 * p - 1;
  if (p < dt) { const x = p / dt; y -= x + x - x * x - 1; } else if (p > 1 - dt) { const x = (p - 1) / dt; y -= x * x + x + x + 1; }
  return y;
}

// -----------------------------------------------------------------------------
// Instrument baking (cached per sample rate; AudioBuffers are context-independent,
// so the live context and OfflineAudioContext renders share them).
//
// Cost control for Quest: pitched instruments are baked at HALF the output rate
// (their content is < 8 kHz; the BufferSource resamples for free), envelopes use
// recursive multipliers instead of per-sample Math.exp, and the bake is split into
// ~10 small tasks. getInstruments(sr) returns immediately with whatever is ready and
// continues on setTimeout slices (no long frame stall); players simply skip
// instruments that are not baked yet. getInstruments(sr, true) bakes synchronously
// (offline renders).
// -----------------------------------------------------------------------------
const instCache = new Map();
export function getInstruments(sr, sync = false) {
  let inst = instCache.get(sr);
  if (!inst) {
    inst = { ready: false, bakeMs: 0, slowestTaskMs: 0, _tasks: bakeTasks(sr) };
    instCache.set(sr, inst);
    if (!sync) setTimeout(() => bakeStep(inst), 0);
  }
  if (sync) while (!inst.ready) bakeStep(inst, true);
  return inst;
}
function bakeStep(inst, sync) {
  if (inst.ready || inst._busy) return;
  inst._busy = true;
  const task = inst._tasks.shift(), t0 = performance.now();
  if (task) Object.assign(inst, task());
  const ms = performance.now() - t0;
  inst.bakeMs += ms; inst.slowestTaskMs = Math.max(inst.slowestTaskMs, ms);
  inst._busy = false;
  if (!inst._tasks.length) inst.ready = true;
  else if (!sync) setTimeout(() => bakeStep(inst), 0);
}
function bakeTasks(sr) {
  const rnd = mulberry(1234567);
  const sp = sr >= 44100 ? sr / 2 : sr;                 // pitched instruments at half rate
  const set = (bases, fn) => bases.map((f) => { const r = fn(f); return { buf: toBuffer(sp, r.d), f: r.f }; });
  const N = (sec) => new Float32Array(Math.floor(sec * sr));
  const wn = () => rnd() * 2 - 1;
  const drum = (d, peak = 0.9) => ({ buf: toBuffer(sr, fadeOut(normalize(d, peak), sr, 0.01)) });
  const decay = (rate) => Math.exp(-rate / sr);           // per-sample multiplier for exp(-rate * t)
  return [
    // Banjo: bright, short, twangy (pick near the bridge + head resonance ~1.3 kHz)
    () => ({ banjo: set([220, 440, 880], (f) => {
      const r = ks(sp, f, 1.1, { t60: 0.85, S: 0.62, pick: 0.13, soft: 0.05 }, rnd);
      biquad(r.d, sp, 'highpass', 170, 0.7); biquad(r.d, sp, 'peaking', 1300, 1.2, 5); biquad(r.d, sp, 'lowpass', 7500, 0.7);
      normalize(r.d, 0.9); fadeOut(r.d, sp); return r;
    }) }),
    // Acoustic guitar: warmer, longer, softer pick
    () => ({ guitar: set([110, 220, 440], (f) => {
      const r = ks(sp, f, 2.2, { t60: 2.0, S: 0.5, pick: 0.22, soft: 0.45 }, rnd);
      biquad(r.d, sp, 'highpass', 70, 0.7); biquad(r.d, sp, 'peaking', 220, 1, 3); biquad(r.d, sp, 'lowpass', 4500, 0.7);
      normalize(r.d, 0.9); fadeOut(r.d, sp); return r;
    }) }),
    // Upright bass: very damped low string, heavy lowpass = round "thump"
    () => ({ bass: set([55, 110], (f) => {
      const r = ks(sp, f, 1.6, { t60: 1.3, S: 0.5, pick: 0.3, soft: 0.6 }, rnd);
      biquad(r.d, sp, 'lowpass', 900, 0.7); biquad(r.d, sp, 'peaking', 90, 1, 4); biquad(r.d, sp, 'highpass', 30, 0.7);
      normalize(r.d, 0.95); fadeOut(r.d, sp); return r;
    }) }),
    // FM bell / celesta (night arpeggios, UI chimes)
    () => ({ bell: set([440, 880, 1760], (f) => {
      const len = Math.floor(sp * 1.6), d = new Float32Array(len), w = (TAU * f) / sp;
      const k3 = Math.exp(-3 / sp), k7 = Math.exp(-7 / sp), k45 = Math.exp(-4.5 / sp), k9 = Math.exp(-9 / sp);
      let e3 = 1, e7 = 1, e45 = 1, e9 = 1;
      for (let i = 0; i < len; i++) {
        d[i] = Math.sin(w * i + (1.8 * e7 + 0.35) * Math.sin(w * 3.51 * i)) * Math.min(1, (i / sp) * 500) * e3 + 0.2 * Math.sin(w * 2 * i) * e45 + 0.1 * Math.sin(w * 4.17 * i) * e9;
        e3 *= k3; e7 *= k7; e45 *= k45; e9 *= k9;
      }
      normalize(d, 0.8); fadeOut(d, sp); return { d, f };
    }) }),
    // Brass: 2 detuned band-limited saws through a state-variable lowpass with a "blat" envelope
    () => ({ brass: set([110, 220, 440], (f) => {
      const len = Math.floor(sp * 1.6), d = new Float32Array(len), k7 = Math.exp(-7 / sp), k6 = Math.exp(-6 / sp);
      let p1 = 0, p2 = 0.37, lp = 0, bp = 0, e7 = 1, e6 = 1, F = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sp, vib = t > 0.25 ? 1 + 0.003 * Math.sin(TAU * 5.2 * t) : 1;
        const dt1 = (f * vib) / sp, dt2 = (f * 1.0045 * vib) / sp;
        const s = blsaw(p1, dt1) + blsaw(p2, dt2);
        p1 += dt1; if (p1 >= 1) p1 -= 1; p2 += dt2; if (p2 >= 1) p2 -= 1;
        if (t >= 0.05) e7 *= k7;
        if ((i & 15) === 0) { const eb = t < 0.05 ? t / 0.05 : 0.45 + 0.55 * e7; F = 2 * Math.sin((Math.PI * Math.min(sp * 0.16, f * 1.2 + 3000 * eb)) / sp); }
        lp += F * bp; const hp = s - lp - 0.9 * bp; bp += F * hp;
        d[i] = lp * Math.min(1, t / 0.03) * (0.8 + 0.2 * e6); e6 *= k6;
      }
      normalize(d, 0.85); fadeOut(d, sp, 0.25); return { d, f };
    }) }),
    // ---- drum kit (full rate: hats/cymbals need the top octave) ----
    () => {
      const kick = N(0.5); { let ph = 0, e30 = 1, e8 = 1, e500 = 1; const a = decay(30), b = decay(8), c = decay(500);
        for (let i = 0; i < kick.length; i++) { ph += (TAU * (46 + 120 * e30)) / sr; kick[i] = Math.tanh((Math.sin(ph) * e8 * Math.min(1, (i / sr) * 2000) + wn() * e500 * 0.35) * 1.4); e30 *= a; e8 *= b; e500 *= c; } }
      const snz = N(0.3); for (let i = 0; i < snz.length; i++) snz[i] = wn(); biquad(snz, sr, 'highpass', 1200); biquad(snz, sr, 'lowpass', 9000);
      const snare = N(0.3); { let e28 = 1, e16 = 1; const a = decay(28), b = decay(16);
        for (let i = 0; i < snare.length; i++) { const t = i / sr; snare[i] = Math.min(1, t * 3000) * ((Math.sin(TAU * 185 * t) * 0.55 + Math.sin(TAU * 330 * t) * 0.25) * e28 + snz[i] * e16 * 0.9); e28 *= a; e16 *= b; } }
      const brush = N(0.32); for (let i = 0; i < brush.length; i++) brush[i] = wn(); biquad(brush, sr, 'bandpass', 3800, 0.5); biquad(brush, sr, 'highpass', 1000);
      { let e = 1; const a = decay(11); for (let i = 0; i < brush.length; i++) { const t = i / sr; if (t < 0.02) brush[i] *= t / 0.02; else { brush[i] *= e; e *= a; } } }
      const rnz = N(0.09); for (let i = 0; i < rnz.length; i++) rnz[i] = wn(); biquad(rnz, sr, 'bandpass', 3000, 1.5);
      const rim = N(0.09); for (let i = 0; i < rim.length; i++) { const t = i / sr; rim[i] = Math.sin(TAU * 1750 * t) * Math.exp(-t * 90) * 0.6 + Math.sin(TAU * 820 * t) * Math.exp(-t * 60) * 0.4 + rnz[i] * Math.exp(-t * 120) * 0.5; }
      return { kick: drum(kick, 0.95), snare: drum(snare), brush: drum(brush, 0.7), rim: drum(rim, 0.8) };
    },
    () => {
      const hatN = (sec, k) => { const d = N(sec); for (let i = 0; i < d.length; i++) d[i] = wn(); biquad(d, sr, 'highpass', 7000); biquad(d, sr, 'highpass', 7000); let e = 1; const a = decay(k); for (let i = 0; i < d.length; i++) { d[i] *= e; e *= a; } return d; };
      const shaker = N(0.1); for (let i = 0; i < shaker.length; i++) shaker[i] = wn(); biquad(shaker, sr, 'bandpass', 6500, 0.9);
      for (let i = 0; i < shaker.length; i++) { const t = i / sr; shaker[i] *= t < 0.012 ? t / 0.012 : Math.exp(-(t - 0.012) * 45); }
      const clap = N(0.32); for (let i = 0; i < clap.length; i++) clap[i] = wn(); biquad(clap, sr, 'bandpass', 1300, 1.1);
      for (let i = 0; i < clap.length; i++) { const t = i / sr; let e = 0; for (const ti of [0, 0.011, 0.023]) if (t >= ti) e += Math.exp(-(t - ti) * 260); if (t >= 0.03) e += 0.7 * Math.exp(-(t - 0.03) * 16); clap[i] *= e; }
      return { hat: drum(hatN(0.07, 65), 0.6), ohat: drum(hatN(0.45, 7), 0.5), shaker: drum(shaker, 0.6), clap: drum(clap, 0.8) };
    },
    () => {
      const tnz = N(0.5); for (let i = 0; i < tnz.length; i++) tnz[i] = wn(); biquad(tnz, sr, 'lowpass', 600);
      const tom = N(0.5); { let ph = 0, e18 = 1, e65 = 1, e60 = 1; const a = decay(18), b = decay(6.5), c = decay(60);
        for (let i = 0; i < tom.length; i++) { ph += (TAU * (92 + 70 * e18)) / sr; tom[i] = Math.sin(ph) * e65 + tnz[i] * e60 * 0.3; e18 *= a; e65 *= b; e60 *= c; } }
      const taiko = N(1.0); { let ph = 0, e14 = 1, e4 = 1, e35 = 1; const a = decay(14), b = decay(4), c = decay(35);
        for (let i = 0; i < taiko.length; i++) { ph += (TAU * (58 + 55 * e14)) / sr; taiko[i] = Math.tanh(1.3 * (Math.sin(ph) * e4 + tnz[i % tnz.length] * e35 * 0.6)); e14 *= a; e4 *= b; e35 *= c; } }
      return { tom: drum(tom), taiko: drum(taiko, 0.95) };
    },
    () => {
      // 808-style cymbal: 6 inharmonic square waves + noise, high-passed
      const crash = N(2.0), fr = [205.3, 304.4, 369.6, 522.7, 540, 800].map((x) => x * 1.7), ph = fr.map(() => 0), inc = fr.map((x) => x / sr);
      let e = 1; const a = decay(2.2);
      for (let i = 0; i < crash.length; i++) {
        let m = 0; for (let k = 0; k < 6; k++) { ph[k] += inc[k]; if (ph[k] >= 1) ph[k] -= 1; m += ph[k] < 0.5 ? 1 : -1; }
        crash[i] = (m * 0.12 + wn()) * Math.min(1, (i / sr) * 1500) * e; e *= a;
      }
      biquad(crash, sr, 'highpass', 3500); biquad(crash, sr, 'highpass', 3000);
      // Heartbeat "lub-dub" cycle (~70 bpm), loopable
      const heart = N(0.86);
      for (let i = 0; i < heart.length; i++) {
        const t = i / sr, t2 = t - 0.29;
        let y = Math.sin(TAU * 52 * t) * (t < 0.012 ? t / 0.012 : Math.exp(-(t - 0.012) * 22));
        if (t2 > 0) y += 0.75 * Math.sin(TAU * 44 * t2) * (t2 < 0.012 ? t2 / 0.012 : Math.exp(-(t2 - 0.012) * 26));
        heart[i] = y;
      }
      biquad(heart, sr, 'lowpass', 160);
      return { crash: drum(crash, 0.55), heart: { buf: toBuffer(sr, normalize(heart, 0.95)) } };
    },
  ];
}

/** Pick the baked sample whose base pitch is closest (log distance) and the playbackRate. */
export function pickSample(set, f) {
  let best = set[0], bd = 1e9;
  for (const s of set) { const d = Math.abs(Math.log(f / s.f)); if (d < bd) { bd = d; best = s; } }
  return { buf: best.buf, rate: f / best.f };
}

// -----------------------------------------------------------------------------
// Theory helpers
// -----------------------------------------------------------------------------
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], harm: [0, 2, 3, 5, 7, 8, 11], dorian: [0, 2, 3, 5, 7, 9, 10],
  mixo: [0, 2, 4, 5, 7, 9, 10], phryg: [0, 1, 3, 5, 7, 8, 10], majPent: [0, 2, 4, 7, 9], minPent: [0, 3, 5, 7, 10],
};
const QUAL = { M: [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], 5: [0, 7], sus: [0, 5, 7], dim: [0, 3, 6] };
/** All midi notes in [lo, hi] whose pitch class is in pcs (ascending). */
function pcsIn(pcs, lo, hi) { const out = []; for (let m = lo; m <= hi; m++) if (pcs.includes(((m % 12) + 12) % 12)) out.push(m); return out; }
/** Lowest midi >= lo with pitch class pc. */
const lowAbove = (pc, lo) => lo + ((((pc - lo) % 12) + 12) % 12);
function nearestPc(pcs, m) { for (let d = 0; d < 7; d++) { if (pcs.includes(((m + d) % 12 + 12) % 12)) return m + d; if (pcs.includes(((m - d) % 12 + 12) % 12)) return m - d; } return m; }

// Melody rhythm cells (16th onsets inside one beat)
const CELLS_DENSE = [[0, 2], [0, 1, 2, 3], [0, 2, 3], [0], [0, 3], [0, 2], [0, 1, 2]];
const CELLS_CALM = [[0], [0, 2], [], [0], [2], [0, 3], [0]];
const CELLS_SLOW = [[0], [], [], [0], [2], []];

// Lead synth patches (one persistent monophonic voice per mode → legato slides for free)
const PATCH = {
  fiddle: { type: 'sawtooth', det2: 7, filt: ['bandpass', 1500, 0.8], vib: [5.6, 22], vibDelay: 0.12, atk: 0.035, rel: 0.08, glide: 0.035, vol: 0.32 },
  harmonica: { type: 'square', det2: 5, filt: ['lowpass', 1700, 1.6], vib: [5, 14], vibDelay: 0.15, atk: 0.03, rel: 0.1, glide: 0.025, vol: 0.2 },
  theremin: { type: 'sine', det2: 0, filt: ['lowpass', 3200, 0.5], vib: [6.2, 40], vibDelay: 0.05, atk: 0.12, rel: 0.25, glide: 0.16, vol: 0.34 },
  whistle: { type: 'sine', det2: 0, filt: ['lowpass', 6000, 0.5], vib: [5.5, 22], vibDelay: 0.1, atk: 0.03, rel: 0.08, glide: 0.05, vol: 0.2 },
  brassLead: { type: 'sawtooth', det2: 9, filt: ['lowpass', 2300, 1.2], vib: [5.2, 15], vibDelay: 0.15, atk: 0.04, rel: 0.1, glide: 0.04, vol: 0.22 },
};

// -----------------------------------------------------------------------------
// createMusic(env) — one instance per AudioContext (live or offline)
//   env: { ctx, inst, musicIn, stingerOut, duck(depth, holdSec), dbg, offline }
// -----------------------------------------------------------------------------
export function createMusic(env) {
  const { ctx, inst, dbg } = env;
  const G = (v, dest) => { const g = ctx.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; };
  const pan = (p, dest) => { if (!ctx.createStereoPanner) return dest; const s = ctx.createStereoPanner(); s.pan.value = p; s.connect(dest); return s; };

  // ---- routing (permanent nodes) ----
  const fader = G(0, env.musicIn);                         // whole-score on/off fade
  const modeGain = G(1, fader);                            // per-mode loudness trim
  const layer = { base: G(1, modeGain), bass: G(0, modeGain), drums: G(0, modeGain), lead: G(0, modeGain) };
  const dIn = G(1), dl = ctx.createDelay(2), dfb = G(0.32), dlp = ctx.createBiquadFilter();
  dlp.type = 'lowpass'; dlp.frequency.value = 2400; dl.delayTime.value = 0.375;
  dIn.connect(dl); dl.connect(dlp); dlp.connect(dfb); dfb.connect(dl); dlp.connect(G(0.5, modeGain));
  const ch = {
    banjo: G(0.65, pan(0.3, layer.base)), guitar: G(0.55, pan(-0.28, layer.base)), bell: G(0.32, pan(0.15, layer.base)),
    pad: G(1, layer.base), bass: G(0.95, layer.bass), brass: G(0.3, pan(-0.12, layer.bass)), drums: G(0.75, layer.drums),
    lead: G(1, pan(-0.05, layer.lead)),
    intro: G(0.32, modeGain),   // mode intros (victory fanfare, game-over phrase): not intensity-gated
  };
  const bellSend = G(0, dIn); ch.bell.connect(bellSend);
  const leadSend = G(0, dIn); ch.lead.connect(leadSend);
  const gtrSend = G(0, dIn); ch.guitar.connect(gtrSend);

  let padWave = null;
  const getPadWave = () => {
    if (padWave) return padWave;
    const n = 24, re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 1; k < n; k++) im[k] = (k % 2 ? 1 : 0.6) / Math.pow(k, 1.5);
    return (padWave = ctx.createPeriodicWave(re, im));
  };

  // ---- state ----
  const S = {
    mode: 'off', md: null, pending: null, running: false, enabled: true,
    bpm: 100, target: 100, override: null, It: 0, I: 0, lv: { base: 1, bass: 0, drums: 0, lead: 0 },
    beatT: 0, q: 0, bar: 0, bi: 0, introEnd: 0, prog: null, progIdx: -1, chord: null, next: null,
    motifs: null, leadOn: false, first: true, roll: 0, fill: 0, fillType: 0, crashNext: false, mono: null,
    rng: Math.random, lastSting: {},
    st: { minLead: 9, resyncs: 0, bars: 0, notes: 0, leadNotes: 0, sections: 0, leadSections: 0, cpuMs: 0, pumps: 0, driftMs: 0, d0: null },
  };
  const R = () => S.rng();
  const RI = (a, b) => a + Math.floor(R() * (b - a + 1));

  // ---- note players (all return quickly; 2 nodes per note, auto-disconnect on end) ----
  function play(setOrDrum, t, midi, vel, dest, dur, rate = 1) {
    if (!setOrDrum) return;                                   // instrument still baking: skip the note
    let buf, r;
    if (Array.isArray(setOrDrum)) { const s = pickSample(setOrDrum, mtof(midi)); buf = s.buf; r = s.rate * rate; }
    else { buf = setOrDrum.buf; r = rate; }
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; src.playbackRate.value = r;
    let end = t + buf.duration / r;
    if (dur && t + dur + 0.08 < end) { g.gain.setValueAtTime(vel, t); g.gain.setValueAtTime(vel, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.07); end = t + dur + 0.08; }
    else g.gain.value = vel;
    src.connect(g); g.connect(dest);
    src.start(t); src.stop(end);
    dbg.musicNodes += 2; S.st.notes++;
    src.onended = () => { src.disconnect(); g.disconnect(); dbg.musicNodes -= 2; };
  }
  const bnj = (t, m, v, d) => play(inst.banjo, t, m, v, ch.banjo, d);
  const gtr = (t, m, v, d) => play(inst.guitar, t, m, v, ch.guitar, d);
  const bas = (t, m, v, d) => play(inst.bass, t, m, v, ch.bass, d);
  const bel = (t, m, v, d) => play(inst.bell, t, m, v, ch.bell, d);
  const dr = (n, t, v, rate = 1) => play(inst[n], t, 0, v, ch.drums, 0, rate);
  const brs = (t, ms, v, d, dest = ch.brass) => { for (const m of ms) play(inst.brass, t, m, v, dest, d); };
  function strum(t, pcs, v, mute, lo = 52, n = 5, dest = ch.guitar) {
    const ns = pcsIn(pcs, lo, lo + 17).slice(0, n);
    ns.forEach((m, i) => play(inst.guitar, t + i * 0.012, m, v * (1 - i * 0.06), dest, mute ? 0.07 : 2.5));
  }
  function padChord(t, pcs, dur, { vel, lo, bright }) {
    const ms = pcsIn(pcs, lo, lo + 14).slice(0, 3);
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.Q.value = 0.6;
    f.frequency.setValueAtTime(bright * 0.6, t); f.frequency.linearRampToValueAtTime(bright, t + dur * 0.5); f.frequency.linearRampToValueAtTime(bright * 0.7, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + Math.min(0.5, dur * 0.3));
    g.gain.setValueAtTime(vel, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.6);
    f.connect(g); g.connect(ch.pad);
    const oscs = [];
    for (const m of ms) for (const det of [-7, 7]) {
      const o = ctx.createOscillator(); o.setPeriodicWave(getPadWave()); o.frequency.value = mtof(m); o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + dur + 0.65); oscs.push(o);
    }
    const n = oscs.length + 2; dbg.musicNodes += n;
    oscs[oscs.length - 1].onended = () => { for (const o of oscs) o.disconnect(); f.disconnect(); g.disconnect(); dbg.musicNodes -= n; };
  }

  // ---- persistent monophonic lead ----
  function makeMono(name, t) {
    const P = PATCH[name];
    const o1 = ctx.createOscillator(); o1.type = P.type;
    const o2 = P.det2 ? ctx.createOscillator() : null; if (o2) { o2.type = P.type; o2.detune.value = P.det2; }
    const lfo = ctx.createOscillator(); lfo.frequency.value = P.vib[0];
    const vg = G(0); lfo.connect(vg); vg.connect(o1.detune); if (o2) vg.connect(o2.detune);
    const f = ctx.createBiquadFilter(); f.type = P.filt[0]; f.frequency.value = P.filt[1]; f.Q.value = P.filt[2];
    const amp = G(0, ch.lead);
    o1.connect(f); if (o2) o2.connect(f); f.connect(amp);
    const all = [o1, o2, lfo].filter(Boolean);
    for (const o of all) o.start(t);
    const nodeCount = all.length + 3; dbg.musicNodes += nodeCount;
    let started = false;
    return {
      note(t, midi, dur, vel) {
        const fr = mtof(midi);
        for (const o of [o1, o2]) if (o) { if (!started) o.frequency.setValueAtTime(fr, t); else o.frequency.setTargetAtTime(fr, t, P.glide / 3); }
        started = true;
        amp.gain.setTargetAtTime(vel * P.vol, t, P.atk / 3);
        amp.gain.setTargetAtTime(0, t + Math.max(0.05, dur), P.rel / 3);
        vg.gain.setTargetAtTime(0, t, 0.02); vg.gain.setTargetAtTime(P.vib[1], t + P.vibDelay, 0.08);
      },
      stop(t) {
        amp.gain.cancelScheduledValues(t); amp.gain.setTargetAtTime(0, t, 0.05);
        for (const o of all) o.stop(t + 0.4);
        o1.onended = () => { for (const o of all) o.disconnect(); vg.disconnect(); f.disconnect(); amp.disconnect(); dbg.musicNodes -= nodeCount; };
      },
    };
  }

  // ---- melody generator ----
  function genMotif(md) {
    const cells = md.cells, notes = [];
    let deg = 2 + [0, 2, 4][RI(0, 2)];
    for (let b = 0; b < 8; b++) {
      const cell = b === 7 ? (R() < 0.5 ? [] : [0]) : b === 0 ? [0] : cells[RI(0, cells.length - 1)];
      for (const on of cell) {
        const r = R();
        deg += r < 0.35 ? 1 : r < 0.7 ? -1 : r < 0.82 ? 2 : r < 0.94 ? -2 : R() < 0.5 ? 3 : -3;
        deg = Math.max(0, Math.min(md.melRange || 9, deg));
        notes.push({ s: b * 4 + on, deg });
      }
    }
    return finishMotif(notes, md);
  }
  function finishMotif(notes, md) {
    notes.sort((a, b) => a.s - b.s);
    const map = new Array(32);
    notes.forEach((n, i) => { n.len = Math.min((notes[i + 1] ? notes[i + 1].s : 32) - n.s, md.maxLen || 6); map[n.s] = n; });
    return { notes, map };
  }
  function variant(m, md, endHome) {
    const c = m.notes.map((n) => ({ ...n }));
    const k = c.length;
    if (k >= 2) for (let i = k - 2; i < k; i++) c[i].deg = Math.max(0, Math.min(md.melRange || 9, c[i].deg + (R() < 0.5 ? 1 : -1) * RI(1, 2)));
    if (endHome && k) { const last = c[k - 1]; last.deg = last.deg > 4 ? SCALES[md.mel].length : 0; }
    return finishMotif(c, md);
  }
  const degToMidi = (md, deg) => { const sc = SCALES[md.mel]; return md.key + md.leadOct + 12 * Math.floor(deg / sc.length) + sc[deg % sc.length]; };

  // ---- shared pattern pieces ----
  const ROLLS = [[0, 1, 2, 0, 1, 2, 0, 2], [2, 1, 0, 2, 1, 0, 2, 1], [0, 1, 0, 2, 0, 1, 0, 2]];
  function banjoRoll(X, vel) {
    if (X.q % 2) return;
    const k = X.q >> 1, r = ROLLS[S.roll][k], up = pcsIn(X.c.pcs, 62, 81);
    const m = r === 0 ? (k === 0 ? up[0] : S.md.key + 12) : r === 1 ? up[1 + (X.bi & 1)] : up[Math.min(up.length - 1, 3)];
    bnj(X.t, m, vel * (k % 2 ? 0.8 : 1));
  }
  function travis(X, vel, lo = 59, hi = 74) {
    const { q, c, t } = X;
    if (q % 2) return;
    if (q % 4 === 0) {
      const beat = q >> 2, pc = beat % 2 === 0 ? c.pcs[0] : c.pcs[Math.min(2, c.pcs.length - 1)];
      gtr(t, lowAbove(pc, 40), vel * (beat === 0 ? 1 : 0.85), X.bd * 1.8);
      if (q === 0 && R() < 0.4) gtr(t + 0.008, pcsIn(c.pcs, lo, hi).pop(), vel * 0.6, X.bd * 1.5);
    } else {
      const up = pcsIn(c.pcs, lo, hi), order = X.bi & 1 ? [2, 1, 3, 0] : [1, 2, 0, 3];
      gtr(t, up[order[(q >> 2) % 4] % up.length], vel * 0.7, X.bd * 1.2);
    }
  }
  function walkingBass(X, vel) {
    const { q, c, n, t } = X;
    const root = lowAbove(c.pcs[0], 36), fifth = lowAbove(c.pcs[Math.min(2, c.pcs.length - 1)], 31);
    if (q === 0) bas(t, root, vel, X.bd * 1.7);
    else if (q === 8) bas(t, fifth, vel * 0.85, X.bd * 1.7);
    else if (X.I > 0.5 && n && n.pcs[0] !== c.pcs[0] && (q === 12 || q === 14)) {
      const tgt = lowAbove(n.pcs[0], 36), dir = tgt > root ? -1 : 1;
      bas(t, tgt + dir * (q === 12 ? 2 : 1), vel * 0.7, X.bd * 0.45);
    } else if (X.I > 0.8 && q === 12) bas(t, root + 12, vel * 0.5, X.bd * 0.45);
  }
  function fills(X) {
    if (!X.fill) return false;
    const start = X.fill === 2 ? 8 : 12;
    if (X.q < start) return false;
    const k = X.q - start, n = 16 - start, cres = 0.35 + (0.6 * k) / n;
    if (S.fillType === 0) { dr('snare', X.t, cres * 0.75); if (k === 0) dr('kick', X.t, 0.8); }
    else if (S.fillType === 1) { if (X.q % 2 === 0 || X.fill === 1) dr('tom', X.t, 0.55 + 0.3 * cres, 1.5 - (0.7 * k) / n); }
    else if (X.q % 2 === 0) dr(k % 4 === 0 ? 'kick' : 'snare', X.t, cres * 0.8);
    else dr('tom', X.t, 0.4 * cres, 1.15);
    return true;
  }
  function lead(X) {
    if (!S.leadOn || !S.mono || S.lv.lead < 0.01) return;
    const mot = S.motifs[X.bi >> 1], local = (X.bi & 1) * 16 + X.q, n = mot.map[local];
    if (!n) return;
    let m = degToMidi(S.md, n.deg);
    if (local % 8 === 0) m = nearestPc(X.c.pcs, m);
    S.mono.note(X.t, m, n.len * X.sd * 0.9, 0.8 + 0.2 * R());
    S.st.leadNotes++;
  }

  // ---- the modes ----
  const C = (s, q) => [s, q];
  const MODES = {
    menu: {
      key: 55, mel: 'majPent', leadOct: 12, bpm: 88, swing: 0.56, maxI: 0.4, lead: 'whistle', leadChance: 0.5, leadFloor: 0.8, cells: CELLS_CALM, gain: 0.53,
      pad: { vel: 0.12, lo: 55, bright: 1000 }, echo: [0.12, 0.2, 0.05],
      progs: [[C(0, 'M'), C(5, 'M'), C(0, 'M'), C(7, 'M')], [C(0, 'M'), C(9, 'm'), C(5, 'M'), C(7, 'M')], [C(5, 'M'), C(0, 'M'), C(7, 'M'), C(0, 'M')], [C(0, 'M'), C(4, 'm'), C(5, 'M'), C(7, 'M')]],
      step(X) {
        const { q, t, c } = X;
        travis(X, 0.42);
        if (S.lv.bass > 0.01 && (q === 0 || q === 8)) bas(t, lowAbove(c.pcs[q ? 2 : 0], 36), 0.5, X.bd * 1.8);
        if (S.lv.drums > 0.01) { if (q === 4 || q === 12) dr('brush', t, 0.35); if (q % 4 === 2) dr('shaker', t, 0.16); }
        if (q === 0 && X.bi % 4 === 3 && R() < 0.5) bel(t, pcsIn(c.pcs, 79, 91)[0], 0.16);
        lead(X);
      },
    },
    day: {
      key: 55, mel: 'majPent', leadOct: 12, bpm: 118, swing: 0.52, maxI: 1, lead: 'fiddle', leadChance: 0.7, cells: CELLS_DENSE, gain: 0.47,
      pad: { vel: 0.07, lo: 55, bright: 1400 }, echo: [0.05, 0.12, 0.04],
      progs: [[C(0, 'M'), C(5, 'M'), C(0, 'M'), C(7, 'M')], [C(0, 'M'), C(0, 'M'), C(5, 'M'), C(7, 'M')], [C(0, 'M'), C(9, 'm'), C(5, 'M'), C(7, 'M')],
        [C(5, 'M'), C(0, 'M'), C(7, 'M'), C(0, 'M')], [C(0, 'M'), C(5, 'M'), C(0, 'M'), C(0, 'M'), C(0, 'M'), C(7, 'M'), C(7, 'M'), C(0, 'M')]],
      step(X) {
        const { q, t, c, I } = X;
        banjoRoll(X, 0.36 + 0.2 * I);
        if (I < 0.25) { if (q === 0 || q === 8) strum(t, c.pcs, q ? 0.24 : 0.32, false); } else if (q === 4 || q === 12) strum(t, c.pcs, 0.38, true);
        if (S.lv.bass > 0.01) walkingBass(X, 0.85);
        if (S.lv.drums > 0.01 && !fills(X)) {
          if (q === 0 || q === 8) dr('kick', t, 0.85);
          if (q === 10 && I > 0.75 && R() < 0.5) dr('kick', t, 0.5);
          if (q === 4 || q === 12) dr('brush', t, 0.65);
          if (q % 2 === 0 && I > 0.35) dr('shaker', t, q % 4 === 2 ? 0.38 : 0.22);
          if ((q === 7 || q === 15) && I > 0.8) dr('snare', t, 0.12);
        }
        lead(X);
      },
    },
    dusk: {
      key: 50, mel: 'majPent', leadOct: 12, bpm: 96, swing: 0.6, maxI: 1, lead: 'harmonica', leadChance: 0.6, cells: CELLS_CALM, gain: 0.46,
      pad: { vel: 0.13, lo: 50, bright: 1100 }, echo: [0.1, 0.18, 0.08],
      progs: [[C(0, 'M'), C(7, 'M'), C(9, 'm'), C(5, 'M')], [C(0, 'M'), C(5, 'M'), C(0, 'M'), C(7, 'M')], [C(5, 'M'), C(0, 'M'), C(7, 'M'), C(7, '7')], [C(0, 'M'), C(4, 'm'), C(5, 'M'), C(7, 'M')]],
      step(X) {
        const { q, t, c, I } = X;
        travis(X, 0.5, 57, 74);
        if (S.lv.bass > 0.01) walkingBass(X, 0.65);
        if (S.lv.drums > 0.01 && !fills(X)) {
          if (q === 0) dr('kick', t, 0.7); if (q === 8) dr('kick', t, 0.5);
          if (q === 4 || q === 12) dr('brush', t, 0.5);
          if (q % 2 === 0 && I > 0.5) dr('shaker', t, 0.24);
        }
        if ((X.bi & 1) && I > 0.55 && q >= 12 && q % 2 === 0) { const up = pcsIn(c.pcs, 64, 79); bnj(t, up[((q - 12) >> 1) % up.length], 0.3); }
        lead(X);
      },
    },
    night: {
      key: 52, mel: 'harm', leadOct: 12, bpm: 92, swing: 0.5, maxI: 1, lead: 'theremin', leadChance: 0.55, cells: CELLS_SLOW, maxLen: 12, melRange: 8, gain: 0.41,
      pad: { vel: 0.17, lo: 52, bright: 800 }, echo: [0.4, 0.3, 0.25],
      progs: [[C(0, 'm'), C(8, 'M'), C(5, 'm'), C(7, 'M')], [C(0, 'm'), C(10, 'M'), C(8, 'M'), C(7, 'M')], [C(0, 'm'), C(3, 'M'), C(8, 'M'), C(7, '7')], [C(5, 'm'), C(0, 'm'), C(8, 'M'), C(7, 'M')], [C(0, 'm'), C(1, 'M'), C(0, 'm'), C(7, 'M')]],
      step(X) {
        const { q, t, c, I } = X;
        if (q % 2 === 0) { const arp = pcsIn(c.pcs, 64, 88), i = [0, 1, 2, 3, 4, 3, 2, 1][q >> 1] % arp.length; bel(t, arp[i], (q % 8 === 0 ? 0.36 : 0.26) * (1 - 0.15 * I)); }
        if (q === 0) gtr(t, lowAbove(c.pcs[0], 40), 0.5, X.bd * 3.5);
        if (q === 10 && R() < 0.35) gtr(t, lowAbove(c.pcs[Math.min(2, c.pcs.length - 1)], 47), 0.32, X.bd * 1.5);
        if (S.lv.bass > 0.01) { const r = lowAbove(c.pcs[0], 31); if (I > 0.55) { if (q % 2 === 0) bas(t, r, q === 0 ? 0.8 : 0.5, X.sd * 1.6); } else if (q === 0 || q === 8) bas(t, r, 0.75, X.bd * 1.8); }
        if (S.lv.drums > 0.01 && !fills(X)) {
          if (q === 0 || (q === 10 && I > 0.5) || (q === 8 && I > 0.85)) dr('kick', t, 0.9);
          if (q === 4 || q === 12) dr(I > 0.7 && q === 12 ? 'snare' : 'rim', t, 0.5);
          if (I > 0.45 && q % 2 === 0) dr('hat', t, q % 4 === 0 ? 0.25 : 0.35);
          if (I > 0.85 && q % 2 === 1) dr('hat', t, 0.14);
        }
        lead(X);
      },
    },
    boss: {
      key: 50, mel: 'harm', leadOct: 24, bpm: 148, swing: 0.5, maxI: 1, lead: 'fiddle', leadChance: 0.65, cells: CELLS_DENSE, gain: 0.47,
      pad: { vel: 0.1, lo: 50, bright: 700 }, echo: [0.1, 0.1, 0.03],
      progs: [[C(0, 'm'), C(0, 'm'), C(8, 'M'), C(7, 'M')], [C(0, 'm'), C(8, 'M'), C(10, 'M'), C(7, 'M')], [C(0, 'm'), C(3, 'M'), C(8, 'M'), C(7, '7')], [C(5, 'm'), C(0, 'm'), C(8, 'M'), C(7, 'M')]],
      step(X) {
        const { q, t, c, I } = X;
        if (q % 2 === 0) { const arp = pcsIn(c.pcs, 62, 86); bel(t, arp[[0, 2, 1, 3, 0, 2, 1, 4][q >> 1] % arp.length], 0.2); }
        if (X.bi >= 4 && I > 0.7) bnj(t, lowAbove(c.pcs[Math.min(2, c.pcs.length - 1)], 67), q % 2 ? 0.14 : 0.24);
        if (S.lv.bass > 0.01) {
          const r = lowAbove(c.pcs[0], 31);
          if (q % 2 === 0) bas(t, q === 6 || q === 14 ? r + 12 : r, q % 4 === 0 ? 0.85 : 0.6, X.sd * 1.7);
          if (q === 0) brs(t, pcsIn(c.pcs, 50, 66), 0.5, X.bd * 1.2);
          else if (q === 6 || q === 10) brs(t, pcsIn(c.pcs, 50, 66), 0.35, X.sd * 1.5);
        }
        if (S.lv.drums > 0.01 && !fills(X)) {
          if (q === 0 || q === 8 || q === 10 || (q === 3 && I > 0.8)) dr('kick', t, 0.95);
          if (q === 4 || q === 12) { dr('snare', t, 0.8); if (I > 0.85) dr('clap', t, 0.45); }
          dr('hat', t, q % 4 === 0 ? 0.28 : q % 2 === 0 ? 0.2 : 0.12);
          if (q === 14 && R() < 0.3) dr('ohat', t, 0.3);
        }
        lead(X);
      },
    },
    mother: {
      key: 52, mel: 'phryg', leadOct: 12, bpm: 124, swing: 0.5, maxI: 1, lead: 'theremin', leadChance: 0.5, cells: CELLS_SLOW, maxLen: 12, melRange: 8, gain: 0.42,
      pad: { vel: 0.2, lo: 40, bright: 600 }, echo: [0.3, 0.3, 0.15],
      progs: [[C(0, 'm'), C(1, 'M'), C(0, 'm'), C(1, 'M')], [C(0, 'm'), C(8, 'M'), C(1, 'M'), C(0, 'm')], [C(0, 'm'), C(1, 'M'), C(3, 'M'), C(1, 'M')]],
      step(X) {
        const { q, t, c, I } = X;
        if (q % 4 === 2) { const r = lowAbove(c.pcs[0], 76); bel(t, q & 4 ? r + 1 : r, 0.2); }
        if (S.lv.bass > 0.01) {
          const r = lowAbove(c.pcs[0], 28);
          if (q === 0) bas(t, r, 0.9, X.bd * 3.5);
          else if (I > 0.65 && q % 2 === 0) bas(t, r + (q === 12 ? 12 : 0), 0.45, X.sd * 1.5);
          if (q === 0 && X.bi % 2 === 0) brs(t, [r + 12, r + 19, r + 24], 0.6, X.bd * 6);
        }
        if (S.lv.drums > 0.01 && !fills(X)) {
          if (q === 0) dr('taiko', t, 1);
          if (q === 6 || q === 10) dr('taiko', t, 0.6, 1.12);
          if (q === 0 || (q === 8 && I > 0.5)) dr('kick', t, 0.8);
          if (q === 8) { dr('snare', t, 0.75); dr('clap', t, 0.5); }
          if (I > 0.6 && q % 2 === 0) dr('hat', t, 0.22);
        }
        lead(X);
      },
    },
    flight: {
      key: 48, mel: 'major', leadOct: 24, bpm: 132, swing: 0.5, maxI: 1, lead: 'brassLead', leadChance: 0.75, cells: CELLS_DENSE, gain: 0.45,
      pad: { vel: 0.11, lo: 55, bright: 1600 }, echo: [0.08, 0.12, 0.04],
      progs: [[C(0, 'M'), C(5, 'M'), C(7, 'M'), C(0, 'M')], [C(0, 'M'), C(9, 'm'), C(5, 'M'), C(7, 'M')], [C(5, 'M'), C(7, 'M'), C(4, 'm'), C(9, 'm')], [C(0, 'M'), C(7, 'M'), C(9, 'm'), C(5, 'M')], [C(8, 'M'), C(10, 'M'), C(0, 'M'), C(0, 'M')]],
      step(X) {
        const { q, t, c, I } = X;
        banjoRoll(X, 0.3 + 0.15 * I);
        if (I < 0.3 && q === 0) strum(t, c.pcs, 0.35, false);
        if (S.lv.bass > 0.01) {
          const r = lowAbove(c.pcs[0], 31);
          if (q % 2 === 0) bas(t, r + ((q >> 1) % 2 ? 12 : 0), 0.7, X.sd * 1.6);
          const v = pcsIn(c.pcs, 55, 72);
          if (q === 0) brs(t, v, 0.5, X.bd * 1.4); else if (q === 10) brs(t, v, 0.4, X.sd * 1.6); else if (q === 12) brs(t, v, 0.45, X.bd * 0.9);
        }
        if (S.lv.drums > 0.01 && !fills(X)) {
          if (q % 4 === 0) dr('kick', t, 0.9);
          if (q === 4 || q === 12) dr('snare', t, 0.7);
          if (q % 4 === 2 && I > 0.55) dr('ohat', t, 0.26);
          if (q % 2 === 1 && I > 0.85) dr('hat', t, 0.12);
        }
        lead(X);
      },
    },
    victory: {
      key: 55, mel: 'majPent', leadOct: 12, bpm: 104, swing: 0.55, maxI: 0.5, lead: 'whistle', leadChance: 0.6, leadFloor: 0.8, cells: CELLS_CALM, gain: 0.45,
      pad: { vel: 0.1, lo: 55, bright: 1200 }, echo: [0.1, 0.15, 0.05],
      progs: [[C(0, 'M'), C(5, 'M'), C(0, 'M'), C(7, 'M')], [C(0, 'M'), C(9, 'm'), C(5, 'M'), C(7, 'M')], [C(5, 'M'), C(0, 'M'), C(7, 'M'), C(0, 'M')]],
      intro(t) { fanfare(t, ch.intro, ch.intro, ch.intro, 60 / S.bpm); return 2; },
      step(X) { MODES.day.step(X); },
    },
    gameover: {
      key: 57, mel: 'minor', leadOct: 12, bpm: 70, swing: 0.5, maxI: 0.2, lead: 'harmonica', leadChance: 0.45, leadFloor: 0.8, cells: CELLS_SLOW, maxLen: 8, gain: 0.38,
      pad: { vel: 0.17, lo: 45, bright: 700 }, echo: [0.2, 0.25, 0.15],
      progs: [[C(0, 'm'), C(5, 'm'), C(8, 'M'), C(7, 'M')], [C(0, 'm'), C(8, 'M'), C(3, 'M'), C(7, 'M')]],
      intro(t) { sadIntro(t, ch.intro, ch.intro, 60 / S.bpm); return 2; },
      step(X) { travis(X, 0.38, 57, 72); lead(X); },
    },
  };

  // ---- shared musical phrases (used by modes AND stingers) ----
  function fanfare(t, brassDest, drumDest, bellDest, beat) {
    const seq = [[0, [67, 71, 74], 0.3], [0.5, [67, 71, 74], 0.3], [1, [67, 71, 74], 0.3], [1.5, [72, 76, 79], 0.9], [3, [71, 74, 79], 0.3], [3.5, [74, 79, 83], 2.4]];
    for (const [b, ms, d] of seq) brs(t + b * beat, ms, 0.55, d * beat, brassDest);
    for (let i = 0; i < 6; i++) play(inst.snare, t + 2.5 * beat + i * beat * 0.17, 0, 0.2 + i * 0.08, drumDest);
    play(inst.crash, t + 3.5 * beat, 0, 0.6, drumDest); play(inst.taiko, t + 3.5 * beat, 0, 0.8, drumDest);
    [83, 86, 91, 95].forEach((m, i) => play(inst.bell, t + 3.5 * beat + i * 0.06, m, 0.25, bellDest));
  }
  function sadIntro(t, brassDest, drumDest, beat) {
    [[0, 64], [1, 63], [2, 62], [3, 61]].forEach(([b, m]) => play(inst.brass, t + b * beat * 0.9, m, 0.6, brassDest, b === 3 ? beat * 2.5 : beat * 0.7));
    play(inst.taiko, t + 2.7 * beat, 0, 0.7, drumDest, 0, 0.8);
  }

  // ---- scheduler ----
  const swingOff = (q, sw) => { const b = q & 3; return b === 0 ? 0 : b === 1 ? sw / 2 : b === 2 ? sw : sw + (1 - sw) / 2; };
  const stepTime = () => S.beatT + swingOff(S.q, S.md ? S.md.swing : 0.5) * (60 / S.bpm);
  const clampBpm = (b) => Math.max(50, Math.min(200, b));

  function setLayers(t, immediate) {
    const I = S.I;
    S.lv.base = 1 - 0.2 * I; S.lv.bass = smooth(0.08, 0.4, I); S.lv.drums = smooth(0.22, 0.6, I); S.lv.lead = smooth(0.45, 0.85, I);
    if (S.md && S.md.leadFloor) S.lv.lead = Math.max(S.lv.lead, S.md.leadFloor);   // gentle modes: melody regardless of intensity
    for (const k in layer) { if (immediate) { layer[k].gain.cancelScheduledValues(0); layer[k].gain.setValueAtTime(S.lv[k], t); } else layer[k].gain.setTargetAtTime(S.lv[k], t, 0.35); }
  }
  function applyMode(name, t) {
    if (S.mono) { S.mono.stop(t); S.mono = null; }
    if (name === 'off') { S.mode = 'off'; S.md = null; S.running = false; fader.gain.setTargetAtTime(0, t, 0.3); return; }
    const md = MODES[name], was = S.running;
    S.mode = name; S.md = md;
    S.target = clampBpm(S.override || md.bpm);
    if (!was || md.intro) S.bpm = S.target;
    setLayers(t, !was);
    S.bar = 0; S.introEnd = 0; S.progIdx = -1; S.fill = 0; S.crashNext = false; S.first = true; S.st.d0 = null;
    if (md.intro) S.introEnd = md.intro(t);
    if (md.lead) S.mono = makeMono(md.lead, t);
    bellSend.gain.setTargetAtTime(md.echo[0], t, 0.1); leadSend.gain.setTargetAtTime(md.echo[1], t, 0.1); gtrSend.gain.setTargetAtTime(md.echo[2], t, 0.1);
    dl.delayTime.setTargetAtTime(Math.min(1.5, (0.75 * 60) / S.bpm), t, 0.1);
    modeGain.gain.setTargetAtTime(md.gain || 1, t, 0.3);
    fader.gain.cancelScheduledValues(t); fader.gain.setTargetAtTime(1, t, was ? 0.05 : 0.3);
    S.running = true;
  }
  function newSection() {
    const md = S.md;
    let i = RI(0, md.progs.length - 1);
    if (i === S.progIdx && md.progs.length > 1) i = (i + 1) % md.progs.length;
    S.progIdx = i; S.prog = md.progs[i];
    S.roll = RI(0, ROLLS.length - 1);
    S.leadOn = !S.first && R() < md.leadChance; S.first = false;
    S.st.sections++; if (S.leadOn) S.st.leadSections++;
    const A = genMotif(md), B = genMotif(md);
    S.motifs = [A, variant(A, md, false), B, variant(A, md, true)];
  }
  const chordAt = (i) => { const [s, q] = S.prog[i % S.prog.length], root = S.md.key + s; return { root, pcs: QUAL[q].map((x) => (root + x) % 12) }; };

  function barStart(t) {
    if (S.pending) { const p = S.pending; S.pending = null; applyMode(p, t); if (!S.running) return; }
    S.st.bars++;
    // drift probe: with a steady tempo, bar starts must land exactly on t0 + n * barLength
    if (S.bpm === S.target) {
      if (!S.st.d0) S.st.d0 = { t, bar: S.bar, bpm: S.bpm };
      else if (S.st.d0.bpm === S.bpm) S.st.driftMs = (t - (S.st.d0.t + (S.bar - S.st.d0.bar) * (240 / S.bpm))) * 1000;
      else S.st.d0 = null;
    } else S.st.d0 = null;
    if (S.bar < S.introEnd) return;
    S.bi = (S.bar - S.introEnd) % 8;
    if (S.bi === 0) newSection();
    S.chord = chordAt(S.bi); S.next = chordAt(S.bi + 1);
    S.fill = S.lv.drums < 0.02 ? 0 : S.bi === 7 ? 2 : S.bi === 3 && R() < 0.6 ? 1 : 0;
    S.fillType = RI(0, 2);
    if (S.crashNext && S.lv.drums > 0.05) dr('crash', t, 0.45);
    S.crashNext = S.fill === 2;
    if (S.md.pad && S.lv.base > 0.01) padChord(t, S.chord.pcs, 240 / S.bpm, S.md.pad);
  }
  function beatStart(t) {
    if (S.bpm !== S.target) {
      S.bpm += (S.target - S.bpm) * 0.2;
      if (Math.abs(S.target - S.bpm) < 0.05) S.bpm = S.target;
      dl.delayTime.setTargetAtTime(Math.min(1.5, (0.75 * 60) / S.bpm), t, 0.2);
    }
    const It = Math.min(S.It, S.md.maxI);
    if (S.I !== It) { S.I += (It - S.I) * 0.3; if (Math.abs(It - S.I) < 0.005) S.I = It; setLayers(t, false); }
  }
  const X = { t: 0, q: 0, sd: 0, bd: 0, I: 0, c: null, n: null, bi: 0, fill: 0 };
  function playStep(t) {
    if (S.bar < S.introEnd || !S.chord) return;
    X.t = t; X.q = S.q; X.bd = 60 / S.bpm; X.sd = X.bd / 4; X.I = S.I; X.c = S.chord; X.n = S.next; X.bi = S.bi; X.fill = S.fill;
    S.md.step(X);
  }

  function pump(horizon = 0.12) {
    if (!S.running || !S.enabled) return;
    const c0 = performance.now(), now = ctx.currentTime;
    S.st.pumps++;
    let t = stepTime();
    if (!env.offline && t < now - 0.01) { const shift = now + 0.04 - t; S.beatT += shift; t += shift; S.st.resyncs++; S.st.d0 = null; }
    let guard = 0;
    while (t < now + horizon && S.running && guard++ < 8192) {
      if (S.q === 0) barStart(t);
      if (!S.running) break;
      if ((S.q & 3) === 0) beatStart(t);
      playStep(t);
      if (t - now < S.st.minLead) S.st.minLead = t - now;
      S.q++;
      if ((S.q & 3) === 0) S.beatT += 60 / S.bpm;
      if (S.q === 16) { S.q = 0; S.bar++; }
      t = stepTime();
    }
    S.st.cpuMs += performance.now() - c0;
  }
  const timer = env.offline ? null : setInterval(pump, 25);

  function start(t) { S.beatT = t; S.q = 0; applyMode(S.pending || S.mode, t); S.pending = null; }

  // ---- stingers (short musical one-shots on the SFX side, music ducks under them) ----
  const STING = {
    waveStart(t, o) {
      [55, 59, 62, 67, 71, 74, 79].forEach((m, i) => play(inst.banjo, t + i * 0.045, m, 0.55, o));
      brs(t + 0.38, [62, 66, 69], 0.5, 0.12, o); brs(t + 0.55, [62, 66, 69], 0.5, 0.12, o); brs(t + 0.72, [67, 71, 74, 79], 0.6, 0.7, o);
      play(inst.snare, t + 0.38, 0, 0.5, o); play(inst.snare, t + 0.55, 0, 0.6, o);
      play(inst.kick, t + 0.72, 0, 0.9, o); play(inst.crash, t + 0.72, 0, 0.45, o);
      return 1.6;
    },
    waveClear(t, o) {
      strum(t, [7, 11, 2], 0.6, false, 55, 5, o);
      [79, 76, 74, 71, 74, 79].forEach((m, i) => play(inst.banjo, t + 0.05 + i * 0.06, m, 0.45, o));
      [79, 83, 86, 91].forEach((m, i) => play(inst.bell, t + 0.42 + i * 0.07, m, 0.3, o));
      brs(t + 0.6, [67, 71, 74], 0.5, 0.8, o);
      return 1.6;
    },
    newWeapon(t, o) {
      play(inst.kick, t, 0, 0.8, o); strum(t, [7, 2], 0.8, false, 43, 4, o);
      brs(t + 0.08, [55, 62, 67], 0.55, 0.35, o);
      [91, 98].forEach((m, i) => play(inst.bell, t + 0.2 + i * 0.08, m, 0.25, o));
      return 1;
    },
    bossIn(t, o) {
      brs(t, [38, 45, 50], 0.9, 1.8, o); play(inst.crash, t, 0, 0.5, o);
      [0, 0.4, 0.8].forEach((d, i) => play(inst.taiko, t + d, 0, 0.9 - i * 0.15, o, 0, 1 - i * 0.06));
      play(inst.bell, t + 0.2, 74, 0.25, o); play(inst.bell, t + 0.2, 80, 0.2, o);
      return 2.2;
    },
    levelUp(t, o) {
      [67, 71, 74, 79, 83, 86, 91].forEach((m, i) => play(inst.bell, t + i * 0.05, m, 0.3, o));
      brs(t + 0.38, [67, 71, 74, 79], 0.5, 0.6, o); play(inst.shaker, t + 0.38, 0, 0.4, o);
      return 1.2;
    },
    victory(t, o) { fanfare(t, o, o, o, 60 / 104); return 3.2; },
    gameOver(t, o) {
      [[0, 64], [0.45, 63], [0.9, 62], [1.35, 61]].forEach(([d, m], i) => play(inst.brass, t + d, m, 0.6, o, i === 3 ? 1.4 : 0.38));
      play(inst.taiko, t + 1.35, 0, 0.7, o, 0, 0.8); strum(t + 1.35, [9, 0, 4], 0.45, false, 45, 4, o);
      return 3;
    },
    perfect(t, o) {
      [79, 83, 86, 90].forEach((m, i) => play(inst.bell, t + i * 0.03, m, 0.28, o));
      [91, 95, 98].forEach((m, i) => play(inst.bell, t + 0.25 + i * 0.04, m, 0.22, o));
      brs(t + 0.2, [67, 71, 74, 78], 0.45, 0.8, o);
      [74, 76, 79].forEach((m, i) => play(inst.banjo, t + i * 0.05, m, 0.4, o));
      return 1.4;
    },
  };

  return {
    setMode(name) {
      if (name !== 'off' && !MODES[name]) { console.warn('[music] unknown mode', name); return; }
      S.override = null;
      if (!S.running) {
        if (name === 'off') { S.mode = 'off'; return; }
        S.mode = name;
        if (S.enabled) { S.pending = name; start(ctx.currentTime + 0.06); }
        return;
      }
      if (name === S.mode && !S.pending) return;
      if (name === 'off') fader.gain.setTargetAtTime(0, ctx.currentTime, 0.35); // fade now, stop at the bar line
      S.pending = name;
    },
    setIntensity(x, immediate = false) {
      S.It = clamp01(+x || 0);
      if (immediate) { S.I = S.md ? Math.min(S.It, S.md.maxI) : S.It; setLayers(ctx.currentTime, true); }
    },
    setTempo(bpm) {
      S.override = bpm ? clampBpm(bpm) : null;
      const md = S.pending && S.pending !== 'off' ? null : S.md;
      if (md) S.target = clampBpm(S.override || md.bpm);
    },
    setEnabled(on) {
      if (S.enabled === on) return;
      S.enabled = on;
      const now = ctx.currentTime;
      if (!on) { fader.gain.setTargetAtTime(0, now, 0.25); if (S.mono) { S.mono.stop(now + 0.5); S.mono = null; } S.running = false; }
      else if (S.mode !== 'off') { S.pending = S.mode; start(now + 0.08); }
    },
    stinger(name) {
      const fn = STING[name];
      if (!fn) { console.warn('[audio] unknown stinger', name); return; }
      const now = ctx.currentTime;
      if (S.lastSting[name] && now - S.lastSting[name] < 0.25) return;
      S.lastSting[name] = now;
      const dur = fn(now + 0.03, env.stingerOut);
      env.duck(0.55, dur * 0.8);
    },
    pump,
    state() {
      return {
        mode: S.mode, pending: S.pending, running: S.running, enabled: S.enabled, bpm: +S.bpm.toFixed(2), targetBpm: S.target,
        intensity: +S.I.toFixed(3), intensityTarget: S.It, bar: S.bar, sectionBar: S.bi, leadOn: S.leadOn,
        minLeadMs: +(S.st.minLead * 1000).toFixed(1), resyncs: S.st.resyncs, driftMs: +S.st.driftMs.toFixed(6),
        bars: S.st.bars, notes: S.st.notes, leadNotes: S.st.leadNotes, sections: S.st.sections, leadSections: S.st.leadSections, pumps: S.st.pumps, avgPumpMs: S.st.pumps ? +(S.st.cpuMs / S.st.pumps).toFixed(4) : 0,
      };
    },
    resetStats() { S.st.minLead = 9; S.st.cpuMs = 0; S.st.pumps = 0; },
    dispose() { if (timer) clearInterval(timer); S.running = false; },
  };
}
