// =============================================================================
// FX — partículas em GPU, respingos de ovo, destroços, explosões, raios/lasers,
// popups de texto 3D, overlays presos na câmera e o banner 3D.
// Tudo com pool e poucas draw calls (Quest 2).
// =============================================================================
import { THREE, scene, camera, renderer, camPos, fitDistance, canvasTex, roundRect, TEX, FONT, FONT_UI, toon, UP, SHADOW_COLOR } from './render.js';
import { rand, clamp, tmpV } from './core.js';

const _c = new THREE.Color();
const [v0, v1, v2, v3] = tmpV(4);

// ---------- Escala dos pontos (corrige o tamanho no VR) ----------
export const pointScale = { value: 600 };
export const maxPoint = { value: 4096 };
const FXQ = { level: 0, cap: 1 };
export function updatePointScale() {
  let h = renderer.domElement.height, p11 = camera.projectionMatrix.elements[5];
  if (renderer.xr.isPresenting) {
    const s = renderer.xr.getSession();
    const bl = s && s.renderState && s.renderState.baseLayer;
    h = bl ? bl.framebufferHeight : 1800;
    const xc = renderer.xr.getCamera();
    if (xc && xc.cameras && xc.cameras[0]) p11 = xc.cameras[0].projectionMatrix.elements[5] || p11;
  }
  pointScale.value = h * 0.5 * p11;
  // no VR um ponto não passa de ~30% da altura da imagem (menos ainda com qualidade reduzida)
  maxPoint.value = renderer.xr.isPresenting ? h * [0.3, 0.22, 0.16, 0.12][FXQ.level] : 4096;
}

// ---------- Atlas de formas das partículas (2x2) ----------
// 0 brilho suave · 1 estrela de 4 pontas · 2 fumaça fofa · 3 gota sólida
const ATLAS = canvasTex(256, 256, (x) => {
  // brilho
  let g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  // estrela
  x.save(); x.translate(192, 64);
  g = x.createRadialGradient(0, 0, 0, 0, 0, 22); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.beginPath(); x.arc(0, 0, 22, 0, Math.PI * 2); x.fill();
  x.fillStyle = 'rgba(255,255,255,0.95)';
  for (let k = 0; k < 4; k++) { x.rotate(Math.PI / 2); x.beginPath(); x.moveTo(-7, 0); x.lineTo(0, -62); x.lineTo(7, 0); x.fill(); }
  x.restore();
  // fumaça (vários círculos sobrepostos)
  for (let k = 0; k < 9; k++) {
    const a = k / 9 * Math.PI * 2, r = k === 0 ? 0 : 22;
    const cx = 64 + Math.cos(a) * r, cy = 192 + Math.sin(a) * r;
    g = x.createRadialGradient(cx, cy, 0, cx, cy, 34);
    g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, 34, 0, Math.PI * 2); x.fill();
  }
  // gota sólida com borda suave e brilho (pedaço de ovo, pena, confete)
  g = x.createRadialGradient(178, 178, 2, 192, 192, 54);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.85, 'rgba(235,235,235,1)'); g.addColorStop(1, 'rgba(235,235,235,0)');
  x.fillStyle = g; x.beginPath(); x.arc(192, 192, 54, 0, Math.PI * 2); x.fill();
});
export const SHAPE = { glow: 0, star: 1, smoke: 2, solid: 3 };

const PARTICLE_VS = `
attribute float psize; attribute float palpha; attribute vec3 pcolor; attribute float pshape; attribute float prot;
uniform float uScale, uMaxPt;
varying vec3 vColor; varying float vAlpha; varying float vShape; varying float vRot;
void main(){
  vColor = pcolor; vAlpha = palpha; vShape = pshape; vRot = prot;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // limite de tamanho: fumaça colada no rosto cobria meia tela (muito pixel no Quest)
  gl_PointSize = min(psize * uScale / max(0.05, -mv.z), uMaxPt);
  gl_Position = projectionMatrix * mv;
}`;
const PARTICLE_FS = `
uniform sampler2D uAtlas;
varying vec3 vColor; varying float vAlpha; varying float vShape; varying float vRot;
void main(){
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) discard;
  float sx = mod(vShape, 2.0), sy = floor(vShape / 2.0);
  vec4 t = texture2D(uAtlas, (vec2(sx, sy) + vec2(p.x, 1.0 - p.y)) * 0.5);
  float a = t.a * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * t.rgb, a);
  #include <colorspace_fragment>
}`;

