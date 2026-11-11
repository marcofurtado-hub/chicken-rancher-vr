// =============================================================================
// SKY — cúpula (gradiente + sol + lua no shader), estrelas discretas, nuvens fofas
// Tudo controlado por uniforms; world.js (setTOD) só escreve valores aqui.
// Custo: 3 draw calls (cúpula, estrelas, nuvens). Nada aloca por frame.
// =============================================================================
import { THREE, scene, renderer, bake, ico } from './render.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const SKY_R = 650;   // raio da cúpula (câmera far = 700)
const STAR_R = 600;

// Empurra o vértice para "quase o far plane": a cúpula nunca é cortada, mesmo se
// a câmera do XR usar um far diferente. depthWrite=false → não atrapalha nada.
const FAR_CLAMP = 'gl_Position.z = gl_Position.w * 0.99999;';

// ---------- Cúpula ----------
export const skyU = {
  uZenith: { value: new THREE.Color(0x2f86e0) },
  uHorizon: { value: new THREE.Color(0xbfe4f7) },
  uGround: { value: new THREE.Color(0xd5ecf3) },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(0xfffbe8) },
  uSunVis: { value: 1 },
  uGlowColor: { value: new THREE.Color(0xfff3d0) },
  uGlow: { value: 0.3 },
  uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
  uMoonColor: { value: new THREE.Color(0xeef2ff) },
  uMoonVis: { value: 0 },
};

const skyMat = new THREE.ShaderMaterial({
  uniforms: skyU,
  vertexShader: /* glsl */`
    varying vec3 vW;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
      ${FAR_CLAMP}
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor, uGlowColor, uMoonDir, uMoonColor;
    uniform float uSunVis, uGlow, uMoonVis;
    varying vec3 vW;
    float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float dot2(vec2 v) { return dot(v, v); }
    void main() {
      vec3 d = normalize(vW - cameraPosition);
      float y = d.y;
      // gradiente: faixa de horizonte larga e suave, zênite calmo (UFOs leem bem contra ele)
      vec3 col = mix(uHorizon, uZenith, pow(smoothstep(0.0, 1.0, max(y, 0.0)), 0.5));
      col = mix(col, uGround, smoothstep(0.0, -0.10, y));
      // brilho do sol: halo largo só perto do horizonte + halo médio + coroa
      float sd = dot(d, uSunDir);
      float s = max(sd, 0.0);
      float hz = 1.0 - smoothstep(0.0, 0.55, abs(y));
      col += uGlowColor * uGlow * (pow(s, 4.0) * 0.5 * hz + pow(s, 22.0) * 0.35 + pow(s, 380.0) * 0.55);
      // disco do sol (borda nítida, estilo toon)
      float disk = smoothstep(0.99930, 0.99946, sd);
      col = mix(col, uSunColor, disk * uSunVis);
      // lua: halo discreto + disco com crateras simples
      if (uMoonVis > 0.001) {
        float md = dot(d, uMoonDir);
        float mh = max(md, 0.0);
        col += uMoonColor * uMoonVis * (pow(mh, 80.0) * 0.07 + pow(mh, 1500.0) * 0.12);
        if (md > 0.998) {
          vec3 t = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
          vec3 b = cross(t, uMoonDir);
          vec2 mp = vec2(dot(d, t), dot(d, b)) / 0.028;
          float r = length(mp);
          float m = 1.0 - smoothstep(0.93, 1.0, r);
          float sh = 0.96 + 0.06 * mp.y;
          sh -= 0.10 * (1.0 - smoothstep(0.20, 0.27, length(mp - vec2(-0.32, 0.22))));
          sh -= 0.08 * (1.0 - smoothstep(0.13, 0.18, length(mp - vec2(0.36, -0.18))));
          sh -= 0.07 * (1.0 - smoothstep(0.10, 0.14, length(mp - vec2(0.02, -0.52))));
          sh -= 0.06 * (1.0 - smoothstep(0.07, 0.11, length(mp - vec2(0.46, 0.42))));
          col = mix(col, uMoonColor * sh, m * uMoonVis);
        }
      }
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
      gl_FragColor.rgb += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;   // dithering anti-banding
    }`,
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
});
const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_R, 40, 20), skyMat);
// desenhado DEPOIS do cenário opaco: o teste de profundidade descarta os pixels cobertos
// (antes o céu era pintado na tela inteira e o chão por cima — o dobro de pixels no Quest)
skyMesh.renderOrder = 1000;
skyMesh.frustumCulled = false;
skyMesh.name = 'sky';

