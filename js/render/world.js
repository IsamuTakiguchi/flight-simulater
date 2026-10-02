// 3D 外部視界: 空・太陽・雲・海・地形・空港・自機・カメラ
import * as THREE from 'three';
import { DEG, RAD, FT, KT, clamp, lerp, qRotate, smoothstep } from '../util/math.js';
import { destination } from '../util/geo.js';
import { worldUniforms, curvatureChunk, origin, setOrigin, toWorld, nedToThree, attitudeToThree, R_EARTH } from './shared.js';
import { Terrain } from './terrain.js';
import { Airports } from './airports.js';
import { AircraftModel } from './aircraft.js';
import { B789 } from '../sim/aircraft-787.js';

/** 太陽高度・方位（度）: 日付と日本時間、緯度経度から */
export function sunPosition(date, hourJST, lat, lon) {
  const start = new Date(date.getFullYear(), 0, 0);
  const N = Math.floor((date - start) / 86400000);
  const decl = 23.44 * Math.sin(2 * Math.PI * (284 + N) / 365) * DEG;
  const B = 2 * Math.PI * (N - 81) / 364;
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B); // 分
  const solar = hourJST - 9 + lon / 15 + eot / 60;
  const H = (solar - 12) * 15 * DEG, phi = lat * DEG;
  const el = Math.asin(Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(decl) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  return { el: el * RAD, az: (az * RAD + 360) % 360 };
}

const skyVert = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 w = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * w;
    #include <logdepthbuf_vertex>
  }`;
const skyFrag = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uNight; uniform float uHorizonDip;
  uniform vec3 uFogColor; uniform float uOvercast;
  varying vec3 vDir;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  void main() {
    #include <logdepthbuf_fragment>
    vec3 d = normalize(vDir);
    float e = d.y + uHorizonDip;
    float t = pow(clamp(e, 0.0, 1.0), 0.45);
    vec3 col = mix(uHorizon, uZenith, t);
    if (e < 0.0) col = mix(uHorizon, uFogColor * 0.85, clamp(-e * 8.0, 0.0, 1.0));
    float sd = max(dot(d, uSunDir), 0.0);
    col += uSunCol * (pow(sd, 900.0) * 30.0 + pow(sd, 18.0) * 0.35 + pow(sd, 4.0) * 0.12) * (1.0 - uOvercast * 0.85);
    if (uNight > 0.3 && e > 0.0) {
      vec3 q = floor(d * 420.0);
      float s = step(0.9975, hash(q));
      col += vec3(s) * (uNight - 0.3) * 1.3 * smoothstep(0.0, 0.2, e);
    }
    col = mix(col, uFogColor, uOvercast * 0.6);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const cloudVert = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform vec2 uCloudOff; varying vec2 vXZ; varying vec3 vWorld;
  ${curvatureChunk}
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    w.y -= curvatureDrop(w.xz);
    vXZ = w.xz; vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
    #include <logdepthbuf_vertex>
  }`;
