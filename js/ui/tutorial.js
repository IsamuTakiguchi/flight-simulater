// 初心者向けチュートリアル: 手順を 1 つずつ表示し、操作できたら自動で次へ進む
import { KT, wrap180, clamp } from '../util/math.js';
import { B789 } from '../sim/aircraft-787.js';

const kt = s => Math.round(s.fdm.out.ias || 0);
const flapName = s => B789.flaps[s.sys.flapLever].name;
const CALM = { windDir: 0, windKt: 3, gustKt: 0, visibilityM: 40000, cloudBaseFt: 6000, cloudCover: 0.15, cloudTopFt: 8000, turbulence: 0, qnh: 1013 };

/**
 * 各ステップ: title, text(HTML), target(data-tut 名 or CSS セレクタ), cond(sim)→bool（null なら「次へ」で進む）,
 *   live(sim)→文字列, enter(sim, ctx), pause: 説明中は一時停止
 */
export const LESSONS = [
  {
    id: 'tour', name: '画面の見方', time: '約3分', level: '入門',
    desc: 'コックピットの画面とスイッチの役割を、実物の配置どおりに順番に紹介します。',
    scenario: { start: 'runway', origin: 'RJTT', depRwy: '34R', dest: 'RJBB', arrRwy: '24L', timeOfDay: 11, weather: CALM },
    steps: [
      { title: 'ようこそ、787 のフライトデッキへ', text: 'ここは羽田空港 RWY 34R。エンジンは始動済みで、パーキングブレーキがかかった状態です。<br>このチュートリアルでは画面を順番に見ていきます。<b>「次へ」</b>で進んでください。' },
      { title: '外の景色（3D 視界）', target: '#view', text: '上半分が操縦席からの眺めです。<b>ドラッグ</b>で見回し、<b>ホイール</b>でズーム、<b>ダブルクリック</b>で正面に戻ります。<br>キーボードの <b>1〜5</b> で視点（操縦席・機体の後ろ・主翼・フライバイ・タワー）を切り替えられます。' },
      { title: 'PFD（主計器）', target: '#pfd', text: '最も大切な計器です。<br>・<b>左の縦帯</b>: 速度（ノット）<br>・<b>中央</b>: 姿勢（青=空、茶=地面）<br>・<b>右の縦帯</b>: 高度（フィート）<br>・<b>下の円弧</b>: 機首の方位<br>・<b>最上段</b>: 自動操縦のモード（緑の文字）' },
      { title: 'ND（ナビゲーション表示）', target: '#nd', text: '上空から見た地図です。<b>マゼンタの線</b>が飛ぶ予定の経路、☆がその通過点です。空港は水色の丸で表示されます。<br>左上は対地速度と風、右上は次の通過点までの距離です。' },
      { title: 'EICAS（エンジンと警報）', target: '#eicas', text: '左の丸いメーターがエンジンの回転（N1）と排気温度です。<br>右上には警報が出ます（<span style="color:#ff4a3a">赤=警告</span>、<span style="color:#ffb000">黄=注意</span>、白=メモ）。下はギア・フラップ・燃料です。' },
      { title: 'MCP（自動操縦の操作盤）', target: '#mcp', text: '速度・方位・高度を設定して自動操縦に伝える操作盤です。数字の窓は<b>ホイールで回し、クリックで押し込み</b>ます。<br>左端の <b>A/P</b> がオートパイロットのボタンです。' },
      { title: 'スラストレバーとフラップ', target: '[data-tut=throttle]', text: '左の 2 本が<b>エンジン推力のレバー</b>（PageUp / PageDown）、右側にスピードブレーキと<b>フラップ</b>のレバーがあります。ドラッグでも動かせます。' },
      { title: 'その他のスイッチ', target: '#pedestal', text: 'ギア、オートブレーキ、パーキングブレーキ、燃料制御などがここにあります。<br><b>CDU</b> は飛行計画を入力する端末、<b>OVHD</b> は天井のスイッチ類、<b>CHKL</b> は手順チェックリストです。<br>操作キーの一覧はいつでも <b>F1</b> で表示できます。' },
      { title: '準備完了！', text: '次は<b>「はじめての離陸」</b>に進みましょう。<br>このまま自由に飛んでもかまいません（Esc でメニュー）。', final: true },
    ],
  },
  {
    id: 'takeoff', name: 'はじめての離陸', time: '約5分', level: '初級',
    desc: '羽田 34R から離陸し、ギアを上げてオートパイロットを入れるまで。',
    scenario: { start: 'runway', origin: 'RJTT', depRwy: '34R', dest: 'RJBB', arrRwy: '24L', timeOfDay: 10, weather: CALM },
    steps: [
      { title: '離陸の流れ', text: '①ブレーキ解除 → ②推力を少し上げる → ③離陸推力（TO/GA） → ④速度 VR で機首上げ → ⑤ギアアップ → ⑥オートパイロット、の順に進めます。<br>操作できると自動で次の手順に進みます。' },
      { title: '① パーキングブレーキを解除', target: '[data-tut=parking]', text: '<b>P キー</b>（またはボタン）でパーキングブレーキを解除します。', cond: s => !s.sys.parkingBrake },
      { title: '② 推力を約 40% に', target: '[data-tut=throttle]', text: '<b>PageUp（または + キー）</b>を少し押して、EICAS の N1 が <b>40%</b> 前後になるまで推力を上げます。左右のエンジンが安定するのを待つための手順です。', cond: s => s.engines[0].n1 > 36, live: s => `N1 ${s.engines[0].n1.toFixed(0)}%（目標 40%）` },
      { title: '③ TO/GA で離陸推力', target: '[data-tut=toga]', text: '<b>T キー</b>（または TO/GA ボタン）を押すと、オートスロットルが離陸推力まで自動で上げます。機体が走り始めます。<br>まっすぐ走らないときは <b>Z / X</b>（ラダー）で修正します。', cond: s => ['THR REF', 'HOLD'].includes(s.af.thr) || s.fdm.out.ias > 60 },
      { title: '加速中…', target: '#pfd', text: 'PFD 左の速度テープを見てください。緑の <b>V1</b>（離陸を中止できる限界）、<b>VR</b>（機首上げ速度）の印に近づいていきます。<br>VR の少し手前で次の指示が出ます。', cond: s => kt(s) >= (s.fmc.vr || 140) - 8, live: s => `速度 ${kt(s)} kt ／ VR ${s.fmc.vr} kt` },
      { title: '④ ローテーション（機首上げ）', target: '#pfd', text: '<b>↓キーを押し続けて</b>機首をゆっくり上げます。PFD のピッチ目盛で <b>10〜15°</b> を目指し、届いたらキーを離します。<br>上げすぎると尾部を擦ります（約 9° 以上で地上にいるとき）。', cond: s => !s.onGround && s.raFt > 30, live: s => `速度 ${kt(s)} kt ／ ピッチ ${s.fdm.out.pitch.toFixed(1)}°${kt(s) >= s.fmc.vr ? '　← 今です！ ↓キー' : ''}`, enter: (s, c) => c.slow(0.5), leave: (s, c) => c.slow(1) },
      { title: '浮きました！', target: '#pfd', text: '姿勢を <b>12〜15°</b> 付近に保ちます。PFD の<b>マゼンタの十字（フライトディレクター）</b>が、中央の機体マークに重なるように↑↓で合わせると、適切な上昇になります。', cond: s => s.raFt > 120 && s.vsFpm > 300, live: s => `高度 ${Math.round(s.raFt)} ft ／ 昇降率 ${Math.round(s.vsFpm)} fpm` },
      { title: '⑤ ギアアップ', target: '[data-tut=gear]', text: '上昇していることを確認したら <b>G キー</b>で脚を格納します（実機の呼称は「ポジティブレート、ギアアップ」）。', cond: s => s.sys.gearLever === 'UP' },
      { title: '⑥ オートパイロット ON', target: '[data-tut=mcp-ap]', text: '電波高度 <b>200 ft</b> を超えたら <b>A キー</b>（または MCP の A/P ボタン）でオートパイロットを入れます。<br>以後は FMC の経路（LNAV）と高度計画（VNAV）に沿って自動で飛びます。', cond: s => s.af.ap, live: s => `電波高度 ${Math.round(s.raFt)} ft${s.raFt < 200 ? '（200 ft 以上で入ります）' : ''}` },
      { title: 'フラップを格納', target: '[data-tut=flaps]', text: '速度が上がると PFD 速度テープに緑の <b>「5」「1」「UP」</b> の印が出ます。速度が印を超えるたびに <b>Shift+F</b> でフラップを 1 段ずつ上げ、UP にします。', cond: s => s.sys.flapLever === 0, live: s => `フラップ ${flapName(s)} ／ 速度 ${kt(s)} kt` },
      { title: '離陸成功！', text: 'おめでとうございます。あとはオートパイロットが関西空港まで飛びます（Space で一時停止、×2〜×8 で早送り）。<br>次は<b>「自動操縦の使い方」</b>か<b>「ILS 自動着陸」</b>に挑戦しましょう。', final: true },
    ],
  },
  {
    id: 'autopilot', name: '自動操縦の使い方', time: '約5分', level: '初級',
    desc: '巡航中に方位・高度を MCP で変更し、経路飛行（LNAV）に戻すまで。',
    scenario: { start: 'cruise', origin: 'RJTT', depRwy: '34R', dest: 'RJFF', arrRwy: '34R', timeOfDay: 14, weather: CALM },
    steps: [
      { title: '巡航中です', target: '#pfd', text: '高度 39,000 ft を自動操縦で飛行中です。PFD 最上段のモード表示は「SPD ｜ LNAV ｜ VNAV PTH」＝速度・経路・高度をすべて FMC の計画どおりに制御している状態です。', pause: true },
      { title: '方位を 30° 右へ設定', target: '[data-tut=mcp-win-hdg]', text: 'MCP の <b>HDG（方位）窓</b>にマウスを乗せてホイールを回すか <b>＋</b> を押し、表示を<b>今より 30° 大きく</b>します（Shift を押しながらだと 10° ずつ）。', cond: (s, c) => Math.abs(wrap180(s.af.mcp.hdg - c.data.hdg0 - 30)) < 6, enter: (s, c) => { c.data.hdg0 = Math.round(s.hdgMag); }, live: (s, c) => `設定 ${s.af.mcp.hdg}° ／ 目標 ${Math.round((c.data.hdg0 + 30) % 360) || 360}°` },
      { title: 'HDG SEL を押す', target: '[data-tut=mcp-hdgsel]', text: 'MCP の <b>SEL</b> ボタン（または Ctrl+H）を押すと、設定した方位へ旋回します。PFD のモードが <b>HDG SEL</b> に変わります。', cond: s => s.af.lat.active === 'HDG SEL' },
      { title: '旋回を見守る', target: '#nd', text: 'ND のマゼンタの点線が設定方位です。機体は最大 25° 傾けて旋回し、方位がそろうと水平に戻ります。', cond: s => Math.abs(wrap180(s.hdgMag - s.af.mcp.hdg)) < 3, live: s => `現在 ${Math.round(s.hdgMag)}° → 設定 ${s.af.mcp.hdg}°` },
      { title: '経路（LNAV）に戻る', target: '[data-tut=mcp-lnav]', text: '<b>LNAV</b> ボタン（Ctrl+L）を押すと、FMC の経路に戻ります。経路から離れているときは「LNAV」が白字（待機）になり、経路に近づくと緑字（作動）に変わります。', cond: s => s.af.lat.active === 'LNAV' || s.af.lat.armed === 'LNAV' },
      { title: '高度を 2,000 ft 下げる', target: '[data-tut=mcp-win-alt]', text: '<b>ALT（高度）窓</b>を <b>37000</b> にします（Shift+ホイールで 1,000 ft ずつ）。', cond: s => s.af.mcp.alt <= 37000 && s.af.mcp.alt >= 36500, live: s => `設定 ${s.af.mcp.alt} ft` },
      { title: 'V/S で降下', target: '[data-tut=mcp-vsbtn]', text: '<b>V/S</b> ボタンを押し、<b>V/S 窓</b>を <b>−1000</b>（毎分 1,000 ft 降下）にします。', cond: s => s.af.vert.active === 'V/S' && s.af.mcp.vs <= -500, live: s => `モード ${s.af.vert.active} ／ V/S ${s.af.mcp.vs}` },
      { title: '高度捕捉', target: '#pfd', text: '設定高度に近づくと自動で水平飛行に移り、モードが <b>ALT</b> に変わります。速度はオートスロットル（SPD）が保ちます。', cond: s => s.af.vert.active === 'ALT' && Math.abs(s.altFt - s.af.mcp.alt) < 150, live: s => `高度 ${Math.round(s.altFt)} ft → ${s.af.mcp.alt} ft` },
      { title: '自動操縦の基本はここまで', text: 'MCP は「窓で値を設定 → ボタンでモードを選ぶ」の 2 段階です。VNAV ボタンを押すと高度管理を FMC に戻せます。<br>次は<b>「ILS 自動着陸」</b>へどうぞ。', final: true },
    ],
  },
  {
    id: 'autoland', name: 'ILS 自動着陸', time: '約4分', level: '初級',
    desc: '羽田 34R への最終進入から、自動着陸・逆推力・停止まで。',
    scenario: { start: 'final10', origin: 'RJTT', depRwy: '34R', dest: 'RJTT', arrRwy: '34R', timeOfDay: 16, weather: CALM },
    steps: [
      { title: '最終進入中です', target: '#pfd', text: '滑走路まで約 10 NM（18 km）。オートパイロットが ILS（滑走路から出る誘導電波）に乗って降下しています。<br>モード表示 <b>LOC</b>＝左右の誘導、<b>G/S</b>＝降下角の誘導です。', pause: true },
      { title: 'ILS の菱形', target: '#pfd', text: 'PFD の下と右にある<b>マゼンタの菱形</b>が、誘導路からのずれです。両方とも中央にあれば正しいコースです。', pause: true },
      { title: '着陸の準備', target: '[data-tut=autobrake]', text: 'オートブレーキは <b>3</b>、スピードブレーキは <b>ARMED</b>（接地で自動展開）、ギアとフラップ 30 も設定済みです。<br>高度 1,500 ft 以下で表示が <b>LAND 3</b> になると自動着陸の準備完了です。', cond: s => s.af.land3, live: s => `電波高度 ${Math.round(s.raFt)} ft ／ ${s.af.status}` },
      { title: '高度コールアウト', target: '#pfd', text: '「FIVE HUNDRED」「MINIMUMS」「FIFTY, FORTY…」と自動音声が高度を読み上げます。50 ft 付近で機首を少し上げて降下を緩めます（<b>FLARE</b>）。', cond: s => s.landedRoll, live: s => `電波高度 ${Math.round(s.raFt)} ft ／ ${s.af.vert.active}` },
      { title: '接地！ 逆推力', target: '[data-tut=reverse]', text: 'スポイラーが立ち、オートブレーキが効き始めました。<b>R キーを押し続けて</b>逆推力をかけます。', cond: s => s.engines.some(e => e.revLever > 0.5) || s.fdm.out.gs / KT < 60, live: s => `対地速度 ${Math.round(s.fdm.out.gs / KT)} kt` },
      { title: '60 kt でリバースを戻す', target: '#pfd', text: '速度が 60 kt を下回ったら <b>R キーを離します</b>。オートブレーキが停止まで減速します。', cond: s => s.fdm.out.gs / KT < 25, live: s => `対地速度 ${Math.round(s.fdm.out.gs / KT)} kt` },
      { title: 'オートパイロット解除', target: '[data-tut=mcp-ap]', text: '<b>A キー</b>でオートパイロットを解除します（警報音は M キーで止められます）。', cond: s => !s.af.ap },
      { title: '着陸成功！', text: '着陸評価が表示されます。次は<b>「手動で着陸」</b>に挑戦しましょう。', final: true },
    ],
  },
  {
    id: 'manual', name: '手動で着陸', time: '約3分', level: '中級',
    desc: '5 NM から自分の操縦で着陸。速度はオートスロットルが保ちます。',
    scenario: { start: 'final5', origin: 'RJTT', depRwy: '34R', dest: 'RJTT', arrRwy: '34R', timeOfDay: 9, weather: CALM },
    steps: [
      { title: '手動着陸に挑戦', target: '#pfd', text: '滑走路まで 5 NM、オートパイロットは OFF です。速度はオートスロットルが保つので、<b>姿勢と方向</b>だけに集中しましょう。', pause: true },
      { title: '菱形を中央に', target: '#pfd', text: 'PFD 右の菱形（降下角）が<b>上</b>にずれたら高すぎ → ↑で少し機首下げ。下なら↓で少し上げます。<br>下の菱形（左右）がずれたら、その方向へ ← → で少しだけ傾けて戻します。<b>小さく、ゆっくり</b>が上達のコツです。', cond: s => s.raFt < 500, live: s => s.ilsDev ? `左右 ${s.ilsDev.locDots > 0.2 ? '→ 右へ' : s.ilsDev.locDots < -0.2 ? '← 左へ' : 'OK'} ／ 上下 ${s.ilsDev.gsDots > 0.2 ? '↑ 低い' : s.ilsDev.gsDots < -0.2 ? '↓ 高い' : 'OK'} ／ 電波高度 ${Math.round(s.raFt)} ft` : '' },
      { title: '滑走路を見ながら', target: '#view', text: '外の滑走路の手前の白い縞（進入端）の少し先を目標に。左の <b>PAPI</b>（4 つのランプ）が<b>白 2・赤 2</b> なら正しい降下角です。', cond: s => s.raFt < 60, live: s => `電波高度 ${Math.round(s.raFt)} ft`, enter: (s, c) => c.slow(0.7) },
      { title: 'フレア！', target: '#pfd', text: '<b>↓キーで少しだけ</b>機首を上げ、降下を緩めます。同時に <b>I キー</b>で推力をアイドルに。滑走路にそっと置くイメージです。', cond: s => s.landedRoll, live: s => `電波高度 ${Math.round(s.raFt)} ft ／ 降下率 ${Math.round(-s.vsFpm)} fpm`, leave: (s, c) => c.slow(1) },
      { title: '接地後', target: '[data-tut=reverse]', text: '↑で前脚をゆっくり下ろし、<b>R キー</b>で逆推力、<b>B キー</b>でブレーキ。<b>Z / X</b> で中心線を保ちます。', cond: s => s.fdm.out.gs / KT < 20, live: s => `対地速度 ${Math.round(s.fdm.out.gs / KT)} kt` },
      { title: 'お見事！', text: '着陸評価を確認しましょう。うまくいかなくても大丈夫です。メニューの「最終進入 5NM」で何度でも練習できます。', final: true },
    ],
  },
];

