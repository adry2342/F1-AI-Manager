// Decorado de Val d'Ambre (bosque en otoño, nublado): lomas de las Ardenas cubiertas de hayas, robles, abedules y
// abetos; público de rally en los taludes de las curvas (valla naranja, banderas, paraguas, gente sentada y de pie),
// acampada entre los árboles (caravanas, tiendas, carpas) y un pueblo de piedra con tejados de pizarra.
// Todo instanciado o en geometrías juntas: son decenas de miles de piezas.
import * as THREE from 'three';
import { between } from './track.js';
import { fitTerrain } from './decor.js';

const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
const hash = (x) => { const s = Math.sin(x * 127.1) * 43758.5453; return s - Math.floor(s); };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// lista de transformaciones -> InstancedMesh
export function inst(scene, geo, mat, list, { shadow = false, colors = null } = {}) {
  if (!list.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, list.length);
  const col = new THREE.Color();
  list.forEach((p, k) => {
    q.setFromAxisAngle(Y, p.yaw || 0); if (p.tilt) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), p.tilt));
    m4.compose(v.set(p.x, p.y, p.z), q, sc.set(p.sx ?? p.s ?? 1, p.sy ?? p.s ?? 1, p.sz ?? p.s ?? 1)); im.setMatrixAt(k, m4);
    if (colors || p.c !== undefined) im.setColorAt(k, col.setHex(p.c ?? 0xffffff));
  });
  im.castShadow = shadow; im.receiveShadow = false; scene.add(im); return im;
}

// lo mismo, repartido en bloques por zona: cada bloque se descarta solo si queda fuera de cámara (o de la sombra).
// Con una sola malla de 30 000 árboles la GPU los dibujaba todos en cada fotograma: 31 FPS frente a 73 en Monte Alto
export function chunked(scene, geo, mat, list, { cell = 250, shadow = false } = {}) {
  const groups = new Map();
  for (const p of list) { const k = Math.floor(p.x / cell) * 4096 + Math.floor(p.z / cell); let g = groups.get(k); if (!g) groups.set(k, (g = [])); g.push(p); }
  for (const g of groups.values()) inst(scene, geo, mat, g, { shadow });
}

// varias piezas en una sola geometría (una sola llamada de dibujo por bloque): color por vértice y «tint» (1 = la pieza
// toma el color de la instancia: copa, ropa; 0 = color propio: tronco, piernas, cara)
export function merged(parts) {
  const pos = [], nor = [], col = [], tin = [];
  for (const { g, c = [1, 1, 1], tint = 1 } of parts) {
    const ng = g.index ? g.toNonIndexed() : g; if (!ng.attributes.normal) ng.computeVertexNormals();
    const P = ng.attributes.position, N = ng.attributes.normal;
    // (c puede ser una función de la posición: degradados, sombra bajo las copas)
    for (let i = 0; i < P.count; i++) { const cc = typeof c === 'function' ? c(P.getX(i), P.getY(i), P.getZ(i)) : c; pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); col.push(cc[0], cc[1], cc[2]); tin.push(tint); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('tint', new THREE.Float32BufferAttribute(tin, 1));
  return g;
}
export const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
export function tintMat(opts) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, ...opts });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float tint;').replace('#include <color_vertex>', `
      vColor = vec3(1.0);
      #ifdef USE_COLOR
        vColor *= color;
      #endif
      #ifdef USE_INSTANCING_COLOR
        vColor *= mix(vec3(1.0), instanceColor.rgb, tint);
      #endif`);
  };
  return m;
}

// textura de banderas: 8 diseños en una rejilla 4x2 (tricolores, bandas, cuadros, colores de equipo)
export function flagAtlas() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 192; const g = c.getContext('2d');
  const W = 128, H = 96;
  const designs = [
    (x, y) => { ['#111', '#f9d71c', '#e1251b'].forEach((k, i) => { g.fillStyle = k; g.fillRect(x + i * W / 3, y, W / 3 + 1, H); }); },   // negro-amarillo-rojo
    (x, y) => { ['#ae1c28', '#fff', '#21468b'].forEach((k, i) => { g.fillStyle = k; g.fillRect(x, y + i * H / 3, W, H / 3 + 1); }); },   // rojo-blanco-azul
    (x, y) => { ['#000', '#dd0000', '#ffce00'].forEach((k, i) => { g.fillStyle = k; g.fillRect(x, y + i * H / 3, W, H / 3 + 1); }); },
    (x, y) => { ['#ff8000', '#fff', '#ff8000'].forEach((k, i) => { g.fillStyle = k; g.fillRect(x, y + i * H / 3, W, H / 3 + 1); }); },
    (x, y) => { for (let a = 0; a < 8; a++) for (let b = 0; b < 6; b++) { g.fillStyle = (a + b) % 2 ? '#fff' : '#111'; g.fillRect(x + a * 16, y + b * 16, 16, 16); } },   // a cuadros
    (x, y) => { g.fillStyle = '#c8102e'; g.fillRect(x, y, W, H); g.fillStyle = '#fff'; g.font = 'bold 54px sans-serif'; g.textAlign = 'center'; g.fillText('GO!', x + W / 2, y + 68); },
    (x, y) => { g.fillStyle = '#0a2e6e'; g.fillRect(x, y, W, H); g.fillStyle = '#f5c400'; g.beginPath(); g.moveTo(x, y + H); g.lineTo(x + W, y); g.lineTo(x + W, y + 30); g.lineTo(x + 30, y + H); g.fill(); },
    (x, y) => { g.fillStyle = '#00a19b'; g.fillRect(x, y, W, H); g.fillStyle = '#111'; g.fillRect(x, y + 36, W, 24); },
  ];
  designs.forEach((d, i) => d((i % 4) * W, Math.floor(i / 4) * H));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// malla naranja de plástico (la valla del público)
