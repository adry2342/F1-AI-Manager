// Modo mánager: eliges un equipo y llevas a sus dos pilotos desde el muro de boxes.
// Muro (siempre a la vista): ritmo, modo motor y pelea de cada piloto, con lo que cuesta cada opción; parar en esta vuelta
// (carrera) o salir a pista / volver a boxes (libres y clasificación); órdenes de equipo y avisos que esperan respuesta.
// Garaje (botón o G): plan de paradas con el desgaste previsto (se cambia en directo), reglaje (solo con el coche en el
// garaje en libres y clasificación, o en la parrilla), rendimiento real por compuesto y desgaste, y radar de lluvia.
// La estrategia es siempre manual: el equipo no para por su cuenta (ni por lluvia ni por daños): te avisa y decides tú.
import { COMPOUNDS } from './teams.js';
import { MGR, wetGrip, isFP } from './sim.js';
import { TeamSim } from './teamsim.js';

const DRY = ['S', 'M', 'H'], TYRES = ['S', 'M', 'H', 'I', 'W'];
const LEVERS = [
  ['pace', 'RITMO', [['save', 'Cuidar'], ['normal', 'Normal'], ['push', 'Atacar']]],
  ['ers', 'MOTOR', [['charge', 'Recargar'], ['normal', 'Normal'], ['boost', 'Ataque']]],
  ['fight', 'PELEA', [['calm', 'Prudente'], ['normal', 'Normal'], ['hard', 'Agresivo']]],
];
// lo que cuesta cada opción (medido solo en pista y sin aprender, media de 4 circuitos): [en el botón, debajo al elegirla]
const COST = {
  pace: { save: ['+1,3 s/v', 'Gasta la mitad de goma y casi no comete errores.'], normal: ['—', 'Ritmo de carrera normal.'], push: ['−0,9 s/v', 'Goma ×1,8 y más errores: salidas y trompos.'] },
  ers: { charge: ['+0,6 s/v', 'Menos potencia; recarga la batería (40 % por vuelta).'], normal: ['—', 'Batería estable.'], boost: ['−0,6 s/v', 'Más potencia en recta; vacía la batería en 2 vueltas.'] },
  fight: { calm: ['no defiende', 'Ni cierra la puerta ni se tira. En libres y clasificación se aparta en cuanto llega alguien lanzado.'], normal: ['—', 'Ataca y defiende según su carácter.'], hard: ['+riesgo', 'Ataca antes y se tira más en la frenada. En libres y clasificación no cede y se quita de encima a los lentos: aire libre.'] },
};
// programa de la salida: lanzadas (cada una con su vuelta para enfriar), tanda seguida o hasta que se le llame; con las vueltas
// que se quieran. La gasolina sale de las vueltas (1,7 kg por vuelta en libres y clasificación, más la de salida y la de entrada)
const PROG_N = { quali: 'Lanzadas', long: 'Tanda seguida', free: 'Hasta que diga' };
const prog = (n) => {
  const laps = n.kind === 'free' ? 0 : Math.max(1, n.laps || 1);
  const fuel = n.kind === 'free' ? 45 : Math.ceil(((n.kind === 'quali' ? laps * 2 : laps) + 2) * 1.7 + 2);
  const l = n.kind === 'free' ? 'hasta que diga' : n.kind === 'quali' ? `${laps} ${laps === 1 ? 'lanzada' : 'lanzadas'}` : `tanda de ${laps} vueltas`;
  return { kind: n.kind === 'free' ? 'long' : n.kind, laps, fuel, l };
};
const TRIMS = [[-1, 'Poca'], [-0.5, '·'], [0, 'Media'], [0.5, '·'], [1, 'Mucha']];
const SUSPS = [[-1, 'Blanda'], [0, 'Media'], [1, 'Dura']];
const TRIM_N = { '-1': 'Poca', '-0.5': 'Media−', 0: 'Media', 0.5: 'Media+', 1: 'Mucha' };
const SUSP_N = { '-1': 'Blanda', 0: 'Media', 1: 'Dura' };
const PACE_N = { save: 'Cuidar', normal: 'Normal', push: 'Atacar' }, ERS_N = { charge: 'Recargar', normal: 'Normal', boost: 'Ataque' };
// agua en la trazada en esa vuelta y condición: seco (< 20 %) o mojado; la vuelta vale si la goma era la de esa agua
// (lisos en seco, intermedios con pista húmeda, lluvia extrema empapada): las de mojado con la goma buena cuentan, aparte
const waterOf = (l) => l.water ?? (l.wet ? 0.3 : 0);
const condOf = (l) => (waterOf(l) < 0.2 ? 'dry' : 'wet');
const rightTyre = (l) => { const w = waterOf(l); return w < 0.2 ? !COMPOUNDS[l.c].wet : l.c === 'I' ? w < 0.85 : l.c === 'W' ? w > 0.65 : false; };
const usable = (l) => l.ok && rightTyre(l);
const PTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const PIT_LOSS = 22;
const fmt = (t) => (isFinite(t) && t > 0 ? `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}` : '—');
const nf = (x, d = 1) => x.toFixed(d).replace('.', ',');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tyre = (c, extra = '') => `<span class="ty" style="--tc:${COMPOUNDS[c].color}" title="${COMPOUNDS[c].name}">${c}</span>${extra}`;
const med = (v) => { if (!v.length) return NaN; v = v.slice().sort((a, b) => a - b); return v[v.length >> 1]; };

