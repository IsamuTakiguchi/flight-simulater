import { FDM } from '../js/sim/fdm.js';
import { FBW } from '../js/sim/fbw.js';
import { Weather, isa, casToTas } from '../js/sim/atmosphere.js';
import { Engine } from '../js/sim/engines.js';
import { KT, FT, DEG } from '../js/util/math.js';

const w = new Weather({});
const f = new FDM(); const fbw = new FBW();
f.fuel = 50000; f.payload = 22000;
const hm = 35000*FT;
f.h = hm; const atm = isa(hm); const tas = 0.84*atm.a;
f.setAttitude(2.5, 0, 90); f.vN=[0,tas,0]; f.flapPos=0; f.gearPos=0; f.ih = -0.5*DEG;
f.groundElev=()=>0;
let thr = 45000;
const dt=1/240; let t=0;
const pilot={pitch:0,roll:0,yaw:0,trim:0};
fbw.flightBlend=1; fbw.vRefTrim = 0;
for (let i=0;i<240*120;i++){
  f.thrusts=[thr,thr];
  if (i===0){ f.step(dt,{weather:w}); fbw.vRefTrim=f.out.ias; }
  fbw.update(dt,f,pilot,null,{});
  f.step(dt,{weather:w});
  t+=dt;
  // simple speed hold
  thr += (0.84 - f.out.mach)*2000*dt*50;
  if (i%(240*10)===0) console.log(t.toFixed(0), 'alt',(f.h/FT).toFixed(0),'M',f.out.mach.toFixed(3),'ias',f.out.ias.toFixed(1),'pitch',f.out.pitch.toFixed(2),'aoa',f.out.alpha.toFixed(2),'vs',(f.out.vs/FT*60).toFixed(0),'nz',f.nz.toFixed(3),'de',(f.de/DEG).toFixed(2),'ih',(f.ih/DEG).toFixed(2),'thr',(thr/1000).toFixed(1),'bank',f.out.bank.toFixed(2));
}
// pull test
console.log('--- pull 0.3 for 5s, then release');
for (let i=0;i<240*30;i++){
  pilot.pitch = i<240*5?0.3:0;
  pilot.roll = (i>240*10 && i<240*13)?0.5:0;
  f.thrusts=[thr,thr];
  fbw.update(dt,f,pilot,null,{}); f.step(dt,{weather:w}); thr += (0.84 - f.out.mach)*2000*dt*50;
  if (i%(240*2)===0) console.log((i/240).toFixed(0),'alt',(f.h/FT).toFixed(0),'ias',f.out.ias.toFixed(1),'pitch',f.out.pitch.toFixed(2),'vs',(f.out.vs/FT*60).toFixed(0),'nz',f.nz.toFixed(3),'nzc',fbw.out.nzCmd.toFixed(3),'de',(f.de/DEG).toFixed(2),'bank',f.out.bank.toFixed(1),'hdg',f.out.hdgTrue.toFixed(1),'beta',f.out.beta.toFixed(2));
}
