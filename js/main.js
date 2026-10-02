// エントリポイント: シミュレーション・描画・UI・入力・音響を統合するメインループ
import { Simulation } from './sim/simulation.js';
import { Elevation } from './sim/elevation.js';
import { VirtualCaptain } from './sim/copilot.js';
import { B789 } from './sim/aircraft-787.js';
import { DEG, KT, FT, clamp } from './util/math.js';
import { World } from './render/world.js';
import { PFD } from './ui/pfd.js';
import { ND } from './ui/nd.js';
import { EICAS } from './ui/eicas.js';
import { HUD } from './ui/hud.js';
import { MCP } from './ui/mcp.js';
import { Pedestal } from './ui/pedestal.js';
import { Overhead } from './ui/overhead.js';
import { CDU } from './ui/cdu.js';
import { Checklist, HELP_HTML } from './ui/checklist.js';
import { Menu } from './ui/menu.js';
import { Tutorial } from './ui/tutorial.js';
import { Input } from './ui/input.js';
import { Sound } from './audio/sound.js';

const $ = id => document.getElementById(id);
const VIEWS = ['cockpit', 'chase', 'wing', 'flyby', 'tower'];
const VIEW_NAMES = { cockpit: 'COCKPIT', chase: 'CHASE', wing: 'WING', flyby: 'FLY-BY', tower: 'TOWER' };

const elevation = new Elevation();
let sim = new Simulation({ elevation });
let captain = null;
let world = null;
let scenario = null;
let running = false;
const sound = new Sound();
const input = new Input();
const getSim = () => sim;

// ---------- 表示系 ----------
try {
  world = new World($('gl'), elevation, {});
} catch (e) {
  console.error(e);
  $('menu-body').innerHTML = '<p style="color:#ff8a80">WebGL を初期化できませんでした。WebGL 対応ブラウザ（Chrome / Edge / Firefox / Safari 最新版）でお試しください。</p>';
}
const pfd = new PFD($('pfd')), nd = new ND($('nd')), eicas = new EICAS($('eicas')), hud = new HUD($('hud'));
const mcp = new MCP($('mcp'), $('efis-l'), getSim, sound);
const actions = {
  toggle: id => toggleWin(id),
  cycleView: () => setView(VIEWS[(VIEWS.indexOf(world.view) + 1) % VIEWS.length]),
  toggleHud: () => { hud.enabled = !hud.enabled; toast('HUD ' + (hud.enabled ? 'ON' : 'OFF')); },
  toggleDemo: () => toggleDemo(),
  demoOn: () => !!captain,
  togglePause: () => togglePause(),
  menu: () => openMenu(),
};
const pedestal = new Pedestal($('pedestal'), getSim, actions);
const overhead = new Overhead($('overhead'), getSim, sound);
const cdu = new CDU($('cdu'), getSim, sound);
const checklist = new Checklist($('checklist'), getSim);
$('help').innerHTML = HELP_HTML;

// ---------- ウィンドウ ----------
function toggleWin(id, force) {
  const w = $(id);
  w.hidden = force != null ? !force : !w.hidden;
  if (!w.hidden) { if (id === 'cdu-win') cdu.render(); if (id === 'chk-win') checklist.render(); }
}
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => toggleWin(b.dataset.close, false));
document.querySelectorAll('.float-win').forEach(win => {
  const bar = win.querySelector('.win-title');
  let sx, sy, ox, oy, drag = false;
  bar.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    drag = true; bar.setPointerCapture(e.pointerId);
    const r = win.getBoundingClientRect(); sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
    win.style.transform = 'none'; win.style.left = ox + 'px'; win.style.top = oy + 'px'; win.style.right = 'auto';
  });
  bar.addEventListener('pointermove', e => {
    if (!drag) return;
    win.style.left = clamp(ox + e.clientX - sx, -win.offsetWidth + 80, innerWidth - 80) + 'px';
    win.style.top = clamp(oy + e.clientY - sy, 0, innerHeight - 40) + 'px';
  });
  bar.addEventListener('pointerup', () => { drag = false; });
});

