// CDU（コントロール・ディスプレイ・ユニット）— FMC の主要ページ
import { NM, FT, KT, wrap360, clamp } from '../util/math.js';
import { distance, bearing } from '../util/geo.js';
import { findAirport, findRunway, AIRPORTS } from '../sim/navigation.js';
import { B789 } from '../sim/aircraft-787.js';

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

export class CDU {
  constructor(root, getSim, audio) {
    this.root = root; this.getSim = getSim; this.audio = audio;
    this.page = 'IDENT'; this.sub = 0;
    this.scratch = '';
    this.msg = '';
    this.mod = null;
    this.build();
  }

  build() {
    const r = this.root;
    const body = el('div', 'cdu-body');
    this.lskL = el('div', 'lsk-col'); this.lskR = el('div', 'lsk-col');
    for (let i = 0; i < 6; i++) {
      const a = el('button', 'lsk'); a.onclick = () => this.lsk('L', i); this.lskL.appendChild(a);
      const b = el('button', 'lsk'); b.onclick = () => this.lsk('R', i); this.lskR.appendChild(b);
    }
    this.screen = el('div', 'cdu-screen');
    body.append(this.lskL, this.screen, this.lskR);
    r.appendChild(body);
    const keys = el('div', 'cdu-keys');
    const fn = [['INIT<br>REF', () => this.go('IDENT')], ['RTE', () => this.go('RTE')], ['DEP<br>ARR', () => this.go('DEPARR')], ['LEGS', () => this.go('LEGS')], ['PROG', () => this.go('PROG')], ['N1<br>LIMIT', () => this.go('THRLIM')],
      ['TAKEOFF', () => this.go('TAKEOFF')], ['APPR', () => this.go('APPROACH')], ['PERF', () => this.go('PERF')], ['PREV<br>PAGE', () => { this.sub = Math.max(0, this.sub - 1); }], ['NEXT<br>PAGE', () => { this.sub++; }], ['EXEC', () => this.exec()]];
    for (const [l, f] of fn) {
      const b = el('button', l === 'EXEC' ? 'k-exec' : '', l);
      b.onclick = () => { this.audio && this.audio.click(); f(); this.render(); };
      if (l === 'EXEC') this.execBtn = b;
      keys.appendChild(b);
    }
    const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890./'.split('');
    for (const c of alpha) {
      const b = el('button', 'k-alpha', c);
      b.onclick = () => { this.type(c); };
      keys.appendChild(b);
    }
    for (const [l, f] of [['SP', () => this.type(' ')], ['DEL', () => { this.scratch = 'DELETE'; }], ['CLR', () => this.clr()], ['+/-', () => this.type('-')]]) {
      const b = el('button', '', l); b.onclick = () => { f(); this.render(); }; keys.appendChild(b);
    }
    r.appendChild(keys);
    this.render();
  }

  type(c) { if (this.msg) { this.msg = ''; } if (this.scratch === 'DELETE') this.scratch = ''; if (this.scratch.length < 22) this.scratch += c; this.render(); }
  clr() { if (this.msg) this.msg = ''; else this.scratch = this.scratch.slice(0, -1); }
  /** キーボード入力（CDU ウィンドウ表示中） */
  key(e) {
    if (e.key === 'Backspace') { this.clr(); this.render(); return true; }
    if (e.key === 'Delete') { this.scratch = 'DELETE'; this.render(); return true; }
    if (e.key === 'Enter') { this.exec(); this.render(); return true; }
    if (/^[a-zA-Z0-9./ -]$/.test(e.key)) { this.type(e.key.toUpperCase()); return true; }
    return false;
  }
  go(p) { this.page = p; this.sub = 0; }
  err(m) { this.msg = m; this.render(); }

  exec() {
    if (!this.mod) return;
    const sim = this.getSim(), f = sim.fmc;
    if (this.mod.type === 'RTE') {
      f.setOrigin(this.mod.origin, this.mod.depRwy);
      f.setDest(this.mod.dest, this.mod.arrRwy);
      f.buildRoute();
      sim.ils = f.ils;
      sim.minimumsAltFt = f.arrRwy.elevM / FT + sim.sys.minimumsBaro;
      if (sim.onGround) { f.computeTakeoff(sim.fdm.mass, f.depRwy.elevM, 15); sim.af.mcp.spd = f.v2; }
      f.computeApproach(Math.min(sim.fdm.mass - sim.estimateTripFuel(), B789.MLW));
    }
    this.mod = null;
  }

