// MCP（モード・コントロール・パネル）と EFIS コントロール
import { clamp, wrap360 } from '../util/math.js';

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

export class MCP {
  constructor(root, efisRoot, getSim, audio) {
    this.root = root; this.getSim = getSim; this.audio = audio;
    this.buttons = {}; this.windows = {};
    this.build();
    this.buildEfis(efisRoot);
  }
  click() { this.audio && this.audio.click(); }

  btn(parent, id, label, fn, wide = false) {
    const b = el('button', 'mcp-btn' + (wide ? ' wide' : ''), label);
    b.title = label;
    b.addEventListener('click', () => { this.click(); fn(this.getSim()); });
    parent.appendChild(b); this.buttons[id] = b; return b;
  }

  /** ノブ付き表示窓 */
  win(parent, id, { inc, push, title }) {
    const wrap = el('div', 'mcp-row');
    const minus = el('button', 'knob', '−'), plus = el('button', 'knob', '+');
    const w = el('div', 'mcp-win', '---');
    w.title = title + '（ホイール/ドラッグで変更、クリックでプッシュ。Shift で大きく変更）';
    minus.addEventListener('click', e => { this.click(); inc(this.getSim(), -1, e.shiftKey); });
    plus.addEventListener('click', e => { this.click(); inc(this.getSim(), 1, e.shiftKey); });
    w.addEventListener('wheel', e => { e.preventDefault(); inc(this.getSim(), e.deltaY < 0 ? 1 : -1, e.shiftKey); }, { passive: false });
    let dragY = null, moved = false;
    w.addEventListener('pointerdown', e => { dragY = e.clientY; moved = false; w.setPointerCapture(e.pointerId); });
    w.addEventListener('pointermove', e => {
      if (dragY == null) return;
      const d = dragY - e.clientY;
      if (Math.abs(d) > 6) { inc(this.getSim(), Math.sign(d), e.shiftKey); dragY = e.clientY; moved = true; }
    });
    w.addEventListener('pointerup', () => { if (!moved && push) { this.click(); push(this.getSim()); } dragY = null; });
    wrap.append(minus, w, plus);
    parent.appendChild(wrap);
    this.windows[id] = w;
    return w;
  }

  group(label) {
    const g = el('div', 'mcp-group');
    const lab = el('div', 'mcp-label', label);
    const row = el('div', 'mcp-row');
    g.append(lab, row);
    this.root.appendChild(g);
    return row;
  }

  build() {
    const af = s => s.af;
    let r = this.group('A/P  F/D  A/T ARM');
    this.btn(r, 'ap', 'A/P', s => af(s).pressAP(s));
    this.btn(r, 'fd', 'F/D', s => af(s).toggleFD(s));
    this.btn(r, 'atarm', 'A/T ARM', s => af(s).toggleATArm(s), true);

    r = this.group('CLB/CON  A/T');
    this.btn(r, 'clbcon', 'CLB CON', s => af(s).pressCLBCON(s), true);
    this.btn(r, 'at', 'A/T', s => af(s).pressAT(s));

    r = this.group('IAS / MACH');
    this.btn(r, 'iasmach', 'IAS<br>MACH', s => af(s).toggleSpdMach(s));
    this.win(r, 'spd', {
      title: '速度選択',
      inc: (s, d, big) => {
        const m = af(s).mcp;
        if (m.isMach) m.mach = clamp(+(m.mach + d * (big ? 0.01 : 0.001)).toFixed(3), 0.4, 0.9);
        else m.spd = clamp(m.spd + d * (big ? 10 : 1), 100, 360);
      },
      push: s => af(s).pushSpeed(s),
    });

    r = this.group('LNAV  VNAV  FLCH');
    this.btn(r, 'lnav', 'LNAV', s => af(s).pressLNAV(s));
    this.btn(r, 'vnav', 'VNAV', s => af(s).pressVNAV(s));
    this.btn(r, 'flch', 'FLCH', s => af(s).pressFLCH(s));

    r = this.group('HDG / TRK');
    this.btn(r, 'hdgtrk', 'HDG<br>TRK', s => { const m = af(s).mcp; m.hdgTrk = m.hdgTrk === 'HDG' ? 'TRK' : 'HDG'; });
    this.win(r, 'hdg', {
      title: '方位選択（プッシュで HDG SEL）',
      inc: (s, d, big) => { const m = af(s).mcp; m.hdg = Math.round(wrap360(m.hdg + d * (big ? 10 : 1))) || 360; },
      push: s => af(s).pressHDGSel(s),
    });
    this.btn(r, 'hdgsel', 'SEL', s => af(s).pressHDGSel(s));
    this.btn(r, 'hdghold', 'HOLD', s => af(s).pressHDGHold(s));

    r = this.group('V/S');
    this.win(r, 'vs', {
      title: '昇降率選択',
      inc: (s, d, big) => { const m = af(s).mcp; m.vs = clamp(m.vs + d * (big ? 500 : 100), -6000, 6000); },
      push: s => af(s).pressVS(s),
    });
    this.btn(r, 'vsbtn', 'V/S', s => af(s).pressVS(s));

    r = this.group('ALTITUDE');
    this.win(r, 'alt', {
      title: '高度選択（Shift で 1000ft 単位）',
      inc: (s, d, big) => { const m = af(s).mcp; m.alt = clamp(m.alt + d * (big ? 1000 : 100), 0, 43000); },
      push: s => { const a = af(s); if (a.vert.active.startsWith('VNAV')) a.engageVNAV(s); },
    });
    this.btn(r, 'althold', 'ALT<br>HOLD', s => af(s).pressALTHold(s));

    r = this.group('LOC  APP');
    this.btn(r, 'loc', 'LOC', s => af(s).pressLOC(s));
    this.btn(r, 'app', 'APP', s => af(s).pressAPP(s));

    r = this.group('A/P DISENGAGE');
    const disc = el('button', 'ap-disc'); disc.title = 'A/P 切断（バー）';
    disc.addEventListener('click', () => { this.click(); const s = this.getSim(); s.af.disconnectAP(); });
    r.appendChild(disc);
  }