class Particles {
  constructor(max, additive, order) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.sz = new Float32Array(max); this.al = new Float32Array(max); this.sh = new Float32Array(max); this.rot = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.ml = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.s0 = new Float32Array(max);
    this.grow = new Float32Array(max); this.a0 = new Float32Array(max); this.spin = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    const dyn = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    this.attrs = [dyn(this.pos, 3), dyn(this.col, 3), dyn(this.sz, 1), dyn(this.al, 1), dyn(this.sh, 1), dyn(this.rot, 1)];
    ['position', 'pcolor', 'psize', 'palpha', 'pshape', 'prot'].forEach((k, i) => g.setAttribute(k, this.attrs[i]));
    g.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: pointScale, uMaxPt: maxPoint, uAtlas: { value: ATLAS } },
      vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = order;
    scene.add(this.points);
  }
  /** grav: m/s² · drag: 1/s · grow: multiplica o tamanho no fim · shape: SHAPE.* · spin: rad/s */
  spawn(x, y, z, vx, vy, vz, color, size, life, grav = 0, drag = 0, grow = 0, alpha = 1, shape = 0, spin = 0) {
    if (this.n >= this.max * FXQ.cap) return;
    const i = this.n++, i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = color.r; this.col[i3 + 1] = color.g; this.col[i3 + 2] = color.b;
    this.s0[i] = size; this.sz[i] = size; this.life[i] = 0; this.ml[i] = life;
    this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow; this.a0[i] = alpha; this.al[i] = 0;
    this.sh[i] = shape; this.spin[i] = spin; this.rot[i] = Math.random() * 6.283;
  }
  copy(f, t) {
    const f3 = f * 3, t3 = t * 3;
    for (let k = 0; k < 3; k++) { this.pos[t3 + k] = this.pos[f3 + k]; this.vel[t3 + k] = this.vel[f3 + k]; this.col[t3 + k] = this.col[f3 + k]; }
    this.sz[t] = this.sz[f]; this.al[t] = this.al[f]; this.life[t] = this.life[f]; this.ml[t] = this.ml[f];
    this.grav[t] = this.grav[f]; this.drag[t] = this.drag[f]; this.s0[t] = this.s0[f];
    this.grow[t] = this.grow[f]; this.a0[t] = this.a0[f]; this.sh[t] = this.sh[f]; this.rot[t] = this.rot[f]; this.spin[t] = this.spin[f];
  }
  update(dt) {
    let n = this.n;
    for (let i = 0; i < n; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.ml[i]) { n--; if (i !== n) this.copy(n, i); i--; continue; }
      const i3 = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3 + 1] -= this.grav[i] * dt;
      this.vel[i3] *= d; this.vel[i3 + 1] *= d; this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.grav[i] > 0 && this.pos[i3 + 1] < 0.03) { this.pos[i3 + 1] = 0.03; this.vel[i3 + 1] *= -0.3; this.vel[i3] *= 0.5; this.vel[i3 + 2] *= 0.5; this.spin[i] *= 0.5; }
      const t = this.life[i] / this.ml[i];
      this.sz[i] = this.s0[i] * (1 + this.grow[i] * t);
      this.al[i] = this.a0[i] * (t < 0.06 ? t / 0.06 : 1 - (t - 0.06) / 0.94);
      this.rot[i] += this.spin[i] * dt;
    }
    this.n = n;
    this.points.geometry.setDrawRange(0, n);
    if (n > 0) for (const a of this.attrs) { a.needsUpdate = true; a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); }
  }
  clear() { this.n = 0; this.points.geometry.setDrawRange(0, 0); }
}
/** Qualidade automática do VR: menos partículas e pontos menores (0 = tudo · 3 = mínimo). */
export function setFxQuality(q) { FXQ.level = q; FXQ.cap = [1, 0.6, 0.42, 0.3][q]; updatePointScale(); }
export const fxAdd = new Particles(1800, true, 7);     // brilhos, faíscas, fogo
export const fxAlpha = new Particles(1200, false, 6);  // fumaça, pedaços de ovo, penas, confete

