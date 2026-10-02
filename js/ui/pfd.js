// PFD（プライマリ・フライト・ディスプレイ）— 787 の表示配置に準拠
import { Display, C, text, box, line, poly, pad } from './draw.js';
import { DEG, RAD, KT, FT, clamp, wrap360, wrap180 } from '../util/math.js';
import { B789 } from '../sim/aircraft-787.js';

const ADI = { cx: 500, cy: 455, w: 460, h: 470 };
const PPD = 8.6;           // 1° あたりの描画単位
const SPD = { x: 70, w: 120, top: 200, bot: 720, kt: 4.3 };
const ALT = { x: 790, w: 120, top: 200, bot: 720, ft: 0.52 };

export class PFD extends Display {
  draw(sim) {
    const g = this.begin();
    if (!g) return;
    if (!sim.sys.dc) { return; }
    const o = sim.fdm.out, af = sim.af;
    this.attitude(g, sim, o, af);
    this.speedTape(g, sim, o, af);
    this.altTape(g, sim, o, af);
    this.vsi(g, sim);
    this.heading(g, sim, o, af);
    this.fma(g, sim, af);
    this.ils(g, sim);
  }

  attitude(g, sim, o, af) {
    const { cx, cy, w, h } = ADI;
    g.save();
    g.beginPath();
    g.roundRect(cx - w / 2, cy - h / 2, w, h, 40);
    g.clip();
    g.translate(cx, cy);
    g.rotate(-o.bank * DEG);
    const py = o.pitch * PPD;
    g.fillStyle = C.sky; g.fillRect(-800, -1600 + py, 1600, 1600);
    g.fillStyle = C.ground; g.fillRect(-800, py, 1600, 1600);
    line(g, -800, py, 800, py, C.white, 2.5);
    // ピッチラダー
    for (let p = -90; p <= 90; p += 2.5) {
      if (p === 0) continue;
      const y = py - p * PPD;
      if (y < -260 || y > 260) continue;
      const major = p % 10 === 0, mid = p % 5 === 0;
      const hw = major ? 80 : mid ? 42 : 18;
      line(g, -hw, y, hw, y, C.white, 2);
      if (major) { text(g, String(Math.abs(p)), -hw - 26, y, { size: 22 }); text(g, String(Math.abs(p)), hw + 26, y, { size: 22 }); }
    }
    // 機首方位スケール（水平線上）
    g.restore();

    // バンク角目盛
    g.save();
    g.translate(cx, cy);
    const R = 205;
    g.strokeStyle = C.white; g.lineWidth = 2.5;
    g.beginPath(); g.arc(0, 0, R, (-90 - 60) * DEG, (-90 + 60) * DEG); g.stroke();
    for (const a of [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]) {
      const L = Math.abs(a) % 30 === 0 ? 24 : 13;
      const r = (a - 90) * DEG;
      line(g, Math.cos(r) * R, Math.sin(r) * R, Math.cos(r) * (R + L), Math.sin(r) * (R + L), C.white, 2.5);
    }
    poly(g, [[0, -R], [-11, -R - 18], [11, -R - 18]], { stroke: C.white, lw: 2 });
    // バンクポインタ＋横滑り
    g.rotate(-o.bank * DEG);
    const bankCol = Math.abs(o.bank) > 35 ? C.amber : C.white;
    poly(g, [[0, -R + 2], [-12, -R + 22], [12, -R + 22]], { stroke: bankCol, fill: Math.abs(o.bank) > 35 ? C.amber : null, lw: 2.5 });
    const slip = clamp(-sim.fdm.ny * 260, -30, 30);
    poly(g, [[-15 + slip, -R + 26], [15 + slip, -R + 26], [17 + slip, -R + 33], [-17 + slip, -R + 33]], { stroke: bankCol, lw: 2.5 });
    g.restore();

    // フライトディレクター
    if (af.fd && af.lat.active || af.fd && af.vert.active) {
      const fdx = clamp((af.fdRoll - o.bank) * 4.5, -150, 150);
      const fdy = clamp(-(af.fdPitch - o.pitch) * PPD, -150, 150);
      if (af.lat.active && af.lat.active !== 'ROLLOUT') line(g, cx + fdx, cy - 140, cx + fdx, cy + 140, C.magenta, 4.5);
      if (af.vert.active && !(sim.onGround && af.vert.active === 'TO/GA' && o.ias < 60)) line(g, cx - 140, cy + fdy, cx + 140, cy + fdy, C.magenta, 4.5);
    }
    // 飛行経路ベクトル
    if (!sim.onGround) {
      const fx = cx + clamp(-o.beta * PPD, -150, 150);
      const fy = cy - (o.fpa - o.pitch) * PPD;
      g.strokeStyle = C.green; g.lineWidth = 2.5;
      g.beginPath(); g.arc(fx, fy, 10, 0, Math.PI * 2); g.stroke();
      line(g, fx - 30, fy, fx - 10, fy, C.green, 2.5); line(g, fx + 10, fy, fx + 30, fy, C.green, 2.5); line(g, fx, fy - 10, fx, fy - 22, C.green, 2.5);
    }
    // 自機シンボル
    const wing = (s) => poly(g, [[cx + s * 150, cy - 6], [cx + s * 62, cy - 6], [cx + s * 62, cy + 26], [cx + s * 50, cy + 26], [cx + s * 50, cy + 6], [cx + s * 150, cy + 6]], { fill: '#000', stroke: C.white, lw: 2.5 });
    wing(1); wing(-1);
    g.fillStyle = '#000'; g.fillRect(cx - 7, cy - 7, 14, 14); box(g, cx - 7, cy - 7, 14, 14, C.white, 2.5);

    // 電波高度
    if (sim.raFt < 2500) {
      const ra = sim.raFt;
      const rv = ra < 500 ? Math.round(ra / 2) * 2 : Math.round(ra / 10) * 10;
      const belowMins = sim.minimumsAltFt != null && sim.altFt < sim.minimumsAltFt && !sim.onGround;
      text(g, String(rv), cx, cy + 205, { size: 36, color: belowMins ? C.amber : C.white, weight: 'bold' });
    }
    // GPWS 表示
    if (sim.gpws.alert) text(g, sim.gpws.alert, cx, cy + 120, { size: 40, color: sim.gpws.alert === 'PULL UP' ? C.red : C.amber, weight: 'bold' });
    if (sim.fbw.stickShaker) text(g, 'STALL', cx, cy - 110, { size: 38, color: C.red, weight: 'bold' });
    // ミニマム表示
    if (sim.minimumsAltFt != null) {
      text(g, 'MINS', 930, 795, { size: 20, color: C.green, align: 'left' });
      text(g, 'BARO', 930, 818, { size: 20, color: C.green, align: 'left' });
      text(g, String(Math.round(sim.minimumsAltFt)), 925, 845, { size: 24, color: C.green, align: 'left' });
    }
  }

