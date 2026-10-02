// 自動飛行システム (AFDS: オートパイロット / フライトディレクター / オートスロットル)
// 787 の MCP（モードコントロールパネル）と FMA 表示に準拠したモード体系
import { DEG, RAD, KT, FT, NM, G0, clamp, wrap180, wrap360, approach } from '../util/math.js';
import { isa, casToTas, tasToCas, machToCas } from './atmosphere.js';
import { RATINGS, Engine } from './engines.js';
import { B789 } from './aircraft-787.js';

export class AutoFlight {
  constructor() {
    this.mcp = { spd: 160, mach: 0.80, isMach: false, hdg: 0, alt: 5000, vs: 0, fpa: 0, hdgTrk: 'HDG', vsFpa: 'VS', spdIntv: false, bankLimit: 25 };
    this.ap = false; this.fd = true; this.atArm = true; this.at = false;
    this.lat = { active: '', armed: '' };
    this.vert = { active: '', armed: '' };
    this.thr = '';
    this.status = 'FD';
    this.apDiscWarning = false; this.atDiscWarning = false;
    this.rating = 'TO';
    this.cmd = { pitch: null, roll: null, rudder: null, steer: null, column: null };
    this.fdPitch = 0; this.fdRoll = 0;
    this.hdgHold = 0; this.trkHold = 0;
    this.altHold = 0;
    this.iasF = 0; this.accel = 0;
    this.leverCmd = 0;
    this.land3 = false;
    this.retard = false;
    this.flareStart = null;
    this.gaTime = 0;
    this.messages = [];
    this.targetSpeed = 160;
    this.vsT = 0;
    this.toTrack = 0;
    this.changed = 0;
  }

