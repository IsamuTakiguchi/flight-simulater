// キャンバス描画の共通ヘルパー（1000×1000 の論理座標で描画）
export const C = {
  white: '#ffffff', green: '#3cff5a', magenta: '#ff46ff', cyan: '#2ee6ff', amber: '#ffb000', red: '#ff2a1a',
  gray: '#5c6670', dgray: '#2a3038', sky: '#2c72c6', ground: '#7a4a24', black: '#000', tape: '#4a525c',
};
export const FONT = '"B612 Mono", "DejaVu Sans Mono", Consolas, Menlo, monospace';

export class Display {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = 0;
  }
  begin() {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (!w || !h) return null;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const s = Math.min(w, h) / 1000;
    g.setTransform(s, 0, 0, s, (w - 1000 * s) / 2, (h - 1000 * s) / 2);
    g.lineJoin = 'round'; g.lineCap = 'round';
    return g;
  }
}

export function text(g, str, x, y, { size = 28, color = C.white, align = 'center', base = 'middle', weight = '', font = FONT } = {}) {
  g.font = `${weight} ${size}px ${font}`;
  g.fillStyle = color; g.textAlign = align; g.textBaseline = base;
  g.fillText(str, x, y);
}
export function box(g, x, y, w, h, color = C.white, lw = 2) {
  g.strokeStyle = color; g.lineWidth = lw; g.strokeRect(x, y, w, h);
}
export function line(g, x1, y1, x2, y2, color = C.white, lw = 2) {
  g.strokeStyle = color; g.lineWidth = lw; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
}
export function poly(g, pts, { stroke = null, fill = null, lw = 2, close = true } = {}) {
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  if (close) g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}
export function pad(n, w, ch = '0') { return String(n).padStart(w, ch); }