  buildEfis(root) {
    if (!root) return;
    const s = () => this.getSim();
    const row1 = el('div', 'mcp-row'), row2 = el('div', 'mcp-row');
    const mk = (row, label, fn, id) => { const b = el('button', 'toggle-sw', label); b.addEventListener('click', () => { this.click(); fn(s()); }); row.appendChild(b); if (id) this.buttons['efis_' + id] = b; return b; };
    mk(row1, 'RNG−', sim => { const R = [5, 10, 20, 40, 80, 160, 320, 640]; const i = R.indexOf(sim.sys.efis.range); sim.sys.efis.range = R[Math.max(0, i - 1)]; });
    mk(row1, 'RNG+', sim => { const R = [5, 10, 20, 40, 80, 160, 320, 640]; const i = R.indexOf(sim.sys.efis.range); sim.sys.efis.range = R[Math.min(R.length - 1, i + 1)]; });
    mk(row1, 'TERR', sim => { sim.sys.efis.terr = !sim.sys.efis.terr; }, 'terr');
    mk(row2, 'STD', sim => { sim.sys.baroStd = !sim.sys.baroStd; }, 'std');
    mk(row2, 'ARPT', sim => { sim.sys.efis.arpt = !sim.sys.efis.arpt; }, 'arpt');
    mk(row2, 'STA', sim => { sim.sys.efis.sta = !sim.sys.efis.sta; }, 'sta');
    const lab = el('div', 'mcp-label', 'EFIS');
    root.append(lab, row1, row2);
  }

  update(sim) {
    const af = sim.af, B = this.buttons;
    const on = (id, v) => B[id] && B[id].classList.toggle('on', !!v);
    on('ap', af.ap); on('fd', af.fd); on('atarm', af.atArm); on('at', af.at);
    on('lnav', af.lat.active === 'LNAV' || af.lat.armed === 'LNAV');
    on('vnav', af.vert.active.startsWith('VNAV') || af.vert.armed === 'VNAV');
    on('flch', af.vert.active === 'FLCH SPD');
    on('hdgsel', af.lat.active === 'HDG SEL'); on('hdghold', af.lat.active === 'HDG HOLD');
    on('vsbtn', af.vert.active === 'V/S');
    on('althold', af.vert.active === 'ALT');
    on('loc', af.lat.active === 'LOC' || af.lat.armed === 'LOC');
    on('app', af.vert.armed === 'G/S' || af.vert.active === 'G/S' || af.vert.active === 'FLARE');
    on('efis_terr', sim.sys.efis.terr); on('efis_std', sim.sys.baroStd); on('efis_arpt', sim.sys.efis.arpt); on('efis_sta', sim.sys.efis.sta);
    const W = this.windows, m = af.mcp;
    const vnavBlank = af.vert.active.startsWith('VNAV') && !m.spdIntv;
    W.spd.textContent = vnavBlank ? '' : m.isMach ? '.' + String(Math.round(m.mach * 1000)).padStart(3, '0') : String(m.spd);
    W.spd.classList.toggle('blank', vnavBlank);
    W.hdg.textContent = String(m.hdg).padStart(3, '0');
    W.vs.textContent = af.vert.active === 'V/S' ? (m.vs > 0 ? '+' : '') + m.vs : '';
    W.alt.textContent = String(m.alt).padStart(5, ' ');
  }
}
