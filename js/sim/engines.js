// GEnx-1B 相当のターボファンエンジンモデル（FADEC・電動スタータ始動シーケンス・逆推力）
import { clamp, approach } from '../util/math.js';
import { B789 } from './aircraft-787.js';

const TSFC_UNIT = 2.8325e-5; // lb/(lbf·h) → kg/(N·s)
const N1Z = 20, N1EXP = 2.2;   // 推力 ∝ ((N1-20)/(N1max-20))^2.2

/** 推力定格 */
export const RATINGS = {
  'TO': 1.00, 'TO 1': 0.90, 'TO 2': 0.80, 'GA': 1.00, 'CON': 0.96, 'CLB': 0.93, 'CLB 1': 0.85, 'CLB 2': 0.78, 'CRZ': 0.88,
};

export class Engine {
  constructor(index) {
    this.index = index;
    this.pos = B789.engines[index].pos;
    this.n1 = 0; this.n2 = 0; this.egt = 15; this.ff = 0; this.thrust = 0;
    this.running = false;
    this.fuelControl = 'CUTOFF';  // 'RUN' | 'CUTOFF'
    this.startSwitch = 'NORM';    // 'START' | 'NORM'
    this.fuelOn = false;
    this.lever = 0;               // スラストレバー 0(アイドル)〜1(フル)
    this.revLever = 0;            // リバースレバー 0〜1
    this.revPos = 0;              // リバーサー展開量 0〜1
    this.failed = false;
    this.oilPress = 0;
    this.n1Cmd = 0;
    this.lightOff = false;
  }

  /** エンジンを即座に運転状態にする（初期配置用） */
  setRunning(n1 = B789.n1Idle) {
    this.running = true; this.fuelOn = true; this.fuelControl = 'RUN';
    this.n1 = n1; this.n2 = 58 + 0.42 * n1; this.egt = 400 + (n1 - 21) * 6;
    this.startSwitch = 'NORM';
  }

  /** 定格に対する最大 N1（気温・高度で変化） */
  static maxN1(atm, hFt, dT) {
    // 外気温が高いと定格推力を維持するため N1 が上がる（フラットレート温度 ISA+15 程度）
    return clamp(97.5 + hFt / 1000 * 0.12 + Math.max(0, dT - 15) * -0.15 + Math.min(dT, 15) * 0.08, 92, B789.n1Max);
  }

  /** 利用可能最大推力 (N) */
  static availThrust(atm, mach) {
    return B789.T0 * Math.pow(atm.sigma, 0.95) * (1 - 0.65 * mach + 0.35 * mach * mach);
  }
  /** N1 → 最大推力に対する比 */
  static fracForN1(n1, n1Max) {
    return Math.pow(clamp((n1 - N1Z) / (n1Max - N1Z), 0, 1.05), N1EXP);
  }
  static n1ForFrac(frac, n1Max) {
    return N1Z + (n1Max - N1Z) * Math.pow(clamp(frac, 0, 1.1), 1 / N1EXP);
  }

  idleN1(ctx) {
    if (ctx.onGround) return B789.n1Idle;
    return ctx.approachIdle ? B789.n1ApproachIdle : B789.n1FlightIdle;
  }

