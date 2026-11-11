// =============================================================================
// RENDER — renderer, cena, câmera, rig do jogador, materiais toon e helpers de modelagem
// Tudo que desenha usa daqui. Nenhum outro módulo cria WebGLRenderer.
// =============================================================================
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export { THREE };

// ---------- Sombra entonada pelo céu, em MULTIPLY (vale para TODO material toon) ----------
// Na faixa de sombra do toon, a luz é MULTIPLICADA pela cor do céu do momento (como uma camada
// "multiplicar"): a sombra fica mais escura e saturada no tom do céu — azul ao meio-dia,
// lilás no pôr do sol, azul-escura à noite. O céu vem da luz hemisférica (segue o céu real).
// O tom é normalizado pelo canal mais forte, então só escurece o que o céu "não tem".
const SKY_SHADOW_TINT = 1.0;   // 0 = sem tom · 1 = faixa mais escura multiplicada 100% pela cor do céu
THREE.ShaderChunk.lights_toon_pars_fragment = THREE.ShaderChunk.lights_toon_pars_fragment.replace(
  'vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;',
  `vec3 gi = getGradientIrradiance( geometryNormal, directLight.direction );
	vec3 irradiance = gi * directLight.color;
	#if NUM_HEMI_LIGHTS > 0
	{
		vec3 sky = hemisphereLights[ 0 ].skyColor;
		vec3 tint = mix( vec3( 1.0 ), sky / max( max( sky.r, sky.g ), max( sky.b, 1e-4 ) ), 0.7 );   // cor do céu (canal mais forte = 1), 70% saturada
		float sh = clamp( ( 1.0 - gi.r ) * 1.75 * ${SKY_SHADOW_TINT.toFixed(2)}, 0.0, 1.0 );  // 0 no claro · 1 na faixa escura
		irradiance *= mix( vec3( 1.0 ), tint, sh );                                // multiply
	}
	#endif`
);
/** Multiplicador das sombras projetadas (manchas no chão): tom do céu escurecido. world.setTOD atualiza. */
export const SHADOW_COLOR = new THREE.Color(0x101828);

export const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

// ---------- Renderer ----------
export const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.xr.enabled = true;
try { renderer.xr.setReferenceSpaceType('local-floor'); } catch (e) {}
try { renderer.xr.setFoveation(1); } catch (e) {}
renderer.domElement.id = 'game';
document.body.prepend(renderer.domElement);

export const xrActive = () => renderer.xr.isPresenting;

// ---------- Cena, câmera e rig ----------
export const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfe0f0, 50, 300);

export const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.05, 700);
camera.position.set(0, 1.25, 0); // altura dos olhos sentado na cadeira (fora do VR)

// O rig é o "corpo" do jogador: anda, gira e voa. Câmera e controles são filhos dele.
export const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Posição/direção da cabeça no mundo (atualizadas pelo loop no começo de cada frame)
export const camPos = new THREE.Vector3();
export const camDir = new THREE.Vector3(0, 0, 1);
export function updateCamWorld() { camera.getWorldPosition(camPos); camera.getWorldDirection(camDir); }

// Fonte dos textos desenhados em canvas (carregada no index.html)
export const FONT = '"Lilita One", "Arial Black", Impact, sans-serif';
export const FONT_UI = '"Nunito", "Helvetica Neue", Arial, sans-serif';

/** Distância para um objeto de meia-largura `halfW` caber na largura da tela (celular em pé). No VR, devolve `min`. */
export function fitDistance(halfW, min) {
  if (renderer.xr.isPresenting) return min;
  const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect);
  return Math.max(min, halfW / Math.tan(hHalf * 0.92));
}

// ---------- Uniforms compartilhados (o ciclo dia/noite mexe aqui) ----------
export const U = {
  uTime: { value: 0 },
  uRimColor: { value: new THREE.Color(0xfff2d0) },
  uRimStrength: { value: 0.35 },
  uWind: { value: 1 },
};

// ---------- Rampa toon ----------
function gradientTex(steps) {
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255; });
  const t = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}
export const RAMP3 = gradientTex([110, 190, 255]);
export const RAMP4 = gradientTex([90, 150, 210, 255]);

