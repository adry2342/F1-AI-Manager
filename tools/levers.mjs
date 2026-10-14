// Palancas del mánager sin ruido: el coche solo en pista y sin aprender (con tráfico y aprendizaje cada prueba acaba
// con otra trazada y el ruido tapa la palanca). node tools/levers.mjs [gp|night|urban|mount]
import { buildTrack } from '../js/track.js';
import { Sim } from '../js/sim.js';
const tr = process.argv[2] || 'gp', T = buildTrack(tr);
const cf = [['normal', 0, 0], ['push', 0, 0], ['save', 0, 0], ['normal', 1, 0], ['normal', -1, 0], ['normal', 0, 1], ['normal', 0, -1]];
for (const [pace, trim, susp] of cf) {
  let tot = 0, w = 0, n = 0, err = 0, vmax = 0;
  for (const seed of [3, 11]) {
    const sim = new Sim(T, { seed, raceLaps: 7 }); sim.weatherMode = 'dry';
    const me = sim.cars[0];
    me.mgr = { pace, ers: 'normal', fight: 'normal', laps: [], stopsLog: [], draft: [{ c: 'H', from: 0, to: 7 }] }; me.trim = trim; me.susp = susp;
    sim.startSession('RACE'); for (const o of sim.cars) if (o !== me) o.out = true; sim.canLearn = () => false;
    while (!sim.session.done) { sim.step(); if (me.lap >= 1) vmax = Math.max(vmax, me.v * 3.6); }
    for (const l of me.mgr.laps.slice(1)) { tot += l.t; w += l.w1 - l.w0; n++; }
    err += me.brain.mistakes;
  }
  console.log(tr, pace.padEnd(6), 'ala', trim, 'susp', susp, 'vuelta', (tot / n).toFixed(3), 'desg/v', (w / n * 100).toFixed(2), 'err', err, 'vmax', vmax.toFixed(0));
}
