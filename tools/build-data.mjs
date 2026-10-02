// 実在の空港・滑走路・航法援助施設データ (OurAirports, パブリックドメイン) から
// js/data/airports.js と js/data/navaids.js を生成するスクリプト。
//
//   node tools/build-data.mjs [csvディレクトリ]
//
// csvディレクトリを省略すると OurAirports から直接ダウンロードする。
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'https://davidmegginson.github.io/ourairports-data/';
const dir = process.argv[2];

async function load(name) {
  if (dir) return fs.readFileSync(path.join(dir, name), 'utf8');
  const res = await fetch(SRC + name);
  if (!res.ok) throw new Error(name + ': ' + res.status);
  return res.text();
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const NAME_JA = {
  RJTT: '東京国際空港（羽田）', RJAA: '成田国際空港', RJBB: '関西国際空港', RJOO: '大阪国際空港（伊丹）',
  RJGG: '中部国際空港（セントレア）', RJCC: '新千歳空港', RJFF: '福岡空港', ROAH: '那覇空港',
  RJSS: '仙台空港', RJOA: '広島空港', RJBE: '神戸空港', RJFK: '鹿児島空港', RJFT: '熊本空港',
  RJFM: '宮崎空港', RJFO: '大分空港', RJFU: '長崎空港', RJOM: '松山空港', RJOT: '高松空港',
  RJOK: '高知空港', RJOB: '岡山空港', RJNK: '小松空港', RJNT: '富山空港', RJSN: '新潟空港',
  RJSA: '青森空港', RJSK: '秋田空港', RJSM: '三沢空港', RJCH: '函館空港', RJEC: '旭川空港',
  RJCK: '釧路空港', RJCB: '帯広空港', RJCM: '女満別空港', RJCN: '中標津空港', RJCW: '稚内空港',
  RJSF: '福島空港', RJSY: '庄内空港', RJSC: '山形空港', RJSI: '花巻空港', RJAH: '茨城空港',
  RJOI: '岩国空港', RJDC: '山口宇部空港', RJFR: '北九州空港', RJFS: '佐賀空港', RJOR: '鳥取空港',
  RJOH: '米子空港', RJOC: '出雲空港', RJOS: '徳島空港', RJBD: '南紀白浜空港', RJNS: '静岡空港',
  RJAF: '松本空港', RJNW: '能登空港', ROIG: '新石垣空港', ROMY: '宮古空港', RODN: '嘉手納飛行場',
  RJKA: '奄美空港', RJFG: '種子島空港', RJCO: '札幌丘珠空港', RJSH: '八戸飛行場', RJOW: '石見空港',
  ROKJ: '久米島空港', RORS: '下地島空港', RJTH: '八丈島空港', RJAW: '硫黄島',
};

const FT = 0.3048;
const toRad = d => d * Math.PI / 180, toDeg = r => r * 180 / Math.PI;
function bearing(lat1, lon1, lat2, lon2) {
  const p1 = toRad(lat1), p2 = toRad(lat2), dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
function dist(lat1, lon1, lat2, lon2) {
  const R = 6371008.8, p1 = toRad(lat1), p2 = toRad(lat2);
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const r5 = x => Math.round(x * 1e6) / 1e6, r1 = x => Math.round(x * 10) / 10;

const [aptCsv, rwyCsv, navCsv] = await Promise.all(['airports.csv', 'runways.csv', 'navaids.csv'].map(load));
const airports = parseCSV(aptCsv), runways = parseCSV(rwyCsv), navaids = parseCSV(navCsv);

const navJP = navaids.filter(n => n.iso_country === 'JP' && ['VOR', 'VOR-DME', 'VORTAC', 'TACAN', 'NDB', 'NDB-DME', 'DME'].includes(n.type));
const vors = navJP.filter(n => n.magnetic_variation_deg !== '' && n.type.startsWith('VOR'));
function magVarAt(lat, lon) {
  // 近傍 VOR の磁気偏差を距離重み付けで補間（西偏 = 負）
  const near = vors.map(v => ({ d: dist(lat, lon, +v.latitude_deg, +v.longitude_deg), m: +v.magnetic_variation_deg }))
    .sort((a, b) => a.d - b.d).slice(0, 3);
  let w = 0, s = 0;
  for (const n of near) { const wi = 1 / Math.max(n.d, 1000) ** 2; w += wi; s += wi * n.m; }
  return r1(s / w);
}

const out = [];
for (const a of airports) {
  if (a.iso_country !== 'JP') continue;
  if (!['large_airport', 'medium_airport'].includes(a.type)) continue;
  const rws = runways.filter(r => r.airport_ident === a.ident && r.closed !== '1'
    && /ASP|CON|PEM|ASPH|CONC/i.test(r.surface) && +r.length_ft >= 4900
    && r.le_latitude_deg && r.he_latitude_deg);
  if (!rws.length) continue;
  if (a.scheduled_service !== 'yes' && !NAME_JA[a.ident]) continue;
  const ends = [];
  for (const r of rws) {
    const le = { id: r.le_ident, lat: +r.le_latitude_deg, lon: +r.le_longitude_deg, elev: +(r.le_elevation_ft || a.elevation_ft || 0), disp: +(r.le_displaced_threshold_ft || 0) };
    const he = { id: r.he_ident, lat: +r.he_latitude_deg, lon: +r.he_longitude_deg, elev: +(r.he_elevation_ft || a.elevation_ft || 0), disp: +(r.he_displaced_threshold_ft || 0) };
    const len = dist(le.lat, le.lon, he.lat, he.lon);
    for (const [s, e] of [[le, he], [he, le]]) {
      ends.push({
        id: s.id, opp: e.id,
        lat: r5(s.lat), lon: r5(s.lon), elevFt: s.elev,
        endLat: r5(e.lat), endLon: r5(e.lon), endElevFt: e.elev,
        hdg: r1(bearing(s.lat, s.lon, e.lat, e.lon)),
        lengthM: Math.round(len), widthM: Math.round(+(r.width_ft || 150) * FT),
        dispM: Math.round(s.disp * FT),
      });
    }
  }
  const longest = Math.max(...ends.map(e => e.lengthM));
  out.push({
    icao: a.ident, iata: a.iata_code || '', name: a.name, nameJa: NAME_JA[a.ident] || a.name,
    city: a.municipality, lat: r5(+a.latitude_deg), lon: r5(+a.longitude_deg), elevFt: +(a.elevation_ft || 0),
    magVar: magVarAt(+a.latitude_deg, +a.longitude_deg), longestM: longest,
    runways: ends.sort((x, y) => x.id.localeCompare(y.id)),
  });
}
const MAJOR = ['RJTT', 'RJAA', 'RJBB', 'RJOO', 'RJGG', 'RJCC', 'RJFF', 'ROAH'];
const EXCLUDE = new Set(['RODN', 'RJAW']); // 軍用飛行場は除外
const rank = a => { const i = MAJOR.indexOf(a.icao); return i >= 0 ? i : (NAME_JA[a.icao] ? 100 : 200); };
for (let i = out.length - 1; i >= 0; i--) if (EXCLUDE.has(out[i].icao)) out.splice(i, 1);
out.sort((a, b) => rank(a) - rank(b) || b.lat - a.lat);

const nav = navJP.map(n => ({
  id: n.ident, name: n.name, type: n.type, freq: n.type.startsWith('NDB') ? +n.frequency_khz : +(n.frequency_khz / 1000).toFixed(2),
  lat: r5(+n.latitude_deg), lon: r5(+n.longitude_deg), elevFt: +(n.elevation_ft || 0),
  magVar: n.magnetic_variation_deg === '' ? null : r1(+n.magnetic_variation_deg),
}));

const header = '// 自動生成ファイル: tools/build-data.mjs\n// 出典: OurAirports (https://ourairports.com/data/) — Public Domain\n';
fs.writeFileSync('js/data/airports.js', header + 'export const AIRPORTS = ' + JSON.stringify(out) + ';\n');
fs.writeFileSync('js/data/navaids.js', header + 'export const NAVAIDS = ' + JSON.stringify(nav) + ';\n');
console.log(`airports: ${out.length}, runway ends: ${out.reduce((s, a) => s + a.runways.length, 0)}, navaids: ${nav.length}`);