  lines() {
    const sim = this.getSim(), f = sim.fmc, af = sim.af;
    const L = []; // [label, left, right, labelR]
    const title = (t, pg = '1/1') => ({ title: t, pg });
    let T;
    const fmtAlt = a => a == null ? '-----' : a >= 18000 ? 'FL' + Math.round(a / 100) : String(a);
    switch (this.page) {
      case 'IDENT':
        T = title('IDENT');
        L.push(['MODEL', '787-9', '', 'ENGINES'], ['', '', 'GEnx-1B74/75', ''], ['NAV DATA', 'OURAIRPORTS', '', 'ACTIVE'], ['', '', 'JAPAN', ''], ['OP PROGRAM', 'SIM-787 v1.0', '', ''], ['', '<INDEX', 'PERF INIT>', '']);
        break;
      case 'PERF': {
        T = title('PERF INIT');
        const gw = sim.fdm.mass / 1000, fuel = sim.sys.fuelTotal / 1000, zfw = gw - fuel;
        L.push(['GR WT', gw.toFixed(1), String(f.crzAltFt >= 18000 ? 'FL' + f.crzAltFt / 100 : f.crzAltFt), 'CRZ ALT'],
          ['FUEL', fuel.toFixed(1) + ' CALC', String(f.costIndex), 'COST INDEX'],
          ['ZFW', zfw.toFixed(1), String(f.transAltFt), 'TRANS ALT'],
          ['RESERVES', (f.reserveKg / 1000).toFixed(1), '', ''],
          ['', '', '', ''],
          ['', '<INDEX', 'THRUST LIM>', '']);
        break;
      }
      case 'THRLIM': {
        T = title('THRUST LIM');
        const sel = r => (f.toRating === r ? '<SEL>' : '');
        L.push(['', `<TO ${sel('TO')}`, `CLB ${af.rating === 'CLB' ? '<ACT>' : ''}>`, ''],
          ['', `<TO 1 ${sel('TO 1')}`, 'CLB 1>', ''],
          ['', `<TO 2 ${sel('TO 2')}`, 'CLB 2>', ''],
          ['N1 LIMIT', (af.ratingN1 || 0).toFixed(1) + '%', '', ''],
          ['', '', '', ''],
          ['', '<INDEX', 'TAKEOFF>', '']);
        break;
      }
      case 'TAKEOFF': {
        T = title('TAKEOFF REF');
        L.push(['FLAPS', f.toFlaps, String(f.v1 || '---') + 'KT', 'V1'],
          ['THRUST', f.toRating, String(f.vr || '---') + 'KT', 'VR'],
          ['CG / TRIM', '25.0% / ' + f.toTrim, String(f.v2 || '---') + 'KT', 'V2'],
          ['RWY', f.origin ? f.origin.icao + ' ' + (f.depRwy?.id || '') : '----', f.thrRedAglFt + '/' + f.accelAglFt, 'THR RED/ACCEL'],
          ['GR WT', (sim.fdm.mass / 1000).toFixed(1), (sim.trimUnits).toFixed(1), 'STAB SET'],
          ['', '<INDEX', 'SET TRIM>', '']);
        break;
      }
      case 'APPROACH': {
        T = title('APPROACH REF');
        const gw = (sim.fdm.mass / 1000).toFixed(1);
        L.push(['GROSS WT', gw, '', 'FLAPS   VREF'],
          ['', '', `25°  ${f.vref25}KT${f.ldgFlaps === '25' ? '<' : ''}`, ''],
          ['', '', `30°  ${f.vref30}KT${f.ldgFlaps === '30' ? '<' : ''}`, ''],
          ['ILS ' + (f.arrRwy ? f.arrRwy.id : ''), sim.ils ? sim.ils.freq.toFixed(2) + '/' + String(Math.round(sim.ils.courseMag)).padStart(3, '0') + '°' : '---', '', ''],
          ['MINIMUMS (BARO)', String(sim.sys.minimumsBaro) + ' FT', '', ''],
          ['', '<INDEX', 'RECALC>', '']);
        break;
      }
      case 'RTE': {
        const m = this.mod && this.mod.type === 'RTE' ? this.mod : null;
        T = title((m ? 'MOD ' : 'ACT ') + 'RTE 1');
        const o = m ? m.origin : f.origin?.icao, d = m ? m.dest : f.dest?.icao;
        const dr = m ? m.depRwy : f.depRwy?.id, ar = m ? m.arrRwy : f.arrRwy?.id;
        L.push(['ORIGIN', o || '□□□□', d || '□□□□', 'DEST'],
          ['RUNWAY', dr || '-----', ar || '-----', 'ARR RWY'],
          ['CRZ ALT', fmtAlt(f.crzAltFt), String(f.legs.length) + ' WPTS', 'ROUTE'],
          ['', '', '', ''],
          ['', '', m ? 'EXEC TO ACTIVATE' : '', ''],
          ['', '<DEP/ARR', 'LEGS>', '']);
        break;
      }
      case 'DEPARR': {
        T = title('DEP/ARR INDEX');
        const o = f.origin, d = f.dest;
        const rw = (a) => a ? a.runways.map(r => r.id) : [];
        const ro = rw(o), rd = rw(d);
        for (let i = 0; i < 5; i++) L.push([i === 0 ? (o ? o.icao + ' DEP' : '') : '', ro[i] ? '<' + ro[i] + (f.depRwy?.id === ro[i] ? ' <SEL>' : '') : '', rd[i] ? (f.arrRwy?.id === rd[i] ? '<SEL> ' : '') + rd[i] + '>' : '', i === 0 ? (d ? d.icao + ' ARR' : '') : '']);
        L.push(['', '<INDEX', 'RTE>', '']);
        break;
      }
      case 'LEGS': {
        const per = 5, pages = Math.max(1, Math.ceil((f.legs.length - f.active) / per));
        this.sub = Math.min(this.sub, pages - 1);
        T = title('ACT RTE 1 LEGS', `${this.sub + 1}/${pages}`);
        let prev = { lat: sim.fdm.lat, lon: sim.fdm.lon };
        for (let k = 0; k < per; k++) {
          const i = f.active + this.sub * per + k;
          const leg = f.legs[i];
          if (!leg) { L.push(['', '', '', '']); continue; }
          if (i > 0 && k === 0) prev = this.sub === 0 ? prev : f.legs[i - 1];
          const brg = Math.round(wrap360(bearing(prev.lat, prev.lon, leg.lat, leg.lon) - sim.magVar()));
          const d = distance(prev.lat, prev.lon, leg.lat, leg.lon) / NM;
          const cons = (leg.spd ? leg.spd + '/' : '') + (leg.alt != null ? fmtAlt(leg.alt) + (leg.altType === 'A' ? 'A' : '') : '');
          L.push([`${String(brg).padStart(3, '0')}°  ${d.toFixed(0)}NM`, (i === f.active ? '[M]' : '') + leg.ident, cons || '---/------', '']);
          prev = leg;
        }
        L.push(['', '<RTE 2 LEGS', 'RTE DATA>', '']);
        break;
      }
      case 'PROG': {
        T = title('PROGRESS');
        const leg = f.activeLeg, next = f.legs[f.active + 1];
        const gs = Math.max(sim.fdm.out.gs / KT, 1);
        const dTo = leg ? distance(sim.fdm.lat, sim.fdm.lon, leg.lat, leg.lon) / NM : 0;
        const dDest = f.distanceToDest(sim.fdm.lat, sim.fdm.lon) / NM;
        const fuelDest = sim.sys.fuelTotal - dDest * 11.5;
        const eta = m => { const z = new Date(Date.now() + m * 60000); return String(z.getUTCHours()).padStart(2, '0') + String(z.getUTCMinutes()).padStart(2, '0') + 'z'; };
        L.push(['TO', leg ? leg.ident : '----', dTo.toFixed(0) + 'NM ' + eta(dTo / gs * 60), 'DTG  ETA'],
          ['NEXT', next ? next.ident : '----', '', ''],
          ['DEST', f.dest ? f.dest.icao : '----', dDest.toFixed(0) + 'NM ' + eta(dDest / gs * 60), ''],
          ['FUEL AT DEST', (fuelDest / 1000).toFixed(1) + 't', String(Math.round(sim.fdm.out.tas / KT)) + 'KT', 'TAS'],
          ['WIND', (() => { const w = sim.fdm.out.wind; if (!w) return '---'; const v = Math.hypot(w[0], w[1]) / KT; const dd = wrap360(Math.atan2(-w[1], -w[0]) * 57.2958 - sim.magVar()); return String(Math.round(dd)).padStart(3, '0') + '°/' + Math.round(v) + 'KT'; })(), sim.flightPhase, 'PHASE'],
          ['', '<POS REF', '', '']);
        break;
      }
      default:
        T = title(this.page);
    }
    return { T, L };
  }

