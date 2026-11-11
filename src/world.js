// =============================================================================
// WORLD — a fazenda inteira: chão, casa + varanda, quintal, cerca, celeiro, silo,
// moinho, milharal, árvores, colinas/montanhas + ciclo do dia (setTOD) + colisões.
//
// Orçamento (Quest 2): ~13 draw calls, < 120k triângulos. Tudo estático é "bakeado"
// (render.js → bake) em 3 malhas: facetada (MAT.flat), lisa (MAT.smooth) e vidros
// (material próprio cujo emissive acende ao anoitecer). Grama/flores/milho são
// InstancedMesh com balanço de vento no vertex shader. Luzes reais: SÓ 1 direcional
// + 1 hemisférica — lampiões e janelas são emissive + sprites aditivos.
//
// Convenção: +Y pra cima, jogador olha para +Z no início. ATENÇÃO: olhando para +Z,
// a DIREITA da tela é -X. Por isso o celeiro (direita) fica em x < 0 e o moinho
// (esquerda) em x > 0; o pôr do sol fica à frente-direita (x < 0, z > 0).
// =============================================================================
import {
  THREE, scene, renderer, U, MAT, RAMP3, bake, add, box, cyl, sph, cone, ico, lathe, canvasTex,
} from './render.js';
import { initSky, updateSky, skyU, cloudU, starU } from './sky.js';

// ---------- Contrato com o gameplay ----------
export const PORCH_Y = 0.4;
export const YARD = { minX: -8, maxX: 8, minZ: 2, maxZ: 16.5 };      // área das galinhas
export const MOVE_BOUNDS = { minX: -8.6, maxX: 8.6, minZ: -3.3, maxZ: 17.4 };
export const CHAIR_POS = new THREE.Vector3(0, PORCH_Y, 0);
export const LANTERN_POS = new THREE.Vector3(-3.42, 2.78, 0.2);      // lampião pendurado (frente-direita)
export const FENCE = { x: 9.6, zFront: 18.6, zBack: -3.8 };          // cerca do quintal
export const HOUSE_BOX = { minX: -5.4, maxX: 5.4, minZ: -11.4, maxZ: -3.6 };
export const PORCH_BOX = { minX: -3.96, maxX: 3.96, minZ: -3.6, maxZ: 0.5 };
export const RAMP_BOX = { minX: -1.35, maxX: 1.35, minZ: 0.5, maxZ: 1.7 };
// Obstáculos DENTRO da área do jogador (AABB no plano XZ, meia-largura hx/hz).
// blockedSeg já considera; galinhas podem usar obstacleAt() para desviar.
export const OBSTACLES = [
  { name: 'coop', x: -6.72, z: 12.8, hx: 0.94, hz: 1.36 },           // galinheiro + rampinha
  { name: 'hayRound', x: 7.55, z: 17.5, hx: 0.62, hz: 0.66 },        // fardo redondo
  { name: 'hayStack', x: -8.13, z: 17.45, hx: 0.56, hz: 0.46 },       // fardos quadrados
];
export const sunDir = new THREE.Vector3(0, 1, 0);

const hemi = new THREE.HemisphereLight(0xd6ecff, 0x7a9a4a, 1.2);
const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
sun.name = 'sun'; hemi.name = 'hemi';
export const lights = { hemi, sun };

// ---------- Utilidades ----------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const D2R = Math.PI / 180;
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let R = mulberry32(20251109);                   // layout determinístico
const rnd = (a = 0, b = 1) => a + (b - a) * R();
const pick = arr => arr[Math.floor(R() * arr.length)];

// Ruído de valor 2D (determinístico) para o terreno
function hash2(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}
const fbm = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.03 + 5.2, y * 2.03 - 1.3) * 0.3 + vnoise(x * 4.1 - 7.7, y * 4.1 + 3.1) * 0.15;
const angDist = (a, b) => { let d = Math.abs(a - b) % (Math.PI * 2); return d > Math.PI ? Math.PI * 2 - d : d; };