export class Manager {
  // opts.headless: muro de otro jugador (multijugador). Su lógica corre igual en todas las máquinas (para que la simulación
  // sea idéntica), pero sin panel, avisos ni radio: eso solo lo ve quien lleva el equipo
  constructor(sim, dir, teamId, app, opts = {}) {
    this.sim = sim; this.dir = dir; this.app = app; this.teamId = teamId; this.headless = !!opts.headless;
    this.cars = sim.cars.filter((c) => c.team.id === teamId);
    for (const c of this.cars) {
      c.mgr = { pace: 'normal', ers: 'normal', fight: 'normal', laps: [], stopsLog: [], stopNow: false, boxReq: false, go: null, next: { c: 'M', fresh: true, kind: 'free', laps: 8, test: false, cool: true, repeat: true }, draft: null, owed: 0, simLaps: 0 };
      c.trim = 0; c.susp = 0;
    }
    sim.managed = teamId; this.ord = { hold: false, yield: null };
    this.alerts = []; this.log = []; this.sel = 0; this.gOpen = false; this.gTab = 'setup'; this.stSel = null; this.pf = 'all'; this.pv = 'chart'; this.ps = 'all'; this.pg = 'setup'; this.po = 'order'; this.pt = 'all'; this.pw = 'dry';
    this.pauseOnAlert = false; this.t = 0; this.gt = 0; this.seq = 0; this.jobs = new Map();
    if (this.headless) { sim.on((e) => this.onEvent(e)); return; }
    document.body.classList.add('mgr');
    const hud = document.getElementById('hud');
    this.el = document.createElement('div'); this.el.id = 'mgr'; hud.appendChild(this.el);
    this.gel = document.createElement('div'); this.gel.id = 'garage'; this.gel.className = 'hidden'; hud.appendChild(this.gel);
    // pointerdown (no click): el panel se redibuja 4 veces por segundo y un clic a medias se perdía
    const down = (e) => { if (e.button === 0) this.onAct(e); };
    this.el.addEventListener('pointerdown', down);
    this.gel.addEventListener('pointerdown', down);
    // avisos: columna propia a la izquierda del muro (dentro se comían el sitio de las palancas y se cortaban)
    this.alEl = document.createElement('div'); this.alEl.id = 'mgrAl'; this.alEl.className = 'als hidden'; hud.appendChild(this.alEl);
    this.alEl.addEventListener('pointerdown', down);
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'g') { this.toggleGarage(); e.stopImmediatePropagation(); }
      else if (k === 'escape' && this.gOpen && !document.querySelector('.modal')) { this.toggleGarage(false); e.stopImmediatePropagation(); }
    }, true);
    sim.on((e) => this.onEvent(e));
    this.render();
  }

  get car() { return this.cars[this.sel]; }
  // órdenes de equipo: una por equipo (en multijugador hay varios muros en la misma carrera)
  get ord() { return this.sim.teamOrders?.[this.teamId]; }
  set ord(v) { (this.sim.teamOrders ||= {})[this.teamId] = v; }
  race() { return this.sim.session?.id === 'RACE'; }
  onGrid() { const s = this.sim.session; return s?.id === 'RACE' && s.phase === 'grid' && this.sim.gridHold; }
  canSetup(c) { const s = this.sim.session; if (!s || s.done) return false; return s.id === 'RACE' ? this.onGrid() : c.state === 'garage' && !c.out; }
  say(car, lines, prio = 2) { if (!this.headless) this.app.radio?.say(car, lines, prio); }
  note(car, txt) { this.log.push({ s: this.sim.session?.id, lap: Math.max(0, car.lap), car, txt, pos: car.pos, t: this.sim.t }); }

  toggleGarage(open = !this.gOpen, tab) {
    if (this.headless) return;
    this.gOpen = open; if (tab) this.gTab = tab;
    this.gel.classList.toggle('hidden', !open); document.body.classList.toggle('garageOpen', open);
    this.gHTML = null; if (open) this.renderGarage(); this.render();
  }

  // ------------------------------------------------------------------ acciones
  // clic en el muro o el garaje: lo que solo cambia la vista se hace aquí; lo que toca la simulación es un comando
  // (en multijugador va al anfitrión, que lo reparte a todos en el mismo instante de la simulación)
  onAct(e) {
    const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
    e.preventDefault();
    const sim = this.sim, a = b.dataset.a, v = b.dataset.v;
    const car = b.dataset.i != null ? sim.cars[+b.dataset.i] : this.car;
    switch (a) {
      case 'sel': this.sel = +v; this.stSel = null; this.dir.setFocus(this.car); break;
      case 'focus': this.dir.setFocus(car); break;
      case 'garage': this.toggleGarage(); break;
      case 'mtoggle': this.el.classList.toggle('open'); break;   // (en el móvil el muro se pliega en su barra)
      case 'gclose': this.toggleGarage(false); break;
      case 'gtab': this.gTab = v; break;
      case 'pauseAl': this.pauseOnAlert = !this.pauseOnAlert; break;
      case 'pt': this.pt = v; break;
      case 'pw': this.pw = v; break;
      case 'stsel': this.stSel = +v; break;
      case 'pf': this.pf = v; break;
      case 'pv': this.pv = v; break;
      case 'ps': this.ps = v; break;
      case 'pg': this.pg = v; break;
      case 'po': this.po = v; break;
      case 'stdrag': this.startDrag(e, car, +v); return;
      case 'al': {
        const al = this.alerts.find((x) => x.id === +v); if (!al) break;
        const act = al.acts[+b.dataset.k]; this.alerts = this.alerts.filter((x) => x !== al);
        this.cmd({ a: 'op', op: act.op || null, i: al.car.i, txt: `${al.title}: ${act.l}` });
        if (act.reply) this.say(al.car, [['e', act.reply]], 3);
        if (this.pausedBy === al.id && this.app.speed === 0) this.app.reqSpeed(this.app.lastSpeed || 1);
        break;
      }
      case 'stc': this.cmd({ a, v, x: +b.dataset.k, i: car.i }); break;
      case 'start': if (this.sim.gridReady?.has(this.teamId)) break; this.toggleGarage(false); this.cmd({ a }); break;
      default: this.cmd({ a, v, x: b.dataset.k, i: car?.i });
    }
    this.gHTML = null; this.render(); if (this.gOpen) this.renderGarage();
  }
  cmd(c) { if (this.app.mp) this.app.mp.cmd({ ...c, k: 'mgr', team: this.teamId }); else this.exec(c); }

  // aplica un comando del muro (en todas las máquinas a la vez en multijugador)
  exec(c) {
    const sim = this.sim, a = c.a, v = c.v;
    const car = c.i != null ? sim.cars[c.i] : this.car, M = car?.mgr;
    if (car && car.team.id !== this.teamId) return;
    const N = { push: 'Atacar', normal: 'Normal', save: 'Cuidar', boost: 'Ataque', charge: 'Recargar', calm: 'Prudente', hard: 'Agresivo' };
    this.execing = true;
    try {
    switch (a) {
      case 'lev': {
        const k = c.x; if (!LEVERS.some(([x]) => x === k) || M[k] === v) break;
        M[k] = v; if (k === 'pace') sim.rebuildProfile(car);
        this.note(car, `${{ pace: 'Ritmo', ers: 'Motor', fight: 'Pelea' }[k]}: ${N[v] || 'Normal'}`);
        if (this.race() && k === 'pace') this.say(car, [['e', v === 'push' ? 'Modo ataque: todo lo que tengas.' : v === 'save' ? 'Gestiona las gomas, levanta en las rápidas.' : 'Vuelve al ritmo normal.'], ['d', 'Copiado.']], 1);
        break;
      }
      case 'stop': this.stopToggle(car); break;
      case 'go': this.goOut(car); break;
      case 'box': {
        if (car.lapKind === 'in' && !M.boxReq) break;
        M.boxReq = !M.boxReq; car.pitReq = M.boxReq;
        this.note(car, M.boxReq ? 'Box esta vuelta' : 'Cancela la vuelta a boxes');
        if (M.boxReq) this.say(car, [['e', 'Box, box. Vuelve al garaje.']], 1);
        break;
      }
      case 'order': if (this.race()) this.setOrder(v); break;
      case 'start': {
        // la salida se da cuando todos los muros están listos (en solitario, al momento)
        if (!this.onGrid()) break;
        const ready = (sim.gridReady ||= new Set()); ready.add(this.teamId);
        const all = this.app.managers || [this];
        if (all.every((m) => ready.has(m.teamId) || sim.dropped?.has(m.teamId))) { sim.gridHold = false; for (const m of all) m.release(); }
        break;
      }
      case 'op': this.runOp(c.op); if (car && c.txt) this.note(car, String(c.txt).slice(0, 80)); break;
      case 'stmove': {
        const P = this.plan(car), k = +c.x; if (!P.st[k + 1]) break;
        const [lo, hi] = this.stopRange(car, P, k); P.st[k].to = Math.max(lo, Math.min(hi, Math.round(+v)));
        this.afterEdit(car, 'Mueve parada');
        break;
      }
      // garaje
      case 'trim': if (this.canSetup(car)) { car.trim = +v; sim.rebuildProfile(car); } break;
      case 'susp': if (this.canSetup(car)) { car.susp = +v; sim.rebuildProfile(car); } break;
      case 'ntyre': M.next.c = v; if (v !== car.tyre.c || !(car.tyre.wear > 0)) M.next.fresh = true; break;
      case 'nfresh': M.next.fresh = v === '1'; break;
      case 'nprog': M.next.kind = v; if (v === 'quali' && M.next.laps > 4) M.next.laps = 1; if (v === 'long' && M.next.laps < 3) M.next.laps = 8; break;
      case 'ncool': M.next.cool = v === '1'; break;
      case 'nrep': M.next.repeat = v === '1'; break;
      case 'nextlap': M.nextLap = v; this.note(car, v === 'cool' ? 'Siguiente vuelta: enfriar' : 'Siguiente vuelta: lanzada'); break;
      case 'simnow': this.applySim(car); break;
      case 'nlaps': M.next.laps = Math.max(1, Math.min(30, (M.next.laps || 1) + +v)); break;
      case 'ntest': M.next.test = v === '1'; break;
      case 'stc': if (TYRES.includes(v)) this.setCompound(car, +c.x, v); break;
      case 'stadd': this.addStop(car); break;
      case 'stdel': this.delStop(car, +v); break;
      case 'stsug': { const P = this.plan(car), s = this.suggest(car); if (s) { P.st.splice(P.k0, P.st.length - P.k0, ...s.st); this.afterEdit(car, 'Plan sugerido'); } break; }
    }
    } finally { this.execing = false; }
    if (!this.headless) { this.gHTML = null; this.render(); if (this.gOpen) this.renderGarage(); }
  }

  // salida dada: el plan con el que sale cada coche (para el resumen)
  release() {
    this.toggleGarage(false);
    for (const c of this.cars) c.mgr.plan0 = c.strategy.stints.map((x) => ({ ...x }));
    for (const c of this.cars) this.note(c, `Sale con ${COMPOUNDS[c.tyre.c].name.toLowerCase()} · ${c.strategy.stints.map((x) => x.c).join('-')}`);
  }

  // respuestas de los avisos: operaciones con nombre (no funciones) para poder mandarlas por la red
  runOp(op) {
    if (!Array.isArray(op)) return;
    const [name, i, x, y] = op, car = this.sim.cars[i];
    if (!car || car.team.id !== this.teamId) return;
    const M = car.mgr;
    switch (name) {
      case 'order': if (this.race() && ['free', 'hold', 'swap'].includes(x)) this.setOrder(x); break;
      case 'stopNow': this.sim.mgrStopNow(car, x || undefined); car.pitReq = true; break;
      case 'set': if (['pace', 'ers', 'fight', 'nextLap'].includes(x)) M[x] = y; break;
      case 'next': Object.assign(M.next, x); break;
      case 'boxNow': M.boxReq = true; car.pitReq = true; break;
      case 'okLap': { const run = car.run || {}; car.pushN = (car.pushN || 0) + 1; if (run.laps && car.pushN >= run.laps && car.lapKind !== 'in') { car.lapKind = 'in'; car.pitReq = true; } break; }
      case 'qout': Object.assign(M.next, { c: 'S', fresh: true, kind: 'quali', laps: 1, test: false }); this.goOut(car); break;
    }
  }

  // carrera: «para en esta vuelta» (o cancelar la parada, sea la pedida o la del plan)
  stopToggle(car) {
    const M = car.mgr, sts = car.strategy?.stints; if (!sts || car.inPit) return;
    const st = sts[car.stint], due = car.stint < sts.length - 1 && car.lap + 1 >= st.to;
    if (M.stopNow || due) {
      const was = M.stopNow; M.stopNow = false;
      // la del plan se retrasa dos vueltas (luego se puede mover en el garaje)
      // (y las de después con ella: si no, la siguiente tanda se quedaba en 1 vuelta y paraba otra vez)
      if (due && !was) {
        const N = this.sim.raceLaps, d = Math.min(N - 1, car.lap + 3) - st.to;
        for (let k = car.stint; k < sts.length - 1; k++) sts[k].to = Math.min(N - 1, sts[k].to + d);
        for (let k = sts.length - 1; k > car.stint; k--) if ((k === sts.length - 1 ? N : sts[k].to) - sts[k - 1].to < 2) { sts[k - 1].to = sts[k].to; sts.splice(k, 1); }
        this.fixPlan(car);
      }
      car.pitReq = false; this.note(car, due ? `Retrasa la parada a la V${st.to}` : 'Cancela la parada');
      this.say(car, [['e', 'Cancela, cancela. Quédate fuera.'], ['d', 'Entendido.']], 3);
    } else {
      this.sim.mgrStopNow(car); car.pitReq = true;
      const nx = sts[car.stint + 1]?.c || car.tyre.c;
      this.note(car, `Para en esta vuelta (${COMPOUNDS[nx].name.toLowerCase()})`);
      this.say(car, [['e', `Box, box. Ponemos ${COMPOUNDS[nx].name.toLowerCase()}.`], ['d', 'Copiado.']], 3);
    }
  }
  // libres / clasificación: salir a pista con la goma, el juego y el programa elegidos en el garaje
  goOut(car) {
    const M = car.mgr, p = prog(M.next);
    if (car.state !== 'garage' || this.sim.session?.phase !== 'run') return;
    if (!M.next.test) this.applySim(car); else this.endJob(car);
    M.go = { c: M.next.c, fresh: M.next.fresh, kind: p.kind, laps: p.laps, fuel: p.fuel + (p.kind === 'quali' && M.next.repeat ? 4 : 0), test: M.next.test && isFP(this.sim.session.id), cool: M.next.cool, repeat: M.next.repeat };
    M.nextLap = null;
    M.boxReq = false; this.toggleGarage(false);
    this.note(car, `Sale: ${COMPOUNDS[M.next.c].name.toLowerCase()} ${M.next.fresh ? 'nuevo' : 'usado'}, ${p.l.toLowerCase()}`);
  }
  setOrder(v) {
    const o = this.sim.raceOrder || [], [a, b] = this.cars, lead = o.indexOf(a) < o.indexOf(b) ? a : b, trail = lead === a ? b : a;
    this.ord = { hold: v !== 'free', yield: v === 'swap' ? lead : null, trail: v === 'swap' ? trail : null };
    if (v === 'swap') { this.say(lead, [['e', `${lead.drv.first}, deja pasar a ${trail.drv.last}. Es una orden de equipo.`], ['d', '…Entendido.']], 3); this.note(lead, `Orden: deja pasar a ${trail.code}`); }
    else if (v === 'hold') { for (const c of this.cars) this.say(c, [['e', 'Mantened posiciones. No hay que pelear entre vosotros.']], 2); this.note(lead, 'Orden: mantener posiciones'); }
    else this.note(lead, 'Orden: pilotos libres');
  }

  // ------------------------------------------------------------------ plan de paradas
  plan(car) {
    if (this.drag?.car === car) return this.drag.P;   // arrastrando una parada: copia local hasta soltarla
    if (this.race() && car.strategy) return { st: car.strategy.stints, k0: this.onGrid() ? 0 : car.stint, live: true };
    const M = car.mgr;
    if (!M.draft || M.draft[M.draft.length - 1].to !== this.sim.raceLaps) {
      const d = this.suggest(car, true)?.st || [{ c: 'M', from: 0, to: this.sim.raceLaps }];
      // (en multijugador el borrador solo se guarda dentro de un comando: si no, cada máquina lo fijaría en un momento distinto)
      if (this.app.mp && !this.execing) return { st: d, k0: 0, live: false };
      M.draft = d;
    }
    return { st: M.draft, k0: 0, live: false };
  }
  // límites de una parada (entre la tanda k y la k+1)
  stopRange(car, P, k) {
    const st = P.st; let lo = st[k].from + 1; const hi = st[k + 1].to - 1;
    if (P.live && !this.onGrid() && k === car.stint) lo = Math.max(lo, car.lap + 1);
    return [lo, hi];
  }
  canComp(car, P, k) { return k > P.k0 || (k === P.k0 && (!P.live || this.onGrid())); }
  fixPlan(car, P = this.plan(car)) {
    const st = P.st, N = this.sim.raceLaps;
    for (let k = 1; k < st.length; k++) st[k].from = st[k - 1].to;
    st[st.length - 1].to = N;
  }
  afterEdit(car, what) {
    const P = this.plan(car); this.fixPlan(car, P);
    // en la parrilla, la goma de salida se monta ya
    if (P.live && this.onGrid() && car.tyre.c !== P.st[0].c) { car.tyre = { c: P.st[0].c, wear: 0, temp: 0.75, age: 0, used: new Set([P.st[0].c]) }; this.sim.rebuildProfile(car); }
    if (P.live && !this.onGrid()) this.note(car, `${what} · ${P.st.slice(car.stint).map((x, k) => (k ? `V${x.from} ` : '') + x.c).join(' → ')}`);
  }
  setCompound(car, k, c) { const P = this.plan(car); if (!P.st[k] || !this.canComp(car, P, k)) return; P.st[k].c = c; this.afterEdit(car, 'Cambia goma'); }
  addStop(car) {
    const P = this.plan(car), st = P.st;
    // parte en dos la tanda más larga que aún se pueda tocar
    let best = -1, len = 0;
    for (let k = P.k0; k < st.length; k++) {
      const from = P.live && !this.onGrid() && k === car.stint ? Math.max(st[k].from, car.lap + 1) : st[k].from, n = st[k].to - from;
      if (n > len) { len = n; best = k; }
    }
    if (best < 0 || len < 4) return;
    const s = st[best], from = P.live && !this.onGrid() && best === car.stint ? Math.max(s.from, car.lap + 1) : s.from, mid = Math.round(from + len / 2);
    const c = DRY.find((x) => x !== s.c && !st.some((y) => y.c === x)) || (s.c === 'H' ? 'M' : 'H');
    st.splice(best + 1, 0, { c, from: mid, to: s.to }); s.to = mid; this.stSel = best + 1;
    this.afterEdit(car, 'Añade parada');
  }
  delStop(car, k) {
    const P = this.plan(car), st = P.st; if (k < P.k0 || !st[k + 1]) return;
    st[k].to = st[k + 1].to; st.splice(k + 1, 1); this.stSel = null;
    this.afterEdit(car, 'Quita parada');
  }
  startDrag(e, car, k) {
    const svg = e.target.closest('svg'); if (!svg) return;
    const r = svg.getBoundingClientRect(), N = this.sim.raceLaps, vb = svg.viewBox.baseVal;
    this.dragging = true;
    // se arrastra una copia del plan; al soltar, la parada se mueve con un comando (igual en todas las máquinas)
    const P0 = this.plan(car), to0 = P0.st[k]?.to;
    this.drag = { car, P: { ...P0, st: P0.st.map((x) => ({ ...x })) } };
    const move = (ev) => {
      const P = this.plan(car); if (!P.st[k + 1]) return;
      const x = ((ev.clientX - r.left) / r.width) * vb.width, lap = Math.round(((x - 34) / (vb.width - 50)) * N);
      const [lo, hi] = this.stopRange(car, P, k), l = Math.max(lo, Math.min(hi, lap));
      if (l !== P.st[k].to) { P.st[k].to = l; this.fixPlan(car, P); this.gHTML = null; this.renderGarage(true); }
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); this.dragging = false;
      const to = this.drag?.P.st[k]?.to; this.drag = null;
      if (to != null && to !== to0) this.cmd({ a: 'stmove', i: car.i, x: k, v: to });
      this.gHTML = null; this.renderGarage();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }

  // desgaste por vuelta de carrera con esa goma (del rendimiento real del equipo si ya hay vueltas; si no, el medio de la sim)
  wearK(c) {
    const C = COMPOUNDS[c], ks = [];
    for (const car of this.cars) for (const l of car.mgr.laps) {
      if (l.c !== c || !usable(l) || condOf(l) !== 'dry') continue;
      const sc = l.s === 'RACE' ? this.sim.raceLaps : 20, f = MGR.pace[l.pace].wear * (1 + 0.1 * l.susp);
      ks.push(((l.w1 - l.w0) * sc) / (C.wear * f));
    }
    return ks.length >= 3 ? med(ks.slice(-14)) : MGR.WEAR_K;
  }
  wpl(car, c) { return (COMPOUNDS[c].wear * this.wearK(c) * MGR.pace[car.mgr.pace].wear * (1 + 0.1 * (car.susp || 0))) / this.sim.raceLaps; }
  // desgaste al final de cada vuelta: lo real hasta ahora y lo previsto después
  project(car, P) {
    const N = this.sim.raceLaps, st = P.st, out = new Array(N + 1).fill(null), real = new Map();
    if (P.live) for (const l of car.mgr.laps) if (l.s === 'RACE') real.set(l.lap, l.w1);
    const now = P.live && !this.onGrid() ? car.lap : -1;
    st.forEach((s, k) => {
      let w = k === 0 ? (P.live ? car.mgr.plan0Wear ?? 0.05 : 0.05) : 0;
      const r = this.wpl(car, s.c);
      for (let l = s.from + 1; l <= s.to; l++) {
        if (l <= now) { w = real.get(l) ?? w + r; out[l] = { w, c: s.c, k, real: true }; continue; }
        if (l === now + 1 && k === car.stint) w = car.tyre.wear;
        w += r; out[l] = { w, c: s.c, k, real: false };
      }
    });
    return out;
  }
  // tiempo que cuesta un plan (goma, desgaste, precipicio, paradas), relativo: sirve para comparar planes
  rates(car) { const R = {}; for (const c of TYRES) R[c] = this.wpl(car, c); return R; }
  cost(car, st, w0, from, wl, R = this.rates(car)) {
    const base = isFinite(car.best) ? car.best : 85; let t = 0;
    st.forEach((s, k) => {
      const r = R[s.c]; let w = k === 0 ? w0 : 0;
      for (let l = (k === 0 ? from : s.from) + 1; l <= s.to; l++) {
        let g = COMPOUNDS[s.c].grip * wetGrip(s.c, wl) * (1 - 0.07 * w);
        if (w > 0.72) g *= Math.max(0.72, 1 - (w - 0.72) * 1.15);
        t += base * 0.5 * (1 - g / 0.994); w += r;
      }
      if (k > 0) t += PIT_LOSS;
    });
    return t;
  }
  // el mejor plan de 0, 1 o 2 paradas desde aquí (con la regla de usar dos compuestos de seco si la carrera es en seco)
  suggest(car, draft = false) {
    const sim = this.sim, N = sim.raceLaps, wl = sim.wx?.line ?? 0;
    const live = !draft && this.race() && car.strategy && !this.onGrid();
    const R = this.rates(car), key = [car.code, live, live ? car.lap : -1, live ? car.tyre.c : '', Math.round(wl * 20), ...TYRES.map((c) => R[c].toFixed(4))].join('|');
    if (this.sugMemo?.key === key) return this.sugMemo.v && { t: this.sugMemo.v.t, st: this.sugMemo.v.st.map((x) => ({ ...x })) };
    const from = live ? car.lap : 0, w0 = live ? car.tyre.wear : 0.05, used = live ? car.tyre.used : new Set();
    const cands = wl > 0.2 ? TYRES : DRY, firsts = live ? [car.tyre.c] : cands;
    const legal = (cs) => wl > 0.2 || cs.some((c) => COMPOUNDS[c].wet) || used.has('I') || used.has('W') || new Set([...used, ...cs].filter((c) => !COMPOUNDS[c].wet)).size >= 2;
    let best = null;
    const tryP = (st) => { if (!legal(st.map((x) => x.c))) return; const t = this.cost(car, st, w0, from, wl, R); if (!best || t < best.t) best = { t, st }; };
    for (const a of firsts) {
      tryP([{ c: a, from: 0, to: N }]);
      for (const b of cands) for (let p = from + 2; p <= N - 2; p++) {
        tryP([{ c: a, from: 0, to: p }, { c: b, from: p, to: N }]);
        for (const c of cands) for (let q = p + 3; q <= N - 2; q++) tryP([{ c: a, from: 0, to: p }, { c: b, from: p, to: q }, { c, from: q, to: N }]);
      }
    }
    if (best && live) { best.st[0].from = car.strategy.stints[car.stint].from; }
    this.sugMemo = { key, v: best };
    return best && { t: best.t, st: best.st.map((x) => ({ ...x })) };
  }

  // ------------------------------------------------------------------ avisos (decisiones que esperan respuesta)
  alert(car, key, title, text, acts, opts = {}) {
    // (simulando el resto de la sesión no hay nadie en el muro: decide la IA)
    if (this.headless || this.sim.autoMgr || this.alerts.some((a) => a.key === car.code + key)) return;
    const al = { id: ++this.seq, car, key: car.code + key, title, text, acts, born: performance.now(), ttl: (opts.ttl || 16) * 1000, valid: opts.valid };
    this.alerts.unshift(al); if (this.alerts.length > 4) this.alerts.length = 4;
    if (opts.voice) this.say(car, opts.voice, 3);
    if (this.pauseOnAlert && this.app.speed > 0) { this.pausedBy = al.id; this.app.reqSpeed(0); }
    this.render();
  }
  stopAct(car, c, l) { return { l, op: ['stopNow', car.i, c], reply: `Box, box. Ponemos ${COMPOUNDS[c || car.strategy.stints[car.stint + 1]?.c || car.tyre.c].name.toLowerCase()}.` }; }
  around(c) { const o = this.sim.raceOrder || [], k = o.indexOf(c); return { ah: k > 0 ? o[k - 1] : null, bh: k >= 0 && k < o.length - 1 ? o[k + 1] : null }; }

  onEvent(e) {
    const sim = this.sim, race = this.race(), c = e.car, mine = c && this.cars.includes(c);
    // modo consistente: cada vuelta lanzada en seco es una vuelta de aprendizaje que queda pendiente para el simulador
    if (e.type === 'lap' && mine && c.testRun && sim.wx.line < 0.15) c.mgr.owed++;
    // (lo pendiente no se aplica al volver al garaje: así todas las tandas consistentes seguidas se comparan con el mismo piloto;
    // se aplica al acabar la sesión, al salir en modo «Aprende» o con el botón del garaje)
    if (e.type === 'sessionEnd' && isFP(e.id)) for (const m of this.cars) this.applySim(m);
    if (e.type === 'session' && !isFP(e.id)) for (const m of this.cars) this.applySim(m);
    if (e.type === 'session') {
      this.alerts = []; this.ord = { hold: false, yield: null }; sim.gridReady = new Set();
      for (const m of this.cars) { Object.assign(m.mgr.next, isFP(e.id) ? { kind: 'free' } : { kind: 'quali', laps: 1 }); m.mgr.next.c = isFP(e.id) ? 'M' : 'S'; m.mgr.next.fresh = true; m.mgr.next.test = false; }
      if (e.id === 'RACE') {
        sim.gridHold = true;
        for (const m of this.cars) m.mgr.plan0Wear = m.tyre.wear;
        this.toggleGarage(true, 'strat');
      } else this.toggleGarage(true, 'setup');
      return;
    }
    if (e.type === 'flag' && race && e.flag === 'VSC') {
      for (const m of this.cars) if (!m.inPit && !m.retired && !m.finished && sim.raceLaps - m.lap > 1)
        this.alert(m, 'vsc', 'VSC', `Coche virtual de seguridad: parar ahora cuesta ~${nf(PIT_LOSS * 0.45, 0)} s menos.`, [this.stopAct(m, null, 'Box ahora'), { l: 'Seguimos fuera', reply: 'Nos quedamos fuera. Respeta el delta.' }], { valid: () => sim.flag === 'VSC' && !m.inPit });
      return;
    }
    if (e.type === 'weather' && (e.what === 'rainStart' || e.what === 'rainMore')) {
      const W = sim.wx, nx = W.ev.find((x) => x.t > sim.t), mins = nx ? Math.max(1, Math.round((nx.t - sim.t) / 60)) : null;
      for (const m of this.cars) {
        if (m.retired || m.finished || COMPOUNDS[m.tyre.c].wet) continue;
        const txt = `${e.what === 'rainStart' ? 'Empieza a llover' : 'Llueve más'} (${W.target > 0.6 ? 'fuerte' : W.target > 0.3 ? 'moderada' : 'débil'}).${mins ? ` Cambia en ~${mins} min.` : ''}`;
        if (m.state === 'garage') this.alert(m, 'rainG', 'LLUVIA', txt, [{ l: 'Intermedios para salir', op: ['next', m.i, { c: 'I', fresh: true }] }, { l: 'Lluvia extrema', op: ['next', m.i, { c: 'W', fresh: true }] }, { l: 'Ignorar' }]);
        else if (race) this.alert(m, 'rain', 'LLUVIA', txt, [this.stopAct(m, 'I', 'Box: intermedios'), this.stopAct(m, 'W', 'Box: lluvia'), { l: 'Seguimos con lisos', reply: 'Seguimos con lisos. Dinos cómo está.' }], { ttl: 20, voice: [['d', 'Está empezando a llover.']] });
        else this.alert(m, 'rain', 'LLUVIA', txt, [{ l: 'Box ya', op: ['boxNow', m.i], reply: 'Box, box.' }, { l: 'Sigue' }]);
      }
      return;
    }
    if (e.type === 'badlap' && mine) {
      const run = c.run || {};
      this.alert(c, 'bad' + c.lap, e.why === 'tráfico' ? 'TRÁFICO' : 'VUELTA MALA', `${c.code}: lanzada ${e.why === 'tráfico' ? 'con tráfico' : 'con un error'}. No cuenta: la repite (${c.pushN || 0}/${run.laps} hechas).`,
        [{ l: 'Repetir', reply: 'No vale, otra vuelta.' }, { l: 'Vale así', op: ['okLap', c.i], reply: 'Nos vale. Seguimos con el programa.' },
         { l: 'Enfriar antes', op: ['set', c.i, 'nextLap', 'cool'], reply: 'Vuelta tranquila y lo intentamos otra vez.' }], { ttl: 20, valid: () => c.state !== 'garage' });
      return;
    }
    if (!race) {
      if (e.type === 'debris' && mine && e.broken && c.state !== 'garage') this.alert(c, 'dmg' + e.part, 'DAÑOS', `${c.code}: ${{ fw: 'alerón delantero', rw: 'alerón trasero', susp: 'suspensión' }[e.part]} roto.`, [{ l: 'Box ya', op: ['boxNow', c.i], reply: 'Vuelve a boxes con cuidado.' }, { l: 'Sigue' }]);
      return;
    }
    // carrera
    if (e.type === 'pitin' && c && !mine) {
      for (const m of this.cars) {
        if (m.inPit || m.retired || m.finished || sim.raceLaps - m.lap < 3) continue;
        const { ah, bh } = this.around(m);
        if (!((c === ah && sim.gapTo(m, c) < 3) || (c === bh && sim.gapTo(c, m) < 3))) continue;
        this.alert(m, 'rival' + c.code, c === bh ? 'UNDERCUT' : 'RIVAL EN BOXES', c === bh ? `${c.code} para detrás de ${m.code}. Puede salir delante con goma nueva.` : `${c.code} para delante de ${m.code}. Si paramos ya, intentamos el undercut.`,
          [this.stopAct(m, null, c === bh ? 'Cubrir: box ya' : 'Undercut: box ya'), { l: 'Overcut: atacar', op: ['set', m.i, 'pace', 'push'], reply: 'Nos quedamos fuera. Vueltas de clasificación: empuja.' }, { l: 'Ignorar' }], { valid: () => !m.inPit });
      }
      return;
    }
    if (!mine) return;
    if (e.type === 'debris' && e.broken && !c.inPit) {
      this.alert(c, 'dmg' + e.part, 'DAÑOS', `${c.code}: ${{ fw: 'alerón delantero', rw: 'alerón trasero', susp: 'suspensión' }[e.part]} roto. En boxes se arregla (+${e.part === 'susp' ? 7 : 7} s).`,
        [this.stopAct(c, null, 'Box: reparar'), { l: 'Seguir así', reply: 'Seguimos. Cuidado en las rápidas.' }], { ttl: 20, valid: () => !c.inPit });
      return;
    }
    if (e.type === 'lap' && !c.finished && !c.inPit) this.raceLap(c);
  }

  // cada vuelta de carrera: lo que puede pedir una decisión
  raceLap(c) {
    const sim = this.sim, M = c.mgr, left = sim.raceLaps - c.lap, { ah, bh } = this.around(c), W = sim.wx;
    const gA = ah ? sim.gapTo(c, ah) : null, gB = bh && !bh.retired ? sim.gapTo(bh, c) : null, pA = c.mgA, pB = c.mgB; c.mgA = gA; c.mgB = gB;
    const sts = c.strategy.stints, st = sts[c.stint], stopSoon = c.stint < sts.length - 1 && st.to - c.lap <= 2;
    const slick = !COMPOUNDS[c.tyre.c].wet;
    if (M.ers === 'boost' && c.ers <= 0.02) this.alert(c, 'bat', 'BATERÍA', `${c.code} sin batería: el modo ataque ya no da nada.`, [{ l: 'Recargar', op: ['set', c.i, 'ers', 'charge'] }, { l: 'Normal', op: ['set', c.i, 'ers', 'normal'] }]);
    if (slick && W.line > 0.3 && left > 1) this.alert(c, 'wetslick', 'SIN AGARRE', 'No hay agarre con lisos.', [this.stopAct(c, W.line > 0.75 ? 'W' : 'I', `Box: ${W.line > 0.75 ? 'lluvia' : 'intermedios'}`), { l: 'Aguanta', reply: 'Aguanta una vuelta más.' }], { voice: [['d', pick(['No hay agarre, esto es una pista de hielo.', '¡No puedo con los lisos!'])]], valid: () => !c.inPit });
    else if (!slick && W.line < 0.14 && W.target < 0.1 && left > 2) this.alert(c, 'dry', 'SE SECA', 'La trazada se seca: las gomas de agua se deshacen.', [this.stopAct(c, left < sim.raceLaps * 0.42 ? 'S' : 'M', `Box: ${left < sim.raceLaps * 0.42 ? 'blandos' : 'medios'}`), this.stopAct(c, 'H', 'Box: duros'), { l: 'Aguanta' }], { voice: [['d', 'La trazada está seca.']], valid: () => !c.inPit });
    else if (c.tyre.wear > 0.62 && left > 2 && !stopSoon && !M.stopNow) this.alert(c, 'deg' + c.stint, 'GOMAS', `${c.code}: goma al ${Math.round((1 - c.tyre.wear) * 100)} %. Por encima del 72 % de desgaste se cae.`, [this.stopAct(c, null, 'Box ya'), { l: 'Cuidar gomas', op: ['set', c.i, 'pace', 'save'], reply: 'Gestiona: levanta y deja correr.' }, { l: 'Aguanta', reply: 'Aguanta, lo necesitamos.' }], { voice: [['d', pick(['Las gomas se acaban.', 'Pierdo mucho detrás.'])]], valid: () => !c.inPit });
    else if (gB != null && pB != null && gB < 2 && pB - gB > 0.25 && left > 1 && bh.team !== c.team) this.alert(c, 'def', 'DEFENSA', `${bh.code} a ${nf(gB)} s de ${c.code}: le recupera ${nf(pB - gB)} por vuelta.`, [{ l: 'Atacar', op: ['set', c.i, 'pace', 'push'], reply: 'Todo lo que tengas, defiende la posición.' }, { l: 'Ataque ERS', op: ['set', c.i, 'ers', 'boost'], reply: 'Modo ataque en el motor.' }, { l: 'Pelea agresiva', op: ['set', c.i, 'fight', 'hard'], reply: 'Cierra la puerta, no le dejes nada.' }]);
    else if (gA != null && pA != null && gA < 2.5 && gA > 0.6 && pA - gA > 0.2 && left > 1 && ah.team !== c.team) this.alert(c, 'att', 'ATAQUE', `${c.code} a ${nf(gA)} s de ${ah.code} y recuperando ${nf(pA - gA)} por vuelta.`, [{ l: 'Ataque ERS', op: ['set', c.i, 'ers', 'boost'], reply: 'Modo ataque: a por él.' }, { l: 'Pelea agresiva', op: ['set', c.i, 'fight', 'hard'], reply: 'Ve a por él en la frenada.' }, { l: 'Ignorar' }]);
    // compañero más rápido detrás
    const mate = this.cars.find((x) => x !== c);
    if (mate && bh === mate && gB != null && gB < 1.1 && !this.ord?.hold && mate.lastLap && c.lastLap && c.lastLap - mate.lastLap > 0.3 && left > 2)
      this.alert(c, 'mate', 'EQUIPO', `${mate.code} va ${nf(c.lastLap - mate.lastLap)} s más rápido que ${c.code} y está a ${nf(gB)} s.`, [{ l: `Deja pasar a ${mate.code}`, op: ['order', c.i, 'swap'] }, { l: 'Mantener posiciones', op: ['order', c.i, 'hold'] }, { l: 'Que peleen' }]);
  }

  // simulador del equipo: lo aprendido ya está en su cerebro; aquí se carga en el coche y se descuenta de lo pendiente
  endJob(car) {
    const j = this.jobs.get(car); if (!j) return;
    this.jobs.delete(car);
    car.mgr.owed = Math.max(0, car.mgr.owed - j.done); car.mgr.simLaps += j.done;
    this.sim.rebuildLine(car);
    if (j.done) this.note(car, `Simulador: ${j.done} vueltas de aprendizaje`);
  }

  // aplica ya las vueltas pendientes del simulador (de golpe: 1-3 s de cálculo)
  applySim(car) {
    if (!car.mgr.owed) return;
    const j = this.jobs.get(car) || new TeamSim(this.sim, car, car.mgr.owed);
    this.jobs.set(car, j); j.run(Infinity); this.endJob(car);
  }

  // tras cada paso de la simulación (no por fotograma: así pasa en el mismo instante en todas las máquinas)
  tickLogic() {
    // orden «deja pasar» cumplida: mantener posiciones
    const O = this.ord, sim = this.sim;
    if (O?.yield && sim.raceOrder) { const o = sim.raceOrder; if (o.indexOf(O.trail) < o.indexOf(O.yield)) { this.ord = { hold: true, yield: null }; this.say(O.yield, [['e', 'Gracias. Ahora mantened posiciones.']], 2); } }
  }

  update(dt) {
    if (this.headless) return;
    const now = performance.now(), sim = this.sim;
    // (unos milisegundos por fotograma; si el coche sale del garaje se para y lo que falte queda pendiente)
    for (const [car, j] of this.jobs) { if (car.state !== 'garage') this.endJob(car); else if (j.run(3)) this.endJob(car); }
    // avisos caducados o que ya no tienen sentido
    const n0 = this.alerts.length;
    this.alerts = this.alerts.filter((a) => (this.app.speed === 0 && this.pausedBy === a.id) || (now - a.born < a.ttl && (!a.valid || a.valid())));
    // clasificación: en el garaje y fuera del corte
    const ss = sim.session;
    if (ss && !ss.done && ss.id[0] === 'Q' && ss.phase === 'run' && sim.t > 60) {
      const cut = ss.cut, left = ss.dur - sim.t, cls = sim.classification();
      if (cut && left > 110 && left < 330) for (const m of this.cars) {
        const p = cls.indexOf(m) + 1;
        if (!m.out && m.state === 'garage' && (p > cut - 2 || !isFinite(m.best))) this.alert(m, 'qcut' + ss.id, 'CORTE', `${m.code} P${p}${p > cut ? ', fuera del corte' : ', al límite del corte'} (P${cut}). Quedan ${Math.ceil(left / 60)} min.`,
          [{ l: 'Salir: blandos nuevos', op: ['qout', m.i] }, { l: 'Quedarse' }], { ttl: 25, valid: () => m.state === 'garage' });
      }
    }
    this.t -= dt; this.gt -= dt;
    if (this.t <= 0 || this.alerts.length !== n0) { this.t = 0.25; this.render(); }
    if (this.gOpen && this.gt <= 0 && !this.dragging) { this.gt = 0.5; this.renderGarage(); }
  }

  // ------------------------------------------------------------------ muro
  // posición: en carrera la de la carrera; en libres y clasificación, la de la tabla de tiempos
  posOf(c) { if (this.race()) return c.pos; const k = this.cls.indexOf(c); return k >= 0 && isFinite(c.best) ? k + 1 : 0; }
  render() {
    const sim = this.sim; if (!sim.session || this.headless) return;
    this.cls = this.race() ? null : sim.classification();
    const race = this.race(), tabs = this.cars.map((c, k) => {
      const w = Math.max(0, Math.round((1 - c.tyre.wear) * 100)), st = c.retired ? 'OUT' : c.state === 'garage' ? 'GAR' : c.inPit ? 'BOX' : c.pitReq ? '→BOX' : '';
      return `<button data-a="sel" data-v="${k}" class="tab ${k === this.sel ? 'on' : ''}"><span class="p">${this.posOf(c) ? 'P' + this.posOf(c) : '—'}</span><span class="bar" style="background:${c.team.c1}"></span><b>${c.code}</b>${tyre(c.tyre.c)}<span class="k">${w}%</span>${st ? `<em>${st}</em>` : ''}</button>`;
    }).join('');
    // (sin textos de ayuda: robaban sitio y los avisos se cortaban; la explicación de cada opción sale al pasar el ratón)
    const html = `<div class="mt" data-a="mtoggle"><span>MURO</span><b>${esc(this.cars[0].team.name)}</b><button data-a="pauseAl" class="pa ${this.pauseOnAlert ? 'on' : ''}" title="Pausa la sesión cuando llega un aviso">${this.pauseOnAlert ? 'PAUSA EN AVISOS' : 'SIN PAUSA'}</button></div>
      <button data-a="garage" class="gbig ${this.gOpen ? 'on' : ''}" title="Estrategia · Reglaje · Rendimiento · Radar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5 12 4l9 6.5V20H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M7 20v-6h10v6M7 17h10" fill="none" stroke="currentColor" stroke-width="2"/></svg>
        <span><b>${this.gOpen ? 'CERRAR GARAJE' : 'GARAJE'}</b></span><kbd>G</kbd></button>
      ${this.onGrid() ? this.startBtn() : ''}
      <div class="tabs">${tabs}</div>${this.cardHTML(this.car)}${race ? this.ordersHTML() : ''}`;
    if (!this.mainEl) { this.mainEl = document.createElement('div'); this.mainEl.className = 'mgrMain'; this.el.append(this.mainEl); }
    if (html !== this.html) { this.html = html; this.mainEl.innerHTML = html; }
    this.renderAlerts();
  }

  // en multijugador la salida espera a que todos los muros estén listos
  startBtn() {
    const n = this.app.managers?.length || 1, ready = this.sim.gridReady?.size || 0;
    if (this.sim.gridReady?.has(this.teamId)) return `<button class="startBtn" disabled>LISTO · ESPERANDO A LOS DEMÁS (${ready}/${n})</button>`;
    return `<button data-a="start" class="startBtn">${n > 1 ? `LISTO PARA LA SALIDA (${ready}/${n})` : 'DAR LA SALIDA'}</button>`;
  }
  cardHTML(c) {
    const sim = this.sim, race = this.race(), M = c.mgr, wear = Math.round(c.tyre.wear * 100);
    const { ah, bh } = race ? this.around(c) : {};
    const ga = ah ? sim.gapTo(c, ah) : NaN, gb = bh && !bh.retired ? sim.gapTo(bh, c) : NaN;
    const last = c.laps?.length ? c.laps[c.laps.length - 1] : NaN;
    const job = this.jobs.get(c);
    const state = c.retired ? 'ABANDONO' : c.out ? 'ELIMINADO' : c.state === 'garage' ? ( job ? `EN EL GARAJE · SIMULADOR ${job.done}/${job.target} VUELTAS` : 'EN EL GARAJE') : c.inPit ? (c.pitPhase === 'stop' ? 'PARADA' : c.pitPhase === 'in' ? 'ENTRANDO A BOXES' : 'SALIENDO DE BOXES')
      : c.finished ? 'BANDERA A CUADROS' : race ? '' : { push: 'VUELTA RÁPIDA', out: 'VUELTA DE SALIDA', in: 'VUELTA DE ENTRADA', cool: 'ENFRIANDO' }[c.lapKind] || '';
    const levers = LEVERS.map(([k, label, opts]) => `<div class="lv"><div class="lt"><span>${label}</span>${k === 'ers' ? `<span class="bat" title="Batería"><i style="width:${Math.round(c.ers * 100)}%"></i></span>` : ''}</div>
      <div class="row seg">${opts.map(([v, l]) => `<button data-a="lev" data-k="${k}" data-v="${v}" data-i="${c.i}" class="${M[k] === v ? 'on' : ''} ${v}" title="${COST[k][v][1]}"><b>${l}</b><small>${COST[k][v][0]}</small></button>`).join('')}</div></div>`).join('');
    return `<div class="mc">
      <div class="mh" data-a="focus" data-i="${c.i}"><span class="p">${this.posOf(c) ? 'P' + this.posOf(c) : '—'}</span><span class="bar" style="background:${c.team.c1}"></span><b>${esc(c.drv.last)}</b>
        ${tyre(c.tyre.c)}<span class="wr" title="Goma que queda"><i style="width:${Math.max(0, 100 - wear)}%;background:${wear > 72 ? 'var(--red)' : wear > 55 ? 'var(--yellow)' : '#fff'}"></i></span><span class="k">${Math.max(0, 100 - wear)}%</span></div>
      <div class="mi"><span>${race ? `Delante <b>${isFinite(ga) ? '+' + nf(ga) : '—'}</b> · Detrás <b>${isFinite(gb) ? '−' + nf(gb) : '—'}</b>` : `Mejor <b>${fmt(c.best)}</b>`}</span><span>Últ. <b>${fmt(last)}</b></span></div>
      ${state ? `<div class="st">${state}</div>` : ''}
      ${levers}
      ${this.actionHTML(c)}
    </div>`;
  }

  actionHTML(c) {
    const sim = this.sim, M = c.mgr, ss = sim.session;
    if (c.retired || c.out || c.finished || ss.done) return '';
    if (this.race()) {
      if (this.onGrid()) return '';
      if (c.inPit) return '<div class="act"><button class="big" disabled>EN BOXES</button></div>';
      const sts = c.strategy.stints, st = sts[c.stint], due = c.stint < sts.length - 1 && c.lap + 1 >= st.to, nx = sts[c.stint + 1]?.c || c.tyre.c;
      const nextStop = c.stint < sts.length - 1 ? `Plan: parada en la V${st.to} → ${nx}` : 'Plan: sin más paradas';
      if (M.stopNow || due) return `<div class="act"><button data-a="stop" data-i="${c.i}" class="big on">BOX ESTA VUELTA ${tyre(nx)}<small>${M.stopNow ? 'pedida por ti · pulsa para cancelar' : 'la del plan · pulsa para retrasarla 2 vueltas'}</small></button></div>`;
      return `<div class="act"><button data-a="stop" data-i="${c.i}" class="big">PARAR EN ESTA VUELTA ${tyre(nx)}<small>${nextStop}</small></button></div>`;
    }
    if (ss.phase !== 'run' && c.state === 'garage') return '';
    if (c.state === 'garage') {
      const p = prog(M.next);
      return `<div class="act"><button data-a="go" data-i="${c.i}" class="big go">SALIR A PISTA ${tyre(M.next.c)}<small>${M.next.fresh ? 'juego nuevo' : 'juego usado'} · ${p.l.toLowerCase()}${M.next.test && isFP(ss.id) ? ' · modo consistente' : ''} · cámbialo en el garaje</small></button></div>`;
    }
    if (c.inPit) return '';
    const back = M.boxReq || c.lapKind === 'in';
    const nextK = M.nextLap || (c.lapKind === 'push' && c.run?.kind === 'quali' && c.run?.cool !== false ? 'cool' : 'push');
    const nextRow = back || c.lapKind === 'in' ? '' : `<div class="lv"><div class="lt"><span>SIGUIENTE VUELTA</span></div><div class="row seg">${[['push', 'Lanzada'], ['cool', 'Enfriar']].map(([v, l]) => `<button data-a="nextlap" data-v="${v}" data-i="${c.i}" class="${nextK === v ? 'on' : ''}"><b>${l}</b></button>`).join('')}</div></div>`;
    const progTxt = (c.run?.laps ? `lanzadas ${c.pushN || 0}/${c.run.laps}` : `${c.pushN || 0} vueltas`) + (c.testRun ? ' · modo consistente' : '');
    return nextRow + `<div class="act"><button data-a="box" data-i="${c.i}" class="big ${back ? 'on' : ''}">${back ? 'VUELVE A BOXES' : 'BOX ESTA VUELTA'}<small>${back ? (M.boxReq ? 'pulsa para cancelar' : 'fin del programa') : progTxt}</small></button></div>`;
  }

  ordersHTML() {
    const [a, b] = this.cars; if (!b || a.retired || b.retired || a.finished || b.finished) return '';
    const o = this.sim.raceOrder || [], lead = o.indexOf(a) < o.indexOf(b) ? a : b, trail = lead === a ? b : a, O = this.ord || {};
    const cur = O.yield ? 'swap' : O.hold ? 'hold' : 'free';
    return `<div class="ord"><span>ÓRDENES</span><div class="row seg">${[['free', 'Libres'], ['hold', 'Mantener'], ['swap', `${lead.code} deja pasar`]].map(([v, l]) => `<button data-a="order" data-v="${v}" class="${cur === v ? 'on' : ''}" ${v === 'swap' && cur === 'swap' ? 'disabled' : ''}><b>${l}</b></button>`).join('')}</div>
      ${cur === 'swap' ? `<div class="lc">${lead.code} se aparta en recta cuando ${trail.code} llegue.</div>` : ''}</div>`;
  }

  // avisos: cada uno se crea una vez y se queda (la barra de tiempo baja con una animación CSS); antes se redibujaba todo el
  // panel 4 veces por segundo y la animación de entrada se repetía: el aviso parpadeaba
  renderAlerts() {
    // arriba del muro y solo cuando hay alguno (así caben enteros, aunque sean varios)
    const box = this.alEl, now = performance.now();
    if (!box.querySelector('.alh')) box.insertAdjacentHTML('afterbegin', '<div class="alh"><span>AVISOS</span></div>');
    const ids = new Set(this.alerts.map((a) => String(a.id)));
    for (const n of box.querySelectorAll('.al')) if (!ids.has(n.dataset.id)) n.remove();
    box.classList.toggle('hidden', !this.alerts.length);
    if (!this.alerts.length) return;
    let prev = box.querySelector('.alh');
    for (const a of this.alerts) {
      let n = box.querySelector(`.al[data-id="${a.id}"]`);
      if (!n) {
        n = document.createElement('div'); n.className = 'al'; n.dataset.id = a.id;
        n.innerHTML = `<div class="ah"><span class="bar" style="background:${a.car.team.c1}"></span><b>${a.car.code}</b><span class="t">${a.title}</span><i class="tm"><i style="animation-duration:${a.ttl}ms;animation-delay:-${Math.round(now - a.born)}ms"></i></i></div>
          <p>${a.text}</p><div class="row">${a.acts.map((x, k) => `<button data-a="al" data-v="${a.id}" data-k="${k}">${x.l}</button>`).join('')}</div>`;
      }
      if (prev.nextSibling !== n) prev.after(n);
      // pausado por este aviso: la barra se para
      n.querySelector('.tm i').style.animationPlayState = this.app.speed === 0 && this.pausedBy === a.id ? 'paused' : 'running';
      prev = n;
    }
  }

  // ------------------------------------------------------------------ garaje
  renderGarage(force) {
    if (!this.gOpen) return;
    const c = this.car, T = [['strat', 'Estrategia'], ['setup', 'Reglaje'], ['perf', 'Rendimiento'], ['radar', 'Radar']];
    const body = this.gTab === 'strat' ? this.stratHTML(c) : this.gTab === 'setup' ? this.setupHTML(c) : this.gTab === 'perf' ? this.perfHTML() : this.radar(true);
    const html = `<div class="gh"><b>GARAJE</b><div class="gt">${T.map(([v, l]) => `<button data-a="gtab" data-v="${v}" class="${this.gTab === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="gd">${this.gTab === 'perf' ? '' : this.cars.map((x, k) => `<button data-a="sel" data-v="${k}" class="${k === this.sel ? 'on' : ''}"><span class="bar" style="background:${x.team.c1}"></span>${x.code}</button>`).join('')}</div>
      <button data-a="gclose" class="x" title="Cerrar (Esc)">✕</button></div><div class="gb">${body}</div>`;
    if (force || html !== this.gHTML) { this.gHTML = html; this.gel.innerHTML = html; }
  }

  stratHTML(c) {
    const sim = this.sim, N = sim.raceLaps, P = this.plan(c), st = P.st, proj = this.project(c, P);
    const W = 720, H = 236, x0 = 34, xw = W - 50, X = (l) => x0 + (l / N) * xw, yT = 40, yH = 160, Y = (w) => yT + yH * (1 - Math.min(1.1, w) / 1.1);
    const now = P.live && !this.onGrid() ? c.lap : null;
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="stc">`;
    // precipicio y rejilla
    svg += `<rect x="${x0}" y="${Y(1.1)}" width="${xw}" height="${Y(0.72) - Y(1.1)}" class="cliff"/><text x="${x0 + 4}" y="${Y(0.72) - 4}" class="cl">caída de agarre (+72 %)</text>`;
    for (const w of [0, 0.25, 0.5, 0.75, 1]) svg += `<line x1="${x0}" x2="${x0 + xw}" y1="${Y(w)}" y2="${Y(w)}" class="gl"/><text x="${x0 - 6}" y="${Y(w) + 3}" class="ax" text-anchor="end">${w * 100}</text>`;
    const step = N > 20 ? 5 : 2;
    for (let l = 0; l <= N; l += step) svg += `<text x="${X(l)}" y="${H - 6}" class="ax" text-anchor="middle">${l}</text>`;
    // tandas
    st.forEach((s, k) => {
      const col = COMPOUNDS[s.c].color, past = P.live && !this.onGrid() && k < c.stint, sel = this.stSel === k;
      svg += `<rect data-a="stsel" data-v="${k}" x="${X(s.from) + 1}" y="6" width="${Math.max(2, X(s.to) - X(s.from) - 2)}" height="24" rx="6" fill="${col}" class="sb ${past ? 'past' : ''} ${sel ? 'sel' : ''}"/>`;
      svg += `<text x="${(X(s.from) + X(s.to)) / 2}" y="22" class="sl" text-anchor="middle" pointer-events="none">${COMPOUNDS[s.c].name} · ${s.to - s.from} v</text>`;
      // curva de desgaste
      let d = '', dr = '', prev = null;
      for (let l = s.from + 1; l <= s.to; l++) {
        const p = proj[l]; if (!p) continue;
        const pt = `${X(l).toFixed(1)},${Y(p.w).toFixed(1)}`;
        if (p.real) dr += (dr ? 'L' : `M${X(l - 1).toFixed(1)},${Y(prev ?? (k === 0 ? 0.05 : 0)).toFixed(1)}L`) + pt;
        else d += (d ? 'L' : `M${X(l - 1).toFixed(1)},${Y(prev ?? (l - 1 === now ? c.tyre.wear : k === 0 ? 0.05 : 0)).toFixed(1)}L`) + pt;
        prev = p.w;
      }
      if (dr) svg += `<path d="${dr}" stroke="${col}" class="wr"/>`;
      if (d) svg += `<path d="${d}" stroke="${col}" class="we"/>`;
      const end = proj[s.to]; if (end) svg += `<text x="${X(s.to) - 4}" y="${Y(end.w) - 6}" class="wl ${end.w > 0.85 ? 'bad' : end.w > 0.72 ? 'warn' : ''}" text-anchor="end">${Math.round(end.w * 100)}%</text>`;
    });
    // paradas (se arrastran)
    st.slice(0, -1).forEach((s, k) => {
      const ed = !(P.live && !this.onGrid() && k < c.stint), x = X(s.to);
      svg += `<line x1="${x}" x2="${x}" y1="32" y2="${yT + yH}" class="sp"/>`;
      if (ed) svg += `<g data-a="stdrag" data-v="${k}" class="hd"><rect x="${x - 14}" y="${yT + yH - 4}" width="28" height="22" rx="6"/><text x="${x}" y="${yT + yH + 11}" text-anchor="middle">V${s.to}</text></g>`;
      else svg += `<text x="${x}" y="${yT + yH + 11}" text-anchor="middle" class="ax">V${s.to}</text>`;
    });
    if (now != null) svg += `<line x1="${X(Math.max(0, now))}" x2="${X(Math.max(0, now))}" y1="2" y2="${yT + yH}" class="now"/><text x="${X(Math.max(0, now)) + 4}" y="${yT + 10}" class="nowt">AHORA</text>`;
    svg += '</svg>';
    // controles
    const k = this.stSel != null && st[this.stSel] ? this.stSel : null;
    const canC = k != null && this.canComp(c, P, k);
    const sug = this.suggest(c), cur = this.cost(c, P.live && !this.onGrid() ? st.slice(c.stint).map((x, i) => (i ? x : { ...x })) : st, P.live && !this.onGrid() ? c.tyre.wear : 0.05, P.live && !this.onGrid() ? c.lap : 0, sim.wx?.line ?? 0);
    const diff = sug ? cur - sug.t : 0;
    const maxW = Math.max(...proj.filter(Boolean).filter((p) => !p.real).map((p) => p.w), 0);
    const dryUsed = new Set(st.map((x) => x.c).filter((x) => !COMPOUNDS[x].wet)), wetRace = st.some((x) => COMPOUNDS[x.c].wet) || (sim.wx?.line ?? 0) > 0.2;
    const ctl = `<div class="sctl">
      <div class="sg"><span class="k">${k == null ? 'Toca una tanda para cambiar su goma' : `Tanda ${k + 1}${canC ? '' : ' · ya montada'}`}</span>
        <div class="row tyres">${TYRES.map((t) => `<button data-a="stc" data-k="${k}" data-v="${t}" style="--tc:${COMPOUNDS[t].color}" class="${k != null && st[k].c === t ? 'on' : ''}" ${canC ? '' : 'disabled'}>${t}</button>`).join('')}</div></div>
      <div class="sg"><span class="k">Paradas</span><div class="row"><button data-a="stadd">+ Parada</button><button data-a="stdel" data-v="${k != null && k > 0 ? k - 1 : st.length - 2}" ${st.length > 1 && st.length - 1 > P.k0 ? '' : 'disabled'}>− Parada</button><button data-a="stsug" title="El mejor plan según el desgaste medido">Sugerido</button></div></div>
      ${P.live && !this.onGrid() ? `<div class="sg"><span class="k">Ahora</span><div class="row">${this.actionHTML(c).replace(/class="act"/, 'class="act in"')}</div></div>` : ''}
    </div>`;
    const info = `<div class="sinfo">
      <span><b>${st.length - 1}</b> ${st.length === 2 ? 'parada' : 'paradas'} · ${st.map((x) => x.c).join(' → ')}</span>
      <span>Desgaste máx. previsto <b class="${maxW > 0.85 ? 'bad' : maxW > 0.72 ? 'warn' : ''}">${Math.round(maxW * 100)} %</b></span>
      <span>${sug ? (Math.abs(diff) < 0.3 ? '<b>Igual que el sugerido</b>' : `<b class="${diff > 3 ? 'warn' : ''}">≈ ${diff > 0 ? '+' : '−'}${nf(Math.abs(diff))} s</b> frente al sugerido (${sug.st.map((x) => x.c).join('-')})`) : ''}</span>
      ${!wetRace && dryUsed.size < 2 ? '<span class="bad">Regla: en seco hay que usar dos compuestos distintos</span>' : ''}
    </div>`;
    const title = P.live ? (this.onGrid() ? `Plan de carrera de ${c.drv.last} · antes de la salida` : `Plan de carrera de ${c.drv.last} · vuelta ${Math.max(0, c.lap)}/${N}`) : `Borrador del plan de carrera de ${c.drv.last} · ${N} vueltas`;
    const note = P.live ? (this.onGrid() ? 'Arrastra las paradas (V…) para moverlas. La goma de la primera tanda es con la que sale.' : 'Arrastra las paradas para moverlas: el coche para cuando lo diga el plan. Línea continua: desgaste real; discontinua: previsto.')
      : 'Se usará en la carrera. El desgaste previsto sale de las vueltas que haga tu equipo (pestaña Rendimiento).';
    return `<div class="gtitle"><b>${title}</b><span>${note}</span></div>${svg}${info}${ctl}${this.onGrid() ? this.startBtn() : ''}`;
  }

  setupHTML(c) {
    const sim = this.sim, ok = this.canSetup(c), M = c.mgr, race = this.race();
    const lock = ok ? '' : `<p class="lock">${race ? 'Durante la carrera el reglaje no se toca: solo en la parrilla, antes de la salida.' : c.out ? 'Eliminado: el coche ya no sale.' : 'El reglaje solo se cambia con el coche en el garaje. Llámalo a boxes.'}</p>`;
    const seg = (a, opts, cur) => `<div class="row seg">${opts.map(([v, l]) => `<button data-a="${a}" data-v="${v}" data-i="${c.i}" class="${cur === v ? 'on' : ''}" ${ok ? '' : 'disabled'}><b>${l}</b></button>`).join('')}</div>`;
    const tr = c.trim || 0, su = c.susp || 0;
    let html = `<div class="gtitle"><b>Reglaje de ${esc(c.drv.last)}</b><span>${race ? 'Se fija en la parrilla.' : 'Pruébalo en pista y mira el resultado en Rendimiento.'}</span></div>${lock}
      <div class="sset"><div class="sh"><b>Alerón</b><span>${tr > 0 ? `Más carga: +${nf(tr * 7, 1)} % de apoyo en curva, −${nf(tr * 18, 0)} km/h de punta (cuesta adelantar)` : tr < 0 ? `Menos carga: +${nf(-tr * 16, 0)} km/h de punta (adelanta y defiende mejor), −${nf(-tr * 7, 1)} % de apoyo en curva` : 'Equilibrado'}</span></div>${seg('trim', TRIMS, tr)}</div>
      <div class="sset"><div class="sh"><b>Suspensión</b><span>${su > 0 ? 'Dura: +5 % de carga en las rápidas y −1 % de agarre mecánico. Más rápida (≈ −0,5 s/v), pero gasta un 10 % más de goma' : su < 0 ? 'Blanda: +1 % de agarre mecánico y −5 % de carga. Más lenta (≈ +0,6 s/v), pero gasta un 10 % menos de goma' : 'Media'}</span></div>${seg('susp', SUSPS, su)}</div>`;
    if (!race) {
      const can = c.state === 'garage' && sim.session?.phase === 'run' && !c.out;
      const used = c.tyre.c === M.next.c && c.tyre.wear > 0;
      html += `<div class="gtitle sub"><b>Próxima salida</b><span>Neumático, juego y programa de vueltas.</span></div>
        <div class="sset"><div class="sh"><b>Neumático</b><span>${COMPOUNDS[M.next.c].name}${M.next.fresh || !used ? ' · juego nuevo' : ` · usado (${Math.round((1 - c.tyre.wear) * 100)} % de goma)`}</span></div>
          <div class="row tyres">${TYRES.map((t) => `<button data-a="ntyre" data-v="${t}" data-i="${c.i}" style="--tc:${COMPOUNDS[t].color}" class="${M.next.c === t ? 'on' : ''}">${t}</button>`).join('')}
          <span class="sp2"></span><div class="row seg mini"><button data-a="nfresh" data-v="1" data-i="${c.i}" class="${M.next.fresh || !used ? 'on' : ''}"><b>Nuevo</b></button><button data-a="nfresh" data-v="0" data-i="${c.i}" class="${!M.next.fresh && used ? 'on' : ''}" ${used ? '' : 'disabled'}><b>Usado</b></button></div></div></div>
        <div class="sset"><div class="sh"><b>Programa</b><span>${{ quali: 'Vuelta de salida y cada lanzada con su vuelta para enfriar. Poca gasolina.', long: 'Vueltas seguidas a ritmo (sirve para medir el desgaste).', free: 'Vueltas seguidas hasta que le llames a boxes.' }[M.next.kind]}</span></div>
          <div class="row seg">${Object.entries(PROG_N).map(([v, l]) => `<button data-a="nprog" data-v="${v}" data-i="${c.i}" class="${M.next.kind === v ? 'on' : ''}"><b>${l}</b></button>`).join('')}</div>
          <div class="row laps">${M.next.kind === 'free' ? '<span class="k">Sin límite de vueltas</span>' : `<button data-a="nlaps" data-v="-1" data-i="${c.i}" ${M.next.laps <= 1 ? 'disabled' : ''}>−</button><b>${prog(M.next).laps}</b><button data-a="nlaps" data-v="1" data-i="${c.i}" ${M.next.laps >= 30 ? 'disabled' : ''}>+</button><span class="k">${M.next.kind === 'quali' ? (prog(M.next).laps === 1 ? 'lanzada' : 'lanzadas') : 'vueltas'}</span>`}
            <span class="k fu">${prog(M.next).fuel + (M.next.kind === 'quali' && M.next.repeat ? 4 : 0)} kg de gasolina${M.next.kind === 'free' ? '' : ` · unos ${Math.round(((M.next.kind === 'quali' ? prog(M.next).laps * 2 : prog(M.next).laps) + 2) * (isFinite(c.best) ? c.best : 90) / 60)} min`}</span></div></div>
        ${M.next.kind === 'quali' ? `<div class="sset two"><div><div class="sh"><b>Vuelta de enfriamiento</b><span>${M.next.cool ? 'tras cada lanzada' : 'lanzadas seguidas'}</span></div>
            <div class="row seg mini"><button data-a="ncool" data-v="1" data-i="${c.i}" class="${M.next.cool ? 'on' : ''}"><b>Sí</b></button><button data-a="ncool" data-v="0" data-i="${c.i}" class="${M.next.cool ? '' : 'on'}"><b>No</b></button></div></div>
          <div><div class="sh"><b>Lanzada con error o tráfico</b><span>${M.next.repeat ? 'la repite (te avisa)' : 'cuenta igual'}</span></div>
            <div class="row seg mini"><button data-a="nrep" data-v="1" data-i="${c.i}" class="${M.next.repeat ? 'on' : ''}"><b>Repetir</b></button><button data-a="nrep" data-v="0" data-i="${c.i}" class="${M.next.repeat ? '' : 'on'}"><b>Contar</b></button></div></div></div>
          <p class="leg">En pista puedes elegir en el muro si la siguiente vuelta es lanzada o para enfriar.</p>` : ''}
        ${M.owed || M.simLaps ? `<div class="simrow"><p class="leg">Simulador del equipo: ${M.owed ? `<b>${M.owed} vueltas de aprendizaje pendientes</b> de las tandas en modo consistente. Se aplican al salir en modo «Aprende», al acabar la sesión o ahora. Mientras sigas en modo consistente, todas las tandas se comparan con el mismo piloto.` : 'al día.'} ${M.simLaps} vueltas hechas en total.</p>${M.owed ? `<button data-a="simnow" data-i="${c.i}" class="btn ghost">Aplicar ahora</button>` : ''}</div>` : ''}
        ${isFP(sim.session?.id) ? `<div class="sset"><div class="sh"><b>Piloto</b><span>${M.next.test ? 'Modo consistente: conduce igual todas las vueltas (no prueba nada en pista). Las vueltas con tráfico quedan marcadas y no cuentan. Lo que no aprende en pista lo recupera luego en el simulador del equipo. Con pelea agresiva no cede y se quita a los lentos.' : 'Aprende: prueba trazadas y frenadas en pista (mejora, pero sus vueltas varían).'}</span></div>
          <div class="row seg"><button data-a="ntest" data-v="0" data-i="${c.i}" class="${M.next.test ? '' : 'on'}"><b>Aprende</b><small>mejora cada vuelta</small></button><button data-a="ntest" data-v="1" data-i="${c.i}" class="${M.next.test ? 'on' : ''}"><b>Modo consistente</b><small>vueltas iguales</small></button></div></div>` : ''}
        <button data-a="go" data-i="${c.i}" class="startBtn" ${can ? '' : 'disabled'}>${c.state === 'garage' ? 'SALIR A PISTA' : 'EN PISTA'}</button>`;
    } else if (this.onGrid()) html += this.startBtn();
    return html;
  }

  // rendimiento real: tiempo de vuelta (corregido por gasolina) frente al desgaste, por compuesto, y por reglaje
  // vueltas de los pilotos elegidos y de las sesiones elegidas (all = también las no válidas y en mojado)
  perfLaps(all = false) {
    const cars = this.pf === 'all' ? this.cars : this.cars.filter((c) => c.code === this.pf), out = [];
    const sOk = (s) => this.ps === 'all' || (this.ps === 'Q' ? s[0] === 'Q' : s === this.ps);
    for (const c of cars) c.mgr.laps.forEach((l, k) => { if (sOk(l.s) && (all || (usable(l) && condOf(l) === this.pw && (this.pt === 'all' || l.test)))) out.push({ ...l, car: c, k }); });
    return out;
  }
  perfHTML() {
    const seg = (a, cur, opts) => `<div class="row seg mini">${opts.map(([v, l]) => `<button data-a="${a}" data-v="${v}" class="${cur === v ? 'on' : ''}"><b>${l}</b></button>`).join('')}</div>`;
    // (antes cuatro filas de botones sin nombre: arriba la vista; debajo los filtros con su etiqueta, y solo las sesiones
    // que ya tienen vueltas y «Mojado» si las hay)
    const all = this.cars.flatMap((c) => c.mgr.laps), has = (f) => all.some(f);
    const sess = [['all', 'Todas'], ['FP', 'Libres 1'], ['FP2', 'Libres 2'], ['Q', 'Clasif.'], ['RACE', 'Carrera']].filter(([v]) => v === 'all' || has((l) => (v === 'Q' ? l.s[0] === 'Q' : l.s === v)));
    if (!sess.some(([v]) => v === this.ps)) this.ps = 'all';
    const wetToo = has((l) => condOf(l) === 'wet'); if (!wetToo) this.pw = 'dry';
    const grp = (k, html) => `<div class="pgr"><span class="k">${k}</span>${html}</div>`;
    const filt = `<div class="pview">${seg('pv', this.pv, [['chart', 'Gráfica'], ['cmp', 'Comparar'], ['laps', 'Vueltas']])}</div>
      ${all.length ? `<div class="pfil">${grp('Piloto', seg('pf', this.pf, [['all', 'Los dos'], ...this.cars.map((c) => [c.code, c.code])]))}${sess.length > 2 ? grp('Sesión', seg('ps', this.ps, sess)) : ''}${this.pv !== 'laps' && wetToo ? grp('Pista', seg('pw', this.pw, [['dry', 'Seco'], ['wet', 'Mojado']])) : ''}</div>` : ''}`;
    const sub = { chart: 'Tiempo de vuelta frente al desgaste, por goma.', cmp: 'Cada piloto por separado: qué reglaje, goma o ritmo le va mejor.', laps: 'Todas las vueltas hechas, también las que no cuentan (y por qué).' }[this.pv];
    const head = `<div class="gtitle"><b>Rendimiento real</b><span>${sub} Tiempos corregidos por gasolina y por la goma que va dejando la pista.</span></div>${filt}`;
    if (this.pv === 'laps') return head + this.lapsTable();
    if (this.pv === 'cmp') return head + this.compareTable();
    const laps = this.perfLaps();
    if (laps.length < 2) return head + `<p class="lock">Aún no hay vueltas limpias ${this.pw === 'dry' ? 'en seco' : 'en mojado (con intermedios o lluvia)'} con este filtro. Sal a pista en libres (una tanda larga mide el desgaste de cada goma).</p>`;
    const W = 720, H = 220, x0 = 46, xw = W - 64, yT = 10, yH = H - 40;
    const ts = laps.map((l) => l.tf).sort((a, b) => a - b), tMin = ts[0] - 0.2, tMax = Math.min(ts[ts.length - 1], ts[Math.floor(ts.length * 0.92)] + 1) + 0.2;
    const wMax = Math.max(0.5, ...laps.map((l) => l.w0)) + 0.05;
    const X = (w) => x0 + (w / wMax) * xw, Y = (t) => yT + ((Math.min(tMax, t) - tMin) / (tMax - tMin)) * yH;
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="pfc">`;
    for (let k = 0; k <= 4; k++) { const t = tMin + ((tMax - tMin) * k) / 4; svg += `<line x1="${x0}" x2="${x0 + xw}" y1="${Y(t)}" y2="${Y(t)}" class="gl"/><text x="${x0 - 6}" y="${Y(t) + 3}" class="ax" text-anchor="end">${fmt(t)}</text>`; }
    for (let w = 0; w <= wMax; w += 0.1) svg += `<text x="${X(w)}" y="${H - 14}" class="ax" text-anchor="middle">${Math.round(w * 100)}%</text>`;
    svg += `<text x="${x0 + xw}" y="${H - 2}" class="ax" text-anchor="end">desgaste al empezar la vuelta →</text>`;
    if (0.72 < wMax) svg += `<rect x="${X(0.72)}" y="${yT}" width="${X(wMax) - X(0.72)}" height="${yH}" class="cliff"/>`;
    const rows = [];
    for (const c of TYRES) {
      const L = laps.filter((l) => l.c === c); if (!L.length) continue;
      const col = COMPOUNDS[c].color;
      for (const l of L) svg += `<circle cx="${X(l.w0).toFixed(1)}" cy="${Y(l.tf).toFixed(1)}" r="4" fill="${l.s === 'RACE' ? 'none' : col}" stroke="${col}" stroke-width="1.6" opacity="0.9"><title>${l.car.code} ${l.s} V${l.lap} · ${fmt(l.t)} (${fmt(l.tf)} corregido) · ${Math.round(l.w0 * 100)} %</title></circle>`;
      // recta por mínimos cuadrados (tiempo frente a desgaste)
      let sl = NaN;
      if (L.length >= 3) {
        const n = L.length, sx = L.reduce((a, l) => a + l.w0, 0), sy = L.reduce((a, l) => a + l.tf, 0), sxx = L.reduce((a, l) => a + l.w0 * l.w0, 0), sxy = L.reduce((a, l) => a + l.w0 * l.tf, 0);
        const den = n * sxx - sx * sx;
        if (den > 1e-6 && Math.max(...L.map((l) => l.w0)) - Math.min(...L.map((l) => l.w0)) > 0.08) {
          sl = (n * sxy - sx * sy) / den; const b0 = (sy - sl * sx) / n, a0 = Math.min(...L.map((l) => l.w0)), a1 = Math.max(...L.map((l) => l.w0));
          svg += `<line x1="${X(a0)}" x2="${X(a1)}" y1="${Y(b0 + sl * a0)}" y2="${Y(b0 + sl * a1)}" stroke="${col}" class="fit"/>`;
        }
      }
      const wl = this.wpl(this.car, c), life = Math.floor(0.72 / wl);
      const fresh = L.filter((l) => l.w0 < 0.2).map((l) => l.tf);
      rows.push(`<tr><td>${tyre(c)} ${COMPOUNDS[c].name}</td><td class="num">${L.length}</td><td class="num">${fmt(Math.min(...L.map((l) => l.tf)))}</td><td class="num">${fresh.length ? fmt(med(fresh)) : '—'}</td>
        <td class="num">${isFinite(sl) ? `${sl / 10 >= 0 ? '+' : '−'}${nf(Math.abs(sl / 10), 2)} s` : '—'}</td><td class="num">${COMPOUNDS[c].wet ? '—' : `${nf(wl * 100)} %`}</td><td class="num">${COMPOUNDS[c].wet ? '—' : `${life} v`}</td></tr>`);
    }
    svg += '</svg>';
    const tbl = `<table class="pt"><thead><tr><th>Goma</th><th class="num">Vueltas</th><th class="num">Mejor</th><th class="num">Media nueva</th><th class="num">Por cada 10 %</th><th class="num">Desgaste/v en carrera</th><th class="num">Hasta el 72 %</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
    return head + svg + '<p class="leg">Relleno: libres/clasificación · hueco: carrera. Zona roja: más del 72 % de desgaste. Para comparar reglajes, la vista «Comparar».</p>' + tbl;
  }

  // desgaste de la vuelta pasado a «vuelta de carrera» (en libres y clasificación la goma se gasta a ritmo de 20 vueltas)
  wearRace(l) { return ((l.w1 - l.w0) * (l.s === 'RACE' ? this.sim.raceLaps : 20)) / this.sim.raceLaps; }

  // agrupa las vueltas válidas de cada piloto por reglaje, goma, ritmo o todo junto. Por piloto: la conclusión en una frase y
  // una fila por opción con cada vuelta como un punto en un eje de tiempo común (marca grande: media de sus 3 mejores)
  compareTable() {
    const laps = this.perfLaps();
    const DIM = { setup: 'Reglaje', c: 'Goma', pace: 'Ritmo', ers: 'Motor', all: 'Todo junto' };
    const ctl = `<div class="cmpctl"><span class="k">Comparar por</span><div class="row seg mini">${Object.entries(DIM).map(([v, l]) => `<button data-a="pg" data-v="${v}" class="${this.pg === v ? 'on' : ''}"><b>${l}</b></button>`).join('')}</div>
      <div class="row seg mini">${[['all', 'Todas las vueltas'], ['test', 'Solo consistentes']].map(([v, l]) => `<button data-a="pt" data-v="${v}" class="${this.pt === v ? 'on' : ''}"><b>${l}</b></button>`).join('')}</div></div>`;
    if (!laps.length) return ctl + `<p class="lock">Aún no hay vueltas limpias ${this.pw === 'dry' ? 'en seco' : 'en mojado (con intermedios o lluvia)'} con este filtro.</p>`;
    const key = (l) => ({ setup: `${l.trim}|${l.susp}`, c: l.c, pace: l.pace, ers: l.ers, all: `${l.c}|${l.trim}|${l.susp}|${l.pace}|${l.ers}` }[this.pg]);
    const name = (l) => ({ setup: `Alerón ${TRIM_N[l.trim].toLowerCase()} · susp. ${SUSP_N[l.susp].toLowerCase()}`, c: `${tyre(l.c)} ${COMPOUNDS[l.c].name}`, pace: PACE_N[l.pace], ers: ERS_N[l.ers], all: `${tyre(l.c)} ${TRIM_N[l.trim]}/${SUSP_N[l.susp]} · ${PACE_N[l.pace]} · ${ERS_N[l.ers]}` }[this.pg]);
    const plain = (l) => name(l).replace(/<[^>]+>/g, '').replace(/^\s*[SMHIW]\s+/, '').trim();
    let html = ctl;
    for (const car of this.cars) {
      const L = laps.filter((l) => l.car === car); if (!L.length) continue;
      const g = new Map(); for (const l of L) { const k = key(l); if (!g.has(k)) g.set(k, []); g.get(k).push(l); }
      const rows = [...g.values()].map((v) => {
        const t = v.map((l) => l.tf).sort((a, b) => a - b), top = t.slice(0, 3), ws = v.map((l) => this.wearRace(l)).filter((x) => x > 0);
        return { v, n: name(v[0]), p: plain(v[0]), cnt: v.length, best: t[0], top: top.reduce((a, x) => a + x, 0) / top.length, wear: ws.length ? med(ws) : NaN, few: v.length < 3 };
      }).sort((a, b) => a.top - b.top);
      const ref = rows[0].top, lo = Math.min(...L.map((l) => l.tf)) - 0.15, hi = Math.max(lo + 1.2, Math.min(Math.max(...rows.map((r) => r.top)) + 1.2, Math.max(...L.map((l) => l.tf)) + 0.15));
      const X = (t) => Math.max(0, Math.min(100, ((t - lo) / (hi - lo)) * 100));
      // ¿ha aprendido el piloto entre unas opciones y otras? (entonces parte de la diferencia es eso, no la opción)
      const kn = rows.map((r) => r.v.map((l) => l.know ?? 0)), learnt = rows.length > 1 && Math.max(...kn.flat()) - Math.min(...kn.flat()) >= 3 ? Math.max(...kn.flat()) - Math.min(...kn.flat()) : 0;
      const verdict = rows.length < 2 ? `Solo has probado <b>${rows[0].n}</b>: prueba otra opción para comparar.`
        : `Mejor ${DIM[this.pg].toLowerCase()}: <b>${rows[0].n}</b>, ${nf(rows[1].top - ref, 2)} s por vuelta más rápido que ${rows[1].p}${rows[0].few || rows[1].few ? ' <span class="few">(pocas vueltas: tómalo con cuidado)</span>' : ''}.${learnt ? `<br><span class="few">Ojo: entre estas tandas el piloto ha aprendido (${learnt} mejoras); parte de la diferencia es eso. Para comparar limpio, tandas seguidas en modo consistente.</span>` : ''}`;
      const step = hi - lo > 4 ? 1 : hi - lo > 2 ? 0.5 : 0.25, ticks = [];
      for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(`<i style="left:${X(t)}%"><span>${fmt(t)}</span></i>`);
      html += `<div class="cmp" style="--tcol:${car.team.c1}"><div class="cmph"><span class="bar" style="background:${car.team.c1}"></span><b>${esc(car.drv.last)}</b><span class="k">${L.length} vueltas válidas</span></div>
        <p class="verd">${verdict}</p>
        <div class="crow axis"><div class="cl"></div><div class="ct">${ticks.join('')}</div><div class="cd"></div></div>
        ${rows.map((r, i) => `<div class="crow ${i === 0 ? 'best' : ''}"><div class="cl"><b>${r.n}</b><small>${r.cnt} ${r.cnt === 1 ? 'vuelta' : 'vueltas'}${isFinite(r.wear) ? ` · desgaste ${nf(r.wear * 100)} %/v` : ''}</small></div>
          <div class="ct">${r.v.map((l) => `<i class="dot" style="left:${X(l.tf)}%" title="${l.s} V${l.lap} · ${fmt(l.tf)}"></i>`).join('')}<i class="avg" style="left:${X(r.top)}%" title="Media de sus 3 mejores: ${fmt(r.top)}"></i></div>
          <div class="cd">${i === 0 ? '<b>MEJOR</b>' : `+${nf(r.top - ref, 2)} s`}<small>${fmt(r.top)}</small></div></div>`).join('')}
      </div>`;
    }
    return html + '<p class="leg">Cada punto es una vuelta (corregida por gasolina y por la goma de la pista); la marca grande es la media de sus 3 mejores, que es lo que se compara. Si el piloto aprende entre tandas, mejora solo: para comparar de verdad, tandas en modo consistente.</p>';
  }

  // lista de todas las vueltas, con sectores, reglaje y por qué no cuenta si no cuenta; cada piloto en su bloque
  lapsTable() {
    const L = this.perfLaps(true);
    const seg = `<div class="row seg mini pg">${[['order', 'En orden'], ['fast', 'Más rápidas']].map(([v, l]) => `<button data-a="po" data-v="${v}" class="${this.po === v ? 'on' : ''}"><b>${l}</b></button>`).join('')}<span class="k">${L.length} vueltas</span></div>`;
    if (!L.length) return seg + '<p class="lock">Aún no hay vueltas con este filtro.</p>';
    const sesN = (s) => ({ FP: 'Libres 1', FP2: 'Libres 2', RACE: 'Carrera' }[s] || s);
    const block = (car) => {
      const CL = L.filter((l) => l.car === car); if (!CL.length) return '';
      let best = null; const b = [Infinity, Infinity, Infinity];
      for (const l of CL) if (usable(l)) { if (!best || l.tf < best.tf) best = l; l.sec?.forEach((x, k) => { if (x > 0 && x < b[k]) b[k] = x; }); }
      const rows = (this.po === 'fast' ? CL.slice().sort((a, b2) => usable(b2) - usable(a) || a.tf - b2.tf) : CL.slice().reverse()).slice(0, 120);
      let prevS = null;
      const body = rows.map((l) => {
        const ok = usable(l), isBest = best === l;
        const sec = [0, 1, 2].map((k) => { const x = l.sec?.[k]; return `<td class="num ${ok && x > 0 && x <= b[k] ? 'pb' : ''}">${x > 0 ? nf(x, 3) : '—'}</td>`; }).join('');
        const sep = this.po === 'order' && l.s !== prevS ? `<tr class="ses"><td colspan="16">${sesN(l.s)}</td></tr>` : ''; prevS = l.s;
        return sep + `<tr class="${ok ? '' : 'off'} ${isBest ? 'best' : ''}">${this.po === 'fast' ? `<td>${sesN(l.s)}</td>` : ''}<td class="num">${l.lap}</td><td>${tyre(l.c)} <small>${l.age} v</small></td>
          <td class="num ${condOf(l) === 'wet' ? 'wetc' : ''}">${Math.round(waterOf(l) * 100)} %</td><td class="num">${Math.round(l.w0 * 100)} %</td><td class="num">${l.fuel != null ? Math.round(l.fuel) : '—'}</td><td>${TRIM_N[l.trim]}</td><td>${SUSP_N[l.susp]}</td><td>${PACE_N[l.pace]}</td><td>${ERS_N[l.ers]}</td>${sec}
          <td class="num">${fmt(l.t)}</td><td class="num"><b>${fmt(l.tf)}</b></td><td class="why">${l.test ? '<small class="tst">consist.</small> ' : ''}${!l.ok ? l.why || 'no cuenta' : !rightTyre(l) ? 'goma equivocada' : isBest ? 'mejor' : ''}${condOf(l) === 'wet' && ok ? ' <small class="wetc">mojado</small>' : ''}</td></tr>`;
      }).join('');
      return `<div class="lblk" style="--tcol:${car.team.c1}"><div class="cmph"><span class="bar" style="background:${car.team.c1}"></span><b>${esc(car.drv.last)}</b><span class="k">${CL.length} vueltas · mejor ${best ? fmt(best.tf) : '—'}</span></div>
        <div class="ltw"><table class="pt lt"><thead><tr>${this.po === 'fast' ? '<th>Sesión</th>' : ''}<th class="num">V</th><th>Goma</th><th class="num">Agua</th><th class="num">Desg.</th><th class="num">Gas.</th><th>Alerón</th><th>Susp.</th><th>Ritmo</th><th>Motor</th><th class="num">S1</th><th class="num">S2</th><th class="num">S3</th><th class="num">Tiempo</th><th class="num">Corregido</th><th></th></tr></thead><tbody>${body}</tbody></table></div></div>`;
    };
    return seg + this.cars.map(block).join('') + '<p class="leg">Morado: su mejor sector. Verde: su mejor vuelta. En gris, las que no cuentan (error, tráfico, bandera, paso por boxes, salida o goma equivocada para el agua que había). Las de mojado con la goma buena cuentan, pero se comparan aparte (filtro Seco/Mojado).</p>';
  }

  // radar: agua ahora (en la trazada y fuera) y la lluvia que viene en los próximos minutos (del guion del tiempo)
  radar(big) {
    const W = this.sim.wx; if (!W) return '';
    const t = this.sim.t, H = 15 * 60, cells = big ? 45 : 30;
    const at = (tt) => { let r = W.ev[0]?.rain ?? 0; for (const e of W.ev) if (e.t <= tt) r = e.rain; return r; };
    const bars = Array.from({ length: cells }, (_, k) => {
      const tt = t + (k / cells) * H, r = k === 0 ? W.rain : at(tt);
      const h = Math.round(Math.min(1, r) * 100), col = r < 0.05 ? 'rgba(255,255,255,0.08)' : r < 0.3 ? '#4FC3F7' : r < 0.6 ? '#2F7BFF' : '#7C4DFF';
      return `<i style="height:${Math.max(6, h)}%;background:${col}"></i>`;
    }).join('');
    const next = W.ev.find((e) => e.t > t);
    const txt = next ? (next.rain > W.target + 0.05 ? `Lluvia ${next.rain > 0.6 ? 'fuerte' : next.rain > 0.3 ? 'moderada' : 'débil'} en ~${Math.max(1, Math.round((next.t - t) / 60))} min` : `Para en ~${Math.max(1, Math.round((next.t - t) / 60))} min`) : W.rain > 0.05 ? 'Sigue lloviendo' : 'Sin lluvia a la vista';
    const rec = W.line < 0.2 ? 'lisos' : W.line < 0.78 ? 'intermedios' : 'lluvia extrema';
    return `<div class="gtitle"><b>Radar · próximos 15 minutos</b><span>${txt}</span></div><div class="rad big"><div class="rb">${bars}</div><div class="rx"><span>ahora</span><span>+5 min</span><span>+10 min</span><span>+15</span></div>
      <div class="rw"><span>Agua en la trazada <b>${Math.round(W.line * 100)} %</b></span><span>Fuera <b>${Math.round(W.wet * 100)} %</b></span><span>Goma ideal ahora <b>${rec}</b></span></div></div>`;
  }

  // ------------------------------------------------------------------ resumen al acabar la carrera
  summaryHTML(cls) {
    const sim = this.sim, N = sim.raceLaps, pts = (c) => { const p = cls.indexOf(c); return c.retired || p < 0 || p > 9 ? 0 : PTS[p]; };
    const teamPts = new Map(); cls.forEach((c, p) => { if (!c.retired && p < 10) teamPts.set(c.team.id, (teamPts.get(c.team.id) || 0) + PTS[p]); });
    const ranking = [...new Set(sim.cars.map((c) => c.team.id))].map((id) => [id, teamPts.get(id) || 0]).sort((a, b) => b[1] - a[1]);
    const myPts = this.cars.reduce((a, c) => a + pts(c), 0), myRank = ranking.findIndex(([id]) => id === this.teamId) + 1;
    const bar = (st) => `<div class="sbar">${st.map((s) => `<i style="flex:${Math.max(1, s.to - s.from)};background:${COMPOUNDS[s.c].color}" title="${COMPOUNDS[s.c].name} V${s.from}–${s.to}">${s.c}</i>`).join('')}</div>`;
    const cards = this.cars.map((c) => {
      const p = cls.indexOf(c) + 1, M = c.mgr, real = c.strategy.stints.slice(0, c.stint + 1).map((s, k) => ({ ...s, to: k === c.stint ? Math.min(N, Math.max(s.from + 1, c.lap)) : s.to }));
      const L = M.laps.filter((l) => l.s === 'RACE'), pc = (v) => (L.length ? Math.round((L.filter((l) => l.pace === v).length / L.length) * 100) : 0);
      const dec = this.log.filter((d) => d.car === c && d.s === 'RACE').map((d) => {
        const after = c.hist[Math.min(c.hist.length - 1, d.lap + 3)], dp = after != null && d.pos ? d.pos - after : null;
        return `<li><span class="lp">V${d.lap}</span>${esc(d.txt)}${dp != null ? ` <em class="${dp > 0 ? 'up' : dp < 0 ? 'down' : ''}">P${d.pos} → P${after}${dp ? ` (${dp > 0 ? '+' : ''}${dp})` : ''}</em>` : ''}</li>`;
      }).join('');
      const pitT = M.stopsLog.reduce((a, s) => a + s.time, 0);
      return `<div class="scard"><div class="sh"><span class="bar" style="background:${c.team.c1}"></span><b>${esc(c.drv.last)}</b><span class="res">${c.retired ? 'Abandono' : `P${p}`}</span><span class="k">sale P${c.gridPos} · ${pts(c)} pts</span></div>
        <div class="srow"><span class="k">Plan inicial</span>${bar(M.plan0 || [])}</div><div class="srow"><span class="k">Lo que hizo</span>${bar(real)}</div>
        <div class="sst"><span>Paradas <b>${M.stopsLog.length}</b>${M.stopsLog.length ? ` (${M.stopsLog.map((s) => `V${s.lap} ${s.from}→${s.c} ${nf(s.time)} s`).join(', ')})` : ''}</span><span>En boxes <b>${nf(pitT)} s</b></span>
          <span>Mejor vuelta <b>${fmt(c.best)}</b></span><span>Ritmo <b>${pc('push')} %</b> atacando · <b>${pc('normal')} %</b> normal · <b>${pc('save')} %</b> cuidando</span></div>
        <ul class="dec">${dec || '<li class="none">Sin decisiones en carrera: todo según el plan.</li>'}</ul></div>`;
    }).join('');
    return `<div class="mgrSum"><div class="sumh"><b>Tu muro · ${esc(this.cars[0].team.name)}</b><span><b>${myPts}</b> puntos · ${myRank}.º de ${ranking.length} equipos en este GP</span></div>
      <p class="leg">Cada decisión con la posición de entonces y la de 3 vueltas después.</p><div class="scards">${cards}</div></div>`;
  }
}

const pick = (a) => a[Math.floor(Math.random() * a.length)];
