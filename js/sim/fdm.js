// 6 自由度剛体飛行力学モデル (Flight Dynamics Model)
// 機体座標: x 前, y 右, z 下 / 航法座標: NED（北・東・下）
import {
  DEG, RAD, KT, FT, G0, clamp, add, sub, scale, cross, dot, len,
  qMul, qNorm, qRotate, qRotateInv, qToEuler, qFromEuler, wrap360,
} from '../util/math.js';
import { radii } from '../util/geo.js';
import { isa, tasToCas, pressureAltitude } from './atmosphere.js';
import { B789, flapAero } from './aircraft-787.js';

export class FDM {
  constructor() {
    const ac = B789;
    this.ac = ac;
    // 位置・姿勢
    this.lat = 35.55; this.lon = 139.78; this.h = 10;   // 度, 度, m (MSL)
    this.vN = [0, 0, 0];                                  // NED 速度 m/s
    this.q = [1, 0, 0, 0];                                // 姿勢クォータニオン
    this.w = [0, 0, 0];                                   // 機体角速度 p,q,r (rad/s)
    // 質量
    this.fuel = 30000; this.payload = 25000;
    // 舵面・形態（FBW / システムから設定）
    this.de = 0; this.ih = -1 * DEG; this.da = 0; this.dr = 0;
    this.speedbrake = 0;        // 0..1 (飛行中 / 地上自動展開も含む)
    this.flapPos = 0;           // 小数インデックス
    this.gearPos = 1;           // 0=UP 1=DOWN
    this.brakeL = 0; this.brakeR = 0; this.parkingBrake = false;
    this.steer = 0;             // 前輪操向角 rad
    this.runwayFriction = 1.0;  // 1=DRY 0.6=WET
    // 推力（エンジンから）
    this.thrusts = [0, 0];
    // 出力
    this.out = {};
    this.gearState = ac.gear.map(() => ({ comp: 0, load: 0, wow: false, spin: 0 }));
    this.alphaPrev = 0;
    this.groundElev = () => 0;
    this.crashed = null;
    this.tailStrike = false;
    this.touchdown = null;
    this.events = [];
    this._prevWow = false;
    this.computeOutputs(null);
  }

  get mass() { return this.ac.OEW + this.payload + this.fuel; }

  /** 姿勢設定（度） */
  setAttitude(pitchDeg, bankDeg, hdgTrueDeg) {
    this.q = qFromEuler(bankDeg * DEG, pitchDeg * DEG, hdgTrueDeg * DEG);
  }
  euler() {
    const e = qToEuler(this.q);
    return { phi: e.phi, theta: e.theta, psi: e.psi };
  }