// ---------- Receitas de partículas ----------
export function randDir(out) {
  const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
  return out.set(r * Math.cos(th), u, r * Math.sin(th));
}
export function sparks(pos, hex, n = 8, spd = 4, size = 0.06, life = 0.5) {
  _c.setHex(hex);
  for (let i = 0; i < n; i++) {
    randDir(v0); const s = spd * rand(0.4, 1.1);
    fxAdd.spawn(pos.x, pos.y, pos.z, v0.x * s, v0.y * s + 1, v0.z * s, _c, size * rand(0.6, 1.3), life * rand(0.6, 1.2), 6, 1.5, -0.4, 1, Math.random() < 0.3 ? SHAPE.star : SHAPE.glow, rand(-6, 6));
  }
}
export function twinkle(pos, hex, n = 4, r = 0.4, size = 0.12, life = 0.6) {
  _c.setHex(hex);
  for (let i = 0; i < n; i++) fxAdd.spawn(pos.x + rand(-r, r), pos.y + rand(-r, r), pos.z + rand(-r, r), 0, rand(0.2, 0.6), 0, _c, size * rand(0.6, 1.2), life * rand(0.7, 1.2), 0, 0, -0.6, 1, SHAPE.star, rand(-2, 2));
}
export function smoke(pos, n = 4, hex = 0x5a5a62, size = 0.45, life = 1.3, rise = 0.6) {
  _c.setHex(hex);
  for (let i = 0; i < n; i++) {
    fxAlpha.spawn(pos.x + rand(-0.15, 0.15), pos.y + rand(-0.1, 0.1), pos.z + rand(-0.15, 0.15), rand(-0.4, 0.4), rise * rand(0.6, 1.3), rand(-0.4, 0.4), _c, size * rand(0.7, 1.2), life * rand(0.7, 1.2), 0, 1.2, 1.7, 0.6, SHAPE.smoke, rand(-0.8, 0.8));
  }
}
export function fireball(pos, r = 1) {
  _c.setHex(0xfff4c0);
  fxAdd.spawn(pos.x, pos.y, pos.z, 0, 0, 0, _c, r * 2.4, 0.2, 0, 0, 0.5, 1, SHAPE.glow);
  for (let i = 0; i < 16; i++) {
    _c.setHex(Math.random() < 0.5 ? 0xff8a20 : 0xffc850);
    randDir(v0); const s = r * rand(1.4, 3.6);
    fxAdd.spawn(pos.x, pos.y, pos.z, v0.x * s, v0.y * s, v0.z * s, _c, r * rand(0.45, 0.8), rand(0.3, 0.6), 0, 3, 1.1, 1, SHAPE.smoke, rand(-3, 3));
  }
  sparks(pos, 0xffd070, 10, 6 * r, 0.05, 0.7);
  smoke(pos, 6, 0x34343a, r * 0.9, 1.8, 0.9);
}
export function feathers(pos, n = 4, hex = 0xffffff) {
  _c.setHex(hex);
  for (let i = 0; i < n; i++) {
    fxAlpha.spawn(pos.x, pos.y + 0.2, pos.z, rand(-1.4, 1.4), rand(0.6, 2), rand(-1.4, 1.4), _c, rand(0.05, 0.08), rand(1.2, 2), 1.0, 2.5, 0, 1, SHAPE.solid, rand(-5, 5));
  }
}
export function confetti(pos, n = 40, spd = 4) {
  const cols = [0xff4060, 0xffd040, 0x40e0ff, 0x8dff4a, 0xff80ff, 0xffffff];
  for (let i = 0; i < n; i++) {
    _c.setHex(cols[i % cols.length]);
    randDir(v0); const s = spd * rand(0.5, 1.2);
    fxAlpha.spawn(pos.x, pos.y, pos.z, v0.x * s, Math.abs(v0.y) * s + 2, v0.z * s, _c, rand(0.04, 0.07), rand(1.5, 2.6), 3, 1.8, 0, 1, SHAPE.solid, rand(-12, 12));
  }
}
export function muzzle(pos, hex, size = 0.22) {
  _c.setHex(hex);
  fxAdd.spawn(pos.x, pos.y, pos.z, 0, 0, 0, _c, size, 0.07, 0, 0, 0.8, 1, SHAPE.star, 0);
  _c.setHex(0xffffff);
  fxAdd.spawn(pos.x, pos.y, pos.z, 0, 0, 0, _c, size * 0.5, 0.05, 0, 0, 0, 1, SHAPE.glow);
}
export function trailPuff(pos, hex, size = 0.06, life = 0.35) {
  _c.setHex(hex);
  fxAdd.spawn(pos.x, pos.y, pos.z, rand(-0.1, 0.1), rand(-0.1, 0.1), rand(-0.1, 0.1), _c, size, life, 0, 0, -0.6, 0.8, SHAPE.glow);
}
/** Pedaços de ovo voando (clara + gema) — no ar, ao bater em nave. */
export function eggBurst(pos, golden = false, n = 12) {
  for (let k = 0; k < n; k++) {
    const yolk = k < 3;
    _c.setHex(yolk ? (golden ? 0xffd040 : 0xffb820) : 0xfffaf0);
    const phi = Math.random() * Math.PI * 2, th = Math.random() * Math.PI * 0.7, sp = rand(2, 5);
    fxAlpha.spawn(pos.x, pos.y, pos.z, Math.sin(th) * Math.cos(phi) * sp, Math.cos(th) * sp * 0.8 + 0.6, Math.sin(th) * Math.sin(phi) * sp,
      _c, yolk ? rand(0.07, 0.1) : rand(0.035, 0.06), rand(0.8, 1.3), 9.8, 0.6, 0, 1, SHAPE.solid, rand(-8, 8));
  }
  // casquinhas
  _c.setHex(0xf2e6d0);
  for (let k = 0; k < 5; k++) { randDir(v0); fxAlpha.spawn(pos.x, pos.y, pos.z, v0.x * 3, Math.abs(v0.y) * 3 + 1, v0.z * 3, _c, 0.03, rand(0.8, 1.2), 9.8, 0.4, 0, 1, SHAPE.solid, rand(-15, 15)); }
  if (golden) sparks(pos, 0xffd040, 8, 3, 0.06, 0.6);
}