  speedTape(g, sim, o, af) {
    const { x, w, top, bot, kt } = SPD;
    const mid = (top + bot) / 2;
    const ias = Math.max(o.ias, 30);
    const Y = v => mid - (v - ias) * kt;
    g.save();
    g.fillStyle = C.tape; g.fillRect(x, top, w, bot - top);
    g.beginPath(); g.rect(x, top, w + 40, bot - top); g.clip();
    for (let v = Math.floor((ias - 70) / 10) * 10; v < ias + 70; v += 10) {
      if (v < 30) continue;
      const y = Y(v);
      line(g, x + w - 22, y, x + w, y, C.white, 2.5);
      if (v % 20 === 0) text(g, String(v), x + w - 30, y, { size: 28, align: 'right' });
    }
    // 最大速度（バーバーポール）
    const vmax = sim.maxSpeed;
    if (Y(vmax) > top) this.barber(g, x + w - 10, top, Y(vmax));
    // 失速速度（シェーカー）
    const vs = (sim.stallSpeed || 100) * 1.06;
    if (!sim.onGround && Y(vs) < bot) this.barber(g, x + w - 10, Y(vs), bot);
    // 最小操作速度（アンバー）
    if (!sim.onGround) {
      const vmm = sim.minManeuver;
      g.strokeStyle = C.amber; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x + w - 6, Y(vmm)); g.lineTo(x + w - 6, Y(vs)); g.stroke();
    }
    // フラップ操作速度・V スピード
    const fms = sim.fmc.flapManeuverSpeeds();
    if (!sim.onGround && sim.fdm.flapPos > 0.2 || sim.flightPhase === 'APPROACH') {
      const order = ['UP', '1', '5', '15', '20'];
      for (const k of order) {
        const v = fms[k];
        if (!v || Math.abs(v - ias) > 70) continue;
        line(g, x + w, Y(v), x + w + 12, Y(v), C.green, 2.5);
        text(g, k, x + w + 14, Y(v), { size: 18, color: C.green, align: 'left' });
      }
    }
    const f = sim.fmc;
    if (sim.onGround || sim.flightPhase === 'TAKEOFF') {
      for (const [lab, v] of [['V1', f.v1], ['VR', f.vr], ['V2', f.v2]]) {
        if (!v) continue;
        line(g, x + w, Y(v), x + w + 12, Y(v), C.green, 2.5);
        text(g, lab, x + w + 14, Y(v), { size: 18, color: C.green, align: 'left' });
      }
    }
    if (f.vref && (sim.flightPhase === 'APPROACH' || sim.flightPhase === 'DESCENT' || sim.flightPhase === 'LANDED')) {
      line(g, x + w, Y(f.vref), x + w + 12, Y(f.vref), C.green, 2.5);
      text(g, 'REF', x + w + 14, Y(f.vref), { size: 18, color: C.green, align: 'left' });
    }
    // 選択速度バグ
    const sel = af.targetSpeed;
    const ys = clamp(Y(sel), top, bot);
    poly(g, [[x + w, ys], [x + w + 14, ys - 14], [x + w + 26, ys - 14], [x + w + 26, ys + 14], [x + w + 14, ys + 14]], { stroke: C.magenta, lw: 3 });
    // 速度トレンド（10 秒予測）
    const trend = af.accel * 10;
    if (Math.abs(trend) > 2 && !sim.onGround) {
      const yt = Y(ias + trend);
      line(g, x + w - 2, mid, x + w - 2, yt, C.green, 3);
      poly(g, [[x + w - 10, yt + Math.sign(trend) * 10], [x + w + 6, yt + Math.sign(trend) * 10], [x + w - 2, yt]], { stroke: C.green, lw: 2.5 });
    }
    g.restore();
    // 現在速度ボックス
    poly(g, [[x - 2, mid - 28], [x + w - 22, mid - 28], [x + w - 22, mid - 12], [x + w - 6, mid], [x + w - 22, mid + 12], [x + w - 22, mid + 28], [x - 2, mid + 28]], { fill: '#000', stroke: C.white, lw: 2.5 });
    const iasCol = o.ias > sim.maxSpeed || (!sim.onGround && o.ias < sim.minManeuver - 5) ? C.amber : C.white;
    text(g, String(Math.round(o.ias)), x + w - 28, mid + 1, { size: 38, align: 'right', weight: 'bold', color: iasCol });
    // 選択速度（上）とマッハ（下）
    const selTxt = af.mcp.isMach && !(af.vert.active.startsWith('VNAV') && !af.mcp.spdIntv) ? '.' + pad(Math.round(af.mcp.mach * 1000), 3) : String(Math.round(sel));
    text(g, selTxt, x + w / 2, top - 22, { size: 32, color: C.magenta });
    if (o.mach > 0.4) text(g, '.' + pad(Math.round(o.mach * 1000), 3), x + w / 2, bot + 28, { size: 30 });
    else if (!sim.onGround) text(g, 'GS ' + Math.round(o.gs / KT), x + w / 2, bot + 28, { size: 24 });
  }

  barber(g, x, y0, y1) {
    if (y1 <= y0) return;
    g.save();
    g.beginPath(); g.rect(x - 5, y0, 10, y1 - y0); g.clip();
    g.fillStyle = C.red; g.fillRect(x - 5, y0, 10, y1 - y0);
    g.fillStyle = '#000';
    for (let y = y0 - 20; y < y1; y += 20) g.fillRect(x - 5, y, 10, 10);
    g.restore();
  }

  altTape(g, sim, o, af) {
    const { x, w, top, bot, ft } = ALT;
    const mid = (top + bot) / 2;
    const alt = sim.altFt;
    const Y = a => mid - (a - alt) * ft;
    g.save();
    g.fillStyle = C.tape; g.fillRect(x, top, w, bot - top);
    g.beginPath(); g.rect(x - 30, top, w + 40, bot - top); g.clip();
    for (let a = Math.floor((alt - 600) / 100) * 100; a < alt + 600; a += 100) {
      const y = Y(a);
      line(g, x, y, x + 18, y, C.white, 2.5);
      if (a % 200 === 0) text(g, String(a), x + 24, y, { size: 24, align: 'left' });
      if (a % 1000 === 0) { line(g, x, y - 14, x + w, y - 14, C.white, 1.5); line(g, x, y + 14, x + w, y + 14, C.white, 1.5); }
    }
    // 地面（着陸標高）
    const gnd = alt - sim.raFt;
    if (sim.raFt < 2500 && Y(gnd) < bot) {
      g.fillStyle = C.amber;
      g.fillRect(x, Y(gnd), 8, bot - Y(gnd));
      for (let y = Y(gnd); y < bot; y += 14) line(g, x, y, x + 14, y + 10, C.amber, 2);
    }
    // ミニマム
    if (sim.minimumsAltFt != null) {
      const ym = Y(sim.minimumsAltFt);
      line(g, x - 26, ym, x + w, ym, C.green, 3);
    }
    // 選択高度バグ
    const ysel = clamp(Y(af.mcp.alt), top, bot);
    poly(g, [[x, ysel - 26], [x + 26, ysel - 26], [x + 26, ysel - 10], [x + 14, ysel], [x + 26, ysel + 10], [x + 26, ysel + 26], [x, ysel + 26]], { stroke: C.magenta, lw: 3 });
    g.restore();
    // 現在高度ボックス（ドラム表示）
    poly(g, [[x + 4, mid], [x + 18, mid - 30], [x + w + 8, mid - 30], [x + w + 8, mid + 30], [x + 18, mid + 30]], { fill: '#000', stroke: C.white, lw: 2.5 });
    const a = Math.round(alt / 20) * 20;
    const thousands = Math.floor(Math.abs(a) / 1000), rest = Math.abs(a) % 1000;
    text(g, (a < 0 ? '-' : '') + thousands, x + 64, mid + 1, { size: 40, align: 'right', weight: 'bold' });
    text(g, pad(rest, 3), x + 66, mid + 3, { size: 30, align: 'left', weight: 'bold' });
    // 選択高度・気圧設定
    const devAlert = Math.abs(af.mcp.alt - alt) < 900 && Math.abs(af.mcp.alt - alt) > 200 && !sim.onGround;
    text(g, String(af.mcp.alt), x + w / 2, top - 22, { size: 32, color: C.magenta });
    if (devAlert) box(g, x + 4, top - 44, w - 8, 42, C.white, 2.5);
    text(g, sim.sys.baroStd ? 'STD' : Math.round(sim.weather.qnh) + ' HPA', x + w / 2, bot + 28, { size: 26, color: C.green });
  }

  vsi(g, sim) {
    const x = 935, top = 245, bot = 665, mid = (top + bot) / 2;
    poly(g, [[x, top], [x + 30, top], [x + 50, top + 60], [x + 50, bot - 60], [x + 30, bot], [x, bot]], { fill: C.tape, stroke: null });
    const Yv = v => {
      const s = Math.sign(v), a = Math.min(Math.abs(v), 6000);
      const k = a <= 1000 ? a / 1000 * 0.45 : a <= 2000 ? 0.45 + (a - 1000) / 1000 * 0.25 : 0.70 + (a - 2000) / 4000 * 0.3;
      return mid - s * k * (bot - top) / 2;
    };
    for (const v of [-6000, -2000, -1000, -500, 0, 500, 1000, 2000, 6000]) {
      line(g, x + 2, Yv(v), x + 14, Yv(v), C.white, 2);
      if (Math.abs(v) >= 1000) text(g, String(Math.abs(v) / 1000), x - 10, Yv(v), { size: 18 });
    }
    const vs = sim.vsFpm;
    line(g, x + 70, mid, x + 4, Yv(vs), C.white, 3.5);
    if (Math.abs(vs) > 400) text(g, String(Math.round(Math.abs(vs) / 50) * 50), x + 26, vs > 0 ? top - 18 : bot + 18, { size: 22 });
    // 選択 V/S
    if (sim.af.vert.active === 'V/S') line(g, x + 2, Yv(sim.af.mcp.vs), x + 26, Yv(sim.af.mcp.vs), C.magenta, 5);
  }

  heading(g, sim, o, af) {
    const cx = 500, cy = 1150, R = 290;
    g.save();
    g.beginPath(); g.rect(200, 840, 600, 160); g.clip();
    g.fillStyle = C.tape;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    const hdg = sim.hdgMag;
    for (let d = 0; d < 360; d += 5) {
      const a = (wrap180(d - hdg) - 90) * DEG;
      const L = d % 10 === 0 ? 18 : 10;
      line(g, cx + Math.cos(a) * R, cy + Math.sin(a) * R, cx + Math.cos(a) * (R - L), cy + Math.sin(a) * (R - L), C.white, 2);
      if (d % 30 === 0) {
        g.save(); g.translate(cx + Math.cos(a) * (R - 36), cy + Math.sin(a) * (R - 36)); g.rotate(a + Math.PI / 2);
        text(g, String(d / 10), 0, 0, { size: 24 }); g.restore();
      }
    }
    // 選択方位バグ
    const ab = (wrap180(af.mcp.hdg - hdg) - 90) * DEG;
    g.save(); g.translate(cx + Math.cos(ab) * R, cy + Math.sin(ab) * R); g.rotate(ab + Math.PI / 2);
    poly(g, [[-14, 0], [-14, -12], [-6, -12], [0, -2], [6, -12], [14, -12], [14, 0]], { stroke: C.magenta, lw: 3 }); g.restore();
    // 航跡
    const at = (wrap180(sim.trackMag - hdg) - 90) * DEG;
    if (!sim.onGround) {
      g.save(); g.translate(cx + Math.cos(at) * (R - 4), cy + Math.sin(at) * (R - 4)); g.rotate(at + Math.PI / 2);
      poly(g, [[0, 0], [-6, 10], [0, 20], [6, 10]], { stroke: C.green, lw: 2 }); g.restore();
    }
    g.restore();
    poly(g, [[cx - 42, 838], [cx + 42, 838], [cx + 42, 874], [cx + 8, 874], [cx, 884], [cx - 8, 874], [cx - 42, 874]], { fill: '#000', stroke: C.white, lw: 2.5 });
    text(g, pad(Math.round(hdg) % 360 || 360, 3), cx, 857, { size: 30, weight: 'bold' });
    text(g, 'MAG', cx + 70, 856, { size: 20, color: C.green });
    text(g, (af.mcp.hdgTrk === 'TRK' ? 'TRK ' : 'HDG ') + pad(af.mcp.hdg, 3), cx - 150, 856, { size: 22, color: C.magenta });
  }

  fma(g, sim, af) {
    const f = af.fma();
    g.fillStyle = '#000'; g.fillRect(200, 6, 600, 72);
    line(g, 400, 10, 400, 72, C.white, 2); line(g, 600, 10, 600, 72, C.white, 2);
    const recent = af.changed > 0;
    const act = (s, x) => {
      if (!s) return;
      text(g, s, x, 30, { size: 28, color: C.green, weight: 'bold' });
      if (recent) box(g, x - 92, 12, 184, 36, C.white, 2);
    };
    act(f.thr, 300); act(f.roll, 500); act(f.pitch, 700);
    if (f.rollArmed) text(g, f.rollArmed, 500, 62, { size: 24 });
    if (f.pitchArmed) text(g, f.pitchArmed, 700, 62, { size: 24 });
    const stCol = f.status === 'LAND 3' ? C.green : f.status === 'A/P' || f.status === 'FD' ? C.green : C.amber;
    if (f.status) text(g, f.status === 'FD' ? 'FLT DIR' : f.status, 500, 115, { size: 30, color: stCol, weight: 'bold' });
    if (sim.af.dragRequired) text(g, 'DRAG REQUIRED', 500, 150, { size: 20, color: C.amber });
  }

  ils(g, sim) {
    const d = sim.ilsDev, ils = sim.ils;
    if (!ils) return;
    text(g, ils.ident + '/' + ils.freq.toFixed(2), 60, 120, { size: 22, align: 'left' });
    if (d && d.locValid) text(g, 'DME ' + d.dme.toFixed(1), 60, 148, { size: 22, align: 'left' });
    if (!d) return;
    const showGs = d.gsValid && d.dme < 25;
    const appArmed = sim.af.lat.armed === 'LOC' || sim.af.lat.active === 'LOC' || sim.af.lat.active === 'ROLLOUT' || sim.flightPhase === 'APPROACH';
    if (!appArmed && !(d.locValid && d.dme < 20)) return;
    // ローカライザー（下）
    const lx = 500, ly = 720;
    for (const k of [-2, -1, 1, 2]) { g.strokeStyle = C.white; g.lineWidth = 2; g.beginPath(); g.arc(lx + k * 70, ly, 7, 0, Math.PI * 2); g.stroke(); }
    line(g, lx, ly - 16, lx, ly + 16, C.white, 2);
    if (d.locValid) {
      const xx = lx + clamp(d.locDots, -2.3, 2.3) * 70;
      poly(g, [[xx - 16, ly], [xx, ly - 11], [xx + 16, ly], [xx, ly + 11]], { fill: Math.abs(d.locDots) < 2.3 ? C.magenta : null, stroke: C.magenta, lw: 2 });
    }
    // グライドスロープ（右）
    const gx = 745, gy = 455;
    for (const k of [-2, -1, 1, 2]) { g.strokeStyle = C.white; g.lineWidth = 2; g.beginPath(); g.arc(gx, gy + k * 70, 7, 0, Math.PI * 2); g.stroke(); }
    line(g, gx - 16, gy, gx + 16, gy, C.white, 2);
    if (showGs) {
      const yy = gy - clamp(d.gsDots, -2.3, 2.3) * 70;
      poly(g, [[gx, yy - 16], [gx + 11, yy], [gx, yy + 16], [gx - 11, yy]], { fill: Math.abs(d.gsDots) < 2.3 ? C.magenta : null, stroke: C.magenta, lw: 2 });
    }
  }
}
