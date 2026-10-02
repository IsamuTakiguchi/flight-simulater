// ペデスタル: スラストレバー・リバース・スピードブレーキ・フラップ・ギア・オートブレーキ・燃料制御 等
import { clamp } from '../util/math.js';
import { B789 } from '../sim/aircraft-787.js';
import { AUTOBRAKE } from '../sim/systems.js';

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

/** 縦スライダー型レバー */
function lever(track, { get, set, detents, onEnd }) {
  const handle = el('div', 'handle');
  track.appendChild(handle);
  const H = () => track.clientHeight;
  const toVal = (y) => 1 - clamp((y - 11) / (H() - 22), 0, 1);
  let dragging = false;
  track.addEventListener('pointerdown', e => {
    dragging = true; track.setPointerCapture(e.pointerId);
    const r = track.getBoundingClientRect(); set(toVal(e.clientY - r.top));
  });
  track.addEventListener('pointermove', e => {
    if (!dragging) return;
    const r = track.getBoundingClientRect(); set(toVal(e.clientY - r.top));
  });
  track.addEventListener('pointerup', () => { dragging = false; onEnd && onEnd(); });
  return () => {
    const v = clamp(get(), 0, 1);
    handle.style.top = ((1 - v) * (H() - 22)) + 'px';
  };
}

export class Pedestal {
  constructor(root, getSim, actions) {
    this.root = root; this.getSim = getSim; this.actions = actions;
    this.updaters = [];
    this.btns = {};
    this.build();
  }

