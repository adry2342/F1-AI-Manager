// Multijugador: comprueba que la simulación es determinista con dos muros y órdenes en pasos fijos.
// Ejecutarlo dos veces (o en dos máquinas) debe dar la misma huella final:  node tools/mpsync.mjs [seed]
import { buildTrack } from '../js/track.js';
import { Sim } from '../js/sim.js';
import { Manager } from '../js/manager.js';
import { TEAMS } from '../js/teams.js';

const seed = +(process.argv[2] || 12345);
const T = buildTrack(process.argv[3] || 'gp');
const sim = new Sim(T, { seed, raceLaps: 6 });
sim.weatherMode = 'mixed';
const app = { mp: {}, speed: 1, managers: [] };
const A = new Manager(sim, null, TEAMS[0].id, app, { headless: true });
const B = new Manager(sim, null, TEAMS[3].id, app, { headless: true });
app.managers.push(A, B);
const [a0, a1] = A.cars, [b0] = B.cars;

let n = 0;
const hash = () => {
  let h = 2166136261 >>> 0; const mix = (x) => { h ^= x | 0; h = Math.imul(h, 16777619) >>> 0; };
  mix(Math.round(sim.t * 100));
  for (const c of sim.cars) { mix(Math.round(c.s * 100)); mix(Math.round(c.d * 1000)); mix(Math.round(c.v * 1000)); mix(c.lap); mix(Math.round(c.tyre.wear * 1e6)); mix(c.laps.length); }
  return h.toString(16);
};
const step = (k) => { for (let i = 0; i < k; i++) { sim.step(); for (const m of app.managers) m.tickLogic(); n++; } };
const out = [];
const t0 = Date.now();

sim.startSession('FP');
step(120); A.exec({ a: 'go', i: a0.i });
step(60); B.exec({ a: 'ntest', v: '1', i: b0.i }); B.exec({ a: 'nprog', v: 'long', i: b0.i }); B.exec({ a: 'go', i: b0.i });
step(3000); A.exec({ a: 'lev', x: 'pace', v: 'push', i: a0.i }); A.exec({ a: 'trim', v: '1', i: a1.i }); A.exec({ a: 'go', i: a1.i });
step(20000); out.push('FP ' + hash());
A.exec({ a: 'box', i: a0.i });
step(30000); out.push('FP2 ' + hash());
B.exec({ a: 'simnow', i: b0.i });
A.exec({ a: 'stadd', i: a0.i }); A.exec({ a: 'stc', x: 0, v: 'S', i: a0.i });
step(600);
sim.startSession('Q1');
step(200); A.exec({ a: 'go', i: a0.i }); B.exec({ a: 'go', i: b0.i });
step(30000); out.push('Q1 ' + hash());
sim.startSession('RACE');
step(300); A.exec({ a: 'stmove', x: 0, v: 3, i: a0.i }); A.exec({ a: 'start' });
step(300); out.push('grid ' + hash() + ' hold=' + sim.gridHold);
B.exec({ a: 'start' });
step(20000); A.exec({ a: 'stop', i: a0.i }); A.exec({ a: 'order', v: 'swap' }); B.exec({ a: 'op', op: ['set', b0.i, 'ers', 'boost'], i: b0.i });
step(40000); out.push('RACE ' + hash() + ' lap=' + Math.max(...sim.cars.map((c) => c.lap)));
console.log(out.join('\n'), `\nn=${n} wall=${((Date.now() - t0) / 1000).toFixed(1)}s`);