/** Direção a partir de azimute (0 = +Z, positivo = para a DIREITA da tela, i.e. -X) e elevação. */
function dirFromAzEl(azDeg, elDeg, out) {
  const az = azDeg * D2R, el = elDeg * D2R;
  return out.set(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}
const MOON_DIR = dirFromAzEl(-40, 31, new THREE.Vector3());          // frente-esquerda, alta
const SUNSET_AZ = 21;                                                  // graus, à direita do centro
const SUNSET_AZ_RAD = Math.atan2(-Math.sin(SUNSET_AZ * D2R), Math.cos(SUNSET_AZ * D2R)); // azimute (atan2(x,z))

// ---------- Paleta ----------
const C = {
  white: 0xfbf6ea, trim: 0xf3ede0,
  siding: 0xf4d68c, sidingLn: 0xe0bb69,
  roof: 0x3f7682, roofDk: 0x325f69, roofRib: 0x4b8592,
  wood: [0xc68a52, 0xbb8049, 0xcf955d], woodDk: 0x7c5233, woodMid: 0xa06c3f,
  ceil: 0xa8dbd3, door: 0xb93c3b, shutter: 0x3f8a72, shutterDk: 0x347460,
  stone: 0x9d978b, stoneDk: 0x86807a, brick: 0xb4553d, brickDk: 0x8e3f2e,
  iron: 0x2c2b30, gold: 0xe0b040,
  barn: 0xc8443a, barnDk: 0xa63731, barnRoof: 0x58494f, barnRoofLt: 0x6a5a60,
  picket: 0xe9d0a0, post: 0xb3875a, postCap: 0x9d7348,
  hay: 0xe6c25c, hayDk: 0xc9a443, hayLt: 0xf0d27a,
  trunk: 0x7a5134, trunkDk: 0x5e3d27,
  leaf: [0x4f9a3c, 0x5daa45, 0x6bb84e], leafLt: 0x86c95a, leafDk: 0x3f8533,
  pine: [0x2f6e4c, 0x3a7f56, 0x47915f],
  soil: 0x6e4a31, terracotta: 0xc8673f,
  pumpkin: [0xf08a24, 0xe9781c, 0xf5a23a], stem: 0x5d6b2c,
  metal: 0xc3ccd3, metalDk: 0x98a3ad,
  green: 0x3f9a46, yellow: 0xf2c230, tire: 0x2b2a2e,
  coop: 0xf2c14e, coopRoof: 0xc8473b,
};

// =============================================================================
// Helpers de modelagem (complementam os de render.js)
// =============================================================================
function shapeGeo(pts, depth) {
  const s = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, steps: 1, curveSegments: 1 });
  g.translate(0, 0, -depth / 2);
  return g;
}
/** Prisma: polígono no plano XY extrudado em Z (centrado). */
const prism = (g, pts, depth, hex, x = 0, y = 0, z = 0) => add(g, shapeGeo(pts, depth), hex, x, y, z);
/** Laje entre dois pontos (x,y) do plano XY, profundidade em Z (telhados). ext = beiral. */
function slab(g, ax, ay, bx, by, depth, thick, hex, extA = 0, extB = 0, z = 0) {
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
  let nx = -uy, ny = ux; if (ny < 0) { nx = -nx; ny = -ny; }
  const sx = ax - ux * extA, sy = ay - uy * extA, ex = bx + ux * extB, ey = by + uy * extB;
  const m = box(g, L + extA + extB, thick, depth, hex, (sx + ex) / 2 + nx * thick / 2, (sy + ey) / 2 + ny * thick / 2, z);
  m.rotation.z = Math.atan2(dy, dx);
  return m;
}
const _up = new THREE.Vector3(0, 1, 0), _va = new THREE.Vector3();
/** Viga (caixa) esticada entre dois pontos 3D. */
function beam(g, a, b, w, hex) {
  _va.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _va.length();
  const m = box(g, w, len, w, hex, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  m.quaternion.setFromUnitVectors(_up, _va.normalize());
  return m;
}
const grp = (parent, x = 0, y = 0, z = 0, ry = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; parent.add(g); return g; };
const kind = (m, k) => { m.userData.kind = k; return m; };
/** local (lx,lz) de um grupo em (cx,cz) girado ry → mundo. */
const l2w = (cx, cz, ry, lx, lz) => [cx + lx * Math.cos(ry) + lz * Math.sin(ry), cz - lx * Math.sin(ry) + lz * Math.cos(ry)];

// Brilhos aditivos (lampiões, janelas, poças de luz, vaga-lumes) → 1 malha no fim
const GLOWS = [];
const G_LAMP = 0, G_WIN = 1, G_POOL = 2, G_FIRE = 3;
const _gv = new THREE.Vector3();
function glowAt(obj, lx, ly, lz, size, hex, k, mul = 1) {
  obj.updateWorldMatrix(true, false);
  _gv.set(lx, ly, lz); obj.localToWorld(_gv);
  GLOWS.push({ x: _gv.x, y: _gv.y, z: _gv.z, size, color: new THREE.Color(hex).multiplyScalar(mul), kind: k, phase: R() });
}

// =============================================================================
// TERRENO — malha polar única: miolo plano (pintado por textura), lavouras em
// patchwork procedural, colinas e montanhas no horizonte (com o "vale" do pôr do sol)
// =============================================================================
const TC = { x: 0, z: 10 };                                  // centro do terreno
const GT = { X0: -40, Z0: -26, S: 80, PX: 1024 };            // área da textura do chão (m)
const roadZ = x => 27 + 0.0022 * x * x;                      // estrada (mesma fórmula no shader)

export function terrainHeight(x, z) {
  const dx = x - TC.x, dz = z - TC.z, d = Math.hypot(dx, dz);
  if (d < 46) return 0;
  const a = Math.atan2(dx, dz);
  // colinas suaves (mais baixas no cone frontal até ~200 m: céu limpo pros UFOs)
  const front = 1 - 0.45 * (1 - smooth(0.35, 0.8, Math.abs(a))) * (1 - smooth(160, 260, d));
  let h = smooth(46, 160, d) * (2 + 28 * Math.pow(fbm(x * 0.0085 + 3.1, z * 0.0085 - 7.4), 1.5)) * front;
  // montanhas: perfil por ângulo (sem emenda) + detalhe local
  const ca = Math.cos(a), sa = Math.sin(a);
  const r1 = fbm(ca * 2.3 + 10, sa * 2.3 + 10), r2 = fbm(ca * 6.5 + 20, sa * 6.5 + 20);
  let mtn = 40 + 120 * r1 * r1 + 40 * r2;
  mtn *= 0.35 + 0.65 * smooth(0.2, 0.75, angDist(a, SUNSET_AZ_RAD));   // vale onde o sol se põe
  h += smooth(330, 540, d) * mtn + smooth(380, 540, d) * fbm(x * 0.03, z * 0.03) * 22;
  return h;
}

const _tc = new THREE.Color(), _tc2 = new THREE.Color(), _tc3 = new THREE.Color();
const TCOL = {
  meadow: new THREE.Color(0x8bbb53), hillA: new THREE.Color(0x77b04a), hillB: new THREE.Color(0x5e9a3f),
  forest: new THREE.Color(0x467f3a), rock: new THREE.Color(0x7d8db0), rockLt: new THREE.Color(0x98a6c6),
  snow: new THREE.Color(0xf3f6ff),
};
function terrainColor(x, z, h, d, out) {
  const n = fbm(x * 0.018 + 11, z * 0.018 - 5), n2 = vnoise(x * 0.05 - 3, z * 0.05 + 8);
  out.copy(TCOL.meadow);
  const far = smooth(46, 110, d);
  _tc.copy(TCOL.hillA).lerp(TCOL.hillB, smooth(0.35, 0.7, n));
  out.lerp(_tc, far * 0.85);
  out.lerp(TCOL.forest, far * smooth(0.62, 0.78, n2) * 0.7);           // manchas de mata
  const rockW = smooth(300, 420, d) * smooth(18, 48, h);
  _tc3.copy(TCOL.rock).lerp(TCOL.rockLt, n);
  out.lerp(_tc3, rockW);
  out.lerp(TCOL.snow, smooth(128, 146, h + (n - 0.5) * 24));
  return out;
}
const fieldWeight = (d, h) => smooth(40, 64, d) * (1 - smooth(220, 310, d)) * (1 - smooth(14, 26, h));

function buildTerrain(groundTex) {
  const SEG = 112, RINGS = 34, RMAX = 662, R0 = 44;
  const radii = [0];
  for (let i = 0; i < RINGS; i++) radii.push(R0 + (RMAX - R0) * Math.pow(i / (RINGS - 1), 1.6));
  // vértices do grid polar
  const V = [];   // [ring][seg] → {x,y,z,r,g,b,f}
  for (let i = 0; i < radii.length; i++) {
    const row = [];
    const segs = i === 0 ? 1 : SEG;
    for (let j = 0; j < segs; j++) {
      const a = (j / SEG) * Math.PI * 2 + (i % 2) * (Math.PI / SEG);   // anéis defasados → triângulos mais bonitos
      const r = radii[i];
      // um pouco de irregularidade nos anéis de fora (silhueta menos "torneada")
      const jr = i > 3 ? (vnoise(j * 0.7, i * 1.3) - 0.5) * (radii[i] - radii[i - 1]) * 0.6 : 0;
      const x = TC.x + Math.sin(a) * (r + jr), z = TC.z + Math.cos(a) * (r + jr);
      const d = Math.hypot(x - TC.x, z - TC.z);
      const y = terrainHeight(x, z);
      terrainColor(x, z, y, d, _tc2);
      row.push({ x, y: d < R0 ? -0.002 : y, z, r: _tc2.r, g: _tc2.g, b: _tc2.b, f: fieldWeight(d, y) });
    }
    V.push(row);
  }
  const pos = [], col = [], fld = [];
  const push = v => { pos.push(v.x, v.y, v.z); col.push(v.r, v.g, v.b); fld.push(v.f); };
  for (let j = 0; j < SEG; j++) { push(V[0][0]); push(V[1][(j + 1) % SEG]); push(V[1][j]); }
  for (let i = 1; i < radii.length - 1; i++) {
    const A = V[i], B = V[i + 1];
    for (let j = 0; j < SEG; j++) {
      const j1 = (j + 1) % SEG;
      // anel i+1 está defasado meio segmento para frente quando i é par
      push(A[j]); push(A[j1]); push(B[j]);
      push(A[j1]); push(B[j1]); push(B[j]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aField', new THREE.Float32BufferAttribute(fld, 1));
  geo.computeVertexNormals();                 // não-indexada → facetado (estilo low-poly)
  // garante winding para cima (normais +Y)
  const nrm = geo.getAttribute('normal');
  let flipped = 0;
  for (let k = 0; k < nrm.count; k += 3) if (nrm.getY(k) < 0) flipped++;
  if (flipped > nrm.count / 6) {
    const p = geo.getAttribute('position').array, c = geo.getAttribute('color').array, f = geo.getAttribute('aField').array;
    for (let k = 0; k < p.length; k += 9) {
      for (let q = 0; q < 3; q++) { const t = p[k + 3 + q]; p[k + 3 + q] = p[k + 6 + q]; p[k + 6 + q] = t; const u = c[k + 3 + q]; c[k + 3 + q] = c[k + 6 + q]; c[k + 6 + q] = u; }
      const kf = k / 3; const t = f[kf + 1]; f[kf + 1] = f[kf + 2]; f[kf + 2] = t;
    }
    geo.computeVertexNormals();
  }
  geo.computeBoundingSphere();

  const fieldCols = [0xe3c35c, 0x9cc955, 0x6fae45, 0xab774b, 0xf0d64e, 0xb7c97a].map(h => new THREE.Color(h));
  const mat = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: RAMP3 });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uGroundTex = { value: groundTex };
    sh.uniforms.uFieldCols = { value: fieldCols };
    sh.uniforms.uHedge = { value: new THREE.Color(0x3d7a35) };
    sh.uniforms.uRoad = { value: new THREE.Color(0xc89c66) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aField;\nvarying float vField;\nvarying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvField = aField;\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uGroundTex;
        uniform vec3 uFieldCols[6];
        uniform vec3 uHedge, uRoad;
        varying float vField;
        varying vec3 vWP;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `
        vec3 base = vColor.rgb;
        vec2 p = vWP.xz;
        // ---- lavouras em patchwork (longe) ----
        vec2 q = vec2(p.x * 0.978 - p.y * 0.208, p.x * 0.208 + p.y * 0.978);
        vec2 cs = vec2(46.0, 34.0);
        vec2 cell = floor(q / cs), f = fract(q / cs);
        float h = h21(cell), h2 = h21(cell + 17.31);
        vec3 fc = uFieldCols[int(h * 5.999)];
        float rc = (h2 > 0.5 ? q.x : q.y) / 1.7;
        float fw = fwidth(rc);
        float stripe = smoothstep(0.3, 0.7, abs(fract(rc) - 0.5) * 2.0);
        fc *= 1.0 - 0.14 * stripe * (1.0 - smoothstep(0.15, 0.5, fw)) * step(0.25, h2);
        fc = mix(fc, base, step(0.84, h) * 0.85);                 // alguns campos viram pasto
        vec2 e2 = min(f, 1.0 - f) * cs;
        float e = min(e2.x, e2.y);
        float we = fwidth(e);
        float hedge = 1.0 - smoothstep(0.8 - we, 1.0 + we, e);
        fc = mix(fc, uHedge, hedge * (1.0 - smoothstep(0.6, 2.5, we)));
        base = mix(base, fc, vField);
        // ---- estrada de terra (continua até longe) ----
        float rz = 27.0 + 0.0022 * p.x * p.x;
        float rd = abs(p.y - rz) / sqrt(1.0 + (0.0044 * p.x) * (0.0044 * p.x));
        float rw = fwidth(rd);
        float road = (1.0 - smoothstep(1.55 - rw, 1.75 + rw, rd)) * (1.0 - smoothstep(280.0, 340.0, length(p - vec2(0.0, 10.0))));
        float rut = 1.0 - smoothstep(0.1, 0.22 + rw, abs(rd - 0.62));
        base = mix(base, uRoad * (1.0 - 0.12 * rut), road);
        // ---- textura pintada perto da casa ----
        vec4 tx = texture2D(uGroundTex, vec2((p.x + 40.0) / 80.0, 1.0 - (p.y + 26.0) / 80.0));
        base = mix(base, tx.rgb, tx.a);
        diffuseColor.rgb *= base;`);
  };
  mat.customProgramCacheKey = () => 'terrainV1';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';
  mesh.frustumCulled = false;
  return mesh;
}

// =============================================================================
// TEXTURA DO CHÃO (canvas 1024² cobrindo 80×80 m): gramado aparado com listras,
// caminhos de terra, terra ciscada do galinheiro, canteiros, sombras falsas (AO)
// =============================================================================
const PAINT = [];   // [fn(ctx, px, pz, k)] — props registram sua "sombra" aqui
function paintGround() {
  const W = GT.PX, k = W / GT.S;
  const px = x => (x - GT.X0) * k, pz = z => (z - GT.Z0) * k;
  return canvasTex(W, W, x => {
    const P = R; R = mulberry32(777);              // pintura com seed própria (não muda o resto)
    const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    const blob = (wx, wz, r, c, a, hard = 0) => {
      const cx = px(wx), cy = pz(wz), rr = r * k;
      const g = x.createRadialGradient(cx, cy, rr * hard, cx, cy, rr);
      g.addColorStop(0, rgba(c, a)); g.addColorStop(1, rgba(c, 0));
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, rr, 0, 6.2832); x.fill();
    };
    const softPoly = (pts, c, a, blurM) => {
      x.save(); x.shadowColor = rgba(c, a); x.shadowBlur = blurM * k; x.shadowOffsetX = 3000; x.fillStyle = '#000';
      x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(px(p[0]) - 3000, pz(p[1])) : x.moveTo(px(p[0]) - 3000, pz(p[1]))));
      x.closePath(); x.fill(); x.restore();
    };
    const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    const MEADOW = [139, 187, 83], LAWN = [126, 190, 76], LAWN_LT = [146, 202, 92], LAWN_DK = [104, 168, 63];
    const DRY = [170, 196, 99], DIRT = [200, 158, 102], DIRT_DK = [165, 124, 76], DIRT_LT = [218, 182, 124];
    const SOIL = [112, 76, 50], SOIL_DK = [88, 58, 38], AO = [40, 70, 30];

    // 1) prado base + manchas
    x.fillStyle = rgba(MEADOW, 1); x.fillRect(0, 0, W, W);
    for (let i = 0; i < 1400; i++) blob(rnd(-40, 40), rnd(-26, 54), rnd(0.6, 4.5), pick([DRY, LAWN_DK, [125, 176, 74], [156, 200, 96]]), rnd(0.08, 0.22));
    // 2) gramado do quintal (aparado) + listras de cortador
    softPoly(rect(-9.6, -3.8, 9.6, 18.6), LAWN, 0.9, 0.4);
    for (let z = -3.8, i = 0; z < 18.6; z += 1.4, i++) {
      x.fillStyle = i % 2 ? 'rgba(255,255,230,0.045)' : 'rgba(20,60,10,0.04)';
      x.fillRect(px(-9.6), pz(z), 19.2 * k, 1.4 * k);
    }
    for (let i = 0; i < 260; i++) blob(rnd(-9.4, 9.4), rnd(-3.6, 18.4), rnd(0.4, 1.8), pick([LAWN_LT, LAWN_DK, LAWN]), rnd(0.08, 0.2));
    // 3) pontilhado fino (textura de grama de perto)
    for (let i = 0; i < 26000; i++) {
      x.fillStyle = R() < 0.5 ? 'rgba(220,255,160,0.22)' : 'rgba(40,80,20,0.2)';
      x.fillRect(R() * W, R() * W, 1.3, 1.3);
    }
    // 4) caminho: rampa → portão → estrada (terra batida com borda escura)
    const pathX = z => 0.42 * Math.sin((z - 1.7) * 0.33);
    for (const [c, r, a] of [[DIRT_DK, 0.82, 0.55], [DIRT, 0.62, 0.9], [DIRT_LT, 0.3, 0.35]])
      for (let z = 1.5; z <= roadZ(0); z += 0.12) blob(pathX(z) + rnd(-0.05, 0.05), z, r * rnd(0.9, 1.1), c, a, 0.55);
    // ramal até o galinheiro
    for (let t = 0; t <= 1; t += 0.012) {
      const zx = lerp(pathX(8.5), -6.2, t), zz = lerp(8.5, 11.3, t) - Math.sin(t * Math.PI) * 0.8;
      blob(zx, zz, 0.55, DIRT_DK, 0.4, 0.5); blob(zx, zz, 0.4, DIRT, 0.75, 0.5);
    }
    // 5) terra ciscada em volta do galinheiro + manchas peladas
    for (let i = 0; i < 70; i++) { const a = rnd(0, 6.28), r = rnd(0, 2.1); blob(-6.8 + Math.cos(a) * r, 12.6 + Math.sin(a) * r * 0.8, rnd(0.4, 0.9), pick([DIRT, DIRT_DK, DIRT_LT]), rnd(0.25, 0.5), 0.3); }
    for (const [bx, bz, br] of [[4.6, 6.2, 0.7], [-3.4, 15.2, 0.6], [6.8, 11.5, 0.5], [-2.6, 4.6, 0.45], [3.2, 15.8, 0.5]]) {
      for (let i = 0; i < 6; i++) blob(bx + rnd(-br, br) * 0.6, bz + rnd(-br, br) * 0.6, br * rnd(0.5, 0.9), pick([DIRT, DIRT_DK]), rnd(0.3, 0.5), 0.3);
    }
    // pedrinhas no caminho
    for (let i = 0; i < 160; i++) { const z = rnd(1.8, 26); blob(pathX(z) + rnd(-0.6, 0.6), z, rnd(0.03, 0.07), [235, 225, 205], 0.8, 0.6); }
    // 6) canteiros na frente da varanda + base da casa
    for (const s of [-1, 1]) softPoly(rect(s * 1.45, 0.52, s * 3.98, 1.2), SOIL, 0.95, 0.12);
    // 7) estrada (mesma curva do shader)
    const roadPath = (off) => { x.beginPath(); for (let xx = -42; xx <= 42; xx += 1) { const zz = roadZ(xx) + off; xx === -42 ? x.moveTo(px(xx), pz(zz)) : x.lineTo(px(xx), pz(zz)); } };
    x.lineCap = 'round';
    roadPath(0); x.strokeStyle = rgba(DIRT_DK, 0.7); x.lineWidth = 3.9 * k; x.stroke();
    roadPath(0); x.strokeStyle = rgba([200, 156, 102], 1); x.lineWidth = 3.3 * k; x.stroke();
    for (const o of [-0.62, 0.62]) { roadPath(o); x.strokeStyle = rgba(DIRT_DK, 0.35); x.lineWidth = 0.32 * k; x.stroke(); }
    roadPath(0); x.strokeStyle = rgba([140, 170, 80], 0.35); x.lineWidth = 0.28 * k; x.stroke();
    // 8) sombras/AO e manchas registradas pelos props (casa, celeiro, árvores...)
    for (const fn of PAINT) fn({ x, px, pz, k, blob, softPoly, rect, rgba, AO, SOIL, SOIL_DK, DIRT, DIRT_DK, DIRT_LT, LAWN_DK });
    // AO da cerca do quintal
    for (const seg of [[-9.6, 18.6, 9.6, 18.6], [-9.6, -3.8, -9.6, 18.6], [9.6, -3.8, 9.6, 18.6], [5.4, -3.8, 9.6, -3.8], [-9.6, -3.8, -5.4, -3.8]]) {
      x.save(); x.strokeStyle = rgba(AO, 0.22); x.lineWidth = 0.55 * k; x.filter = 'none';
      x.beginPath(); x.moveTo(px(seg[0]), pz(seg[1])); x.lineTo(px(seg[2]), pz(seg[3])); x.stroke(); x.restore();
    }
    // 9) florzinhas pintadas no prado (detalhe barato de longe)
    for (let i = 0; i < 2200; i++) {
      const wx = rnd(-40, 40), wz = rnd(-26, 54);
      if (Math.abs(wx) < 9.8 && wz > -4 && wz < 18.8) continue;
      x.fillStyle = pick(['rgba(255,255,255,0.8)', 'rgba(255,214,70,0.8)', 'rgba(255,120,150,0.7)', 'rgba(190,140,255,0.7)']);
      x.fillRect(px(wx), pz(wz), 2, 2);
    }
    // 10) bordas da textura somem suavemente (o shader do terreno assume o resto)
    x.globalCompositeOperation = 'destination-in';
    let g = x.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.07, 'rgba(0,0,0,1)'); g.addColorStop(0.93, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, W, W);
    g = x.createLinearGradient(0, 0, 0, W);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.07, 'rgba(0,0,0,1)'); g.addColorStop(0.93, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, W, W);
    x.globalCompositeOperation = 'source-over';
    R = P;
  }, { aniso: Math.min(8, renderer.capabilities.getMaxAnisotropy()) });
}

// =============================================================================
// CASA + VARANDA
// =============================================================================
/** Janela numa parede. (x,y,z) = centro na face; ry: 0 → olha para +Z. */
function windowAt(root, x, y, z, ry, w, h, o = {}) {
  const wg = grp(root, x, y, z, ry);
  const T = o.trim !== undefined ? o.trim : C.white;
  box(wg, w + 0.18, h + 0.18, 0.06, T, 0, 0, 0.03);
  kind(box(wg, w, h, 0.04, o.tint !== undefined ? o.tint : 0xffffff, 0, 0, 0.055), 'glass');
  box(wg, 0.05, h, 0.03, T, 0, 0, 0.085);
  box(wg, w, 0.05, 0.03, T, 0, h * 0.08, 0.085);
  box(wg, w + 0.34, 0.07, 0.16, T, 0, -h / 2 - 0.12, 0.08);      // peitoril
  box(wg, w + 0.3, 0.12, 0.09, T, 0, h / 2 + 0.14, 0.045);       // verga
  if (o.shutters) for (const s of [-1, 1]) {
    const sx = s * (w / 2 + 0.1 + w * 0.21);
    box(wg, w * 0.42, h + 0.08, 0.05, o.shutters, sx, 0, 0.035);
    box(wg, w * 0.3, h * 0.36, 0.02, C.shutterDk, sx, h * 0.22, 0.065);
    box(wg, w * 0.3, h * 0.36, 0.02, C.shutterDk, sx, -h * 0.22, 0.065);
  }
  if (o.flowerBox) {
    box(wg, w + 0.2, 0.2, 0.22, o.flowerBox, 0, -h / 2 - 0.27, 0.17);
    for (let i = 0; i < 7; i++) kind(sph(wg, rnd(0.07, 0.1), pick([0xff6b8a, 0xffd23f, 0xffffff, 0xff8a3d]), -w / 2 + 0.05 + i * (w - 0.1) / 6, -h / 2 - 0.12 + rnd(0, 0.05), 0.2 + rnd(-0.04, 0.04), 6, 5), 'smooth');
    for (let i = 0; i < 5; i++) kind(sph(wg, 0.1, C.leaf[1], -w / 2 + 0.1 + i * (w - 0.2) / 4, -h / 2 - 0.16, 0.14, 6, 4), 'smooth');
  }
  if (o.glow) glowAt(wg, 0, 0, 0.35, Math.max(w, h) * 0.62, 0xffb45a, G_WIN, 0.42);
  return wg;
}