  build() {
    const s = () => this.getSim();
    const col = el('div', 'ped-col');
    // ---- スラストレバー ----
    const tq = el('div', 'thr-quad');
    for (const i of [0, 1]) {
      const c = el('div', 'lever-col');
      const tr = el('div', 'lever-track');
      const rev = el('div', 'rev'); tr.appendChild(rev);
      const up = lever(tr, {
        get: () => s().engines[i].lever,
        set: v => { const sim = s(); sim.engines[i].lever = v; sim.engines[i].revLever = 0; if (sim.af.at && sim.af.thr !== 'HOLD') sim.af.thrOverride = 1.5; },
      });
      this.updaters.push(() => {
        up();
        const e = s().engines[i];
        rev.style.display = e.revLever > 0 ? 'block' : 'none';
        rev.style.top = (tr.clientHeight - 14) + 'px';
      });
      c.append(tr, el('div', 'lever-label', i ? 'R' : 'L'));
      tq.appendChild(c);
    }
    const ticks = el('div', 'ticks');
    ticks.innerHTML = '<span style="top:6%">FULL</span><span style="top:50%">CL</span><span style="top:94%">IDLE</span>';
    tq.appendChild(ticks);
    // スピードブレーキ
    const sbc = el('div', 'lever-col');
    const sbt = el('div', 'lever-track sb-track');
    const sbUp = lever(sbt, {
      get: () => { const sy = s().sys; return sy.speedbrakeArmed ? 0.08 : sy.speedbrakeLever; },
      set: v => { const sy = s().sys; if (v < 0.04) { sy.speedbrakeLever = 0; sy.speedbrakeArmed = false; } else if (v < 0.14) { sy.speedbrakeLever = 0; sy.speedbrakeArmed = true; } else { sy.speedbrakeArmed = false; sy.speedbrakeLever = v > 0.85 ? 1 : Math.min(v, 0.6); } },
    });
    this.updaters.push(sbUp);
    sbc.append(sbt, el('div', 'lever-label', 'SPD BRK'));
    tq.appendChild(sbc);
    // フラップ
    const fc = el('div', 'lever-col');
    const ft = el('div', 'lever-track flap-track');
    const fUp = lever(ft, {
      get: () => 1 - s().sys.flapLever / 8,
      set: v => { s().setFlapLever(Math.round((1 - v) * 8)); },
    });
    this.updaters.push(fUp);
    fc.append(ft, el('div', 'lever-label', 'FLAPS'));
    tq.appendChild(fc);
    const fticks = el('div', 'ticks');
    fticks.innerHTML = B789.flaps.map((f, i) => `<span style="top:${4 + i / 8 * 92}%">${f.name}</span>`).join('');
    tq.appendChild(fticks);
    col.appendChild(tq);

    const row = el('div', 'row');
    const toga = el('button', 'ped-btn', 'TO/GA'); toga.title = 'TO/GA スイッチ (T)';
    toga.onclick = () => s().af.pressTOGA(s());
    const atd = el('button', 'ped-btn', 'A/T DISC'); atd.onclick = () => { const a = s().af; if (a.at) { a.at = false; a.thr = ''; a.atDiscWarning = true; } else a.atDiscWarning = false; };
    const revb = el('button', 'ped-btn', 'REV'); revb.title = 'リバース (R 長押し)';
    revb.onpointerdown = () => s().setReverse(1); revb.onpointerup = revb.onpointerleave = () => s().setReverse(0);
    row.append(toga, atd, revb);
    col.appendChild(row);
    this.root.appendChild(col);

    // ---- 右側グリッド ----
    const grid = el('div', 'ped-grid');
    const boxp = (title) => { const b = el('div', 'ped-box'); b.appendChild(el('h4', '', title)); grid.appendChild(b); return b; };
    // ギア
    let b = boxp('LANDING GEAR');
    const gl = el('div', 'gear-lever');
    const gup = el('button', 'ped-btn', 'UP'), gdn = el('button', 'ped-btn', 'DN');
    gup.onclick = () => { s().sys.gearLever = 'UP'; }; gdn.onclick = () => { s().sys.gearLever = 'DN'; };
    gl.append(gup, gdn); b.appendChild(gl);
    this.updaters.push(() => { const g = s().sys.gearLever; gup.classList.toggle('on', g === 'UP'); gdn.classList.toggle('on', g === 'DN'); });
    // オートブレーキ
    b = boxp('AUTOBRAKE');
    const ab = el('select', 'select');
    for (const a of AUTOBRAKE) ab.appendChild(Object.assign(document.createElement('option'), { value: a, textContent: a }));
    ab.onchange = () => { s().sys.autobrake = ab.value; ab.blur(); };
    b.appendChild(ab);
    this.updaters.push(() => { if (document.activeElement !== ab) ab.value = s().sys.autobrake; });
    // パーキングブレーキ
    b = boxp('PARKING BRAKE');
    const pb = el('button', 'ped-btn', 'SET');
    pb.onclick = () => { const sy = s().sys; sy.parkingBrake = !sy.parkingBrake; };
    b.appendChild(pb);
    this.updaters.push(() => { const on = s().sys.parkingBrake; pb.classList.toggle('alert', on); pb.textContent = on ? 'SET (ON)' : 'RELEASED'; });
    // 燃料制御
    b = boxp('FUEL CONTROL');
    const fcRow = el('div', 'row');
    for (const i of [0, 1]) {
      const fb = el('button', 'ped-btn', '');
      fb.onclick = () => { const e = s().engines[i]; e.fuelControl = e.fuelControl === 'RUN' ? 'CUTOFF' : 'RUN'; };
      fcRow.appendChild(fb);
      this.updaters.push(() => { const e = s().engines[i]; fb.textContent = (i ? 'R ' : 'L ') + e.fuelControl; fb.classList.toggle('on', e.fuelControl === 'RUN'); fb.classList.toggle('red', e.fuelControl !== 'RUN'); });
    }
    b.appendChild(fcRow);
    // トリム
    b = boxp('STAB TRIM');
    const tr = el('div', 'row');
    const tdn = el('button', 'ped-btn', 'NOSE DN'), tup = el('button', 'ped-btn', 'NOSE UP');
    const hold = (btn, v) => { btn.onpointerdown = () => { s().pilot.trimBtn = v; }; btn.onpointerup = btn.onpointerleave = () => { s().pilot.trimBtn = 0; }; };
    hold(tdn, -1); hold(tup, 1);
    const tv = el('span', 'mini', '');
    tr.append(tdn, tup, tv); b.appendChild(tr);
    this.updaters.push(() => { const sim = s(); tv.textContent = sim.trimUnits.toFixed(1) + 'u' + (sim.fbw.mode === 'NORMAL' && !sim.onGround ? ' / REF ' + Math.round(sim.fbw.vRefTrim) + 'kt' : ''); });
    // 表示・ツール
    b = boxp('VIEW / TOOLS');
    const tools = el('div', 'row');
    const mk = (label, fn, title) => { const x = el('button', 'ped-btn', label); x.onclick = fn; if (title) x.title = title; tools.appendChild(x); return x; };
    mk('CDU', () => this.actions.toggle('cdu-win'), 'FMC CDU (C)');
    mk('OVHD', () => this.actions.toggle('ovhd-win'), 'オーバーヘッドパネル (O)');
    mk('CHKL', () => this.actions.toggle('chk-win'), 'チェックリスト (K)');
    mk('VIEW', () => this.actions.cycleView(), '視点切替 (V)');
    mk('HUD', () => this.actions.toggleHud(), 'HUD (U)');
    this.btns.demo = mk('AUTO', () => this.actions.toggleDemo(), '自動操縦デモ（仮想機長が操縦）');
    mk('⏸', () => this.actions.togglePause(), '一時停止 (Space)');
    mk('MENU', () => this.actions.menu(), 'メニュー (Esc)');
    b.appendChild(tools);
    this.updaters.push(() => { this.btns.demo.classList.toggle('on', !!this.actions.demoOn()); });
    // シム速度
    b = boxp('SIM RATE');
    const rr = el('div', 'row');
    for (const r of [1, 2, 4, 8]) {
      const x = el('button', 'ped-btn', '×' + r);
      x.onclick = () => { s().simRate = r; };
      rr.appendChild(x);
      this.updaters.push(() => x.classList.toggle('on', s().simRate === r));
    }
    b.appendChild(rr);
    this.root.appendChild(grid);
  }

  update() { for (const u of this.updaters) u(); }
}