  // ===== MCP ボタン =====
  toggleFD(sim) {
    this.fd = !this.fd;
    if (this.fd && sim.onGround) { this.lat.active = 'TO/GA'; this.vert.active = 'TO/GA'; this.toTrack = sim.fdm.out.trackTrue; }
    if (!this.fd && !this.ap) { this.lat.active = ''; this.vert.active = ''; this.lat.armed = ''; this.vert.armed = ''; }
  }
  pressAP(sim) {
    if (this.ap) { this.disconnectAP(); return; }
    if (sim.onGround || sim.raFt < 200) { this.msg('A/P ENGAGE INHIBITED (< 200 FT)'); return; }
    this.ap = true; this.apDiscWarning = false;
    if (!this.lat.active || this.lat.active === 'TO/GA' && !this.fd) this.setLat('HDG HOLD', sim);
    if (!this.vert.active) this.setVert('V/S', sim);
  }
  disconnectAP(silent = false) {
    if (this.ap && !silent) this.apDiscWarning = true;
    else if (!this.ap) this.apDiscWarning = false;
    this.ap = false;
    this.land3 = false;
    if (!this.fd) { this.lat.active = ''; this.vert.active = ''; }
  }
  toggleATArm() {
    this.atArm = !this.atArm;
    if (!this.atArm && this.at) { this.at = false; this.atDiscWarning = true; this.thr = ''; }
  }
  pressAT(sim) {
    if (!this.atArm) return;
    if (this.at && this.thr !== '') { this.at = false; this.thr = ''; this.atDiscWarning = true; return; }
    this.at = true; this.atDiscWarning = false;
    this.thr = (this.vert.active === 'FLCH SPD' || this.vert.active.startsWith('VNAV')) ? 'THR' : 'SPD';
    if (this.thr === 'SPD') this.thr = 'SPD';
  }
  pressLNAV(sim) {
    if (!sim.fmc.legs.length) { this.msg('NO ACTIVE ROUTE'); return; }
    const lg = sim.fmc.legGeometry(sim.fdm.lat, sim.fdm.lon);
    if (sim.onGround || sim.raFt < 50 || Math.abs(lg.xtk) > 2.5 * NM && !sim.onGround) this.lat.armed = 'LNAV';
    else this.setLat('LNAV', sim);
    if (sim.onGround || sim.raFt < 50) this.lat.armed = 'LNAV';
  }
  pressVNAV(sim) {
    if (!sim.fmc.legs.length) { this.msg('NO ACTIVE ROUTE'); return; }
    if (sim.onGround || sim.raFt < 400) { this.vert.armed = 'VNAV'; return; }
    this.engageVNAV(sim);
  }
  pressFLCH(sim) { if (!sim.onGround) this.setVert('FLCH SPD', sim); }
  pressHDGSel(sim) { if (!sim.onGround) this.setLat('HDG SEL', sim); }
  pressHDGHold(sim) { if (!sim.onGround) this.setLat('HDG HOLD', sim); }
  pressALTHold(sim) { if (!sim.onGround) this.setVert('ALT', sim, sim.altFt); }
  pressVS(sim) {
    if (sim.onGround) return;
    this.mcp.vs = Math.round(sim.vsFpm / 100) * 100;
    this.setVert('V/S', sim);
  }
  pressLOC(sim) {
    if (!sim.ils) { this.msg('NO ILS TUNED'); return; }
    if (this.lat.active === 'LOC') return;
    this.lat.armed = this.lat.armed === 'LOC' ? '' : 'LOC';
    if (this.vert.armed === 'G/S' && this.lat.armed === '') this.vert.armed = '';
  }
  pressAPP(sim) {
    if (!sim.ils) { this.msg('NO ILS TUNED'); return; }
    if (this.vert.armed === 'G/S' || this.vert.active === 'G/S') {
      if (this.vert.active !== 'G/S') { this.vert.armed = ''; if (this.lat.armed === 'LOC') this.lat.armed = ''; }
      return;
    }
    if (this.lat.active !== 'LOC') this.lat.armed = 'LOC';
    this.vert.armed = 'G/S';
  }
  pressTOGA(sim) {
    if (sim.onGround) {
      // 離陸: A/T THR REF（離陸推力）
      if (this.atArm && sim.fdm.out.ias < 50) {
        this.at = true; this.thr = 'THR REF'; this.rating = sim.fmc.toRating || 'TO';
      }
      if (this.fd) { this.lat.active = 'TO/GA'; this.vert.active = 'TO/GA'; this.toTrack = sim.fdm.out.trackTrue; }
      return;
    }
    // ゴーアラウンド
    const lowEnough = sim.raFt < 2000 || this.vert.active === 'G/S' || this.vert.active === 'FLARE' || sim.fdm.flapPos > 0.5;
    if (!lowEnough) return;
    this.lat.active = 'TO/GA'; this.vert.active = 'TO/GA'; this.lat.armed = ''; this.vert.armed = '';
    this.toTrack = sim.fdm.out.trackTrue;
    this.retard = false; this.flareStart = null; this.land3 = false;
    if (this.atArm) { this.at = true; this.thr = 'THR REF'; this.rating = 'GA'; }
    this.gaTime = 0;
    this.mcp.spdIntv = true;
    this.mcp.spd = Math.max(this.mcp.spd, Math.round(sim.fdm.out.ias));
  }
  pressCLBCON(sim) {
    this.rating = sim.raFt > 400 && this.vert.active.startsWith('VNAV') ? 'CLB' : 'CON';
    if (this.at) this.thr = 'THR REF';
  }
  pushSpeed(sim) { // スピードノブ押し（VNAV 中の速度介入）
    this.mcp.spdIntv = !this.mcp.spdIntv;
    if (this.mcp.spdIntv) this.mcp.spd = Math.round(this.targetSpeed);
  }
  toggleSpdMach(sim) {
    const o = sim.fdm.out;
    this.mcp.isMach = !this.mcp.isMach;
    if (this.mcp.isMach) this.mcp.mach = +o.mach.toFixed(3);
    else this.mcp.spd = Math.round(o.ias);
  }

  msg(t) { this.messages.push({ text: t, time: performance?.now?.() ?? Date.now() }); }

