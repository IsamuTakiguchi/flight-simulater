// フライ・バイ・ワイヤ飛行制御則（787 ノーマルモード C*U 縦系 / 横・方向系 / 包絡線保護）
import { DEG, RAD, KT, G0, clamp, cross } from '../util/math.js';
import { B789 } from './aircraft-787.js';

/** スタビライザー角 (rad) ⇔ トリム単位 (0〜15) */
export const ihToUnits = ih => clamp(4.6 - ih * RAD * 0.85, 0, 15);
export const unitsToIh = u => (4.6 - u) / 0.85 * DEG;

export class FBW {
  static tune = { kp: 0.45, ki: 0.9, kq: 1.2 };
  constructor() {
    this.mode = 'NORMAL';       // 'NORMAL' | 'DIRECT'
    this.autoTrimAssist = false; // 操縦補助：トリム基準速度を常に同期
    this.vRefTrim = 250;        // C*U トリム基準速度 (kt)
    this.int = 0;
    this.nzF = 1;
    this.flightBlend = 0;
    this.phiHold = 0;
    this.rollHolding = false;
    this.pInt = 0;
    this.rHP = 0; this.rLP = 0;
    this.stickShaker = false;
    this.protections = { alpha: false, speed: false, bank: false, pitch: false };
    this.out = { nzCmd: 1 };
  }

  syncTrimSpeed(ias) { this.vRefTrim = ias; }