function toast(text, cls = '') {
  const t = document.createElement('div');
  t.className = 'toast-item ' + cls; t.textContent = text;
  $('toast').appendChild(t);
  setTimeout(() => t.remove(), cls === 'cap' ? 4500 : 3000);
  while ($('toast').children.length > 4) $('toast').firstChild.remove();
}
input.on('toast', toast);

function setView(v) {
  world.setView(v);
  $('sb-view').textContent = VIEW_NAMES[v];
  $('cockpit-frame').classList.toggle('on', v === 'cockpit');
}

function togglePause(force) {
  sim.paused = force != null ? force : !sim.paused;
  $('pause-badge').hidden = !sim.paused;
  if (sim.paused) sound.silence();
}

function toggleDemo(on) {
  const want = on != null ? on : !captain;
  if (want) { captain = new VirtualCaptain(sim); toast('自動操縦デモ: 仮想機長が操縦します（操縦入力で解除）', 'cap'); }
  else { captain = null; sim.pilot.pitch = sim.pilot.roll = sim.pilot.yaw = 0; toast('自動操縦デモ 解除'); }
}

// ---------- メニュー ----------
const tutorial = new Tutorial($('tutorial'), getSim, {
  startFlight: sc => startFlight(Object.assign(menu.scenario(), sc, { tutorial: true }), false),
  pause: on => togglePause(on),
  openMenu: () => openMenu(),
  sound: name => sound.play(name),
});
const menu = new Menu($('menu-body'), (sc, demo) => { tutorial.stop(); startFlight(sc, demo); }, tutorial);
function openMenu() {
  togglePause(true);
  $('menu').hidden = false;
  menu.render();
  if (running) {
    const act = document.querySelector('.m-actions');
    if (act && !$('m-resume')) {
      const b = document.createElement('button'); b.className = 'btn'; b.id = 'm-resume'; b.textContent = 'フライトに戻る';
      b.onclick = () => { $('menu').hidden = true; togglePause(false); };
      act.prepend(b);
    }
  }
}

async function startFlight(sc, demo) {
  sound.init();
  sound.enabled = sc.sound;
  scenario = sc;
  $('menu').hidden = true;
  $('report').hidden = true;
  $('loading').hidden = false;
  $('loading-text').textContent = '機体とフライトを準備中…';
  sim = new Simulation({ elevation });
  if (world) {
    world.terrain.enabled = sc.terrain;
    const apt = sc.start === 'final10' || sc.start === 'final5' ? sc.dest : sc.origin;
    const { AIRPORTS } = await import('./data/airports.js');
    const a = AIRPORTS.find(x => x.icao === apt);
    if (a && sc.terrain) {
      $('loading-text').textContent = '国土地理院 標高データを取得中…';
      await world.terrain.preload(a.lat, a.lon);
    }
  }
  sim.setup(sc);
  sim.timeOfDay = sc.timeOfDay;
  hud.enabled = sc.hud;
  cdu.mod = null; cdu.go(sc.start === 'cold' ? 'IDENT' : 'TAKEOFF'); cdu.render();
  captain = null;
  if (demo) toggleDemo(true);
  setView('cockpit');
  if (world) world.head = { yaw: 0, pitch: -6 * DEG, fov: 58 };
  $('loading').hidden = true;
  togglePause(false);
  running = true;
  lastT = performance.now();
  toast(`${sim.fmc.origin.nameJa} RWY ${sim.fmc.depRwy.id} → ${sim.fmc.dest.nameJa} RWY ${sim.fmc.arrRwy.id}`);
  if (sc.start === 'cold') { toast('コールド＆ダーク: チェックリスト [K] の「エンジン始動」から始めてください', 'cap'); toggleWin('chk-win', true); }
  if (!sc.tutorial && sc.start === 'runway' && !demo) toast('パーキングブレーキ解除 [P] → 推力を少し上げて [T] で TO/GA 離陸推力', 'cap');
  if (!sc.tutorial && sc.start === 'final5') toast('手動着陸: ILS の菱形（LOC / G/S）を中央に保ち、50ft でフレア', 'cap');
}

