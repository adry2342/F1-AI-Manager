// Simulador del equipo (mánager). En modo consistente el piloto no prueba nada en pista (vueltas iguales para comparar
// reglajes), así que esas vueltas no le sirven para aprender. Al volver al garaje las recupera aquí: él solo, sin tráfico,
// con su mismo cerebro (lo que aprende se queda), en una simulación aparte que avanza unos milisegundos por fotograma.
// Así acaba el día con las mismas vueltas de aprendizaje que si no hubiera usado el modo consistente.
import { Sim } from './sim.js';
import { COMPOUNDS } from './teams.js';

export class TeamSim {
  constructor(sim, car, laps) {
    this.car = car; this.target = laps; this.done = 0;
    const g = this.g = new Sim(sim.T, { seed: ((sim.t * 1000) | 0) ^ (car.i * 7919), raceLaps: sim.raceLaps, brains: { [car.code]: car.brain }, noShuffle: true, only: car.code, weekend: sim.weekend });
    g.weatherMode = 'dry';
    g.startSession('FP');
    g.evo = sim.evo;
    const me = this.me = g.cars[0];
    me.trim = car.trim || 0; me.susp = car.susp || 0;
    const c = COMPOUNDS[car.tyre.c]?.wet ? 'M' : car.tyre.c;
    me.plan = { runs: [{ c, laps: laps + 1, fuel: 30, go: 1, kind: 'learn' }], idx: 0 };
    g.on((e) => { if (e.type === 'lap' && e.car === me) this.done++; });
  }
  get finished() { return this.done >= this.target || this.g.session.done || (this.g.t > 20 && this.me.state === 'garage'); }
  // avanza hasta ms milisegundos (o hasta acabar si ms es Infinity)
  run(ms) {
    const t0 = performance.now();
    while (!this.finished && performance.now() - t0 < ms) for (let k = 0; k < 30; k++) this.g.step();
    return this.finished;
  }
}
