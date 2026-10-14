// Desgaste por vuelta y su efecto en el tiempo: K = desgaste por vuelta / (compuesto.wear / vueltas de carrera).
// node tools/wearlap.mjs [track=..] [seed=3] [laps=20]
import { buildTrack } from '../js/track.js';
import { Sim } from '../js/sim.js';
import { COMPOUNDS } from '../js/teams.js';
const a = Object.fromEntries(process.argv.slice(2).map(x => x.split('=')));
const T = buildTrack(a.track);
const sim = new Sim(T, { seed: +(a.seed || 3), raceLaps: +(a.laps || 20) }); sim.weatherMode = 'dry';
sim.startSession('RACE');
const prev = new Map(), K = {}, pts = {};
sim.on((e) => {
  if (e.type !== 'lap' || !e.car) return; const c = e.car, p = prev.get(c);
  if (p && p.c === c.tyre.c && !c.inPit && c.lap > 2) {
    const dw = c.tyre.wear - p.w, k = dw / (COMPOUNDS[c.tyre.c].wear / sim.raceLaps);
    (K[c.tyre.c] ||= []).push(k); (pts[c.tyre.c] ||= []).push([p.w, e.time - c.fuel * 0.03]);
  }
  prev.set(c, { c: c.tyre.c, w: c.tyre.wear });
});
while (!sim.session.done) sim.step();
for (const c in K) { const v = K[c].sort((x, y) => x - y); console.log(c, 'K mediana', v[v.length >> 1].toFixed(3), 'n', v.length); }
for (const c in pts) { const b = [0, 0.2, 0.4, 0.6, 0.8, 1.2]; for (let i = 0; i < b.length - 1; i++) { const s = pts[c].filter(p => p[0] >= b[i] && p[0] < b[i + 1]).map(p => p[1]).sort((x, y) => x - y); if (s.length) console.log(c, `${b[i]}-${b[i + 1]}`, s[s.length >> 1].toFixed(2), s.length); } }