// ---------- Estrelas (poucas, pequenas, fracas) ----------
export const starU = {
  uTime: null,               // ligado a U.uTime em initSky
  uPx: { value: 1 },         // escala de pixels (1 = tela de ~1080 px de altura)
  uOpacity: { value: 0 },
};
let starPoints = null;
function buildStars(rnd) {
  const N = 200;
  const pos = new Float32Array(N * 3), size = new Float32Array(N), bright = new Float32Array(N);
  const phase = new Float32Array(N), col = new Float32Array(N * 3);
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    // distribuição uniforme em área no hemisfério de cima (acima de ~7°)
    const y = 0.12 + rnd() * 0.88, th = rnd() * Math.PI * 2, r = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(th) * r * STAR_R; pos[i * 3 + 1] = y * STAR_R; pos[i * 3 + 2] = Math.sin(th) * r * STAR_R;
    const big = rnd() < 0.08;
    size[i] = big ? 2.4 + rnd() * 0.4 : 1.7 + rnd() * 0.7;
    bright[i] = big ? 0.9 : 0.4 + rnd() * rnd() * 0.55;
    phase[i] = rnd();
    c.setHex([0xffffff, 0xdfe8ff, 0xfff1d8, 0xe8f0ff][Math.floor(rnd() * 4)]);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  const m = new THREE.ShaderMaterial({
    uniforms: starU,
    vertexShader: /* glsl */`
      uniform float uTime, uPx, uOpacity;
      attribute float aSize, aBright, aPhase;
      attribute vec3 aColor;
      varying vec3 vC; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        ${FAR_CLAMP}
        float tw = 0.78 + 0.22 * sin(uTime * (0.5 + aPhase * 1.6) + aPhase * 37.0);
        float el = normalize(position).y;
        vA = uOpacity * aBright * tw * smoothstep(0.10, 0.35, el);
        vC = aColor;
        gl_PointSize = aSize * uPx;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC; varying float vA;
      void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(c, c);
        if (r2 > 1.0) discard;
        float a = 1.0 - r2 * r2;            // disco quase chapado: ponto pequeno mas legível
        gl_FragColor = vec4(vC, a * vA);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  starPoints = new THREE.Points(g, m);
  starPoints.frustumCulled = false;
  starPoints.renderOrder = -9;
  starPoints.name = 'stars';
  return starPoints;
}

// ---------- Nuvens (cúmulos low-poly fundidos numa malha, giram devagar) ----------
export const cloudU = {
  uLit: { value: new THREE.Color(0xffffff) },
  uShade: { value: new THREE.Color(0xc6d8ee) },
  uLightDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunDir: skyU.uSunDir,
  uGlowColor: skyU.uGlowColor,
  uGlow: skyU.uGlow,
  uHorizon: skyU.uHorizon,
};
let cloudMesh = null;
function buildClouds(rnd) {
  const geos = [];
  const N = 12;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < N; i++) {
    const g = new THREE.Group();
    const maxR = 8 + rnd() * 6, len = maxR * (2.4 + rnd() * 1.6);
    const n = 5 + Math.floor(rnd() * 3);
    // fileira principal: blobs que se sobrepõem bem, maiores no meio
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1) * 2 - 1;                     // -1..1 ao longo da nuvem
      const r = maxR * (0.62 + rnd() * 0.2) * (1 - u * u * 0.5);
      const b = ico(g, r, 0xffffff, u * len * 0.5, r * (0.1 + rnd() * 0.2), (rnd() - 0.5) * maxR * 0.5, 1);
      b.scale.set(1.2, 0.78, 1.05);
    }
    // corcovas de cima (cúmulo) e blobs de profundidade
    for (let k = 0; k < 2; k++) {
      const top = ico(g, maxR * (0.65 + rnd() * 0.25), 0xffffff, (rnd() - 0.5) * len * 0.45, maxR * (0.5 + rnd() * 0.25), (rnd() - 0.5) * maxR * 0.4, 1);
      top.scale.set(1.1, 0.85, 1);
    }
    for (let k = 0; k < 2; k++) {
      const d = ico(g, maxR * 0.55, 0xffffff, (rnd() - 0.5) * len * 0.6, maxR * 0.05, (k ? 1 : -1) * maxR * 0.55, 1);
      d.scale.set(1.3, 0.7, 1);
    }
    const geo = bake(g, {});
    // base achatada (cúmulo clássico)
    const pa = geo.getAttribute('position');
    for (let v = 0; v < pa.count; v++) if (pa.getY(v) < 0) pa.setY(v, pa.getY(v) * 0.12);
    geo.deleteAttribute('color');
    geo.computeVertexNormals();   // não-indexada → normais por face (facetado)
    // posição no anel: mais nuvens nas laterais/atrás; poucas na frente (céu calmo pros UFOs)
    let az = (i / N) * Math.PI * 2 + (rnd() - 0.5) * 0.35;
    const d = 230 + rnd() * 190, h = 48 + rnd() * 62;
    p.set(Math.sin(az) * d, h, Math.cos(az) * d);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), az + (rnd() - 0.5) * 0.5);   // alongada na tangente do anel
    s.setScalar(0.8 + rnd() * 0.5);
    m4.compose(p, q, s);
    geo.applyMatrix4(m4);
    geos.push(geo);
  }
  const merged = mergeGeometries(geos, false);
  const mat = new THREE.ShaderMaterial({
    uniforms: cloudU,
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vW;
      void main() {
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uLit, uShade, uLightDir, uSunDir, uGlowColor, uHorizon;
      uniform float uGlow;
      varying vec3 vN; varying vec3 vW;
      void main() {
        vec3 n = normalize(vN);
        float l = dot(n, uLightDir);
        float band = smoothstep(-0.08, 0.08, l);                 // 2 tons, estilo toon
        vec3 c = mix(uShade, uLit, band * 0.85 + 0.15 * max(n.y, 0.0));
        vec3 vd = normalize(vW - cameraPosition);
        float sb = pow(max(dot(vd, uSunDir), 0.0), 5.0);         // contraluz: borda "prateada"
        float rim = pow(1.0 - max(dot(-vd, n), 0.0), 2.0);
        c += uGlowColor * uGlow * sb * rim * 0.8;
        c = mix(uHorizon, c, 0.45 + 0.55 * smoothstep(0.0, 0.25, vd.y));   // some no horizonte
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    fog: false,
  });
  cloudMesh = new THREE.Mesh(merged, mat);
  cloudMesh.frustumCulled = false;
  cloudMesh.renderOrder = 999;   // depois do cenário, antes da cúpula
  cloudMesh.name = 'clouds';
  return cloudMesh;
}

/** Cria cúpula, estrelas e nuvens e adiciona à cena. */
export function initSky(U, rnd) {
  starU.uTime = U.uTime;
  scene.add(skyMesh);
  scene.add(buildStars(rnd));
  scene.add(buildClouds(rnd));
}

// Escala dos pontos de estrela: tamanho em pixels relativo a uma tela de 1080 px de altura,
// para ficar com o mesmo tamanho angular no PC, no celular e em cada olho do Quest.
const _v2 = new THREE.Vector2();
let starBasePx = 1;
/** Ajusta o tamanho base das estrelas (1 = padrão ~1.5–2.9 px numa tela 1080p). */
export function setStarSize(k) { starBasePx = k; }
function viewportHeight() {
  if (renderer.xr.isPresenting) {
    const cams = renderer.xr.getCamera().cameras;
    if (cams.length && cams[0].viewport) return cams[0].viewport.w;
    return 1800;
  }
  renderer.getDrawingBufferSize(_v2);
  return _v2.y;
}

export function updateSky(dt, wind) {
  if (cloudMesh) cloudMesh.rotation.y += dt * 0.0022 * (0.5 + 0.5 * wind);
  const h = viewportHeight();
  starU.uPx.value = starBasePx * Math.min(2.4, Math.max(0.85, h / 1080));
  if (starPoints) starPoints.visible = starU.uOpacity.value > 0.005;
}
