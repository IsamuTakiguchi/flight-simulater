// シミュレーション全体の統合（物理・システム・自動飛行・航法）
import { DEG, RAD, KT, FT, NM, G0, clamp, wrap360, wrap180 } from '../util/math.js';
import { destination, distance, bearing, crossTrack } from '../util/geo.js';
import { isa, Weather, casToTas, machToCas, pressureAltitude } from './atmosphere.js';
import { B789, flapIndexByName, flapAero } from './aircraft-787.js';
import { FDM } from './fdm.js';
import { FBW, ihToUnits, unitsToIh } from './fbw.js';
import { Engine } from './engines.js';
import { Systems } from './systems.js';
import { AutoFlight } from './autoflight.js';
import { FMC } from './fmc.js';
import { GPWS } from './gpws.js';
import { Elevation } from './elevation.js';
import { findAirport, findRunway, runwayGeometry, ILS } from './navigation.js';

export const PHYS_DT = 1 / 240;

export class Simulation {
  constructor(opts = {}) {
    this.elevation = opts.elevation || new Elevation();
    this.weather = new Weather();
    this.fdm = new FDM();
    this.fdm.groundElev = (lat, lon) => this.elevation.height(lat, lon);
    this.fbw = new FBW();
    this.engines = [new Engine(0), new Engine(1)];
    this.sys = new Systems();
    this.af = new AutoFlight();
    this.fmc = new FMC();
    this.gpws = new GPWS();
    this.pilot = { pitch: 0, roll: 0, yaw: 0, tiller: 0, trim: 0, brakeL: 0, brakeR: 0 };
    this.time = 0;
    this.acc = 0;
    this.paused = false;
    this.simRate = 1;
    this.events = [];
    this.flightPhase = 'PREFLIGHT';
    this.takeoffRoll = false; this.landedRoll = false; this.wasAirborne = false;
    this.ils = null; this.ilsDev = null;
    this.raFt = 0; this.altFt = 0; this.vsFpm = 0; this.agl = 0;
    this.landingReport = null;
    this.crashed = null;
    this.gearTransit = 0;
    this.minimumsAltFt = null;
    this.timeOfDay = 12;  // 時（現地時刻）
    this.derive();
  }

  get onGround() { return this.fdm.mainWow > 0 || (this.fdm.anyWow && this.agl < 6); }
  get trimUnits() { return ihToUnits(this.fdm.ih); }
  get grossWeight() { return this.fdm.mass; }

  // ===== 初期配置 =====
  /**
   * sc: { origin, depRwy, dest, arrRwy, start: 'runway'|'cold'|'final10'|'final5'|'cruise',
   *       payloadKg, fuelKg, weather:{...}, oatC, timeOfDay, autoTrim }
   */
  setup(sc) {
    this.scenario = sc;
    const f = this.fdm;
    Object.assign(this.weather, new Weather(sc.weather || {}));
    this.timeOfDay = sc.timeOfDay ?? 12;
    this.fbw.autoTrimAssist = !!sc.autoTrim;
    this.fmc.setOrigin(sc.origin, sc.depRwy);
    this.fmc.setDest(sc.dest || sc.origin, sc.arrRwy || sc.depRwy);
    if (sc.crzAltFt) this.fmc.crzAltFt = sc.crzAltFt;
    else {
      const d = distance(this.fmc.origin.lat, this.fmc.origin.lon, this.fmc.dest.lat, this.fmc.dest.lon) / NM;
      this.fmc.crzAltFt = d < 120 ? 17000 : d < 220 ? 27000 : d < 400 ? 35000 : 39000;
    }
    this.fmc.buildRoute();
    this.ils = this.fmc.ils;
    f.payload = sc.payloadKg ?? 25000;
    this.sys.setFuel(sc.fuelKg ?? 30000);
    f.fuel = this.sys.fuelTotal;
    const dep = this.fmc.depRwy;
    const oat = sc.oatC ?? 15;
    this.weather.setSurfaceTemp(oat, dep.elevM);
    const tow = f.mass;
    this.fmc.computeTakeoff(tow, dep.elevM, oat);
    const lw = tow - this.estimateTripFuel();
    this.fmc.computeApproach(Math.min(lw, B789.MLW));
    this.minimumsAltFt = this.fmc.arrRwy.elevM / FT + this.sys.minimumsBaro;
    this.crashed = null; f.crashed = null; this.landingReport = null;
    this.events = []; this.time = 0;
    const start = sc.start || 'runway';
    if (start === 'runway' || start === 'cold') this.placeOnRunway(start === 'cold');
    else if (start === 'final10') this.placeOnFinal(10, true);
    else if (start === 'final5') this.placeOnFinal(5, false);
    else if (start === 'cruise') this.placeCruise();
    this.derive();
  }

