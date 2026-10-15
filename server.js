// F1 AI Manager · servidor local y de multijugador (sin dependencias: solo Node).
// - Sirve el juego en http://localhost:8765/ y lo abre en el navegador.
// - /ws: sala multijugador. El primero que «crea partida» es el anfitrión; el servidor solo reenvía mensajes:
//   lo que manda el anfitrión va a los invitados y lo que manda cada invitado va al anfitrión.
// - /tunnel: partida por Internet sin abrir puertos. Arranca un túnel gratuito de Cloudflare (cloudflared, se descarga
//   solo la primera vez) que da un enlace https://….trycloudflare.com para los amigos.
// Uso: node server.js [puerto]  (o el ejecutable F1-AI-Manager)  ·  --no-open para no abrir el navegador
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { exec, spawn } = require('child_process');

let isSea = false;
try { isSea = require('node:sea').isSea(); } catch { /* node sin SEA */ }
// carpeta del juego: junto al ejecutable (o junto a este archivo)
const ROOT = (() => {
  const cands = [isSea ? path.dirname(process.execPath) : __dirname, process.cwd(), path.join(path.dirname(process.execPath), '..')];
  return cands.find((d) => fs.existsSync(path.join(d, 'index.html')) && fs.existsSync(path.join(d, 'js', 'main.js'))) || cands[0];
})();
const args = process.argv.slice(isSea ? 1 : 2);
const PORT = +(args.find((a) => /^\d+$/.test(a)) || process.env.PORT || 8765);
const OPEN = !args.includes('--no-open');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.ico': 'image/x-icon' };

function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) if ((n.family === 'IPv4' || n.family === 4) && !n.internal) out.push(n.address);
  // primero las de casa (192.168.x, 10.x); las de adaptadores virtuales (WSL, Docker: 172.x) al final
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('100.') ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b));
}
// ¿la petición viene de este mismo ordenador? (lo que llega por el túnel trae cabeceras de Cloudflare)
const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['cf-connecting-ip'];

const json = (res, o) => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/info') { json(res, { ips: lanIPs(), port: PORT, host: !!room.host }); return; }
  if (url.pathname === '/tunnel') {
    if (req.method === 'POST') { if (!isLocal(req)) { res.writeHead(403); res.end(); return; } startTunnel(); }
    json(res, { state: tunnel.state, url: tunnel.url, err: tunnel.err, got: tunnel.got, size: tunnel.size });
    return;
  }
  let p; try { p = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
  if (p.endsWith('/')) p += 'index.html';
  // solo lo que necesita el juego: nada de .git, tools, etc. (con el túnel esto se ve desde Internet)
  if (!/^\/(index\.html|favicon\.ico|js\/[\w.-]+\.js|vendor\/[\w./-]+)$/.test(p) || p.includes('..')) { res.writeHead(404); res.end(); return; }
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('No encontrado'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

// ------------------------------------------------------------------ WebSocket mínimo (RFC 6455)
function frame(op, data) {
  const n = data.length;
  let head;
  if (n < 126) head = Buffer.from([0x80 | op, n]);
  else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([head, data]);
}
function wsAccept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return null; }
  const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
  socket.setNoDelay(true);
  const ws = { socket, open: true, chunks: [], have: 0, frags: [], fragOp: 1, onmessage: null, onbinary: null, onclose: null };
  ws.send = (text) => { if (ws.open) socket.write(frame(0x1, Buffer.from(text, 'utf8'))); };
  ws.sendBin = (buf) => { if (ws.open) socket.write(frame(0x2, buf)); };
  ws.ping = () => { if (ws.open) socket.write(Buffer.from([0x89, 0])); };
  const close = () => { if (!ws.open) return; ws.open = false; try { socket.end(Buffer.from([0x88, 0])); } catch { /* */ } socket.destroy(); ws.onclose?.(); };
  ws.close = close;
  ws.seen = Date.now();
  socket.on('data', (chunk) => {
    ws.seen = Date.now();
    ws.chunks.push(chunk); ws.have += chunk.length;
    for (;;) {
      if (ws.have < 2) return;
      if (ws.chunks.length > 1) ws.chunks = [Buffer.concat(ws.chunks)];
      const b = ws.chunks[0];
      const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > 64 * 1024 * 1024) { close(); return; }
      const mOff = off; if (masked) off += 4;
      if (b.length < off + len) return;
      let payload = b.subarray(off, off + len);
      if (masked) { const mask = b.subarray(mOff, mOff + 4); payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]; }
      const rest = b.subarray(off + len); ws.chunks = rest.length ? [rest] : []; ws.have = rest.length;
      if (op === 0x8) { close(); return; }
      if (op === 0x9) { socket.write(frame(0xa, payload)); continue; }
      if (op === 0xa) continue;
      if (op === 0x1 || op === 0x2) ws.fragOp = op;
      ws.frags.push(payload);
      if (fin) {
        const msg = Buffer.concat(ws.frags); ws.frags = [];
        if (ws.fragOp === 0x2) ws.onbinary?.(msg); else ws.onmessage?.(msg.toString('utf8'));
      }
    }
  });
  socket.on('close', close);
  socket.on('error', close);
  return ws;
}

