// ボーイング 787-9 の外観モデル（プロシージャル生成。航空会社塗装ではない汎用カラー）
// モデル座標: +x 前方, +y 上方, +z 右翼方向（重心原点, m）
import * as THREE from 'three';
import { DEG } from '../util/math.js';
import { B789 } from '../sim/aircraft-787.js';

function fuselageTexture() {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f6f8'; g.fillRect(0, 0, 2048, 512);
  // 下面（グレー）: 周方向 v=0.5 が下
  const grd = g.createLinearGradient(0, 180, 0, 330);
  grd.addColorStop(0, 'rgba(160,170,182,0)'); grd.addColorStop(0.5, 'rgba(160,170,182,1)'); grd.addColorStop(1, 'rgba(160,170,182,0)');
  g.fillStyle = grd; g.fillRect(0, 180, 2048, 150);
  // 客室窓（両側）: 787 の大型窓
  const winRow = (y) => {
    g.fillStyle = '#20262e';
    for (let x = 300; x < 1740; x += 15.5) {
      if (Math.abs(x - 560) < 18 || Math.abs(x - 1180) < 22 || Math.abs(x - 1560) < 18) continue; // ドア位置
      g.beginPath(); g.ellipse(x, y, 4.2, 6.5, 0, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = '#9aa4ae'; g.lineWidth = 2;
    for (const x of [560, 1180, 1560, 330]) g.strokeRect(x - 10, y - 14, 20, 34);
  };
  winRow(128 - 18); winRow(384 + 18);
  // 操縦室窓（機首）
  g.fillStyle = '#151a20';
  for (const [y, s] of [[128 - 26, 1], [384 + 26, -1]]) {
    g.beginPath(); g.moveTo(1900, y - 8 * s); g.lineTo(1960, y - 14 * s); g.lineTo(1975, y + 6 * s); g.lineTo(1915, y + 10 * s); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(1965, y - 14 * s); g.lineTo(2000, y - 22 * s); g.lineTo(2008, y - 4 * s); g.lineTo(1979, y + 6 * s); g.closePath(); g.fill();
  }
  // 胴体ライン
  g.fillStyle = '#2b4c7e'; g.fillRect(0, 160, 2048, 3); g.fillRect(0, 349, 2048, 3);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function lathe(profile, segs = 40) {
  // profile: [[x, r, yOffset]] → x 軸回りの回転体
  const pos = [], uv = [], idx = [];
  const xmin = profile[profile.length - 1][0], xmax = profile[0][0];
  for (let i = 0; i < profile.length; i++) {
    const [x, r, yo = 0, sy = 1] = profile[i];
    for (let j = 0; j <= segs; j++) {
      const a = j / segs * Math.PI * 2;
      pos.push(x, yo + Math.cos(a) * r * sy, Math.sin(a) * r);
      uv.push((x - xmin) / (xmax - xmin), j / segs);
    }
  }
  for (let i = 0; i < profile.length - 1; i++) for (let j = 0; j < segs; j++) {
    const a = i * (segs + 1) + j, b = a + segs + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/** 翼型断面を補間したテーパー翼。stations: [{x(前縁), y, z, chord, t}] */
function loftWing(stations, mirror = false) {
  const af = [[0, 0], [0.03, 0.55], [0.12, 0.9], [0.3, 1], [0.6, 0.75], [1, 0.05], [0.6, -0.45], [0.3, -0.6], [0.12, -0.55], [0.03, -0.35]];
  const pos = [], idx = [];
  const n = af.length;
  for (const s of stations) {
    for (const [u, v] of af) pos.push(s.x - u * s.chord, s.y + v * s.t * s.chord * 0.5, mirror ? -s.z : s.z);
  }
  for (let i = 0; i < stations.length - 1; i++) for (let j = 0; j < n; j++) {
    const a = i * n + j, b = i * n + (j + 1) % n, c = a + n, d = b + n;
    if (mirror) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  // 翼端キャップ
  const last = (stations.length - 1) * n;
  for (let j = 1; j < n - 1; j++) mirror ? idx.push(last, last + j + 1, last + j) : idx.push(last, last + j, last + j + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.2, 'rgba(255,255,255,0.8)'); r.addColorStop(0.5, 'rgba(255,255,255,0.15)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class AircraftModel {
  constructor() {
    this.root = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.45, metalness: 0.15 });
    const wingMat = new THREE.MeshStandardMaterial({ color: 0xc9cfd6, roughness: 0.55, metalness: 0.25 });
    const tailMat = new THREE.MeshStandardMaterial({ color: 0x1f3d6e, roughness: 0.4, metalness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.7, metalness: 0.3 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xb8bec6, roughness: 0.3, metalness: 0.85 });
    const tire = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
    this.materials = [white, wingMat, tailMat, dark, metal, tire];

    // ---- 胴体 ----
    const fusMat = new THREE.MeshStandardMaterial({ map: fuselageTexture(), roughness: 0.45, metalness: 0.12 });
    this.materials.push(fusMat);
    const prof = [
      [28.5, 0.05, -0.55], [28.3, 0.7, -0.45], [27.8, 1.3, -0.35], [27.0, 1.85, -0.25], [25.8, 2.35, -0.15], [24.0, 2.7, -0.05],
      [21.5, 2.9, 0], [18, 2.95, 0], [0, 2.95, 0], [-14, 2.95, 0], [-18, 2.85, 0.15], [-22, 2.5, 0.5], [-26, 1.95, 0.95],
      [-29.5, 1.3, 1.35], [-32.5, 0.7, 1.7], [-34.3, 0.25, 1.9],
    ];
    const fus = new THREE.Mesh(lathe(prof.map(([x, r, y]) => [x, r, y, 1.03])), fusMat);
    this.root.add(fus);

    // ---- 主翼 ----
    const wingStations = (side) => {
      const st = [];
      const rootX = 6.5, sweep = Math.tan(32.2 * DEG);
      const spans = [2.6, 6, 10, 15, 20, 25, 27.5, 29.2, 30.06];
      for (const z of spans) {
        const t = (z - 2.6) / (30.06 - 2.6);
        let chord = 11.6 - t * 9.2;
        if (z < 10) chord += (10 - z) * 0.55; // 内翼のヤフディ
        let x = rootX - (z - 2.6) * sweep;
        if (z > 27.4) { x -= (z - 27.4) * 0.9; chord *= 1 - (z - 27.4) * 0.18; } // レイクドウィングチップ
        const y = -1.55 + (z - 2.6) * Math.tan(5.5 * DEG) + Math.pow(t, 2) * 1.4;
        st.push({ x, y, z, chord, t: z < 8 ? 0.15 : 0.11 - t * 0.02 });
      }
      return st;
    };
    this.wingSt = wingStations();
    this.root.add(new THREE.Mesh(loftWing(this.wingSt), wingMat));
    this.root.add(new THREE.Mesh(loftWing(this.wingSt, true), wingMat));
    // ウィングボックス・フェアリング
    const fair = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), white);
    fair.scale.set(11, 1.6, 3.1); fair.position.set(1.5, -2.0, 0);
    this.root.add(fair);

    // ---- フラップ・スポイラー（可動）----
    this.flaps = []; this.spoilers = [];
    for (const side of [1, -1]) {
      for (const [z0, z1] of [[3.2, 10.5], [11.5, 21]]) {
        const a = this.interpWing(z0), b = this.interpWing(z1);
        const g = new THREE.BoxGeometry(1, 0.18, 1);
        const m = new THREE.Mesh(g, wingMat);
        const pivot = new THREE.Group();
        const ax = a.x - a.chord * 0.78, bx = b.x - b.chord * 0.78;
        pivot.position.set((ax + bx) / 2, (a.y + b.y) / 2 - 0.15, side * (z0 + z1) / 2);
        pivot.rotation.y = Math.atan2(bx - ax, side * (z1 - z0)) * -1 * side;
        const chord = (a.chord + b.chord) / 2 * 0.22;
        m.scale.set(chord, 1, z1 - z0); m.position.set(-chord / 2, 0, 0);
        pivot.add(m);
        this.root.add(pivot); this.flaps.push(pivot);
        const sp = new THREE.Group();
        sp.position.set(pivot.position.x + (a.chord * 0.08), pivot.position.y + 0.35, pivot.position.z);
        sp.rotation.y = pivot.rotation.y;
        const sm = new THREE.Mesh(new THREE.BoxGeometry(1, 0.08, 1), wingMat);
        sm.scale.set(chord * 0.9, 1, (z1 - z0) * 0.9); sm.position.set(-chord * 0.45, 0, 0);
        sp.add(sm); this.root.add(sp); this.spoilers.push(sp);
      }
    }

    // ---- 水平尾翼 ----
    const hst = [];
    for (const z of [0.8, 4, 8, 9.9]) {
      const t = (z - 0.8) / 9.1;
      hst.push({ x: -24 - (z - 0.8) * Math.tan(36 * DEG), y: 1.0 + (z - 0.8) * Math.tan(7 * DEG), z, chord: 6.4 - t * 4.3, t: 0.09 });
    }
    this.root.add(new THREE.Mesh(loftWing(hst), wingMat));
    this.root.add(new THREE.Mesh(loftWing(hst, true), wingMat));
    // ---- 垂直尾翼 ----
    const vst = [];
    for (const h of [0, 3, 6, 9.6]) {
      const t = h / 9.6;
      vst.push({ x: -21.5 - h * Math.tan(40 * DEG), y: 2.5 + h, z: 0, chord: 9.5 - t * 6.0, t: 0.1 });
    }
    // 垂直尾翼は y 方向に積層するため、断面座標を入れ替えて生成
    const fin = loftWing(vst.map(s => ({ ...s, y: 0, z: s.y })));
    const fp = fin.attributes.position;
    for (let i = 0; i < fp.count; i++) { const y = fp.getY(i), z = fp.getZ(i); fp.setY(i, z); fp.setZ(i, y); }
    fin.computeVertexNormals();
    const finMesh = new THREE.Mesh(fin, tailMat);
    finMesh.material.side = THREE.DoubleSide;
    this.root.add(finMesh);

    // ---- エンジン（GEnx-1B）----
    this.fans = [];
    for (const side of [-1, 1]) {
      const eng = new THREE.Group();
      const nac = new THREE.Mesh(lathe([[2.7, 1.45], [2.5, 1.62], [1.6, 1.68], [-0.5, 1.6], [-1.8, 1.3], [-2.4, 1.05]], 32), white);
      eng.add(nac);
      const lip = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.12, 10, 32), metal);
      lip.rotation.y = Math.PI / 2; lip.position.x = 2.7; eng.add(lip);
      const fanDisc = new THREE.Mesh(new THREE.CircleGeometry(1.42, 32), dark);
      fanDisc.rotation.y = Math.PI / 2; fanDisc.position.x = 2.3; eng.add(fanDisc);
      const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 20), metal);
      spinner.rotation.z = -Math.PI / 2; spinner.position.x = 2.6; eng.add(spinner);
      const core = new THREE.Mesh(lathe([[-2.3, 0.95], [-3.4, 0.75], [-4.3, 0.35]], 24), metal);
      eng.add(core);
      // ファンブレード（回転表示）
      const fan = new THREE.Group();
      for (let i = 0; i < 18; i++) {
        const bl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.3, 0.22), dark);
        bl.position.y = 0.75; bl.rotation.x = 0.5;
        const holder = new THREE.Group(); holder.rotation.x = i / 18 * Math.PI * 2; holder.add(bl);
        fan.add(holder);
      }
      fan.position.x = 2.32; eng.add(fan); this.fans.push(fan);
      eng.position.set(B789.engines[0].pos[0] + 0.5, -2.95, side * 9.9);
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(5.5, 1.5, 0.5), white);
      pylon.position.set(-1.5, 1.4, 0); eng.add(pylon);
      this.root.add(eng);
    }

    // ---- 降着装置 ----
    this.gearGroups = [];
    const mkGear = (pos, wheels, isNose) => {
      const grp = new THREE.Group();
      const legLen = pos[2] - 0.6;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, legLen, 10), metal);
      leg.position.y = -legLen / 2; grp.add(leg);
      const r = isNose ? 0.55 : 0.68;
      const wheelGeo = new THREE.CylinderGeometry(r, r, 0.45, 18);
      wheelGeo.rotateX(Math.PI / 2);
      for (const [dx, dz] of wheels) {
        const w = new THREE.Mesh(wheelGeo, tire);
        w.position.set(dx, -legLen + 0.05, dz); grp.add(w);
      }
      if (!isNose) {
        const bogie = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.25, 0.3), metal);
        bogie.position.set(0, -legLen + 0.05, 0); grp.add(bogie);
      }
      grp.position.set(pos[0], -0.4, pos[1]);
      grp.userData.side = Math.sign(pos[1]);
      grp.userData.isNose = isNose;
      this.root.add(grp); this.gearGroups.push(grp);
    };
    const gNose = B789.gear[0], gL = B789.gear[1], gR = B789.gear[2];
    mkGear([gNose.pos[0], 0, gNose.pos[2]], [[0, -0.32], [0, 0.32]], true);
    mkGear([gL.pos[0], gL.pos[1], gL.pos[2]], [[0.75, -0.6], [0.75, 0.6], [-0.75, -0.6], [-0.75, 0.6]], false);
    mkGear([gR.pos[0], gR.pos[1], gR.pos[2]], [[0.75, -0.6], [0.75, 0.6], [-0.75, -0.6], [-0.75, 0.6]], false);

    // ---- 機外灯 ----
    const glow = glowTexture();
    const mkLight = (color, size, pos) => {
      const m = new THREE.SpriteMaterial({ map: glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
      const s = new THREE.Sprite(m); s.scale.set(size, size, 1); s.position.set(...pos);
      this.root.add(s); return s;
    };
    const tip = this.wingSt[this.wingSt.length - 1];
    this.navL = mkLight(0xff2020, 2.2, [tip.x - 0.5, tip.y + 0.1, -tip.z]);
    this.navR = mkLight(0x20ff40, 2.2, [tip.x - 0.5, tip.y + 0.1, tip.z]);
    this.navTail = mkLight(0xffffff, 1.6, [-34.4, 1.9, 0]);
    this.strobeL = mkLight(0xffffff, 6, [tip.x - 1.2, tip.y + 0.1, -tip.z]);
    this.strobeR = mkLight(0xffffff, 6, [tip.x - 1.2, tip.y + 0.1, tip.z]);
    this.strobeT = mkLight(0xffffff, 4, [-34.6, 1.9, 0]);
    this.beaconT = mkLight(0xff2a10, 2.6, [2, 3.05, 0]);
    this.beaconB = mkLight(0xff2a10, 2.6, [0, -3.2, 0]);
    this.landL = mkLight(0xfff4dc, 4.5, [4, -2.2, -4.2]);
    this.landR = mkLight(0xfff4dc, 4.5, [4, -2.2, 4.2]);
    this.taxiL = mkLight(0xfff4dc, 2.5, [gNose.pos[0], -3.4, 0]);
    this.logoL = mkLight(0xffffff, 0.01, [-26, 6, 0]);
    this.root.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  }

  interpWing(z) {
    const st = this.wingSt;
    for (let i = 1; i < st.length; i++) if (z <= st[i].z) {
      const a = st[i - 1], b = st[i], t = (z - a.z) / (b.z - a.z);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, chord: a.chord + (b.chord - a.chord) * t };
    }
    return st[st.length - 1];
  }

  /** 状態反映 */
  update(sim, time, night) {
    const f = sim.fdm, sys = sim.sys;
    // フラップ（最大 30°）、スポイラー
    const flapDeg = [0, 0, 5, 15, 17, 18, 20, 25, 30];
    const fi = Math.min(Math.floor(f.flapPos), 8), ft = f.flapPos - fi;
    const ang = (flapDeg[fi] + ((flapDeg[Math.min(fi + 1, 8)] ?? 30) - flapDeg[fi]) * ft) * DEG;
    for (const p of this.flaps) { p.rotation.z = -ang; p.position.y = p.userData.y0 ?? (p.userData.y0 = p.position.y); }
    const sp = Math.max(f.speedbrake, f.groundSpoiler || 0) * 45 * DEG;
    this.spoilers.forEach((s, i) => { s.rotation.z = sp + (i % 2 === 0 ? 0 : 0) + (Math.sign(s.position.z) * f.da > 0 ? Math.abs(f.da) * 1.2 : 0); });
    // ファン回転
    sim.engines.forEach((e, i) => { this.fans[i].rotation.x += e.n1 * 0.06 * (1 / 60) * 10; });
    // ギア（格納アニメーション）
    for (const g of this.gearGroups) {
      const k = f.gearPos;
      g.visible = k > 0.02;
      g.rotation.x = 0; g.rotation.z = 0;
      if (g.userData.isNose) g.rotation.z = (1 - k) * 1.5;
      else g.rotation.x = -g.userData.side * (1 - k) * 1.45;
    }
    // 灯火
    const L = sys.lights;
    const ac = sys.dc;
    const flash = (period, on) => (time % period) < on;
    this.navL.visible = this.navR.visible = this.navTail.visible = ac && L.nav;
    const strobe = ac && L.strobe && (flash(1.2, 0.06) || (time % 1.2 > 0.14 && time % 1.2 < 0.2));
    this.strobeL.visible = this.strobeR.visible = this.strobeT.visible = strobe;
    const bcn = ac && L.beacon && flash(1.0, 0.12);
    this.beaconT.visible = this.beaconB.visible = bcn;
    this.landL.visible = this.landR.visible = ac && L.landing;
    this.taxiL.visible = ac && L.taxi && f.gearPos > 0.9;
    const s = 0.6 + night * 2.4;
    this.landL.scale.setScalar(4.5 * s); this.landR.scale.setScalar(4.5 * s);
    this.navL.scale.setScalar(2.2 * s); this.navR.scale.setScalar(2.2 * s);
  }
}
