// Copia completa del estado de la simulación (multijugador): el anfitrión la manda y el invitado la carga encima de la
// suya. Sirve para corregir cualquier desincronización al momento y para volver a entrar a mitad de partida.
// Recorre todo lo que cuelga de la simulación (coches, cerebros, estrategias, tiempo, sesión, muros...) guardando las
// referencias compartidas; lo que es igual en todas las máquinas (circuito, equipos, pilotos, constantes) no se copia,
// se nombra. Los coches se rellenan en sus mismos objetos, así lo que los apunta (cámaras, HUD, muros) sigue valiendo.
import { TEAMS, DRIVERS, COMPOUNDS } from './teams.js';
import { MGR, SESSIONS } from './sim.js';

const SKIP = new Set(['T', 'listeners', 'rng']);
const TYPED = { Float64Array, Float32Array, Int32Array, Int16Array, Int8Array, Uint8Array, Uint16Array, Uint32Array, Uint8ClampedArray };

// objetos comunes a todas las máquinas -> nombre (mismo nombre en todas porque se construyen igual)
function externals(sim) {
  if (sim.__ext) return sim.__ext;
  const toKey = new Map(), toObj = new Map();
  const walk = (o, key, depth) => {
    if (!o || typeof o !== 'object' || toKey.has(o)) return;
    toKey.set(o, key); toObj.set(key, o);
    if (ArrayBuffer.isView(o) || depth > 7) return;
    if (Array.isArray(o) && o.length && typeof o[0] !== 'object') return;   // listas de números: nada que nombrar dentro
    for (const k of Object.keys(o)) walk(o[k], key + '.' + k, depth + 1);
  };
  walk(sim.T, 'T', 0); walk(TEAMS, 'TEAMS', 0); walk(DRIVERS, 'DRIVERS', 0); walk(COMPOUNDS, 'COMPOUNDS', 0); walk(MGR, 'MGR', 0); walk(SESSIONS, 'SESSIONS', 0);
  Object.defineProperty(sim, '__ext', { value: { toKey, toObj }, enumerable: false });
  return sim.__ext;
}

const b64 = {
  enc(u8) {
    if (typeof Buffer !== 'undefined') return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
    let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  },
  dec(str) {
    if (typeof Buffer !== 'undefined') { const b = Buffer.from(str, 'base64'); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); }
    const s = atob(str), u8 = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i); return u8;
  },
};

export function snapshot(sim) {
  const { toKey } = externals(sim);
  const ids = new Map(), objs = [];
  const anchors = new Map(sim.cars.map((c, i) => [c, i]));
  const val = (v) => {
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? (Object.is(v, -0) ? { n: '-0' } : v) : { n: Number.isNaN(v) ? 'N' : v > 0 ? 'I' : '-I' };
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') return { u: 1 };
    const ext = toKey.get(v); if (ext != null) return { x: ext };
    let id = ids.get(v); if (id != null) return { r: id };
    id = objs.length; ids.set(v, id); objs.push(null);
    objs[id] = enc(v);
    return { r: id };
  };
  const enc = (v) => {
    if (ArrayBuffer.isView(v)) return { ta: v.constructor.name, b: b64.enc(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    if (Array.isArray(v)) return { a: v.map(val) };
    if (v instanceof Set) return { set: [...v].map(val) };
    if (v instanceof Map) return { map: [...v].map(([k, x]) => [val(k), val(x)]) };
    const o = {};
    for (const k of Object.keys(v)) { if (typeof v[k] === 'function') continue; if (v === sim && SKIP.has(k)) continue; o[k] = val(v[k]); }
    const r = { o };
    if (anchors.has(v)) r.car = anchors.get(v);
    return r;
  };
  const root = val(sim);
  return { v: 1, root, objs, rng: sim.rng.s };
}

export function restore(sim, snap) {
  const { toObj } = externals(sim);
  const objs = snap.objs, made = new Array(objs.length);
  // 1) crear (o reutilizar: la simulación y cada coche) los objetos, sin rellenar
  for (let i = 0; i < objs.length; i++) {
    const e = objs[i];
    if (e.ta) { const u8 = b64.dec(e.b), C = TYPED[e.ta]; made[i] = new C(u8.slice().buffer); continue; }
    if (e.a) made[i] = []; else if (e.set) made[i] = new Set(); else if (e.map) made[i] = new Map();
    else if (snap.root.r === i) made[i] = sim;
    else if (e.car != null && sim.cars[e.car]) made[i] = sim.cars[e.car];
    else made[i] = {};
  }
  const val = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if ('r' in v) return made[v.r];
    if ('x' in v) return toObj.get(v.x);
    if ('n' in v) return v.n === '-0' ? -0 : v.n === 'N' ? NaN : v.n === 'I' ? Infinity : -Infinity;
    return undefined;
  };
  // 2) rellenar
  for (let i = 0; i < objs.length; i++) {
    const e = objs[i], t = made[i];
    if (e.ta) continue;
    if (e.a) { for (const x of e.a) t.push(val(x)); continue; }
    if (e.set) { for (const x of e.set) t.add(val(x)); continue; }
    if (e.map) { for (const [k, x] of e.map) t.set(val(k), val(x)); continue; }
    if (t === sim || e.car != null) {
      // objeto que ya existía: fuera lo que el anfitrión no tiene (menos funciones y lo propio de cada máquina)
      for (const k of Object.keys(t)) if (!(k in e.o) && typeof t[k] !== 'function' && !(t === sim && SKIP.has(k))) delete t[k];
    }
    for (const k of Object.keys(e.o)) t[k] = val(e.o[k]);
  }
  sim.rng.s = snap.rng;
}