// ---------- キー操作 ----------
input.on('capture', e => {
  if (!$('cdu-win').hidden && document.activeElement === document.body && cdu.root.matches(':hover')) return cdu.key(e);
  return false;
});
input.on('press', (k, e) => {
  if (!running) return false;
  const af = sim.af;
  if (e.ctrlKey || e.metaKey) {
    const m = { KeyH: () => af.pressHDGSel(sim), KeyL: () => af.pressLNAV(sim), KeyV: () => af.pressVNAV(sim), KeyF: () => af.pressFLCH(sim), KeyP: () => af.pressAPP(sim) }[k];
    if (m) { m(); sound.click(); return true; }
    return false;
  }
  switch (k) {
    case 'Space': togglePause(); return true;
    case 'Escape': if (!$('menu').hidden) { $('menu').hidden = true; togglePause(false); } else openMenu(); return true;
    case 'F1': toggleWin('help-win'); return true;
    case 'KeyG': sim.toggleGear(); toast('GEAR ' + (sim.sys.gearLever === 'UP' ? 'UP' : 'DOWN')); return true;
    case 'KeyF': if (e.shiftKey) sim.flapUp(); else sim.flapDown(); toast('FLAPS ' + B789.flaps[sim.sys.flapLever].name); return true;
    case 'BracketRight': sim.flapDown(); toast('FLAPS ' + B789.flaps[sim.sys.flapLever].name); return true;
    case 'BracketLeft': sim.flapUp(); toast('FLAPS ' + B789.flaps[sim.sys.flapLever].name); return true;
    case 'KeyP': sim.sys.parkingBrake = !sim.sys.parkingBrake; toast('PARKING BRAKE ' + (sim.sys.parkingBrake ? 'SET' : 'RELEASED')); return true;
    case 'Slash': {
      const sy = sim.sys;
      if (e.shiftKey) { sy.speedbrakeArmed = false; sy.speedbrakeLever = sy.speedbrakeLever > 0.9 ? 0 : 1; }
      else if (!sy.speedbrakeArmed && sy.speedbrakeLever < 0.05) sy.speedbrakeArmed = true;
      else if (sy.speedbrakeArmed) { sy.speedbrakeArmed = false; sy.speedbrakeLever = sim.onGround ? 0 : 0.6; }
      else { sy.speedbrakeLever = 0; }
      toast('SPEEDBRAKE ' + (sy.speedbrakeArmed ? 'ARMED' : sy.speedbrakeLever > 0.05 ? (sy.speedbrakeLever > 0.9 ? 'UP' : 'FLT DETENT') : 'DOWN'));
      return true;
    }
    case 'KeyA': if (e.shiftKey) af.pressAT(sim); else af.pressAP(sim); sound.click(); return true;
    case 'KeyT': af.pressTOGA(sim); sound.click(); return true;
    case 'F4': sim.setThrottle(1); return true;
    case 'F1x': return false;
    case 'KeyU': actions.toggleHud(); return true;
    case 'Tab': $('app').classList.toggle('panel-hidden'); setTimeout(() => world && world.resize(), 30); return true;
    case 'KeyC': toggleWin('cdu-win'); return true;
    case 'KeyO': toggleWin('ovhd-win'); return true;
    case 'KeyK': toggleWin('chk-win'); return true;
    case 'KeyV': actions.cycleView(); return true;
    case 'KeyM': sim.sys.resetMaster(sim); return true;
    case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5': setView(VIEWS[+k.slice(5) - 1]); return true;
    default: return false;
  }
});
// F1 はヘルプ、アイドルは F1 と競合するため Shift+F1 / Numpad / 1 キー以外で: "I" キーをアイドルに
window.addEventListener('keydown', e => { if (running && e.code === 'KeyI') sim.setThrottle(0); });

