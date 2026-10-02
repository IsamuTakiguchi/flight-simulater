// 地形標高: 国土地理院 標高タイル（DEM）キャッシュ + 空港滑走路の平坦化
import { DEG, FT, clamp, smoothstep } from '../util/math.js';
import { lonToTileX, latToTileY, distance, bearing, toLocal } from '../util/geo.js';
import { AIRPORTS } from '../data/airports.js';
import { runwayGeometry } from './navigation.js';

export const DEM_MAX_Z = 14;

export class Elevation {
  constructor() {
    this.dem = new Map();          // 'z/x/y' → Float32Array(256*256)（海・欠測は NaN）
    this.zooms = [14, 12, 10, 8];
    // 滑走路の平坦化領域（片側 1 本ずつ）
    this.strips = [];
    for (const apt of AIRPORTS) {
      const done = new Set();
      for (const r of apt.runways) {
        const key = [r.id, r.opp].sort().join('/');
        if (done.has(key)) continue;
        done.add(key);
        const g = runwayGeometry(apt, r);
        this.strips.push({
          apt, lat0: r.lat, lon0: r.lon, hdg: r.hdg, len: r.lengthM, halfW: Math.max(r.widthM, 45) / 2 + 180,
          e0: r.elevFt * FT, e1: r.endElevFt * FT, g,
        });
      }
    }
    this.aptElev = AIRPORTS.map(a => ({ lat: a.lat, lon: a.lon, elev: a.elevFt * FT, apt: a }));
  }

  /** DEM タイル登録（ブラウザ側のタイルローダーから） */
  addTile(z, x, y, data) { this.dem.set(z + '/' + x + '/' + y, data); }
  hasTile(z, x, y) { return this.dem.has(z + '/' + x + '/' + y); }

  /** DEM のみの標高 (m)。未取得なら null */
  demHeight(lat, lon) {
    for (const z of this.zooms) {
      const fx = lonToTileX(lon, z), fy = latToTileY(lat, z);
      const tx = Math.floor(fx), ty = Math.floor(fy);
      const d = this.dem.get(z + '/' + tx + '/' + ty);
      if (!d) continue;
      const px = (fx - tx) * 256 - 0.5, py = (fy - ty) * 256 - 0.5;
      const x0 = clamp(Math.floor(px), 0, 255), y0 = clamp(Math.floor(py), 0, 255);
      const x1 = Math.min(x0 + 1, 255), y1 = Math.min(y0 + 1, 255);
      const sx = clamp(px - x0, 0, 1), sy = clamp(py - y0, 0, 1);
      const v = (i, j) => { const h = d[j * 256 + i]; return Number.isNaN(h) ? 0 : h; };
      const h = (v(x0, y0) * (1 - sx) + v(x1, y0) * sx) * (1 - sy) + (v(x0, y1) * (1 - sx) + v(x1, y1) * sx) * sy;
      return h;
    }
    return null;
  }

  /** 滑走路平坦化の重みと標高 */
  stripInfluence(lat, lon) {
    let best = null;
    for (const s of this.strips) {
      if (Math.abs(lat - s.lat0) > 0.06 || Math.abs(lon - s.lon0) > 0.07) continue;
      const { e, n } = toLocal(s.lat0, s.lon0, lat, lon);
      const h = s.hdg * DEG;
      const along = e * Math.sin(h) + n * Math.cos(h);
      const across = Math.abs(e * Math.cos(h) - n * Math.sin(h));
      const pad = 500;
      const dAlong = along < -pad ? -pad - along : along > s.len + pad ? along - s.len - pad : 0;
      const dAcross = Math.max(0, across - s.halfW);
      const d = Math.hypot(dAlong, dAcross);
      const w = 1 - smoothstep(0, 600, d);
      if (w <= 0) continue;
      const elev = s.e0 + (s.e1 - s.e0) * clamp(along / s.len, 0, 1);
      if (!best || w > best.w) best = { w, elev, strip: s, along, across };
    }
    return best;
  }

  /** 地表標高 (m MSL) */
  height(lat, lon) {
    const st = this.stripInfluence(lat, lon);
    if (st && st.w >= 1) return st.elev;
    let h = this.demHeight(lat, lon);
    if (h == null) {
      // DEM 未取得: 近傍空港標高を使用
      h = 0;
      for (const a of this.aptElev) {
        if (Math.abs(lat - a.lat) < 0.1 && Math.abs(lon - a.lon) < 0.12) { h = a.elev; break; }
      }
    }
    if (st) h = h + (st.elev - h) * st.w;
    return h;
  }
}