  estimateTripFuel() {
    const o = this.fmc.origin, d = this.fmc.dest;
    const nm = distance(o.lat, o.lon, d.lat, d.lon) / NM;
    return Math.min(this.sys.fuelTotal * 0.85, 2500 + nm * 11.5);
  }

  resetCommon() {
    const f = this.fdm;
    f.w = [0, 0, 0]; f.de = 0; f.da = 0; f.dr = 0; f.steer = 0;
    f.tailStrike = false; f.touchdown = null; f.events = [];
    this.af = new AutoFlight();
    this.gpws = new GPWS();
    this.fbw = Object.assign(new FBW(), { autoTrimAssist: this.fbw.autoTrimAssist });
    this.sys.events = [];
    this.takeoffRoll = false; this.landedRoll = false; this.wasAirborne = false;
  }

  placeOnRunway(cold) {
    this.resetCommon();
    const f = this.fdm, g = this.fmc.depRwy, s = this.sys, af = this.af;
    const p = destination(g.startLat, g.startLon, g.hdgTrue, 45);
    f.lat = p.lat; f.lon = p.lon;
    const elev = this.elevation.height(p.lat, p.lon);
    f.h = elev + 4.42;
    f.setAttitude(0.0, 0, g.hdgTrue);
    f.vN = [0, 0, 0];
    f.gearPos = 1;
    s.gearLever = 'DN';
    s.parkingBrake = true;
    s.flapLever = cold ? 0 : flapIndexByName(this.fmc.toFlaps);
    f.flapPos = s.flapLever;
    f.ih = unitsToIh(cold ? 4 : this.fmc.toTrim);
    s.speedbrakeLever = 0; s.speedbrakeArmed = false; s.groundSpoiler = 0;
    s.extPwrAvail = cold;
    af.mcp.spd = this.fmc.v2 || 160;
    af.mcp.hdg = Math.round(g.hdgMag);
    af.mcp.alt = Math.max(5000, Math.ceil((g.elevM / FT + 4000) / 1000) * 1000);
    if (cold) {
      for (const e of this.engines) { e.running = false; e.n1 = 0; e.n2 = 0; e.fuelControl = 'CUTOFF'; e.egt = 15; e.lever = 0; }
      s.battery = false; s.apuSwitch = 'OFF'; s.apuRunning = false; s.apuN = 0;
      Object.assign(s.lights, { landing: false, taxi: false, turnoff: false, nav: false, beacon: false, strobe: false, logo: false, wing: false });
      s.fuelPumps = { L: false, C: false, R: false };
      s.autobrake = 'OFF';
      af.fd = false; af.atArm = false;
      s.seatbelt = false; s.noSmoking = false;
    } else {
      for (const e of this.engines) { e.setRunning(B789.n1Idle); e.lever = 0; }
      s.battery = true; s.apuSwitch = 'OFF';
      Object.assign(s.lights, { landing: true, taxi: true, turnoff: true, nav: true, beacon: true, strobe: true, logo: true, wing: false });
      s.fuelPumps = { L: true, C: true, R: true };
      s.autobrake = 'RTO';
      af.fd = true; af.atArm = true;
      af.lat.active = 'TO/GA'; af.vert.active = 'TO/GA';
      af.lat.armed = 'LNAV'; af.vert.armed = 'VNAV';
      af.toTrack = g.hdgTrue;
    }
    this.flightPhase = 'PREFLIGHT';
    this.fdm._prevWow = true;
    // 脚の沈み込みを安定させる
    this.settle(3);
  }