// ------------------------------------------------------------------ sala: un anfitrión y sus invitados
const room = { host: null, guests: new Map(), nextId: 1 };
const sendJSON = (ws, o) => { try { ws.send(JSON.stringify(o)); } catch { /* */ } };
// mantener vivas las conexiones (los túneles y algunos routers cortan las que no mueven nada)
// y cerrar las muertas (sin respuesta en 50 s: se ha ido el wifi, se ha colgado...) para que el anfitrión lo sepa
setInterval(() => {
  for (const ws of [room.host, ...room.guests.values()]) {
    if (!ws) continue;
    if (Date.now() - ws.seen > 50000) ws.close(); else ws.ping();
  }
}, 15000);

server.on('upgrade', (req, socket) => {
  if (!req.url.startsWith('/ws')) { socket.destroy(); return; }
  const ws = wsAccept(req, socket); if (!ws) return;
  let role = null, id = null;
  const from = req.headers['cf-connecting-ip'] ? `${req.headers['cf-connecting-ip']} por Internet` : req.socket.remoteAddress;
  ws.onmessage = (text) => {
    let m; try { m = JSON.parse(text); } catch { return; }
    if (!role) {
      if (m.t !== 'hello') return;
      const name = String(m.name || 'Jugador').slice(0, 20);
      if (m.role === 'host') {
        if (room.host && room.host.open) { sendJSON(ws, { t: 'error', msg: 'Ya hay una partida creada en este servidor. Únete a ella.' }); ws.close(); return; }
        role = 'host'; id = 0; room.host = ws;
        sendJSON(ws, { t: 'welcome', id: 0 });
        log(`${name} ha creado la partida`);
      } else {
        if (!room.host || !room.host.open) { sendJSON(ws, { t: 'error', msg: 'No hay ninguna partida creada en esa dirección todavía.' }); ws.close(); return; }
        role = 'guest'; id = room.nextId++; ws.name = name; room.guests.set(id, ws);
        sendJSON(ws, { t: 'welcome', id });
        sendJSON(room.host, { t: 'join', id, name });
        log(`${name} se ha unido (${from})`);
      }
      return;
    }
    if (role === 'host') {
      if (m.t !== 'send') return;
      const out = JSON.stringify(m.m);
      if (m.to == null) { for (const g of room.guests.values()) if (g.open) g.send(out); }
      else { const g = room.guests.get(m.to); if (g?.open) g.send(out); }
    } else if (room.host?.open) {
      sendJSON(room.host, { t: 'from', id, m });
    }
  };
  // binario (copias del estado de la partida): del anfitrión, con el destinatario en los 4 primeros bytes
  ws.onbinary = (buf) => {
    if (role !== 'host' || buf.length < 4) return;
    const to = buf.readUInt32BE(0), data = buf.subarray(4);
    if (to === 0xffffffff) { for (const g of room.guests.values()) g.sendBin(data); }
    else room.guests.get(to)?.sendBin(data);
  };
  ws.onclose = () => {
    if (role === 'host' && room.host === ws) {
      room.host = null;
      const gs = [...room.guests.values()]; room.guests.clear();
      for (const g of gs) { sendJSON(g, { t: 'hostLeft' }); setTimeout(() => g.close(), 300); }
      log('El anfitrión ha salido');
    } else if (role === 'guest') {
      room.guests.delete(id);
      if (room.host?.open) sendJSON(room.host, { t: 'leave', id });
      log(`${ws.name} ha salido`);
    }
  };
});

