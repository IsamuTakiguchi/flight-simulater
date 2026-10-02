// ND（ナビゲーション・ディスプレイ）MAP モード + 地形表示 (EGPWS TERR)
import { Display, C, text, box, line, poly, pad } from './draw.js';
import { DEG, RAD, KT, FT, NM, clamp, wrap360, wrap180 } from '../util/math.js';
import { distance, bearing, destination } from '../util/geo.js';
import { AIRPORTS, NAVAIDS } from '../sim/navigation.js';

const AC = { x: 500, y: 790 };
const RPX = 640;

export class ND extends Display {
  constructor(canvas) {
    super(canvas);
    this.terrCanvas = document.createElement('canvas');
    this.terrCanvas.width = this.terrCanvas.height = 96;
    this.terrT = -10;
  }

  draw(sim, now) {
    const g = this.begin();
    if (!g) return;
    if (!sim.sys.dc) return;
    const f = sim.fdm, o = f.out, efis = sim.sys.efis;
    const range = efis.range;
    const scale = RPX / range;          // px / NM
    const hdgT = o.hdgTrue;             // 方位アップ（真方位で計算し磁方位で表示）
    const magVar = sim.magVar();
    const P = (lat, lon) => {
      const d = distance(f.lat, f.lon, lat, lon) / NM;
      const b = (bearing(f.lat, f.lon, lat, lon) - hdgT) * DEG;
      return [AC.x + Math.sin(b) * d * scale, AC.y - Math.cos(b) * d * scale, d];
    };

    g.save();
    g.beginPath(); g.arc(AC.x, AC.y, RPX + 4, Math.PI, 0); g.lineTo(1000, 1000); g.lineTo(0, 1000); g.closePath(); g.clip();

    // ---- 地形 ----
    if (efis.terr) {
      if (now - this.terrT > 1.0) { this.terrT = now; this.buildTerrain(sim, range); }
      g.save();
      g.translate(AC.x, AC.y);
      g.rotate(-(hdgT - this.terrHdg) * DEG);
      g.globalAlpha = 0.85;
      g.imageSmoothingEnabled = false;
      const s = this.terrRange * scale;
      g.drawImage(this.terrCanvas, -s, -s, 2 * s, 2 * s);
      g.restore();
    }

    // ---- 空港・航法施設 ----
    if (efis.arpt) for (const a of AIRPORTS) {
      const [x, y, d] = P(a.lat, a.lon);
      if (d > range * 1.1) continue;
      g.strokeStyle = C.cyan; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.stroke();
      text(g, a.icao, x + 14, y + 16, { size: 20, color: C.cyan, align: 'left' });
      if (range <= 20) {
        for (const r of a.runways) {
          const [x1, y1] = P(r.lat, r.lon), [x2, y2] = P(r.endLat, r.endLon);
          line(g, x1, y1, x2, y2, C.white, 3);
        }
      }
    }
    if (efis.sta) for (const n of NAVAIDS) {
      if (!n.type.startsWith('VOR')) continue;
      const [x, y, d] = P(n.lat, n.lon);
      if (d > range * 1.1) continue;
      poly(g, [[x - 8, y], [x - 4, y - 7], [x + 4, y - 7], [x + 8, y], [x + 4, y + 7], [x - 4, y + 7]], { stroke: C.cyan, lw: 2 });
      text(g, n.id, x + 12, y - 12, { size: 18, color: C.cyan, align: 'left' });
    }

    // ---- 経路 ----
    const fmc = sim.fmc;
    if (fmc.legs.length) {
      let prev = null;
      const pts = [];
      for (let i = Math.max(0, fmc.active - 1); i < fmc.legs.length; i++) pts.push({ leg: fmc.legs[i], i, p: P(fmc.legs[i].lat, fmc.legs[i].lon) });
      const start = fmc.directFrom ? P(fmc.directFrom.lat, fmc.directFrom.lon) : null;
      for (let k = 0; k < pts.length; k++) {
        const cur = pts[k];
        let from = k === 0 ? (cur.i === fmc.active ? (start || [AC.x, AC.y]) : null) : pts[k - 1].p;
        if (cur.i === fmc.active && start) from = start;
        if (from) line(g, from[0], from[1], cur.p[0], cur.p[1], cur.i === fmc.active ? C.magenta : C.white, 3);
      }
      for (const { leg, i, p } of pts) {
        if (p[2] > range * 1.4) continue;
        const col = i === fmc.active ? C.magenta : C.white;
        this.star(g, p[0], p[1], col);
        text(g, leg.ident, p[0] + 16, p[1] - 4, { size: 20, color: col, align: 'left' });
        if (leg.alt != null) text(g, (leg.altType === 'A' ? '' : '') + leg.alt + (leg.altType === 'A' ? 'A' : ''), p[0] + 16, p[1] + 18, { size: 16, color: col, align: 'left' });
      }
      // T/D
      const td = this.topOfDescent(sim);
      if (td) {
        const [x, y, d] = P(td.lat, td.lon);
        if (d < range * 1.2) { g.strokeStyle = C.green; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.stroke(); text(g, 'T/D', x + 14, y, { size: 18, color: C.green, align: 'left' }); }
      }
    }

    // ---- 高度到達予測アーク ----
    const vs = sim.vsFpm;
    const dAlt = sim.af.mcp.alt - sim.altFt;
    if (!sim.onGround && Math.abs(vs) > 200 && dAlt * vs > 0) {
      const tMin = dAlt / vs;
      const dist = o.gs / KT * tMin / 60;
      if (dist < range) {
        g.strokeStyle = C.green; g.lineWidth = 3;
        g.beginPath(); g.arc(AC.x, AC.y + dist * scale, dist * scale * 2 + 1e-3, -Math.PI / 2 - 0.12, -Math.PI / 2 + 0.12); g.stroke();
        g.beginPath(); g.arc(AC.x, AC.y, dist * scale, -Math.PI / 2 - 0.25, -Math.PI / 2 + 0.25); g.stroke();
      }
    }
    g.restore();

    // ---- コンパスローズ ----
    g.strokeStyle = C.white; g.lineWidth = 2.5;
    g.beginPath(); g.arc(AC.x, AC.y, RPX, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
    g.setLineDash([12, 14]);
    g.beginPath(); g.arc(AC.x, AC.y, RPX / 2, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    g.setLineDash([]);
    text(g, String(range / 2), AC.x - RPX / 2 * 0.72 - 20, AC.y - RPX / 2 * 0.7, { size: 20 });
    const hdgM = sim.hdgMag;
    for (let d = 0; d < 360; d += 5) {
      const a = wrap180(d - hdgM);
      if (Math.abs(a) > 62) continue;
      const r = (a - 90) * DEG;
      const L = d % 10 === 0 ? 22 : 12;
      line(g, AC.x + Math.cos(r) * RPX, AC.y + Math.sin(r) * RPX, AC.x + Math.cos(r) * (RPX - L), AC.y + Math.sin(r) * (RPX - L), C.white, 2.5);
      if (d % 30 === 0) {
        g.save(); g.translate(AC.x + Math.cos(r) * (RPX - 44), AC.y + Math.sin(r) * (RPX - 44)); g.rotate(r + Math.PI / 2);
        text(g, String(d / 10), 0, 0, { size: 26 }); g.restore();
      }
    }
    // 選択方位
    const sb = (wrap180(sim.af.mcp.hdg - hdgM) - 90) * DEG;
    if (Math.abs(wrap180(sim.af.mcp.hdg - hdgM)) < 62) {
      g.save(); g.translate(AC.x + Math.cos(sb) * RPX, AC.y + Math.sin(sb) * RPX); g.rotate(sb + Math.PI / 2);
      poly(g, [[-16, 0], [-16, -14], [-7, -14], [0, -3], [7, -14], [16, -14], [16, 0]], { stroke: C.magenta, lw: 3 }); g.restore();
      if (sim.af.lat.active === 'HDG SEL') { g.setLineDash([10, 12]); line(g, AC.x, AC.y, AC.x + Math.cos(sb) * RPX, AC.y + Math.sin(sb) * RPX, C.magenta, 2); g.setLineDash([]); }
    }
    // 航跡線
    const tr = (wrap180(sim.trackMag - hdgM) - 90) * DEG;
    line(g, AC.x, AC.y - 20, AC.x + Math.cos(tr) * (RPX - 30), AC.y + Math.sin(tr) * (RPX - 30), C.white, 2);
    // 方位ボックス
    poly(g, [[AC.x - 48, AC.y - RPX - 62], [AC.x + 48, AC.y - RPX - 62], [AC.x + 48, AC.y - RPX - 24], [AC.x - 48, AC.y - RPX - 24]], { fill: '#000', stroke: C.white, lw: 2.5 });
    text(g, pad(Math.round(hdgM) % 360 || 360, 3), AC.x, AC.y - RPX - 42, { size: 32, weight: 'bold' });
    text(g, 'HDG', AC.x - 90, AC.y - RPX - 42, { size: 22, color: C.green });
    text(g, 'MAG', AC.x + 90, AC.y - RPX - 42, { size: 22, color: C.green });
    poly(g, [[AC.x, AC.y - RPX], [AC.x - 12, AC.y - RPX - 20], [AC.x + 12, AC.y - RPX - 20]], { stroke: C.white, lw: 2.5 });
    // 自機
    poly(g, [[AC.x, AC.y - 30], [AC.x - 18, AC.y + 18], [AC.x + 18, AC.y + 18]], { stroke: C.white, lw: 3 });

    // ---- 情報表示 ----
    text(g, 'GS', 20, 40, { size: 22, align: 'left' }); text(g, String(Math.round(o.gs / KT)), 62, 40, { size: 30, align: 'left', weight: 'bold' });
    text(g, 'TAS', 150, 40, { size: 22, align: 'left' }); text(g, String(Math.round(o.tas / KT)), 205, 40, { size: 30, align: 'left', weight: 'bold' });
    if (o.wind && o.tas > 50 / KT * 0) {
      const wv = Math.hypot(o.wind[0], o.wind[1]) / KT;
      const wdir = wrap360(Math.atan2(-o.wind[1], -o.wind[0]) * RAD - magVar);
      if (wv > 1) {
        text(g, pad(Math.round(wdir), 3) + '°/' + Math.round(wv), 20, 78, { size: 24, align: 'left' });
        g.save(); g.translate(50, 140); g.rotate((wdir - hdgM + 180) * DEG);
        line(g, 0, -28, 0, 28, C.white, 3); poly(g, [[0, 30], [-9, 14], [9, 14]], { fill: C.white }); g.restore();
      }
    }
    const leg = fmc.activeLeg;
    if (leg) {
      const dWpt = distance(f.lat, f.lon, leg.lat, leg.lon) / NM;
      text(g, leg.ident, 980, 36, { size: 28, color: C.magenta, align: 'right' });
      const etaMin = o.gs > 10 ? dWpt / (o.gs / KT) * 60 : 0;
      const z = new Date(Date.now() + etaMin * 60000);
      text(g, pad(z.getUTCHours(), 2) + pad(z.getUTCMinutes(), 2) + '.' + Math.floor(z.getUTCSeconds() / 6) + 'z', 980, 70, { size: 24, align: 'right' });
      text(g, dWpt.toFixed(dWpt < 10 ? 1 : 0) + ' NM', 980, 102, { size: 26, align: 'right' });
    }
    text(g, efis.terr ? 'TERR' : '', 980, 960, { size: 22, color: C.cyan, align: 'right' });
    text(g, 'MAP  ' + range + ' NM', 20, 960, { size: 22, color: C.green, align: 'left' });
    if (sim.ils && sim.ilsDev && sim.ilsDev.locValid && sim.ilsDev.dme < 30) {
      text(g, sim.ils.ident + ' ' + sim.ils.freq.toFixed(2), 980, 925, { size: 20, color: C.green, align: 'right' });
      text(g, 'CRS ' + pad(Math.round(sim.ils.courseMag), 3), 980, 898, { size: 20, color: C.green, align: 'right' });
    }
  }

  star(g, x, y, col) {
    poly(g, [[x, y - 14], [x + 4, y - 4], [x + 14, y], [x + 4, y + 4], [x, y + 14], [x - 4, y + 4], [x - 14, y], [x - 4, y - 4]], { stroke: col, lw: 2 });
  }

  topOfDescent(sim) {
    const fmc = sim.fmc;
    const ffIdx = fmc.legs.findIndex(l => l.ident.startsWith('FF'));
    if (ffIdx < 0 || sim.flightPhase === 'DESCENT' || sim.flightPhase === 'APPROACH' || fmc.active > ffIdx) return null;
    let remaining = fmc.todDistFromFF;
    if (!remaining) return null;
    // FF から経路を逆にたどる
    for (let i = ffIdx; i > Math.max(fmc.active - 1, 0); i--) {
      const a = fmc.legs[i], b = fmc.legs[i - 1];
      const d = distance(b.lat, b.lon, a.lat, a.lon);
      if (d >= remaining) return destination(a.lat, a.lon, bearing(a.lat, a.lon, b.lat, b.lon), remaining);
      remaining -= d;
    }
    return null;
  }

  buildTerrain(sim, range) {
    const f = sim.fdm, N = this.terrCanvas.width;
    const g = this.terrCanvas.getContext('2d');
    const img = g.createImageData(N, N);
    const R = Math.min(range, 80) * NM;
    this.terrRange = R / NM; this.terrHdg = f.out.hdgTrue;
    const alt = f.h;
    const hdg = f.out.hdgTrue * DEG;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const xr = (i + 0.5) / N * 2 - 1, yr = (j + 0.5) / N * 2 - 1;
      // 画面座標 → 北東
      const east = (xr * Math.cos(hdg) - yr * Math.sin(hdg)) * R;
      const north = (-xr * Math.sin(hdg) - yr * Math.cos(hdg)) * R;
      const lat = f.lat + north / 111000, lon = f.lon + east / (111000 * Math.cos(f.lat * DEG));
      const h = sim.elevation.demHeight(lat, lon);
      const k = (j * N + i) * 4;
      if (h == null || h < 5) { img.data[k + 3] = 0; continue; }
      const rel = (h - alt) / FT;
      let c;
      if (rel > 2000) c = [255, 0, 0];
      else if (rel > -500) c = [255, 190, 0];
      else if (rel > -1000) c = [0, 170, 0];
      else if (rel > -2000) c = [0, 90, 0];
      else c = sim.onGround || alt / FT < 15000 ? [0, 50, 0] : null;
      if (!c) { img.data[k + 3] = 0; continue; }
      const dither = ((i + j) % 2 === 0) ? 255 : 120;
      img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = dither;
    }
    g.putImageData(img, 0, 0);
  }
}
