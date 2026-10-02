// 自動操縦デモ用の仮想パイロット（離陸〜巡航〜進入〜オートランド〜停止まで標準手順で操作）
// 実機の 787 は離陸操作を自動化できないため、ここでは「機長役」がボーイング標準手順に従って操縦する。
import { KT, FT, NM, clamp, wrap180 } from '../util/math.js';
import { distance } from '../util/geo.js';
import { B789, flapIndexByName } from './aircraft-787.js';

export class VirtualCaptain {
  constructor(sim) {
    this.sim = sim;
    this.state = 'IDLE';
    this.t = 0;
    this.log = [];
    this.enabled = true;
  }

  note(text) { this.log.push({ t: this.sim.time, text }); this.sim.events.push({ type: 'copilot', text }); }

  update(dt) {
    if (!this.enabled) return;
    const s = this.sim, f = s.fdm, o = f.out, af = s.af, sys = s.sys, fmc = s.fmc;
    this.t += dt;
    const ias = o.ias || 0, ra = s.raFt;
    const p = s.pilot;

    switch (this.state) {
      case 'IDLE':
        if (s.onGround && s.flightPhase === 'PREFLIGHT') {
          if (!s.engines.every(e => e.running)) { this.state = 'ENGINE_START'; this.note('エンジン始動手順を開始'); break; }
          this.state = 'LINEUP'; this.t = 0;
        } else if (!s.onGround) {
          this.state = s.flightPhase === 'APPROACH' ? 'APPROACH' : 'CRUISE';
        }
        break;

      case 'ENGINE_START': {
        sys.battery = true;
        if (!sys.apuRunning && sys.apuSwitch === 'OFF') { sys.apuSwitch = 'START'; this.note('APU 始動'); }
        if (!sys.apuRunning) break;
        sys.fuelPumps = { L: true, C: true, R: true };
        sys.lights.beacon = true; sys.lights.nav = true;
        const [L, R] = s.engines;
        if (!R.running) {
          if (R.startSwitch !== 'START' && R.n2 < 5) { R.startSwitch = 'START'; R.fuelControl = 'RUN'; this.note('右エンジン始動 (ENG START R → FUEL CONTROL RUN)'); }
          break;
        }
        if (!L.running) {
          if (L.startSwitch !== 'START' && L.n2 < 5) { L.startSwitch = 'START'; L.fuelControl = 'RUN'; this.note('左エンジン始動'); }
          break;
        }
        sys.apuSwitch = 'OFF';
        sys.flapLever = flapIndexByName(fmc.toFlaps);
        f.ih = (4.6 - fmc.toTrim) / 0.85 * Math.PI / 180;
        af.fd = true; af.atArm = true; af.lat.active = 'TO/GA'; af.vert.active = 'TO/GA';
        af.lat.armed = 'LNAV'; af.vert.armed = 'VNAV';
        sys.autobrake = 'RTO';
        Object.assign(sys.lights, { landing: true, taxi: true, strobe: true, logo: true, turnoff: true });
        sys.seatbelt = true;
        this.note('エンジン始動完了・離陸準備');
        this.state = 'LINEUP'; this.t = 0;
        break;
      }

      case 'LINEUP':
        if (this.t > 2 && Math.abs(f.flapPos - sys.flapLever) < 0.01) {
          sys.parkingBrake = false;
          s.setThrottle(0.35);
          this.note('パーキングブレーキ解除、推力 40% で安定');
          this.state = 'SPOOL'; this.t = 0;
        }
        break;

      case 'SPOOL':
        if (s.engines.every(e => e.n1 > 38) || this.t > 6) {
          af.pressTOGA(s);
          this.note('TO/GA スイッチ押下 — 離陸推力設定');
          this.state = 'ROLL'; this.t = 0;
        }
        break;

      case 'ROLL': {
        // 滑走路中心線維持（ラダー）
        const g = fmc.depRwy;
        const hdgErr = wrap180(g.hdgTrue - o.hdgTrue);
        p.yaw = clamp(hdgErr * 0.15 - (s.ilsDevDep?.xtk || 0), -1, 1);
        p.pitch = 0;
        if (ias >= fmc.vr) { this.note('ローテート'); this.state = 'ROTATE'; this.t = 0; }
        break;
      }

      case 'ROTATE': {
        // 約 2.5°/秒で目標 15° へ
        const target = Math.min(15, this.t * 2.6);
        p.pitch = clamp((target - o.pitch) * 0.12 + 0.18, -0.2, 0.6);
        p.yaw = 0;
        if (!s.onGround && ra > 35) { this.state = 'INITIAL_CLIMB'; this.t = 0; this.note('ポジティブレート — ギアアップ'); sys.gearLever = 'UP'; }
        break;
      }

      case 'INITIAL_CLIMB': {
        // FD のピッチ指令に追従（手動）
        const err = af.fdPitch - o.pitch;
        p.pitch = clamp(err * 0.10, -0.4, 0.4);
        p.roll = clamp((af.fdRoll - o.bank) * 0.04, -0.4, 0.4);
        if (ra > 600) {
          p.pitch = 0; p.roll = 0;
          af.pressAP(s);
          this.note('オートパイロット ON');
          this.state = 'CLIMB'; this.t = 0;
        }
        break;
      }

      case 'CLIMB': {
        // フラップ格納スケジュール
        const fms = fmc.flapManeuverSpeeds();
        const cur = B789.flaps[sys.flapLever].name;
        const order = ['30', '25', '20', '18', '17', '15', '5', '1', 'UP'];
        const next = { '20': '5', '18': '5', '17': '5', '15': '5', '5': '1', '1': 'UP' }[cur];
        if (next && s.agl > 1000 * FT && ias > fms[next] - 10) {
          sys.flapLever = flapIndexByName(next);
          this.note(`フラップ ${next}`);
        }
        if (cur === 'UP' && sys.lights.landing && s.altFt > 10000) {
          Object.assign(sys.lights, { landing: false, taxi: false, turnoff: false });
          sys.seatbelt = false;
          this.note('10,000 ft 通過 — 着陸灯 OFF');
        }
        // MCP 高度を巡航高度へ（管制許可を模擬）
        if (af.mcp.alt < fmc.crzAltFt && s.altFt > af.mcp.alt - 3000) { af.mcp.alt = fmc.crzAltFt; this.note(`巡航高度 FL${Math.round(fmc.crzAltFt / 100)} に上昇許可`); }
        if (s.flightPhase === 'CRUISE') { this.state = 'CRUISE'; this.note('巡航'); }
        break;
      }

      case 'CRUISE': {
        // T/D 前に MCP 高度を最終進入高度へ下げる
        const ff = fmc.legs.find(l => l.ident.startsWith('FF'));
        const path = fmc.vnavPathAlt(f.lat, f.lon);
        if (ff && path != null && path < s.altFt + 2000 && af.mcp.alt > ff.alt) {
          af.mcp.alt = ff.alt;
          this.note(`降下許可 ${ff.alt} ft`);
        }
        if (af.vert.active === 'VNAV ALT' && af.mcp.alt > (ff?.alt ?? 0) && path != null && path < s.altFt) af.mcp.alt = ff.alt;
        if (s.altFt < 10000 && !sys.lights.landing && s.flightPhase !== 'CRUISE') {
          Object.assign(sys.lights, { landing: true, turnoff: true });
          sys.seatbelt = true;
          this.note('10,000 ft — 着陸灯 ON');
        }
        if (af.dragRequired) sys.speedbrakeLever = 0.6; else if (sys.speedbrakeLever > 0 && sys.speedbrakeLever < 0.99) sys.speedbrakeLever = 0;
        const dd = fmc.distanceToDest(f.lat, f.lon) / NM;
        if (dd < 30 || s.flightPhase === 'APPROACH') { this.state = 'APPROACH'; this.note('進入開始'); }
        break;
      }

      case 'APPROACH': {
        // 経路に沿った残距離で減速・フラップ展開を計画
        const dThr = fmc.distanceToDest(f.lat, f.lon) / NM;
        if (!af.mcp.spdIntv && af.vert.active.startsWith('VNAV')) { /* VNAV 速度 */ }
        // 降下中の過速度: スピードブレーキ
        if (af.dragRequired && !s.onGround && f.flapPos < 0.5) sys.speedbrakeLever = 0.6;
        else if (sys.speedbrakeLever > 0 && sys.speedbrakeLever < 0.99 && !af.dragRequired) sys.speedbrakeLever = 0;
        if (!s.onGround && af.vert.armed !== 'G/S' && !['G/S', 'FLARE', 'ROLLOUT'].includes(af.vert.active) && dThr < 22) {
          af.pressAPP(s); this.note('APP アーム（LOC / G/S）');
        }
        // 減速・フラップ展開スケジュール
        const fms = fmc.flapManeuverSpeeds();
        const want = dThr > 18 ? null : dThr > 14 ? '1' : dThr > 11.5 ? '5' : dThr > 10 ? '15' : dThr > 8.5 ? '20' : fmc.ldgFlaps;
        if (want && flapIndexByName(want) > sys.flapLever && ias < B789.flaps[flapIndexByName(want)].vfe - 5) {
          sys.flapLever = flapIndexByName(want);
          this.note(`フラップ ${want}`);
        }
        if (dThr < 11 && sys.gearLever === 'UP') { sys.gearLever = 'DN'; sys.speedbrakeArmed = true; this.note('ギアダウン・スピードブレーキ ARM'); }
        if (sys.autobrake === 'OFF' || sys.autobrake === 'RTO') sys.autobrake = '3';
        // 速度
        const cur = B789.flaps[sys.flapLever].name;
        const tgt = dThr < 9 ? fmc.vref + 5 : Math.max(fms[cur] ?? 220, fmc.vref + 5);
        if (dThr < 20) { af.mcp.spdIntv = true; af.mcp.isMach = false; af.mcp.spd = Math.round(Math.min(tgt, 220)); }
        if (af.vert.active === 'G/S' && af.mcp.alt < s.altFt + 1000) af.mcp.alt = Math.ceil((s.altFt + 2000) / 100) * 100; // 復行高度
        if (af.vert.active === 'G/S') { af.mcp.alt = Math.max(af.mcp.alt, Math.round((fmc.arrRwy.elevM / FT + 3000) / 100) * 100); }
        if (s.onGround) { this.state = 'ROLLOUT'; this.t = 0; this.note('接地 — リバース'); }
        break;
      }

      case 'ROLLOUT': {
        const gsKt = o.gs / KT;
        if (gsKt > 65 && this.t > 0.5) s.setReverse(0.85);
        else if (gsKt > 30) s.setReverse(0.1);
        else s.setReverse(0);
        if (gsKt < 60 && !this.revIdle) { this.revIdle = true; this.note('60 kt — リバースアイドル'); }
        if (gsKt < 25) {
          if (af.ap) { af.disconnectAP(true); this.note('オートパイロット解除・手動でタクシー速度へ'); }
          sys.autobrake = 'OFF';
          p.brakeL = p.brakeR = 0.35;
        }
        if (gsKt < 0.5) {
          sys.parkingBrake = true; s.setReverse(0); p.brakeL = p.brakeR = 0;
          sys.speedbrakeLever = 0; sys.flapLever = 0;
          this.note('停止 — フライト完了');
          this.state = 'DONE';
        }
        break;
      }
      default: break;
    }
  }
}
