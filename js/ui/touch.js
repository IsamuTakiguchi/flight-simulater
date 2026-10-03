// スマートフォン用タッチ操作 UI（画面全体を外部視界にし、必要な操作をボタンで重ねて表示）
import { clamp } from '../util/math.js';
import { B789 } from '../sim/aircraft-787.js';

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

export class TouchUI {
  /**
   * root: #view, press(code, {shiftKey}): キー操作と同じ処理を呼ぶ関数, input: Input
   */
  constructor(root, getSim, press, input, actions) {
    this.root = root; this.getSim = getSim; this.press = press; this.input = input; this.actions = actions;
    this.btn = {};
    this.build();
  }

  button(parent, id, label, fn, { hold = false, tut = null, cls = '' } = {}) {
    const b = el('button', 'tb-btn ' + cls, label);
    if (tut) b.dataset.tut = tut;
    if (hold) {
      const up = () => { b.classList.remove('down'); fn(false); };
      b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add('down'); fn(true); });
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    } else {
      b.addEventListener('click', e => { e.preventDefault(); fn(); });
    }
    parent.appendChild(b);
    this.btn[id] = b;
    return b;
  }

  build() {
    const s = () => this.getSim();
    const wrap = this.wrap = el('div', 'touch-ui');
    // ---- 上段: システム／自動飛行 ----
    const top = el('div', 'tb-top');
    const left = el('div', 'tb-group'), right = el('div', 'tb-group');
    this.button(left, 'menu', 'メニュー', () => this.press('Escape'));
    this.button(left, 'pause', '⏸', () => this.press('Space'));
    this.button(left, 'view', '視点', () => this.press('KeyV'));
    this.button(left, 'inst', '計器', () => this.actions.toggleInst());
    this.button(left, 'mcp', 'MCP', () => this.actions.toggleMcp(), { tut: 'mcp-toggle' });
    this.button(left, 'more', '…', () => this.actions.toggleMore());
    this.button(right, 'ap', 'A/P', () => this.press('KeyA'), { tut: 'mcp-ap' });
    this.button(right, 'at', 'A/T', () => this.press('KeyA', { shiftKey: true }));
    this.button(right, 'toga', 'TO/GA', () => this.press('KeyT'), { tut: 'toga' });
    top.append(left, right);
    this.top = top; this.apGroup = right;
    // ---- 追加メニュー（CDU など）----
    const more = this.more = el('div', 'tb-more');
    more.hidden = true;
    for (const [label, code] of [['CDU', 'KeyC'], ['オーバーヘッド', 'KeyO'], ['チェックリスト', 'KeyK'], ['HUD', 'KeyU'], ['警報リセット', 'KeyM'], ['ヘルプ', 'F1']]) {
      this.button(more, 'm-' + code, label, () => { this.press(code); more.hidden = true; });
    }
    // ---- 下段: 形態 ----
    const bot = el('div', 'tb-bottom');
    this.button(bot, 'gear', 'ギア', () => this.press('KeyG'), { tut: 'gear' });
    const flaps = el('div', 'tb-flaps');
    flaps.dataset.tut = 'flaps';
    this.button(flaps, 'flapUp', 'F−', () => this.press('KeyF', { shiftKey: true }));
    this.flapLabel = el('span', 'tb-flap-val', 'UP');
    flaps.appendChild(this.flapLabel);
    this.button(flaps, 'flapDn', 'F＋', () => this.press('KeyF'));
    bot.appendChild(flaps);
    this.button(bot, 'sb', 'SPD BRK', () => this.press('Slash'));
    this.button(bot, 'pb', 'P.BRAKE', () => this.press('KeyP'), { tut: 'parking' });
    // ---- 右: スラストレバー・リバース・ブレーキ ----
    const rt = el('div', 'tb-right');
    const thr = this.thr = el('div', 'tb-thr');
    thr.dataset.tut = 'throttle';
    this.thrHandle = el('div', 'tb-thr-handle');
    this.thrText = el('div', 'tb-thr-text', 'N1');
    thr.append(this.thrHandle, this.thrText);
    const setFromY = (y) => {
      const r = thr.getBoundingClientRect();
      const v = clamp(1 - (y - r.top - 14) / (r.height - 28), 0, 1);
      s().setThrottle(v < 0.03 ? 0 : v);
    };
    thr.addEventListener('pointerdown', e => { e.preventDefault(); thr.setPointerCapture(e.pointerId); this.dragging = true; setFromY(e.clientY); });
    thr.addEventListener('pointermove', e => { if (this.dragging) setFromY(e.clientY); });
    const end = () => { this.dragging = false; };
    thr.addEventListener('pointerup', end); thr.addEventListener('pointercancel', end);
    const rb = el('div', 'tb-group col');
    this.button(rb, 'rev', 'REV', down => s().setReverse(down ? 1 : 0), { hold: true, tut: 'reverse' });
    this.button(rb, 'brk', 'BRAKE', down => { this.input.touchBrake = down; }, { hold: true });
    rt.append(thr, rb);
    this.rt = rt;

    wrap.append(top, more, bot, rt);
    // 横向き推奨の案内（縦画面のみ）
    this.rotate = el('div', 'tb-rotate', '📱↻ 横向きにすると、景色を広く見ながら操縦できます <button class="tb-btn" id="tb-rot-x">OK</button>');
    wrap.appendChild(this.rotate);
    this.rotate.querySelector('#tb-rot-x').onclick = () => { this.rotate.hidden = true; };
    setTimeout(() => { this.rotate.hidden = true; }, 9000);
    this.root.appendChild(wrap);
  }

  /** 縦画面では A/P・A/T・TO/GA を右列（推力レバーの上）へ移し、上段を 1 行に収める */
  setPortrait(p) {
    if (p) { this.apGroup.classList.add('col'); this.rt.prepend(this.apGroup); }
    else { this.apGroup.classList.remove('col'); this.top.appendChild(this.apGroup); }
  }

  update() {
    const s = this.getSim();
    if (!s) return;
    const on = (id, v) => this.btn[id] && this.btn[id].classList.toggle('on', !!v);
    on('ap', s.af.ap); on('at', s.af.at); on('pb', s.sys.parkingBrake);
    on('sb', s.sys.speedbrakeArmed || s.sys.speedbrakeLever > 0.05);
    on('gear', s.sys.gearLever === 'DN');
    on('pause', s.paused);
    this.btn.gear.textContent = s.sys.gearLever === 'DN' ? 'ギア DN' : 'ギア UP';
    this.btn.sb.textContent = s.sys.speedbrakeArmed ? 'SPD BRK ARM' : s.sys.speedbrakeLever > 0.05 ? 'SPD BRK UP' : 'SPD BRK';
    this.btn.pb.textContent = s.sys.parkingBrake ? 'P.BRAKE ON' : 'P.BRAKE OFF';
    const moving = Math.abs(s.fdm.flapPos - s.sys.flapLever) > 0.02;
    this.flapLabel.textContent = 'FLAP ' + B789.flaps[s.sys.flapLever].name + (moving ? '…' : '');
    const e = s.engines[0];
    const v = clamp(e.lever, 0, 1);
    this.thrHandle.style.bottom = `calc(${v * 100}% - ${v * 28}px)`;
    this.thrText.textContent = (e.revLever > 0.05 ? 'REV ' : 'N1 ') + e.n1.toFixed(0) + '%';
  }
}