  settle(sec) {
    const n = Math.round(sec / PHYS_DT);
    for (let i = 0; i < n; i++) this.physStep(PHYS_DT, true);
    this.fdm.vN = [0, 0, 0]; this.fdm.w = [0, 0, 0];
    this.fdm.events = [];
    this.fdm.touchdown = null;
  }

  /** 定常飛行のトリム状態を解析的に求める */
  trimFlight(iasKt, gammaDeg, hM) {
    const f = this.fdm, A = B789.aero;
    const hp = pressureAltitude(hM, this.weather.qnh);
    const atm = isa(hp, this.weather.dT);
    const tas = casToTas(iasKt * KT, atm);
    const qbar = 0.5 * atm.rho * tas * tas;
    const m = f.mass, W = m * G0;
    const fa = flapAero(f.flapPos);
    const gam = gammaDeg * DEG;
    let alpha = 3 * DEG, ih = 0, T = 0;
    for (let it = 0; it < 8; it++) {
      const CLreq = (W * Math.cos(gam) - T * Math.sin(alpha)) / (qbar * B789.S);
      ih = (A.Cm0 + A.Cma * alpha + fa.dCm - 0.02 * f.gearPos) / -A.Cmih;
      alpha = (CLreq - A.CL0 - fa.dCL - A.CLih * ih) / A.CLa;
      const CL = A.CL0 + fa.dCL + A.CLa * alpha;
      const dM = Math.max(0, tas / atm.a - A.Mcrit);
      const CD = A.CD0 + fa.dCD + A.CDgear * f.gearPos + A.K * 0.15 * 0 + A.K * (CL - 0.1) ** 2 + 20 * dM ** 4;
      T = (qbar * B789.S * CD + W * Math.sin(gam)) / Math.cos(alpha);
    }
    return { alpha, ih, T, tas, atm };
  }

  setEnginesForThrust(Ttotal, atm, mach, hFt) {
    const n1Max = Engine.maxN1(atm, hFt, this.weather.dT);
    const tav = Engine.availThrust(atm, mach);
    const idleT = 0.028 * B789.T0 * Math.pow(atm.sigma, 0.8) - mach * atm.a * 22;
    const frac = clamp((Ttotal / 2 - idleT) / (tav - mach * atm.a * 22), 0, 1);
    for (const e of this.engines) {
      e.setRunning();
      const n1 = Engine.n1ForFrac(frac, n1Max);
      e.n1 = n1; e.n2 = 58 + 0.42 * n1;
      const idle = B789.n1FlightIdle;
      e.lever = clamp((n1 - idle) / (n1Max - idle), 0, 1);
    }
  }

