// 手順チェックリスト（自動で完了判定）と操作ヘルプ
import { KT, FT } from '../util/math.js';
import { B789 } from '../sim/aircraft-787.js';

const flapName = s => B789.flaps[s.sys.flapLever].name;

export const CHECKLISTS = [
  {
    id: 'start', name: 'エンジン始動', note: 'コールド＆ダークから始動する手順です。787 はブリードレス機のため、APU 発電機の電力でエンジンを電動始動します。',
    items: [
      ['BATTERY', 'ON（OVHD）', s => s.sys.battery],
      ['APU', 'START → RUNNING 待ち', s => s.sys.apuRunning],
      ['FUEL PUMPS', 'L / CTR / R ON', s => s.sys.fuelPumps.L && s.sys.fuelPumps.R],
      ['BEACON', 'ON', s => s.sys.lights.beacon],
      ['R ENG START', 'START → FUEL CONTROL R RUN', s => s.engines[1].running],
      ['L ENG START', 'START → FUEL CONTROL L RUN', s => s.engines[0].running],
      ['APU', 'OFF', s => !s.sys.apuRunning],
    ],
  },
  {
    id: 'before-to', name: '離陸前', note: 'CDU の TAKEOFF ページで V スピードとトリムを確認します。',
    items: [
      ['FLAPS', '5 / 15 / 17 / 18 / 20（F キー）', s => B789.takeoffFlaps.map(String).includes(flapName(s)) && Math.abs(s.fdm.flapPos - s.sys.flapLever) < 0.02],
      ['STAB TRIM', 'グリーンバンド内（CDU TAKEOFF → SET TRIM）', s => s.trimUnits >= 2.5 && s.trimUnits <= 8.5],
      ['AUTOBRAKE', 'RTO', s => s.sys.autobrake === 'RTO'],
      ['F/D', 'ON', s => s.af.fd],
      ['A/T ARM', 'ARM', s => s.af.atArm],
      ['LNAV / VNAV', 'ARM（MCP）', s => s.af.lat.armed === 'LNAV' || s.af.lat.active === 'LNAV'],
      ['MCP ALT', '初期上昇高度を設定', s => s.af.mcp.alt > s.altFt + 1000],
      ['LANDING / STROBE', 'ON', s => s.sys.lights.landing && s.sys.lights.strobe],
      ['PARKING BRAKE', 'RELEASE（P キー）', s => !s.sys.parkingBrake],
    ],
  },
  {
    id: 'takeoff', name: '離陸・上昇', note: '推力を 40% 程度で安定させてから TO/GA。VR で毎秒約 2.5° の割合で 15° までローテーションし、FD に従います。',
    items: [
      ['THRUST', '40% で安定 → TO/GA（T キー）', s => s.af.thr === 'THR REF' || s.af.thr === 'HOLD' || !s.onGround],
      ['80 KT', 'A/T HOLD を確認', s => s.fdm.out.ias > 80 || !s.onGround],
      ['V1 / VR', 'ローテーション（↓キー）', s => !s.onGround],
      ['POSITIVE RATE', 'GEAR UP（G キー）', s => s.sys.gearLever === 'UP'],
      ['A/P', '200 ft 以上で ENGAGE（A キー）', s => s.af.ap],
      ['FLAPS', '速度バグに合わせ順次 UP', s => s.sys.flapLever === 0 && !s.onGround],
      ['10,000 FT', '着陸灯 OFF・250kt 以上へ加速', s => s.altFt > 10000],
    ],
  },
  {
    id: 'approach', name: '降下・進入', note: 'CDU の APPROACH REF で VREF を確認。ILS は FMC が自動で同調します。',
    items: [
      ['MCP ALT', '降下許可高度（T/D 前に設定）', s => s.af.mcp.alt < s.fmc.crzAltFt - 1000],
      ['VREF', 'CDU APPR で FLAPS 25/30 選択', s => !!s.fmc.vref],
      ['AUTOBRAKE', '1〜4（通常 2〜3）', s => ['1', '2', '3', '4', 'MAX AUTO'].includes(s.sys.autobrake)],
      ['APP', 'ARM（LOC / G/S）', s => s.af.vert.armed === 'G/S' || s.af.vert.active === 'G/S' || s.af.vert.active === 'FLARE'],
      ['FLAPS', '1 → 5 → 15 → 20 → 25/30', s => s.sys.flapLever >= 7],
      ['GEAR', 'DOWN（G キー）', s => s.sys.gearLever === 'DN' && s.fdm.gearPos > 0.99],
      ['SPEEDBRAKE', 'ARMED（/ キー）', s => s.sys.speedbrakeArmed || s.fdm.groundSpoiler > 0.5],
      ['SPEED', 'VREF + 5', s => s.af.mcp.spd <= (s.fmc.vref || 150) + 10],
    ],
  },
  {
    id: 'landing', name: '着陸', note: '手動着陸では 30〜50 ft でフレア開始（ピッチ +2〜3°）、推力アイドル。接地後リバース、60kt でリバースアイドル。',
    items: [
      ['FLARE', '30〜50 ft でピッチアップ', s => s.landedRoll],
      ['THRUST', 'IDLE（I キー）', s => s.engines.every(e => e.lever < 0.05)],
      ['SPOILERS', '自動展開を確認', s => s.fdm.groundSpoiler > 0.5],
      ['REVERSE', 'R 長押し', s => s.engines.some(e => e.revLever > 0.5) || (s.landedRoll && s.fdm.out.gs / KT < 60)],
      ['60 KT', 'リバースアイドル', s => s.landedRoll && s.fdm.out.gs / KT < 60],
      ['A/P', 'DISCONNECT', s => !s.af.ap && s.landedRoll],
    ],
  },
];

