// FMC（飛行管理コンピュータ）: 経路・性能計算・VNAV 計画
import { DEG, RAD, KT, FT, NM, G0, clamp, wrap360, wrap180 } from '../util/math.js';
import { distance, bearing, destination, crossTrack } from '../util/geo.js';
import { isa } from './atmosphere.js';
import { B789, flapIndexByName } from './aircraft-787.js';
import { findAirport, findRunway, runwayGeometry, ILS, findFix, NAVAIDS } from './navigation.js';

const fixNum = (x) => Math.round(x);

export class FMC {
  constructor() {
    this.origin = null; this.dest = null;
    this.depRwy = null; this.arrRwy = null;   // runwayGeometry
    this.legs = [];                           // {ident, lat, lon, alt, altType:'@'|'A'|'B', spd, kind}
    this.active = 0;
    this.crzAltFt = 35000;
    this.costIndex = 45;
    this.reserveKg = 3500;
    this.toFlaps = '15';
    this.ldgFlaps = '30';
    this.toRating = 'TO';
    this.thrRedAglFt = 1500;
    this.accelAglFt = 3000;
    this.transAltFt = 14000;   // 日本の転移高度
    this.v1 = 0; this.vr = 0; this.v2 = 0;
    this.vref25 = 0; this.vref30 = 0;
    this.toTrim = 5.0;
    this.ils = null;
    this.messages = [];
    this.execPending = false;
    this.phase = 'PREFLIGHT';  // PREFLIGHT, TAKEOFF, CLIMB, CRUISE, DESCENT, APPROACH, LANDED
    this.tod = null;
  }

  // ===== 性能計算 =====
  static vs1g(weightKg, flapName, elevM = 0) {
    const fi = flapIndexByName(flapName);
    const clmax = B789.flaps[Math.max(0, fi)].clmax;
    const rho = 1.225; // 等価対気速度で計算 → CAS ≒ EAS（低高度）
    return Math.sqrt(2 * weightKg * G0 / (rho * B789.S * clmax)) / KT;
  }

  computeTakeoff(weightKg, elevM, oatC) {
    const vs = FMC.vs1g(weightKg, this.toFlaps, elevM);
    const v2 = Math.max(1.15 * vs, 125);
    this.v2 = Math.round(v2);
    this.vr = Math.round(Math.max(v2 - 6, 1.06 * vs, 120));
    this.v1 = Math.round(Math.max(this.vr - 5, 110));
    // 重量に応じたスタビライザートリム（重心 25%MAC 想定）
    this.toTrim = +clamp(4.0 + (weightKg - 180000) / 70000 * 1.5 + (15 - +this.toFlaps) * 0.03, 3, 7).toFixed(1);
    return { v1: this.v1, vr: this.vr, v2: this.v2, trim: this.toTrim };
  }

  computeApproach(landingWeightKg) {
    this.vref25 = Math.round(1.23 * FMC.vs1g(landingWeightKg, '25'));
    this.vref30 = Math.round(1.23 * FMC.vs1g(landingWeightKg, '30'));
    return { vref25: this.vref25, vref30: this.vref30 };
  }

  get vref() { return this.ldgFlaps === '25' ? this.vref25 : this.vref30; }

  /** フラップ操作速度（ボーイング標準: VREF30 + 増分） */
  flapManeuverSpeeds() {
    const v = this.vref30 || 140;
    return { UP: v + 80, '1': v + 60, '5': v + 40, '15': v + 20, '17': v + 20, '18': v + 20, '20': v + 20, '25': this.vref25 || v + 5, '30': v };
  }

  // ===== 経路 =====
  setOrigin(icao, rwyId) {
    this.origin = findAirport(icao);
    if (this.origin && rwyId) this.depRwy = runwayGeometry(this.origin, findRunway(this.origin, rwyId));
  }
  setDest(icao, rwyId) {
    this.dest = findAirport(icao);
    if (this.dest && rwyId) {
      this.arrRwy = runwayGeometry(this.dest, findRunway(this.dest, rwyId));
      this.ils = new ILS(this.arrRwy);
    }
  }