$('btn-mw').onclick = () => sim.sys.resetMaster(sim);
$('btn-mc').onclick = () => sim.sys.resetMaster(sim);

// ---------- 視点のマウス操作 ----------
{
  const v = $('view');
  let drag = null;
  v.addEventListener('pointerdown', e => {
    sound.init();
    if (e.target.closest('#tutorial, #yoke, button, select, input')) return; // パネル上の操作は視点ドラッグにしない
    drag = { x: e.clientX, y: e.clientY }; v.setPointerCapture(e.pointerId);
  });
  v.addEventListener('pointermove', e => {
    if (!drag || !world) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag = { x: e.clientX, y: e.clientY };
    if (world.view === 'cockpit') {
      world.head.yaw = clamp(world.head.yaw - dx * 0.004, -2.6, 2.6);
      world.head.pitch = clamp(world.head.pitch - dy * 0.004, -1.2, 1.2);
    } else {
      world.chase.yaw -= dx * 0.006;
      world.chase.pitch = clamp(world.chase.pitch + dy * 0.004, -0.3, 1.4);
    }
  });
  v.addEventListener('pointerup', () => { drag = null; });
  v.addEventListener('dblclick', e => { if (e.target.closest('#tutorial')) return; if (world) { world.head.yaw = 0; world.head.pitch = -6 * DEG; world.head.fov = 58; world.chase.yaw = 0; world.chase.pitch = 10 * DEG; } });
  v.addEventListener('wheel', e => {
    if (e.target.closest('#tutorial')) return;
    e.preventDefault();
    if (!world) return;
    if (world.view === 'cockpit') world.head.fov = clamp(world.head.fov * (e.deltaY > 0 ? 1.08 : 0.92), 20, 90);
    else world.chase.dist = clamp(world.chase.dist * (e.deltaY > 0 ? 1.1 : 0.9), 30, 1500);
  }, { passive: false });
}
new ResizeObserver(() => world && world.resize()).observe($('view'));
if (window.matchMedia && matchMedia('(pointer: coarse)').matches) input.attachTouchYoke($('view'));

// ---------- イベント処理 ----------
function handleEvents() {
  for (const ev of sim.consumeEvents()) {
    switch (ev.type) {
      case 'callout': sound.say(ev.text, ev.priority); break;
      case 'sound': sound.play(ev.name); break;
      case 'caution-sound': sound.play('caution'); break;
      case 'silence': sound.silence(); break;
      case 'message': toast(ev.text); break;
      case 'copilot': toast('機長: ' + ev.text, 'cap'); break;
      case 'TOUCHDOWN': sound._tdVol = clamp(Math.abs(ev.vsFpm) / 600, 0.2, 1); sound.play('touchdown'); break;
      case 'TAILSTRIKE': toast('TAIL STRIKE（尻もち）', 'warn'); break;
      case 'LANDING_REPORT': setTimeout(() => showReport(ev.report), 6000); break;
      case 'CRASH': showCrash(ev.reason); break;
      default: break;
    }
  }
}

function showReport(r) {
  if (!r) return;
  $('report-body').innerHTML = `
    <header class="menu-head"><div><h1>着陸評価 <span>LANDING REPORT</span></h1><p>${r.runway}</p></div></header>
    <div style="padding:16px 22px">
      <div class="report-grade ${r.grade}">${r.grade}</div>
      <p style="text-align:center;margin:4px 0 0">${r.comment}</p>
      <table class="report-table">
        <tr><td>接地時の降下率</td><td>${r.vsFpm} fpm</td></tr>
        <tr><td>接地位置（進入端から）</td><td>${r.along} m</td></tr>
        <tr><td>中心線からのずれ</td><td>${r.offset} m</td></tr>
        <tr><td>接地時ピッチ / バンク</td><td>${r.pitch}° / ${r.bank}°</td></tr>
        <tr><td>接地速度</td><td>${r.ias} kt</td></tr>
        <tr><td>尻もち</td><td>${r.tailStrike ? 'あり' : 'なし'}</td></tr>
      </table>
      <div class="m-actions"><button class="btn" id="rp-close">続ける</button><button class="btn primary" id="rp-menu">メニューへ</button></div>
    </div>`;
  $('report').hidden = false;
  $('rp-close').onclick = () => { $('report').hidden = true; };
  $('rp-menu').onclick = () => { $('report').hidden = true; openMenu(); };
}