export const HELP_HTML = `
<p>ボーイング 787-9 の操縦系統（フライ・バイ・ワイヤ C*U 則、オートフライト、FMC、EICAS、GPWS）を再現したシミュレーターです。
地形と航空写真は国土地理院のタイル、空港・滑走路・VOR は OurAirports の実データを使用しています。</p>
<h3>操縦</h3>
<table>
<tr><td>↑ / ↓</td><td>機首下げ / 機首上げ（操縦桿 押す / 引く）</td></tr>
<tr><td>← / →</td><td>左右ロール（787 はロールレート指令・バンク保持）</td></tr>
<tr><td>Z / X</td><td>ラダー左 / 右（低速時は前輪ステアリング）</td></tr>
<tr><td>PageUp / PageDown（+ / −）</td><td>スラストレバー 前進 / 後退</td></tr>
<tr><td>I / F4</td><td>推力アイドル / フル</td></tr>
<tr><td>R（長押し）</td><td>逆推力（接地後・レバーアイドル時）</td></tr>
<tr><td>Home / End</td><td>ピッチトリム 機首下げ / 機首上げ（C*U トリム基準速度を変更）</td></tr>
<tr><td>F / Shift+F</td><td>フラップ 1 段下げ / 1 段上げ</td></tr>
<tr><td>G</td><td>ギア UP / DOWN</td></tr>
<tr><td>B（長押し）, ＜ ＞</td><td>ブレーキ（両方 / 左 / 右）</td></tr>
<tr><td>P</td><td>パーキングブレーキ</td></tr>
<tr><td>/ , Shift+/</td><td>スピードブレーキ（DOWN → ARM → FLT DETENT 切替 / 全開）</td></tr>
</table>
<h3>自動飛行</h3>
<table>
<tr><td>A</td><td>オートパイロット ENGAGE / DISCONNECT</td></tr>
<tr><td>Shift+A</td><td>オートスロットル A/T ENGAGE / DISCONNECT</td></tr>
<tr><td>T</td><td>TO/GA（離陸推力・ゴーアラウンド）</td></tr>
<tr><td>Ctrl+H / Ctrl+L / Ctrl+V / Ctrl+F</td><td>HDG SEL / LNAV / VNAV / FLCH</td></tr>
<tr><td>Ctrl+P</td><td>APP（LOC + G/S アーム）</td></tr>
<tr><td>MCP</td><td>表示窓をホイール・ドラッグで設定、クリックでプッシュ（Shift で大きく変更）</td></tr>
</table>
<h3>表示・その他</h3>
<table>
<tr><td>1 / 2 / 3 / 4 / 5（V で順送り）</td><td>操縦席 / 追従 / 主翼 / フライバイ / タワー視点</td></tr>
<tr><td>マウスドラッグ・ホイール</td><td>視点の回転・ズーム</td></tr>
<tr><td>U</td><td>HUD 表示切替</td></tr>
<tr><td>Tab</td><td>計器パネル表示切替（全画面視界）</td></tr>
<tr><td>C / O / K</td><td>CDU / オーバーヘッド / チェックリスト</td></tr>
<tr><td>M</td><td>マスターコーション・ワーニングのリセット</td></tr>
<tr><td>Space</td><td>一時停止</td></tr>
<tr><td>Esc</td><td>メニュー</td></tr>
</table>
<h3>ゲームパッド・ジョイスティック</h3>
<p>標準ゲームパッド: 左スティック=操縦桿、右スティック横=ラダー、RT/LT=推力、LB/RB=トリム、A=ギア、X/Y=フラップ、B=ブレーキ。<br>
汎用ジョイスティック: 軸0/1=操縦桿、軸2=スロットル、軸3または5=ラダー。</p>
<h3>実機との違い（重要）</h3>
<p>空力・エンジン・システムは公開資料と物理モデルに基づく近似で、ボーイング社の正式データパッケージ（訓練用シミュレーター認定に使われる非公開データ）ではありません。
ILS 周波数・SID/STAR・計器進入方式は実データではなく、滑走路データから模擬生成しています。<strong>実際の航空機の操縦訓練には使用できません。</strong></p>`;

export class Checklist {
  constructor(root, getSim) {
    this.root = root; this.getSim = getSim; this.cur = 0;
    this.render();
  }
  render() {
    const sim = this.getSim();
    const cl = CHECKLISTS[this.cur];
    let h = '<div class="chk-tabs">' + CHECKLISTS.map((c, i) => `<button data-i="${i}" class="${i === this.cur ? 'on' : ''}">${c.name}</button>`).join('') + '</div>';
    h += `<div class="chk-note">${cl.note}</div>`;
    for (const [a, b, fn] of cl.items) {
      let done = false; try { done = sim && fn(sim); } catch (e) { done = false; }
      h += `<div class="chk-item ${done ? 'done' : ''}"><span>${done ? '✔ ' : '□ '}${a}</span><span class="act">${b}</span></div>`;
    }
    this.root.innerHTML = h;
    this.root.querySelectorAll('.chk-tabs button').forEach(b => b.onclick = () => { this.cur = +b.dataset.i; this.render(); });
  }
  update() { if (!this.root.closest('[hidden]') && (this._t = (this._t || 0) + 1) % 20 === 0) this.render(); }
}
