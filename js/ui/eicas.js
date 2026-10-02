// EICAS（エンジン表示・乗員警告システム）
import { Display, C, text, box, line, poly, pad } from './draw.js';
import { DEG, clamp } from '../util/math.js';
import { B789 } from '../sim/aircraft-787.js';

export class EICAS extends Display {
  draw(sim) {
    const g = this.begin();
    if (!g) return;
    if (!sim.sys.dc) return;
    const af = sim.af, eng = sim.engines;
    // 推力モード・TAT
    const tat = sim.fdm.out.atm ? sim.fdm.out.atm.T - 273.15 + (sim.fdm.out.tas ** 2) / 2010 : 15;
    text(g, 'TAT ' + (tat >= 0 ? '+' : '') + Math.round(tat) + 'c', 20, 30, { size: 22, align: 'left' });
    const rating = af.rating;
    text(g, rating, 250, 30, { size: 26, color: C.green, align: 'left' });
    if (af.ratingN1) text(g, af.ratingN1.toFixed(1), 340, 30, { size: 26, color: C.green, align: 'left' });

    // N1 ダイヤル
    eng.forEach((e, i) => {
      const cx = 140 + i * 230, cy = 150;
      this.dial(g, cx, cy, 78, e.n1, 0, 110, B789.n1Max, af.ratingN1, e.n1Cmd, e.running || e.n1 > 2);
      text(g, e.n1.toFixed(1), cx + 34, cy - 22, { size: 30, weight: 'bold', align: 'right' });
      box(g, cx - 42, cy - 42, 86, 38, C.white, 2);
      if (e.revPos > 0.05) text(g, 'REV', cx, cy - 95, { size: 24, color: e.revPos > 0.9 ? C.green : C.amber, weight: 'bold' });
    });
    text(g, 'N1', 255, 150, { size: 22 });
    // EGT ダイヤル
    eng.forEach((e, i) => {
      const cx = 140 + i * 230, cy = 330;
      const egtCol = e.egt > 1060 ? C.red : e.egt > 1000 ? C.amber : C.white;
      this.dial(g, cx, cy, 64, e.egt, 0, 1100, B789.egtRedline, null, null, true, egtCol);
      text(g, String(Math.round(e.egt)), cx + 30, cy - 20, { size: 26, weight: 'bold', align: 'right', color: egtCol });
      box(g, cx - 38, cy - 38, 76, 34, egtCol, 2);
    });
    text(g, 'EGT', 255, 330, { size: 22 });
    // N2・燃料流量
    eng.forEach((e, i) => {
      const x = 140 + i * 230;
      text(g, e.n2.toFixed(1), x, 445, { size: 26, color: e.n2 > 0.5 ? C.white : C.gray });
      text(g, (e.ff * 3600 / 1000).toFixed(2), x, 485, { size: 26, color: e.ff > 0 ? C.white : C.gray });
      if (!e.running && e.startSwitch === 'START') text(g, e.lightOff ? 'LIGHTOFF' : 'START', x, 525, { size: 20, color: C.green });
      if (!e.running && e.fuelControl === 'CUTOFF' && !sim.onGround) text(g, 'FUEL OFF', x, 525, { size: 20, color: C.amber });
    });
    text(g, 'N2', 255, 445, { size: 20 }); text(g, 'FF', 255, 485, { size: 20 });

    // 警報メッセージ
    const m = sim.sys.messages;
    let y = 30;
    const mx = 530;
    const put = (s, col, ind = 0) => { if (y > 470) return; text(g, s, mx + ind, y, { size: 24, color: col, align: 'left' }); y += 30; };
    m.warning.forEach(s => put(s, C.red));
    m.caution.forEach(s => put(s, C.amber));
    m.advisory.forEach(s => put(s, C.amber, 20));
    m.memo.forEach(s => put(s, C.white));

    line(g, 500, 560, 1000, 560, C.gray, 2);
    // 燃料
    const fuel = sim.sys.fuelTotal;
    text(g, 'TOTAL FUEL', 760, 600, { size: 22, color: C.cyan });
    text(g, (fuel / 1000).toFixed(1), 760, 640, { size: 34, weight: 'bold', color: fuel < 2500 ? C.amber : C.white });
    text(g, 'KGS X 1000', 760, 675, { size: 16, color: C.cyan });
    text(g, 'GW ' + (sim.fdm.mass / 1000).toFixed(1), 760, 712, { size: 22 });

    // 降着装置
    const gp = sim.fdm.gearPos;
    text(g, 'GEAR', 590, 600, { size: 20, color: C.cyan });
    if (gp > 0.99) { box(g, 545, 620, 90, 40, C.green, 3); text(g, 'DOWN', 590, 641, { size: 26, color: C.green, weight: 'bold' }); }
    else if (gp < 0.01) { box(g, 545, 620, 90, 40, C.white, 2); text(g, 'UP', 590, 641, { size: 26, weight: 'bold' }); }
    else { g.save(); g.beginPath(); g.rect(545, 620, 90, 40); g.clip(); for (let x = 540; x < 640; x += 14) line(g, x, 662, x + 20, 618, C.amber, 3); g.restore(); box(g, 545, 620, 90, 40, C.amber, 3); }

    // フラップ
    const fp = sim.fdm.flapPos;
    const flapNames = B789.flaps.map(f => f.name);
    const fx = 930, ftop = 590, fbot = 860;
    text(g, 'FLAPS', fx, ftop - 10, { size: 20, color: C.cyan });
    box(g, fx - 16, ftop + 10, 32, fbot - ftop - 10, C.white, 2);
    const fy = ftop + 10 + (fbot - ftop - 10) * fp / 8;
    g.fillStyle = C.white; g.fillRect(fx - 14, ftop + 12, 28, fy - ftop - 12);
    const lever = sim.sys.flapLever;
    const ly = ftop + 10 + (fbot - ftop - 10) * lever / 8;
    line(g, fx - 34, ly, fx + 30, ly, C.magenta, 4);
    const moving = Math.abs(fp - lever) > 0.01;
    text(g, flapNames[lever], fx - 50, ly, { size: 26, color: moving ? C.magenta : C.green, align: 'right', weight: 'bold' });

    // スタビライザートリム・その他
    text(g, 'STAB', 590, 720, { size: 20, color: C.cyan });
    const units = sim.trimUnits;
    const inGreen = units >= 2.5 && units <= 8.5;
    text(g, units.toFixed(1), 590, 752, { size: 28, weight: 'bold', color: sim.onGround && !inGreen ? C.amber : C.green });
    text(g, 'AUTOBRAKE ' + sim.sys.autobrake, 590, 800, { size: 20, color: sim.sys.abActive ? C.green : C.white });
    const sb = sim.sys.speedbrakeArmed ? 'ARMED' : sim.sys.speedbrakeLever > 0.02 ? (sim.sys.speedbrakeLever * 100).toFixed(0) + '%' : 'DOWN';
    text(g, 'SPDBRK ' + sb, 590, 830, { size: 20, color: sim.sys.speedbrakeArmed ? C.green : sim.sys.speedbrakeLever > 0.02 ? C.amber : C.white });
    // ブレーキ温度
    const bt = sim.sys.brakeTemp.map(t => t.toFixed(1)).join(' ');
    text(g, 'BRK TEMP ' + bt, 590, 860, { size: 18, color: sim.sys.brakeTemp.some(t => t > 5) ? C.amber : C.gray });

    // APU
    if (sim.sys.apuN > 1) {
      text(g, 'APU', 60, 600, { size: 20, color: C.cyan, align: 'left' });
      text(g, 'RPM ' + sim.sys.apuN.toFixed(0) + '  EGT ' + Math.round(sim.sys.apuEgt), 60, 630, { size: 22, align: 'left' });
    }
    text(g, 'ELEC ' + (sim.sys.ac ? 'AC' : sim.sys.battery ? 'BATT' : 'OFF'), 60, 680, { size: 20, color: sim.sys.ac ? C.green : C.amber, align: 'left' });
    text(g, 'CG 25.0%   TRIM ' + sim.fmc.toTrim, 60, 720, { size: 18, color: C.gray, align: 'left' });
    text(g, 'TIME ' + this.clock(sim), 60, 760, { size: 20, color: C.white, align: 'left' });
    text(g, sim.flightPhase, 60, 800, { size: 20, color: C.cyan, align: 'left' });
  }

