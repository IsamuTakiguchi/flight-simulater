// チュートリアル検証: 各レッスンの手順を「生徒役」の操作で順に満たせるかを確認する
//   node tests/tutorial.mjs
import { Simulation } from '../js/sim/simulation.js';
import { LESSONS } from '../js/ui/tutorial.js';
import { wrap180, clamp } from '../js/util/math.js';

// 手順ごとの生徒の操作（毎フレーム呼ばれる）
const STUDENT = {
  takeoff: {
    1: s => { s.sys.parkingBrake = false; },
    2: s => { s.setThrottle(0.3); },
    3: s => { s.af.pressTOGA(s); },
    5: s => { s.pilot.pitch = s.fdm.out.pitch < 11 ? 0.45 : 0; },
    6: s => { s.pilot.pitch = clamp((s.af.fdPitch - s.fdm.out.pitch) * 0.1, -0.4, 0.4); },
    7: s => { s.pilot.pitch = clamp((s.af.fdPitch - s.fdm.out.pitch) * 0.1, -0.4, 0.4); s.sys.gearLever = 'UP'; },
    8: s => { s.pilot.pitch = s.af.ap ? 0 : clamp((s.af.fdPitch - s.fdm.out.pitch) * 0.1, -0.4, 0.4); if (s.raFt > 220) s.af.pressAP(s); },
    9: s => { const f = s.fmc.flapManeuverSpeeds(); const cur = ['UP', '1', '5', '15'][Math.min(3, s.sys.flapLever)] ; const next = { 3: '5', 2: '1', 1: 'UP' }[s.sys.flapLever]; if (next && s.fdm.out.ias > f[next]) s.flapUp(); },
  },
  autopilot: {
    1: (s, c) => { s.af.mcp.hdg = Math.round(((c.data.hdg0 + 30) % 360)) || 360; },
    2: s => { s.af.pressHDGSel(s); },
    4: s => { if (!(s.af.lat.armed === 'LNAV' || s.af.lat.active === 'LNAV')) s.af.pressLNAV(s); },
    5: s => { s.af.mcp.alt = 37000; },
    6: s => { if (s.af.vert.active !== 'V/S') s.af.pressVS(s); s.af.mcp.vs = -1000; },
  },
  autoland: {
    4: s => { s.setReverse(1); },
    5: s => { s.setReverse(0); },
    6: s => { s.af.disconnectAP(); },
  },
  manual: {
    // 手順 2〜3: FD に追従、手順 4: 35ft でフレア＋アイドル、手順 5: 逆推力とブレーキ
    1: s => fly(s), 2: s => fly(s),
    3: s => { if (s.raFt > 35) fly(s); else { s.pilot.pitch = clamp((-(s.raFt * 8 + 120) - s.vsFpm) * 0.0006 - s.fdm.w[1] * 57.3 * 0.06, -0.2, 0.4); s.pilot.roll = 0; s.setThrottle(0); } },
    4: s => { s.pilot.pitch = 0; s.setReverse(s.fdm.out.gs > 31 ? 1 : 0); s.pilot.brakeL = s.pilot.brakeR = 0.6; },
  },
};
// 生徒は授業で教えるとおりフライトディレクター（マゼンタの十字）に合わせて操縦する
function fly(s) {
  const o = s.fdm.out, af = s.af;
  s.pilot.pitch = clamp((af.fdPitch - o.pitch) * 0.05 - s.fdm.w[1] * 57.3 * 0.06, -0.3, 0.3);
  s.pilot.roll = clamp((af.fdRoll - o.bank) * 0.04, -0.4, 0.4);
}

let fail = 0;
for (const L of LESSONS) {
  const sim = new Simulation();
  sim.setup({ ...L.scenario, payloadKg: 25000, fuelKg: L.scenario.start === 'cruise' ? 20000 : 22000, autoTrim: true });
  const ctx = { data: {}, slow: r => { sim.simRate = r; } };
  const dt = 1 / 30;
  let t = 0, ok = true;
  for (let i = 0; i < L.steps.length; i++) {
    const st = L.steps[i];
    if (st.enter) st.enter(sim, ctx);
    if (!st.cond) { console.log(`  [${L.id}] ${i + 1}. ${st.title} — (説明)`); continue; }
    const t0 = t;
    let done = false;
    while (t - t0 < 600) {
      const act = STUDENT[L.id]?.[i];
      if (act) act(sim, ctx);
      sim.update(dt); t += dt * sim.simRate;
      sim.consumeEvents();
      if (sim.crashed) break;
      if (st.cond(sim, ctx)) { done = true; break; }
    }
    if (st.leave) st.leave(sim, ctx);
    console.log(`  [${L.id}] ${i + 1}. ${st.title} — ${done ? `OK (${(t - t0).toFixed(0)}s)` : 'NG'}${sim.crashed ? ' CRASH ' + sim.crashed : ''}`);
    if (!done) { ok = false; break; }
  }
  if (sim.landingReport) console.log(`  [${L.id}] 着陸評価 ${sim.landingReport.grade} ${sim.landingReport.vsFpm} fpm`);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${L.name}`);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
