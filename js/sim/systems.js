// 機体システム: 電源・APU・燃料・油圧・灯火・ブレーキ／オートブレーキ・スピードブレーキ・
// 降着装置・フラップ、および EICAS 警報メッセージ
import { DEG, KT, FT, G0, clamp, approach } from '../util/math.js';
import { B789 } from './aircraft-787.js';

export const AUTOBRAKE = ['RTO', 'OFF', 'DISARM', '1', '2', '3', '4', 'MAX AUTO'];
const AB_DECEL = { '1': 1.2, '2': 1.5, '3': 1.9, '4': 2.3, 'MAX AUTO': 3.4 }; // m/s²

export class Systems {
  constructor() {
    this.battery = true;
    this.extPwrAvail = false; this.extPwr = false;
    this.apuSwitch = 'OFF'; this.apuN = 0; this.apuRunning = false; this.apuEgt = 15; this.apuStartT = 0;
    this.genL = true; this.genR = true;
    this.fuelPumps = { L: true, C: true, R: true };
    this.tanks = { L: 15000, C: 0, R: 15000 };
    this.lights = { landing: false, taxi: false, turnoff: false, nav: true, beacon: true, strobe: false, logo: true, wing: false };
    this.seatbelt = true; this.noSmoking = true;
    this.antiIce = { wing: 'AUTO', eng: 'AUTO' };
    this.hydPumps = { L: true, C: true, R: true };
    this.autobrake = 'OFF';
    this.abActive = false;
    this.brakeCmd = 0;
    this.speedbrakeLever = 0;   // 0..1 (FLIGHT DETENT = 0.6, UP = 1)
    this.speedbrakeArmed = false;
    this.groundSpoiler = 0;
    this.gearLever = 'DN';
    this.flapLever = 0;         // インデックス
    this.parkingBrake = true;
    this.brakeTemp = [1, 1, 1, 1];
    this.transponder = 'TA/RA';
    this.squawk = '2000';
    this.baroStd = false;
    this.minimumsBaro = 200;    // ft（滑走路標高からの高さ）
    this.efis = { range: 20, mode: 'MAP', terr: false, wxr: false, arpt: true, sta: true, wpt: true };
    this.messages = { warning: [], caution: [], advisory: [], memo: [] };
    this.masterWarning = false; this.masterCaution = false;
    this._prevW = new Set(); this._prevC = new Set();
    this.events = [];
    this.rtoArmedSpeed = false;
  }

  get fuelTotal() { return this.tanks.L + this.tanks.C + this.tanks.R; }
  setFuel(kg) {
    // 主翼タンク各 約 23,600 kg、残りを中央タンクへ
    const wing = Math.min(kg / 2, 23600);
    this.tanks.L = wing; this.tanks.R = wing; this.tanks.C = Math.max(0, kg - 2 * wing);
  }

  acPower(sim) {
    const engGen = sim.engines.some(e => e.running && e.n2 > 50);
    return (this.extPwr && this.extPwrAvail) || (this.apuRunning) || engGen;
  }