function orangeNet() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64); g.strokeStyle = '#ff6a00'; g.lineWidth = 3;
  for (let i = 0; i <= 64; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.stroke(); }
  g.lineWidth = 6; for (let i = 0; i <= 64; i += 12) { g.beginPath(); g.moveTo(0, i); g.lineTo(64, i); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// copas de los árboles a lo lejos (manchas de hojas para las lomas que cierran el horizonte)
function canopyTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#7a6a58'; g.fillRect(0, 0, 256, 256);
  const cols = ['#c8a070', '#b07850', '#e0c088', '#8a7058', '#d0b080', '#6e6650', '#a89068'];
  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 3 + Math.random() * 7;
    g.fillStyle = cols[Math.floor(Math.random() * cols.length)];
    for (const [ox, oy] of [[0, 0], [256, 0], [-256, 0], [0, 256], [0, -256]]) { g.beginPath(); g.arc(x + ox, y + oy, r, 0, 7); g.fill(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

export function buildForest(ctx) {
  const { T, world, scene, r, quality } = ctx;
  const hi = quality !== 'low';
  const bb = world.bb, ccx = (bb.x0 + bb.x1) / 2, ccz = (bb.z0 + bb.z1) / 2;
  const nearest = world.nearest;
  const P = [0, 0, 0];
  const at = (s, d) => { T.pos(s, d, P); return [P[0], P[2]]; };
  const where = (x, z, n = nearest(x, z, 6)) => {
    if (n.i < 0) return null;
    const dx = x - T.x[n.i], dz = z - T.z[n.i];
    return { s: n.i * T.ds, i: n.i, d: n.d, side: dx * T.lx[n.i] + dz * T.lz[n.i] >= 0 ? 1 : -1 };
  };
  const pitA = T.wrap(T.pit.entryA - 120), pitB = T.wrap(T.pit.exitB + 120);

  // ------------------------------------------------------------ 1) taludes del público (por fuera y por dentro de las curvas)
  // como en Spa o en un rally: la gente de pie y sentada en la ladera, detrás de una valla naranja, entre árboles
  const banks = [];
  const bankFree = (s0, len, side) => {
    if (between(T, s0, pitA, pitB) || between(T, T.wrap(s0 + len), pitA, pitB)) return false;
    for (const st of world.stands || []) if (st.side === side && (T.ahead(st.s0 - 40, s0) < st.len + 80 || T.ahead(s0, st.s0) < len + 40)) return false;
    for (const b of banks) if (b.side === side && (T.ahead(b.s0 - 20, s0) < b.len + 30 || T.ahead(s0, b.s0) < len + 20)) return false;
    // sitio que hay por ese lado hasta que otro tramo de pista queda más cerca: el talud se hace a su medida
    let room = 110;
    for (let k = 0; k <= len; k += 12) {
      const s = T.wrap(s0 + k), B = world.barrier(s, side);
      for (let off = 10; off < room; off += 8) {
        const [x, z] = at(s, side * (B + off)); const w = where(x, z);
        if (w && Math.abs(T.rel(w.s, s)) > 50) { room = off - 8; break; }
      }
    }
    return room >= 32 ? room : 0;
  };
  for (const c of T.corners) {
    const out = -Math.sign(c.dir) || 1;
    const s0 = T.wrap(c.sIn - 70 - r() * 50), len = T.ahead(s0, c.sOut) + 40 + r() * 60;
    for (const side of [out, -out]) {
      if (side !== out && r() < 0.45) continue;                       // por dentro solo en algunas
      const room = bankFree(s0, len, side);
      if (room) banks.push({ s0, len, side, room, h: (6 + r() * 8) * Math.min(1, room / 80), crowd: 0.55 + r() * 0.45 });
    }
  }
  world.banks = banks;
  // altura extra del talud en (x, z): sube desde la valla hasta un rellano y vuelve a bajar hacia el bosque
  const bankAt = (x, z, n) => {
    const w = where(x, z, n); if (!w) return null;
    for (const b of banks) {
      if (b.side !== w.side || !between(T, w.s, b.s0, T.wrap(b.s0 + b.len))) continue;
      const a = T.ahead(b.s0, w.s), fade = sstep(0, 45, a) * sstep(0, 45, b.len - a);
      const B = world.barrier(w.s, w.side), dd = w.d - B;
      return { b, w, B, dd, fade };
    }
    return null;
  };
  const bankH = (x, z, n) => {
    const k = bankAt(x, z, n); if (!k) return 0;
    const R = k.b.room; if (k.dd > R + 8) return 0;
    return k.b.h * sstep(5, Math.min(34, R * 0.45), k.dd) * (1 - sstep(Math.min(70, R * 0.65), Math.min(125, R + 6), k.dd)) * k.fade;
  };
  const G = fitTerrain(ctx, bankH, 0.45);

  // ------------------------------------------------------------ 2) público en los taludes
  const people = [], umbrellas = [], seated = [], poles = [], flags = [];
  const shirts = [0xd32f2f, 0xfdd835, 0x1e88e5, 0xfafafa, 0x43a047, 0xfb8c00, 0x212121, 0x8e24aa, 0xff7043, 0x90caf9, 0xd81b60, 0x546e7a, 0x6d4c41, 0x26a69a, 0xc62828, 0xff8f00];
  const coats = [0x263238, 0x37474f, 0x1b5e20, 0x3e2723, 0x0d47a1, 0xb71c1c, 0xe65100, 0x4a148c, 0x212121, 0xf9a825];
  const skin = [0xf1c27d, 0xe0ac69, 0x8d5524, 0xc68642, 0xffdbac, 0xd9a066];
  const umbr = [0xe53935, 0x1e88e5, 0xfdd835, 0x212121, 0xffffff, 0x43a047, 0xff6f00, 0x8e24aa];
  const maxPeople = hi ? 14000 : 5000;
  const fenceSegs = [];
  for (const b of banks) {
    const cl = 0.4 + r() * 0.6;
    for (let a = 0; a < b.len; a += 0.95) {
      const s = T.wrap(b.s0 + a), i = T.idx(s), B = world.barrier(s, b.side);
      const fade = sstep(0, 30, a) * sstep(0, 30, b.len - a);
      // corrillos: la densidad sube y baja a lo largo de la ladera
      const clump = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(a * 0.07 + b.s0 * 0.01) * Math.sin(a * 0.023 + cl * 9));
      const dMax = Math.min(60, b.room * 0.62);
      for (let dd = 6.5; dd < dMax; dd += 1.05 + r() * 0.5) {
        const pr = b.crowd * clump * fade * (dd < dMax / 2 ? 0.92 : 0.92 * (1 - (dd - dMax / 2) / (dMax / 2 + 4)));
        if (r() > pr || people.length >= maxPeople) continue;
        const [x, z] = at(s + (r() - 0.5) * 0.8, b.side * (B + dd + (r() - 0.5) * 0.5));
        const y = G(x, z);
        const yaw = Math.atan2(-b.side * T.lx[i], -b.side * T.lz[i]) + (r() - 0.5) * 0.9;
        const sit = r() < 0.3, h = 0.88 + r() * 0.22;
        const c = r() < 0.55 ? coats[Math.floor(r() * coats.length)] : shirts[Math.floor(r() * shirts.length)];
        if (sit) seated.push({ x, y, z, yaw, s: h, c, sk: skin[Math.floor(r() * skin.length)] });
        else people.push({ x, y, z, yaw, s: h, c, sk: skin[Math.floor(r() * skin.length)] });
        if (!sit && r() < 0.13) umbrellas.push({ x, y: y + 1.95 * h, z, yaw, s: 0.9 + r() * 0.3, c: umbr[Math.floor(r() * umbr.length)] });
        if (!sit && r() < 0.018) { poles.push({ x, y, z, yaw }); flags.push({ x, y, z, i, side: b.side, d: Math.floor(r() * 8) }); }
      }
      if (Math.round(a / 0.95) % 3 === 0) fenceSegs.push({ s, side: b.side, d: B + 5.2 });
    }
  }
  // grupitos sueltos por todo el bosque, junto a la valla (como en los tramos de un rally)
  for (let s = 0; s < T.L; s += 22 + r() * 40) {
    if (between(T, s, pitA, pitB)) continue;
    const side = r() < 0.5 ? 1 : -1, B = world.barrier(s, side), i = T.idx(s);
    if (bankAt(...at(s, side * (B + 9)), nearest(...at(s, side * (B + 9)), 6))) continue;
    const n = 1 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const [x, z] = at(s + k * 1.1, side * (B + 8 + r() * 4)); const w = where(x, z);
      if (!w || Math.abs(T.rel(w.s, s)) > 30) continue;
      const yaw = Math.atan2(-side * T.lx[i], -side * T.lz[i]) + (r() - 0.5) * 0.8;
      people.push({ x, y: G(x, z), z, yaw, s: 0.9 + r() * 0.2, c: coats[Math.floor(r() * coats.length)], sk: skin[Math.floor(r() * skin.length)] });
    }
  }
  {
    // cada persona es una sola pieza: piernas oscuras, cuerpo con el color de su ropa, cara
    const body = new THREE.CapsuleGeometry(0.21, 0.82, 2, 6); body.translate(0, 0.63, 0);
    const legs = new THREE.CylinderGeometry(0.17, 0.14, 0.75, 5); legs.translate(0, 0.37, 0);
    const head = new THREE.IcosahedronGeometry(0.12, 0); head.translate(0, 1.27, 0);
    const sitB = new THREE.CapsuleGeometry(0.21, 0.42, 2, 6); sitB.translate(0, 0.43, 0);
    const sitH = new THREE.IcosahedronGeometry(0.12, 0); sitH.translate(0, 0.86, 0);
    const SK = lin(0xd9a066), LEG = lin(0x2a2f3a);
    const cloth = tintMat({ roughness: 0.9 });
    chunked(scene, merged([{ g: legs, c: LEG, tint: 0 }, { g: body }, { g: head, c: SK, tint: 0 }]), cloth, people);
    chunked(scene, merged([{ g: sitB }, { g: sitH, c: SK, tint: 0 }]), cloth, seated);
    // paraguas: copa (cono abierto) y mango
    const ug = new THREE.ConeGeometry(0.85, 0.32, 8, 1, true); ug.translate(0, 0.16, 0);
    const ush = new THREE.CylinderGeometry(0.015, 0.015, 0.9, 3); ush.translate(0, -0.3, 0);
    chunked(scene, merged([{ g: ug }, { g: ush, c: lin(0x222222), tint: 0 }]), tintMat({ roughness: 0.55, side: THREE.DoubleSide }), umbrellas);
    // mástiles y banderas (geometría junta con UV del atlas)
    const pg = new THREE.CylinderGeometry(0.03, 0.03, 3.6, 4); pg.translate(0, 1.8, 0);
    inst(scene, pg, new THREE.MeshStandardMaterial({ color: 0xcfd2d6, metalness: 0.6, roughness: 0.4 }), poles);
    const fp = [], fu = [], fi = []; let nv = 0;
    for (const f of flags) {
      const tx = T.tx[f.i], tz = T.tz[f.i], w = 1.5, h = 1.0, top = G(f.x, f.z) + 3.55;
      const u0 = (f.d % 4) / 4, v0 = Math.floor(f.d / 4) / 2;
      // ondea un poco: el borde libre más bajo y algo desplazado
      const sag = 0.18;
      fp.push(f.x, top, f.z, f.x + tx * w, top - sag, f.z + tz * w, f.x + tx * w, top - h - sag, f.z + tz * w, f.x, top - h, f.z);
      fu.push(u0, 1 - v0, u0 + 0.25, 1 - v0, u0 + 0.25, 1 - v0 - 0.5, u0, 1 - v0 - 0.5);
      fi.push(nv, nv + 2, nv + 1, nv, nv + 3, nv + 2); nv += 4;
    }
    if (nv) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2)); g.setIndex(fi); g.computeVertexNormals();
      scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: flagAtlas(), side: THREE.DoubleSide, roughness: 0.8 })));
    }
    // valla naranja al pie de cada talud
    const vp = [], vu = [], vi = []; let n2 = 0; const posts = [];
    for (const b of banks) {
      let prev = null, u = 0;
      for (let a = 4; a <= b.len - 4; a += 3) {
        const s = T.wrap(b.s0 + a), d = b.side * (world.barrier(s, b.side) + 5.2);
        const [x, z] = at(s, d), y = G(x, z);
        if (prev) {
          const L = Math.hypot(x - prev[0], z - prev[2]); u += L / 2;
          vp.push(prev[0], prev[1], prev[2], x, y, z, x, y + 1.15, z, prev[0], prev[1] + 1.15, prev[2]);
          vu.push(u - L / 2, 0, u, 0, u, 1, u - L / 2, 1); vi.push(n2, n2 + 1, n2 + 2, n2, n2 + 2, n2 + 3); n2 += 4;
        }
        prev = [x, y, z]; if (Math.round(a / 3) % 2 === 0) posts.push({ x, y, z });
      }
    }
    if (n2) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vp, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(vu, 2)); g.setIndex(vi); g.computeVertexNormals();
      scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: orangeNet(), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.8 })));
      const pst = new THREE.CylinderGeometry(0.035, 0.035, 1.25, 4); pst.translate(0, 0.62, 0);
      inst(scene, pst, new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 1 }), posts);
    }
  }

  // ------------------------------------------------------------ 3) acampada detrás de los taludes: caravanas, autocaravanas, tiendas, carpas, coches
  const camp = { van: [], tent: [], tarp: [], legs: [], car: [] };
  const occFree = (x, z, rad) => ctx.occ.every((o) => Math.hypot(o.x - x, o.z - z) > o.r + rad);
  const vanC = [0xf2efe8, 0xe8e2d4, 0xffffff, 0xd8d4c8, 0x9fb4c8, 0xc9b28a];
  const tentC = [0xff7043, 0x42a5f5, 0x66bb6a, 0xffca28, 0xab47bc, 0xef5350, 0x26c6da, 0x8d6e63, 0x546e7a];
  const carC = [0xd32f2f, 0x1976d2, 0xfafafa, 0x212121, 0x9e9e9e, 0x388e3c, 0x5d4037, 0x90a4ae, 0x0d47a1];
  for (const b of banks) {
    const n = 6 + Math.floor(r() * 12);
    for (let k = 0, tries = 0; k < n && tries < n * 8; tries++) {
      const a = r() * b.len, s = T.wrap(b.s0 + a), B = world.barrier(s, b.side), dd = 80 + r() * 70, i = T.idx(s);
      const [x, z] = at(s, b.side * (B + dd)); const w = where(x, z);
      if (w && Math.abs(T.rel(w.s, s)) > 60) continue;
      if (!occFree(x, z, 5) || !ctx.clearOfTrack(x, z, 5)) continue;
      const yaw = Math.atan2(T.tx[i], T.tz[i]) + (r() - 0.5) * 0.6, y = G(x, z), u = r();
      if (u < 0.35) camp.van.push({ x, y, z, yaw, sx: 2.3, sy: 2.6 + r() * 0.5, sz: 5.5 + r() * 2, c: vanC[Math.floor(r() * vanC.length)] });
      else if (u < 0.65) camp.tent.push({ x, y, z, yaw: r() * 6, sx: 1 + r() * 0.6, sy: 0.9 + r() * 0.4, sz: 1.1 + r() * 0.8, c: tentC[Math.floor(r() * tentC.length)] });
      else if (u < 0.82) {
        const c = tentC[Math.floor(r() * tentC.length)], w2 = 3 + r() * 2;
        camp.tarp.push({ x, y: y + 2.4, z, yaw, sx: w2, sy: 1, sz: w2, c });
        for (const [p1, p2] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const cy = Math.cos(yaw), sy = Math.sin(yaw), lx = p1 * w2 / 2 * 0.95, lz = p2 * w2 / 2 * 0.95;
          camp.legs.push({ x: x + lx * cy + lz * sy, y: y, z: z - lx * sy + lz * cy });
        }
      } else camp.car.push({ x, y, z, yaw, c: carC[Math.floor(r() * carC.length)] });
      ctx.claim(x, z, 4.5); k++;
    }
  }
  {
    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
    inst(scene, box, new THREE.MeshStandardMaterial({ roughness: 0.6 }), camp.van, { shadow: true });
    const tg = new THREE.ConeGeometry(1.5, 1.7, 4); tg.rotateY(Math.PI / 4); tg.translate(0, 0.85, 0);
    inst(scene, tg, new THREE.MeshStandardMaterial({ roughness: 0.85 }), camp.tent, { shadow: true });
    const roof = new THREE.ConeGeometry(0.72, 0.5, 4); roof.rotateY(Math.PI / 4); roof.translate(0, 0.25, 0);
    inst(scene, roof, new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide }), camp.tarp, { shadow: true });
    const leg = new THREE.CylinderGeometry(0.03, 0.03, 2.4, 3); leg.translate(0, 1.2, 0);
    inst(scene, leg, new THREE.MeshStandardMaterial({ color: 0xbfc4c8, metalness: 0.6 }), camp.legs);
    const carG = new THREE.BoxGeometry(1.8, 1.3, 4.3); carG.translate(0, 0.65, 0);
    inst(scene, carG, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.5 }), camp.car, { shadow: true });
  }

  // ------------------------------------------------------------ 4) pueblo de piedra con tejados de pizarra, iglesia y granjas sueltas
  const houses = [], roofs = [];
  const stoneC = [0xb8ad9c, 0xa69a88, 0xcfc6b6, 0x9c8f7d, 0xe4dfd4, 0x8f8576];
  const village = (cx, cz, n, spread) => {
    for (let k = 0, tries = 0; k < n && tries < n * 12; tries++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * spread, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const w = 7 + r() * 6, dp = 9 + r() * 7, h = 5 + r() * 4, yaw = Math.round(r() * 4) * Math.PI / 2 + (r() - 0.5) * 0.3;
      if (!occFree(x, z, Math.max(w, dp) * 0.6) || !ctx.clearOfTrack(x, z, Math.max(w, dp))) continue;
      const y = G(x, z) - 0.4;
      houses.push({ x, y, z, yaw, sx: w, sy: h, sz: dp, c: stoneC[Math.floor(r() * stoneC.length)] });
      roofs.push({ x, y: y + h, z, yaw, sx: w * 1.08, sy: 3.2 + r() * 1.5, sz: dp * 1.04, c: 0x34383e });
      ctx.claim(x, z, Math.max(w, dp) * 0.6); k++;
    }
  };
  {
    // el sitio más libre lejos de la pista para el pueblo
    let best = null, bd = 0;
    for (let t = 0; t < 300; t++) {
      const x = bb.x0 - 500 + r() * (bb.x1 - bb.x0 + 1000), z = bb.z0 - 500 + r() * (bb.z1 - bb.z0 + 1000);
      const d = world.trackDist(x, z);
      if (d > 230 && d < 700 && occFree(x, z, 160) && d > bd) { bd = d; best = [x, z]; }
    }
    if (best) {
      village(best[0], best[1], hi ? 45 : 25, 150);
      // iglesia: nave, torre y aguja
      const [x, z] = best, y = G(x, z) - 0.4, yaw = r() * 3;
      houses.push({ x, y, z, yaw, sx: 11, sy: 9, sz: 24, c: 0xa89c88 });
      roofs.push({ x, y: y + 9, z, yaw, sx: 12, sy: 6, sz: 25, c: 0x2c3036 });
      const cy = Math.cos(yaw), sy = Math.sin(yaw), tx = x + 13 * sy, tz = z + 13 * cy;
      houses.push({ x: tx, y, z: tz, yaw, sx: 6, sy: 20, sz: 6, c: 0x9c917f });
      roofs.push({ x: tx, y: y + 20, z: tz, yaw, sx: 6.2, sy: 14, sz: 6.2, c: 0x2c3036, spire: true });
    }
    // granjas sueltas
    for (let k = 0; k < (hi ? 14 : 7); k++) {
      const x = bb.x0 - 900 + r() * (bb.x1 - bb.x0 + 1800), z = bb.z0 - 900 + r() * (bb.z1 - bb.z0 + 1800);
      if (world.trackDist(x, z) > 200) village(x, z, 2 + Math.floor(r() * 3), 25);
    }
    const hb = new THREE.BoxGeometry(1, 1, 1); hb.translate(0, 0.5, 0);
    inst(scene, hb, new THREE.MeshStandardMaterial({ roughness: 0.95 }), houses, { shadow: true });
    // tejado a dos aguas: prisma triangular de 1x1x1 apoyado en la base
    const rg = new THREE.BufferGeometry();
    const rv = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5];
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rv, 3));
    rg.setIndex([0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4, 0, 1, 4, 0, 4, 3]);
    rg.computeVertexNormals();
    const roofM = new THREE.MeshStandardMaterial({ roughness: 0.7, flatShading: true, side: THREE.DoubleSide });
    inst(scene, rg, roofM, roofs.filter((p) => !p.spire), { shadow: true });
    const sp = new THREE.ConeGeometry(0.62, 1, 4); sp.rotateY(Math.PI / 4); sp.translate(0, 0.5, 0);
    inst(scene, sp, roofM, roofs.filter((p) => p.spire), { shadow: true });
  }

  // ------------------------------------------------------------ 5) bosque denso de otoño
  {
    // especies por manchas (rodales): el color cambia por zonas como en un bosque de verdad
    const species = (x, z) => {
      const a = Math.sin(x * 0.0061 + 1.3) * Math.cos(z * 0.0049 - 0.7) + 0.5 * Math.sin(x * 0.017 - z * 0.013);
      const b = Math.sin(x * 0.0043 - z * 0.0057 + 2.1);
      return a > 0.75 ? 'spruce' : a < -0.85 ? 'birch' : b > 0.35 ? 'beechRed' : b < -0.4 ? 'oak' : 'beech';
    };
    const PAL = {
      beech: [[0.065, 0.78, 0.30], [0.08, 0.8, 0.36], [0.05, 0.75, 0.27], [0.11, 0.72, 0.38], [0.2, 0.45, 0.24]],
      beechRed: [[0.015, 0.72, 0.27], [0.03, 0.78, 0.31], [0.0, 0.62, 0.22], [0.055, 0.8, 0.33]],
      oak: [[0.09, 0.55, 0.24], [0.07, 0.5, 0.2], [0.12, 0.5, 0.28], [0.22, 0.38, 0.2]],
      birch: [[0.13, 0.82, 0.45], [0.12, 0.78, 0.4], [0.15, 0.7, 0.42]],
    };
    const col = new THREE.Color();
    const pick = (sp, seed) => { const p = PAL[sp], c = p[Math.floor(seed * p.length) % p.length]; return col.setHSL(c[0] + (hash(seed * 7.7) - 0.5) * 0.02, c[1], c[2] * (0.85 + hash(seed * 3.3) * 0.3)).getHex(); };
    const dec = [], decFar = [], birch = [], spruce = [], spruceFar = [], bushes = [];
    const nT = hi ? 32000 : 11000;
    const x0 = bb.x0 - 1300, x1 = bb.x1 + 1300, z0 = bb.z0 - 1300, z1 = bb.z1 + 1300;
    const addTree = (x, z, seed) => {
      const sp = species(x + (seed - 0.5) * 60, z), y = G(x, z) - 0.3, s = 0.75 + hash(seed * 5.1) * 0.7, yaw = seed * 40;
      const far = world.trackDist(x, z) > 380;      // lejos: versión con menos polígonos y sin sombra
      if (sp === 'spruce') { (far ? spruceFar : spruce).push({ x, y, z, yaw, s: s * 1.1, sy: s * (1.1 + hash(seed * 2.3) * 0.5), c: col.setHSL(0.36, 0.42, 0.06 + hash(seed * 9.1) * 0.04).getHex() }); return; }
      if (sp === 'birch') { birch.push({ x, y, z, yaw, s, sy: s * 1.05, c: pick('birch', seed) }); return; }
      (far ? decFar : dec).push({ x, y, z, yaw, s, sy: s * (0.85 + hash(seed * 4.1) * 0.3), c: pick(sp, seed) });
    };
    const inBank = (x, z) => { const k = bankAt(x, z, nearest(x, z, 6)); return k && k.dd < Math.min(75, k.b.room) && k.fade > 0.2; };
    let tries = 0, n = 0;
    while (n < nT && tries < nT * 12) {
      tries++;
      const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
      const dT = world.trackDist(x, z);
      // más denso cerca de la pista (es lo que se ve); los claros, por manchas
      if (r() > (dT < 500 ? 1 : 0.4)) continue;
      if (Math.sin(x * 0.009 + 0.4) * Math.cos(z * 0.0077) > 0.82) continue;
      if (dT < 260 && !ctx.clearOfTrack(x, z, 3)) continue;
      if (!occFree(x, z, 3)) continue;
      if (dT < 200 && inBank(x, z) && r() < 0.88) continue;
      addTree(x, z, r()); n++;
    }
    // paredes de árboles a los lados de la pista donde no hay público: el bosque llega casi hasta la valla
    for (let s = 0; s < T.L; s += 6) {
      for (const side of [1, -1]) {
        for (const off of [15, 21, 28, 36, 45]) {
          const [x, z] = at(s + r() * 4, side * (world.barrier(s, side) + off + r() * 5));
          const w = where(x, z); if (!w || Math.abs(T.rel(w.s, s)) > 40) continue;
          if (!ctx.clearOfTrack(x, z, 2) || !occFree(x, z, 2) || inBank(x, z)) continue;
          addTree(x, z, r());
          if (r() < 0.5) bushes.push({ x: x + (r() - 0.5) * 6, y: G(x, z) - 0.2, z: z + (r() - 0.5) * 6, yaw: r() * 6, s: 0.6 + r() * 0.9, sy: 0.5 + r() * 0.5, c: pick(r() < 0.5 ? 'oak' : 'beech', r()) });
        }
      }
    }
    // sotobosque bajo los árboles cercanos
    for (let k = 0; k < (hi ? 9000 : 3000); k++) {
      const t = dec[Math.floor(r() * dec.length)]; if (!t) break;
      const x = t.x + (r() - 0.5) * 9, z = t.z + (r() - 0.5) * 9;
      if (world.trackDist(x, z) < 300 && !ctx.clearOfTrack(x, z, 1)) continue;
      bushes.push({ x, y: G(x, z) - 0.2, z, yaw: r() * 6, s: 0.5 + r() * 0.8, sy: 0.45 + r() * 0.5, c: pick(r() < 0.4 ? 'oak' : 'beech', r()) });
    }
    // cada árbol es una sola pieza (tronco con su color + copa con el de la instancia); lejos, versión simple
    const leaf = tintMat({ roughness: 0.92, flatShading: true }), BARK = lin(0x4a3d33), BIRCH = lin(0xd8d4cc);
    const cA = new THREE.IcosahedronGeometry(3.6, 1); cA.scale(1.15, 1, 1.15); cA.translate(0, 8.2, 0);
    const cB = new THREE.IcosahedronGeometry(2.5, 1); cB.translate(1.9, 10.2, 0.9);
    const tr = new THREE.CylinderGeometry(0.28, 0.48, 8, 5); tr.translate(0, 4, 0);
    chunked(scene, merged([{ g: tr, c: BARK, tint: 0 }, { g: cA }, { g: cB, c: [0.8, 0.76, 0.72] }]), leaf, dec, { shadow: true });
    const cF = new THREE.IcosahedronGeometry(3.9, 0); cF.scale(1.15, 1.05, 1.15); cF.translate(0, 8.6, 0);
    const trF = new THREE.CylinderGeometry(0.3, 0.45, 8, 3); trF.translate(0, 4, 0);
    chunked(scene, merged([{ g: trF, c: BARK, tint: 0 }, { g: cF }]), leaf, decFar, { cell: 600 });
    const bt = new THREE.CylinderGeometry(0.16, 0.24, 11, 5); bt.translate(0, 5.5, 0);
    const bc = new THREE.SphereGeometry(2.1, 6, 5); bc.scale(1, 2.0, 1); bc.translate(0, 10, 0);
    chunked(scene, merged([{ g: bt, c: BIRCH, tint: 0 }, { g: bc }]), leaf, birch, { shadow: true });
    // abeto: tres pisos de cono (lejos, dos)
    const sg = [new THREE.ConeGeometry(3.0, 6, 7), new THREE.ConeGeometry(2.3, 5, 7), new THREE.ConeGeometry(1.5, 4.5, 7)];
    sg[0].translate(0, 5, 0); sg[1].translate(0, 8.5, 0); sg[2].translate(0, 11.8, 0);
    const st = new THREE.CylinderGeometry(0.22, 0.38, 6, 5); st.translate(0, 3, 0);
    chunked(scene, merged([{ g: st, c: BARK, tint: 0 }, ...sg.map((g) => ({ g }))]), leaf, spruce, { shadow: true });
    const sgF = [new THREE.ConeGeometry(3.0, 8, 5), new THREE.ConeGeometry(1.9, 6, 5)]; sgF[0].translate(0, 6, 0); sgF[1].translate(0, 10.5, 0);
    chunked(scene, merged(sgF.map((g) => ({ g }))), leaf, spruceFar, { cell: 600 });
    const bg = new THREE.IcosahedronGeometry(1.4, 0); bg.translate(0, 0.7, 0);
    chunked(scene, bg, new THREE.MeshStandardMaterial({ roughness: 0.92, flatShading: true }), bushes);
    // hojas caídas en el arcén de hierba: motas sueltas sobre el suelo junto a la pista
    const lv = [];
    for (let s = 0; s < T.L; s += 1.6) for (const side of [1, -1]) {
      if (r() < 0.35) continue;
      const B = world.barrier(s, side), [x, z] = at(s, side * (B + 0.5 + r() * 9));
      lv.push({ x, y: G(x, z) + 0.06, z, yaw: r() * 6, s: 0.6 + r() * 1.4, c: pick(r() < 0.5 ? 'beech' : 'beechRed', r()) });
    }
    const lg = new THREE.CircleGeometry(0.6, 5); lg.rotateX(-Math.PI / 2);
    chunked(scene, lg, new THREE.MeshStandardMaterial({ roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }), lv);
  }

  // ------------------------------------------------------------ 6) lomas del horizonte cubiertas de bosque (más allá del terreno)
  {
    const rings = 16, sectors = 180, rMin = 1500, rMax = 7500;
    const pos = [], uvs = [], cols = [], idx = [];
    const ridge = (ang, d) => {
      const a = 0.5 + 0.5 * Math.sin(ang * 4 + 0.6), b = 0.5 + 0.5 * Math.sin(ang * 9 - 1.4), c = 0.5 + 0.5 * Math.cos(ang * 17 + 0.3);
      const t = sstep(rMin, rMin + 1800, d);
      return t * (90 + 200 * a * a + 70 * b + 25 * c) + (d > 4500 ? (d - 4500) * 0.04 : 0);
    };
    const fall = [[0.55, 0.3, 0.14], [0.62, 0.42, 0.18], [0.45, 0.22, 0.12], [0.3, 0.32, 0.18], [0.5, 0.38, 0.22]];
    const HAZE = lin(0x8e969d);
    for (let j = 0; j <= rings; j++) {
      const d = rMin + (rMax - rMin) * Math.pow(j / rings, 1.4);
      for (let i = 0; i <= sectors; i++) {
        const ang = (i / sectors) * Math.PI * 2, x = ccx + Math.cos(ang) * d, z = ccz + Math.sin(ang) * d;
        const inside = x > bb.x0 - 1350 && x < bb.x1 + 1350 && z > bb.z0 - 1350 && z < bb.z1 + 1350;
        const base = world.hills(x, z) + 2;
        const y = inside ? base - 6 : Math.min(base, 260) + ridge(ang, d) * 0.6;
        pos.push(x, y, z); uvs.push(x / 90, z / 90);
        // bruma propia (sin la niebla de la escena, que las dejaba en siluetas grises lisas): más azulada cuanto más lejos
        const f = fall[Math.floor(hash(i * 3.1 + j * 7.3) * fall.length)];
        const k = 0.75 + 0.25 * hash(i * 1.7 + j * 2.9), hz = 0.25 + 0.5 * sstep(rMin, rMax, d);
        for (let c = 0; c < 3; c++) cols.push(Math.pow(f[c] * k, 2.2) * 2.6 * (1 - hz) + HAZE[c] * 1.5 * hz);
      }
    }
    for (let j = 0; j < rings; j++) for (let i = 0; i < sectors; i++) {
      const a = j * (sectors + 1) + i, b = a + sectors + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); g.setIndex(idx); g.computeVertexNormals();
    // sin luz (color ya decidido): con luz salían negras, las normales de la malla miran hacia abajo
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: canopyTex(), vertexColors: true, fog: false, side: THREE.DoubleSide }));
    m.userData.noOcclude = true; scene.add(m);

    // árboles en las lomas: copas muy simples, sin luz y con la misma bruma, en rodales; la altura se interpola de la
    // propia malla (con la fórmula quedaban flotando: la rejilla es gruesa)
    const ringY = (x, z) => {
      const dx = x - ccx, dz = z - ccz, d = Math.hypot(dx, dz);
      let ang = Math.atan2(dz, dx); if (ang < 0) ang += Math.PI * 2;
      const jf = rings * Math.pow(Math.min(1, Math.max(0, (d - rMin) / (rMax - rMin))), 1 / 1.4), fi = (ang / (Math.PI * 2)) * sectors;
      const j = Math.min(rings - 1, Math.floor(jf)), i = Math.min(sectors - 1, Math.floor(fi)), u = fi - i, w = jf - j;
      const Yv = (jj, ii) => pos[(jj * (sectors + 1) + ii) * 3 + 1];
      return (Yv(j, i) * (1 - u) + Yv(j, i + 1) * u) * (1 - w) + (Yv(j + 1, i) * (1 - u) + Yv(j + 1, i + 1) * u) * w;
    };
    const shade = (geo) => { const P = geo.attributes.position, c = []; geo.computeBoundingBox(); const b = geo.boundingBox;
      for (let k = 0; k < P.count; k++) { const v = 0.55 + 0.45 * (P.getY(k) - b.min.y) / (b.max.y - b.min.y); c.push(v, v, v); }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); return geo; };
    const blob = new THREE.IcosahedronGeometry(1, 0); blob.scale(1, 0.85, 1); blob.translate(0, 0.6, 0);
    const cone = new THREE.ConeGeometry(0.75, 2.4, 5); cone.translate(0, 1.0, 0);
    const far = { blob: [], cone: [] };
    const nC = hi ? 4200 : 1500, col = new THREE.Color();
    for (let c = 0, tries = 0; c < nC && tries < nC * 6; tries++) {
      const ang = r() * Math.PI * 2, d = 2000 + Math.pow(r(), 1.3) * 3600;
      const cx = ccx + Math.cos(ang) * d, cz = ccz + Math.sin(ang) * d;
      if (cx > bb.x0 - 1250 && cx < bb.x1 + 1250 && cz > bb.z0 - 1250 && cz < bb.z1 + 1250) continue;
      c++;
      const spruceStand = r() < 0.22, n = 5 + Math.floor(r() * 9), hz = 0.25 + 0.5 * sstep(rMin, rMax, d);
      for (let k = 0; k < n; k++) {
        const x = cx + (r() - 0.5) * 90, z = cz + (r() - 0.5) * 90, s = (d < 3200 ? 7 : 10) * (0.8 + r() * 0.6);
        const f = spruceStand ? [0.16, 0.24, 0.16] : fall[Math.floor(r() * fall.length)], kk = 0.7 + r() * 0.35;
        col.setRGB(Math.pow(f[0] * kk, 2.2) * 2.6 * (1 - hz) + HAZE[0] * 1.5 * hz, Math.pow(f[1] * kk, 2.2) * 2.6 * (1 - hz) + HAZE[1] * 1.5 * hz, Math.pow(f[2] * kk, 2.2) * 2.6 * (1 - hz) + HAZE[2] * 1.5 * hz, THREE.LinearSRGBColorSpace);
        (spruceStand ? far.cone : far.blob).push({ x, y: ringY(x, z) - 1.5, z, yaw: r() * 6, s, c: col.getHex() });
      }
    }
    const farM = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
    for (const [geo, list] of [[shade(blob), far.blob], [shade(cone), far.cone]]) {
      chunked(scene, geo, farM, list, { cell: 1500 });
    }
  }
}