// ---------- Ovo frito no chão (decal instanciado) ----------
const FRIED_TEX = canvasTex(256, 256, (x, w, h) => {
  // clara irregular
  x.fillStyle = '#fffaf0';
  x.beginPath();
  for (let i = 0; i <= 24; i++) {
    const a = i / 24 * Math.PI * 2, r = 100 + Math.sin(a * 3) * 12 + Math.sin(a * 5 + 1) * 8 + Math.random() * 6;
    const px = 128 + Math.cos(a) * r, py = 128 + Math.sin(a) * r;
    i ? x.lineTo(px, py) : x.moveTo(px, py);
  }
  x.closePath(); x.fill();
  x.strokeStyle = 'rgba(210,190,150,0.6)'; x.lineWidth = 4; x.stroke();
  // gotinhas
  for (let i = 0; i < 7; i++) { const a = Math.random() * 6.28; x.beginPath(); x.arc(128 + Math.cos(a) * 118, 128 + Math.sin(a) * 118, 6 + Math.random() * 6, 0, 6.28); x.fill(); }
  // gema com brilho
  const g = x.createRadialGradient(118, 116, 4, 128, 128, 44);
  g.addColorStop(0, '#fff2a0'); g.addColorStop(0.35, '#ffc21a'); g.addColorStop(1, '#f09000');
  x.fillStyle = g; x.beginPath(); x.arc(128, 128, 42, 0, 6.28); x.fill();
  x.fillStyle = 'rgba(255,255,255,0.8)'; x.beginPath(); x.ellipse(112, 112, 12, 7, -0.6, 0, 6.28); x.fill();
});
const SPLAT_MAX = 70;
const splatMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ map: FRIED_TEX, transparent: true, alphaTest: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), SPLAT_MAX);
splatMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
splatMesh.count = 0; splatMesh.frustumCulled = false; splatMesh.renderOrder = 2;
scene.add(splatMesh);
const splats = []; // { x, y, z, rot, s, life, ml }
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
export function friedEgg(pos, y = 0.03, golden = false) {
  if (splats.length >= SPLAT_MAX) splats.shift();
  splats.push({ x: pos.x, y: y + 0.004 + splats.length * 0.0002, z: pos.z, rot: Math.random() * 6.28, s: rand(0.4, 0.6), life: 0, ml: rand(5, 7), golden });
  eggBurst(pos, golden, 6);
}
function updateSplats(dt) {
  let n = 0;
  for (let i = splats.length - 1; i >= 0; i--) {
    const s = splats[i];
    s.life += dt;
    if (s.life > s.ml) { splats.splice(i, 1); continue; }
  }
  for (const s of splats) {
    const t = s.life;
    let k = t < 0.12 ? 0.5 + (t / 0.12) * 0.6 : t < 0.22 ? 1.1 - (t - 0.12) : 1;
    if (t > s.ml - 0.8) k *= (s.ml - t) / 0.8;
    _q.setFromEuler(_e.set(0, s.rot, 0));
    _m4.compose(_p.set(s.x, s.y, s.z), _q, _s.set(s.s * k, 1, s.s * k));
    splatMesh.setMatrixAt(n++, _m4);
  }
  splatMesh.count = n;
  splatMesh.instanceMatrix.needsUpdate = true;
}

// ---------- Destroços instanciados (pedaços de nave) ----------
const DEBRIS_MAX = 90;
const debrisMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), toon({ vertexColors: false }), DEBRIS_MAX);
debrisMesh.setColorAt(0, new THREE.Color(1, 1, 1));   // cria a cor por instância já (evita variante de shader nova no meio do jogo)
debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
debrisMesh.count = 0; debrisMesh.frustumCulled = false;
scene.add(debrisMesh);
const debris = [];
export function debrisBurst(pos, hex, n = 8, spd = 3) {
  for (let i = 0; i < n; i++) {
    if (debris.length >= DEBRIS_MAX) debris.shift();
    debris.push({
      p: new THREE.Vector3().copy(pos), v: new THREE.Vector3(rand(-spd, spd), rand(1, spd + 1.5), rand(-spd, spd)),
      r: new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)), w: new THREE.Vector3(rand(-8, 8), rand(-8, 8), rand(-8, 8)),
      s: new THREE.Vector3(rand(0.05, 0.14), rand(0.03, 0.06), rand(0.05, 0.12)), c: new THREE.Color(Math.random() < 0.55 ? hex : 0x9aa0aa),
      life: 0, ml: rand(2, 3), smokeT: 0,
    });
  }
}
function updateDebris(dt) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.life += dt;
    if (d.life > d.ml) { debris.splice(i, 1); continue; }
    d.v.y -= 9.8 * dt;
    d.p.addScaledVector(d.v, dt);
    if (d.p.y < 0.03) { d.p.y = 0.03; d.v.y *= -0.35; d.v.x *= 0.5; d.v.z *= 0.5; d.w.multiplyScalar(0.5); }
    d.r.x += d.w.x * dt; d.r.y += d.w.y * dt; d.r.z += d.w.z * dt;
    d.smokeT -= dt;
    if (d.smokeT <= 0 && d.life < 1.2 && d.p.y > 0.3) { d.smokeT = 0.08; _c.setHex(0x404048); fxAlpha.spawn(d.p.x, d.p.y, d.p.z, 0, 0.3, 0, _c, 0.12, 0.5, 0, 0, 1.5, 0.5, SHAPE.smoke); }
  }
  let n = 0;
  for (const d of debris) {
    const k = d.life > d.ml - 0.4 ? (d.ml - d.life) / 0.4 : 1;
    _m4.compose(d.p, _q.setFromEuler(d.r), _s.copy(d.s).multiplyScalar(k));
    debrisMesh.setMatrixAt(n, _m4);
    debrisMesh.setColorAt(n, d.c);
    n++;
  }
  debrisMesh.count = n;
  debrisMesh.instanceMatrix.needsUpdate = true;
  if (debrisMesh.instanceColor) debrisMesh.instanceColor.needsUpdate = true;
}