  update(dt, sim) {
    const f = sim.fdm, o = f.out;
    const ac = B789;

    // ---- APU ----
    if (this.apuSwitch === 'START' && this.battery) { this.apuSwitch = 'ON'; this.apuStarting = true; }
    if (this.apuSwitch === 'ON' && this.battery) {
      if (!this.apuRunning) {
        this.apuN = approach(this.apuN, 100, 100 / ac.apuStartTime * dt);
        this.apuEgt = approach(this.apuEgt, this.apuN > 20 ? 650 : 15, 40 * dt);
        if (this.apuN >= 99.5) { this.apuRunning = true; this.apuStarting = false; }
      } else {
        this.apuEgt = approach(this.apuEgt, 420, 15 * dt);
      }
    } else {
      this.apuRunning = false; this.apuStarting = false;
      this.apuN = approach(this.apuN, 0, 8 * dt);
      this.apuEgt = approach(this.apuEgt, (o.atm ? o.atm.T - 273.15 : 15), 5 * dt);
    }
    this.ac = this.acPower(sim) && this.battery;
    this.dc = this.battery || this.ac;

    // ---- 燃料消費 ----
    let burn = 0;
    for (const e of sim.engines) burn += e.ff * dt;
    if (this.apuRunning) burn += 0.035 * dt;
    // 中央タンク優先（ポンプ ON 時）
    let rem = burn;
    if (this.fuelPumps.C && this.tanks.C > 0 && this.ac) {
      const d = Math.min(this.tanks.C, rem); this.tanks.C -= d; rem -= d;
    }
    if (rem > 0) {
      const half = rem / 2;
      this.tanks.L = Math.max(0, this.tanks.L - half);
      this.tanks.R = Math.max(0, this.tanks.R - half);
    }
    f.fuel = this.fuelTotal;

    // ---- 降着装置 ----
    const onGround = sim.onGround;
    if (this.gearLever === 'UP' && onGround) this.gearLever = 'DN'; // 地上ではロック
    const gearTarget = this.gearLever === 'UP' ? 0 : 1;
    if (this.ac || this.gearLever === 'DN') f.gearPos = approach(f.gearPos, gearTarget, dt / (gearTarget ? 12 : 10));

    // ---- フラップ ----
    const flapTarget = this.flapLever;
    if (this.ac) f.flapPos = approach(f.flapPos, flapTarget, ac.flapRate * dt * (flapTarget < f.flapPos ? 1.2 : 1));

    // ---- スピードブレーキ／グラウンドスポイラー ----
    const leversIdle = sim.engines.every(e => e.lever < 0.05);
    const anyRev = sim.engines.some(e => e.revLever > 0.05);
    if (onGround) {
      const autoDeploy = (this.speedbrakeArmed && leversIdle && f.mainWow > 0) ||
        (o.ias > 85 && leversIdle && this.autobrake === 'RTO') || anyRev;
      if (autoDeploy && this.groundSpoiler < 1) {
        this.groundSpoiler = 1; this.speedbrakeLever = 1; this.speedbrakeArmed = false;
      }
      if (!leversIdle && !anyRev && this.groundSpoiler > 0 && sim.engines.some(e => e.lever > 0.3)) {
        this.groundSpoiler = 0; this.speedbrakeLever = 0;
      }
      if (this.speedbrakeLever >= 0.99 && f.mainWow > 0) this.groundSpoiler = 1;
      if (this.speedbrakeLever < 0.05 && !this.speedbrakeArmed) this.groundSpoiler = 0;
    } else {
      this.groundSpoiler = 0;
    }
    f.groundSpoiler = approach(f.groundSpoiler || 0, this.groundSpoiler, dt * 1.5);
    const inflight = onGround ? 0 : clamp(this.speedbrakeLever / 0.6, 0, 1);
    f.speedbrake = approach(f.speedbrake, onGround ? Math.max(this.speedbrakeLever, 0) : inflight, dt * 1.2);

    // ---- ブレーキ／オートブレーキ ----
    let bL = sim.pilot.brakeL || 0, bR = sim.pilot.brakeR || 0;
    const gsKt = o.gs / KT;
    if (this.autobrake === 'RTO') {
      if (onGround && o.ias > 85 && leversIdle && sim.takeoffRoll) { this.abActive = true; this.abTarget = 99; }
    } else if (AB_DECEL[this.autobrake]) {
      if (onGround && f.mainWow > 0 && leversIdle && sim.landedRoll && gsKt > 5) { this.abActive = true; this.abTarget = AB_DECEL[this.autobrake]; }
    }
    if (this.abActive) {
      if (bL > 0.5 || bR > 0.5 || sim.engines.some(e => e.lever > 0.2) || (this.speedbrakeLever < 0.05 && !this.groundSpoiler && sim.landedRoll)) {
        this.abActive = false; this.autobrake = 'DISARM'; this.events.push({ type: 'caution-sound' });
      } else if (gsKt < 3) {
        this.abActive = false;
      } else {
        const decel = -(f.nx || 0) * G0;
        if (this.abTarget >= 99) this.brakeCmd = 1;
        else this.brakeCmd = clamp(this.brakeCmd + (this.abTarget - decel) * 0.6 * dt, 0, 1);
        bL = Math.max(bL, this.brakeCmd); bR = Math.max(bR, this.brakeCmd);
      }
    } else this.brakeCmd = 0;
    f.brakeL = bL; f.brakeR = bR;
    f.parkingBrake = this.parkingBrake;
    // ブレーキ温度（簡易）
    for (let i = 0; i < 4; i++) {
      const b = i < 2 ? bL : bR;
      this.brakeTemp[i] += (b * gsKt * 0.0025 - (this.brakeTemp[i] - 1) * 0.004) * dt * 10;
      this.brakeTemp[i] = clamp(this.brakeTemp[i], 0, 9.9);
    }

    this.computeMessages(sim);
  }

