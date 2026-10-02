// 音響: エンジン音・風切り音・接地音・警報音（WebAudio 合成）と自動音声コールアウト（音声合成）
import { clamp } from '../util/math.js';

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.voice = null;
    this.speaking = false;
    this.queue = [];
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.7; this.master.connect(ctx.destination);
    // ホワイトノイズバッファ
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
    // エンジン（低域ランブル＋ファン音）
    this.eng = [0, 1].map(() => {
      const n = noise();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
      const g = ctx.createGain(); g.gain.value = 0;
      n.connect(bp); bp.connect(g); g.connect(this.master);
      const osc = ctx.createOscillator(); osc.type = 'sawtooth';
      const og = ctx.createGain(); og.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
      osc.connect(lp); lp.connect(og); og.connect(this.master); osc.start();
      const rum = noise();
      const rl = ctx.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 160;
      const rg = ctx.createGain(); rg.gain.value = 0;
      rum.connect(rl); rl.connect(rg); rg.connect(this.master);
      return { bp, g, osc, og, rg };
    });
    // 風切り音
    const wn = noise();
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.Q.value = 0.4;
    this.windG = ctx.createGain(); this.windG.gain.value = 0;
    wn.connect(this.windF); this.windF.connect(this.windG); this.windG.connect(this.master);
    // 転がり音
    const rn = noise();
    this.rollF = ctx.createBiquadFilter(); this.rollF.type = 'lowpass'; this.rollF.frequency.value = 300;
    this.rollG = ctx.createGain(); this.rollG.gain.value = 0;
    rn.connect(this.rollF); this.rollF.connect(this.rollG); this.rollG.connect(this.master);
    // スティックシェーカー
    const sk = noise();
    const skf = ctx.createBiquadFilter(); skf.type = 'lowpass'; skf.frequency.value = 120;
    this.shakeG = ctx.createGain(); this.shakeG.gain.value = 0;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 28; const lfoG = ctx.createGain(); lfoG.gain.value = 0;
    lfo.connect(lfoG.gain); lfo.start();
    sk.connect(skf); skf.connect(lfoG); lfoG.connect(this.shakeG); this.shakeG.connect(this.master);
    this.shakeLfoG = lfoG;
    // ギア/フラップ作動音
    const hn = noise();
    this.hydF = ctx.createBiquadFilter(); this.hydF.type = 'bandpass'; this.hydF.frequency.value = 420; this.hydF.Q.value = 3;
    this.hydG = ctx.createGain(); this.hydG.gain.value = 0;
    hn.connect(this.hydF); this.hydF.connect(this.hydG); this.hydG.connect(this.master);
    this.loops = {};
    this.pickVoice();
    if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = () => this.pickVoice();
  }

  pickVoice() {
    if (!window.speechSynthesis) return;
    const vs = window.speechSynthesis.getVoices();
    this.voice = vs.find(v => /en-US/i.test(v.lang) && /male|david|alex|daniel|fred/i.test(v.name)) || vs.find(v => /^en/i.test(v.lang)) || null;
  }

  click() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.value = 2200; g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.04);
  }

  tone(freq, dur, vol = 0.12, type = 'sine', when = 0) {
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.setValueAtTime(vol, t + dur - 0.03); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  play(name) {
    if (!this.ctx || !this.enabled) return;
    switch (name) {
      case 'caution': this.tone(1000, 0.18, 0.12); this.tone(1000, 0.18, 0.12, 'sine', 0.3); break;
      case 'chime': this.tone(880, 0.35, 0.1); this.tone(660, 0.5, 0.1, 'sine', 0.25); break;
      case 'siren': for (let i = 0; i < 6; i++) { this.tone(i % 2 ? 950 : 650, 0.25, 0.1, 'square', i * 0.25); } break;
      case 'wailer': for (let i = 0; i < 3; i++) { const t = this.ctx.currentTime + i * 0.6; const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(400, t); o.frequency.linearRampToValueAtTime(1100, t + 0.5); g.gain.setValueAtTime(0.07, t); g.gain.linearRampToValueAtTime(0, t + 0.58); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.6); } break;
      case 'clacker': for (let i = 0; i < 16; i++) this.tone(320, 0.04, 0.15, 'square', i * 0.125); break;
      case 'bell': for (let i = 0; i < 4; i++) this.tone(1400, 0.25, 0.08, 'triangle', i * 0.3); break;
      case 'touchdown': {
        const t = this.ctx.currentTime;
        const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
        const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
        const g = this.ctx.createGain(); g.gain.setValueAtTime(this._tdVol || 0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + 0.6);
        break;
      }
      default: break;
    }
  }

  say(text, priority = 1) {
    if (!this.enabled || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = 1.15; u.pitch = 0.85; u.volume = 1;
    if (this.voice) u.voice = this.voice;
    if (priority >= 4 || /^(FIFTY|FORTY|THIRTY|TWENTY|TEN)$/.test(text)) window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  silence() { if (window.speechSynthesis) window.speechSynthesis.cancel(); }

  update(sim, view, dt) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const on = this.enabled && !sim.paused ? 1 : 0;
    const inside = view === 'cockpit' ? 1 : 0;
    const t = this.ctx.currentTime;
    const o = sim.fdm.out;
    sim.engines.forEach((e, i) => {
      const E = this.eng[i];
      const n = clamp(e.n1 / 100, 0, 1.05);
      const vol = on * (e.n2 > 1 ? 0.05 + 0.45 * n * n : 0) * (inside ? 0.45 : 1);
      E.g.gain.setTargetAtTime(vol, t, 0.2);
      E.bp.frequency.setTargetAtTime(120 + n * (inside ? 700 : 1600), t, 0.2);
      E.osc.frequency.setTargetAtTime(40 + e.n1 * 26, t, 0.2);
      E.og.gain.setTargetAtTime(on * clamp(e.n1 / 100, 0, 1) * (inside ? 0.008 : 0.02), t, 0.2);
      E.rg.gain.setTargetAtTime(on * n * (inside ? 0.25 : 0.45), t, 0.2);
    });
    const tas = o.tas || 0;
    this.windG.gain.setTargetAtTime(on * clamp(tas / 260, 0, 1) * (inside ? 0.16 : 0.3) * (1 + Math.max(sim.fdm.speedbrake, sim.fdm.gearPos * 0.6)), t, 0.3);
    this.windF.frequency.setTargetAtTime(300 + tas * 6, t, 0.3);
    this.rollG.gain.setTargetAtTime(on * (sim.onGround ? clamp(o.gs / 60, 0, 1) * 0.5 : 0), t, 0.1);
    this.rollF.frequency.setTargetAtTime(120 + o.gs * 3, t, 0.2);
    const shake = on * (sim.fbw.stickShaker ? 0.6 : 0);
    this.shakeLfoG.gain.setTargetAtTime(shake, t, 0.05);
    this.shakeG.gain.setTargetAtTime(shake ? 1 : 0, t, 0.05);
    const hyd = (sim.fdm.gearPos > 0.01 && sim.fdm.gearPos < 0.99) || Math.abs(sim.fdm.flapPos - sim.sys.flapLever) > 0.01;
    this.hydG.gain.setTargetAtTime(on * (hyd ? 0.05 : 0) * (inside ? 1 : 0.5), t, 0.2);
  }
}