function buildHouse(S) {
  const P = PORCH_Y;
  const H = grp(S);
  // ---- corpo (prisma com a empena), cumeeira ao longo de X ----
  const body = prism(H, [[-3.9, 0], [3.9, 0], [3.9, 6.6], [0, 9.55], [-3.9, 6.6]], 10.8, C.siding);
  body.rotation.y = Math.PI / 2; body.position.set(0, 0, -7.5);
  box(H, 11.0, 0.5, 8.0, C.stone, 0, 0.25, -7.5);                       // fundação de pedra
  for (const [sx, sz] of [[-5.42, -3.62], [5.42, -3.62], [-5.42, -11.38], [5.42, -11.38]]) box(H, 0.2, 6.6, 0.2, C.white, sx, 3.3, sz);
  for (const sx of [-1, 1]) box(H, 0.06, 0.16, 7.9, C.white, sx * 5.43, 3.55, -7.5);   // faixa entre andares (laterais)
  box(H, 10.9, 0.16, 0.06, C.white, 0, 3.55, -11.43);
  // linhas do siding (horizontais) — frente (inclui a parte sob a varanda), laterais e fundos
  for (let y = 0.75; y < 6.5; y += 0.34) {
    box(H, 10.8, 0.035, 0.03, C.sidingLn, 0, y, -3.585);
    box(H, 10.8, 0.035, 0.03, C.sidingLn, 0, y, -11.415);
    for (const sx of [-1, 1]) box(H, 0.03, 0.035, 7.8, C.sidingLn, sx * 5.415, y, -7.5);
  }
  for (const sx of [-1, 1]) for (let y = 6.85; y < 9.2; y += 0.34) {   // empenas laterais
    const half = 3.9 * (1 - (y - 6.6) / 2.95);
    box(H, 0.03, 0.035, half * 2 - 0.2, C.sidingLn, sx * 5.415, y, -7.5);
  }
  // ---- telhado principal ----
  const RG = grp(H, 0, 0, -7.5, Math.PI / 2);      // local X = -Z do mundo; profundidade local Z = X do mundo
  for (const s of [-1, 1]) {
    slab(RG, s * 3.9, 6.6, 0, 9.55, 11.7, 0.18, C.roof, 0.55, 0.05);
    // ripas da telha metálica (standing seam) na água da frente/fundos
    for (let xw = -5.6; xw <= 5.61; xw += 0.55) {
      const r = slab(RG, s * 3.9, 6.6, 0, 9.55, 0.05, 0.25, C.roofRib, 0.5, 0.0, xw);
      r.scale.y = 1;
    }
  }
  box(RG, 0.36, 0.14, 11.8, C.roofDk, 0, 9.72, 0);                     // cumeeira
  // beirais brancos (fascia) nas empenas
  for (const sx of [-1, 1]) for (const s of [-1, 1]) slab(RG, s * 4.45, 6.18, 0, 9.65, 0.12, 0.2, C.white, 0, 0, sx * 5.86);
  // ---- empena frontal (cross gable) acima da varanda ----
  prism(H, [[-2.0, 0], [2.0, 0], [0, 2.05]], 0.4, C.siding, 0, 6.6, -3.75);
  const CG = grp(H, 0, 0, -3.55);
  for (const s of [-1, 1]) slab(CG, s * 2.0, 6.6, 0, 8.65, 3.6, 0.16, C.roof, 0.45, 0.05, -1.55);
  for (const s of [-1, 1]) slab(CG, s * 2.45, 6.13, 0, 8.72, 0.1, 0.18, C.white, 0, 0, 0.27);
  box(CG, 0.3, 0.12, 3.7, C.roofDk, 0, 8.8, -1.55);
  // janela redonda do sótão
  { const wg = grp(H, 0, 7.45, -3.52);
    const fr = cyl(wg, 0.42, 0.42, 0.08, 14, C.white, 0, 0, 0); fr.rotation.x = Math.PI / 2;
    const gl = kind(cyl(wg, 0.32, 0.32, 0.06, 14, 0xffffff, 0, 0, 0.03), 'glass'); gl.rotation.x = Math.PI / 2;
    box(wg, 0.64, 0.05, 0.04, C.white, 0, 0, 0.07); box(wg, 0.05, 0.64, 0.04, C.white, 0, 0, 0.07);
    glowAt(wg, 0, 0, 0.4, 0.6, 0xffb45a, G_WIN, 0.45);
  }
  // ---- janelas ----
  for (const sx of [-1, 1]) {
    windowAt(H, sx * 2.55, P + 1.5, -3.6, 0, 1.05, 1.35, { shutters: C.shutter, flowerBox: C.white, glow: true });       // térreo (sob a varanda)
    windowAt(H, sx * 3.15, 5.05, -3.6, 0, 0.95, 1.25, { shutters: C.shutter, glow: true });                              // 1º andar
    for (const z of [-5.9, -9.1]) {
      windowAt(H, sx * 5.4, P + 1.5, z, sx * Math.PI / 2, 0.95, 1.3, { glow: true });
      windowAt(H, sx * 5.4, 5.05, z, sx * Math.PI / 2, 0.9, 1.2, { glow: true });
    }
  }
  for (const wx of [-3.2, 0, 3.2]) {
    windowAt(H, wx, P + 1.5, -11.4, Math.PI, 0.95, 1.3, { glow: wx !== 0, shutters: C.shutter });
    windowAt(H, wx, 5.05, -11.4, Math.PI, 0.9, 1.2, { glow: wx === 0 });
  }
  // ---- porta da frente ----
  { const D = grp(H, 0, P, -3.6);
    box(D, 1.3, 2.42, 0.08, C.white, 0, 1.2, 0.04);
    box(D, 1.02, 2.2, 0.07, C.door, 0, 1.1, 0.08);
    kind(box(D, 0.62, 0.62, 0.03, 0xffffff, 0, 1.68, 0.12), 'glass');
    box(D, 0.05, 0.62, 0.02, C.white, 0, 1.68, 0.14); box(D, 0.62, 0.05, 0.02, C.white, 0, 1.68, 0.14);
    for (const sx of [-1, 1]) box(D, 0.32, 0.62, 0.02, 0x9e3232, sx * 0.2, 0.55, 0.12);
    sph(D, 0.045, C.gold, 0.38, 1.05, 0.15, 8, 6);
    box(D, 1.5, 0.12, 0.3, C.white, 0, 2.48, 0.12);                   // cornija
    glowAt(D, 0, 1.68, 0.4, 0.5, 0xffb45a, G_WIN, 0.4);
    // capacho
    box(D, 1.0, 0.012, 0.6, 0xa4553a, 0, 0.006, 0.55);
    box(D, 0.84, 0.014, 0.44, 0xb86a48, 0, 0.007, 0.55);
    // arandelas dos lados da porta
    for (const sx of [-1, 1]) {
      const L = grp(D, sx * 0.95, 1.95, 0.0);
      box(L, 0.12, 0.2, 0.06, C.iron, 0, 0, 0.03);
      box(L, 0.04, 0.04, 0.14, C.iron, 0, 0, 0.1);
      kind(box(L, 0.12, 0.18, 0.12, 0xffe2a0, 0, -0.02, 0.2), 'glass');
      cone(L, 0.11, 0.1, 4, C.iron, 0, 0.12, 0.2).rotation.y = Math.PI / 4;
      glowAt(L, 0, -0.02, 0.22, 0.28, 0xffc46b, G_LAMP, 1.0);
      glowAt(L, 0, -0.02, 0.22, 0.8, 0xff9c45, G_LAMP, 0.28);
    }
  }
  // ---- chaminé (água de trás) ----
  box(H, 0.95, 5.6, 0.95, C.brick, 3.6, 8.2, -9.3);
  box(H, 1.12, 0.22, 1.12, C.brickDk, 3.6, 11.0, -9.3);
  for (let y = 9.6; y < 10.9; y += 0.36) box(H, 0.97, 0.03, 0.97, C.brickDk, 3.6, y, -9.3);
  // ---- varanda dos fundos? não: só um degrau na porta de trás ----
  box(H, 1.2, 2.2, 0.06, C.door, 0, P + 1.1, -11.44);
  box(H, 1.6, 0.4, 0.8, C.stone, 0, 0.2, -11.8);

  PAINT.push(({ softPoly, rect, AO }) => {
    softPoly(rect(-5.6, -11.7, 5.6, -3.5), AO, 0.55, 1.2);
    softPoly(rect(-4.1, -3.7, 4.1, 0.62), AO, 0.45, 0.5);
  });
}

function buildPorch(S, SM) {
  const P = PORCH_Y;
  const V = grp(S);
  // ---- piso: base + tábuas ----
  box(V, 7.92, P - 0.03, 4.1, C.woodDk, 0, (P - 0.03) / 2, -1.55);
  let i = 0;
  for (let x = -3.96 + 0.075; x < 3.96; x += 0.152, i++) {
    const m = box(V, 0.146, 0.03, 4.1, C.wood[i % 3], x, P - 0.015, -1.55);
    m.userData.c = new THREE.Color(C.wood[i % 3]).offsetHSL(0, 0, rnd(-0.03, 0.03)).getHex();
  }
  // fáscia branca em volta do piso + saia de treliça
  box(V, 8.0, 0.14, 0.05, C.white, 0, P - 0.07, 0.525);
  for (const s of [-1, 1]) box(V, 0.05, 0.14, 4.12, C.white, s * 3.985, P - 0.07, -1.55);
  for (const s of [-1, 1]) {
    box(V, 2.6, 0.24, 0.03, 0x5e6b58, s * 2.66, 0.13, 0.515);
    for (let x = 1.45; x < 3.9; x += 0.22) {
      beam(V, [s * x, 0.02, 0.53], [s * (x + 0.2), 0.25, 0.53], 0.025, C.white);
      beam(V, [s * (x + 0.2), 0.02, 0.535], [s * x, 0.25, 0.535], 0.025, C.white);
    }
  }
  // ---- rampa (sem corrimão lateral — cair da rampa é feature) ----
  { const th = Math.atan2(P, 1.2), L = Math.hypot(1.2, P), t = 0.08;
    const r = box(V, 2.7, t, L, C.wood[0], 0, P / 2 - (t / 2) * Math.cos(th), 1.1 - (t / 2) * Math.sin(th));
    r.rotation.x = th;
    for (let k = 0; k < 6; k++) {
      const zz = 0.6 + k * 0.2, yy = P * (1 - (zz - 0.5) / 1.2) + 0.006;
      const c = box(V, 2.6, 0.018, 0.05, C.woodMid, 0, yy, zz); c.rotation.x = th;
    }
    for (const s of [-1, 1]) prism(V, [[0, 0], [0, P], [1.2, 0]], 0.04, C.white, s * 1.33, 0, 0.5).rotation.y = -Math.PI / 2;
  }
  // ---- colunas torneadas nas quinas da frente ----
  const colPts = [[0.12, 0], [0.12, 0.14], [0.085, 0.2], [0.075, 0.36], [0.068, 2.25], [0.085, 2.38], [0.1, 2.44], [0.1, 2.62]];
  for (const s of [-1, 1]) kind(lathe(V, colPts, 10, C.white, s * 3.9, P, 0.45), 'smooth');
  // ---- guarda-corpo (frente com vão da rampa + laterais) ----
  const RAILC = C.white;
  for (const s of [-1, 1]) {
    // frente: de |x|=1.35 até a coluna
    box(V, 2.55, 0.055, 0.12, RAILC, s * 2.64, P + 0.85 - 0.028, 0.5);
    box(V, 2.55, 0.06, 0.07, RAILC, s * 2.64, P + 0.12, 0.5);
    for (let x = 1.5; x < 3.8; x += 0.13) box(V, 0.045, 0.68, 0.045, RAILC, s * x, P + 0.49, 0.5);
    box(V, 0.13, 0.95, 0.13, RAILC, s * 1.35, P + 0.475, 0.5);          // pilarete
    box(V, 0.18, 0.045, 0.18, RAILC, s * 1.35, P + 0.97, 0.5);
    cone(V, 0.09, 0.1, 4, RAILC, s * 1.35, P + 1.04, 0.5).rotation.y = Math.PI / 4;
    // lateral
    box(V, 0.12, 0.055, 4.0, RAILC, s * 3.96, P + 0.85 - 0.028, -1.58);
    box(V, 0.07, 0.06, 4.0, RAILC, s * 3.96, P + 0.12, -1.58);
    for (let z = -3.45; z < 0.35; z += 0.13) box(V, 0.045, 0.68, 0.045, RAILC, s * 3.96, P + 0.49, z);
  }
  // ---- telhado da varanda (água única), forro "haint blue", viga frontal ----
  const yBack = 3.85, yFront = 3.35, zB = -3.6, zF = 0.78;
  const RG = grp(V, 0, 0, 0, Math.PI / 2);   // local X = -Z mundo
  slab(RG, -zB, yBack, -zF, yFront, 8.5, 0.12, C.roof, 0, 0.0);
  for (let xw = -4.0; xw <= 4.01; xw += 0.5) slab(RG, -zB, yBack + 0.1, -zF, yFront + 0.1, 0.05, 0.05, C.roofRib, 0, 0, xw);
  slab(RG, -zB, yBack - 0.1, -zF + 0.25, yFront - 0.07, 8.1, 0.04, C.ceil, 0, 0);    // forro
  box(V, 8.5, 0.22, 0.06, C.white, 0, yFront - 0.02, zF + 0.02);                     // testeira (beiral)
  box(V, 8.2, 0.24, 0.18, C.white, 0, P + 2.62 + 0.12, 0.45);                        // viga sobre as colunas
  for (let x = -3.5; x <= 3.51; x += 1.0) slab(RG, -zB, yBack - 0.18, -0.45, yFront - 0.02, 0.07, 0.1, C.white, 0, 0, x); // caibros brancos
  box(V, 8.2, 0.12, 0.12, C.white, 0, yBack - 0.15, -3.53);                          // tábua junto à parede
  // ---- lampião pendurado (frente-direita) ----
  { const L = grp(V, LANTERN_POS.x, LANTERN_POS.y, LANTERN_POS.z);
    beam(L, [0, 0.16, 0], [0, 0.53, 0], 0.015, C.iron);
    box(L, 0.2, 0.03, 0.2, C.iron, 0, 0.14, 0);
    cone(L, 0.15, 0.13, 4, C.iron, 0, 0.21, 0).rotation.y = Math.PI / 4;
    kind(box(L, 0.15, 0.22, 0.15, 0xffe1a0, 0, 0, 0), 'glass');
    for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(L, 0.02, 0.24, 0.02, C.iron, cx * 0.08, 0, cz * 0.08);
    box(L, 0.18, 0.03, 0.18, C.iron, 0, -0.125, 0);
    glowAt(L, 0, 0, 0, 0.32, 0xffd27a, G_LAMP, 1.0);
    glowAt(L, 0, 0, 0, 1.25, 0xff9c45, G_LAMP, 0.32);
  }
  // poça de luz no piso da varanda e na grama à frente
  GLOWS.push({ x: LANTERN_POS.x + 0.2, y: P + 0.012, z: LANTERN_POS.z - 0.7, size: 1.9, color: new THREE.Color(0xffa64d).multiplyScalar(0.22), kind: G_POOL, phase: 0 });
  GLOWS.push({ x: LANTERN_POS.x + 0.1, y: 0.03, z: LANTERN_POS.z + 1.6, size: 1.7, color: new THREE.Color(0xffa64d).multiplyScalar(0.12), kind: G_POOL, phase: 0 });
  GLOWS.push({ x: 0, y: P + 0.012, z: -3.1, size: 1.6, color: new THREE.Color(0xffa64d).multiplyScalar(0.16), kind: G_POOL, phase: 0 });
  // ---- vaso pendurado (frente-esquerda), equilibra o lampião ----
  { const L = grp(SM, -LANTERN_POS.x, 2.72, LANTERN_POS.z);
    for (const a of [0, 2.1, 4.2]) beam(L, [Math.cos(a) * 0.14, 0.12, Math.sin(a) * 0.14], [0, 0.6, 0], 0.01, C.iron);
    cyl(L, 0.17, 0.12, 0.16, 10, C.terracotta, 0, 0.04, 0);
    for (let k = 0; k < 9; k++) {
      const a = k * 0.7, r = rnd(0.05, 0.16);
      const b = sph(L, rnd(0.07, 0.11), pick([C.leaf[1], C.leaf[2], C.leafLt]), Math.cos(a) * r, 0.14 + rnd(-0.03, 0.06), Math.sin(a) * r, 6, 5);
      b.scale.y = 0.8;
    }
    for (let k = 0; k < 6; k++) { const a = k * 1.05 + 0.3; const c = cone(L, 0.05, 0.38, 5, C.leaf[0], Math.cos(a) * 0.15, -0.08, Math.sin(a) * 0.15); c.rotation.x = Math.PI + Math.sin(a) * 0.4; c.rotation.z = -Math.cos(a) * 0.4; }
    for (let k = 0; k < 5; k++) sph(L, 0.04, pick([0xff6b8a, 0xffffff, 0xffd23f]), rnd(-0.14, 0.14), 0.2, rnd(-0.14, 0.14), 6, 4);
  }
  // ---- canteiros na frente da varanda: hortênsias ----
  for (const s of [-1, 1]) {
    box(V, 2.5, 0.06, 0.04, C.stoneDk, s * 2.68, 0.03, 1.2);
    for (const bx of [1.85, 2.65, 3.45]) {
      const B = grp(SM, s * (bx + rnd(-0.08, 0.08)), 0, 0.86 + rnd(-0.05, 0.05));
      const sc = rnd(0.85, 1.1);
      for (let k = 0; k < 4; k++) sph(B, 0.2 * sc, pick(C.leaf), rnd(-0.14, 0.14), 0.2 * sc + rnd(0, 0.08), rnd(-0.1, 0.1), 7, 5);
      const hc = pick([[0x8fb8ff, 0xb3cdff], [0xff9ccf, 0xffc2e0], [0xc9a6ff, 0xe0ccff], [0xffffff, 0xf0f0ff]]);
      for (let k = 0; k < 6; k++) sph(B, rnd(0.08, 0.11) * sc, pick(hc), rnd(-0.2, 0.2), 0.36 * sc + rnd(0, 0.1), rnd(-0.14, 0.18), 6, 4);
    }
  }
  // ---- abóboras e vasos na varanda (encostados na parede, fora do caminho) ----
  pumpkin(SM, 0.82, P, -3.32, 0.17); pumpkin(SM, 1.12, P, -3.3, 0.12);
  pumpkin(SM, -0.82, P, -3.32, 0.15);
  for (const sx of [-3.62, 3.62]) {
    cyl(SM, 0.2, 0.15, 0.34, 10, C.terracotta, sx, P + 0.17, -3.3);
    for (let k = 0; k < 6; k++) sph(SM, rnd(0.12, 0.17), pick(C.leaf), sx + rnd(-0.12, 0.12), P + 0.45 + rnd(0, 0.18), -3.3 + rnd(-0.1, 0.1), 7, 5);
  }
  // banco de madeira sob a janela da esquerda (+X)
  { const B = grp(V, 2.55, P, -3.38);
    box(B, 1.3, 0.06, 0.36, C.woodMid, 0, 0.44, 0);
    for (const sx of [-0.55, 0.55]) box(B, 0.07, 0.44, 0.3, C.woodDk, sx, 0.22, 0);
    box(B, 1.3, 0.3, 0.05, C.woodMid, 0, 0.72, -0.17);
  }
  // galões de leite (direita, -X)
  for (const [mx, mz] of [[-2.1, -3.32], [-1.78, -3.36]]) {
    cyl(SM, 0.13, 0.15, 0.42, 10, C.metal, mx, P + 0.21, mz);
    cyl(SM, 0.08, 0.13, 0.12, 10, C.metal, mx, P + 0.48, mz);
    cyl(SM, 0.09, 0.09, 0.06, 10, C.metalDk, mx, P + 0.56, mz);
  }
}