  placeOnFinal(nm, apOn) {
    this.resetCommon();
    const f = this.fdm, s = this.sys, af = this.af, ils = this.ils, g = this.fmc.arrRwy;
    const back = wrap360(g.hdgTrue + 180);
    const p = destination(ils.gpiLat, ils.gpiLon, back, nm * NM);
    f.lat = p.lat; f.lon = p.lon;
    f.h = g.elevM + Math.tan(3 * DEG) * nm * NM;
    s.flapLever = flapIndexByName(this.fmc.ldgFlaps); f.flapPos = s.flapLever;
    s.gearLever = 'DN'; f.gearPos = 1;
    s.parkingBrake = false; s.autobrake = '3'; s.speedbrakeArmed = true;
    s.apuSwitch = 'OFF';
    Object.assign(s.lights, { landing: true, taxi: false, turnoff: true, nav: true, beacon: true, strobe: true, logo: true, wing: false });
    s.fuelPumps = { L: true, C: true, R: true };
    const ias = this.fmc.vref + 5;
    // 着陸重量に調整
    const fuel = Math.min(this.sys.fuelTotal, 9000);
    this.sys.setFuel(fuel); f.fuel = fuel;
    this.fmc.computeApproach(f.mass);
    const tr = this.trimFlight(this.fmc.vref + 5, -3, f.h);
    const wind = this.weather.wind(f.h, f.h - g.elevM, 0);
    // 風を考慮した偏流角
    const crs = g.hdgTrue * DEG;
    const wCross = -wind[0] * Math.sin(crs) + wind[1] * Math.cos(crs);
    const wca = Math.asin(clamp(-wCross / tr.tas, -0.5, 0.5)) * RAD;
    f.setAttitude(tr.alpha * RAD - 3, 0, g.hdgTrue + wca);
    const hdg = (g.hdgTrue + wca) * DEG;
    const vAir = [tr.tas * Math.cos(hdg) * Math.cos(-3 * DEG), tr.tas * Math.sin(hdg) * Math.cos(-3 * DEG), tr.tas * Math.sin(3 * DEG)];
    f.vN = [vAir[0] + wind[0], vAir[1] + wind[1], vAir[2]];
    f.ih = tr.ih;
    this.setEnginesForThrust(tr.T, tr.atm, tr.tas / tr.atm.a, f.h / FT);
    af.fd = true; af.atArm = true; af.at = true; af.thr = 'SPD';
    af.mcp.spd = ias; af.mcp.hdg = Math.round(g.hdgMag);
    af.mcp.alt = Math.ceil((g.elevM / FT + 3000) / 100) * 100;
    af.lat.active = 'LOC'; af.vert.active = 'G/S';
    af.ap = !!apOn;
    this.fbw.flightBlend = 1;
    this.fbw.vRefTrim = ias;
    this.fmc.active = this.fmc.legs.length - 1;
    this.flightPhase = 'APPROACH';
    this.wasAirborne = true;
    this.fdm._prevWow = false;
    this.fdm.alphaPrev = tr.alpha;
    this.physStep(PHYS_DT, false);
  }

  placeCruise() {
    this.resetCommon();
    const f = this.fdm, s = this.sys, af = this.af, fmc = this.fmc;
    // 経路の 1/3 付近
    const total = fmc.distanceToDest(fmc.depRwy.thrLat, fmc.depRwy.thrLon);
    let acc = 0, p = { lat: fmc.depRwy.thrLat, lon: fmc.depRwy.thrLon }, idx = 0, pos = p;
    for (let i = 0; i < fmc.legs.length; i++) {
      const L = fmc.legs[i];
      const d = distance(p.lat, p.lon, L.lat, L.lon);
      if (acc + d > total * 0.3) {
        const brg = bearing(p.lat, p.lon, L.lat, L.lon);
        pos = destination(p.lat, p.lon, brg, total * 0.3 - acc);
        idx = i; break;
      }
      acc += d; p = L;
    }
    fmc.active = idx;
    const to = fmc.legs[idx];
    const hdg = bearing(pos.lat, pos.lon, to.lat, to.lon);
    f.lat = pos.lat; f.lon = pos.lon;
    f.h = fmc.crzAltFt * FT;
    s.flapLever = 0; f.flapPos = 0; s.gearLever = 'UP'; f.gearPos = 0;
    s.parkingBrake = false; s.autobrake = 'OFF';
    Object.assign(s.lights, { landing: false, taxi: false, turnoff: false, nav: true, beacon: true, strobe: true, logo: false, wing: false });
    s.fuelPumps = { L: true, C: true, R: true };
    const atm0 = isa(f.h, this.weather.dT);
    const ias = machToCas(0.85, atm0) / KT;
    const tr = this.trimFlight(ias, 0, f.h);
    const wind = this.weather.wind(f.h, f.h, 0);
    f.setAttitude(tr.alpha * RAD, 0, hdg);
    f.vN = [tr.tas * Math.cos(hdg * DEG) + wind[0], tr.tas * Math.sin(hdg * DEG) + wind[1], 0];
    f.ih = tr.ih;
    this.setEnginesForThrust(tr.T, tr.atm, tr.tas / tr.atm.a, f.h / FT);
    af.fd = true; af.atArm = true; af.at = true; af.thr = 'SPD';
    af.mcp.isMach = true; af.mcp.mach = 0.85; af.mcp.spd = Math.round(ias);
    af.mcp.alt = fmc.crzAltFt; af.mcp.hdg = Math.round(wrap360(hdg - fmc.origin.magVar));
    af.lat.active = 'LNAV'; af.vert.active = 'VNAV PTH';
    af.ap = true;
    this.fbw.flightBlend = 1; this.fbw.vRefTrim = ias;
    this.flightPhase = 'CRUISE';
    this.wasAirborne = true;
    this.fdm._prevWow = false;
    this.fdm.alphaPrev = tr.alpha;
    this.physStep(PHYS_DT, false);
  }

