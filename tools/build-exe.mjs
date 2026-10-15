// Ejecutables (Node SEA: el servidor dentro de un binario de Node) para Windows y Linux, con el juego al lado.
//   node tools/build-exe.mjs [ruta al binario «node» de Linux x64, misma versión que este Node]
// Sale en release/: F1-AI-Manager-Windows(.zip) y F1-AI-Manager-Linux(.tar.gz).
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import zlib from 'zlib';

const P = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const OUT = path.join(P, 'release'), TMP = path.join(OUT, '.tmp');
const linuxNode = process.argv[2];
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
// npx sin pasar por la consola (rutas con espacios): su script junto a este Node
const npxCli = [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js'), path.join(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npx-cli.js')].find((f) => fs.existsSync(f));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

// 1) el servidor como blob de SEA
const cfg = path.join(TMP, 'sea-config.json'), blob = path.join(TMP, 'sea.blob');
fs.writeFileSync(cfg, JSON.stringify({ main: path.join(P, 'server.js'), output: blob, disableExperimentalSEAWarning: true }));
run(process.execPath, ['--experimental-sea-config', cfg]);

// 2) los archivos del juego
const copyGame = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['index.html', 'server.js', 'LEEME-MULTIJUGADOR.txt']) if (fs.existsSync(path.join(P, f))) fs.copyFileSync(path.join(P, f), path.join(dir, f));
  for (const d of ['js', 'vendor']) fs.cpSync(path.join(P, d), path.join(dir, d), { recursive: true });
};
const inject = (bin) => run(process.execPath, [npxCli, '--yes', 'postject@1.0.0-alpha.6', bin, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', FUSE, '--overwrite']);

// 3) Windows
if (process.platform === 'win32') {
  const dir = path.join(OUT, 'F1-AI-Manager-Windows'); copyGame(dir);
  const exe = path.join(dir, 'F1-AI-Manager.exe');
  fs.copyFileSync(process.execPath, exe);
  inject(exe);
  run('powershell', ['-NoProfile', '-Command', `Compress-Archive -Force -Path '${dir}' -DestinationPath '${dir}.zip'`]);
}

// 4) Linux
if (linuxNode) {
  const dir = path.join(OUT, 'F1-AI-Manager-Linux'); copyGame(dir);
  const bin = path.join(dir, 'F1-AI-Manager');
  fs.copyFileSync(linuxNode, bin);
  inject(bin);
  fs.writeFileSync(path.join(dir, 'jugar.sh'), fs.readFileSync(path.join(P, 'jugar.sh'), 'utf8').replace(/\r\n/g, '\n'));
  // tar hecho aquí para que el ejecutable y jugar.sh lleven permiso de ejecución aunque se empaquete en Windows
  fs.writeFileSync(dir + '.tar.gz', zlib.gzipSync(tarOf(dir, (rel) => rel === 'F1-AI-Manager' || rel === 'jugar.sh')));
}

// tar (ustar) mínimo: carpetas y archivos con sus permisos
function tarOf(root, isExec) {
  const base = path.basename(root), blocks = [];
  const header = (name, size, mode, type) => {
    const h = Buffer.alloc(512);
    let prefix = '';
    if (name.length > 100) { const k = name.lastIndexOf('/', 154); prefix = name.slice(0, k); name = name.slice(k + 1); }
    h.write(name, 0, 100); h.write(mode.toString(8).padStart(7, '0') + '\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(size.toString(8).padStart(11, '0') + '\0', 124); h.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136);
    h.write('        ', 148); h.write(type, 156); h.write('ustar\0', 257); h.write('00', 263); h.write(prefix, 345, 155);
    let sum = 0; for (const b of h) sum += b; h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return h;
  };
  const walk = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const a = path.join(abs, e.name), r = rel ? `${rel}/${e.name}` : e.name, name = `${base}/${r}`;
      if (e.isDirectory()) { blocks.push(header(name + '/', 0, 0o755, '5')); walk(a, r); continue; }
      const data = fs.readFileSync(a);
      blocks.push(header(name, data.length, isExec(r) ? 0o755 : 0o644, '0'), data, Buffer.alloc((512 - (data.length % 512)) % 512));
    }
  };
  blocks.push(header(base + '/', 0, 0o755, '5')); walk(root, '');
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log('listo en', OUT);
