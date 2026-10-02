// ヘッドレス統合テスト: 離陸 → 上昇 → 巡航 → 降下 → ILS 進入 → オートランド → 停止
//   node tests/full-flight.mjs [出発 ICAO] [滑走路] [到着 ICAO] [滑走路] [開始=runway|cold|final10|cruise]
import { Simulation } from '../js/sim/simulation.js';
import { VirtualCaptain } from '../js/sim/copilot.js';
import { FT, KT, NM } from '../js/util/math.js';

const [o = 'RJTT', or = '34R', d = 'RJBB', dr = '24L', start = 'runway', wind = '0'] = process.argv.slice(2);
const sim = new Simulation();
sim.setup({ origin: o, depRwy: or, dest: d, arrRwy: dr, start, payloadKg: 25000, fuelKg: 22000, weather: { windDir: +wind.split('/')[0] || 0, windKt: +(wind.split('/')[1] || 0) } });
const cap = new VirtualCaptain(sim);
console.log('route:', sim.fmc.legs.map(l => l.ident + (l.alt ? '/' + l.alt : '')).join(' '), 'CRZ', sim.fmc.crzAltFt);
console.log('V1/VR/V2', sim.fmc.v1, sim.fmc.vr, sim.fmc.v2, 'trim', sim.fmc.toTrim, 'VREF30', sim.fmc.vref30, 'TOW', Math.round(sim.fdm.mass));
const dt = 1 / 30;
let lastPrint = -1e9, lastPhase = '';
const maxT = 3 * 3600;
let maxBank = 0;
for (let t = 0; t < maxT; t += dt) {
  cap.update(dt);
  sim.update(dt);
  const f = sim.fdm, out = f.out, af = sim.af;
  if (!sim.onGround) maxBank = Math.max(maxBank, Math.abs(out.bank));
  for (const ev of sim.consumeEvents()) {
    if (ev.type === 'copilot') console.log(`[${t.toFixed(0)}s] CAPT: ${ev.text}`);
    else if (ev.type === 'callout') console.log(`[${t.toFixed(0)}s] (aural) ${ev.text}`);
    else if (ev.type === 'TOUCHDOWN') console.log(`[${t.toFixed(0)}s] TOUCHDOWN vs=${ev.vsFpm.toFixed(0)} fpm pitch=${ev.pitch.toFixed(1)}`);
    else if (ev.type === 'LANDING_REPORT') console.log('LANDING REPORT', JSON.stringify(ev.report));
    else if (ev.type === 'CRASH') console.log('CRASH', ev.reason);
    else if (ev.type === 'TAILSTRIKE') console.log(`[${t.toFixed(0)}s] TAIL STRIKE`);
    else if (ev.type === 'sound' && ev.key) console.log(`[${t.toFixed(0)}s] WARNING ${ev.key}`);
  }
  const interval = sim.raFt < 2500 && !sim.onGround ? 10 : 60;
  if (t - lastPrint > interval || sim.flightPhase !== lastPhase) {
    lastPrint = t; lastPhase = sim.flightPhase;
    const fma = af.fma();
    console.log(`${t.toFixed(0).padStart(5)}s ${sim.flightPhase.padEnd(9)} ALT ${sim.altFt.toFixed(0).padStart(6)} RA ${sim.raFt.toFixed(0).padStart(5)} IAS ${out.ias.toFixed(0).padStart(3)} M${out.mach.toFixed(2)} VS ${sim.vsFpm.toFixed(0).padStart(6)} HDG ${sim.hdgMag.toFixed(0).padStart(3)} P ${out.pitch.toFixed(1).padStart(5)} B ${out.bank.toFixed(1).padStart(5)} N1 ${sim.engines[0].n1.toFixed(1)} FL ${sim.sys.flapLever} G ${sim.sys.gearLever} | ${fma.thr}|${fma.roll}(${fma.rollArmed})|${fma.pitch}(${fma.pitchArmed})|${fma.status} leg ${sim.fmc.activeLeg?.ident} dtg ${(sim.fmc.distanceToDest(f.lat, f.lon) / NM).toFixed(0)} fuel ${sim.sys.fuelTotal.toFixed(0)}${sim.ilsDev?.locValid ? ` loc ${sim.ilsDev.locDots.toFixed(2)} gs ${sim.ilsDev.gsDots.toFixed(2)}` : ''}`);
  }
  if (sim.crashed || cap.state === 'DONE') break;
}
console.log('END state', cap.state, 'crashed', sim.crashed, 'maxBank', maxBank.toFixed(1), 'time', sim.time.toFixed(0));
if (sim.crashed || cap.state !== 'DONE') process.exit(1);
