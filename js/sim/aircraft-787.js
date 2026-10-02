// Boeing 787-9 の機体諸元と空力モデル係数
// 公開資料（ボーイング社 Airport Planning Document, 型式証明データシート等）の値と、
// 同クラス機の公開空力データから推定した係数を組み合わせている。
// メーカー非公開の正式データパッケージではないため、実機と完全一致はしない。
import { DEG } from '../util/math.js';

export const B789 = {
  type: 'B787-9',
  name: 'Boeing 787-9 Dreamliner',
  engine: 'GEnx-1B74/75',

  // ---- 寸法 ----
  S: 360.5,          // 主翼面積 m²
  b: 60.12,          // 翼幅 m
  c: 7.0,            // 平均空力翼弦 m
  length: 62.81,
  height: 17.02,

  // ---- 重量 (kg) ----
  OEW: 128850,
  MZFW: 181437,
  MTOW: 254011,
  MLW: 192777,
  maxFuel: 101456,   // 126,372 L × 0.803
  // 慣性半径 (m)：I = m k²
  kx: 9.0, ky: 11.2, kz: 14.0,

  // ---- 速度制限 ----
  VMO: 350, MMO: 0.90,      // KIAS / Mach
  VLO: 270, VLE: 270, MLE: 0.82,
  maxAltFt: 43100,

  // ---- フラップ ----
  // 位置, 表示名, ΔCL0, CLmax, ΔCD0, ΔCm, プラカード速度 (KIAS)
  flaps: [
    { name: 'UP', dCL: 0.00, clmax: 1.25, dCD: 0.000, dCm: 0.00, vfe: 350 },
    { name: '1', dCL: 0.08, clmax: 1.55, dCD: 0.003, dCm: -0.005, vfe: 255 },
    { name: '5', dCL: 0.25, clmax: 1.75, dCD: 0.010, dCm: -0.02, vfe: 235 },
    { name: '15', dCL: 0.42, clmax: 1.92, dCD: 0.018, dCm: -0.035, vfe: 215 },
    { name: '17', dCL: 0.45, clmax: 1.95, dCD: 0.021, dCm: -0.040, vfe: 205 },
    { name: '18', dCL: 0.47, clmax: 1.97, dCD: 0.023, dCm: -0.042, vfe: 205 },
    { name: '20', dCL: 0.50, clmax: 2.00, dCD: 0.027, dCm: -0.048, vfe: 195 },
    { name: '25', dCL: 0.51, clmax: 2.08, dCD: 0.045, dCm: -0.065, vfe: 185 },
    { name: '30', dCL: 0.56, clmax: 2.17, dCD: 0.065, dCm: -0.085, vfe: 175 },
  ],
  takeoffFlaps: [5, 15, 17, 18, 20], // 表示名
  landingFlaps: [25, 30],
  flapRate: 0.30,          // 段/秒（UP→30 約30秒）

  // ---- 空力係数（機体軸, 1/rad）----
  aero: {
    CL0: 0.22, CLa: 5.6, CLq: 5.0, CLde: 0.30, CLih: 0.5,
    CD0: 0.0165, K: 0.0375, CDgear: 0.020, CDspoiler: 0.030, CDbeta: 0.35,
    Mcrit: 0.83,
    Cm0: 0.05, Cma: -1.4, Cmq: -25, Cmadot: -6, Cmde: -1.3, Cmih: -2.6,
    CYb: -0.85, CYdr: -0.15,
    Clb: -0.10, Clp: -0.42, Clr: 0.12, Clda: 0.09, Cldr: 0.006,
    Cnb: 0.16, Cnr: -0.28, Cnp: -0.04, Cndr: 0.16, Cnda: -0.005,
    spoilerCL: -0.45,       // 地上スポイラー全開時の揚力減少
    spoilerFlightCL: -0.12, // 飛行中スピードブレーキ全開
  },

  // ---- 操縦舵面 ----
  deMax: 25 * DEG, daMax: 22 * DEG, drMax: 27 * DEG,
  ihMin: -12.5 * DEG, ihMax: 4.5 * DEG, ihRate: 0.45 * DEG,

  // ---- エンジン ----
  engines: [
    { pos: [5.5, -9.9, 1.6] },  // 左 (機体座標 x前, y右, z下; 重心基準 m)
    { pos: [5.5, 9.9, 1.6] },   // 右
  ],
  T0: 329000,         // 海面静止離陸推力 N (74,000 lbf)
  n1Idle: 21.0, n1FlightIdle: 24.5, n1ApproachIdle: 29.0, n1Max: 101.0,
  egtRedline: 1090,
  revMax: 0.30,       // 最大逆推力比

  // ---- 降着装置 (機体座標, z はオレオ全伸長時の車輪接地点) ----
  gear: [
    { name: 'NOSE', pos: [22.6, 0, 4.55], k: 1.1e6, c: 2.4e5, stroke: 0.45, steer: true },
    { name: 'LMLG', pos: [-2.4, -4.9, 4.65], k: 3.6e6, c: 7.0e5, stroke: 0.55, brake: true },
    { name: 'RMLG', pos: [-2.4, 4.9, 4.65], k: 3.6e6, c: 7.0e5, stroke: 0.55, brake: true },
  ],
  // 機体構造の接地判定点（尻もち・エンジン・翼端・胴体）
  structure: [
    { name: 'TAIL', pos: [-30.5, 0, 0.15], kind: 'tail' },
    { name: 'AFT BODY', pos: [-20, 0, 1.95], kind: 'body' },
    { name: 'BELLY', pos: [5, 0, 2.6], kind: 'body' },
    { name: 'NOSE', pos: [26, 0, 2.2], kind: 'body' },
    { name: 'L ENG', pos: [6.5, -9.9, 3.75], kind: 'engine' },
    { name: 'R ENG', pos: [6.5, 9.9, 3.75], kind: 'engine' },
    { name: 'L WINGTIP', pos: [-14, -30, 0.2], kind: 'wing' },
    { name: 'R WINGTIP', pos: [-14, 30, 0.2], kind: 'wing' },
  ],
  pilotEye: [23.6, -0.55, -1.55],
  apuStartTime: 45,
};

export function flapIndexByName(name) {
  return B789.flaps.findIndex(f => f.name === String(name));
}

/** フラップ位置（小数インデックス）での空力値を補間 */
export function flapAero(pos) {
  const f = B789.flaps;
  const i = Math.max(0, Math.min(f.length - 1, Math.floor(pos)));
  const j = Math.min(f.length - 1, i + 1);
  const t = Math.max(0, Math.min(1, pos - i));
  const L = k => f[i][k] + (f[j][k] - f[i][k]) * t;
  return { dCL: L('dCL'), clmax: L('clmax'), dCD: L('dCD'), dCm: L('dCm') };
}