// =============================================================================
// CERCA (piquetes de madeira) — corrida entre dois pontos, com portão opcional
// =============================================================================
const PICKET_GEO = shapeGeo([[-0.045, 0], [0.045, 0], [0.045, 0.96], [0, 1.06], [-0.045, 0.96]], 0.026);
function fenceRun(S, x0, z0, x1, z1, gate = null) {
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
  const F = grp(S, x0, 0, z0, -Math.atan2(dz, dx));   // local +X corre ao longo da cerca
  const n = Math.ceil(L / 2.4), posts = [];
  for (let i = 0; i <= n; i++) posts.push(i * L / n);
  if (gate) { posts.push(gate[0], gate[1]); }
  for (const u of posts) {
    const tall = gate && (Math.abs(u - gate[0]) < 0.01 || Math.abs(u - gate[1]) < 0.01);
    const h = tall ? 1.42 : 1.2;
    box(F, 0.13, h, 0.13, C.post, u, h / 2, 0);
    if (tall) kind(sph(F, 0.09, C.postCap, u, h + 0.07, 0, 8, 6), 'smooth');
    else cone(F, 0.1, 0.12, 4, C.postCap, u, h + 0.06, 0).rotation.y = Math.PI / 4;
  }
  const inGate = u => gate && u > gate[0] - 0.08 && u < gate[1] + 0.08;
  // travessas (lado de dentro do quintal = local -Z na maioria das corridas)
  for (const y of [0.34, 0.84]) {
    if (!gate) box(F, L, 0.085, 0.045, C.post, L / 2, y, -0.075);
    else {
      box(F, gate[0], 0.085, 0.045, C.post, gate[0] / 2, y, -0.075);
      box(F, L - gate[1], 0.085, 0.045, C.post, (gate[1] + L) / 2, y, -0.075);
    }
  }
  for (let u = 0.16; u < L - 0.1; u += 0.19) {
    if (posts.some(p => Math.abs(p - u) < 0.11) || inGate(u)) continue;
    const m = add(F, PICKET_GEO, C.picket, u, 0.04, 0);
    m.userData.c = new THREE.Color(C.picket).offsetHSL(0, 0, rnd(-0.04, 0.02)).getHex();
    m.scale.y = rnd(0.96, 1.03); m.rotation.z = rnd(-0.025, 0.025);
  }
  if (gate) {   // portão (fechado): piquetes mais baixos + travessas em Z
    const g0 = gate[0] + 0.1, g1 = gate[1] - 0.1, gw = g1 - g0;
    for (let u = g0 + 0.05; u < g1; u += 0.17) add(F, PICKET_GEO, C.picket, u, 0.1, 0).scale.y = 0.92;
    box(F, gw, 0.1, 0.04, C.post, (g0 + g1) / 2, 0.3, -0.05);
    box(F, gw, 0.1, 0.04, C.post, (g0 + g1) / 2, 0.86, -0.05);
    beam(F, [g0 + 0.05, 0.3, -0.06], [g1 - 0.05, 0.86, -0.06], 0.06, C.post);
  }
}
function buildFences(S) {
  fenceRun(S, -9.6, 18.6, 9.6, 18.6, [8.6, 10.6]);     // frente, com portão central
  fenceRun(S, 9.6, 18.6, 9.6, -3.8);                    // lateral esquerda (+X)
  fenceRun(S, -9.6, -3.8, -9.6, 18.6);                  // lateral direita (-X)
  fenceRun(S, 9.6, -3.8, 5.42, -3.8);                   // volta até a casa
  fenceRun(S, -5.42, -3.8, -9.6, -3.8);
}

// =============================================================================
// GALINHEIRO (dentro do quintal), FENO
// =============================================================================
function buildCoop(S, SM) {
  const G = grp(S, -6.8, 0, 13.15);          // porta/rampa viradas para a varanda (-Z)
  for (const [sx, sz] of [[-0.58, -0.72], [0.58, -0.72], [-0.58, 0.72], [0.58, 0.72]]) box(G, 0.09, 0.55, 0.09, C.woodDk, sx, 0.27, sz);
  const body = prism(G, [[-0.66, 0], [0.66, 0], [0.66, 0.85], [0, 1.38], [-0.66, 0.85]], 1.6, C.coop, 0, 0.5, 0);
  body.userData.c = C.coop;
  for (const [sx, sz] of [[-0.67, -0.81], [0.67, -0.81], [-0.67, 0.81], [0.67, 0.81]]) box(G, 0.07, 0.86, 0.07, C.white, sx, 0.93, sz);
  for (let y = 0.68; y < 1.32; y += 0.16) for (const sx of [-1, 1]) box(G, 0.02, 0.02, 1.6, 0xdcaa3c, sx * 0.665, y, 0);
  for (const s of [-1, 1]) slab(G, s * 0.66, 1.35, 0, 1.88, 1.95, 0.07, C.coopRoof, 0.2, 0.04);
  box(G, 0.12, 0.07, 1.98, 0xa73a30, 0, 1.92, 0);
  // porta + rampinha com travessas
  box(G, 0.46, 0.5, 0.03, C.white, 0.18, 0.82, -0.815);
  box(G, 0.36, 0.42, 0.03, 0x3b2a1e, 0.18, 0.8, -0.83);
  const vent = cyl(G, 0.1, 0.1, 0.03, 10, 0x3b2a1e, 0, 1.58, -0.82); vent.rotation.x = Math.PI / 2;
  const vr = cyl(G, 0.13, 0.13, 0.025, 10, C.white, 0, 1.58, -0.81); vr.rotation.x = Math.PI / 2;
  { const th = Math.atan2(0.52, 0.75), L = Math.hypot(0.52, 0.75);
    const r = box(G, 0.36, 0.04, L, C.woodMid, 0.18, 0.25, -0.81 - 0.375); r.rotation.x = -th;
    for (let k = 0; k < 4; k++) { const zz = -0.9 - k * 0.17, yy = 0.5 - (-0.81 - zz) * (0.52 / 0.75) + 0.02; const c = box(G, 0.36, 0.025, 0.03, C.woodDk, 0.18, yy, zz); c.rotation.x = -th; }
  }
  // caixa de ninhos do lado (+X, para o centro do quintal)
  box(G, 0.34, 0.42, 1.0, C.coop, 0.83, 0.8, 0.1);
  slab(G, 1.02, 0.98, 0.66, 1.12, 1.08, 0.05, C.coopRoof, 0.03, 0, 0.1);
  // palha saindo da porta
  for (let k = 0; k < 4; k++) cone(G, 0.03, 0.12, 4, C.hay, 0.1 + k * 0.05, 0.6, -0.84).rotation.x = -1.2;
  PAINT.push(({ softPoly, rect, AO }) => softPoly(rect(-7.6, 12.2, -5.9, 14.1), AO, 0.4, 0.4));
  // fardos dentro do quintal (obstáculos)
  roundBale(SM, 7.55, 17.5, 0, 0.62, 1.12);
  squareBale(S, -8.4, 17.45, 0, 0); squareBale(S, -7.85, 17.45, 0, 0.05); squareBale(S, -8.12, 17.45, 0.46, -0.04);
  // forcado encostado
  { const F = grp(S, -7.45, 0, 17.2, 0.3);
    const h = beam(F, [0, 0, 0], [0.25, 1.45, 0.1], 0.035, C.woodMid); h.userData.c = C.woodMid;
    for (let k = -1; k <= 1; k++) beam(F, [0.25 + k * 0.05, 1.45, 0.1], [0.27 + k * 0.06, 1.75, 0.11], 0.015, C.iron);
  }
  PAINT.push(({ blob, AO }) => { blob(7.55, 17.5, 1.1, AO, 0.35); blob(-8.12, 17.45, 1.0, AO, 0.3); });
}
function roundBale(SM, x, z, ry, r = 0.62, len = 1.1) {
  const B = grp(SM, x, r, z, ry);
  const c = cyl(B, r, r, len, 16, C.hay, 0, 0, 0); c.rotation.z = Math.PI / 2;
  for (const s of [-1, 1]) {
    const e = cyl(B, r * 0.82, r * 0.82, 0.02, 14, C.hayLt, s * len / 2, 0, 0); e.rotation.z = Math.PI / 2;
    const e2 = cyl(B, r * 0.45, r * 0.45, 0.025, 12, C.hayDk, s * len / 2, 0, 0); e2.rotation.z = Math.PI / 2;
  }
  for (const s of [-0.3, 0.3]) { const t = cyl(B, r + 0.01, r + 0.01, 0.04, 16, 0xb88d33, s * len, 0, 0); t.rotation.z = Math.PI / 2; }
}
function squareBale(S, x, z, y = 0, ry = 0) {
  const B = grp(S, x, y, z, ry);
  box(B, 0.55, 0.45, 0.9, C.hay, 0, 0.225, 0);
  for (const s of [-0.22, 0.22]) box(B, 0.57, 0.46, 0.03, C.hayDk, 0, 0.225, s);
}
// abóbora com gomos: esfera 10×6 com raio modulado (120 tris)
const PUMPKIN_GEO = (() => {
  const g = new THREE.SphereGeometry(1, 10, 6);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
    const k = 1 + 0.09 * Math.cos(a * 10) * Math.sqrt(Math.max(0, 1 - y * y));
    p.setXYZ(i, x * k, y * 0.72 * (1 - 0.12 * Math.max(0, y) ** 4), z * k);
  }
  g.computeVertexNormals();
  return g;
})();
function pumpkin(SM, x, y, z, r) {
  const P = grp(SM, x, y, z, rnd(0, 6));
  add(P, PUMPKIN_GEO, pick(C.pumpkin), 0, r * 0.72, 0).scale.setScalar(r);
  cyl(P, r * 0.1, r * 0.13, r * 0.4, 5, C.stem, 0, r * 1.38, 0).rotation.z = 0.2;
}

