// HUD（ヘッドアップディスプレイ）— 787 標準装備の HGS 風・コンフォーマル表示
import * as THREE from 'three';
import { DEG, RAD, KT, FT, clamp, wrap180, wrap360, qRotate } from '../util/math.js';
import { nedToThree } from '../render/shared.js';
import { FONT } from './draw.js';

const HUD_COL = '#66ff7a';

export class HUD {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.enabled = true;
    this._v = new THREE.Vector3();
  }

  project(world, camera, dir) {
    const v = this._v.copy(dir).normalize().multiplyScalar(5000).add(camera.position).project(camera);
    if (v.z > 1) return null;
    return [(v.x + 1) / 2 * this.w, (1 - v.y) / 2 * this.h];
  }

  dirFromAngles(azDeg, elDeg) {
    const az = azDeg * DEG, el = elDeg * DEG;
    return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
  }

  draw(sim, world) {
    const c = this.canvas, g = this.ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    g.clearRect(0, 0, w, h);
    if (!this.enabled || world.view !== 'cockpit' || !sim.sys.dc) return;
    this.w = w; this.h = h;
    const cam = world.camera, f = sim.fdm, o = f.out, af = sim.af;
    const s = h / 1000;
    g.save();
    g.strokeStyle = HUD_COL; g.fillStyle = HUD_COL; g.lineWidth = Math.max(1.5, 2.2 * s);
    g.shadowColor = 'rgba(80,255,120,0.6)'; g.shadowBlur = 4 * s;
    const T = (str, x, y, size, align = 'center') => { g.font = `${size * s}px ${FONT}`; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(str, x, y); };
    const L = (a, b) => { g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); };

    // HUD の視野（ボアサイト中心 ±13°）
    const fwd = nedToThree(qRotate(f.q, [1, 0, 0]));
    const bore = this.project(null, cam, fwd);
    if (!bore) { g.restore(); return; }
    const fpx = (h / 2) / Math.tan(cam.fov * DEG / 2);
    const R = fpx * Math.tan(13 * DEG);
    g.beginPath(); g.rect(bore[0] - R * 1.35, bore[1] - R * 1.05, R * 2.7, R * 2.1); g.clip();

    const hdgT = o.hdgTrue;
    // 水平線と機首方位目盛
    const hl = this.project(null, cam, this.dirFromAngles(hdgT - 20, 0)), hr = this.project(null, cam, this.dirFromAngles(hdgT + 20, 0));
    if (hl && hr) {
      L(hl, hr);
      const mv = sim.magVar();
      for (let d = Math.ceil((hdgT - 20) / 5) * 5; d <= hdgT + 20; d += 5) {
        const p = this.project(null, cam, this.dirFromAngles(d, 0));
        if (!p) continue;
        L([p[0], p[1]], [p[0], p[1] - (d % 10 === 0 ? 14 : 7) * s]);
        if (d % 10 === 0) T(String(Math.round(wrap360(d - mv) / 10) % 36 || 36), p[0], p[1] - 26 * s, 18);
      }
    }
    // ピッチラダー
    for (let p = -20; p <= 30; p += 5) {
      if (p === 0) continue;
      const a = this.project(null, cam, this.dirFromAngles(hdgT - 4, p)), b = this.project(null, cam, this.dirFromAngles(hdgT + 4, p));
      if (!a || !b) continue;
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const dx = (b[0] - a[0]) / 2, dy = (b[1] - a[1]) / 2;
      const len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
      const W = 80 * s, gap = 28 * s;
      if (p < 0) g.setLineDash([10 * s, 8 * s]);
      L([mx - ux * W, my - uy * W], [mx - ux * gap, my - uy * gap]);
      L([mx + ux * gap, my + uy * gap], [mx + ux * W, my + uy * W]);
      g.setLineDash([]);
      const tick = p > 0 ? 10 * s : -10 * s;
      L([mx - ux * W, my - uy * W], [mx - ux * W - uy * -tick, my - uy * W + ux * -tick]);
      L([mx + ux * W, my + uy * W], [mx + ux * W - uy * -tick, my + uy * W + ux * -tick]);
      T(String(Math.abs(p)), mx + ux * (W + 22 * s), my + uy * (W + 22 * s), 16);
    }
    // 飛行経路ベクトル
    let fpv = null;
    if (o.gs > 15 || !sim.onGround) {
      const vdir = nedToThree(f.vN);
      fpv = this.project(null, cam, vdir);
    } else fpv = bore;
    if (fpv) {
      const r = 9 * s;
      g.beginPath(); g.arc(fpv[0], fpv[1], r, 0, Math.PI * 2); g.stroke();
      L([fpv[0] - r - 22 * s, fpv[1]], [fpv[0] - r, fpv[1]]); L([fpv[0] + r, fpv[1]], [fpv[0] + r + 22 * s, fpv[1]]); L([fpv[0], fpv[1] - r], [fpv[0], fpv[1] - r - 12 * s]);
      // FD ガイダンスキュー
      if (af.fd && (af.lat.active || af.vert.active) && !sim.onGround) {
        const gx = fpv[0] + clamp((af.fdRoll - o.bank) * 3, -120, 120) * s;
        const gy = fpv[1] - clamp((af.fdPitch - o.pitch) * fpx * DEG, -150 * s, 150 * s);
        g.beginPath(); g.arc(gx, gy, 6 * s, 0, Math.PI * 2); g.stroke();
      }
      // 速度エラー（加速度キャレット）
      const acc = af.accel;
      const cy = fpv[1] - clamp(acc * 6, -40, 40) * s;
      L([fpv[0] - r - 30 * s, cy], [fpv[0] - r - 22 * s, cy - 5 * s]); L([fpv[0] - r - 30 * s, cy], [fpv[0] - r - 22 * s, cy + 5 * s]);
    }
    // ボアサイト
    L([bore[0] - 12 * s, bore[1]], [bore[0] - 4 * s, bore[1]]); L([bore[0] + 4 * s, bore[1]], [bore[0] + 12 * s, bore[1]]); L([bore[0], bore[1] - 4 * s], [bore[0], bore[1] - 12 * s]);

    // 速度・高度
    const lx = bore[0] - R * 1.05, rx = bore[0] + R * 1.05, my = bore[1];
    g.strokeRect(lx - 60 * s, my - 18 * s, 92 * s, 36 * s);
    T(String(Math.round(o.ias)), lx - 14 * s, my, 26);
    T(String(Math.round(af.targetSpeed)), lx - 14 * s, my - 42 * s, 18);
    g.strokeRect(rx - 32 * s, my - 18 * s, 112 * s, 36 * s);
    T(String(Math.round(sim.altFt / 10) * 10), rx + 24 * s, my, 26);
    T(String(af.mcp.alt), rx + 24 * s, my - 42 * s, 18);
    T((sim.vsFpm >= 0 ? '+' : '') + Math.round(sim.vsFpm / 10) * 10, rx + 24 * s, my + 40 * s, 16);
    T('GS ' + Math.round(o.gs / KT), lx - 14 * s, my + 40 * s, 16);
    if (sim.raFt < 1500) T(String(Math.round(sim.raFt)) + ' R', rx + 24 * s, my + 80 * s, 20);
    // FMA
    const fma = af.fma();
    T([fma.thr, fma.roll, fma.pitch].filter(Boolean).join('   '), bore[0], bore[1] - R * 0.92, 18);
    if (fma.status) T(fma.status, bore[0], bore[1] - R * 0.92 + 26 * s, 16);
    // ILS 偏差
    const d = sim.ilsDev;
    if (d && d.locValid && (af.lat.armed === 'LOC' || af.lat.active === 'LOC') && d.dme < 25) {
      const by = bore[1] + R * 0.78;
      for (const k of [-2, -1, 1, 2]) { g.beginPath(); g.arc(bore[0] + k * 34 * s, by, 4 * s, 0, Math.PI * 2); g.stroke(); }
      const xx = bore[0] + clamp(d.locDots, -2.3, 2.3) * 34 * s;
      g.beginPath(); g.moveTo(xx - 9 * s, by); g.lineTo(xx, by - 7 * s); g.lineTo(xx + 9 * s, by); g.lineTo(xx, by + 7 * s); g.closePath(); g.stroke();
      if (d.gsValid) {
        const gx = bore[0] + R * 0.8;
        for (const k of [-2, -1, 1, 2]) { g.beginPath(); g.arc(gx, bore[1] + k * 34 * s, 4 * s, 0, Math.PI * 2); g.stroke(); }
        const yy = bore[1] - clamp(d.gsDots, -2.3, 2.3) * 34 * s;
        g.beginPath(); g.moveTo(gx, yy - 9 * s); g.lineTo(gx + 7 * s, yy); g.lineTo(gx, yy + 9 * s); g.lineTo(gx - 7 * s, yy); g.closePath(); g.stroke();
      }
    }
    if (sim.gpws.alert) { g.fillStyle = '#ff5040'; T(sim.gpws.alert, bore[0], bore[1] + R * 0.45, 30); }
    g.restore();
  }
}
