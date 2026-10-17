// Punta Serena (costa a mediodía): acantilados y calas, mar con fondo que se ve en lo poco profundo, puerto con muelle,
// rompeolas y barcos, pueblo blanco en la colina con el túnel por debajo, faro en el cabo, pinos, olivos y cipreses,
// villas con piscina, molinos, una playa con sombrillas y veleros. Todo instanciado o en geometrías juntas.
import * as THREE from 'three';
import { between } from './track.js';
import { inst, chunked, merged, tintMat, lin, flagAtlas } from './forest.js';

const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (x) => { const s = Math.sin(x * 127.1) * 43758.5453; return s - Math.floor(s); };

// ------------------------------------------------------------------ terreno de la costa (lo usa world.js al crear el suelo)
// sd = distancia con signo a la línea de costa (+ tierra adentro); la costa del polígono se ondula salvo junto a la pista
export function coastTerrain(T) {
  // el borde del muelle sale de la propia pista
  const LAND = [];
  for (const v of T.meta.land) {
    if (v !== 'quay') { LAND.push(v); continue; }
    const [q0, q1, off] = T.meta.quay, P = [0, 0, 0];
    for (let s = q0; s <= q1 + 0.1; s += 15) { T.pos(s, T.hwAt(s) + off, P); LAND.push([P[0], P[2]]); }
  }
  const n = LAND.length;
  const edges = LAND.map((p, i) => [p, LAND[(i + 1) % n]]);
  const inside = (x, z) => {
    let c = false;
    for (const [a, b] of edges) if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    return c;
  };
  const rawSD = (x, z) => {
    let m = 1e18;
    for (const [a, b] of edges) {
      const ex = b[0] - a[0], ez = b[1] - a[1], t = Math.min(1, Math.max(0, ((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez)));
      const dx = x - a[0] - ex * t, dz = z - a[1] - ez * t; m = Math.min(m, dx * dx + dz * dz);
    }
    return (inside(x, z) ? 1 : -1) * Math.sqrt(m);
  };
  // distancia a la pista (rejilla gruesa propia: T.nearest solo mira cerca)
  const tdist = (x, z) => { const q = T.nearest(x, z, 4); if (q.i >= 0) return q.d; let b = 1e18; for (let i = 0; i < T.N; i += 16) b = Math.min(b, (T.x[i] - x) ** 2 + (T.z[i] - z) ** 2); return Math.sqrt(b); };
  // rejilla de 8 m con la distancia a la costa ya ondulada
  let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
  for (let i = 0; i < T.N; i += 10) { bx0 = Math.min(bx0, T.x[i]); bx1 = Math.max(bx1, T.x[i]); bz0 = Math.min(bz0, T.z[i]); bz1 = Math.max(bz1, T.z[i]); }
  const C = 8, gx0 = bx0 - 1500, gz0 = bz0 - 1500, GX = Math.ceil((bx1 - bx0 + 3000) / C) + 1, GZ = Math.ceil((bz1 - bz0 + 3000) / C) + 1;
  const grid = new Float32Array(GX * GZ);
  for (let j = 0; j < GZ; j++) for (let i = 0; i < GX; i++) {
    const x = gx0 + i * C, z = gz0 + j * C;
    let v = rawSD(x, z);
    if (Math.abs(v) < 160) {
      const calm = sstep(30, 110, tdist(x, z));        // junto a la pista (muelle) la orilla es recta
      v += calm * (13 * Math.sin(x * 0.011 + z * 0.017) * Math.sin(x * 0.007 - z * 0.013 + 1) + 5 * Math.sin(x * 0.05 + z * 0.04) + 2.5 * Math.sin(x * 0.13 - z * 0.11));
    }
    grid[j * GX + i] = v;
  }
  const sd = (x, z) => {
    const u = (x - gx0) / C, w = (z - gz0) / C;
    if (u < 0 || w < 0 || u >= GX - 1 || w >= GZ - 1) return rawSD(x, z);
    const i = Math.floor(u), j = Math.floor(w), fu = u - i, fw = w - j, k = j * GX + i;
    return (grid[k] * (1 - fu) + grid[k + 1] * fu) * (1 - fw) + (grid[k + GX] * (1 - fu) + grid[k + GX + 1] * fu) * fw;
  };
  // playas: cala en la costa sur, playa larga al noroeste y otra en la tierra firme del oeste
  const BEACH = [[90, 1015, 300, 120], [-700, -175, 280, 100], [-1700, 520, 420, 140]];
  const beachW = (x, z) => { let b = 0; for (const [cx, cz, rx, rz] of BEACH) b = Math.max(b, Math.exp(-(((x - cx) / rx) ** 4 + ((z - cz) / rz) ** 2) * 1.2)); return b; };
  // puerto (dársena dragada)
  const inHarbour = (x, z) => x > 930 && x < 1345 && z > 410 && z < 770;
  // relieve tierra adentro: meseta alta al norte y oeste, más baja hacia el puerto y la costa sur; colina del pueblo y cabo
  // muestras del eje del túnel: la colina sigue por encima de él (si no, a la salida apenas había monte)
  const tunPts = []; if (T.meta.tunnel) for (let s = T.meta.tunnel[0] - 30; s <= T.meta.tunnel[1] + 30; s += 15) { const i = T.idx(s); tunPts.push([T.x[i], T.z[i]]); }
  const landH = (x, z) => {
    let tb = 1e9; for (const [px, pz] of tunPts) tb = Math.min(tb, (px - x) ** 2 + (pz - z) ** 2);
    let h = 26 * Math.exp(-tb / (75 * 75)) + 36 + 6 * Math.sin(x * 0.0042 + 0.8) * Math.cos(z * 0.0051 - 0.3) + 3 * Math.sin(x * 0.012 - z * 0.009) + 1.2 * Math.sin(x * 0.037 + z * 0.029);
    h -= 14 * sstep(450, 1000, z) * sstep(-400, 500, x);
    h += 32 * Math.exp(-(((x - 800) / 230) ** 2 + ((z - 540) / 260) ** 2));          // colina del pueblo
    h += 20 * Math.exp(-(((x - 1050) / 150) ** 2 + ((z - 830) / 115) ** 2));         // cabo del sureste (sobre el túnel)
    h += 10 * Math.exp(-(((x + 860) / 120) ** 2 + ((z - 800) / 110) ** 2));          // cabo del faro
    h += Math.max(0, -x - 1100) * 0.07 * (0.7 + 0.3 * Math.sin(z * 0.004));          // tierra firme: sube hacia los montes
    return h;
  };
  const SEA0 = -1.2;
  const land = (x, z, s = sd(x, z)) => {
    const bw = beachW(x, z);
    if (s < 0) {
      let f = SEA0 - Math.min(28, -s * 0.07) - (1 - bw) * 5 * sstep(0, 12, -s);
      if (inHarbour(x, z)) f = Math.min(f, -6);
      return f;
    }
    const lh = landH(x, z);
    const cliff = 0.8 + (lh - 0.8) * sstep(0, 16, s), beach = Math.min(lh, s < 55 ? 0.3 + s * 0.028 : 1.84 + (s - 55) * 0.12);
    return cliff * (1 - bw) + beach * bw;
  };
  // rejilla de la pista para el «techo» (ningún tramo queda enterrado por el suelo de otro)
  const tCell = 40, tGrid = new Map();
  for (let i = 0; i < T.N; i += 3) { const k = Math.floor(T.x[i] / tCell) * 100003 + Math.floor(T.z[i] / tCell); let l = tGrid.get(k); if (!l) tGrid.set(k, (l = [])); l.push(i); }
  const tun = T.meta.tunnel, P = [0, 0, 0];
  // paddock (detrás de los garajes): explanada a la altura de la pista, como scenery.js la pinta (s0, largo)
  const pk0 = T.wrap(T.pit.boxes[0].s - 70), pkL = T.ahead(pk0, T.wrap(T.pit.boxes[T.pit.boxes.length - 1].s + 90));
  const paddockK = (s, lat) => { const a = T.ahead(T.wrap(pk0 - 40), s); return lat < 0 && a < pkL + 80 ? sstep(0, 40, a) * sstep(0, 40, pkL + 80 - a) * (1 - sstep(152, 190, -lat)) : 0; };
  const nearPortal = (s) => (tun ? Math.min(Math.abs(T.rel(s, tun[0])), Math.abs(T.rel(s, tun[1]))) : 1e9);
  const G = (x, z) => {
    const s0 = sd(x, z), L = land(x, z, s0);
    const q = T.nearest(x, z, 6);
    let g = L;
    if (q.i >= 0) {
      const s = q.i * T.ds, dx = x - T.x[q.i], dz = z - T.z[q.i], side = dx * T.lx[q.i] + dz * T.lz[q.i] >= 0 ? 1 : -1;
      const hw = T.hw[q.i], B = T.barrier(s, side);
      const ty = T.pos(s, side * Math.min(q.d, hw + 0.4), P)[1] - 0.45;
      const inT = T.inTunnel(s), np = nearPortal(s);
      // el suelo sigue a la pista hasta 6 m pasado el muro y luego sube hacia el relieve. Túnel: llano hasta el bloque y
      // luego la colina; trinchera de acceso: llano 12 m detrás del muro (una celda de la malla: así la ladera interpolada
      // no se mete dentro de los muros) y luego empinado, cada vez menos al alejarse de la boca
      let a0 = B + 6, span = 70;
      const e = sstep(a0, a0 + span, q.d);
      g = ty * (1 - e) + L * e;
      // túnel: la colina sigue por encima, al menos 11,5 m sobre la pista hasta 24 m del eje (techo, losa y muros dentro)
      if (inT) g = Math.max(L, ty + 12 - 6 * sstep(hw + 24, hw + 60, q.d));
      // sobre las bocas: la colina baja hasta la explanada que hay encima de cada boca (14 m hacia dentro, a 15 m sobre la
      // pista: buildCoast) y sube desde ella en un cortado (3 m por metro). Antes la ladera subía a pico desde la boca y los triángulos que tocaban
      // la trinchera se quitaban: quedaba una raja por la que se veía el cielo a través de la colina
      if (inT && np < 80) g = Math.min(g, Math.max(ty + 12, ty + 0.45 + 15 + 3 * Math.max(0, np - 14) + 3 * Math.max(0, q.d - (hw + 22))));
      // todos los tramos cercanos (no solo el más cercano): dentro de los muros de cualquiera, el suelo a la altura de su
      // pista (en la bajada en zigzag, la escapatoria de un tramo quedaba bajo la ladera del otro); fuera, techo: no sube
      // más de 0,55 m por metro desde 6 m detrás de su muro
      const cx = Math.floor(x / tCell), cz = Math.floor(z / tCell);
      let corr = 1e9, cap = 1e9;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
        const lst = tGrid.get((cx + a) * 100003 + cz + b); if (!lst) continue;
        for (const i of lst) {
          const ex = x - T.x[i], ez = z - T.z[i], ds = Math.hypot(ex, ez); if (ds > 90) continue;
          const si = i * T.ds, lat = ex * T.lx[i] + ez * T.lz[i], Bi = T.barrier(si, lat >= 0 ? 1 : -1);
          if (T.inTunnel(si)) continue;
          if (Math.abs(lat) < Bi + 1.5 && Math.abs(ex * T.tx[i] + ez * T.tz[i]) < 1.7 * (1 + Math.abs(lat * T.k[i]))) corr = Math.min(corr, T.y[i] - 0.45 - Math.abs(T.bank[i] * Math.min(Math.abs(lat), T.hw[i])));
          if (!T.inTunnel(si)) cap = Math.min(cap, T.y[i] - 0.3 + 0.55 * Math.max(0, Math.abs(lat) - Bi - 6) + 0.55 * Math.max(0, ds - Math.abs(lat)));
        }
      }
      if (corr < 1e8) g = corr; else if (!inT) g = Math.min(g, cap);
      const pk = corr < 1e8 ? 0 : paddockK(s, side * q.d);
      if (pk > 0) g += (T.y[q.i] - 0.5 - g) * pk;
    }
    if (s0 < 14) g = Math.min(g, s0 <= 0 ? L : SEA0 - 4 + (s0 / 14) * 200);   // el mar manda junto a la orilla
    return g;
  };
  const isSea = (x, z, rad = 0) => sd(x, z) < rad + 3;
  // ¿(x, z) está dentro de los muros de algún tramo? (margen m más allá del muro) -> { y de su pista, s } o null
  const corridor = (x, z, margin = 0, skipS = null) => {
    const cx = Math.floor(x / tCell), cz = Math.floor(z / tCell); let best = null;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const lst = tGrid.get((cx + a) * 100003 + cz + b); if (!lst) continue;
      for (const i of lst) {
        const ex = x - T.x[i], ez = z - T.z[i], lat = ex * T.lx[i] + ez * T.lz[i];
        // (muestras cada 3 m: por fuera de una curva se separan más; la tolerancia crece con la distancia al eje)
        if (Math.abs(ex * T.tx[i] + ez * T.tz[i]) > 1.7 * (1 + Math.abs(lat * T.k[i]))) continue;
        const si = i * T.ds; if (T.inTunnel(si) || (skipS != null && Math.abs(T.rel(si, skipS)) < 60)) continue;
        if (Math.abs(lat) < T.barrier(si, lat >= 0 ? 1 : -1) + margin && (!best || T.y[i] < best.y)) best = { y: T.y[i], s: si, lat };
      }
    }
    return best;
  };

  // colores del suelo: hierba seca dorada, matorral verde grisáceo, tierra rojiza, roca caliza en lo empinado,
  // arena en las playas, césped regado junto a la pista
  const paint = (geo, nx, nz, col) => {
    const p = geo.attributes.position, W = nx + 1;
    const lin = (r, g, b) => [Math.pow(r, 2.2) * 1.45, Math.pow(g, 2.2) * 1.45, Math.pow(b, 2.2) * 1.45];
    const DRY = [0.70, 0.60, 0.36], DRY2 = [0.62, 0.55, 0.33], SCRUB = [0.38, 0.42, 0.26], SOIL = [0.66, 0.46, 0.30], ROCK = [0.92, 0.88, 0.80], ROCK2 = [0.86, 0.80, 0.70];
    const SAND = [0.92, 0.85, 0.68], WETS = [0.66, 0.60, 0.46], LAWN = [0.40, 0.52, 0.24], FLOOR = [0.72, 0.68, 0.52];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const k = j * W + i, x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const yl = p.getY(j * W + Math.max(0, i - 1)), yr = p.getY(j * W + Math.min(nx, i + 1)), yu = p.getY(Math.max(0, j - 1) * W + i), yd = p.getY(Math.min(nz, j + 1) * W + i);
      const dxv = p.getX(j * W + Math.min(nx, i + 1)) - p.getX(j * W + Math.max(0, i - 1)), dzv = p.getZ(Math.min(nz, j + 1) * W + i) - p.getZ(Math.max(0, j - 1) * W + i);
      const slope = Math.hypot((yr - yl) / (dxv || 1), (yd - yu) / (dzv || 1));
      const jit = 0.9 + 0.16 * hash(Math.floor(x / 17) * 3.1 + Math.floor(z / 17) * 7.7);
      const n1 = 0.5 + 0.28 * Math.sin(x * 0.013 + z * 0.009 + Math.sin(z * 0.004) * 2) + 0.16 * Math.sin(x * 0.031 - z * 0.023 + Math.sin(x * 0.011)) + 0.08 * Math.sin(x * 0.083 + z * 0.067);
      const n2 = hash(Math.floor(x / 41) * 1.7 + Math.floor(z / 37) * 9.3);
      let c;
      if (y < 0.2) c = FLOOR;
      else {
        const bw = beachW(x, z);
        let base = n1 > 0.62 ? SCRUB : n2 < 0.18 ? SOIL : n1 < 0.3 ? DRY2 : DRY;
        const q = T.nearest(x, z, 3), lawn = q.i >= 0 ? 1 - sstep(25, 60, q.d - T.hw[q.i]) : 0;
        base = mix3(base, LAWN, lawn * 0.85);
        const tw = 1 - sstep(250, 335, Math.hypot(x - 800, z - 545));            // pueblo: suelo de piedra y tierra
        base = mix3(base, n1 > 0.48 ? [0.40, 0.47, 0.27] : n2 < 0.45 ? [0.78, 0.73, 0.64] : [0.50, 0.53, 0.32], tw * 0.85);
        const rock = sstep(0.55, 1.1, slope);
        const strata = 0.5 + 0.5 * Math.sin(y * 1.1 + Math.sin(x * 0.05 + z * 0.04) * 2.5), streak = hash(Math.floor((x + z) / 3.3)) * 0.12;
        base = mix3(base, mix3(n2 > 0.5 ? ROCK : ROCK2, [0.70, 0.63, 0.52], strata * 0.18 + streak * 0.6), rock);
        if (bw > 0.25 && y < 6) base = mix3(base, y < 0.9 ? WETS : SAND, sstep(0.25, 0.6, bw) * (1 - sstep(4, 6, y)));
        c = base;
      }
      const l = lin(c[0] * jit, c[1] * jit, c[2] * jit);
      col[k * 3] = l[0]; col[k * 3 + 1] = l[1]; col[k * 3 + 2] = l[2];
    }
  };
  return { G, land, sd, isSea, paint, landH, beachW, inHarbour, corridor };
}
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ------------------------------------------------------------------ mar: color según la profundidad (turquesa en lo poco
// profundo, azul marino lejos), olas con brillo del sol, cielo reflejado y espuma en la orilla
function buildSea(ctx) {
  const { scene, world } = ctx;
  const geo = world.terrainGeo, gr = world.terrainGrid, p = geo.attributes.position, W = gr.nx + 1, H = gr.nz + 1;
  const data = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const y = p.getY(j * W + i); data[j * W + i] = Math.max(0, Math.min(255, Math.round(-y * 10))); }
  const depthTex = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  depthTex.magFilter = depthTex.minFilter = THREE.LinearFilter; depthTex.needsUpdate = true;
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uDepth: { value: null }, uBox: { value: new THREE.Vector4(gr.x0, gr.z0, 1 / (gr.x1 - gr.x0), 1 / (gr.z1 - gr.z0)) },
    uTime: { value: 0 }, uSun: { value: world.sunDir.clone().normalize() }, uSunCol: { value: new THREE.Color(1.0, 0.93, 0.8) },
  }]);
  uniforms.uDepth.value = depthTex;
  const mat = new THREE.ShaderMaterial({
    uniforms, fog: true,
    vertexShader: `varying vec3 vW;
      #include <fog_pars_vertex>
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform sampler2D uDepth; uniform vec4 uBox; uniform float uTime; uniform vec3 uSun; uniform vec3 uSunCol; varying vec3 vW;
      #include <fog_pars_fragment>
      vec2 wave(vec2 p, vec2 d, float f, float a, float s){ float ph = dot(p, d) * f + uTime * s; return d * cos(ph) * a * f; }
      void main(){
        vec2 uv = (vW.xz - uBox.xy) * uBox.zw;
        float depth = (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) ? 40.0 : texture2D(uDepth, uv).r * 25.5;
        if (depth > 25.0) depth = 40.0;
        float dist = length(cameraPosition - vW);
        float fine = 1.0 - smoothstep(150.0, 900.0, dist);
        vec2 p = vW.xz, g = vec2(0.0);
        float far = 1.0 - 0.6 * smoothstep(300.0, 2500.0, dist);                 // de lejos, sin las rayas de las olas largas
        g += wave(p, normalize(vec2(0.8, 0.6)), 0.045, 0.32, 1.1) * far;
        g += wave(p, normalize(vec2(-0.3, 1.0)), 0.07, 0.2, 1.6) * far;
        g += wave(p, normalize(vec2(0.95, -0.35)), 0.11, 0.12, 2.1);
        g += wave(p, normalize(vec2(-0.7, -0.7)), 0.19, 0.07, 2.6);
        g += wave(p, normalize(vec2(0.2, -1.0)), 0.31, 0.05, 3.0) * fine;
        g += wave(p, normalize(vec2(-0.9, -0.3)), 0.57, 0.025, 3.9) * fine;
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 V = normalize(cameraPosition - vW);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        vec3 shallow = vec3(0.18, 0.66, 0.64), mid = vec3(0.04, 0.36, 0.52), deep = vec3(0.012, 0.13, 0.27);
        vec3 base = mix(shallow, mid, smoothstep(0.6, 6.0, depth));
        base = mix(base, deep, smoothstep(6.0, 24.0, depth));
        base = mix(vec3(0.80, 0.76, 0.60), base, smoothstep(0.0, 1.1, depth));            // arena bajo muy poca agua
        float lit = 0.55 + 0.45 * max(dot(n, uSun), 0.0);
        vec3 R = reflect(-V, n); R.y = abs(R.y);
        vec3 sky = mix(vec3(0.45, 0.63, 0.84), vec3(0.10, 0.30, 0.68), pow(clamp(R.y, 0.0, 1.0), 0.5));
        vec3 col = mix(base * lit, sky, fres * 0.85);
        float sd = max(dot(R, uSun), 0.0);
        col += uSunCol * (pow(sd, 700.0) * 9.0 + pow(sd, 60.0) * 0.35 * fine + pow(sd, 8.0) * 0.06);
        // espuma: rompe en la orilla, con rizos que avanzan
        float foam = (1.0 - smoothstep(0.05, 0.9, depth)) * (0.55 + 0.45 * sin(dot(p, vec2(0.21, 0.17)) + uTime * 1.3 + depth * 7.0));
        foam = max(foam, (1.0 - smoothstep(0.0, 0.35, depth)));
        col = mix(col, vec3(0.96, 0.97, 0.97), clamp(foam, 0.0, 1.0) * 0.8 * step(0.01, depth));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const cx = (gr.x0 + gr.x1) / 2, cz = (gr.z0 + gr.z1) / 2;
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(26000, 26000, 1, 1), mat);
  sea.rotation.x = -Math.PI / 2; sea.position.set(cx, 0, cz); sea.userData.noOcclude = true;
  scene.add(sea);
  return { update: (dt) => { uniforms.uTime.value += dt; } };
}

// ------------------------------------------------------------------ texturas
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function ctex(c, rep = true) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; }
function rnd(seed) { let a = seed >>> 0; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }

// fachada mediterránea en blanco (se tiñe con el color de cada casa): 4 vanos x 4 plantas (14,4 x 12,8 m); abajo puertas
// y arcos, arriba ventanas con contraventanas (algunas cerradas), balcones de hierro y alguna maceta
const FAC_W = 14.4, FAC_H = 12.8;
function facadeTex(shutter, seed) {
  const [c, g] = canvas(512, 512), r = rnd(seed), bw = 128, fh = 128;
  g.fillStyle = '#f6f3ec'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '120,100,80' : '255,255,255'},${0.03 + r() * 0.05})`; g.fillRect(r() * 512, r() * 512, 2 + r() * 3, 2 + r() * 3); }
  for (let f = 0; f < 4; f++) {
    const y0 = 512 - (f + 1) * fh;
    g.fillStyle = 'rgba(0,0,0,0.07)'; g.fillRect(0, y0 + fh - 5, 512, 5);                     // cornisa de la planta
    for (let b = 0; b < 4; b++) {
      const x0 = b * bw;
      if (f === 0) {
        if (r() < 0.6) { // puerta (a veces arco de tienda con toldo)
          const arch = r() < 0.4;
          g.fillStyle = '#3a2e26'; g.fillRect(x0 + 34, y0 + 30, 60, 98);
          if (arch) { g.beginPath(); g.arc(x0 + 64, y0 + 30, 30, Math.PI, 0); g.fill(); g.fillStyle = ['#c0392b', '#2e86c1', '#27ae60', '#f39c12'][Math.floor(r() * 4)]; g.fillRect(x0 + 26, y0 + 18, 76, 14); }
          else { g.fillStyle = shutter; g.fillRect(x0 + 38, y0 + 34, 52, 94); g.fillStyle = 'rgba(0,0,0,0.25)'; for (let k = 0; k < 9; k++) g.fillRect(x0 + 38, y0 + 38 + k * 10, 52, 2); }
        } else { g.fillStyle = '#2f3a44'; g.fillRect(x0 + 40, y0 + 40, 48, 50); g.fillStyle = '#d9d2c3'; g.fillRect(x0 + 36, y0 + 90, 56, 6); }
        continue;
      }
      const wx = x0 + 42, wy = y0 + 26, ww = 44, wh = 66;
      g.fillStyle = '#e9e3d6'; g.fillRect(wx - 6, wy - 6, ww + 12, wh + 12);                   // marco
      g.fillStyle = '#26303a'; g.fillRect(wx, wy, ww, wh);
      g.fillStyle = 'rgba(160,190,210,0.35)'; g.fillRect(wx + 3, wy + 3, ww / 2 - 4, wh - 6);
      const st = r();
      g.fillStyle = shutter;
      if (st < 0.3) g.fillRect(wx, wy, ww, wh);                                                    // cerrada
      else if (st < 0.8) { g.fillRect(wx - 26, wy, 22, wh); g.fillRect(wx + ww + 4, wy, 22, wh); } // abiertas
      g.fillStyle = 'rgba(0,0,0,0.22)';
      if (st < 0.8) for (let k = 0; k < 7; k++) { if (st < 0.3) g.fillRect(wx, wy + 4 + k * 9, ww, 2); else { g.fillRect(wx - 26, wy + 4 + k * 9, 22, 2); g.fillRect(wx + ww + 4, wy + 4 + k * 9, 22, 2); } }
      if (r() < 0.35) { g.fillStyle = '#22262a'; g.fillRect(wx - 10, wy + wh - 2, ww + 20, 4); for (let k = 0; k < 9; k++) g.fillRect(wx - 10 + k * 8, wy + wh - 18, 2, 18); g.fillRect(wx - 10, wy + wh - 18, ww + 20, 2); }
      if (r() < 0.25) { g.fillStyle = ['#c2185b', '#e53935', '#8e24aa'][Math.floor(r() * 3)]; for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(wx - 4 + r() * (ww + 8), wy + wh - 6 + r() * 6, 5 + r() * 4, 0, 7); g.fill(); } }
    }
  }
  return ctex(c);
}
// caliza en estratos (cortados y acantilados; se proyecta en triplanar: las bandas quedan horizontales en el mundo):
// capas de grosor y tono distintos, juntas oscuras, cornisas claras, grietas verticales y churretes de lluvia
let ROCK_TEX = null;
function rockTex() {
  if (ROCK_TEX) return ROCK_TEX;
  const S = 512, [c, g] = canvas(S, S), r = rnd(77);
  g.fillStyle = '#c4b598'; g.fillRect(0, 0, S, S);
  let y = 0;
  while (y < S) {
    const h = 5 + r() * 26, k = 0.82 + r() * 0.3, wv = r() * 6, ph = r() * 6.28;
    const col = `rgb(${196 * k | 0},${181 * k | 0},${152 * k | 0})`;
    g.fillStyle = col; g.beginPath(); g.moveTo(0, y + Math.sin(ph) * wv);
    for (let x = 0; x <= S; x += 16) g.lineTo(x, y + Math.sin(ph + x / S * 6.283 * 2) * wv);
    for (let x = S; x >= 0; x -= 16) g.lineTo(x, y + h + Math.sin(ph + x / S * 6.283 * 2) * wv);
    g.fill();
    g.strokeStyle = 'rgba(70,58,44,0.45)'; g.lineWidth = 1 + r() * 1.5; g.beginPath();
    for (let x = 0; x <= S; x += 16) g.lineTo(x, y + h + Math.sin(ph + x / S * 6.283 * 2) * wv);
    g.stroke();
    if (r() < 0.5) { g.strokeStyle = 'rgba(255,248,230,0.35)'; g.lineWidth = 2; g.beginPath(); for (let x = 0; x <= S; x += 16) g.lineTo(x, y + 2 + Math.sin(ph + x / S * 6.283 * 2) * wv); g.stroke(); }
    y += h;
  }
  for (let i = 0; i < 140; i++) {   // grietas
    let x = r() * S, yy = r() * S; g.strokeStyle = `rgba(60,48,36,${0.25 + r() * 0.35})`; g.lineWidth = 0.8 + r() * 1.6; g.beginPath(); g.moveTo(x, yy);
    for (let k = 0; k < 4 + r() * 6; k++) { x += (r() - 0.5) * 8; yy += 6 + r() * 14; g.lineTo(x, yy); } g.stroke();
  }
  for (let i = 0; i < 70; i++) {    // churretes
    const x = r() * S, yy = r() * S * 0.7, w = 4 + r() * 16, h = 40 + r() * 160, gr = g.createLinearGradient(0, yy, 0, yy + h);
    gr.addColorStop(0, `rgba(90,80,64,${0.18 + r() * 0.2})`); gr.addColorStop(1, 'rgba(90,80,64,0)'); g.fillStyle = gr; g.fillRect(x, yy, w, h);
  }
  for (let i = 0; i < 26000; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '50,42,32' : '255,250,235'},${r() * 0.12})`; g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2); }
  ROCK_TEX = ctex(c); return ROCK_TEX;
}
// azulejo claro hasta media altura y hormigón encima, con una franja oscura (paredes del túnel: v = 0 abajo, 1 en el techo)
function tunnelTex() {
  const [c, g] = canvas(256, 256), r = rnd(9);
  g.fillStyle = '#7c7d7b'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.08})`; g.fillRect(r() * 256, r() * 256, 2, 2); }
  const y0 = 256 - 256 * 3.2 / 7.5;                                    // azulejo hasta 3,2 m
  g.fillStyle = '#d9d3c4'; g.fillRect(0, y0, 256, 256 - y0);
  g.strokeStyle = 'rgba(90,85,75,0.35)'; g.lineWidth = 1.5;
  for (let y = y0; y < 256; y += 11) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  for (let x = 0; x < 256; x += 22) { g.beginPath(); g.moveTo(x, y0); g.lineTo(x, 256); g.stroke(); }
  g.fillStyle = '#2b4a6b'; g.fillRect(0, y0 - 9, 256, 9);               // franja azul
  const gr = g.createLinearGradient(0, 230, 0, 256); gr.addColorStop(0, 'rgba(30,25,20,0)'); gr.addColorStop(1, 'rgba(30,25,20,0.55)'); g.fillStyle = gr; g.fillRect(0, 230, 256, 26);
  return ctex(c);
}
// sillería de piedra caliza (bocas del túnel, trincheras, torre)
// teja árabe en hiladas (se tiñe con el color de cada tejado): canales y cobijas con sombra entre hiladas
function roofTileTex() {
  const [c, g] = canvas(256, 256), r = rnd(31);
  g.fillStyle = '#e6e0d8'; g.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 8; row++) for (let k = 0; k < 16; k++) {
    const x = k * 16 + (row % 2) * 8, y = row * 32, l = 0.82 + r() * 0.3;
    const gr = g.createLinearGradient(x, 0, x + 16, 0);
    gr.addColorStop(0, `rgba(${Math.round(150 * l)},${Math.round(140 * l)},${Math.round(130 * l)},1)`); gr.addColorStop(0.5, `rgba(${Math.round(255 * l)},${Math.round(248 * l)},${Math.round(240 * l)},1)`); gr.addColorStop(1, `rgba(${Math.round(140 * l)},${Math.round(130 * l)},${Math.round(120 * l)},1)`);
    g.fillStyle = gr; g.fillRect(x, y, 15, 30);
    g.fillStyle = 'rgba(40,25,15,0.35)'; g.fillRect(x, y + 27, 16, 5);
  }
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '60,40,20' : '255,255,255'},${0.05 + r() * 0.08})`; g.fillRect(r() * 256, r() * 256, 2 + r() * 4, 1 + r() * 2); }
  const t = ctex(c); t.repeat.set(1, 3); return t;
}
function stoneTex() {
  const [c, g] = canvas(256, 256), r = rnd(17);
  g.fillStyle = '#b8a888'; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 21) for (let x = (y / 21) % 2 ? 0 : -20; x < 256; x += 40 + Math.floor(r() * 12)) { const k = 0.82 + r() * 0.3; g.fillStyle = `rgb(${205 * k | 0},${190 * k | 0},${160 * k | 0})`; g.fillRect(x + 1.5, y + 1.5, 38 + r() * 8, 18); }
  for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '60,50,40' : '255,250,240'},${r() * 0.08})`; g.fillRect(r() * 256, r() * 256, 2, 2); }
  return ctex(c);
}
// losas de piedra clara (muelle, paseos y plazas)
function pavingTex() {
  const [c, g] = canvas(256, 256), r = rnd(31);
  g.fillStyle = '#cfc6b4'; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 32) for (let x = (y / 32) % 2 ? 0 : -32; x < 256; x += 64) {
    const k = 0.9 + r() * 0.18; g.fillStyle = `rgb(${207 * k | 0},${198 * k | 0},${180 * k | 0})`; g.fillRect(x + 1, y + 1, 62, 30);
  }
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.06})`; g.fillRect(r() * 256, r() * 256, 2, 2); }
  return ctex(c);
}
// sillería del muro del muelle (con la franja de algas y humedad abajo)
function quayWallTex() {
  const [c, g] = canvas(256, 128), r = rnd(5);
  g.fillStyle = '#b9ae98'; g.fillRect(0, 0, 256, 128);
  for (let y = 0; y < 128; y += 16) for (let x = (y / 16) % 2 ? 0 : -24; x < 256; x += 48) { const k = 0.85 + r() * 0.25; g.fillStyle = `rgb(${185 * k | 0},${174 * k | 0},${152 * k | 0})`; g.fillRect(x + 1, y + 1, 46, 14); }
  const gr = g.createLinearGradient(0, 128, 0, 70); gr.addColorStop(0, 'rgba(40,60,40,0.85)'); gr.addColorStop(0.5, 'rgba(70,80,55,0.45)'); gr.addColorStop(1, 'rgba(70,80,55,0)');
  g.fillStyle = gr; g.fillRect(0, 70, 256, 58);
  return ctex(c);
}

// ------------------------------------------------------------------ casas: paredes juntas en una geometría (UV en metros)
class Walls {
  constructor() { this.pos = []; this.uv = []; this.col = []; this.n = 0; }
  // caja sin techo: base y0, alto h; u por metros desde un vano al azar, v desde la base
  add(x, y0, z, w, d, h, yaw, color, u0 = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (a, b, hh) => [x + a * c + b * s, y0 + hh, z - a * s + b * c];
    const cs = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
    let u = u0;
    for (let k = 0; k < 4; k++) {
      const [a0, b0] = cs[k], [a1, b1] = cs[(k + 1) % 4], len = Math.hypot(a1 - a0, b1 - b0);
      const A = P(a0, b0, 0), B = P(a1, b1, 0), Cc = P(a1, b1, h), D = P(a0, b0, h), ua = u / FAC_W, ub = (u + len) / FAC_W, vh = h / FAC_H;
      // (abajo algo más oscuro: la casa asienta en el suelo en vez de parecer pegada encima)
      for (const [p, t] of [[A, [ua, 0]], [Cc, [ub, vh]], [B, [ub, 0]], [A, [ua, 0]], [D, [ua, vh]], [Cc, [ub, vh]]]) { const k = t[1] ? 1 : 0.74; this.pos.push(...p); this.uv.push(...t); this.col.push(color.r * k, color.g * k, color.b * k); this.n++; }
      u += len + 3.6 * Math.floor(hash(x + k) * 4);
    }
  }
  mesh(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, material); m.castShadow = true; m.receiveShadow = true; return m;
  }
}

// ------------------------------------------------------------------ barcos (proa hacia +z, en metros; el casco toma el color de la instancia)
function hullGeo(L, B, F, D) {
  const N = 12, secs = [];
  for (let k = 0; k <= N; k++) {
    const t = k / N, hw = B / 2 * (t < 0.55 ? 0.8 + 0.2 * Math.sin(t / 0.55 * Math.PI / 2) : Math.pow(Math.cos((t - 0.55) / 0.45 * Math.PI / 2), 0.75));
    secs.push({ z: -L / 2 + t * L, hw: Math.max(0.001, hw), y: F + 0.25 * F * t * t });
  }
  const pos = [];
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  for (let k = 0; k < N; k++) {
    const A = secs[k], Bs = secs[k + 1];
    for (const sd of [1, -1]) {
      const a0 = [sd * A.hw, A.y, A.z], a1 = [sd * A.hw * 0.55, -D, A.z], b0 = [sd * Bs.hw, Bs.y, Bs.z], b1 = [sd * Bs.hw * 0.55, -D, Bs.z];
      tri(a0, a1, b1); tri(a0, b1, b0);
    }
    tri([-A.hw, A.y, A.z], [A.hw, A.y, A.z], [Bs.hw, Bs.y, Bs.z]); tri([-A.hw, A.y, A.z], [Bs.hw, Bs.y, Bs.z], [-Bs.hw, Bs.y, Bs.z]);   // cubierta
  }
  const S = secs[0]; tri([-S.hw, S.y, S.z], [S.hw * 0.55, -D, S.z], [S.hw, S.y, S.z]); tri([-S.hw, S.y, S.z], [-S.hw * 0.55, -D, S.z], [S.hw * 0.55, -D, S.z]);   // espejo de popa
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
}
const boxAt = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };
const cylAt = (r0, r1, h, x, y, z, seg = 6) => { const g = new THREE.CylinderGeometry(r0, r1, h, seg); g.translate(x, y, z); return g; };
function boatGeos() {
  const W = lin(0xf3f3ef), GL = lin(0x1f2a33), MET = lin(0xcfd3d6), NAVY = lin(0x1d2f4f), TEAK = lin(0x9a7650);
  const boom = new THREE.CylinderGeometry(0.06, 0.06, 4.6, 5); boom.rotateX(Math.PI / 2); boom.translate(0, 2.55, -0.7);
  const sail = merged([
    { g: hullGeo(11, 3.6, 1.15, 0.6) },
    { g: boxAt(2.3, 0.55, 3.8, 0, 1.45, 0.4), c: W, tint: 0 }, { g: boxAt(2.34, 0.16, 2.8, 0, 1.5, 0.6), c: GL, tint: 0 },
    { g: cylAt(0.07, 0.09, 15, 0, 8.6, 1.8), c: MET, tint: 0 }, { g: boom, c: MET, tint: 0 },
    { g: boxAt(0.42, 0.42, 4.2, 0, 2.85, -0.7), c: NAVY, tint: 0 }, { g: boxAt(2.0, 0.12, 2.6, 0, 1.3, -3.6), c: TEAK, tint: 0 },
  ]);
  const motor = merged([
    { g: hullGeo(18, 5, 2.0, 0.9) },
    { g: boxAt(4.1, 2.0, 9.5, 0, 3.0, -1.2), c: W, tint: 0 }, { g: boxAt(4.16, 0.75, 8.6, 0, 3.15, -0.9), c: GL, tint: 0 },
    { g: boxAt(3.5, 1.3, 5.4, 0, 4.65, -1.9), c: W, tint: 0 }, { g: boxAt(3.56, 0.5, 4.4, 0, 4.75, -1.4), c: GL, tint: 0 },
    { g: boxAt(3.2, 0.25, 0.5, 0, 5.9, -1.6), c: W, tint: 0 }, { g: boxAt(4.4, 0.1, 3.0, 0, 2.06, -7.4), c: TEAK, tint: 0 },
  ]);
  const fish = merged([
    { g: hullGeo(7.5, 2.6, 1.0, 0.5) },
    { g: boxAt(1.4, 1.5, 1.6, 0, 1.8, -1.0), c: W, tint: 0 }, { g: boxAt(1.45, 0.45, 1.2, 0, 2.15, -0.9), c: GL, tint: 0 },
    { g: cylAt(0.05, 0.06, 4.5, 0, 3.2, 1.2), c: TEAK, tint: 0 }, { g: boxAt(2.2, 0.12, 2.4, 0, 1.12, 1.6), c: TEAK, tint: 0 },
  ]);
  // velas desplegadas (para los que navegan): mayor y foque
  const sp = [0, 1.6, 1.8, 0, 15.5, 1.8, 0, 1.9, -3.0, 0, 1.6, 2.2, 0, 14.2, 2.2, 0, 1.4, 5.3];
  const sails = new THREE.BufferGeometry(); sails.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sails.computeVertexNormals();
  return { sail, motor, fish, sails };
}
const HULLC = [0xf5f5f2, 0xf5f5f2, 0xf5f5f2, 0xeef2f5, 0x1d2f4f, 0xf5f5f2, 0x2b2b2b, 0xe8e2d0];
const FISHC = [0x2e6fb0, 0x2f8f5b, 0xc0392b, 0xf2f2ee, 0xf1c40f, 0x16a085, 0x1f4e79];

// ------------------------------------------------------------------ gente (una pieza: piernas, cuerpo con el color de la ropa, cara)
function crowd(scene, people, seated) {
  const body = new THREE.CapsuleGeometry(0.21, 0.82, 2, 6); body.translate(0, 0.63, 0);
  const legs = new THREE.CylinderGeometry(0.17, 0.14, 0.75, 5); legs.translate(0, 0.37, 0);
  const head = new THREE.IcosahedronGeometry(0.12, 0); head.translate(0, 1.27, 0);
  const SK = lin(0xd9a066), LEG = lin(0x3a3f4a);
  const cloth = tintMat({ roughness: 0.9 });
  chunked(scene, merged([{ g: legs, c: LEG, tint: 0 }, { g: body }, { g: head, c: SK, tint: 0 }]), cloth, people);
  if (seated?.length) {
    const sitB = new THREE.CapsuleGeometry(0.21, 0.42, 2, 6); sitB.translate(0, 0.43, 0);
    const sitH = new THREE.IcosahedronGeometry(0.12, 0); sitH.translate(0, 0.86, 0);
    chunked(scene, merged([{ g: sitB }, { g: sitH, c: SK, tint: 0 }]), cloth, seated);
  }
}
const SKINS = [0xf1c27d, 0xe0ac69, 0x8d5524, 0xc68642, 0xffdbac, 0xd9a066];
const SUMMER = [0xffffff, 0xf5f5f5, 0x90caf9, 0xff8a65, 0xfdd835, 0x4fc3f7, 0xe57373, 0x81c784, 0x1e88e5, 0xd32f2f, 0x212121, 0xffb74d, 0xba68c8, 0x26a69a, 0xf06292, 0x8d6e63];
const PARASOL = [0xe53935, 0x1e88e5, 0xfdd835, 0xffffff, 0x43a047, 0xff6f00, 0x00acc1, 0xf06292];

// ------------------------------------------------------------------ decorado
export function buildCoast(ctx) {
  const { T, world, scene, r, quality } = ctx, hi = quality !== 'low';
  // altura exacta de la malla del terreno tal como se dibuja (world.meshY): con la función analítica, en las laderas
  // empinadas las rocas, la gente y las carreteras quedaban flotando o enterradas
  // fuera de la malla, la de tierra firme (más gruesa, apartado 15): misma interpolación por triángulos
  const FAR = (() => { const x0 = -9500, x1 = world.terrainGrid.x0 + 30, z0 = -3500, z1 = 4500, nx = Math.ceil((x1 - x0) / 60), nz = Math.ceil((z1 - z0) / 60); return { x0, x1, z0, z1, nx, nz, cx: (x1 - x0) / nx, cz: (z1 - z0) / nz }; })();
  const farH = (x, z) => (x > world.terrainGrid.x0 - 10 ? world.hills(x, z) : world.hills(x, z) + Math.max(0, -x - 3500) * 0.09 * (0.6 + 0.4 * Math.sin(z * 0.0021 + 1) * Math.sin(x * 0.0017)));
  const farY = (x, z) => {
    const u = (x - FAR.x0) / FAR.cx, w = (z - FAR.z0) / FAR.cz, ix = Math.floor(u), iy = Math.floor(w), fu = u - ix, fv = w - iy;
    const V = (i, j) => farH(FAR.x0 + i * FAR.cx, FAR.z0 + j * FAR.cz);
    return fu + fv <= 1 ? V(ix, iy) + (V(ix + 1, iy) - V(ix, iy)) * fu + (V(ix, iy + 1) - V(ix, iy)) * fv
      : V(ix + 1, iy + 1) + (V(ix, iy + 1) - V(ix + 1, iy + 1)) * (1 - fu) + (V(ix + 1, iy) - V(ix + 1, iy + 1)) * (1 - fv);
  };
  const G = (x, z) => (x < world.terrainGrid.x0 + 1 && x > FAR.x0 ? farY(x, z) : world.meshY(x, z));
  world.coastG = G;
  const parts = [buildSea(ctx)];
  // ---- suelo: en lo empinado, caliza en estratos proyectada en triplanar (sin estirarse en los cortados); el resto, igual
  {
    const m = world.mat.terrain, rt = rockTex();
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uRock = { value: rt };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uRock; varying vec3 vWP; varying vec3 vWN;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            vec3 n = normalize(vWN); float rk = smoothstep(0.26, 0.5, 1.0 - n.y);
            if (rk > 0.001) {
              vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
              vec3 p = vWP / vec3(15.0, 11.0, 15.0);
              vec3 rc = texture2D(uRock, p.zy).rgb * w.x + texture2D(uRock, p.xz).rgb * w.y + texture2D(uRock, p.xy).rgb * w.z;
              rc *= 0.92 + 0.16 * texture2D(uRock, p.xz * 0.13 + 0.37).r;          // manchas grandes
              diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * rc * 1.12, rk);
            }
          }`);
    };
    m.customProgramCacheKey = () => 'coastRock';
    m.needsUpdate = true;
  }
  const P = [0, 0, 0];
  const at = (s, d) => { T.pos(s, d, P); return [P[0], P[1], P[2]]; };
  const yawAt = (s) => Math.atan2(T.tx[T.idx(s)], T.tz[T.idx(s)]);
  const sd = world.coastSD;
  const occFree = (x, z, rad) => ctx.occ.every((o) => Math.hypot(o.x - x, o.z - z) > o.r + rad);
  // ¿cabe algo de radio rad en tierra, lejos de la pista, muros y gradas?
  const onLand = (x, z, rad, margin = 4) => sd(x, z) > rad + margin;
  const fits = (x, z, rad, trackM = 6) => {
    if (!occFree(x, z, rad)) return false;
    const q = world.nearest(x, z, 6);
    if (q.i >= 0) {
      const s = q.i * T.ds, side = (x - T.x[q.i]) * T.lx[q.i] + (z - T.z[q.i]) * T.lz[q.i] >= 0 ? 1 : -1;
      if (q.d < world.barrier(s, side) + rad + trackM) return false;
      if (between(T, s, T.wrap(T.pit.entryA - 60), T.wrap(T.pit.exitB + 60)) && side < 0 && q.d < 170) return false;
      for (const st of world.stands || []) if (st.side === side && between(T, s, T.wrap(st.s0 - 12), T.wrap(st.s0 + st.len + 12)) && q.d < world.barrier(s, side) + st.depth + 12 + rad) return false;
    }
    return true;
  };
  // ---- dentro de los muros no hay terreno: lo tapan pista, arcén y escapatorias. Con celdas de 10 m, la ladera que sube
  // detrás de un muro se colaba en la escapatoria (en la bajada en zigzag, en la trinchera del túnel...). Detrás de cada muro,
  // una franja de terreno a medida (12 m) y, donde la ladera sube, muro de contención de piedra
  {
    const geo = world.terrainGeo, p = geo.attributes.position, ix = geo.index.array, keep = [];
    // fuera los triángulos con algún vértice o el centro dentro de los muros (los que solo asomaban también se colaban)
    const vIn = new Uint8Array(p.count); for (let i = 0; i < p.count; i++) vIn[i] = world.coastCorridor(p.getX(i), p.getZ(i), 0.6) ? 1 : 0;
    for (let k = 0; k < ix.length; k += 3) {
      const a = ix[k], b = ix[k + 1], c = ix[k + 2];
      if (vIn[a] || vIn[b] || vIn[c]) continue;
      if (!world.coastCorridor((p.getX(a) + p.getX(b) + p.getX(c)) / 3, (p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3, 0.3)) keep.push(a, b, c);
    }
    geo.setIndex(keep);
    const gcol = geo.attributes.color, gr = world.terrainGrid, cs = (gr.x1 - gr.x0) / gr.nx;
    const colAt = (x, z, out) => { const i = Math.max(0, Math.min(gr.nx, Math.round((x - gr.x0) / cs))), j = Math.max(0, Math.min(gr.nz, Math.round((z - gr.z0) / cs))), k = j * (gr.nx + 1) + i; out.push(gcol.getX(k), gcol.getY(k), gcol.getZ(k)); };
    const [tq0, tq1] = T.meta.tunnel, [qa, qb] = T.meta.quay;
    const stoneW = new THREE.MeshStandardMaterial({ map: stoneTex(), roughness: 0.95, side: THREE.DoubleSide });
    const footM = world.mat.verge;
    const OFF = [0.45, 3, 6, 10, 15];
    for (const side of [1, -1]) {
      const pos = [], uv = [], colr = [], idx = []; let rows = 0;
      let wallRun = null;
      const flushWall = (end) => { if (wallRun && end - wallRun.s0 > 4) { const hs = wallRun.h; world.along(wallRun.s0, end - wallRun.s0, (s2) => side * (world.barrier(s2, side) + 0.45), (s2) => side * (world.barrier(s2, side) + 0.45), (s2, e) => (e ? hs.get(Math.round(s2 / 2) * 2) ?? 1.2 : -0.6), stoneW, 1, 6).castShadow = true; } wallRun = null; };
      for (let s2 = 0; s2 <= T.L; s2 += 2) {
        const sw = T.wrap(s2), inT = between(T, sw, T.wrap(tq0 - 1), T.wrap(tq1 + 1)), quay = side > 0 && between(T, sw, T.wrap(qa - 12), T.wrap(qb + 4));
        const B = world.barrier(sw, side), rb = at(sw, side * B)[1];
        // la franja y su muro
        const pts = OFF.map((o) => at(sw, side * (B + o)));
        let hT = pts.map(([x, , z]) => G(x, z));
        let hi = Math.max(rb - 0.5, Math.min(rb + 16, hT[1]));
        hT[0] = hi;
        for (let k = 1; k < OFF.length; k++) { const [x, , z] = pts[k]; if (world.coastCorridor(x, z, 0.3, sw)) { for (let m = k; m < OFF.length; m++) { pts[m] = pts[k - 1]; hT[m] = hT[k - 1]; } break; } }
        const skip = inT || quay;
        for (let k = 0; k < OFF.length; k++) { const [x, , z] = pts[k]; pos.push(x, skip ? -200 : hT[k] + 0.02, z); uv.push(x / 40, z / 40); colAt(x, z, colr); }
        if (rows) for (let k = 0; k < OFF.length - 1; k++) { const a = (rows - 1) * OFF.length + k, b = rows * OFF.length + k; if (side > 0) idx.push(a, b, a + 1, a + 1, b, b + 1); else idx.push(a, a + 1, b, a + 1, b + 1, b); }
        rows++;
        if (!skip && hi > rb + 1.5) { if (!wallRun) wallRun = { s0: sw, h: new Map() }; wallRun.h.set(Math.round(sw / 2) * 2, hi - rb + 0.3); } else flushWall(sw);
      }
      flushWall(T.L);
      // (los tramos saltados se mandan muy abajo y luego se quitan sus triángulos)
      const clean = []; for (let k = 0; k < idx.length; k += 3) if (pos[idx[k] * 3 + 1] > -100 && pos[idx[k + 1] * 3 + 1] > -100 && pos[idx[k + 2] * 3 + 1] > -100) clean.push(idx[k], idx[k + 1], idx[k + 2]);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
      g.setIndex(clean); g.computeVertexNormals();
      const m = new THREE.Mesh(g, world.mat.terrain); m.receiveShadow = true; m.userData.noOcclude = true; scene.add(m);
      // pie del muro: del final de la escapatoria hasta detrás del muro, a ras de pista
      world.along(0, T.L, (s2) => side * (world.barrier(s2, side) - 0.6), (s2) => side * (world.barrier(s2, side) + 0.5), -0.03, footM, 6, 6);
    }
  }
  const people = [], seated = [];
  const person = (x, z, yaw, y = G(x, z)) => people.push({ x, y, z, yaw, s: 0.88 + r() * 0.22, c: SUMMER[Math.floor(r() * SUMMER.length)] });
  const BG = boatGeos();
  const rocks = [], palmList = [], treeList = [];
  const boats = { sail: [], motor: [], fish: [] };
  const boatMat = tintMat({ roughness: 0.35, metalness: 0.05, side: THREE.DoubleSide });

  // ============================================================== 1) carreteras con coches (antes que nada: lo demás las respeta)
  // una red que une el paddock con el pueblo (por encima del túnel), la playa, el faro y los montes de tierra firme, y la
  // costa norte con el aparcamiento de la recta y el hotel del cabo; en el pueblo, calles en anillo y radiales. Cada
  // carretera se corta en los tramos que tocarían la pista, el mar o las gradas (antes se descartaba entera: de cinco
  // salían dos)
  const cars = [], roadLamps = [], roadTrees = [], roadPaths = [];
  const HC = [800, 545];
  {
    const ROADS = [
      // p: puntos de paso (x, z); w: ancho; line: rayas pintadas; trees: árboles a los lados
      { p: [[300, 112], [430, 125], [560, 150], [640, 190], [700, 260], [735, 340], [760, 420], [782, 505]], w: 7.2, line: true, trees: 'plane' },   // paddock -> plaza de la iglesia
      { p: [[815, 575], [812, 640], [845, 700], [900, 760], [955, 805], [955, 860], [900, 905], [830, 940], [760, 968], [705, 964], [650, 978], [600, 981], [550, 977], [470, 968], [400, 960], [300, 956], [160, 955], [30, 958], [-100, 966]], w: 7.2, line: true, trees: 'pine' },   // plaza -> sobre el túnel -> costa sur -> paseo de la playa
      { p: [[-100, 966], [-200, 992], [-290, 985], [-400, 925], [-500, 860], [-560, 842], [-640, 846], [-700, 851], [-750, 849], [-800, 840], [-850, 822], [-880, 812]], w: 7.2, line: true, trees: 'pine' },   // playa -> por detrás de la grada de la horquilla -> faro
      { p: [[-880, 812], [-882, 710], [-848, 620], [-852, 540], [-880, 470], [-930, 430], [-1070, 330], [-1300, 280], [-1700, 250]], w: 7.2, line: true, trees: 'cypress' },   // faro -> tierra firme, por el istmo
      { p: [[-1700, 250], [-2050, 320], [-2400, 290], [-2750, 380], [-3100, 350], [-3450, 470], [-3700, 430], [-3900, 560], [-3720, 650], [-3980, 760], [-4250, 720]], w: 6.4, line: true, trees: 'cypress' },   // tierra firme -> puerto de montaña -> mirador
      { p: [[-1450, 180], [-1250, 150], [-1150, 230]], w: 6.2, line: false },                                                                     // a los molinos
      { p: [[-1700, 250], [-1450, 180], [-1300, 0], [-1100, -60], [-900, -95], [-650, -108], [-420, -104], [-200, -100], [150, -104], [400, -108], [700, -110], [900, -108], [1040, -100], [1130, -60], [1175, 20], [1180, 110]], w: 7.2, line: true, trees: 'pine' },   // montes -> playa del noroeste -> costa norte (detrás de la tribuna) -> hotel del cabo
      { p: [[770, 480], [700, 520], [640, 600], [620, 700], [600, 760]], w: 5.4, line: false },                                                  // bajada por el oeste del pueblo
    ];
    // calles del pueblo (las casas se reparten luego por los huecos): dos rondas que serpentean alrededor de la iglesia y
    // seis cuestas desde la plaza que se tuercen al bajar, como en un pueblo de verdad (con anillos y radios rectos parecía
    // una tela de araña)
    for (const [R0, ph] of [[96, 0.4], [168, 1.9], [242, 3.1]]) {
      const p = []; for (let a = 0; a <= 6.2832 + 1e-6; a += 8 / R0) { const R = R0 + 11 * Math.sin(3 * a + ph) + 6 * Math.sin(7 * a + ph * 2); p.push([HC[0] + Math.cos(a) * R, HC[1] + Math.sin(a) * R]); }
      ROADS.push({ p, w: 4.6, town: true });
    }
    for (const a0 of [-2.55, -1.45, -0.35, 0.75, 1.75, 2.75]) {
      const p = []; for (let d = 40; d <= 315; d += 25) { const a = a0 + 0.22 * Math.sin(d * 0.018 + a0 * 3) + 0.1 * Math.sin(d * 0.047); p.push([HC[0] + Math.cos(a) * d, HC[1] + Math.sin(a) * d]); }
      ROADS.push({ p, w: 4.6, town: true });
    }
    // ¿cabe un trozo de carretera (semiancho hw) en (x, z)? Sobre el túnel sí: va por encima de la colina
    const [tq0, tq1] = T.meta.tunnel;
    const roadOK = (x, z, hw, town) => {
      if (!onLand(x, z, hw, 2) || Math.hypot(x - HC[0], z - HC[1]) < 37) return false;
      if (Math.hypot(G(x + 4, z) - G(x - 4, z), G(x, z + 4) - G(x, z - 4)) / 8 > (town ? 0.55 : 0.5)) return false;   // (nada de asfalto por un cortado)
      const q2 = world.nearest(x, z, 6); if (q2.i < 0) return true;
      const s2 = q2.i * T.ds, sd2 = (x - T.x[q2.i]) * T.lx[q2.i] + (z - T.z[q2.i]) * T.lz[q2.i] >= 0 ? 1 : -1;
      if (T.inTunnel(s2)) return Math.min(T.ahead(tq0, s2), T.ahead(s2, tq1)) > 30 || q2.d > T.hw[q2.i] + 40;
      if (between(T, s2, T.wrap(T.pit.entryA - 60), T.wrap(T.pit.exitB + 60)) && sd2 < 0 && q2.d < 52) return false;
      for (const st of world.stands || []) if (st.side === sd2 && between(T, s2, T.wrap(st.s0 - 15), T.wrap(st.s0 + st.len + 15)) && q2.d < world.barrier(s2, sd2) + st.depth + 10 + hw) return false;
      return q2.d > world.barrier(s2, sd2) + hw + (town ? 5 : 8);
    };
    // (una pizca de desplazamiento distinto por carretera: donde se cruzan, el asfalto de una no parpadea con el de la otra)
    const roadMs = [0, 1, 2, 3].map((k) => new THREE.MeshStandardMaterial({ map: world.mat.asphalt.map, color: 0x9a9da2, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2 - k, polygonOffsetUnits: -4 - 2 * k }));
    const townM = new THREE.MeshStandardMaterial({ map: pavingTex(), color: 0xc9c0ae, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const lineM = new THREE.MeshStandardMaterial({ color: 0xf2f2ea, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -12 });
    const paths = [];
    const lpos = [];
    // altura del firme: lo más alto del suelo en 1,2 m alrededor (los coches van por la misma)
    const roadH = (x, z) => { let m = G(x, z); for (let a = 0; a < 6; a++) m = Math.max(m, G(x + Math.cos(a * 1.047) * 1.2, z + Math.sin(a * 1.047) * 1.2)); return m; };
    ROADS.forEach((R, ri) => {
      // Catmull-Rom cada 4 m; luego se parte en los tramos que caben
      const pts = [], P0 = R.p, hw = R.w / 2;
      for (let k = 0; k < P0.length - 1; k++) {
        const p0 = P0[Math.max(0, k - 1)], p1 = P0[k], p2 = P0[k + 1], p3 = P0[Math.min(P0.length - 1, k + 2)];
        const n = Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 4);
        for (let j = 0; j < n; j++) { const t = j / n, t2 = t * t, t3 = t2 * t; pts.push([0, 1].map((c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3))); }
      }
      pts.push(P0[P0.length - 1]);
      const runs = []; let cur = [];
      for (const p of pts) { if (roadOK(p[0], p[1], hw, R.town)) cur.push(p); else { if (cur.length) runs.push(cur); cur = []; } }
      if (cur.length) runs.push(cur);
      for (const run of runs) {
        let L = 0; for (let k = 1; k < run.length; k++) L += Math.hypot(run[k][0] - run[k - 1][0], run[k][1] - run[k - 1][1]);
        if (L < (R.town ? 24 : 40)) continue;
        const pos = [], uv = [], idx = [], cum = [0]; let acc = 0;
        const lift = 0.16 + 0.01 * (ri % 4);
        // sección: arcén que se mete en el suelo, cinco vértices sobre el firme y otro arcén. Cada vértice a la altura más alta
        // del suelo a su alrededor (con solo los dos bordes, donde la ladera hace lomo el terreno asomaba por el centro de la
        // calzada, y entre vértices los pliegues de la malla de 10 m también)
        const cols = [-hw - 0.9, -hw, -hw / 2, 0, hw / 2, hw, hw + 0.9], NC = cols.length;
        for (let k = 0; k < run.length; k++) {
          const a = run[Math.max(0, k - 1)], b = run[Math.min(run.length - 1, k + 1)], [x, z] = run[k];
          const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1, nx = tz / l, nz = -tx / l;
          if (k) { acc += Math.hypot(x - run[k - 1][0], z - run[k - 1][1]); cum.push(acc); }
          for (const o of cols) {
            const px = x + nx * o, pz = z + nz * o, edge = Math.abs(o) > hw + 0.1;
            pos.push(px, edge ? G(px, pz) - 0.25 : roadH(px, pz) + lift, pz); uv.push((o + hw) / 6, acc / 6);
          }
          if (k) for (let c = 0; c < NC - 1; c++) { const a0 = (k - 1) * NC + c, b0 = k * NC + c; idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1); }
          // rayas: discontinua en el centro y continuas en los bordes, cada esquina a la altura del firme
          if (R.line && k) {
            const [px, pz] = run[k - 1], la = run[Math.max(0, k - 2)], ll = Math.hypot(x - la[0], z - la[1]) || 1, pnx = (z - la[1]) / ll, pnz = -(x - la[0]) / ll;
            const Y = (xx, zz) => roadH(xx, zz) + lift + 0.03;
            const quad = (o, w) => {
              const A = [px + pnx * (o - w), pz + pnz * (o - w)], B = [x + nx * (o - w), z + nz * (o - w)], C = [x + nx * (o + w), z + nz * (o + w)], D = [px + pnx * (o + w), pz + pnz * (o + w)];
              for (const [qx, qz] of [A, B, C, A, C, D]) lpos.push(qx, Y(qx, qz), qz);
            };
            if (Math.floor(acc / 6) % 2 === 0) quad(0, 0.08);
            quad(hw - 0.35, 0.07); quad(-hw + 0.35, 0.07);
          }
        }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
        if (g.attributes.normal.getY(3) < 0) { for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]]; g.setIndex(idx); g.computeVertexNormals(); }
        const me = new THREE.Mesh(g, R.town ? townM : roadMs[ri % 4]); me.receiveShadow = true; me.userData.noOcclude = true; me.userData.road = R.town ? 'town' : 'road'; scene.add(me);
        paths.push({ pts: run, cum, L: acc, town: !!R.town, hw, far: run.some(([x]) => x < world.terrainGrid.x0) });
        for (let k = 0; k < run.length; k += 2) ctx.claim(run[k][0], run[k][1], hw + 1.9);
        // farolas en las calles del pueblo; árboles en fila a los lados de las carreteras
        for (let d = 10, sd2 = 1; d < acc - 5; d += R.town ? 26 : 16, sd2 = -sd2) {
          let k = 1; while (k < cum.length - 1 && cum[k] < d) k++;
          const [ax, az] = run[k - 1], [bx, bz] = run[k], l = Math.hypot(bx - ax, bz - az) || 1, nx = (bz - az) / l, nz = -(bx - ax) / l;
          if (R.town) roadLamps.push({ x: ax + nx * sd2 * (hw + 0.5), z: az + nz * sd2 * (hw + 0.5), yaw: Math.atan2(bx - ax, bz - az) });
          else if (R.trees) for (const s3 of [1, -1]) if (r() < 0.8) roadTrees.push({ x: ax + nx * s3 * (hw + 5.5), z: az + nz * s3 * (hw + 5.5), kind: R.trees, road: true });
        }
      }
    });
    if (lpos.length) { const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lpos, 3)); lg.computeVertexNormals(); const lm = new THREE.Mesh(lg, lineM); lm.userData.noOcclude = true; scene.add(lm); }
    // farolas de las calles (se dibujan con las del muelle)
    // coches: utilitarios, berlinas y furgonetas; en las calles del pueblo, utilitarios y motos. Todos los de una carretera
    // van a la misma velocidad (no se alcanzan) y al llegar al final se paran un momento fuera de la vista y vuelven
    const CC = [0xd32f2f, 0x1976d2, 0xfafafa, 0x212121, 0x9e9e9e, 0x388e3c, 0xfbc02d, 0x90a4ae, 0xe0e0e0, 0x0d47a1, 0xb71c1c, 0xf5f0e1, 0x7cb342, 0xffa000];
    const GLASS = lin(0x26313b), TYRE = lin(0x141414), TRIM = lin(0x2b2b2b), LAMP = lin(0xfff6dc), TAIL = lin(0xc62828);
    // carrocería con capó, techo y maletero: caja cuya tapa se estrecha (parabrisas inclinados)
    const shell = (w, h, l, x, y, z, top = 0.78, front = 0.18, back = 0.1) => {
      const g = new THREE.BoxGeometry(w, h, l); const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * top); p.setZ(i, p.getZ(i) > 0 ? p.getZ(i) - l * front : p.getZ(i) + l * back); }
      g.translate(x, y, z); return g;
    };
    const wheels = (fz, bz, wx, rr = 0.32) => [[-wx, fz], [wx, fz], [-wx, bz], [wx, bz]].map(([a, b]) => ({ g: new THREE.CylinderGeometry(rr, rr, 0.24, 10).rotateZ(Math.PI / 2).translate(a, rr, b), c: TYRE, tint: 0 }));
    const lights = (w, y, zf, zb) => [{ g: boxAt(0.36, 0.14, 0.05, -w, y, zf), c: LAMP, tint: 0 }, { g: boxAt(0.36, 0.14, 0.05, w, y, zf), c: LAMP, tint: 0 }, { g: boxAt(0.3, 0.14, 0.05, -w, y, zb), c: TAIL, tint: 0 }, { g: boxAt(0.3, 0.14, 0.05, w, y, zb), c: TAIL, tint: 0 }];
    const CAR = {
      hatch: merged([{ g: boxAt(1.7, 0.62, 3.8, 0, 0.6, 0) }, { g: shell(1.6, 0.6, 2.2, 0, 1.2, -0.35), c: GLASS, tint: 0 }, { g: boxAt(1.36, 0.06, 1.5, 0, 1.52, -0.45) },
        { g: boxAt(1.72, 0.18, 0.2, 0, 0.38, 1.92), c: TRIM, tint: 0 }, { g: boxAt(1.72, 0.18, 0.2, 0, 0.38, -1.92), c: TRIM, tint: 0 }, ...wheels(1.25, -1.2, 0.78), ...lights(0.6, 0.72, 1.91, -1.91)]),
      sedan: merged([{ g: boxAt(1.8, 0.6, 4.6, 0, 0.6, 0) }, { g: shell(1.66, 0.58, 2.4, 0, 1.19, -0.15, 0.8, 0.2, 0.18), c: GLASS, tint: 0 }, { g: boxAt(1.36, 0.06, 1.3, 0, 1.5, -0.2) },
        { g: boxAt(1.82, 0.18, 0.2, 0, 0.38, 2.32), c: TRIM, tint: 0 }, { g: boxAt(1.82, 0.18, 0.2, 0, 0.38, -2.32), c: TRIM, tint: 0 }, ...wheels(1.5, -1.45, 0.82), ...lights(0.62, 0.72, 2.31, -2.31)]),
      van: merged([{ g: boxAt(1.95, 1.9, 4.9, 0, 1.3, -0.2) }, { g: shell(1.9, 0.9, 1.0, 0, 0.75, 2.2, 0.95, 0.3, 0) }, { g: boxAt(1.97, 0.7, 0.9, 0, 1.75, 1.75), c: GLASS, tint: 0 }, { g: boxAt(1.98, 0.5, 1.2, 0, 1.75, 0.6), c: GLASS, tint: 0 },
        ...wheels(1.75, -1.6, 0.86, 0.35), ...lights(0.66, 0.9, 2.71, -2.66)]),
      moto: merged([{ g: boxAt(0.3, 0.42, 1.5, 0, 0.62, 0) }, { g: boxAt(0.42, 0.55, 0.42, 0, 1.05, -0.25), c: lin(0x3a3f4a), tint: 0 }, { g: new THREE.IcosahedronGeometry(0.17, 0).translate(0, 1.45, -0.2), c: lin(0xf2f2f2), tint: 0 },
        { g: new THREE.CylinderGeometry(0.28, 0.28, 0.1, 10).rotateZ(Math.PI / 2).translate(0, 0.28, 0.6), c: TYRE, tint: 0 }, { g: new THREE.CylinderGeometry(0.28, 0.28, 0.1, 10).rotateZ(Math.PI / 2).translate(0, 0.28, -0.6), c: TYRE, tint: 0 }]),
    };
    for (const pth of paths) {
      const n = Math.max(pth.town ? 1 : 2, Math.round(pth.L / (pth.town ? 120 : 130))), sp = pth.town ? 6 + r() * 2 : 11 + r() * 4;
      for (let k = 0; k < n; k++) {
        const u = r(), kind = pth.town ? (u < 0.55 ? 'hatch' : u < 0.8 ? 'moto' : 'van') : u < 0.45 ? 'hatch' : u < 0.82 ? 'sedan' : 'van';
        cars.push({ p: pth, d: (k + r() * 0.6) / n * pth.L, v: sp * (r() < 0.5 ? 1 : -1), hold: 0, kind, c: CC[Math.floor(r() * CC.length)] });
      }
    }
    const carMat = tintMat({ roughness: 0.38, metalness: 0.35 }), fleets = {};
    for (const kind of Object.keys(CAR)) {
      const list = cars.filter((c) => c.kind === kind); if (!list.length) continue;
      const im = new THREE.InstancedMesh(CAR[kind], carMat, list.length); im.userData.noOcclude = true; im.frustumCulled = false; im.castShadow = true;
      list.forEach((c, k) => { c.im = im; c.k = k; im.setColorAt(k, new THREE.Color(c.c)); });
      scene.add(im); fleets[kind] = im;
    }
    roadPaths.push(...paths);
    const P2 = [0, 0];
    const posAt = (pth, d) => { d = Math.max(0, Math.min(pth.L - 0.01, d)); let k = 1; while (k < pth.cum.length - 1 && pth.cum[k] < d) k++; const f = (d - pth.cum[k - 1]) / Math.max(0.01, pth.cum[k] - pth.cum[k - 1]); const a = pth.pts[k - 1], b = pth.pts[k]; P2[0] = a[0] + (b[0] - a[0]) * f; P2[1] = a[1] + (b[1] - a[1]) * f; return Math.atan2(b[0] - a[0], b[1] - a[1]); };
    parts.push({ update: (dt) => {
      for (const c of cars) {
        if (c.hold > 0) { c.hold -= dt; m4.makeScale(0, 0, 0); c.im.setMatrixAt(c.k, m4); continue; }
        c.d += c.v * dt;
        if (c.d > c.p.L || c.d < 0) { c.v = -c.v; c.d = Math.max(0, Math.min(c.p.L, c.d)); c.hold = 3; continue; }
        const yaw = posAt(c.p, c.d), dir = c.v > 0 ? 0 : Math.PI, side = (c.v > 0 ? 1 : -1) * c.p.hw * 0.48;
        const x = P2[0] - Math.cos(yaw) * side, z = P2[1] + Math.sin(yaw) * side;
        m4.compose(v.set(x, roadH(x, z) + 0.18, z), q.setFromAxisAngle(Y, yaw + dir), sc.set(1, 1, 1)); c.im.setMatrixAt(c.k, m4);
      }
      for (const im of Object.values(fleets)) im.instanceMatrix.needsUpdate = true;
    } });
  }

  // ============================================================== 2) puerto
  const [q0, q1, qOff] = T.meta.quay;
  const paveM = new THREE.MeshStandardMaterial({ map: pavingTex(), roughness: 0.92 }); paveM.map.repeat.set(1, 1);
  {
    // muelle: losas desde el muro de la pista hasta el agua, muro de sillería hasta el fondo y bordillo de piedra
    const edge = (s) => T.hwAt(s) + qOff;
    world.along(q0 - 10, q1 - q0 + 10, (s) => world.barrier(s, 1) + 0.45, edge, -0.3, paveM, 4, 4);
    const wallM = new THREE.MeshStandardMaterial({ map: quayWallTex(), roughness: 0.95 });
    world.along(q0 - 10, q1 - q0 + 10, edge, edge, (s, e) => (e ? -0.3 : -3.5 - at(s, edge(s))[1]), wallM, 1, 8);
    const capM = new THREE.MeshStandardMaterial({ color: 0xe6dfcf, roughness: 0.8 });
    world.along(q0 - 10, q1 - q0 + 10, (s) => edge(s) - 0.7, edge, -0.12, capM, 1, 4);
    const bol = [], lamps = [], palmsL = [], tables = [], parasols = [];
    for (let s = q0; s < q1; s += 9) { const [x, y, z] = at(s, edge(s) - 0.45); bol.push({ x, y: y - 0.3, z }); }
    for (let s = q0 + 6; s < q1 - 4; s += 26) { const [x, y, z] = at(s, edge(s) - 5); lamps.push({ x, y: y - 0.3, z, yaw: yawAt(s) }); }
    for (let s = q0 + 18; s < q1 - 6; s += 26) { const [x, y, z] = at(s, edge(s) - 8); palmsL.push([x, z]); }
    // terrazas de café entre las palmeras
    for (let s = q0 + 30; s < q1 - 20; s += 52) {
      for (let k = 0; k < 6; k++) {
        const ss = s + (k % 3) * 4.5, dd = edge(ss) - 11 - Math.floor(k / 3) * 4; const [x, y, z] = at(ss, dd);
        tables.push({ x, y: y - 0.3, z }); parasols.push({ x, y: y - 0.3, z, c: [0xfaf6ee, 0x1e5aa0, 0xc0392b][Math.floor(s / 52) % 3] });
        for (let c = 0; c < 3; c++) if (r() < 0.75) { const a = c * 2.1 + r(); seated.push({ x: x + Math.cos(a) * 0.9, y: y - 0.3, z: z + Math.sin(a) * 0.9, yaw: a + Math.PI, s: 0.95, c: SUMMER[Math.floor(r() * SUMMER.length)] }); }
      }
    }
    inst(scene, cylAt(0.22, 0.28, 0.6, 0, 0.3, 0, 8), new THREE.MeshStandardMaterial({ color: 0x2b2f33, metalness: 0.6, roughness: 0.4 }), bol);
    const lampG = merged([{ g: cylAt(0.08, 0.12, 4.2, 0, 2.1, 0), c: lin(0x24332a), tint: 0 }, { g: boxAt(0.42, 0.55, 0.42, 0, 4.45, 0), c: lin(0xf2ead8), tint: 0 }, { g: new THREE.ConeGeometry(0.36, 0.3, 4).rotateY(Math.PI / 4).translate(0, 4.85, 0), c: lin(0x24332a), tint: 0 }]);
    for (const l of roadLamps) lamps.push({ x: l.x, y: G(l.x, l.z) - 0.1, z: l.z, yaw: l.yaw });
    chunked(scene, lampG, tintMat({ roughness: 0.6 }), lamps, { cell: 260, shadow: true });
    lamps.forEach((l) => world.addOccluder(l.x, l.z, 0.2, 0.2, 0, l.y, l.y + 5));
    palmList.push(...palmsL.map(([x, z]) => ({ x, z, kind: 0 })));
    inst(scene, merged([{ g: cylAt(0.45, 0.45, 0.06, 0, 0.75, 0, 10) }, { g: cylAt(0.04, 0.04, 0.75, 0, 0.37, 0) }]), tintMat({ roughness: 0.5 }), tables);
    const umb = merged([{ g: new THREE.ConeGeometry(1.7, 0.5, 8, 1, true).translate(0, 2.5, 0) }, { g: cylAt(0.03, 0.03, 2.5, 0, 1.25, 0, 4), c: lin(0x333333), tint: 0 }]);
    inst(scene, umb, tintMat({ roughness: 0.7, side: THREE.DoubleSide }), parasols, { shadow: true });
    // público a lo largo de la valla del muelle (mirando a la pista)
    for (let s = q0 + 3; s < q1 - 3; s += 1.1) {
      const B = world.barrier(s, 1), i = T.idx(s);
      for (let dd = B + 1.2; dd < B + 4.5; dd += 0.9) if (r() < 0.55 - (dd - B) * 0.08) { const [x, y, z] = at(s + (r() - 0.5) * 0.6, dd); person(x, z, Math.atan2(-T.lx[i], -T.lz[i]) + (r() - 0.5) * 0.8, y - 0.3); }
    }
    // barcos amarrados de popa al muelle, con la proa hacia la dársena
    for (let s = q0 + 4; s < q1 - 6;) {
      const motor = r() < 0.55, k = motor ? 0.75 + r() * 0.75 : 0.85 + r() * 0.35, beam = (motor ? 5 : 3.6) * k;
      const i = T.idx(s), L = (motor ? 18 : 11) * k, [ex, , ez] = at(s, edge(s));
      (motor ? boats.motor : boats.sail).push({ x: ex + T.lx[i] * (L / 2 + 1.2), y: 0.15, z: ez + T.lz[i] * (L / 2 + 1.2), yaw: Math.atan2(T.lx[i], T.lz[i]), s: k, c: HULLC[Math.floor(r() * HULLC.length)] });
      s += beam + 0.9;
    }
    // pantalanes de la dársena con veleros a los dos lados
    const ponG = new THREE.BoxGeometry(1, 1, 1);
    const pons = [];
    for (const px of [1118, 1188, 1258]) {
      const z0 = 431, z1 = 590; pons.push({ x: px, y: 0.25, z: (z0 + z1) / 2, sx: 2.6, sy: 0.5, sz: z1 - z0 });
      for (let z = z0 + 6; z < z1 - 3; z += 4.4) for (const sd2 of [-1, 1]) {
        if (r() < 0.12) continue;
        const motor = r() < 0.25, k = motor ? 0.6 + r() * 0.35 : 0.75 + r() * 0.35, L = (motor ? 18 : 11) * k;
        (motor ? boats.motor : boats.sail).push({ x: px + sd2 * (1.3 + L / 2 + 0.8), y: 0.15, z: z + (r() - 0.5) * 0.4, yaw: sd2 * Math.PI / 2, s: k, c: HULLC[Math.floor(r() * HULLC.length)] });
      }
    }
    inst(scene, ponG, new THREE.MeshStandardMaterial({ color: 0xa08a6a, roughness: 0.9 }), pons);
    // espigón de los pescadores con sus barcas de colores
    {
      const a = [1060, 756], b = [1108, 688], L = Math.hypot(b[0] - a[0], b[1] - a[1]), yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
      inst(scene, ponG, paveM.clone(), [{ x: (a[0] + b[0]) / 2, y: 0.6, z: (a[1] + b[1]) / 2, yaw, sx: 6, sy: 4, sz: L }]);
      for (let t = 0.08; t < 0.95; t += 0.085) for (const sd2 of [-1, 1]) {
        const x = a[0] + (b[0] - a[0]) * t + Math.cos(yaw) * sd2 * 6.2, z = a[1] + (b[1] - a[1]) * t - Math.sin(yaw) * sd2 * 6.2;
        boats.fish.push({ x, y: 0.15, z, yaw: yaw + (r() - 0.5) * 0.15 + (sd2 > 0 ? 0 : Math.PI), s: 0.85 + r() * 0.3, c: FISHC[Math.floor(r() * FISHC.length)] });
      }
    }
    // rompeolas de escollera con muro y baliza en la punta (verde el de levante, rojo el del sur)
    const breakwater = (pts, beacon) => {
      const crown = [];
      for (let k = 0; k < pts.length - 1; k++) {
        const [ax, az] = pts[k], [bx, bz] = pts[k + 1], L = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(bx - ax, bz - az), nx = Math.cos(yaw), nz = -Math.sin(yaw);
        crown.push({ x: (ax + bx) / 2, y: 0, z: (az + bz) / 2, yaw, sx: 4, sy: 4.2, sz: L + 2 });
        for (let t = 0; t < L; t += 2.2) for (const sd2 of [-1, 1]) for (let row = 0; row < 3; row++) {
          const off = sd2 * (3 + row * 2.6 + r()), x = ax + (bx - ax) * t / L + nx * off, z = az + (bz - az) * t / L + nz * off;
          rocks.push({ x, y: 2.2 - row * 1.6 + r() * 0.6, z, yaw: r() * 6, tilt: r() * 2, s: 1.6 + r() * 1.3, c: 0xffffff });
        }
      }
      inst(scene, ponG, new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.9 }), crown.map((c) => ({ ...c, y: 0.9 })), { shadow: true });
      const [ex, ez] = pts[pts.length - 1];
      const tw = merged([{ g: cylAt(1.1, 1.3, 6.5, 0, 3.25, 0, 12), c: lin(beacon) }, { g: cylAt(1.15, 1.15, 0.9, 0, 3.6, 0, 12), c: lin(0xf5f5f5) }, { g: cylAt(0.55, 0.55, 1.2, 0, 7.1, 0, 10), c: lin(0x90a4ae) }, { g: new THREE.ConeGeometry(0.7, 0.7, 10).translate(0, 8.05, 0), c: lin(beacon) }]);
      inst(scene, tw, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), [{ x: ex, y: 2.4, z: ez }], { shadow: true });
    };
    breakwater([[1352, 418], [1346, 520], [1338, 600], [1326, 652]], 0x2e9e4f);
    breakwater([[1150, 800], [1205, 768], [1256, 728]], 0xd32f2f);
  }

  // ============================================================== barcos: todos juntos (amarrados y fondeados)
  {
    // fondeados frente al puerto y en la cala (como en Mónaco: gente en las cubiertas viendo la carrera)
    const anchor = [[1520, 560, 260, 200, 22], [1450, 900, 200, 140, 12], [80, 1150, 260, 90, 14], [-700, -320, 260, 110, 10], [500, -330, 300, 120, 8]];
    for (const [cx, cz, rx, rz, n] of anchor) for (let k = 0, t = 0; k < n && t < n * 20; t++) {
      const x = cx + (r() - 0.5) * 2 * rx, z = cz + (r() - 0.5) * 2 * rz;
      if (sd(x, z) > -40) continue;
      const motor = r() < 0.6, kk = motor ? 0.9 + r() * 1.1 : 0.9 + r() * 0.4;
      const b = { x, y: 0.15, z, yaw: 0.6 + (r() - 0.5) * 0.5, s: kk, c: HULLC[Math.floor(r() * HULLC.length)] };
      (motor ? boats.motor : boats.sail).push(b); k++;
      if (motor) for (let p = 0; p < 2 + Math.floor(r() * 5); p++) { const a = b.yaw, lz = (r() - 0.6) * 10 * kk, lx = (r() - 0.5) * 3 * kk; person(x + Math.sin(a) * lz + Math.cos(a) * lx, z + Math.cos(a) * lz - Math.sin(a) * lx, r() * 6, 2.1 * kk + 0.15); }
    }
    for (const k of ['sail', 'motor', 'fish']) chunked(scene, BG[k], boatMat, boats[k], { cell: 300 });
  }
  // ============================================================== 3) pueblo blanco en la colina (y la fila de casas de colores del muelle)
  const facM = [facadeTex('#2f5d8a', 11), facadeTex('#3f6b4f', 23)].map((t) => new THREE.MeshStandardMaterial({ map: t, vertexColors: true, roughness: 0.92 }));
  const walls = [new Walls(), new Walls()];
  const flatRoofs = [], houseRoofs = [], hipRoofs = [], gableRoofs = [], gableEnds = [], extras = [], tanks = [], bougain = [], balconies = [], chimneys = [], awnings = [];
  const col = new THREE.Color();
  const WHITE = [0xf6f4ee, 0xf3f1ea, 0xf8f6f0, 0xefebe2], PASTEL = [0xf1e3c6, 0xe9c690, 0xedc4b8, 0xf2e1a6, 0xd4e2ea, 0xe8d5c0];
  const VIVID = [0xd9893b, 0xc4553d, 0xe8b84a, 0xe39b7b, 0xf1d8a8, 0xb5533c, 0xe0c068, 0xd7745a, 0xcf8f5a, 0xe6a96b];
  const TERRA = [0xb5562f, 0xa94d2b, 0xc0653a, 0x9e4a2c];
  // ¿la planta de una casa queda entera fuera de los muros de la pista (con margen)?
  const clearFoot = (x, z, w, d, yaw, margin) => {
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    for (let a = -0.5; a <= 0.5; a += 0.125) for (let b = -0.5; b <= 0.5; b += 0.125) {
      if (Math.abs(a) < 0.5 && Math.abs(b) < 0.5) continue;
      const px = x + a * w * c + b * d * sn, pz = z - a * w * sn + b * d * c, qn = world.nearest(px, pz, 4);
      if (qn.i < 0) continue;
      const sd2 = (px - T.x[qn.i]) * T.lx[qn.i] + (pz - T.z[qn.i]) * T.lz[qn.i] >= 0 ? 1 : -1;
      if (qn.d < world.barrier(qn.i * T.ds, sd2) + margin) return false;
    }
    return true;
  };
  const house = (x, z, w, d, floors, yaw, color, roof, mat = 0, sink = 0.6, noClaim = false) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let gmin = 1e9, gmax = -1e9;
    for (const [a, b] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [0, 0]]) { const g = G(x + a * c + b * s, z - a * s + b * c); gmin = Math.min(gmin, g); gmax = Math.max(gmax, g); }
    const y0 = gmin - sink, top = sink > 2 ? gmin + floors * 3.2 : Math.max(gmin + floors * 3.2 + 0.3, gmax + 3.2), h = top - y0;
    if (!noClaim && sink <= 2 && gmax - gmin > 14) return gmax;                 // (en un cortado no: quedaba una torre)
    walls[mat].add(x, y0, z, w, d, h, yaw, col.setHex(color), 3.6 * Math.floor(r() * 4));
    (world.coastHouses ||= []).push({ x, z, w, d, yaw, y0, top });
    // balcones de hierro en la fachada larga (una o las dos), en las plantas de arriba
    if (floors >= 2 && w >= 5 && r() < 0.55) for (const fb of r() < 0.4 ? [1, -1] : [r() < 0.5 ? 1 : -1]) for (let f = 1; f < Math.floor(floors); f++) {
      if (r() < 0.25) continue;
      const bw = Math.min(w - 1.2, 1.8 + r() * 2.4), off = (r() - 0.5) * (w - bw - 0.8), by = gmin + f * 3.2 + 0.15;
      if (by < gmax + 1) continue;                                                         // (no a ras del suelo de la ladera)
      balconies.push({ x: x + off * c + fb * (d / 2 + 0.45) * s, y: by, z: z - off * s + fb * (d / 2 + 0.45) * c, yaw: yaw + (fb > 0 ? 0 : Math.PI), sx: bw, sy: 1, sz: 1, c: 0xf4f1ea });
    }
    if (roof === 'flat') {
      houseRoofs.push({ x, y: top, z, yaw, sx: w + 0.3, sy: 1, sz: d + 0.3, c: 0xf1eee6 });
      if (r() < 0.35) extras.push({ x: x + (r() - 0.5) * w * 0.5, y: top + 0.4, z: z + (r() - 0.5) * d * 0.5, yaw, sx: 2.2, sy: 2.3, sz: 2.4, c: color });
      if (r() < 0.25) tanks.push({ x: x + (r() - 0.5) * w * 0.6, y: top + 0.4, z: z + (r() - 0.5) * d * 0.6, yaw: r() * 3 });
    } else {
      const rh = roof === 'hip' ? 1.6 + Math.min(w, d) * 0.12 : 1.4 + Math.min(w, d) * 0.14, tc = TERRA[Math.floor(r() * TERRA.length)];
      if (roof === 'hip') hipRoofs.push({ x, y: top, z, yaw, sx: w + 0.8, sy: rh, sz: d + 0.8, c: tc });
      else { gableRoofs.push({ x, y: top, z, yaw, sx: w + 0.8, sy: rh, sz: d + 0.8, c: tc }); gableEnds.push({ x, y: top, z, yaw, sx: w, sy: rh, sz: d + 0.02, c: color }); }
      // chimenea que asoma del tejado
      if (r() < 0.5) { const a = (r() - 0.5) * w * 0.5, b = (r() - 0.5) * d * 0.4; chimneys.push({ x: x + a * c + b * s, y: top + rh * 0.35, z: z - a * s + b * c, yaw, s: 0.9 + r() * 0.3, c: r() < 0.6 ? 0xf3f0e8 : tc }); }
    }
    if (r() < 0.12) bougain.push({ x: x + (r() - 0.5) * w, y: gmin + 0.5 + r() * 2.5, z: z + (r() - 0.5) * d, s: 1.2 + r() * 1.4, c: [0xc2185b, 0xd81b60, 0x8e24aa, 0xe91e63][Math.floor(r() * 4)] });
    if (!noClaim) ctx.claim(x, z, Math.max(w, d) * 0.55);
    return top;
  };
  {
    // fila de casas altas de colores pegadas al muro del muelle (lado derecho de la pista), estilo Portofino
    for (let s = q0 - 25; s < T.meta.tunnel[0] - 4;) {
      const w = 7 + r() * 6, dep = 13, B = world.barrier(s + w / 2, -1), sm = s + w / 2;
      const [x, , z] = at(sm, -(B + 1.4 + dep / 2));
      if (!clearFoot(x, z, w, dep, yawAt(sm), 1)) { s += 4; continue; }
      house(x, z, w, dep, 4 + Math.floor(r() * 3), yawAt(sm), VIVID[Math.floor(r() * VIVID.length)], r() < 0.6 ? 'gable' : 'flat', 1, 2.5);
      // toldo de tienda o de café en la planta baja, hacia la pista
      if (r() < 0.6) { const i = T.idx(sm), fx = x + T.lx[i] * (dep / 2), fz = z + T.lz[i] * (dep / 2); awnings.push({ x: fx, y: Math.max(G(fx, fz), at(sm, -B)[1]) + 3.1, z: fz, yaw: Math.atan2(T.lx[i], T.lz[i]), sx: w * 0.8, sy: 1, sz: 1, c: [0xc0392b, 0x1e5aa0, 0x2e8b57, 0xe0a030, 0xf2efe6][Math.floor(r() * 5)] }); }
      s += w + 0.05;
    }
    // el pueblo: casas apretadas en la ladera (rejilla de 9,5 m con desorden, callejuelas radiales y en anillo), más altas
    // y más juntas cerca de la cumbre y en la cara del puerto; las paredes de cada casa bajan hasta el punto más bajo del
    // terreno (en la ladera empinada se ven como casas escalonadas)
    const HC = [800, 545], target = hi ? 1150 : 500, gTop = G(HC[0], HC[1]), GY = 0.35, gc = Math.cos(GY), gs = Math.sin(GY);
    const town = [];
    for (let gx = -330; gx <= 330; gx += 9.5) for (let gz = -350; gz <= 350; gz += 9.5) {
      const jx = (hash(gx * 3.1 + gz * 0.7) - 0.5) * 2.6, jz = (hash(gz * 1.7 - gx * 0.3) - 0.5) * 2.6;
      const x = HC[0] + (gx + jx) * gc + (gz + jz) * gs, z = HC[1] - (gx + jx) * gs + (gz + jz) * gc;
      const d = Math.hypot(x - HC[0], z - HC[1]); if (d < 38 || d > 330) continue;
      const harbourSide = x > HC[0] + 60 ? 0.12 : 0;
      if (r() > Math.min(0.95, (d < 190 ? 0.86 : 0.86 * (1 - (d - 190) / 140)) + harbourSide)) continue;
      const w = 5.5 + r() * 3.2, dd = 5.5 + r() * 2.8, rad = Math.hypot(w, dd) / 2;
      if (!onLand(x, z, rad, 5) || !fits(x, z, rad, 3)) continue;
      const qn = world.nearest(x, z, 4); if (qn.i >= 0 && T.inTunnel(qn.i * T.ds) && qn.d < T.hw[qn.i] + 12 + rad) continue;
      if (Math.abs(G(x + 4, z) - G(x - 4, z)) + Math.abs(G(x, z + 4) - G(x, z - 4)) > 18) continue;      // cortado
      town.push({ x, z, w, dd, d });
    }
    for (const h of town.sort(() => r() - 0.5).slice(0, target)) {
      const pastel = r() < 0.2, fl = 2 + (r() < 0.4 ? 1 : 0) + (h.d < 120 && r() < 0.3 ? 1 : 0);
      house(h.x, h.z, h.w, h.dd, fl, GY + (r() - 0.5) * 0.12, pastel ? PASTEL[Math.floor(r() * PASTEL.length)] : WHITE[Math.floor(r() * WHITE.length)], r() < 0.55 ? 'flat' : 'hip', r() < 0.7 ? 0 : 1, 0.6, true);
    }
    for (const h of town) ctx.claim(h.x, h.z, 3);
    // bancales: muros de piedra seca a lo largo de las curvas de nivel donde la ladera pica (huertos y jardines escalonados)
    for (let t = 0, n = 0; t < 9000 && n < (hi ? 650 : 300); t++) {
      const a = r() * 6.283, d = Math.sqrt(r()) * 340, x = HC[0] + Math.cos(a) * d, z = HC[1] + Math.sin(a) * d;
      const gx = G(x + 3, z) - G(x - 3, z), gz = G(x, z + 3) - G(x, z - 3), sl = Math.hypot(gx, gz) / 6;
      if (sl < 0.3 || sl > 1.6 || !onLand(x, z, 6, 6) || !fits(x, z, 5, 4)) continue;
      const len = 7 + r() * 9, hgt = 1.2 + sl * 1.6, yaw = Math.atan2(gx, gz) + Math.PI / 2;
      flatRoofs.push({ x, y: G(x, z) - hgt * 0.55, z, yaw, sx: len, sy: hgt, sz: 0.7, c: [0xd8cbb0, 0xcbbd9f, 0xe2d6bc][n % 3] });
      ctx.claim(x, z, 2.5); n++;
    }
    // iglesia en lo alto: nave, crucero con cúpula de tejas vidriadas y campanario; plaza con árboles
    const cy = gTop, yaw = 0.35;
    const plain = new THREE.MeshStandardMaterial({ color: 0xf7f3ea, roughness: 0.9 });
    const ch = new THREE.Group(); ch.position.set(HC[0], cy - 0.5, HC[1]); ch.rotation.y = yaw;
    const add = (g, m, x, y, z) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; ch.add(o); return o; };
    add(new THREE.BoxGeometry(11, 11, 26), plain, 0, 5.5, 0);
    add(new THREE.BoxGeometry(22, 9, 9), plain, 0, 4.5, 4);
    add(new THREE.CylinderGeometry(5.2, 5.2, 4, 16), plain, 0, 13, 4);
    add(new THREE.SphereGeometry(5.3, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2f6fa8, roughness: 0.35, metalness: 0.2 }), 0, 15, 4);
    add(new THREE.CylinderGeometry(0.5, 0.7, 2.4, 8), plain, 0, 21.2, 4);
    add(new THREE.BoxGeometry(5.5, 25, 5.5), plain, 9, 12.5, -10);
    add(new THREE.BoxGeometry(5.6, 3.4, 5.6), new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.9 }), 9, 21, -10);
    add(new THREE.ConeGeometry(4.2, 5, 4).rotateY(Math.PI / 4), new THREE.MeshStandardMaterial({ color: 0xb5562f, roughness: 0.7, flatShading: true }), 9, 27.6, -10);
    add(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 4), new THREE.MeshStandardMaterial({ color: 0x333333 }), 9, 31, -10);
    const roofT = new THREE.MeshStandardMaterial({ color: 0xae5532, roughness: 0.75, flatShading: true });
    const nave = new THREE.CylinderGeometry(0.01, 7.6, 3.4, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 2.45); add(nave, roofT, 0, 12.7, 0);
    scene.add(ch);
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(36, 32), paveM); plaza.rotation.x = -Math.PI / 2; plaza.position.set(HC[0], cy + 0.08, HC[1]); plaza.receiveShadow = true; scene.add(plaza);
    ctx.claim(HC[0], HC[1], 34);
    for (let k = 0; k < 10; k++) { const a = k / 10 * 6.283 + 0.3, x = HC[0] + Math.cos(a) * 27, z = HC[1] + Math.sin(a) * 27; treeList.push({ x, z, kind: 'plane' }); }
    for (let k = 0; k < 40; k++) { const a = r() * 6.283, d = 14 + r() * 18; person(HC[0] + Math.cos(a) * d, HC[1] + Math.sin(a) * d, r() * 6, cy); }
    // edificios del puerto en la orilla norte de la dársena: club náutico, capitanía y la lonja
    for (const [x, z, w, d, h, c, yawB] of [[1175, 405, 30, 13, 2, 0xf6f6f2, 0.05], [1262, 402, 16, 11, 3, 0xe8c37e, 0.05], [1100, 406, 22, 12, 1, 0xd9d2c0, 0.04]]) {
      if (!fits(x, z, Math.max(w, d) / 2, 2)) continue;
      house(x, z, w, d, h, yawB, c, h > 2 ? 'hip' : 'flat', 0);
    }
  }
  // ============================================================== 4) túnel bajo el pueblo: azulejo claro abajo, hormigón
  // arriba, dos filas de luces en el techo, ventiladores, nichos de emergencia; bocas de piedra con el nombre y trincheras
  const [t0, t1] = T.meta.tunnel, tLen = T.ahead(t0, t1), RH = 7.2, BH = 9.8;
  const tunnelUpd = { k: 0, e: 1 };
  {
    const tileM = new THREE.MeshStandardMaterial({ map: tunnelTex(), roughness: 0.55, side: THREE.DoubleSide });
    const ceilM = new THREE.MeshStandardMaterial({ color: 0x45474a, roughness: 0.95, side: THREE.DoubleSide });
    const stoneM = new THREE.MeshStandardMaterial({ map: stoneTex(), roughness: 0.95, side: THREE.DoubleSide });
    const topM = new THREE.MeshStandardMaterial({ map: pavingTex(), color: 0xd8cfb8, roughness: 0.95 });
    const Bw = (side) => (s) => side * (world.barrier(s, side) + 0.05), outer = (side) => (s) => side * (T.hwAt(s) + 20);
    for (const side of [1, -1]) {
      world.along(t0 - 0.5, tLen + 1, Bw(side), Bw(side), (s, e) => (e ? RH : -0.3), tileM, 1, 6).castShadow = true;
      world.along(t0 - 0.5, tLen + 1, outer(side), outer(side), (s, e) => (e ? BH : -1.5), stoneM, 1, 6).castShadow = true;
    }
    world.along(t0 - 0.5, tLen + 1, Bw(-1), Bw(1), RH, ceilM, 6, 6).castShadow = true;
    world.along(t0 - 0.5, tLen + 1, outer(-1), outer(1), BH, topM, 6, 6).castShadow = true;
    // luces, ventiladores, nichos con su cartel verde
    const lights = [], fans = [], niches = [], signs = [];
    for (let s = t0 + 3; s < t1 - 2; s += 4.5) for (const dd of [-2.9, 2.9]) { const [x, y, z] = at(s, dd); lights.push({ x, y: y + RH - 0.08, z, yaw: yawAt(s) }); }
    for (let s = t0 + 60; s < t1 - 40; s += 110) for (const dd of [-3.4, 3.4]) { const [x, y, z] = at(s, dd); fans.push({ x, y: y + RH - 0.95, z, yaw: yawAt(s) }); }
    for (let s = t0 + 90; s < t1 - 30; s += 140) for (const side of [1, -1]) {
      const B = world.barrier(s, side), [x, y, z] = at(s, side * (B + 0.02)), yaw = yawAt(s);
      niches.push({ x, y, z, yaw, sx: 0.12, sy: 2.4, sz: 1.6 }); const [sx2, sy2, sz2] = at(s, side * (B - 0.05)); signs.push({ x: sx2, y: sy2 + 2.9, z: sz2, yaw, sx: 0.1, sy: 0.35, sz: 1.0 });
    }
    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
    inst(scene, boxAt(0.5, 0.1, 2.8, 0, 0, 0), new THREE.MeshStandardMaterial({ color: 0xfff7e8, emissive: 0xffe0a8, emissiveIntensity: 2.4 }), lights);
    const fanG = merged([{ g: new THREE.CylinderGeometry(0.55, 0.55, 4, 12).rotateX(Math.PI / 2), c: lin(0x9ea4a8), tint: 0 }, { g: boxAt(0.15, 0.9, 0.15, 0, 0.9, -1.2), c: lin(0x5f6468), tint: 0 }, { g: boxAt(0.15, 0.9, 0.15, 0, 0.9, 1.2), c: lin(0x5f6468), tint: 0 }]);
    inst(scene, fanG, tintMat({ roughness: 0.4, metalness: 0.5 }), fans);
    inst(scene, box, new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.8 }), niches);
    inst(scene, boxAt(1, 1, 1, 0, 0, 0), new THREE.MeshStandardMaterial({ color: 0x1fa055, emissive: 0x18c060, emissiveIntensity: 1.6 }), signs);
    // bocas: muro de piedra con cornisa y rótulo, y trinchera de acceso con muros que bajan
    const signTex = (() => { const [c, g] = canvas(1024, 128); g.fillStyle = '#e9e2d0'; g.fillRect(0, 0, 1024, 128); g.fillStyle = '#5b4a3a'; g.font = 'bold 76px Georgia, serif'; g.textAlign = 'center'; g.fillText('PUNTA SERENA', 512, 92); return ctex(c, false); })();
    for (const [sp, dir] of [[t0, -1], [t1, 1]]) {
      const grp = new THREE.Group(), [x, y, z] = at(sp, 0); grp.position.set(x, y, z); grp.rotation.y = yawAt(sp);
      const hw = T.hwAt(sp), B = world.barrier(sp, 1) + 0.05, W = hw + 26, Hh = 15, D = 3;
      const zc = dir * D / 2;
      const add = (g, m, px, py, pz) => { const o = new THREE.Mesh(g, m); o.position.set(px, py, pz); o.castShadow = o.receiveShadow = true; grp.add(o); };
      add(new THREE.BoxGeometry(W - B, Hh + 2, D), stoneM, (W + B) / 2, Hh / 2 - 1, zc);
      add(new THREE.BoxGeometry(W - B, Hh + 2, D), stoneM, -(W + B) / 2, Hh / 2 - 1, zc);
      add(new THREE.BoxGeometry(2 * B, Hh - RH, D), stoneM, 0, (Hh + RH) / 2, zc);
      add(new THREE.BoxGeometry(2 * W + 1, 0.6, D + 0.8), new THREE.MeshStandardMaterial({ color: 0xe7dfcc, roughness: 0.8 }), 0, Hh + 0.3, zc);
      // explanada encima de la boca, 14 m hacia dentro de la colina (tapa el corte del terreno sobre la trinchera)
      add(new THREE.BoxGeometry(2 * W, 3, 14), topM, 0, Hh - 1.2, -dir * 7);
      for (let px2 = -W + 4; px2 < W; px2 += 8) { const lz = -dir * 7, [cx2, , cz2] = [x + px2 * Math.cos(yawAt(sp)) + lz * Math.sin(yawAt(sp)), 0, z - px2 * Math.sin(yawAt(sp)) + lz * Math.cos(yawAt(sp))]; ctx.claim(cx2, cz2, 7); }
      add(new THREE.BoxGeometry(2 * B + 0.6, 0.5, D + 0.4), new THREE.MeshStandardMaterial({ color: 0xe7dfcc, roughness: 0.8 }), 0, RH + 0.25, zc);
      // marco de piedra clara alrededor de la boca, rótulo, balaustrada arriba y gente asomada
      const lightM = new THREE.MeshStandardMaterial({ color: 0xece4d2, roughness: 0.85 }), zf = zc + dir * 0.25;
      for (const sx of [1, -1]) add(new THREE.BoxGeometry(1.4, RH + 1.4, D + 0.5), lightM, sx * (B + 0.7), (RH + 1.4) / 2 - 0.3, zf);
      add(new THREE.BoxGeometry(2 * B + 2.8, 1.4, D + 0.5), lightM, 0, RH + 0.7, zf);
      add(new THREE.BoxGeometry(2.2, 2.2, 0.4), new THREE.MeshStandardMaterial({ color: 0xb08d57, roughness: 0.5, metalness: 0.4 }), 0, RH + 4.6, zc + dir * (D / 2 + 0.2));
      const sg = new THREE.Mesh(new THREE.PlaneGeometry(17, 2.1), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.7 }));
      sg.position.set(0, RH + 2.4, zc + dir * (D / 2 + 0.03)); if (dir < 0) sg.rotation.y = Math.PI; grp.add(sg);
      add(new THREE.BoxGeometry(2 * W, 0.18, 0.25), lightM, 0, Hh + 1.45, zc + dir * (D / 2 - 0.2));
      for (let px2 = -W + 0.5; px2 < W; px2 += 2.5) add(new THREE.BoxGeometry(0.22, 0.85, 0.22), lightM, px2, Hh + 1.0, zc + dir * (D / 2 - 0.2));
      scene.add(grp);
      const cy2 = Math.cos(yawAt(sp)), sy2 = Math.sin(yawAt(sp));
      for (let px2 = -W + 2; px2 < W - 2; px2 += 0.8 + r() * 0.9) if (r() < 0.7) { const lz = zc + dir * (D / 2 - 0.9); person(x + px2 * cy2 + lz * sy2, z - px2 * sy2 + lz * cy2, yawAt(sp) + (dir < 0 ? Math.PI : 0) + (r() - 0.5) * 0.6, y + Hh + 0.6); }
    }
    // cámaras y rayos: dentro del túnel solo se ve lo que hay dentro; el bloque y la colina tapan
    world.solidAt = (x, y, z, nr, d, h) => {
      const s = nr.i * T.ds, ad = Math.abs(d), B = world.barrier(s, d >= 0 ? 1 : -1);
      // muro de las bocas (3 m de grueso por fuera), salvo el hueco del túnel
      if ((between(T, s, T.wrap(t0 - 3.2), t0) || between(T, s, t1, T.wrap(t1 + 3.2))) && ad < T.hw[nr.i] + 26 && h < 15) return !(ad < B && h < RH);
      if (!between(T, s, T.wrap(t0 - 1), T.wrap(t1 + 1))) return false;
      if (ad < B && h < RH) return false;
      if (ad < T.hw[nr.i] + 20.1) return h < BH + 0.3 || y < G(x, z);
      return y < G(x, z);
    };
    world.tunnel = { t0, t1, RH };
    // luz dentro: sin sol (lo tapa el techo), poca luz ambiente y el ojo que se adapta (la exposición sube despacio)
    tunnelUpd.update = (dt, camPos) => {
      if (!camPos) return;
      const qn = world.nearest(camPos.x, camPos.z, 2);
      let inside = 0;
      if (qn.i >= 0 && T.inTunnel(qn.i * T.ds)) {
        const s = qn.i * T.ds, dd = (camPos.x - T.x[qn.i]) * T.lx[qn.i] + (camPos.z - T.z[qn.i]) * T.lz[qn.i];
        if (Math.abs(dd) < world.barrier(s, dd >= 0 ? 1 : -1) + 0.3 && camPos.y < T.y[qn.i] + RH + 0.5) inside = 1;
      }
      tunnelUpd.k += (inside - tunnelUpd.k) * Math.min(1, dt * 12);                     // luz: casi de golpe
      const eT = 1 + 1.7 * inside;                                                       // ojo: se adapta en ~0,6 s al entrar
      tunnelUpd.e += (eT - tunnelUpd.e) * Math.min(1, dt * (eT > tunnelUpd.e ? 1.6 : 1.1)); // (y algo más despacio al salir)
      world.tunnelK = tunnelUpd.k; world.tunnelDim = 1 - 0.72 * tunnelUpd.k; world.exposureK = tunnelUpd.e;
      // visto desde fuera, el túnel es una boca oscura (dentro no llega el sol); desde dentro, con el ojo hecho, se ve normal
      const lit = 0.3 + 0.7 * tunnelUpd.k; tileM.color.setScalar(lit); ceilM.color.setHex(0x45474a).multiplyScalar(lit);
    };
    parts.push(tunnelUpd);
  }
  // ============================================================== 5) faro en el cabo del suroeste, con la casa del farero
  const rotors = [];
  {
    let best = null;
    for (let t = 0; t < 400 && !best; t++) { const x = -905 + (r() - 0.5) * 70, z = 845 + (r() - 0.5) * 60; if (onLand(x, z, 8, 4) && fits(x, z, 9, 8)) best = [x, z]; }
    if (best) {
      const [x, z] = best, y = G(x, z) - 0.3, H = 27;
      const lh = new THREE.Group(); lh.position.set(x, y, z);
      const segs = 6;
      for (let k = 0; k < segs; k++) {
        const r0 = 3.4 - k * 0.22, r1 = 3.4 - (k + 1) * 0.22, h = H / segs;
        const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, 20), new THREE.MeshStandardMaterial({ color: k % 2 ? 0xc62828 : 0xf7f5f0, roughness: 0.6 }));
        m.position.y = h * (k + 0.5); m.castShadow = true; lh.add(m);
      }
      const add = (g, mat, py) => { const m = new THREE.Mesh(g, mat); m.position.y = py; m.castShadow = true; lh.add(m); return m; };
      add(new THREE.CylinderGeometry(3.0, 3.0, 0.35, 20), new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.5 }), H + 0.15);
      add(new THREE.TorusGeometry(2.9, 0.05, 4, 24).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x222222 }), H + 1.2);
      add(new THREE.CylinderGeometry(1.7, 1.7, 3.0, 16), new THREE.MeshStandardMaterial({ color: 0x9fc7d8, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.55 }), H + 1.85);
      add(new THREE.SphereGeometry(0.7, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c0, emissiveIntensity: 3 }), H + 1.9);
      add(new THREE.SphereGeometry(1.9, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8b2a1f, roughness: 0.4, metalness: 0.4 }), H + 3.35);
      // haz que gira (se intuye a pleno sol)
      // óptica que gira dentro de la linterna (a mediodía no se ve el haz)
      const beam = new THREE.Group(); beam.position.y = H + 1.9;
      const lens = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0c0, emissiveIntensity: 4 });
      for (const sgn of [1, -1]) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.1, 0.9), lens); c.position.x = sgn * 0.75; beam.add(c); }
      lh.add(beam); rotors.push({ o: beam, ax: 'y', sp: 0.9 });
      scene.add(lh); ctx.claim(x, z, 9);
      // casa del farero y tapia
      const yaw = Math.atan2(x + 728, z - 743);
      const hx = x + Math.sin(yaw) * 12, hz = z + Math.cos(yaw) * 12;
      if (fits(hx, hz, 7, 4)) house(hx, hz, 11, 7, 1, yaw, 0xf7f5f0, 'gable', 0);
      world.addOccluder(x, z, 3.4, 3.4, 0, y, y + H + 4);
    }
  }

  // ============================================================== 6) villas con piscina mirando al mar
  const pools = [], loungers = [];
  {
    const HC = [800, 545];
    for (let k = 0, t = 0; k < (hi ? 42 : 20) && t < 4000; t++) {
      const gr = world.terrainGrid, x = gr.x0 + 300 + r() * (gr.x1 - gr.x0 - 600), z = gr.z0 + 300 + r() * (gr.z1 - gr.z0 - 600);
      const s0 = sd(x, z); if (s0 < 35 || s0 > 320 || Math.hypot(x - HC[0], z - HC[1]) < 400) continue;
      if (!fits(x, z, 24, 18)) continue;
      // mira al mar: hacia donde baja la distancia a la costa
      const yaw = Math.atan2(sd(x - 6, z) - sd(x + 6, z), sd(x, z - 6) - sd(x, z + 6));
      const top = house(x, z, 15 + r() * 4, 10 + r() * 2, 2, yaw, WHITE[k % 4], r() < 0.7 ? 'flat' : 'hip', k % 2);
      const c = Math.cos(yaw), s = Math.sin(yaw), fx = Math.sin(yaw), fz = Math.cos(yaw);
      const px = x + fx * 13, pz = z + fz * 13, py = Math.max(G(px, pz), G(x, z)) + 0.2;
      pools.push({ x: px, y: py, z: pz, yaw, sx: 10, sy: 0.3, sz: 5 });
      flatRoofs.push({ x: px, y: py - 1.72, z: pz, yaw, sx: 16, sy: 1.7, sz: 9, c: 0xe6dccb });
      for (let b = 0; b < 3; b++) loungers.push({ x: px + c * (-3 + b * 2.2) + fx * 3.6, y: py, z: pz - s * (-3 + b * 2.2) + fz * 3.6, yaw, sx: 0.75, sy: 0.35, sz: 1.9 });
      palmList.push({ x: px + c * 6.5, z: pz - s * 6.5, kind: 0 }, { x: px - c * 6.8 + fx * 2, z: pz + s * 6.8 + fz * 2, kind: 1 });
      for (let b = 0; b < 4; b++) treeList.push({ x: x - fx * 9 + c * (-6 + b * 4), z: z - fz * 9 - s * (-6 + b * 4), kind: 'cypress' });
      ctx.claim(px, pz, 9); k++;
    }
  }

  // ============================================================== 7) molinos blancos en la loma del oeste, torre vigía, ermita y cementerio
  {
    const mills = [];
    for (let k = 0, t = 0; k < 5 && t < 600; t++) {
      const x = -1180 + k * 70 + (r() - 0.5) * 40, z = 260 + (r() - 0.5) * 160;
      if (!onLand(x, z, 6, 10) || !fits(x, z, 9, 10) || !mills.every((m) => Math.hypot(m[0] - x, m[1] - z) > 50)) continue;
      mills.push([x, z]); k++;
    }
    const towerG = merged([{ g: cylAt(3.0, 3.4, 9, 0, 4.5, 0, 16), c: lin(0xf6f3ec), tint: 0 }, { g: new THREE.ConeGeometry(3.5, 3.4, 16).translate(0, 10.7, 0), c: lin(0x8a6a48), tint: 0 }, { g: boxAt(1.0, 1.8, 0.2, 0, 0.9, 3.35), c: lin(0x2f5d8a), tint: 0 }]);
    inst(scene, towerG, tintMat({ roughness: 0.85 }), mills.map(([x, z]) => ({ x, y: G(x, z) - 0.4, z, yaw: r() * 6 })), { shadow: true });
    const sailM = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.9, side: THREE.DoubleSide }), spokeM = new THREE.MeshStandardMaterial({ color: 0x5b4632 });
    for (const [x, z] of mills) {
      const yaw = Math.atan2(-x, -400 - z);                                     // de cara al viento del mar (norte)
      const hub = new THREE.Group(); hub.position.set(x + Math.sin(yaw) * 3.6, G(x, z) + 9.6, z + Math.cos(yaw) * 3.6); hub.rotation.y = yaw;
      const rot = new THREE.Group(); hub.add(rot);
      for (let k = 0; k < 8; k++) {
        const arm = new THREE.Group(); arm.rotation.z = k * Math.PI / 4;
        const sp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 9, 0.12), spokeM); sp.position.y = 4.5; arm.add(sp);
        const sl = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 5.5), sailM); sl.position.set(0.9, 6, 0.05); sl.rotation.y = 0.25; arm.add(sl);
        rot.add(arm);
      }
      scene.add(hub); rotors.push({ o: rot, ax: 'z', sp: 0.5 + r() * 0.3 }); ctx.claim(x, z, 8);
      world.addOccluder(x, z, 3.4, 3.4, 0, G(x, z), G(x, z) + 19);
    }
    // torre vigía en el acantilado norte
    for (let t = 0; t < 300; t++) {
      const x = 380 + r() * 500, z = -150 + r() * 70;
      if (!onLand(x, z, 6, 8) || !fits(x, z, 6, 10)) continue;
      const y = G(x, z) - 0.5, tw = new THREE.Group(); tw.position.set(x, y, z);
      const stoneM2 = new THREE.MeshStandardMaterial({ map: stoneTex(), roughness: 0.95 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 5.0, 13, 18), stoneM2); body.position.y = 6.5; body.castShadow = true; tw.add(body);
      for (let k = 0; k < 10; k++) { const a = k / 10 * 6.283, m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 0.9), stoneM2); m.position.set(Math.cos(a) * 4.0, 13.5, Math.sin(a) * 4.0); m.rotation.y = -a; tw.add(m); }
      scene.add(tw); ctx.claim(x, z, 7); world.addOccluder(x, z, 4.6, 4.6, 0, y, y + 14); break;
    }
    // ermita blanca con espadaña y cementerio con cipreses
    for (let t = 0; t < 400; t++) {
      const x = -1250 + r() * 300, z = -40 + r() * 220;
      if (!onLand(x, z, 30, 10) || !fits(x, z, 30, 15)) continue;
      const yaw = 0.2;
      house(x, z, 9, 16, 1.6, yaw, 0xf8f6f0, 'gable', 0);
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const bx = x + s * 8.6, bz = z + c * 8.6, gy = G(bx, bz);
      flatRoofs.push({ x: bx, y: gy - 0.5, z: bz, yaw, sx: 4, sy: 11, sz: 0.9, c: 0xf8f6f0 });
      // cementerio: tapia blanca, cipreses en fila y lápidas
      const cx = x - c * 26, cz = z + s * 26, wallsC = [];
      for (const [a, b, w2, d2] of [[0, -14, 34, 0.5], [0, 14, 34, 0.5], [-17, 0, 0.5, 28], [17, 0, 0.5, 28]]) wallsC.push({ x: cx + a * c + b * s, y: G(cx + a * c + b * s, cz - a * s + b * c) - 0.3, z: cz - a * s + b * c, yaw, sx: w2, sy: 2.3, sz: d2, c: 0xf4f1ea });
      flatRoofs.push(...wallsC);
      for (let k = -3; k <= 3; k++) for (const b of [-10, 10]) treeList.push({ x: cx + k * 4.5 * c + b * s, z: cz - k * 4.5 * s + b * c, kind: 'cypress' });
      for (let a = -12; a <= 12; a += 3) for (const b of [-5, -1.5, 2, 5.5]) flatRoofs.push({ x: cx + a * c + b * s, y: G(cx + a * c + b * s, cz - a * s + b * c) - 0.1, z: cz - a * s + b * c, yaw, sx: 1.0, sy: 0.9 + r() * 0.4, sz: 2.0, c: 0xdcd8cf });
      ctx.claim(cx, cz, 22); break;
    }
  }

  // ============================================================== 7b) mirador al final de la carretera de montaña: explanada
  // de piedra con pretil, ermita blanca y unos pinos, con todo el circuito a los pies
  {
    const mx = -4285, mz = 740, my = G(mx, mz), yaw = Math.atan2(800 - mx, 500 - mz);   // de cara al circuito
    flatRoofs.push({ x: mx, y: my - 1.2, z: mz, yaw, sx: 30, sy: 1.5, sz: 22, c: 0xd9cfb8 });
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let a = -14; a <= 14; a += 2) flatRoofs.push({ x: mx + a * c + 11 * s, y: my + 0.2, z: mz - a * s + 11 * c, yaw, sx: 2.05, sy: 0.9, sz: 0.5, c: 0xcfc3a6 });
    house(mx - 9 * c - 7 * s, mz + 9 * s - 7 * c, 7, 11, 1.4, yaw, 0xf8f6f0, 'gable', 0, 0.6, true);
    for (let k = 0; k < 6; k++) treeList.push({ x: mx + (k - 2.5) * 7 * c - 16 * s, z: mz - (k - 2.5) * 7 * s - 16 * c, kind: k % 2 ? 'cypress' : 'pine' });
    for (let k = 0; k < 9; k++) person(mx + (r() - 0.5) * 22 * c + (6 + r() * 4) * s, mz - (r() - 0.5) * 22 * s + (6 + r() * 4) * c, yaw + (r() - 0.5), my + 0.3);
  }

  // ============================================================== 8) banderas en el muelle, hotel y helipuerto
  {
    // banderas en mástiles a lo largo del muelle (como en Mónaco)
    {
      const poles = [], flags = [];
      for (let s = q0 + 10; s < q1 - 10; s += 13) { const [x, y, z] = at(s, world.barrier(s, 1) + 4.5); poles.push({ x, y: y - 0.3, z }); flags.push({ x, y: y - 0.3, z, s, k: Math.floor(r() * 8) }); }
      inst(scene, cylAt(0.05, 0.07, 7.5, 0, 3.75, 0, 5), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 0.6, roughness: 0.4 }), poles);
      const fp = [], fu = [], fi = []; let nv = 0;
      for (const f of flags) {
        const i = T.idx(f.s), tx = -T.tx[i], tz = -T.tz[i], w = 2.2, h = 1.4, top = f.y + 7.3, u0 = (f.k % 4) / 4, v0 = Math.floor(f.k / 4) / 2;
        fp.push(f.x, top, f.z, f.x + tx * w, top - 0.2, f.z + tz * w, f.x + tx * w, top - h - 0.2, f.z + tz * w, f.x, top - h, f.z);
        fu.push(u0, 1 - v0, u0 + 0.25, 1 - v0, u0 + 0.25, 1 - v0 - 0.5, u0, 1 - v0 - 0.5); fi.push(nv, nv + 2, nv + 1, nv, nv + 3, nv + 2); nv += 4;
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2)); g.setIndex(fi); g.computeVertexNormals();
      scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: flagAtlas(), side: THREE.DoubleSide, roughness: 0.8 })));
      poles.forEach((p) => world.addOccluder(p.x, p.z, 0.1, 0.1, 0, p.y, p.y + 7.5));
    }
    // gran hotel en el cabo del nordeste, escalonado hacia el mar, con piscina; helipuerto al lado
    for (let t = 0; t < 300; t++) {
      const x = 1150 + r() * 160, z = 60 + r() * 220;
      if (!onLand(x, z, 30, 20) || !fits(x, z, 30, 12)) continue;
      const yaw = Math.atan2(1, 0.15);   // de cara al este (al mar)
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      house(x, z, 16, 46, 5, yaw, 0xf6f2ea, 'flat', 0); house(x + fx * 14, z + fz * 14, 12, 40, 3, yaw, 0xf6f2ea, 'flat', 0);
      const px = x + fx * 28, pz = z + fz * 28, py = G(px, pz) + 0.3;
      pools.push({ x: px, y: py, z: pz, yaw, sx: 10, sy: 0.3, sz: 24 });
      flatRoofs.push({ x: px, y: py - 1.72, z: pz, yaw, sx: 16, sy: 1.7, sz: 34, c: 0xe9e1d0 });
      for (let k = 0; k < 8; k++) loungers.push({ x: px + fx * 6.2 + Math.cos(yaw) * (-14 + k * 4), y: py, z: pz + fz * 6.2 - Math.sin(yaw) * (-14 + k * 4), yaw: yaw + Math.PI / 2, sx: 0.75, sy: 0.35, sz: 1.9 });
      for (let k = 0; k < 5; k++) palmList.push({ x: px - fx * 7 + Math.cos(yaw) * (-16 + k * 8), z: pz - fz * 7 - Math.sin(yaw) * (-16 + k * 8), kind: 0 });
      // helipuerto
      for (let t2 = 0; t2 < 200; t2++) {
        const hx = x + (r() - 0.5) * 180, hz = z + (r() - 0.5) * 180;
        if (!onLand(hx, hz, 16, 10) || !fits(hx, hz, 16, 12)) continue;
        const [hc, hg] = canvas(256, 256); hg.fillStyle = '#3b4046'; hg.fillRect(0, 0, 256, 256); hg.strokeStyle = '#f2f2f2'; hg.lineWidth = 10; hg.beginPath(); hg.arc(128, 128, 100, 0, 7); hg.stroke(); hg.fillStyle = '#f2f2f2'; hg.font = 'bold 130px sans-serif'; hg.textAlign = 'center'; hg.fillText('H', 128, 175);
        const pad = new THREE.Mesh(new THREE.CircleGeometry(12, 32), new THREE.MeshStandardMaterial({ map: ctex(hc, false), roughness: 0.8 })); pad.rotation.x = -Math.PI / 2; pad.position.set(hx, G(hx, hz) + 0.25, hz); pad.receiveShadow = true; scene.add(pad);
        const hm = new THREE.MeshStandardMaterial({ color: 0xc62828, roughness: 0.4, metalness: 0.3 }), heli = new THREE.Group();
        const body = new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 10), hm); body.scale.set(1, 0.9, 1.8); body.position.y = 1.6; heli.add(body);
        const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, 6.5, 6), hm); tail.rotation.x = Math.PI / 2; tail.position.set(0, 1.9, -4.6); heli.add(tail);
        const rot = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.06, 0.3), new THREE.MeshStandardMaterial({ color: 0x222222 })); rot.position.y = 3.2; rot.rotation.y = 0.6; heli.add(rot);
        const sk = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 3.4), new THREE.MeshStandardMaterial({ color: 0x777777 })); sk.position.y = 0.1; heli.add(sk);
        heli.position.set(hx, G(hx, hz) + 0.3, hz); heli.rotation.y = r() * 6; heli.traverse((o) => { o.castShadow = true; }); scene.add(heli);
        ctx.claim(hx, hz, 14); break;
      }
      break;
    }
  }

  // ============================================================== 9) playas: sombrillas, hamacas, chiringuito, socorrista, bañistas y patines
  const swimmers = [];
  {
    const beachW = world.coastBeach;
    const parasols = [], beds = [], lying = [];
    const beach = (cx, cz, rx, rz) => {
      let n = 0;
      for (let x = cx - rx; x < cx + rx; x += 5.5) for (let z = cz - rz; z < cz + rz; z += 6) {
        const px = x + (r() - 0.5) * 1.5, pz = z + (r() - 0.5) * 1.5, s0 = sd(px, pz);
        if (beachW(px, pz) < 0.45) continue;
        if (s0 > 9 && s0 < 42 && G(px, pz) < 3.2 && beachW(px, pz) > 0.55 && fits(px, pz, 1.5, 3) && r() < 0.8) {
          const y = G(px, pz);
          parasols.push({ x: px, y, z: pz, c: PARASOL[Math.floor(r() * PARASOL.length)] }); n++;
          for (const o of [-1, 1]) { beds.push({ x: px + o * 0.9, y, z: pz + 1.0, yaw: 0, sx: 0.7, sy: 0.3, sz: 1.9 }); if (r() < 0.6) lying.push({ x: px + o * 0.9, y: y + 0.35, z: pz + 1.0, yaw: 0, tilt: Math.PI / 2, s: 0.95, c: SKINS[Math.floor(r() * SKINS.length)] }); }
        } else if (s0 > 0.5 && s0 < 9 && r() < 0.18) person(px, pz, r() * 6);
        else if (s0 < -1 && s0 > -30 && r() < 0.12) swimmers.push({ x: px, y: -0.95, z: pz, yaw: r() * 6, s: 0.95, c: SKINS[Math.floor(r() * SKINS.length)] });
      }
      // chiringuito, torre del socorrista, patines y boyas
      for (let t = 0; t < 200; t++) {
        const x = cx + (r() - 0.5) * rx, z = cz + (r() - 0.5) * rz;
        if (beachW(x, z) > 0.4 && sd(x, z) > 45 && sd(x, z) < 75 && fits(x, z, 7, 3)) { house(x, z, 12, 7, 1, 0, 0xc49a6c, 'gable', 1); break; }
      }
      for (let t = 0; t < 200; t++) {
        const x = cx + (r() - 0.5) * rx, z = cz + (r() - 0.5) * rz;
        if (beachW(x, z) > 0.5 && sd(x, z) > 4 && sd(x, z) < 10) {
          const y = G(x, z), lg = merged([{ g: boxAt(1.6, 0.15, 1.6, 0, 3.0, 0), c: lin(0xf2f2f2), tint: 0 }, ...[[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]].map(([a, b]) => ({ g: cylAt(0.06, 0.06, 3, a, 1.5, b, 4), c: lin(0xf2f2f2), tint: 0 })), { g: boxAt(0.8, 0.9, 0.05, 0, 4.2, 0), c: lin(0xd32f2f), tint: 0 }]);
          inst(scene, lg, tintMat({ roughness: 0.7 }), [{ x, y, z }]); person(x, z, 0, y + 3.1); break;
        }
      }
      const buoys = [];
      for (let k = 0; k < 40; k++) { const a = k / 40, x = cx - rx + a * 2 * rx, z0 = cz; let z = z0; for (let w = 0; w < 400 && sd(x, z) > -55; w += 4) z += Math.sign(cz - 500) * 4 || 4; buoys.push({ x, y: 0.1, z }); }
      inst(scene, new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff6d00, roughness: 0.5 }), buoys.filter((b) => sd(b.x, b.z) < -30));
      return n;
    };
    beach(80, 1010, 300, 110); beach(-700, -170, 280, 90); beach(-1700, 520, 400, 140);
    const umb = merged([{ g: new THREE.ConeGeometry(1.5, 0.45, 10, 1, true).translate(0, 2.3, 0) }, { g: cylAt(0.03, 0.03, 2.3, 0, 1.15, 0, 4), c: lin(0xdddddd), tint: 0 }]);
    chunked(scene, umb, tintMat({ roughness: 0.7, side: THREE.DoubleSide }), parasols, { cell: 300 });
    chunked(scene, boxAt(1, 1, 1, 0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.6 }), beds.concat(loungers), { cell: 300 });
    const lie = new THREE.CapsuleGeometry(0.2, 1.3, 2, 6); // tumbados: cápsula girada en inst (tilt)
    chunked(scene, lie, tintMat({ roughness: 0.8 }), lying, { cell: 300 });
    inst(scene, boxAt(1, 1, 1, 0, -0.5, 0), new THREE.MeshStandardMaterial({ color: 0x3fd0e6, roughness: 0.05, metalness: 0.1, emissive: 0x0a5560, emissiveIntensity: 0.4 }), pools);
  }

  // ============================================================== 10) vegetación: pinares, olivares, cipreses, matorral, pitas y palmeras
  // cada especie donde tendría sentido: pinares en manchas (más densos en la franja del acantilado y en las vaguadas, nunca en
  // lo empinado), olivares en bancales siguiendo la ladera con su tapia, cipreses en hileras junto a caminos, villas y la
  // ermita, encinas a lo largo de la carretera del paddock, limoneros y naranjos en los patios del pueblo (junto a las casas,
  // no dentro), palmeras en el paseo, las villas, el hotel y detrás de la playa, y matorral en manchas
  {
    const gr = world.terrainGrid;
    const pines = [], aleppo = [], olives = [], shrubs = [], agaves = [], cypress = [], oaks = [], citrus = [], palms = [];
    // casas en una rejilla: ningún árbol dentro de una (las del pueblo no reservan sitio: se colaban copas por las paredes)
    const hCell = 24, hGrid = new Map();
    for (const h of world.coastHouses || []) { const k = Math.floor(h.x / hCell) * 100003 + Math.floor(h.z / hCell); let l = hGrid.get(k); if (!l) hGrid.set(k, (l = [])); l.push(h); }
    const inHouse = (x, z, rad) => {
      const cx = Math.floor(x / hCell), cz = Math.floor(z / hCell);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const h of hGrid.get((cx + a) * 100003 + cz + b) || []) {
        const c = Math.cos(h.yaw), s = Math.sin(h.yaw), dx = x - h.x, dz = z - h.z, u = dx * c - dz * s, w = dx * s + dz * c;
        if (Math.abs(u) < h.w / 2 + rad && Math.abs(w) < h.d / 2 + rad) return true;
      }
      return false;
    };
    const slopeAt = (x, z) => Math.hypot(G(x + 3, z) - G(x - 3, z), G(x, z + 3) - G(x, z - 3)) / 6;
    const ok = (x, z, rad, trackM = 6, margin = 4) => onLand(x, z, rad, margin) && world.coastBeach(x, z) < 0.3 && fits(x, z, rad, trackM) && !inHouse(x, z, rad);
    const pineZone = (x, z) => Math.sin(x * 0.0047 + 1.3) * Math.cos(z * 0.0061 - 0.4) + 0.55 * Math.sin(x * 0.013 - z * 0.011 + 2.0) + 0.25 * Math.sin(x * 0.031 + z * 0.027);
    const clump = (x, z) => 0.5 + 0.5 * Math.sin(x * 0.043 + Math.sin(z * 0.021) * 2) * Math.sin(z * 0.039 - x * 0.012);
    const GREENS = [0x4a6e33, 0x557a3a, 0x43662f, 0x5e8240, 0x4d7236];
    // pinares: manchas; en la franja de 20-140 m de la costa (los pinos del acantilado) bastan manchas más flojas
    const nP = hi ? 8000 : 3500;
    for (let t = 0; t < nP * 6 && pines.length + aleppo.length < nP; t++) {
      const x = gr.x0 + r() * (gr.x1 - gr.x0), z = gr.z0 + r() * (gr.z1 - gr.z0), s0 = sd(x, z);
      const cliffBand = s0 > 20 && s0 < 140 ? 0.35 : 0;
      if (pineZone(x, z) + cliffBand < 0.5 || Math.hypot(x - HC[0], z - HC[1]) < 330) continue;
      const sl = slopeAt(x, z); if (sl > 0.75 || r() < sl) continue;                    // en lo empinado, ralo; en el cortado, nada
      if (!ok(x, z, 3.5, 6, 5)) continue;
      const y = G(x, z) - 0.3, c = GREENS[Math.floor(r() * GREENS.length)];
      if (r() < 0.62) pines.push({ x, y, z, yaw: r() * 6, s: 0.8 + r() * 0.5, c });
      else aleppo.push({ x, y, z, yaw: r() * 6, s: 0.75 + r() * 0.45, c: [0x4f6b38, 0x587542, 0x4a6534][Math.floor(r() * 3)] });
    }
    // olivares: parcelas en ladera suave, filas a lo largo de las curvas de nivel, tapia de piedra seca y, a veces, el cortijo
    const fieldWalls = [];
    for (let f = 0, t = 0; f < (hi ? 30 : 16) && t < 2500; t++) {
      const cx = gr.x0 + 400 + r() * (gr.x1 - gr.x0 - 800), cz = gr.z0 + 400 + r() * (gr.z1 - gr.z0 - 800);
      if (Math.hypot(cx - HC[0], cz - HC[1]) < 380 || slopeAt(cx, cz) > 0.22 || !ok(cx, cz, 40, 12, 20)) continue;
      // orientación: filas a lo largo de la curva de nivel (perpendiculares a la pendiente)
      const gx = G(cx + 6, cz) - G(cx - 6, cz), gz = G(cx, cz + 6) - G(cx, cz - 6), yaw = Math.hypot(gx, gz) > 0.3 ? Math.atan2(gx, gz) + Math.PI / 2 : r() * 3;
      const w = 70 + r() * 80, d = 50 + r() * 60, c = Math.cos(yaw), s = Math.sin(yaw), P = (a, b) => [cx + a * c + b * s, cz - a * s + b * c];
      let n = 0;
      for (let a = -w / 2 + 4; a < w / 2 - 3; a += 7) for (let b = -d / 2 + 4; b < d / 2 - 3; b += 7.5) {
        const [x, z] = P(a + (r() - 0.5) * 0.8, b + (r() - 0.5) * 0.8);
        if (r() < 0.06 || !ok(x, z, 2.5, 6, 4) || slopeAt(x, z) > 0.45) continue;
        olives.push({ x, y: G(x, z) - 0.15, z, yaw: r() * 6, s: 0.75 + r() * 0.45, c: [0x7d8a5c, 0x8a9468, 0x6f7d52, 0x84906a][Math.floor(r() * 4)] }); n++;
      }
      if (n < 12) continue;
      // tapia baja alrededor (tramos de 6 m que siguen el suelo)
      for (const [a0, b0, a1, b1] of [[-w / 2, -d / 2, w / 2, -d / 2], [w / 2, -d / 2, w / 2, d / 2], [w / 2, d / 2, -w / 2, d / 2], [-w / 2, d / 2, -w / 2, -d / 2]]) {
        const L = Math.hypot(a1 - a0, b1 - b0), nn = Math.ceil(L / 6), wy = Math.atan2((a1 - a0) * c + (b1 - b0) * s, -(a1 - a0) * s + (b1 - b0) * c);
        for (let k = 0; k < nn; k++) {
          if (k === Math.floor(nn / 2) && r() < 0.8) continue;                          // hueco de la entrada
          const [x, z] = P(a0 + (a1 - a0) * (k + 0.5) / nn, b0 + (b1 - b0) * (k + 0.5) / nn);
          if (!onLand(x, z, 1, 2) || !fits(x, z, 1, 4) || inHouse(x, z, 0.5)) continue;
          fieldWalls.push({ x, y: G(x, z) - 0.35, z, yaw: wy, sx: 0.7, sy: 1.25, sz: L / nn + 0.15, c: [0xcdbf9f, 0xc2b392, 0xd6caae][k % 3] });
        }
      }
      // cortijo en una esquina, con sus cipreses
      if (r() < 0.55) {
        const [hx, hz] = P(w / 2 + 12, -d / 2 + 6);
        if (ok(hx, hz, 9, 10, 8)) {
          house(hx, hz, 13, 8, 1, yaw, WHITE[Math.floor(r() * WHITE.length)], 'gable', 0);
          for (let k = 0; k < 3; k++) { const [tx, tz] = P(w / 2 + 22, -d / 2 + k * 4.5); if (ok(tx, tz, 1.4, 6, 3)) cypress.push({ x: tx, y: G(tx, tz) - 0.2, z: tz, s: 0.8 + r() * 0.3 }); }
        }
      }
      f++;
    }
    // matorral en manchas (más en las laderas y al borde de los pinares) y pitas en la franja del acantilado
    const nS = hi ? 12000 : 5000;
    for (let t = 0; t < nS * 4 && shrubs.length < nS; t++) {
      const x = gr.x0 + r() * (gr.x1 - gr.x0), z = gr.z0 + r() * (gr.z1 - gr.z0), s0 = sd(x, z);
      if (s0 < 4) continue;
      const k = 0.15 + 0.55 * clump(x, z) + 0.25 * Math.max(0, pineZone(x, z) + 0.2) + 0.4 * Math.min(1, slopeAt(x, z)); if (r() > k) continue;
      if (!fits(x, z, 1, 3) || inHouse(x, z, 0.8) || world.coastBeach(x, z) > 0.45) continue;
      shrubs.push({ x, y: G(x, z) - 0.25, z, yaw: r() * 6, s: 0.6 + r() * 1.0, c: [0x5a6b3a, 0x6d7445, 0x4c5d33, 0x7a7c4a, 0x8a8452][Math.floor(r() * 5)] });
      if (s0 < 50 && r() < 0.22) agaves.push({ x: x + 2, y: G(x + 2, z) - 0.1, z, yaw: r() * 6, s: 0.8 + r() * 0.6, c: 0x6f8f7a });
    }
    // pueblo: limoneros, naranjos y algún ciprés en los patios, pegados a una casa (a 1,5-3 m de una pared)
    const town = (world.coastHouses || []).filter((h) => Math.hypot(h.x - HC[0], h.z - HC[1]) < 335);
    for (const h of town) {
      if (r() > 0.42) continue;
      const side = Math.floor(r() * 4), c = Math.cos(h.yaw), s = Math.sin(h.yaw), along = (r() - 0.5) * 0.8;
      const [a, b] = side === 0 ? [h.w / 2 + 2.4, along * h.d] : side === 1 ? [-h.w / 2 - 2.4, along * h.d] : side === 2 ? [along * h.w, h.d / 2 + 2.4] : [along * h.w, -h.d / 2 - 2.4];
      const x = h.x + a * c + b * s, z = h.z - a * s + b * c;
      if (!onLand(x, z, 1.5, 3) || !fits(x, z, 1.4, 3) || inHouse(x, z, 1.2)) continue;
      const y = G(x, z) - 0.15, u = r();
      if (u < 0.25) cypress.push({ x, y, z, s: 0.6 + r() * 0.25 });
      else citrus.push({ x, y, z, yaw: r() * 6, s: 0.8 + r() * 0.35, c: [0x3f6f32, 0x4a7a3a, 0x3a6630][Math.floor(r() * 3)], fruit: u < 0.62 ? 0 : 1 });
    }
    // tierra firme, a los lados de la carretera de montaña: pinares, matorral y algún olivo (fuera de la malla no llega el
    // reparto de arriba y la ladera quedaba pelada)
    for (const pth of roadPaths.filter((p) => p.far)) for (let t = 0; t < (hi ? 2600 : 1100); t++) {
      const k = Math.floor(r() * (pth.pts.length - 1)), [ax, az] = pth.pts[k], [bx, bz] = pth.pts[k + 1], l = Math.hypot(bx - ax, bz - az) || 1;
      const off = (r() < 0.5 ? -1 : 1) * (9 + Math.pow(r(), 1.6) * 260), x = ax + (bz - az) / l * off, z = az - (bx - ax) / l * off;
      if (x > gr.x0 + 20 || !onLand(x, z, 3, 8) || !occFree(x, z, 2)) continue;
      const u = r(), y = G(x, z);
      if (u < 0.5 && pineZone(x * 0.7, z * 0.7) > -0.2) pines.push({ x, y: y - 0.3, z, yaw: r() * 6, s: 0.8 + r() * 0.45, c: GREENS[Math.floor(r() * GREENS.length)] });
      else if (u < 0.62) aleppo.push({ x, y: y - 0.3, z, yaw: r() * 6, s: 0.75 + r() * 0.4, c: 0x587542 });
      else if (u < 0.7) olives.push({ x, y: y - 0.15, z, yaw: r() * 6, s: 0.8 + r() * 0.4, c: 0x7d8a5c });
      else shrubs.push({ x, y: y - 0.25, z, yaw: r() * 6, s: 0.7 + r() * 1.0, c: [0x5a6b3a, 0x6d7445, 0x7a7c4a][Math.floor(r() * 3)] });
    }
    // en las afueras del pueblo, algún pino suelto entre las últimas casas
    for (let t = 0; t < (hi ? 900 : 400); t++) {
      const a = r() * 6.283, d = 250 + r() * 110, x = HC[0] + Math.cos(a) * d, z = HC[1] + Math.sin(a) * d;
      if (r() < 0.5 && ok(x, z, 3, 4, 5) && slopeAt(x, z) < 0.7) pines.push({ x, y: G(x, z) - 0.3, z, yaw: r() * 6, s: 0.7 + r() * 0.4, c: GREENS[Math.floor(r() * GREENS.length)] });
    }
    // árboles puestos a propósito: plaza, villas, ermita, carreteras
    for (const tr of treeList.concat(roadTrees)) {
      if (!onLand(tr.x, tr.z, 1, 2) || inHouse(tr.x, tr.z, 1.2) || (tr.road && !fits(tr.x, tr.z, 1.4, 4))) continue;   // (los de la plaza, villas y ermita están en sitio reservado)
      const y = G(tr.x, tr.z) - 0.2;
      if (tr.kind === 'cypress') cypress.push({ x: tr.x, y, z: tr.z, s: 0.85 + r() * 0.25 });
      else if (tr.kind === 'pine') { if (slopeAt(tr.x, tr.z) < 0.8) pines.push({ x: tr.x, y: y - 0.1, z: tr.z, yaw: r() * 6, s: 0.85 + r() * 0.3, c: GREENS[Math.floor(r() * GREENS.length)] }); }
      else oaks.push({ x: tr.x, y, z: tr.z, yaw: r() * 6, s: (tr.kind === 'plaza' ? 0.85 : 0.75) + r() * 0.3, c: [0x4a6a34, 0x52733a, 0x46632f][Math.floor(r() * 3)] });
    }
    // palmeras: paseo del puerto, villas, hotel, paddock y una fila detrás de cada playa
    for (let k = 0; k < 14; k++) { const s = T.pit.boxes[0].s - 40 + k * 32; const [x, , z] = at(s, -(world.barrier(s, -1) + 44)); palmList.push({ x, z, kind: 0 }); }
    for (const [bx, bz, rx] of [[80, 1010, 300], [-700, -170, 280], [-1700, 520, 400]]) for (let x = bx - rx; x < bx + rx; x += 22 + r() * 10) {
      let z = bz; const dir = bz > 400 ? -1 : 1;                                       // de la orilla hacia tierra hasta 46 m dentro
      for (let w = 0; w < 120 && sd(x, z) < 46; w++) z += dir * 2;
      if (world.coastBeach(x, z) > 0.2) palmList.push({ x, z, kind: r() < 0.5 ? 0 : 1 });
    }
    for (const p of palmList) { if (!onLand(p.x, p.z, 1, 1) || inHouse(p.x, p.z, 1) || !fits(p.x, p.z, 1, 3)) continue; palms.push({ x: p.x, y: G(p.x, p.z) - 0.2, z: p.z, yaw: r() * 6, s: (p.kind ? 0.65 : 0.85) + r() * 0.35, tilt: (r() - 0.5) * 0.14 }); }

    // ---- modelos: grumos de hojas (icosaedros deformados) con sombra por debajo y luz por arriba; troncos con ramas
    const BARK = lin(0x6b5340), BARK2 = lin(0x5a4636), OB = lin(0x7a6a58), PALMB = lin(0x8a7458);
    const blob = (sx, sy, sz, x, y, z, seed, det = 0) => {
      const g = new THREE.IcosahedronGeometry(1, det), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const k = 0.78 + 0.44 * hash(p.getX(i) * 12.9 + p.getY(i) * 78.2 + p.getZ(i) * 37.7 + seed); p.setXYZ(i, p.getX(i) * k * sx + x, p.getY(i) * k * sy + y, p.getZ(i) * k * sz + z); }
      g.computeVertexNormals(); return g;
    };
    // degradado de la copa: oscura abajo y por dentro, clara arriba
    const shade = (y0, y1, lo = 0.55, hiK = 1.12) => (x, y, z) => { const t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0))), k = lo + (hiK - lo) * t * t * (3 - 2 * t); return [k, k, k]; };
    const limb = (x0, y0, z0, x1, y1, z1, r0, r1, seg = 5) => {
      const L = Math.hypot(x1 - x0, y1 - y0, z1 - z0), g = new THREE.CylinderGeometry(r1, r0, L, seg); g.translate(0, L / 2, 0);
      const dir = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize(); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, dir)); g.translate(x0, y0, z0); return g;
    };
    // pino piñonero: tronco recio algo inclinado que se abre arriba en ramas cortas metidas en la copa; copa en cúpula ancha
    // y densa de fondo casi plano (con la horquilla a la vista y la copa en losa parecían acacias de sabana)
    const pineParts = [{ g: limb(0, -0.5, 0, 0.5, 7.0, 0.2, 0.5, 0.34, 7), c: BARK, tint: 0 }];
    for (let k = 0; k < 4; k++) { const a = k * 1.57 + 0.4; pineParts.push({ g: limb(0.5, 6.8, 0.2, 0.5 + Math.cos(a) * 1.7, 8.9, 0.2 + Math.sin(a) * 1.7, 0.26, 0.15, 6), c: BARK, tint: 0 }); }
    const pSh = shade(8.3, 12.2, 0.66, 1.2);
    pineParts.push({ g: blob(3.9, 1.7, 3.7, 0.5, 10.2, 0.2, 1, 1), c: pSh });
    for (let k = 0; k < 8; k++) { const a = k * 0.785 + 0.3, rr = 2.9 + (k % 2) * 0.7; pineParts.push({ g: blob(2.2, 1.15, 2.1, 0.5 + Math.cos(a) * rr, 9.7 + (k % 3) * 0.25, 0.2 + Math.sin(a) * rr, 3 + k), c: pSh }); }
    for (const [x, z, k] of [[1.6, -0.6, 11], [-0.7, 1.4, 12], [0.4, -1.7, 13], [-1.2, -0.9, 14]]) pineParts.push({ g: blob(1.8, 0.9, 1.7, x, 11.2, z, k), c: pSh });
    const pineG = merged(pineParts);
    // pino carrasco: tronco torcido y copa suelta e irregular, más alta y clara
    const alParts = [{ g: limb(0, -0.5, 0, -0.7, 4.6, 0.3, 0.36, 0.25, 6), c: BARK2, tint: 0 }, { g: limb(-0.7, 4.4, 0.3, 0.3, 8.0, -0.3, 0.24, 0.12, 5), c: BARK2, tint: 0 }, { g: limb(-0.6, 5.0, 0.3, -2.2, 7.0, 1.1, 0.16, 0.08, 5), c: BARK2, tint: 0 }];
    const aSh = shade(5.0, 10.5, 0.55, 1.1);
    for (const [x, y, z, sx, sy, k] of [[-2.0, 7.0, 1.0, 2.0, 1.3, 1], [0.6, 7.6, -0.8, 2.4, 1.5, 2], [-0.5, 9.0, 0.4, 2.0, 1.3, 3], [1.2, 9.4, 0.9, 1.4, 1.0, 4], [-1.0, 8.2, -1.4, 1.5, 1.1, 5]]) alParts.push({ g: blob(sx, sy, sx * 0.9, x, y, z, k + 20), c: aSh });
    const aleppoG = merged(alParts);
    // olivo: tronco corto retorcido que se parte en dos, copa redonda de varios grumos plateados
    const olParts = [{ g: limb(0, -0.3, 0, 0.25, 1.2, 0.1, 0.42, 0.32, 6), c: OB, tint: 0 }, { g: limb(0.25, 1.1, 0.1, -0.5, 2.3, 0.4, 0.24, 0.14, 5), c: OB, tint: 0 }, { g: limb(0.25, 1.1, 0.1, 0.9, 2.2, -0.4, 0.22, 0.13, 5), c: OB, tint: 0 }];
    const oSh = shade(1.6, 4.2, 0.62, 1.1);
    for (const [x, y, z, sx, sy, k] of [[0.1, 2.9, 0, 1.9, 1.15, 1], [-0.9, 2.6, 0.7, 1.35, 0.95, 2], [1.0, 2.6, -0.6, 1.4, 0.95, 3], [0.3, 3.5, 0.6, 1.2, 0.8, 4], [-0.4, 3.4, -0.7, 1.1, 0.8, 5]]) olParts.push({ g: blob(sx, sy, sx, x, y, z, k + 40), c: oSh });
    const oliveG = merged(olParts);
    // ciprés: huso alto y estrecho, con la superficie rugosa
    const cypG = (() => {
      const prof = [[0.01, 0.2], [0.55, 0.5], [0.95, 1.6], [1.08, 3.0], [1.02, 4.8], [0.86, 6.6], [0.62, 8.2], [0.36, 9.5], [0.12, 10.4], [0.01, 10.8]].map(([x, y]) => new THREE.Vector2(x, y));
      const g = new THREE.LatheGeometry(prof, 9), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), k = 0.82 + 0.3 * hash(Math.round(p.getY(i) * 3) * 7.1 + Math.round(Math.atan2(z, x) * 3) * 3.3); p.setX(i, x * k); p.setZ(i, z * k); }
      g.computeVertexNormals();
      return merged([{ g: cylAt(0.12, 0.16, 1.0, 0, 0.2, 0, 5), c: BARK, tint: 0 }, { g, c: (x, y) => { const t = y / 10.8, k = 0.62 + 0.5 * t; return [k * 0.18, k * 0.29, k * 0.17]; } }]);
    })();
    // encina (carreteras, plaza): tronco recto y copa redonda y densa
    const oakParts = [{ g: limb(0, -0.4, 0, 0.2, 3.4, 0.1, 0.34, 0.26, 6), c: BARK2, tint: 0 }];
    const kSh = shade(3.0, 8.0, 0.55, 1.1);
    for (const [x, y, z, sx, sy, k] of [[0.2, 5.6, 0.1, 2.9, 2.0, 1], [-1.6, 5.0, 0.8, 1.8, 1.4, 2], [1.7, 5.1, -0.7, 1.9, 1.4, 3], [0.6, 6.6, 1.2, 1.7, 1.3, 4], [-0.5, 6.7, -1.1, 1.6, 1.2, 5], [0.2, 4.4, -1.6, 1.6, 1.1, 6]]) oakParts.push({ g: blob(sx, sy, sx, x, y, z, k + 60), c: kSh });
    const oakG = merged(oakParts);
    // limonero / naranjo: copa redonda baja con frutos
    const citrusG = (fruitC) => {
      const parts = [{ g: limb(0, -0.2, 0, 0.05, 1.0, 0, 0.13, 0.1, 5), c: BARK, tint: 0 }, { g: blob(1.25, 1.05, 1.2, 0, 1.9, 0, 80, 1), c: shade(1.0, 2.9, 0.6, 1.1) }];
      for (let k = 0; k < 10; k++) { const a = k * 2.4, h = 1.4 + (k % 4) * 0.3, rr = 1.05 + 0.1 * (k % 3); parts.push({ g: new THREE.IcosahedronGeometry(0.12, 0).translate(Math.cos(a) * rr, h, Math.sin(a) * rr), c: fruitC, tint: 0 }); }
      return merged(parts);
    };
    const shrubG = merged([{ g: blob(1.2, 0.75, 1.1, 0, 0.45, 0, 90), c: shade(0, 1.1, 0.6, 1.1) }, { g: blob(0.85, 0.6, 0.8, 0.8, 0.35, 0.4, 91), c: shade(0, 1, 0.6, 1.1) }, { g: blob(0.7, 0.5, 0.7, -0.6, 0.3, -0.5, 92), c: shade(0, 0.9, 0.6, 1.1) }]);
    const agaveG = merged(Array.from({ length: 11 }, (_, k) => ({ g: new THREE.ConeGeometry(0.13, 1.5 - (k % 3) * 0.2, 3).translate(0, 0.7, 0).rotateZ(0.3 + (k % 3) * 0.22).rotateY(k * 0.57) })));
    // palmera: tronco curvo en anillos y hojas que caen
    const palmG = (() => {
      const parts = [];
      for (let k = 0; k < 8; k++) { const t0 = k / 8, t1 = (k + 1) / 8, bend = (t) => 0.9 * t * t; parts.push({ g: limb(bend(t0), t0 * 9, 0, bend(t1), t1 * 9 + 0.05, 0, 0.36 - 0.12 * t0, 0.36 - 0.12 * t1, 7), c: k % 2 ? PALMB : lin(0x7d6a50), tint: 0 }); }
      const pos = [];
      for (let k = 0; k < 16; k++) {
        const a = k / 16 * 6.283 + (k % 2) * 0.2, ca = Math.cos(a), sa = Math.sin(a), up = k % 2 ? 0.6 : -0.1, L = k % 2 ? 1 : 0.85;
        const pts = [[0, 0, 0.3], [2.0 * L, 0.9 + up, 0.65], [3.9 * L, 0.3 + up, 0.5], [5.0 * L, -1.3 + up, 0.12]];
        for (let j = 0; j < 3; j++) {
          const [d0, h0, w0] = pts[j], [d1, h1, w1] = pts[j + 1], cx = 0.9;
          const A = [cx + ca * d0 - sa * w0, 9 + h0, sa * d0 + ca * w0], B = [cx + ca * d0 + sa * w0, 9 + h0 - 0.15, sa * d0 - ca * w0], C = [cx + ca * d1 - sa * w1, 9 + h1, sa * d1 + ca * w1], D = [cx + ca * d1 + sa * w1, 9 + h1 - 0.15, sa * d1 - ca * w1];
          pos.push(...A, ...B, ...C, ...B, ...D, ...C);
        }
      }
      const fr = new THREE.BufferGeometry(); fr.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); fr.computeVertexNormals();
      parts.push({ g: fr, c: (x, y) => { const k = 0.7 + 0.08 * (y - 8); return [0.29 * k, 0.47 * k, 0.2 * k]; }, tint: 0 }, { g: new THREE.IcosahedronGeometry(0.55, 0).translate(0.9, 8.95, 0), c: lin(0x7a5a2a), tint: 0 });
      return merged(parts);
    })();
    const leafM = tintMat({ roughness: 0.92, flatShading: true });
    const trunkM = tintMat({ roughness: 0.95, flatShading: true, side: THREE.DoubleSide });
    chunked(scene, pineG, leafM, pines, { cell: 260, shadow: true });
    chunked(scene, aleppoG, leafM, aleppo, { cell: 260, shadow: true });
    chunked(scene, oliveG, leafM, olives, { cell: 260, shadow: true });
    chunked(scene, cypG, leafM, cypress.map((c) => ({ ...c, yaw: hash(c.z) * 6, sx: c.s, sy: c.s * (0.9 + hash(c.x) * 0.4), sz: c.s, c: 0xffffff })), { cell: 260, shadow: true });
    chunked(scene, oakG, leafM, oaks, { cell: 260, shadow: true });
    chunked(scene, citrusG(lin(0xf2c230)), leafM, citrus.filter((c) => !c.fruit), { cell: 260, shadow: true });
    chunked(scene, citrusG(lin(0xf08a1c)), leafM, citrus.filter((c) => c.fruit), { cell: 260, shadow: true });
    chunked(scene, shrubG, leafM, shrubs, { cell: 260 });
    chunked(scene, agaveG, leafM, agaves, { cell: 260 });
    chunked(scene, palmG, trunkM, palms, { cell: 260, shadow: true });
    chunked(scene, boxAt(1, 1, 1, 0, 0.5, 0), new THREE.MeshStandardMaterial({ map: stoneTex(), roughness: 0.95 }), fieldWalls, { cell: 260 });
  }

  // ============================================================== 11) público en las laderas de las curvas, bajo sombrillas
  {
    const umbrellas = [];
    const maxP = hi ? 9000 : 3500;
    const spots = [[0, -1], [2, -1], [2, 1], [3, 1], [8, 1], [8, -1], [10, -1], [12, 1], [13, -1], [14, -1], [15, 1], [16, -1]];
    for (const [ci, sgn] of spots) {
      const c = T.corners[ci]; if (!c) continue;
      const side = sgn * (-Math.sign(c.dir) || 1);
      const a0 = T.wrap(c.sIn - 70), len = T.ahead(a0, c.sOut) + 60;
      for (let a = 0; a < len; a += 1.0) {
        const s = T.wrap(a0 + a), B = world.barrier(s, side), i = T.idx(s);
        const fade = sstep(0, 25, a) * sstep(0, 25, len - a), clump = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(a * 0.08 + ci) * Math.sin(a * 0.029 + ci * 3));
        for (let dd = B + 1.6; dd < B + 26; dd += 1.1 + r() * 0.5) {
          if (people.length >= maxP || r() > 0.85 * fade * clump * (1 - (dd - B) / 30)) continue;
          const [x, , z] = at(s + (r() - 0.5) * 0.8, side * dd);
          if (!onLand(x, z, 1, 2) || !fits(x, z, 0.4, 0.9)) continue;
          const y = G(x, z), yaw = Math.atan2(-side * T.lx[i], -side * T.lz[i]) + (r() - 0.5) * 0.9;
          if (r() < 0.28) seated.push({ x, y, z, yaw, s: 0.95, c: SUMMER[Math.floor(r() * SUMMER.length)] });
          else { person(x, z, yaw, y); if (r() < 0.1) umbrellas.push({ x, y, z, c: PARASOL[Math.floor(r() * PARASOL.length)], s: 0.75 }); }
        }
      }
    }
    // gente en las azoteas del pueblo que dan a la pista
    for (const f of houseRoofs) if (r() < 0.18) { const q2 = world.nearest(f.x, f.z, 3); if (q2.i >= 0 && q2.d < 120) for (let k = 0; k < 2 + Math.floor(r() * 4); k++) person(f.x + (r() - 0.5) * f.sx * 0.6, f.z + (r() - 0.5) * f.sz * 0.6, Math.atan2(T.x[q2.i] - f.x, T.z[q2.i] - f.z), f.y + 0.4); }
    const umb = merged([{ g: new THREE.ConeGeometry(1.5, 0.45, 10, 1, true).translate(0, 2.3, 0) }, { g: cylAt(0.03, 0.03, 2.3, 0, 1.15, 0, 4), c: lin(0xdddddd), tint: 0 }]);
    chunked(scene, umb, tintMat({ roughness: 0.7, side: THREE.DoubleSide }), umbrellas, { cell: 300 });
  }

  // ============================================================== 12) rocas: escolleras y la orilla de los acantilados
  {
    const gr = world.terrainGrid;
    for (let t = 0; t < (hi ? 60000 : 25000); t++) {
      const x = gr.x0 + r() * (gr.x1 - gr.x0), z = gr.z0 + r() * (gr.z1 - gr.z0), s0 = sd(x, z);
      if (s0 > 4 || s0 < -6 || world.coastBeach(x, z) > 0.3 || world.coastHarbour(x, z)) continue;
      const gy = G(x, z); if (gy > 2.5) continue;                                         // al pie del acantilado, no colgadas
      rocks.push({ x, y: Math.max(-1.5, gy) + r() * 0.6, z, yaw: r() * 6, tilt: r() * 2, s: (1.2 + r() * 2.8) * (r() < 0.25 ? 2.2 : 1) });
    }
    const rg = new THREE.IcosahedronGeometry(1, 1), p = rg.attributes.position;
    for (let i = 0; i < p.count; i++) { const k = 0.75 + 0.5 * hash(p.getX(i) * 3.1 + p.getY(i) * 7.3 + p.getZ(i) * 1.7); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k); }
    rg.computeVertexNormals();
    chunked(scene, rg, new THREE.MeshStandardMaterial({ color: 0xb3a892, roughness: 0.95, flatShading: true }), rocks, { cell: 300 });
  }

  // ============================================================== 13) en el mar: veleros navegando, lanchas con estela, un ferry, motos de agua
  const movers = [];
  {
    const wakeTex = (() => { const [c, g] = canvas(64, 256); const gr2 = g.createLinearGradient(0, 0, 0, 256); gr2.addColorStop(0, 'rgba(255,255,255,0.9)'); gr2.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr2; g.beginPath(); g.moveTo(26, 0); g.lineTo(38, 0); g.lineTo(64, 256); g.lineTo(0, 256); g.fill(); return ctex(c, false); })();
    const wakeM = new THREE.MeshBasicMaterial({ map: wakeTex, transparent: true, depthWrite: false, opacity: 0.75, side: THREE.DoubleSide });
    const sailWhite = new THREE.MeshStandardMaterial({ color: 0xfbfbf8, roughness: 0.8, side: THREE.DoubleSide });
    const mk = (kind, path, speed, scale = 1, wake = 0) => {
      const g = new THREE.Group();
      const hull = new THREE.Mesh(BG[kind === 'yacht' ? 'motor' : kind === 'sail' ? 'sail' : 'fish'], boatMat); hull.castShadow = true; g.add(hull);
      if (kind === 'sail') { const sl = new THREE.Mesh(BG.sails, sailWhite); g.add(sl); }
      if (wake) { const w = new THREE.Mesh(new THREE.PlaneGeometry(wake * 0.35, wake), wakeM); w.rotation.x = Math.PI / 2; w.position.set(0, 0.06 / scale, -wake / 2 - 6); g.add(w); }
      g.scale.setScalar(scale); scene.add(g);
      movers.push({ g, path, w: speed / ((path[2] + path[3]) / 2), ph: r() * 6.283, heel: kind === 'sail' ? 0.14 : 0, bob: r() * 6 });
    };
    // trayectorias: elipses en el mar (cx, cz, rx, rz)
    const P1 = [[300, -760, 1100, 260], [2150, 450, 380, 900], [300, 1650, 1200, 320], [-1700, 1350, 500, 260], [-600, -900, 600, 200], [1700, -600, 500, 250]];
    // (velocidades en m/s)
    P1.forEach((p) => mk('sail', p, 3 + r() * 2.5, 1.1 + r() * 0.4));
    mk('yacht', [600, -480, 900, 160], 10, 1.4, 70); mk('yacht', [1900, 900, 350, 500], 12, 1.2, 60); mk('yacht', [-200, 1400, 800, 180], 9, 1.6, 80);
    mk('fish', [1600, 200, 300, 260], 4, 1.2, 25); mk('fish', [-1200, 1200, 260, 200], 4, 1.2, 25);
    mk('yacht', [80, 1110, 70, 35], 13, 0.22, 18); mk('yacht', [-700, -240, 80, 30], 12, 0.22, 18);   // motos de agua
    // ferry lejano: va y vuelve por el horizonte del sur
    const ferry = new THREE.Group();
    const fm = (w, h, d, x, y, z, c) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 })); m.position.set(x, y, z); ferry.add(m); };
    fm(22, 8, 110, 0, 1, 0, 0x1d3f72); fm(21, 12, 80, 0, 11, -8, 0xf4f4f4); fm(21.2, 1.4, 78, 0, 9, -8, 0x1f2a33); fm(21.2, 1.4, 78, 0, 13, -8, 0x1f2a33); fm(5, 7, 8, 0, 20, -20, 0xd32f2f);
    scene.add(ferry); movers.push({ g: ferry, path: [400, 3300, 4200, 160], w: 7 / 2180, ph: 1, heel: 0, bob: 0 });
  }

  // ============================================================== 14) gaviotas sobre el puerto y los acantilados
  const gulls = [];
  let gullBody = null, gullWing = null;
  {
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.25, -0.9, 0.35, -0.05, 0, 0, -0.2, 0, 0, 0.25, 0, 0, -0.2, 0.9, 0.35, -0.05], 3)); wg.computeVertexNormals();
    const bg = new THREE.CapsuleGeometry(0.1, 0.45, 2, 5).rotateX(Math.PI / 2);
    const centers = [[1150, 560, 22, 160], [1000, -260, 35, 300], [-900, 900, 40, 260], [100, 1080, 18, 200], [-400, -260, 30, 260]];
    for (let k = 0; k < 40; k++) { const c = centers[k % centers.length]; gulls.push({ cx: c[0] + (r() - 0.5) * 60, cz: c[1] + (r() - 0.5) * 60, h: c[2] + r() * 30, rad: c[3] * (0.4 + r() * 0.7), sp: (0.08 + r() * 0.08) * (r() < 0.5 ? 1 : -1), ph: r() * 6.283, fl: 6 + r() * 3 }); }
    gullBody = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8 }), gulls.length);
    gullWing = new THREE.InstancedMesh(wg, new THREE.MeshStandardMaterial({ color: 0xe8eaec, roughness: 0.8, side: THREE.DoubleSide }), gulls.length);
    gullBody.frustumCulled = gullWing.frustumCulled = false; gullBody.userData.noOcclude = gullWing.userData.noOcclude = true;
    scene.add(gullBody, gullWing);
  }

  // ============================================================== 15) a lo lejos: islas y los montes de tierra firme
  {
    const isl = (x, z, sx, sy, sz, seed) => {
      const g = new THREE.IcosahedronGeometry(1, 4), p = g.attributes.position, rr = rnd(seed), cols = [];
      const ph = [rr() * 6, rr() * 6, rr() * 6];
      for (let i = 0; i < p.count; i++) {
        let X = p.getX(i), Yv = p.getY(i), Z = p.getZ(i);
        const n = 1 + 0.18 * Math.sin(X * 5 + ph[0]) * Math.cos(Z * 4 + ph[1]) + 0.1 * Math.sin(X * 11 + Z * 9 + ph[2]);
        Yv = Yv < 0 ? Yv * 0.2 : Math.pow(Yv, 1.4) * n; p.setXYZ(i, X * n, Yv, Z * n);
        const c = new THREE.Color(Yv > 0.45 ? 0x6d7a4f : Yv > 0.08 ? 0x8a8a62 : 0xcfc6b0); cols.push(c.r, c.g, c.b);
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true })); m.scale.set(sx, sy, sz); m.position.set(x, -3, z); m.userData.noOcclude = true; scene.add(m);
    };
    isl(3800, -2600, 700, 140, 380, 3); isl(-2300, -4300, 1100, 210, 520, 7); isl(4200, 3500, 520, 95, 300, 11); isl(5200, 1200, 260, 55, 180, 13);
    // tierra firme: el terreno sigue hacia el oeste con la misma costa, en una malla más gruesa, hasta los montes
    const { x0, x1, z0, z1, nx, nz } = FAR;
    const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz); geo.rotateX(-Math.PI / 2); geo.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const p = geo.attributes.position, cols = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const y = farH(x, z);
      p.setY(i, y);
      const n1 = 0.5 + 0.28 * Math.sin(x * 0.006 + z * 0.0045 + Math.sin(z * 0.002) * 2) + 0.16 * Math.sin(x * 0.015 - z * 0.011), n2 = hash(Math.floor(x / 90) * 1.7 + Math.floor(z / 80) * 9.3);
      const base = y < 0.3 ? [0.62, 0.58, 0.44] : n1 > 0.62 ? [0.38, 0.42, 0.26] : n2 < 0.15 ? [0.62, 0.45, 0.3] : n1 < 0.3 ? [0.6, 0.54, 0.33] : [0.68, 0.6, 0.37];
      const rockK = Math.min(1, Math.max(0, (y - 180) / 120)), jit = 0.92 + 0.12 * hash(Math.floor(x / 37) * 3.1 + Math.floor(z / 41) * 7.7);
      for (let k = 0; k < 3; k++) cols[i * 3 + k] = Math.pow((base[k] * (1 - rockK) + [0.6, 0.57, 0.5][k] * rockK) * jit, 2.2) * 1.4;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3)); geo.computeVertexNormals();
    { const uv = geo.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 40, p.getZ(i) / 40); }
    const far = new THREE.Mesh(geo, world.mat.terrain); far.receiveShadow = false; far.userData.noOcclude = true; scene.add(far);
  }

  // casas, tejados y azoteas de todo el mapa (pueblo, villas, faro, ermita, chiringuitos): al final, cuando ya están todas
  scene.add(walls[0].mesh(facM[0]), walls[1].mesh(facM[1]));
  {
    const slab = new THREE.BoxGeometry(1, 1, 1); slab.translate(0, 0.5, 0);
    chunked(scene, slab, new THREE.MeshStandardMaterial({ roughness: 0.9 }), flatRoofs.concat(extras), { cell: 200, shadow: true });
    // azotea: losa con pretil alrededor (antes una losa lisa: de lejos las casas parecían cajas)
    const parapet = merged([{ g: boxAt(1, 0.4, 1, 0, 0.2, 0) }, { g: boxAt(1, 0.55, 0.04, 0, 0.67, 0.48) }, { g: boxAt(1, 0.55, 0.04, 0, 0.67, -0.48) }, { g: boxAt(0.04, 0.55, 1, 0.48, 0.67, 0) }, { g: boxAt(0.04, 0.55, 1, -0.48, 0.67, 0) },
      { g: boxAt(1.01, 0.08, 1.01, 0, 0.98, 0), c: [0.93, 0.92, 0.9] }]);
    chunked(scene, parapet, tintMat({ roughness: 0.9 }), houseRoofs, { cell: 200, shadow: true });
    // tejados de teja árabe: a cuatro aguas (pirámide recortada) y a dos aguas (prisma con los hastiales del color de la casa)
    const tileT = roofTileTex();
    const hip = new THREE.CylinderGeometry(0.18, 0.7071, 1, 4, 1); hip.rotateY(Math.PI / 4); hip.translate(0, 0.5, 0);
    { const uv = hip.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i)); }
    const roofM = new THREE.MeshStandardMaterial({ map: tileT, roughness: 0.75, flatShading: true });
    chunked(scene, hip, roofM, hipRoofs, { cell: 200, shadow: true });
    const rg = new THREE.BufferGeometry();
    // (cada faldón con sus vértices: u a lo largo de la cumbrera, v de alero a cumbrera)
    rg.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, -0.5, -0.5, 0, 0.5, 0, 1, 0.5, -0.5, 0, -0.5, 0, 1, 0.5, 0, 1, -0.5, 0.5, 0, 0.5, 0.5, 0, -0.5, 0, 1, -0.5, 0.5, 0, 0.5, 0, 1, -0.5, 0, 1, 0.5], 3));
    rg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 2, 1, 0, 0, 2, 1, 0, 1, 2, 0, 0, 0, 0, 1, 2, 0, 0, 1, 2, 1], 2)); rg.computeVertexNormals();
    chunked(scene, rg, new THREE.MeshStandardMaterial({ map: tileT, roughness: 0.75, flatShading: true, side: THREE.DoubleSide }), gableRoofs, { cell: 200, shadow: true });
    const ge = new THREE.BufferGeometry(); ge.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, -0.5, 0, 1, -0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5], 3)); ge.computeVertexNormals();
    chunked(scene, ge, new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide }), gableEnds, { cell: 200 });
    // balcones (losa, barandilla de hierro), chimeneas con su sombrerete
    const IRON = lin(0x24282c);
    chunked(scene, merged([{ g: boxAt(1, 0.14, 0.9, 0, 0, 0) }, { g: boxAt(1, 0.05, 0.05, 0, 0.95, 0.42), c: IRON, tint: 0 }, ...[-0.5, -0.25, 0, 0.25, 0.5].map((a) => ({ g: boxAt(0.03, 0.9, 0.03, a * 0.98, 0.5, 0.42), c: IRON, tint: 0 })),
      { g: boxAt(0.04, 0.05, 0.9, 0.49, 0.95, 0), c: IRON, tint: 0 }, { g: boxAt(0.04, 0.05, 0.9, -0.49, 0.95, 0), c: IRON, tint: 0 }]), tintMat({ roughness: 0.8 }), balconies, { cell: 200 });
    chunked(scene, merged([{ g: boxAt(0.7, 1.7, 0.7, 0, 0.85, 0) }, { g: boxAt(0.95, 0.12, 0.95, 0, 1.76, 0), c: lin(0x8a7a6a), tint: 0 }, { g: boxAt(0.3, 0.3, 0.3, 0, 1.97, 0), c: lin(0xb5562f), tint: 0 }]), tintMat({ roughness: 0.85 }), chimneys, { cell: 200 });
    chunked(scene, merged([{ g: boxAt(1, 0.06, 1.6, 0, 0, 0.8).rotateX(0.32) }, { g: boxAt(1, 0.32, 0.03, 0, -0.42, 1.5), c: lin(0xf5f2ea), tint: 0 }]), tintMat({ roughness: 0.8, side: THREE.DoubleSide }), awnings, { cell: 200 });
    inst(scene, cylAt(0.6, 0.6, 1.3, 0, 0.65, 0, 8), new THREE.MeshStandardMaterial({ color: 0xdedad2, roughness: 0.7 }), tanks);
    inst(scene, new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), bougain.map((b) => ({ ...b, sx: b.s, sy: b.s * 0.8, sz: b.s })));
  }
  crowd(scene, people.concat(swimmers), seated);

  const t0r = performance.now();
  return {
    update: (dt, camPos) => {
      for (const p of parts) p.update?.(dt, camPos);
      const t = (performance.now() - t0r) / 1000;
      for (const ro of rotors) ro.o.rotation[ro.ax] += dt * ro.sp;
      for (const m of movers) {
        const [cx, cz, rx, rz] = m.path, a = m.ph + t * m.w;
        const x = cx + Math.cos(a) * rx, z = cz + Math.sin(a) * rz, tx = -Math.sin(a) * rx, tz = Math.cos(a) * rz;
        m.g.position.set(x, 0.1 + Math.sin(t * 1.3 + m.bob) * 0.12, z);
        m.g.rotation.set(Math.sin(t * 0.9 + m.bob) * 0.02, Math.atan2(tx, tz), -m.heel);
      }
      if (gullBody) {
        gulls.forEach((g, k) => {
          const a = g.ph + t * g.sp, x = g.cx + Math.cos(a) * g.rad, z = g.cz + Math.sin(a) * g.rad, y = g.h + Math.sin(t * 0.3 + k) * 4;
          const yaw = Math.atan2(-Math.sin(a) * Math.sign(g.sp), Math.cos(a) * Math.sign(g.sp));
          q.setFromEuler(new THREE.Euler(0, yaw, Math.sign(g.sp) * 0.25, 'YXZ')); m4.compose(v.set(x, y, z), q, sc.set(1.4, 1.4, 1.4)); gullBody.setMatrixAt(k, m4);
          const f = Math.sin(t * g.fl + k); m4.compose(v.set(x, y, z), q, sc.set(1.4, 1.4 * f, 1.4)); gullWing.setMatrixAt(k, m4);
        });
        gullBody.instanceMatrix.needsUpdate = gullWing.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