const cloudFrag = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D uNoise; uniform vec2 uCloudOff; uniform float uCover; uniform vec3 uLit; uniform vec3 uShade;
  uniform vec3 uFogColor; uniform float uVis; uniform float uBelow;
  varying vec2 vXZ; varying vec3 vWorld;
  void main() {
    #include <logdepthbuf_fragment>
    vec2 p = (vXZ + uCloudOff) / 9000.0;
    float n = texture2D(uNoise, p).r * 0.62 + texture2D(uNoise, p * 3.1 + 0.37).r * 0.28 + texture2D(uNoise, p * 9.7).r * 0.10;
    float th = 1.0 - uCover;
    float a = smoothstep(th - 0.05, th + 0.18, n);
    if (a < 0.01) discard;
    vec3 col = mix(uLit, uShade, uBelow * 0.7 + (1.0 - a) * 0.2);
    float dist = length(vWorld - cameraPosition);
    float fade = exp(-dist / (uVis * 2.5 + 60000.0));
    a *= fade * 0.96;
    col = mix(uFogColor, col, fade);
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;

function noiseTexture() {
  const N = 256;
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  // タイル可能な値ノイズ（多重オクターブ）
  const grid = (s) => { const a = new Float32Array(s * s); for (let i = 0; i < a.length; i++) a[i] = Math.random(); return a; };
  const octs = [4, 8, 16, 32, 64].map(s => ({ s, g: grid(s) }));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0, amp = 1, tot = 0;
    for (const o of octs) {
      const fx = x / N * o.s, fy = y / N * o.s;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const s = o.s, G = o.g;
      const at = (i, j) => G[((j % s + s) % s) * s + ((i % s + s) % s)];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const val = (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
      v += val * amp; tot += amp; amp *= 0.55;
    }
    const k = (y * N + x) * 4;
    const b = Math.round(v / tot * 255);
    img.data[k] = img.data[k + 1] = img.data[k + 2] = b; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const col3 = (r, g, b) => new THREE.Color(r, g, b);

export class World {
  constructor(canvas, elevation, opts = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.pixelRatioMax || 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.3, 900000);
    this.camera.rotation.order = 'YXZ';

    // 空
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false,
      uniforms: {
        uZenith: { value: col3(0.2, 0.4, 0.8) }, uHorizon: { value: col3(0.7, 0.8, 0.9) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunCol: { value: col3(1, 0.95, 0.85) }, uNight: { value: 0 }, uHorizonDip: { value: 0 }, uFogColor: worldUniforms.uFogColor, uOvercast: { value: 0 },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(150000, 48, 24), this.skyMat); // 深度を書かない背景なので半径は任意
    this.sky.renderOrder = -10; this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // 海（タイル未読込領域の下地）
    const oceanMat = new THREE.ShaderMaterial({
      vertexShader: `#include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vW; ${curvatureChunk}
        void main(){ vec4 w = modelMatrix*vec4(position,1.0); w.y -= curvatureDrop(w.xz); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w;
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `#include <common>
        #include <logdepthbuf_pars_fragment>
        uniform vec3 uFogColor; uniform float uVis; uniform float uDay; uniform float uCamAlt; varying vec3 vW;
        void main(){
        #include <logdepthbuf_fragment>
        vec3 c = vec3(0.03,0.09,0.15)*(0.05+0.95*uDay);
        float dist=length(vW-cameraPosition); float fog=1.0-exp(-3.2*dist/(uVis*(1.0+uCamAlt/2500.0)));
        gl_FragColor=vec4(mix(c,uFogColor,clamp(fog,0.0,1.0)),1.0);
        #include <colorspace_fragment>
        }`,
      uniforms: { ...worldUniforms },
    });
    const og = new THREE.CircleGeometry(700000, 96, 0, Math.PI * 2);
    // 中心付近を細かく（曲率表現のためリング分割）
    const ring = new THREE.RingGeometry(1, 700000, 96, 40);
    const rp = ring.attributes.position;
    for (let i = 0; i < rp.count; i++) { const x = rp.getX(i), y = rp.getY(i); const r = Math.hypot(x, y); const k = Math.pow(r / 700000, 2.2) * 700000 / Math.max(r, 1e-6); rp.setXY(i, x * k, y * k); }
    ring.rotateX(-Math.PI / 2);
    og.dispose();
    this.ocean = new THREE.Mesh(ring, oceanMat);
    this.ocean.frustumCulled = false; this.ocean.renderOrder = -5;
    this.scene.add(this.ocean);

    // 雲
    this.cloudMat = new THREE.ShaderMaterial({
      vertexShader: cloudVert, fragmentShader: cloudFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: {
        ...worldUniforms, uNoise: { value: noiseTexture() }, uCloudOff: { value: new THREE.Vector2() }, uCover: { value: 0.3 },
        uLit: { value: col3(1, 1, 1) }, uShade: { value: col3(0.6, 0.63, 0.68) }, uBelow: { value: 0 },
      },
    });
    const cg = new THREE.RingGeometry(1, 160000, 64, 30);
    const cp = cg.attributes.position;
    for (let i = 0; i < cp.count; i++) { const x = cp.getX(i), y = cp.getY(i); const r = Math.hypot(x, y); const k = Math.pow(r / 160000, 1.8) * 160000 / Math.max(r, 1e-6); cp.setXY(i, x * k, y * k); }
    cg.rotateX(-Math.PI / 2);
    this.clouds = new THREE.Mesh(cg, this.cloudMat);
    this.clouds.frustumCulled = false; this.clouds.renderOrder = 20;
    this.scene.add(this.clouds);

    // 照明（自機モデル用）
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a4030, 0.8);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.terrain = new Terrain(this.scene, elevation, { enabled: opts.terrain !== false, anisotropy: this.renderer.capabilities.getMaxAnisotropy() });
    this.airports = new Airports(this.scene);
    this.model = new AircraftModel();
    this.scene.add(this.model.root);

    this.view = 'cockpit';
    this.head = { yaw: 0, pitch: -6 * DEG, fov: 58 };
    this.chase = { yaw: 0, pitch: 10 * DEG, dist: 95 };
    this.flyby = null;
    this.date = new Date();
    this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3();
    this.camPosSmooth = null;
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setView(v) { this.view = v; this.flyby = null; this.camPosSmooth = null; }

  /** 環境（太陽・空・霧・雲） */
  updateEnvironment(sim, hourJST) {
    const f = sim.fdm, wx = sim.weather;
    const sp = sunPosition(this.date, hourJST, f.lat, f.lon);
    this.sunEl = sp.el; this.sunAz = sp.az;
    const el = sp.el * DEG, az = sp.az * DEG;
    const sunDir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
    this.skyMat.uniforms.uSunDir.value.copy(sunDir);
    const e = sp.el;
    const day = smoothstep(-8, 12, e);
    const dusk = Math.exp(-((e - 1) ** 2) / 40);
    const night = 1 - smoothstep(-14, -3, e);
    const overcast = clamp((wx.cloudCover - 0.7) / 0.3, 0, 1) * (sim.altFt * FT < wx.cloudBaseFt * FT ? 1 : 0.2);
    const zenith = col3(lerp(0.004, 0.13, day), lerp(0.008, 0.33, day), lerp(0.03, 0.75, day));
    const horizon = col3(lerp(0.02, 0.72, day) + dusk * 0.35, lerp(0.03, 0.80, day) + dusk * 0.08, lerp(0.07, 0.92, day) - dusk * 0.15);
    // 高高度では空が濃くなる
    const altK = clamp(sim.altFt / 45000, 0, 1);
    zenith.multiplyScalar(1 - altK * 0.55);
    this.skyMat.uniforms.uZenith.value.copy(zenith);
    this.skyMat.uniforms.uHorizon.value.copy(horizon);
    this.skyMat.uniforms.uSunCol.value.setRGB(1, 0.9 - dusk * 0.3, 0.75 - dusk * 0.45).multiplyScalar(smoothstep(-3, 2, e));
    this.skyMat.uniforms.uNight.value = night;
    this.skyMat.uniforms.uOvercast.value = overcast;
    const camAlt = this.camera.position.y;
    this.skyMat.uniforms.uHorizonDip.value = Math.sqrt(2 * Math.max(camAlt, 1) / R_EARTH) * 0.9;
    // 霧色（地平線の色 + 雲量）
    const gray = col3(0.55, 0.58, 0.62).multiplyScalar(0.05 + 0.95 * day);
    const fogC = horizon.clone().lerp(gray, overcast * 0.8);
    worldUniforms.uFogColor.value.copy(fogC);
    worldUniforms.uDay.value = clamp(day * (1 - overcast * 0.35), 0, 1);
    worldUniforms.uNight.value = night;
    worldUniforms.uSunTint.value.setRGB(1, 1 - dusk * 0.25, 1 - dusk * 0.45);
    // 視程（雲中は 150 m）
    let vis = wx.visibilityM;
    const hFt = camAlt / FT;
    const inCloud = wx.cloudCover > 0.05 && hFt > wx.cloudBaseFt && hFt < wx.cloudTopFt;
    if (inCloud) vis = 150 + (1 - wx.cloudCover) * 1500;
    worldUniforms.uVis.value = vis;
    worldUniforms.uCamAlt.value = Math.max(0, camAlt - (sim.fdm.out.groundElev ?? 0));
    // 雲層
    this.clouds.visible = wx.cloudCover > 0.02;
    this.clouds.position.set(0, wx.cloudBaseFt * FT + (wx.cloudTopFt - wx.cloudBaseFt) * FT * 0.15, 0);
    this.cloudMat.uniforms.uCover.value = wx.cloudCover;
    const ox = (origin.lon * origin.ke) % 9000, oz = -(origin.lat * origin.kn) % 9000;
    this.cloudMat.uniforms.uCloudOff.value.set(ox + (this._cloudDrift || 0), oz);
    this._cloudDrift = ((this._cloudDrift || 0) + wx.windKt * 0.05) % 9000;
    const lit = col3(1, 1, 1).multiplyScalar(0.06 + 0.94 * day).lerp(col3(1, 0.7, 0.5), dusk * 0.4);
    this.cloudMat.uniforms.uLit.value.copy(lit);
    this.cloudMat.uniforms.uShade.value.copy(lit.clone().multiplyScalar(0.55));
    this.cloudMat.uniforms.uBelow.value = camAlt < this.clouds.position.y ? 1 : 0;
    // ライト
    this.sun.position.copy(sunDir).multiplyScalar(1000);
    this.sun.intensity = 2.4 * smoothstep(-2, 8, e) * (1 - overcast * 0.6);
    this.hemi.intensity = 0.15 + 0.85 * day;
    this.renderer.setClearColor(fogC);
    return { day, night, inCloud };
  }

  update(sim, dt, hourJST, now) {
    const f = sim.fdm;
    setOrigin(f.lat, f.lon);
    const env = this.updateEnvironment(sim, hourJST);
    const night = env.night;
    worldUniforms.uTime.value = now;

    // 自機
    const acPos = new THREE.Vector3(0, f.h, 0);
    const acQ = attitudeToThree(qRotate, f.q, this._q);
    this.model.root.position.copy(acPos);
    this.model.root.quaternion.copy(acQ);
    this.model.update(sim, now, night);

    // 着陸灯の地面照射
    const L = sim.sys.lights;
    const llOn = sim.sys.dc && (L.landing || L.taxi);
    worldUniforms.uLLOn.value = llOn ? 1 : 0;
    if (llOn) {
      const p = nedToThree(qRotate(f.q, [8, 0, 1.5]));
      worldUniforms.uLLPos.value.copy(acPos).add(p);
      const d = nedToThree(qRotate(f.q, [Math.cos(6 * DEG), 0, Math.sin(6 * DEG)]));
      worldUniforms.uLLDir.value.copy(d).normalize();
    }

    // カメラ
    this.updateCamera(sim, dt, acPos, acQ);
    this.sky.position.copy(this.camera.position);
    this.ocean.position.set(0, -2.5, 0);
    this.camera.updateMatrixWorld();

    this.terrain.update(this.camera, origin, now);
    this.airports.update(origin);
    this.renderer.render(this.scene, this.camera);
  }

  updateCamera(sim, dt, acPos, acQ) {
    const f = sim.fdm, cam = this.camera;
    this.model.root.visible = this.view !== 'cockpit';
    const ground = (sim.fdm.out.groundElev ?? 0);
    if (this.view === 'cockpit') {
      const eye = nedToThree(qRotate(f.q, B789.pilotEye));
      cam.position.copy(acPos).add(eye);
      const q = acQ.clone();
      // モデル座標(+x前) → カメラ座標(-z前) へ
      const base = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0));
      const head = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.head.pitch, this.head.yaw, 0, 'YXZ'));
      cam.quaternion.copy(q).multiply(base).multiply(head);
      cam.fov = this.head.fov;
      cam.near = 0.3;
    } else if (this.view === 'chase') {
      const hdg = f.out.hdgTrue * DEG;
      const yaw = hdg + this.chase.yaw + Math.PI;
      const d = this.chase.dist;
      const target = acPos.clone();
      const pos = new THREE.Vector3(
        Math.sin(yaw) * Math.cos(this.chase.pitch) * d,
        Math.sin(this.chase.pitch) * d + 4,
        -Math.cos(yaw) * Math.cos(this.chase.pitch) * d,
      ).add(target);
      if (this.camPosSmooth) {
        const k = 1 - Math.exp(-dt * 6);
        this.camPosSmooth.lerp(pos.sub(target), k);
      } else this.camPosSmooth = pos.sub(target);
      cam.position.copy(target).add(this.camPosSmooth);
      cam.position.y = Math.max(cam.position.y, ground + 2);
      cam.up.set(0, 1, 0);
      cam.lookAt(target);
      cam.fov = 50; cam.near = 1;
    } else if (this.view === 'wing') {
      const p = nedToThree(qRotate(f.q, [-2, -7.5, -3.6]));
      cam.position.copy(acPos).add(p);
      const look = nedToThree(qRotate(f.q, [-9, -22, 0.8]));
      const up = nedToThree(qRotate(f.q, [0, 0, -1]));
      cam.up.copy(up);
      cam.lookAt(acPos.clone().add(look));
      cam.fov = 62; cam.near = 0.3;
    } else if (this.view === 'flyby' || this.view === 'tower') {
      // 予測位置の脇にカメラを固定して通過を眺める
      const gs = Math.max(f.out.gs, 5);
      if (!this.flyby || this.flyby.lat == null) this.flyby = null;
      const fb = this.flyby;
      const curW = toWorld(f.lat, f.lon, f.h);
      let needNew = !fb;
      if (fb) {
        const w = toWorld(fb.lat, fb.lon, fb.h);
        if (w.distanceTo(curW) > 1600) needNew = true;
      }
      if (needNew) {
        const ahead = Math.min(gs * 12, 1400);
        const p = destination(f.lat, f.lon, f.out.trackTrue, ahead);
        const side = destination(p.lat, p.lon, f.out.trackTrue + 90, this.view === 'tower' ? 260 : 45 + gs * 0.15);
        const gElev = sim.elevation.height(side.lat, side.lon);
        const h = this.view === 'tower' ? gElev + 45 : Math.max(f.h + f.out.vs * 12 - 12, gElev + 3);
        this.flyby = { lat: side.lat, lon: side.lon, h };
      }
      const w = toWorld(this.flyby.lat, this.flyby.lon, this.flyby.h);
      cam.position.copy(w);
      cam.up.set(0, 1, 0);
      cam.lookAt(acPos);
      const dist = w.distanceTo(acPos);
      cam.fov = clamp(2 * Math.atan(55 / Math.max(dist, 1)) * RAD * 1.3, 4, 60);
      cam.near = 1;
    }
    cam.updateProjectionMatrix();
  }
}
