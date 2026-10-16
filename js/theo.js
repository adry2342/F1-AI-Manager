// Vuelta teórica: lo que aprende un piloto medido sin el ruido de la pista (tráfico, gasolina, gomas, errores).
// Con el mismo modelo de coche que la trazada ideal (tools/ideal.mjs), se calcula la vuelta que daría con su trazada
// y con el agarre que se atreve a usar en cada curva, y se compara con la ideal del circuito:
//   pérdida por trazada = su trazada al 100 % − la ideal al 100 %
//   pérdida por ataque  = su trazada con su compromiso − su trazada al 100 %
// Así se ve lo que ha aprendido aunque sus tiempos reales estén tapados por el tráfico o por la goma.
import { buildLine, lineGeometry } from './brain.js';
import { gearPower } from './sim.js';
import { IDEAL_NODES } from './idealNodes.js';

const G = 9.81, MU = 1.53, A = 0.0038, MASS = 800, CD = 0.96, ROLL = 160, BRK = 0.67, TRAC = 0.58, PW = 770 * 1000 * 0.96;
const ell = (r) => (r >= 0.993 ? 0.12 : Math.max(0.12, Math.sqrt(1 - r * r)));
const buf = new Map();

// tiempo de vuelta del modelo con esos nodos; commit: agarre usado en cada zona de curva (null = todo al 100 %)
export function modelLap(T, nodes, commit = null) {
  const N = T.N;
  let B = buf.get(T); if (!B) buf.set(T, B = { k: new Float64Array(N), len: new Float64Array(N), v: new Float64Array(N), line: new Float64Array(N), mu: new Float64Array(N) });
  const { k, len, v, line, mu } = B, zoneOf = T.zoneOf;
  buildLine(T, { nodes }, line); lineGeometry(T, line, k, len);
  for (let i = 0; i < N; i++) {
    const z = zoneOf[i], m = mu[i] = MU * (commit && z >= 0 ? Math.min(1.05, commit[z]) : 1);
    const kk = Math.abs(k[i]), den = kk - m * A; v[i] = den <= 1e-6 ? 110 : Math.min(110, Math.sqrt(m * G / den));
  }
  for (let p = 0; p < 2; p++) for (let i = N - 1; i >= 0; i--) {
    const vn = v[(i + 1) % N], cap = mu[i] * (G + A * vn * vn);
    const dec = BRK * cap * ell(vn * vn * Math.abs(k[i]) / cap) + (CD * vn * vn + ROLL) / MASS;
    const lim = Math.sqrt(vn * vn + 2 * dec * len[i]); if (lim < v[i]) v[i] = lim;
  }
  for (let p = 0; p < 2; p++) for (let i = 0; i < N; i++) {
    const vp = v[(i - 1 + N) % N], cap = mu[i] * (G + A * vp * vp);
    const acc = Math.min(TRAC * cap * ell(vp * vp * Math.abs(k[i]) / cap), PW * gearPower(vp) / (MASS * Math.max(vp, 8))) - (CD * vp * vp + ROLL) / MASS;
    const lim = Math.sqrt(Math.max(0, vp * vp + 2 * acc * len[i])); if (lim < v[i]) v[i] = lim;
  }
  let t = 0; for (let i = 0; i < N; i++) t += len[i] / v[i];
  return t;
}

const idealCache = new Map();
export function idealLap(T) {
  if (!idealCache.has(T)) { const I = IDEAL_NODES[T.meta.id]; idealCache.set(T, I ? modelLap(T, I.nodes) : NaN); }
  return idealCache.get(T);
}

// la de un piloto con su memoria de seco o de mojado (kb: { nodes, commit })
export function theoLap(T, kb) {
  const ideal = idealLap(T), line = modelLap(T, kb.nodes), full = modelLap(T, kb.nodes, kb.commit);
  return { t: full, ideal, line: Math.max(0, line - ideal), att: Math.max(0, full - line), pct: (ideal / full) * 100 };
}