// ------------------------------------------------------------------ partida por Internet (túnel de Cloudflare)
const tunnel = { state: 'off', url: null, err: null, proc: null, got: 0, size: 0 };
const CF_NAME = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
const CF_DIR = path.join(os.homedir(), '.f1-ai-manager');
function cfDownloadURL() {
  const base = 'https://github.com/cloudflare/cloudflared/releases/latest/download/';
  if (process.platform === 'win32') return base + (process.arch === 'ia32' ? 'cloudflared-windows-386.exe' : 'cloudflared-windows-amd64.exe');
  if (process.platform === 'linux') return base + `cloudflared-linux-${process.arch === 'arm64' ? 'arm64' : process.arch === 'arm' ? 'arm' : 'amd64'}`;
  return null;
}
function findCloudflared() {
  return [path.join(ROOT, CF_NAME), path.join(ROOT, 'bin', CF_NAME), path.join(CF_DIR, CF_NAME)].find((f) => fs.existsSync(f));
}
function download(url, dest, hops = 6) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'f1-ai-manager' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops > 0) { res.resume(); download(new URL(res.headers.location, url).href, dest, hops - 1).then(resolve, reject); return; }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`descarga fallida (${res.statusCode})`)); return; }
      tunnel.size = +res.headers['content-length'] || 0; tunnel.got = 0;
      const tmp = dest + '.part', out = fs.createWriteStream(tmp);
      res.on('data', (d) => { tunnel.got += d.length; });
      res.pipe(out);
      out.on('finish', () => out.close(() => { fs.renameSync(tmp, dest); try { fs.chmodSync(dest, 0o755); } catch { /* */ } resolve(dest); }));
      out.on('error', reject); res.on('error', reject);
    }).on('error', reject);
  });
}
async function startTunnel() {
  if (['downloading', 'starting', 'on'].includes(tunnel.state)) return;
  tunnel.err = null; tunnel.url = null;
  try {
    let bin = findCloudflared();
    if (!bin) {
      const url = cfDownloadURL(); if (!url) throw new Error('En este sistema no se puede crear el enlace automáticamente.');
      tunnel.state = 'downloading'; log('Descargando cloudflared (solo la primera vez)…');
      fs.mkdirSync(CF_DIR, { recursive: true });
      bin = await download(url, path.join(CF_DIR, CF_NAME));
    }
    tunnel.state = 'starting';
    const p = tunnel.proc = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const onData = (d) => {
      const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !tunnel.url) { tunnel.url = m[0]; tunnel.state = 'on'; log(`Partida por Internet: ${tunnel.url}`); }
    };
    p.stdout.on('data', onData); p.stderr.on('data', onData);
    p.on('error', (e) => { tunnel.state = 'error'; tunnel.err = e.message; });
    p.on('exit', (code) => {
      if (tunnel.proc === p) tunnel.proc = null;
      if (tunnel.state !== 'off') { tunnel.state = 'error'; tunnel.url = null; tunnel.err = `El enlace se ha cerrado (código ${code}). Pulsa otra vez para crear uno nuevo.`; }
    });
    setTimeout(() => { if (tunnel.state === 'starting' && tunnel.proc === p) { tunnel.state = 'error'; tunnel.err = 'Cloudflare no ha respondido. ¿Hay conexión a Internet?'; p.kill(); } }, 45000);
  } catch (e) { tunnel.state = 'error'; tunnel.err = `No se ha podido crear el enlace: ${e.message}`; log(tunnel.err); }
}
const stopTunnel = () => { tunnel.state = 'off'; try { tunnel.proc?.kill(); } catch { /* */ } };
process.on('exit', stopTunnel);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { stopTunnel(); process.exit(0); });

function log(t) { console.log(`[${new Date().toLocaleTimeString()}] ${t}`); }

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`El puerto ${PORT} ya está en uso: ¿ya tienes el juego abierto? Abriendo http://localhost:${PORT}/`);
    if (OPEN) openBrowser(`http://localhost:${PORT}/`);
    setTimeout(() => process.exit(0), 1500);
  } else { console.error(e); process.exit(1); }
});

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => { /* si no se puede, ya se ha escrito la dirección */ });
}

server.listen(PORT, () => {
  const ips = lanIPs();
  console.log('');
  console.log('  F1 AI MANAGER - servidor en marcha');
  console.log(`  Juego:  http://localhost:${PORT}/`);
  if (ips.length) console.log(`  Amigos en tu misma red: ${ips.map((ip) => `http://${ip}:${PORT}/`).join('   ')}`);
  console.log('  Por Internet: en la sala del juego, "Crear enlace para Internet".');
  console.log('  Usa Chrome o Edge. Cierra esta ventana (o Ctrl+C) para apagarlo.');
  console.log('');
  if (OPEN) openBrowser(`http://localhost:${PORT}/`);
});
