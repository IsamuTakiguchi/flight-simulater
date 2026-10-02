// 国際標準大気 (ISA) + 気温偏差・QNH・風
import { KT, FT, DEG, clamp } from '../util/math.js';

const T0 = 288.15, P0 = 101325, RHO0 = 1.225, L = 0.0065, R = 287.053, GAMMA = 1.4, G = 9.80665;

/** 気圧高度 hp (m) と ISA 偏差 dT (K) から大気状態 */
export function isa(hp, dT = 0) {
  let Tisa, p;
  if (hp < 11000) {
    Tisa = T0 - L * hp;
    p = P0 * Math.pow(Tisa / T0, G / (L * R));
  } else {
    Tisa = 216.65;
    const p11 = P0 * Math.pow(216.65 / T0, G / (L * R));
    p = p11 * Math.exp(-G * (hp - 11000) / (R * 216.65));
  }
  const T = Tisa + dT;
  const rho = p / (R * T);
  const a = Math.sqrt(GAMMA * R * T);
  return { T, p, rho, a, sigma: rho / RHO0, delta: p / P0, theta: T / T0 };
}

/** 真対気速度 → 較正対気速度 (m/s), 圧縮性考慮 */
export function tasToCas(tas, atm) {
  const M = tas / atm.a;
  const qc = atm.p * (Math.pow(1 + 0.2 * M * M, 3.5) - 1);
  return 340.294 * Math.sqrt(5 * (Math.pow(qc / P0 + 1, 2 / 7) - 1));
}
export function casToTas(cas, atm) {
  const qc = P0 * (Math.pow(1 + 0.2 * (cas / 340.294) ** 2, 3.5) - 1);
  const M = Math.sqrt(5 * (Math.pow(qc / atm.p + 1, 2 / 7) - 1));
  return M * atm.a;
}
export function machToCas(M, atm) { return tasToCas(M * atm.a, atm); }

/** QNH (hPa) から気圧高度への換算: 真高度 h (m MSL) → 気圧高度 */
export function pressureAltitude(h, qnh) {
  return h + (1013.25 - qnh) * 8.32; // 1 hPa ≒ 27.3 ft ≒ 8.32 m
}

export class Weather {
  constructor(opts = {}) {
    this.windDir = opts.windDir ?? 0;          // 吹いてくる方向(真方位,度)
    this.windKt = opts.windKt ?? 0;
    this.gustKt = opts.gustKt ?? 0;
    this.turbulence = opts.turbulence ?? 0;    // 0..1
    this.dT = opts.dT ?? 0;                    // ISA 偏差 (K)
    this.qnh = opts.qnh ?? 1013.25;
    this.visibilityM = opts.visibilityM ?? 30000;
    this.cloudBaseFt = opts.cloudBaseFt ?? 4000;
    this.cloudCover = opts.cloudCover ?? 0.3;  // 0..1
    this.cloudTopFt = opts.cloudTopFt ?? 7000;
    this._t = 0;
    this._turb = [0, 0, 0];
  }
  /** 外気温 (℃) を地上値として設定 */
  setSurfaceTemp(c, elevM = 0) { this.dT = (c + 273.15) - (T0 - L * elevM); }

  /** 高度 h (m)、対地高度 agl (m) における風ベクトル NED (m/s) */
  wind(h, agl, dt = 0) {
    // 地表付近は対数則で弱め、上空は強める（簡易）
    const hft = h / FT;
    let k = agl < 1 ? 0.6 : clamp(0.6 + 0.4 * Math.log10(1 + agl / 10) / Math.log10(31), 0.6, 1.0);
    k *= 1 + clamp((hft - 3000) / 30000, 0, 1) * 1.5;
    let spd = this.windKt * KT * k;
    this._t += dt;
    if (this.gustKt > 0) spd += this.gustKt * KT * 0.5 * (1 + Math.sin(this._t * 0.7) * Math.sin(this._t * 0.23));
    const dir = this.windDir * DEG;
    const w = [-spd * Math.cos(dir), -spd * Math.sin(dir), 0];
    if (this.turbulence > 0 && dt > 0) {
      // 一次遅れフィルタ付きランダム（Dryden 風の簡易モデル）
      const sigma = this.turbulence * 3.5 * (agl < 300 ? 0.5 + agl / 600 : 1);
      const tau = 1.2;
      for (let i = 0; i < 3; i++) {
        const n = (Math.random() * 2 - 1) * Math.sqrt(3);
        this._turb[i] += (-this._turb[i] / tau + sigma * Math.sqrt(2 / tau) * n / Math.sqrt(dt)) * dt;
      }
      w[0] += this._turb[0]; w[1] += this._turb[1]; w[2] += this._turb[2] * 0.6;
    }
    return w;
  }
}