  // ===== 時間発展 =====
  update(frameDt) {
    if (this.paused || this.crashed) { this.derive(); return; }
    const dtTotal = Math.min(frameDt, 0.1) * this.simRate;
    this.acc += dtTotal;
    let n = 0;
    while (this.acc >= PHYS_DT && n < 240 * 4) {
      this.physStep(PHYS_DT, false);
      this.acc -= PHYS_DT; n++;
      if (this.crashed) break;
    }
    this.frameUpdate(dtTotal);
  }

  physStep(dt, settling) {
    const f = this.fdm;
    this.time += dt;
    // エンジン
    const o = f.out;
    const atm = o.atm || isa(f.h);
    const hFt = f.h / FT;
    this.n1MaxAvail = Engine.maxN1(atm, hFt, this.weather.dT);
    const approachIdle = f.flapPos >= 6.5 || (f.gearPos > 0.5 && !this.onGround);
    this.engCtx = {
      dt, atm, mach: o.mach || 0, tas: o.tas || 0, hFt, dT: this.weather.dT, onGround: this.onGround, approachIdle,
      power: this.sys.ac, fuelAvail: this.sys.fuelTotal > 1, n1MaxAvail: this.n1MaxAvail, oat: atm.T - 273.15,
    };
    for (const e of this.engines) e.update(this.engCtx);
    f.thrusts = this.engines.map(e => e.thrust);
    // 自動飛行・FBW
    if (!settling) this.af.update(dt, this);
    this.fbw.update(dt, f, this.pilot, settling ? null : this.af.cmd, {});
    f.step(dt, { weather: this.weather, time: this.time });
    this.derive();
  }