  clock(sim) {
    const s = Math.floor(sim.time);
    return pad(Math.floor(s / 3600), 2) + ':' + pad(Math.floor(s / 60) % 60, 2) + ':' + pad(s % 60, 2);
  }

  dial(g, cx, cy, r, val, min, max, red, ref, cmd, on, col = C.white) {
    const a0 = Math.PI, span = Math.PI * 1.15;
    const A = v => a0 + (clamp(v, min, max) - min) / (max - min) * span;
    g.strokeStyle = C.white; g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, r, a0, A(red)); g.stroke();
    g.strokeStyle = C.red; g.beginPath(); g.arc(cx, cy, r, A(red), A(red) + 0.04); g.stroke();
    line(g, cx + Math.cos(A(red)) * r, cy + Math.sin(A(red)) * r, cx + Math.cos(A(red)) * (r + 14), cy + Math.sin(A(red)) * (r + 14), C.red, 4);
    if (!on) return;
    // 塗りつぶし扇形
    g.fillStyle = 'rgba(160,160,160,0.35)';
    g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, r - 2, a0, A(val)); g.closePath(); g.fill();
    line(g, cx, cy, cx + Math.cos(A(val)) * r, cy + Math.sin(A(val)) * r, col, 4);
    if (ref) { const a = A(ref); line(g, cx + Math.cos(a) * (r + 2), cy + Math.sin(a) * (r + 2), cx + Math.cos(a) * (r + 16), cy + Math.sin(a) * (r + 16), C.green, 4); }
    if (cmd != null) { const a = A(cmd); line(g, cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14), cx + Math.cos(a) * (r + 2), cy + Math.sin(a) * (r + 2), C.white, 3); }
  }
}
