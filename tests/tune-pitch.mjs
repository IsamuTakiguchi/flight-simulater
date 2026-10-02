import { FDM } from '../js/sim/fdm.js';
import { FBW } from '../js/sim/fbw.js';
import { Weather, isa, casToTas } from '../js/sim/atmosphere.js';
import { KT, FT, DEG } from '../js/util/math.js';
const w = new Weather({});
function run(cfg, tune){
  Object.assign(FBW.tune, tune);
  const f = new FDM(); const fbw = new FBW(); fbw.autoTrimAssist = true;
  f.fuel = cfg.fuel; f.payload = 22000; f.h = cfg.alt*FT; f.groundElev=()=>0;
  const atm = isa(f.h); const tas = casToTas(cfg.ias*KT, atm);
  f.flapPos=cfg.flap; f.gearPos=cfg.gear; f.ih = cfg.ih*DEG;
  f.setAttitude(cfg.pitch, 0, 90); f.vN=[0,tas,0];
  const dt=1/240; let thr=cfg.thr; fbw.flightBlend=1;
  const pilot={pitch:0,roll:0,yaw:0,trim:0};
  let maxnz=0, err=0, n=0, osc=0, last=null;
  for (let i=0;i<240*40;i++){
    pilot.pitch = (i>240*20 && i<240*26)?0.2:0;
    f.thrusts=[thr,thr]; fbw.update(dt,f,pilot,null,{}); f.step(dt,{weather:w});
    thr += (cfg.ias - f.out.ias)*300*dt*10;
    if (i>240*20 && i<240*26){ maxnz=Math.max(maxnz,f.nz); if(i>240*22){err+=Math.abs(f.nz-fbw.out.nzCmd);n++;} }
    if (i>240*26){ const d=f.nz-fbw.out.nzCmd; if(last!==null && Math.sign(d)!==Math.sign(last) && Math.abs(d)>0.01) osc++; last=d; }
    if (i===240*19) var pre={pitch:f.out.pitch, de:f.de/DEG, ih:f.ih/DEG, vs:f.out.vs/FT*60, nz:f.nz};
  }
  return {pre, maxnz:maxnz.toFixed(3), cmd:(1+0.2*(cfg.flap>0.5?1:1.5)).toFixed(2), err:(err/n).toFixed(3), osc, endPitch:f.out.pitch.toFixed(2), endVs:(f.out.vs/FT*60).toFixed(0)};
}
const cfgs = {
  cruise:{alt:35000, ias:280, flap:0, gear:0, ih:-0.3, pitch:2.5, thr:46000, fuel:50000},
  climb:{alt:15000, ias:300, flap:0, gear:0, ih:0, pitch:2, thr:60000, fuel:60000},
  approach:{alt:3000, ias:145, flap:8, gear:1, ih:-3, pitch:3, thr:60000, fuel:10000},
};
const tunes = JSON.parse(process.argv[2]||'[{}]');
for (const t of tunes) for (const [k,c] of Object.entries(cfgs)) console.log(JSON.stringify(t), k, JSON.stringify(run(c,t)));