function loadDone() { try { return new Set(JSON.parse(localStorage.getItem('b787sim.tutorial') || '[]')); } catch (e) { return new Set(); } }
function saveDone(set) { try { localStorage.setItem('b787sim.tutorial', JSON.stringify([...set])); } catch (e) { /* 保存できなくても続行 */ } }

export class Tutorial {
  constructor(root, getSim, hooks) {
    this.root = root; this.getSim = getSim; this.hooks = hooks;
    this.lesson = null; this.i = 0; this.doneAt = null; this.hl = null; this.data = {};
    this.done = loadDone();
  }
  get active() { return !!this.lesson; }
  isDone(id) { return this.done.has(id); }

  async start(id) {
    const L = LESSONS.find(l => l.id === id);
    if (!L) return;
    this.stop();
    await this.hooks.startFlight(L.scenario);
    this.lesson = L; this.i = 0; this.data = {};
    this.enterStep();
  }

  stop() {
    if (this.lesson) { const st = this.step; if (st && st.leave) st.leave(this.getSim(), this); }
    this.lesson = null;
    this.highlight(null);
    this.root.hidden = true;
    this.slow(1);
  }

  get step() { return this.lesson && this.lesson.steps[this.i]; }
  slow(rate) { const s = this.getSim(); if (s) s.simRate = rate; }