// =============================================================================
// CELEIRO, SILO, TRATOR
// =============================================================================
const BARN = { x: -16.6, z: 16.2, ry: 2.3 };
function buildBarn(S, SM) {
  const B = grp(S, BARN.x, 0, BARN.z, BARN.ry);     // frente = local +Z (vira para o quintal)
  const prof = [[-4.2, 0], [4.2, 0], [4.2, 4.3], [2.95, 6.6], [0, 7.95], [-2.95, 6.6], [-4.2, 4.3]];
  prism(B, prof, 10, C.barn);
  box(B, 8.6, 0.4, 10.4, C.stone, 0, 0.2, 0);
  // tábuas verticais (frente/fundos e laterais)
  const profTop = ax => (ax <= 2.95 ? 6.6 + (2.95 - ax) / 2.95 * 1.35 : 4.3 + (4.2 - ax) / 1.25 * 2.3);
  for (const fz of [5.0, -5.0]) for (let x = -3.9; x <= 3.9; x += 0.45) {
    const h = profTop(Math.abs(x)) - 0.55;
    box(B, 0.04, h, 0.03, C.barnDk, x, 0.4 + h / 2, fz + Math.sign(fz) * 0.015);
  }
  for (const sx of [-1, 1]) for (let z = -4.7; z <= 4.71; z += 0.55) box(B, 0.03, 3.9, 0.04, C.barnDk, sx * 4.215, 2.35, z);
  // acabamento branco: quinas, base, contorno do gambrel na frente e atrás
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(B, 0.2, 4.3, 0.2, C.white, sx * 4.2, 2.15, sz * 5.0);
  for (const fz of [5.04, -5.04]) {
    box(B, 8.6, 0.16, 0.06, C.white, 0, 4.28, fz);
    slab(B, 4.2, 4.3, 2.95, 6.6, 0.06, 0.16, C.white, 0, 0, fz); slab(B, -4.2, 4.3, -2.95, 6.6, 0.06, 0.16, C.white, 0, 0, fz);
    slab(B, 2.95, 6.6, 0, 7.95, 0.06, 0.16, C.white, 0, 0, fz); slab(B, -2.95, 6.6, 0, 7.95, 0.06, 0.16, C.white, 0, 0, fz);
  }
  // telhado gambrel (4 águas) com beiral
  for (const s of [-1, 1]) {
    slab(B, s * 4.2, 4.3, s * 2.95, 6.6, 10.7, 0.16, C.barnRoof, 0.45, 0.02);
    slab(B, s * 2.95, 6.6, 0, 7.95, 10.7, 0.16, C.barnRoof, 0.04, 0.04);
    for (let z = -5.0; z <= 5.01; z += 0.62) slab(B, s * 4.2, 4.3, s * 2.95, 6.6, 0.05, 0.22, C.barnRoofLt, 0.4, 0, z);
  }
  box(B, 0.4, 0.16, 10.8, C.white, 0, 8.1, 0);
  // portas grandes com X branco
  { const D = grp(B, 0, 0, 5.03);
    box(D, 3.7, 3.55, 0.06, C.white, 0, 1.78, 0);
    for (const s of [-1, 1]) {
      box(D, 1.6, 3.3, 0.06, C.barnDk, s * 0.83, 1.7, 0.04);
      box(D, 1.6, 0.14, 0.04, C.white, s * 0.83, 1.7, 0.08);
      beam(D, [s * 0.1, 0.12, 0.09], [s * 1.56, 3.28, 0.09], 0.12, C.white);
      beam(D, [s * 1.56, 0.12, 0.095], [s * 0.1, 3.28, 0.095], 0.12, C.white);
    }
    box(D, 4.4, 0.12, 0.14, C.iron, 0, 3.66, 0.08);    // trilho
    // luminária pescoço-de-ganso sobre a porta
    const L = grp(D, 0, 4.05, 0.05);
    beam(L, [0, 0, 0], [0, 0.25, 0.35], 0.04, C.iron);
    const sh = cone(L, 0.26, 0.18, 10, 0x2f5d43, 0, 0.18, 0.45); sh.userData.c = 0x2f5d43;
    kind(sph(L, 0.08, 0xffe6b0, 0, 0.08, 0.45, 8, 6), 'glass');
    glowAt(L, 0, 0.05, 0.45, 0.35, 0xffd27a, G_LAMP, 1.0);
    glowAt(L, 0, 0.05, 0.45, 1.5, 0xff9c45, G_LAMP, 0.3);
    L.updateWorldMatrix(true, false);
    _gv.set(0, 0, 2.2); L.localToWorld(_gv);
    GLOWS.push({ x: _gv.x, y: 0.04, z: _gv.z, size: 2.8, color: new THREE.Color(0xffa64d).multiplyScalar(0.18), kind: G_POOL, phase: 0 });
  }
  // porta do palheiro aberta, com feno aparecendo
  { const D = grp(B, 0, 5.55, 5.03);
    box(D, 1.7, 1.7, 0.05, C.white, 0, 0, 0);
    box(D, 1.4, 1.4, 0.06, 0x3a2418, 0, 0, 0.02);
    box(D, 1.1, 0.5, 0.4, C.hay, 0, -0.45, 0.0);
    for (let k = 0; k < 6; k++) cone(D, 0.05, 0.25, 4, C.hayLt, rnd(-0.5, 0.5), -0.2, 0.12).rotation.x = rnd(-1.4, -0.6);
    const door = box(D, 0.7, 1.4, 0.05, C.barnDk, -1.25, 0, 0.35); door.rotation.y = -1.2;
    box(D, 0.12, 0.12, 1.0, C.woodDk, 0, 1.2, 0.45);      // viga da polia
    const pu = cyl(D, 0.1, 0.1, 0.06, 8, C.iron, 0, 1.02, 0.85); pu.rotation.z = Math.PI / 2;
  }
  // janelas laterais (acendem à noite)
  for (const sx of [-1, 1]) for (const z of [-2.6, 1.0]) windowAt(B, sx * 4.22, 2.6, z, sx * Math.PI / 2, 0.8, 0.8, { glow: true });
  // cúpula de ventilação + cata-vento (galo)
  { const Cu = grp(B, 0, 7.95, 0);
    box(Cu, 1.0, 0.9, 1.0, C.white, 0, 0.45, 0);
    for (const s of [-1, 1]) box(Cu, 0.6, 0.5, 0.03, C.barnDk, 0, 0.5, s * 0.51);
    cone(Cu, 0.95, 0.65, 4, C.barnRoof, 0, 1.22, 0).rotation.y = Math.PI / 4;
    cyl(Cu, 0.02, 0.02, 1.1, 4, C.iron, 0, 2.0, 0);
    box(Cu, 0.6, 0.02, 0.02, C.iron, 0, 2.25, 0); box(Cu, 0.02, 0.02, 0.6, C.iron, 0, 2.25, 0);
    const rooster = grp(Cu, 0, 2.62, 0, 0.7);
    box(rooster, 0.42, 0.2, 0.03, C.iron, 0, 0, 0); box(rooster, 0.12, 0.2, 0.03, C.iron, 0.17, 0.15, 0); box(rooster, 0.12, 0.26, 0.03, C.iron, -0.2, 0.12, 0);
    box(rooster, 0.5, 0.03, 0.03, C.iron, 0.05, -0.18, 0);
  }
  // fardos e cocho ao lado
  for (const [lx, lz] of [[5.6, 3.5], [5.7, 1.9], [5.4, -1.0]]) { const [wx, wz] = l2w(BARN.x, BARN.z, BARN.ry, lx, lz); roundBale(SM, wx, wz, BARN.ry + rnd(-0.2, 0.2), 0.7, 1.2); }
  PAINT.push(({ softPoly, blob, AO, DIRT, DIRT_DK }) => {
    const c = (lx, lz) => l2w(BARN.x, BARN.z, BARN.ry, lx, lz);
    for (let i = 0; i < 90; i++) { const [wx, wz] = c(rnd(-3.6, 3.6), rnd(5.2, 9.5)); blob(wx, wz, rnd(0.6, 1.4), pick([DIRT, DIRT_DK]), rnd(0.25, 0.5), 0.4); }
    softPoly([c(-4.6, -5.4), c(4.6, -5.4), c(4.6, 5.6), c(-4.6, 5.6)], AO, 0.5, 1.0);
    for (const [lx, lz] of [[5.6, 3.5], [5.7, 1.9], [5.4, -1.0]]) { const [wx, wz] = c(lx, lz); blob(wx, wz, 1.3, AO, 0.35); }
  });
  // ---- silo (atrás do celeiro) ----
  { const [sx, sz] = l2w(BARN.x, BARN.z, BARN.ry, 2.4, -8.6);
    const Si = grp(SM, sx, 0, sz);
    cyl(Si, 2.15, 2.15, 11.2, 16, C.metal, 0, 5.6, 0);
    for (let y = 1.2; y < 11; y += 1.35) cyl(Si, 2.19, 2.19, 0.12, 16, C.metalDk, 0, y, 0);
    const dome = add(Si, new THREE.SphereGeometry(2.2, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0xd9e0e6, 0, 11.2, 0);
    dome.userData.c = 0xd9e0e6;
    cyl(Si, 0.3, 0.4, 0.4, 8, C.metalDk, 0, 13.5, 0);
    cyl(Si, 2.5, 2.5, 0.3, 16, C.stone, 0, 0.15, 0);
    const L = grp(S, sx, 0, sz, BARN.ry + 0.9);
    for (const lx of [-0.22, 0.22]) box(L, 0.05, 11.0, 0.05, C.metalDk, lx, 5.9, 2.25);
    for (let y = 0.8; y < 11.3; y += 0.4) box(L, 0.44, 0.03, 0.03, C.metalDk, 0, y, 2.25);
    PAINT.push(({ blob, AO }) => blob(sx, sz, 3.4, AO, 0.5, 0.5));
  }
  // ---- trator (perto da estrada) ----
  { const [tx, tz] = l2w(BARN.x, BARN.z, BARN.ry, -8.0, 1.5);
    tractor(S, SM, tx, tz, BARN.ry - 1.9);
    PAINT.push(({ blob, AO, DIRT_DK }) => { blob(tx, tz, 2.6, AO, 0.35); blob(tx, tz, 3.5, DIRT_DK, 0.3, 0.3); });
  }
}
function tractor(S, SM, x, z, ry) {
  const T = grp(S, x, 0, z, ry);              // frente = local +Z
  box(T, 0.9, 0.55, 2.5, C.green, 0, 0.95, 0.15);
  box(T, 0.8, 0.6, 1.3, C.green, 0, 1.25, 0.9);               // capô
  box(T, 0.82, 0.08, 1.32, 0x2f7a35, 0, 1.58, 0.9);
  box(T, 0.7, 0.5, 0.06, 0x2a2a2a, 0, 1.2, 1.56);              // grade
  for (let y = 1.0; y < 1.42; y += 0.09) box(T, 0.62, 0.03, 0.02, C.metal, 0, y, 1.6);
  for (const s of [-1, 1]) kind(cyl(T, 0.08, 0.08, 0.04, 8, 0xfff2c0, s * 0.28, 1.45, 1.57), 'glass').rotation.x = Math.PI / 2;
  // cabine aberta
  for (const [sx, sz] of [[-0.6, -0.95], [0.6, -0.95], [-0.6, 0.15], [0.6, 0.15]]) box(T, 0.07, 1.35, 0.07, 0x2b2b2e, sx, 2.0, sz);
  box(T, 1.5, 0.08, 1.45, C.yellow, 0, 2.7, -0.4);
  box(T, 0.5, 0.12, 0.45, 0x2b2b2e, 0, 1.4, -0.5);   // banco
  box(T, 0.5, 0.45, 0.08, 0x2b2b2e, 0, 1.65, -0.72);
  const sw = cyl(T, 0.17, 0.17, 0.03, 10, 0x2b2b2e, 0, 1.7, -0.05); sw.rotation.x = -0.9;
  cyl(T, 0.05, 0.05, 1.0, 6, 0x333333, 0.32, 2.0, 0.95);      // escapamento
  cyl(T, 0.07, 0.05, 0.12, 6, 0x333333, 0.32, 2.5, 0.95);
  // rodas
  for (const s of [-1, 1]) {
    const W = grp(T, s * 0.82, 0.78, -0.55); W.userData.kind = 'smooth';
    const t = cyl(W, 0.78, 0.78, 0.42, 16, C.tire, 0, 0, 0); t.rotation.z = Math.PI / 2;
    const h = cyl(W, 0.46, 0.46, 0.44, 12, C.yellow, 0, 0, 0); h.rotation.z = Math.PI / 2;
    box(T, 0.5, 0.08, 1.2, C.green, s * 0.82, 1.62, -0.55);
    const Wf = grp(T, s * 0.6, 0.42, 1.25); Wf.userData.kind = 'smooth';
    const tf = cyl(Wf, 0.42, 0.42, 0.26, 12, C.tire, 0, 0, 0); tf.rotation.z = Math.PI / 2;
    const hf = cyl(Wf, 0.24, 0.24, 0.28, 10, C.yellow, 0, 0, 0); hf.rotation.z = Math.PI / 2;
  }
}

// =============================================================================
// MOINHO (torre de madeira estilo americano) — o rotor gira (malha separada)
// =============================================================================
const MILL = { x: 15.2, z: 19.6 };
let rotor = null;
function buildWindmill(S, SM) {
  const ry = Math.atan2(-MILL.x, -MILL.z) + 0.25;      // rotor olhando para a varanda
  const M = grp(S, MILL.x, 0, MILL.z, ry);
  const TOP = 9.6, B0 = 1.35, B1 = 0.3;
  const leg = (sx, sz) => beam(M, [sx * B0, 0, sz * B0], [sx * B1, TOP, sz * B1], 0.14, 0x9c6b42);
  leg(-1, -1); leg(1, -1); leg(-1, 1); leg(1, 1);
  const wAt = y => B0 + (B1 - B0) * (y / TOP);
  for (const y of [0.3, 3.2, 6.2, 9.2]) {
    const w = wAt(y);
    for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) beam(M, [ax * w, y, az * w], [bx * w, y, bz * w], 0.08, 0xb07c4c);
  }
  for (const [y0, y1] of [[0.3, 3.2], [3.2, 6.2], [6.2, 9.2]]) {
    const w0 = wAt(y0), w1 = wAt(y1);
    for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
      beam(M, [ax * w0, y0, az * w0], [bx * w1, y1, bz * w1], 0.05, 0x8a5c38);
      beam(M, [bx * w0, y0, bz * w0], [ax * w1, y1, az * w1], 0.05, 0x8a5c38);
    }
  }
  box(M, 1.2, 0.08, 1.2, 0x8a5c38, 0, TOP, 0);                 // plataforma
  box(M, 0.4, 0.42, 0.95, C.barn, 0, TOP + 0.38, 0.05);        // cabeçote
  cone(M, 0.32, 0.3, 4, C.barnDk, 0, TOP + 0.74, 0.05).rotation.y = Math.PI / 4;
  cyl(M, 0.07, 0.07, 0.9, 6, 0x555555, 0, TOP + 0.2, 0);
  beam(M, [0, TOP + 0.4, -0.35], [0, TOP + 0.55, -2.5], 0.07, 0x9aa3ab);   // cauda
  box(M, 0.04, 1.0, 1.35, C.barn, 0, TOP + 0.6, -3.1);
  box(M, 0.05, 0.22, 1.37, C.white, 0, TOP + 0.6, -3.1);
  // bebedouro de lata ao pé da torre
  cyl(SM, 1.05, 1.05, 0.55, 18, C.metal, ...l2w0(MILL.x, MILL.z, ry, 1.9, 1.1, 0.275));
  cyl(SM, 0.98, 0.98, 0.02, 18, 0x5aa7c9, ...l2w0(MILL.x, MILL.z, ry, 1.9, 1.1, 0.5));
  // rotor
  const RG = new THREE.Group();
  const nB = 18;
  for (let i = 0; i < nB; i++) {
    const a = (i / nB) * Math.PI * 2;
    const arm = new THREE.Group(); arm.rotation.z = a; RG.add(arm);
    const b = box(arm, 0.24, 1.15, 0.02, i % 2 ? 0xf3ecd8 : C.barn, 0, 1.12, 0);
    b.rotation.y = 0.45;
    box(arm, 0.03, 1.5, 0.03, 0x8f969c, 0, 0.75, -0.03);
  }
  for (const r of [0.62, 1.62]) RG.add(Object.assign(new THREE.Mesh(new THREE.TorusGeometry(r, 0.03, 4, 28)), { userData: { c: 0x8f969c } }));
  const hub = cyl(RG, 0.18, 0.2, 0.22, 10, 0x555555, 0, 0, 0); hub.rotation.x = Math.PI / 2;
  const geo = bake(RG, { flat: true });
  rotor = new THREE.Mesh(geo, MAT.flat);
  rotor.name = 'windmillRotor';
  const [rx, rz] = l2w(MILL.x, MILL.z, ry, 0, 0.72);
  rotor.position.set(rx, TOP + 0.38, rz);
  rotor.rotation.set(0, ry, 0);
  PAINT.push(({ blob, AO, DIRT, DIRT_DK }) => {
    blob(MILL.x, MILL.z, 2.6, DIRT_DK, 0.4, 0.3); blob(MILL.x, MILL.z, 2.0, DIRT, 0.5, 0.4); blob(MILL.x, MILL.z, 2.2, AO, 0.3);
    const [wx, wz] = l2w(MILL.x, MILL.z, ry, 1.9, 1.1); blob(wx, wz, 1.6, AO, 0.4);
  });
  return rotor;
}
function l2w0(cx, cz, ry, lx, lz, y) { const [x, z] = l2w(cx, cz, ry, lx, lz); return [x, y, z]; }