// ---------- Explosões (esfera + anel de choque), com pool ----------
const BLAST_GEO = new THREE.IcosahedronGeometry(1, 2);
const RING_GEO = new THREE.RingGeometry(0.7, 1, 40);
const blasts = [];
for (let i = 0; i < 12; i++) {
  const m = new THREE.Mesh(i % 2 ? RING_GEO : BLAST_GEO, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  m.visible = false; m.renderOrder = 8;
  scene.add(m);
  blasts.push({ m, ring: !!(i % 2), life: 1, ml: 1, r: 1, a0: 1 });
}
export function blast(pos, radius, hex) {
  for (const ring of [false, true]) {
    const b = blasts.find(q => q.ring === ring && q.life >= q.ml) || blasts.filter(q => q.ring === ring).sort((a, c) => c.life / c.ml - a.life / a.ml)[0];
    b.m.material.color.setHex(ring ? 0xffffff : hex);
    b.m.position.copy(pos);
    b.life = 0; b.ml = ring ? 0.42 : 0.38; b.r = ring ? radius * 1.4 : radius; b.a0 = ring ? 0.7 : 0.9;
    b.m.visible = true;
    if (ring) b.m.lookAt(camPos);
  }
}
function updateBlasts(dt) {
  for (const b of blasts) {
    if (!b.m.visible) continue;
    b.life += dt;
    const t = b.life / b.ml;
    if (t >= 1) { b.m.visible = false; continue; }
    const e = 1 - Math.pow(1 - t, 3);
    b.m.scale.setScalar(Math.max(0.01, b.r * (b.ring ? e : Math.min(1, e * 1.6))));
    b.m.material.opacity = b.a0 * (1 - t) * (1 - t);
    if (b.ring) b.m.lookAt(camPos);
  }
}

// ---------- Segmentos de luz (raios tesla, lasers, mira da sniper, cabos) — 1 draw call ----------
const SEG_MAX = 260;
const segGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
const segMesh = new THREE.InstancedMesh(segGeo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), SEG_MAX);
segMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
segMesh.count = 0; segMesh.frustumCulled = false; segMesh.renderOrder = 9;
segMesh.setColorAt(0, new THREE.Color());
scene.add(segMesh);
const segs = []; // { a, b, w, c, life, ml }
const segFree = [];
/** Desenha um segmento brilhante de a até b. life = 0 → só neste frame. */
export function seg(a, b, w, hex, life = 0) {
  if (segs.length >= SEG_MAX) return;
  const s = segFree.pop() || { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Color() };
  s.a.copy(a); s.b.copy(b); s.w = w; s.c.setHex(hex); s.life = 0; s.ml = life;
  segs.push(s);
}
/** Raio em zigue-zague entre a e b (tesla, choque). */
export function bolt(a, b, jag = 0.15, life = 0.09, hex = 0xb8f0ff, w = 0.018) {
  const n = Math.max(3, Math.min(9, Math.ceil(a.distanceTo(b) / 1.2)));
  v1.copy(a);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    v2.lerpVectors(a, b, t);
    if (i < n) { const j = jag * a.distanceTo(b) / n * 1.6; v2.x += rand(-j, j); v2.y += rand(-j, j); v2.z += rand(-j, j); }
    seg(v1, v2, w * 2.4, hex, life);          // halo
    seg(v1, v2, w * 0.7, 0xffffff, life);     // núcleo
    v1.copy(v2);
  }
}
function updateSegs(dt) {
  let n = 0;
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    if (s.life > s.ml) { segFree.push(s); segs[i] = segs[segs.length - 1]; segs.pop(); continue; }
    v3.subVectors(s.b, s.a);
    const len = v3.length();
    if (len > 1e-5) {
      _q.setFromUnitVectors(UP, v3.multiplyScalar(1 / len));
      _m4.compose(_p.addVectors(s.a, s.b).multiplyScalar(0.5), _q, _s.set(s.w, len, s.w));
      const fade = s.ml > 0 ? 1 - s.life / s.ml : 1;
      segMesh.setMatrixAt(n, _m4);
      segMesh.setColorAt(n, _c.copy(s.c).multiplyScalar(fade));
      n++;
    }
    s.life += dt;
    if (s.ml === 0) s.life = 1; // de frame único: some no próximo update
  }
  segMesh.count = n;
  segMesh.instanceMatrix.needsUpdate = true;
  if (segMesh.instanceColor) segMesh.instanceColor.needsUpdate = true;
}

