// Multijugador: copia el estado de una simulación a otra nueva a mitad de sesión y comprueba que siguen idénticas.
//   node tools/mpsnap.mjs
import { buildTrack } from '../js/track.js';
import { Sim } from '../js/sim.js';
import { Manager } from '../js/manager.js';
import { TEAMS } from '../js/teams.js';
import { snapshot, restore } from '../js/snapshot.js';

const make = () => {
  const sim = new Sim(buildTrack(process.argv[2] || 'urban'), { seed: 4242, raceLaps: 6 });
  sim.weatherMode = 'mixed';
  const app = { mp: {}, speed: 1, managers: [] };
  app.managers.push(new Manager(sim, null, TEAMS[1].id, app, { headless: true }), new Manager(sim, null, TEAMS[5].id, app, { headless: true }));
  return { sim, app, step: (k) => { for (let i = 0; i < k; i++) { sim.step(); for (const m of app.managers) m.tickLogic(); } } };
};
const hash = (sim) => {
  let h = 2166136261 >>> 0; const mix = (x) => { h ^= x | 0; h = Math.imul(h, 16777619) >>> 0; };
  mix(Math.round(sim.t * 100)); mix(sim.rng.s);
  for (const c of sim.cars) { mix(Math.round(c.s * 100)); mix(Math.round(c.d * 1000)); mix(Math.round(c.v * 1000)); mix(c.lap); mix(Math.round(c.tyre.wear * 1e6)); mix(c.laps.length); mix(c.brain.acc || 0); }
  return h.toString(16);
};
let fails = 0;
const check = (label, A, B) => { const a = hash(A.sim), b = hash(B.sim); if (a !== b) fails++; console.log(label.padEnd(26), a, b, a === b ? 'OK' : 'DISTINTO'); };
const both = (f) => { f(A); f(B); };

const A = make();
const [a0] = A.app.managers[0].cars, [b0] = A.app.managers[1].cars;
A.sim.startSession('FP');
A.step(100); A.app.managers[0].exec({ a: 'go', i: a0.i }); A.app.managers[1].exec({ a: 'ntest', v: '1', i: b0.i }); A.app.managers[1].exec({ a: 'go', i: b0.i });
A.step(15000);

const copy = (label) => {
  const t0 = Date.now(), s = JSON.stringify(snapshot(A.sim)), t1 = Date.now();
  const B = make(); restore(B.sim, JSON.parse(s));
  console.log(`${label}: ${(s.length / 1e6).toFixed(2)} MB, copiar ${t1 - t0} ms, cargar ${Date.now() - t1} ms`);
  return B;
};
let B = copy('libres, a mitad');
check('al copiar', A, B);
both((X) => X.step(6000)); check('+100 s', A, B);
both((X) => X.app.managers[0].exec({ a: 'box', i: a0.i })); both((X) => X.step(20000)); check('+433 s (box)', A, B);

both((X) => X.sim.startSession('Q1')); both((X) => X.step(300));
both((X) => { X.app.managers[0].exec({ a: 'go', i: a0.i }); X.app.managers[1].exec({ a: 'go', i: b0.i }); }); both((X) => X.step(20000)); check('Q1', A, B);

A.sim.startSession('RACE'); A.step(200); A.app.managers[0].exec({ a: 'start' }); A.app.managers[1].exec({ a: 'start' }); A.step(15000);
B = copy('carrera, a mitad');
check('al copiar', A, B);
both((X) => X.app.managers[1].exec({ a: 'stop', i: b0.i })); both((X) => X.step(30000)); check('final carrera', A, B);
console.log(fails ? `FALLOS: ${fails}` : 'TODO IGUAL');
process.exit(fails ? 1 : 0);
