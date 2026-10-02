// オーバーヘッドパネル（787 の主要スイッチを簡略化して再現）
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

export class Overhead {
  constructor(root, getSim, audio) {
    this.root = root; this.getSim = getSim; this.audio = audio;
    this.updaters = [];
    this.build();
  }

  sec(title) { const s = el('div', 'oh-sec'); s.appendChild(el('h3', '', title)); this.root.appendChild(s); return s; }

  /** トグルスイッチ: label, get→bool, set(bool), 表示文字 [on, off] */
  sw(sec, label, get, set, txt = ['ON', 'OFF'], cls = '') {
    const row = el('div', 'oh-sw');
    const b = el('button');
    row.append(el('span', '', label), b);
    b.onclick = () => { this.audio && this.audio.click(); set(!get()); };
    sec.appendChild(row);
    this.updaters.push(() => { const v = get(); b.textContent = v ? txt[0] : txt[1]; b.className = v ? 'on ' + cls : ''; });
  }

  build() {
    const s = () => this.getSim();
    // 電源
    let sec = this.sec('ELECTRICAL');
    this.sw(sec, 'BATTERY', () => s().sys.battery, v => { s().sys.battery = v; });
    this.sw(sec, 'EXT PWR', () => s().sys.extPwr, v => { const sy = s().sys; sy.extPwr = v && sy.extPwrAvail && s().onGround; }, ['ON', 'AVAIL']);
    this.sw(sec, 'L GEN', () => s().sys.genL, v => { s().sys.genL = v; });
    this.sw(sec, 'R GEN', () => s().sys.genR, v => { s().sys.genR = v; });
    const elec = el('div', 'oh-val'); sec.appendChild(elec);
    this.updaters.push(() => { const sy = s().sys; elec.textContent = `AC BUS: ${sy.ac ? 'POWERED' : 'OFF'} / DC: ${sy.dc ? 'ON' : 'OFF'}`; });
    // APU
    sec = this.sec('APU');
    const apuRow = el('div', 'oh-sw');
    const apuSel = el('div', 'row');
    for (const v of ['OFF', 'ON', 'START']) {
      const b = el('button', '', v);
      b.onclick = () => { this.audio && this.audio.click(); s().sys.apuSwitch = v; };
      apuSel.appendChild(b);
      this.updaters.push(() => { const sy = s().sys; const cur = sy.apuSwitch === 'ON' && sy.apuStarting ? 'START' : sy.apuSwitch; b.className = cur === v ? 'on' : ''; });
    }
    apuRow.append(el('span', '', 'APU'), apuSel);
    sec.appendChild(apuRow);
    const apuv = el('div', 'oh-val'); sec.appendChild(apuv);
    this.updaters.push(() => { const sy = s().sys; apuv.textContent = sy.apuRunning ? 'APU RUNNING / GEN ON' : sy.apuN > 1 ? `STARTING ${sy.apuN.toFixed(0)}%` : 'APU OFF'; });
    // エンジン始動
    sec = this.sec('ENGINE START');
    for (const i of [0, 1]) {
      this.sw(sec, (i ? 'R' : 'L') + ' ENG START', () => s().engines[i].startSwitch === 'START', v => { const e = s().engines[i]; if (!e.running) e.startSwitch = v ? 'START' : 'NORM'; }, ['START', 'NORM'], 'white');
    }
    for (const i of [0, 1]) {
      this.sw(sec, (i ? 'R' : 'L') + ' FUEL CTRL', () => s().engines[i].fuelControl === 'RUN', v => { s().engines[i].fuelControl = v ? 'RUN' : 'CUTOFF'; }, ['RUN', 'CUTOFF']);
    }
    const ev = el('div', 'oh-val'); sec.appendChild(ev);
    this.updaters.push(() => { ev.textContent = s().engines.map((e, i) => `${i ? 'R' : 'L'}: N2 ${e.n2.toFixed(0)}% ${e.running ? 'RUN' : e.lightOff ? 'LIGHT' : ''}`).join(' / '); });
    // 燃料
    sec = this.sec('FUEL');
    for (const k of ['L', 'C', 'R']) this.sw(sec, `${k === 'C' ? 'CTR' : k} PUMPS`, () => s().sys.fuelPumps[k], v => { s().sys.fuelPumps[k] = v; });
    const fv = el('div', 'oh-val'); sec.appendChild(fv);
    this.updaters.push(() => { const t = s().sys.tanks; fv.textContent = `L ${(t.L / 1000).toFixed(1)}  C ${(t.C / 1000).toFixed(1)}  R ${(t.R / 1000).toFixed(1)} t`; });
    // 外部灯火
    sec = this.sec('EXTERIOR LIGHTS');
    const L = (k, label) => this.sw(sec, label, () => s().sys.lights[k], v => { s().sys.lights[k] = v; });
    L('landing', 'LANDING'); L('taxi', 'TAXI'); L('turnoff', 'RWY TURNOFF'); L('nav', 'NAV'); L('beacon', 'BEACON'); L('strobe', 'STROBE'); L('logo', 'LOGO'); L('wing', 'WING');
    // サイン・防氷
    sec = this.sec('SIGNS / ANTI-ICE');
    this.sw(sec, 'SEAT BELTS', () => s().sys.seatbelt, v => { s().sys.seatbelt = v; });
    this.sw(sec, 'NO SMOKING', () => s().sys.noSmoking, v => { s().sys.noSmoking = v; });
    this.sw(sec, 'WING ANTI-ICE', () => s().sys.antiIce.wing === 'AUTO', v => { s().sys.antiIce.wing = v ? 'AUTO' : 'OFF'; }, ['AUTO', 'OFF']);
    this.sw(sec, 'ENG ANTI-ICE', () => s().sys.antiIce.eng === 'AUTO', v => { s().sys.antiIce.eng = v ? 'AUTO' : 'OFF'; }, ['AUTO', 'OFF']);
    // 油圧
    sec = this.sec('HYDRAULICS');
    for (const k of ['L', 'C', 'R']) this.sw(sec, `${k} PUMP`, () => s().sys.hydPumps[k], v => { s().sys.hydPumps[k] = v; }, ['AUTO', 'OFF']);
    const hv = el('div', 'oh-val'); sec.appendChild(hv);
    this.updaters.push(() => { const sim = s(); const p = k => (k === 'C' ? sim.sys.ac : sim.engines[k === 'L' ? 0 : 1].running) && sim.sys.hydPumps[k] ? 5000 : 0; hv.textContent = `L ${p('L')}  C ${p('C')}  R ${p('R')} PSI`; });
    // 飛行制御
    sec = this.sec('FLIGHT CONTROLS');
    this.sw(sec, 'FLT CTRL MODE', () => s().fbw.mode === 'NORMAL', v => { s().fbw.mode = v ? 'NORMAL' : 'DIRECT'; }, ['NORMAL', 'DIRECT']);
    this.sw(sec, 'TRIM ASSIST', () => s().fbw.autoTrimAssist, v => { s().fbw.autoTrimAssist = v; }, ['ON', 'OFF']);
    const xpdr = el('div', 'oh-val'); sec.appendChild(xpdr);
    this.updaters.push(() => { xpdr.textContent = `XPDR ${s().sys.squawk} ${s().sys.transponder}`; });
  }

  update() { if (!this.root.closest('[hidden]')) for (const u of this.updaters) u(); }
}