// ---------- Popups de texto 3D ----------
const pops = [];
for (let i = 0; i < 22; i++) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false }));
  sp.visible = false; sp.renderOrder = 990;
  scene.add(sp);
  pops.push({ sp, ctx: c.getContext('2d'), tex, life: 0, ml: 1, active: false, size: 1, vy: 0.6 });
}
let popsThisFrame = 0;
export function popup(text, pos, color = '#ffd040', size = 1, life = 1.1) {
  // no máximo 4 textos novos por quadro (cada um redesenha um canvas e sobe a textura)
  if (++popsThisFrame > 4) return;
  let p = pops.find(q => !q.active);
  if (!p) p = pops.reduce((a, b) => (a.life / a.ml > b.life / b.ml ? a : b));
  const ctx = p.ctx;
  ctx.clearRect(0, 0, 512, 128);
  let fs = 80;
  ctx.font = fs + 'px ' + FONT;
  const w = ctx.measureText(text).width;
  if (w > 470) { fs = Math.floor(fs * 470 / w); ctx.font = fs + 'px ' + FONT; }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = 14; ctx.strokeStyle = 'rgba(20,10,30,0.9)';
  ctx.strokeText(text, 256, 66);
  const g = ctx.createLinearGradient(0, 30, 0, 100);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, color); g.addColorStop(1, color);
  ctx.fillStyle = g; ctx.fillText(text, 256, 66);
  p.tex.needsUpdate = true;
  p.sp.position.copy(pos);
  p.life = 0; p.ml = life; p.active = true; p.size = size; p.sp.visible = true; p.vy = 0.6;
}
export function popupStack(lines, pos) {
  const d = Math.max(1, camPos.distanceTo(pos));
  lines.forEach((l, i) => popup(l[0], v3.copy(pos).setY(pos.y - d * 0.04 * i), l[1], l[2] || 1, l[3] || 1.1));
}
export function popupAhead(text, color, size = 1.2, life = 1.2) {
  camera.getWorldDirection(v0);
  popup(text, v1.copy(camPos).addScaledVector(v0, 1.6), color, size, life);
}
function updatePops(dt) {
  popsThisFrame = 0;
  for (const p of pops) {
    if (!p.active) continue;
    p.life += dt;
    const t = p.life / p.ml;
    if (t >= 1) { p.active = false; p.sp.visible = false; continue; }
    p.sp.position.y += dt * p.vy;
    const d = camPos.distanceTo(p.sp.position);
    let w = clamp(d * 0.11, 0.22, 3.4) * p.size;
    // estoura e assenta (squash and stretch)
    if (t < 0.1) w *= 0.5 + (t / 0.1) * 0.7; else if (t < 0.2) w *= 1.2 - (t - 0.1) / 0.1 * 0.2;
    p.sp.scale.set(w, w * 0.25, 1);
    p.sp.material.opacity = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
  }
}

// ---------- Overlays presos na câmera ----------
const VIGNETTE_TEX = canvasTex(256, 256, (x, w, h) => {
  const g = x.createRadialGradient(128, 128, 40, 128, 128, 150);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.55, 'rgba(255,255,255,0.25)'); g.addColorStop(1, 'rgba(255,255,255,1)');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
});
// vinheta de conforto: centro limpo maior, borda escura suave (túnel)
const COMFORT_TEX = canvasTex(256, 256, (x, w, h) => {
  const g = x.createRadialGradient(128, 128, 70, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.6, 'rgba(255,255,255,0.65)'); g.addColorStop(1, 'rgba(255,255,255,1)');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
});
const SLIME_TEX = canvasTex(512, 512, (x, w, h) => {
  const eg = x.createRadialGradient(256, 256, 120, 256, 256, 300);
  eg.addColorStop(0, 'rgba(90,220,40,0)'); eg.addColorStop(1, 'rgba(90,220,40,0.85)');
  x.fillStyle = eg; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * Math.PI * 2, r = w * (0.34 + Math.random() * 0.22);
    const cx = w / 2 + Math.cos(a) * r, cy = h / 2 + Math.sin(a) * r, rr = w * (0.05 + Math.random() * 0.09);
    const g = x.createRadialGradient(cx - rr * 0.3, cy - rr * 0.3, 0, cx, cy, rr);
    g.addColorStop(0, 'rgba(200,255,150,0.98)'); g.addColorStop(0.4, 'rgba(120,240,50,0.92)'); g.addColorStop(1, 'rgba(60,170,20,0)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, rr, 0, Math.PI * 2); x.fill();
  }
  x.fillStyle = 'rgba(110,230,40,0.9)';
  for (let i = 0; i < 12; i++) {
    const dx = 40 + Math.random() * (w - 80), len = 60 + Math.random() * 150, dw = 8 + Math.random() * 12;
    x.fillRect(dx - dw / 2, 0, dw, len);
    x.beginPath(); x.arc(dx, len, dw * 0.8, 0, Math.PI * 2); x.fill();
  }
});
function makeOverlay(tex, hex, z = -0.24, size = 1.4) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, color: hex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
  m.position.z = z; m.renderOrder = 1000; m.visible = false;
  camera.add(m);
  return m;
}
const ovHurt = makeOverlay(VIGNETTE_TEX, 0xff2020);
const ovFlash = makeOverlay(VIGNETTE_TEX, 0xffc020);
const ovSlow = makeOverlay(VIGNETTE_TEX, 0x40a0ff);
const ovSlime = makeOverlay(SLIME_TEX, 0xffffff);
const ovBubble = makeOverlay(VIGNETTE_TEX, 0x60e0ff);
const ovMove = makeOverlay(COMFORT_TEX, 0x000000, -0.2, 1.2);
const ovLow = makeOverlay(VIGNETTE_TEX, 0xff0020);
export const ov = { hurt: 0, flash: 0, slime: 0, move: 0, slow: 0, bubble: 0, low: 0 };
export function flashScreen(hex, t = 0.5) { ovFlash.material.color.setHex(hex); ov.flash = t; }
function updateOverlays(dt) {
  ov.hurt = Math.max(0, ov.hurt - dt);
  ov.flash = Math.max(0, ov.flash - dt);
  ov.slime = Math.max(0, ov.slime - dt);
  const set = (m, a) => { m.material.opacity = a; m.visible = a > 0.01; };
  set(ovHurt, Math.min(0.85, ov.hurt * 2.2));
  set(ovFlash, Math.min(0.7, ov.flash * 1.6));
  set(ovSlime, Math.min(1, ov.slime * 0.9));
  ovBubble.material.opacity += (ov.bubble * 0.4 - ovBubble.material.opacity) * Math.min(1, dt * 6); ovBubble.visible = ovBubble.material.opacity > 0.01;
  ovSlow.material.opacity += (ov.slow * 0.35 - ovSlow.material.opacity) * Math.min(1, dt * 4); ovSlow.visible = ovSlow.material.opacity > 0.01;
  ovMove.material.opacity += (ov.move * 0.6 - ovMove.material.opacity) * Math.min(1, dt * 7); ovMove.visible = ovMove.material.opacity > 0.01;
  set(ovLow, ov.low);
}

