// GPWS（対地接近警報装置）と自動音声コールアウト
import { FT, KT } from '../util/math.js';
import { B789 } from './aircraft-787.js';

const ALT_CALLS = [
  [2500, 'TWENTY FIVE HUNDRED'], [1000, 'ONE THOUSAND'], [500, 'FIVE HUNDRED'], [100, 'ONE HUNDRED'],
  [50, 'FIFTY'], [40, 'FORTY'], [30, 'THIRTY'], [20, 'TWENTY'], [10, 'TEN'],
];

export class GPWS {
  constructor() {
    this.called = new Set();
    this.alert = '';         // PFD 表示 'PULL UP' / 'GND PROX' 等
    this.lastCall = {};
    this.prevRa = null;
    this.closure = 0;
    this.toMaxAlt = 0;
    this.v1Called = false;
    this.minCalled = false; this.appMinCalled = false;
    this.events = [];
    this.inhibit = false;
  }

  say(text, repeatSec = 0, priority = 1) {
    const now = this.t;
    if (repeatSec > 0) {
      if (this.lastCall[text] != null && now - this.lastCall[text] < repeatSec) return;
    }
    this.lastCall[text] = now;
    this.events.push({ type: 'callout', text, priority });
  }

  update(dt, sim) {
    this.t = (this.t || 0) + dt;
    const f = sim.fdm, o = f.out;
    const ra = sim.raFt, vs = sim.vsFpm;
    const onGround = sim.onGround;
    this.alert = '';
    if (this.prevRa != null) this.closure += ((this.prevRa - ra) / dt * 60 - this.closure) * Math.min(1, dt * 2);
    this.prevRa = ra;
    if (this.inhibit) return;

    // ---- 離陸 V1 コール ----
    if (onGround && sim.fmc.v1 && o.ias >= sim.fmc.v1 && !this.v1Called && sim.takeoffRoll) {
      this.v1Called = true; this.say('V ONE', 0, 2);
    }
    if (onGround && o.ias < 30) { this.v1Called = false; }

    if (onGround) { this.toMaxAlt = 0; this.called.clear(); return; }
    const descending = vs < -100;
    const gearDown = f.gearPos > 0.99;
    const landingFlaps = f.flapPos >= 6.5;

    // ---- 高度コールアウト ----
    for (const [h, text] of ALT_CALLS) {
      if (ra <= h && ra > h - 40 && descending && !this.called.has(h) && (h <= 1000 || gearDown || sim.flightPhase === 'APPROACH' || h === 2500)) {
        this.called.add(h); this.say(text, 0, 2);
        break;
      }
      if (ra > h + 150) this.called.delete(h);
    }
    // ミニマム（気圧高度）
    if (sim.minimumsAltFt != null && descending && gearDown) {
      const above = sim.altFt - sim.minimumsAltFt;
      if (above < 80 && above > 40 && !this.appMinCalled) { this.appMinCalled = true; this.say('APPROACHING MINIMUMS', 0, 2); }
      if (above < 0 && above > -60 && !this.minCalled) { this.minCalled = true; this.say('MINIMUMS', 0, 3); }
      if (above > 300) { this.minCalled = false; this.appMinCalled = false; }
    }

    // ---- Mode 1: 過大降下率 ----
    if (ra < 2450 && ra > 30) {
      const sink = -vs;
      if (sink > 1900 + ra * 1.45) { this.alert = 'PULL UP'; this.say('WHOOP WHOOP PULL UP', 1.6, 5); }
      else if (sink > 1400 + ra * 1.1) { this.alert = 'SINK RATE'; this.say('SINK RATE', 2.2, 4); }
    }
    // ---- Mode 2: 対地接近率 ----
    if (ra < 1650 && ra > 30 && !(gearDown && landingFlaps)) {
      if (this.closure > 2800 + (ra > 800 ? (ra - 800) * 2 : 0)) {
        this.alert = 'PULL UP'; this.say('TERRAIN TERRAIN', 2.5, 5);
      }
    }
    // ---- Mode 3: 離陸後の高度損失 ----
    if (sim.flightPhase === 'CLIMB' || sim.flightPhase === 'TAKEOFF') {
      this.toMaxAlt = Math.max(this.toMaxAlt, sim.altFt);
      if (ra < 1500 && ra > 30 && this.toMaxAlt - sim.altFt > Math.max(30, ra * 0.1)) {
        this.say("DON'T SINK", 2.5, 4); this.alert = this.alert || 'GND PROX';
      }
    }
    // ---- Mode 4: 不適切な形態での対地接近 ----
    if (!gearDown && ra < 500 && o.ias < 190 && descending) { this.say('TOO LOW GEAR', 3, 4); this.alert = this.alert || 'GND PROX'; }
    else if (gearDown && !landingFlaps && ra < 245 && o.ias < 159 && descending && f.flapPos < 6.5) { this.say('TOO LOW FLAPS', 3, 4); this.alert = this.alert || 'GND PROX'; }
    else if (!gearDown && ra < 1000 && o.ias > 250 && descending && sim.flightPhase !== 'CLIMB') { this.say('TOO LOW TERRAIN', 3, 4); this.alert = this.alert || 'GND PROX'; }
    // ---- Mode 5: グライドスロープ逸脱 ----
    const d = sim.ilsDev;
    if (d && d.gsValid && gearDown && ra < 1000 && ra > 30 && d.gsDots > 1.3 && sim.af.vert.armed !== 'G/S') {
      this.say('GLIDESLOPE', 3, 3); this.alert = this.alert || 'GND PROX';
    }
    // ---- バンク角 ----
    if (Math.abs(o.bank) > 35 + (ra > 150 ? 5 : 0)) this.say('BANK ANGLE BANK ANGLE', 3, 3);
  }
}