  lsk(side, i) {
    this.audio && this.audio.click();
    const sim = this.getSim(), f = sim.fmc, af = sim.af;
    const sp = this.scratch.trim();
    const take = () => { const v = this.scratch.trim(); this.scratch = ''; return v; };
    try {
      switch (this.page) {
        case 'IDENT': if (side === 'R' && i === 5) this.go('PERF'); break;
        case 'PERF':
          if (side === 'R' && i === 0 && sp) { let v = take().replace(/^FL/, ''); let n = +v; if (n < 1000) n *= 100; if (!(n >= 2000 && n <= 43000)) return this.err('INVALID ENTRY'); f.crzAltFt = n; f.updatePredictions(); }
          else if (side === 'R' && i === 1 && sp) { const n = +take(); if (!(n >= 0 && n <= 9999)) return this.err('INVALID ENTRY'); f.costIndex = n; }
          else if (side === 'R' && i === 2 && sp) { const n = +take(); if (!(n >= 3000 && n <= 18000)) return this.err('INVALID ENTRY'); f.transAltFt = n; }
          else if (side === 'R' && i === 5) this.go('THRLIM');
          else if (side === 'L' && i === 5) this.go('IDENT');
          break;
        case 'THRLIM':
          if (side === 'L' && i < 3) { f.toRating = ['TO', 'TO 1', 'TO 2'][i]; if (sim.onGround) af.rating = f.toRating; }
          else if (side === 'R' && i < 3) { af.rating = ['CLB', 'CLB 1', 'CLB 2'][i]; }
          else if (side === 'R' && i === 5) this.go('TAKEOFF');
          else if (side === 'L' && i === 5) this.go('IDENT');
          break;
        case 'TAKEOFF':
          if (side === 'L' && i === 0 && sp) { const v = take(); if (!B789.takeoffFlaps.map(String).includes(v)) return this.err('INVALID ENTRY'); f.toFlaps = v; f.computeTakeoff(sim.fdm.mass, f.depRwy?.elevM || 0, 15); }
          else if (side === 'R' && i <= 2 && sp) { const n = +take(); if (!(n > 80 && n < 200)) return this.err('INVALID ENTRY'); if (i === 0) f.v1 = n; else if (i === 1) f.vr = n; else f.v2 = n; }
          else if (side === 'R' && i === 5) { sim.fdm.ih = (4.6 - f.toTrim) / 0.85 * Math.PI / 180; this.msg = 'STAB SET ' + f.toTrim; }
          else if (side === 'L' && i === 1) { const order = ['TO', 'TO 1', 'TO 2']; f.toRating = order[(order.indexOf(f.toRating) + 1) % 3]; }
          else if (side === 'L' && i === 5) this.go('IDENT');
          break;
        case 'APPROACH':
          if (side === 'R' && i === 1) { f.ldgFlaps = '25'; sim.af.mcp.spd = f.vref25 + 5; }
          else if (side === 'R' && i === 2) { f.ldgFlaps = '30'; sim.af.mcp.spd = f.vref30 + 5; }
          else if (side === 'L' && i === 4 && sp) { const n = +take(); if (!(n >= 0 && n <= 2000)) return this.err('INVALID ENTRY'); sim.sys.minimumsBaro = n; sim.minimumsAltFt = f.arrRwy.elevM / FT + n; }
          else if (side === 'R' && i === 5) f.computeApproach(sim.fdm.mass);
          else if (side === 'L' && i === 5) this.go('IDENT');
          break;
        case 'RTE': {
          const base = this.mod && this.mod.type === 'RTE' ? this.mod : { type: 'RTE', origin: f.origin?.icao, dest: f.dest?.icao, depRwy: f.depRwy?.id, arrRwy: f.arrRwy?.id };
          if (side === 'L' && i === 0 && sp) { const a = findAirport(take()); if (!a) return this.err('NOT IN DATA BASE'); base.origin = a.icao; base.depRwy = a.runways[0].id; this.mod = base; }
          else if (side === 'R' && i === 0 && sp) { const a = findAirport(take()); if (!a) return this.err('NOT IN DATA BASE'); base.dest = a.icao; base.arrRwy = a.runways[0].id; this.mod = base; }
          else if (side === 'L' && i === 1 && sp) { const a = findAirport(base.origin); const r = sp.replace(/^RW/, ''); if (!findRunway(a, r)) return this.err('NOT IN DATA BASE'); take(); base.depRwy = r; this.mod = base; }
          else if (side === 'R' && i === 1 && sp) { const a = findAirport(base.dest); const r = sp.replace(/^RW/, ''); if (!findRunway(a, r)) return this.err('NOT IN DATA BASE'); take(); base.arrRwy = r; this.mod = base; }
          else if (side === 'L' && i === 2 && sp) { let n = +take().replace(/^FL/, ''); if (n < 1000) n *= 100; if (!(n >= 2000 && n <= 43000)) return this.err('INVALID ENTRY'); f.crzAltFt = n; f.updatePredictions(); }
          else if (side === 'L' && i === 5) this.go('DEPARR');
          else if (side === 'R' && i === 5) this.go('LEGS');
          break;
        }
        case 'DEPARR': {
          const base = this.mod && this.mod.type === 'RTE' ? this.mod : { type: 'RTE', origin: f.origin?.icao, dest: f.dest?.icao, depRwy: f.depRwy?.id, arrRwy: f.arrRwy?.id };
          if (i < 5) {
            const list = side === 'L' ? f.origin?.runways : f.dest?.runways;
            const r = list && list[i];
            if (r) { if (side === 'L') base.depRwy = r.id; else base.arrRwy = r.id; this.mod = base; }
          } else if (side === 'L') this.go('IDENT'); else this.go('RTE');
          break;
        }
        case 'LEGS': {
          const idx = f.active + this.sub * 5 + i;
          if (i === 5) { if (side === 'R') this.go('RTE'); break; }
          if (side === 'L') {
            if (sp === 'DELETE') { take(); f.deleteWaypoint(idx); }
            else if (sp) {
              const v = take();
              if (idx === f.active) { if (!f.directTo(v, sim.fdm.lat, sim.fdm.lon)) return this.err('NOT IN DATA BASE'); }
              else if (!f.insertWaypoint(idx, v, sim.fdm.lat, sim.fdm.lon)) return this.err('NOT IN DATA BASE');
            } else if (f.legs[idx]) this.scratch = f.legs[idx].ident;
          } else if (side === 'R' && sp && f.legs[idx]) {
            const v = take();
            const m = v.match(/^(\d{3})?\/?(FL)?(\d+)(A|B)?$/);
            if (!m) return this.err('INVALID ENTRY');
            if (m[1]) f.legs[idx].spd = +m[1];
            let a = +m[3]; if (m[2] || a < 1000) a *= 100;
            f.legs[idx].alt = a; f.legs[idx].altType = m[4] === 'A' ? 'A' : m[4] === 'B' ? 'B' : '@';
            f.updatePredictions();
          }
          break;
        }
        default: break;
      }
    } catch (e) { this.err('INVALID ENTRY'); }
    this.render();
  }