  setLat(mode, sim) {
    this.lat.active = mode;
    if (this.lat.armed === mode) this.lat.armed = '';
    if (mode === 'HDG HOLD') this.hdgHold = sim.hdgMag;
    this.changed = 10;
  }
  setVert(mode, sim, alt) {
    if (mode !== 'G/S' && this.vert.active === 'G/S' && this.vert.armed === '') { /* G/S 解除 */ }
    this.vert.active = mode;
    if (this.vert.armed === mode || (mode.startsWith('VNAV') && this.vert.armed === 'VNAV')) this.vert.armed = '';
    if (mode === 'ALT') this.altHold = alt ?? this.mcp.alt;
    if (this.at || this.atArm && !sim.onGround) {
      if (mode === 'FLCH SPD') { this.at = this.atArm; this.thr = 'THR'; }
      else if (mode === 'V/S' || mode === 'ALT' || mode === 'G/S' || mode === 'VNAV PTH' || mode === 'VNAV ALT') { if (this.atArm) { this.at = true; this.thr = 'SPD'; } }
      else if (mode === 'VNAV SPD') { if (this.atArm) { this.at = true; this.thr = sim.altFt < this.mcp.alt ? 'THR REF' : 'THR'; this.rating = 'CLB'; } }
    }
    this.changed = 10;
  }
  engageVNAV(sim) {
    const crz = sim.fmc.crzAltFt;
    const alt = sim.altFt;
    if (alt < Math.min(crz, this.mcp.alt) - 300) this.setVert('VNAV SPD', sim);
    else this.setVert('VNAV PTH', sim);
    this.vert.armed = '';
  }

  /** FMC の速度スケジュール */
  fmcSpeed(sim) {
    const f = sim.fmc, alt = sim.altFt, o = sim.fdm.out;
    const atm = o.atm;
    let v;
    const phase = sim.flightPhase;
    if (phase === 'CLIMB' || phase === 'TAKEOFF') {
      v = alt < 10000 ? 250 : Math.min(310, machToCas(0.85, atm) / KT);
      if (sim.agl < f.accelAglFt * FT) v = Math.max(f.v2 + 15, 160);
    } else if (phase === 'CRUISE') {
      v = machToCas(0.85, atm) / KT;
    } else {
      v = alt < 10500 ? 250 : Math.min(290, machToCas(0.84, atm) / KT);
      const dDest = f.distanceToDest(sim.fdm.lat, sim.fdm.lon) / NM;
      if (dDest < 35) v = Math.min(v, 220);
      // 速度制限付きウェイポイント: 手前 12NM から減速
      const leg = f.activeLeg;
      if (leg && leg.spd) {
        const dLeg = f.distanceToLeg(sim.fdm.lat, sim.fdm.lon, f.active) / NM;
        if (dLeg < 12) v = Math.min(v, leg.spd + dLeg * 2);
      }
      const prevLeg = f.legs[f.active - 1];
      if (prevLeg && prevLeg.spd) v = Math.min(v, prevLeg.spd);
    }
    // フラップ位置の最小操作速度以上
    const fms = f.flapManeuverSpeeds();
    const fl = B789.flaps[Math.round(sim.fdm.flapPos)].name;
    v = Math.max(v, fms[fl] ?? 0);
    return v;
  }

  /** 選択速度 (KCAS) */
  selectedSpeed(sim) {
    const o = sim.fdm.out;
    if (this.vert.active.startsWith('VNAV') && !this.mcp.spdIntv) return this.fmcSpeed(sim);
    if (this.mcp.isMach) return machToCas(this.mcp.mach, o.atm) / KT;
    return this.mcp.spd;
  }