  /** 1 ステップ積分 */
  step(dt, env) {
    if (this.crashed) return;
    const ac = this.ac, A = ac.aero;
    const m = this.mass;
    const Ixx = m * ac.kx * ac.kx, Iyy = m * ac.ky * ac.ky, Izz = m * ac.kz * ac.kz;

    // ---- 大気・風 ----
    const ground = this.groundElev(this.lat, this.lon);
    const aglCG = this.h - ground;
    const hp = pressureAltitude(this.h, env.weather.qnh);
    const atm = isa(hp, env.weather.dT);
    const wind = env.weather.wind(this.h, Math.max(0, aglCG - 4.4), dt);
    const vAirN = sub(this.vN, wind);
    const vb = qRotateInv(this.q, vAirN);
    const V = Math.max(len(vb), 0.1);
    const alpha = Math.atan2(vb[2], Math.max(vb[0], 0.1));
    const beta = Math.asin(clamp(vb[1] / V, -1, 1));
    const qbar = 0.5 * atm.rho * V * V;
    const mach = V / atm.a;
    const [p, qq, r] = this.w;
    const alphaDot = (alpha - this.alphaPrev) / dt;
    this.alphaPrev = alpha;

    // ---- 空力係数 ----
    const fa = flapAero(this.flapPos);
    const S = ac.S, b = ac.b, c = ac.c;
    const Vn = Math.max(V, 20);
    const ph = p * b / (2 * Vn), qh = qq * c / (2 * Vn), rh = r * b / (2 * Vn);
    const CL0 = A.CL0 + fa.dCL;
    const aStall = (fa.clmax - CL0) / A.CLa;               // 失速迎角
    let CLw;
    if (alpha < aStall) CLw = CL0 + A.CLa * alpha;
    else {
      const x = alpha - aStall;                            // 失速後：揚力低下
      CLw = fa.clmax - 6 * x * x - 0.8 * x;
      CLw = Math.max(CLw, 0.75 * fa.clmax);
    }
    // ソフトな最大揚力付近の丸め
    if (alpha > aStall - 3 * DEG && alpha < aStall) {
      const t = (alpha - (aStall - 3 * DEG)) / (3 * DEG);
      CLw -= 0.06 * t * t;
    }
    if (alpha < -12 * DEG) CLw = CL0 + A.CLa * -12 * DEG;
    // 地面効果
    const hb = Math.max(aglCG - 3, 0) / b;
    const geCL = 1 + 0.06 * Math.exp(-hb * 5);
    const geK = (16 * hb) ** 2 / (1 + (16 * hb) ** 2);
    const onGndSpoiler = this.groundSpoiler || 0;
    let CL = CLw * geCL + A.CLq * qh + A.CLde * this.de + A.CLih * this.ih
      + A.spoilerFlightCL * this.speedbrake * (1 - onGndSpoiler) + A.spoilerCL * onGndSpoiler;
    // 遷音速による揚力増と抗力発散
    const dM = Math.max(0, mach - A.Mcrit);
    const CDwave = 20 * dM ** 4 + (mach > 0.92 ? (mach - 0.92) * 0.15 : 0);
    const CD = A.CD0 + fa.dCD + A.CDgear * this.gearPos + A.CDspoiler * Math.max(this.speedbrake, onGndSpoiler)
      + A.K * (0.15 + 0.85 * geK) * (CLw - 0.1) ** 2 + CDwave + A.CDbeta * beta * beta
      + (alpha > aStall ? 0.6 * Math.sin(alpha - aStall) : 0);
    const CY = A.CYb * beta + A.CYdr * this.dr;
    const Cl = A.Clb * beta + A.Clp * ph + A.Clr * rh + A.Clda * this.da + A.Cldr * this.dr
      + (alpha > aStall ? Math.sin(this._buffet = (this._buffet || 0) + dt * 7) * 0.004 : 0);
    const Cm = A.Cm0 + A.Cma * alpha + A.Cmq * qh + A.Cmadot * alphaDot * c / (2 * Vn) + A.Cmde * this.de + A.Cmih * this.ih
      + fa.dCm - 0.02 * this.gearPos - 0.4 * Math.max(0, alpha - aStall) + 0.01 * this.speedbrake;
    const Cn = A.Cnb * beta + A.Cnr * rh + A.Cnp * ph + A.Cndr * this.dr + A.Cnda * this.da;

    // 揚力・抗力の方向（機体座標）
    const vhat = scale(vb, 1 / V);
    const liftDir = (() => {
      const lx = vb[2], lz = -vb[0];
      const l = Math.hypot(lx, lz) || 1;
      return [lx / l, 0, lz / l];
    })();
    let F = add(add(scale(liftDir, qbar * S * CL), scale(vhat, -qbar * S * CD)), [0, qbar * S * CY, 0]);
    let M = [qbar * S * b * Cl, qbar * S * c * Cm, qbar * S * b * Cn];

    // ---- 推力 ----
    for (let i = 0; i < 2; i++) {
      const T = this.thrusts[i];
      const pos = ac.engines[i].pos;
      const Ft = [T, 0, 0];
      F = add(F, Ft);
      M = add(M, cross(pos, Ft));
    }

    // ---- 降着装置・接地 ----
    const R = (v) => qRotate(this.q, v);
    const Rinv = (v) => qRotateInv(this.q, v);
    let anyWow = false;
    const gearDown = this.gearPos > 0.98;
    const hdgVecN = R([1, 0, 0]);
    const gs = [];
    let mainWow = 0;
    for (let i = 0; i < ac.gear.length; i++) {
      const g = ac.gear[i], st = this.gearState[i];
      st.load = 0; st.wow = false;
      if (!gearDown) { st.comp = 0; continue; }
      const pN = R(g.pos);
      const ptH = this.h - pN[2];
      const gElev = this.groundElev(this.lat + pN[0] / 111000, this.lon + pN[1] / (111000 * Math.cos(this.lat * DEG)));
      const pen = gElev - ptH;
      if (pen <= 0) { st.comp = 0; continue; }
      const vP = add(this.vN, R(cross(this.w, g.pos)));
      let comp = pen;
      let Fz = g.k * comp + g.c * vP[2];
      if (comp > g.stroke) Fz += (comp - g.stroke) * g.k * 20; // ボトミング
      Fz = Math.max(0, Fz);
      st.comp = Math.min(comp, g.stroke);
      st.load = Fz; st.wow = Fz > 1000;
      if (st.wow) anyWow = true;
      if (st.wow && g.brake) mainWow++;
      // 車輪方向（水平面）
      let fwd = [hdgVecN[0], hdgVecN[1], 0];
      const fl = Math.hypot(fwd[0], fwd[1]) || 1;
      fwd = [fwd[0] / fl, fwd[1] / fl, 0];
      if (g.steer) {
        const cs = Math.cos(this.steer), sn = Math.sin(this.steer);
        fwd = [fwd[0] * cs - fwd[1] * sn, fwd[0] * sn + fwd[1] * cs, 0];
      }
      const side = [-fwd[1], fwd[0], 0];
      const vLong = dot(vP, fwd), vLat = dot(vP, side);
      const mu = this.runwayFriction;
      // 縦方向：転がり抵抗＋ブレーキ（アンチスキッド付き）
      let brake = 0;
      if (g.brake) {
        brake = this.parkingBrake ? 1 : (g.pos[1] < 0 ? this.brakeL : this.brakeR);
      }
      const muRoll = 0.012;
      const muBrake = 0.55 * mu * brake;
      const vEps = this.parkingBrake ? 0.08 : 0.35;
      const FLong = -(muRoll + muBrake) * Fz * clamp(vLong / (brake > 0.5 ? 0.15 : vEps), -1, 1);
      // 横方向：コーナリング力
      const muLat = (g.steer ? 0.55 : 0.75) * mu;
      const FLat = -muLat * Fz * clamp(vLat / 0.25, -1, 1);
      const FgN = add(add(scale(fwd, FLong), scale(side, FLat)), [0, 0, -Fz]);
      const Fgb = Rinv(FgN);
      const contact = [g.pos[0], g.pos[1], g.pos[2] - st.comp];
      F = add(F, Fgb);
      M = add(M, cross(contact, Fgb));
      st.spin = Math.abs(vLong);
      gs.push({ i, Fz, vLong });
    }

    // ---- 構造物の接地（尻もち・クラッシュ判定）----
    for (const sp of ac.structure) {
      const pN = R(sp.pos);
      const ptH = this.h - pN[2];
      const pen = ground - ptH;
      if (pen > 0) {
        const vP = add(this.vN, R(cross(this.w, sp.pos)));
        if (sp.kind === 'tail') {
          if (!this.tailStrike) this.events.push({ type: 'TAILSTRIKE' });
          this.tailStrike = true;
        }
        const severe = sp.kind !== 'tail' && (vP[2] > 2.5 || len(this.vN) > 45 || sp.kind === 'engine' || sp.kind === 'wing');
        if (severe && (sp.kind !== 'body' || !gearDown || vP[2] > 4)) {
          this.crashed = sp.kind === 'engine' ? 'エンジンが地面に接触しました' : sp.kind === 'wing' ? '翼端が地面に接触しました' : '機体が地面に激突しました';
          this.events.push({ type: 'CRASH', reason: this.crashed });
          return;
        }
        const Fz = Math.max(0, 4e6 * pen + 8e5 * vP[2]);
        const fr = scale(norm2([vP[0], vP[1]]), -0.5 * Fz);
        const FgN = [fr[0], fr[1], -Fz];
        const Fgb = Rinv(FgN);
        F = add(F, Fgb);
        M = add(M, cross(sp.pos, Fgb));
        if (sp.kind === 'body') anyWow = true;
      }
    }

    // ---- 接地イベント（着地評価用）----
    if (anyWow && !this._prevWow && aglCG < 10) {
      const vs = -this.vN[2];
      const e = this.euler();
      this.touchdown = {
        vsFpm: vs / FT * 60, gload: 0, lat: this.lat, lon: this.lon, pitch: e.theta * RAD, bank: e.phi * RAD,
        ias: this.out.ias ?? 0, time: env.time ?? 0,
      };
      this.events.push({ type: 'TOUCHDOWN', ...this.touchdown });
      if (vs > 5.5) {
        this.crashed = `接地時の降下率が過大です (${Math.round(vs / FT * 60)} fpm)`;
        this.events.push({ type: 'CRASH', reason: this.crashed });
        return;
      }
    }
    this._prevWow = anyWow;

    // ---- 並進運動 ----
    const FN = R(F);
    const acc = [FN[0] / m, FN[1] / m, FN[2] / m + G0];
    this.vN = add(this.vN, scale(acc, dt));
    const { RM, RN } = radii(this.lat * DEG);
    this.lat += this.vN[0] * dt / (RM + this.h) * RAD;
    this.lon += this.vN[1] * dt / ((RN + this.h) * Math.cos(this.lat * DEG)) * RAD;
    this.h -= this.vN[2] * dt;

    // ---- 回転運動 ----
    const w = this.w;
    const Iw = [Ixx * w[0], Iyy * w[1], Izz * w[2]];
    const wxIw = cross(w, Iw);
    const wd = [(M[0] - wxIw[0]) / Ixx, (M[1] - wxIw[1]) / Iyy, (M[2] - wxIw[2]) / Izz];
    this.w = add(w, scale(wd, dt));
    const qd = qMul(this.q, [0, this.w[0], this.w[1], this.w[2]]);
    this.q = qNorm([this.q[0] + 0.5 * qd[0] * dt, this.q[1] + 0.5 * qd[1] * dt, this.q[2] + 0.5 * qd[2] * dt, this.q[3] + 0.5 * qd[3] * dt]);


    // 荷重倍数（機体 z 方向、上向き正）
    const specific = scale(F, 1 / m);
    this.nz = -specific[2] / G0;
    this.nx = specific[0] / G0;
    this.ny = specific[1] / G0;
    if (this.touchdown && this.touchdown.gload === 0 && anyWow) this.touchdown.gload = this.nz;
    this.anyWow = anyWow;
    this.mainWow = mainWow;
    this._aux = { atm, wind, alpha, beta, V, qbar, mach, aStall, ground, CL, CD, hp };
    this.computeOutputs(env);
  }

  computeOutputs(env) {
    const aux = this._aux;
    const e = this.euler();
    const o = this.out;
    o.pitch = e.theta * RAD; o.bank = e.phi * RAD; o.hdgTrue = wrap360(e.psi * RAD);
    o.vs = -this.vN[2];                 // m/s
    o.gs = Math.hypot(this.vN[0], this.vN[1]);
    o.trackTrue = wrap360(Math.atan2(this.vN[1], this.vN[0]) * RAD);
    if (!aux) return;
    o.alpha = aux.alpha * RAD; o.beta = aux.beta * RAD;
    o.tas = aux.V; o.mach = aux.mach;
    o.cas = tasToCas(aux.V, aux.atm);
    o.ias = o.cas / KT;
    o.atm = aux.atm; o.wind = aux.wind;
    o.aStall = aux.aStall * RAD;
    o.groundElev = aux.ground;
    o.hp = aux.hp;
    o.fpa = Math.atan2(o.vs, Math.max(o.gs, 1)) * RAD;
  }
}

function norm2(v) {
  const l = Math.hypot(v[0], v[1]);
  return l < 0.01 ? [0, 0] : [v[0] / l, v[1] / l];
}