  /**
   * ctx: { dt, atm, mach, hFt, dT, onGround, approachIdle, power, fuelAvail, ratingN1, oat }
   */
  update(ctx) {
    const dt = ctx.dt;
    const oat = ctx.oat;
    const n1Max = ctx.n1MaxAvail;
    const idle = this.idleN1(ctx);

    // ---- 始動シーケンス ----
    if (!this.running) {
      const motoring = this.startSwitch === 'START' && ctx.power && !this.failed;
      if (motoring) {
        // 電動スタータで N2 を加速
        const target = this.fuelOn ? 68 : 24;
        const rate = this.fuelOn ? (this.n2 < 50 ? 1.9 : 1.3) : 1.6;
        this.n2 = approach(this.n2, target, rate * dt);
      } else {
        // 風車回転（対気速度に応じて）
        const wm = clamp(ctx.tas / 250, 0, 1) * 18;
        this.n2 = approach(this.n2, wm, 2.5 * dt);
      }
      if (this.fuelControl === 'RUN' && this.n2 >= 20 && ctx.fuelAvail && !this.failed && (motoring || this.n2 > 15)) {
        this.fuelOn = true;
      }
      if (this.fuelControl !== 'RUN' || !ctx.fuelAvail) this.fuelOn = false;
      this.lightOff = this.fuelOn && this.n2 > 22;
      const n1Target = Math.max(0, (this.n2 - 58) / 0.42);
      this.n1 = approach(this.n1, this.lightOff ? Math.max(n1Target, this.n2 * 0.25) : this.n2 * 0.28, 4 * dt);
      const egtT = this.lightOff ? oat + 120 + this.n2 * 8.5 : oat + (this.egt > oat ? 0 : 0);
      this.egt += (egtT - this.egt) * clamp(dt * (this.lightOff ? 0.5 : 0.08), 0, 1);
      if (this.lightOff && this.n2 >= 55) {
        this.running = true;
        this.startSwitch = 'NORM';
      }
      this.ff = this.fuelOn ? 0.05 + this.n2 * 0.0012 : 0;
      this.thrust = this.lightOff ? Engine.availThrust(ctx.atm, ctx.mach) * 0.01 : 0;
      this.oilPress = this.n2 * 0.9;
      this.revPos = approach(this.revPos, 0, dt / 2);
      return;
    }

    // ---- 停止 ----
    if (this.fuelControl !== 'RUN' || !ctx.fuelAvail || this.failed) {
      this.running = false; this.fuelOn = false; this.lightOff = false;
      return;
    }

    // ---- FADEC: レバー → N1 指令 ----
    const revDeployCmd = this.revLever > 0.02 && ctx.onGround;
    this.revPos = approach(this.revPos, revDeployCmd ? 1 : 0, dt / 2.0);
    let cmd;
    if (this.revPos > 0.9 && this.revLever > 0) {
      cmd = idle + this.revLever * (82 - idle);
    } else if (this.revPos > 0.05 || this.revLever > 0) {
      cmd = idle; // リバーサー作動中はアイドル保持
    } else {
      cmd = idle + clamp(this.lever, 0, 1) * (n1Max - idle);
    }
    this.n1Cmd = cmd;
    // スプール応答（低回転ほど加速が遅い）
    const up = cmd > this.n1;
    const tau = up ? (this.n1 < 50 ? 3.2 : 1.6) : 1.8;
    this.n1 += (cmd - this.n1) * clamp(dt / tau, 0, 1);
    this.n1 = clamp(this.n1, 0, B789.n1Max + 1);
    this.n2 = 58 + 0.42 * this.n1;

    // ---- 推力 ----
    const frac = Engine.fracForN1(this.n1, n1Max);
    const tav = Engine.availThrust(ctx.atm, ctx.mach);
    let thrust = tav * frac + 0.028 * B789.T0 * Math.pow(ctx.atm.sigma, 0.8) * clamp(this.n1 / B789.n1Idle, 0, 1.3);
    // ラム抗力の簡易表現（高速アイドル時はほぼゼロ推力）
    thrust -= ctx.tas * 22 * (1 - frac);
    if (this.revPos > 0.05) {
      thrust = thrust * (1 - this.revPos) - this.revPos * tav * frac * B789.revMax;
    }
    this.thrust = thrust;

    // ---- 燃料流量・EGT ----
    const tsfc = (0.30 + 0.35 * ctx.mach) * TSFC_UNIT;
    this.ff = 0.065 * Math.sqrt(ctx.atm.delta) + Math.max(0, Math.abs(thrust)) * tsfc;
    const egtT = oat + 360 + (this.n1 - 21) * 6.4 + Math.max(0, oat - 15) * 1.5;
    this.egt += (egtT - this.egt) * clamp(dt * 0.6, 0, 1);
    this.oilPress = 40 + this.n2 * 0.6;
  }
}
