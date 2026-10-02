// 入力: キーボード / ゲームパッド・ジョイスティック / マウス視点操作
import { clamp } from '../util/math.js';

export class Input {
  constructor() {
    this.keys = new Set();
    this.axes = { pitch: 0, roll: 0, yaw: 0 };
    this.gamepad = null;
    this.gpThrottle = null;
    this.handlers = {};
    this.mouseLook = null;
    window.addEventListener('keydown', e => this.onKey(e, true));
    window.addEventListener('keyup', e => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', e => { this.gamepad = e.gamepad.index; this.handlers.toast && this.handlers.toast(`ゲームパッド接続: ${e.gamepad.id}`); });
  }
  on(name, fn) { this.handlers[name] = fn; }

  /** タッチ端末用の画面上の操縦桿 */
  attachTouchYoke(parent) {
    this.touch = { pitch: 0, roll: 0 };
    const pad = document.createElement('div');
    pad.id = 'yoke';
    pad.innerHTML = '<div class="knob-dot"></div><span>YOKE</span>';
    parent.appendChild(pad);
    const dot = pad.querySelector('.knob-dot');
    const set = (e) => {
      const r = pad.getBoundingClientRect();
      const x = clamp((e.clientX - r.left) / r.width * 2 - 1, -1, 1);
      const y = clamp((e.clientY - r.top) / r.height * 2 - 1, -1, 1);
      this.touch.roll = x; this.touch.pitch = y;
      dot.style.left = (50 + x * 40) + '%'; dot.style.top = (50 + y * 40) + '%';
    };
    pad.addEventListener('pointerdown', e => { e.stopPropagation(); pad.setPointerCapture(e.pointerId); set(e); });
    pad.addEventListener('pointermove', e => { if (pad.hasPointerCapture(e.pointerId)) set(e); });
    const end = () => { this.touch.roll = 0; this.touch.pitch = 0; dot.style.left = dot.style.top = '50%'; };
    pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
  }

  onKey(e, down) {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    const k = e.code;
    if (down && this.handlers.capture && this.handlers.capture(e)) { e.preventDefault(); return; }
    if (down) {
      if (!this.keys.has(k) && this.handlers.press) {
        if (this.handlers.press(k, e)) e.preventDefault();
      }
      this.keys.add(k);
    } else this.keys.delete(k);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'PageUp', 'PageDown', 'Home', 'End', 'Tab', 'F1'].includes(k)) e.preventDefault();
  }

  has(k) { return this.keys.has(k); }

  /** 毎フレーム: 操縦入力を更新 */
  update(dt, sim) {
    const p = sim.pilot;
    // キーボード（なめらかに増減）
    const rate = 2.2, ret = 3.5;
    const kAxis = (cur, neg, pos, max = 1) => {
      const n = neg.some(k => this.keys.has(k)), q = pos.some(k => this.keys.has(k));
      if (n && !q) return Math.max(cur - rate * dt, -max);
      if (q && !n) return Math.min(cur + rate * dt, max);
      return Math.abs(cur) < ret * dt ? 0 : cur - Math.sign(cur) * ret * dt;
    };
    this.axes.pitch = kAxis(this.axes.pitch, ['ArrowUp', 'Numpad8'], ['ArrowDown', 'Numpad2'], 0.8);
    this.axes.roll = kAxis(this.axes.roll, ['ArrowLeft', 'Numpad4'], ['ArrowRight', 'Numpad6'], 0.8);
    this.axes.yaw = kAxis(this.axes.yaw, ['KeyZ', 'Numpad0'], ['KeyX', 'NumpadDecimal'], 1);
    let pitch = this.axes.pitch, roll = this.axes.roll, yaw = this.axes.yaw;
    if (this.touch) { pitch = clamp(pitch + this.touch.pitch * 0.9, -1, 1); roll = clamp(roll + this.touch.roll * 0.9, -1, 1); }
    let brakeL = 0, brakeR = 0;
    if (this.keys.has('KeyB')) brakeL = brakeR = 1;
    if (this.keys.has('Comma')) brakeL = 1;
    if (this.keys.has('Period')) brakeR = 1;
    // スロットル
    if (this.keys.has('PageUp') || this.keys.has('Equal') || this.keys.has('NumpadAdd') || this.keys.has('F3')) sim.moveThrottle(0.4 * dt);
    if (this.keys.has('PageDown') || this.keys.has('Minus') || this.keys.has('NumpadSubtract') || this.keys.has('F2')) sim.moveThrottle(-0.4 * dt);
    // リバース (R 長押し)
    if (this.keys.has('KeyR')) sim.setReverse(Math.min(1, (sim.engines[0].revLever || 0) + dt * 1.2));
    else if (this._revHeld) sim.setReverse(0);
    this._revHeld = this.keys.has('KeyR');
    // トリム
    let trim = 0;
    if (this.keys.has('Home') || this.keys.has('Numpad7')) trim = -1;
    if (this.keys.has('End') || this.keys.has('Numpad1')) trim = 1;
    if (p.trimBtn) trim = p.trimBtn;

    // ゲームパッド / ジョイスティック
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find(x => x && x.connected);
    if (gp) {
      const dz = v => (Math.abs(v) < 0.08 ? 0 : (v - Math.sign(v) * 0.08) / 0.92);
      const ax = gp.axes;
      if (gp.mapping === 'standard') {
        roll = clamp(roll + dz(ax[0]), -1, 1);
        pitch = clamp(pitch + dz(ax[1]), -1, 1);
        yaw = clamp(yaw + dz(ax[2] || 0), -1, 1);
        const b = gp.buttons;
        const rt = b[7] ? b[7].value : 0, lt = b[6] ? b[6].value : 0;
        if (rt > 0.05) sim.moveThrottle(0.5 * rt * dt);
        if (lt > 0.05) sim.moveThrottle(-0.5 * lt * dt);
        if (b[4] && b[4].pressed) trim = -1; if (b[5] && b[5].pressed) trim = 1;
        if (b[1] && b[1].pressed) brakeL = brakeR = 1;
        this.edge(gp, 0, () => sim.toggleGear());
        this.edge(gp, 3, () => sim.flapDown());
        this.edge(gp, 2, () => sim.flapUp());
        this.edge(gp, 12, () => this.handlers.press && this.handlers.press('KeyA', {}));
      } else {
        // 汎用ジョイスティック: 0=ロール 1=ピッチ 2=スロットル 3/5=ラダー
        roll = clamp(roll + dz(ax[0]), -1, 1);
        pitch = clamp(pitch + dz(ax[1]), -1, 1);
        if (ax.length > 2) {
          const thr = (1 - ax[2]) / 2;
          if (this.gpThrottle == null || Math.abs(thr - this.gpThrottle) > 0.01) { this.gpThrottle = thr; if (!sim.af.at || sim.af.thr === 'HOLD') sim.setThrottle(thr); }
        }
        if (ax.length > 5) yaw = clamp(yaw + dz(ax[5]), -1, 1); else if (ax.length > 3) yaw = clamp(yaw + dz(ax[3]), -1, 1);
        if (gp.buttons[0] && gp.buttons[0].pressed) brakeL = brakeR = 1;
        this.edge(gp, 1, () => sim.toggleGear());
      }
    }
    p.pitch = pitch; p.roll = roll; p.yaw = yaw;
    // キーボード操作時は低速でラダー入力をティラーにも使う
    p.tiller = sim.fdm.out.gs < 15 ? yaw : 0;
    p.brakeL = brakeL; p.brakeR = brakeR;
    p.trim = trim;
  }

  edge(gp, i, fn) {
    this._prev = this._prev || {};
    const b = gp.buttons[i];
    const v = !!(b && b.pressed);
    if (v && !this._prev[i]) fn();
    this._prev[i] = v;
  }
}