// =============================================================================
// ÁRVORES, ARBUSTOS, PEDRAS
// =============================================================================
function oak(S, x, z, s, lo = false) {
  const T = grp(S, x, terrainHeight(x, z) - 0.05, z, rnd(0, 6.28));
  const det = lo ? 0 : 1;
  cyl(T, 0.2 * s, 0.32 * s, 2.4 * s, lo ? 5 : 7, C.trunk, 0, 1.2 * s, 0);
  if (!lo) { const br = cyl(T, 0.08 * s, 0.13 * s, 1.3 * s, 5, C.trunk, 0.35 * s, 2.3 * s, 0); br.rotation.z = -0.7; }
  const cMain = pick(C.leaf);
  ico(T, 1.55 * s, cMain, 0, 3.35 * s, 0, det).scale.set(1, 0.85, 1);
  const n = lo ? 2 : 3;
  for (let i = 0; i < n; i++) {
    const a = i * 1.7 + rnd(0, 1), r = rnd(0.8, 1.2) * s;
    ico(T, rnd(0.85, 1.15) * s, pick([C.leaf[0], C.leaf[1], C.leafDk]), Math.cos(a) * r, (2.8 + rnd(-0.2, 0.5)) * s, Math.sin(a) * r, det);
  }
  ico(T, 0.95 * s, C.leafLt, rnd(-0.3, 0.3) * s, 4.15 * s, rnd(-0.3, 0.3) * s, det);
  if (!lo) PAINT.push(({ blob, AO }) => blob(x, z, 2.4 * s, AO, 0.45, 0.2));
}
function pine(S, x, z, s, lo = false) {
  const T = grp(S, x, terrainHeight(x, z) - 0.05, z, rnd(0, 6.28));
  const seg = lo ? 6 : 7;
  add(T, new THREE.CylinderGeometry(0.14 * s, 0.22 * s, 1.4 * s, 5, 1, true), C.trunkDk, 0, 0.7 * s, 0);
  const cols = C.pine;
  for (let i = 0; i < 3; i++) add(T, new THREE.ConeGeometry((1.45 - i * 0.36) * s, (2.0 - i * 0.2) * s, seg, 1, lo), cols[i], 0, (1.9 + i * 1.0) * s, 0);
  if (!lo) PAINT.push(({ blob, AO }) => blob(x, z, 1.8 * s, AO, 0.4, 0.2));
}
function poplar(S, x, z, s) {
  const T = grp(S, x, terrainHeight(x, z) - 0.05, z);
  cyl(T, 0.12 * s, 0.2 * s, 1.6 * s, 5, C.trunk, 0, 0.8 * s, 0);
  ico(T, 1.0 * s, pick(C.leaf), 0, 3.3 * s, 0, 0).scale.set(1, 2.3, 1);
}
function bush(S, x, z, s) {
  const T = grp(S, x, 0, z);
  for (let i = 0; i < 3; i++) ico(T, rnd(0.45, 0.65) * s, pick([C.leaf[0], C.leaf[1], C.leafDk]), rnd(-0.4, 0.4) * s, 0.35 * s, rnd(-0.3, 0.3) * s, 0);
}
function rock(S, x, z, s) {
  const r = ico(S, s, pick([0x9c9a92, 0x8f8d86, 0xa9a69c]), x, s * 0.3, z, 0);
  r.scale.set(rnd(1, 1.5), rnd(0.55, 0.8), rnd(0.9, 1.3)); r.rotation.y = rnd(0, 6);
}
function buildTrees(S) {
  // perto: emolduram a casa e o quintal (fora do cone central)
  oak(S, -12.8, 3.4, 1.35); oak(S, -12.0, -7.6, 1.5); oak(S, 11.8, -7.2, 1.4); oak(S, 12.6, 15.0, 1.05);
  oak(S, -3.8, -16.0, 1.6); oak(S, 6.4, -16.8, 1.3); pine(S, -9.5, -17.2, 1.45); pine(S, 13.4, -14.2, 1.5);
  pine(S, -17.5, -10.5, 1.3); oak(S, 18.5, -9.2, 1.2); pine(S, 22.5, -3.5, 1.35); oak(S, 31, 21, 1.5);
  oak(S, 33, 7, 1.3); pine(S, 29, -7, 1.4); oak(S, -29, 6, 1.4); oak(S, -28, 33, 1.3); pine(S, -32, 19, 1.5);
  pine(S, -24, -4, 1.3); oak(S, 24, 30, 1.2); pine(S, 36, 30, 1.5); oak(S, -36, 26, 1.4);
  bush(S, -10.4, -1.5, 1.2); bush(S, 10.5, -2.2, 1.0); bush(S, -10.6, 9.2, 0.9); bush(S, 10.4, 17.6, 0.8);
  // fileira de árvores do outro lado da estrada (laterais)
  for (const side of [-1, 1]) for (let ax = 13; ax < 80; ax += rnd(6, 9)) {
    const x = side * ax, z = roadZ(x) + rnd(4.5, 7);
    const r = R();
    if (inSunsetCone(x, z)) continue;
    if (r < 0.4) poplar(S, x, z, rnd(1.0, 1.3)); else if (r < 0.8) oak(S, x, z, rnd(0.9, 1.2), ax > 40); else bush(S, x, z, 1.1);
  }
  // matas nas colinas (baixo detalhe, em grupinhos)
  let placed = 0, tries = 0;
  while (placed < 30 && tries++ < 400) {
    const a = rnd(-Math.PI, Math.PI), d = rnd(70, 250);
    if (Math.abs(a) < 0.3 && d < 150) continue;
    const cx = TC.x + Math.sin(a) * d, cz = TC.z + Math.cos(a) * d;
    if (Math.abs(cz - roadZ(cx)) < 8) continue;
    const n = 4 + Math.floor(rnd(0, 7));
    for (let i = 0; i < n; i++) {
      const x = cx + rnd(-11, 11), z = cz + rnd(-11, 11);
      if (Math.abs(z - roadZ(x)) < 5 || inSunsetCone(x, z)) continue;
      const s = rnd(1.4, 2.4);
      R() < 0.65 ? pine(S, x, z, s, true) : oak(S, x, z, s * 0.8, true);
    }
    placed++;
  }
  // pedras
  for (const [x, z, s] of [[-10.2, 18.9, 0.35], [10.3, 19.0, 0.28], [-10.4, 0.6, 0.3], [4.2, 26.0, 0.25], [-6.5, 28.6, 0.4], [11.5, 28.4, 0.32], [-18, 29, 0.5], [20, -1, 0.45]]) rock(S, x, z, s);
}

// nada alto na linha de visada do pôr do sol (a partir da varanda)
const inSunsetCone = (x, z) => z > 12 && angDist(Math.atan2(x, z), SUNSET_AZ_RAD) < 9 * D2R;

// Espantalho, abóboras, caixa de correio, lenha
function buildExtras(S, SM) {
  // espantalho no milharal
  { const E = grp(S, 18.4, 0, 6.2, -2.0);
    cyl(E, 0.05, 0.06, 2.5, 5, C.woodMid, 0, 1.25, 0);
    box(E, 1.5, 0.07, 0.07, C.woodMid, 0, 1.85, 0);
    box(E, 0.6, 0.6, 0.32, 0xc0392b, 0, 1.7, 0);
    for (const y of [1.55, 1.75, 1.9]) box(E, 0.62, 0.03, 0.33, 0x8e2a20, 0, y, 0);
    box(E, 1.3, 0.2, 0.22, 0xc0392b, 0, 1.86, 0);
    box(E, 0.5, 0.45, 0.3, 0x3d5fa8, 0, 1.25, 0.01);
    for (const s of [-1, 1]) { cone(E, 0.07, 0.2, 4, C.hay, s * 0.72, 1.86, 0).rotation.z = s * 1.57; cone(E, 0.06, 0.2, 4, C.hay, s * 0.12, 0.98, 0).rotation.z = Math.PI; }
    kind(sph(E, 0.21, 0xe8d29a, 0, 2.25, 0, 10, 8), 'smooth');
    cyl(E, 0.4, 0.4, 0.03, 12, 0xc9a24b, 0, 2.42, 0);
    cyl(E, 0.17, 0.21, 0.22, 10, 0xc9a24b, 0, 2.55, 0);
    box(E, 0.05, 0.05, 0.02, 0x222222, -0.07, 2.28, 0.2); box(E, 0.05, 0.05, 0.02, 0x222222, 0.07, 2.28, 0.2);
    // corvo no braço
    const Cr = grp(E, 0.55, 1.93, 0, 0.5);
    box(Cr, 0.16, 0.1, 0.08, 0x1d1d24, 0, 0.05, 0); box(Cr, 0.07, 0.07, 0.07, 0x1d1d24, 0.1, 0.12, 0); box(Cr, 0.05, 0.02, 0.02, 0xe0a030, 0.15, 0.12, 0);
  }
  // canteiro de abóboras além da cerca da frente (baixo, não atrapalha os UFOs)
  for (let i = 0; i < 22; i++) pumpkin(SM, rnd(3.2, 9.4), 0, rnd(20.4, 24.0), rnd(0.18, 0.32));
  for (let i = 0; i < 26; i++) { const l = sph(SM, rnd(0.15, 0.25), pick([C.leaf[0], C.leafDk]), rnd(3.0, 9.6), 0.05, rnd(20.2, 24.2), 6, 4); l.scale.y = 0.35; }
  PAINT.push(({ softPoly, rect, SOIL, blob, LAWN_DK }) => {
    softPoly(rect(2.7, 20.0, 9.9, 24.6), SOIL, 0.85, 0.3);
    for (let i = 0; i < 40; i++) blob(rnd(3, 9.6), rnd(20.3, 24.3), rnd(0.2, 0.5), LAWN_DK, 0.5, 0.4);
  });
  // caixa de correio na estrada
  { const Mb = grp(S, -1.7, 0, 24.7, 0.15);
    box(Mb, 0.09, 1.1, 0.09, C.woodMid, 0, 0.55, 0);
    box(Mb, 0.3, 0.26, 0.5, 0xc8443a, 0, 1.22, 0);
    const top = cyl(Mb, 0.15, 0.15, 0.5, 10, 0xc8443a, 0, 1.35, 0); top.rotation.x = Math.PI / 2;
    box(Mb, 0.03, 0.28, 0.06, C.yellow, 0.17, 1.38, -0.12);
  }
  // lenha empilhada ao lado da casa
  { const L = grp(S, 7.6, 0, -5.9, 0);
    for (let row = 0; row < 4; row++) for (let k = 0; k < 6 - row; k++) {
      const c = cyl(L, 0.13, 0.13, 1.0, 6, pick([0x9a6a40, 0x8a5c36, 0xa8794b]), (k - (5 - row) / 2) * 0.27, 0.13 + row * 0.23, 0);
      c.rotation.x = Math.PI / 2;
    }
    cyl(L, 0.25, 0.28, 0.45, 8, 0x8a5c36, 1.3, 0.225, 0.4);
    beam(L, [1.3, 0.45, 0.4], [1.55, 0.95, 0.3], 0.04, C.woodMid);
    box(L, 0.04, 0.12, 0.18, 0x9aa3ab, 1.56, 0.95, 0.3);
  }
}