// MeshToonMaterial + luz de contorno (rim). Barato no Quest: 1 luz direcional + hemisférica.
const _toonCache = new Map();
function patchRim(shader) {
  shader.uniforms.uRimColor = U.uRimColor;
  shader.uniforms.uRimStrength = U.uRimStrength;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;')
    .replace('#include <opaque_fragment>', `#include <opaque_fragment>
  {
    float rimF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
    gl_FragColor.rgb += uRimColor * (rimF * rimF * rimF) * uRimStrength;
  }`);
}
/**
 * Material toon compartilhado.
 * @param {object} o  { color, vertexColors=true, rim=true, emissive, emissiveIntensity, transparent, opacity, side, ramp }
 */
export function toon(o = {}) {
  const key = JSON.stringify(o);
  if (_toonCache.has(key)) return _toonCache.get(key);
  const m = new THREE.MeshToonMaterial({
    color: o.color !== undefined ? o.color : 0xffffff,
    vertexColors: o.vertexColors !== false,
    gradientMap: o.ramp === 4 ? RAMP4 : RAMP3,
    emissive: o.emissive !== undefined ? o.emissive : 0x000000,
    emissiveIntensity: o.emissiveIntensity !== undefined ? o.emissiveIntensity : 1,
    transparent: !!o.transparent,
    opacity: o.opacity !== undefined ? o.opacity : 1,
    side: o.side !== undefined ? o.side : THREE.FrontSide,
  });
  if (o.rim !== false) {
    m.onBeforeCompile = patchRim;
    m.customProgramCacheKey = () => 'toonrim';
  }
  _toonCache.set(key, m);
  return m;
}

// Material único (não compartilhado) — para quem precisa animar cor/emissive por objeto.
export function toonUnique(o = {}) {
  const m = new THREE.MeshToonMaterial({
    color: o.color !== undefined ? o.color : 0xffffff,
    vertexColors: o.vertexColors !== false,
    gradientMap: o.ramp === 4 ? RAMP4 : RAMP3,
    emissive: o.emissive !== undefined ? o.emissive : 0x000000,
    transparent: !!o.transparent,
    opacity: o.opacity !== undefined ? o.opacity : 1,
  });
  if (o.rim !== false) { m.onBeforeCompile = patchRim; m.customProgramCacheKey = () => 'toonrim'; }
  return m;
}

// Contorno estilo cartoon (inverted hull). Use com outlineGeo(geo) para não abrir nas quinas.
const _outlineCache = new Map();
export function outlineMat(width = 0.012, color = 0x1a1420) {
  const key = width + ':' + color;
  if (_outlineCache.has(key)) return _outlineCache.get(key);
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = sh => {
    sh.uniforms.uOutline = { value: width };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutline;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * uOutline;');
  };
  m.customProgramCacheKey = () => 'outline' + width;
  _outlineCache.set(key, m);
  return m;
}
/** Versão "lisa" da geometria (vértices soldados, normais suaves) para o contorno. */
export function outlineGeo(geo) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.getAttribute('position').clone());
  if (geo.index) g.setIndex(geo.index.clone());
  const m = mergeVertices(g, 1e-3);
  m.computeVertexNormals();
  return m;
}
/** Malha + contorno como filho (o contorno herda transformações). */
export function withOutline(mesh, width = 0.012, color = 0x1a1420) {
  const o = new THREE.Mesh(outlineGeo(mesh.geometry), outlineMat(width, color));
  o.raycast = () => {};
  mesh.add(o);
  mesh.userData.outline = o;
  return mesh;
}

// Materiais básicos prontos
export const MAT = {
  flat: toon({ ramp: 3 }),           // geometria facetada (normais por face vêm do bake)
  smooth: toon({ ramp: 4 }),         // geometria arredondada
  basicVC: new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }),
  basicVCnoFog: new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }),
};