  /** 出発滑走路 → VOR 経由 → 到着滑走路 の経路を自動生成 */
  buildRoute() {
    const legs = [];
    const dep = this.depRwy, arr = this.arrRwy;
    if (!dep || !arr) return;
    const elevD = dep.elevM / FT, elevA = arr.elevM / FT;
    // 出発: 滑走路方位で 6 NM まで上昇
    const d1 = destination(dep.endLat, dep.endLon, dep.hdgTrue, 4 * NM);
    legs.push({ ident: 'DP' + dep.id, lat: d1.lat, lon: d1.lon, alt: Math.round((elevD + 3000) / 100) * 100, altType: 'A', kind: 'DEP' });

    // 到着側の最終進入点
    const back = wrap360(arr.hdgTrue + 180);
    const ffDist = 8.0;
    const ffAlt = Math.floor((elevA + ffDist * NM * Math.tan(3 * DEG) / FT + 50) / 100) * 100;
    const ff = destination(arr.thrLat, arr.thrLon, back, ffDist * NM);
    const ci = destination(arr.thrLat, arr.thrLon, back, 15 * NM);

    // エンルート: 大圏上 40NM 以内の VOR を 60NM 以上間隔で採用
    const total = distance(d1.lat, d1.lon, ci.lat, ci.lon);
    const cand = [];
    for (const n of NAVAIDS) {
      if (!n.type.startsWith('VOR')) continue;
      const xt = crossTrack(d1.lat, d1.lon, ci.lat, ci.lon, n.lat, n.lon);
      if (Math.abs(xt.xtk) < 40 * NM && xt.along > 30 * NM && xt.along < total - 40 * NM) cand.push({ n, along: xt.along, x: Math.abs(xt.xtk) });
    }
    cand.sort((a, b) => a.along - b.along);
    let lastAlong = 0;
    for (const c of cand) {
      if (c.along - lastAlong < 70 * NM) continue;
      legs.push({ ident: c.n.id, lat: c.n.lat, lon: c.n.lon, kind: 'ENR', name: c.n.name });
      lastAlong = c.along;
    }

    // 進入経路への接続（場周的な誘導点を必要に応じ追加）
    const prev = legs[legs.length - 1];
    const brgToCi = bearing(prev.lat, prev.lon, ci.lat, ci.lon);
    const intercept = Math.abs(wrap180(brgToCi - arr.hdgTrue));
    const sideSign = wrap180(bearing(arr.thrLat, arr.thrLon, prev.lat, prev.lon) - arr.hdgTrue) > 0 ? 1 : -1;
    if (intercept > 70) {
      if (intercept > 120) {
        const dw0 = destination(arr.thrLat, arr.thrLon, arr.hdgTrue + 90 * sideSign, 7 * NM);
        const dw = destination(dw0.lat, dw0.lon, arr.hdgTrue, 2 * NM);
        legs.push({ ident: 'DW' + arr.id, lat: dw.lat, lon: dw.lon, kind: 'ARR', alt: ffAlt + 1000, altType: 'A' });
      }
      const b0 = destination(arr.thrLat, arr.thrLon, back, 15 * NM);
      const bs = destination(b0.lat, b0.lon, arr.hdgTrue + 90 * sideSign, 5 * NM);
      legs.push({ ident: 'BS' + arr.id, lat: bs.lat, lon: bs.lon, kind: 'ARR', alt: ffAlt + 500, altType: 'A' });
    }
    legs.push({ ident: 'CI' + arr.id, lat: ci.lat, lon: ci.lon, alt: ffAlt, altType: 'A', kind: 'APP', spd: 210 });
    legs.push({ ident: 'FF' + arr.id, lat: ff.lat, lon: ff.lon, alt: ffAlt, altType: '@', kind: 'APP', spd: 180 });
    legs.push({ ident: 'RW' + arr.id, lat: arr.thrLat, lon: arr.thrLon, alt: Math.round(elevA + 50), altType: '@', kind: 'RWY' });
    this.legs = legs;
    this.active = 0;
    this.updatePredictions();
  }

  /** LEGS に直行（DIRECT TO） */
  directTo(ident, lat, lon) {
    const i = this.legs.findIndex(l => l.ident === ident.toUpperCase());
    if (i >= 0) { this.active = i; this.directFrom = { lat, lon }; return true; }
    const f = findFix(ident, lat, lon);
    if (!f) return false;
    this.legs.splice(this.active, 0, { ident: f.ident, lat: f.lat, lon: f.lon, kind: 'ENR' });
    this.directFrom = { lat, lon };
    return true;
  }