  enterStep() {
    const s = this.getSim(), st = this.step;
    this.doneAt = null;
    if (st.enter) st.enter(s, this);
    if (st.pause) this.hooks.pause(true);
    if (st.final) { this.done.add(this.lesson.id); saveDone(this.done); this.hooks.sound && this.hooks.sound('chime'); }
    this.highlight(st.target);
    this.render();
  }

  go(d) {
    const s = this.getSim(), st = this.step;
    if (st.leave) st.leave(s, this);
    if (st.pause) this.hooks.pause(false);
    const n = this.i + d;
    if (n < 0) return;
    if (n >= this.lesson.steps.length) { this.stop(); return; }
    this.i = n;
    this.enterStep();
  }

  highlight(target) {
    if (this.hl) this.hl.classList.remove('tut-hl');
    this.hl = null;
    if (!target) return;
    const el = document.querySelector(target.startsWith('#') || target.startsWith('[') ? target : `[data-tut="${target}"]`);
    if (el) { el.classList.add('tut-hl'); this.hl = el; }
  }

  render() {
    const L = this.lesson, st = this.step;
    if (!L) return;
    const n = L.steps.length;
    this.root.hidden = false;
    const auto = !!st.cond;
    this.root.innerHTML = `
      <div class="tut-head"><span class="tut-lesson">チュートリアル｜${L.name}</span><button class="tut-x" id="tut-close" title="チュートリアルを終了">×</button></div>
      <div class="tut-progress"><div style="width:${((this.i + 1) / n) * 100}%"></div></div>
      <div class="tut-step">手順 ${this.i + 1} / ${n}</div>
      <h3 class="tut-title">${st.title}</h3>
      <div class="tut-text">${st.text}</div>
      <div class="tut-live" id="tut-live"></div>
      <div class="tut-actions">
        <button class="btn" id="tut-prev" ${this.i === 0 ? 'disabled' : ''}>戻る</button>
        ${st.final ? '<button class="btn primary" id="tut-menu">レッスン一覧へ</button><button class="btn" id="tut-end">このまま飛ぶ</button>'
          : auto ? '<span class="tut-wait" id="tut-wait">操作すると自動で進みます</span><button class="btn" id="tut-skip">スキップ</button>'
            : '<button class="btn primary" id="tut-next">次へ</button>'}
      </div>`;
    const $ = id => this.root.querySelector('#' + id);
    $('tut-close').onclick = () => this.stop();
    if ($('tut-prev')) $('tut-prev').onclick = () => this.go(-1);
    if ($('tut-next')) $('tut-next').onclick = () => this.go(1);
    if ($('tut-skip')) $('tut-skip').onclick = () => this.go(1);
    if ($('tut-end')) $('tut-end').onclick = () => this.stop();
    if ($('tut-menu')) $('tut-menu').onclick = () => { this.stop(); this.hooks.openMenu(); };
    this.updateLive();
  }

  updateLive() {
    const st = this.step, s = this.getSim();
    const el = this.root.querySelector('#tut-live');
    if (!el) return;
    let t = '';
    try { t = st.live ? st.live(s, this) : ''; } catch (e) { t = ''; }
    el.textContent = t;
    el.hidden = !t;
  }

  /** メインループから約 10Hz で呼ぶ */
  update(now) {
    if (!this.lesson) return;
    const s = this.getSim(), st = this.step;
    if (s.crashed) return;
    this.updateLive();
    if (!st.cond || this.doneAt != null) {
      if (this.doneAt != null && now - this.doneAt > 1.2) this.go(1);
      return;
    }
    let ok = false;
    try { ok = st.cond(s, this); } catch (e) { ok = false; }
    if (ok) {
      this.doneAt = now;
      this.hooks.sound && this.hooks.sound('chime');
      const w = this.root.querySelector('#tut-wait');
      if (w) { w.textContent = '✔ できました！'; w.classList.add('ok'); }
    }
  }
}
