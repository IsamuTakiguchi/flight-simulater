// 実在空港の滑走路（標識・灯火・PAPI・進入灯）を描画
import * as THREE from 'three';
import { DEG, FT } from '../util/math.js';
import { distance, radii } from '../util/geo.js';
import { AIRPORTS } from '../data/airports.js';
import { worldUniforms, toWorld } from './shared.js';

// ---------- 共有テクスチャ ----------
function asphaltTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#3c3e41'; g.fillRect(0, 0, 256, 256);
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = `rgba(20,20,22,${Math.random() * 0.25})`;
    g.lineWidth = Math.random() * 3;
    g.beginPath(); const x = Math.random() * 256; g.moveTo(x, 0); g.lineTo(x + (Math.random() - 0.5) * 20, 256); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function designatorTexture(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 512);
  g.fillStyle = '#fff';
  const num = text.replace(/[LRC]/, ''), lr = text.replace(/[0-9]/g, '');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 230px Arial, Helvetica, sans-serif';
  g.save(); g.translate(128, 330); g.scale(0.8, 1.15); g.fillText(num.padStart(2, '0'), 0, 0); g.restore();
  if (lr) { g.save(); g.translate(128, 100); g.scale(0.8, 1.0); g.fillText(lr, 0, 0); g.restore(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

const groundVert = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv; varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
    #include <logdepthbuf_vertex>
  }`;
const groundFrag = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D uMap; uniform float uHasMap; uniform vec3 uColor; uniform float uOpacity;
  uniform float uDay; uniform vec3 uSunTint; uniform vec3 uFogColor; uniform float uVis; uniform float uCamAlt;
  uniform vec3 uLLPos; uniform vec3 uLLDir; uniform float uLLOn;
  varying vec2 vUv; varying vec3 vWorld;
  void main() {
    #include <logdepthbuf_fragment>
    vec4 tx = uHasMap > 0.5 ? texture2D(uMap, vUv) : vec4(1.0);
    vec3 base = uColor * tx.rgb;
    vec3 col = base * uSunTint * (0.035 + 0.965 * uDay);
    if (uLLOn > 0.5) {
      vec3 d = vWorld - uLLPos; float dist = length(d);
      float spot = smoothstep(0.93, 0.985, dot(d / dist, uLLDir)) * clamp(1.0 - dist / 900.0, 0.0, 1.0);
      col += base * spot * 2.4 * (1.0 - uDay);
    }
    float dist = length(vWorld - cameraPosition);
    float fog = 1.0 - exp(-2.5 * dist / (uVis * (1.0 + uCamAlt / 2500.0)));
    col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
    gl_FragColor = vec4(col, tx.a * uOpacity);
    #include <colorspace_fragment>
  }`;

export function groundMaterial(map, color, opacity = 1) {
  return new THREE.ShaderMaterial({
    vertexShader: groundVert, fragmentShader: groundFrag,
    uniforms: { ...worldUniforms, uMap: { value: map }, uHasMap: { value: map ? 1 : 0 }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
    transparent: opacity < 1 || !!(map && map.userData && map.userData.alpha),
    depthWrite: opacity >= 1,
  });
}

// ---------- 灯火シェーダ ----------
const lightVert = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 color2; attribute vec2 dir; attribute float kind; attribute float param; attribute float lsize;
  uniform float uTime; uniform float uDay; uniform float uVis; uniform float uPx;
  varying vec3 vCol; varying float vA;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vec3 toCam = cameraPosition - w.xyz;
    float dist = length(toCam);
    vec3 c = color;
    float a = 1.0;
    if (length(dir) > 0.1) {
      float f = dot(normalize(toCam.xz), dir);
      if (f >= 0.0) { a = smoothstep(-0.05, 0.25, f); }
      else { c = color2; a = smoothstep(0.05, -0.25, f); }
    }
    if (kind > 1.5) {            // PAPI
      float ang = degrees(atan(toCam.y, length(toCam.xz)));
      c = ang > param ? vec3(1.0, 0.97, 0.9) : vec3(1.0, 0.08, 0.05);
    } else if (kind > 0.5) {     // 連鎖式閃光灯
      float ph = fract(uTime * 2.0) - param;
      a *= ph > 0.0 && ph < 0.06 ? 1.0 : 0.0;
      c = vec3(1.4);
    }
    if (dot(c, c) < 0.001) a = 0.0;
    float fogT = exp(-dist / (uVis * 1.8));
    vA = a * fogT * mix(1.0, 0.45, uDay);
    vCol = c;
    float sz = lsize * 2600.0 / max(dist, 1.0);
    // 遠方でも点として視認できるよう最小サイズを確保し、輝度で距離感を出す
    vA *= clamp(sz / 3.0, 0.35, 1.0);
    gl_PointSize = clamp(sz, 3.0, 14.0) * uPx * (kind > 1.5 ? 1.4 : 1.0) * (kind > 0.5 && kind < 1.5 ? 1.6 : 1.0);
    gl_Position = projectionMatrix * viewMatrix * w;
    #include <logdepthbuf_vertex>
  }`;
const lightFrag = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_fragment>
  varying vec3 vCol; varying float vA;
  void main() {
    #include <logdepthbuf_fragment>
    float d = length(gl_PointCoord - 0.5);
    float core = 1.0 - smoothstep(0.12, 0.5, d);
    float a = vA * core;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vCol * a * 1.6, a);
    #include <colorspace_fragment>
  }`;

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  SHARED = {
    asphalt: asphaltTexture(),
    lightMat: new THREE.ShaderMaterial({
      vertexShader: lightVert, fragmentShader: lightFrag,
      uniforms: { ...worldUniforms, uPx: { value: Math.min(window.devicePixelRatio || 1, 2) } },
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
    whiteMat: null,
  };
  SHARED.paveMat = groundMaterial(SHARED.asphalt, 0xffffff);
  SHARED.shoulderMat = groundMaterial(null, 0x5d5b55);
  SHARED.markMat = groundMaterial(null, 0xeceee8);
  SHARED.rubberMat = groundMaterial(null, 0x111111, 0.35);
  return SHARED;
}

const W = [1, 1, 1], G = [0.1, 1, 0.25], R = [1, 0.1, 0.06], Y = [1, 0.8, 0.2], K = [0, 0, 0];

class AirportVisual {
  constructor(apt) {
    this.apt = apt;
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = true;
    const { RM, RN } = radii(apt.lat * DEG);
    this.ke = RN * Math.cos(apt.lat * DEG) * DEG; this.kn = RM * DEG;
    this.refElev = apt.elevFt * FT;
    this.build();
  }
  local(lat, lon) { return { x: (lon - this.apt.lon) * this.ke, z: -(lat - this.apt.lat) * this.kn }; }

  build() {
    const S = shared();
    const quads = { pave: [], shoulder: [], mark: [], rubber: [] };
    const lights = { pos: [], c1: [], c2: [], dir: [], kind: [], param: [], size: [] };
    const addLight = (p, c1, c2, dir, kind = 0, param = 0, size = 1) => {
      lights.pos.push(p.x, p.y, p.z); lights.c1.push(...c1); lights.c2.push(...c2);
      lights.dir.push(dir ? dir[0] : 0, dir ? dir[1] : 0); lights.kind.push(kind); lights.param.push(param); lights.size.push(size);
    };
    const done = new Set();
    for (const r of this.apt.runways) {
      const key = [r.id, r.opp].sort().join('/');
      if (done.has(key)) continue;
      done.add(key);
      const opp = this.apt.runways.find(x => x.id === r.opp) || { dispM: 0, id: r.opp };
      const a = this.local(r.lat, r.lon), b = this.local(r.endLat, r.endLon);
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;   // 滑走路方向（ワールド xz）
      const vx = -uz, vz = ux;                             // 右方向
      const e0 = r.elevFt * FT, e1 = r.endElevFt * FT;
      const Wd = Math.max(r.widthM, 45);
      const P = (u, v, dy = 0) => ({ x: a.x + ux * u + vx * v, z: a.z + uz * u + vz * v, y: e0 + (e1 - e0) * Math.min(Math.max(u / L, 0), 1) + dy });
      const quad = (arr, u0, u1, v0, v1, dy, uvScale) => arr.push({ p: [P(u0, v0, dy), P(u1, v0, dy), P(u1, v1, dy), P(u0, v1, dy)], uv: uvScale });
      // 舗装面・路肩
      quad(quads.shoulder, -60, L + 60, -Wd / 2 - 7.5, Wd / 2 + 7.5, 0.22);
      quad(quads.pave, -60, L + 60, -Wd / 2, Wd / 2, 0.30, [Wd / 40, (L + 120) / 40]);
      // 両端の標識
      const ends = [
        { s: 1, u0: 0, disp: r.dispM, id: r.id },
        { s: -1, u0: L, disp: opp.dispM || 0, id: r.opp },
      ];
      const mk = (uA, uB, vA, vB) => quad(quads.mark, Math.min(uA, uB), Math.max(uA, uB), Math.min(vA, vB), Math.max(vA, vB), 0.36);
      this.designators = this.designators || [];
      for (const e of ends) {
        const thr = e.u0 + e.s * e.disp;
        const U = (d) => thr + e.s * d;
        // 進入端標識（ピアノキー）
        const nStr = Wd >= 60 ? 16 : Wd >= 45 ? 12 : 8;
        const sw = 1.8, gap = 1.8;
        for (let i = 0; i < nStr / 2; i++) {
          const v = 3 + i * (sw + gap);
          mk(U(6), U(36), v, v + sw); mk(U(6), U(36), -v, -v - sw);
        }
        // 接地点標識（エイミングポイント）
        mk(U(400), U(460), 9, 19); mk(U(400), U(460), -9, -19);
        // 接地帯標識
        const tdz = [[150, 3], [300, 2], [450, 2], [600, 1], [750, 1], [900, 1]];
        for (const [d, cnt] of tdz) {
          if (d + 22.5 > L / 2) break;
          for (let k = 0; k < cnt; k++) {
            const v = 9 + k * 3.3;
            mk(U(d), U(d + 22.5), v, v + 1.8); mk(U(d), U(d + 22.5), -v, -v - 1.8);
          }
        }
        // タイヤ痕
        quad(quads.rubber, Math.min(U(250), U(1100)), Math.max(U(250), U(1100)), -10, 10, 0.33);
        // 滑走路番号
        this.designators.push({ text: e.id, P, u: U(42), s: e.s });
        // ---- 灯火 ----
        const dirF = [-ux * e.s, -uz * e.s];   // 灯火の向き（進入機の方向）
        // 進入端灯（緑）／ 反対側からは末端灯（赤）
        for (let v = -Wd / 2; v <= Wd / 2 + 0.01; v += 3) addLight(P(thr, v, 0.6), G, R, dirF, 0, 0, 1.2);
        // 接地帯灯
        for (let d = 60; d <= 900 && d < L / 2; d += 60) for (const side of [-1, 1]) for (let k = 0; k < 3; k++) {
          addLight(P(U(d), side * (9 + k * 1.5), 0.5), W, K, dirF, 0, 0, 0.8);
        }
        // PAPI（左側）
        const gpi = 50 * FT / Math.tan(3 * DEG) + 0;
        const ang = [3.5, 3.1667, 2.8333, 2.5];
        for (let i = 0; i < 4; i++) addLight(P(U(gpi), -e.s * (Wd / 2 + 15 + i * 9), 1.0), W, K, dirF, 2, ang[i], 1.4);
        // 進入灯（900 m・クロスバー・連鎖式閃光灯）
        for (let d = 30; d <= 900; d += 30) {
          const u = thr - e.s * d;
          for (let k = -2; k <= 2; k++) addLight(P(u, k * 1.0, 1.5), W, K, dirF, 0, 0, 1.0);
          if (d >= 300) addLight(P(u, 0, 2.2), W, K, dirF, 1, (900 - d) / 600 * 0.5, 1.2);
          if (d === 300) for (let v = 4; v <= 15; v += 1.5) { addLight(P(u, v, 1.5), W, K, dirF, 0, 0, 1.0); addLight(P(u, -v, 1.5), W, K, dirF, 0, 0, 1.0); }
          if (d === 150) for (let v = 3; v <= 9; v += 1.5) { addLight(P(u, v, 1.5), R, K, dirF, 0, 0, 1.0); addLight(P(u, -v, 1.5), R, K, dirF, 0, 0, 1.0); }
        }
      }
      // センターライン標識
      const c0 = r.dispM + 80, c1 = L - (opp.dispM || 0) - 80;
      for (let u = c0; u + 30 < c1; u += 50) mk(u, u + 30, -0.45, 0.45);
      // サイドストライプ
      mk(0, L, Wd / 2 - 1.4, Wd / 2 - 0.5); mk(0, L, -Wd / 2 + 0.5, -Wd / 2 + 1.4);
      // 滑走路灯（両側、60m 間隔）・中心線灯（15m 間隔、方向で色が変化）
      for (let u = 0; u <= L + 0.1; u += 60) for (const side of [-1, 1]) {
        const remF = L - u, remB = u;
        const cF = remF < 600 ? Y : W, cB = remB < 600 ? Y : W;
        addLight(P(u, side * (Wd / 2 + 1.5), 0.7), cF, cB, [-ux, -uz], 0, 0, 1.1);
      }
      for (let u = 15; u < L; u += 15) {
        const col = rem => rem < 300 ? R : rem < 900 ? ((Math.round(u / 15) % 2) ? R : W) : W;
        addLight(P(u, 0, 0.45), col(L - u), col(u), [-ux, -uz], 0, 0, 0.7);
      }
    }
    // ---- メッシュ化 ----
    const mkMesh = (arr, mat, uvMode) => {
      if (!arr.length) return;
      const pos = [], uv = [], idx = [];
      let k = 0;
      for (const q of arr) {
        for (const p of q.p) pos.push(p.x, p.y, p.z);
        const su = q.uv ? q.uv[0] : 1, sv = q.uv ? q.uv[1] : 1;
        uv.push(0, 0, 0, sv, su, sv, su, 0);
        idx.push(k, k + 2, k + 1, k, k + 3, k + 2, k, k + 1, k + 2, k, k + 2, k + 3);
        k += 4;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      const m = new THREE.Mesh(g, mat);
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };
    mkMesh(quads.shoulder, S.shoulderMat).renderOrder = 1;
    mkMesh(quads.pave, S.paveMat).renderOrder = 2;
    const rub = mkMesh(quads.rubber, S.rubberMat); if (rub) rub.renderOrder = 3;
    mkMesh(quads.mark, S.markMat).renderOrder = 4;
    // 滑走路番号
    for (const d of this.designators) {
      const tex = designatorTexture(d.text);
      tex.userData.alpha = true;
      const mat = groundMaterial(tex, 0xeceee8);
      const p0 = d.P(d.u, -6, 0.37), p1 = d.P(d.u + d.s * 18, -6, 0.37), p2 = d.P(d.u + d.s * 18, 6, 0.37), p3 = d.P(d.u, 6, 0.37);
      // テクスチャ上が進行方向（読み手は進入側）
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([p0, p1, p2, p3].flatMap(p => [p.x, p.y, p.z]), 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(d.s > 0 ? [0, 0, 0, 1, 1, 1, 1, 0] : [1, 0, 1, 1, 0, 1, 0, 0], 2));
      g.setIndex([0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]);
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 5;
      this.group.add(m);
    }
    // 灯火
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lights.pos, 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(lights.c1, 3));
    lg.setAttribute('color2', new THREE.Float32BufferAttribute(lights.c2, 3));
    lg.setAttribute('dir', new THREE.Float32BufferAttribute(lights.dir, 2));
    lg.setAttribute('kind', new THREE.Float32BufferAttribute(lights.kind, 1));
    lg.setAttribute('param', new THREE.Float32BufferAttribute(lights.param, 1));
    lg.setAttribute('lsize', new THREE.Float32BufferAttribute(lights.size, 1));
    this.lights = new THREE.Points(lg, S.lightMat);
    this.lights.frustumCulled = false;
    this.lights.renderOrder = 10;
    this.group.add(this.lights);
    // 局所座標の y は標高絶対値 → グループの y は曲率補正のみ
  }

  dispose() {
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material !== shared().lightMat && !Object.values(shared()).includes(o.material)) o.material.dispose(); });
  }
}

export class Airports {
  constructor(scene) {
    this.scene = scene;
    this.visuals = new Map();
    this._v = new THREE.Vector3();
  }
  update(origin) {
    for (const apt of AIRPORTS) {
      const d = distance(origin.lat, origin.lon, apt.lat, apt.lon);
      let v = this.visuals.get(apt.icao);
      if (d < 70000 && !v) {
        v = new AirportVisual(apt);
        this.visuals.set(apt.icao, v);
        this.scene.add(v.group);
      } else if (d > 90000 && v) {
        this.scene.remove(v.group); v.dispose(); this.visuals.delete(apt.icao); v = null;
      }
      if (v) {
        toWorld(apt.lat, apt.lon, 0, this._v);
        v.group.position.copy(this._v);
        v.group.visible = d < 60000;
        v.lights.visible = d < 60000;
      }
    }
  }
}