  derive() {
    const f = this.fdm, o = f.out;
    const ground = this.elevation.height(f.lat, f.lon);
    this.agl = f.h - ground;
    // 電波高度計: 主脚車輪の対地高
    const e = f.euler();
    const mg = B789.gear[1].pos;
    const wheelDrop = -mg[0] * Math.sin(e.theta) + mg[2] * Math.cos(e.theta) * Math.cos(e.phi) - (f.gearState[1]?.comp || 0);
    this.raFt = clamp((this.agl - wheelDrop) / FT, 0, 2500 * 4);
    this.raValid = this.raFt < 2500;
    const hp = o.hp ?? f.h;
    this.altFt = (this.sys.baroStd ? hp : f.h) / FT;
    this.vsFpm = (o.vs ?? 0) / FT * 60;
    const magVar = this.magVar();
    this.hdgMag = wrap360(o.hdgTrue - magVar);
    this.trackMag = wrap360(o.trackTrue - magVar);
    this.ilsDev = this.ils ? this.ils.deviation(f.lat, f.lon, f.h) : null;
    // 速度制限
    const fl = B789.flaps[Math.round(f.flapPos)];
    const vs1g = FMC.vs1g(f.mass, fl.name);
    this.stallSpeed = vs1g * Math.sqrt(Math.max(f.nz || 1, 0.5));
    this.minSpeed = Math.round(vs1g * 1.3);
    const fms = this.fmc.flapManeuverSpeeds();
    this.minManeuver = fl.name === '30' || fl.name === '25' ? fms[fl.name] : Math.max(fms[fl.name] - 20, vs1g * 1.3);
    let vmax = B789.VMO;
    if (o.atm) vmax = Math.min(vmax, machToCas(B789.MMO, o.atm) / KT);
    if (f.flapPos > 0.05) {
      const fi = Math.ceil(f.flapPos - 0.05);
      vmax = Math.min(vmax, B789.flaps[fi].vfe);
    }
    if (f.gearPos > 0.01) vmax = Math.min(vmax, B789.VLE);
    this.maxSpeed = vmax;
  }

  magVar() {
    const a = this.nearestAirport || this.fmc.origin;
    return a ? a.magVar : -7;
  }

  /** フレーム単位の処理（システム・警報・フェーズ判定） */
  frameUpdate(dt) {
    const f = this.fdm, o = f.out;
    this.sys.update(dt, this);
    this.gpws.update(dt, this);
    // 降着装置遷移時間
    if (f.gearPos > 0.01 && f.gearPos < 0.99) this.gearTransit += dt; else this.gearTransit = 0;

    // 飛行フェーズ
    const onG = this.onGround;
    if (onG) {
      if (this.engines.some(e => e.lever > 0.5) && o.gs > 2 && !this.wasAirborne) { this.takeoffRoll = true; this.flightPhase = 'TAKEOFF'; }
      if (this.wasAirborne && !this.landedRoll) {
        this.landedRoll = true; this.flightPhase = 'LANDED';
        this.af.retard = false;
      }
    } else {
      if (this.takeoffRoll) { this.takeoffRoll = false; this.wasAirborne = true; this.flightPhase = 'TAKEOFF'; }
      this.wasAirborne = true;
      if (this.flightPhase === 'TAKEOFF' && this.agl > this.fmc.accelAglFt * FT) this.flightPhase = 'CLIMB';
      if (this.flightPhase === 'CLIMB' && this.altFt > this.fmc.crzAltFt - 300) this.flightPhase = 'CRUISE';
      if ((this.flightPhase === 'CRUISE' || this.flightPhase === 'CLIMB') && this.af.vert.active === 'VNAV PTH' && this.vsFpm < -500) this.flightPhase = 'DESCENT';
      const dd = this.fmc.dest ? distance(f.lat, f.lon, this.fmc.dest.lat, this.fmc.dest.lon) / NM : 999;
      if (this.flightPhase === 'DESCENT' && (f.flapPos > 0.5 || dd < 20)) this.flightPhase = 'APPROACH';
      if (this.flightPhase === 'CLIMB' && this.landedRoll === false && dd < 25 && this.altFt < this.fmc.crzAltFt - 3000 && this.vsFpm < -300) this.flightPhase = 'APPROACH';
    }

    // LNAV 以外でもウェイポイントを順次通過処理
    if (!onG && this.af.lat.active !== 'LNAV' && this.fmc.legs.length) this.fmc.sequence(f.lat, f.lon, o.gs);

    // 最寄り空港
    if (!this._nearT || this.time - this._nearT > 5) {
      this._nearT = this.time;
      let best = null, bd = Infinity;
      for (const a of [this.fmc.origin, this.fmc.dest]) {
        if (!a) continue;
        const d = distance(f.lat, f.lon, a.lat, a.lon);
        if (d < bd) { bd = d; best = a; }
      }
      this.nearestAirport = best;
    }

    // イベント集約
    for (const ev of f.events) {
      this.events.push(ev);
      if (ev.type === 'TOUCHDOWN' && this.wasAirborne) this.makeLandingReport(ev);
      if (ev.type === 'CRASH') this.crashed = ev.reason;
    }
    f.events = [];
    for (const ev of this.sys.events) this.events.push(ev);
    this.sys.events = [];
    for (const ev of this.gpws.events) this.events.push(ev);
    this.gpws.events = [];
    for (const m of this.af.messages) this.events.push({ type: 'message', text: m.text });
    this.af.messages = [];
  }

