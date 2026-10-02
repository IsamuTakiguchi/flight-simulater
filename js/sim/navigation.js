// 航法データベースと ILS・無線航法計算
import { AIRPORTS } from '../data/airports.js';
import { NAVAIDS } from '../data/navaids.js';
import { distance, bearing, destination, crossTrack } from '../util/geo.js';
import { DEG, RAD, FT, NM, wrap180, wrap360, clamp } from '../util/math.js';

export function findAirport(icao) {
  return AIRPORTS.find(a => a.icao === icao.toUpperCase() || a.iata === icao.toUpperCase());
}
export function findRunway(apt, id) {
  return apt && apt.runways.find(r => r.id === id);
}

/** 着陸滑走路端（移設滑走路端を考慮）の情報 */
export function runwayGeometry(apt, rwy) {
  const thr = rwy.dispM > 0 ? destination(rwy.lat, rwy.lon, rwy.hdg, rwy.dispM) : { lat: rwy.lat, lon: rwy.lon };
  const elevM = rwy.elevFt * FT, endElevM = rwy.endElevFt * FT;
  return {
    apt, rwy, id: rwy.id,
    thrLat: thr.lat, thrLon: thr.lon,
    startLat: rwy.lat, startLon: rwy.lon,
    endLat: rwy.endLat, endLon: rwy.endLon,
    hdgTrue: rwy.hdg, hdgMag: wrap360(rwy.hdg - apt.magVar),
    elevM, endElevM, lengthM: rwy.lengthM, widthM: rwy.widthM, dispM: rwy.dispM,
    ldaM: rwy.lengthM - rwy.dispM,
  };
}

/** 滑走路上の位置での標高（中心線に沿って線形補間） */
export function runwayElevAt(g, along) {
  return g.elevM + (g.endElevM - g.elevM) * clamp(along / g.lengthM, 0, 1);
}

/**
 * ILS（模擬）: ローカライザーは滑走路末端の先 300 m、
 * グライドパスは接地帯（TCH 50 ft となる位置）に設置。
 */
export class ILS {
  constructor(g, gsAngle = 3.0) {
    this.g = g;
    this.course = g.hdgTrue;
    this.courseMag = g.hdgMag;
    this.gsAngle = gsAngle;
    const loc = destination(g.endLat, g.endLon, g.hdgTrue, 300);
    this.locLat = loc.lat; this.locLon = loc.lon;
    const gpiDist = (50 * FT) / Math.tan(gsAngle * DEG);
    const gpi = destination(g.thrLat, g.thrLon, g.hdgTrue, gpiDist);
    this.gpiLat = gpi.lat; this.gpiLon = gpi.lon;
    this.elevM = g.elevM;
    const locDist = g.lengthM - g.dispM + 300;
    this.locHalfWidthDeg = Math.atan(106.7 / locDist) * RAD;    // 2 ドット
    this.ident = 'I' + g.apt.icao.slice(2) + g.id.replace(/[^0-9LRC]/g, '');
    this.freq = ILS.pseudoFreq(g);
  }

  static pseudoFreq(g) {
    // 実周波数データは同梱していないため、識別用の擬似周波数（108.10〜111.95 の奇数小数）を割当て
    let h = 0;
    for (const c of g.apt.icao + g.id) h = (h * 31 + c.charCodeAt(0)) % 1000;
    const ch = h % 40;
    return +(108.1 + Math.floor(ch / 2) * 0.2 + (ch % 2) * 0.05).toFixed(2);
  }

  /** 機体位置での偏位 */
  deviation(lat, lon, hM) {
    const brgFromLoc = bearing(this.locLat, this.locLon, lat, lon);
    const back = wrap360(this.course + 180);
    const locErr = wrap180(brgFromLoc - back);              // 正 = 機体はコース右側
    const dLoc = distance(this.locLat, this.locLon, lat, lon);
    const locValid = dLoc < 25 * NM && Math.abs(locErr) < 35;
    const locDots = clamp(-locErr / this.locHalfWidthDeg * 2, -2.5, 2.5); // 正 = コースは右（右へ修正）
    const dGs = distance(this.gpiLat, this.gpiLon, lat, lon);
    const gsBrgErr = wrap180(bearing(lat, lon, this.gpiLat, this.gpiLon) - this.course);
    const elevAng = Math.atan2(hM - this.elevM, dGs) * RAD;
    const gsErr = elevAng - this.gsAngle;                     // 正 = 機体はパスより上
    const gsValid = dGs < 10 * NM && Math.abs(gsBrgErr) < 10 && dGs > 50;
    const gsDots = clamp(-gsErr / 0.35, -2.5, 2.5);          // 正 = パスは上（上昇方向）
    const xt = crossTrack(this.locLat, this.locLon, destination(this.locLat, this.locLon, back, 10000).lat,
      destination(this.locLat, this.locLon, back, 10000).lon, lat, lon);
    return {
      locValid, gsValid, locDots, gsDots, locErrDeg: locErr, gsErrDeg: gsErr,
      dme: dGs / NM, xtkM: -xt.xtk, distThr: distance(this.g.thrLat, this.g.thrLon, lat, lon),
      gsAltM: this.elevM + Math.tan(this.gsAngle * DEG) * dGs,
    };
  }
}

/** 識別符号から航法点を検索（VOR/NDB, 空港） */
export function findFix(ident, nearLat, nearLon) {
  ident = ident.toUpperCase();
  const c = [];
  for (const n of NAVAIDS) if (n.id === ident) c.push({ ident: n.id, lat: n.lat, lon: n.lon, type: n.type, name: n.name, freq: n.freq });
  for (const a of AIRPORTS) if (a.icao === ident) c.push({ ident: a.icao, lat: a.lat, lon: a.lon, type: 'APT', name: a.nameJa });
  if (!c.length) return null;
  if (nearLat != null) c.sort((x, y) => distance(nearLat, nearLon, x.lat, x.lon) - distance(nearLat, nearLon, y.lat, y.lon));
  return c[0];
}

export function vorsNear(lat, lon, rangeM) {
  return NAVAIDS.filter(n => n.type.startsWith('VOR') && distance(lat, lon, n.lat, n.lon) < rangeM);
}

export { AIRPORTS, NAVAIDS };
