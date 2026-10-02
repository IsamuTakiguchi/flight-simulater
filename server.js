// 本番配信用の静的ファイルサーバー（依存パッケージなし。Railway などの PaaS 向け）
//   PORT 環境変数で待ち受け（未指定時 8080）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;

// 公開してよいパスだけを配信（サーバーやテストのソースは出さない）
const PUBLIC = ['/index.html', '/manifest.webmanifest', '/sw.js', '/css/', '/js/', '/vendor/', '/icons/'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt']);

// 起動時に圧縮済みデータを作っておく（ファイル数が少ないため全量をメモリに保持）
const cache = new Map();
function load(urlPath) {
  if (cache.has(urlPath)) return cache.get(urlPath);
  const file = path.join(ROOT, urlPath);
  if (!file.startsWith(ROOT + path.sep)) return null;
  let body;
  try { body = fs.readFileSync(file); } catch { return null; }
  const ext = path.extname(file);
  const entry = {
    body,
    gzip: COMPRESSIBLE.has(ext) ? zlib.gzipSync(body, { level: 9 }) : null,
    br: COMPRESSIBLE.has(ext) ? zlib.brotliCompressSync(body) : null,
    type: MIME[ext] || 'application/octet-stream',
    etag: '"' + body.length.toString(36) + '-' + fs.statSync(file).mtimeMs.toString(36) + '"',
    ext,
  };
  cache.set(urlPath, entry);
  return entry;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); res.end(); return; }
  if (urlPath === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
  if (urlPath === '/') urlPath = '/index.html';
  const allowed = PUBLIC.some(p => (p.endsWith('/') ? urlPath.startsWith(p) : urlPath === p)) && !urlPath.includes('..');
  const entry = allowed ? load(urlPath) : null;
  if (!entry) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not Found'); return; }

  const headers = {
    'Content-Type': entry.type,
    ETag: entry.etag,
    Vary: 'Accept-Encoding',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // HTML と SW は常に最新を確認、それ以外は短期キャッシュ（SW が長期キャッシュを担当）
    'Cache-Control': entry.ext === '.html' || urlPath === '/sw.js' ? 'no-cache' : 'public, max-age=3600',
  };
  if (req.headers['if-none-match'] === entry.etag) { res.writeHead(304, headers); res.end(); return; }
  const ae = req.headers['accept-encoding'] || '';
  let body = entry.body;
  if (entry.br && /\bbr\b/.test(ae)) { body = entry.br; headers['Content-Encoding'] = 'br'; }
  else if (entry.gzip && /\bgzip\b/.test(ae)) { body = entry.gzip; headers['Content-Encoding'] = 'gzip'; }
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
});

server.listen(PORT, '0.0.0.0', () => console.log(`B787 Flight Simulator: http://0.0.0.0:${PORT}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