  update(dt, sim) {
    const f = sim.fdm, o = f.out;
    if (!o.atm) return;
    const ias = o.ias, alt = sim.altFt, vs = sim.vsFpm, ra = sim.raFt;
    const V = Math.max(o.tas, 40);
    const gamma = Math.atan2(o.vs, Math.max(o.gs, 30));
    const phi = o.bank * DEG;
    if (this.changed > 0) this.changed -= dt;

    // 加速度推定（kt/s）
    const prev = this.iasF || ias;
    this.iasF += (ias - this.iasF) * clamp(dt * 3, 0, 1);
    this.accel += ((this.iasF - prev) / dt - this.accel) * clamp(dt * 2, 0, 1);

    // ---- パイロットのオーバーライドで A/P 解除 ----
    if (this.ap && (Math.abs(sim.pilot.pitch) > 0.55 || Math.abs(sim.pilot.roll) > 0.6)) {
      this.disconnectAP(); this.msg('AUTOPILOT DISCONNECT (OVERRIDE)');
    }
    if (this.ap && sim.fbw.stickShaker) { this.disconnectAP(); }

    // ---- 自動モード遷移（アーム → アクティブ）----
    if (this.lat.armed === 'LNAV' && ra > 50 && !sim.onGround) {
      const lg = sim.fmc.legGeometry(f.lat, f.lon);
      if (lg && (this.lat.active === 'TO/GA' || Math.abs(lg.xtk) < 2.5 * NM || Math.abs(wrap180(lg.crs - o.trackTrue)) < 90)) this.setLat('LNAV', sim);
    }
    if (this.vert.armed === 'VNAV' && ra > 400 && !sim.onGround) this.engageVNAV(sim);
    const dev = sim.ilsDev;
    if (this.lat.armed === 'LOC' && dev && dev.locValid) {
      const closing = Math.abs(wrap180(o.trackTrue - sim.ils.course)) < 120;
      if (Math.abs(dev.locDots) < 1.6 && closing) this.setLat('LOC', sim);
    }
    if (this.vert.armed === 'G/S' && dev && dev.gsValid && (this.lat.active === 'LOC' || Math.abs(dev.locDots) < 1.0)) {
      if (dev.gsDots > -0.25 && dev.gsDots < 0.6) this.setVert('G/S', sim);
    }

    // ---- 高度捕捉 ----
    const selAlt = this.mcp.alt;
    const climbingModes = ['V/S', 'FLCH SPD', 'VNAV SPD', 'TO/GA'];
    if (climbingModes.includes(this.vert.active) && !sim.onGround && ra > 400) {
      const err = selAlt - alt;
      const towards = err * vs > 0;
      const capDist = Math.abs(vs) / 4 + 50;
      if (towards && Math.abs(err) < capDist && Math.abs(vs) > 50 && this.vert.active !== 'TO/GA') {
        if (this.vert.active.startsWith('VNAV')) { this.setVert('VNAV ALT', sim); this.altHold = selAlt; }
        else this.setVert('ALT', sim, selAlt);
        this.capturing = true;
      }
      if (this.vert.active === 'VNAV SPD' && alt > sim.fmc.crzAltFt - Math.abs(vs) / 4 - 50 && sim.fmc.crzAltFt <= selAlt) {
        this.setVert('VNAV PTH', sim); this.altHold = sim.fmc.crzAltFt;
      }
    }
    // VNAV ALT から MCP 高度変更で再開
    if (this.vert.active === 'VNAV ALT' && Math.abs(selAlt - this.altHold) > 100) {
      if (selAlt > alt + 200 && alt < sim.fmc.crzAltFt - 200) this.setVert('VNAV SPD', sim);
      else if (selAlt < alt - 200) this.setVert('VNAV PTH', sim);
    }

    // ---- 横方向モード ----
    let bankCmd = null;
    const bl = this.mcp.bankLimit;
    const trackErr = (cmd) => wrap180(cmd - o.trackTrue);
    switch (this.lat.active) {
      case 'TO/GA':
        if (!sim.onGround) bankCmd = clamp(trackErr(this.toTrack) * 1.5, -15, 15);
        else bankCmd = 0;
        break;
      case 'HDG SEL': {
        const target = this.mcp.hdgTrk === 'TRK' ? wrap180(this.mcp.hdg - sim.trackMag) : wrap180(this.mcp.hdg - sim.hdgMag);
        bankCmd = clamp(target * 1.4, -bl, bl);
        break;
      }
      case 'HDG HOLD':
        bankCmd = clamp(wrap180(this.hdgHold - sim.hdgMag) * 1.4, -bl, bl);
        if (Math.abs(o.bank) > 3 && this.changed > 9.5) this.hdgHold = sim.hdgMag;
        break;
      case 'LNAV': {
        const lg = sim.fmc.legGeometry(f.lat, f.lon);
        if (lg) {
          const parallel = lg.crsNow + Math.atan2(lg.xtk, Math.max(lg.dtg, 1000)) * RAD;
          const cmdTrk = parallel - clamp(lg.xtk / NM * 22, -45, 45);
          bankCmd = clamp(trackErr(cmdTrk) * 1.6, -25, 25);
          sim.fmc.sequence(f.lat, f.lon, o.gs);
        } else bankCmd = 0;
        break;
      }
      case 'LOC': {
        if (dev && dev.locValid) {
          const kx = ra < 300 ? 0.05 : 0.035;
          const cmdTrk = sim.ils.course - clamp(dev.xtkM * kx, -30, 30);
          bankCmd = clamp(trackErr(cmdTrk) * 2.0, ra < 200 ? -8 : -25, ra < 200 ? 8 : 25);
        } else bankCmd = 0;
        break;
      }
      case 'ROLLOUT':
        bankCmd = 0;
        break;
      default:
        bankCmd = null;
    }

    // ---- 縦方向モード ----
    let gammaT = null;   // 目標経路角 (rad)
    let vsT = null;      // 目標昇降率 (fpm)
    const spdT = this.selectedSpeed(sim);
    this.targetSpeed = spdT;
    const speedOnPitch = (target, dirSign) => {
      // 速度を昇降舵で制御（FLCH / VNAV SPD / TO/GA）
      const e = ias - target;
      let g = gamma + 0.0524 * this.accel + 0.0035 * e;
      if (dirSign > 0) g = Math.max(g, 0.5 * DEG);
      if (dirSign < 0) g = Math.min(g, -0.5 * DEG);
      return clamp(g, -12 * DEG, 18 * DEG);
    };
    switch (this.vert.active) {
      case 'TO/GA': {
        const tgt = sim.fmc.v2 ? Math.max(sim.fmc.v2 + 15, this.gaTime >= 0 && this.rating === 'GA' ? this.mcp.spd : 0) : 160;
        if (sim.onGround) { gammaT = null; this.fdPitch = ias > sim.fmc.vr - 5 ? 10 : 0; }
        else {
          gammaT = Math.min(speedOnPitch(tgt, 1), (18 - (o.alpha || 0)) * DEG);
          if (this.rating === 'GA' && vs > 2000) gammaT = Math.min(gammaT, Math.asin(2000 * FT / 60 / V));
        }
        this.gaTime += dt;
        break;
      }
      case 'ALT':
      case 'VNAV ALT': {
        const err = (this.vert.active === 'ALT' ? this.altHold : this.altHold) - alt;
        vsT = clamp(err * 4, -2000, 2000);
        if (this.capturing) {
          vsT = clamp(vsT, -Math.max(Math.abs(vs), 300), Math.max(Math.abs(vs), 300));
          if (Math.abs(err) < 30) this.capturing = false;
        }
        break;
      }
      case 'V/S':
        vsT = this.mcp.vs;
        // 速度保護
        if (ias < sim.minSpeed && vsT > 0) vsT = Math.min(vsT, (ias - sim.minSpeed) * 100);
        if (ias > sim.maxSpeed - 3 && vsT < 0) vsT = Math.max(vsT, -(sim.maxSpeed - ias) * 100);
        break;
      case 'FLCH SPD':
      case 'VNAV SPD': {
        const dir = selAlt > alt + 50 ? 1 : selAlt < alt - 50 ? -1 : 0;
        gammaT = speedOnPitch(spdT, dir);
        break;
      }
      case 'VNAV PTH': {
        const pathAlt = sim.fmc.vnavPathAlt(f.lat, f.lon);
        const crz = sim.fmc.crzAltFt;
        const descending = sim.flightPhase === 'DESCENT' || sim.flightPhase === 'APPROACH';
        let tgtAlt = descending ? Math.min(alt, crz) : crz;
        if (pathAlt == null && descending) tgtAlt = this.pthHold ?? (this.pthHold = alt);
        else this.pthHold = null;
        if (pathAlt != null && pathAlt < crz) tgtAlt = pathAlt;
        tgtAlt = Math.max(tgtAlt, selAlt);           // MCP 高度で制限
        if (pathAlt != null && pathAlt < alt - 50 && selAlt < alt - 50) {
          const pathVs = -o.gs * Math.tan(2.8 * DEG) / FT * 60;
          const pv = clamp(pathVs + (tgtAlt - alt) * 4, -4500, 500);
          // 速度優先: 目標速度を超える場合は降下率を浅くする（パスより上に外れる）
          const gPath = Math.asin(clamp(pv * FT / 60 / V, -0.4, 0.4));
          const gSpd = speedOnPitch(spdT + 5, -1);
          gammaT = ias > spdT + 3 ? Math.max(gPath, gSpd) : gPath;
          this.abovePathFt = alt - tgtAlt;
          this.dragRequired = this.abovePathFt > 400 && ias > spdT;
          if (sim.flightPhase === 'CRUISE' || sim.flightPhase === 'CLIMB') sim.flightPhase = 'DESCENT';
        } else {
          this.dragRequired = false;
          vsT = clamp((tgtAlt - alt) * 4, -2000, 2000);
          if (Math.abs(tgtAlt - alt) < 100 && tgtAlt === selAlt && selAlt < crz - 100) { this.setVert('VNAV ALT', sim); this.altHold = selAlt; }
        }
        break;
      }
      case 'G/S': {
        if (dev && dev.gsValid) {
          const gsVs = -o.gs * Math.tan(sim.ils.gsAngle * DEG) / FT * 60;
          const errFt = (dev.gsAltM - (sim.altFt * FT - 0)) / FT;
          vsT = gsVs + clamp(errFt * (ra < 300 ? 3 : 5), -700, 700);
          this.lastGsVs = vsT;
        } else vsT = this.lastGsVs ?? -700;
        if (ra < 100) vsT = this.lastGsVsFrozen ?? (this.lastGsVsFrozen = vsT);
        // フレア
        // フレア開始高度: 指数降下則 (τ=4s) の目標降下率が現在値を下回る高さ
        if (this.ap && this.land3 && ra > 0 && ra < Math.max(30, (Math.abs(vs) / 60 - 2) * 4 + 4)) { this.vert.active = 'FLARE'; this.flareStart = ra; }
        break;
      }
      case 'FLARE':
        vsT = -(Math.max(0, ra + vs / 60 * 0.5) / 4 + 2) * 60;
        if (!this.retard && ra < 25 && this.at) { this.retard = true; this.thr = 'IDLE'; }
        break;
      default:
        break;
    }
    if (this.vert.active !== 'G/S') this.lastGsVsFrozen = null;
    if (vsT != null && gammaT == null) gammaT = Math.asin(clamp(vsT * FT / 60 / V, -0.4, 0.4));
    this.vsT = vsT;

    // ---- オートランド状態 ----
    if (this.ap && this.lat.active === 'LOC' && (this.vert.active === 'G/S' || this.vert.active === 'FLARE') && ra < 1500) {
      this.land3 = true;
    }
    this.status = this.ap ? (this.land3 ? 'LAND 3' : 'A/P') : (this.fd ? 'FD' : '');

    // ---- 接地 → ROLLOUT ----
    if ((this.vert.active === 'FLARE' || this.land3) && sim.onGround && this.ap) {
      this.lat.active = 'ROLLOUT'; this.vert.active = 'ROLLOUT';
    }

    // ---- 指令出力 ----
    const cmd = { pitch: null, roll: null, rudder: null, steer: null, column: null };
    let nzCmd = null;
    if (gammaT != null) {
      const flare = this.vert.active === 'FLARE';
      const k = flare ? 0.7 : 0.55;
      let dnz = (V / G0) * k * (gammaT - gamma);
      dnz = flare ? clamp(dnz, -0.02, 0.2) : clamp(dnz, -0.12, 0.12);
      const phiC = clamp(Math.abs(phi), 0, 35 * DEG);
      nzCmd = Math.cos(gamma) / Math.cos(phiC) + dnz;
      // 姿勢制限
      if (o.pitch > 20) nzCmd -= (o.pitch - 20) * 0.03;
      if (o.pitch < -10) nzCmd += (-10 - o.pitch) * 0.03;
      this.fdPitch = o.pitch + (gammaT - gamma) * RAD * 1.4;
    } else if (!sim.onGround) {
      this.fdPitch = o.pitch;
    }
    this.fdRoll = bankCmd != null ? bankCmd : o.bank;

    if (this.ap) {
      if (nzCmd != null) cmd.pitch = { nzCmd };
      if (bankCmd != null) cmd.roll = { bankCmd };
      // オートランド: 低高度でのデクラブ・ROLLOUT 操向
      if (this.land3 && ra < 120 && !sim.onGround && sim.ils) {
        const crab = wrap180(sim.ils.course - o.hdgTrue);
        cmd.rudder = clamp(crab * DEG * 2.2, -20 * DEG, 20 * DEG) * clamp((120 - ra) / 60, 0, 1);
      }
      if (this.lat.active === 'ROLLOUT' && sim.ils) {
        const d = sim.ilsDev;
        const hErr = wrap180(sim.ils.course - o.hdgTrue);
        const xt = d ? d.xtkM : 0;
        const s = clamp(hErr * 0.06 - xt * 0.012, -0.3, 0.3);
        cmd.rudder = s * B789.drMax * 1.4;
        cmd.steer = s * 8 * DEG;
        cmd.column = o.pitch > 1.0 && f.gearState[0].wow === false ? -0.12 : 0;
      }
    }
    this.cmd = cmd;

    // ---- オートスロットル ----
    this.updateAT(dt, sim, spdT);
  }