// ---------- Banner 3D (segue o olhar devagar) ----------
const bannerCanvas = document.createElement('canvas');
bannerCanvas.width = 1024; bannerCanvas.height = 460;
const bctx = bannerCanvas.getContext('2d');
const bannerTex = new THREE.CanvasTexture(bannerCanvas); bannerTex.colorSpace = THREE.SRGBColorSpace;
const bannerMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.08), new THREE.MeshBasicMaterial({ map: bannerTex, transparent: true, fog: false, depthTest: false, side: THREE.DoubleSide, toneMapped: false }));
bannerMesh.renderOrder = 998; bannerMesh.visible = false;
scene.add(bannerMesh);
let bannerLife = 0, bannerDur = 2.4, bannerYOff = 0;
export function fitText(x, text, cx, cy, maxW, size, family, color, glow, weight = '') {
  let s = size;
  x.font = weight + ' ' + s + 'px ' + family;
  const w = x.measureText(text).width;
  if (w > maxW) { s = Math.floor(s * maxW / w); x.font = weight + ' ' + s + 'px ' + family; }
  if (glow) { x.shadowColor = color; x.shadowBlur = 26; }
  x.fillStyle = color; x.fillText(text, cx, cy);
  x.shadowBlur = 0;
}
function strokeFit(x, text, cx, cy, maxW, size, family, color, lw = 12) {
  let s = size;
  x.font = s + 'px ' + family;
  const w = x.measureText(text).width;
  if (w > maxW) { s = Math.floor(s * maxW / w); x.font = s + 'px ' + family; }
  x.lineJoin = 'round'; x.lineWidth = lw; x.strokeStyle = 'rgba(16,8,28,0.95)'; x.strokeText(text, cx, cy);
  const g = x.createLinearGradient(0, cy - s * 0.5, 0, cy + s * 0.5);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, color); g.addColorStop(1, color);
  x.fillStyle = g; x.fillText(text, cx, cy);
}
function drawBanner(title, sub, l3, color, l4) {
  const x = bctx, W = 1024, H = 460;
  x.clearRect(0, 0, W, H);
  // placa com cantos arredondados, degradê e faixa colorida
  const top = 40, bh = l4 ? 400 : l3 ? 340 : sub ? 270 : 190;
  roundRect(x, 30, top, W - 60, bh, 46);
  const g = x.createLinearGradient(0, top, 0, top + bh);
  g.addColorStop(0, 'rgba(28,18,48,0.93)'); g.addColorStop(1, 'rgba(10,8,22,0.93)');
  x.fillStyle = g; x.fill();
  x.lineWidth = 8; x.strokeStyle = color; x.stroke();
  x.save(); x.clip();
  x.fillStyle = color; x.globalAlpha = 0.18; x.fillRect(0, top, W, 16); x.globalAlpha = 1;
  x.restore();
  x.textAlign = 'center'; x.textBaseline = 'middle';
  strokeFit(x, title, 512, top + 92, 900, 118, FONT, color, 16);
  if (sub) fitText(x, sub, 512, top + 192, 920, 44, FONT_UI, '#ffffff', false, '800');
  if (l3) fitText(x, l3, 512, top + 262, 920, 50, FONT, '#8dff4a');
  if (l4) fitText(x, l4, 512, top + 334, 940, 36, FONT_UI, '#ffc080', false, '700');
  bannerTex.needsUpdate = true;
}
export function showBanner(title, sub = '', l3 = '', color = '#ffd040', dur = 2.4, yOff = 0, l4 = '') {
  drawBanner(title, sub, l3, color, l4);
  bannerLife = 0; bannerDur = dur; bannerYOff = yOff;
  placeBanner(true);
  bannerMesh.visible = true;
}
export function hideBanner() { bannerMesh.visible = false; }
export const bannerVisible = () => bannerMesh.visible;
function placeBanner(snap) {
  camera.getWorldDirection(v0); v0.y = 0;
  if (v0.lengthSq() < 1e-4) v0.set(0, 0, 1);
  v0.normalize();
  const bd = fitDistance(1.25, 3.4);
  v1.copy(camPos).addScaledVector(v0, bd); v1.y = camPos.y + (0.55 + bannerYOff * (camera.aspect < 1 && !renderer.xr.isPresenting ? 0.4 : 1)) * bd / 3.4;
  if (snap) bannerMesh.position.copy(v1); else bannerMesh.position.lerp(v1, 0.05);
  bannerMesh.lookAt(camPos);
}
function updateBanner(dt) {
  if (!bannerMesh.visible) return;
  bannerLife += dt;
  if (bannerLife > bannerDur) { bannerMesh.visible = false; return; }
  placeBanner(false);
  const t = bannerLife, e = t < 0.25 ? 1 - Math.pow(1 - t / 0.25, 3) : 1;
  const s = t < 0.25 ? 0.6 + e * 0.4 + Math.sin(e * Math.PI) * 0.08 : 1;
  bannerMesh.scale.setScalar(s);
  bannerMesh.material.opacity = bannerDur - t < 0.4 ? (bannerDur - t) / 0.4 : Math.min(1, t * 6);
}