function showCrash(reason) {
  sound.silence();
  $('report-body').innerHTML = `
    <header class="menu-head"><div><h1 style="color:#ff6b5f">CRASH</h1><p>${reason}</p></div></header>
    <div style="padding:16px 22px">
      <p class="m-note">同じ条件でやり直すか、メニューから設定を変更してください。</p>
      <div class="m-actions"><button class="btn" id="cr-menu">メニューへ</button><button class="btn primary" id="cr-retry">やり直す</button></div>
    </div>`;
  $('report').hidden = false;
  $('cr-retry').onclick = () => { if (tutorial.active) tutorial.start(tutorial.lesson.id); else startFlight(scenario, false); };
  $('cr-menu').onclick = () => { $('report').hidden = true; openMenu(); };
}

// ---------- メインループ ----------
let lastT = performance.now();
let frame = 0, fpsT = 0, fpsN = 0;
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min((t - lastT) / 1000, 0.1);
  lastT = t;
  if (!running || !world) return;
  frame++;
  input.update(dt, sim);
  // 操縦入力があれば自動操縦デモ解除
  if (captain) {
    const p = sim.pilot;
    if (Math.abs(input.axes.pitch) > 0.3 || Math.abs(input.axes.roll) > 0.3) toggleDemo(false);
    else { p.pitch = 0; p.roll = 0; p.yaw = 0; captain.update(dt * sim.simRate); }
  }
  sim.update(dt);
  handleEvents();
  const hour = (sim.timeOfDay + sim.time / 3600) % 24;
  world.update(sim, dt, hour, t / 1000);
  hud.draw(sim, world);
  // 計器（約 30Hz）
  if (frame % 2 === 0) { pfd.draw(sim); nd.draw(sim, t / 1000); eicas.draw(sim); }
  if (frame % 6 === 0) {
    tutorial.update(t / 1000);
    mcp.update(sim); pedestal.update(); overhead.update(); cdu.update(); checklist.update();
    $('btn-mw').classList.toggle('lit', sim.sys.masterWarning);
    $('btn-mc').classList.toggle('lit', sim.sys.masterCaution);
    $('sb-rate').textContent = sim.simRate > 1 ? `×${sim.simRate}` : '';
    const st = world.terrain.stats;
    $('sb-tiles').textContent = scenario && scenario.terrain ? `TILES ${st.visible}/${st.tiles}${st.loading ? ' ⟳' + st.loading : ''}${world.terrain.netOk ? '' : ' (オフライン)'}` : '';
  }
  sound.update(sim, world.view, dt);
  fpsN++; fpsT += dt;
  if (fpsT > 1) { $('sb-help').textContent = `${Math.round(fpsN / fpsT)} FPS  [F1] ヘルプ`; fpsN = 0; fpsT = 0; }
}
requestAnimationFrame(loop);

// ---------- PWA（ホーム画面に追加・オフライン起動）----------
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  window.__installPrompt = e;
  if (!$('menu').hidden) menu.render();
});
window.addEventListener('appinstalled', () => toast('アプリとしてインストールしました'));
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !/^(localhost|127\.)/.test(location.hostname) || 'serviceWorker' in navigator && new URLSearchParams(location.search).has('sw')) {
  navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Service Worker 登録失敗', err));
}

// デバッグ・自動テスト用
window.__sim = () => sim;
window.__world = () => world;
window.__start = (sc, demo) => startFlight(Object.assign(menu.scenario(), sc || {}), demo);