  ratingLever(sim, rating) {
    const o = sim.fdm.out;
    const n1Max = sim.n1MaxAvail;
    const frac = RATINGS[rating] ?? 1;
    const n1 = Engine.n1ForFrac(frac, n1Max);
    const idle = sim.engines[0].idleN1(sim.engCtx || { onGround: sim.onGround });
    this.ratingN1 = n1;
    return clamp((n1 - idle) / (n1Max - idle), 0, 1);
  }

  updateAT(dt, sim, spdT) {
    const o = sim.fdm.out, ias = o.ias, ra = sim.raFt;
    const eng = sim.engines;
    let lever = eng[0].lever;
    // 推力定格の自動切替
    if (!sim.onGround) {
      if ((this.rating === 'TO' || this.rating.startsWith('TO ')) && sim.agl > sim.fmc.thrRedAglFt * FT) this.rating = 'CLB';
      if (this.rating === 'GA' && this.vert.active !== 'TO/GA') this.rating = 'CLB';
    }
    const maxLever = this.ratingLever(sim, this.rating === 'TO' || this.rating === 'GA' || this.rating.startsWith('TO') ? this.rating : (this.rating || 'CLB'));
    this.maxLever = maxLever;
    if (!this.at || !this.atArm) { this.thr = this.at ? this.thr : ''; return; }

    // 離陸時 80kt で HOLD
    if (this.thr === 'THR REF' && sim.onGround && ias > 80 && (this.rating.startsWith('TO'))) this.thr = 'HOLD';
    if (this.thr === 'HOLD' && !sim.onGround && sim.agl > 400 * FT) {
      this.thr = this.vert.active.startsWith('VNAV') ? 'THR REF' : (this.vert.active === 'TO/GA' ? 'THR REF' : 'SPD');
    }
    // FLCH: 上昇は THR、降下は IDLE→HOLD
    if (this.thr === 'THR') {
      const dir = this.mcp.alt - sim.altFt;
      if (dir < -50) { lever = approach(lever, 0, 0.12 * dt); if (lever <= 0.001) this.thr = 'HOLD'; }
      else lever = approach(lever, maxLever, 0.12 * dt);
    }
    if (this.vert.active === 'VNAV SPD' && this.thr !== 'HOLD') this.thr = 'THR REF';
    if (this.vert.active === 'VNAV SPD' && this.thr === 'HOLD' && !sim.onGround) this.thr = 'THR REF';
    if (['ALT', 'V/S', 'G/S', 'VNAV PTH', 'VNAV ALT', 'LOC'].includes(this.vert.active) && (this.thr === 'THR' || this.thr === 'THR REF' || this.thr === 'HOLD') && !sim.onGround) {
      if (!(this.vert.active === 'VNAV PTH' && sim.flightPhase === 'DESCENT' && this.thr === 'HOLD')) this.thr = 'SPD';
    }
    if (this.vert.active === 'FLCH SPD' && this.thr === 'SPD') this.thr = 'THR';

    switch (this.thr) {
      case 'THR REF':
        lever = approach(lever, maxLever, (sim.onGround ? 0.25 : 0.1) * dt);
        break;
      case 'SPD': {
        let tgt = spdT;
        tgt = clamp(tgt, sim.minSpeed, sim.maxSpeed - 3);
        const e = tgt - ias;
        const rate = clamp(0.012 * e - 0.10 * this.accel, -0.10, 0.10);
        lever = clamp(lever + rate * dt, 0, maxLever);
        break;
      }
      case 'IDLE':
        lever = approach(lever, 0, 0.2 * dt);
        break;
      case 'HOLD':
        return;
      default:
        return;
    }
    this.leverCmd = lever;
    for (const e of eng) e.lever = lever;
  }

  /** FMA 表示文字列 */
  fma() {
    return {
      thr: this.at ? this.thr : '',
      roll: this.fd || this.ap ? this.lat.active : '',
      rollArmed: this.lat.armed,
      pitch: this.fd || this.ap ? this.vert.active : '',
      pitchArmed: this.vert.armed,
      status: this.status,
    };
  }
}