// ---------- Sombras de chão (blob) — qualquer entidade pede uma por frame ----------
const BLOB_MAX = 64;
const blobMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ map: TEX.shadow, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }), BLOB_MAX);
blobMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
blobMesh.count = 0; blobMesh.frustumCulled = false; blobMesh.renderOrder = 1;
blobMesh.material.color = SHADOW_COLOR;   // sombra no chão com o tom do céu do momento (world.setTOD atualiza)
scene.add(blobMesh);
let blobN = 0;
/** Sombra redonda no chão em (x, y, z) com diâmetro d. Chame todo frame enquanto quiser a sombra. */
export function blob(x, y, z, d) {
  if (blobN >= BLOB_MAX || d <= 0.01) return;
  _m4.makeScale(d, 1, d); _m4.setPosition(x, y + 0.02, z);
  blobMesh.setMatrixAt(blobN++, _m4);
}
function flushBlobs() { blobMesh.count = blobN; blobMesh.instanceMatrix.needsUpdate = true; blobN = 0; }

// ---------- Brilhos de um frame (luzes das naves à noite, halos de projéteis) — 1 draw call ----------
const GLOW_MAX = 400;
const glowPos = new Float32Array(GLOW_MAX * 3), glowCol = new Float32Array(GLOW_MAX * 3), glowSz = new Float32Array(GLOW_MAX), glowAl = new Float32Array(GLOW_MAX), glowSh = new Float32Array(GLOW_MAX), glowRot = new Float32Array(GLOW_MAX);
const glowGeo = new THREE.BufferGeometry();
const glowAttrs = [[glowPos, 3, 'position'], [glowCol, 3, 'pcolor'], [glowSz, 1, 'psize'], [glowAl, 1, 'palpha'], [glowSh, 1, 'pshape'], [glowRot, 1, 'prot']]
  .map(([arr, n, k]) => { const a = new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage); glowGeo.setAttribute(k, a); return a; });
glowGeo.setDrawRange(0, 0);
const glowPts = new THREE.Points(glowGeo, new THREE.ShaderMaterial({
  uniforms: { uScale: pointScale, uAtlas: { value: ATLAS } }, vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
}));
glowPts.frustumCulled = false; glowPts.renderOrder = 7;
scene.add(glowPts);
let glowN = 0;
/** Ponto de luz que dura só este frame. size em metros. */
export function glow(x, y, z, size, hex, alpha = 1, shape = 0) {
  if (glowN >= GLOW_MAX || alpha <= 0.01) return;
  const i = glowN++, i3 = i * 3;
  glowPos[i3] = x; glowPos[i3 + 1] = y; glowPos[i3 + 2] = z;
  _c.setHex(hex); glowCol[i3] = _c.r; glowCol[i3 + 1] = _c.g; glowCol[i3 + 2] = _c.b;
  glowSz[i] = size; glowAl[i] = alpha; glowSh[i] = shape; glowRot[i] = 0;
}
function flushGlow() {
  glowGeo.setDrawRange(0, glowN);
  if (glowN) for (const a of glowAttrs) { a.needsUpdate = true; a.clearUpdateRanges(); a.addUpdateRange(0, glowN * a.itemSize); }
  glowN = 0;
}

// ---------- Loop e reset ----------
export function updateFx(dt) {
  updatePointScale();
  fxAdd.update(dt); fxAlpha.update(dt);
  updateSplats(dt);
  updateDebris(dt);
  updateBlasts(dt);
  updateSegs(dt);
  updatePops(dt);
  updateOverlays(dt);
  updateBanner(dt);
  flushBlobs();
  flushGlow();
}
export function clearFx() {
  fxAdd.clear(); fxAlpha.clear();
  splats.length = 0; debris.length = 0;
  for (const b of blasts) b.m.visible = false;
  for (const p of pops) { p.active = false; p.sp.visible = false; }
  bannerMesh.visible = false;
}
