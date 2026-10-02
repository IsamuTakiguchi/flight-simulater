// 測地計算 (WGS84)
import { DEG, RAD, wrap360 } from './math.js';

export const R_EARTH = 6371008.8;
const A = 6378137.0, E2 = 6.69437999014e-3;

/** 子午線曲率半径 / 卯酉線曲率半径 */
export function radii(latRad) {
  const s = Math.sin(latRad), d = 1 - E2 * s * s;
  return { RM: A * (1 - E2) / Math.pow(d, 1.5), RN: A / Math.sqrt(d) };
}

export function distance(lat1, lon1, lat2, lon2) { // 度 → m
  const p1 = lat1 * DEG, p2 = lat2 * DEG;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((lon2 - lon1) * DEG / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearing(lat1, lon1, lat2, lon2) { // 度 → 真方位(度)
  const p1 = lat1 * DEG, p2 = lat2 * DEG, dl = (lon2 - lon1) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return wrap360(Math.atan2(y, x) * RAD);
}

export function destination(lat, lon, brgDeg, distM) {
  const d = distM / R_EARTH, b = brgDeg * DEG, p1 = lat * DEG, l1 = lon * DEG;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 * RAD, lon: l2 * RAD };
}

/** 大圏航路からの横偏差 (m, 右が正) と、開始点からの航路上距離 (m) */
export function crossTrack(lat1, lon1, lat2, lon2, lat, lon) {
  const d13 = distance(lat1, lon1, lat, lon) / R_EARTH;
  const t13 = bearing(lat1, lon1, lat, lon) * DEG, t12 = bearing(lat1, lon1, lat2, lon2) * DEG;
  const xt = Math.asin(Math.sin(d13) * Math.sin(t13 - t12));
  const at = Math.acos(Math.max(-1, Math.min(1, Math.cos(d13) / Math.cos(xt))));
  const along = Math.cos(t13 - t12) < 0 ? -at : at;
  return { xtk: xt * R_EARTH, along: along * R_EARTH };
}

/** 基準点まわりの局所平面座標 (東 e, 北 n; m) */
export function toLocal(lat0, lon0, lat, lon) {
  const { RM, RN } = radii(lat0 * DEG);
  return { e: (lon - lon0) * DEG * RN * Math.cos(lat0 * DEG), n: (lat - lat0) * DEG * RM };
}
export function fromLocal(lat0, lon0, e, n) {
  const { RM, RN } = radii(lat0 * DEG);
  return { lat: lat0 + n / RM * RAD, lon: lon0 + e / (RN * Math.cos(lat0 * DEG)) * RAD };
}

// Web メルカトル（地理院タイル）
export function lonToTileX(lon, z) { return (lon + 180) / 360 * (1 << z); }
export function latToTileY(lat, z) {
  const s = Math.sin(lat * DEG);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * (1 << z);
}
export function tileXToLon(x, z) { return x / (1 << z) * 360 - 180; }
export function tileYToLat(y, z) {
  const n = Math.PI - 2 * Math.PI * y / (1 << z);
  return Math.atan(Math.sinh(n)) * RAD;
}