  render() {
    const { T, L } = this.lines();
    let h = `<div class="cdu-line cdu-title"><span>${esc(T.title)}</span></div>`;
    h = `<div class="cdu-line"><span></span><span>${esc(T.title)}</span><span class="c-s">${T.pg}</span></div>`;
    for (let i = 0; i < 6; i++) {
      const [lab, left, right, labR] = L[i] || ['', '', '', ''];
      h += `<div class="cdu-line small"><span>${esc(lab || '')}</span><span>${esc(labR || '')}</span></div>`;
      const cl = /^(<|\[M\])/.test(left || '') ? '' : 'c-g';
      h += `<div class="cdu-line"><span class="${left && left.startsWith('[M]') ? 'c-m' : ''}">${esc((left || '').replace('[M]', ''))}</span><span class="${right && right.includes('<SEL>') ? 'c-g' : ''}">${esc(right || '')}</span></div>`;
    }
    h += `<div class="cdu-line cdu-scratch"><span class="${this.msg ? 'c-a' : ''}">${esc(this.msg || this.scratch)}</span><span></span></div>`;
    this.screen.innerHTML = h;
    if (this.execBtn) this.execBtn.classList.toggle('lit', !!this.mod);
  }

  update() { if (!this.root.closest('[hidden]') && (this._t = (this._t || 0) + 1) % 15 === 0) this.render(); }
}