  makeLandingReport(td) {
    const g = this.fmc.arrRwy;
    if (!g) return;
    const ct = crossTrack(g.thrLat, g.thrLon, g.endLat, g.endLon, td.lat, td.lon);
    const vs = Math.abs(td.vsFpm);
    let grade, comment;
    if (vs < 120) { grade = 'S'; comment = '極めてスムーズな接地（バター）'; }
    else if (vs < 240) { grade = 'A'; comment = '良好な接地'; }
    else if (vs < 400) { grade = 'B'; comment = 'しっかりとした接地'; }
    else if (vs < 600) { grade = 'C'; comment = 'やや強い接地'; }
    else { grade = 'D'; comment = 'ハードランディング（整備点検が必要）'; }
    const tdz = ct.along > 150 && ct.along < 900;
    if (!tdz && grade < 'D') comment += ct.along < 150 ? '／接地帯手前' : '／接地帯を越えて接地';
    if (Math.abs(ct.xtk) > g.widthM / 2) { grade = 'D'; comment = '滑走路外に接地'; }
    this.landingReport = {
      grade, comment, vsFpm: Math.round(td.vsFpm), along: Math.round(ct.along), offset: +ct.xtk.toFixed(1),
      pitch: +td.pitch.toFixed(1), bank: +td.bank.toFixed(1), ias: Math.round(td.ias), tailStrike: this.fdm.tailStrike,
      runway: g.apt.icao + ' RWY ' + g.id,
    };
    this.events.push({ type: 'LANDING_REPORT', report: this.landingReport });
  }

  consumeEvents() { const e = this.events; this.events = []; return e; }

  // ===== パイロット操作 =====
  setFlapLever(idx) {
    this.sys.flapLever = clamp(idx, 0, B789.flaps.length - 1);
  }
  flapUp() { this.setFlapLever(this.sys.flapLever - 1); }
  flapDown() { this.setFlapLever(this.sys.flapLever + 1); }
  toggleGear() { this.sys.gearLever = this.sys.gearLever === 'UP' ? 'DN' : 'UP'; }
  moveThrottle(delta, which = null) {
    for (const [i, e] of this.engines.entries()) {
      if (which != null && which !== i) continue;
      if (delta < 0 && e.lever <= 0 && this.onGround) { e.revLever = clamp(e.revLever - delta, 0, 1); continue; }
      if (e.revLever > 0 && delta > 0) { e.revLever = clamp(e.revLever - delta, 0, 1); continue; }
      e.lever = clamp(e.lever + delta, 0, 1);
    }
    if (this.af.at && (this.af.thr === 'HOLD' || this.af.thr === '')) return;
  }
  setThrottle(v, which = null) {
    for (const [i, e] of this.engines.entries()) if (which == null || which === i) { e.lever = clamp(v, 0, 1); if (v > 0) e.revLever = 0; }
  }
  setReverse(v) {
    for (const e of this.engines) { if (e.lever < 0.05 || v === 0) { e.revLever = clamp(v, 0, 1); if (v > 0) e.lever = 0; } }
  }
  /** 着陸時の自動逆推力（デモ用） */
}