  insertWaypoint(index, ident, nearLat, nearLon) {
    const f = findFix(ident, nearLat, nearLon);
    if (!f) return false;
    this.legs.splice(index, 0, { ident: f.ident, lat: f.lat, lon: f.lon, kind: 'ENR' });
    this.updatePredictions();
    return true;
  }
  deleteWaypoint(index) {
    if (index < 0 || index >= this.legs.length) return;
    this.legs.splice(index, 1);
    if (this.active > index) this.active--;
    this.active = clamp(this.active, 0, Math.max(0, this.legs.length - 1));
  }

  get activeLeg() { return this.legs[this.active]; }

  /** 現在の航法レグ（from → to） */
  legGeometry(lat, lon) {
    const to = this.legs[this.active];
    if (!to) return null;
    const from = this.directFrom || (this.active > 0 ? this.legs[this.active - 1]
      : (this.depRwy ? { lat: this.depRwy.thrLat, lon: this.depRwy.thrLon } : { lat, lon }));
    const crs = bearing(from.lat, from.lon, to.lat, to.lon);
    const xt = crossTrack(from.lat, from.lon, to.lat, to.lon, lat, lon);
    const dtg = distance(lat, lon, to.lat, to.lon);
    const crsNow = bearing(lat, lon, to.lat, to.lon);
    return { from, to, crs, xtk: xt.xtk, along: xt.along, dtg, crsNow };
  }

  /** ウェイポイント通過判定（旋回先行） */
  sequence(lat, lon, gsMs) {
    const lg = this.legGeometry(lat, lon);
    if (!lg || this.active >= this.legs.length - 1) return;
    const next = this.legs[this.active + 1];
    const nextCrs = bearing(lg.to.lat, lg.to.lon, next.lat, next.lon);
    const turn = Math.abs(wrap180(nextCrs - lg.crs));
    const R = (gsMs * gsMs) / (G0 * Math.tan(25 * DEG));
    const lead = clamp(R * Math.tan(Math.min(turn, 120) * DEG / 2), 500, 12 * NM);
    const legLen = distance(lg.from.lat, lg.from.lon, lg.to.lat, lg.to.lon);
    if (lg.dtg < lead || lg.along > legLen) {
      this.active++;
      this.directFrom = null;
      this.updatePredictions();
    }
  }

  /** 目的地までの残距離 (m) */
  distanceToDest(lat, lon) {
    let d = 0, p = { lat, lon };
    for (let i = this.active; i < this.legs.length; i++) {
      d += distance(p.lat, p.lon, this.legs[i].lat, this.legs[i].lon);
      p = this.legs[i];
    }
    return d;
  }

  /** 指定レグまでの経路距離 (m) */
  distanceToLeg(lat, lon, idx) {
    let d = 0, p = { lat, lon };
    for (let i = this.active; i <= idx && i < this.legs.length; i++) {
      d += distance(p.lat, p.lon, this.legs[i].lat, this.legs[i].lon);
      p = this.legs[i];
    }
    return d;
  }

  updatePredictions() {
    // T/D は 3° パスで最終進入点 (FF) 高度まで降下 + 減速分 8NM
    const ffIdx = this.legs.findIndex(l => l.ident.startsWith('FF'));
    if (ffIdx < 0) { this.tod = null; return; }
    const ffAlt = this.legs[ffIdx].alt;
    this.todDistFromFF = (this.crzAltFt - ffAlt) * FT / Math.tan(2.8 * DEG) + 8 * NM;
  }

  /** VNAV 降下パス上の目標高度 (ft)。null = パス外（巡航） */
  vnavPathAlt(lat, lon) {
    const ffIdx = this.legs.findIndex(l => l.ident.startsWith('FF'));
    if (ffIdx < 0 || this.active > ffIdx) return null;
    const ff = this.legs[ffIdx];
    const d = this.distanceToLeg(lat, lon, ffIdx);
    // FF から 8NM 手前までは FF 高度 + 減速区間、それ以遠は 2.8° パス
    const dPath = Math.max(0, d - 8 * NM);
    return ff.alt + dPath * Math.tan(2.8 * DEG) / FT;
  }

  /** 次の高度制限 */
  nextConstraint() {
    for (let i = this.active; i < this.legs.length; i++) if (this.legs[i].alt != null) return { i, leg: this.legs[i] };
    return null;
  }
}