  computeMessages(sim) {
    const f = sim.fdm, o = f.out, af = sim.af;
    const W = [], C = [], A = [], M = [];
    const onGround = sim.onGround;
    const flapName = B789.flaps[Math.round(f.flapPos)].name;
    // ---- 離陸形態警報 ----
    if (onGround && sim.engines.some(e => e.lever > 0.45) && o.ias < (sim.fmc.v1 || 140)) {
      if (!B789.takeoffFlaps.map(String).includes(flapName) || Math.abs(f.flapPos - this.flapLever) > 0.05) W.push('CONFIG FLAPS');
      if (this.parkingBrake) W.push('CONFIG PARKING BRAKE');
      if (this.speedbrakeLever > 0.05) W.push('CONFIG SPOILERS');
      const units = sim.trimUnits;
      if (units < 2.5 || units > 8.5) W.push('CONFIG STABILIZER');
    }
    // ---- 着陸形態警報 ----
    if (!onGround && f.gearPos < 0.99) {
      const idle = sim.engines.every(e => e.lever < 0.1);
      if (f.flapPos >= 6.5 || (idle && sim.raFt < 800)) W.push('CONFIG GEAR');
    }
    if (o.ias > B789.VMO + 2 || o.mach > B789.MMO + 0.005) W.push('OVERSPEED');
    if (af.apDiscWarning) W.push('AUTOPILOT DISC');
    if (sim.fbw.stickShaker) W.push('STALL');
    // ---- 注意 ----
    if (af.atDiscWarning) C.push('AUTOTHROTTLE DISC');
    sim.engines.forEach((e, i) => { if (!e.running && !onGround) C.push(`ENG SHUTDOWN ${i ? 'R' : 'L'}`); });
    if (this.fuelTotal < 2500) C.push('FUEL QTY LOW');
    if (Math.abs(this.tanks.L - this.tanks.R) > 1500) C.push('FUEL IMBALANCE');
    if (!onGround && f.gearPos > 0.01 && f.gearPos < 0.99 && sim.gearTransit > 20) C.push('GEAR DISAGREE');
    if (af.ap && sim.raFt < 1500 && af.vert.active === 'G/S' && !af.land3) C.push('NO AUTOLAND');
    if (this.brakeTemp.some(t => t > 5)) C.push('BRAKE TEMP');
    if (!this.ac && this.battery) C.push('ELEC AC BUS');
    if (af.dragRequired) A.push('DRAG REQUIRED');
    // ---- アドバイザリ ----
    if (!onGround && this.speedbrakeLever > 0.05 && (sim.raFt < 800 || f.flapPos > 3.5 || sim.engines.some(e => e.lever > 0.15))) A.push('SPEEDBRAKE EXTENDED');
    if (this.autobrake === 'DISARM') A.push('AUTOBRAKE');
    if (sim.fbw.mode === 'DIRECT') C.push('FLIGHT CONTROL MODE');
    if (o.ias > B789.flaps[Math.round(f.flapPos)].vfe + 3 && f.flapPos > 0.5) W.push('OVERSPEED');
    // ---- メモ ----
    if (this.parkingBrake) M.push('PARKING BRAKE SET');
    if (this.seatbelt) M.push('SEATBELTS ON');
    if (this.noSmoking) M.push('NO SMOKING ON');
    if (this.apuRunning) M.push('APU RUNNING');
    if (this.speedbrakeArmed) M.push('SPEEDBRAKE ARMED');
    if (AB_DECEL[this.autobrake] || this.autobrake === 'RTO') M.push('AUTOBRAKE ' + (this.autobrake === 'MAX AUTO' ? 'MAX' : this.autobrake));
    if (sim.engines.some(e => e.startSwitch === 'START')) M.push('ENGINE START');
    const uniq = a => [...new Set(a)];
    this.messages = { warning: uniq(W), caution: uniq(C), advisory: uniq(A), memo: uniq(M) };

    // マスターワーニング／コーション（新規発生時に点灯・音）
    for (const w of this.messages.warning) if (!this._prevW.has(w)) {
      this.masterWarning = true;
      const snd = w.startsWith('CONFIG') ? 'siren' : w === 'OVERSPEED' ? 'clacker' : w === 'AUTOPILOT DISC' ? 'wailer' : w === 'STALL' ? null : 'bell';
      if (snd) this.events.push({ type: 'sound', name: snd, key: w });
    }
    for (const c of this.messages.caution) if (!this._prevC.has(c)) { this.masterCaution = true; this.events.push({ type: 'sound', name: 'caution' }); }
    this._prevW = new Set(this.messages.warning);
    this._prevC = new Set(this.messages.caution);
    if (!this.messages.warning.length) this.masterWarning = false;
  }

  resetMaster(sim) {
    this.masterWarning = false; this.masterCaution = false;
    sim.af.apDiscWarning = false; sim.af.atDiscWarning = false;
    this.events.push({ type: 'silence' });
  }
}
