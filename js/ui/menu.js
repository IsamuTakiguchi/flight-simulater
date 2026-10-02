// スタートメニュー（出発・到着空港、開始位置、重量、天候、時刻、設定）
import { AIRPORTS } from '../data/airports.js';
import { FT, wrap360 } from '../util/math.js';
import { distance } from '../util/geo.js';
import { LESSONS } from './tutorial.js';

const PRESETS = {
  clear: { name: '快晴', windDir: 0, windKt: 5, gustKt: 0, visibilityM: 40000, cloudBaseFt: 6000, cloudCover: 0.15, cloudTopFt: 8000, turbulence: 0, oatC: 18, qnh: 1018 },
  scattered: { name: '晴れ時々曇り', windDir: 0, windKt: 10, gustKt: 0, visibilityM: 25000, cloudBaseFt: 3500, cloudCover: 0.45, cloudTopFt: 6500, turbulence: 0.15, oatC: 16, qnh: 1012 },
  overcast: { name: '曇り・低い雲', windDir: 0, windKt: 14, gustKt: 6, visibilityM: 8000, cloudBaseFt: 1200, cloudCover: 0.9, cloudTopFt: 7000, turbulence: 0.3, oatC: 12, qnh: 1004 },
  lowvis: { name: '濃霧（CAT III）', windDir: 0, windKt: 3, gustKt: 0, visibilityM: 300, cloudBaseFt: 100, cloudCover: 1.0, cloudTopFt: 1500, turbulence: 0, oatC: 9, qnh: 1015 },
  xwind: { name: '強い横風', windDir: 90, windKt: 25, gustKt: 12, visibilityM: 20000, cloudBaseFt: 3000, cloudCover: 0.5, cloudTopFt: 6000, turbulence: 0.5, oatC: 14, qnh: 1000 },
  custom: { name: 'カスタム' },
};

const START = [
  ['runway', '滑走路上（エンジン始動済み・離陸準備完了）'],
  ['cold', '滑走路上（コールド＆ダーク：電源OFFから始動）'],
  ['final10', '最終進入 10NM（オートパイロット ILS 進入中）'],
  ['final5', '最終進入 5NM（手動着陸の練習）'],
  ['cruise', '巡航中（FMC 経路上）'],
];

const TIMES = [['now', '現在時刻（日本時間）'], ['6', '早朝 6:00'], ['10', '午前 10:00'], ['14', '午後 14:00'], ['17.5', '夕暮れ 17:30'], ['19', '日没後 19:00'], ['22', '夜 22:00']];

function opt(v, t, sel) { return `<option value="${v}" ${sel ? 'selected' : ''}>${t}</option>`; }

