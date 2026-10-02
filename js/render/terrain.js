// 地形タイル（国土地理院 シームレス空中写真 + 標高タイル）を四分木 LOD で表示
import * as THREE from 'three';
import { DEG } from '../util/math.js';
import { lonToTileX, latToTileY, tileXToLon, tileYToLat, distance } from '../util/geo.js';
import { worldUniforms, curvatureChunk } from './shared.js';

const PHOTO_URL = 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg';
const DEM_URL = 'https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png';
const DEM_ZOOMS = [14, 12, 10, 8, 6];
const ROOT_Z = 7;
const SEG = 32;

function demZoomFor(z) { for (const dz of DEM_ZOOMS) if (dz <= z) return dz; return 6; }

const vert = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform vec2 uTileOffset;   // タイル中心 − 原点 (度)
  uniform vec2 uK;            // m/度 (東, 北)
  varying vec2 vUv;
  varying vec3 vWorld;
  ${curvatureChunk}
  void main() {
    vec3 p;
    p.x = (uTileOffset.x + position.x) * uK.x;
    p.z = -(uTileOffset.y + position.z) * uK.y;
    p.y = position.y;
    p.y -= curvatureDrop(p.xz);
    vUv = uv;
    vWorld = p;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const frag = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D uMap;
  uniform float uHasMap;
  uniform vec3 uFallback;
  uniform float uDay;
  uniform vec3 uSunTint;
  uniform vec3 uFogColor;
  uniform float uVis;
  uniform float uCamAlt;
  uniform float uNight;
  uniform vec3 uLLPos;
  uniform vec3 uLLDir;
  uniform float uLLOn;
  varying vec2 vUv;
  varying vec3 vWorld;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    #include <logdepthbuf_fragment>
    vec3 base = uHasMap > 0.5 ? texture2D(uMap, vUv).rgb : uFallback;
    if (uHasMap < 0.5) {
      // 写真が無い場合はノイズで地表の変化を表現
      vec2 q = vWorld.xz + vec2(1.0e5);
      float n = hash(floor(q / 260.0)) * 0.5 + hash(floor(q / 61.0)) * 0.3 + hash(floor(q / 13.0)) * 0.2;
      base *= 0.78 + 0.44 * n;
    }
    vec3 col = base * uSunTint * (0.04 + 0.96 * uDay);
    // 夜間: 市街地（低彩度・中明度の画素）に街明かりを散らす
    if (uNight > 0.01 && uHasMap > 0.5) {
      float g = dot(base, vec3(0.333));
      float sat = max(base.r, max(base.g, base.b)) - min(base.r, min(base.g, base.b));
      float urban = smoothstep(0.10, 0.22, g) * (1.0 - smoothstep(0.05, 0.12, sat));
      vec2 cell = floor(vWorld.xz / 18.0 + vec2(1000.0));
      float sp = step(0.82, hash(cell));
      col += vec3(1.0, 0.72, 0.38) * urban * sp * uNight * 0.9;
      col += vec3(0.5, 0.35, 0.2) * urban * uNight * 0.05;
    }
    // 着陸灯
    if (uLLOn > 0.5) {
      vec3 d = vWorld - uLLPos;
      float dist = length(d);
      float c = dot(d / dist, uLLDir);
      float spot = smoothstep(0.93, 0.985, c) * clamp(1.0 - dist / 900.0, 0.0, 1.0);
      col += base * spot * 2.2 * (1.0 - uDay);
    }
    // 大気遠近（ケーシュミーダー則）
    float dist = length(vWorld - cameraPosition);
    float vis = uVis * (1.0 + uCamAlt / 2500.0);
    float fog = 1.0 - exp(-2.5 * dist / vis);
    col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

class Tile {
  constructor(z, x, y) {
    this.z = z; this.x = x; this.y = y;
    this.key = `${z}/${x}/${y}`;
    this.west = tileXToLon(x, z); this.east = tileXToLon(x + 1, z);
    this.north = tileYToLat(y, z); this.south = tileYToLat(y + 1, z);
    this.lonC = (this.west + this.east) / 2; this.latC = (this.north + this.south) / 2;
    this.sizeM = (this.east - this.west) * DEG * 6371000 * Math.cos(this.latC * DEG);
    this.state = 'new';
    this.mesh = null; this.children = null;
    this.minH = 0; this.maxH = 0;
    this.lastUsed = 0;
  }
}

export class Terrain {
  constructor(scene, elevation, opts = {}) {
    this.scene = scene;
    this.elev = elevation;
    this.enabled = opts.enabled !== false;
    this.group = new THREE.Group();
    this.group.frustumCulled = false;
    scene.add(this.group);
    this.tiles = new Map();
    this.queue = [];
    this.active = 0;
    this.maxActive = 8;
    this.demPromises = new Map();
    this.frame = 0;
    this.stats = { tiles: 0, visible: 0, loading: 0, failed: 0 };
    this.maxZ = 16;
    this.splitK = 1.9;
    this.netOk = true;
    this.anisotropy = opts.anisotropy || 4;
    this.fallbackLand = new THREE.Color(0.20, 0.27, 0.15);
    this.fallbackSea = new THREE.Color(0.05, 0.12, 0.20);
    this.frustum = new THREE.Frustum();
    this.projScreen = new THREE.Matrix4();
    this._sphere = new THREE.Sphere();
    this.errors = 0;
  }

  getTile(z, x, y) {
    const n = 1 << z;
    x = ((x % n) + n) % n;
    const key = `${z}/${x}/${y}`;
    let t = this.tiles.get(key);
    if (!t) { t = new Tile(z, x, y); this.tiles.set(key, t); }
    return t;
  }

  // ---------- DEM 読み込み ----------
  loadDem(z, x, y) {
    const key = `${z}/${x}/${y}`;
    if (this.elev.hasTile(z, x, y)) return Promise.resolve();
    if (this.demPromises.has(key)) return this.demPromises.get(key);
    const url = DEM_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    const p = fetch(url).then(async res => {
      const arr = new Float32Array(256 * 256);
      if (res.status === 404) { arr.fill(NaN); this.elev.addTile(z, x, y, arr); return; }   // 海域など
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const bmp = await createImageBitmap(await res.blob());
      const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, 256, 256).data;
      for (let i = 0; i < 65536; i++) {
        const v = d[i * 4] * 65536 + d[i * 4 + 1] * 256 + d[i * 4 + 2];
        arr[i] = v === 8388608 ? NaN : (v < 8388608 ? v : v - 16777216) * 0.01;
      }
      this.elev.addTile(z, x, y, arr);
      this.okCount = (this.okCount || 0) + 1;
    }).catch(err => {
      // 通信エラー: キャッシュせず後で再試行
      this.demPromises.delete(key);
      this.netErrors = (this.netErrors || 0) + 1;
      if (!this.okCount && this.netErrors > 12) this.netOk = false;
      throw err;
    });
    this.demPromises.set(key, p);
    return p;
  }

  /** 航空写真（404 は写真なし＝ null、通信エラーは例外） */
  async loadImage(z, x, y) {
    const res = await fetch(PHOTO_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('HTTP ' + res.status);
    this.okCount = (this.okCount || 0) + 1;
    this.netOk = true;
    return createImageBitmap(await res.blob());
  }

  async buildTile(t) {
    t.state = 'loading';
    this.active++;
    try {
      const dz = demZoomFor(t.z);
      const f = 1 << (t.z - dz);
      // オフライン（または地形 OFF）時は簡易地形で生成
      const online = this.enabled && this.netOk !== false;
      const demP = online ? this.loadDem(dz, Math.floor(t.x / f), Math.floor(t.y / f)) : Promise.resolve();
      const imgP = online ? this.loadImage(t.z, t.x, t.y) : Promise.resolve(null);
      const [, img] = await Promise.all([demP, imgP]);
      if (t.state === 'disposed') return;
      this.createMesh(t, img);
      t.state = 'ready';
    } catch (e) {
      // 通信失敗: 一定時間後に再要求
      if (t.state !== 'disposed') { t.state = 'new'; t.retryAt = performance.now() / 1000 + 2 + Math.random() * 3; }
      this.errors++;
    } finally {
      this.active--;
    }
  }

  createMesh(t, img) {
    const n = SEG + 1;
    const vCount = n * n + 4 * n;
    const pos = new Float32Array(vCount * 3);
    const uv = new Float32Array(vCount * 2);
    let minH = 1e9, maxH = -1e9, sea = 0;
    const heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      const ty = t.y + j / SEG;
      const lat = tileYToLat(ty, t.z);
      for (let i = 0; i < n; i++) {
        const lon = t.west + (t.east - t.west) * i / SEG;
        let h = this.elev.height(lat, lon);
        if (!Number.isFinite(h)) h = 0;
        if (h === 0) sea++;
        heights[j * n + i] = h;
        minH = Math.min(minH, h); maxH = Math.max(maxH, h);
        const k = j * n + i;
        pos[k * 3] = lon - t.lonC; pos[k * 3 + 1] = h; pos[k * 3 + 2] = lat - t.latC;
        uv[k * 2] = i / SEG; uv[k * 2 + 1] = j / SEG;   // ImageBitmap は flipY なし
      }
    }
    // スカート（LOD 境界の隙間隠し）
    const skirt = Math.max(15, t.sizeM * 0.015);
    let k = n * n;
    const edges = [];
    const pushEdge = (idxs) => {
      const start = k;
      for (const src of idxs) {
        pos[k * 3] = pos[src * 3]; pos[k * 3 + 1] = pos[src * 3 + 1] - skirt; pos[k * 3 + 2] = pos[src * 3 + 2];
        uv[k * 2] = uv[src * 2]; uv[k * 2 + 1] = uv[src * 2 + 1];
        k++;
      }
      edges.push({ src: idxs, start });
    };
    const top = [], bottom = [], left = [], right = [];
    for (let i = 0; i < n; i++) { top.push(i); bottom.push(SEG * n + i); left.push(i * n); right.push(i * n + SEG); }
    pushEdge(top); pushEdge(bottom); pushEdge(left); pushEdge(right);
    const idx = [];
    for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    for (const e of edges) {
      for (let i = 0; i < SEG; i++) {
        const a = e.src[i], b = e.src[i + 1], c = e.start + i, d = e.start + i + 1;
        idx.push(a, b, c, b, d, c, a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    let tex = null;
    if (img) {
      tex = new THREE.Texture(img);
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.anisotropy;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.needsUpdate = true;
    }
    const mostlySea = sea > n * n * 0.6;
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag,
      uniforms: {
        ...worldUniforms,
        uTileOffset: { value: new THREE.Vector2() },
        uMap: { value: tex },
        uHasMap: { value: tex ? 1 : 0 },
        uFallback: { value: mostlySea ? this.fallbackSea : this.fallbackLand },
      },
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    t.mesh = mesh; t.minH = minH; t.maxH = maxH; t.tex = tex;
    this.group.add(mesh);
  }

  disposeTile(t) {
    if (t.mesh) {
      this.group.remove(t.mesh);
      t.mesh.geometry.dispose();
      t.mesh.material.dispose();
      if (t.tex) { t.tex.dispose(); if (t.tex.image && t.tex.image.close) t.tex.image.close(); }
    }
    t.mesh = null; t.state = 'disposed';
    this.tiles.delete(t.key);
  }

  request(t, prio) {
    if (t.state !== 'new') return;
    if (t.retryAt && performance.now() / 1000 < t.retryAt) return;
    t.prio = prio;
    t.lastUsed = this.now;
    if (!t.queued) { t.queued = true; this.queue.push(t); }
  }

  /** 毎フレーム: LOD 選択と描画タイル更新 */
  update(camera, origin, now) {
    this.frame++;
    this.now = now;
    const camAlt = camera.position.y;
    const ke = worldUniforms.uK.value.x, kn = worldUniforms.uK.value.y;
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    for (const t of this.tiles.values()) if (t.mesh) t.mesh.visible = false;

    const horizon = Math.sqrt(2 * 6371000 * Math.max(camAlt, 50)) + 40000;
    const range = Math.min(Math.max(horizon, 90000), 420000);
    // ルートタイル列挙
    const z = ROOT_Z;
    const dLat = range / 111000, dLon = range / (111000 * Math.cos(origin.lat * DEG));
    const x0 = Math.floor(lonToTileX(origin.lon - dLon, z)), x1 = Math.floor(lonToTileX(origin.lon + dLon, z));
    const y0 = Math.floor(latToTileY(origin.lat + dLat, z)), y1 = Math.floor(latToTileY(origin.lat - dLat, z));
    let visible = 0;
    const camX = camera.position.x, camZ = camera.position.z;
    const visit = (t) => {
      t.lastUsed = now;
      const cx = (t.lonC - origin.lon) * ke, cz = -(t.latC - origin.lat) * kn;
      const half = t.sizeM * 0.72;
      const dh = Math.hypot(cx - camX, cz - camZ);
      const horizD = Math.max(0, dh - half);
      if (horizD > range) return;
      const vD = Math.max(0, camAlt - t.maxH, t.minH - camAlt);
      const d = Math.hypot(horizD, vD);
      const cy = (t.minH + t.maxH) / 2 - (dh * dh) / (2 * 6371000);
      this._sphere.center.set(cx, cy, cz);
      this._sphere.radius = half * 1.05 + (t.maxH - t.minH) / 2 + 50;
      const inView = this.frustum.intersectsSphere(this._sphere);
      const k = inView ? this.splitK : this.splitK * 0.4;
      const wantSplit = t.z < this.maxZ && d < t.sizeM * k && t.state === 'ready';
      if (wantSplit) {
        if (!t.children) {
          t.children = [];
          for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) t.children.push(this.getTile(t.z + 1, t.x * 2 + i, t.y * 2 + j));
        }
        let all = true;
        for (const c of t.children) {
          if (c.state !== 'ready') { all = false; this.request(c, d / t.sizeM + c.z * 0.01 - (inView ? 1 : 0)); }
        }
        if (all) { for (const c of t.children) visit(c); return; }
      }
      if (t.state === 'ready') {
        if (inView && t.mesh) {
          t.mesh.visible = true;
          t.mesh.material.uniforms.uTileOffset.value.set(t.lonC - origin.lon, t.latC - origin.lat);
          visible++;
        }
      } else this.request(t, d / t.sizeM - 5);
    };
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) visit(this.getTile(z, x, y));

    // 読み込みキュー
    if (this.queue.length) {
      this.queue = this.queue.filter(t => {
        const keep = t.state === 'new' && now - t.lastUsed < 2;
        if (!keep) t.queued = false;
        return keep;
      });
      this.queue.sort((a, b) => a.prio - b.prio);
      while (this.active < this.maxActive && this.queue.length) {
        const t = this.queue.shift(); t.queued = false;
        this.buildTile(t);
      }
    }
    // 古いタイルの破棄
    if (this.frame % 60 === 0 && this.tiles.size > 420) {
      const old = [...this.tiles.values()].filter(t => t.z > ROOT_Z && now - t.lastUsed > 8 && t.state === 'ready').sort((a, b) => a.lastUsed - b.lastUsed);
      for (const t of old.slice(0, this.tiles.size - 380)) {
        const parent = this.tiles.get(`${t.z - 1}/${t.x >> 1}/${t.y >> 1}`);
        if (parent && parent.children) parent.children = null;
        this.disposeTile(t);
      }
      // 子リスト整合
      for (const t of this.tiles.values()) if (t.children && t.children.some(c => c.state === 'disposed')) t.children = null;
      // DEM キャッシュ上限
      if (this.elev.dem.size > 260) {
        const keys = [...this.elev.dem.keys()];
        const far = keys.filter(k => {
          const [zz, xx, yy] = k.split('/').map(Number);
          const lon = tileXToLon(xx + 0.5, zz), lat = tileYToLat(yy + 0.5, zz);
          return distance(origin.lat, origin.lon, lat, lon) > 80000 && zz >= 10;
        });
        for (const k of far.slice(0, this.elev.dem.size - 220)) { this.elev.dem.delete(k); this.demPromises.delete(k); }
      }
    }
    this.stats = { tiles: this.tiles.size, visible, loading: this.active + this.queue.length };
  }

  /** 開始地点周辺の高解像度 DEM を先読み（物理計算用） */
  async preload(lat, lon) {
    if (!this.enabled) return;
    const jobs = [];
    for (const z of [14, 12, 10]) {
      const cx = Math.floor(lonToTileX(lon, z)), cy = Math.floor(latToTileY(lat, z));
      const r = z === 14 ? 1 : 1;
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) jobs.push(this.loadDem(z, cx + dx, cy + dy));
    }
    await Promise.race([Promise.allSettled(jobs), new Promise(r => setTimeout(r, 6000))]);
  }
}