  /**
   * fdm: FDM, pilot: {pitch, roll, yaw, tiller, trim}, ap: {pitch:{nzCmd}|null, roll:{bankCmd}|null, rudder, steer}
   */
  update(dt, fdm, pilot, ap, ctx) {
    const o = fdm.out, ac = B789;
    if (!o.atm) return;
    const V = Math.max(o.tas, 30);
    const ias = o.ias;
    const qbar = Math.max(0.5 * o.atm.rho * o.tas * o.tas, 400);
    const phi = o.bank * DEG, theta = o.pitch * DEG;
    const gamma = Math.atan2(o.vs, Math.max(o.gs, 30));
    const [p, q, r] = fdm.w;
    const alpha = o.alpha * DEG;
    const aStall = o.aStall * DEG;
    const m = fdm.mass;
    const onGround = fdm.mainWow > 0;
    this.nzF += (fdm.nz - this.nzF) * clamp(dt * 12, 0, 1);

    // 空中／地上ブレンド（離陸後 3 秒かけてノーマル則へ）
    this.flightBlend = onGround ? Math.max(0, this.flightBlend - dt) : Math.min(1, this.flightBlend + dt / 3);

    // ===== 縦系 =====
    let de;
    const pitchIn = clamp(pilot.pitch + (ap && ap.column != null ? ap.column : 0), -1, 1);
    const direct = -pitchIn * ac.deMax;
    const stickFree = Math.abs(pitchIn) < 0.05;
    if (this.mode === 'DIRECT') {
      de = direct;
      fdm.ih = clamp(fdm.ih + (pilot.trim || 0) * -ac.ihRate * dt, ac.ihMin, ac.ihMax);
      this.int = 0;
    } else {
      // トリム基準速度（C*U の U 項）
      const apOn = !!(ap && ap.pitch);
      if (apOn || this.autoTrimAssist || onGround || this.flightBlend < 1) this.vRefTrim = ias;
      else if (pilot.trim) this.vRefTrim = clamp(this.vRefTrim - pilot.trim * 6 * dt, 100, ac.VMO);
      // 基本 nz 指令（経路角保持＋バンク補償 30°まで）
      const phiC = clamp(Math.abs(phi), 0, 30 * DEG);
      let nzCmd = Math.cos(gamma) / Math.cos(phiC);
      if (apOn) {
        nzCmd = ap.pitch.nzCmd;
      } else {
        const flaps = fdm.flapPos > 0.5;
        nzCmd += pitchIn > 0 ? pitchIn * (flaps ? 1.0 : 1.5) : pitchIn * 1.4;
        if (!this.autoTrimAssist) nzCmd += clamp(0.012 * (ias - this.vRefTrim), -0.35, 0.35);
      }
      // ---- 包絡線保護 ----
      this.protections.alpha = false; this.protections.speed = false; this.protections.pitch = false;
      const aProt = aStall - 2.5 * DEG;
      if (alpha > aProt) {
        nzCmd = Math.min(nzCmd, this.nzF - 9 * (alpha - aProt));
        this.protections.alpha = true;
      }
      const vmo = ac.VMO + 4, mmo = ac.MMO + 0.01;
      if (ias > vmo || o.mach > mmo) {
        nzCmd += Math.max((ias - vmo) * 0.03, (o.mach - mmo) * 12);
        this.protections.speed = true;
      }
      if (o.pitch > 25) { nzCmd -= (o.pitch - 25) * 0.06; this.protections.pitch = true; }
      if (o.pitch < -15) { nzCmd += (-15 - o.pitch) * 0.06; this.protections.pitch = true; }
      nzCmd = clamp(nzCmd, fdm.flapPos > 0.5 ? 0 : -1, fdm.flapPos > 0.5 ? 2.0 : 2.5);
      this.out.nzCmd = nzCmd;

      // ---- 内側ループ（nz 追従 + ピッチレート減衰）----
      const Gs = qbar * ac.S * ac.aero.CLa / (m * G0) * 0.93;  // g / rad(δe)
      const T = FBW.tune;
      const Kp = T.kp / Gs, Ki = T.ki / Gs;
      const Kq = clamp(T.kq * (m * ac.ky * ac.ky) / (qbar * ac.S * ac.c * 1.3), 0.2, 8);
      const qExp = Math.cos(phi) * G0 * (nzCmd * Math.cos(phi) - Math.cos(gamma)) / V + G0 * Math.sin(phi) * Math.tan(clamp(phi, -1.2, 1.2)) / V;
      const e = nzCmd - this.nzF;
      let deC = -(Kp * e + Ki * this.int) + Kq * (q - qExp);
      const sat = Math.abs(deC) > ac.deMax;
      if (!sat || Math.sign(e) !== Math.sign(this.int)) this.int = clamp(this.int + e * dt, -0.6, 0.6);
      deC = clamp(deC, -ac.deMax, ac.deMax);
      de = direct + (deC - direct) * this.flightBlend;
      if (this.flightBlend < 1) this.int *= this.flightBlend;
      // 自動スタビライザートリム（エレベーターの定常舵角をアンロード）
      if (!onGround && this.flightBlend >= 1) {
        fdm.ih = clamp(fdm.ih + clamp(0.35 * de, -ac.ihRate, ac.ihRate) * dt, ac.ihMin, ac.ihMax);
      } else if (onGround && pilot.trim) {
        fdm.ih = clamp(fdm.ih + pilot.trim * -ac.ihRate * dt, ac.ihMin, ac.ihMax);
      }
    }
    // エレベーター作動速度制限
    fdm.de += clamp(de - fdm.de, -60 * DEG * dt, 60 * DEG * dt);

    // ===== 横系 =====
    const rollIn = clamp(pilot.roll, -1, 1);
    let da;
    if (this.mode === 'DIRECT' || onGround || this.flightBlend < 0.3) {
      da = rollIn * ac.daMax;
      this.phiHold = phi; this.pInt = 0;
    } else {
      let pCmd;
      if (ap && ap.roll) {
        pCmd = clamp(0.55 * (ap.roll.bankCmd * DEG - phi), -4 * DEG, 4 * DEG);
        this.phiHold = phi;
      } else if (Math.abs(rollIn) > 0.04) {
        const s = Math.sign(rollIn) * (Math.abs(rollIn) - 0.04) / 0.96;
        pCmd = s * Math.abs(s) * 0.4 + s * 0.6;
        pCmd *= 15 * DEG;
        this.phiHold = phi;
      } else {
        if (Math.abs(this.phiHold) < 3 * DEG) this.phiHold *= 1 - dt * 0.5;
        if (Math.abs(this.phiHold) > 30 * DEG) this.phiHold = Math.sign(this.phiHold) * 30 * DEG;
        pCmd = clamp(0.6 * (this.phiHold - phi), -6 * DEG, 6 * DEG);
      }
      // バンク角保護（35°超で 30° へ戻す）
      this.protections.bank = Math.abs(phi) > 35 * DEG;
      if (this.protections.bank) pCmd -= Math.sign(phi) * 0.9 * (Math.abs(phi) - 33 * DEG);
      const cff = -ac.aero.Clp * ac.b / (2 * V) / ac.aero.Clda;
      this.pInt = clamp(this.pInt + (pCmd - p) * dt, -0.2, 0.2);
      da = cff * pCmd + 2.2 * cff * (pCmd - p) + 1.5 * cff * this.pInt;
      // 高速時は外側エルロンロックアウト相当でゲイン低下
      da = clamp(da, -ac.daMax, ac.daMax) * clamp(1.15 - (ias - 250) / 400, 0.5, 1);
    }
    fdm.da += clamp(da - fdm.da, -45 * DEG * dt, 45 * DEG * dt);

    // ===== 方向系 =====
    const yawIn = clamp(pilot.yaw, -1, 1);
    const ratio = clamp(1 - (ias - 160) / 260, 0.25, 1); // ラダー比変換
    let dr = yawIn * ac.drMax * ratio;
    // ヨーダンパー（ハイパス）
    this.rLP += (r - this.rLP) * clamp(dt / 3, 0, 1);
    const rHP = r - this.rLP;
    if (!onGround && this.mode !== 'DIRECT') {
      dr += -1.6 * rHP * ratio;
      dr += 1.2 * (o.beta * DEG) * this.flightBlend;   // 旋回協調
    } else if (!onGround) {
      dr += -1.0 * rHP * ratio;
    }
    // TAC（推力非対称補償）
    let Neng = 0;
    for (let i = 0; i < 2; i++) Neng += cross(ac.engines[i].pos, [fdm.thrusts[i], 0, 0])[2];
    if (ias > 50 && Math.abs(Neng) > 2e5) {
      dr += clamp(-Neng / (qbar * ac.S * ac.b * ac.aero.Cndr) * 0.9, -ac.drMax, ac.drMax);
    }
    if (ap && ap.rudder != null) dr += ap.rudder;
    dr = clamp(dr, -ac.drMax, ac.drMax);
    fdm.dr += clamp(dr - fdm.dr, -50 * DEG * dt, 50 * DEG * dt);

    // ===== 前輪操向 =====
    const gsKt = o.gs / KT;
    let steer = (pilot.tiller || 0) * 70 * DEG * clamp(1 - (gsKt - 10) / 30, 0, 1) + yawIn * 7 * DEG;
    if (ap && ap.steer != null) steer += ap.steer;
    fdm.steer += clamp(steer - fdm.steer, -20 * DEG * dt, 20 * DEG * dt);

    // ===== 失速警報（スティックシェーカー）=====
    this.stickShaker = !onGround && alpha > aStall - 1.2 * DEG && o.ias > 60;
  }
}