export class Menu {
  constructor(root, onStart, tutorial = null) {
    this.root = root; this.onStart = onStart; this.tutorial = tutorial;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('b787sim.menu') || '{}'); } catch (e) { saved = {}; }
    this.s = Object.assign({
      origin: 'RJTT', depRwy: '34R', dest: 'RJBB', arrRwy: '24L', start: 'runway', pax: 240, cargoKg: 8000, fuelKg: 0,
      preset: 'clear', time: 'now', autoTrim: true, terrain: true, sound: true, hud: true, ...PRESETS.clear,
    }, saved);
    this.render();
  }

  runways(icao) { const a = AIRPORTS.find(x => x.icao === icao); return a ? a.runways : []; }

  bestRunway(icao) {
    const r = this.runways(icao);
    // 風に正対する滑走路
    const wd = this.s.windDir || 0;
    let best = r[0], bs = -2;
    for (const x of r) {
      const head = Math.cos((x.hdg - wd) * Math.PI / 180) + x.lengthM / 40000;
      if (head > bs) { bs = head; best = x; }
    }
    return best ? best.id : '';
  }

  render() {
    const s = this.s;
    const aptOpts = sel => AIRPORTS.map(a => opt(a.icao, `${a.icao}${a.iata ? ' / ' + a.iata : ''}　${a.nameJa}`, a.icao === sel)).join('');
    const rwyOpts = (icao, sel) => this.runways(icao).map(r => opt(r.id, `RWY ${r.id}（${r.lengthM} m）`, r.id === sel)).join('');
    const rwyInfo = (icao, id) => {
      const a = AIRPORTS.find(x => x.icao === icao); const r = a && a.runways.find(x => x.id === id);
      if (!r) return '';
      const mag = Math.round(wrap360(r.hdg - a.magVar));
      return `標高 ${a.elevFt} ft ／ 磁方位 ${String(mag).padStart(3, '0')}° ／ 長さ ${r.lengthM} m × 幅 ${r.widthM} m${r.lengthM < 2500 ? ' <span style="color:#ffb000">※787 には短い滑走路</span>' : ''}`;
    };
    const o = AIRPORTS.find(a => a.icao === s.origin), d = AIRPORTS.find(a => a.icao === s.dest);
    const dist = o && d ? Math.round(distance(o.lat, o.lon, d.lat, d.lon) / 1852) : 0;
    const zfw = 128850 + s.pax * 95 + s.cargoKg;
    const autoFuel = Math.round(Math.min(101000, 6500 + dist * 12.5 + 3500) / 100) * 100;
    const fuel = s.fuelKg > 0 ? s.fuelKg : autoFuel;
    const tow = zfw + fuel;
    const p = PRESETS[s.preset] || PRESETS.custom;
    const tut = this.tutorial;
    const firstTime = tut && !LESSONS.some(l => tut.isDone(l.id));
    this.root.innerHTML = `
      <section class="m-tut">
        <div class="m-tut-head"><h2>🎓 チュートリアル</h2><span class="m-note">${firstTime ? 'はじめての方は「画面の見方」→「はじめての離陸」の順がおすすめです。' : '各レッスンは何度でも受けられます。'}</span></div>
        <div class="m-tut-list">
          ${LESSONS.map((l, i) => `<button class="m-lesson${tut && tut.isDone(l.id) ? ' done' : ''}${firstTime && i === 0 ? ' rec' : ''}" data-lesson="${l.id}">
            <span class="ml-top"><span class="ml-no">${i + 1}</span><span class="ml-level">${l.level}・${l.time}</span>${tut && tut.isDone(l.id) ? '<span class="ml-done">✔ 完了</span>' : ''}</span>
            <span class="ml-name">${l.name}</span><span class="ml-desc">${l.desc}</span></button>`).join('')}
        </div>
      </section>
      <div class="m-grid">
        <section class="m-sec">
          <h2>✈ 出発</h2>
          <div class="m-field"><label>出発空港</label><select id="m-origin">${aptOpts(s.origin)}</select></div>
          <div class="m-field"><label>滑走路</label><select id="m-dep">${rwyOpts(s.origin, s.depRwy)}</select></div>
          <div class="m-rwyinfo">${rwyInfo(s.origin, s.depRwy)}</div>
          <div class="m-field"><label>開始位置</label><select id="m-start">${START.map(([v, t]) => opt(v, t, v === s.start)).join('')}</select></div>
        </section>
        <section class="m-sec">
          <h2>🛬 到着</h2>
          <div class="m-field"><label>到着空港</label><select id="m-dest">${aptOpts(s.dest)}</select></div>
          <div class="m-field"><label>着陸滑走路</label><select id="m-arr">${rwyOpts(s.dest, s.arrRwy)}</select></div>
          <div class="m-rwyinfo">${rwyInfo(s.dest, s.arrRwy)}</div>
          <div class="m-note">飛行距離 約 ${dist} NM。FMC が VOR を経由する経路と ILS 進入を自動生成します（CDU で変更可）。</div>
        </section>
        <section class="m-sec">
          <h2>⚖ 重量・燃料</h2>
          <div class="m-field"><label>乗客数</label><div class="m-inline"><input type="range" id="m-pax" min="0" max="290" step="10" value="${s.pax}"><output>${s.pax} 名</output></div></div>
          <div class="m-field"><label>貨物</label><div class="m-inline"><input type="range" id="m-cargo" min="0" max="25000" step="500" value="${s.cargoKg}"><output>${(s.cargoKg / 1000).toFixed(1)} t</output></div></div>
          <div class="m-field"><label>燃料</label><div class="m-inline"><input type="range" id="m-fuel" min="0" max="101000" step="1000" value="${s.fuelKg}"><output>${s.fuelKg > 0 ? (fuel / 1000).toFixed(1) + ' t' : '自動 ' + (fuel / 1000).toFixed(1) + ' t'}</output></div></div>
          <div class="m-note">ZFW ${(zfw / 1000).toFixed(1)} t ／ 離陸重量 ${(tow / 1000).toFixed(1)} t（MTOW 254.0 t）${tow > 254011 ? ' <span style="color:#ff5a4f">最大離陸重量超過</span>' : ''}</div>
        </section>
        <section class="m-sec">
          <h2>☁ 天候・時刻</h2>
          <div class="m-field"><label>天候</label><select id="m-preset">${Object.entries(PRESETS).map(([k, v]) => opt(k, v.name, k === s.preset)).join('')}</select></div>
          <div class="m-field"><label>風</label><div class="m-inline"><input type="number" id="m-wd" min="0" max="360" step="10" value="${s.windDir}" style="width:80px"> ° /&nbsp;<input type="number" id="m-wk" min="0" max="60" value="${s.windKt}" style="width:70px"> kt</div></div>
          <div class="m-field"><label>視程</label><div class="m-inline"><input type="range" id="m-vis" min="200" max="50000" step="100" value="${s.visibilityM}"><output>${s.visibilityM >= 10000 ? (s.visibilityM / 1000).toFixed(0) + ' km' : s.visibilityM + ' m'}</output></div></div>
          <div class="m-field"><label>雲量 / 雲底</label><div class="m-inline"><input type="range" id="m-cc" min="0" max="1" step="0.05" value="${s.cloudCover}"><output>${Math.round(s.cloudCover * 8)}/8 ${s.cloudBaseFt}ft</output></div></div>
          <div class="m-field"><label>乱気流</label><div class="m-inline"><input type="range" id="m-turb" min="0" max="1" step="0.05" value="${s.turbulence}"><output>${s.turbulence < 0.05 ? 'なし' : s.turbulence < 0.35 ? '弱' : s.turbulence < 0.7 ? '並' : '強'}</output></div></div>
          <div class="m-field"><label>気温 / QNH</label><div class="m-inline"><input type="number" id="m-oat" min="-30" max="45" value="${s.oatC}" style="width:70px"> ℃ /&nbsp;<input type="number" id="m-qnh" min="950" max="1050" value="${s.qnh}" style="width:80px"> hPa</div></div>
          <div class="m-field"><label>時刻</label><select id="m-time">${TIMES.map(([v, t]) => opt(v, t, v === String(s.time))).join('')}</select></div>
        </section>
        <section class="m-sec">
          <h2>⚙ 設定</h2>
          <label class="m-check"><input type="checkbox" id="m-terrain" ${s.terrain ? 'checked' : ''}> 実地形・航空写真（国土地理院タイル、要インターネット）</label>
          <label class="m-check"><input type="checkbox" id="m-trim" ${s.autoTrim ? 'checked' : ''}> 操縦補助：トリム自動（OFF で実機同様に手動トリム）</label>
          <label class="m-check"><input type="checkbox" id="m-sound" ${s.sound ? 'checked' : ''}> 効果音・自動音声コールアウト</label>
          <label class="m-check"><input type="checkbox" id="m-hud" ${s.hud ? 'checked' : ''}> HUD を表示</label>
          <div class="m-note">キーボード・ゲームパッド・ジョイスティックで操縦できます。[F1] で操作一覧。<br>
          「自動操縦デモで開始」では仮想機長が標準手順で離陸から着陸・停止まで操縦します。</div>
        </section>
      </div>
      <div class="m-actions">
        <button class="btn" id="m-install" hidden>アプリとしてインストール</button>
        <button class="btn" id="m-full">全画面</button>
        <button class="btn" id="m-help">操作ヘルプ</button>
        <button class="btn" id="m-demo">自動操縦デモで開始</button>
        <button class="btn primary" id="m-go">フライト開始</button>
      </div>`;
    const $ = id => this.root.querySelector('#' + id);
    const bind = (id, fn, ev = 'change') => $(id).addEventListener(ev, e => { fn(e.target); this.save(); this.render(); });
    bind('m-origin', t => { s.origin = t.value; s.depRwy = this.bestRunway(t.value); });
    bind('m-dep', t => { s.depRwy = t.value; });
    bind('m-dest', t => { s.dest = t.value; s.arrRwy = this.bestRunway(t.value); });
    bind('m-arr', t => { s.arrRwy = t.value; });
    bind('m-start', t => { s.start = t.value; });
    bind('m-pax', t => { s.pax = +t.value; });
    bind('m-cargo', t => { s.cargoKg = +t.value; });
    bind('m-fuel', t => { s.fuelKg = +t.value; });
    bind('m-preset', t => { s.preset = t.value; const pr = PRESETS[t.value]; if (t.value !== 'custom') { const { name, ...rest } = pr; Object.assign(s, rest); s.depRwy = this.bestRunway(s.origin); s.arrRwy = this.bestRunway(s.dest); } });
    bind('m-wd', t => { s.windDir = +t.value; s.preset = 'custom'; });
    bind('m-wk', t => { s.windKt = +t.value; s.preset = 'custom'; });
    bind('m-vis', t => { s.visibilityM = +t.value; s.preset = 'custom'; });
    bind('m-cc', t => { s.cloudCover = +t.value; s.preset = 'custom'; });
    bind('m-turb', t => { s.turbulence = +t.value; s.preset = 'custom'; });
    bind('m-oat', t => { s.oatC = +t.value; });
    bind('m-qnh', t => { s.qnh = +t.value; });
    bind('m-time', t => { s.time = t.value; });
    bind('m-terrain', t => { s.terrain = t.checked; });
    bind('m-trim', t => { s.autoTrim = t.checked; });
    bind('m-sound', t => { s.sound = t.checked; });
    bind('m-hud', t => { s.hud = t.checked; });
    // range はドラッグ中は数値表示のみ更新（確定時に再描画）
    for (const id of ['m-pax', 'm-cargo', 'm-fuel', 'm-vis', 'm-cc', 'm-turb']) {
      const elx = $(id), out = elx.nextElementSibling;
      elx.addEventListener('input', () => { out.textContent = elx.value; });
    }
    this.root.querySelectorAll('[data-lesson]').forEach(b => { b.onclick = () => { this.save(); this.tutorial && this.tutorial.start(b.dataset.lesson); }; });
    $('m-go').onclick = () => this.start(false);
    $('m-demo').onclick = () => this.start(true);
    $('m-help').onclick = () => document.getElementById('help-win').hidden = false;
    // PWA インストール（対応ブラウザのみ表示）
    const inst = $('m-install');
    if (window.__installPrompt) {
      inst.hidden = false;
      inst.onclick = async () => { const p = window.__installPrompt; window.__installPrompt = null; p.prompt(); await p.userChoice.catch(() => {}); inst.hidden = true; };
    }
    $('m-full').onclick = () => {
      const d = document.documentElement;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (d.requestFullscreen) d.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
    };
  }

  save() { try { localStorage.setItem('b787sim.menu', JSON.stringify(this.s)); } catch (e) { /* 保存不可でも続行 */ } }

  scenario() {
    const s = this.s;
    const o = AIRPORTS.find(a => a.icao === s.origin), d = AIRPORTS.find(a => a.icao === s.dest);
    const dist = distance(o.lat, o.lon, d.lat, d.lon) / 1852;
    const fuel = s.fuelKg > 0 ? s.fuelKg : Math.round(Math.min(101000, 6500 + dist * 12.5 + 3500) / 100) * 100;
    let hour = s.time === 'now' ? (() => { const n = new Date(); return ((n.getUTCHours() + 9) % 24) + n.getUTCMinutes() / 60; })() : +s.time;
    return {
      origin: s.origin, depRwy: s.depRwy, dest: s.dest, arrRwy: s.arrRwy, start: s.start,
      payloadKg: s.pax * 95 + s.cargoKg, fuelKg: fuel, oatC: s.oatC, timeOfDay: hour, autoTrim: s.autoTrim,
      weather: { windDir: s.windDir, windKt: s.windKt, gustKt: s.gustKt || 0, visibilityM: s.visibilityM, cloudBaseFt: s.cloudBaseFt, cloudCover: s.cloudCover, cloudTopFt: s.cloudTopFt || s.cloudBaseFt + 3000, turbulence: s.turbulence, qnh: s.qnh },
      terrain: s.terrain, sound: s.sound, hud: s.hud,
    };
  }

  start(demo) { this.save(); this.onStart(this.scenario(), demo); }
}
