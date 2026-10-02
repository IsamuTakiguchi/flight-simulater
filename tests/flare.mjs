import { Simulation } from '../js/sim/simulation.js';
const sim = new Simulation();
const [o='RJTT', r='34R', wind='0/0'] = process.argv.slice(2);
sim.setup({ origin: o, depRwy: r, dest: o, arrRwy: r, start: 'final10', payloadKg: 25000, fuelKg: 9000, weather:{windDir:+wind.split('/')[0], windKt:+wind.split('/')[1]} });
sim.sys.autobrake='3';
const dt = 1/60;
let last=0;
for (let t=0;t<400;t+=dt){
  sim.update(dt);
  for (const ev of sim.consumeEvents()) if (ev.type==='LANDING_REPORT') console.log(JSON.stringify(ev.report)); else if (ev.type==='CRASH') console.log('CRASH',ev.reason);
  const f=sim.fdm,o=f.out,af=sim.af;
  if ((sim.raFt<120 && t-last>0.5) || t-last>20){ last=t;
    console.log(t.toFixed(1),'RA',sim.raFt.toFixed(1),'VS',sim.vsFpm.toFixed(0),'vsT',af.vsT?.toFixed(0),'P',o.pitch.toFixed(2),'IAS',o.ias.toFixed(0),'nz',f.nz.toFixed(3),'nzc',sim.fbw.out.nzCmd.toFixed(3),'de',(f.de*57.3).toFixed(1),af.vert.active, af.lat.active, 'loc',sim.ilsDev.locDots.toFixed(2),'hdg',sim.hdgMag.toFixed(1),'b',o.bank.toFixed(1),'gs',(o.gs/0.5144).toFixed(0));
  }
  if (sim.onGround && o.gs<20) break;
}