// =============================================================================
// VEGETAÇÃO INSTANCIADA (grama, flores, milho) com vento no vertex shader
// =============================================================================
const _noFlip = THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', '');
function vegMaterial(amp, key) {
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: RAMP3, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = U.uTime; sh.uniforms.uWind = U.uWind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace('#include <project_vertex>', /* glsl */`
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        {
          float hgt = max(mvPosition.y, 0.0);
          vec2 wp = mvPosition.xz;
          float gust = 0.55 + 0.45 * sin(uTime * 0.6 + wp.x * 0.07 - wp.y * 0.05);
          float ph = dot(wp, vec2(0.41, 0.27));
          float s = sin(uTime * 2.0 + ph) * 0.65 + sin(uTime * 3.3 + ph * 1.7) * 0.35;
          float b = (0.55 * gust + s * 0.45) * ${amp.toFixed(3)} * uWind * pow(hgt, 1.5);
          mvPosition.xz += vec2(0.8, 0.6) * b;
          mvPosition.y -= abs(b) * 0.25;
        }
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', _noFlip);
  };
  m.customProgramCacheKey = () => 'veg-' + key;
  return m;
}
function geoFrom(P, Cc) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
  const N = new Float32Array(P.length); for (let i = 1; i < N.length; i += 3) N[i] = 1;   // normais pra cima (luz igual ao chão)
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  return g;
}
function tuftGeo() {
  const P = [], Cc = [];
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094 + 0.4, ca = Math.cos(a), sa = Math.sin(a);
    const w = 0.032, h = 0.24 - i * 0.04, lean = 0.07;
    const ox = ca * 0.025, oz = sa * 0.025, bx = -sa * w, bz = ca * w;
    P.push(ox - bx, 0, oz - bz, ox + bx, 0, oz + bz, ox + ca * lean, h, oz + sa * lean);
    Cc.push(0.6, 0.6, 0.55, 0.6, 0.6, 0.55, 1.12, 1.12, 1.02);
  }
  return geoFrom(P, Cc);
}
function flowerGeo() {
  const P = [], Cc = [], y = 0.2;
  P.push(-0.006, 0, 0, 0.006, 0, 0, 0, y, 0); Cc.push(0.3, 0.55, 0.25, 0.3, 0.55, 0.25, 0.3, 0.55, 0.25);
  for (let i = 0; i < 10; i++) {
    const a0 = (i / 10) * Math.PI * 2, a1 = ((i + 1) / 10) * Math.PI * 2;
    const r0 = i % 2 ? 0.03 : 0.065, r1 = (i + 1) % 2 ? 0.03 : 0.065;
    P.push(0, y + 0.004, 0, Math.cos(a0) * r0, y, Math.sin(a0) * r0, Math.cos(a1) * r1, y, Math.sin(a1) * r1);
    Cc.push(1.0, 0.9, 0.45, 1, 1, 1, 1, 1, 1);
  }
  return geoFrom(P, Cc);
}
function cornGeo() {
  const P = [], Cc = [];
  const lin = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };   // sRGB → linear
  const H = 2.05, st = lin(0x5f8f2e), lf = lin(0x6aa53a), lfT = lin(0x93c452), tas = lin(0xe8c45a), ear = lin(0xe0cf7a);
  for (let i = 0; i < 3; i++) {   // talo (prisma de 3 lados)
    const a0 = i * 2.094, a1 = (i + 1) * 2.094;
    const p = (a, r, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
    const A = p(a0, 0.035, 0), B = p(a1, 0.035, 0), Ct = p(a0, 0.015, H), D = p(a1, 0.015, H);
    P.push(...A, ...B, ...Ct, ...B, ...D, ...Ct);
    for (let k = 0; k < 6; k++) Cc.push(...st);
  }
  for (let i = 0; i < 5; i++) {   // folhas arqueadas
    const y = 0.4 + i * 0.3, a = i * 2.4, ca = Math.cos(a), sa = Math.sin(a), px = -sa, pz = ca;
    const len = 0.7 - i * 0.07, w = 0.06;
    const base = [0, y, 0], mid = [ca * len * 0.45, y + 0.2, sa * len * 0.45], tip = [ca * len, y - 0.06, sa * len];
    P.push(...base, mid[0] + px * w, mid[1], mid[2] + pz * w, mid[0] - px * w, mid[1], mid[2] - pz * w);
    P.push(mid[0] + px * w, mid[1], mid[2] + pz * w, ...tip, mid[0] - px * w, mid[1], mid[2] - pz * w);
    Cc.push(...lf, ...lf, ...lf, ...lf, ...lfT, ...lf);
  }
  // pendão dourado + espiga
  P.push(-0.08, H - 0.05, 0, 0.08, H - 0.05, 0, 0, H + 0.32, 0.02, 0, H - 0.05, -0.08, 0, H - 0.05, 0.08, 0.02, H + 0.28, 0);
  for (let k = 0; k < 6; k++) Cc.push(...tas);
  P.push(0.02, 1.0, 0, 0.12, 1.12, 0.05, 0.05, 1.42, 0.02, 0.02, 1.0, 0, 0.05, 1.42, 0.02, 0.0, 1.15, 0.07);
  for (let k = 0; k < 6; k++) Cc.push(...ear);
  return geoFrom(P, Cc);
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const VEG = {};
const _shufR = mulberry32(777);   // embaralha a ordem (não muda o visual): cortar o fim da lista = rarear por igual
function instanced(geo, mat, list, name) {
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(_shufR() * (i + 1)); const t = list[i]; list[i] = list[j]; list[j] = t; }
  const im = new THREE.InstancedMesh(geo, mat, list.length);
  im.userData.full = list.length;
  VEG[name] = im;
  list.forEach((it, i) => {
    _p.set(it.x, it.y || 0, it.z);
    _e.set(it.tx || 0, it.ry || 0, it.tz || 0); _q.setFromEuler(_e);
    _s.set(it.s, it.sy || it.s, it.s);
    _m4.compose(_p, _q, _s);
    im.setMatrixAt(i, _m4);
    im.setColorAt(i, _c.setHex(it.c));
  });
  im.instanceMatrix.needsUpdate = true;
  im.frustumCulled = false;
  im.name = name;
  return im;
}
/** Qualidade automática do VR: rareia grama/flores/milho (0 = tudo · 3 = mínimo). */
const VEG_Q = { grass: [1, 0.6, 0.35, 0.15], flowers: [1, 0.5, 0.2, 0], corn: [1, 0.85, 0.65, 0.5] };
export function setVegQuality(q) {
  for (const k in VEG_Q) {
    const im = VEG[k]; if (!im) continue;
    const n = Math.round(im.userData.full * VEG_Q[k][q]);
    im.count = n; im.visible = n > 0;
  }
}
// zonas sem grama
const pathX = z => 0.42 * Math.sin((z - 1.7) * 0.33);
function noGrass(x, z) {
  if (Math.abs(x) < 4.05 && z < 0.55) return true;                               // varanda
  if (Math.abs(x) < 1.5 && z < 1.85) return true;                                // rampa
  if (Math.abs(x) > 1.4 && Math.abs(x) < 4.0 && z < 1.22 && z > 0.5) return true; // canteiros
  if (z > 1.5 && z < 27 && Math.abs(x - pathX(z)) < 0.62) return true;           // caminho
  if (Math.hypot((x + 6.8) / 1.25, z - 12.6) < 1.9) return true;                  // terra do galinheiro
  for (const o of OBSTACLES) if (Math.abs(x - o.x) < o.hx + 0.1 && Math.abs(z - o.z) < o.hz + 0.1) return true;
  if (x > -5.5 && x < 5.5 && z < -3.55) return true;                              // casa
  return false;
}
function buildVegetation() {
  const out = [];
  const GRASS = [0x8fcc5a, 0x7bbd49, 0xa2d466, 0x6caa40, 0x88c252];
  const grass = [];
  // quintal
  while (grass.length < 3400) {
    const x = rnd(-9.45, 9.45), z = rnd(-3.7, 18.45);
    if (noGrass(x, z)) continue;
    grass.push({ x, z, ry: rnd(0, 6.28), tx: rnd(-0.15, 0.15), tz: rnd(-0.15, 0.15), s: rnd(0.8, 1.2), sy: rnd(0.6, 1.25), c: pick(GRASS) });
  }
  // prado em volta (capim mais alto e amarelado)
  const MEAD = [0x9cc65a, 0xb2cc68, 0x86b84c, 0xa8c45e];
  let n = 0;
  while (n < 1700) {
    const x = rnd(-24, 24), z = rnd(-14, 32);
    if (Math.abs(x) < 9.8 && z > -3.95 && z < 18.75) continue;
    if (x > -5.6 && x < 5.6 && z < -3.5 && z > -11.7) continue;                // casa
    if (x > 11.0 && x < 28.6 && z > -3.6 && z < 14.0) continue;                // milharal
    if (x > 2.6 && x < 10 && z > 20 && z < 24.6) continue;                     // abóboras
    if (Math.abs(z - roadZ(x)) < 2.0) continue;                                // estrada
    if (Math.abs(x - pathX(z)) < 0.7 && z > 18) continue;
    const [bx, bz] = [x - BARN.x, z - BARN.z];
    const lx = bx * Math.cos(BARN.ry) - bz * Math.sin(BARN.ry), lz = bx * Math.sin(BARN.ry) + bz * Math.cos(BARN.ry);
    if (Math.abs(lx) < 6.5 && lz > -6 && lz < 10) continue;                    // celeiro + terreiro
    if (Math.hypot(x - MILL.x, z - MILL.z) < 3.2) continue;
    grass.push({ x, z, ry: rnd(0, 6.28), tx: rnd(-0.2, 0.2), tz: rnd(-0.2, 0.2), s: rnd(1.0, 1.5), sy: rnd(1.1, 1.9), c: pick(MEAD) });
    n++;
  }
  out.push(instanced(tuftGeo(), vegMaterial(0.32, 'grass'), grass, 'grass'));
  // flores: mais perto da cerca e nos canteiros
  const FL = [0xff6b8a, 0xffd23f, 0xffffff, 0xb987ff, 0xff8a3d, 0x6fb6ff];
  const flowers = [];
  while (flowers.length < 150) {
    const edge = R() < 0.65;
    let x, z;
    if (edge) { const s = R(); if (s < 0.33) { x = rnd(-9.3, 9.3); z = rnd(17.6, 18.4); } else { x = (R() < 0.5 ? -1 : 1) * rnd(8.5, 9.4); z = rnd(-3.5, 18.4); } }
    else { x = rnd(-9, 9); z = rnd(2, 17); }
    if (noGrass(x, z)) continue;
    flowers.push({ x, z, ry: rnd(0, 6.28), s: rnd(0.8, 1.3), c: pick(FL) });
  }
  for (const s of [-1, 1]) for (let i = 0; i < 22; i++) flowers.push({ x: s * rnd(1.5, 3.9), z: rnd(0.6, 1.15), ry: rnd(0, 6.28), s: rnd(1.0, 1.5), sy: rnd(1.0, 1.4), c: pick(FL) });
  for (let i = 0; i < 160; i++) {
    const x = rnd(-22, 22), z = rnd(-10, 30);
    if ((Math.abs(x) < 9.9 && z > -4 && z < 18.9) || (x > 11 && x < 28.6 && z > -3.6 && z < 14) || Math.abs(z - roadZ(x)) < 2) continue;
    flowers.push({ x, z, ry: rnd(0, 6.28), s: rnd(0.9, 1.4), sy: rnd(1.4, 2.2), c: pick(FL) });
  }
  out.push(instanced(flowerGeo(), vegMaterial(0.32, 'flower'), flowers, 'flowers'));
  // milharal (fileiras ao longo de Z, fora da cerca à esquerda)
  const corn = [];
  for (let x = 11.6; x < 28.2; x += 0.95) for (let z = -3.0; z < 13.6; z += 0.62) {
    const px = x + rnd(-0.12, 0.12), pz = z + rnd(-0.18, 0.18);
    if (Math.hypot(px - 18.4, pz - 6.2) < 0.9) continue;                       // espantalho
    const edgeK = Math.min(px - 11.6, 28.2 - px, pz + 3, 13.6 - pz);
    corn.push({ x: px, z: pz, ry: rnd(0, 6.28), s: rnd(0.85, 1.1), sy: rnd(0.85, 1.12) * (edgeK < 0.8 ? 0.85 : 1), c: pick([0xffffff, 0xf2ffe6, 0xfff6dc, 0xe6f5d6]) });
  }
  out.push(instanced(cornGeo(), vegMaterial(0.07, 'corn'), corn, 'corn'));
  PAINT.push(({ x, px, pz, k, softPoly, rect, SOIL, SOIL_DK }) => {
    softPoly(rect(11.2, -3.5, 28.6, 14.0), SOIL, 0.95, 0.3);
    x.fillStyle = `rgba(${SOIL_DK[0]},${SOIL_DK[1]},${SOIL_DK[2]},0.55)`;
    for (let xx = 11.6 + 0.47; xx < 28.2; xx += 0.95) x.fillRect(px(xx) - 0.12 * k, pz(-3.2), 0.24 * k, 16.8 * k);
  });
  return out;
}

// =============================================================================
// BRILHOS (lampiões, janelas, poças de luz, vaga-lumes) — 1 malha aditiva
// =============================================================================
const glowU = { uTime: U.uTime, uLamp: { value: 0 }, uWin: { value: 0 }, uFire: { value: 0 } };
let glowMesh = null;
function buildFireflies() {
  for (let i = 0; i < 64; i++) {
    let x, z;
    const r = R();
    if (r < 0.55) { x = rnd(-9, 9); z = rnd(1.5, 18); }
    else if (r < 0.8) { x = rnd(10, 16); z = rnd(-2, 15); }
    else { x = rnd(-14, -9.8); z = rnd(-2, 10); }
    GLOWS.push({ x, y: rnd(0.35, 2.3), z, size: rnd(0.05, 0.075), color: new THREE.Color(0xd8ff6a), kind: G_FIRE, phase: R() * 10 });
  }
}
function buildGlowMesh() {
  const n = GLOWS.length;
  const pos = new Float32Array(n * 12), cor = new Float32Array(n * 8), siz = new Float32Array(n * 4), col = new Float32Array(n * 12), kp = new Float32Array(n * 8);
  const idx = [];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  GLOWS.forEach((g, i) => {
    for (let v = 0; v < 4; v++) {
      const o = i * 4 + v;
      pos.set([g.x, g.y, g.z], o * 3);
      cor.set(corners[v], o * 2);
      siz[o] = g.size;
      col.set([g.color.r, g.color.g, g.color.b], o * 3);
      kp.set([g.kind, g.phase], o * 2);
    }
    const b = i * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aCorner', new THREE.BufferAttribute(cor, 2));
  geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aKind', new THREE.BufferAttribute(kp, 2));
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: glowU,
    vertexShader: /* glsl */`
      uniform float uTime, uLamp, uWin, uFire;
      attribute vec2 aCorner, aKind; attribute float aSize; attribute vec3 aColor;
      varying vec2 vC; varying vec3 vCol; varying float vA;
      void main() {
        vec3 c = position;
        float k = aKind.x, ph = aKind.y, inten;
        if (k < 0.5) inten = uLamp * (0.94 + 0.06 * sin(uTime * 9.0 + ph * 20.0) * sin(uTime * 5.3 + ph * 7.0));
        else if (k < 1.5) inten = uWin;
        else if (k < 2.5) inten = uLamp;
        else {
          float s = 0.5 + fract(ph * 7.13) * 0.6;
          c += vec3(sin(uTime * 0.45 * s + ph) * 0.9, sin(uTime * 0.8 * s + ph * 2.0) * 0.35, cos(uTime * 0.37 * s + ph * 1.3) * 0.9);
          float b = 0.5 + 0.5 * sin(uTime * (1.2 + s) + ph * 13.0);
          inten = uFire * b * b;
        }
        vA = inten; vC = aCorner; vCol = aColor;
        if (k > 1.5 && k < 2.5) {
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(c + vec3(aCorner.x, 0.0, aCorner.y) * aSize, 1.0);
        } else {
          vec4 mv = modelViewMatrix * vec4(c, 1.0);
          mv.xy += aCorner * aSize;
          gl_Position = projectionMatrix * mv;
        }
        if (inten < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // descarta (fora do clip)
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vC; varying vec3 vCol; varying float vA;
      void main() {
        float d = length(vC);
        float a = 1.0 - smoothstep(0.0, 1.0, d);
        gl_FragColor = vec4(vCol, a * a * vA);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  glowMesh = new THREE.Mesh(geo, mat);
  glowMesh.frustumCulled = false;
  glowMesh.renderOrder = 5;
  glowMesh.name = 'glows';
  return glowMesh;
}

// =============================================================================
// PÁSSAROS — bandinho circulando longe, à esquerda (some no crepúsculo). Tudo na GPU.
// =============================================================================
let birdMesh = null;
const birdU = { uTime: U.uTime, uVis: { value: 1 }, uColor: { value: new THREE.Color(0x2a2e3a) } };
function buildBirds() {
  const N = 7, pos = [], ctr = [], brd = [], tip = [];
  const groups = [[42, 26, 30], [-46, 30, 52]];       // centros dos círculos (bem longe do cone dos UFOs)
  for (let i = 0; i < N; i++) {
    const gc = groups[i < 5 ? 0 : 1];
    const radius = rnd(9, 16), phase = rnd(0, 6.28), speed = rnd(0.16, 0.24) * (i < 5 ? 1 : -1), h = rnd(-2, 3);
    const sc = rnd(0.8, 1.1);
    // asa esquerda e direita (x = lateral, z = frente); ponta da asa bate
    const tris = [[0, 0, 0.18, 0, 0, -0.12, -0.55, 0, -0.05], [0, 0, 0.18, 0.55, 0, -0.05, 0, 0, -0.12]];
    const tips = [[0, 0, 1], [0, 1, 0]];
    tris.forEach((t, k) => {
      for (let v = 0; v < 3; v++) {
        pos.push(t[v * 3] * sc, t[v * 3 + 1] * sc, t[v * 3 + 2] * sc);
        ctr.push(...gc); brd.push(radius, phase, speed, h); tip.push(tips[k][v]);
      }
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCenter', new THREE.Float32BufferAttribute(ctr, 3));
  g.setAttribute('aBird', new THREE.Float32BufferAttribute(brd, 4));
  g.setAttribute('aTip', new THREE.Float32BufferAttribute(tip, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: birdU,
    vertexShader: /* glsl */`
      uniform float uTime, uVis;
      attribute vec3 aCenter; attribute vec4 aBird; attribute float aTip;
      void main() {
        float ang = uTime * aBird.z + aBird.y;
        vec3 c = aCenter + vec3(cos(ang) * aBird.x, aBird.w + sin(ang * 2.3) * 0.8, sin(ang) * aBird.x);
        vec3 fwd = normalize(vec3(-sin(ang), 0.0, cos(ang)) * sign(aBird.z));
        vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
        float flap = sin(uTime * 6.5 + aBird.y * 9.0);
        flap = flap > -0.2 ? flap : -0.2;   // planeia de vez em quando
        vec3 p = c + right * position.x + fwd * position.z + vec3(0.0, aTip * flap * 0.32, 0.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        if (uVis < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4(uColor, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, fog: false,
  });
  birdMesh = new THREE.Mesh(g, m);
  birdMesh.frustumCulled = false;
  birdMesh.name = 'birds';
  return birdMesh;
}

// =============================================================================
// Bake em 3 materiais: facetado, liso e vidro (emissive)
// =============================================================================
const glassMat = new THREE.MeshToonMaterial({ color: 0x5f86a3, vertexColors: true, gradientMap: RAMP3, emissive: 0x000000 });
function bakeSplit(root) {
  const meshes = [];
  root.traverse(m => { if (m.isMesh) meshes.push(m); });
  const out = {};
  for (const k of ['flat', 'smooth', 'glass']) {
    let any = false;
    for (const m of meshes) { const mk = m.userData.kind || m.parent.userData.kind || 'flat'; m.userData.noBake = mk !== k; if (!m.userData.noBake) any = true; }
    if (any) out[k] = bake(root, { flat: k !== 'smooth' });
  }
  for (const m of meshes) m.userData.noBake = false;
  return out;
}

// =============================================================================
// API
// =============================================================================
let built = false;
export function initWorld() {
  if (built) return;
  built = true;
  R = mulberry32(20251109);
  scene.add(hemi, sun);
  initSky(U, mulberry32(4242));

  const S = new THREE.Group();     // facetado (padrão)
  const SM = new THREE.Group();    // liso
  SM.userData.kind = 'smooth';
  S.add(SM);
  // marca recursivamente o que está dentro de SM como 'smooth' (exceto vidro)
  buildHouse(S);
  buildPorch(S, SM);
  buildFences(S);
  buildCoop(S, SM);
  buildBarn(S, SM);
  scene.add(buildWindmill(S, SM));
  buildTrees(S);
  buildExtras(S, SM);
  const veg = buildVegetation();
  SM.traverse(m => { if (m.isMesh && !m.userData.kind) m.userData.kind = 'smooth'; });

  const parts = bakeSplit(S);
  const mk = (geo, mat, name) => { const m = new THREE.Mesh(geo, mat); m.name = name; m.frustumCulled = false; scene.add(m); return m; };
  if (parts.flat) mk(parts.flat, MAT.flat, 'worldFlat');
  if (parts.smooth) mk(parts.smooth, MAT.smooth, 'worldSmooth');
  if (parts.glass) mk(parts.glass, glassMat, 'worldGlass');

  scene.add(buildTerrain(paintGround()));
  for (const v of veg) scene.add(v);
  buildFireflies();
  scene.add(buildGlowMesh());
  scene.add(buildBirds());

  _lastT = -1;
  setTOD(0);
}

let windmillSpin = 0;
export function updateWorld(dt) {
  if (!built) return;
  const w = U.uWind.value;
  windmillSpin += dt * (1.2 + 0.6 * Math.sin(U.uTime.value * 0.23)) * w;
  if (rotor) rotor.rotation.z = windmillSpin;
  updateSky(dt, w);
}

// ---------- Ciclo do dia ----------
// t: 0 meio-dia · 1 tarde · 2 hora dourada/pôr do sol · 3 crepúsculo azul · 4 noite com lua
const KEYS = [
  { zen: 0x3d8fe0, hor: 0xc4e6f6, gnd: 0xc8dde6, glowC: 0xfff2d2, glow: 0.22, sunC: 0xfffbea, az: 150, el: 62,
    fog: 0xc9e4f1, fogN: 80, fogF: 900, hemiS: 0xd6ecff, hemiG: 0x7a9a4a, hemiI: 1.25, lightC: 0xfff4e0, lightI: 2.4,
    rimC: 0xfff8e8, rimS: 0.15, cLit: 0xffffff, cShade: 0xc7d9ee, win: 0, lamp: 0, fire: 0, stars: 0, moon: 0 },
  { zen: 0x3a80d4, hor: 0xf2e4c8, gnd: 0xd9cdb5, glowC: 0xffdba6, glow: 0.42, sunC: 0xfff2cc, az: 70, el: 32,
    fog: 0xe6dcc6, fogN: 70, fogF: 820, hemiS: 0xe6e4d8, hemiG: 0x748c40, hemiI: 1.15, lightC: 0xffe6bb, lightI: 2.3,
    rimC: 0xffe3b0, rimS: 0.28, cLit: 0xfff6e6, cShade: 0xc9c6d4, win: 0, lamp: 0, fire: 0, stars: 0, moon: 0 },
  { zen: 0x3a5aa6, hor: 0xffb575, gnd: 0xd99a74, glowC: 0xff8a45, glow: 1.15, sunC: 0xfff3c8, az: SUNSET_AZ, el: 5.5,
    fog: 0xf0ab84, fogN: 55, fogF: 720, hemiS: 0xf5bf9c, hemiG: 0x66603e, hemiI: 1.05, lightC: 0xffb878, lightI: 2.1,
    rimC: 0xffb070, rimS: 0.55, cLit: 0xffc996, cShade: 0x9f7598, win: 0.15, lamp: 0.25, fire: 0, stars: 0, moon: 0.15 },
  { zen: 0x1f2c6e, hor: 0xc77584, gnd: 0x5e4a6a, glowC: 0xff7650, glow: 0.55, sunC: 0xff9d6a, az: SUNSET_AZ - 3, el: -4.5,
    fog: 0x67568a, fogN: 40, fogF: 600, hemiS: 0x8f88cc, hemiG: 0x3a3a52, hemiI: 1.05, lightC: 0xb8a8ea, lightI: 0.95,
    rimC: 0xc3a8ff, rimS: 0.5, cLit: 0xc995b0, cShade: 0x524d80, win: 0.85, lamp: 0.9, fire: 0.5, stars: 0.3, moon: 0.7 },
  { zen: 0x0c1a3d, hor: 0x2f4a80, gnd: 0x1c2849, glowC: 0x4d62b5, glow: 0.12, sunC: 0x000000, az: SUNSET_AZ - 8, el: -24,
    fog: 0x24385f, fogN: 35, fogF: 520, hemiS: 0x4f6cc6, hemiG: 0x1b2238, hemiI: 1.0, lightC: 0x8eaaff, lightI: 0.95,
    rimC: 0x8fb2ff, rimS: 0.55, cLit: 0x6676a2, cShade: 0x29345c, win: 1, lamp: 1, fire: 1, stars: 1, moon: 1 },
];
const COLOR_KEYS = ['zen', 'hor', 'gnd', 'glowC', 'sunC', 'fog', 'hemiS', 'hemiG', 'lightC', 'rimC', 'cLit', 'cShade'];
const KC = KEYS.map(k => { const o = { ...k }; for (const c of COLOR_KEYS) o[c] = new THREE.Color(k[c]); return o; });
const WARM = new THREE.Color(0xffc472);
const _lightDir = new THREE.Vector3(), _tmpC = new THREE.Color();
let _lastT = -1, _night = 0;

export function setTOD(t) {
  t = clamp(+t || 0, 0, 4);
  if (Math.abs(t - _lastT) < 1e-5) return;
  _lastT = t;
  const i = Math.min(3, Math.floor(t)), f = t - i, a = KC[i], b = KC[i + 1];
  const L = key => a[key] + (b[key] - a[key]) * f;
  const LC = (key, out) => out.lerpColors(a[key], b[key], f);
  _night = clamp((t - 2) / 2, 0, 1);

  // céu
  LC('zen', skyU.uZenith.value); LC('hor', skyU.uHorizon.value); LC('gnd', skyU.uGround.value);
  LC('glowC', skyU.uGlowColor.value); skyU.uGlow.value = L('glow');
  LC('sunC', skyU.uSunColor.value);
  const el = L('el');
  dirFromAzEl(L('az'), el, sunDir);
  skyU.uSunDir.value.copy(sunDir);
  skyU.uSunVis.value = smooth(-2.5, 1.0, el);
  skyU.uMoonDir.value.copy(MOON_DIR);
  skyU.uMoonVis.value = L('moon');
  starU.uOpacity.value = L('stars') * 0.75;
  // névoa
  LC('fog', scene.fog.color); scene.fog.near = L('fogN'); scene.fog.far = L('fogF');
  renderer.setClearColor(scene.fog.color);
  // luzes: direcional segue o sol e passa para a lua no crepúsculo
  const moonW = smooth(2.55, 3.45, t);
  _lightDir.copy(sunDir).lerp(MOON_DIR, moonW);
  if (_lightDir.y < 0.12) _lightDir.y = 0.12;
  _lightDir.normalize();
  sun.position.copy(_lightDir).multiplyScalar(120);
  LC('lightC', sun.color); sun.intensity = L('lightI');
  LC('hemiS', hemi.color); LC('hemiG', hemi.groundColor); hemi.intensity = L('hemiI');
  LC('rimC', U.uRimColor.value); U.uRimStrength.value = L('rimS');
  // nuvens
  LC('cLit', cloudU.uLit.value); LC('cShade', cloudU.uShade.value); cloudU.uLightDir.value.copy(_lightDir);
  // janelas, lampiões, vaga-lumes
  const win = L('win'), lamp = L('lamp');
  glassMat.emissive.copy(WARM).multiplyScalar(win * 0.9);
  glassMat.color.setHex(0x5f86a3).lerp(_tmpC.setHex(0x3a4a66), _night);
  glowU.uWin.value = win; glowU.uLamp.value = lamp; glowU.uFire.value = L('fire');
  if (glowMesh) glowMesh.visible = win > 0.003 || lamp > 0.003 || glowU.uFire.value > 0.003;
  birdU.uVis.value = 1 - smooth(2.4, 3.1, t);
  if (birdMesh) birdMesh.visible = birdU.uVis.value > 0.01;
  birdU.uColor.value.setHex(0x2a2e3a).lerp(LC('fog', _tmpC), 0.25);
}

/** 0 até t=2 (pôr do sol), sobe linearmente até 1 em t=4. Gameplay liga as luzes dos UFOs com isso. */
export function nightAmount() { return _night; }

// =============================================================================
// COLISÃO / ALTURA DO CHÃO (portado do v2 + casa, cerca e obstáculos)
// =============================================================================
/** 0.4 na varanda, rampa linear 0.4→0 na frente central, 0 no resto. */
export function groundHeightAt(x, z) {
  if (Math.abs(x) <= 3.96 && z <= 0.5 && z >= -3.6) return PORCH_Y;
  if (Math.abs(x) < 1.35 && z > 0.5 && z < 1.7) return PORCH_Y * (1 - (z - 0.5) / 1.2);
  return 0;
}
// cruza a linha x = X com z (no ponto de cruzamento) dentro de [z0, z1]?
function crossX(ax, az, bx, bz, X, z0, z1) {
  if ((ax <= X) === (bx <= X)) return false;
  const t = (X - ax) / (bx - ax), z = az + (bz - az) * t;
  return z >= z0 && z <= z1;
}
function crossZ(ax, az, bx, bz, Z, x0, x1) {
  if ((az <= Z) === (bz <= Z)) return false;
  const t = (Z - az) / (bz - az), x = ax + (bx - ax) * t;
  return x >= x0 && x <= x1;
}
const PLAYER_R = 0.3;
const inBox = (x, z, o, pad) => Math.abs(x - o.x) < o.hx + pad && Math.abs(z - o.z) < o.hz + pad;
/** Obstáculo (galinheiro/fardos) em (x,z) com folga `pad`? Retorna o obstáculo ou null. */
export function obstacleAt(x, z, pad = 0) {
  for (const o of OBSTACLES) if (inBox(x, z, o, pad)) return o;
  return null;
}
/**
 * true se andar de (x0,z0) para (x1,z1) atravessa guarda-corpo, parede da casa, cerca
 * ou obstáculo. O vão da rampa (|x| < 1.35, z = 0.5) é livre; degraus > 0.12 m são
 * responsabilidade do gameplay (via groundHeightAt).
 */
export function blockedSeg(x0, z0, x1, z1) {
  // guarda-corpo da frente (dois lados do vão da rampa)
  if (crossZ(x0, z0, x1, z1, 0.5, 1.35, 4.0) || crossZ(x0, z0, x1, z1, 0.5, -4.0, -1.35)) return true;
  // guarda-corpos laterais
  if (crossX(x0, z0, x1, z1, 3.96, -3.6, 0.5) || crossX(x0, z0, x1, z1, -3.96, -3.6, 0.5)) return true;
  // casa
  if (crossZ(x0, z0, x1, z1, -3.6, -5.4, 5.4) || crossX(x0, z0, x1, z1, 5.4, -11.4, -3.6) || crossX(x0, z0, x1, z1, -5.4, -11.4, -3.6)) return true;
  // cerca do quintal
  if (crossX(x0, z0, x1, z1, 9.6, -3.8, 18.6) || crossX(x0, z0, x1, z1, -9.6, -3.8, 18.6)) return true;
  if (crossZ(x0, z0, x1, z1, 18.6, -9.6, 9.6)) return true;
  if (crossZ(x0, z0, x1, z1, -3.8, 5.4, 9.6) || crossZ(x0, z0, x1, z1, -3.8, -9.6, -5.4)) return true;
  // obstáculos: bloqueia entrar (sair é sempre permitido, para não prender ninguém)
  for (const o of OBSTACLES) if (inBox(x1, z1, o, PLAYER_R) && !inBox(x0, z0, o, PLAYER_R)) return true;
  return false;
}
