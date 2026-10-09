// L'icona dell'app (build/icon.png, 1024×1024) disegnata qui, senza programmi di grafica: quattro blocchi
// bianchi su un quadrato nero arrotondato. Con node:zlib si scrive il PNG a mano. electron-builder ne ricava .icns e .ico.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// pixel RGBA → PNG (filtro 0 su ogni riga)
export function png(lato, pixel) {
  const crc = b => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const pezzo = (tipo, dati) => { const t = Buffer.from(tipo), l = Buffer.alloc(4), c = Buffer.alloc(4); l.writeUInt32BE(dati.length); c.writeUInt32BE(crc(Buffer.concat([t, dati]))); return Buffer.concat([l, t, dati, c]); };
  const testa = Buffer.alloc(13); testa.writeUInt32BE(lato, 0); testa.writeUInt32BE(lato, 4); testa[8] = 8; testa[9] = 6;
  const righe = Buffer.alloc(lato * (lato * 4 + 1)); for (let y = 0; y < lato; y++) pixel.copy(righe, y * (lato * 4 + 1) + 1, y * lato * 4, (y + 1) * lato * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pezzo('IHDR', testa), pezzo('IDAT', deflateSync(righe, { level: 9 })), pezzo('IEND', Buffer.alloc(0))]);
}
// i quattro blocchi: «dentro» dice quanto un punto (0..1) è coperto, con un bordo morbido per l'antialias
export function disegna(lato, { sfondo = true } = {}) {
  const px = Buffer.alloc(lato * lato * 4), r = 0.2, blocchi = [[0.22, 0.22], [0.53, 0.22], [0.22, 0.53], [0.53, 0.53]], b = 0.25, rb = 0.035;
  const arrotondato = (x, y, x0, y0, w, raggio) => { const dx = Math.max(x0 + raggio - x, 0, x - (x0 + w - raggio)), dy = Math.max(y0 + raggio - y, 0, y - (y0 + w - raggio)); return Math.hypot(dx, dy) - raggio; };
  for (let j = 0; j < lato; j++) for (let i = 0; i < lato; i++) {
    const x = (i + 0.5) / lato, y = (j + 0.5) / lato, a = 1.5 / lato, cop = d => Math.min(1, Math.max(0, 0.5 - d / a));
    const fondo = sfondo ? cop(arrotondato(x, y, 0.06, 0.06, 0.88, r)) : 0, blocco = Math.max(...blocchi.map(([x0, y0]) => cop(arrotondato(x, y, x0, y0, b, rb))));
    const o = (j * lato + i) * 4;
    if (sfondo) { const v = Math.round(10 + 232 * blocco); px[o] = px[o + 1] = px[o + 2] = v; px[o + 3] = Math.round(255 * fondo); }
    else { px[o] = px[o + 1] = px[o + 2] = 0; px[o + 3] = Math.round(255 * blocco); }   // per la barra dei menu del Mac (immagine «modello»)
  }
  return px;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dove = join(dirname(fileURLToPath(import.meta.url)), 'build'); mkdirSync(dove, { recursive: true });
  writeFileSync(join(dove, 'icon.png'), png(1024, disegna(1024)));
  console.log('build/icon.png pronto');
}