// ---------- Modelagem procedural ----------
// Constrói num THREE.Group usando os helpers abaixo (cada malha leva sua cor em userData.c),
// depois bake(group) funde tudo numa BufferGeometry com cores por vértice = 1 draw call.
const _col = new THREE.Color();
function colorize(geo, hex) {
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  _col.set(hex);
  for (let i = 0; i < n; i++) { arr[i * 3] = _col.r; arr[i * 3 + 1] = _col.g; arr[i * 3 + 2] = _col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}
/**
 * Funde as malhas de um grupo numa geometria só (cores por vértice).
 * @param {THREE.Object3D} root
 * @param {object} o { flat: true → normais por face (visual facetado) }
 */
export function bake(root, o = {}) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const geos = [];
  root.traverse(m => {
    if (!m.isMesh || m.userData.noBake) return;
    let g = m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (g.index) g = g.toNonIndexed();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const hex = m.userData.c !== undefined ? m.userData.c : (m.material && m.material.color ? m.material.color.getHex() : 0xffffff);
    colorize(g, hex);
    if (o.flat || m.userData.flat) g.computeVertexNormals();
    geos.push(g);
  });
  if (!geos.length) return new THREE.BufferGeometry();
  const out = mergeGeometries(geos, false);
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}
/** Atalho: constrói com fn(group) e devolve a geometria fundida. */
export function bakeWith(fn, o = {}) { const g = new THREE.Group(); fn(g); return bake(g, o); }

// Primitivas (todas retornam a malha para ajustar rotação/escala depois)
const _dummyMat = new THREE.MeshBasicMaterial();
export function add(g, geo, hex, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, _dummyMat);
  m.userData.c = hex;
  m.position.set(x, y, z);
  g.add(m);
  return m;
}
export const box = (g, w, h, d, hex, x, y, z) => add(g, new THREE.BoxGeometry(w, h, d), hex, x, y, z);
export const cyl = (g, rt, rb, h, seg, hex, x, y, z) => add(g, new THREE.CylinderGeometry(rt, rb, h, seg), hex, x, y, z);
export const sph = (g, r, hex, x, y, z, ws = 12, hs = 8) => add(g, new THREE.SphereGeometry(r, ws, hs), hex, x, y, z);
export const cone = (g, r, h, seg, hex, x, y, z) => add(g, new THREE.ConeGeometry(r, h, seg), hex, x, y, z);
export const ico = (g, r, hex, x, y, z, detail = 0) => add(g, new THREE.IcosahedronGeometry(r, detail), hex, x, y, z);
export const torus = (g, r, t, rs, ts, hex, x, y, z) => add(g, new THREE.TorusGeometry(r, t, rs, ts), hex, x, y, z);
/** Lathe a partir de pontos [r, y]. */
export const lathe = (g, pts, seg, hex, x = 0, y = 0, z = 0) => add(g, new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg), hex, x, y, z);

// ---------- Texturas de canvas ----------
export function canvasTex(w, h, draw, o = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = o.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (o.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (o.nearest) { t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; }
  t.anisotropy = o.aniso || 1;
  return t;
}
export function roundRect(x, px, py, w, h, r) {
  x.beginPath();
  x.moveTo(px + r, py);
  x.arcTo(px + w, py, px + w, py + h, r);
  x.arcTo(px + w, py + h, px, py + h, r);
  x.arcTo(px, py + h, px, py, r);
  x.arcTo(px, py, px + w, py, r);
  x.closePath();
}

// Texturas utilitárias compartilhadas
export const TEX = {
  glow: canvasTex(64, 64, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  }),
  shadow: canvasTex(64, 64, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    // branca com alfa: a cor vem do material (SHADOW_COLOR, tom do céu)
    g.addColorStop(0, 'rgba(255,255,255,0.62)'); g.addColorStop(0.6, 'rgba(255,255,255,0.3)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  }),
  ring: canvasTex(128, 128, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.75, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  }),
};

// ---------- Utilidades de vetor ----------
export const UP = new THREE.Vector3(0, 1, 0);
/** Estica uma malha cilíndrica unitária (altura 1 em Y) entre os pontos a e b. */
const _seg = new THREE.Vector3();
export function placeSegment(mesh, a, b, width) {
  _seg.subVectors(b, a);
  const len = _seg.length();
  mesh.position.copy(a).addScaledVector(_seg, 0.5);
  if (len > 1e-6) mesh.quaternion.setFromUnitVectors(UP, _seg.multiplyScalar(1 / len));
  mesh.scale.set(width, len, width);
}
